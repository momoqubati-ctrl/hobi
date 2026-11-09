import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostingOwnerPortalHeaders,
  readHostingOwnerApiResponse,
} from "../src/lib/hosting-owner-portal-api";

test("hosting-owner requests include the portal key and optional idempotency header", () => {
  assert.deepEqual(hostingOwnerPortalHeaders("portal-key"), {
    "x-hosting-owner-portal-key": "portal-key",
  });
  assert.deepEqual(hostingOwnerPortalHeaders("portal-key", "attempt-1"), {
    "x-hosting-owner-portal-key": "portal-key",
    "Idempotency-Key": "attempt-1",
  });
});

test("hosting-owner API response reader returns successful payloads", async () => {
  const response = new Response(JSON.stringify({ success: true, balanceCoins: "1250" }), {
    status: 200,
  });

  assert.deepEqual(await readHostingOwnerApiResponse(response), {
    success: true,
    balanceCoins: "1250",
  });
});

test("hosting-owner API response reader surfaces server errors and malformed responses", async () => {
  const failure = new Response(JSON.stringify({ success: false, message: "تم رفض الطلب" }), {
    status: 409,
  });
  const malformed = new Response("not-json", { status: 200 });

  await assert.rejects(readHostingOwnerApiResponse(failure), /تم رفض الطلب/);
  await assert.rejects(readHostingOwnerApiResponse(malformed), /استجابة غير صالحة/);
});
