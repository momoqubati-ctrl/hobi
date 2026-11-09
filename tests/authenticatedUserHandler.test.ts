import assert from "node:assert/strict";
import { getResponseStatus, mockEvent } from "h3";
import test from "node:test";
import { createAuthenticatedUserHandler } from "../server/services/authenticatedUserHandler";

test("authenticated handlers receive the session identity instead of client-supplied IDs", async () => {
  let receivedUserId = "";
  const handler = createAuthenticatedUserHandler(
    (_event, auth) => {
      receivedUserId = auth.userId;
      return { success: true };
    },
    () => ({
      ok: true,
      userId: "session-account",
      username: "member",
      role: "member",
    }),
  );
  const event = mockEvent("/api/test?userId=another-account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "another-account" }),
  });

  await handler(event);

  assert.equal(receivedUserId, "session-account");
});

test("authenticated handlers stop before protected operations without a valid session", async () => {
  let called = false;
  const handler = createAuthenticatedUserHandler(
    () => {
      called = true;
      return { success: true };
    },
    () => ({
      ok: false,
      statusCode: 401,
      message: "غير مصرح",
    }),
  );
  const event = mockEvent("/api/test");

  const response = await handler(event);

  assert.deepEqual(response, { success: false, message: "غير مصرح" });
  assert.equal(getResponseStatus(event), 401);
  assert.equal(called, false);
});
