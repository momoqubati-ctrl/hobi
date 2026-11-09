import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { EncryptedVoiceProviderSecret } from "../services/voiceProviderEncryption";
import type { RoomCustomRolePermissions } from "../services/roomCustomRoleService";

export const accountRole = pgEnum("account_role", ["guest", "member", "moderator", "owner", "admin", "agent"]);
export const accountStatus = pgEnum("account_status", ["active", "muted", "banned", "suspended", "deleted"]);
export const edgeType = pgEnum("edge_type", ["friend", "follow", "block", "mute", "mutual"]);
export const presenceStatus = pgEnum("presence_status", ["online", "idle", "lurking", "active", "multitasking"]);

// --- 1. SOCIAL GRAPH ENGINE ---
export const socialEdges = pgTable(
  "social_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: varchar("source_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
    targetId: varchar("target_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
    type: edgeType("type").notNull(),
    weight: integer("weight").default(1).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("social_edges_pair_idx").on(table.sourceId, table.targetId, table.type),
    index("social_edges_source_idx").on(table.sourceId),
    index("social_edges_target_idx").on(table.targetId),
  ]
);

export const socialAffinity = pgTable(
  "social_affinity",
  {
    userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
    relatedId: varchar("related_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
    score: numeric("score", { precision: 10, scale: 2 }).default("0").notNull(),
    interactionCount: integer("interaction_count").default(0).notNull(),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.relatedId] }),
    index("social_affinity_score_idx").on(table.score),
  ]
);

// --- 2. DYNAMIC IDENTITY ENGINE ---
export const identityEffects = pgTable(
  "identity_effects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    type: varchar("type", { length: 40 }).notNull(),
    config: jsonb("config").default({}).notNull(),
    assetUrl: text("asset_url"),
    isPremium: boolean("is_premium").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [uniqueIndex("identity_effects_slug_idx").on(table.slug)]
);

export const userIdentityState = pgTable(
  "user_identity_state",
  {
    userId: varchar("user_id", { length: 255 }).primaryKey().references(() => users.id, { onDelete: "cascade" }),
    activeFrameId: uuid("active_frame_id").references(() => identityEffects.id),
    activeAuraId: uuid("active_aura_id").references(() => identityEffects.id),
    activeThemeId: varchar("active_theme_id", { length: 80 }),
    customCss: text("custom_css"),
    reactiveConfig: jsonb("reactive_config").default({}).notNull(),
  }
);

// --- 3. REPUTATION & TRUST ENGINE ---
export const behaviorScores = pgTable(
  "behavior_scores",
  {
    userId: varchar("user_id", { length: 255 }).primaryKey().references(() => users.id, { onDelete: "cascade" }),
    trustScore: integer("trust_score").default(50).notNull(),
    toxicityScore: integer("toxicity_score").default(0).notNull(),
    influenceScore: integer("influence_score").default(0).notNull(),
    spamProbability: numeric("spam_probability", { precision: 4, scale: 3 }).default("0").notNull(),
    lastRecalculatedAt: timestamp("last_recalculated_at", { withTimezone: true }).defaultNow().notNull(),
  }
);

// --- 4. ACTIVITY STREAM ---
export const activityStream = pgTable(
  "activity_stream",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: varchar("actor_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
    verb: varchar("verb", { length: 64 }).notNull(),
    objectType: varchar("object_type", { length: 64 }).notNull(),
    objectId: varchar("object_id", { length: 128 }),
    targetId: varchar("target_id", { length: 128 }),
    metadata: jsonb("metadata").default({}).notNull(),
    visibility: varchar("visibility", { length: 32 }).default("public").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("activity_stream_actor_idx").on(table.actorId),
    index("activity_stream_verb_idx").on(table.verb),
    index("activity_stream_created_idx").on(table.createdAt),
  ]
);

