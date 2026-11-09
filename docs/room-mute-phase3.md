# تقرير الإصلاح: كتم بالغرفة منفصل عن الكتم العام (Phase 3)

**الحالة: ✅ منفَّذ ومُختبَر (51/51 اختبار متصلة ناجحة)**

## 0. ما أُنفَّذ فعلياً

| الملف | التغيير |
|---|---|
| `server/db/schema.ts` | جدول drizzle `roomMutes` بجانب `roomKicks` |
| `server/db/migrate.ts` | إنشاء `room_mutes` + فهرسين (نفس نمط room_kicks) |
| `server/services/roomMuteService.ts` (جديد) | `deriveRoomIds` (خالصة) + `setRoomMute`/`isRoomMutedForUser`/`clearRoomMutesForUser`/`clearRoomMute`/`getUserActiveRoomMutes` — تفشل مغلقة عند خطأ DB |
| `server/socket/profileHandlers.ts` | فصل الاتجاهات: `global_mute`/`global_unmute` عام (كما كان)، `room_mute` غرفي فقط (بدون لمس users.muted)، `room_unmute` يفك الغرفي فقط. كشف غرفة العضو + إشعارات للحالة الغرفية على كل سوكيتات العضو (`roomMutedRooms`) |
| `server/socket/roomHandlers.ts` | فرض في رسائل الغرفة + التفاعل + ترطيب الحالة عند `join_room` مع تنويعات معرف الغرفة وإبلاغ عميل `muted_state` |
| `server/routes/api/rooms/[roomId]/messages.post.ts` | فحص الكتم الغرفي من DB لكل طلب REST |
| `src/lib/profileAdminPermissions.ts` | إضافة `global_unmute: "meiut"` |
| `src/components/profile/ProfileAdminPanel.tsx` | «إلغاء الإسكات العام» أصبح يستخدم `global_unmute` (في القائمة واللوحة القديمة) — لم يعد يمس الكتم الغرفي |
| `src/components/realtime/PresenceEngine.tsx` | معالج `muted_state` يقبل الحقول الاختيارية `roomMuted`/`roomId` ويوثقها محلياً دون كسر السلوك العام |
| `tests/roomMuteService.test.ts` (جديد) | 12 اختباراً |

**ملاحظات أثناء التنفيذ:**
- اكتشاف خطأين SQL أثناء كتابة الخدمة وأصلحتهما (`lower(room_id) = ANY(...)`).
- أخطاء TS المتبقية في `roomHandlers.ts` (canonicalRoomId/likesRequired/maxMembers/room.edit في سطور 213-541) موجودة مسبقاً في شجرة العمل ولم تُساس في هذه المرحلة؛ أضفنا locale scope خاص بالترطيب لتفاديها.

**الهدف:** فصل «كتم بالروم» عن «الإسكات العام». حالياً كلاهما يكتب نفس الحقل العام
`muted` فالكتم «بالغرفة» يمنع العضو من الحديث في كل السايت (الغرف + الخاص + الجدار)
— وهذا يفرغ أمر «كتم بالروم» من معناه.

---

## 1. الوضع الحالي (تم التحقق)

| العنصر | الدليل |
|---|---|
| `room_mute` و `global_mute` كلاهما: `updates = { muted: 1 }` | `profileHandlers.ts` (سطر 490) |
| `room_unmute` يفك الكتم العام (نفس `global_mute` معكوس) | سطر 491 — والقائمة توضحها «فك كتم الروم» خطأً |
| الفرض شبه العام في كامل السايت: رسائل الغرفة (socket 746/846)، الخاص (privateHandlers 140)، الجدار (wall POSTs)، REST (pm/send، rooms/messages) | فحوص `muted` |
| لا جدول غرفي | `room_kicks` موجود للطرد فقط |

## 2. التصميم الجديد

### 2.1 جدول جديد `room_mutes`
```
room_mutes ( id uuid PK, room_id, user_id, muted_by, reason, expires_at NULL, created_at )
INDEX (room_id, user_id)   — نفس نمط room_kicks (schema.ts 808 / migrate.ts 2359)
```
`expires_at = NULL` يعني كتماً دائماً حتى الفكّ (الواجهة الحالية لا تطلب مدة).

