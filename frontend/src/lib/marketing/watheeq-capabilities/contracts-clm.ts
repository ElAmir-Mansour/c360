import type { WatheeqDomain } from './types';

export const domain: WatheeqDomain = {
  slug: 'contracts-clm',
  icon: 'doc',
  title: { en: 'Contract Lifecycle (CLM)', ar: 'دورة حياة العقد' },
  intro: {
    en: 'Take every agreement from first request to signed archive in one governed lifecycle — guided intake, clause-level review, AI risk flags, redline negotiation and renewal tracking.',
    ar: 'انقل كل اتفاق من الطلب الأول حتى الأرشيف الموقّع ضمن دورة حياة واحدة محكومة — استقبال موجَّه، ومراجعة على مستوى البنود، ومؤشرات مخاطر بالذكاء الاصطناعي، وتفاوض بالتعديلات المتتبَّعة، وتتبّع للتجديد.',
  },
  capabilities: [
    {
      title: {
        en: 'Contract request creation & data capture',
        ar: 'إنشاء طلب العقد والتقاط البيانات',
      },
      what: {
        en: 'Create a contract review request in one guided workspace, with type, parties, value, duration and requesting department captured up front.',
        ar: 'أنشئ طلب مراجعة عقد في مساحة عمل موجَّهة واحدة، مع التقاط نوع العقد والأطراف والقيمة والمدة والإدارة الطالبة منذ البداية.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Four named contract attachment slots',
        ar: 'أربع خانات مرفقات مسمّاة للعقد',
      },
      what: {
        en: 'Attach the contract draft, quotation, commercial registration and committee decision as four named, individually versioned slots.',
        ar: 'أرفق مسودة العقد وعرض السعر والسجل التجاري وقرار اللجنة في أربع خانات مسمّاة، لكلٍّ منها إصداراتها المستقلة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Configurable required-attachment policies',
        ar: 'سياسات مرفقات إلزامية قابلة للتهيئة',
      },
      what: {
        en: 'Define how many and which document types each request type must include, checked automatically at submission.',
        ar: 'حدِّد عدد المستندات المطلوبة وأنواعها لكل نوع طلب، مع التحقق التلقائي من اكتمالها عند التقديم.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Review-desk intake, acknowledgement & routing',
        ar: 'استقبال مكتب المراجعة والإشعار والتوجيه',
      },
      what: {
        en: 'Every request is logged with an auto-generated reference, an instant receipt acknowledgement, and routing to the legal department.',
        ar: 'يُسجَّل كل طلب برقم مرجعي تلقائي وإشعار استلام فوري، ثم يُوجَّه إلى الإدارة القانونية للمعالجة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Completeness check, return & deficiency notice',
        ar: 'التحقق من الاكتمال والإعادة وإشعار النقص',
      },
      what: {
        en: 'Reviewers verify submitted documents, return incomplete requests, and issue a deficiency notice detailing exactly what is missing.',
        ar: 'يتحقق المراجعون من اكتمال المستندات، ويعيدون الطلبات الناقصة، ويصدرون إشعار نقص يوضّح المفقود بدقة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Authority-restricted contract work distribution',
        ar: 'توزيع أعمال العقود المقيَّد بالصلاحية',
      },
      what: {
        en: 'Only the Legal Director, Contracts Manager or Supervisors can assign review requests to advisors — a dedicated authority that cannot be bypassed.',
        ar: 'لا يحق إسناد طلبات المراجعة للمستشارين إلا للمدير القانوني أو مدير العقود أو المشرفين، كصلاحية مخصّصة لا يمكن تجاوزها.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Clause-by-clause review',
        ar: 'مراجعة بندًا بندًا',
      },
      what: {
        en: 'Advisors review each clause with its own status and risk summary, producing a structured, auditable review record.',
        ar: 'يراجع المستشارون كل بند على حدة بحالته وملخّص مخاطره، منتجين سجل مراجعة منظّمًا وقابلًا للتدقيق.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'AI risk identification & clause-deviation detection',
        ar: 'تحديد المخاطر واكتشاف انحراف البنود بالذكاء الاصطناعي',
      },
      what: {
        en: 'AI flags clause- and contract-level risks and highlights deviations from standard clauses, which the reviewer then triages and confirms.',
        ar: 'يرصد الذكاء الاصطناعي المخاطر على مستوى البند والعقد ويبرز الانحرافات عن البنود المعيارية، ليقوم المراجع بفرزها وتأكيدها.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Regulatory compliance check',
        ar: 'فحص الامتثال التنظيمي',
      },
      what: {
        en: 'The system checks contracts against configured regulatory rules and surfaces compliance flags for the reviewer to confirm or dismiss.',
        ar: 'يفحص النظام العقود وفق قواعد تنظيمية معدّة مسبقًا ويُظهر مؤشرات الامتثال ليؤكّدها المراجع أو يستبعدها.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Threaded legal comments with @mentions',
        ar: 'تعليقات قانونية متسلسلة مع الإشارة إلى الزملاء',
      },
      what: {
        en: 'Add threaded legal comments and @mention colleagues directly on a clause to collaborate without leaving the contract.',
        ar: 'أضف تعليقات قانونية متسلسلة وأشِر إلى زملائك مباشرةً على البند للتعاون دون مغادرة العقد.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Propose & decide clause amendments (redline)',
        ar: 'اقتراح تعديلات البنود والبتّ فيها (تتبّع التغييرات)',
      },
      what: {
        en: 'Propose clause changes as original-to-proposed redlines and formally accept or reject each amendment, keeping a clean decision trail.',
        ar: 'اقترح تعديلات البنود كتغييرات متتبَّعة من النص الأصلي إلى المقترح، واقبل أو ارفض كل تعديل رسميًا مع سجل قرارات واضح.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Version history & redline comparison',
        ar: 'سجل الإصدارات ومقارنة التغييرات المتتبَّعة',
      },
      what: {
        en: 'Every contract and document version is retained, and any two versions can be compared side-by-side as a tracked-change redline.',
        ar: 'يُحفظ كل إصدار من العقد والمستند، ويمكن مقارنة أي إصدارين جنبًا إلى جنب كتغييرات متتبَّعة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Requester correspondence & clarifications',
        ar: 'مراسلات الطالب والإيضاحات',
      },
      what: {
        en: 'Structured two-way correspondence lets reviewers request clarifications, receive amended versions, and auto-return the request to the responsible advisor.',
        ar: 'تتيح المراسلات المنظَّمة ثنائية الاتجاه للمراجعين طلب الإيضاحات واستلام النسخ المعدّلة، مع إعادة الطلب تلقائيًا إلى المستشار المسؤول.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Final-version ceremony',
        ar: 'اعتماد النسخة النهائية',
      },
      what: {
        en: 'The approved final version can be uploaded only after a review recommendation is approved, guaranteeing the archived copy is the signed-off one.',
        ar: 'لا يمكن رفع النسخة النهائية المعتمدة إلا بعد اعتماد توصية المراجعة، بما يضمن أن النسخة المؤرشفة هي المعتمدة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Recommendation & Contracts-Manager sign-off',
        ar: 'التوصية واعتماد مدير العقود',
      },
      what: {
        en: 'Reviewers record an approve / needs-amendment recommendation with reasons, and the Contracts Manager gives final sign-off — the approver can never be the author.',
        ar: 'يسجّل المراجعون توصية بالاعتماد أو الحاجة إلى تعديل مع الأسباب، ويمنح مدير العقود الاعتماد النهائي — على ألا يكون المعتمِد هو المُعِدّ أبدًا.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Electronic contract archive',
        ar: 'الأرشيف الإلكتروني للعقود',
      },
      what: {
        en: 'Signed contracts move to a controlled electronic archive with a full audit trail and an archive/retrieve lifecycle.',
        ar: 'تُنقل العقود الموقّعة إلى أرشيف إلكتروني محكوم بمسار تدقيق كامل ودورة أرشفة واسترجاع.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Advanced contract & archive search',
        ar: 'بحث متقدم في العقود والأرشيف',
      },
      what: {
        en: 'Search the full repository across active and archived contracts by party, value, department, category and status in seconds.',
        ar: 'ابحث في المستودع الكامل عبر العقود النشطة والمؤرشفة حسب الطرف والقيمة والإدارة والفئة والحالة في ثوانٍ.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Contract classification',
        ar: 'تصنيف العقود',
      },
      what: {
        en: 'Contracts are categorised against a per-tenant catalogue so the portfolio can be organised, filtered and reported on by type.',
        ar: 'تُصنَّف العقود وفق فهرس فئات خاص بكل جهة، بما يتيح تنظيم المحفظة وتصفيتها وإعداد التقارير عنها حسب النوع.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Link contracts to departments & matters',
        ar: 'ربط العقود بالإدارات والقضايا',
      },
      what: {
        en: 'Link contracts to their owning department and related legal matters for a connected view of obligations, correspondence and cases.',
        ar: 'اربط العقود بإدارتها المالكة وبالقضايا القانونية ذات الصلة للحصول على رؤية مترابطة للالتزامات والمراسلات والقضايا.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Contract lifecycle status & pipeline board',
        ar: 'حالة دورة حياة العقد ولوحة المسار',
      },
      what: {
        en: 'Track every contract through its lifecycle stages on a visual pipeline board, with transitions gated by approval controls.',
        ar: 'تابع كل عقد عبر مراحل دورة حياته على لوحة مسار مرئية، مع ضبط الانتقالات بضوابط الاعتماد.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Contract brief & lifecycle timeline',
        ar: 'ملخّص العقد والخط الزمني لدورة حياته',
      },
      what: {
        en: 'A one-page contract brief and a chronological timeline give an at-a-glance history of every action taken on a contract.',
        ar: 'يمنح ملخّص العقد من صفحة واحدة والخط الزمني المتسلسل نظرة سريعة على تاريخ كل إجراء اتُّخذ على العقد.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Renewal & expiry management',
        ar: 'إدارة التجديد والانتهاء',
      },
      what: {
        en: 'Track end dates, surface expiring and renewal-due contracts, and renew in one click so no agreement lapses unnoticed.',
        ar: 'تتبّع تواريخ الانتهاء، وأبرِز العقود المنتهية والمستحقة للتجديد، وجدِّدها بنقرة واحدة كي لا ينقضي أي اتفاق دون ملاحظة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Obligation tracking & reminders',
        ar: 'تتبّع الالتزامات والتذكيرات',
      },
      what: {
        en: 'Contractual obligations are tracked with owners, due dates and escalations, and reminders are dispatched automatically ahead of each deadline.',
        ar: 'تُتابَع الالتزامات التعاقدية بمُلّاكها وتواريخ استحقاقها وتصعيداتها، مع إرسال التذكيرات تلقائيًا قبل كل موعد نهائي.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Automated obligation extraction from contracts',
        ar: 'الاستخراج التلقائي للالتزامات من العقود',
      },
      what: {
        en: 'AI reads executed contracts and proposes the obligations and key dates to track, which a reviewer confirms — removing manual entry.',
        ar: 'يقرأ الذكاء الاصطناعي العقود المبرمة ويقترح الالتزامات والتواريخ المهمة للمتابعة ليؤكّدها المراجع، فيلغي الإدخال اليدوي.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Collaborative redline document editor',
        ar: 'محرّر مستندات تعاوني بتتبّع التعديلات',
      },
      what: {
        en: 'A browser-based collaborative editor with check-out locking, snapshots and live redlining lets legal teams draft and negotiate together.',
        ar: 'محرّر تعاوني عبر المتصفح بميزة قفل السحب واللقطات والتتبّع الحي للتعديلات يتيح للفرق القانونية الصياغة والتفاوض معًا.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Negotiation room & external reviewer portal',
        ar: 'غرفة التفاوض وبوابة المراجع الخارجي',
      },
      what: {
        en: 'An in-document negotiation thread plus secure, token-scoped guest links let external counterparties review and comment without a full account.',
        ar: 'خيط تفاوض داخل المستند وروابط ضيف آمنة محدودة النطاق تتيح للأطراف الخارجية المراجعة والتعليق دون حساب كامل.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Playbook enforcement & redline packages',
        ar: 'إنفاذ أدلة البنود وحزم التعديلات المتتبَّعة',
      },
      what: {
        en: 'The editor applies clause playbooks, repairs defined terms, checks signature-readiness and bundles agreed redlines ready for approval.',
        ar: 'يطبّق المحرّر أدلة البنود، ويصحّح المصطلحات المعرّفة، ويتحقق من جاهزية التوقيع، ويجمع التعديلات المتّفق عليها استعدادًا للاعتماد.',
      },
      status: 'configurable',
    },
  ],
};
