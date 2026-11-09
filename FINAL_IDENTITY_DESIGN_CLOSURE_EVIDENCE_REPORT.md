# FINAL IDENTITY DESIGN CLOSURE EVIDENCE REPORT — Hobi

**الحالة:** `PARTIAL — STRICT_READ_ONLY — WAITING_FOR_USER_EXPLICIT_APPROVAL`
**النطاق:** فحص الأدلة المتاحة وتصميم الإغلاق فقط. لم تُجرَ أي كتابة على قاعدة البيانات، ولم يُعدّل أي كود أو ترحيل.
**قاعدة البيانات التي شملها فحص البيانات:** الاتصال المحلي الحالي بقاعدة `chat_app`، مخطط `public`، PostgreSQL `18.4`. لا يثبت هذا التقرير حالة أي بيئة أخرى. لم تُعرض بيانات اعتماد أو أسماء أو معرفات حسابات.

## 1. الخلاصة التنفيذية

| المحور | النتيجة الحالية | قرار التصميم المقترح | الحالة |
|---|---|---|---|
| الاسم المستعار | أربعة اختلافات بين `topic` و`display_name` من أصل 17 حسابًا؛ لا يوجد قيد تفرد مناسب لـ `display_name` | اعتماد `users.display_name` مصدرًا وحيدًا للاسم الظاهر والاسم المستعار العام الفريد | غير مغلق: يلزم حسم الحالات والفرض بقاعدة البيانات |
| `mention_name` | الحقل غير ظاهر في مخطط `users` الحالي | حقل مستقل، مع حجز موحد يمنع تصادمه مع أي اسم مستعار لحساب آخر | غير مطبق |
| `idreg` | ست مجموعات مكررة، في كل منها حسابان | لا يُستخدم لتوجيه داخلي؛ رفض القيمة الملتبسة وطلب معرف بديل | خطر قائم |
| `uid` | 17 قيمة مملوءة ومتميزة في العينة الحالية، دون قيد تفرد مثبت | معرف توافق قديم فقط؛ ليس مرجع العلاقات الجديد | غير مضمون بقاعدة البيانات |
| `users.id` | المفتاح الأساسي الحالي | المرجع الداخلي الوحيد للعلاقات والتوجيه الجديد | قرار تصميمي؛ يلزم ترحيل توافق |
| البحث العام | `/api/user/search` عام ويعيد حقولًا داخلية، ومنها الدور | الإبقاء على البحث العام مع قائمة حقول عامة محدودة؛ فصل البحث الخاص المحمي | **P0 مفتوح** |
| JWT والجلسات | مسارات تحقق مكررة، أسرار افتراضية في بعض المسارات، وتسجيل خروج لا يبطل JWT | محقق مركزي، مصدر صلاحية آني/نسخة جلسة، وإبطال موثق | غير مغلق |
| `public_user_id` | لا يوجد في المخطط الحالي | 12 رمزًا، ثابت وفريد وغير قابل لإعادة الاستخدام، للبحث/العرض العام فقط | مواصفة مقترحة فقط |

لا يمكن إعلان جاهزية التنفيذ أو استخدام `CLOSED`: تفرد الاسم المستعار غير مفروض، والتعارضات لم تُحسم، والتوجيه بـ `idreg` المكرر قائم، وتسريب البحث العام وجلسات JWT غير محسومين.

## 2. منهج الأدلة وحدودها

- فُحصت الشيفرة مباشرة، مع قراءة Graphify كوسيلة مساعدة. لم يُعتمد على Graphify لإثبات علاقة لم تؤكدها الشيفرة.
- استعلامات قاعدة البيانات كانت قراءة فقط، وجُمعت نتائج الأسماء بأحرف رمزية `A–D` دون إظهار قيم أو معرفات. لا تُعد النتيجة لقطة البيانات الحالية دليلًا تاريخيًا أو ضمانًا للمستقبل.
- لا تُثبت قراءة الشيفرة وحدها أن مسارًا استُغل فعليًا أو ما الذي شاهده مستخدم في متصفح حي. التقرير يميز بين سلوك الشيفرة والخطر الممكن والأثر الذي لم يُختبر.
- روابط ملفات الشيفرة أدناه تشير إلى مواضع الدليل؛ والمقتطفات وصفية وليست إثباتًا لبيانات تاريخية غير موجودة.

## 3. قرار الاسم المستعار العام

### القرار المقترح

اعتماد `users.display_name` بوصفه **الاسم الرئيسي الظاهر والاسم المستعار العام الفريد نفسه**. لا توجد قيمة ثانية منافسة للاسم العام، ولا يُنشأ عمود alias إضافي. بعد التوافق، يصبح `users.topic` حقلًا قديمًا للقراءة/التوافق فقط ثم يُوقف اعتماده، ولا يظل مصدرًا بديلًا للاسم.

هذا القرار يجعل أسماء البروفايل الرئيسية فريدة أيضًا؛ فهو لا يفترض أن `display_name` مجرد اسم مرئي قابل للتكرار. يجب أن يفرض التخزين التفرد بعد التطبيع وحالة الأحرف، لا أن يعتمد على فحص التطبيق وحده.

### الدليل الحالي

