import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db";
import { resolveAnnouncementAudience } from "./announcementAudience";
import type { AnnouncementType } from "./announcementDeliveryPolicy";
import { getAnnouncementSenderPolicy } from "./announcementDeliveryPolicy";
import { publishUserEvent } from "../socket/SocketBroker";

const IDEMPOTENCY_LOCK_NAMESPACE = 1_465_000_021;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLISH_BATCH_SIZE = 25;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANNOUNCEMENT_TYPES = new Set<AnnouncementType>(["all", "ranked", "room"]);

export interface SendAnnouncementInput {
  senderUserId: string;
  senderUsername: string;
  type: AnnouncementType;
  message: string;
  idempotencyKey: string;
  roomId?: string;
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

export interface AnnouncementPendingDependencies {
  connect(): Promise<PoolClient>;
  publishUserEvent(userId: string, event: string, payload: unknown): Promise<void>;
}

export interface AnnouncementDeliveryDependencies {
  connect(): Promise<PoolClient>;
  resolvePolicy(
    userId: string,
    username: string,
    now: Date,
  ): ReturnType<typeof getAnnouncementSenderPolicy>;
  resolveAudience(input: {
    type: AnnouncementType;
    roomId?: string;
  }): ReturnType<typeof resolveAnnouncementAudience>;
  publishUserEvent(userId: string, event: string, payload: unknown): Promise<void>;
}

export class AnnouncementDeliveryError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "NOT_ALLOWED"
      | "DAILY_LIMIT_EXCEEDED"
      | "IDEMPOTENCY_CONFLICT"
      | "IDEMPOTENCY_INCONSISTENT"
      | "SENDER_NOT_FOUND"
      | "ROOM_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AnnouncementDeliveryError";
  }
}

interface NormalizedInput extends SendAnnouncementInput {
  message: string;
  roomId?: string;
}

interface ExistingIdempotencyRow {
  request_fingerprint: string;
  response: unknown;
  expires_at: Date | string;
}

interface SenderSnapshotRow {
  username: string;
  sender_name: string;
  sender_avatar_url: string | null;
}

interface AnnouncementRow {
  id: string;
  created_at: Date | string;
}

const defaultDependencies: AnnouncementDeliveryDependencies = {
  connect: () => dbPool.connect(),
  resolvePolicy: getAnnouncementSenderPolicy,
  resolveAudience: resolveAnnouncementAudience,
  publishUserEvent,
};
const defaultPendingDependencies: AnnouncementPendingDependencies = {
  connect: () => dbPool.connect(),
  publishUserEvent,
};

function normalizeInput(input: SendAnnouncementInput): NormalizedInput {
  if (
    !input ||
    typeof input.senderUserId !== "string" ||
    !input.senderUserId.trim() ||
    typeof input.senderUsername !== "string" ||
    !input.senderUsername.trim() ||
    typeof input.type !== "string" ||
    !ANNOUNCEMENT_TYPES.has(input.type) ||
    typeof input.message !== "string" ||
    typeof input.idempotencyKey !== "string" ||
    !UUID_PATTERN.test(input.idempotencyKey.trim())
  ) {
    throw new AnnouncementDeliveryError("INVALID_REQUEST", "بيانات الإعلان غير صالحة");
  }

  const message = input.message.trim();
  const idempotencyKey = input.idempotencyKey.trim().toLowerCase();
  const roomId = typeof input.roomId === "string" ? input.roomId.trim() : "";
  if (
    !message ||
    message.length > 1000 ||
    (input.type === "room" && (!roomId || roomId.length > 128)) ||
    (input.type !== "room" && input.roomId !== undefined)
  ) {
    throw new AnnouncementDeliveryError("INVALID_REQUEST", "بيانات الإعلان غير صالحة");
  }

  return {
    ...input,
    senderUserId: input.senderUserId.trim(),
    senderUsername: input.senderUsername.trim(),
    message,
    idempotencyKey,
    ...(input.type === "room" ? { roomId } : {}),
  };
}

export function createAnnouncementRequestFingerprint(
  input: Pick<SendAnnouncementInput, "type" | "message" | "roomId">,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      type: input.type,
      message: input.message.trim(),
      roomId: input.roomId?.trim() ?? null,
    }))
    .digest("hex");
}

