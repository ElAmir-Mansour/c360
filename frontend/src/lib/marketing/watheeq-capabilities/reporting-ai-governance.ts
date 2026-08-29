import type { WatheeqDomain } from './types';

export const domain: WatheeqDomain = {
  slug: 'reporting-ai-governance',
  icon: 'trend',
  title: {
    en: 'Reporting, AI & Governance',
    ar: 'التقارير والذكاء الاصطناعي والحوكمة',
  },
  intro: {
    en: 'Turn legal activity into board-ready insight — live KPIs, governed AI drafting, and defensible, encrypted records built for Saudi governance.',
    ar: 'حوّل النشاط القانوني إلى رؤى جاهزة للإدارة العليا — مؤشرات أداء فورية، وصياغة ذكية محوكمة، وسجلات مشفّرة قابلة للإثبات مبنية للحوكمة السعودية.',
  },
  capabilities: [
    {
      title: {
        en: 'Case Reporting & Breakdowns',
        ar: 'تقارير القضايا والتصنيفات',
      },
      what: {
        en: 'Live case counts broken down by type, department and status, with closed and under-procedure metrics, so leadership sees caseload at a glance.',
        ar: 'أعداد فورية للقضايا مصنّفة حسب النوع والإدارة والحالة، مع مؤشرات القضايا المغلقة وقيد الإجراء، لتطّلع القيادة على حجم الأعمال في لمحة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Contract Review Analytics',
        ar: 'تحليلات مراجعة العقود',
      },
      what: {
        en: 'Track legal throughput with reporting on contracts reviewed, average turnaround, and breakdowns by department and contract type.',
        ar: 'متابعة إنتاجية العمل القانوني عبر تقارير عن عدد العقود المُراجَعة، ومتوسط زمن الإنجاز، وتصنيفات حسب الإدارة ونوع العقد.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Consultation Reporting',
        ar: 'تقارير الاستشارات',
      },
      what: {
        en: 'See advisory demand and responsiveness through consultation volumes, department breakdowns and average completion time.',
        ar: 'قياس الطلب على الاستشارات وسرعة الاستجابة من خلال أحجام الاستشارات القانونية، وتصنيفها حسب الإدارة، ومتوسط زمن الإنجاز.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Legal Performance KPIs',
        ar: 'مؤشرات الأداء القانوني',
      },
      what: {
        en: 'An executive KPI set covering average processing time, closed-case ratio, approved-contract ratio, overdue requests and adherence to estimated durations.',
        ar: 'مجموعة مؤشرات تنفيذية تشمل متوسط زمن معالجة الطلبات، ونسبة القضايا المغلقة، ونسبة العقود المعتمدة، وعدد الطلبات المتأخرة، ومدى الالتزام بالمدد المقدّرة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'SLA Compliance KPI',
        ar: 'مؤشر الالتزام باتفاقية مستوى الخدمة',
      },
      what: {
        en: 'The primary service-level KPI: the percentage of requests completed on time against a configurable target (default 90%), reported quarterly for governance review.',
        ar: 'المؤشر الرئيس لمستوى الخدمة: نسبة الطلبات المنجزة في الوقت المحدد مقابل هدف قابل للضبط (افتراضيًا 90٪)، مع رفع تقارير ربع سنوية للمراجعة والحوكمة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Executive Legal Dashboard & Command Center',
        ar: 'لوحة المعلومات القانونية التنفيذية ومركز القيادة',
      },
      what: {
        en: 'A role-aware landing dashboard that surfaces cross-domain KPIs, work needing attention and quick actions tailored to each legal persona.',
        ar: 'لوحة رئيسة مدركة للأدوار تعرض المؤشرات عبر المجالات، والأعمال التي تتطلب انتباهًا، وإجراءات سريعة مخصّصة لكل دور قانوني.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Legal-Operations Analytics',
        ar: 'تحليلات العمليات القانونية',
      },
      what: {
        en: 'Deeper operational analytics with matter and contract velocity trends and a team workload heat-map to spot bottlenecks and balance capacity.',
        ar: 'تحليلات تشغيلية أعمق تشمل اتجاهات وتيرة القضايا والعقود وخريطة حرارية لعبء عمل الفريق لرصد الاختناقات وموازنة الطاقة الاستيعابية.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Legal Entities Registry & Analytics',
        ar: 'سجل الكيانات القانونية وتحليلاتها',
      },
      what: {
        en: 'A central registry of organizational and counterparty legal entities with per-entity exposure and activity views for portfolio oversight.',
        ar: 'سجل مركزي للكيانات القانونية للمؤسسة والأطراف المقابلة مع عرض للتعرّض والنشاط لكل كيان لأغراض الإشراف على المحفظة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Interactive Reports & Export',
        ar: 'التقارير التفاعلية والتصدير',
      },
      what: {
        en: 'Filtered, on-demand reports across cases, contracts, obligations and consultations, with one-click export to CSV/JSON for analysis and audit packs.',
        ar: 'تقارير عند الطلب قابلة للتصفية عبر القضايا والعقود والالتزامات والاستشارات، مع تصدير بنقرة واحدة إلى CSV/JSON للتحليل وحزم التدقيق.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Contract & Clause Risk Scoring',
        ar: 'تقييم مخاطر العقود والبنود',
      },
      what: {
        en: 'Automated risk assessment that flags high-risk clauses, assigns risk levels and presents a color-coded clause-risk summary with remediation guidance.',
        ar: 'تقييم آلي للمخاطر يُبرز البنود عالية الخطورة، ويحدّد مستويات المخاطر، ويعرض ملخصًا مرمّزًا بالألوان لمخاطر البنود مع إرشادات للمعالجة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'AI-Assisted Contract & Clause Drafting',
        ar: 'الصياغة الذكية للعقود والبنود بمساعدة الذكاء الاصطناعي',
      },
      what: {
        en: 'A governed AI assistant that drafts contracts and clauses, rewrites for clarity, suggests fallback wording in negotiation and drafts RFP responses.',
        ar: 'مساعد ذكاء اصطناعي محوكم يصوغ العقود والبنود، ويعيد الصياغة لزيادة الوضوح، ويقترح صياغات بديلة أثناء التفاوض، ويعدّ ردود طلبات العروض.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'AI Translation, Summarization & Glossary',
        ar: 'الترجمة والتلخيص ومسرد المصطلحات بالذكاء الاصطناعي',
      },
      what: {
        en: 'On-demand legal-grade Arabic-English translation, concise contract summaries and automatic glossaries of defined terms to speed review.',
        ar: 'ترجمة قانونية عند الطلب بين العربية والإنجليزية، وملخصات موجزة للعقود، ومسارد تلقائية للمصطلحات المعرّفة لتسريع المراجعة.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'AI Obligation Extraction & QA',
        ar: 'استخلاص الالتزامات وضمان الجودة بالذكاء الاصطناعي',
      },
      what: {
        en: 'Automatically extracts contractual obligations from documents and runs an AI quality-assurance pass to verify completeness before they enter the register.',
        ar: 'استخلاص آلي للالتزامات التعاقدية من الوثائق مع مراجعة لضمان الجودة بالذكاء الاصطناعي للتحقق من اكتمالها قبل إدراجها في السجل.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Governed Prompt Library & Human Draft Review',
        ar: 'مكتبة الموجّهات المحوكمة والمراجعة البشرية للمسودات',
      },
      what: {
        en: 'Reusable, organization-specific AI prompt templates plus a mandatory human-in-the-loop review where every AI draft is tracked as a governed task before use.',
        ar: 'قوالب موجّهات ذكاء اصطناعي قابلة لإعادة الاستخدام وخاصة بالمؤسسة، مع مراجعة بشرية إلزامية تُتابَع فيها كل مسودة ذكاء اصطناعي كمهمة محوكمة قبل استخدامها.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Immutable Audit Trail',
        ar: 'سجل تدقيق غير قابل للتعديل',
      },
      what: {
        en: 'Every action across the suite is captured in append-only, tamper-evident audit logs — a complete, defensible record of who did what and when.',
        ar: 'تُسجّل كل عملية عبر المنظومة في سجلات تدقيق للإضافة فقط ومقاومة للعبث، لتوفير سجل كامل قابل للإثبات عن مَن فعل ماذا ومتى.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Field-Level Encryption at Rest',
        ar: 'التشفير على مستوى الحقول أثناء التخزين',
      },
      what: {
        en: 'Sensitive legal data — investigations, settlement terms, party contacts and intake secrets — is encrypted at the field level with strong AES-256.',
        ar: 'تُشفّر البيانات القانونية الحساسة — تفاصيل التحقيقات وشروط التسويات وبيانات الأطراف وأسرار الاستقبال — على مستوى الحقل بتشفير AES-256 القوي.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Immutable Legal Archive & Long-Term Retention',
        ar: 'الأرشيف القانوني غير القابل للتعديل والحفظ طويل الأمد',
      },
      what: {
        en: 'Executed contracts and records are archived with hash-chained chain-of-custody and searchable long-term retention, preserving an unalterable record.',
        ar: 'تُؤرشف العقود والسجلات المنفّذة بسلسلة حفظ مترابطة بالبصمات الرقمية مع حفظ طويل الأمد قابل للبحث، للحفاظ على سجل تاريخي غير قابل للتغيير.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Backup, Recovery & Business Continuity',
        ar: 'النسخ الاحتياطي والاستعادة واستمرارية الأعمال',
      },
      what: {
        en: 'Regular backups, point-in-time recovery and disaster-recovery failover keep the legal system available and its records restorable.',
        ar: 'نسخ احتياطي منتظم واستعادة إلى نقطة زمنية محددة وتجاوز الأعطال للتعافي من الكوارث لإبقاء النظام القانوني متاحًا وسجلاته قابلة للاستعادة.',
      },
      status: 'roadmap',
    },
    {
      title: {
        en: 'In-System & Email Notifications',
        ar: 'الإشعارات داخل النظام وعبر البريد الإلكتروني',
      },
      what: {
        en: 'A durable per-user notification inbox plus email alerts with read/unread tracking, so legal staff never miss an action or update.',
        ar: 'صندوق إشعارات دائم لكل مستخدم إلى جانب تنبيهات بالبريد الإلكتروني مع تتبّع المقروء وغير المقروء، حتى لا يفوت الفريق القانوني أي إجراء أو تحديث.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Event-Driven Legal Alerts',
        ar: 'التنبيهات القانونية المدفوعة بالأحداث',
      },
      what: {
        en: 'Automatic alerts on key events — request received or transferred, information requested, status changed, hearing or contract-expiry approaching, and judgments issued.',
        ar: 'تنبيهات آلية عند الأحداث الرئيسة — استلام الطلب أو تحويله، وطلب معلومات، وتغيّر الحالة، واقتراب موعد جلسة أو انتهاء عقد، وصدور الأحكام والقرارات.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Full Arabic / RTL Interface',
        ar: 'واجهة عربية كاملة من اليمين إلى اليسار',
      },
      what: {
        en: 'A complete Arabic-first, right-to-left experience across the suite so Arabic-speaking teams work in their native language end to end.',
        ar: 'تجربة عربية كاملة تعتمد الاتجاه من اليمين إلى اليسار عبر المنظومة، لتعمل الفرق الناطقة بالعربية بلغتها الأم من البداية إلى النهاية.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Hijri Calendar & KSA Working Calendar',
        ar: 'التقويم الهجري وتقويم العمل السعودي',
      },
      what: {
        en: 'Hijri dates alongside Gregorian, plus a KSA working calendar with official holidays that drives deadline, SLA and duration calculations.',
        ar: 'عرض التاريخ الهجري إلى جانب الميلادي، مع تقويم عمل سعودي يتضمن الإجازات الرسمية لاحتساب المواعيد النهائية ومستويات الخدمة والمدد.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'KSA Number, Date & Currency Formatting',
        ar: 'تنسيق الأرقام والتواريخ والعملة السعودية',
      },
      what: {
        en: 'Locale-correct formatting with Arabic-Indic numerals, Saudi date conventions and SAR currency presentation for a fully localized experience.',
        ar: 'تنسيق مطابق للغة يشمل الأرقام العربية الهندية وأعراف التواريخ السعودية وعرض العملة بالريال السعودي لتجربة محلية متكاملة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Responsive Web Interface',
        ar: 'واجهة ويب متجاوبة',
      },
      what: {
        en: 'A modern, responsive web app accessible from standard browsers with no install, adapting from desktop to tablet and mobile.',
        ar: 'تطبيق ويب حديث ومتجاوب يمكن الوصول إليه من المتصفحات القياسية دون تثبيت، ويتكيّف من الحاسب المكتبي إلى اللوحي والجوال.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Fast Search & Retrieval',
        ar: 'بحث واسترجاع سريع',
      },
      what: {
        en: 'Low-latency full-text search across contracts and documents finds the right record in seconds, even in large repositories.',
        ar: 'بحث نصي كامل منخفض الكمون عبر العقود والوثائق يعثر على السجل المطلوب في ثوانٍ، حتى في المستودعات الكبيرة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'High-Volume Attachment Handling',
        ar: 'معالجة المرفقات عالية الحجم',
      },
      what: {
        en: 'Scales to large numbers of attachments per matter and contract with versioning, keeping heavy files performant and organized.',
        ar: 'يتوسّع لأعداد كبيرة من المرفقات لكل قضية وعقد مع إدارة الإصدارات، للحفاظ على أداء الملفات الثقيلة وتنظيمها.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Simple, Intuitive Navigation',
        ar: 'تنقّل بسيط وسهل الاستخدام',
      },
      what: {
        en: 'A clean interface with grouped navigation, breadcrumbs, global search and a keyboard command palette makes the suite easy to learn and fast to use.',
        ar: 'واجهة أنيقة مع تنقّل مجمّع ومسارات تنقّل وبحث شامل ولوحة أوامر بلوحة المفاتيح تجعل المنظومة سهلة التعلّم وسريعة الاستخدام.',
      },
      status: 'production',
    },
  ],
};
