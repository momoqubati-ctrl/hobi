import assert from "node:assert/strict";
import { test } from "node:test";
import { getResponseHeader, getResponseStatus, mockEvent } from "h3";
import {
  getHostingOwnerPortalPath,
  isValidHostingOwnerPortalKey,
} from "../server/services/hostingOwnerPortal";
import portalHandler from "../server/routes/api/hosting-owner/portal.get";

test("hosting-owner portal paths are generated only from strong URL-safe keys", () => {
  const key = "a".repeat(43);

  assert.equal(getHostingOwnerPortalPath(key), `/hosting-owner/${key}`);
  assert.equal(getHostingOwnerPortalPath("short"), null);
  assert.equal(getHostingOwnerPortalPath(`${"a".repeat(43)}/extra`), null);
});

test("hosting-owner portal key validation rejects missing, malformed, and incorrect keys", () => {
  const key = "a".repeat(43);

  assert.equal(isValidHostingOwnerPortalKey(key, key), true);
  assert.equal(isValidHostingOwnerPortalKey("b".repeat(43), key), false);
  assert.equal(isValidHostingOwnerPortalKey(key, undefined), false);
  assert.equal(isValidHostingOwnerPortalKey("short", key), false);
});

test("hosting-owner portal readiness fails closed without configuration", async () => {
  const previousKey = process.env.HOSTING_OWNER_PORTAL_KEY;
  delete process.env.HOSTING_OWNER_PORTAL_KEY;

  try {
    const event = mockEvent("/api/hosting-owner/portal");
    const response = await portalHandler(event);

    assert.equal(getResponseStatus(event), 503);
    assert.equal(response.code, "HOSTING_OWNER_PORTAL_NOT_CONFIGURED");
  } finally {
    if (previousKey === undefined) delete process.env.HOSTING_OWNER_PORTAL_KEY;
    else process.env.HOSTING_OWNER_PORTAL_KEY = previousKey;
  }
});

test("hosting-owner portal readiness validates the key and disables caching", async () => {
  const key = "a".repeat(43);
  const previousKey = process.env.HOSTING_OWNER_PORTAL_KEY;
  process.env.HOSTING_OWNER_PORTAL_KEY = key;

  try {
    const event = mockEvent("/api/hosting-owner/portal", {
      headers: { "x-hosting-owner-portal-key": key },
    });
    const response = await portalHandler(event);

    assert.deepEqual(response, { success: true });
    assert.equal(getResponseStatus(event), 200);
    assert.equal(getResponseHeader(event, "Cache-Control"), "no-store");
    assert.equal(getResponseHeader(event, "Referrer-Policy"), "no-referrer");
  } finally {
    if (previousKey === undefined) delete process.env.HOSTING_OWNER_PORTAL_KEY;
    else process.env.HOSTING_OWNER_PORTAL_KEY = previousKey;
  }
});
