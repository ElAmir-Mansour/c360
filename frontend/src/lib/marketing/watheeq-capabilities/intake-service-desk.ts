import type { WatheeqDomain } from './types';

export const domain: WatheeqDomain = {
  slug: 'intake-service-desk',
  icon: 'briefcase',
  title: { en: 'Legal Service Desk', ar: 'مكتب الخدمات القانونية' },
  intro: {
    en: 'Every legal request enters through one governed front door — captured, classified, prioritised and clocked against a service-level target from the first minute.',
    ar: 'كل طلب قانوني يدخل عبر بوابة واحدة منضبطة — يُسجَّل ويُصنَّف وتُحدَّد أولويته ويبدأ احتساب مستوى الخدمة له منذ اللحظة الأولى.',
  },
  capabilities: [
    {
      title: { en: 'Direct in-platform request submission', ar: 'رفع الطلبات مباشرة داخل المنصة' },
      what: {
        en: 'Employees and managers raise any legal request through a guided workspace that captures the mechanism, service type and beneficiary entity automatically, so nothing is misfiled.',
        ar: 'يرفع الموظفون والمديرون أي طلب قانوني عبر مساحة عمل موجَّهة تلتقط آلية الطلب ونوع الخدمة والجهة المستفيدة تلقائيًا، فلا يُصنَّف أي طلب خطأً.',
      },
      status: 'production',
    },
    {
      title: { en: 'Email-to-case intake', ar: 'تحويل البريد الإلكتروني إلى طلبات' },
      what: {
        en: 'Dedicated legal mailboxes turn inbound emails into tracked requests automatically, resolving the owning entity and request type from the address while filtering duplicates.',
        ar: 'تُحوِّل صناديق البريد القانونية المخصصة الرسائل الواردة إلى طلبات مُتابَعة تلقائيًا، مع تحديد الجهة المالكة ونوع الطلب من العنوان وتصفية الرسائل المكررة.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Automatic classification and routing', ar: 'التصنيف والتوجيه التلقائي عند الاستلام' },
      what: {
        en: 'Every incoming request is classified by mechanism, service type and beneficiary entity, then routed to the correct legal team so work starts without manual triage.',
        ar: 'يُصنَّف كل طلب وارد حسب الآلية ونوع الخدمة والجهة المستفيدة، ثم يُوجَّه إلى الفريق القانوني المختص ليبدأ العمل دون فرزٍ يدوي.',
      },
      status: 'production',
    },
    {
      title: { en: 'Eight-service legal service catalog', ar: 'كتالوج الخدمات القانونية الثماني' },
      what: {
        en: 'A ready-to-use catalog of eight core legal services — consultation, contract review, preliminary study, litigation study, enforcement request, violation study, field inspection and power-of-attorney issuance — each with its own metadata and rules.',
        ar: 'كتالوج جاهز للاستخدام يضم ثماني خدمات قانونية أساسية — الاستشارة ومراجعة العقود والدراسة الأولية ودراسة التقاضي وطلب التنفيذ ودراسة المخالفات والتفتيش الميداني وإصدار الوكالات — لكلٍّ منها بياناتها وقواعدها.',
      },
      status: 'production',
    },
    {
      title: { en: 'Admin-managed service catalog', ar: 'كتالوج خدمات يديره المسؤول' },
      what: {
        en: 'The Legal Director can add, modify or retire any legal service directly, tailoring the catalog to operational needs with no code change or vendor request.',
        ar: 'يستطيع المدير القانوني إضافة أي خدمة قانونية أو تعديلها أو إيقافها مباشرة، لتهيئة الكتالوج وفق الاحتياجات التشغيلية دون تعديل برمجي أو طلب من المورّد.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Per-service eligibility rules', ar: 'قواعد الأهلية لكل خدمة' },
      what: {
        en: 'Each service can be restricted to who may request it — all staff, department managers, or the delegation-of-authority matrix — with eligibility enforced at the moment of submission.',
        ar: 'يمكن تقييد كل خدمة بمن يحق له طلبها — جميع الموظفين أو مديري الإدارات أو مصفوفة تفويض الصلاحيات — مع فرض الأهلية لحظة رفع الطلب.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Requester and provider approval gates', ar: 'بوابات اعتماد مقدِّم الطلب ومزوِّد الخدمة' },
      what: {
        en: 'Services that need sign-off pass through a two-stage requester-then-provider approval chain aligned to the delegation-of-authority, so the right business and legal authorities approve before execution.',
        ar: 'تمر الخدمات التي تتطلب اعتمادًا عبر سلسلة موافقات من مرحلتين — مقدِّم الطلب ثم مزوِّد الخدمة — متوافقة مع تفويض الصلاحيات، ليعتمدها أصحاب الصلاحية الإداريون والقانونيون قبل التنفيذ.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Urgent / Normal priority tiers', ar: 'مستويات الأولوية: عاجل / عادي' },
      what: {
        en: 'Every request carries an Urgent or Normal priority that drives its service-level clock, keeping critical matters visibly prioritised across the queue.',
        ar: 'يحمل كل طلب أولوية عاجل أو عادي تُحرِّك احتساب مستوى الخدمة، لتظل المسائل الحرجة ظاهرة الأولوية في قائمة الانتظار.',
      },
      status: 'production',
    },
    {
      title: { en: 'Urgent-justification control', ar: 'ضابط تبرير الاستعجال' },
      what: {
        en: 'Marking a request Urgent requires a documented operational or regulatory justification, blocking urgency that stems only from a requester\'s own delay or poor planning.',
        ar: 'يتطلب تحديد الطلب كعاجل تبريرًا تشغيليًا أو تنظيميًا موثَّقًا، ما يمنع الاستعجال الناتج عن تأخُّر مقدِّم الطلب أو سوء تخطيطه.',
      },
      status: 'production',
    },
    {
      title: { en: 'Provider priority re-classification', ar: 'إعادة تصنيف الأولوية من مزوِّد الخدمة' },
      what: {
        en: 'The legal service provider can review and re-classify a request\'s priority based on its actual impact, with every change captured in the audit trail.',
        ar: 'يستطيع مزوِّد الخدمة القانونية مراجعة أولوية الطلب وإعادة تصنيفها بناءً على أثرها الفعلي، مع تسجيل كل تغيير في مسار التدقيق.',
      },
      status: 'production',
    },
    {
      title: { en: 'Per-service SLA turnaround targets', ar: 'أهداف زمن الإنجاز لكل خدمة' },
      what: {
        en: 'Turnaround targets are set per service and per priority in working days, giving each service its own committed delivery window and a basis for compliance reporting.',
        ar: 'تُحدَّد أهداف زمن الإنجاز لكل خدمة ولكل أولوية بأيام العمل، ما يمنح كل خدمة نافذة تسليم ملتزمًا بها وأساسًا لتقارير الالتزام.',
      },
      status: 'production',
    },
    {
      title: { en: 'Acknowledgement SLAs', ar: 'اتفاقيات مستوى تأكيد الاستلام' },
      what: {
        en: 'Receipt of every request is confirmed automatically within its window — one working day for Normal and four working hours for Urgent — so requesters always know their matter is in hand.',
        ar: 'يُؤكَّد استلام كل طلب تلقائيًا ضمن نافذته — يوم عمل واحد للعادي وأربع ساعات عمل للعاجل — ليطمئن مقدِّم الطلب دائمًا إلى أن مسألته قيد المعالجة.',
      },
      status: 'production',
    },
    {
      title: { en: 'Service-to-channel mapping', ar: 'ربط الخدمة بقناة الاستلام' },
      what: {
        en: 'Each legal service is mapped to its approved intake email and in-platform channel, ensuring requests always arrive through the correct, governed route.',
        ar: 'تُربط كل خدمة قانونية ببريد الاستلام المعتمد وقناتها داخل المنصة، لضمان وصول الطلبات دائمًا عبر المسار الصحيح والمنضبط.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Automatic escalation on SLA breach', ar: 'التصعيد التلقائي عند تجاوز مستوى الخدمة' },
      what: {
        en: 'When a request exceeds its defined execution time, escalation fires automatically via a continuous background monitor, surfacing breaches to management without anyone watching the clock.',
        ar: 'عند تجاوز الطلب زمن التنفيذ المحدد، يُطلَق التصعيد تلقائيًا عبر مراقبٍ خلفي مستمر، لتظهر التجاوزات للإدارة دون حاجة لمراقبة الوقت.',
      },
      status: 'production',
    },
    {
      title: { en: 'Three-level escalation ladder', ar: 'سُلَّم تصعيد من ثلاثة مستويات' },
      what: {
        en: 'Overdue requests climb a defined ladder — the section supervisor at +2 working days, the department manager at +4, and the shared-services unit manager at +6 — with each escalation emailed and logged.',
        ar: 'تتصاعد الطلبات المتأخرة عبر سُلَّم محدد — مشرف القسم المنفِّذ عند +2 يوم عمل، ومدير الإدارة عند +4، ومدير وحدة الخدمات المشتركة عند +6 — مع إرسال كل تصعيد بالبريد وتسجيله.',
      },
      status: 'configurable',
    },
    {
      title: { en: 'Live SLA operations board', ar: 'لوحة عمليات مستوى الخدمة الحية' },
      what: {
        en: 'A real-time board shows every request\'s clock, remaining time, escalation level and breach-imminent flags, giving legal operations a single view to manage the queue proactively.',
        ar: 'تعرض لوحة لحظية زمن كل طلب والوقت المتبقي ومستوى التصعيد ومؤشرات قرب التجاوز، لتمنح العمليات القانونية رؤية واحدة لإدارة القائمة بشكل استباقي.',
      },
      status: 'production',
    },
    {
      title: { en: 'Official working-calendar administration', ar: 'إدارة تقويم العمل الرسمي' },
      what: {
        en: 'Administrators manage the official working days and hours that drive every SLA and KPI calculation, so service-level math reflects how the organisation actually operates.',
        ar: 'يدير المسؤولون أيام وساعات العمل الرسمية التي تُحرِّك كل حسابات مستوى الخدمة ومؤشرات الأداء، لتعكس الحسابات طريقة عمل المؤسسة فعليًا.',
      },
      status: 'production',
    },
    {
      title: { en: 'Ramadan hours and holiday configuration', ar: 'تهيئة ساعات رمضان والإجازات' },
      what: {
        en: 'Configure year-round hours, reduced Ramadan hours, weekly rest days, and official and religious holidays, so deadlines never fall due on a non-working day.',
        ar: 'تهيئة ساعات العمل على مدار العام وساعات رمضان المخفَّضة وأيام الراحة الأسبوعية والإجازات الرسمية والدينية، حتى لا تحل المواعيد النهائية في يوم غير عمل.',
      },
      status: 'production',
    },
    {
      title: { en: 'Working-day SLA calculation engine', ar: 'محرك احتساب مستوى الخدمة بأيام العمل' },
      what: {
        en: 'All durations and deadlines are computed strictly on approved working days and hours, giving accurate, defensible turnaround figures that skip weekends and holidays automatically.',
        ar: 'تُحتسب جميع المدد والمواعيد النهائية حصرًا على أيام وساعات العمل المعتمدة، لتقديم أرقام إنجاز دقيقة وقابلة للإثبات تتجاوز العطلات الأسبوعية والإجازات تلقائيًا.',
      },
      status: 'production',
    },
  ],
};