export function getRiyadhUsageDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function parseReplayReceipt(value: unknown): AnnouncementReceipt {
  let response = value;
  if (typeof response === "string") {
    try {
      response = JSON.parse(response) as unknown;
    } catch {
      throw new AnnouncementDeliveryError(
        "IDEMPOTENCY_INCONSISTENT",
        "تعذر التحقق من نتيجة الإرسال السابقة",
      );
    }
  }

  if (
    typeof response !== "object" ||
    response === null ||
    !("id" in response) ||
    typeof response.id !== "string" ||
    !("recipientCount" in response) ||
    typeof response.recipientCount !== "number" ||
    !("sentToday" in response) ||
    typeof response.sentToday !== "number" ||
    !("dailyLimit" in response) ||
    typeof response.dailyLimit !== "number" ||
    !("remainingToday" in response) ||
    typeof response.remainingToday !== "number"
  ) {
    throw new AnnouncementDeliveryError(
      "IDEMPOTENCY_INCONSISTENT",
      "تعذر التحقق من نتيجة الإرسال السابقة",
    );
  }
  if (
    !Number.isSafeInteger(response.recipientCount) ||
    response.recipientCount < 0 ||
    !Number.isSafeInteger(response.sentToday) ||
    response.sentToday < 0 ||
    !Number.isSafeInteger(response.dailyLimit) ||
    response.dailyLimit < response.sentToday ||
    !Number.isSafeInteger(response.remainingToday) ||
    response.remainingToday !== response.dailyLimit - response.sentToday
  ) {
    throw new AnnouncementDeliveryError(
      "IDEMPOTENCY_INCONSISTENT",
      "تعذر التحقق من نتيجة الإرسال السابقة",
    );
  }
  return {
    id: response.id,
    recipientCount: response.recipientCount,
    sentToday: response.sentToday,
    dailyLimit: response.dailyLimit,
    remainingToday: response.remainingToday,
  };
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Announcement creation timestamp is invalid");
  }
  return date.toISOString();
}

async function publishCreatedAnnouncement(
  recipientIds: readonly string[],
  announcement: {
    id: string;
    type: AnnouncementType;
    message: string;
    senderName: string;
    senderAvatarUrl: string | null;
    createdAt: string;
  },
  publish: AnnouncementDeliveryDependencies["publishUserEvent"],
): Promise<void> {
  for (let index = 0; index < recipientIds.length; index += PUBLISH_BATCH_SIZE) {
    const batch = recipientIds.slice(index, index + PUBLISH_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((userId) => publish(userId, "announcement:created", announcement)),
    );
    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
      const result = results[resultIndex];
      if (result.status === "rejected") {
        console.error(
          `[Announcements] Failed to publish committed announcement ${announcement.id} to user ${batch[resultIndex]}`,
          result.reason,
        );
      }
    }
  }
}

