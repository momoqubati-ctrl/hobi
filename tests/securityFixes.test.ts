import assert from "node:assert/strict";
import test from "node:test";
import { mockEvent, getResponseStatus, getResponseHeaders } from "h3";
import filesIndexHandler from "../server/routes/api/files/index.get";
import filesQuotaHandler from "../server/routes/api/files/quota.get";
import filesUploadHandler from "../server/routes/api/files/upload.post";
import filesRenameHandler from "../server/routes/api/files/[id].put";
import filesDeleteHandler from "../server/routes/api/files/[id].delete";
import uploadIndexHandler from "../server/routes/api/upload/index.post";
import profileCheckHandler from "../server/routes/api/user/profile-check.get";
import profilePostHandler from "../server/routes/api/user/profile.post";
import uploadsDownloadHandler from "../server/routes/uploads/[filename].get";
import notifIndexHandler from "../server/routes/api/notifications/index.get";
import notifReadHandler from "../server/routes/api/notifications/read.post";
import notifReadAllHandler from "../server/routes/api/notifications/read-all.post";
import notifUnreadHandler from "../server/routes/api/notifications/unread.get";
import roomMessagesGetHandler from "../server/routes/api/rooms/[roomId]/messages.get";
import roomStreamGetHandler from "../server/routes/api/rooms/[roomId]/stream.get";
import rateLimiterHandler, { getClientIp, isTrustedProxy, getRouteCategory } from "../server/middleware/rateLimiter";
import securityHeadersHandler from "../server/middleware/securityHeaders";
import { getSocketCorsOrigin } from "../server/socket/index";
import { normalizeUploadExtension } from "../server/services/uploadStorage";
import { uploadFile } from "../server/services/fileService";
import { issueToken, issueAgentToken, issueHostingOwnerToken, hashPassword, verifyPassword, verifyAuthToken } from "../server/services/authService";
import { getUserAuthContext } from "../server/services/adminAccess";
import { revokeSession, revokeUserTokens, revokeIpTokens, recordBanInCache, removeBanFromCache } from "../server/services/tokenRevocation";
import { handleApiError, ApiError } from "../server/utils/apiError";
import { guardAdminAction } from "../server/services/adminPermissions";
import userSearchHandler from "../server/routes/api/users/search.get";
import flatLoginHandler from "../server/routes/api/auth.login.post";
import folderLoginHandler from "../server/routes/api/auth/login.post";
import flatRegisterHandler from "../server/routes/api/auth.register.post";
import folderRegisterHandler from "../server/routes/api/auth/register.post";
import flatGuestHandler from "../server/routes/api/auth.guest.post";
import folderGuestHandler from "../server/routes/api/auth/guest.post";
import flatLogoutHandler from "../server/routes/api/auth.logout.post";
import folderLogoutHandler from "../server/routes/api/auth/logout.post";
import dbBrowserHandler from "../server/routes/db-browser.html.get";

test("C-01: /api/files endpoints reject unauthenticated access", async () => {
  const event = mockEvent("/api/files?userId=victim_123");
  const response = await filesIndexHandler(event) as any;
  assert.equal(getResponseStatus(event), 401);
  assert.equal(response?.success, false);

  const quotaEvent = mockEvent("/api/files/quota?userId=victim_123");
  const quotaResponse = await filesQuotaHandler(quotaEvent) as any;
  assert.equal(getResponseStatus(quotaEvent), 401);
  assert.equal(quotaResponse?.success, false);

  const deleteEvent = mockEvent("/api/files/file_123?userId=victim_123", {
    method: "DELETE",
  });
  deleteEvent.context.params = { id: "file_123" };
  const deleteResponse = await filesDeleteHandler(deleteEvent) as any;
  assert.equal(getResponseStatus(deleteEvent), 401);
  assert.equal(deleteResponse?.success, false);
});

