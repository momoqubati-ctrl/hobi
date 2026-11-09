import {
  defineEventHandler,
  getRouterParam,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import { dbPool } from "../db";
import { getAdminContext } from "./adminAccess";
import { hasPermission, logAdminAudit } from "./adminPermissions";
import { isSystemOwnerUsername } from "./systemOwner";
import {
  VoiceProviderEncryptionConfigurationError,
  VoiceProviderSecretDecryptionError,
} from "./voiceProviderEncryption";
import {
  createVoiceProviderStore,
  VoiceProviderAccountNotFoundError,
  VoiceProviderCredentialsRequiredError,
} from "./voiceProviderStore";
import type {
  RequestedVoiceProviderSelection,
  UpdateVoiceProviderAccountInput,
} from "./voiceProviderStore";

export type VoiceProviderAdminPermission =
  | "admin_micprovidercp.read"
  | "micprovideredit.edit"
  | "micprovideredit.delete";

export type VoiceProviderAdminAuthorization =
  | { ok: true; userId: string }
  | { ok: false; statusCode: 401 | 403 };

export type VoiceProviderAdminAuthorizer = (
  event: H3Event,
  permission: VoiceProviderAdminPermission,
) => Promise<VoiceProviderAdminAuthorization>;

export interface VoiceProviderAdminAuditInput {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

export type VoiceProviderAdminStore = Pick<
  ReturnType<typeof createVoiceProviderStore>,
  | "listAccounts"
  | "getRequestedSelection"
  | "putAccount"
  | "deleteAccount"
  | "setRequestedSelection"
>;

export interface VoiceProviderAdminTransaction {
  store: VoiceProviderAdminStore;
  audit: (input: VoiceProviderAdminAuditInput) => Promise<void>;
}

export type VoiceProviderAdminTransactionRunner = <T>(
  operation: (transaction: VoiceProviderAdminTransaction) => Promise<T>,
) => Promise<T>;

interface VoiceProviderAdminApiDependencies {
  authorize: VoiceProviderAdminAuthorizer;
  runTransaction: VoiceProviderAdminTransactionRunner;
}

interface AccountPutBody extends UpdateVoiceProviderAccountInput {
  name: string;
  url: string;
}

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CREDENTIAL_LENGTH = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidAccountId(value: string): boolean {
  return ACCOUNT_ID_PATTERN.test(value);
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "UnknownError";
}

function errorResponse(
  event: H3Event,
  statusCode: number,
  code: string,
  message: string,
) {
  setResponseStatus(event, statusCode);
  return { success: false, code, message };
}

function parseAccountBody(value: unknown):
  | { ok: true; input: AccountPutBody }
  | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "بيانات الحساب غير صالحة" };
  }

  const allowedFields = new Set(["name", "url", "apiKey", "apiSecret"]);
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    return { ok: false, message: "تحتوي البيانات على حقول غير معروفة" };
  }

  if (
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.trim().length > 120
  ) {
    return { ok: false, message: "اسم الحساب مطلوب وبحد أقصى 120 حرفاً" };
  }

  if (typeof value.url !== "string" || value.url.trim().length === 0 || value.url.length > 2048) {
    return { ok: false, message: "رابط LiveKit غير صالح" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.url.trim());
  } catch {
    return { ok: false, message: "رابط LiveKit غير صالح" };
  }
  if (
    parsedUrl.protocol !== "wss:" ||
    !parsedUrl.hostname ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    return { ok: false, message: "يجب أن يكون الرابط آمناً بصيغة wss ومن دون مسار أو بيانات إضافية" };
  }

  const input: AccountPutBody = {
    name: value.name.trim(),
    url: value.url.trim(),
  };
  for (const [field, label] of [["apiKey", "مفتاح API"], ["apiSecret", "سر API"]] as const) {
    const credential = value[field];
    if (credential === undefined) continue;
    if (
      typeof credential !== "string" ||
      credential.trim().length === 0 ||
      credential.length > MAX_CREDENTIAL_LENGTH
    ) {
      return { ok: false, message: `${label} غير صالح` };
    }
    input[field] = credential;
  }

  return { ok: true, input };
}

