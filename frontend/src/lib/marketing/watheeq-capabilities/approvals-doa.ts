import type { WatheeqDomain } from './types';

export const domain: WatheeqDomain = {
  slug: 'approvals-doa',
  icon: 'check',
  title: {
    en: 'Approvals & Delegation of Authority',
    ar: 'الاعتمادات وتفويض الصلاحيات',
  },
  intro: {
    en: "Every legal request, contract and case moves through the right sign-offs, with policy-driven routing, delegation-of-authority controls and unbypassable four-eyes governance.",
    ar: "يمرّ كل طلب قانوني وعقد وقضية عبر الاعتمادات الصحيحة، بتوجيه محكوم بالسياسات وضوابط لتفويض الصلاحيات وحوكمة الأربع أعين التي لا يمكن تجاوزها.",
  },
  capabilities: [
    {
      title: {
        en: "Legal approval & workflow engine",
        ar: "محرك الاعتماد وسير العمل القانوني",
      },
      what: {
        en: "One approval and workflow engine drives every legal request, case, consultation, investigation and contract review through its required review and sign-off steps, so nothing is actioned without the right approvals.",
        ar: "محرك اعتماد وسير عمل موحّد يقود كل طلب وقضية واستشارة وتحقيق ومراجعة عقد عبر خطوات المراجعة والاعتماد المطلوبة، فلا يُنفَّذ أي إجراء دون الاعتمادات الصحيحة.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Policy-driven, type-varying approval chains",
        ar: "سلاسل اعتماد متغيّرة حسب السياسة والنوع",
      },
      what: {
        en: "Approval routing adapts to each request's type, department and value, with multi-tier chains, sequential or parallel steps and quorum rules.",
        ar: "يتكيّف توجيه الاعتماد مع نوع كل طلب وإدارته وقيمته، مع سلاسل متعددة المستويات وخطوات متتابعة أو متوازية وقواعد النصاب.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Value / type / department approval policies",
        ar: "سياسات الاعتماد حسب القيمة والنوع والإدارة",
      },
      what: {
        en: "Administrators define approval policies matched by contract or request type, department and monetary value range, for precise control over who must approve what.",
        ar: "يحدّد المسؤولون سياسات الاعتماد وفق نوع العقد أو الطلب والإدارة ونطاق القيمة المالية، لضبط دقيق لمن يجب أن يعتمد وماذا.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Policy versioning & immutable change audit",
        ar: "إصدارات السياسات وسجل تغييرات غير قابل للتعديل",
      },
      what: {
        en: "Every change to an approval policy is captured as an immutable version snapshot with an append-only audit log of who changed what and when, so approval rules stay traceable and defensible.",
        ar: "يُلتقط كل تغيير في سياسة الاعتماد كنسخة إصدار غير قابلة للتعديل مع سجل تدقيق يُضاف إليه فقط يوثّق من غيّر ماذا ومتى، لتبقى قواعد الاعتماد قابلة للتتبع والإثبات.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Approval-policy conflict detection",
        ar: "كشف تعارض سياسات الاعتماد",
      },
      what: {
        en: "Before a new policy goes live the system checks for overlapping or duplicate routing rules and flags scope conflicts, preventing contradictory approval paths.",
        ar: "قبل تفعيل أي سياسة جديدة يفحص النظام قواعد التوجيه المتداخلة أو المكررة ويُبرز تعارضات النطاق، ما يمنع مسارات الاعتماد المتناقضة.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Reusable approval-policy templates",
        ar: "قوالب سياسات اعتماد قابلة لإعادة الاستخدام",
      },
      what: {
        en: "Common approval patterns are saved as named templates and instantiated into new policies with optional overrides, so standard governance rolls out consistently across departments and entities.",
        ar: "تُحفظ أنماط الاعتماد الشائعة كقوالب مُسمّاة وتُنشأ منها سياسات جديدة مع إمكانية التعديل، لتطبيق الحوكمة المعيارية باتساق عبر الإدارات والكيانات.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Policy effective-dating & expiry",
        ar: "تفعيل السياسات بتواريخ سريان وانتهاء",
      },
      what: {
        en: "Each approval policy carries a valid-from and valid-until window, and only in-window policies are used for routing, so governance changes can be scheduled and time-boxed automatically.",
        ar: "تحمل كل سياسة اعتماد تاريخ بدء وانتهاء سريان، ولا يُستخدم للتوجيه سوى السياسات السارية، لجدولة تغييرات الحوكمة وتحديدها زمنياً تلقائياً.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Approval-policy recommendation assistant",
        ar: "مساعد التوصية بسياسة الاعتماد",
      },
      what: {
        en: "For a given contract or request the system recommends the applicable approval policy from its type, department and value, helping staff pick the correct routing and reducing misrouted approvals.",
        ar: "لأي عقد أو طلب يوصي النظام بسياسة الاعتماد المناسبة استناداً إلى نوعه وإدارته وقيمته، ما يساعد الموظفين على اختيار التوجيه الصحيح ويقلل الاعتمادات المُوجَّهة خطأً.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Approval governance analytics",
        ar: "تحليلات حوكمة الاعتماد",
      },
      what: {
        en: "A management view shows approval-policy usage and coverage, including active versus archived policies and how scopes are distributed, giving leadership oversight of the governance framework.",
        ar: "توفّر لوحة إدارية استخدام سياسات الاعتماد وتغطيتها، بما في ذلك السياسات الفعّالة مقابل المؤرشفة وتوزيع نطاقاتها، لمنح القيادة إشرافاً على إطار الحوكمة.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Conditional approval form fields",
        ar: "حقول نماذج اعتماد شرطية",
      },
      what: {
        en: "Approval steps can present extra data-capture fields only when relevant, such as a justification field that appears only on rejection, keeping approvers focused and capturing the right evidence for each decision.",
        ar: "يمكن أن تُظهر خطوات الاعتماد حقول إدخال إضافية عند الحاجة فقط، مثل حقل تبرير يظهر عند الرفض وحده، لإبقاء المعتمدين مركّزين والتقاط الأدلة الصحيحة لكل قرار.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Delegation of Authority with PKI evidence",
        ar: "تفويض الصلاحيات بإثبات البنية التحتية للمفاتيح العامة",
      },
      what: {
        en: "High-value approvals can require cryptographic proof of delegated authority: the system validates an X.509 certificate chain and a signed authority document, and checks that the delegated spend limit covers the amount being approved.",
        ar: "يمكن أن تتطلب الاعتمادات عالية القيمة إثباتاً مشفّراً للصلاحية المُفوَّضة: يتحقق النظام من سلسلة شهادات X.509 ومن وثيقة تفويض موقّعة، ويتأكد أن حد الإنفاق المُفوَّض يغطي المبلغ المطلوب اعتماده.",
      },
      status: 'configurable',
    },
    {
      title: {
        en: "Four-eyes control & Separation of Duties",
        ar: "ضابط الأربع أعين والفصل بين الواجبات",
      },
      what: {
        en: "The engine enforces that the author of a contract or request cannot approve or reject their own work, with no administrator bypass, and blocks the decision if the author cannot be established, for genuine four-eyes governance.",
        ar: "يفرض المحرك ألا يعتمد مُعِدّ العقد أو الطلب عمله أو يرفضه بنفسه، دون أي تجاوز من المسؤول، ويوقف القرار إذا تعذّر تحديد المُعِدّ، لتحقيق حوكمة الأربع أعين الحقيقية.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Approval inbox & human-task decisions",
        ar: "صندوق الاعتماد وقرارات المهام البشرية",
      },
      what: {
        en: "Approvers receive their pending decisions in a personal inbox and act with approve, request-changes or reject plus notes, and the workflow advances automatically to the next step.",
        ar: "يستلم المعتمدون قراراتهم المعلّقة في صندوق شخصي ويتخذون إجراء الاعتماد أو طلب التعديل أو الرفض مع ملاحظات، ويتقدم سير العمل تلقائياً إلى الخطوة التالية.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Bulk approval decisions",
        ar: "قرارات اعتماد جماعية",
      },
      what: {
        en: "Approvers can clear several pending tasks in one action, applying the same decision and notes across multiple items to handle high approval volumes efficiently.",
        ar: "يمكن للمعتمدين إنجاز عدة مهام معلّقة بإجراء واحد، بتطبيق القرار والملاحظات نفسها على عناصر متعددة للتعامل مع أحجام الاعتماد الكبيرة بكفاءة.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Contract review workflows",
        ar: "مسارات مراجعة العقود",
      },
      what: {
        en: "Contract reviews start with a reviewer assignment and an SLA deadline, route automatically by the applicable approval policy, and are tracked through each reviewer decision to completion.",
        ar: "تبدأ مراجعات العقود بإسناد مراجع ومهلة اتفاقية مستوى خدمة، وتُوجَّه تلقائياً وفق سياسة الاعتماد المطبّقة، وتُتابَع عبر كل قرار مراجع حتى الاكتمال.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Execution clock starts on completeness",
        ar: "بدء ساعة التنفيذ عند اكتمال الطلب",
      },
      what: {
        en: "The turnaround clock for a request begins only when the assigned provider confirms it is complete, so teams are never measured against time lost to incomplete submissions.",
        ar: "تبدأ ساعة إنجاز الطلب فقط عندما يؤكد مقدّم الخدمة المُسنَد اكتماله، فلا تُحتسب على الفرق أوقات ضائعة بسبب طلبات غير مكتملة.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Pre-start requirements checklist",
        ar: "قائمة متطلبات ما قبل البدء",
      },
      what: {
        en: "Each service can require a checklist of mandatory attachments and data before work begins, and the clock does not start until every requirement is met.",
        ar: "يمكن أن تشترط كل خدمة قائمة تحقق من المرفقات والبيانات الإلزامية قبل بدء العمل، ولا تبدأ الساعة حتى استيفاء كل متطلب.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Return incomplete requests",
        ar: "إعادة الطلبات غير المكتملة",
      },
      what: {
        en: "Providers can formally return an incomplete request to the requester, and timing starts only once the outstanding requirements are supplied, protecting SLA fairness.",
        ar: "يمكن لمقدّمي الخدمة إعادة الطلب غير المكتمل رسمياً إلى مُقدِّمه، ولا يبدأ احتساب الوقت إلا بعد توفير المتطلبات الناقصة، حفاظاً على عدالة اتفاقية مستوى الخدمة.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Re-evaluate & re-tier on material change",
        ar: "إعادة التقييم والتصنيف عند التغيير الجوهري",
      },
      what: {
        en: "When a request is substantially edited the system re-evaluates its service level and can treat it as a new request, so the SLA reflects the real scope of work.",
        ar: "عند تعديل الطلب تعديلاً جوهرياً يعيد النظام تقييم مستوى خدمته وقد يعامله كطلب جديد، لتعكس اتفاقية مستوى الخدمة النطاق الفعلي للعمل.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Two-round review close & auto re-spawn",
        ar: "الإغلاق بعد جولتي مراجعة وإعادة الإنشاء التلقائية",
      },
      what: {
        en: "After two review rounds a request is closed and a fresh copy is raised automatically under a new SLA, preventing items from cycling indefinitely while preserving continuity.",
        ar: "بعد جولتي مراجعة يُغلق الطلب وتُنشأ نسخة جديدة تلقائياً باتفاقية مستوى خدمة جديدة، لمنع تدوير العناصر بلا نهاية مع الحفاظ على الاستمرارية.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Delivery confirmation handshake",
        ar: "تأكيد استلام المخرجات",
      },
      what: {
        en: "Once agreed outputs are delivered the requester is asked to confirm or dispute receipt, and their response is captured as part of the request record.",
        ar: "بعد تسليم المخرجات المتفق عليها يُطلب من مُقدِّم الطلب تأكيد الاستلام أو الاعتراض عليه، ويُسجَّل ردّه ضمن سجل الطلب.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Auto-close on no response",
        ar: "الإغلاق التلقائي عند عدم الرد",
      },
      what: {
        en: "If a requester does not respond to a delivery confirmation within 24 hours the request closes automatically, keeping queues clean without manual chasing.",
        ar: "إذا لم يردّ مُقدِّم الطلب على تأكيد التسليم خلال 24 ساعة يُغلق الطلب تلقائياً، للحفاظ على نظافة قوائم الانتظار دون متابعة يدوية.",
      },
      status: 'production',
    },
    {
      title: {
        en: "Working-calendar timing basis",
        ar: "احتساب التوقيت على تقويم العمل الرسمي",
      },
      what: {
        en: "All approval and execution timers count only approved official working days and hours, so SLAs and escalations are measured fairly against the real business calendar.",
        ar: "تحتسب جميع مؤقتات الاعتماد والتنفيذ أيام وساعات العمل الرسمية المعتمدة فقط، لقياس اتفاقيات مستوى الخدمة والتصعيدات بعدالة وفق تقويم العمل الفعلي.",
      },
      status: 'production',
    },
    {
      title: {
        en: "SLA-breach escalation ladder",
        ar: "سلّم التصعيد عند تجاوز اتفاقية مستوى الخدمة",
      },
      what: {
        en: "When a request breaches its target, escalation fires automatically up a three-level ladder: section supervisor at +2 working days, department manager at +4 and unit manager at +6, each notified by email.",
        ar: "عند تجاوز الطلب هدفه يُطلق التصعيد تلقائياً عبر سلّم من ثلاثة مستويات: مشرف القسم عند +2 يوم عمل، ومدير الإدارة عند +4، ومدير الوحدة عند +6، مع إشعار كلٍّ منهم بالبريد الإلكتروني.",
      },
      status: 'production',
    },
  ],
};