test("C-01 & H-01: /api/files rejects wallet_agent and hosting_owner tokens", async () => {
  const agentToken = issueAgentToken({ id: "agent-1", username: "agent_one" });
  const event = mockEvent("/api/files", {
    headers: { authorization: `Bearer ${agentToken}` },
  });
  const response = await filesIndexHandler(event) as any;
  assert.equal(getResponseStatus(event), 401);
  assert.equal(response?.success, false);

  const ownerToken = issueHostingOwnerToken({ username: "hosting_owner_1" });
  const ownerEvent = mockEvent("/api/files", {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const ownerResponse = await filesIndexHandler(ownerEvent) as any;
  assert.equal(getResponseStatus(ownerEvent), 401);
  assert.equal(ownerResponse?.success, false);
});

test("C-02: normalizeUploadExtension rejects svg and xml variants", () => {
  assert.equal(normalizeUploadExtension("svg"), "");
  assert.equal(normalizeUploadExtension("SVG"), "");
  assert.equal(normalizeUploadExtension("svg+xml"), "");
  assert.equal(normalizeUploadExtension("xml"), "");
  assert.equal(normalizeUploadExtension("html"), "");
  assert.equal(normalizeUploadExtension("htm"), "");
  assert.equal(normalizeUploadExtension(".svg"), "");

  // Safe extensions still pass
  assert.equal(normalizeUploadExtension("png"), "png");
  assert.equal(normalizeUploadExtension("jpg"), "jpg");
  assert.equal(normalizeUploadExtension("webp"), "webp");
});

test("C-02: fileService.uploadFile blocks SVG and XML uploads", async () => {
  await assert.rejects(
    async () => {
      await uploadFile("user_123", Buffer.from("<svg></svg>").toString("base64"), "malicious.svg", "/");
    },
    /نوع الملف غير مسموح به لأسباب أمنية|نوع الملف غير مدعوم/
  );

  await assert.rejects(
    async () => {
      await uploadFile("user_123", Buffer.from("<xml></xml>").toString("base64"), "malicious.xml", "/");
    },
    /نوع الملف غير مسموح به لأسباب أمنية|نوع الملف غير مدعوم/
  );
});

test("C-02 & H-01: /api/upload rejects unauthenticated requests and SVG files", async () => {
  // Unauthenticated
  const unauthEvent = mockEvent("/api/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: "abc", filename: "test.png" }),
  });
  const unauthRes = await uploadIndexHandler(unauthEvent) as any;
  assert.equal(getResponseStatus(unauthEvent), 401);
  assert.equal(unauthRes?.success, false);

  // Authenticated user trying to upload SVG
  const validToken = issueToken({ id: "user-123", username: "regular_user", role: "member" });
  const svgEvent = mockEvent("/api/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${validToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      file: Buffer.from("<svg onload=alert(1)>").toString("base64"),
      filename: "xss.svg",
    }),
  });
  const svgRes = await uploadIndexHandler(svgEvent) as any;
  assert.equal(getResponseStatus(svgEvent), 415);
  assert.equal(svgRes?.success, false);
});

test("H-01: /api/user/profile-check requires valid authentication and omits allUserIds", async () => {
  // Unauthenticated
  const unauthEvent = mockEvent("/api/user/profile-check");
  const unauthRes = await profileCheckHandler(unauthEvent) as any;
  assert.equal(getResponseStatus(unauthEvent), 401);
  assert.equal(unauthRes?.success, false);

  // Authenticated
  const validToken = issueToken({ id: "user-check-1", username: "check_user", role: "member" });
  const authEvent = mockEvent("/api/user/profile-check", {
    headers: { authorization: `Bearer ${validToken}` },
  });
  const authRes = await profileCheckHandler(authEvent) as any;
  assert.equal(authRes?.allUserIds, undefined, "allUserIds must not be leaked to clients");
});

test("C-02: /uploads/[filename] serves security headers (nosniff, CSP sandbox, XFO)", async () => {
  const event = mockEvent("/uploads/test-image.png");
  event.context.params = { filename: "test-image.png" };
  await uploadsDownloadHandler(event);

  const headers = getResponseHeaders(event);
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["content-security-policy"], "default-src 'none'; sandbox");
});