function parseSelectionBody(value: unknown):
  | { ok: true; selection: RequestedVoiceProviderSelection }
  | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "اختيار مزود الصوت غير صالح" };
  }

  if (value.provider === "webrtc" && Object.keys(value).length === 1) {
    return { ok: true, selection: { provider: "webrtc", accountId: null } };
  }

  if (
    value.provider === "livekit" &&
    Object.keys(value).length === 2 &&
    typeof value.accountId === "string" &&
    isValidAccountId(value.accountId)
  ) {
    return {
      ok: true,
      selection: { provider: "livekit", accountId: value.accountId },
    };
  }

  return { ok: false, message: "يجب اختيار WebRTC أو حساب LiveKit صالح" };
}

async function runVoiceProviderTransaction<T>(
  operation: (transaction: VoiceProviderAdminTransaction) => Promise<T>,
): Promise<T> {
  const client = await dbPool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const store = createVoiceProviderStore(client);
    const result = await operation({
      store,
      audit: (input) => logAdminAudit(input, {
        queryExecutor: client,
        throwOnError: true,
      }),
    });
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        console.error("Voice provider transaction rollback failed");
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export function createVoiceProviderAdminAuthorizer(
  checkPermission: typeof hasPermission = hasPermission,
): VoiceProviderAdminAuthorizer {
  return async (event, permission) => {
    const admin = getAdminContext(event);
    if (!admin.ok) return { ok: false, statusCode: admin.statusCode };
    if (!isSystemOwnerUsername(admin.username) && !(await checkPermission(admin.userId, permission))) {
      return { ok: false, statusCode: 403 };
    }
    return { ok: true, userId: admin.userId };
  };
}

export function createVoiceProviderAdminHandlers(
  dependencies: VoiceProviderAdminApiDependencies,
) {
  const authorizeRequest = async (
    event: H3Event,
    permission: VoiceProviderAdminPermission,
  ): Promise<{ ok: true; userId: string } | { ok: false; response: ReturnType<typeof errorResponse> }> => {
    try {
      const result = await dependencies.authorize(event, permission);
      if (result.ok) return result;
      return {
        ok: false,
        response: result.statusCode === 401
          ? errorResponse(event, 401, "UNAUTHENTICATED", "جلسة الإدارة غير صالحة")
          : errorResponse(event, 403, "FORBIDDEN", "لا تملك الصلاحية الكافية"),
      };
    } catch (error) {
      console.error("Voice provider authorization failed", { code: errorCode(error) });
      return {
        ok: false,
        response: errorResponse(event, 500, "INTERNAL_ERROR", "تعذر التحقق من صلاحيات الإدارة"),
      };
    }
  };

  return {
    get: defineEventHandler(async (event) => {
      const authorization = await authorizeRequest(event, "admin_micprovidercp.read");
      if (!authorization.ok) return authorization.response;

      try {
        const result = await dependencies.runTransaction(async ({ store }) => ({
          accounts: await store.listAccounts(),
          selection: await store.getRequestedSelection(),
        }));
        return { success: true, ...result };
      } catch (error) {
        console.error("Voice provider listing failed", { code: errorCode(error) });
        return errorResponse(event, 500, "INTERNAL_ERROR", "تعذر تحميل إعدادات مزود الصوت");
      }
    }),

    put: defineEventHandler(async (event) => {
      const authorization = await authorizeRequest(event, "micprovideredit.edit");
      if (!authorization.ok) return authorization.response;

      const accountId = getRouterParam(event, "id") || "";
      if (!isValidAccountId(accountId)) {
        return errorResponse(event, 422, "VALIDATION_ERROR", "معرف الحساب غير صالح");
      }

      let body: unknown;
      try {
        body = await readBody(event);
      } catch {
        return errorResponse(event, 400, "INVALID_BODY", "تعذر قراءة بيانات الطلب");
      }

      const parsed = parseAccountBody(body);
      if (!parsed.ok) {
        return errorResponse(event, 422, "VALIDATION_ERROR", parsed.message);
      }

      try {
        const result = await dependencies.runTransaction(async ({ store, audit }) => {
          const saved = await store.putAccount(accountId, parsed.input);
          await audit({
            actorId: authorization.userId,
            action: saved.created ? "voice_provider.create" : "voice_provider.update",
            targetType: "voice_provider_account",
            targetId: accountId,
            metadata: {
              name: saved.account.name,
              url: saved.account.url,
              credentialsUpdated: parsed.input.apiKey !== undefined || parsed.input.apiSecret !== undefined,
            },
          });
          return saved;
        });

        if (result.created) setResponseStatus(event, 201);
        return { success: true, account: result.account };
      } catch (error) {
        if (error instanceof VoiceProviderCredentialsRequiredError) {
          return errorResponse(event, 422, "VALIDATION_ERROR", "مفتاح API وسره مطلوبان عند إنشاء الحساب");
        }
        if (error instanceof VoiceProviderEncryptionConfigurationError) {
          return errorResponse(
            event,
            503,
            "ENCRYPTION_UNAVAILABLE",
            "إعداد تشفير مزود الصوت غير جاهز؛ تحقق من VOICE_PROVIDER_ENCRYPTION_KEY على الخادم",
          );
        }
        if (errorCode(error) === "23505") {
          return errorResponse(event, 409, "CONFLICT", "تعذر حفظ الحساب بسبب تعارض في المعرف");
        }
        console.error("Voice provider account save failed", { code: errorCode(error) });
        return errorResponse(event, 500, "INTERNAL_ERROR", "تعذر حفظ حساب LiveKit");
      }
    }),

    delete: defineEventHandler(async (event) => {
      const authorization = await authorizeRequest(event, "micprovideredit.delete");
      if (!authorization.ok) return authorization.response;

      const accountId = getRouterParam(event, "id") || "";
      if (!isValidAccountId(accountId)) {
        return errorResponse(event, 422, "VALIDATION_ERROR", "معرف الحساب غير صالح");
      }

      try {
        const deleted = await dependencies.runTransaction(async ({ store, audit }) => {
          const result = await store.deleteAccount(accountId);
          if (result) {
            await audit({
              actorId: authorization.userId,
              action: "voice_provider.delete",
              targetType: "voice_provider_account",
              targetId: accountId,
              metadata: {},
            });
          }
          return result;
        });
        if (!deleted) return errorResponse(event, 404, "NOT_FOUND", "حساب LiveKit غير موجود");
        return { success: true, message: "تم حذف حساب LiveKit" };
      } catch (error) {
        if (errorCode(error) === "23503") {
          return errorResponse(event, 409, "CONFLICT", "لا يمكن حذف الحساب المحدد حالياً");
        }
        console.error("Voice provider account deletion failed", { code: errorCode(error) });
        return errorResponse(event, 500, "INTERNAL_ERROR", "تعذر حذف حساب LiveKit");
      }
    }),

    putSelection: defineEventHandler(async (event) => {
      const authorization = await authorizeRequest(event, "micprovideredit.edit");
      if (!authorization.ok) return authorization.response;

      let body: unknown;
      try {
        body = await readBody(event);
      } catch {
        return errorResponse(event, 400, "INVALID_BODY", "تعذر قراءة بيانات الطلب");
      }

      const parsed = parseSelectionBody(body);
      if (!parsed.ok) {
        return errorResponse(event, 422, "VALIDATION_ERROR", parsed.message);
      }

      try {
        const result = await dependencies.runTransaction(async ({ store, audit }) => {
          const previous = await store.getRequestedSelection();
          const saved = await store.setRequestedSelection(parsed.selection);
          if (
            previous.provider !== saved.provider ||
            previous.accountId !== saved.accountId
          ) {
            await audit({
              actorId: authorization.userId,
              action: "voice_provider.selection.update",
              targetType: "voice_provider_selection",
              targetId: "1",
              metadata: {
                provider: saved.provider,
                accountId: saved.accountId,
              },
            });
          }
          return saved;
        });

        return { success: true, selection: result };
      } catch (error) {
        if (error instanceof VoiceProviderAccountNotFoundError) {
          return errorResponse(event, 404, "NOT_FOUND", "حساب LiveKit غير موجود");
        }
        if (error instanceof VoiceProviderSecretDecryptionError) {
          return errorResponse(
            event,
            409,
            "PROVIDER_CREDENTIALS_INVALID",
            "تعذر التحقق من أسرار حساب LiveKit؛ لم يتغير الاختيار",
          );
        }
        if (error instanceof VoiceProviderEncryptionConfigurationError) {
          return errorResponse(
            event,
            503,
            "ENCRYPTION_UNAVAILABLE",
            "إعداد تشفير مزود الصوت غير جاهز؛ تحقق من VOICE_PROVIDER_ENCRYPTION_KEY على الخادم",
          );
        }
        console.error("Voice provider selection update failed", { code: errorCode(error) });
        return errorResponse(event, 500, "INTERNAL_ERROR", "تعذر حفظ اختيار مزود الصوت");
      }
    }),
  };
}

export const voiceProviderAdminHandlers = createVoiceProviderAdminHandlers({
  authorize: createVoiceProviderAdminAuthorizer(),
  runTransaction: runVoiceProviderTransaction,
});
