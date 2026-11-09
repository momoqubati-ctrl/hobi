import { H3Event, getResponseStatus, setResponseStatus } from "h3";

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

const SENSITIVE_ERROR_PATTERN =
  /(relation\s*["']|syntax error|column\s*["']|table\s*["']|database|password|secret|pool|pg_|econnrefused|psql|postgres|sqlstate|constraint|deadlock detected|connection refused|select\s+.*\s+from|insert\s+into|update\s+.*set|delete\s+from)/i;

/**
 * دالة موحدة للتعامل مع أخطاء الـ API وحماية البيانات الحساسة
 * تمنع تسريب تفاصيل قاعدة البيانات أو أخطاء الخادم الداخلية للمستخدم
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
      error: error.message,
    };
  }

  // تسجيل الخطأ بالكامل داخلياً في السيرفر لأغراض الـ Debugging
  console.error(`[API Error] [${new Date().toISOString()}] ${event?.path || ""}:`, error);

  // التحقق من وجود كلمات حساسة متعلقة بالبنية التحتية وقاعدة البيانات
  const isInternalSensitive = SENSITIVE_ERROR_PATTERN.test(errorMessage);

  // التحقق إذا كانت الحالة 4xx (خطأ عميل / تحقق من المدخلات)
  let clientStatusCode: number | null = null;
  const errorStatus = (error as any)?.statusCode || (error as any)?.status;
  if (typeof errorStatus === "number" && errorStatus >= 400 && errorStatus < 500) {
    clientStatusCode = errorStatus;
  } else {
    try {
      const current = getResponseStatus(event);
      if (typeof current === "number" && current >= 400 && current < 500) {
        clientStatusCode = current;
      }
    } catch {
      // ignore
    }
  }

  // إذا كان خطأ تحقق من العميل وغير حساس
  if (clientStatusCode && !isInternalSensitive) {
    try {
      setResponseStatus(event, clientStatusCode);
    } catch {
      if (event?.node?.res) (event.node.res as any).statusCode = clientStatusCode;
    }
    return {
      success: false,
      code: (error as any)?.code || "CLIENT_ERROR",
      message: errorMessage,
      error: errorMessage,
    };
  }

  // تعيين 500 لجميع الأخطاء غير المتوقعة أو الحساسة
  try {
    setResponseStatus(event, 500);
  } catch {
    if (event?.node?.res) (event.node.res as any).statusCode = 500;
  }

  const safeMessage = isInternalSensitive || !isDev
    ? "حدث خطأ غير متوقع في الخادم. يرجى المحاولة لاحقاً."
    : errorMessage;

  return {
    success: false,
    code: "INTERNAL_SERVER_ERROR",
    message: safeMessage,
    error: safeMessage,
  };
}