export async function sendAnnouncement(
  rawInput: SendAnnouncementInput,
  dependencies: AnnouncementDeliveryDependencies = defaultDependencies,
  now: Date = new Date(),
): Promise<AnnouncementReceipt> {
  const input = normalizeInput(rawInput);
  const fingerprint = createAnnouncementRequestFingerprint(input);
  const client = await dependencies.connect();
  let transactionStarted = false;
  let receipt: AnnouncementReceipt;
  let publishedAnnouncement: {
    id: string;
    type: AnnouncementType;
    message: string;
    senderName: string;
    senderAvatarUrl: string | null;
    createdAt: string;
  } | undefined;
  let recipientIds: string[] = [];

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS acquired",
      [
      IDEMPOTENCY_LOCK_NAMESPACE,
      `${input.senderUserId}:${input.idempotencyKey}`,
      ],
    );
    if (!lockResult.rows[0]?.acquired) {
      throw new AnnouncementDeliveryError(
        "IDEMPOTENCY_CONFLICT",
        "طلب الإرسال بهذا المفتاح قيد التنفيذ",
      );
    }

    const existingResult = await client.query<ExistingIdempotencyRow>(
      `SELECT request_fingerprint, response, expires_at
       FROM announcement_idempotency
       WHERE sender_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [input.senderUserId, input.idempotencyKey],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      const expiresAt = new Date(existing.expires_at).getTime();
      if (!Number.isFinite(expiresAt)) {
        throw new AnnouncementDeliveryError(
          "IDEMPOTENCY_INCONSISTENT",
          "تعذر التحقق من نتيجة الإرسال السابقة",
        );
      }
      if (expiresAt > now.getTime()) {
        if (existing.request_fingerprint !== fingerprint) {
          throw new AnnouncementDeliveryError(
            "IDEMPOTENCY_CONFLICT",
            "مفتاح الإرسال مستخدم بطلب مختلف",
          );
        }
        receipt = parseReplayReceipt(existing.response);
        await client.query("COMMIT");
        transactionStarted = false;
        return receipt;
      }

      await client.query(
        `DELETE FROM announcement_idempotency
         WHERE sender_user_id = $1 AND idempotency_key = $2`,
        [input.senderUserId, input.idempotencyKey],
      );
    }

    const policy = await dependencies.resolvePolicy(input.senderUserId, input.senderUsername, now);
    if (!policy.allowedTypes.includes(input.type)) {
      throw new AnnouncementDeliveryError("NOT_ALLOWED", "لا تملك صلاحية هذا النوع من الإعلانات");
    }
    if (!Number.isInteger(policy.dailyLimit) || policy.dailyLimit <= 0) {
      throw new AnnouncementDeliveryError(
        "DAILY_LIMIT_EXCEEDED",
        "لا يتوفر لك حد يومي لإرسال الإعلانات",
      );
    }

    let audience: Awaited<ReturnType<AnnouncementDeliveryDependencies["resolveAudience"]>>;
    try {
      audience = await dependencies.resolveAudience({
        type: input.type,
        ...(input.type === "room" ? { roomId: input.roomId } : {}),
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ROOM_NOT_FOUND"
      ) {
        throw new AnnouncementDeliveryError("ROOM_NOT_FOUND", "الغرفة غير موجودة");
      }
      throw error;
    }
    recipientIds = [...new Set(audience.recipientIds.map((id) => id.trim()).filter(Boolean))];

    const senderResult = await client.query<SenderSnapshotRow>(
      `SELECT
         u.username,
         COALESCE(NULLIF(u.display_name, ''), u.username) AS sender_name,
         COALESCE(NULLIF(up.avatar_url, ''), u.avatar_url) AS sender_avatar_url
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [input.senderUserId],
    );
    const sender = senderResult.rows[0];
    if (!sender) {
      throw new AnnouncementDeliveryError("SENDER_NOT_FOUND", "تعذر التحقق من حساب المرسل");
    }

    const usageDate = getRiyadhUsageDate(now);
    await client.query(
      `INSERT INTO announcement_daily_usage (user_id, usage_date, send_count)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id, usage_date) DO NOTHING`,
      [input.senderUserId, usageDate],
    );
    const usageResult = await client.query<{ send_count: number }>(
      `UPDATE announcement_daily_usage
       SET send_count = send_count + 1, updated_at = now()
       WHERE user_id = $1
         AND usage_date = $2
         AND send_count < $3
       RETURNING send_count`,
      [input.senderUserId, usageDate, policy.dailyLimit],
    );
    const usage = usageResult.rows[0];
    if (!usage) {
      throw new AnnouncementDeliveryError(
        "DAILY_LIMIT_EXCEEDED",
        "تجاوزت الحد اليومي لإرسال الإعلانات",
      );
    }

    const announcementResult = await client.query<AnnouncementRow>(
      `INSERT INTO announcements
         (type, message, sender_user_id, sender_name, sender_avatar_url, room_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [
        input.type,
        input.message,
        input.senderUserId,
        sender.sender_name || sender.username,
        sender.sender_avatar_url,
        audience.roomId ?? null,
      ],
    );
    const announcement = announcementResult.rows[0];
    if (!announcement) throw new Error("Announcement insert returned no row");

    receipt = {
      id: announcement.id,
      recipientCount: recipientIds.length,
      sentToday: Number(usage.send_count),
      dailyLimit: policy.dailyLimit,
      remainingToday: Math.max(policy.dailyLimit - Number(usage.send_count), 0),
    };
    const createdAnnouncement = {
      id: announcement.id,
      type: input.type,
      message: input.message,
      senderName: sender.sender_name || sender.username,
      senderAvatarUrl: sender.sender_avatar_url,
      createdAt: toIsoString(announcement.created_at),
    };

    if (recipientIds.length > 0) {
      await client.query(
        `INSERT INTO announcement_recipients (announcement_id, recipient_user_id)
         SELECT $1, recipient_id
         FROM unnest($2::text[]) AS recipient_id`,
        [announcement.id, recipientIds],
      );
      publishedAnnouncement = createdAnnouncement;
    } else {
      await client.query("DELETE FROM announcements WHERE id = $1", [announcement.id]);
    }

    await client.query(
      `INSERT INTO announcement_idempotency
         (sender_user_id, idempotency_key, request_fingerprint, announcement_id, response, expires_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        input.senderUserId,
        input.idempotencyKey,
        fingerprint,
        recipientIds.length > 0 ? announcement.id : null,
        JSON.stringify(receipt),
        new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      ],
    );
    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[Announcements] Failed to roll back announcement send:", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }

  if (publishedAnnouncement) {
    await publishCreatedAnnouncement(recipientIds, publishedAnnouncement, dependencies.publishUserEvent);
  }
  if (!receipt) throw new Error("Announcement receipt was not created");
  return receipt;
}