- تعريف `users` يتضمن `username` و`display_name`، ويُعرّف فهرس تفرد لـ `username` فقط؛ لا يظهر فهرس تفرد لـ `display_name`: [schema.ts](./server/db/schema.ts#L132)، [schema.ts](./server/db/schema.ts#L145).
- الترحيل يضيف `topic` وفهارس عادية على `uid` و`idreg` وفهارس غير فريدة على `username/topic` بعد تحويل الأحرف، ولا يفرض تفرد الاسم العام: [migrate.ts](./server/db/migrate.ts#L1378)، [migrate.ts](./server/db/migrate.ts#L2332).
- طبقة البحث العامة تستخدم `username` أو `topic` لا `display_name`: [search.get.ts](./server/routes/api/user/search.get.ts#L4). وخدمة الرسائل الخاصة تعرض `topic` باسم `display_name`: [privateMessageService.ts](./server/services/privateMessageService.ts#L90).
- استعلامات القراءة الحالية على 17 حسابًا وجدت قيم `topic` و`display_name` غير فارغة، وأطوالها ضمن حد `display_name` الحالي البالغ 120 حرفًا. لم يظهر تصادم بين قيم `display_name` بعد فحص NFKC/casefold في هذه اللقطة؛ لكن قاعدة البيانات لا تفرضه. **هذا يثبت حالة العينة فقط، لا التفرد المستقبلي.**

### آلية الإنفاذ المطلوبة

1. اعتماد تطبيع واحد محدد الإصدار: إزالة المسافات الطرفية، NFKC، ثم Unicode casefold. تُعامل القيمة بعده كهوية الاسم المحجوزة.
2. فرض التفرد في قاعدة البيانات، لا بفحص ثم إدراج منفصل قابل لسباق التزامن.
3. استخدام سجل حجز أسماء موحد بمفتاح تطبيع فريد ومرجع `users.id`، يغطي الاسمين العامين: `display_name` و`mention_name`. تُحدّث الحجوزات في معاملة واحدة مع الحقول؛ رفض التصادم من قيد قاعدة البيانات.
4. جعل تغيير الاسم وإلغاء حجزه خاضعًا لسياسة تاريخية؛ لا يُحرر الاسم السابق لإعادة استخدامه تلقائيًا.
5. لا يضيف سجل الحجز عمود alias جديدًا إلى `users`. يلزم تصميم التنفيذ بحيث لا يمكن أن تنحرف الحجوزات عن حقول الحساب، ويفضل إنفاذ المزامنة من قاعدة البيانات.

**الحالة:** القرار تصميم مقترح؛ لا يوجد حاليًا إثبات على قيد تفرد مناسب أو سجل الحجز. لا تُعلن خاصية التفرد مغلقة قبل إنشاء القيود والتحقق منها في طلب تنفيذ منفصل.

## 4. سياسة alias وmention_name ومنع الالتباس

### العرض النهائي المقترح في الواجهات

| عنصر البروفايل | الحقل | العرض |
|---|---|---|
| الاسم الرئيسي | `display_name` | نص الاسم دون `@`، مع وصف واجهة «الاسم العام» |
| الاسم المستعار العام | `display_name` نفسه | لا يُكرر كسطر ثانٍ؛ هو الاسم العام الفريد |
| اسم المنشن | `mention_name` | `@` مع تسمية ظاهرة «اسم المنشن» |
| معرف الحساب العام | `public_user_id` | حقل منفصل بعنوان «معرّف الحساب العام»، دون `@` |

حاليًا يعرض `ProfileHeader` الاسم من `displayName` ثم `username`، ويبني handle آخرًا من `username` أو `id`، ما قد يعرض قيمتين غير مميزتين وظيفيًا: [ProfileHeader.tsx](./src/components/profile/ProfileHeader.tsx#L26). واجهة البروفايل لا تثبت وجود `mention_name` حاليًا.

### منع تصادم الاسم العام والمنشن

يجب أن تكون هناك مساحة أسماء عالمية واحدة بعد التطبيع؛ لا يكفي أن يكون لكل عمود فهرس تفرد مستقل.

في الحالة المطلوبة:

```text
الحساب A: display_name = jems
الحساب B: mention_name = jems
```

يرفض سجل الحجز الموحد مطالبة الحساب B بالقيمة `jems` ما دامت محجوزة للحساب A. وبذلك لا يمكن أن يشير `@jems` إلى حساب مختلف عمن يقصده الدليل عند رؤية الاسم `jems`. تُعرض قيمة الاسم العام دون `@`، وقيمة المنشن فقط مع `@` وتسمية «اسم المنشن»، ويُحل المنشن إلى `users.id`.

**الوضع الحالي:** لا يوجد `mention_name` في تعريف `users` المعروض في [schema.ts](./server/db/schema.ts#L128)، ولا يمكن إثبات غياب التصادم بينه وبين أسماء الحسابات من بيانات اليوم.

### مواصفة mention_name المقترحة

- حقل مستقل وفريد؛ لا يُشتق من `username` ولا يُكشف اسم الدخول.
- اقتراح قواعد قابلة للتنفيذ: أحرف ASCII صغيرة `a-z` وأرقام `0-9` وشرطة سفلية `_`، بطول 3–24؛ رفض المسافات و`@` في القيمة المخزنة، وأسماء النظام والمحجوزة.
- تُوحّد حالة الأحرف إلى lowercase، مع trim والتحقق من الطول والأبجدية عند الخادم، وتُفرض قيمة الحجز الفريدة في قاعدة البيانات. إذا تقرر دعم Unicode لاحقًا، يلزم قرار منفصل حول التشابه البصري والـ confusables.
- المنشنات الجديدة تُحل عند الإرسال إلى `users.id` وتُخزن الإشارة إلى الحساب، لا مجرد سلسلة قابلة لإعادة التوجيه.
- عند قراءة رسالة قديمة، يُعرض اسم المنشن الحالي للحساب المرتبط بالـ ID، مع الاحتفاظ بلقطة الاسم وقت الإرسال كسياق تاريخي عند الحاجة. لا يعاد تفسير نصوص الرسائل القديمة لتوجيهها إلى مالك جديد.
- تُحجز الأسماء المتقاعدة ولا يعاد استخدامها؛ فهذا يمنع انتحال الحساب السابق، مع إبقاء سجل الحساب/الحجز وفق سياسة حذف وحفظ معتمدة.
- تغيير الاسم يكون بتغيير محكوم ومحدود المعدل، مع الاحتفاظ بالتاريخ؛ لا تُحوّل الإشارات القديمة إلى حساب آخر.

**الحالة:** تصميم مقترح، ولا يوجد دليل على سياسة أو حقل أو مخطط ترحيل منفذ.

## 5. مصفوفة اختلافات التهيئة الأولية

الجدول التالي لا يكشف قيمًا أو معرفات. الأطوال المرصودة هي أطوال القيم الخام كما رُصدت في الاستعلام. مصدر القيم التاريخي غير مثبت.

| الحساب الرمزي | طول `topic` | طول `display_name` | نتيجة المقارنة بعد trim/lower وNFKC/casefold | التصنيف المدعوم | الإجراء |
|---|---:|---:|---|---|---|
| A | 4 | 4 | يتساويان بعد trim/lower؛ لم يثبت أن الفرق الوحيد حالة أحرف دون أثر Unicode إضافي | اختلاف تطبيع/حالة أحرف مرجح؛ لا اختلاف هوية مثبت | لا مزامنة آلية؛ قرار واجهة حول الشكل المرئي قبل توحيد القراءات |
| B | 4 | 5 | يبقى اختلاف غير مطابق بعد التطبيع | اختلاف فعلي بالقيمة المخزنة؛ دلالته ومنشؤه غير محسومين | قرار بشري |
| C | 5 | 10 | يبقى اختلاف غير مطابق بعد التطبيع | اختلاف فعلي بالقيمة المخزنة؛ دلالته ومنشؤه غير محسومين | قرار بشري |
| D | 8 | 6 | يبقى اختلاف غير مطابق بعد التطبيع | اختلاف فعلي بالقيمة المخزنة؛ دلالته ومنشؤه غير محسومين | قرار بشري |

- لم يظهر `NULL` أو نص فارغ في `topic` أو `display_name` ضمن الـ17 حسابًا المفحوصة. أطول قيمة مرصودة 17 حرفًا، وهي ضمن الحد المقترح حاليًا. **صلاحية القيمة دلاليًا أو وفق قواعد أسماء مستقبلية لم تُثبت**.
- لا توجد أدلة كافية لتصنيف أي من B–D على أنه «قيمة تاريخية»؛ لا يُستنتج تاريخ التعديل من اختلاف الحقلين. A فقط متساوٍ بعد التطبيع المرصود.
- لا تُنفذ `UPDATE users SET display_name = topic ...` أو اقتطاعًا أو استبدالًا تلقائيًا. اعتماد `display_name` يعني الحفاظ على قيمته الحالية في الحالات غير المحسومة، إلى أن يُتخذ قرار موثق؛ ولا يُمحى `topic` القديم في عملية التوافق.
- قبل الترحيل المستقبلي: تصدير قائمة اختلافات غير كاشفة للمراجعة، نسخ القيم القديمة في سجل تاريخي مرتبط بـ `users.id`، فحص التصادمات بعد التطبيع، ثم رفض أي تصادم بدل تخمين القيمة. تُحفظ نسخة النسخ الاحتياطي وخطة التراجع المعتمدة قبل الكتابة.
- خطة التراجع المقترحة: معاملة للقيود والحجوزات، وإيقاف الترحيل عند أي تصادم؛ إعادة الحقول إلى القيم المحفوظة فقط ضمن إجراء مراجَع. لا تُستعاد هوية حساب من `topic/display_name` إذا لم يمكن ربطها بـ `users.id` بصورة قطعية.

**ما لم يثبت:** أن اختلاف B–D ناتج عن خطأ، أو عن تاريخ أو رغبة المستخدم؛ أو أن الأحرف والتطبيع المقترحين صالحان لكل أسماء المنتج.

## 6. `idreg` و`uid` و`users.id`

### المرجعية المقترحة

- `users.id`: المرجع الداخلي الأساسي والثابت للعلاقات الجديدة، والمفتاح الأساسي المعرّف في المخطط: [schema.ts](./server/db/schema.ts#L128).
- `users.username`: معرّف دخول خاص فقط، لا يظهر في البحث العام ولا يستخدم كمعرف توجيه عام.
- `uid`: قيمة توافق قديمة يستخدمها عدد من المسارات، وليست أساس علاقات جديدة.
- `idreg`: رقم قديم قابل للعرض والتوافق فقط؛ لا يحدد حسابًا داخليًا إذا لم يكن فريدًا.
- `public_user_id`: معرف عام ثابت للبحث الخارجي فقط، ويُحوّله الخادم إلى `users.id` عند الحد الخارجي؛ لا يستخدم كمفتاح أجنبي جديد أو في الرسائل/الإشعارات الداخلية.

### نتيجة بيانات القراءة فقط

- وُجدت **ست مجموعات مكررة من `idreg`، كل مجموعة تضم حسابين** (ست قيم متعارضة/ستة صفوف زائدة على التفرد). لذلك لا يمكن حل هذه القيم القديمة إلى حساب واحد بأمان.
- كانت قيم `uid` مملوءة ومتميزة بين 17 حسابًا في اللقطة الحالية؛ لا يثبت ذلك وجود قيد `UNIQUE` أو ضمان عدم التكرار مستقبلًا.
- `users.id` هو المفتاح الأساسي. فهارس `users_uid_idx` و`users_idreg_idx` في الترحيل فهارس عادية وليست فريدة: [migrate.ts](./server/db/migrate.ts#L2332).
- الترحيل الحالي يملأ `uid` من `id` حين تكون قيمة `uid` فارغة فقط، وينشئ تسلسلًا لـ `idreg` الجديد؛ هذا لا يثبت سلامة القيم الموجودة أو تفردها: [migrate.ts](./server/db/migrate.ts#L1412).

### جرد استعمالات التوجيه والبيانات

| المجال | الاستخدام القائم والدليل | الأثر/الحد |
|---|---|---|
| JWT والمصادقة | الرمز يصدر `sub` من `user.id`، مع `username` و`role`: [authService.ts](./server/services/authService.ts#L94)؛ التحقق المركزي يتطلب `sub`: [authService.ts](./server/services/authService.ts#L187) | التصميم الصحيح لـ JWT هو `sub = users.id`؛ هذا لا يجعل كل المسارات تستعمل المحقق المركزي |
| البحث عن مستخدم/حل مفتاح | `resolveUserKey` يبحث بـ `uid` أو `id` أو `idreg` أو `username` ثم `LIMIT 1`: [privateMessageService.ts](./server/services/privateMessageService.ts#L15) | إذا طابق `idreg` مكرر، اختيار صف واحد غير حتمي وليس سياسة آمنة |
| رسائل خاصة | المعرّف يحوّل إلى `uid` وتُكتب `sender_id/receiver_id` به: [privateMessageService.ts](./server/services/privateMessageService.ts#L27) | الرسائل التاريخية لا تُعاد نسبتها آليًا إذا لم تكن القيمة قابلة للحل بصورة وحيدة |
| إرسال الرسائل | فحص المرسل يقبل `uid/id/idreg/username` مع `LIMIT 1`، ثم يرسل إلى resolver: [send.post.ts](./server/routes/api/pm/send.post.ts#L46) | `idreg` المكرر قابل للوصول إلى حساب غير المقصود |
| قراءة ملف مستخدم للرسائل | `/api/pm/user` يبحث بـ `id/uid/idreg/username` مع `LIMIT 1` ويعيد `id/uid/username`: [user.get.ts](./server/routes/api/pm/user.get.ts#L14) | اختيار ملتبس وتسريب اسم الدخول ومعرفات داخلية |
| قنوات Socket | الانضمام إلى `user:<id>`, و`user:<username>`, و`user:<idreg>`: [SocketChannels.ts](./server/socket/SocketChannels.ts#L14)، ويستدعي Socket gateway هذا الانضمام: [SocketGateway.ts](./server/socket/SocketGateway.ts#L17) | إذا كان للحسابين ذوي `idreg` المتكرر اتصالان موثقان، فكلاهما ينضم إلى `user:<idreg>` نفسها؛ لا يعتمد ذلك على فلترة العميل |
| حل مالك الغرفة | البحث بـ `id/uid/idreg` مع أكثر من شرط ثم تحديد `row`: [roomHandlers.ts](./server/socket/roomHandlers.ts#L306) | لا يوجد رفض صريح عند تعدد النتائج في هذا المسار |
| الملف الشخصي | `profileService` يحل UID وID و`idreg` وبادئة `#`: [profileService.ts](./server/services/profileService.ts#L126) | قيمة مكررة قد تعيد ملفًا غير مقصود إذا استُخدمت كمعرّف بحث |
| الجدار | ربط مؤلف الجدار يسمح بـ `uid` أو `id` أو `idreg` أو username: [wallService.ts](./server/services/wallService.ts#L88) | قد يفشل ربط المؤلف أو يتضاعف حسب البيانات؛ لم يُثبت أثر فعلي على سجل بعينه |
| البريد الداخلي | استعلامات حل وربط المرسل/المستلم تقارن `id/uid/idreg`: [internalMailService.ts](./server/services/internalMailService.ts#L25) | Join على قيمة مكررة قد يربط بيانات إلى أكثر من صف؛ لم يُجر فحص بيانات الرسائل |
| الإشعارات | حل المستخدم واسم الفاعل يقارن `id/uid/idreg`: [notificationService.ts](./server/services/notificationService.ts#L36) | لا يجوز اعتبار هذه المعرفات متكافئة بعد وجود تصادمات |
| البحث الإداري | `/api/users/search` يعيد `idreg` و`username`: [search.get.ts](./server/routes/api/users/search.get.ts#L30) | قيمة داخلية/قديمة مكشوفة في استجابة بحث مصادق عليها |
| العرض والواجهة | قائمة الأعضاء تعرض `idreg` وتستخدم fallback إلى `id`: [MemberList.tsx](./src/components/chat/MemberList.tsx#L407) | عرض المعرف لا يثبت أمان استخدامه في التوجيه |

### أثر التوجيه والسرية

1. **حل خاطئ:** كل مسار يختار `LIMIT 1` عند تلقي قيمة `idreg` مكررة قد يوجه الإجراء إلى أحد الحسابين بلا قاعدة موثوقة. إزالة `LIMIT 1` وحدها غير كافية؛ المطلوب التحقق من عدد المطابقات ورفض الالتباس.
2. **قنوات مشتركة:** إذا اتصل الحسابان ذوا `idreg` المكرر، فسيشتركان في `user:<idreg>` لأن gateway يستدعي الانضمام لكل socket، والدالة تنشئ الغرفة من `idreg`. أي حدث يرسل إلى تلك الغرفة يمكن أن يصل إلى الاثنين. لم يُثبت من هذه القراءة ناشر محدد لحدث حساس إلى كل قناة `user:<idreg>`؛ لذلك خطر الغرفة مشترك ومثبت، لكن تسريب حدث معين عبرها لم يُثبت.
3. **تسريب رسالة خاصة مستقل ومؤكد من سلوك الشيفرة:** مسار الإرسال يستدعي `publishGlobalEvent("pm:message", socketMessage)` ويصفه بأنه بث لكل المتصلين: [send.post.ts](./server/routes/api/pm/send.post.ts#L60). وسيط Socket يرسل الحدث العام إلى `io`/جميع الاتصالات: [SocketBroker.ts](./server/socket/SocketBroker.ts#L38) و[SocketBroker.ts](./server/socket/SocketBroker.ts#L112). فلترة العميل المذكورة في التعليق ليست حاجزًا أمنيًا. هذا **تسريب محتمل لمحتوى PM إلى كل Socket متصل عند تنفيذ المسار**؛ لم يُنفذ اختبار حي في هذا التدقيق.
4. **الإشعارات والرسائل:** لا توجد أدلة كافية لتأكيد تسليم خاطئ فعلي لمستخدم بعينه؛ لكن استعمال المعرفات المتعددة والـ joins يجعل احتمال الربط الخاطئ واقعيًا. يجب أن تتوقف عمليات الحل الداخلية على `users.id` فقط بعد ترحيل متحكم به.

### خطة توافق للمعرفات القديمة

1. عند مدخل التوافق، ابحث عن كل تطابقات المعرف القديم. اقبل القيمة فقط إذا كان هناك حساب واحد بالضبط؛ إذا كانت صفرًا أو أكثر من واحد، ارفضها برسالة عامة تطلب `users.id` من جلسة المصادقة أو `public_user_id` للبحث الخارجي.
2. لا تختر حسابًا عشوائيًا ولا تستخدم ترتيب قاعدة البيانات كقاعدة حل. علّم سجلات `idreg` المكررة للمعالجة اليدوية؛ لا تعِد ترقيمها أو تنقل ملكيتها تلقائيًا.
3. أثناء مرحلة توافق معلنة، يمكن قراءة `uid` القديم إذا أثبت فحص كل طلب تفرد القيمة؛ لا يُستخدم كأساس علاقات جديدة. يضاف قيد تفرد بعد preflight وترحيل سجلاته فقط في تغيير معتمد.
4. تُنقل العلاقات تدريجيًا إلى `users.id` فقط بعد وجود mapping أحادي موثق. تبقى السجلات التاريخية غير القابلة للحل محفوظة ومعلّمة غير قابلة للتوجيه، ولا يُخمن مالكها.
5. يظل `public_user_id` محصورًا في واجهات البحث/العرض العام، مع تحويله خادميًا إلى `users.id`؛ لا يدخل في المفاتيح الأجنبية أو الجداول الداخلية الجديدة.

### جرد الملفات المطابقة لـ `idreg` و`uid`

هذا جرد على مستوى **كل ملف مصدر مطابق** في امتدادات TypeScript/JavaScript/SQL، مع أول موضع مطابق في كل ملف. قد يحتوي الملف على استعمالات إضافية؛ مواضع التوجيه المؤثرة موضحة بالتفصيل في الجدول السابق. ملفات النسخ الاحتياطية وSQL التاريخية أدلة مخطط/توافق وليست إثباتًا لمسار وقت التشغيل.

**ملفات `idreg` — 60 ملفًا:**

- المخطط والترحيل: [schema.ts](./server/db/schema.ts#L151)، [migrate.ts](./server/db/migrate.ts#L1360).
- مسارات الإدارة: [bans.post.ts](./server/routes/api/admin/bans.post.ts#L17)، [bots.get.ts](./server/routes/api/admin/bots.get.ts#L14)، [bots.post.ts](./server/routes/api/admin/bots.post.ts#L22)، [moderation-events.get.ts](./server/routes/api/admin/moderation-events.get.ts#L32)، [rooms.get.ts](./server/routes/api/admin/rooms.get.ts#L47)، [rooms.post.ts](./server/routes/api/admin/rooms.post.ts#L52)، [rooms/[id].get.ts](./server/routes/api/admin/rooms/[id].get.ts#L46)، [rooms/[id].put.ts](./server/routes/api/admin/rooms/[id].put.ts#L47)، [users-search.get.ts](./server/routes/api/admin/users-search.get.ts#L73)، [users.get.ts](./server/routes/api/admin/users.get.ts#L25)، [unverify.post.ts](./server/routes/api/admin/users/unverify.post.ts#L18)، [verify.post.ts](./server/routes/api/admin/users/verify.post.ts#L18).
- مسارات أخرى: [send.post.ts](./server/routes/api/pm/send.post.ts#L49)، [user.get.ts](./server/routes/api/pm/user.get.ts#L20)، [profile.post.ts](./server/routes/api/user/profile.post.ts#L108)، [search.get.ts](./server/routes/api/users/search.get.ts#L38)، [comments/index.post.ts](./server/routes/api/wall/comments/index.post.ts#L47)، [posts.post.ts](./server/routes/api/wall/posts.post.ts#L53).
- الخدمات: [adminPermissions.ts](./server/services/adminPermissions.ts#L62)، [authService.ts](./server/services/authService.ts#L246)، [internalMailService.ts](./server/services/internalMailService.ts#L25)، [notificationService.ts](./server/services/notificationService.ts#L36)، [powersService.ts](./server/services/powersService.ts#L239)، [privateMessageService.ts](./server/services/privateMessageService.ts#L12)، [profileService.ts](./server/services/profileService.ts#L39)، [userProfileDefaults.ts](./server/services/userProfileDefaults.ts#L11)، [userProfileMapper.ts](./server/services/userProfileMapper.ts#L4)، [userRepository.ts](./server/services/userRepository.ts#L42)، [wallService.ts](./server/services/wallService.ts#L97).
- Socket والحضور: [SocketChannels.ts](./server/socket/SocketChannels.ts#L15)، [index.ts](./server/socket/index.ts#L146)، [presenceHandlers.ts](./server/socket/presenceHandlers.ts#L64)، [presenceManager.ts](./server/socket/presenceManager.ts#L29)، [profileHandlers.ts](./server/socket/profileHandlers.ts#L143)، [roomHandlers.ts](./server/socket/roomHandlers.ts#L116)، [wallHandlers.ts](./server/socket/wallHandlers.ts#L263).
- واجهات العميل: [BanCreateModal.tsx](./src/components/admin/bans/BanCreateModal.tsx#L27)، [constants.ts](./src/components/admin/constants.ts#L3)، [UsersSection.tsx](./src/components/admin/sections/UsersSection.tsx#L38)، [MemberList.tsx](./src/components/chat/MemberList.tsx#L95)، [PrivateList.tsx](./src/components/chat/PrivateList.tsx#L396)، [RoomPage.tsx](./src/components/chat/RoomPage.tsx#L117)، [RoomProfileModal.tsx](./src/components/chat/RoomProfileModal.tsx#L193)، [PresenceEngine.tsx](./src/components/realtime/PresenceEngine.tsx#L338)، [socket.ts](./src/lib/socket.ts#L50).
- اختبارات وأدوات محلية: [auth.test.ts](./tests/auth.test.ts#L57)، [presenceAudience.test.ts](./tests/presenceAudience.test.ts#L41)، [test-idreg.ts](./test-idreg.ts#L10)، [test-users.ts](./test-users.ts#L8)، [vite-socket-io.ts](./vite-socket-io.ts#L231).
- SQL ونسخ قديمة: [create-tables.sql](./create-tables.sql#L3)، [database_backup.sql](./database_backup.sql#L780)، [database_backup_fixed.sql](./database_backup_fixed.sql#L780)، [database_backup_fixed2.sql](./database_backup_fixed2.sql#L780)، [global-chat.postgres.sql](./database/global-chat.postgres.sql#L140)، [legacy-normalized-performance.postgres.sql](./database/legacy-normalized-performance.postgres.sql#L33)، [legacy-safarihost.postgres.sql](./database/legacy-safarihost.postgres.sql#L140)، [legacy-import-mappings.preview.sql](./reports/legacy/legacy-import-mappings.preview.sql#L140).

**ملفات `uid` — 43 ملفًا:**

- المخطط والترحيل: [schema.ts](./server/db/schema.ts#L153)، [migrate.ts](./server/db/migrate.ts#L1375).
- مسارات الإدارة: [bans.post.ts](./server/routes/api/admin/bans.post.ts#L17)، [rooms/[id].get.ts](./server/routes/api/admin/rooms/[id].get.ts#L77)، [rooms/[id].put.ts](./server/routes/api/admin/rooms/[id].put.ts#L47)، [users-search.get.ts](./server/routes/api/admin/users-search.get.ts#L74)، [users.get.ts](./server/routes/api/admin/users.get.ts#L20).
- مسارات أخرى: [send.post.ts](./server/routes/api/pm/send.post.ts#L49)، [user.get.ts](./server/routes/api/pm/user.get.ts#L15)، [profile.post.ts](./server/routes/api/user/profile.post.ts#L108)، [batch-stats.get.ts](./server/routes/api/users/batch-stats.get.ts#L99)، [comments/index.post.ts](./server/routes/api/wall/comments/index.post.ts#L47)، [likes/index.post.ts](./server/routes/api/wall/likes/index.post.ts#L36)، [posts.post.ts](./server/routes/api/wall/posts.post.ts#L53).
- الخدمات: [adminPermissions.ts](./server/services/adminPermissions.ts#L62)، [authService.ts](./server/services/authService.ts#L246)، [internalMailService.ts](./server/services/internalMailService.ts#L25)، [notificationService.ts](./server/services/notificationService.ts#L36)، [powersService.ts](./server/services/powersService.ts#L238)، [privateMessageService.ts](./server/services/privateMessageService.ts#L7)، [profileService.ts](./server/services/profileService.ts#L39)، [userProfileDefaults.ts](./server/services/userProfileDefaults.ts#L13)، [userProfileMapper.ts](./server/services/userProfileMapper.ts#L6)، [userRepository.ts](./server/services/userRepository.ts#L45)، [wallService.ts](./server/services/wallService.ts#L88).
- Socket/التوافق: [index.ts](./server/socket/index.ts#L158)، [privateHandlers.ts](./server/socket/privateHandlers.ts#L113)، [profileHandlers.ts](./server/socket/profileHandlers.ts#L141)، [roomHandlers.ts](./server/socket/roomHandlers.ts#L296)، [wallHandlers.ts](./server/socket/wallHandlers.ts#L100)، [vite-socket-io.ts](./vite-socket-io.ts#L491).
- واجهات العميل: [BanCreateModal.tsx](./src/components/admin/bans/BanCreateModal.tsx#L28)، [constants.ts](./src/components/admin/constants.ts#L46)، [RoomPage.tsx](./src/components/chat/RoomPage.tsx#L152)، [Dashboard.tsx](./src/pages/Dashboard.tsx#L163).
- SQL ونسخ قديمة: [create-tables.sql](./create-tables.sql#L5)، [database_backup.sql](./database_backup.sql#L103)، [database_backup_fixed.sql](./database_backup_fixed.sql#L103)، [database_backup_fixed2.sql](./database_backup_fixed2.sql#L103)، [global-chat.postgres.sql](./database/global-chat.postgres.sql#L135)، [legacy-normalized-performance.postgres.sql](./database/legacy-normalized-performance.postgres.sql#L31)، [legacy-safarihost.postgres.sql](./database/legacy-safarihost.postgres.sql#L135)، [legacy-import-mappings.preview.sql](./reports/legacy/legacy-import-mappings.preview.sql#L137).

## 7. البحث العام، تسجيل الدخول، JWT والجلسات

### المسارات المطلوبة

| المسار | الدليل الحالي | الخطر/التصميم المطلوب |
|---|---|---|
| `/api/user/search` | لا يظهر تحقق مصادقة؛ البحث بـ `username/topic` ويعيد `id, username, topic, pic, role`: [search.get.ts](./server/routes/api/user/search.get.ts#L4) | **P0 مفتوح** حسب التكليف. أبقِ البحث العام إن كان مطلب المنتج، لكن أرجع حقولًا عامة فقط مثل `display_name`, `mention_name`, `public_user_id`, صورة مسموحة. لا تكشف `username` أو `role` أو `users.id/idreg`. |
| `/api/users/search` | يفحص HMAC محليًا، لكنه يستخدم secret افتراضيًا ولا يتحقق من `exp`؛ يعيد `id/username/idreg`: [search.get.ts](./server/routes/api/users/search.get.ts#L6) و[search.get.ts](./server/routes/api/users/search.get.ts#L30) | فصل API خاص موحد التحقق عن العام؛ إزالة الحقول الداخلية من نتائج الجمهور؛ تحقق من النوع والانتهاء وسلطة الجلسة |
| `/api/user/profile-check` | secret افتراضي وفحص توقيع محلي، دون فحص `exp`، ويعيد قائمة `allUserIds`: [profile-check.get.ts](./server/routes/api/user/profile-check.get.ts#L5) و[profile-check.get.ts](./server/routes/api/user/profile-check.get.ts#L25) | إزالة قائمة معرفات كل المستخدمين؛ إعادة بيانات الحساب صاحب الجلسة فقط، مع verifier موحد ورفض المنتهي |
| `/api/auth/login` | يمرر تسجيل الدخول إلى `loginMember`: [login.post.ts](./server/routes/api/auth/login.post.ts#L6) | يجب أن يبقى استجابة الدخول عامة غير كاشفة، مع قيود تعداد ومراقبة محاولات. لا يستنتج هذا الفحص أن مسارات أخرى تستخدم verifier نفسه |
| `/api/auth/me` | secret افتراضي محلي، تحقق توقيع، ثم فحص `exp` غير موحد؛ يعيد `userId/role/permissions`: [me.get.ts](./server/routes/api/auth/me.get.ts#L6) و[me.get.ts](./server/routes/api/auth/me.get.ts#L31) | توحيد verifier، عدم استخدام secret افتراضي، وعدم إرجاع معرف داخلي إلا لسبب واجهة موثق |
| `/api/auth/logout` | يقبل `userId` من body دون تحقق إلزامي من Bearer؛ يقطع sockets بحسب ID ولا يسجل إبطال JWT: [logout.post.ts](./server/routes/api/auth/logout.post.ts#L9) | يجب أن يحدد الحساب من token موثوق، ويبطل الجلسة؛ لا يقبل ID يختاره العميل لتسجيل الخروج من حساب آخر |

### توحيد verifier والسياسات

- لدى `authService` تحقق مركزي يوقع ويتحقق من `sub`, `username`, `role`, و`exp` ويتأكد أن `exp` رقم صالح وغير منتهٍ: [authService.ts](./server/services/authService.ts#L187). لكن المسارات المذكورة تعيد تنفيذ HMAC منفصلًا، وبعضها يتجاوز الانتهاء.
- يوجد fallback تطويري في خدمة المصادقة؛ الخدمة ترفض غيابه/القيمة الافتراضية في production عند تحميلها: [authService.ts](./server/services/authService.ts#L49). رغم ذلك، المسارات المحلية `/api/users/search`, `/api/user/profile-check`, `/api/auth/me` تعرف fallback خاصًا بها. لا تعتمد على حماية غير مباشرة؛ يجب إلغاء fallbacks من مسارات verifier نفسها واستخدام خدمة واحدة تفشل مغلقة.
- `getAdminContext` يتحقق من `exp` لكنه يقرر الصلاحية من role/username الموجودين في JWT: [adminAccess.ts](./server/services/adminAccess.ts#L41). إذا خُفضت رتبة الحساب بعد إصدار الرمز، قد يظل الادعاء القديم مؤثرًا حتى انتهاء الرمز؛ يلزم التحقق من الرتبة الحالية أو `token_version/session_version` عند كل إجراء حساس.
- مدة token الاعتيادية 24 ساعة: [authService.ts](./server/services/authService.ts#L134). هذا يحدد حدًا أعلى لاستمرار token غير المبطل، وليس آلية إبطال.
- لا يظهر في المسارات المفحوصة سجل جلسات/JTI أو إبطال خادمي. `logout` يقطع الاتصال المباشر لكنه لا يجعل bearer token السابق غير صالح؛ لذلك تعدد الجلسات وسلوك إنهاء جهاز واحد/كل الأجهزة غير محدد وغير مفروض بالقاعدة الحالية.
- حد فئة المصادقة مضبوط على 20 طلبًا في الدقيقة، والفشل في Redis يرجع إلى Map محلي لكل عملية: [rateLimiter.ts](./server/middleware/rateLimiter.ts#L8) و[rateLimiter.ts](./server/middleware/rateLimiter.ts#L18) و[rateLimiter.ts](./server/middleware/rateLimiter.ts#L64). هذا لا يغني عن المصادقة، ويختلف فعليًا باختلاف عدد النسخ عند استخدام التخزين المحلي. كما لم يثبت هذا الفحص وحده أن كل المسارات المعنية مغطاة في كل نشر.
- عند إغلاق التعداد: البحث العام لا يحتاج مصادقة إذا كانت استجابته حقولًا عامة فقط؛ البحث الخاص يتطلب مصادقة وتفويضًا. تُطبق حدود معدل مشتركة، وحدود حجم/صفحات، واستجابات موحدة لا تكشف وجود username داخلي.

**التصنيف:** تسريب `/api/user/search` عام وعدم وجود verifier موحد ثغرات مفتوحة؛ لا تُعلن P0 البحث مغلقة. مسار `/api/pm/user` أيضًا يعيد `username/id/uid` من دون تحقق ظاهر في الملف: [user.get.ts](./server/routes/api/pm/user.get.ts#L4).

## 8. `public_user_id`

لا يوجد الحقل في تعريف `users` الحالي: [schema.ts](./server/db/schema.ts#L132). المواصفة التالية **اقتراح غير مطبق**:

- الطول: 12 رمزًا بالضبط، والتخزين `varchar(12)` أفضل من `character(12)` لتجنب الحشو بمسافات.
- أبجدية مقترحة صريحة من 31 رمزًا: `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (الأرقام 2–9، والحروف دون I/L/O).
- مساحة الاحتمالات: `31^12 = 787,662,783,788,549,761`.
- التوليد: مولّد خادمي موثوق ومشفّر عشوائيًا، أخذ عينات غير منحاز مثل اختيار كل رمز باستخدام `crypto.randomInt(0, 31)`، لا `% 31` على بايت عشوائي.
- قيد قاعدة البيانات: `UNIQUE`، و`CHECK` يفرض الطول 12 والأبجدية المحددة.
- عند تصادم الفهرس: إعادة توليد محدودة (مثل 5 محاولات)، ثم إظهار فشل صريح وتسجيله؛ لا حل نجاح صامت ولا حلقة غير منتهية.
- عدم القابلية للتغيير وعدم إعادة الاستخدام: سجل حجز/قيد دائم أو tombstone حتى بعد حذف/تعطيل الحساب؛ قيد `UNIQUE` وحده لا يمنع إعادة الاستخدام إذا حُذف الصف.
- Backfill: توليد مرة واحدة داخل عملية قابلة للاستئناف تحفظ نتيجة كل `users.id`؛ إعادة التشغيل لا تغير المعرفات التي تم تثبيتها. فحص التصادم والـ format قبل اعتماد القيد.
- ليس كلمة مرور أو token أو سرًا للمصادقة، ولا يمنح أي صلاحية؛ هو مفتاح بحث/عرض عام فقط، ويحوّله الخادم إلى `users.id`.

## 9. خطة حفظ البيانات والتراجع

1. لا يكتب هذا التقرير أو أي استعلام أُجري له في قاعدة البيانات. لا توجد مزامنة `topic`/`display_name` ولا توليد معرفات.
2. في تنفيذ مستقل لاحق: نسخة احتياطية حديثة قابلة للاستعادة قبل الكتابة، تقرير preflight غير كاشف، وموافقة بشرية على الحالات التي تحتاج قرارًا.
3. حفظ `topic` و`display_name` القديمين في سجل تغييرات مرتبط بـ `users.id` قبل التغيير؛ لا حذف أو اقتطاع أو استبدال تلقائي.
4. تطبق التغييرات التي تتعلق بالحجز/القيود على دفعات ومعاملات، مع إيقاف فوري عند تصادم. لا تُعدّل الرسائل أو سجلات مالية أو ربط ملكية مبهم ضمن backfill الهوية.
5. التراجع يعيد القيمة المحفوظة لصاحب `users.id` نفسه. لا يستخدم أي معرف مكرر لتحديد صف التراجع.
6. اختبار migration وإعادة تشغيلها يكون على نسخة معزولة؛ لا يشمل هذا التقرير إذن تطبيق أو migration.

## 10. ملفات تتأثر مستقبلًا

هذه خريطة نطاق مستقبلي، وليست قائمة ملفات معدلة:

- **المخطط/الترحيل:** [schema.ts](./server/db/schema.ts#L128)، [migrate.ts](./server/db/migrate.ts#L1372).
- **إنشاء الحساب والجلسات:** [userRepository.ts](./server/services/userRepository.ts#L224)، [authService.ts](./server/services/authService.ts#L94)، مسارات login/me/logout.
- **البحث والبروفايل:** مسارا user search، users search، profile-check، [profileService.ts](./server/services/profileService.ts#L126)، [ProfileHeader.tsx](./src/components/profile/ProfileHeader.tsx#L26).
- **الرسائل الخاصة والبريد والإشعار:** [privateMessageService.ts](./server/services/privateMessageService.ts#L15)، مسارات PM، [internalMailService.ts](./server/services/internalMailService.ts#L25)، [notificationService.ts](./server/services/notificationService.ts#L36).
- **Socket/الحضور والغرف:** [SocketChannels.ts](./server/socket/SocketChannels.ts#L14)، [SocketBroker.ts](./server/socket/SocketBroker.ts#L112)، `roomHandlers.ts`, `presenceHandlers.ts`, `profileHandlers.ts`.
- **الجدار وواجهات الأعضاء:** [wallService.ts](./server/services/wallService.ts#L88)، `MemberList.tsx`, `PrivateList.tsx`, `RoomPage.tsx`، وأي واجهة بحث/ذكر مستخدم.
- يجب أن يتضمن التنفيذ المستقبلي اختبارات خصائص التفرد بعد NFKC/casefold، التصادم بين الحقول، المعرفات القديمة المكررة، رفض القيمة الملتبسة، توجيه الرسائل إلى ID ثابت، صلاحية انتهاء JWT وإبطال الجلسة، وعدم كشف الحقول الداخلية.

## 11. معايير القبول قبل إغلاق التصميم والتنفيذ

- قرار مالك المنتج موثق بأن `display_name` هو الاسم المرئي والـ alias الوحيد، وتُحسم الحالات B–D وأثر حالة A.
- تفرد alias بعد NFKC/casefold مفروض في قاعدة البيانات، بما يشمل السباقات والتغيير.
- لا يمكن أن يمتلك حساب `mention_name` المحجوز نفسه لاسم alias في حساب آخر، والعكس.
- عرض البروفايل يسمي الاسم العام والمنشن ومعرف الحساب بوضوح؛ لا يعرض اسمين بـ `@` دون معنى مميز.
- أي `idreg` أو `uid` قديم يُحل إلى حساب واحد فقط؛ الملتبس مرفوض، ولا تستخدمه العلاقات الجديدة.
- كل مفاتيح العلاقات/الرسائل/الإشعارات الجديدة هي `users.id`، و`public_user_id` للبحث الخارجي فقط.
- حدث PM غير عام، ويثبت اختبار عزل أن غير المرسل/المستقبل لا يتلقى payload.
- نتائج البحث العامة لا تتضمن `username` أو `role` أو معرّفًا داخليًا؛ API الخاص موحد التحقق ومحدود الصلاحيات.
- كل مسارات JWT تستخدم verifier واحدًا، ترفض missing/invalid/expired tokens، ولا تستخدم fallback secret. تغيير الدور والحظر والخروج له آلية إبطال/تحقق آنية موثقة، مع سياسة جلسات متعددة محددة.
- فحص مسبق للتصادمات والقيم الفارغة والطول، وخطة ترحيل قابلة للتراجع، وسجل يحفظ القيم السابقة.
- `public_user_id` يحقق 12 رمزًا، الأبجدية، `UNIQUE/CHECK`، التوليد غير المنحاز، retry محدود، الثبات وعدم إعادة الاستخدام.

## 12. الموانع المفتوحة وترتيبها

| الأولوية | المانع | سبب بقائه مفتوحًا |
|---|---|---|
| **P0** | البحث العام يكشف `username` و`role` و`users.id` | السلوك ظاهر مباشرة في استعلام `/api/user/search`؛ لم يُصلح |
| **P0** | بث `pm:message` إلى كل Socket | مسار الإرسال يستدعي البث العام؛ لم يُنفذ اختبار حي أو إصلاح |
| **P1** | توجيه مبني على `idreg` مكرر وresolver يستخدم `LIMIT 1` | ست مجموعات مكررة فعليًا، مع مسارات حل غير وحيدة |
| **P1** | verifier/secret/expiry غير موحد | عدة routes لها fallback خاص، واثنان على الأقل لا يتحققان من `exp` |
| **P1** | logout لا يبطل bearer token ويقبل `userId` من body | قطع sockets لا يساوي إبطال الجلسة |
| **P1** | دور JWT قديم بعد خفض الرتبة | `getAdminContext` يعتمد على claim حتى انتهاء token |
| **P1** | تفرد alias غير مفروض | لا فهرس أو قيد تفرد على `display_name` |
| **P1** | اختلافات alias الأربعة غير محسومة | B–D اختلافات فعلية بالقيمة؛ المصدر التاريخي/النية غير مثبتين |
| **P2** | `uid` بلا ضمان تفرد مخططي | التميز الحالي لقطة فقط، والفهرس العادي ليس قيدًا |
| **P2** | مواصفة alphabet سابقة غير مكتملة | هذا التقرير يقترح الأبجدية الصريحة أعلاه؛ تنتظر اعتماد المنتج |
| **P2** | سياسة تغير/حجز `mention_name` غير مطبقة | الحقل وسياسة الأسماء المتقاعدة غير موجودين |

## 13. ما لم يُختبر أو يُثبت

- لم تُجرَ اختبارات تشغيل متصفح أو اختبارات استغلال؛ أثر بث PM مستنتج من مسار التنفيذ المباشر وموجه `io`.
- لم تُقرأ أو تُعرض قيم أسماء أو معرفات أو محتوى رسائل؛ مصفوفة A–D مجهولة الهوية.
- لم يُثبت تاريخ تغيير `topic/display_name` أو ما إذا كانت تلك التغييرات مقصودة.
- لم يُثبت وجود مسار آخر لتعطيل JWT خارج الملفات التي فُحصت؛ المطلوب مراجعة سجلات الجلسات كاملة قبل التنفيذ.
- لم يُثبت تهيئة rate limiter لكل بيئة نشر أو عدد نسخ الخدمة.
- لم يُنفذ أي تعديل، migration، backfill، token revocation، أو فحص كتابة.

## القرار

```text
STRICT_READ_ONLY: TRUE
CODE_CHANGES: NONE
MIGRATIONS_CREATED: NONE
MIGRATIONS_APPLIED: NONE
DATABASE_WRITES: NONE
PRODUCTION_WRITES: NONE
FINANCIAL_OPERATIONS: NONE
EXECUTION_AUTHORIZATION: NOT_GRANTED
WAITING_FOR_USER_EXPLICIT_APPROVAL: TRUE
FINAL_STATUS: PARTIAL
```

هذا التقرير لا يمنح تصريحًا بالتنفيذ. تبقى الموانع أعلاه مفتوحة؛ لا يُعلن التصميم مغلقًا ولا يبدأ الترحيل قبل قرار وموافقة منفصلين.
