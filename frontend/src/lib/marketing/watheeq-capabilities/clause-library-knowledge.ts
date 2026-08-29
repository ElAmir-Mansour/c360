import type { WatheeqDomain } from './types';

export const domain: WatheeqDomain = {
  slug: 'clause-library-knowledge',
  icon: 'book',
  title: { en: 'Clause Library & Knowledge', ar: 'مكتبة البنود والمعرفة' },
  intro: {
    en: 'A single, trusted source of approved clauses, playbooks and regulatory references so legal teams draft, review and stay compliant from one governed knowledge base.',
    ar: 'مصدر موثوق موحّد للبنود المعتمدة وأدلة التفاوض والمراجع التنظيمية، يتيح للفرق القانونية الصياغة والمراجعة والالتزام من قاعدة معرفية واحدة محكومة.',
  },
  capabilities: [
    {
      title: { en: 'Standard Clause Library', ar: 'مكتبة البنود المعيارية' },
      what: {
        en: 'A central, reusable library of approved clauses organised by type, category, jurisdiction and risk, so teams draft from one trusted source instead of copying old contracts.',
        ar: 'مكتبة مركزية قابلة لإعادة الاستخدام من البنود المعتمدة، مُنظّمة حسب النوع والفئة والاختصاص القضائي والمخاطر، لتصوغ الفرق من مصدر موثوق واحد بدلاً من نسخ العقود القديمة.',
      },
      status: 'production',
    },
    {
      title: { en: 'Clause Governance & Approval Workflow', ar: 'حوكمة البنود ومسار الاعتماد' },
      what: {
        en: 'Every clause moves through a controlled governance status with reviewer attribution and justification, so only vetted clauses reach drafters.',
        ar: 'يمر كل بند بحالة حوكمة مضبوطة مع توثيق هوية المراجع ومبررات القرار، بحيث لا تصل إلى المُحرّرين سوى البنود المُدقّقة.',
      },
      status: 'production',
    },
    {
      title: { en: 'Clause Search & Semantic Discovery', ar: 'البحث في البنود والاكتشاف الدلالي' },
      what: {
        en: 'Find the right clause fast through full-text search plus meaning-based discovery of similar clauses, filtered by type, jurisdiction, risk and language.',
        ar: 'اعثر على البند المناسب بسرعة عبر البحث في النص الكامل إلى جانب الاكتشاف الدلالي للبنود المشابهة، مع التصفية حسب النوع والاختصاص القضائي والمخاطر واللغة.',
      },
      status: 'production',
    },
    {
      title: { en: 'Clause Risk Classification', ar: 'تصنيف مخاطر البنود' },
      what: {
        en: 'Each clause carries a risk level with justifications and remediation notes, giving reviewers instant guidance on where to focus.',
        ar: 'يحمل كل بند مستوى مخاطر مع مبررات وملاحظات للمعالجة، ما يمنح المراجعين توجيهاً فورياً حول مواطن التركيز.',
      },
      status: 'production',
    },
    {
      title: { en: 'Automated Clause Extraction from Contracts', ar: 'الاستخراج الآلي للبنود من العقود' },
      what: {
        en: 'Automatically identifies and extracts clauses from an uploaded contract, maps them to clause types and stores them with confidence scores, removing manual tagging.',
        ar: 'يحدّد ويستخرج البنود تلقائياً من العقد المُحمَّل، ويربطها بأنواع البنود ويحفظها مع درجات الثقة، مُلغياً التصنيف اليدوي بنداً بنداً.',
      },
      status: 'production',
    },
    {
      title: { en: 'Clause Playbooks by Contract Type', ar: 'أدلة البنود حسب نوع العقد' },
      what: {
        en: 'Define the ideal set of standard clauses for each contract type as a versioned playbook, so the negotiating position and preferred wording are codified and applied consistently.',
        ar: 'حدّد المجموعة المثالية من البنود المعيارية لكل نوع عقد كدليل مُدار بالإصدارات، فتُقنَّن مواقف التفاوض والصياغة المفضّلة وتُطبَّق باتساق.',
      },
      status: 'production',
    },
    {
      title: { en: 'Playbook Deviation Detection & Review', ar: 'كشف الانحرافات عن الأدلة ومراجعتها' },
      what: {
        en: 'Compares a contract against its applicable playbook, flags missing, altered and extra clauses with a compliance score, then routes each deviation for reviewer sign-off.',
        ar: 'يقارن العقد بالدليل المُطبَّق عليه، ويشير إلى البنود المفقودة والمُعدَّلة والزائدة مع درجة امتثال، ثم يوجّه كل انحراف لاعتماد المراجع.',
      },
      status: 'production',
    },
    {
      title: { en: 'Playbook Approval Governance', ar: 'حوكمة اعتماد الأدلة' },
      what: {
        en: 'A draft playbook must pass a formal approval before it becomes active, with tasks and decisions recorded, so changes are authorised rather than ad-hoc.',
        ar: 'يجب أن يجتاز الدليل المُسوّد اعتماداً رسمياً قبل تفعيله، مع تسجيل المهام والقرارات، لتكون التغييرات مُصرَّحاً بها لا عشوائية.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Playbook Portfolio & Prebuilt Templates', ar: 'حافظة الأدلة والقوالب الجاهزة' },
      what: {
        en: 'A portfolio view of all playbooks plus ready-made templates that can be cloned and tailored, accelerating rollout across contract types.',
        ar: 'عرض شامل لجميع الأدلة إلى جانب قوالب جاهزة يمكن استنساخها وتخصيصها، ما يُسرّع التطبيق عبر أنواع العقود.',
      },
      status: 'production',
    },
    {
      title: { en: 'In-Editor Playbook Enforcement', ar: 'تطبيق الأدلة داخل المحرّر' },
      what: {
        en: 'While drafting in the editor, the system checks the document against configured playbook rules and highlights non-compliant or missing clauses in context, catching issues before review.',
        ar: 'أثناء الصياغة في المحرّر، يتحقق النظام من المستند وفق قواعد الدليل المُهيّأة ويُبرز البنود غير الممتثلة أو المفقودة في سياقها، فتُكتشف المشكلات قبل المراجعة.',
      },
      status: 'production',
    },
    {
      title: { en: 'Regulation & Standards Reference Library', ar: 'مكتبة مراجع الأنظمة والمعايير' },
      what: {
        en: 'A managed library of regulatory requirements and industry standards with jurisdiction, effective dates and governance status, giving teams an authoritative compliance reference.',
        ar: 'مكتبة مُدارة للمتطلبات التنظيمية والمعايير القطاعية مع الاختصاص القضائي وتواريخ النفاذ وحالة الحوكمة، تمنح الفرق مرجعاً موثوقاً للامتثال.',
      },
      status: 'production',
    },
    {
      title: { en: 'Regulation Governance & Approval', ar: 'حوكمة الأنظمة واعتمادها' },
      what: {
        en: 'Regulatory entries pass through the same approve / change-requested / reject governance as clauses, with a reviewer audit trail, ensuring the compliance reference is vetted and trustworthy.',
        ar: 'تمر مدخلات الأنظمة بحوكمة الاعتماد وطلب التعديل والرفض ذاتها المُطبَّقة على البنود، مع سجل تدقيق للمراجع، لضمان أن مرجع الامتثال مُدقَّق وموثوق.',
      },
      status: 'production',
    },
    {
      title: { en: 'Regulation-to-Clause Coverage Mapping', ar: 'ربط تغطية الأنظمة بالبنود' },
      what: {
        en: 'Link each regulation to the clauses that satisfy it, producing a clear coverage map showing which obligations are addressed by which contract language.',
        ar: 'اربط كل نظام بالبنود التي تفي به، لإنتاج خريطة تغطية واضحة تُبيّن أي الالتزامات تعالجها أي صياغة تعاقدية.',
      },
      status: 'production',
    },
    {
      title: { en: 'Regulation Search', ar: 'البحث في الأنظمة' },
      what: {
        en: 'Search the regulation library by text, jurisdiction, category, status and governance state with pagination and sorting, so the relevant rule is located quickly during review.',
        ar: 'ابحث في مكتبة الأنظمة بالنص والاختصاص القضائي والفئة والحالة وحالة الحوكمة مع الترقيم والفرز، ليُعثر على القاعدة المناسبة بسرعة أثناء المراجعة.',
      },
      status: 'production',
    },
    {
      title: { en: 'Compliance Rules Engine & Scanning', ar: 'محرّك قواعد الامتثال والفحص' },
      what: {
        en: 'Configure organisation-specific compliance rules that scan contracts and generate de-duplicated breach alerts, turning static policy into automated, repeatable checks.',
        ar: 'هيّئ قواعد امتثال خاصة بالمؤسسة تفحص العقود وتُنتج تنبيهات مخالفات دون تكرار، محوّلاً السياسة الثابتة إلى فحوصات آلية قابلة للتكرار.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Compliance Alerts & Issue Tracking', ar: 'تنبيهات الامتثال وتتبّع القضايا' },
      what: {
        en: 'Compliance breaches surface as tracked alerts with status management, so teams triage, assign and resolve issues rather than lose them in ad-hoc notes.',
        ar: 'تظهر مخالفات الامتثال كتنبيهات متتبَّعة مع إدارة للحالة، لتفرز الفرق القضايا وتُسندها وتحلّها بدلاً من ضياعها في ملاحظات متفرقة.',
      },
      status: 'production',
    },
    {
      title: { en: 'Compliance Scoring & Dashboard', ar: 'تقييم الامتثال ولوحة المؤشرات' },
      what: {
        en: 'A live dashboard and compliance score aggregate rule results across the portfolio, giving leadership an at-a-glance view of regulatory health and trend.',
        ar: 'لوحة مؤشرات حيّة ودرجة امتثال تجمع نتائج القواعد عبر الحافظة، تمنح القيادة رؤية فورية لصحة الامتثال التنظيمي واتجاهه.',
      },
      status: 'production',
    },
    {
      title: { en: 'Per-Contract Regulatory Compliance Check', ar: 'فحص الامتثال التنظيمي لكل عقد' },
      what: {
        en: 'Run a regulatory compliance check on an individual contract and record structured reviews against it, evidencing that each contract was checked against applicable rules.',
        ar: 'نفّذ فحص امتثال تنظيمي على عقد بعينه وسجّل مراجعات مُهيكلة عليه، لإثبات أن كل عقد قد فُحص وفق القواعد المُطبَّقة.',
      },
      status: 'production',
    },
    {
      title: { en: 'Configurable Attachment Policies', ar: 'سياسات المرفقات القابلة للتهيئة' },
      what: {
        en: 'The legal department defines the required number and types of attachments per request or contract type, and the system checks completeness before work proceeds.',
        ar: 'تحدّد الإدارة القانونية العدد والأنواع المطلوبة من المرفقات لكل طلب أو نوع عقد، ويتحقق النظام من اكتمالها قبل المضي في العمل.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Common Document Format Support', ar: 'دعم صيغ المستندات الشائعة' },
      what: {
        en: 'Upload and manage documents in common business formats including DOCX and PDF, backed by the platform file service and document editor.',
        ar: 'ارفع وأدر المستندات بالصيغ التجارية الشائعة بما فيها DOCX وPDF، مدعومة بخدمة الملفات ومحرّر المستندات في المنصة.',
      },
      status: 'production',
    },
    {
      title: { en: 'Document Classification & Confidentiality Taxonomy', ar: 'تصنيف المستندات وتصنيف السرية' },
      what: {
        en: 'Classify documents by type and confidentiality and organise them in a folder taxonomy with a repository summary, so sensitive legal material is labelled and controlled.',
        ar: 'صنّف المستندات حسب النوع والسرية ونظّمها في هيكل مجلدات مع ملخص للمستودع، لتُوسَم المواد القانونية الحساسة وتُضبط.',
      },
      status: 'production',
    },
    {
      title: { en: 'In-Document Full-Text Search', ar: 'البحث في النص الكامل داخل المستندات' },
      what: {
        en: 'Search inside documents using extracted full text, so relevant contracts, clauses and evidence are found by content rather than by filename.',
        ar: 'ابحث داخل المستندات باستخدام النص الكامل المُستخرَج، لتُعثر على العقود والبنود والأدلة ذات الصلة بالمحتوى لا باسم الملف.',
      },
      status: 'production',
    },
    {
      title: { en: 'Document Versioning & Version Retrieval', ar: 'إصدارات المستندات واسترجاعها' },
      what: {
        en: 'Maintain immutable version snapshots of every document, compare versions and retrieve any prior version, giving a complete and tamper-evident change history.',
        ar: 'احتفظ بلقطات إصدار غير قابلة للتغيير لكل مستند، وقارن الإصدارات واسترجع أي إصدار سابق، لتوفير سجل تغييرات كامل ومقاوم للعبث.',
      },
      status: 'production',
    },
    {
      title: { en: 'Electronic Archiving (WORM-backed)', ar: 'الأرشفة الإلكترونية (مدعومة بتقنية WORM)' },
      what: {
        en: 'Archive finalised contracts, consultations and legal documents to a tamper-evident, write-once electronic archive with a hash-chained manifest for long-term evidentiary integrity.',
        ar: 'أرشِف العقود والاستشارات والمستندات القانونية المُنجزة في أرشيف إلكتروني للكتابة مرة واحدة مقاوم للعبث، مع بيان مترابط بالتجزئة لضمان سلامة الأدلة على المدى الطويل.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Contract Assembly from Templates & Sections', ar: 'تجميع العقود من القوالب والأقسام' },
      what: {
        en: 'Assemble a complete contract deterministically from curated sections, templates and library clauses, producing reproducible documents without relying on generative AI.',
        ar: 'جمّع عقداً كاملاً بشكل حتمي من أقسام وقوالب وبنود مكتبية مُنسَّقة، لإنتاج مستندات قابلة لإعادة الإنتاج دون الاعتماد على الذكاء الاصطناعي التوليدي.',
      },
      status: 'production',
    },
  ],
};