interface PendingAnnouncementRow {
  id: string;
  type: AnnouncementType;
  message: string;
  sender_name: string;
  sender_avatar_url: string | null;
  created_at: Date | string;
}

interface AnnouncementCursor {
  id: string;
  createdAt: string;
}

const MAX_PENDING_PAGE_SIZE = 50;

function decodeAnnouncementCursor(cursor: string): AnnouncementCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id) ||
      !("createdAt" in parsed) ||
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(new Date(parsed.createdAt).getTime())
    ) {
      throw new Error("Invalid cursor");
    }
    return {
      id: parsed.id,
      createdAt: new Date(parsed.createdAt).toISOString(),
    };
  } catch {
    throw new AnnouncementDeliveryError("INVALID_REQUEST", "مؤشر قائمة الإعلانات غير صالح");
  }
}

function encodeAnnouncementCursor(row: PendingAnnouncementRow): string {
  return Buffer.from(JSON.stringify({
    id: row.id,
    createdAt: toIsoString(row.created_at),
  })).toString("base64url");
}

export async function listPendingAnnouncements(
  userId: string,
  cursor: string | null = null,
  limit = 20,
  database: Pick<typeof dbPool, "query"> = dbPool,
): Promise<{ items: PendingAnnouncement[]; nextCursor: string | null }> {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (
    !normalizedUserId ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PENDING_PAGE_SIZE
  ) {
    throw new AnnouncementDeliveryError("INVALID_REQUEST", "طلب قائمة الإعلانات غير صالح");
  }
  const decodedCursor = cursor ? decodeAnnouncementCursor(cursor) : null;
  const result = await database.query<PendingAnnouncementRow>(
    `SELECT
       a.id,
       a.type,
       a.message,
       a.sender_name,
       a.sender_avatar_url,
       a.created_at
     FROM announcement_recipients ar
     JOIN announcements a ON a.id = ar.announcement_id
     WHERE ar.recipient_user_id = $1
       AND ($2::timestamptz IS NULL OR (a.created_at, a.id) > ($2::timestamptz, $3::uuid))
     ORDER BY a.created_at ASC, a.id ASC
     LIMIT $4`,
    [
      normalizedUserId,
      decodedCursor?.createdAt ?? null,
      decodedCursor?.id ?? null,
      limit + 1,
    ],
  );
  const hasMore = result.rows.length > limit;
  const selectedRows = result.rows.slice(0, limit);
  return {
    items: selectedRows.map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      senderName: row.sender_name,
      senderAvatarUrl: row.sender_avatar_url,
      createdAt: toIsoString(row.created_at),
    })),
    nextCursor: hasMore && selectedRows.length > 0
      ? encodeAnnouncementCursor(selectedRows[selectedRows.length - 1])
      : null,
  };
}

export async function dismissAnnouncement(
  userId: string,
  announcementId: string,
  dependencies: AnnouncementPendingDependencies = defaultPendingDependencies,
): Promise<void> {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  const normalizedAnnouncementId = typeof announcementId === "string"
    ? announcementId.trim()
    : "";
  if (!normalizedUserId || !UUID_PATTERN.test(normalizedAnnouncementId)) {
    throw new AnnouncementDeliveryError("INVALID_REQUEST", "معرف الإعلان غير صالح");
  }

  const client = await dependencies.connect();
  let transactionStarted = false;
  let recipientDismissed = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const announcementResult = await client.query<{ id: string }>(
      `SELECT id FROM announcements WHERE id = $1 FOR UPDATE`,
      [normalizedAnnouncementId],
    );
    if (announcementResult.rows.length > 0) {
      const recipientResult = await client.query<{ announcement_id: string }>(
        `DELETE FROM announcement_recipients
         WHERE announcement_id = $1 AND recipient_user_id = $2
         RETURNING announcement_id`,
        [normalizedAnnouncementId, normalizedUserId],
      );
      recipientDismissed = recipientResult.rows.length > 0;
      if (recipientDismissed) {
        await client.query(
          `DELETE FROM announcements a
           WHERE a.id = $1
             AND NOT EXISTS (
               SELECT 1 FROM announcement_recipients ar
               WHERE ar.announcement_id = a.id
             )`,
          [normalizedAnnouncementId],
        );
      }
    }

    await client.query("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("[Announcements] Failed to roll back announcement dismissal:", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }

  if (recipientDismissed) {
    try {
      await dependencies.publishUserEvent(
        normalizedUserId,
        "announcement:dismissed",
        { id: normalizedAnnouncementId },
      );
    } catch (error) {
      console.error(
        `[Announcements] Failed to publish dismissal for announcement ${normalizedAnnouncementId}`,
        error,
      );
    }
  }
}
