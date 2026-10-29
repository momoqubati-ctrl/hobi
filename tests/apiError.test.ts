import test from "node:test";
import assert from "node:assert";
import { ApiError, handleApiError } from "../server/utils/apiError";

test("ApiError - should retain status code and error code", () => {
  const err = new ApiError(403, "FORBIDDEN", "لا تملك الصلاحية الكافية");
  assert.strictEqual(err.statusCode, 403);
  assert.strictEqual(err.code, "FORBIDDEN");
  assert.strictEqual(err.message, "لا تملك الصلاحية الكافية");
});

test("handleApiError - should format custom ApiError properly", () => {
  let statusCode = 200;
  const mockEvent = {
    path: "/api/test",
    node: {
      res: {
        statusCode: 200,
      },
    },
  } as any;

  // Simulate setResponseStatus effect
  const result = handleApiError(mockEvent, new ApiError(404, "NOT_FOUND", "العنصر غير موجود"));
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, "NOT_FOUND");
  assert.strictEqual(result.message, "العنصر غير موجود");
});

test("handleApiError - should mask sensitive database errors", () => {
  const mockEvent = {
    path: "/api/data",
    node: {
      res: {
        statusCode: 200,
      },
    },
  } as any;

  const rawDbError = new Error('relation "users" does not exist at character 15, password="secret"');
  const result = handleApiError(mockEvent, rawDbError);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, "INTERNAL_SERVER_ERROR");
  // Ensure sensitive sql/database string is NEVER leaked to client
  assert.strictEqual(result.message.includes("relation"), false);
  assert.strictEqual(result.message.includes("password"), false);
  assert.strictEqual(result.message, "حدث خطأ غير متوقع في الخادم. يرجى المحاولة لاحقاً.");
});