// --- 5. CORE TABLES (RESTORED) ---
export const users = pgTable(
  "users",
  {
    id: varchar("id", { length: 255 }).primaryKey(),
    legacyId: integer("legacy_id"),
    uid: varchar("uid", { length: 255 }),
    idreg: integer("idreg"),
    username: varchar("username", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    mentionName: varchar("mention_name", { length: 64 }),
    publicUserId: varchar("public_user_id", { length: 12 }),
    passwordHash: text("password_hash"),
    role: accountRole("role").default("member").notNull(),
    status: accountStatus("status").default("active").notNull(),
    avatarUrl: text("avatar_url"),
    coverUrl: text("cover_url"),
    countryCode: varchar("country_code", { length: 16 }),
    presence: presenceStatus("presence").default("online").notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_username_idx").on(table.username),
    uniqueIndex("users_mention_name_lower_idx").on(sql`LOWER(${table.mentionName})`),
    uniqueIndex("users_public_user_id_idx").on(table.publicUserId),
    index("users_display_name_lower_idx").on(sql`LOWER(${table.displayName})`),
  ]
);

export const userProfiles = pgTable("user_profiles", {
  userId: varchar("user_id", { length: 255 }).primaryKey().references(() => users.id, { onDelete: "cascade" }),
  idreg: varchar("idreg", { length: 40 }),
  lid: varchar("lid", { length: 40 }),
  uid: varchar("uid", { length: 40 }),
  profileMsg: text("profile_msg"),
  bio: text("bio"),
  mood: varchar("mood", { length: 120 }),
  customStatus: text("custom_status"),
  stealth: boolean("stealth").default(false),
  youtubeUrl: text("youtube_url"),
  autoplayEnabled: boolean("autoplay_enabled").default(false),
  avatarUrl: text("avatar_url"),
  bannerUrl: text("banner_url"),
  themeId: varchar("theme_id", { length: 80 }),
  avatarFrameUrl: text("avatar_frame_url"),
  seatFrameUrl: text("seat_frame_url"),
  giftIconUrl: text("gift_icon_url"),
  memberCardBgUrl: text("member_card_bg_url"),
  profileIconUrl: text("profile_icon_url"),
  nameGradient: text("name_gradient"),
  nameEffectId: varchar("name_effect_id", { length: 80 }),
  messageBubbleStyle: varchar("message_bubble_style", { length: 80 }),
  profileAccentColor: varchar("profile_accent_color", { length: 20 }),
  profileBackgroundUrl: text("profile_background_url"),
  backgroundColor: varchar("background_color", { length: 20 }),
  messageColor: varchar("message_color", { length: 20 }),
  nameColor: varchar("name_color", { length: 20 }),
  statusFontColor: varchar("status_font_color", { length: 20 }),
  gradientColor: varchar("gradient_color", { length: 20 }),
  evaluation: integer("evaluation").default(0),
  rep: integer("rep").default(0),
  coins: integer("coins").default(0),
  wallPostLikes: integer("wall_post_likes").default(0),
  giftsReceivedCount: integer("gifts_received_count").default(0),
  power: varchar("power", { length: 80 }),
  icon: text("icon"),
  isLogin: varchar("is_login", { length: 20 }),
  muted: boolean("muted").default(false),
  documents: boolean("documents").default(false),
  busy: boolean("busy").default(false),
  alerts: boolean("alerts").default(true),
  nopmcall: boolean("nopmcall").default(false),
  nopmvideocall: boolean("nopmvideocall").default(false),
  roomId: varchar("room_id", { length: 128 }),
  siteBadgeId: varchar("site_badge_id", { length: 80 }),
  siteBadge: text("site_badge"),
  giftedBannerUrl: text("gifted_banner_url"),
  giftedGiftIconUrl: text("gifted_gift_icon_url"),
  giftedPromotionIconUrl: text("gifted_promotion_icon_url"),
  joinuser: bigint("joinuser", { mode: "number" }),
  level: integer("level").default(1).notNull(),
  exp: integer("exp").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const profileVisits = pgTable("profile_visits", {
  id: uuid("id").defaultRandom().primaryKey(),
  visitorId: varchar("visitor_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
  profileId: varchar("profile_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
  visitedAt: timestamp("visited_at", { withTimezone: true }).defaultNow().notNull(),
  hiddenVisit: boolean("hidden_visit").default(false).notNull(),
  source: varchar("source", { length: 80 }),
}, (table) => [
  index("profile_visits_profile_idx").on(table.profileId),
  index("profile_visits_visitor_idx").on(table.visitorId),
]);

export const userVerifications = pgTable("user_verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
  type: varchar("type", { length: 40 }).notNull(),
  status: varchar("status", { length: 40 }).default("pending").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("user_verifications_user_idx").on(table.userId),
]);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 128 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    ownerId: varchar("owner_id", { length: 255 }).references(() => users.id),
    avatarUrl: text("avatar_url"),
    isPublic: boolean("is_public").default(true).notNull(),
    settings: jsonb("settings").default({}).notNull(),
    engagementScore: integer("engagement_score").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("rooms_slug_idx").on(table.slug)]
);

export const moderationEvents = pgTable("moderation_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: varchar("actor_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  targetUserId: varchar("target_user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  reason: text("reason"),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const siteSettings = pgTable("site_settings", {
  key: varchar("key", { length: 120 }).primaryKey(),
  value: jsonb("value").default({}).notNull(),
  updatedBy: varchar("updated_by", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const voiceProviderAccounts = pgTable("voice_provider_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  url: text("url").notNull(),
  apiKeyEncrypted: jsonb("api_key_encrypted").$type<EncryptedVoiceProviderSecret>().notNull(),
  apiSecretEncrypted: jsonb("api_secret_encrypted").$type<EncryptedVoiceProviderSecret>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const voiceProviderSelection = pgTable(
  "voice_provider_selection",
  {
    id: integer("id").default(1).primaryKey(),
    provider: varchar("provider", { length: 16 }).default("webrtc").notNull(),
    livekitAccountId: uuid("livekit_account_id").references(
      () => voiceProviderAccounts.id,
      { onDelete: "restrict" },
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("voice_provider_selection_singleton_check", sql`${table.id} = 1`),
    check(
      "voice_provider_selection_provider_check",
      sql`${table.provider} IN ('webrtc', 'livekit')`,
    ),
    check(
      "voice_provider_selection_account_check",
      sql`(${table.provider} = 'webrtc' AND ${table.livekitAccountId} IS NULL)
          OR (${table.provider} = 'livekit' AND ${table.livekitAccountId} IS NOT NULL)`,
    ),
  ],
);

export const chatBots = pgTable("chat_bots", {
  id: uuid("id").defaultRandom().primaryKey(),
  botKey: varchar("bot_key", { length: 80 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  kind: varchar("kind", { length: 60 }).notNull(),
  avatarUrl: text("avatar_url"),
  isActive: boolean("is_active").default(true).notNull(),
  settings: jsonb("settings").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("chat_bots_key_idx").on(table.botKey)]);

export const moderationFilters = pgTable("moderation_filters", {
  id: uuid("id").defaultRandom().primaryKey(),
  pattern: varchar("pattern", { length: 240 }).notNull(),
  action: varchar("action", { length: 40 }).default("block").notNull(),
  scope: varchar("scope", { length: 40 }).default("global").notNull(),
  severity: integer("severity").default(1).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: varchar("actor_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 120 }).notNull(),
  targetType: varchar("target_type", { length: 64 }),
  targetId: varchar("target_id", { length: 128 }),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const wallPosts = pgTable("wall_posts", {
  id: uuid("id").defaultRandom().primaryKey(),
  authorId: varchar("author_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
  body: text("body"),
  mediaUrl: text("media_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const wallComments = pgTable("wall_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  postId: uuid("post_id").references(() => wallPosts.id, { onDelete: "cascade" }),
  authorId: varchar("author_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const wallPostLikes = pgTable("wall_post_likes", {
  postId: uuid("post_id").references(() => wallPosts.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.postId, table.userId] })]);

export const eventStore = pgTable("event_store", {
  id: uuid("id").primaryKey(),
  type: varchar("type", { length: 120 }).notNull(),
  stream: varchar("stream", { length: 80 }).notNull(),
  version: integer("version").default(1).notNull(),
  actorId: varchar("actor_id", { length: 128 }),
  targetId: varchar("target_id", { length: 128 }),
  payload: jsonb("payload").default({}).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  status: varchar("status", { length: 40 }).default("published").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  persistedAt: timestamp("persisted_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("event_store_type_idx").on(table.type),
  index("event_store_stream_idx").on(table.stream),
  index("event_store_occurred_idx").on(table.occurredAt),
]);

export const eventSnapshots = pgTable("event_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  aggregateType: varchar("aggregate_type", { length: 80 }).notNull(),
  aggregateId: varchar("aggregate_id", { length: 128 }).notNull(),
  version: integer("version").default(1).notNull(),
  state: jsonb("state").default({}).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("event_snapshots_aggregate_idx").on(table.aggregateType, table.aggregateId, table.version),
]);

export const eventReplays = pgTable("event_replays", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestedBy: varchar("requested_by", { length: 255 }),
  status: varchar("status", { length: 40 }).default("pending").notNull(),
  filter: jsonb("filter").default({}).notNull(),
  replayedCount: integer("replayed_count").default(0).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const socialClusters = pgTable("social_clusters", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }),
  algorithm: varchar("algorithm", { length: 80 }).default("affinity_v1").notNull(),
  score: numeric("score", { precision: 10, scale: 4 }).default("0").notNull(),
  members: jsonb("members").default([]).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const interactionHeat = pgTable("interaction_heat", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: varchar("source_id", { length: 128 }).notNull(),
  targetId: varchar("target_id", { length: 128 }).notNull(),
  scope: varchar("scope", { length: 40 }).default("user").notNull(),
  heatScore: numeric("heat_score", { precision: 10, scale: 4 }).default("0").notNull(),
  decayRate: numeric("decay_rate", { precision: 6, scale: 4 }).default("0.0500").notNull(),
  lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("interaction_heat_pair_idx").on(table.sourceId, table.targetId, table.scope),
]);

export const influenceScores = pgTable("influence_scores", {
  userId: varchar("user_id", { length: 255 }).primaryKey(),
  roomInfluence: numeric("room_influence", { precision: 10, scale: 4 }).default("0").notNull(),
  networkInfluence: numeric("network_influence", { precision: 10, scale: 4 }).default("0").notNull(),
  trustPropagation: numeric("trust_propagation", { precision: 10, scale: 4 }).default("0").notNull(),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
});

// --- 6. ROLES AND PERMISSIONS ENGINE ---
export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  legacyName: varchar("legacy_name", { length: 120 }),
  name: varchar("name", { length: 120 }).notNull(),
  rank: integer("rank").default(0).notNull(),
  iconUrl: text("icon_url").default("").notNull(),
  isSystem: boolean("is_system").default(false).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  isOwner: boolean("is_owner").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  autoEnabled: boolean("auto_enabled").default(false).notNull(),
  autoPromote: boolean("auto_promote").default(false).notNull(),
  autoPoints: integer("auto_points").default(0).notNull(),
  announcementDailyLimit: integer("announcement_daily_limit").default(0).notNull(),
  legacyMetadata: jsonb("legacy_metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("roles_name_idx").on(table.name),
  index("roles_rank_idx").on(table.rank),
  check(
    "roles_announcement_daily_limit_check",
    sql`${table.announcementDailyLimit} BETWEEN 0 AND 1000`,
  ),
]);

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: varchar("type", { length: 16 }).notNull(),
    message: varchar("message", { length: 1000 }).notNull(),
    senderUserId: varchar("sender_user_id", { length: 255 })
      .references(() => users.id, { onDelete: "SET NULL" }),
    senderName: varchar("sender_name", { length: 120 }).notNull(),
    senderAvatarUrl: text("sender_avatar_url"),
    roomId: varchar("room_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("announcements_type_check", sql`${table.type} IN ('all', 'ranked', 'room')`),
    check(
      "announcements_message_length_check",
      sql`length(trim(${table.message})) BETWEEN 1 AND 1000`,
    ),
    index("announcements_created_idx").on(table.createdAt, table.id),
  ],
);

export const announcementRecipients = pgTable(
  "announcement_recipients",
  {
    announcementId: uuid("announcement_id")
      .references(() => announcements.id, { onDelete: "cascade" })
      .notNull(),
    recipientUserId: varchar("recipient_user_id", { length: 255 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.announcementId, table.recipientUserId] }),
    uniqueIndex("announcement_recipients_user_idx").on(table.recipientUserId, table.announcementId),
    index("announcement_recipients_announcement_idx").on(table.announcementId),
  ],
);

export const announcementDailyUsage = pgTable(
  "announcement_daily_usage",
  {
    userId: varchar("user_id", { length: 255 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    usageDate: varchar("usage_date", { length: 10 }).notNull(),
    sendCount: integer("send_count").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.usageDate] }),
    check("announcement_daily_usage_nonnegative_check", sql`${table.sendCount} >= 0`),
    index("announcement_daily_usage_date_idx").on(table.usageDate),
  ],
);

export const announcementIdempotency = pgTable(
  "announcement_idempotency",
  {
    senderUserId: varchar("sender_user_id", { length: 255 })
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    announcementId: uuid("announcement_id")
      .references(() => announcements.id, { onDelete: "SET NULL" }),
    response: jsonb("response").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.senderUserId, table.idempotencyKey] }),
    uniqueIndex("announcement_idempotency_sender_key_idx")
      .on(table.senderUserId, table.idempotencyKey),
    index("announcement_idempotency_expiry_idx").on(table.expiresAt),
    check(
      "announcement_idempotency_fingerprint_check",
      sql`length(${table.requestFingerprint}) = 64`,
    ),
  ],
);

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }).notNull(),
  permissionKey: varchar("permission_key", { length: 120 }).notNull(),
  permissionValue: jsonb("permission_value").default(true).notNull(),
  source: varchar("source", { length: 40 }).default("legacy_powers").notNull(),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permissionKey] })
]);

