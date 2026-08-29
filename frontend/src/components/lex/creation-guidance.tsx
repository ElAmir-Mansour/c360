"use client";

import { Lightbulb, CheckCircle2 } from "lucide-react";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";

export type LexCreationWorkflow =
  | "case"
  | "consultation"
  | "contract"
  | "investigation"
  | "matter"
  | "settlement"
  | "regulation"
  | "playbook"
  | "document"
  | "signature"
  | "clause"
  | "service-request"
  | "integration"
  | "report"
  | "policy"
  | "classification"
  | "organization"
  | "service"
  | "calendar"
  | "legal-hold";

interface GuidanceCopy {
  title: string;
  body: string;
  checklist: string;
}

const EN: Record<LexCreationWorkflow, GuidanceCopy> = {
  case: {
    title: "Start with the facts that drive the case",
    body: "Classification, priority, parties, and the responsible officer determine routing, reporting, and deadline visibility.",
    checklist: "Confirm the case reference and key dates before creating the record.",
  },
  consultation: {
    title: "Make the legal question answerable",
    body: "State the requested outcome, business context, urgency, and due date so the right advisor and SLA can be applied.",
    checklist: "Attach the documents an advisor will need to respond without follow-up.",
  },
  contract: {
    title: "Use the source agreement as the reference",
    body: "Parties, value, owner, effective dates, and contract type power approvals, renewals, risk, and portfolio statistics.",
    checklist: "Upload the latest version and verify dates before starting review.",
  },
  investigation: {
    title: "Define a clear investigation scope",
    body: "The subject, allegation, priority, owner, and confidentiality setting control access, evidence handling, and escalation.",
    checklist: "Record only verified initial facts; observations can be added as evidence later.",
  },
  matter: {
    title: "Create one authoritative matter record",
    body: "Matter type, priority, owner, department, and linked records drive workload, exposure, and obligation reporting.",
    checklist: "Link the originating request or contract when one already exists.",
  },
  settlement: {
    title: "Anchor the settlement to its matter",
    body: "Counterparty, value, owner, target dates, and approval context feed negotiation, recovery, and settlement analytics.",
    checklist: "Use the latest agreed commercial position, not an earlier offer.",
  },
  regulation: {
    title: "Capture the authoritative regulatory source",
    body: "Jurisdiction, issuer, effective date, topic, and source reference determine applicability and compliance follow-up.",
    checklist: "Link the official publication whenever it is available.",
  },
  playbook: {
    title: "Turn policy into review rules",
    body: "Scope, contract type, required clauses, thresholds, and fallback language determine how deviations are detected.",
    checklist: "Keep rules specific enough that reviewers can act on each result.",
  },
  document: {
    title: "Register the document with usable metadata",
    body: "Document type, confidentiality, owner, retention details, and the initial file drive search, access, and governance.",
    checklist: "Upload the current authoritative file and use a title others can find.",
  },
  signature: {
    title: "Check the signing order before sending",
    body: "The target document, recipient identities, order, due date, and provider settings determine the execution workflow.",
    checklist: "Verify every email address and signer role before creating the envelope.",
  },
  clause: {
    title: "Save reusable, approved clause language",
    body: "Clause type, jurisdiction, language, risk level, and fallback text make the clause discoverable during drafting and review.",
    checklist: "Remove transaction-specific names and values before saving.",
  },
  "service-request": {
    title: "Give Legal enough context to route the request",
    body: "Service, beneficiary, requested outcome, priority, due date, and attachments determine eligibility, ownership, and SLA.",
    checklist: "Review the summary before submission; missing context can delay routing.",
  },
  integration: {
    title: "Validate the connection before activation",
    body: "Environment, endpoint, authentication, mapping, and sync direction determine what data can enter or leave Lex.",
    checklist: "Use test credentials first and review the preview before enabling writes.",
  },
  report: {
    title: "Build the report around one decision",
    body: "Dataset, measures, grouping, filters, and date range determine every displayed statistic and exported row.",
    checklist: "Preview the result and drill into a sample before saving.",
  },
  policy: {
    title: "Make the rule easy to predict",
    body: "Scope, conditions, precedence, approvers, and exceptions determine which records the policy affects and what happens next.",
    checklist: "Test the narrowest intended scenario and check for overlap before enabling it.",
  },
  classification: {
    title: "Choose a stable place in the taxonomy",
    body: "Code, parent, names, and status control navigation, reporting groups, and where teams can select this classification.",
    checklist: "Search for an equivalent code or sibling before creating another category.",
  },
  organization: {
    title: "Model the operating structure, not a temporary team",
    body: "Entity code, hierarchy, jurisdiction, and ownership influence access, routing, reporting, and record attribution.",
    checklist: "Confirm the parent entity and use the official legal or operating name.",
  },
  service: {
    title: "Design the intake path from the requester’s view",
    body: "Eligibility, questions, routing, approvals, mailbox settings, and SLA determine who can request the service and how Legal receives it.",
    checklist: "Preview the form and submit a test request before publishing it.",
  },
  calendar: {
    title: "Define the working time used by SLA clocks",
    body: "Time zone, working days, hours, and holidays determine when deadlines advance or pause across linked services.",
    checklist: "Verify overnight hours, local holidays, and daylight-saving behavior where applicable.",
  },
  "legal-hold": {
    title: "Preserve the right information from the start",
    body: "Matter scope, custodians, systems, dates, and instructions determine what must be retained and who must acknowledge the hold.",
    checklist: "Confirm the custodian list and preservation start date before issuing notices.",
  },
};