### 2.2 فصل الاتجاهات في الخدمة (server/services/roomMuteService.ts)
| الدالة | الوظيفة |
|---|---|
| `setRoomMute(roomId, userId, mutedBy?, reason?)` | إدراج كتم غرفي لكل تنويعات معرف الغرفة (نفس أسلوب room_kick في حل مشكلة المعرّفات) |
| `isRoomMutedForUser(roomIds[], userId)` | فحص فعال: مفعّل ولم ينته صلاحيته |
| `clearRoomMutesForUser(userId)` | فك كل الكتم الغرفي للعضو (يعيد عدد الصفوف المفكوكة) |
| `clearRoomMute(roomIds[], userId)` | فك كتم غرف محددة |

### 2.3 إعادة هيكلة الإجراءات في `profileHandlers.ts`
| الإجراء | قبل | بعد |
|---|---|---|
| `global_mute` | muted=1 (كل السايت) | يبقى كما هو (كل السايت) + تنبيه |
| **`global_unmute` (جديد)** | — (كان يُطلق عليه room_unmute) | muted=0 + تنبيه «تم السماح لك بالدردشة» + مزامنة الصوت كما كانت |
| `room_mute` | muted=1 (كل السايت) ❌ | إدراج في `room_mutes` على غرفة العضو الحالية فقط + تحديث حالة السوكيت + تنبيه «تم منعك من الحديث في غرفة X» |
| `room_unmute` | muted=0 (يفك العام ❌) | حذف من `room_mutes` (كل غرف العضو) + تحديث السوكيت + تنبيه، **بدون** لمس الكتم العام |

كشف غرفة العضو لـ `room_mute`: أولاً `data.roomId` إن أرسلت الواجهة، وإلا اكتشاف
تلقائي من presence/السوكيتات (نفس آلية `room_kick`). إن لم يكن في أي غرفة → خطأ واضح.

### 2.4 نقاط الفرض الجديدة
1. **رسائل الغرفة (socket `room_message`)** — بعد فحص الكتم العام: فحص
   `socket.data.user.roomMutedRooms` (خزنة في الذاكرة على السوكيت).
2. **التفاعل `room:react`** — نفس الفحص الغرفي.
3. **REST `POST /api/rooms/[roomId]/messages`** — فحص `isRoomMutedForUser` مباشرة من DB.
4. **`join_room`** — ترطيب (hydration) حالة الكتم الغرفي للغرفة عند الدخول (استعلام واحد
   لكل دخول، ثم ذاكرة) + إبلاغ العميل `muted_state { muted, roomMuted, roomId }`.
5. **میاز تنويعات معرفات الغرفة** (الغرف/room:prefix) مثل ما يحدث في room_kick.

الخاص والجدار يبقيان تحت الكتم العام فقط — صحيح لأن كتم الغرفة لا يجب أن يمدهما.

### 2.5 العميل
- `profileAdminPermissions.ts`: إضافة `global_unmute: "meiut"` (نفس صلاحية الكتم).
- `ProfileAdminMenuItems`: زر «إلغاء الإسكات العام» يستخدم `global_unmute` بدلاً من
  `room_unmute` — أما «فك كتم الروم» فيبقى `room_unmute` ومعناه الحقيقي الآن.
- `PresenceEngine`: معالج `muted_state` يتعامل مع الحقول الاختيارية الجديدة
  `roomMuted`/`roomId` دون كسر الموجود.
- الحالة الغرفية مستمرة في الذاكرة عبر `roomMutedRooms` على السوكيت؛ رسالة مرفوضة
  ترجع للمشجار `roomMuted: true` + رسالة واضحة.

### 2.6 لا يستحق هذا التعديل (خارج النطاق — موثق)
- أمر الدردشة المنفصل القديم `moderation_action` في `vite-socket-io.ts` (سيرفر تطوير فقط).
- مؤشر الكتابة (typing) لن يُمنع غرفياً (مجرد مؤشر، والرسالة نفسها محجوبة).
- مقعد المسرح الصوتي (voice seat) — الكتم الصوتي يبقى عاماً كما هو.

## 3. الاختبارات الجديدة (tests/roomMuteService.test.ts)
1. `setRoomMute` يدرج صفوفاً لكل تنويعات الغرفة ويستثني المكرر.
2. `isRoomMutedForUser` = true للمفعول (expires null) عند مطابقة أي تنويع.
3. false عند انتهاء `expires_at`.
4. false لمستخدم غير مكتوم.
5. `clearRoomMutesForUser` يحذف ويعيد العدد.
6. خريطة الصلاحيات: `room_mute` و `global_unmute` كلاهما يتطلب `meiut.edit/all`.
