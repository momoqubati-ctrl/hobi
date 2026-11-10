import assert from "node:assert/strict";
import test from "node:test";
import { saveWithLocalFallback } from "../server/services/uploadStorage";

test("saves locally when the MinIO upload fails", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  let localSaveCount = 0;

  try {
    const result = await saveWithLocalFallback(
      async () => {
        throw new Error("MinIO is unavailable");
      },
      () => {
        localSaveCount += 1;
        return "/uploads/avatar_user.png";
      },
    );

    assert.equal(result, "/uploads/avatar_user.png");
    assert.equal(localSaveCount, 1);
  } finally {
    console.error = originalConsoleError;
  }
});

test("does not save locally when the MinIO upload succeeds", async () => {
  let localSaveCount = 0;

  const result = await saveWithLocalFallback(
    async () => "/minio/avatar_user.png",
    () => {
      localSaveCount += 1;
      return "/uploads/avatar_user.png";
    },
  );

  assert.equal(result, "/minio/avatar_user.png");
  assert.equal(localSaveCount, 0);
});
