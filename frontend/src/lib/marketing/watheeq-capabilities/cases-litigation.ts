import type { WatheeqDomain } from './types';

export const domain: WatheeqDomain = {
  slug: 'cases-litigation',
  icon: 'scale',
  title: { en: "Cases & Litigation", ar: "القضايا والتقاضي" },
  intro: {
    en: "From the first directive to the final judgment, govern every case, hearing, pleading and objection in one auditable, deadline-aware litigation workspace.",
    ar: "من التوجيه الأول حتى الحكم النهائي، أدِر كل قضية وجلسة ومذكرة واعتراض في مساحة تقاضٍ واحدة قابلة للتدقيق وواعية بالمواعيد.",
  },
  capabilities: [
    {
      title: { en: "Two-Phase Legal Case Intake", ar: "استقبال القضايا على مرحلتين" },
      what: {
        en: "Departments raise a legal-action request that routes up the management hierarchy to a CEO directive; Phase 1 qualifies and gathers evidence, Phase 2 opens the managed case.",
        ar: "ترفع الإدارات طلب إجراء قانوني يمر عبر التسلسل الإداري وصولًا إلى توجيه الرئيس التنفيذي؛ المرحلة الأولى للتأهيل وجمع الأدلة، والثانية لفتح القضية وإدارتها.",
      },
      status: 'production',
    },
    {
      title: { en: "Case-Strength Assessment", ar: "تقييم قوة القضية" },
      what: {
        en: "Records the legal team's assessment of the company's position and case strength so leadership can decide whether to proceed, settle or object.",
        ar: "يوثّق تقييم الفريق القانوني لموقف المنشأة وقوة القضية ليقرّر القياديون المضي أو التسوية أو الاعتراض.",
      },
      status: 'production',
    },
    {
      title: { en: "Case Assignment & Supervision", ar: "إسناد القضايا والإشراف عليها" },
      what: {
        en: "The Legal Director hands a case to the section manager, who assigns a supervisor and a handling officer, with every hand-off recorded on an auditable trail.",
        ar: "يُسند المدير القانوني القضية إلى مدير القسم الذي يعيّن مشرفًا وموظفًا مباشرًا للمتابعة، مع تسجيل كل إحالة في سجل قابل للتدقيق.",
      },
      status: 'production',
    },
    {
      title: { en: "Case Task Planning & Prioritisation", ar: "تخطيط مهام القضية وتحديد أولوياتها" },
      what: {
        en: "Estimate, define and assign the tasks that progress a case and set its priority, so the team focuses on what matters most and tracks delivery.",
        ar: "تقدير المهام اللازمة للسير في القضية وتعريفها وإسنادها وتحديد أولويتها، ليركّز الفريق على الأهم ويتابع الإنجاز.",
      },
      status: 'production',
    },
    {
      title: { en: "Central Case Register", ar: "السجل المركزي للقضايا" },
      what: {
        en: "A single searchable register of every case: case and court numbers, type and classification, company status, competent court, parties, key dates, hearings, documents and the responsible lawyer.",
        ar: "سجل موحّد قابل للبحث يضم كل قضية: أرقام القضية والمحكمة، والنوع والتصنيف، وصفة المنشأة، والمحكمة المختصة، والأطراف، والتواريخ المهمة، والجلسات، والمستندات، والمحامي المسؤول.",
      },
      status: 'production',
    },
    {
      title: { en: "Case Classification Taxonomy", ar: "تصنيف القضايا" },
      what: {
        en: "Pre-built, multi-level classification covering eviction, rent, fair-rent, tax, labour, commercial, enforcement and investigations, kept consistent and admin-extensible.",
        ar: "تصنيف متعدد المستويات جاهز يشمل الإخلاء والأجرة والأجرة العادلة والضريبة والعمل والتجارة والتنفيذ والتحقيقات، بشكل موحّد وقابل للتوسعة من المسؤول.",
      },
      status: 'production',
    },
    {
      title: { en: "Cascading Rental-Dispute Classification", ar: "تصنيف نزاعات الإيجار المتسلسلة" },
      what: {
        en: "Links a rental dispute's natural escalation, from eviction to rent claim to fair-rent to tax committee, as connected sub-cases under one parent matter.",
        ar: "يربط التصاعد الطبيعي لنزاع الإيجار، من الإخلاء إلى المطالبة بالأجرة إلى الأجرة العادلة إلى اللجنة الضريبية، كقضايا فرعية مترابطة تحت قضية أم واحدة.",
      },
      status: 'production',
    },
    {
      title: { en: "Plaintiff — Statement of Claim Drafting", ar: "المدّعي — صياغة صحيفة الدعوى" },
      what: {
        en: "Prepare the lawsuit and draft the statement of claim with versioned drafts and supporting attachments, accelerated by optional AI assistance.",
        ar: "إعداد الدعوى وصياغة صحيفة الدعوى مع مسودات محفوظة الإصدارات ومرفقات داعمة، مع تسريع اختياري بمساعدة الذكاء الاصطناعي.",
      },
      status: 'production',
    },
    {
      title: { en: "Statement of Claim Approval", ar: "اعتماد صحيفة الدعوى" },
      what: {
        en: "The statement of claim is approved through a controlled workflow that guarantees the approver is never the drafter before the claim is filed.",
        ar: "تُعتمد صحيفة الدعوى عبر مسار محكوم يضمن أن يكون المعتمِد شخصًا مختلفًا عن مُعِدّها قبل رفعها.",
      },
      status: 'production',
    },
    {
      title: { en: "Hearing & Session Management", ar: "إدارة الجلسات والمرافعات" },
      what: {
        en: "Register hearing dates, submit hearing reports, attach session minutes and record court decisions, keeping each case's full procedural history in one place.",
        ar: "تسجيل مواعيد الجلسات، ورفع تقاريرها، وإرفاق ضبط الجلسة، وتوثيق قرارات المحكمة، مع حفظ التاريخ الإجرائي الكامل لكل قضية في مكان واحد.",
      },
      status: 'production',
    },
    {
      title: { en: "Court Expert Management", ar: "إدارة الخبراء القضائيين" },
      what: {
        en: "Register an expert assignment, track expert requests through the case, and upload the documents the court expert requires, keeping the engagement fully evidenced.",
        ar: "تسجيل ندب الخبير، وتتبّع طلباته خلال القضية، ورفع المستندات التي يطلبها الخبير القضائي، مع توثيق التعامل بالكامل.",
      },
      status: 'production',
    },
    {
      title: { en: "Judgment Lifecycle & Objection Management", ar: "دورة حياة الحكم وإدارة الاعتراض" },
      what: {
        en: "Record the judgment, study its implications, recommend objection or acceptance, and manage objection deadlines so statutory appeal windows are never missed.",
        ar: "توثيق الحكم، ودراسة آثاره، والتوصية بالاعتراض أو القبول، وإدارة مواعيد الاعتراض بحيث لا تفوت مهل الاستئناف النظامية.",
      },
      status: 'production',
    },
    {
      title: { en: "Defendant — Inbound Lawsuit Receipt", ar: "المدّعى عليه — استلام الدعاوى الواردة" },
      what: {
        en: "Register an incoming lawsuit filed against the company together with its official notification date, starting the defence clock and the response procedure.",
        ar: "تسجيل الدعوى الواردة المرفوعة ضد المنشأة مع تاريخ التبليغ الرسمي، بما يبدأ مهلة الدفاع وإجراءات الرد.",
      },
      status: 'production',
    },
    {
      title: { en: "Najiz Court-Portal Representation & Sync", ar: "التمثيل والمزامنة مع بوابة ناجز" },
      what: {
        en: "Adds the company's authorised representative and synchronises defendant case data with the Ministry of Justice Najiz portal, with seamless manual entry until the portal is connected.",
        ar: "إضافة ممثل المنشأة المفوّض ومزامنة بيانات قضايا المدّعى عليه مع بوابة ناجز التابعة لوزارة العدل، مع إدخال يدوي سلس حتى يتم الربط.",
      },
      status: 'production',
    },
    {
      title: { en: "Defendant Response Memo & Two-Tier Review", ar: "مذكرة رد المدّعى عليه ومراجعتها على مستويين" },
      what: {
        en: "Upload the statement of claim, notify the concerned department, prepare the first response memo, and route it through two-tier supervisor and section-manager approval.",
        ar: "رفع صحيفة الدعوى، وإشعار الإدارة المعنية، وإعداد مذكرة الرد الأولى، وتمريرها عبر اعتماد على مستويين من المشرف ومدير القسم.",
      },
      status: 'production',
    },
    {
      title: { en: "Investigations Register & Findings Sign-off", ar: "سجل التحقيقات واعتماد النتائج" },
      what: {
        en: "Register an internal investigation, capture parties, record statements and testimonies, upload evidence, and document results with a controlled approval of the findings.",
        ar: "تسجيل التحقيق الداخلي، وتوثيق الأطراف، وتدوين الأقوال والشهادات، ورفع الأدلة، وتوثيق النتائج مع اعتماد محكوم لها.",
      },
      status: 'production',
    },
    {
      title: { en: "External-Dependency Timelines & Delay Tracking", ar: "الجداول الزمنية للقضايا المعتمدة على أطراف خارجية وتتبّع التأخير" },
      what: {
        en: "For cases that depend on outside parties, allow estimated durations without a fixed close date, record delay reasons, flag externally-pending cases and classify each cause.",
        ar: "للقضايا المعتمدة على أطراف خارجية، يسمح بمُدد تقديرية دون تاريخ إغلاق ثابت، ويوثّق أسباب التأخير، ويميّز القضايا المعلّقة على أطراف خارجية ويصنّف كل سبب.",
      },
      status: 'production',
    },
    {
      title: { en: "Case Portfolio Timeline Overview", ar: "نظرة زمنية على محفظة القضايا" },
      what: {
        en: "A cross-case portfolio view of durations, holds and delays so legal leadership sees at a glance which matters are stalled and why.",
        ar: "عرض شامل لمحفظة القضايا يبيّن المدد والتعليقات والتأخيرات، ليرى القياديون القانونيون بلمحة أي القضايا متعثّرة ولماذا.",
      },
      status: 'production',
    },
    {
      title: { en: "Legal Hold & Preservation", ar: "الحجز القانوني وحفظ الأدلة" },
      what: {
        en: "Places an enforced legal hold on a matter, contract or document so it cannot be deleted, archived or modified while preserved, and releases it when the hold is lifted.",
        ar: "يفرض حجزًا قانونيًا على قضية أو عقد أو مستند بحيث لا يمكن حذفه أو أرشفته أو تعديله أثناء الحفظ، ويُرفع الحجز عند انتهائه.",
      },
      status: 'production',
    },
    {
      title: { en: "Case Documents & Attachments", ar: "مستندات القضية ومرفقاتها" },
      what: {
        en: "Attach, list and manage documents against any case, hearing, pleading, expert or investigation, keeping every file linked to the record it belongs to.",
        ar: "إرفاق المستندات وعرضها وإدارتها على أي قضية أو جلسة أو مذكرة أو خبير أو تحقيق، مع ربط كل ملف بالسجل الذي يخصّه.",
      },
      status: 'production',
    },
    {
      title: { en: "Case Audit Trail & Version History", ar: "سجل تدقيق القضية وتاريخ الإصدارات" },
      what: {
        en: "Every change to a case, party, hearing, task or decision is recorded with who did what and when, and prior versions are retained for a defensible, tamper-evident record.",
        ar: "يُسجَّل كل تغيير على القضية أو الأطراف أو الجلسة أو المهمة أو القرار مع مَن قام به ومتى، مع حفظ الإصدارات السابقة لسجل موثوق يصعب العبث به.",
      },
      status: 'production',
    },
    {
      title: { en: "Separation of Duties on Case Decisions", ar: "الفصل بين المهام في قرارات القضايا" },
      what: {
        en: "Approval and decision points across intake, pleadings, defendant memos and investigations are governed by a 14-role duties matrix, so no one can both prepare and approve, with no administrator bypass.",
        ar: "تخضع نقاط الاعتماد والقرار في الاستقبال والمذكرات ومذكرات المدّعى عليه والتحقيقات لمصفوفة مهام من 14 دورًا، بما يمنع أن يُعِدّ الشخص ويعتمد في آنٍ واحد، دون أي تجاوز إداري.",
      },
      status: 'production',
    },
  ],
};
