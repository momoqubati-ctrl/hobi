# CRITICAL PRIVATE MESSAGING & IDENTITY SECURITY FINAL VALIDATION REPORT — Hobi

**الحالة:** `PARTIAL — STRICT_READ_ONLY — WAITING_FOR_USER_EXPLICIT_APPROVAL`

**النطاق:** مراجعة ساكنة لمسارات الرسائل الخاصة والهوية والبحث والمصادقة، وتصميم اختبارات مستقبلية معزولة.
**التنفيذ:** لم تُرسل رسائل اختبار، ولم تُجرَ اختبارات تشغيلية أو اتصالات بقاعدة البيانات، ولم تُنفذ كتابة بيانات أو ترحيلات أو تغييرات تطبيقية أو نشر.

## 1. الخلاصة التنفيذية

| الأولوية | النتيجة | ما يثبته الدليل | ما لم يُثبت |
|---|---|---|---|
| P0 | مسار REST الخاص بالرسائل يرسل `pm:message` عبر بث عام | المصدر الحالي يستدعي `publishGlobalEvent` بحمولة الرسالة، والوسيط يبث إلى `io` أو يمررها إلى مشتركي Redis الذين يبثون إلى `io` | لم يُختبر نشر حي أو التقاط اتصال مستخدم فعلي |
| P0 | واجهات قراءة PM المستمرة تقبل معرفات يرسلها العميل بلا تحقق ظاهر من العضوية | المسارات تمرر `userId` و`conversationId` إلى خدمة تقرأ المحادثة بحسب `conversation_id` دون شرط عضوية | لم يُجرِ أي طلب حي ولم تُقرأ رسائل قاعدة بيانات |
| P0 | البريد الداخلي يبث الحمولة عالميًا؛ مسار REST لا يظهر تحقق مصادقة ويقبل `senderId` من الجسم | تدفق ساكن من المسار إلى الخدمة ثم البث العام | لم يُختبر على نشر حي |
| P1 | حل معرفات PM يقبل `id/uid/idreg/username` مع `LIMIT 1`، بينما `idreg` له ست مجموعات مكررة في لقطة سابقة | مسار الحل غير حتمي عند تعدد المطابقات؛ تقرير الهوية السابق يسجل التصادمات | لم تُعد قراءة قاعدة البيانات في هذا التحقق |
| P1 | غرف Socket تضم معرفات متعددة في مساحة `user:`، منها `idreg` و`username` | الحسابان المتصلان بقيمة `idreg` مكررة ينضمان إلى الغرفة نفسها؛ قد تتصادم أيضًا أنواع المعرفات | لم يُثبت تسليم حدث حساس بعينه عبر هذه الغرفة |
| P1 | بحث عام يكشف حقولًا داخلية، وبعض المسارات تقبل توكنًا منتهيًا أو secret احتياطيًا | الشيفرة تعرض `username/id/role/idreg` أو لا تتحقق من `exp` في مسارات معينة | لم يُختبر الوصول الفعلي أو إعدادات النشر |
| P1 | `logout` لا يتحقق من التوقيع قبل استخدام `userId` المرسل، ولا يبطل bearer token مركزيًا | الشيفرة تفصل اتصالات المستخدم المعطى، ويمكنها أخذ هويته من الجسم | لم يُختبر أثره على نشر حي |

**القرار:** يوجد تأكيد ساكن على بث محتوى خاص إلى الجمهور العام في مسار REST؛ هذا **ليس** إثباتًا لواقعة تسريب مرصودة. يجب إبقاء الحالة `PARTIAL` وعدم إعلان جاهزية التنفيذ أو الإغلاق.

## 2. منهج الأدلة وحدودها