export const userRoleAssignments = pgTable("user_role_assignments", {
  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }).notNull(),
  assignedBy: varchar("assigned_by", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  legacyMetadata: jsonb("legacy_metadata").default({}).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.roleId] })
]);

// --- STORIES ---
export const stories = pgTable("stories", {
  id: uuid("id").defaultRandom().primaryKey(),
  authorId: varchar("author_id", { length: 255 }).notNull(),
  mediaUrl: text("media_url"),
  mediaType: varchar("media_type", { length: 20 }).default("text").notNull(),
  caption: text("caption"),
  linkUrl: text("link_url"),
  bgColor: varchar("bg_color", { length: 80 }).default("linear-gradient(135deg,#667eea,#764ba2)").notNull(),
  textColor: varchar("text_color", { length: 20 }).default("#ffffff").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  viewCount: integer("view_count").default(0).notNull(),
  likeCount: integer("like_count").default(0).notNull(),
  giftCount: integer("gift_count").default(0).notNull(),
  shareCount: integer("share_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("stories_author_idx").on(table.authorId),
  index("stories_expires_idx").on(table.expiresAt),
  index("stories_active_idx").on(table.isActive),
]);

export const storyViews = pgTable("story_views", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id").references(() => stories.id, { onDelete: "cascade" }).notNull(),
  viewerId: varchar("viewer_id", { length: 255 }).notNull(),
  viewerName: varchar("viewer_name", { length: 255 }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("story_views_unique_idx").on(table.storyId, table.viewerId),
  index("story_views_story_idx").on(table.storyId),
]);

export const storyReactions = pgTable("story_reactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id").references(() => stories.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  userName: varchar("user_name", { length: 255 }),
  type: varchar("type", { length: 20 }).default("like").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("story_reactions_unique_idx").on(table.storyId, table.userId),
  index("story_reactions_story_idx").on(table.storyId),
]);

