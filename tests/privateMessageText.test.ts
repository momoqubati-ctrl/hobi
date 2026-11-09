import assert from "node:assert/strict";
import test from "node:test";
import { processPrivateMessageText } from "../server/services/privateMessageText";

test("private-message processing expands shortcuts before applying the shared filter", async () => {
  const filterInputs: Array<Record<string, unknown>> = [];
  const filtered = await processPrivateMessageText(
    "hi",
    {
      username: "sender",
      topic: "sender",
      ip: "127.0.0.2",
      recipientId: "recipient-id",
      recipientName: "Recipient",
    },
    {
      expandShortcuts: async () => "expanded text",
      processText: async (params) => {
        filterInputs.push(params);
        return { filteredText: "filtered text" };
      },
    },
  );

  assert.equal(filtered, "filtered text");
  assert.equal(filterInputs[0]?.text, "expanded text");
  assert.equal(filterInputs[0]?.source, "محادثة خاصة مع Recipient");
  assert.equal(filterInputs[0]?.target, "recipient-id");
  assert.equal(filterInputs[0]?.suppressSideEffects, true);
});

test("private-message processing fails rather than sending unfiltered text after an error", async () => {
  await assert.rejects(
    processPrivateMessageText(
      "private text",
      {
        username: "sender",
        topic: "sender",
        ip: "127.0.0.2",
        recipientId: "recipient-id",
        recipientName: "Recipient",
      },
      {
        expandShortcuts: async () => "expanded text",
        processText: async () => {
          throw new Error("filter unavailable");
        },
      },
    ),
    /filter unavailable/,
  );
});