- تم تتبع الشيفرة الحالية مباشرة، واستخدم Graphify للاستكشاف فقط؛ لم يُعتمد عليه لإثبات السلوك الذي لم تؤكده الملفات.
- لم يُجرِ هذا التحقق استعلامات قاعدة بيانات أو اتصالات Socket أو اختبارات أو إرسال رسائل.
- يتضمن المستودع تغييرات غير مثبتة النسبة. عند فحص Git ظهرت الملفات ذات الصلة التالية معدلة في worktree: [send.post.ts](./server/routes/api/pm/send.post.ts)، [SocketBroker.ts](./server/socket/SocketBroker.ts)، و[privateHandlers.ts](./server/socket/privateHandlers.ts). الفروق الحالية تضيف مصادقة/صلاحيات أو تحسينات وسيط، لكنها لا تزيل بث REST العام؛ لا يثبت ذلك أن هذه التغييرات منشورة أو مفعلة على خادم حي.
- توجد أيضًا ملفات أخرى معدلة في worktree، بما فيها مخرجات Graphify؛ لم تُعدّل أو تُسترجع. لعدم وجود لقطة Git نظيفة عند بدء المهمة، لا يمكن نسبة كل تغيير ظاهر إلى هذه المراجعة أو إلى مستخدم بعينه.
- أرقام `idreg` ومصفوفة الأسماء أدناه من نتائج الفحص السابق المسجلة في [FINAL_IDENTITY_DESIGN_CLOSURE_EVIDENCE_REPORT.md](./FINAL_IDENTITY_DESIGN_CLOSURE_EVIDENCE_REPORT.md#L88)، وليست قراءة جديدة أو ضمانًا لحالة البيانات الحالية.

## 3. تتبع مسار الرسالة الخاصة

### المسار من العميل إلى الخادم

1. يبدأ العميل برسالة Socket `pm:send` إلى `otherUser.id`. عند فشل الإقرار أو انتهاء المهلة، يحاول العميل، للرسائل التي لا تحمل مرفقًا، إرسال REST إلى `/api/pm/send`: [PrivateChat.tsx](./src/components/chat/PrivateChat.tsx#L576)، [PrivateChat.tsx](./src/components/chat/PrivateChat.tsx#L600).
2. معالج Socket يأخذ هوية المرسل من `socket.data.user`، وينشئ `myId` من `rawUser.id` غالبًا، ثم يضع الرسالة في مخزن ذاكرة مؤقت ويرسلها إلى غرفتي `social:<recipient>` و`social:<sender>`: [privateHandlers.ts](./server/socket/privateHandlers.ts#L109)، [privateHandlers.ts](./server/socket/privateHandlers.ts#L217)، [privateHandlers.ts](./server/socket/privateHandlers.ts#L245). هذا المسار لا يستعمل البث العام لـ `pm:message`، لكن `toUserId` يأتي من العميل ولا يظهر في هذا المقتطف تحقق عضوية/حظر للمستقبل.
3. مسار REST يطلب سياق المرسل الموثق، لكنه يأخذ `receiverId` من الجسم: [send.post.ts](./server/routes/api/pm/send.post.ts#L9). يمرر الطرفين إلى `sendPrivateMessage`.
4. `resolveUserKey` يقبل `uid` و`users.id` و`idreg` و`username`، ثم يختار صفًا بـ `LIMIT 1`؛ تخزن الخدمة معرفات الرسالة بعد توحيدها إلى `uid`: [privateMessageService.ts](./server/services/privateMessageService.ts#L14)، [privateMessageService.ts](./server/services/privateMessageService.ts#L34).
5. يبني REST `socketMessage` من صف الرسالة، ويضيف `clientId` و`text` و`read`، ثم يستدعي أولًا `publishGlobalEvent("pm:message", socketMessage)` وبعدها ينشر أيضًا إلى غرف `social:<receiverId>` و`social:<senderId>`: [send.post.ts](./server/routes/api/pm/send.post.ts#L61)، [send.post.ts](./server/routes/api/pm/send.post.ts#L70)، [send.post.ts](./server/routes/api/pm/send.post.ts#L76).
6. عند تعطيل Redis، `publishGlobalEvent` يستهدف كائن `io` المحلي كله. وعند تفعيله، ينشر على قناة Redis العامة؛ المشترك يختار `target = io` ثم ينفذ `target.emit`: [SocketBroker.ts](./server/socket/SocketBroker.ts#L112)، [SocketBroker.ts](./server/socket/SocketBroker.ts#L28).

### محتوى الحمولة والجمهور

حمولة REST تحتوي على الأقل: `id`، `conversationId`، `senderId`، `receiverId`، `body`، `readAt`، `createdAt`، `clientId`، `text`، و`read`. إذن **نص الرسالة ومعرفات الطرفين ومعرف المحادثة وحالة القراءة والتوقيت تُرسل ضمن الحدث العام**. مسار Socket المباشر يحمل معلومات إضافية مثل اسم المرسل وصورته وألوانه، والوسائط والرد المقتبس والوجوه المتحركة: [privateHandlers.ts](./server/socket/privateHandlers.ts#L217).

لا يظهر في `publishGlobalEvent` أي شرط يختبر كون socket مرسلًا أو مستقبلًا. لذلك:

```text
STATIC_BROADCAST_CONFIRMED: YES
POTENTIAL_SENSITIVE_DATA_EXPOSURE: YES
RUNTIME_EXPOSURE_CONFIRMED: NO — لم يُختبر نشر حي
NOT_EXPLOITABLE_WITH_EVIDENCE: NO
```

فلترة الواجهة ليست حاجزًا أمنيًا: `PrivateChat` يرشح حسب `conversationId` بعد استلام الحدث، و`Dashboard` يفحص `receiverId` بعد الاستلام، لكن `PrivateList` يعالج الحدث ويبني/يحدث قائمة المحادثات دون التحقق أولًا من مشاركة المستخدم الحالي: [PrivateChat.tsx](./src/components/chat/PrivateChat.tsx#L788)، [Dashboard.tsx](./src/pages/Dashboard.tsx#L208)، [PrivateList.tsx](./src/components/chat/PrivateList.tsx#L125). من ثم يمكن للواجهة نفسها أن تعرض معاينة رسالة غير موجهة للمستخدم إن وصلها الحدث العام.

في REST يُرسل الحدث نفسه مرة عامة ومرة إلى الغرف المستهدفة؛ قد يتلقى العضو المقصود نسختين. `PrivateChat` يزيل تكرارًا محليًا لبعض الرسائل، لكن معالج `PrivateList` يزيد العداد بناء على كل حدث دون مفتاح تكرار ظاهر. هذه نتيجة ساكنة محتملة وليست قياسًا حيًا.

### الجمهور لكل أحداث PM

| الحدث/المسار | جمهور الإرسال في الشيفرة | تحقق العضوية |
|---|---|---|
| REST `pm:message` | كل اتصالات Socket عبر `io`، ثم غرف المرسل والمستقبل | لا يوجد قبل البث العام |
| Socket `pm:message` | غرفة المستلم الاجتماعية، وغرفة المرسل عند اختلافهما | الغرفة موجهة لكن `toUserId` يقدمه العميل |
| `pm:history` | رد callback إلى socket الطالب | يفحص أن الطالب أحد طرفي محادثة المخزن المؤقت |
| `pm:conversations` | رد callback إلى socket الطالب | يستعمل هوية socket |
| `pm:read` | غرفة الطرف الآخر الاجتماعية؛ `pm:unread_update` للـ socket الطالب | يحدد الطرف الآخر من المحادثة ويغير الحالة لطرف الرسالة |
| `pm:typing` / `pm:stop_typing` | غرفة اجتماعية يحددها `toUserId` المرسل من العميل | لا يظهر فحص أن الطالب طرف في محادثة مع المستلم |
| `pm:reaction` | غرفتا الطرفين | يتحقق من العضوية ووجود الرسالة |
| حذف/تعديل PM | لم يظهر معالج PM عام للحذف/التعديل في الملفات المفحوصة | لا يوجد ما يثبت حدثًا عامًا من هذا النوع |
| REST قراءة/قائمة/قراءة غير مقروء | HTTP response للطالب | المسارات لا تعرض تحقق مصادقة/عضوية موثوقًا في ملفاتها |

**اختلاف معرفات التسليم:** Socket يسجل الغرفة الاجتماعية باستخدام `socket.data.user.id`، بينما خدمة REST تطبع `senderId/receiverId` إلى `uid` ثم تُستخدم هذه القيم لبناء اسم غرفة التسليم. إذا لم يكن `uid` مساويًا لـ `users.id` فقد لا تصل النسخة الموجهة؛ لم تُفحص قيم قاعدة البيانات في هذه الجولة، لذا هذا تعارض تصميمي محتمل لا إثبات فشل تسليم بعينه. البث العام ما زال يرسل الحمولة بصرف النظر عنه.

## 4. مسارات PM المستمرة والتسريب عبر السجل

المسارات التالية تعتمد `userId` أو `conversationId` المقدمين من العميل ولا يظهر في ملفاتها تحقق من JWT أو من عضوية الحساب في المحادثة. لم يظهر middleware مصادقة عام ضمن `server/middleware`؛ الموجود هناك هو محدد المعدل فقط: [rateLimiter.ts](./server/middleware/rateLimiter.ts#L1).

- `/api/pm/messages` يمرر `conversationId` و`userId` للخدمة: [messages.get.ts](./server/routes/api/pm/messages.get.ts#L4). تستعلم الخدمة عن كل صفوف `conversation_id = $1` دون شرط أن يكون الطالب طرفًا؛ `userId` يستخدم فقط لتحديد `isMine` وتحديث القراءة: [privateMessageService.ts](./server/services/privateMessageService.ts#L103)، [privateMessageService.ts](./server/services/privateMessageService.ts#L130).
- `/api/pm/conversations` يمرر `userId` اعتباطيًا ويعيد المحادثات، كما يكتب كائن النتيجة كاملًا في سجل الخادم، بما فيه `lastMessage`: [conversations.get.ts](./server/routes/api/pm/conversations.get.ts#L4)، [conversations.get.ts](./server/routes/api/pm/conversations.get.ts#L15)، [privateMessageService.ts](./server/services/privateMessageService.ts#L59).
- `/api/pm/unread` يعيد العدد لمعرف يحدده العميل: [unread.get.ts](./server/routes/api/pm/unread.get.ts#L4).
- `/api/pm/read` يحدّث حالة القراءة وفق `conversationId` و`userId` من الجسم: [read.post.ts](./server/routes/api/pm/read.post.ts#L4).
- `/api/pm/user` يحل `id/uid/idreg/username` بـ `LIMIT 1` ويعيد حقولًا منها `username` ومعرفات داخلية: [user.get.ts](./server/routes/api/pm/user.get.ts#L15).

النتيجة هي تصميم IDOR ساكن عالي الخطورة في مسارات PM، إضافة إلى تسريب نصوص محتمل عبر سجلات المحادثات. لا يُثبت هذا التقرير أن شخصًا استعلم عنها أو أن سجلًا محددًا كُشف.

## 5. البريد الداخلي كمسار حساس مجاور

- مسار `/api/mail/send` يأخذ `senderId` و`recipientId` و`text` من الجسم، ولا يظهر فيه فحص مصادقة: [send.post.ts](./server/routes/api/mail/send.post.ts#L6).
- تستدعي الخدمة `sendMail(senderId, recipientId, text)` ثم تبث `internal_mail` عالميًا: [send.post.ts](./server/routes/api/mail/send.post.ts#L16)، [send.post.ts](./server/routes/api/mail/send.post.ts#L18).
- معالج Socket يأخذ المرسل من socket الموثق، لكن ما زال يبث الحمولة نفسها عالميًا: [mailHandlers.ts](./server/socket/mailHandlers.ts#L12)، [mailHandlers.ts](./server/socket/mailHandlers.ts#L32).
- الحمولة تشمل جسم البريد ومعرفات المرسل والمستقبل؛ وخدمة البريد تستخدم ربطًا بـ `id/uid/idreg`: [internalMailService.ts](./server/services/internalMailService.ts#L18)، [internalMailService.ts](./server/services/internalMailService.ts#L82).

هذا مسار مستقل عن PM المباشر، ويستحق معالجة على نفس مستوى السرية. لم يتم إرسال بريد اختبار.

## 6. الهوية الداخلية و`uid` و`idreg` ومسارات التوجيه

### ما يثبته الفحص السابق

- `users.id` هو المفتاح الأساسي التصميمي.
- في العينة السابقة، كانت قيم `uid` الـ17 مملوءة ومتميزة؛ لم يثبت ذلك قيدًا فريدًا دائمًا.
- رُصدت ست مجموعات `idreg` مكررة، في كل مجموعة حسابان. بناء على ذلك، لا يصلح `idreg` لحل هوية داخلية مبهمة. التفاصيل العددية والتصنيف موثقان في التقرير السابق: [تقرير الهوية السابق](./FINAL_IDENTITY_DESIGN_CLOSURE_EVIDENCE_REPORT.md#L120).

### الاستخدامات المؤثرة

| المجال | السلوك المرصود | الخطر/الحد |
|---|---|---|
| JWT | `sub` يصدر من `user.id` | أساس صحيح للهوية، لكن لا تتبعه كل المسارات إلى مخزن موحد |
| PM REST | يحل `uid/id/idreg/username` مع `LIMIT 1` ويخزن `uid` | قد يختار حسابًا غير محدد عند `idreg` مكرر |
| PM Socket | `myId` يأتي من `rawUser.id`، والمستلم من `toUserId` | يختلف مفتاحه عن تخزين REST المعتمد على `uid` |
| Socket Rooms | تنضم الحسابات إلى `user:<id>` و`user:<username>` و`user:<idreg>` | حسابان يحملان `idreg` نفسه يشتركان في `user:<idreg>` عند الاتصال؛ كما أن أنواع المعرفات تشترك في مساحة أسماء واحدة |
| Presence | يستعمل خدمات الحضور `id` و`username` وحقول `idreg` legacy | البحث أو المطابقة بقيمة legacy لا يثبت تفرد الهوية |
| الإشعارات | خدمات الإشعار تحل الممثل عبر `id/uid/idreg` مع `LIMIT 1` | قد ينتج ربط غير محدد؛ لا توجد واقعة رصد مثبتة |
| البريد الداخلي | يربط المستخدمين بـ `id/uid/idreg` | الربط قد يتضاعف مع قيمة legacy مكررة |
| الغرف | مسار حل مالك الغرفة يقارن معرفات legacy متعددة | إزالة `LIMIT 1` وحدها لا تحسم التصادم؛ يجب رفض المطابقة المتعددة |
| الملف الشخصي | `userRepository` و`profileService` يقبلان مفاتيح قديمة | استخدام هذه القيم في الكتابة/الملكية يحتاج mapping أحاديًا |
| الحائط والتعليقات | خدماتها تقبل `uid/id/idreg/username` في ربط المؤلف | لا تُنقل الملكية ولا تُصحح سجلات قديمة تلقائيًا |
| البحث والإدارة | بعض النتائج ترجع `idreg/uid/username/role` | كشف داخلي غير لازم في واجهة عامة |

أدلة التنفيذ الأساسية: [SocketChannels.ts](./server/socket/SocketChannels.ts#L12)، [SocketGateway.ts](./server/socket/SocketGateway.ts#L16)، [index.ts](./server/socket/index.ts#L65)، [privateHandlers.ts](./server/socket/privateHandlers.ts#L113)، [privateMessageService.ts](./server/services/privateMessageService.ts#L14)، [notificationService.ts](./server/services/notificationService.ts#L36)، [internalMailService.ts](./server/services/internalMailService.ts#L25)، [wallService.ts](./server/services/wallService.ts#L127)، [userRepository.ts](./server/services/userRepository.ts#L110).

**هل يمكن أن يشترك حسابان في قناة واحدة؟** نعم: إذا اتصل حسابان من مجموعة `idreg` مكررة، ينضم كلاهما إلى `user:<idreg>` نفسها. كذلك قد تتصادم قيمة username أو idreg مع قيمة users.id لأن الغرفة لا تحمل نوع المفتاح. لم يُثبت في هذه المراجعة ناشر حدث PM يرسل إلى `user:<idreg>` تحديدًا، لذلك لا ننسب تسريب PM إلى هذا التصادم. حدث حساس موجّه إلى اسم غرفة مطابق قد يصل إلى المشتركين الاثنين؛ هذه مخاطرة توجيه، لا قياس تسليم حي.

## 7. خريطة الهوية النهائية المقترحة

```text
users.id           = الهوية الداخلية الوحيدة للعلاقات والتوجيه
users.username     = معرّف تسجيل دخول خاص
users.display_name = اسم عرض قابل للتكرار، ما لم يعتمد المنتج صراحة تفرده
users.mention_name = معرّف منشن مستقل وفريد
users.public_user_id = معرف بحث/عرض عام ثابت، لا يستخدم للمصادقة أو العلاقات
uid / idreg        = توافق قديم محدود؛ لا تخمين عند الالتباس
```

توصية التصميم: استعمل `users.id` من JWT موثوق إلى persistence والرسائل والغرف والإشعارات، ولا تمرر معرفات غرف من العميل. عند قبول مفتاح توافق قديم، افحص عدد المطابقات؛ اقبل فقط مطابقة واحدة موثقة، وارفض الصفر أو تعدد النتائج. لا تغيّر المعرفات أو الملكية التاريخية آليًا. عند عدم القدرة على حل القيمة القديمة، اطلب معرفًا بديلًا بدل `LIMIT 1`.

قنوات Socket المستقبلية يجب أن تستخدم صيغة داخلية واحدة مبنية على `users.id` مثل `user:<users.id>` فقط؛ يُحذف الانضمام القديم تدريجيًا بخطة إصدار/توافق حتى لا تبقى اتصالات قديمة وجديدة في مساحة الأسماء نفسها. لا يسمح للعميل باختيار هذا المعرف: يؤخذ من جلسة موقعة، ثم يتحقق الخادم من الحساب وحالته قبل ضم socket.

## 8. قرار `display_name` والاسم العام والمنشن

يجب التمييز بين ثلاثة مفاهيم:

1. **الاسم الرئيسي الظاهر:** وصف قابل للقراءة في البروفايل؛ تكراره قد يكون مقبولًا اجتماعيًا.
2. **الاسم العام الفريد:** قيمة بحث/تمييز تحل إلى حساب واحد؛ تتطلب قيد تفرد، وقواعد تغيير وحجز.
3. **اسم المنشن:** مقبض فريد يكتب بعد `@` ويوجه إلى حساب واحد.

لا توجد أدلة منتج تحسم أن الاسم الرئيسي يجب أن يكون فريدًا. لذلك لا أوصي بفرض التفرد على `display_name` دون موافقة صاحب المنتج. أوصي مبدئيًا بأن يبقى اسم العرض قابلاً للتكرار وأن يكون `mention_name` هو المرجع الوحيد لتوجيه `@mentions`، مع عرض حقول الواجهة بعناوين صريحة. لا يُعرض `@display_name` إذا لم يكن هو مقبض المنشن.

### اختبار التصادم المطلوب

```text
Account A: display_name = jems
Account B: mention_name = jems
```

إذا كانت نتائج الدليل تعرض `jems` للحساب A، بينما يفسر محرر الرسالة `@jems` على أنه الحساب B، فالمستخدم قد يختار الشخص الخطأ. **فصل واجهتي البحث وحده لا يزيل الالتباس.**

يوجد خياران متسقان:

- جعل `display_name` الاسم العام الفريد ذاته، مع مساحة أسماء مشتركة وحجز يمنع أن يطالب حساب آخر بـ `jems` كـ `mention_name`. هذا يفرض تفرد الاسم الرئيسي وقد يكون قيدًا غير مطلوب.
- الإبقاء على `display_name` اسم عرض غير موجّه وغير فريد، وجعل `mention_name` المعرّف الوحيد القابل للتوجيه؛ يجب عدم حل النص العادي إلى حساب واحد. إذا كان شرط المنتج أن القيمة العامة نفسها لا يمكن أن تعني حسابين في أي سياق، فلابد من حجز عالمي مشترك أو قرار بأن الاسم العام نفسه فريد. لا يمكن تحقيق الشرط مع أسماء عرض مكررة وmentions مستقلة بلا سياسة تمييز.

يظل القرار النهائي مفتوحًا لاعتماد المنتج. لا يوجد عمود alias جديد مقترح.

### سياسة `mention_name` المقترحة

| خيار الأبجدية | سهولة الاستخدام والبحث | التفرد والتشابه البصري | توافق التنفيذ |
|---|---|---|---|
| ASCII lowercase + أرقام وفاصل | الأسهل تنفيذًا وبحثًا، لكنه يستبعد أسماء عربية | بسيط نسبيًا؛ لا يمنع كل التباس بين الأرقام والحروف | سهل التطبيق في Node.js وPostgreSQL |
| عربي/لاتيني/أرقام | يراعي المستخدم العربي مع دعم اللاتينية | يحتاج قواعد تمنع أو تضبط مزج الكتابات والتشكيل ومحارف الاتجاه | يتطلب تطبيعًا موحدًا وفحصًا على الخادم وقيدًا مكافئًا في قاعدة البيانات |
| Unicode واسع مع تطبيع صارم | أكبر شمولًا | أعلى خطرًا من homographs والمحارف غير المرئية والتشابه بين أنظمة الكتابة | يجب تثبيت إصدار Unicode وقواعد canonicalization وتجنب الاعتماد على `lower()`/collation غير متطابقين |

التوصية المعمارية: حقل مستقل؛ لا يُشتق من username؛ يُحل المنشن إلى `users.id` قبل التخزين؛ يُحفظ المستهدف كهوية لا كسلسلة يعاد تفسيرها لاحقًا. ضع حدًا للطول وقواعد المحارف والأسماء المحجوزة بعد قرار المنتج. إن اختير Unicode، يجب توحيد NFKC وcasefold في التطبيق والتخزين، ورفض محارف التحكم/الاتجاه غير المسموحة، واختبار NFC/NFD وconfusables، ورفض التصادم بدل تبديل الاسم تلقائيًا. لا تُحسم هنا اللغة أو الطول.

**حجز الأسماء القديمة:** الأفضل منع إعادة توجيه إشارات قديمة لشخص جديد؛ يمكن إبقاء سجل تاريخي `normalized_name -> users.id` أو حجز مؤقت/دائم. الحجز الدائم يمنع الانتحال لكنه يقلل الأسماء المتاحة ويحتفظ ببيانات تعريفية بعد التغيير/الحذف؛ فترة الانتظار تقلل التعارض لكن لا تمنع انتحالًا لاحقًا. يلزم قرار retention وحذف خصوصية. لا حاجة إلى جدول منفصل إذا اقتصرت uniqueness على حقل واحد وفرضها index مناسب؛ أما منع التصادم عبر `display_name` و`mention_name` فيحتاج مساحة حجز مشتركة أو آلية قاعدة بيانات مكافئة، وتكلفته مزامنة ذرية وسجل تاريخي.

## 9. المصالحة الأولية لـ `topic` و`display_name`

المصفوفة التالية من تقرير القراءة السابق؛ لا تحتوي أسماء أو معرفات. لا توجد قراءة جديدة للبيانات في هذه المهمة.

| الحساب الرمزي | طول `topic` | طول `display_name` | المقارنة بعد trim/lower وNFKC/casefold | التصنيف المدعوم | الإجراء |
|---|---:|---:|---|---|---|
| A | 4 | 4 | يتساويان بعد trim/lower؛ لم يثبت أن الفرق الوحيد حالة أحرف فقط | فرق تطبيع/حالة أحرف مرجح | لا مزامنة آلية |
| B | 4 | 5 | يبقى اختلاف بعد التطبيع | اختلاف فعلي بالقيم المخزنة، منشؤه غير محسوم | قرار بشري |
| C | 5 | 10 | يبقى اختلاف بعد التطبيع | اختلاف فعلي بالقيم المخزنة، منشؤه غير محسوم | قرار بشري |
| D | 8 | 6 | يبقى اختلاف بعد التطبيع | اختلاف فعلي بالقيم المخزنة، منشؤه غير محسوم | قرار بشري |

بحسب التقرير السابق، لم توجد قيمة `NULL` أو فارغة بين الحسابات الـ17، وأطول قيمة مرصودة 17 حرفًا؛ لا يثبت ذلك صلاحية الأسماء وفق سياسة مستقبلية أو عدم وجود تصادمات جديدة. لا توجد أدلة كافية لتصنيف B–D كتاريخية، ولا تُنفذ مزامنة `UPDATE users SET display_name = topic` أو اقتطاع/استبدال. يلزم preflight جديد، ومراجعة بشرية، وحفظ القيم السابقة حسب `users.id`، ثم قيد uniqueness وفق قرار المنتج، مع rollback يعيد القيم للحساب نفسه فقط. المرجع التفصيلي: [مصفوفة A–D السابقة](./FINAL_IDENTITY_DESIGN_CLOSURE_EVIDENCE_REPORT.md#L96).

## 10. `public_user_id`

المواصفة مقترحة فقط؛ لم ينشأ العمود ولم تُولد قيم:

- أبجدية 31 رمزًا: `23456789ABCDEFGHJKMNPQRSTUVWXYZ`.
- `31^12 = 787,662,783,788,549,761` احتمالًا.
- الطول 12 رمزًا تمامًا، وتخزين `varchar(12)` أوضح من `character(12)` لتجنب padding.
- توليد خادمي بمصدر عشوائية تشفيري واختيار موحد مثل `crypto.randomInt(0, 31)` لكل رمز؛ لا تستخدم `randomByte % 31` لاحتمال modulo bias.
- `UNIQUE` و`CHECK` للطول والأبجدية، مع محاولات تصادم محدودة وفشل صريح بعد حد المحاولات.
- عدم التغيير وعدم إعادة الاستخدام يحتاجان حجزًا دائمًا أو tombstone؛ `UNIQUE` وحده لا يمنع إعادة الاستخدام بعد حذف الصف.
- Backfill مرة واحدة لكل `users.id`، قابل للاستئناف بحيث لا تتغير القيم الموجودة عند إعادة التشغيل.
- لا يستخدم للتوثيق أو كسر صلاحيات، ولا يحل محل `users.id` في العلاقات الداخلية.

## 11. البحث والمصادقة والجلسات

| المسار/الخدمة | الملاحظة الساكنة | ما يلزم لإغلاق الخطر |
|---|---|---|
| `/api/user/search` | لا يظهر فحص مصادقة؛ يبحث بـ `username/topic` ويرجع `id, username, topic, pic, role`: [search.get.ts](./server/routes/api/user/search.get.ts#L4) | إبقاء البحث العام فقط بحقول عامة محددة؛ منع تعداد username/role والمعرفات الداخلية |
| `/api/users/search` | يتحقق من التوقيع محليًا مع fallback secret ولا يظهر فحص `exp`؛ يرجع `username/id/idreg`: [search.get.ts](./server/routes/api/users/search.get.ts#L6)، [search.get.ts](./server/routes/api/users/search.get.ts#L33) | verifier موحد، exp، وحقول مصرح بها حسب كون المسار عامًا/خاصًا |
| `/api/user/profile-check` | verifier محلي مع fallback ولا يفحص `exp`؛ يعيد `allUserIds` إلى جانب سجل الحساب: [profile-check.get.ts](./server/routes/api/user/profile-check.get.ts#L5)، [profile-check.get.ts](./server/routes/api/user/profile-check.get.ts#L40) | قصر الرد على بيانات الحساب المخول، حذف تعداد المعرفات |
| `/api/auth/me` | verifier محلي وفallback، مع فحص `exp`؛ يعيد دورًا فعليًا محسوبًا من خدمات الصلاحيات لكن يرجع fallback إلى claim: [me.get.ts](./server/routes/api/auth/me.get.ts#L6)، [me.get.ts](./server/routes/api/auth/me.get.ts#L31)، [me.get.ts](./server/routes/api/auth/me.get.ts#L39) | توحيد verifier وجعل مصدر الدور موحدًا وموثوقًا |
| `/api/auth/logout` | يأخذ `body.userId` دون تحقق توقيع؛ عند قراءة التوكن يفك payload دون التحقق من التوقيع، ثم يقطع الجلسات المرتبطة بالمعرف: [logout.post.ts](./server/routes/api/auth/logout.post.ts#L10)، [logout.post.ts](./server/routes/api/auth/logout.post.ts#L25) | ربط logout بهوية موثقة، ومنع استهداف حساب آخر |
| `authService` | يصدر `sub=user.id` ويدمج `role` في JWT؛ `verifyAuthToken` يتحقق توقيعًا و`exp`، لكن مدة الرمز الافتراضية 24 ساعة: [authService.ts](./server/services/authService.ts#L94)، [authService.ts](./server/services/authService.ts#L150) | استخدامه عبر كل المسارات بدل تحقق مكرر؛ إبطال/نسخة جلسة موثقة وتحديث رتبة الحساب |
| `adminAccess` | يتحقق من توقيع و`exp`، لكنه verifier منفصل ويقرأ role من claims: [adminAccess.ts](./server/services/adminAccess.ts#L22)، [adminAccess.ts](./server/services/adminAccess.ts#L63) | توحيد التحقق ومصدر الصلاحية الحالية |

`authService` يوقف التشغيل الإنتاجي إذا لم يضبط secret صالحًا، لكن مسارات أخرى تحتوي fallback مستقلًا؛ لا يثبت ذلك وحده إمكان تجاوز الحماية في نشر بعينه، بل يثبت أن التنفيذ ليس موحدًا. `getUserAuthContext` يرفض الأنواع الخاصة ويتحقق من exp، لكن يثق role claim. لا يظهر في الأدلة المفحوصة JTI/session-version أو قائمة إبطال مركزية: disconnect عند logout لا يبطل bearer سابقًا، وقد يظل التوكن صالحًا حتى انتهاء صلاحيته أو يعيد الاتصال.

**تعدد الأجهزة والحظر وتغيير الرتبة:** سياسة موحدة غير مثبتة. المطلوب تصميم logout لجهاز واحد/كل الأجهزة، إبطال token عند الحظر أو خفض الرتبة، والتحقق من الحالة/الرتبة الحالية أو نسخة جلسة في كل عملية حساسة. لا يثبت هذا التقرير أن فشل Redis يمنح صلاحية؛ fallback local في محدد المعدل يعني فقط أن سلوك الحد قد يختلف باختلاف النسخ، ولا يغني عن المصادقة: [rateLimiter.ts](./server/middleware/rateLimiter.ts#L64).

## 12. خريطة التنفيذ المستقبلية

هذه ملفات مرشحة لطلب تنفيذ مستقل، وليست ملفات عُدلت في هذه المراجعة:

- PM وتوجيه/حماية المحتوى: [send.post.ts](./server/routes/api/pm/send.post.ts)، [messages.get.ts](./server/routes/api/pm/messages.get.ts)، [conversations.get.ts](./server/routes/api/pm/conversations.get.ts)، [read.post.ts](./server/routes/api/pm/read.post.ts)، [unread.get.ts](./server/routes/api/pm/unread.get.ts)، [user.get.ts](./server/routes/api/pm/user.get.ts)، [privateMessageService.ts](./server/services/privateMessageService.ts)، [privateHandlers.ts](./server/socket/privateHandlers.ts).
- قنوات وبث Socket: [SocketBroker.ts](./server/socket/SocketBroker.ts)، [SocketChannels.ts](./server/socket/SocketChannels.ts)، [SocketGateway.ts](./server/socket/SocketGateway.ts)، [index.ts](./server/socket/index.ts)، و[PrivateChat.tsx](./src/components/chat/PrivateChat.tsx)/[PrivateList.tsx](./src/components/chat/PrivateList.tsx).
- البريد والإشعارات: [send.post.ts](./server/routes/api/mail/send.post.ts)، [mailHandlers.ts](./server/socket/mailHandlers.ts)، [internalMailService.ts](./server/services/internalMailService.ts)، [notificationService.ts](./server/services/notificationService.ts).
- البحث والجلسات: [search.get.ts](./server/routes/api/user/search.get.ts)، [search.get.ts](./server/routes/api/users/search.get.ts)، [profile-check.get.ts](./server/routes/api/user/profile-check.get.ts)، [login.post.ts](./server/routes/api/auth/login.post.ts)، [me.get.ts](./server/routes/api/auth/me.get.ts)، [logout.post.ts](./server/routes/api/auth/logout.post.ts)، [authService.ts](./server/services/authService.ts)، [adminAccess.ts](./server/services/adminAccess.ts).
- الهوية والاسم: [schema.ts](./server/db/schema.ts)، [migrate.ts](./server/db/migrate.ts)، [userRepository.ts](./server/services/userRepository.ts)، [ProfileHeader.tsx](./src/components/profile/ProfileHeader.tsx)، وواجهات البحث/المنشن.

## 13. خطة تحقق مستقبلية معزولة — لم تُشغّل

تُنفذ فقط في طلب منفصل وعلى خادم وقاعدة اختبار معزولين، مع تعطيل egress للخدمات الخارجية، رموز اصطناعية، وعدم استعمال حسابات/رسائل حقيقية:

1. أنشئ A مرسلًا وB مستلمًا وC مراقبًا غير مخول. سجل كل حدث وارد لدى العملاء عبر listener عام (`onAny`) أو التقاط packet على طبقة النقل، لا عبر حالة عرض الواجهة فقط.
2. أرسل A رسالة إلى B؛ اثبت وصول الحمولة إلى كل جهاز B، وعدم ورود `pm:message` أو نص الرسالة لدى C. أضف assertion على جهة الخادم أن event target/الغرف لا تشمل socket الخاص بـ C.
3. اطلب من C الانضمام إلى `user:<B>` أو `social:<B>` عبر بيانات عميل؛ تحقق أن عضوية الغرف لا تتغير. اجعل مصدر room ID الوحيد `socket.data.user.id` بعد التحقق.
4. أعد اتصال B بعد الإرسال؛ تحقق من وجود سجل واحد ثابت المعرف، وتسليم/استعادة صحيحين دون فقد أو تضاعف. اختبر أيضًا حالتي وصول الإقرار المتأخر وfallback REST.
5. وصل جهازين لحساب B وجهازًا لحساب C؛ يجب أن يتلقى الجهازان المعتمدان لـ B الحدث مرة واحدة، وC لا يتلقى أي payload.
6. اختبر `pm:read` و`pm:reaction` و`pm:typing` و`pm:stop_typing`، وتأكد أن كل حدث لا يذهب إلا إلى المشاركين المصرح لهم؛ لا يوجد حدث عام.
7. أرسل معرف مستقبل مزورًا، ومعرف `idreg` له أكثر من تطابق في fixture؛ يجب رفضه بلا رسالة/تغيير ملكية، لا اختيار صف عبر ترتيب غير محدد.
8. استدعِ واجهات PM المستمرة بمعرف محادثة ليس C طرفًا فيه؛ يجب رفضها وعدم إرجاع body أو تغيير read state.
9. اختبر token منتهيًا، token موقعًا بـ fallback، تغيير رتبة/حظر مع token سابق، logout بمعرف مستخدم آخر، وجلسات متعددة؛ جميعها على mocks/fixtures.
10. اختبر نتائج البحث العامة، NFKC/NFC/casefold، collisions بين `display_name` و`mention_name` وفق السياسة التي يعتمدها المنتج، وثبات `public_user_id` عند تغيير الأسماء.

لم تُشغّل هذه الاختبارات هنا، ولم تُكتب بيانات اختبار.

## 14. معايير القبول قبل الإغلاق

- حذف البث العام لأي حمولة PM أو بريد داخلي، مع اختبار على مستوى socket يثبت عدم وصول أي packet إلى C.
- جميع قراءة/تغيير محادثة PM تتحقق على الخادم من هوية JWT والعضوية باستخدام `users.id`، لا معرف مستخدم يختاره العميل.
- كل PM/notification/mail join يستخدم مفاتيح علاقات موحدة ومحددة، ورفض صريح للمعرف القديم الملتبس.
- قنوات المستخدم تعتمد هوية موثوقة واحدة ولا تضم `username` أو `idreg`.
- لا تحتوي سجلات التشغيل على جسم الرسالة أو بيانات حساسة.
- البحث العام لا يعيد username أو role أو `users.id` أو `uid/idreg/allUserIds` دون ضرورة عامة موثقة؛ البحث الخاص مصادق ومفوض.
- verifier مركزي، secrets الافتراضية غير مقبولة، جميع المسارات ترفض token منتهيًا، والرتبة/الحظر والإبطال تطبق وفق سياسة جلسات معتمدة.
- قرار المنتج يحدد هل `display_name` فريد أم قابل للتكرار، ويحدد مساحة التصادم مع `mention_name` قبل أي قيد/ترحيل.
- لا يفقد التوافق القديم القيم أو الملكية؛ اختلافات A–D تُحسم بقرار بشري، مع preflight ونسخة/rollback معتمدين.
- `public_user_id`، إن اعتمد، يطابق صيغة 12 رمزًا ويكون فريدًا وثابتًا وغير قابل لإعادة الاستخدام، ولا يدخل في العلاقات الداخلية.

## 15. سجل الموانع المفتوحة

| الأولوية | المانع | الحالة |
|---|---|---|
| P0 | بث محتوى PM عالميًا عبر REST | مثبت ساكنًا؛ لا يوجد إثبات runtime |
| P0 | قراءة PM المستمرة بلا تفويض عضوية ظاهر | مثبت ساكنًا؛ لا يوجد اختبار وصول |
| P0 | بحث عام يعيد username وrole ومعرفات داخلية | مثبت ساكنًا |
| P0 | بريد داخلي REST بلا تحقق مصادقة ظاهر وبث عالمي | مثبت ساكنًا |
| P1 | حل معرفات legacy بـ `LIMIT 1` مع `idreg` مكرر | مثبت بالشيفرة ونتيجة التقرير السابق |
| P1 | قنوات `user:<idreg>` و`user:<username>` والمساحة غير المميزة | مثبت بالشيفرة؛ أثر الحدث الحساس بعينه غير مثبت |
| P1 | verifier غير موحد، fallback secrets، وفحص `exp` غير متسق | مثبت بالشيفرة؛ قابلية الوصول مرتبطة ببيئة النشر |
| P1 | logout يقبل معرفًا يقدمه العميل ولا يبطل token مركزيًا | مثبت بالشيفرة |
| P1 | معاينة المحادثات تسجل نص الرسالة | مثبت بالشيفرة؛ وصول السجلات غير مفحوص |
| P2 | قرار تفرد `display_name` ومساحة التصادم مع المنشن | يحتاج قرار المنتج |
| P2 | قواعد Unicode/العربية والطول والحجز التاريخي لـ `mention_name` | توصية فقط؛ غير معتمد |
| P2 | إنشاء `public_user_id` | مواصفة مقترحة فقط؛ لا عمود/بيانات |
| P2 | مصالحة `topic`/`display_name` والحالات A–D | غير محسومة؛ لا مزامنة مأذونة |

## 16. الحالة النهائية

```text
STRICT_READ_ONLY: TRUE
CODE_CHANGES: NONE
MIGRATIONS_CREATED: NONE
MIGRATIONS_APPLIED: NONE
DATABASE_WRITES: NONE
PRODUCTION_WRITES: NONE
TEST_DATA_WRITES: NONE
FINANCIAL_OPERATIONS: NONE
DEPLOYMENTS: NONE
EXECUTION_AUTHORIZATION: NOT_GRANTED
WAITING_FOR_USER_EXPLICIT_APPROVAL: TRUE
FINAL_STATUS: PARTIAL
```

لا يُعلن إغلاق أمني أو جاهزية تنفيذ. التقرير يعتمد على شيفرة العمل الحالية ونتائج القراءة السابقة المحددة، ويظل أي تحقق حي أو إصلاح أو migration طلبًا منفصلًا يحتاج تفويضًا صريحًا.