// --- GIFT CATEGORIES ---
export const giftCategories = pgTable("gift_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// --- GIFTS ---
export const giftCatalog = pgTable("gift_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  icon: text("icon").notNull(),
  price: integer("price").notNull(),
  categoryId: uuid("category_id").references(() => giftCategories.id, { onDelete: "set null" }),
  category: varchar("category", { length: 40 }).default("common").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const giftTransactions = pgTable("gift_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  giftId: uuid("gift_id").references(() => giftCatalog.id, { onDelete: "cascade" }).notNull(),
  senderId: varchar("sender_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
  receiverId: varchar("receiver_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  quantity: integer("quantity").default(1).notNull(),
  totalCoins: integer("total_coins").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("gift_transactions_sender_idx").on(table.senderId),
  index("gift_transactions_receiver_idx").on(table.receiverId),
  index("gift_transactions_created_idx").on(table.createdAt),
]);

// --- PRIVATE MESSAGES ---
export const privateMessages = pgTable("private_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: varchar("conversation_id", { length: 512 }).notNull(),
  senderId: varchar("sender_id", { length: 255 }).notNull(),
  receiverId: varchar("receiver_id", { length: 255 }).notNull(),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("pm_conversation_idx").on(table.conversationId),
  index("pm_sender_idx").on(table.senderId),
  index("pm_receiver_idx").on(table.receiverId),
  index("pm_created_idx").on(table.createdAt),
]);

// --- INTERNAL MAIL ---
export const internalMail = pgTable("internal_mail", {
  id: uuid("id").defaultRandom().primaryKey(),
  senderId: varchar("sender_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
  recipientId: varchar("recipient_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("internal_mail_sender_idx").on(table.senderId),
  index("internal_mail_recipient_idx").on(table.recipientId),
  index("internal_mail_created_idx").on(table.createdAt),
]);

// --- FILE MANAGER ---
export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  folderPath: text("folder_path").default("/").notNull(),
  isFolder: boolean("is_folder").default(false).notNull(),
  mimeType: varchar("mime_type", { length: 80 }),
  size: integer("size").default(0).notNull(),
  storagePath: text("storage_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("files_user_idx").on(table.userId),
  index("files_folder_idx").on(table.folderPath),
]);

// --- NOTIFICATIONS ---
export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
  actorId: varchar("actor_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  type: varchar("type", { length: 40 }).notNull(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: varchar("entity_id", { length: 128 }),
  metadata: jsonb("metadata").default({}).notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("notifications_user_idx").on(table.userId),
  index("notifications_read_idx").on(table.userId, table.readAt),
  index("notifications_created_idx").on(table.createdAt),
]);

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(userProfiles),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

// --- STICKERS ---
export const stickerCategories = pgTable("sticker_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  icon: text("icon").default("😀"),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const stickers = pgTable("stickers", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id").references(() => stickerCategories.id, { onDelete: "cascade" }).notNull(),
  name: varchar("name", { length: 100 }).default(""),
  imageUrl: text("image_url").notNull(),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("stickers_category_idx").on(table.categoryId),
]);

// --- ICONS ---
export const icons = pgTable("icons", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).default(""),
  imageUrl: text("image_url").notNull(),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// --- SWIPER BANNERS ---
export const swiperBanners = pgTable("swiper_banners", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).default(""),
  imageUrl: text("image_url").notNull(),
  link: text("link").default(""),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// --- PROFILE FRAMES ---
export const profileFrames = pgTable("profile_frames", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).default(""),
  imageUrl: text("image_url").notNull(),
  link: text("link").default(""),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// --- MEMBER CARD THEMES ---
export const memberCardThemes = pgTable("member_card_themes", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).default(""),
  imageUrl: text("image_url").notNull(),
  link: text("link").default(""),
  sortOrder: integer("sort_order").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// --- ROOM BADGES ---
