import assert from "node:assert/strict";
import test from "node:test";
import {
  EphemeralPrivateMessageStore,
  PrivateMessageRecipientOfflineError,
} from "../server/services/ephemeralPrivateMessageStore";
import { isEphemeralPrivateMessagingEnabled } from "../server/services/privateMessageService";

const future = () => Date.now() + 60_000;

test("ephemeral PM is disabled on sharded servers and requires a production opt-in", () => {
  assert.equal(isEphemeralPrivateMessagingEnabled({ NODE_ENV: "production" }), false);
  assert.equal(isEphemeralPrivateMessagingEnabled({
    NODE_ENV: "production",
    PM_EPHEMERAL_SINGLE_PROCESS: "true",
  }), true);
  assert.equal(isEphemeralPrivateMessagingEnabled({
    NODE_ENV: "production",
    PM_EPHEMERAL_SINGLE_PROCESS: "true",
    SOCKET_SHARD_ID: "shard-1",
  }), false);
  assert.equal(isEphemeralPrivateMessagingEnabled({ NODE_ENV: "development" }), true);
});

const createStoreWithOnlineRecipient = () => {
  const store = new EphemeralPrivateMessageStore();
  store.registerSession({ sessionId: "sender-session", userId: "sender", expiresAt: future() });
  store.registerSession({ sessionId: "recipient-session", userId: "recipient", expiresAt: future() });
  store.attachSocket("sender-session", "sender-socket");
  store.attachSocket("recipient-session", "recipient-socket");
  return store;
};

const sender = { id: "sender", name: "Sender", avatar: "/sender.png" };
const recipient = { id: "recipient", name: "Recipient", avatar: "/recipient.png" };

test("ephemeral private messages require an active recipient session", () => {
  const store = new EphemeralPrivateMessageStore();
  store.registerSession({ sessionId: "sender-session", userId: "sender", expiresAt: future() });
  store.attachSocket("sender-session", "sender-socket");

  assert.throws(
    () => store.send({
      sessionId: "sender-session",
      sender,
      receiver: recipient,
      text: "hello",
      clientId: "client-1",
    }),
    PrivateMessageRecipientOfflineError,
  );
  assert.deepEqual(store.listConversations("sender-session"), []);
  store.dispose();
});

test("messages are shared only with sessions bound to their conversation and retries are idempotent", () => {
  const store = createStoreWithOnlineRecipient();
  store.registerSession({ sessionId: "outsider-session", userId: "outsider", expiresAt: future() });
  store.attachSocket("outsider-session", "outsider-socket");

  const input = {
    sessionId: "sender-session",
    sender,
    receiver: recipient,
    text: "hello",
    clientId: "client-1",
  };
  const first = store.send(input);
  const retry = store.send(input);

  assert.equal(first.message.id, retry.message.id);
  assert.deepEqual(first.deliverySessionIds, ["recipient-session", "sender-session"]);
  assert.equal(store.getMessages("recipient-session", first.message.conversationId).length, 1);
  assert.deepEqual(store.listConversations("outsider-session"), []);
  assert.throws(
    () => store.send({ ...input, text: "different payload" }),
    { name: "PrivateMessageIdempotencyConflictError" },
  );
  store.dispose();
});

test("reaction updates target both participant sessions, including the reacting sender", () => {
  const store = createStoreWithOnlineRecipient();
  const sent = store.send({
    sessionId: "sender-session",
    sender,
    receiver: recipient,
    text: "hello",
    clientId: "client-reaction",
  });

  const result = store.react(
    "sender-session",
    sent.message.conversationId,
    sent.message.id,
    "love",
  );

  assert.deepEqual(result?.sessionIds, ["recipient-session", "sender-session"]);
  assert.deepEqual(result?.reactions, { sender: "love" });
  assert.deepEqual(
    store.getMessages("sender-session", sent.message.conversationId)[0].reactions,
    { sender: "love" },
  );
  store.dispose();
});

test("private media is delivered only to active conversation sessions and removed when context ends", () => {
  const store = createStoreWithOnlineRecipient();
  store.registerSession({ sessionId: "outsider-session", userId: "outsider", expiresAt: future() });
  store.attachSocket("outsider-session", "outsider-socket");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const mediaId = store.stageMedia({
    sessionId: "sender-session",
    receiverId: recipient.id,
    contentType: "image/png",
    mediaType: "image",
    bytes,
  });

  assert.ok(mediaId);
  const sent = store.send({
    sessionId: "sender-session",
    sender,
    receiver: recipient,
    text: "",
    clientId: "client-media",
    mediaId: mediaId!,
    mediaType: "image",
  });
  const retry = store.send({
    sessionId: "sender-session",
    sender,
    receiver: recipient,
    text: "",
    clientId: "client-media",
    mediaId: mediaId!,
    mediaType: "image",
  });

  assert.equal(sent.message.mediaUrl, `/api/pm/media/${mediaId}`);
  assert.equal(retry.message.id, sent.message.id);
  assert.throws(
    () => store.send({
      sessionId: "sender-session",
      sender,
      receiver: recipient,
      text: "",
      clientId: "client-media-replay",
      mediaId: mediaId!,
      mediaType: "image",
    }),
    { name: "PrivateMessageSessionError" },
  );
  assert.deepEqual(store.getMedia("sender-session", mediaId!), {
    bytes,
    contentType: "image/png",
  });
  assert.deepEqual(store.getMedia("recipient-session", mediaId!), {
    bytes,
    contentType: "image/png",
  });
  assert.equal(store.getMedia("outsider-session", mediaId!), null);

  store.endSession("recipient-session", "logout");
  assert.equal(store.getMedia("sender-session", mediaId!), null);
  store.dispose();
});

test("ending either participant session removes the conversation for both sides", () => {
  const store = createStoreWithOnlineRecipient();
  const sent = store.send({
    sessionId: "sender-session",
    sender,
    receiver: recipient,
    text: "hello",
    clientId: "client-1",
  });

  const ended = store.endSession("recipient-session", "logout");

  assert.equal(ended.expiredConversations.length, 1);
  assert.deepEqual(
    ended.expiredConversations[0].sessionIds,
    ["recipient-session", "sender-session"],
  );
  assert.deepEqual(store.listConversations("sender-session"), []);
  assert.deepEqual(store.listConversations("recipient-session"), []);
  assert.equal(
    store.registerSession({ sessionId: "recipient-session", userId: "recipient", expiresAt: future() }),
    false,
  );
  assert.equal(sent.message.text, "hello");
  store.dispose();
});

test("session expiry removes conversations and reports the reason", () => {
  const store = new EphemeralPrivateMessageStore();
  const expiredAt = Date.now() + 20;
  store.registerSession({ sessionId: "sender-session", userId: "sender", expiresAt: expiredAt });
  store.registerSession({ sessionId: "recipient-session", userId: "recipient", expiresAt: future() });
  store.attachSocket("sender-session", "sender-socket");
  store.attachSocket("recipient-session", "recipient-socket");
  store.send({
    sessionId: "sender-session",
    sender,
    receiver: recipient,
    text: "hello",
    clientId: "client-1",
  });

  const ended = store.expireSessions(expiredAt + 1);

  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, "expired");
  assert.deepEqual(store.listConversations("recipient-session"), []);
  store.dispose();
});