const AR: Record<LexCreationWorkflow, GuidanceCopy> = {
  case: { title: "ابدأ بالحقائق التي توجّه القضية", body: "يحدد التصنيف والأولوية والأطراف والمسؤول مسار الإحالة والتقارير ووضوح المواعيد.", checklist: "تحقق من مرجع القضية والتواريخ الأساسية قبل إنشاء السجل." },
  consultation: { title: "اجعل المسألة القانونية قابلة للإجابة", body: "وضّح النتيجة المطلوبة وسياق العمل والاستعجال وتاريخ الاستحقاق لتطبيق المستشار واتفاقية الخدمة المناسبة.", checklist: "أرفق المستندات التي يحتاجها المستشار لتجنب طلب معلومات إضافية." },
  contract: { title: "اعتمد الاتفاقية الأصلية كمرجع", body: "تغذي الأطراف والقيمة والمالك وتواريخ السريان ونوع العقد الموافقات والتجديدات والمخاطر والإحصاءات.", checklist: "ارفع أحدث نسخة وتحقق من التواريخ قبل بدء المراجعة." },
  investigation: { title: "حدّد نطاقاً واضحاً للتحقيق", body: "يتحكم الموضوع والادعاء والأولوية والمالك والسرية في الوصول ومعالجة الأدلة والتصعيد.", checklist: "سجّل الحقائق الأولية المتحققة فقط، ويمكن إضافة الملاحظات لاحقاً كأدلة." },
  matter: { title: "أنشئ سجلاً مرجعياً واحداً للمسألة", body: "يحدد النوع والأولوية والمالك والإدارة والسجلات المرتبطة عبء العمل والتعرض وتقارير الالتزامات.", checklist: "اربط الطلب أو العقد الأصلي عند وجوده." },
  settlement: { title: "اربط التسوية بالمسألة الأصلية", body: "تغذي الجهة المقابلة والقيمة والمالك والتواريخ وسياق الموافقة التفاوض والتحصيل وتحليلات التسويات.", checklist: "استخدم أحدث موقف تجاري متفق عليه وليس عرضاً سابقاً." },
  regulation: { title: "سجّل المصدر التنظيمي الرسمي", body: "يحدد الاختصاص والجهة المصدرة وتاريخ النفاذ والموضوع والمرجع نطاق التطبيق والمتابعة.", checklist: "اربط النشر الرسمي متى كان متاحاً." },
  playbook: { title: "حوّل السياسة إلى قواعد مراجعة", body: "يحدد النطاق ونوع العقد والبنود المطلوبة والحدود والصياغة البديلة كيفية اكتشاف الانحرافات.", checklist: "اجعل كل قاعدة محددة بما يكفي لاتخاذ إجراء واضح." },
  document: { title: "سجّل الوثيقة ببيانات قابلة للاستخدام", body: "يحدد النوع والسرية والمالك والاحتفاظ والملف الأولي البحث والوصول والحوكمة.", checklist: "ارفع الملف الرسمي الحالي واستخدم عنواناً يسهل العثور عليه." },
  signature: { title: "تحقق من ترتيب التوقيع قبل الإرسال", body: "تحدد الوثيقة والمستلمون والترتيب والموعد وإعدادات المزوّد مسار التنفيذ.", checklist: "تحقق من البريد الإلكتروني وصفة كل موقّع قبل إنشاء المغلف." },
  clause: { title: "احفظ صياغة بند معتمدة وقابلة لإعادة الاستخدام", body: "يجعل النوع والاختصاص واللغة ومستوى المخاطر والصياغة البديلة البند قابلاً للاكتشاف.", checklist: "أزل الأسماء والقيم الخاصة بالمعاملة قبل الحفظ." },
  "service-request": { title: "زوّد الإدارة القانونية بسياق كافٍ للإحالة", body: "تحدد الخدمة والمستفيد والنتيجة والأولوية والموعد والمرفقات الأهلية والملكية واتفاقية الخدمة.", checklist: "راجع الملخص قبل الإرسال؛ نقص السياق قد يؤخر الإحالة." },
  integration: { title: "تحقق من الاتصال قبل التفعيل", body: "تحدد البيئة ونقطة النهاية والمصادقة والربط واتجاه المزامنة البيانات التي تدخل إلى ليكس أو تخرج منه.", checklist: "استخدم بيانات اختبار أولاً وراجع المعاينة قبل تمكين الكتابة." },
  report: { title: "ابنِ التقرير حول قرار واحد", body: "تحدد مجموعة البيانات والمقاييس والتجميع والمرشحات والفترة كل إحصائية وصف مُصدّر.", checklist: "عاين النتيجة وافتح عينة من السجلات قبل الحفظ." },
  policy: { title: "اجعل نتيجة القاعدة قابلة للتوقع", body: "يحدد النطاق والشروط والأولوية والموافقون والاستثناءات السجلات المتأثرة والخطوة التالية.", checklist: "اختبر أضيق سيناريو مقصود وتحقق من عدم تداخل القواعد قبل التفعيل." },
  classification: { title: "اختر موضعاً ثابتاً في شجرة التصنيف", body: "يتحكم الرمز والأصل والأسماء والحالة في التنقل ومجموعات التقارير ومواضع اختيار التصنيف.", checklist: "ابحث عن رمز أو تصنيف مماثل قبل إنشاء فئة أخرى." },
  organization: { title: "مثّل الهيكل التشغيلي المستقر", body: "يؤثر رمز الكيان والتسلسل والاختصاص والملكية في الوصول والإحالة والتقارير ونسبة السجلات.", checklist: "تحقق من الكيان الأصل واستخدم الاسم القانوني أو التشغيلي الرسمي." },
  service: { title: "صمّم مسار الاستقبال من منظور مقدم الطلب", body: "تحدد الأهلية والأسئلة والإحالة والموافقات والبريد واتفاقية الخدمة من يطلب الخدمة وكيف تستقبلها الإدارة القانونية.", checklist: "عاين النموذج وأرسل طلباً تجريبياً قبل النشر." },
  calendar: { title: "حدّد وقت العمل الذي تستخدمه ساعات الخدمة", body: "تحدد المنطقة الزمنية وأيام وساعات العمل والعطلات متى تتقدم المواعيد أو تتوقف.", checklist: "تحقق من الساعات الليلية والعطلات المحلية والتوقيت الموسمي إن وجد." },
  "legal-hold": { title: "احفظ المعلومات الصحيحة منذ البداية", body: "يحدد نطاق المسألة والأوصياء والأنظمة والتواريخ والتعليمات ما يجب الاحتفاظ به ومن يجب أن يقر بالتعليق.", checklist: "تحقق من قائمة الأوصياء وتاريخ بدء الحفظ قبل إصدار الإشعارات." },
};

export function LexCreationGuidance({
  workflow,
  className,
}: {
  workflow: LexCreationWorkflow;
  className?: string;
}) {
  const { locale } = useLocaleOrDefault();
  const copy = (locale === "ar" ? AR : EN)[workflow];

  return (
    <aside
      role="note"
      data-lex-creation-guidance={workflow}
      className={cn(
        "rounded-xl border border-info-500/25 bg-info-500/5 px-4 py-3 text-start",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-info-600" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{copy.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.body}</p>
          <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-foreground/80">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden />
            <span>{copy.checklist}</span>
          </p>
        </div>
      </div>
    </aside>
  );
}
