/**
 * ─── الهوية العامة الموحّدة ───────────────────────────────────────────────────
 *
 * الاسم المُعروض للآخرين في كل مسارات الموقع يجب أن يكون الاسم المستعار
 * (display_name / topic) فقط، وليس اسم المستخدم الحقيقي المستخدم في تسجيل
 * الدخول؛ لأن كشفه يسمح بمحاولات تخمين كلمات المرور.
 *
 * القاعدة:
 *  - إن وُجد الاسم المستعار → يُستخدم كما هو.
 *  - إن لم يوجد → نرجع للمعرّف العام (idreg / publicUserId) أو صفة العضوية،
 *    ولا نرجع أبداً إلى اسم المستخدم الحقيقي.
 */

type IdentitySource = {
  username?: string | null;
  displayName?: string | null;
  name?: string | null;
  topic?: string | null;
  mentionName?: string | null;
  publicUserId?: string | null;
  idreg?: string | number | null;
  role?: string | null;
};

const isGuest = (source?: IdentitySource): boolean =>
  String(source?.role || "").toLowerCase() === "guest" ||
  String(source?.username || "").toLowerCase().startsWith("guest-");

/** الاسم العام الافتراضي حسب نوع الحساب */
const fallbackIdentity = (source?: IdentitySource): string => {
  const idreg = source?.idreg != null ? String(source.idreg).trim() : "";
  if (idreg) return `#${idreg.replace(/^#+/, "")}`;
  const publicUserId = String(source?.publicUserId || "").trim();
  if (publicUserId) return publicUserId;
  return isGuest(source) ? "زائر" : "عضو";
};

/**
 * resolvePublicName – الاسم الذي يُعرض لجميع الأعضاء الآخرين.
 * يُستخدم في كل الأحداث المُذاعة عبر الـ Socket وفي أي ردّ API يbservableه الأعضاء.
 */
export const resolvePublicName = (source?: IdentitySource | null): string => {
  if (!source) return "عضو";
  const alias =
    String(source.displayName || "").trim() ||
    String(source.name || "").trim() ||
    String(source.topic || "").trim();
  return alias || fallbackIdentity(source);
};

/**
 * toPublicIdentity – كائن هوية جاهز للبث العام: يبقي المعرّف الداخلي id/uid
 * (للمطابقة التقنية بين الأحداث) ويستبدل username الحقيقي بالاسم المستعار.
 */
export const toPublicIdentity = (source?: IdentitySource | null) => ({
  username: resolvePublicName(source),
  displayName: resolvePublicName(source),
  id: source?.id,
});
