import assert from "node:assert/strict";
import test from "node:test";
import { getNewlyJoinedStagePeers } from "../src/lib/voiceStageConnections";

test("detects a listener becoming a stage peer while the local user remains on stage", () => {
  const previousStagePeers = new Set(["laptop-speaker"]);
  const updatedSeats = [
    { userId: "laptop-speaker" },
    { userId: "phone-speaker" },
  ];

  assert.deepStrictEqual(
    getNewlyJoinedStagePeers(previousStagePeers, updatedSeats, "laptop-speaker"),
    {
      stagePeerIds: new Set(["phone-speaker"]),
      newlyJoinedPeerIds: ["phone-speaker"],
    },
  );
});
