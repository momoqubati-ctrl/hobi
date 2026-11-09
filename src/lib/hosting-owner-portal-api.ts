export const hostingOwnerPortalHeaders = (portalKey: string, idempotencyKey?: string) => ({
  "x-hosting-owner-portal-key": portalKey,
  ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
});

export const readHostingOwnerApiResponse = async (
  response: Response,
): Promise<Record<string, unknown>> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("استجابة غير صالحة من الخادم");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("استجابة غير صالحة من الخادم");
  }

  const data = payload as Record<string, unknown>;
  if (!response.ok || data.success !== true) {
    throw new Error(
      typeof data.message === "string" && data.message
        ? data.message
        : "تعذر تنفيذ الطلب",
    );
  }

  return data;
};