export const roomBadges = pgTable("room_badges", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).default(""),
  power: integer("power").default(0),
  icon: text("icon").default(""),
  bg: text("bg").default(""),
  bgType: varchar("bg_type", { length: 20 }).default("static"),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const animatedFaces = pgTable("animated_faces", {
  id: uuid("id").defaultRandom().primaryKey(),
  shortcut: varchar("shortcut", { length: 10 }).notNull().unique(),
  name: varchar("name", { length: 100 }).default(""),
  imageUrl: text("image_url").notNull(),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const roomKicks = pgTable("room_kicks", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  bannedUntil: timestamp("banned_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const roomMutes = pgTable("room_mutes", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: varchar("room_id", { length: 128 }).notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  mutedBy: varchar("muted_by", { length: 255 }),
  reason: text("reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const roomCustomRoles = pgTable(
  "room_custom_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    color: varchar("color", { length: 7 }).default("#64748b").notNull(),
    powerLevel: integer("power_level").default(1000).notNull(),
    permissions: jsonb("permissions").$type<RoomCustomRolePermissions>().default({
      canKick: false,
      canMute: false,
      canManageMics: false,
      canPin: false,
      canClearMessages: false,
      canBan: false,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("room_custom_roles_room_name_idx").on(table.roomId, sql`lower(${table.name})`),
    index("room_custom_roles_room_power_idx").on(table.roomId, table.powerLevel),
    check("room_custom_roles_name_check", sql`length(trim(${table.name})) BETWEEN 1 AND 64`),
    check("room_custom_roles_color_check", sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
    check("room_custom_roles_power_check", sql`${table.powerLevel} BETWEEN 1 AND 99999`),
    check(
      "room_custom_roles_permissions_check",
      sql`
        jsonb_typeof(${table.permissions}) = 'object'
        AND jsonb_object_length(${table.permissions}) = 6
        AND jsonb_typeof(${table.permissions}->'canKick') = 'boolean'
        AND jsonb_typeof(${table.permissions}->'canMute') = 'boolean'
        AND jsonb_typeof(${table.permissions}->'canManageMics') = 'boolean'
        AND jsonb_typeof(${table.permissions}->'canPin') = 'boolean'
        AND jsonb_typeof(${table.permissions}->'canClearMessages') = 'boolean'
        AND jsonb_typeof(${table.permissions}->'canBan') = 'boolean'
      `,
    ),
  ],
);


export const roomMembers = pgTable(
  "room_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }).notNull(),
    userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "cascade" }).notNull(),
    role: varchar("role", { length: 40 }).default("member").notNull(),
    power: integer("power").default(1000).notNull(),
    customRoleId: uuid("custom_role_id").references(() => roomCustomRoles.id, { onDelete: "set null" }),
    customTitle: varchar("custom_title", { length: 120 }),
    badgeId: uuid("badge_id").references(() => roomBadges.id, { onDelete: "set null" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("room_members_room_user_idx").on(table.roomId, table.userId),
    index("room_members_user_idx").on(table.userId),
    index("room_members_room_idx").on(table.roomId),
  ]
);

export const walletOperations = pgTable(
  "wallet_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorScope: varchar("actor_scope", { length: 16 }).notNull(),
    actorUserId: varchar("actor_user_id", { length: 255 }).references(() => users.id, { onDelete: "restrict" }),
    actorAgentId: uuid("actor_agent_id").references(() => walletAgents.id, { onDelete: "restrict" }),
    operationType: varchar("operation_type", { length: 40 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    referenceType: varchar("reference_type", { length: 40 }),
    referenceId: varchar("reference_id", { length: 255 }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "wallet_operations_actor_scope_check",
      sql`(
        (${table.actorScope} = 'member' AND ${table.actorAgentId} IS NULL)
        OR
        (${table.actorScope} = 'site_owner' AND ${table.actorUserId} IS NOT NULL AND ${table.actorAgentId} IS NULL)
        OR
        (${table.actorScope} = 'agent' AND ${table.actorUserId} IS NULL AND ${table.actorAgentId} IS NOT NULL)
        OR
        (${table.actorScope} = 'system' AND ${table.actorUserId} IS NULL AND ${table.actorAgentId} IS NULL)
      )`,
    ),
    check(
      "wallet_operations_fingerprint_format_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check("wallet_operations_idempotency_key_check", sql`length(trim(${table.idempotencyKey})) > 0`),
    uniqueIndex("wallet_operations_actor_idempotency_idx")
      .on(table.actorUserId, table.idempotencyKey)
      .where(sql`${table.actorScope} = 'member' AND ${table.actorUserId} IS NOT NULL`),
    uniqueIndex("wallet_operations_site_owner_idempotency_idx")
      .on(table.actorUserId, table.idempotencyKey)
      .where(sql`${table.actorScope} = 'site_owner' AND ${table.actorUserId} IS NOT NULL`),
    uniqueIndex("wallet_operations_system_idempotency_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.actorScope} = 'system'`),
    uniqueIndex("wallet_operations_agent_idempotency_idx")
      .on(table.actorAgentId, table.idempotencyKey)
      .where(sql`${table.actorScope} = 'agent' AND ${table.actorAgentId} IS NOT NULL`),
    uniqueIndex("wallet_operations_site_funding_reference_idx")
      .on(sql`lower(${table.referenceId})`)
      .where(sql`${table.referenceType} = 'site_wallet_funding' AND ${table.referenceId} IS NOT NULL`),
    uniqueIndex("wallet_operations_agent_inventory_reference_idx")
      .on(table.referenceId)
      .where(sql`${table.referenceType} = 'agent_inventory_order' AND ${table.referenceId} IS NOT NULL`),
    uniqueIndex("wallet_operations_member_coin_purchase_reference_idx")
      .on(table.referenceId)
      .where(sql`${table.referenceType} = 'member_coin_purchase' AND ${table.referenceId} IS NOT NULL`),
    index("wallet_operations_reference_idx").on(table.referenceType, table.referenceId),
    index("wallet_operations_created_idx").on(table.createdAt),
  ],
);

export const walletSettings = pgTable("wallet_settings", {
  key: varchar("key", { length: 120 }).primaryKey(),
  value: jsonb("value").default({}).notNull(),
  updatedBy: varchar("updated_by", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const walletAgents = pgTable(
  "wallet_agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 16 }).default("").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: varchar("status", { length: 16 }).default("active").notNull(),
    forcePasswordChange: boolean("force_password_change").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("wallet_agents_username_idx").on(table.username),
    check("wallet_agents_username_lowercase_check", sql`${table.username} = lower(${table.username})`),
    check("wallet_agents_status_check", sql`${table.status} IN ('active', 'disabled')`),
  ],
);

export const walletAgentPackages = pgTable(
  "wallet_agent_packages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id").references(() => walletAgents.id, { onDelete: "restrict" }).notNull(),
    coinAmount: bigint("coin_amount", { mode: "bigint" }).notNull(),
    priceMinorUnits: bigint("price_minor_units", { mode: "bigint" }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    paymentInstructions: text("payment_instructions").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("wallet_agent_packages_coin_amount_check", sql`${table.coinAmount} > 0`),
    check("wallet_agent_packages_price_check", sql`${table.priceMinorUnits} > 0`),
    check("wallet_agent_packages_currency_check", sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check(
      "wallet_agent_packages_instructions_length_check",
      sql`length(trim(${table.paymentInstructions})) BETWEEN 1 AND 4000`,
    ),
    uniqueIndex("wallet_agent_packages_agent_amount_idx").on(table.agentId, table.coinAmount),
    index("wallet_agent_packages_active_idx").on(table.agentId, table.isActive),
  ],
);

export const walletAgentInventoryOrders = pgTable(
  "wallet_agent_inventory_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id").references(() => walletAgents.id, { onDelete: "restrict" }).notNull(),
    requestedCoins: bigint("requested_coins", { mode: "bigint" }).notNull(),
    quotedPriceMinorUnits: bigint("quoted_price_minor_units", { mode: "bigint" }),
    currencyCode: varchar("currency_code", { length: 3 }),
    paymentInstructionsSnapshot: text("payment_instructions_snapshot"),
    paymentReference: varchar("payment_reference", { length: 255 }),
    proofObjectKey: text("proof_object_key"),
    proofUploadedAt: timestamp("proof_uploaded_at", { withTimezone: true }),
    receiptExpiresAt: timestamp("receipt_expires_at", { withTimezone: true }),
    settlementOperationId: uuid("settlement_operation_id")
      .references(() => walletOperations.id, { onDelete: "restrict" }),
    quotedByUserId: varchar("quoted_by_user_id", { length: 255 }).references(() => users.id, { onDelete: "set null" }),
    quotedAt: timestamp("quoted_at", { withTimezone: true }),
    status: varchar("status", { length: 24 }).default("requested").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    reviewedByUserId: varchar("reviewed_by_user_id", { length: 255 }).references(
      () => users.id,
      { onDelete: "set null" },
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: varchar("rejection_reason", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("wallet_agent_inventory_orders_coins_check", sql`${table.requestedCoins} > 0`),
    check(
      "wallet_agent_inventory_orders_price_check",
      sql`${table.quotedPriceMinorUnits} IS NULL OR ${table.quotedPriceMinorUnits} > 0`,
    ),
    check(
      "wallet_agent_inventory_orders_currency_check",
      sql`${table.currencyCode} IS NULL OR ${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "wallet_agent_inventory_orders_quote_check",
      sql`${table.status} IN ('requested', 'rejected') OR (
        ${table.quotedPriceMinorUnits} IS NOT NULL AND ${table.currencyCode} IS NOT NULL
        AND ${table.paymentInstructionsSnapshot} IS NOT NULL
        AND length(trim(${table.paymentInstructionsSnapshot})) BETWEEN 1 AND 4000
      )`,
    ),
    check(
      "wallet_agent_inventory_orders_status_check",
      sql`${table.status} IN ('requested', 'quoted', 'submitted', 'approved', 'rejected')`,
    ),
    check(
      "wallet_agent_inventory_orders_payment_proof_check",
      sql`${table.status} NOT IN ('submitted', 'approved') OR (
        ${table.paymentReference} IS NOT NULL AND ${table.proofObjectKey} IS NOT NULL
      )`,
    ),
    check(
      "wallet_agent_inventory_orders_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    uniqueIndex("wallet_agent_inventory_orders_agent_idempotency_idx")
      .on(table.agentId, table.idempotencyKey),
    uniqueIndex("wallet_agent_inventory_orders_settlement_idx")
      .on(table.settlementOperationId)
      .where(sql`${table.settlementOperationId} IS NOT NULL`),
    uniqueIndex("wallet_agent_inventory_orders_payment_reference_idx")
      .on(sql`lower(${table.paymentReference})`)
      .where(sql`${table.paymentReference} IS NOT NULL`),
    index("wallet_agent_inventory_orders_agent_status_idx").on(table.agentId, table.status, table.createdAt),
    index("wallet_agent_inventory_orders_receipt_expiry_idx").on(table.receiptExpiresAt),
  ],
);

export const memberCoinPurchases = pgTable(
  "member_coin_purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    memberUserId: varchar("member_user_id", { length: 255 })
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    agentId: uuid("agent_id").references(() => walletAgents.id, { onDelete: "restrict" }).notNull(),
    packageId: uuid("package_id").references(() => walletAgentPackages.id, { onDelete: "restrict" }).notNull(),
    coinAmount: bigint("coin_amount", { mode: "bigint" }).notNull(),
    priceMinorUnits: bigint("price_minor_units", { mode: "bigint" }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    paymentInstructionsSnapshot: text("payment_instructions_snapshot").notNull(),
    paymentReference: varchar("payment_reference", { length: 255 }),
    proofObjectKey: text("proof_object_key"),
    proofUploadedAt: timestamp("proof_uploaded_at", { withTimezone: true }),
    receiptExpiresAt: timestamp("receipt_expires_at", { withTimezone: true }),
    status: varchar("status", { length: 24 }).default("awaiting_payment").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    settlementOperationId: uuid("settlement_operation_id")
      .references(() => walletOperations.id, { onDelete: "restrict" }),
    reviewedByAgentId: uuid("reviewed_by_agent_id").references(() => walletAgents.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    rejectionReason: varchar("rejection_reason", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("member_coin_purchases_coin_amount_check", sql`${table.coinAmount} > 0`),
    check("member_coin_purchases_price_check", sql`${table.priceMinorUnits} > 0`),
    check("member_coin_purchases_currency_check", sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check(
      "member_coin_purchases_status_check",
      sql`${table.status} IN ('awaiting_payment', 'submitted', 'approved', 'rejected')`,
    ),
    check(
      "member_coin_purchases_payment_proof_check",
      sql`${table.status} IN ('awaiting_payment', 'rejected') OR (${table.paymentReference} IS NOT NULL AND ${table.proofObjectKey} IS NOT NULL)`,
    ),
    check(
      "member_coin_purchases_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    uniqueIndex("member_coin_purchases_member_idempotency_idx")
      .on(table.memberUserId, table.idempotencyKey),
    uniqueIndex("member_coin_purchases_settlement_idx")
      .on(table.settlementOperationId)
      .where(sql`${table.settlementOperationId} IS NOT NULL`),
    uniqueIndex("member_coin_purchases_agent_payment_reference_idx")
      .on(table.agentId, sql`lower(${table.paymentReference})`)
      .where(sql`${table.paymentReference} IS NOT NULL`),
    index("member_coin_purchases_member_status_idx").on(table.memberUserId, table.status, table.createdAt),
    index("member_coin_purchases_agent_status_idx").on(table.agentId, table.status, table.createdAt),
    index("member_coin_purchases_receipt_expiry_idx").on(table.receiptExpiresAt),
  ],
);

export const walletBalances = pgTable(
  "wallet_balances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountType: varchar("account_type", { length: 16 }).notNull(),
    userId: varchar("user_id", { length: 255 }).references(() => users.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").references(() => walletAgents.id, { onDelete: "restrict" }),
    bucket: varchar("bucket", { length: 40 }).notNull(),
    balanceCoins: bigint("balance_coins", { mode: "bigint" }).default(0n).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "wallet_balances_bucket_check",
      sql`(
      (${table.accountType} = 'member' AND ${table.agentId} IS NULL AND ${table.bucket} IN (
        'legacy_spendable', 'cashable_spendable', 'cashable_reserved',
        'purchased_spendable', 'gift_earnings_spendable', 'conversion_escrow'
      ))
        OR
      (${table.accountType} = 'site_owner' AND ${table.userId} IS NOT NULL
        AND ${table.agentId} IS NULL AND ${table.bucket} IN ('site_inventory', 'site_profit'))
        OR
      (${table.accountType} = 'agent' AND ${table.userId} IS NULL AND ${table.agentId} IS NOT NULL
        AND ${table.bucket} IN ('agent_inventory', 'agent_profit'))
      OR
      (${table.accountType} = 'system' AND ${table.userId} IS NULL AND ${table.agentId} IS NULL AND ${table.bucket} IN ('platform_fee', 'external_clearing', 'legacy_opening_equity', 'site_inventory'))
    )`,
    ),
    check(
      "wallet_balances_member_nonnegative_check",
      sql`${table.accountType} <> 'member' OR ${table.balanceCoins} >= 0`,
    ),
    check(
      "wallet_balances_site_inventory_nonnegative_check",
      sql`${table.accountType} <> 'system' OR ${table.bucket} <> 'site_inventory' OR ${table.balanceCoins} >= 0`,
    ),
    check(
      "wallet_balances_agent_inventory_nonnegative_check",
      sql`${table.accountType} <> 'agent' OR ${table.balanceCoins} >= 0`,
    ),
    check(
      "wallet_balances_site_owner_nonnegative_check",
      sql`${table.accountType} <> 'site_owner' OR ${table.balanceCoins} >= 0`,
    ),
    uniqueIndex("wallet_balances_member_bucket_idx")
      .on(table.userId, table.bucket)
      .where(sql`${table.accountType} = 'member' AND ${table.userId} IS NOT NULL`),
    uniqueIndex("wallet_balances_system_bucket_idx")
      .on(table.bucket)
      .where(sql`${table.accountType} = 'system'`),
    uniqueIndex("wallet_balances_agent_inventory_idx")
      .on(table.agentId, table.bucket)
      .where(sql`${table.accountType} = 'agent' AND ${table.agentId} IS NOT NULL`),
    uniqueIndex("wallet_balances_site_owner_bucket_idx")
      .on(table.userId, table.bucket)
      .where(sql`${table.accountType} = 'site_owner' AND ${table.userId} IS NOT NULL`),
    index("wallet_balances_user_idx").on(table.userId),
  ],
);

export const walletEntries = pgTable(
  "wallet_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id").references(() => walletOperations.id, { onDelete: "restrict" }).notNull(),
    walletBalanceId: uuid("wallet_balance_id").references(() => walletBalances.id, { onDelete: "restrict" }).notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    reversalOfEntryId: uuid("reversal_of_entry_id").references(
      (): AnyPgColumn => walletEntries.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("wallet_entries_nonzero_amount_check", sql`${table.amount} <> 0`),
    uniqueIndex("wallet_entries_operation_account_idx").on(table.operationId, table.walletBalanceId),
    uniqueIndex("wallet_entries_reversal_once_idx")
      .on(table.reversalOfEntryId)
      .where(sql`${table.reversalOfEntryId} IS NOT NULL`),
    index("wallet_entries_operation_idx").on(table.operationId),
    index("wallet_entries_balance_idx").on(table.walletBalanceId),
  ],
);

export const cashAccounts = pgTable(
  "cash_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerType: varchar("owner_type", { length: 24 }).notNull(),
    ownerUserId: varchar("owner_user_id", { length: 255 })
      .references(() => users.id, { onDelete: "restrict" }),
    ownerAgentId: uuid("owner_agent_id").references(() => walletAgents.id, { onDelete: "restrict" }),
    ownerReference: varchar("owner_reference", { length: 255 }),
    bucket: varchar("bucket", { length: 40 }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    balanceMinorUnits: bigint("balance_minor_units", { mode: "bigint" }).default(0n).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "cash_accounts_owner_check",
      sql`(
        (${table.ownerType} = 'member' AND ${table.ownerUserId} IS NOT NULL AND ${table.ownerAgentId} IS NULL AND ${table.ownerReference} IS NULL
          AND ${table.bucket} IN ('recipient_earnings', 'withdrawable_balance', 'payout_reserved'))
        OR
        (${table.ownerType} = 'site_owner' AND ${table.ownerUserId} IS NOT NULL AND ${table.ownerAgentId} IS NULL AND ${table.ownerReference} IS NULL
          AND ${table.bucket} IN ('site_profit', 'payout_reserved'))
        OR
        (${table.ownerType} = 'hosting_owner' AND ${table.ownerUserId} IS NULL AND ${table.ownerAgentId} IS NULL
          AND ${table.ownerReference} IS NOT NULL AND ${table.ownerReference} = lower(${table.ownerReference})
          AND ${table.bucket} IN ('hosting_profit', 'payout_reserved'))
        OR
        (${table.ownerType} = 'agent' AND ${table.ownerUserId} IS NULL AND ${table.ownerAgentId} IS NOT NULL AND ${table.ownerReference} IS NULL
          AND ${table.bucket} IN ('sales_reward', 'payout_reserved'))
        OR
        (${table.ownerType} = 'system' AND ${table.ownerUserId} IS NULL AND ${table.ownerAgentId} IS NULL AND ${table.ownerReference} IS NULL
          AND ${table.bucket} IN ('settlement_clearing', 'opening_equity', 'platform_cash_asset'))
      )`,
    ),
    check("cash_accounts_currency_check", sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check(
      "cash_accounts_nonnegative_check",
      sql`${table.ownerType} = 'system' AND ${table.bucket} IN ('settlement_clearing', 'opening_equity')
        OR ${table.balanceMinorUnits} >= 0`,
    ),
    uniqueIndex("cash_accounts_id_currency_idx").on(table.id, table.currencyCode),
    uniqueIndex("cash_accounts_member_bucket_currency_idx")
      .on(table.ownerUserId, table.bucket, table.currencyCode)
      .where(sql`${table.ownerType} = 'member'`),
    uniqueIndex("cash_accounts_site_owner_bucket_currency_idx")
      .on(table.ownerUserId, table.bucket, table.currencyCode)
      .where(sql`${table.ownerType} = 'site_owner'`),
    uniqueIndex("cash_accounts_hosting_owner_bucket_currency_idx")
      .on(table.ownerReference, table.bucket, table.currencyCode)
      .where(sql`${table.ownerType} = 'hosting_owner'`),
    uniqueIndex("cash_accounts_agent_bucket_currency_idx")
      .on(table.ownerAgentId, table.bucket, table.currencyCode)
      .where(sql`${table.ownerType} = 'agent'`),
    uniqueIndex("cash_accounts_system_bucket_currency_idx")
      .on(table.bucket, table.currencyCode)
      .where(sql`${table.ownerType} = 'system'`),
  ],
);

export const cashOperations = pgTable(
  "cash_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorScope: varchar("actor_scope", { length: 16 }).notNull(),
    actorUserId: varchar("actor_user_id", { length: 255 })
      .references(() => users.id, { onDelete: "restrict" }),
    actorAgentId: uuid("actor_agent_id").references(() => walletAgents.id, { onDelete: "restrict" }),
    operationType: varchar("operation_type", { length: 40 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    referenceType: varchar("reference_type", { length: 40 }),
    referenceId: varchar("reference_id", { length: 255 }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "cash_operations_actor_scope_check",
      sql`(
        (${table.actorScope} IN ('member', 'site_owner') AND ${table.actorUserId} IS NOT NULL AND ${table.actorAgentId} IS NULL)
        OR
        (${table.actorScope} = 'agent' AND ${table.actorUserId} IS NULL AND ${table.actorAgentId} IS NOT NULL)
        OR
        (${table.actorScope} = 'system' AND ${table.actorUserId} IS NULL AND ${table.actorAgentId} IS NULL)
      )`,
    ),
    check("cash_operations_currency_check", sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    check(
      "cash_operations_fingerprint_check",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check("cash_operations_idempotency_key_check", sql`length(trim(${table.idempotencyKey})) > 0`),
    uniqueIndex("cash_operations_id_currency_idx").on(table.id, table.currencyCode),
    uniqueIndex("cash_operations_member_idempotency_idx")
      .on(table.actorUserId, table.idempotencyKey)
      .where(sql`${table.actorScope} = 'member' AND ${table.actorUserId} IS NOT NULL`),
    uniqueIndex("cash_operations_site_owner_idempotency_idx")
      .on(table.actorUserId, table.idempotencyKey)
      .where(sql`${table.actorScope} = 'site_owner' AND ${table.actorUserId} IS NOT NULL`),
    uniqueIndex("cash_operations_agent_idempotency_idx")
      .on(table.actorAgentId, table.idempotencyKey)
      .where(sql`${table.actorScope} = 'agent' AND ${table.actorAgentId} IS NOT NULL`),
    uniqueIndex("cash_operations_system_idempotency_idx")
      .on(table.idempotencyKey)
      .where(sql`${table.actorScope} = 'system'`),
    index("cash_operations_reference_idx").on(table.referenceType, table.referenceId),
    index("cash_operations_created_idx").on(table.createdAt),
  ],
);

export const cashEntries = pgTable(
  "cash_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id").notNull(),
    cashAccountId: uuid("cash_account_id").notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).notNull(),
    amountMinorUnits: bigint("amount_minor_units", { mode: "bigint" }).notNull(),
    reversalOfEntryId: uuid("reversal_of_entry_id").references(
      (): AnyPgColumn => cashEntries.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "cash_entries_operation_currency_fk",
      columns: [table.operationId, table.currencyCode],
      foreignColumns: [cashOperations.id, cashOperations.currencyCode],
    }).onDelete("restrict"),
    foreignKey({
      name: "cash_entries_account_currency_fk",
      columns: [table.cashAccountId, table.currencyCode],
      foreignColumns: [cashAccounts.id, cashAccounts.currencyCode],
    }).onDelete("restrict"),
    check("cash_entries_nonzero_amount_check", sql`${table.amountMinorUnits} <> 0`),
    check("cash_entries_currency_check", sql`${table.currencyCode} ~ '^[A-Z]{3}$'`),
    uniqueIndex("cash_entries_operation_account_idx").on(table.operationId, table.cashAccountId),
    uniqueIndex("cash_entries_reversal_once_idx")
      .on(table.reversalOfEntryId)
      .where(sql`${table.reversalOfEntryId} IS NOT NULL`),
    index("cash_entries_operation_idx").on(table.operationId),
    index("cash_entries_account_idx").on(table.cashAccountId),
  ],
);