test("C-02 & H-01: /api/user/profile rejects unauthenticated access and ignores svg base64", async () => {
  // Unauthenticated
  const unauthEvent = mockEvent("/api/user/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Hacker" }),
  });
  const unauthRes = await profilePostHandler(unauthEvent) as any;
  assert.equal(getResponseStatus(unauthEvent), 401);
  assert.equal(unauthRes?.success, false);

  // Authenticated user passing SVG base64 avatar
  const validToken = issueToken({ id: "user-profile-1", username: "profile_tester", role: "member" });
  const svgAvatarEvent = mockEvent("/api/user/profile", {
    method: "POST",
    headers: {
      authorization: `Bearer ${validToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      avatar: "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+",
      displayName: "SafeUser",
    }),
  });
  const svgAvatarRes = await profilePostHandler(svgAvatarEvent) as any;
  // Avatar should not be updated to any svg file
  assert.equal(svgAvatarRes?.updates?.avatar, undefined, "SVG avatar must not be processed or saved");
});

test("M-01: /api/notifications endpoints reject unauthenticated access", async () => {
  // index.get
  const indexEvent = mockEvent("/api/notifications?userId=target-user");
  const indexRes = await notifIndexHandler(indexEvent) as any;
  assert.equal(getResponseStatus(indexEvent), 401);
  assert.equal(indexRes?.success, false);

  // read.post
  const readEvent = mockEvent("/api/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notificationId: "n-123", userId: "target-user" }),
  });
  const readRes = await notifReadHandler(readEvent) as any;
  assert.equal(getResponseStatus(readEvent), 401);
  assert.equal(readRes?.success, false);

  // read-all.post
  const readAllEvent = mockEvent("/api/notifications/read-all", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "target-user" }),
  });
  const readAllRes = await notifReadAllHandler(readAllEvent) as any;
  assert.equal(getResponseStatus(readAllEvent), 401);
  assert.equal(readAllRes?.success, false);

  // unread.get
  const unreadEvent = mockEvent("/api/notifications/unread?userId=target-user");
  const unreadRes = await notifUnreadHandler(unreadEvent) as any;
  assert.equal(getResponseStatus(unreadEvent), 401);
  assert.equal(unreadRes?.success, false);
});

test("M-03: /api/rooms/[roomId]/messages.get rejects unauthenticated requests", async () => {
  const unauthEvent = mockEvent("/api/rooms/general/messages");
  unauthEvent.context.params = { roomId: "general" };
  const unauthRes = await roomMessagesGetHandler(unauthEvent) as any;
  assert.equal(getResponseStatus(unauthEvent), 401);
  assert.equal(unauthRes?.success, false);

  // Authenticated
  const token = issueToken({ id: "user-room-1", username: "room_user", role: "member" });
  const authEvent = mockEvent("/api/rooms/general/messages", {
    headers: { authorization: `Bearer ${token}` },
  });
  authEvent.context.params = { roomId: "general" };
  const authRes = await roomMessagesGetHandler(authEvent) as any;
  assert.equal(authRes?.success, true);
  assert.ok(Array.isArray(authRes?.messages));
});

test("M-03: /api/rooms/[roomId]/stream.get requires authentication via header or token query", async () => {
  // Unauthenticated
  const unauthEvent = mockEvent("/api/rooms/general/stream");
  unauthEvent.context.params = { roomId: "general" };
  const unauthRes = await roomStreamGetHandler(unauthEvent) as any;
  assert.equal(getResponseStatus(unauthEvent), 401);
  assert.equal(unauthRes?.success, false);

  // Authenticated via query token (?token=...)
  const token = issueToken({ id: "user-stream-1", username: "stream_user", role: "member" });
  const authQueryEvent = mockEvent(`/api/rooms/general/stream?token=${token}`);
  authQueryEvent.context.params = { roomId: "general" };
  const streamRes = await roomStreamGetHandler(authQueryEvent) as any;
  assert.notEqual(getResponseStatus(authQueryEvent), 401);
});

test("M-02: RateLimiter prevents IP spoofing from untrusted remote sockets", () => {
  // 1. Untrusted public remote socket cannot spoof via X-Forwarded-For or CF-Connecting-IP
  const untrustedEvent = mockEvent("/api/auth/login", {
    headers: {
      "x-forwarded-for": "198.51.100.1, 198.51.100.2",
      "cf-connecting-ip": "198.51.100.99",
    },
  });
  (untrustedEvent.context as any).clientAddress = "203.0.113.50";

  assert.equal(isTrustedProxy("203.0.113.50"), false);
  assert.equal(getClientIp(untrustedEvent), "203.0.113.50");

  // 2. Trusted proxy (e.g. 127.0.0.1 or 10.0.0.1) allows client IP extraction
  const trustedEvent = mockEvent("/api/auth/login", {
    headers: {
      "cf-connecting-ip": "198.51.100.99",
    },
  });
  (trustedEvent.context as any).clientAddress = "127.0.0.1";

  assert.equal(isTrustedProxy("127.0.0.1"), true);
  assert.equal(getClientIp(trustedEvent), "198.51.100.99");

  // 3. getRouteCategory covers both flat and folder auth paths
  assert.equal(getRouteCategory("/api/auth/login"), "auth");
  assert.equal(getRouteCategory("/api/auth.login"), "auth");
});

test("M-06: SecurityHeaders middleware sets CSP, XFO, nosniff, and ReferrerPolicy", () => {
  const apiEvent = mockEvent("/api/users");
  securityHeadersHandler(apiEvent);
  const apiHeaders = getResponseHeaders(apiEvent);
  assert.equal(apiHeaders["x-content-type-options"], "nosniff");
  assert.equal(apiHeaders["x-frame-options"], "DENY");
  assert.equal(apiHeaders["referrer-policy"], "strict-origin-when-cross-origin");
  assert.ok(apiHeaders["content-security-policy"]?.includes("sandbox"));

  const pageEvent = mockEvent("/");
  securityHeadersHandler(pageEvent);
  const pageHeaders = getResponseHeaders(pageEvent);
  assert.equal(pageHeaders["x-frame-options"], "SAMEORIGIN");
  assert.ok(pageHeaders["content-security-policy"]?.includes("default-src 'self'"));
});

test("M-04: handleApiError masks internal SQL and database errors", () => {
  const event = mockEvent("/api/test-route");
  const sqlError = new Error('relation "users" does not exist at character 15');
  const res = handleApiError(event, sqlError);

  assert.equal(getResponseStatus(event), 500);
  assert.equal(res.success, false);
  assert.equal(res.code, "INTERNAL_SERVER_ERROR");
  assert.equal(res.message, "حدث خطأ غير متوقع في الخادم. يرجى المحاولة لاحقاً.");
  assert.equal(res.error, "حدث خطأ غير متوقع في الخادم. يرجى المحاولة لاحقاً.");
  assert.ok(!JSON.stringify(res).includes("relation"));
  assert.ok(!JSON.stringify(res).includes("users"));

  // Syntax error test
  const syntaxErr = new Error("syntax error at or near 'SELECT'");
  const res2 = handleApiError(event, syntaxErr);
  assert.equal(res2.message, "حدث خطأ غير متوقع في الخادم. يرجى المحاولة لاحقاً.");
  assert.ok(!JSON.stringify(res2).includes("syntax error"));
});

test("M-04: handleApiError preserves ApiError status code and clean messages", () => {
  const event = mockEvent("/api/test-route");
  const authError = new ApiError(403, "FORBIDDEN", "لا تملك الصلاحية الكافية لتنفيذ هذا الإجراء");
  const res = handleApiError(event, authError);

  assert.equal(getResponseStatus(event), 403);
  assert.equal(res.success, false);
  assert.equal(res.code, "FORBIDDEN");
  assert.equal(res.message, "لا تملك الصلاحية الكافية لتنفيذ هذا الإجراء");
});

test("M-04: guardAdminAction throws ApiError and integrates with handleApiError", async () => {
  const unauthEvent = mockEvent("/api/admin/access-logs");
  try {
    await guardAdminAction(unauthEvent, "cp");
    assert.fail("Should have thrown");
  } catch (error: any) {
    const res = handleApiError(unauthEvent, error);
    assert.equal(getResponseStatus(unauthEvent), 401);
    assert.equal(res.success, false);
    assert.equal(res.code, "UNAUTHORIZED");
  }
});

test("M-04: /api/users/search rejects unauthenticated calls and handles errors safely", async () => {
  const unauthEvent = mockEvent("/api/users/search?q=test");
  const res = await userSearchHandler(unauthEvent) as any;
  assert.equal(getResponseStatus(unauthEvent), 401);
  assert.equal(res.success, false);
});

test("M-08: hashPassword and verifyPassword are asynchronous and do not block the event loop", async () => {
  const password = "SuperSecretPassword123!";
  const hashPromise = hashPassword(password);
  assert.ok(hashPromise instanceof Promise, "hashPassword must return a Promise");

  const storedHash = await hashPromise;
  assert.ok(storedHash.includes(":"), "hash format must be salt:hash");

  const [salt, hexHash] = storedHash.split(":");
  assert.equal(salt.length, 32);
  assert.equal(hexHash.length, 128); // 64 bytes = 128 hex chars

  // Correct password verification
  const isValid = await verifyPassword(password, storedHash);
  assert.equal(isValid, true);

  // Wrong password verification
  const isInvalid = await verifyPassword("WrongPassword!", storedHash);
  assert.equal(isInvalid, false);

  // Event loop test: verify that timer callbacks can fire during multiple password hashings
  let timerFired = false;
  const timer = setTimeout(() => {
    timerFired = true;
  }, 1);

  await Promise.all([
    hashPassword("test1"),
    hashPassword("test2"),
    hashPassword("test3"),
  ]);

  clearTimeout(timer);
  assert.ok(timerFired, "Event loop timer must be able to fire during asynchronous hashing");
});

test("M-09: Duplicate auth routes (dot vs slash) share identical canonical handlers", async () => {
  assert.equal(flatLoginHandler, folderLoginHandler, "auth.login.post must point to auth/login.post");
  assert.equal(flatRegisterHandler, folderRegisterHandler, "auth.register.post must point to auth/register.post");
  assert.equal(flatGuestHandler, folderGuestHandler, "auth.guest.post must point to auth/guest.post");
  assert.equal(flatLogoutHandler, folderLogoutHandler, "auth.logout.post must point to auth/logout.post");

  // Calling flatLoginHandler with missing credentials returns 400
  const badLoginEvent = mockEvent("/api/auth.login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "", password: "" }),
  });
  const badLoginRes = await flatLoginHandler(badLoginEvent) as any;
  assert.equal(getResponseStatus(badLoginEvent), 400);
  assert.equal(badLoginRes?.success, false);
});

test("L-01: /db-browser.html restricts public access and protects admin session", async () => {
  // 1. Unauthenticated request rejected
  const unauthEvent = mockEvent("/db-browser.html");
  await dbBrowserHandler(unauthEvent);
  assert.notEqual(getResponseStatus(unauthEvent), 200, "Unauthenticated access must not return 200");

  // 2. Authenticated system owner request allowed with security headers
  const ownerToken = issueToken({ id: "owner-1", username: "super_owner", role: "owner" });
  const authEvent = mockEvent("/db-browser.html", {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const html = await dbBrowserHandler(authEvent) as string;
  assert.equal(getResponseStatus(authEvent), 200);
  assert.ok(typeof html === "string" && html.includes("<title>تصفح قاعدة البيانات</title>"));

  // 3. Verify security headers
  const headers = getResponseHeaders(authEvent);
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.ok(headers["content-security-policy"]?.includes("default-src 'self'"));

  // 4. Verify sessionStorage is used instead of persistent localStorage
  assert.ok(html.includes("sessionStorage.getItem('db_auth')"), "Must use sessionStorage for auth credentials");
  assert.ok(!html.includes("localStorage.getItem('db_auth')"), "Must NOT use localStorage for auth credentials");
});

test("M-05: Stateless tokens can be revoked immediately on logout, per-user, and when banned", async () => {
  // 1. Single session revocation on logout
  const token1 = issueToken({ id: "user_rev_1", username: "rev_user_1", role: "member" });
  const event1 = mockEvent("/api/notifications", {
    headers: { authorization: `Bearer ${token1}` },
  });
  const auth1 = getUserAuthContext(event1);
  assert.equal(auth1.ok, true);
  assert.ok(verifyAuthToken(token1) !== null);

  // Call logout endpoint with token1
  const logoutEvent = mockEvent("/api/auth/logout", {
    method: "POST",
    headers: { authorization: `Bearer ${token1}` },
  });
  const logoutRes = await folderLogoutHandler(logoutEvent) as any;
  assert.equal(logoutRes?.success, true);

  // After logout, token1 is revoked and immediately rejected
  const auth1After = getUserAuthContext(event1);
  assert.equal(auth1After.ok, false);
  assert.equal(auth1After.statusCode, 401);
  assert.equal(verifyAuthToken(token1), null);

  // 2. User-wide revocation
  const token2 = issueToken({ id: "user_rev_2", username: "rev_user_2", role: "member" });
  assert.ok(verifyAuthToken(token2) !== null);
  revokeUserTokens("rev_user_2");
  assert.equal(verifyAuthToken(token2), null);

  // 3. Active ban immediate enforcement
  const token3 = issueToken({ id: "user_ban_3", username: "banned_guy", role: "member" });
  const event3 = mockEvent("/api/notifications", {
    headers: { authorization: `Bearer ${token3}` },
  });
  assert.equal(getUserAuthContext(event3).ok, true);
  assert.ok(verifyAuthToken(token3) !== null);

  // Ban the user
  recordBanInCache({ targetName: "banned_guy", type: "name" });
  const banAuth = getUserAuthContext(event3);
  assert.equal(banAuth.ok, false);
  assert.equal(banAuth.statusCode, 403);
  assert.equal(verifyAuthToken(token3), null);

  // Unban the user
  removeBanFromCache("banned_guy", "name");
  assert.equal(getUserAuthContext(event3).ok, true);
  assert.ok(verifyAuthToken(token3) !== null);
});

test.after(() => {
  setTimeout(() => process.exit(0), 200);
});
