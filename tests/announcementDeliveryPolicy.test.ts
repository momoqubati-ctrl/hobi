import assert from "node:assert/strict";
import test from "node:test";
import { resolveAnnouncementSenderPolicy } from "../server/services/announcementDeliveryPolicy";

const now = new Date("2026-03-01T12:00:00.000Z");

test("announcement policy combines only active assigned roles that grant an announcement type", () => {
  const policy = resolveAnnouncementSenderPolicy(
    "ordinary-user",
    [
      {
        isActive: true,
        isDefault: false,
        isOwner: false,
        startsAt: new Date("2026-03-01T12:00:00.000Z"),
        expiresAt: null,
        dailyLimit: 50,
        permissionKeys: ["announcement_all.use"],
      },
      {
        isActive: true,
        isDefault: false,
        isOwner: false,
        startsAt: new Date("2026-02-01T00:00:00.000Z"),
        expiresAt: new Date("2026-03-01T12:00:00.001Z"),
        dailyLimit: 100,
        permissionKeys: ["announcement_room.use"],
      },
      {
        isActive: true,
        isDefault: false,
        isOwner: false,
        startsAt: new Date("2026-02-01T00:00:00.000Z"),
        expiresAt: null,
        dailyLimit: 1000,
        permissionKeys: ["room_chat.use"],
      },
      {
        isActive: true,
        isDefault: false,
        isOwner: false,
        startsAt: new Date("2026-02-01T00:00:00.000Z"),
        expiresAt: null,
        dailyLimit: 25,
        permissionKeys: ["announcement_ranked.use"],
      },
      {
        isActive: false,
        isDefault: false,
        isOwner: false,
        startsAt: new Date("2026-02-01T00:00:00.000Z"),
        expiresAt: null,
        dailyLimit: 1000,
        permissionKeys: ["announcement_ranked.use"],
      },
    ],
    now,
  );

  assert.deepEqual(policy.allowedTypes, ["all", "room", "ranked"]);
  assert.equal(policy.dailyLimit, 100);
});

test("announcement policy excludes roles that have not started or have expired", () => {
  const policy = resolveAnnouncementSenderPolicy(
    "ordinary-user",
    [
      {
        isActive: true,
        isDefault: false,
        isOwner: false,
        startsAt: new Date("2026-03-01T12:00:00.001Z"),
        expiresAt: null,
        dailyLimit: 100,
        permissionKeys: ["announcement_all.use"],
      },
      {
        isActive: true,
        isDefault: false,
        isOwner: false,
        startsAt: new Date("2026-02-01T00:00:00.000Z"),
        expiresAt: new Date("2026-03-01T12:00:00.000Z"),
        dailyLimit: 100,
        permissionKeys: ["announcement_room.use"],
      },
    ],
    now,
  );

  assert.deepEqual(policy.allowedTypes, []);
  assert.equal(policy.dailyLimit, 0);
});

test("announcement policy enforces zero and maximum configured role limits", () => {
  const role = (dailyLimit: number) => ({
    isActive: true,
    isDefault: false,
    isOwner: false,
    startsAt: new Date("2026-02-01T00:00:00.000Z"),
    expiresAt: null,
    dailyLimit,
    permissionKeys: ["announcement_ranked.use"],
  });

  assert.equal(
    resolveAnnouncementSenderPolicy("ordinary-user", [role(0)], now).dailyLimit,
    0,
  );
  assert.equal(
    resolveAnnouncementSenderPolicy("ordinary-user", [role(1000)], now).dailyLimit,
    1000,
  );
});

test("only the designated account with an active owner-role assignment gets the owner allowance", () => {
  const ownerRole = {
    isActive: true,
    isDefault: false,
    isOwner: true,
    startsAt: new Date("2026-02-01T00:00:00.000Z"),
    expiresAt: null,
    dailyLimit: 0,
    permissionKeys: [],
  };

  const designatedOwner = resolveAnnouncementSenderPolicy("safarihost", [ownerRole], now);
  assert.deepEqual(designatedOwner.allowedTypes, ["all", "ranked", "room"]);
  assert.equal(designatedOwner.dailyLimit, 10000);

  const otherAccount = resolveAnnouncementSenderPolicy("other-user", [ownerRole], now);
  assert.deepEqual(otherAccount.allowedTypes, []);
  assert.equal(otherAccount.dailyLimit, 0);
});
