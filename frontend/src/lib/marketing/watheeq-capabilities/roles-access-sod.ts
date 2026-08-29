import type { WatheeqDomain } from './types';

export const domain: WatheeqDomain = {
  slug: 'roles-access-sod',
  icon: 'lock',
  title: {
    en: 'Roles, Access & Separation of Duties',
    ar: 'الأدوار والوصول وفصل المهام',
  },
  intro: {
    en: 'Governance-grade access control for legal work: a ready 14-role matrix, enforced separation of duties, and a tamper-evident audit trail, so every action is authorised and every decision independently reviewed.',
    ar: 'تحكّم في الوصول بمستوى الحوكمة للعمل القانوني: مصفوفة جاهزة من 14 دورًا، وفصل مُلزَم للمهام، وسجل تدقيق محصّن ضد التلاعب، بحيث يكون كل إجراء مُخوَّلًا وكل قرار مراجَعًا بشكل مستقل.',
  },
  capabilities: [
    {
      title: {
        en: '14-Role Legal Permission Matrix',
        ar: 'مصفوفة صلاحيات قانونية من 14 دورًا',
      },
      what: {
        en: 'A ready-made set of 14 named legal-department roles, each carrying exactly the rights it needs, so teams are governed from day one instead of hand-building permissions.',
        ar: 'مجموعة جاهزة من 14 دورًا مُسمّى في الإدارة القانونية، يحمل كل منها الصلاحيات التي يحتاجها بالضبط، لتبدأ الفرق محكومةً من اليوم الأول بدلًا من بناء الصلاحيات يدويًا.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Granular View / Add / Edit / Approve / Close Rights',
        ar: 'صلاحيات دقيقة للعرض والإضافة والتعديل والاعتماد والإغلاق',
      },
      what: {
        en: 'Every action across contracts, cases, investigations, settlements, consultations and requests is governed by fine-grained View, Add, Edit, Approve and Close rights, so each user does only what their role permits.',
        ar: 'يخضع كل إجراء عبر العقود والقضايا والتحقيقات والتسويات والاستشارات والطلبات لصلاحيات دقيقة للعرض والإضافة والتعديل والاعتماد والإغلاق، بحيث لا يقوم أي مستخدم إلا بما يسمح به دوره.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Restricted Assign & Distribute Work-Allocation Rights',
        ar: 'صلاحيات مقيَّدة لإسناد الأعمال وتوزيعها',
      },
      what: {
        en: 'Assigning a case to a lawyer or distributing a contract for handling are dedicated, restricted privileges held only by managers and supervisors, so work is allocated by the right authority alone.',
        ar: 'إسناد قضية إلى محامٍ أو توزيع عقد للمعالجة صلاحيات مخصّصة ومقيَّدة يملكها المديرون والمشرفون فقط، بحيث تُوزَّع الأعمال من قِبل الجهة المخوَّلة وحدها.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Organisational-Structure-Based Access',
        ar: 'وصول مبني على الهيكل التنظيمي',
      },
      what: {
        en: "Permissions can be scoped to the org chart, so a user's rights follow the entities and units they are responsible for and cascade sensibly down the hierarchy.",
        ar: 'يمكن تحديد نطاق الصلاحيات وفق الهيكل التنظيمي، بحيث تتبع صلاحيات المستخدم الكيانات والوحدات المسؤول عنها وتتدرّج منطقيًا عبر التسلسل الهرمي.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Enterprise Single Sign-On (SSO)',
        ar: 'الدخول الموحّد للمؤسسة (SSO)',
      },
      what: {
        en: "Users sign in with their existing corporate identity through the organisation's identity provider, removing separate passwords and centralising joiner and leaver control.",
        ar: 'يسجّل المستخدمون الدخول بهويتهم المؤسسية القائمة عبر مزوّد الهوية للمؤسسة، مما يلغي كلمات المرور المنفصلة ويوحّد التحكم في المنضمّين والمغادرين.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Dynamic Separation of Duties',
        ar: 'الفصل الديناميكي للمهام',
      },
      what: {
        en: 'Whoever drafts or initiates a matter is automatically blocked from approving or closing it, even if their role would allow it, and the rule binds administrators too with no bypass.',
        ar: 'يُمنَع تلقائيًا من يصيغ المعاملة أو يبدؤها من اعتمادها أو إغلاقها، حتى لو كان دوره يسمح بذلك، وتُلزِم هذه القاعدة المسؤولين أيضًا دون أي استثناء.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Static Role-Conflict Exclusions',
        ar: 'استبعادات التعارض الثابت بين الأدوار',
      },
      what: {
        en: 'Incompatible roles cannot be granted to the same person for the same scope, and no operational role can also be the independent Auditor, so conflicts are stopped at the moment access is granted.',
        ar: 'لا يمكن منح الأدوار المتعارضة للشخص نفسه ضمن النطاق ذاته، ولا يمكن لأي دور تشغيلي أن يكون كذلك المدقّق المستقل، بحيث تُوقَف التعارضات لحظة منح الوصول.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Two-Distinct-Approver (Four-Eyes) Enforcement',
        ar: 'إلزام معتمِدَين مختلفين (مبدأ العينين)',
      },
      what: {
        en: 'On multi-step and multi-tier approvals the platform guarantees two genuinely different approvers, so high-value decisions always carry independent review.',
        ar: 'في الاعتمادات متعددة الخطوات والمستويات تضمن المنصّة وجود معتمِدَين مختلفين فعليًا، بحيث تحظى القرارات عالية القيمة دائمًا بمراجعة مستقلة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Tamper-Resistant Approve & Close Transitions',
        ar: 'انتقالات اعتماد وإغلاق محصّنة ضد التلاعب',
      },
      what: {
        en: 'Sensitive status changes such as approving or closing a matter always demand the specific approve or close right and can never be slipped through a broader general edit permission.',
        ar: 'تتطلّب تغييرات الحالة الحسّاسة كاعتماد المعاملة أو إغلاقها دائمًا صلاحية الاعتماد أو الإغلاق المحدّدة، ولا يمكن تمريرها عبر صلاحية تعديل عامة أوسع.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Delegation-of-Authority Signing Limits',
        ar: 'حدود التوقيع وفق تفويض الصلاحيات',
      },
      what: {
        en: 'Approvals that require formal signing authority are checked against verifiable delegation-of-authority evidence and value limits, so only a properly authorised person can sign off at a given value.',
        ar: 'يُتحقَّق من الاعتمادات التي تتطلّب صلاحية توقيع رسمية مقابل أدلة تفويض الصلاحيات القابلة للتحقّق وحدود القيمة، بحيث لا يوقّع عند قيمة معيّنة إلا شخص مخوَّل على النحو الصحيح.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Role-Aware Login & Persona Landing',
        ar: 'دخول واعٍ بالدور وصفحة هبوط حسب الشخصية',
      },
      what: {
        en: 'When users sign in they land directly on the workspace built for their role: a command centre for the Legal Director, the service desk for a requester, compliance for an auditor.',
        ar: 'عند تسجيل الدخول يصل المستخدمون مباشرةً إلى مساحة العمل المصمَّمة لدورهم: مركز قيادة للمدير القانوني، ومكتب الخدمة لمقدّم الطلب، والامتثال للمدقّق.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Role-Scoped Navigation & Action Gating',
        ar: 'تنقّل محدَّد بالدور وضبط للإجراءات',
      },
      what: {
        en: "The sidebar, menus and on-screen action buttons adapt to each user's role, showing only the areas and controls they are entitled to use.",
        ar: 'يتكيّف الشريط الجانبي والقوائم وأزرار الإجراءات على الشاشة مع دور كل مستخدم، فلا يظهر إلا المناطق والأدوات التي يحقّ له استخدامها.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Persona Switcher for Multi-Role Users',
        ar: 'مبدّل الشخصيات للمستخدمين متعددي الأدوار',
      },
      what: {
        en: 'Users who legitimately hold more than one legal role can switch between them from a single control, instantly re-scoping their workspace without logging out or holding multiple accounts.',
        ar: 'يمكن للمستخدمين الذين يشغلون بشكل مشروع أكثر من دور قانوني التبديل بينها من عنصر تحكّم واحد، فيُعاد تحديد نطاق مساحة عملهم فورًا دون تسجيل خروج أو امتلاك حسابات متعددة.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Effective-Permissions Session Contract',
        ar: 'عقد الجلسة للصلاحيات الفعلية',
      },
      what: {
        en: "The application always knows a signed-in user's precise effective permissions, keeping the interface and the enforced rules in step so users never see actions they will later be denied.",
        ar: 'يعرف التطبيق دائمًا الصلاحيات الفعلية الدقيقة للمستخدم المسجَّل، فيبقى الواجهة والقواعد المُطبَّقة متطابقين حتى لا يرى المستخدمون إجراءات سيُمنَعون منها لاحقًا.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Immutable Audit Log of All Operations',
        ar: 'سجل تدقيق غير قابل للتغيير لكل العمليات',
      },
      what: {
        en: 'Every material action — who did what, to which record, and when — is recorded to an append-only trail that cannot be altered or deleted, giving a complete, trustworthy history.',
        ar: 'يُسجَّل كل إجراء جوهري — من فعل ماذا، وعلى أي سجل، ومتى — في سجل إلحاقي فقط لا يمكن تغييره أو حذفه، مما يوفّر سجلًّا كاملًا وموثوقًا.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Data Encryption at Rest & in Transit',
        ar: 'تشفير البيانات عند التخزين وأثناء النقل',
      },
      what: {
        en: 'Sensitive personal and legal information — investigation details, settlement terms, contract parties and payment terms — is encrypted at the application layer and in transit.',
        ar: 'تُشفَّر المعلومات الشخصية والقانونية الحسّاسة — تفاصيل التحقيقات وشروط التسويات وأطراف العقود وشروط الدفع — على مستوى التطبيق وأثناء النقل.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'Tenant Data Isolation',
        ar: 'عزل بيانات المستأجرين',
      },
      what: {
        en: "Each organisation's data is strictly isolated at the database level, so one tenant's information can never be reached from another even through a compromised query.",
        ar: 'تُعزَل بيانات كل مؤسسة بصرامة على مستوى قاعدة البيانات، بحيث لا يمكن الوصول إلى معلومات أي مستأجر من مستأجر آخر حتى عبر استعلام مخترَق.',
      },
      status: 'production',
    },
    {
      title: {
        en: 'In-Kingdom Data Residency Enforcement',
        ar: 'إلزام إقامة البيانات داخل المملكة',
      },
      what: {
        en: "The platform can enforce that a tenant's legal data stays within a defined geographic boundary, backing sovereignty commitments with a technical control rather than a policy promise.",
        ar: 'يمكن للمنصّة أن تفرض بقاء البيانات القانونية للمستأجر داخل حدود جغرافية محدَّدة، فتدعم التزامات السيادة بضابط تقني بدلًا من وعد سياساتي.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'Attribute-Based Access Refinement',
        ar: 'تحسين الوصول المبني على السمات',
      },
      what: {
        en: 'On top of role-based rights, tenants can layer optional attribute rules — for example limiting visibility to a specific department — for finer control where a role alone is too broad.',
        ar: 'فوق الصلاحيات المبنية على الأدوار، يمكن للمستأجرين إضافة قواعد سمات اختيارية — مثل قصر الاطّلاع على إدارة محدّدة — لتحكّم أدق حين يكون الدور وحده واسعًا أكثر من اللازم.',
      },
      status: 'configurable',
    },
    {
      title: {
        en: 'One-Click Governance Provisioning for New Tenants',
        ar: 'تهيئة حوكمة بنقرة واحدة للمستأجرين الجدد',
      },
      what: {
        en: 'Standing up a new legal department automatically applies the full governance baseline — the 14-role matrix, separation-of-duties rules, service catalog, working calendar and approval templates — so a new organisation is fully governed from first login.',
        ar: 'يؤدي إنشاء إدارة قانونية جديدة إلى تطبيق خط الأساس الكامل للحوكمة تلقائيًا — مصفوفة الأدوار الأربعة عشر، وقواعد فصل المهام، وكتالوج الخدمات، وتقويم العمل، وقوالب الاعتماد — لتكون المؤسسة الجديدة محكومة بالكامل منذ أول تسجيل دخول.',
      },
      status: 'configurable',
    },
  ],
};
