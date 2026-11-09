export const CHAT_FEATURE_GROUPS = [
  {
    label: "ميزات الغرف",
    resources: [
      { key: "room_chat", label: "إرسال رسائل الغرف" },
      { key: "room_media", label: "إرسال الوسائط في الغرف" },
      { key: "room_youtube", label: "مشاركة YouTube في الغرف" },
      { key: "room_audio_message", label: "إرسال الرسائل الصوتية في الغرف" },
      { key: "room_reactions", label: "التفاعل مع الغرف ورسائلها" },
      { key: "room_voice", label: "استخدام المايك في الغرف" },
      { key: "room_voice_moderation", label: "إدارة مقاعد المايك" },
    ],
  },
  {
    label: "الإعلانات",
    resources: [
      { key: "announcement_all", label: "إرسال إعلان للجميع" },
      { key: "announcement_ranked", label: "إرسال إعلان للسوابر" },
      { key: "announcement_room", label: "إرسال إعلان لغرفة محددة" },
    ],
  },
  {
    label: "ميزات الخاص والمكالمات",
    resources: [
      { key: "private_chat", label: "إرسال رسائل الخاص" },
      { key: "private_media", label: "إرسال الوسائط في الخاص" },
      { key: "private_youtube", label: "مشاركة YouTube في الخاص" },
      { key: "private_audio_message", label: "إرسال الرسائل الصوتية في الخاص" },
      { key: "private_voice_call", label: "مكالمات صوتية في الخاص" },
      { key: "private_video_call", label: "مكالمات فيديو في الخاص" },
      { key: "private_reactions", label: "التفاعل مع رسائل الخاص" },
    ],
  },
  {
    label: "ميزات الحائط",
    resources: [
      { key: "wall_posts", label: "إنشاء منشورات الحائط" },
      { key: "wall_media", label: "إرفاق الوسائط بمنشورات الحائط" },
      { key: "wall_youtube", label: "مشاركة YouTube على الحائط" },
      { key: "wall_comments", label: "التعليق على الحائط" },
      { key: "wall_reactions", label: "التفاعل مع منشورات وتعليقات الحائط" },
    ],
  },
  {
    label: "ميزات القصص",
    resources: [
      { key: "story_publish", label: "نشر القصص" },
      { key: "story_interactions", label: "التفاعل مع القصص" },
    ],
  },
  {
    label: "الملصقات والمؤثرات",
    resources: [{ key: "chat_effects", label: "إرسال الملصقات والفيسات المتحركة" }],
  },
] as const;

export const CHAT_FEATURE_PERMISSION_KEYS = CHAT_FEATURE_GROUPS.flatMap(({ resources }) =>
  resources.map(({ key }) => `${key}.use` as const),
);

export const ANNOUNCEMENT_DAILY_LIMIT_MAX = 1000;

export const DEFAULT_CHAT_FEATURE_PERMISSION_KEYS = CHAT_FEATURE_PERMISSION_KEYS.filter(
  (permission) =>
    permission !== "room_voice_moderation.use" &&
    !permission.startsWith("announcement_"),
);

export type ChatFeaturePermission = (typeof CHAT_FEATURE_PERMISSION_KEYS)[number];
export function isValidAnnouncementDailyLimit(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= ANNOUNCEMENT_DAILY_LIMIT_MAX;
}

export type ChatMessageChannel = "room" | "private" | "wall";
export type ChatMessageMediaType = "image" | "video" | "audio";
export type PrivateCallMode = "voice" | "video";
export type ChatUploadPurpose = "room_message" | "wall_post";

export function getChatUploadPermissionRequirements(
  purpose: ChatUploadPurpose,
  mediaType: ChatMessageMediaType,
): ChatFeaturePermission[] {
  return getMessagePermissionRequirements({
    channel: purpose === "room_message" ? "room" : "wall",
    mediaType,
  });
}

export function getPrivateCallPermission(mode: unknown): ChatFeaturePermission | null {
  if (mode === "voice") return "private_voice_call.use";
  if (mode === "video") return "private_video_call.use";
  return null;
}

export function getMessagePermissionRequirements(input: {
  channel: ChatMessageChannel;
  text?: string;
  mediaType?: ChatMessageMediaType;
  hasMedia?: boolean;
  hasEffects?: boolean;
}): ChatFeaturePermission[] {
  const permissions: ChatFeaturePermission[] = [
    input.channel === "room"
      ? "room_chat.use"
      : input.channel === "private"
        ? "private_chat.use"
        : "wall_posts.use",
  ];

  if (input.text && /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(input.text)) {
    permissions.push(
      input.channel === "room"
        ? "room_youtube.use"
        : input.channel === "private"
          ? "private_youtube.use"
          : "wall_youtube.use",
    );
  }

  const mediaPermission = input.channel === "room"
    ? "room_media.use"
    : input.channel === "private"
      ? "private_media.use"
      : "wall_media.use";
  if (input.mediaType === "audio") {
    if (input.channel !== "wall") permissions.push(mediaPermission);
    permissions.push(
      input.channel === "room"
        ? "room_audio_message.use"
        : input.channel === "private"
          ? "private_audio_message.use"
          : "wall_media.use",
    );
  } else if (input.hasMedia || input.mediaType) {
    permissions.push(mediaPermission);
  }

  if (input.hasEffects) permissions.push("chat_effects.use");
  return [...new Set(permissions)];
}

export function hasAllRequiredPermissions(
  permissions: ReadonlySet<string>,
  requiredPermissions: readonly string[],
): boolean {
  return requiredPermissions.every((permission) => permissions.has(permission));
}
