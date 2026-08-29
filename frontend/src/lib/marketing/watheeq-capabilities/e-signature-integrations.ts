import type { WatheeqDomain } from './types';

export const domain: WatheeqDomain = {
  slug: 'e-signature-integrations',
  icon: 'pen',
  title: { en: 'E-Signature & Integrations', ar: 'التوقيع الإلكتروني والتكاملات' },
  intro: {
    en: "Sign contracts natively or through licensed Saudi trust services, and connect the legal suite to your identity, HR, court and enterprise systems — all governed and in-Kingdom.",
    ar: "وقّع العقود محلياً أو عبر خدمات الثقة السعودية المرخّصة، واربط المنظومة القانونية بأنظمة الهوية والموارد البشرية والمحاكم والأنظمة المؤسسية — كل ذلك محوكم وداخل المملكة.",
  },
  capabilities: [
    {
      title: { en: "Electronic Signature Envelopes", ar: "مظاريف التوقيع الإلكتروني" },
      what: {
        en: "Package any document for signature with ordered signers, approvers and deadlines, using built-in native signing (one-time-passcode and wet-signature tracking) with no external provider required.",
        ar: "تجهيز أي مستند للتوقيع مع ترتيب الموقّعين والمعتمدين والمواعيد النهائية، باستخدام توقيع أصلي مدمج (رمز تحقق لمرة واحدة وتتبّع للتوقيع الورقي) دون الحاجة إلى مزوّد خارجي.",
      },
      status: 'production',
    },
    {
      title: { en: "Bilingual / Arabic Signing Experience", ar: "تجربة توقيع ثنائية اللغة / عربية" },
      what: {
        en: "Present each signer's screen, consent text and instructions in their preferred language, with full Arabic right-to-left rendering or a side-by-side bilingual view.",
        ar: "عرض شاشة كل موقّع ونص الموافقة والتعليمات بلغته المفضّلة، مع عرض عربي كامل من اليمين إلى اليسار أو عرض ثنائي اللغة جنباً إلى جنب.",
      },
      status: 'production',
    },
    {
      title: { en: "Signature Chain-of-Custody & Evidence", ar: "سلسلة عهدة التوقيع والأدلة" },
      what: {
        en: "Capture every signing action in an immutable custody trail with proof of consent and precise timestamps, producing a defensible evidentiary record for audit and dispute.",
        ar: "تسجيل كل إجراء توقيع في سجل عهدة غير قابل للتعديل مع إثبات الموافقة والطوابع الزمنية الدقيقة، مما ينتج سجلاً إثباتياً موثوقاً للتدقيق والنزاعات.",
      },
      status: 'production',
    },
    {
      title: { en: "Signatory Authority & Delegation Validation", ar: "التحقق من صلاحية الموقّع وتفويض الصلاحيات" },
      what: {
        en: "Validate that a signer is genuinely authorised — checking their digital certificate and Delegation-of-Authority document — before any signature is accepted.",
        ar: "التحقق من أن الموقّع مفوّض فعلاً عبر فحص شهادته الرقمية ووثيقة تفويض الصلاحيات قبل قبول أي توقيع.",
      },
      status: 'configurable',
    },
    {
      title: { en: "Qualified Electronic Signature (emdha)", ar: "التوقيع الإلكتروني المعتمد (إمضاء)" },
      what: {
        en: "Apply a legally binding qualified electronic signature through emdha, a licensed Saudi Trust Service Provider, for contracts that demand the highest evidentiary weight.",
        ar: "إضافة توقيع إلكتروني معتمد وملزم قانوناً عبر «إمضاء»، مزوّد خدمات الثقة السعودي المرخّص، للعقود التي تتطلب أعلى قوة إثباتية.",
      },
      status: 'production',
    },
    {
      title: { en: "Nafath National Identity Confirmation", ar: "تأكيد الهوية الوطنية عبر نفاذ" },
      what: {
        en: "Confirm a signer's national identity through Nafath number-match verification, providing the identity-assurance foundation for identity-confirmed signing.",
        ar: "تأكيد الهوية الوطنية للموقّع عبر التحقق بمطابقة الرقم في «نفاذ»، مما يوفّر أساس ضمان الهوية للتوقيع الموثّق بالهوية.",
      },
      status: 'production',
    },
    {
      title: { en: "Single Sign-On (OIDC / SAML 2.0)", ar: "الدخول الموحّد (OIDC / SAML 2.0)" },
      what: {
        en: "Let users sign in with the organisation's existing identity provider over standard OpenID Connect or SAML 2.0, removing separate passwords and centralising access control.",
        ar: "تمكين المستخدمين من تسجيل الدخول عبر مزوّد الهوية القائم لدى المؤسسة باستخدام معايير OpenID Connect أو SAML 2.0، مما يلغي كلمات المرور المنفصلة ويوحّد التحكم بالوصول.",
      },
      status: 'configurable',
    },
    {
      title: { en: "Automated User Provisioning (SCIM 2.0)", ar: "التزويد التلقائي للمستخدمين (SCIM 2.0)" },
      what: {
        en: "Automatically create, update and deactivate accounts in step with the organisation's identity directory using standard SCIM 2.0, so joiners, movers and leavers are handled without manual administration.",
        ar: "إنشاء الحسابات وتحديثها وتعطيلها تلقائياً بالتزامن مع دليل هوية المؤسسة باستخدام معيار SCIM 2.0، لتُعالَج حالات الالتحاق والنقل والمغادرة دون إدارة يدوية.",
      },
      status: 'configurable',
    },
    {
      title: { en: "HR / HRIS System Integration", ar: "التكامل مع أنظمة الموارد البشرية" },
      what: {
        en: "Synchronise employees, departments and reporting lines from the organisation's HR platform via SCIM or its own API, keeping the legal directory and approval routing accurate.",
        ar: "مزامنة الموظفين والإدارات وخطوط التبعية من منصة الموارد البشرية للمؤسسة عبر SCIM أو واجهتها البرمجية، للحفاظ على دقة الدليل القانوني وتوجيه الاعتمادات.",
      },
      status: 'configurable',
    },
    {
      title: { en: "e-Archiving / Records System Integration", ar: "التكامل مع أنظمة الأرشفة الإلكترونية والسجلات" },
      what: {
        en: "Push executed contracts and legal records into the organisation's enterprise archive under write-once retention with legal-hold protection, so records cannot be altered or deleted before their retention period ends.",
        ar: "دفع العقود المنفّذة والسجلات القانونية إلى الأرشيف المؤسسي تحت حفظ يُكتب مرة واحدة مع حماية بالحجز القانوني، بحيث لا يمكن تعديل السجلات أو حذفها قبل انتهاء مدة الاحتفاظ بها.",
      },
      status: 'configurable',
    },
    {
      title: { en: "Email Integration (Inbound & Outbound)", ar: "التكامل مع البريد الإلكتروني (وارد وصادر)" },
      what: {
        en: "Send outbound legal notifications over the organisation's mail service and automatically turn emails to a dedicated mailbox into legal requests, with mailbox-to-type and mailbox-to-entity routing.",
        ar: "إرسال الإشعارات القانونية الصادرة عبر خدمة بريد المؤسسة وتحويل الرسائل الواردة إلى صندوق مخصّص إلى طلبات قانونية تلقائياً، مع توجيه حسب نوع الطلب والجهة.",
      },
      status: 'configurable',
    },
    {
      title: { en: "Najiz (MOJ) Court-Portal Integration", ar: "التكامل مع بوابة ناجز (وزارة العدل)" },
      what: {
        en: "Connect to the Ministry of Justice Najiz portal to pull hearings, case status, judgments and enforcement cases, and to register company representatives and legal agencies for litigation.",
        ar: "الربط مع بوابة ناجز التابعة لوزارة العدل لجلب الجلسات وحالة القضايا والأحكام وقضايا التنفيذ، ولتسجيل ممثّلي الشركة والوكالات القانونية للتقاضي.",
      },
      status: 'production',
    },
    {
      title: { en: "Internal Systems Integration (Custom REST)", ar: "التكامل مع الأنظمة الداخلية (REST مخصّص)" },
      what: {
        en: "Connect to the organisation's own back-office systems with secure signed outbound webhooks and authenticated inbound webhooks, enabling two-way data exchange without custom development.",
        ar: "الربط مع الأنظمة الخلفية للمؤسسة عبر روابط ويب صادرة موقّعة وآمنة وروابط واردة موثّقة، لتمكين تبادل البيانات في الاتجاهين دون تطوير مخصّص.",
      },
      status: 'configurable',
    },
    {
      title: { en: "Admin Integrations Console", ar: "وحدة تحكّم التكاملات للمشرفين" },
      what: {
        en: "A self-service console where administrators browse a connector gallery, follow guided onboarding, configure and test connections in a sandbox, and monitor every integration's health from one place.",
        ar: "وحدة تحكّم ذاتية الخدمة يتصفّح فيها المشرفون معرض الموصّلات، ويتّبعون خطوات إعداد موجّهة، ويهيّئون الاتصالات ويختبرونها في بيئة تجريبية، ويراقبون صحة كل تكامل من مكان واحد.",
      },
      status: 'production',
    },
    {
      title: { en: "Integration Change Governance (Maker-Checker)", ar: "حوكمة تغييرات التكامل (المُنشئ والمدقّق)" },
      what: {
        en: "Every change to an integration is proposed by one administrator and approved by another before it takes effect, enforcing separation of duties on live connections.",
        ar: "يُقترح كل تغيير على أي تكامل من مشرف ويُعتمد من مشرف آخر قبل أن يصبح نافذاً، مما يفرض الفصل بين المهام على الاتصالات الحيّة.",
      },
      status: 'production',
    },
    {
      title: { en: "Integration Reliability (Retry, Dead-Letter & Circuit Breaker)", ar: "موثوقية التكامل (إعادة المحاولة والرسائل المعلّقة وقاطع الدائرة)" },
      what: {
        en: "Failed messages are captured in a replayable queue, a circuit breaker isolates an unhealthy external system, and administrators can inspect and re-run failed items, so transient outages never lose data.",
        ar: "تُحفظ الرسائل الفاشلة في طابور قابل لإعادة التشغيل، ويعزل قاطع الدائرة أي نظام خارجي متعطّل، ويمكن للمشرفين فحص العناصر الفاشلة وإعادة تشغيلها، فلا تفقد الأعطال المؤقتة أي بيانات.",
      },
      status: 'production',
    },
    {
      title: { en: "Integration Observability & Event Inspector", ar: "مراقبة التكاملات وفاحص الأحداث" },
      what: {
        en: "Live metrics, per-connector health history and a searchable inbound/outbound event log give administrators full visibility, with the ability to inspect and replay individual events.",
        ar: "مقاييس حيّة وسجل صحة لكل موصّل وسجل أحداث وارد وصادر قابل للبحث تمنح المشرفين رؤية كاملة، مع إمكانية فحص الأحداث الفردية وإعادة تشغيلها.",
      },
      status: 'production',
    },
    {
      title: { en: "Data-Residency & Egress Controls", ar: "ضوابط إقامة البيانات والتصدير" },
      what: {
        en: "Set per-connector policies that govern which data fields may leave the platform and where they may be sent, keeping sensitive legal and personal data within approved boundaries.",
        ar: "ضبط سياسات لكل موصّل تحكم أي حقول بيانات يُسمح لها بمغادرة المنصة وإلى أين تُرسل، لإبقاء البيانات القانونية والشخصية الحسّاسة ضمن الحدود المعتمدة.",
      },
      status: 'configurable',
    },
    {
      title: { en: "Credential Vault & Secret Rotation", ar: "خزنة بيانات الاعتماد وتدوير الأسرار" },
      what: {
        en: "Integration credentials and signing secrets are stored securely and can be rotated on demand without downtime, reducing the risk of stale or compromised keys.",
        ar: "تُخزّن بيانات اعتماد التكامل وأسرار التوقيع بأمان ويمكن تدويرها عند الطلب دون توقّف، مما يقلّل مخاطر المفاتيح القديمة أو المخترقة.",
      },
      status: 'production',
    },
    {
      title: { en: "No-Code Custom Connector & Sync Rules", ar: "موصّل مخصّص وقواعد مزامنة بدون برمجة" },
      what: {
        en: "Administrators can define a new connector and its data-mapping and synchronisation rules through configuration rather than code, with a conflict queue to resolve mismatches.",
        ar: "يمكن للمشرفين تعريف موصّل جديد وقواعد ربط بياناته ومزامنته عبر الإعداد بدلاً من البرمجة، مع طابور تعارضات لحل حالات عدم التطابق.",
      },
      status: 'configurable',
    },
  ],
};
