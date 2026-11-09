import assert from "node:assert/strict";
import test from "node:test";
import { isValidMentionName, sanitizeMentionName } from "../server/services/publicIdService";

test("mention_name validation accepts valid handles", () => {
  assert.equal(isValidMentionName("james"), true);
  assert.equal(isValidMentionName("james_007"), true);
  assert.equal(isValidMentionName("user-123"), true);
  assert.equal(isValidMentionName("احمد"), true);
});

test("mention_name validation rejects invalid formats", () => {
  assert.equal(isValidMentionName(""), false);
  assert.equal(isValidMentionName("a"), false); // too short (< 2)
  assert.equal(isValidMentionName("_james"), false); // leading underscore
  assert.equal(isValidMentionName("james_"), false); // trailing underscore
  assert.equal(isValidMentionName("james 007"), false); // space not allowed
  assert.equal(isValidMentionName("james@host"), false); // special character @ not allowed
});

test("sanitizeMentionName correctly normalizes handles", () => {
  assert.equal(sanitizeMentionName("James"), "james");
  assert.equal(sanitizeMentionName("  @James  "), "james");
  assert.equal(sanitizeMentionName("User Name 1"), "user_name_1");
});
