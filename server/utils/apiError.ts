import { H3Event, setResponseStatus } from "h3";

export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * دالة موحدة للتعامل مع أخطاء الـ API وحماية البيانات الحساسة
 * تمنع تسريب تفاصيل قاعدة البيانات أو أخطاء السيرفر الحساسة للمستخدم
 */
export function handleApiError(event: H3Event, error: unknown) {
  const isDev = process.env.NODE_ENV !== "production";
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (error instanceof ApiError) {
    try {
      setResponseStatus(event, error.statusCode);
    } catch {
      if (event?.node?.res) (event.node.res as any).statusCode = error.statusCode;
    }
    return {
      success: false,
      code: error.code,
      message: error.message,
    };
  }

  // تسجيل الخطأ بالكامل داخلياً في السيرفر لأغراض الـ Debugging
  console.error(`[API Error] [${new Date().toISOString()}] ${event?.path || ""}:`, error);

  // إخفاء الأخطاء التقنية المرتبطة بقاعدة البيانات أو الخادم الداخلي
  const isInternalSensitive =
    errorMessage.includes("relation") ||
    errorMessage.includes("syntax error") ||
    errorMessage.includes("column") ||
    errorMessage.includes("database") ||
    errorMessage.includes("password") ||
    errorMessage.includes("pool") ||
    errorMessage.includes("pg_") ||
    errorMessage.includes("connect ECONNREFUSED");

  try {
    setResponseStatus(event, 500);
  } catch {
    if (event?.node?.res) (event.node.res as any).statusCode = 500;
  }

  return {
    success: false,
    code: "INTERNAL_SERVER_ERROR",
    message: isInternalSensitive || !isDev
      ? "حدث خطأ غير متوقع في الخادم. يرجى المحاولة لاحقاً."
      : errorMessage,
  };
}
