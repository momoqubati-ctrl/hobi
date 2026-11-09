export type AnnouncementType = "all" | "ranked" | "room";

export interface AnnouncementDraft {
  type: AnnouncementType;
  message: string;
  roomId?: string;
}

export interface AnnouncementSubmissionKey {
  fingerprint: string;
  key: string;
}

export interface AnnouncementReceipt {
  id: string;
  recipientCount: number;
  sentToday: number;
  dailyLimit: number;
  remainingToday: number;
}

export interface PendingAnnouncement {
  id: string;
  type: AnnouncementType;
  message: string;
  senderName: string;
  senderAvatarUrl: string | null;
  createdAt: string;
}

export interface PendingAnnouncementPage {
  items: PendingAnnouncement[];
  nextCursor: string | null;
}

export class AnnouncementApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "AnnouncementApiError";
  }
}

const ANNOUNCEMENT_PERMISSIONS: Record<AnnouncementType, string> = {
  all: "announcement_all.use",
  ranked: "announcement_ranked.use",
  room: "announcement_room.use",
};

const ANNOUNCEMENT_TYPE_ORDER: readonly AnnouncementType[] = ["all", "ranked", "room"];

const isAnnouncementType = (value: unknown): value is AnnouncementType =>
  value === "all" || value === "ranked" || value === "room";

export function getAllowedAnnouncementTypes(
  permissions: readonly string[],
): AnnouncementType[] {
  return ANNOUNCEMENT_TYPE_ORDER
    .filter((type) => permissions.includes(ANNOUNCEMENT_PERMISSIONS[type]));
}

export function canReceiveAnnouncementsForRole(role: unknown): boolean {
  if (typeof role !== "string") return false;
  const normalizedRole = role.trim().toLowerCase();
  return normalizedRole.length > 0 && normalizedRole !== "guest";
}

export function validateAnnouncementDraft(draft: AnnouncementDraft): string | null {
  if (!isAnnouncementType(draft.type)) return "نوع الإعلان غير صالح";
  if (typeof draft.message !== "string" || !draft.message.trim()) return "اكتب نص الإعلان";
  if (draft.message.length > 1000) return "الحد الأقصى للإعلان 1000 حرف";
  if (draft.type === "room" && !draft.roomId?.trim()) return "اختر غرفة للإعلان";
  if (draft.type !== "room" && draft.roomId !== undefined) return "اختيار الغرفة غير صالح";
  return null;
}

export function getAnnouncementSubmissionKey(
  draft: AnnouncementDraft,
  previous: AnnouncementSubmissionKey | null,
  createKey: () => string = () => crypto.randomUUID(),
): AnnouncementSubmissionKey {
  const fingerprint = JSON.stringify([draft.type, draft.roomId ?? null, draft.message]);
  if (previous?.fingerprint === fingerprint) return previous;
  return { fingerprint, key: createKey() };
}

function getAuthorizationHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem("authToken")
    || window.localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReceipt(value: unknown): value is AnnouncementReceipt {
  return isRecord(value)
    && typeof value.id === "string"
    && Number.isInteger(value.recipientCount)
    && Number.isInteger(value.sentToday)
    && Number.isInteger(value.dailyLimit)
    && Number.isInteger(value.remainingToday);
}

export function isPendingAnnouncement(value: unknown): value is PendingAnnouncement {
  return isRecord(value)
    && typeof value.id === "string"
    && isAnnouncementType(value.type)
    && typeof value.message === "string"
    && typeof value.senderName === "string"
    && (typeof value.senderAvatarUrl === "string" || value.senderAvatarUrl === null)
    && typeof value.createdAt === "string";
}

function isPendingPage(value: unknown): value is PendingAnnouncementPage {
  return isRecord(value)
    && Array.isArray(value.items)
    && value.items.every(isPendingAnnouncement)
    && (typeof value.nextCursor === "string" || value.nextCursor === null);
}

async function requestData<T>(
  path: string,
  init: RequestInit,
  isData: (value: unknown) => value is T,
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(path, init);
  } catch {
    throw new AnnouncementApiError("تعذر الاتصال بالسيرفر", null);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AnnouncementApiError("تعذر قراءة استجابة السيرفر", response.status);
  }

  if (!response.ok || !isRecord(data) || data.success !== true) {
    const message = isRecord(data) && typeof data.message === "string"
      ? data.message
      : "تعذر تنفيذ طلب الإعلان";
    throw new AnnouncementApiError(message, response.status);
  }

  if (!isData(data)) {
    throw new AnnouncementApiError("استجابة الإعلان غير صالحة", response.status);
  }
  return data;
}

export async function sendAnnouncement(
  draft: AnnouncementDraft,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<AnnouncementReceipt> {
  const validationError = validateAnnouncementDraft(draft);
  if (validationError) throw new AnnouncementApiError(validationError, 422);
  if (!idempotencyKey.trim()) {
    throw new AnnouncementApiError("مفتاح إرسال الإعلان مطلوب", 422);
  }

  const body = draft.type === "room"
    ? { type: draft.type, message: draft.message, roomId: draft.roomId?.trim() }
    : { type: draft.type, message: draft.message };

  const data = await requestData(
    "/api/announcements",
    {
      method: "POST",
      headers: {
        ...getAuthorizationHeaders(),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    isReceipt,
    fetcher,
  );
  return data;
}

export async function listPendingAnnouncements(
  cursor: string | null = null,
  fetcher: typeof fetch = fetch,
): Promise<PendingAnnouncementPage> {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  return requestData(
    `/api/announcements?${query.toString()}`,
    {
      headers: getAuthorizationHeaders(),
    },
    isPendingPage,
    fetcher,
  );
}

export async function dismissAnnouncement(
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const data = await requestData(
    `/api/announcements/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: getAuthorizationHeaders(),
    },
    (value): value is Record<string, unknown> => isRecord(value),
    fetcher,
  );
  if (data.success !== true) {
    throw new AnnouncementApiError("تعذر إغلاق الإعلان", null);
  }
}
