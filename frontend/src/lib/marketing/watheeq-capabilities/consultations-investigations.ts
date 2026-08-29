import type { WatheeqDomain } from './types';

export const domain: WatheeqDomain = {
  slug: "consultations-investigations",
  icon: "clipboard",
  title: {
    en: "Consultations & Investigations",
    ar: "الاستشارات والتحقيقات",
  },
  intro: {
    en: "From the first advisory question to the final investigation report, WatheeqTech gives legal teams one governed workspace for consultations and internal investigations — captured, routed, approved and archived with full separation of duties.",
    ar: "من أول استفسار استشاري إلى تقرير التحقيق النهائي، تمنح وثيقتك الفرق القانونية مساحة عمل واحدة محوكمة للاستشارات والتحقيقات الداخلية، تُوثَّق وتُوجَّه وتُعتمَد وتُؤرشَف مع فصل كامل بين المهام.",
  },
  capabilities: [
    {
      title: {
        en: "Legal Advisory Request Intake",
        ar: "استقبال طلبات الاستشارات القانونية",
      },
      what: {
        en: "Business units and staff submit legal consultation requests through a guided workspace or API, so every question to the legal team is captured, tracked and never lost in email.",
        ar: "ترفع وحدات الأعمال والموظفون طلبات الاستشارة القانونية عبر مساحة عمل موجَّهة أو واجهة برمجية، فيُوثَّق كل استفسار قانوني ويُتابَع دون أن يضيع في البريد الإلكتروني.",
      },
      status: "production",
    },
    {
      title: {
        en: "Consultation Type Classification",
        ar: "تصنيف نوع الاستشارة",
      },
      what: {
        en: "Each advisory request is classified by legal subject so it can be prioritised, routed to the right specialist and reported on by category.",
        ar: "يُصنَّف كل طلب استشارة حسب الموضوع القانوني ليتسنى ترتيب أولويته وتوجيهه إلى المختص المناسب وإعداد التقارير حسب الفئة.",
      },
      status: "production",
    },
    {
      title: {
        en: "Supporting Document Attachments",
        ar: "إرفاق المستندات الداعمة",
      },
      what: {
        en: "Requesters and advisors attach contracts, correspondence and reference documents directly to a consultation, keeping the full advisory file in one place.",
        ar: "يرفق مقدّمو الطلبات والمستشارون العقود والمراسلات والمستندات المرجعية مباشرةً بالاستشارة، فيبقى ملف الاستشارة كاملاً في مكان واحد.",
      },
      status: "production",
    },
    {
      title: {
        en: "Routing & Advisor Assignment",
        ar: "التوجيه وإسناد المستشار",
      },
      what: {
        en: "Consultations are routed to the responsible legal advisor with visible ownership and workload balancing, so requests reach the person who will answer them promptly.",
        ar: "تُوجَّه الاستشارات إلى المستشار القانوني المسؤول مع وضوح الملكية وموازنة أحمال العمل، لتصل الطلبات سريعاً إلى من سيتولى الرد عليها.",
      },
      status: "production",
    },
    {
      title: {
        en: "Advisory Response Capture",
        ar: "توثيق الرد الاستشاري",
      },
      what: {
        en: "The assigned advisor records the formal legal opinion against the request, producing a defensible, timestamped record of the advice given.",
        ar: "يوثّق المستشار المكلَّف الرأي القانوني الرسمي على الطلب، مكوّناً سجلاً موثّقاً بالتاريخ والوقت للمشورة المقدَّمة.",
      },
      status: "production",
    },
    {
      title: {
        en: "AI-Assisted First-Response Drafting",
        ar: "الصياغة الأولية للرد بمساعدة الذكاء الاصطناعي",
      },
      what: {
        en: "Advisors generate a suggested first-response memo from the request context to accelerate turnaround, then review and edit it before it becomes the official answer.",
        ar: "يولّد المستشارون مسودة مذكرة رد أولية من سياق الطلب لتسريع الإنجاز، ثم يراجعونها ويعدّلونها قبل اعتمادها رداً رسمياً.",
      },
      status: "configurable",
    },
    {
      title: {
        en: "Response Approval with Separation of Duties",
        ar: "اعتماد الرد مع الفصل بين المهام",
      },
      what: {
        en: "A legal opinion must be approved before it is issued, and the advisor who authored the response can never be the one to approve it — protecting the integrity of advice.",
        ar: "يجب اعتماد الرأي القانوني قبل إصداره، مع ضمان ألا يكون المستشار الذي صاغ الرد هو من يعتمده، حمايةً لنزاهة المشورة.",
      },
      status: "production",
    },
    {
      title: {
        en: "Consultation Archival & Retention",
        ar: "أرشفة الاستشارات وحفظها",
      },
      what: {
        en: "Completed consultations are formally archived to a tamper-evident legal record, giving the department a durable, searchable history of advice provided.",
        ar: "تُؤرشَف الاستشارات المكتملة رسمياً في سجل قانوني غير قابل للعبث، ما يمنح الإدارة سجلاً دائماً قابلاً للبحث للمشورة المقدَّمة.",
      },
      status: "production",
    },
    {
      title: {
        en: "Consultation SLA Clock & Escalation",
        ar: "ساعة مستوى الخدمة والتصعيد للاستشارات",
      },
      what: {
        en: "Each consultation carries acknowledgement and response deadlines with live countdown badges, breach flags and escalation levels, so advisory turnaround is visible and enforceable.",
        ar: "تحمل كل استشارة مواعيد نهائية للإقرار والرد مع مؤشرات عدّ تنازلي حيّة وتنبيهات تجاوز ومستويات تصعيد، فتصبح مدة الإنجاز واضحة وقابلة للإنفاذ.",
      },
      status: "configurable",
    },
    {
      title: {
        en: "Advisory Analytics & KPIs",
        ar: "تحليلات ومؤشرات أداء الاستشارات",
      },
      what: {
        en: "Dashboards summarise open, responded and approved volumes, breached SLAs, average time-to-respond and advisor workload, giving leadership a real-time view of advisory demand and performance.",
        ar: "تلخّص لوحات المعلومات أعداد الطلبات المفتوحة والمردود عليها والمعتمدة، وحالات تجاوز مستوى الخدمة، ومتوسط زمن الرد، وأحمال المستشارين، لتمنح القيادة رؤية آنية للطلب على الاستشارات وأدائها.",
      },
      status: "production",
    },
    {
      title: {
        en: "Consultation Legal-Hold Preservation",
        ar: "الحفظ القانوني للاستشارات",
      },
      what: {
        en: "When a consultation is placed under legal hold, a hold banner appears and archival, document removal and deletion are prevented, preserving the advisory record for litigation or audit.",
        ar: "عند وضع استشارة تحت الحفظ القانوني، تظهر لافتة حفظ وتُمنع الأرشفة وإزالة المستندات والحذف، حفاظاً على سجل الاستشارة لأغراض التقاضي أو التدقيق.",
      },
      status: "production",
    },
    {
      title: {
        en: "Bulk Consultation Actions",
        ar: "الإجراءات المجمّعة للاستشارات",
      },
      what: {
        en: "Advisors and managers classify, route, tag, archive or remove many consultations at once, with each item processed independently so a single failure never blocks the rest.",
        ar: "يصنّف المستشارون والمديرون عدداً كبيراً من الاستشارات ويوجّهونها ويوسمونها ويؤرشفونها أو يزيلونها دفعةً واحدة، مع معالجة كل عنصر بشكل مستقل بحيث لا يعيق إخفاق واحد بقية العناصر.",
      },
      status: "production",
    },
    {
      title: {
        en: "Consultation Audit Trail & Timeline",
        ar: "سجل التدقيق والخط الزمني للاستشارات",
      },
      what: {
        en: "Every state change on a consultation is recorded as an immutable, timestamped timeline, giving a complete who-did-what history for compliance and internal review.",
        ar: "يُسجَّل كل تغيّر في حالة الاستشارة ضمن خط زمني غير قابل للتعديل ومختوم بالتاريخ والوقت، ما يوفّر سجلاً كاملاً لمن فعل ماذا لأغراض الامتثال والمراجعة الداخلية.",
      },
      status: "production",
    },
    {
      title: {
        en: "Investigation Case Registration & Parties",
        ar: "تسجيل قضايا التحقيق وأطرافها",
      },
      what: {
        en: "Open and register an internal legal investigation and capture all participants — subjects, complainants, witnesses, investigators and experts — as a structured, role-tagged record.",
        ar: "افتح وسجّل تحقيقاً قانونياً داخلياً ووثّق جميع أطرافه من مشتكى عليهم ومشتكين وشهود ومحققين وخبراء في سجل منظَّم موسوم بالأدوار.",
      },
      status: "production",
    },
    {
      title: {
        en: "Statements & Testimony Capture",
        ar: "تدوين الأقوال والشهادات",
      },
      what: {
        en: "Record witness statements and testimonies taken during an investigation, optionally linked to the party who gave them, so the evidentiary narrative is complete and attributable.",
        ar: "دوّن أقوال الشهود وشهاداتهم المأخوذة خلال التحقيق، مع إمكانية ربطها بالطرف الذي أدلى بها، ليكتمل السرد الاستدلالي ويكون منسوباً لأصحابه.",
      },
      status: "production",
    },
    {
      title: {
        en: "Evidence Cataloguing & Attachments",
        ar: "فهرسة الأدلة وإرفاقها",
      },
      what: {
        en: "Catalogue evidence items and upload supporting attachments against the investigation, building a defensible, organised evidence file for the matter.",
        ar: "افهرس عناصر الأدلة وارفع المرفقات الداعمة على التحقيق، لبناء ملف أدلة منظَّم وقابل للاحتجاج به للقضية.",
      },
      status: "production",
    },
    {
      title: {
        en: "Findings & Final Recommendations",
        ar: "النتائج والتوصيات النهائية",
      },
      what: {
        en: "Investigators record the statement of findings and final recommendations, completing the investigation's conclusion in a structured, reportable form.",
        ar: "يدوّن المحققون بيان النتائج والتوصيات النهائية، مكملين خاتمة التحقيق في صيغة منظَّمة قابلة للإبلاغ عنها.",
      },
      status: "production",
    },
    {
      title: {
        en: "AI-Assisted Findings & Recommendations Drafting",
        ar: "صياغة النتائج والتوصيات بمساعدة الذكاء الاصطناعي",
      },
      what: {
        en: "Generate a neutral, thorough draft statement of findings and clear, actionable recommendations from the investigation record, which the investigator reviews and finalises.",
        ar: "ولّد مسودة محايدة ووافية لبيان النتائج وتوصيات واضحة قابلة للتنفيذ من سجل التحقيق، ليراجعها المحقق ويعتمدها نهائياً.",
      },
      status: "configurable",
    },
    {
      title: {
        en: "Investigation Results Sign-Off with Separation of Duties",
        ar: "اعتماد نتائج التحقيق مع الفصل بين المهام",
      },
      what: {
        en: "Investigation results move through a formal approval chain before closure, with the person who recorded the results blocked from approving them and delegation-of-authority validated on the approver.",
        ar: "تمر نتائج التحقيق عبر سلسلة اعتماد رسمية قبل الإغلاق، مع منع من دوّن النتائج من اعتمادها والتحقق من تفويض الصلاحية لدى المعتمد.",
      },
      status: "production",
    },
    {
      title: {
        en: "Investigation Lifecycle Workspace & Board",
        ar: "مساحة عمل ولوحة دورة حياة التحقيق",
      },
      what: {
        en: "A visual board and case workspace track each investigation through its full lifecycle — registered, in progress, results recorded, pending approval and closed — so status is always clear.",
        ar: "تتابع لوحة مرئية ومساحة عمل للقضية كل تحقيق عبر دورة حياته الكاملة، من مُسجَّل وقيد التنفيذ والنتائج مدوَّنة وبانتظار الاعتماد إلى مُغلَق، لتبقى الحالة واضحة دائماً.",
      },
      status: "production",
    },
    {
      title: {
        en: "Investigation Audit Trail",
        ar: "سجل تدقيق التحقيق",
      },
      what: {
        en: "Every action and status change on an investigation is written to an immutable timeline, providing a full, defensible record for internal audit, HR or regulatory review.",
        ar: "يُدوَّن كل إجراء وتغيّر في حالة التحقيق ضمن خط زمني غير قابل للتعديل، ما يوفّر سجلاً كاملاً قابلاً للاحتجاج به للتدقيق الداخلي أو الموارد البشرية أو المراجعة التنظيمية.",
      },
      status: "production",
    },
    {
      title: {
        en: "Role-Aware Access for Consultations & Investigations",
        ar: "وصول محكوم بالأدوار للاستشارات والتحقيقات",
      },
      what: {
        en: "Menus, actions and records for advisory and investigation work are scoped to each user's legal role, so investigators, advisors, approvers and directors see only what their role permits.",
        ar: "تُقصَر القوائم والإجراءات والسجلات الخاصة بأعمال الاستشارات والتحقيقات على الدور القانوني لكل مستخدم، بحيث لا يرى المحققون والمستشارون والمعتمدون والمدراء إلا ما يسمح به دورهم.",
      },
      status: "production",
    },
  ],
};
