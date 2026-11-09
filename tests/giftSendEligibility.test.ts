import assert from "node:assert/strict";
import { test } from "node:test";
import { canSendContextualGift } from "../src/lib/gift-send-eligibility";

test("registered members can open a contextual gift action for another member", () => {
  assert.equal(
    canSendContextualGift(
      { id: "sender-1", role: "member" },
      { id: "receiver-2", role: "member" },
    ),
    true,
  );
});

test("contextual gifts reject self-gifting", () => {
  assert.equal(
    canSendContextualGift(
      { id: "member-1", role: "member" },
      { id: "member-1", role: "member" },
    ),
    false,
  );
});

test("contextual gifts reject guest senders and guest recipients", () => {
  for (const role of ["guest", "visitor", "زائر"]) {
    assert.equal(
      canSendContextualGift(
        { id: `${role}-1`, role },
        { id: "member-2", role: "member" },
      ),
      false,
    );
    assert.equal(
      canSendContextualGift(
        { id: "member-1", role: "member" },
        { id: `${role}-2`, role },
      ),
      false,
    );
  }
});

test("contextual gifts reject non-member system and bot recipients", () => {
  for (const role of ["system", "bot"]) {
    assert.equal(
      canSendContextualGift(
        { id: "member-1", role: "member" },
        { id: `${role}-2`, role },
      ),
      false,
    );
  }
});

test("contextual gifts reject absent or placeholder identities", () => {
  assert.equal(
    canSendContextualGift({ id: "0", role: "member" }, { id: "member-2" }),
    false,
  );
  assert.equal(
    canSendContextualGift({ id: "member-1", role: "member" }, { id: "" }),
    false,
  );
});
