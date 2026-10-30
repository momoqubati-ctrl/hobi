# قائمة مهام: provider-admin

المواصفة: [SPEC-provider-admin.md](../SPEC-provider-admin.md)
الخطة: [tasks/plan.md](./plan.md)

## المرحلة 1: الأساس والتخزين

- [x] **voice-provider-encryption — إنشاء تشفير الأسرار**
  - القبول: AES-256-GCM، مفتاح Base64 بطول 32 بايت، رفض المفتاح المفقود/غير الصحيح والبيانات المعدلة، دون تسجيل الأسرار.
  - التحقق: `npm test` وESLint للملفات المتأثرة.
  - الملفات: `server/services/voiceProviderEncryption.ts`, `tests/voiceProviderEncryption.test.ts`, `.env.example`
  - الاعتماديات: لا يوجد.

- [ ] **voice-provider-storage — تخزين الحسابات والاختيار**
  - القبول: تخزين متعدد للحسابات مع أسرار مشفرة واختيار مطلوب منفصل؛ ترحيل إضافي آمن.
  - التحقق: اختبارات التخزين، `npm run db:verify`، وترحيل على قاعدة اختبار معزولة فقط.
  - الملفات: `server/db/schema.ts`, `server/db/migrate.ts`, `server/services/voiceProviderStore.ts`, `tests/voiceProviderStore.test.ts`
  - الاعتماديات: `voice-provider-encryption`.
  - **بوابة:** لا يبدأ تعديل المخطط أو الترحيل قبل موافقة المستخدم الصريحة.

## نقطة تحقق: الأساس

- [ ] اختبارات التشفير والتخزين تمر.
- [ ] الترحيل متوافق ويُختبر خارج الإنتاج.
- [ ] تمت مراجعة أي تغيير مطلوب في قاعدة البيانات.

## المرحلة 2: واجهات الإدارة

- [ ] **voice-provider-account-api — إدارة حسابات LiveKit**
  - القبول: قراءة وإضافة وتعديل وحذف آمنة مع الصلاحيات والتدقيق ومنع تسريب الأسرار.
  - التحقق: اختبارات API لكل مستوى صلاحية وحالة خطأ، ثم `npm test`.
  - الملفات: مسارات `server/routes/api/admin/voice-providers*`, `tests/adminVoiceProviders.test.ts`
  - الاعتماديات: `voice-provider-encryption`, `voice-provider-storage`.

- [ ] **voice-provider-selection-api — حفظ الاختيار المطلوب**
  - القبول: حفظ WebRTC أو حساب LiveKit موجود وسليم، دون الادعاء أن التفعيل الفعلي اكتمل.
  - التحقق: اختبارات نجاح وفشل وتعارض، ثم `npm test`.
  - الملفات: `server/routes/api/admin/voice-provider-selection.put.ts`, `server/services/voiceProviderStore.ts`, `tests/adminVoiceProviders.test.ts`
  - الاعتماديات: `voice-provider-storage`, `voice-provider-account-api`.

## نقطة تحقق: واجهات API

- [ ] كل API محمية بصلاحيتها الخادمية.
- [ ] لا يظهر مفتاح أو سر أو ciphertext في الاستجابات أو السجلات.
- [ ] لا يمكن حذف الحساب المحدد ولا حفظ اختيار غير صالح.

## المرحلة 3: الواجهة والتحقق النهائي

- [ ] **voice-provider-admin-ui — بناء تبويب إدارة المزود**
  - القبول: إدارة الحسابات والاختيار، عرض بيانات غير حساسة، ومعالجة أخطاء API بوضوح.
  - التحقق: `npm run build`، ESLint، ومراجعة في متصفح محلي دون أسرار حقيقية.
  - الملفات: `src/components/admin/AdminDashboard.tsx`, `src/components/admin/sections/VoiceProviderSection.tsx`, اختبار منطق العرض إن أمكن بالأدوات الحالية.
  - الاعتماديات: `voice-provider-account-api`, `voice-provider-selection-api`.

- [ ] **voice-provider-final-verification — فحص أمني وتوثيق التشغيل**
  - القبول: توثيق مكان المفتاح والتحذير من فقده/تغييره، وعدم وجود أسرار في المستودع أو السجلات.
  - التحقق: `npm test`, `npm run build`, ESLint ومراجعة يدوية للاستجابات.
  - الملفات: `docs/production-readiness-roadmap.md`, `docs/voice-provider-operations.md`, والاختبارات ذات الصلة عند الحاجة.
  - الاعتماديات: `voice-provider-admin-ui`.

## نقطة تحقق: الإكمال

- [ ] اختبارات المشروع والبناء وفحوص lint ذات الصلة تمر.
- [ ] مسارات الفشل لا تكشف الأسرار ولا تعطل WebRTC.
- [ ] لم يُختبر أي حساب LiveKit حقيقي أو تُضف بيانات اعتماد فعلية.
- [ ] موافقة المستخدم على الخطة حاصلة قبل بدء التنفيذ.
