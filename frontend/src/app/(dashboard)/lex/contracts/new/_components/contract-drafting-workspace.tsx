"use client";

import { cloneElement, isValidElement, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  FileCheck2,
  FileText,
  Landmark,
  Library,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Upload,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { LexCreationGuidance } from "@/components/lex/creation-guidance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/providers/locale-provider";
import { useAuth } from "@/hooks/use-auth";
import { enterpriseApi } from "@/lib/enterprise";
import { lexRequestsApi, type LegalRequest } from "@/lib/lex/requests";
import { showApiError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { LexContractType } from "@/types/suites";
import { deriveRenewalDate } from "../../_lib/renewal-date";

const CONTRACT_TYPES: LexContractType[] = [
  "service_agreement",
  "nda",
  "vendor",
  "consulting",
  "procurement",
  "license",
  "lease",
  "employment",
  "partnership",
  "sla",
  "mou",
  "other",
];

const CLAUSES = [
  { id: "confidentiality", en: "Confidentiality", ar: "السرية", risk: "low" },
  { id: "termination", en: "Termination", ar: "الإنهاء", risk: "medium" },
  {
    id: "limitation_of_liability",
    en: "Limitation of Liability",
    ar: "حدود المسؤولية",
    risk: "medium",
  },
  { id: "indemnification", en: "Indemnification", ar: "التعويض", risk: "high" },
  {
    id: "force_majeure",
    en: "Force Majeure",
    ar: "القوة القاهرة",
    risk: "low",
  },
  {
    id: "dispute_resolution",
    en: "Dispute Resolution",
    ar: "تسوية النزاعات",
    risk: "medium",
  },
] as const;

/**
 * A clause the drafter can select — either one of the built-in {@link CLAUSES}
 * or one the user added themselves. Custom clauses are held on the draft rather
 * than pushed into CLAUSES so the built-in library stays a stable constant, and
 * so a custom clause cannot outlive the draft it was written for.
 */
interface ClauseOption {
  id: string;
  en: string;
  ar: string;
  risk: string;
  /** True only for user-authored clauses; drives the remove affordance. */
  custom?: boolean;
}

/** Risk tiers a custom clause may be assigned, mirroring the built-in library. */
const CLAUSE_RISKS = ["low", "medium", "high"] as const;

/**
 * Custom clause ids are namespaced so they can never collide with a built-in id
 * (which would make the built-in unselectable) and so downstream consumers can
 * tell the two apart from the id alone.
 */
const CUSTOM_CLAUSE_PREFIX = "custom:";

/** Bilingual label for a clause risk tier; unknown tiers render as-is. */
function riskLabel(risk: string, ar: boolean): string {
  if (!ar) return risk;
  switch (risk) {
    case "low":
      return "منخفض";
    case "medium":
      return "متوسط";
    case "high":
      return "مرتفع";
    default:
      return risk;
  }
}

interface DraftState {
  title: string;
  contractNumber: string;
  legalRequestId: string;
  type: LexContractType;
  description: string;
  partyA: string;
  partyAEntity: string;
  partyB: string;
  partyBEntity: string;
  partyBContact: string;
  totalValue: string;
  currency: string;
  paymentTerms: string;
  penaltyTerms: string;
  effectiveDate: string;
  expiryDate: string;
  autoRenew: boolean;
  renewalNoticeDays: string;
  jurisdiction: string;
  clauses: string[];
  /**
   * User-authored clauses available for selection on this draft. Kept separate
   * from `clauses` (which holds only the SELECTED ids) so a custom clause the
   * user unticks is not silently destroyed.
   */
  customClauses: ClauseOption[];
  documentNames: string[];
}

const initialDraft: DraftState = {
  title: "",
  contractNumber: "",
  legalRequestId: "",
  type: "service_agreement",
  description: "",
  partyA: "",
  partyAEntity: "",
  partyB: "",
  partyBEntity: "",
  partyBContact: "",
  totalValue: "",
  currency: "SAR",
  paymentTerms: "",
  penaltyTerms: "",
  effectiveDate: "",
  expiryDate: "",
  autoRenew: false,
  renewalNoticeDays: "30",
  jurisdiction: "Kingdom of Saudi Arabia",
  clauses: ["confidentiality", "termination", "limitation_of_liability"],
  customClauses: [],
  documentNames: [],
};

const copy = {
  en: {
    eyebrow: "WatheeqTech · Contracts",
    title: "Contract Drafting Workspace",
    description:
      "Build a complete contract, validate its terms, and route it for approval.",
    back: "Back to contracts",
    steps: [
      "Basic Info",
      "Parties",
      "Terms & Clauses",
      "Documents",
      "Review & Submit",
    ],
    previous: "Previous",
    next: "Next Step",
    save: "Save as Draft",
    submit: "Submit for Approval",
    required: "Complete the required fields before continuing.",
    sourceRequired: "Enter a contract number or select an approved request.",
    created: "Contract created",
    createdDescription: "The contract was saved to the registry.",
    reviewStarted: "Approval workflow started",
    reviewDescription: "The contract is now ready for legal review.",
    partialSaved: "The contract was saved, but submitting it for approval failed.",
    partialRetry:
      "Retrying will only resubmit it for approval — the contract is not created twice. Any edits made below are no longer applied; change them on the saved draft.",
    partialOpenDraft: "Open the saved draft",
  },
  ar: {
    eyebrow: "وثيق تك · العقود",
    title: "مساحة صياغة العقود",
    description: "أنشئ عقداً متكاملاً، وراجع شروطه، ثم أرسله للاعتماد.",
    back: "العودة إلى العقود",
    steps: [
      "المعلومات الأساسية",
      "الأطراف",
      "الشروط والبنود",
      "المستندات",
      "المراجعة والإرسال",
    ],
    previous: "السابق",
    next: "الخطوة التالية",
    save: "حفظ كمسودة",
    submit: "إرسال للاعتماد",
    required: "أكمل الحقول المطلوبة قبل المتابعة.",
    sourceRequired: "أدخل رقم العقد أو اختر طلبًا معتمدًا.",
    created: "تم إنشاء العقد",
    createdDescription: "تم حفظ العقد في السجل.",
    reviewStarted: "بدأ مسار الاعتماد",
    reviewDescription: "العقد جاهز الآن للمراجعة القانونية.",
    partialSaved: "تم حفظ العقد، لكن إرساله للاعتماد لم ينجح.",
    partialRetry:
      "إعادة المحاولة ستعيد إرساله للاعتماد فقط — لن يُنشأ العقد مرتين. أي تعديلات تجريها أدناه لن تُطبّق؛ عدّلها على المسودة المحفوظة.",
    partialOpenDraft: "فتح المسودة المحفوظة",
  },
} as const;

export function ContractDraftingWorkspace() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { locale, direction } = useLocale();
  const t = copy[locale];
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<DraftState>(initialDraft);
  const [validationMessage, setValidationMessage] = useState("");

  const approvedRequestsQuery = useQuery({
    queryKey: ["lex-approved-contract-requests"],
    queryFn: () =>
      lexRequestsApi.listRequests({
        page: 1,
        per_page: 100,
        order: "desc",
        filters: { status: "approved" },
      }),
  });
  const approvedRequests = useMemo(
    () => (approvedRequestsQuery.data?.data ?? []).filter((request) => !request.subject_id),
    [approvedRequestsQuery.data],
  );

  const set = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setValidationMessage("");
  };

  /**
   * Every clause offered on this draft, built-ins first then user-authored, so
   * the library grid and the preview render from one ordered source.
   */
  const clauseOptions = useMemo<ClauseOption[]>(
    () => [...CLAUSES, ...draft.customClauses],
    [draft.customClauses],
  );

  // Filtered from clauseOptions, NOT from CLAUSES: filtering the static library
  // would silently drop every custom clause from the preview and from the risk
  // indicator, which is what made a custom clause look like it did nothing.
  const selectedClauses = useMemo(
    () => clauseOptions.filter((clause) => draft.clauses.includes(clause.id)),
    [clauseOptions, draft.clauses],
  );

  /**
   * Id of a contract this wizard has ALREADY created. `POST /lex/contracts` is
   * not idempotent — `contract_number` is unique per tenant, and an approved
   * source request can only be consumed once (the backend answers a second
   * attempt with "a contract with this contract number already exists" /
   * "the approved legal request is already linked to a legal work item"). So
   * once the row exists it must never be POSTed again: a failure in the
   * follow-up review step has to retry ONLY that step, otherwise every retry
   * 409s and the user is stranded on an error they can never clear.
   *
   * Held in a ref as well as state because `mutationFn` closes over its render
   * and must see the id written by the immediately preceding attempt.
   */
  const createdContractRef = useRef<{ id: string } | null>(null);
  const [savedContractId, setSavedContractId] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (submitForReview: boolean) => {
      if (!user) throw new Error("An authenticated owner is required.");
      if (createdContractRef.current) {
        const existing = createdContractRef.current;
        if (!submitForReview) {
          return { contract: existing, reviewStarted: false };
        }
        await enterpriseApi.lex.startContractReview(existing.id, {
          approver_role: "legal-director",
          description:
            locale === "ar"
              ? "مراجعة قانونية للعقد المقدم من مساحة الصياغة"
              : "Legal review requested from the contract drafting workspace",
        });
        return { contract: existing, reviewStarted: true };
      }
      const ownerName =
        user.full_name?.trim() ||
        `${user.first_name} ${user.last_name}`.trim() ||
        user.email;
      const contract = await enterpriseApi.lex.createContract({
        title: draft.title.trim(),
        contract_number: draft.contractNumber.trim() || null,
        legal_request_id: draft.legalRequestId || null,
        type: draft.type,
        description: draft.description.trim(),
        party_a_name: draft.partyA.trim(),
        party_a_entity: draft.partyAEntity.trim() || null,
        party_b_name: draft.partyB.trim(),
        party_b_entity: draft.partyBEntity.trim() || null,
        party_b_contact: draft.partyBContact.trim() || null,
        total_value: draft.totalValue ? Number(draft.totalValue) : null,
        currency: draft.currency,
        payment_terms: draft.paymentTerms.trim() || null,
        effective_date: draft.effectiveDate
          ? new Date(draft.effectiveDate).toISOString()
          : null,
        expiry_date: draft.expiryDate
          ? new Date(draft.expiryDate).toISOString()
          : null,
        // The wizard collects no renewal date of its own: it follows from the
        // end date and the notice period the user just entered.
        renewal_date:
          deriveRenewalDate(
            draft.expiryDate || null,
            Number(draft.renewalNoticeDays) || 30,
          )?.toISOString() ?? null,
        auto_renew: draft.autoRenew,
        renewal_notice_days: Number(draft.renewalNoticeDays) || 30,
        owner_user_id: user.id,
        owner_name: ownerName,
        department: draft.partyAEntity.trim() || null,
        tags: ["figma-deep-draft"],
        metadata: {
          jurisdiction: draft.jurisdiction,
          penalty_terms: draft.penaltyTerms,
          selected_clauses: draft.clauses,
          // A built-in id ("confidentiality") is self-describing; a custom id is
          // an opaque uuid. Persist the user's own titles alongside it so the
          // saved contract does not carry unreadable clause references.
          custom_clauses: draft.customClauses
            .filter((clause) => draft.clauses.includes(clause.id))
            .map((clause) => ({
              id: clause.id,
              title: clause.en,
              risk: clause.risk,
            })),
          supporting_documents: draft.documentNames,
          drafting_source: "contracts-deep-workspace",
        },
      });

      // The row now exists. Record it BEFORE the review call so a failure below
      // cannot cause a duplicate create on retry.
      createdContractRef.current = { id: contract.id };
      setSavedContractId(contract.id);

      let reviewStarted = false;
      if (submitForReview) {
        // Workflow assignee matching uses canonical legal persona slugs. The
        // former generic `legal` token matched no seeded role and created an
        // effectively invisible task. Let failures reject this mutation so the
        // UI never reports a review as started when only the contract was saved.
        await enterpriseApi.lex.startContractReview(contract.id, {
          approver_role: "legal-director",
          description:
            locale === "ar"
              ? "مراجعة قانونية للعقد المقدم من مساحة الصياغة"
              : "Legal review requested from the contract drafting workspace",
        });
        reviewStarted = true;
      }
      return { contract, reviewStarted };
    },
    onSuccess: async ({ contract, reviewStarted }) => {
      createdContractRef.current = null;
      setSavedContractId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lex-contracts"] }),
        queryClient.invalidateQueries({ queryKey: ["lex-overview"] }),
      ]);
      showSuccess(
        reviewStarted ? t.reviewStarted : t.created,
        reviewStarted ? t.reviewDescription : t.createdDescription,
      );
      router.push(
        reviewStarted
          ? `/lex/contracts/${contract.id}/approval`
          : `/lex/contracts/${contract.id}/draft`,
      );
    },
    onError: showApiError,
  });

  const canAdvance = () => {
    if (step === 0) {
      return Boolean(
        draft.title.trim() &&
        (draft.contractNumber.trim() || draft.legalRequestId),
      );
    }
    if (step === 1) return Boolean(draft.partyA.trim() && draft.partyB.trim());
    if (step === 2) return Boolean(draft.effectiveDate && draft.expiryDate);
    return true;
  };

  const advance = () => {
    if (!canAdvance()) {
      setValidationMessage(
        step === 0 && !draft.contractNumber.trim() && !draft.legalRequestId
          ? t.sourceRequired
          : t.required,
      );
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  };

  return (
    <div dir={direction} lang={locale} className="space-y-6">
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.description}
        actions={
          <Button variant="outline" asChild>
            <Link href="/lex/contracts">
              {direction === "rtl" ? (
                <ArrowRight className="me-2 h-4 w-4" />
              ) : (
                <ArrowLeft className="me-2 h-4 w-4" />
              )}
              {t.back}
            </Link>
          </Button>
        }
      />

      <LexCreationGuidance workflow="contract" />

      <Surface variant="card" padding="md" className="overflow-x-auto">
        <ol className="flex min-w-[720px] items-center justify-between">
          {t.steps.map((label, index) => (
            <li key={label} className="flex flex-1 items-center last:flex-none">
              <Button
                type="button"
                variant="ghost"
                onClick={() => index <= step && setStep(index)}
                className="h-auto gap-2 p-0 text-start hover:bg-transparent"
                aria-current={index === step ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold",
                    index < step &&
                      "border-success-600 bg-success-600 text-white",
                    index === step &&
                      "border-primary bg-primary text-primary-foreground",
                    index > step &&
                      "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {index < step ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "text-sm font-medium",
                    index !== step && "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </Button>
              {index < t.steps.length - 1 ? (
                <span
                  className={cn(
                    "mx-4 h-px flex-1",
                    index < step ? "bg-success-500" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          ))}
        </ol>
      </Surface>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Surface variant="card" padding="lg" className="min-h-[520px]">
          {step === 0 ? (
            <BasicInfoStep
              draft={draft}
              set={set}
              locale={locale}
              approvedRequests={approvedRequests}
              requestsLoading={approvedRequestsQuery.isLoading}
            />
          ) : null}
          {step === 1 ? (
            <PartiesStep draft={draft} set={set} locale={locale} />
          ) : null}
          {step === 2 ? (
            <TermsStep draft={draft} set={set} locale={locale} />
          ) : null}
          {step === 3 ? (
            <DocumentsStep draft={draft} set={set} locale={locale} />
          ) : null}
          {step === 4 ? <ReviewStep draft={draft} locale={locale} /> : null}
        </Surface>

        <DraftPreview
          draft={draft}
          selectedClauses={selectedClauses}
          locale={locale}
        />
      </div>

      {validationMessage ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {validationMessage}
        </p>
      ) : null}

      {/* The contract row exists but the submission did not complete. Say so
          plainly and offer the saved draft — silently leaving the user on an
          error toast is what made this flow look permanently broken. */}
      {savedContractId ? (
        <div
          role="status"
          className="space-y-2 rounded-2xl border border-status-warning/25 bg-status-warning/10 p-4 text-sm"
        >
          <p className="font-medium">{t.partialSaved}</p>
          <p className="text-muted-foreground">{t.partialRetry}</p>
          <Link
            href={`/lex/contracts/${savedContractId}/draft`}
            className="inline-flex items-center font-medium text-primary underline underline-offset-4"
          >
            {t.partialOpenDraft}
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <Button
          variant="outline"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          disabled={step === 0 || saveMutation.isPending}
        >
          {direction === "rtl" ? (
            <ArrowRight className="me-2 h-4 w-4" />
          ) : (
            <ArrowLeft className="me-2 h-4 w-4" />
          )}
          {t.previous}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void saveMutation.mutate(false)}
            disabled={
              !draft.title.trim() ||
              (!draft.contractNumber.trim() && !draft.legalRequestId) ||
              !draft.partyA.trim() ||
              !draft.partyB.trim() ||
              saveMutation.isPending
            }
          >
            {saveMutation.isPending ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="me-2 h-4 w-4" />
            )}
            {t.save}
          </Button>
          {step < 4 ? (
            <Button onClick={advance}>
              {t.next}
              {direction === "rtl" ? (
                <ArrowLeft className="ms-2 h-4 w-4" />
              ) : (
                <ArrowRight className="ms-2 h-4 w-4" />
              )}
            </Button>
          ) : (
            <Button
              onClick={() => void saveMutation.mutate(true)}
              disabled={
                saveMutation.isPending ||
                !draft.contractNumber.trim() && !draft.legalRequestId
              }
            >
              {saveMutation.isPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="me-2 h-4 w-4" />
              )}
              {t.submit}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface StepProps {
  draft: DraftState;
  set: <K extends keyof DraftState>(key: K, value: DraftState[K]) => void;
  locale: "en" | "ar";
}

function BasicInfoStep({
  draft,
  set,
  locale,
  approvedRequests,
  requestsLoading,
}: StepProps & { approvedRequests: LegalRequest[]; requestsLoading: boolean }) {
  const ar = locale === "ar";
  const applyRequest = (requestId: string) => {
    if (requestId === "manual") {
      set("legalRequestId", "");
      return;
    }
    const request = approvedRequests.find((item) => item.id === requestId);
    if (!request) return;
    const title = localizedRequestTitle(request, locale);
    set("legalRequestId", request.id);
    set("contractNumber", "");
    set("title", title);
    set("description", request.description);
    set("type", contractTypeFromRequest(request.request_type));
    if (request.department) set("partyAEntity", request.department);
  };
  return (
    <StepShell
      icon={FileText}
      title={ar ? "المعلومات الأساسية" : "Basic Contract Information"}
      description={
        ar
          ? "حدد هوية العقد والغرض منه."
          : "Define the contract identity and business purpose."
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label={ar ? "عنوان العقد" : "Contract Title"}
          required
          className="md:col-span-2"
        >
          <Input
            value={draft.title}
            onChange={(event) => set("title", event.target.value)}
            placeholder={
              ar
                ? "مثال: اتفاقية الخدمات التقنية"
                : "e.g. Technology Services Agreement"
            }
          />
        </Field>
        <Field label={ar ? "رقم العقد" : "Contract ID"}>
          <Input
            value={draft.contractNumber}
            onChange={(event) => set("contractNumber", event.target.value)}
            placeholder="CNT-2026-001"
            disabled={Boolean(draft.legalRequestId)}
          />
        </Field>
        <Field label={ar ? "مصدر الطلب المعتمد" : "Approved Request Source"}>
          <Select
            value={draft.legalRequestId || "manual"}
            onValueChange={applyRequest}
          >
            <SelectTrigger aria-label={ar ? "مصدر الطلب المعتمد" : "Approved Request Source"}>
              <SelectValue placeholder={ar ? "اختر طلبًا معتمدًا" : "Select an approved request"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">
                {ar ? "إدخال رقم العقد يدويًا" : "Enter a contract number manually"}
              </SelectItem>
              {approvedRequests.map((request) => (
                <SelectItem key={request.id} value={request.id}>
                  {request.request_number} — {localizedRequestTitle(request, locale)}
                </SelectItem>
              ))}
              {!requestsLoading && approvedRequests.length === 0 ? (
                <SelectItem value="no-approved-requests" disabled>
                  {ar ? "لا توجد طلبات معتمدة غير مرتبطة" : "No unlinked approved requests"}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </Field>
        <Field label={ar ? "نوع العقد" : "Contract Type"}>
          <Select
            value={draft.type}
            onValueChange={(value) => set("type", value as LexContractType)}
          >
            <SelectTrigger aria-label={ar ? "نوع العقد" : "Contract Type"}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTRACT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label={ar ? "الوصف والغرض" : "Description & Purpose"}
          className="md:col-span-2"
        >
          <Textarea
            value={draft.description}
            onChange={(event) => set("description", event.target.value)}
            rows={5}
          />
        </Field>
      </div>
    </StepShell>
  );
}

function PartiesStep({ draft, set, locale }: StepProps) {
  const ar = locale === "ar";
  return (
    <StepShell
      icon={Users}
      title={ar ? "الأطراف والموقعون" : "Parties & Signatories"}
      description={
        ar
          ? "أضف الكيانات والأشخاص المشاركين."
          : "Add the entities and contacts involved in this agreement."
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <PartyCard
          title={ar ? "الطرف الأول" : "First Party"}
          icon={Landmark}
          name={draft.partyA}
          entity={draft.partyAEntity}
          onName={(value) => set("partyA", value)}
          onEntity={(value) => set("partyAEntity", value)}
          locale={locale}
        />
        <PartyCard
          title={ar ? "الطرف المقابل" : "Counterparty"}
          icon={Building2}
          name={draft.partyB}
          entity={draft.partyBEntity}
          contact={draft.partyBContact}
          onName={(value) => set("partyB", value)}
          onEntity={(value) => set("partyBEntity", value)}
          onContact={(value) => set("partyBContact", value)}
          locale={locale}
        />
      </div>
    </StepShell>
  );
}

function TermsStep({ draft, set, locale }: StepProps) {
  const ar = locale === "ar";
  const customTitleId = useId();
  const customRiskId = useId();
  const [composerOpen, setComposerOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customRisk, setCustomRisk] = useState<string>("medium");

  const clauseOptions: ClauseOption[] = [...CLAUSES, ...draft.customClauses];

  const toggleClause = (id: string, checked: boolean) => {
    set(
      "clauses",
      checked
        ? [...draft.clauses, id]
        : draft.clauses.filter((clause) => clause !== id),
    );
  };

  const trimmedTitle = customTitle.trim();
  // Guard against a duplicate title producing two indistinguishable chips.
  const duplicateTitle = clauseOptions.some(
    (clause) =>
      clause.en.toLocaleLowerCase() === trimmedTitle.toLocaleLowerCase() ||
      clause.ar === trimmedTitle,
  );
  const canAddCustom = trimmedTitle.length > 0 && !duplicateTitle;

  const closeComposer = () => {
    setComposerOpen(false);
    setCustomTitle("");
    setCustomRisk("medium");
  };

  const addCustomClause = () => {
    if (!canAddCustom) return;
    // One title serves both locales: the user authored it in their own words and
    // we must not invent a translation for the other language.
    const clause: ClauseOption = {
      id: `${CUSTOM_CLAUSE_PREFIX}${crypto.randomUUID()}`,
      en: trimmedTitle,
      ar: trimmedTitle,
      risk: customRisk,
      custom: true,
    };
    set("customClauses", [...draft.customClauses, clause]);
    // A clause the user just wrote is selected by default — adding it and then
    // having to tick it would be a second, pointless step.
    set("clauses", [...draft.clauses, clause.id]);
    closeComposer();
  };

  const removeCustomClause = (id: string) => {
    set(
      "customClauses",
      draft.customClauses.filter((clause) => clause.id !== id),
    );
    set(
      "clauses",
      draft.clauses.filter((clause) => clause !== id),
    );
  };
  return (
    <StepShell
      icon={Library}
      title={ar ? "الشروط والبنود" : "Terms & Clauses"}
      description={
        ar
          ? "حدد الشروط المالية والتواريخ ومكتبة البنود."
          : "Set financial terms, key dates, and the clause library."
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={ar ? "قيمة العقد" : "Contract Value"}>
          <Input
            type="number"
            min="0"
            value={draft.totalValue}
            onChange={(event) => set("totalValue", event.target.value)}
          />
        </Field>
        <Field label={ar ? "العملة" : "Currency"}>
          <Select
            value={draft.currency}
            onValueChange={(value) => set("currency", value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["SAR", "USD", "AED", "EUR"].map((currency) => (
                <SelectItem key={currency} value={currency}>
                  {currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={ar ? "تاريخ البدء" : "Start Date"} required>
          <Input
            type="datetime-local"
            value={draft.effectiveDate}
            onChange={(event) => set("effectiveDate", event.target.value)}
          />
        </Field>
        <Field label={ar ? "تاريخ الانتهاء" : "End Date"} required>
          <Input
            type="datetime-local"
            min={draft.effectiveDate || undefined}
            value={draft.expiryDate}
            onChange={(event) => set("expiryDate", event.target.value)}
          />
        </Field>
        <Field label={ar ? "جدول وشروط الدفع" : "Payment Schedule & Terms"}>
          <Textarea
            value={draft.paymentTerms}
            onChange={(event) => set("paymentTerms", event.target.value)}
            rows={3}
          />
        </Field>
        <Field label={ar ? "الغرامات والجزاءات" : "Penalty Terms"}>
          <Textarea
            value={draft.penaltyTerms}
            onChange={(event) => set("penaltyTerms", event.target.value)}
            rows={3}
          />
        </Field>
        <Field
          label={ar ? "الاختصاص القضائي" : "Jurisdiction"}
          className="md:col-span-2"
        >
          <Input
            value={draft.jurisdiction}
            onChange={(event) => set("jurisdiction", event.target.value)}
          />
        </Field>
        <div className="md:col-span-2 flex items-center justify-between rounded-xl border bg-muted/30 p-4">
          <div>
            <p className="font-medium">
              {ar ? "التجديد التلقائي" : "Automatic Renewal"}
            </p>
            <p className="text-sm text-muted-foreground">
              {ar
                ? "تجديد العقد تلقائياً عند انتهائه."
                : "Renew this agreement automatically at expiry."}
            </p>
          </div>
          <Switch
            checked={draft.autoRenew}
            onCheckedChange={(checked) => set("autoRenew", checked)}
          />
        </div>
        {draft.autoRenew ? (
          <Field
            label={ar ? "مهلة إشعار التجديد (أيام)" : "Renewal Notice (days)"}
          >
            <Input
              type="number"
              min="1"
              value={draft.renewalNoticeDays}
              onChange={(event) => set("renewalNoticeDays", event.target.value)}
            />
          </Field>
        ) : null}
      </div>
      <div className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">
            {ar ? "مكتبة البنود" : "Clause Library"}
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (composerOpen ? closeComposer() : setComposerOpen(true))}
            aria-expanded={composerOpen}
            data-testid="add-custom-clause"
          >
            <Plus className="me-2 h-4 w-4" />
            {ar ? "بند مخصص" : "Custom Clause"}
          </Button>
        </div>
        {composerOpen ? (
          <div className="mb-3 rounded-xl border border-dashed p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <div className="grid gap-1.5">
                <Label htmlFor={customTitleId}>
                  {ar ? "عنوان البند" : "Clause title"}
                </Label>
                <Input
                  id={customTitleId}
                  value={customTitle}
                  dir="auto"
                  autoFocus
                  onChange={(event) => setCustomTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCustomClause();
                    }
                    if (event.key === "Escape") closeComposer();
                  }}
                  placeholder={
                    ar ? "مثال: حماية البيانات" : "e.g. Data Protection"
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={customRiskId}>
                  {ar ? "المخاطر" : "Risk"}
                </Label>
                <Select value={customRisk} onValueChange={setCustomRisk}>
                  <SelectTrigger id={customRiskId} className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAUSE_RISKS.map((risk) => (
                      <SelectItem key={risk} value={risk}>
                        {riskLabel(risk, ar)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={addCustomClause}
                  disabled={!canAddCustom}
                >
                  {ar ? "إضافة" : "Add"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={closeComposer}
                >
                  {ar ? "إلغاء" : "Cancel"}
                </Button>
              </div>
            </div>
            {duplicateTitle ? (
              <p className="mt-2 text-xs text-destructive">
                {ar
                  ? "يوجد بند بهذا العنوان بالفعل."
                  : "A clause with this title already exists."}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {clauseOptions.map((clause) => (
            <div
              key={clause.id}
              className="flex items-start gap-3 rounded-xl border p-4 hover:border-primary/50"
            >
              {/*
                The label wraps only the checkbox and its text. A remove button
                inside a <label> would toggle the checkbox as well as fire its
                own handler, so it sits outside as a sibling.
              */}
              <label className="flex flex-1 cursor-pointer items-start gap-3">
                <Checkbox
                  checked={draft.clauses.includes(clause.id)}
                  onCheckedChange={(checked) =>
                    toggleClause(clause.id, checked === true)
                  }
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium" dir="auto">
                    {ar ? clause.ar : clause.en}
                  </span>
                  <Badge
                    variant={
                      clause.risk === "high"
                        ? "destructive"
                        : clause.risk === "medium"
                          ? "warning"
                          : "secondary"
                    }
                    className="mt-2"
                  >
                    {riskLabel(clause.risk, ar)}
                  </Badge>
                </span>
              </label>
              {clause.custom ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-0 p-1"
                  onClick={() => removeCustomClause(clause.id)}
                  aria-label={
                    ar
                      ? `إزالة البند ${clause.ar}`
                      : `Remove clause ${clause.en}`
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </StepShell>
  );
}

function DocumentsStep({ draft, set, locale }: StepProps) {
  const ar = locale === "ar";
  return (
    <StepShell
      icon={Upload}
      title={ar ? "المستندات والمرفقات" : "Documents & Attachments"}
      description={
        ar
          ? "أضف الملاحق والمستندات الداعمة."
          : "Attach schedules, exhibits, and supporting material."
      }
    >
      <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/20 p-8 text-center hover:border-primary/60">
        <Upload className="mb-4 h-10 w-10 text-primary" />
        <span className="font-semibold">
          {ar
            ? "اسحب الملفات هنا أو اختر من جهازك"
            : "Drop files here or browse your device"}
        </span>
        <span className="mt-2 text-sm text-muted-foreground">
          PDF, DOCX, XLSX · 25 MB
        </span>
        <Input
          type="file"
          multiple
          className="sr-only"
          onChange={(event) =>
            set(
              "documentNames",
              Array.from(event.target.files ?? []).map((file) => file.name),
            )
          }
        />
      </label>
      {draft.documentNames.length > 0 ? (
        <div className="mt-5 space-y-2">
          {draft.documentNames.map((name) => (
            <div
              key={name}
              className="flex items-center gap-3 rounded-xl border p-3"
            >
              <FileCheck2 className="h-5 w-5 text-success-600" />
              <span className="text-sm font-medium">{name}</span>
            </div>
          ))}
        </div>
      ) : null}
    </StepShell>
  );
}

function ReviewStep({ draft, locale }: Omit<StepProps, "set">) {
  const ar = locale === "ar";
  return (
    <StepShell
      icon={ShieldCheck}
      title={ar ? "المراجعة والإرسال" : "Review & Submit"}
      description={
        ar
          ? "راجع بيانات العقد قبل بدء مسار الاعتماد."
          : "Review the contract record before starting the approval workflow."
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <ReviewItem label={ar ? "العنوان" : "Title"} value={draft.title} />
        <ReviewItem
          label={ar ? "المصدر" : "Source"}
          value={draft.legalRequestId ? (ar ? "طلب معتمد" : "Approved request") : draft.contractNumber}
        />
        <ReviewItem
          label={ar ? "النوع" : "Type"}
          value={draft.type.replaceAll("_", " ")}
        />
        <ReviewItem
          label={ar ? "الأطراف" : "Parties"}
          value={`${draft.partyA} · ${draft.partyB}`}
        />
        <ReviewItem
          label={ar ? "القيمة" : "Value"}
          value={
            draft.totalValue
              ? `${draft.currency} ${Number(draft.totalValue).toLocaleString(locale)}`
              : "—"
          }
        />
        <ReviewItem
          label={ar ? "المدة" : "Term"}
          value={`${draft.effectiveDate || "—"} → ${draft.expiryDate || "—"}`}
        />
        <ReviewItem
          label={ar ? "التجديد" : "Renewal"}
          value={
            draft.autoRenew
              ? ar
                ? "تلقائي"
                : "Automatic"
              : ar
                ? "يدوي"
                : "Manual"
          }
        />
        <ReviewItem
          label={ar ? "البنود" : "Clauses"}
          value={`${draft.clauses.length}`}
        />
        <ReviewItem
          label={ar ? "المستندات" : "Documents"}
          value={`${draft.documentNames.length}`}
        />
      </div>
      <div className="mt-6 rounded-xl border border-success-300 bg-success-50 p-4 text-success-800 dark:border-success-800 dark:bg-success-950/30 dark:text-success-200">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-5 w-5" />
          {ar ? "جاهز للمراجعة القانونية" : "Ready for legal review"}
        </p>
        <p className="mt-1 text-sm">
          {ar
            ? "سيتم إنشاء سجل العقد وإرساله إلى سلسلة الاعتماد."
            : "The contract record will be created and routed into the approval chain."}
        </p>
      </div>
    </StepShell>
  );
}

function DraftPreview({
  draft,
  selectedClauses,
  locale,
}: {
  draft: DraftState;
  selectedClauses: ClauseOption[];
  locale: "en" | "ar";
}) {
  const ar = locale === "ar";
  return (
    <Surface
      as="aside"
      variant="card"
      padding="lg"
      className="h-fit xl:sticky xl:top-6"
    >
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            {ar ? "معاينة مباشرة" : "Live Preview"}
          </p>
          <h2 className="mt-1 font-semibold">
            {draft.title || (ar ? "عقد بدون عنوان" : "Untitled Contract")}
          </h2>
        </div>
        <FileText className="h-8 w-8 text-primary/70" />
      </div>
      <dl className="space-y-4 text-sm">
        <PreviewLine
          label={ar ? "النوع" : "Type"}
          value={draft.type.replaceAll("_", " ")}
        />
        <PreviewLine
          label={ar ? "الأطراف" : "Parties"}
          value={
            [draft.partyA, draft.partyB].filter(Boolean).join(" / ") || "—"
          }
        />
        <PreviewLine
          label={ar ? "القيمة" : "Value"}
          value={
            draft.totalValue
              ? `${draft.currency} ${Number(draft.totalValue).toLocaleString(locale)}`
              : "—"
          }
        />
        <PreviewLine
          label={ar ? "الاختصاص" : "Jurisdiction"}
          value={draft.jurisdiction || "—"}
        />
      </dl>
      <div className="my-5 h-px bg-border" />
      <p className="mb-3 text-sm font-semibold">
        {ar ? "البنود المحددة" : "Selected Clauses"}
      </p>
      <div className="flex flex-wrap gap-2">
        {selectedClauses.length > 0 ? (
          selectedClauses.map((clause) => (
            <Badge key={clause.id} variant="secondary">
              {ar ? clause.ar : clause.en}
            </Badge>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">
            {ar ? "لا توجد بنود" : "No clauses selected"}
          </span>
        )}
      </div>
      <div className="mt-6 rounded-xl bg-muted/50 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {ar ? "مؤشر المخاطر" : "Risk Indicator"}
          </span>
          <Badge
            variant={
              selectedClauses.some((clause) => clause.risk === "high")
                ? "warning"
                : "success"
            }
          >
            {selectedClauses.some((clause) => clause.risk === "high")
              ? ar
                ? "متوسط"
                : "Medium"
              : ar
                ? "منخفض"
                : "Low"}
          </Badge>
        </div>
      </div>
    </Surface>
  );
}

function StepShell({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-7 flex items-start gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const generatedId = useId();
  const canAssociate =
    isValidElement<{ id?: string }>(children) && children.type !== Select;
  const controlId = canAssociate ? children.props.id || generatedId : undefined;
  const control = canAssociate
    ? cloneElement(children, { id: controlId })
    : children;
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={controlId}>
        {label}
        {required ? <span className="ms-1 text-destructive">*</span> : null}
      </Label>
      {control}
    </div>
  );
}

function PartyCard({
  title,
  icon: Icon,
  name,
  entity,
  contact,
  onName,
  onEntity,
  onContact,
  locale,
}: {
  title: string;
  icon: typeof Building2;
  name: string;
  entity: string;
  contact?: string;
  onName: (value: string) => void;
  onEntity: (value: string) => void;
  onContact?: (value: string) => void;
  locale: "en" | "ar";
}) {
  const ar = locale === "ar";
  return (
    <div className="rounded-2xl border bg-muted/10 p-5">
      <h3 className="mb-5 flex items-center gap-2 font-semibold">
        <Icon className="h-5 w-5 text-primary" />
        {title}
      </h3>
      <div className="space-y-4">
        <Field label={ar ? "الاسم القانوني" : "Legal Name"} required>
          <Input
            value={name}
            onChange={(event) => onName(event.target.value)}
          />
        </Field>
        <Field label={ar ? "الكيان / الإدارة" : "Entity / Department"}>
          <Input
            value={entity}
            onChange={(event) => onEntity(event.target.value)}
          />
        </Field>
        {onContact ? (
          <Field label={ar ? "جهة الاتصال" : "Primary Contact"}>
            <Input
              value={contact}
              onChange={(event) => onContact(event.target.value)}
            />
          </Field>
        ) : null}
      </div>
    </div>
  );
}

function localizedRequestTitle(request: LegalRequest, locale: "en" | "ar"): string {
  return (locale === "ar" ? request.title.ar : request.title.en).trim()
    || request.title.en.trim()
    || request.title.ar.trim()
    || request.request_number;
}

function contractTypeFromRequest(requestType: string): LexContractType {
  const value = requestType.toLowerCase();
  if (value.includes("nda") || value.includes("confidential")) return "nda";
  if (value.includes("employment")) return "employment";
  if (value.includes("license") || value.includes("licence")) return "license";
  if (value.includes("lease")) return "lease";
  if (value.includes("consult")) return "consulting";
  if (value.includes("procurement") || value.includes("purchase")) return "procurement";
  if (value.includes("service_level") || value.includes("service level") || value.includes("sla")) return "sla";
  if (value.includes("mou") || value.includes("memorandum")) return "mou";
  if (value.includes("vendor") || value.includes("supplier")) return "vendor";
  return "service_agreement";
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-medium capitalize">{value || "—"}</dd>
    </div>
  );
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium capitalize">{value}</dd>
    </div>
  );
}
