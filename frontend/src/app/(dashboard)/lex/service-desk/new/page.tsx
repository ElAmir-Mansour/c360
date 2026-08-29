'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronRight,
  ClipboardList,
  FileText,
  ListChecks,
  Loader2,
  Paperclip,
} from 'lucide-react';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { WatheeqLogo } from '@/components/brand/watheeq-logo';
import { Button } from '@/components/ui/button';
import {
  Wizard,
  useWizard,
  type WizardStepConfig,
} from '@/components/shared/wizard';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { showApiError, showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { resolveLocalized } from '@/lib/i18n/localized';
import {
  lexRequestsApi,
  type CreateLegalRequestPayload,
  type EligibilityDecision,
  type LegalRequest,
  type RequestPriority,
  type ServiceCatalogEntry,
} from '@/lib/lex/requests';
import { useServiceDeskLabels } from '../_components/labels';
import type { BeneficiarySelection } from './_components/beneficiary-picker';
import { useLexFormat } from '@/lib/lex/ksa';
import SubmissionSuccess from './_components/submission-success';
import DraftResumeBanner from './_components/draft-resume-banner';
import RequestWizardStepper from './_components/request-wizard-stepper';
import ServiceStep from './_components/steps/service-step';
import DetailsStep from './_components/steps/details-step';
import AttachmentsStep from './_components/steps/attachments-step';
import ReviewSubmitStep from './_components/steps/review-step';
import RequestGuidanceRail from './_components/request-guidance-rail';
import { useWizardDraft } from './_lib/use-wizard-draft';
import { useStepFocus } from './_lib/use-step-focus';
import { reviewStrings } from './_lib/review-i18n';
import { isAcceptableScanStatus, type StagedAttachment } from './_lib/attachments-types';
import { useAttachmentPolicy, type AttachmentPolicyState } from './_lib/attachment-policy';
import { getAttachmentPolicyMessages } from './_lib/attachment-policy-i18n';
import {
  createAndSubmitLegalRequest,
  RequestSubmissionError,
} from './_lib/request-submission';
import { normalizeRequestedDueDate, validateRequestedDueDate } from './_lib/wizard-validation';
import {
  STEP_IDS,
  type WizardDraftState,
  type WizardStepNumber,
} from './_lib/wizard-types';

const RECENT_KEY = 'clario360.lex.recentServices';

/**
 * Long-form stepper + breadcrumb labels for the 4-step flow. Kept local (the
 * shared `labels.wizard` bundle carries only the short `stepService` etc. names
 * used elsewhere). Both locales are full same-shaped copies.
 */
const STEPPER_LABELS = {
  en: ['Request Info', 'Request Details', 'Attachments', 'Review & Confirm'],
  ar: ['معلومات الطلب', 'تفاصيل الطلب', 'المرفقات', 'المراجعة والتأكيد'],
} as const;

const NEW_REQUEST_UX = {
  en: {
    pageEyebrow: 'New legal request',
    pageHeading: 'Request New Legal Service',
    pageDescription:
      'Choose a service, tell us what you need, and we will route your request to the right legal team.',
    timeEstimate: 'About 5 minutes',
    autosaveNote: 'Saved as you go',
    backToInbox: 'Back to Requests Inbox',
    crumbHome: 'Home',
    crumbRequests: 'Requests',
    crumbSubmit: 'Submit New Request',
    crumbNav: 'Breadcrumb',
    stepAttachments: 'Attachments',
    checklistTitle: 'Completion checklist',
    missingFieldsTitle: 'Complete these fields to continue',
    serviceSelected: 'Service selected',
    requesterSet: 'Requester set',
    titleAdded: 'Title added',
    descriptionAdded: 'Description added',
    urgencyJustified: 'Urgency justified',
    detailsConfirmed: 'Details confirmed',
    attachmentsOptional: 'Attachments optional',
    attachmentsScanning: 'Wait for every attachment to pass its security scan.',
    departmentRequired: 'Select the requesting department or entity.',
    dueDateRequired: 'Select the requested due date.',
    dueDatePast: 'The requested due date cannot be in the past.',
    savedDraftTitle: 'Submission needs another attempt',
    savedDraftBody: (requestNumber: string) =>
      `${requestNumber} was saved as a draft. Submit again to retry the same request without creating a duplicate.`,
    viewSavedDraft: 'View saved draft',
    noPermission: 'You do not have permission to submit legal requests.',
    working: 'Saving changes…',
    continueDetails: 'Next: Request Details',
    continueAttachments: 'Next: Attachments',
    continueReview: 'Next: Review & Confirm',
    submitRequest: 'Submit Request',
    missingPrefix: 'Missing',
    optional: 'Optional',
    ready: 'Ready',
    slaNotSelected: 'Select a service to preview SLA handling.',
    slaPending: 'Legal intake will confirm SLA ownership after service review.',
    slaEligible: 'Eligibility confirmed for this service.',
    slaBlocked: 'Eligibility needs review before submission.',
  },
  ar: {
    pageEyebrow: 'طلب قانوني جديد',
    pageHeading: 'طلب خدمة قانونية جديدة',
    pageDescription:
      'اختر الخدمة، وأخبرنا بما تحتاج إليه، وسنوجّه طلبك إلى الفريق القانوني المناسب.',
    timeEstimate: 'نحو ٥ دقائق',
    autosaveNote: 'يُحفظ تلقائيًا',
    backToInbox: 'العودة إلى صندوق الطلبات',
    crumbHome: 'الرئيسية',
    crumbRequests: 'الطلبات',
    crumbSubmit: 'تقديم طلب جديد',
    crumbNav: 'مسار التنقل',
    stepAttachments: 'المرفقات',
    checklistTitle: 'قائمة الاكتمال',
    missingFieldsTitle: 'أكمل هذه الحقول للمتابعة',
    serviceSelected: 'تم اختيار الخدمة',
    requesterSet: 'تم تحديد مقدم الطلب',
    titleAdded: 'تمت إضافة العنوان',
    descriptionAdded: 'تمت إضافة الوصف',
    urgencyJustified: 'تم تبرير الاستعجال',
    detailsConfirmed: 'تم تأكيد التفاصيل',
    attachmentsOptional: 'المرفقات اختيارية',
    attachmentsScanning: 'انتظر حتى تجتاز جميع المرفقات الفحص الأمني.',
    departmentRequired: 'يرجى اختيار الإدارة أو الجهة الطالبة.',
    dueDateRequired: 'يرجى تحديد تاريخ الاستحقاق المطلوب.',
    dueDatePast: 'لا يمكن أن يكون تاريخ الاستحقاق المطلوب في الماضي.',
    savedDraftTitle: 'يلزم إعادة محاولة الإرسال',
    savedDraftBody: (requestNumber: string) =>
      `حُفظ الطلب ${requestNumber} كمسودة. أرسل الطلب مجددًا لإعادة محاولة الطلب نفسه دون إنشاء نسخة مكررة.`,
    viewSavedDraft: 'عرض المسودة المحفوظة',
    noPermission: 'ليست لديك صلاحية تقديم الطلبات القانونية.',
    working: 'جارٍ حفظ التغييرات…',
    continueDetails: 'التالي: تفاصيل الطلب',
    continueAttachments: 'التالي: المرفقات',
    continueReview: 'التالي: المراجعة والتأكيد',
    submitRequest: 'إرسال الطلب',
    missingPrefix: 'ناقص',
    optional: 'اختياري',
    ready: 'جاهز',
    slaNotSelected: 'اختر خدمة لمعاينة معالجة اتفاقية مستوى الخدمة.',
    slaPending: 'سيؤكد فريق الاستقبال القانوني مالك اتفاقية مستوى الخدمة بعد مراجعة الخدمة.',
    slaEligible: 'تم تأكيد الأهلية لهذه الخدمة.',
    slaBlocked: 'تحتاج الأهلية إلى مراجعة قبل التقديم.',
  },
} as const;

type NewRequestUxCopy = typeof NEW_REQUEST_UX.en | typeof NEW_REQUEST_UX.ar;

interface CompletionItem {
  id: string;
  label: string;
  complete: boolean;
  required: boolean;
}

function readRecentServices(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecentService(id: string): void {
  try {
    if (typeof window === 'undefined') return;
    const next = [id, ...readRecentServices().filter((x) => x !== id)].slice(0, 5);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // best-effort
  }
}

export default function NewRequestWizardPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const labels = useServiceDeskLabels();
  const ux = locale === 'ar' ? NEW_REQUEST_UX.ar : NEW_REQUEST_UX.en;
  const stepperLabels = locale === 'ar' ? STEPPER_LABELS.ar : STEPPER_LABELS.en;
  const t = labels.wizard;
  // §8.2/§18.4 — the new-request wizard is a request add flow.
  const canWrite = hasPermission('lex:request:add');

  const [serviceId, setServiceId] = useState<string>('');
  const [beneficiary, setBeneficiary] = useState<BeneficiarySelection | null>(null);
  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [description, setDescription] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [priority, setPriority] = useState<RequestPriority>('normal');
  const [urgency, setUrgency] = useState('');
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [notes, setNotes] = useState('');
  const [requestedDueDate, setRequestedDueDate] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<LegalRequest | null>(null);
  const [serverDraft, setServerDraft] = useState<LegalRequest | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  // The shared Wizard owns the active step internally; we mirror the 1-based
  // step here so the draft can be persisted/resumed and the breadcrumb + hero
  // can render the active step outside the provider.
  const [currentStep, setCurrentStep] = useState<WizardStepNumber>(1);
  // Remount key + start index: bumping the key re-runs the provider's initial
  // index (the only way to programmatically seed the resumed step).
  const [wizardKey, setWizardKey] = useState(0);
  const [initialIndex, setInitialIndex] = useState(0);

  // Draft autosave + resume.
  const draft = useWizardDraft<WizardDraftState>('default');
  const [resumeOpen, setResumeOpen] = useState(false);
  const [draftResolved, setDraftResolved] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const pendingDraft = useRef<WizardDraftState | null>(null);

  const draftState = useMemo<WizardDraftState>(
    () => ({
      step: currentStep,
      serviceId,
      beneficiary,
      titleEn,
      titleAr,
      description,
      requesterName,
      priority,
      urgency,
      attachments,
      notes,
      requestedDueDate,
    }),
    [
      currentStep,
      serviceId,
      beneficiary,
      titleEn,
      titleAr,
      description,
      requesterName,
      priority,
      urgency,
      attachments,
      notes,
      requestedDueDate,
    ],
  );

  // On mount: surface a resumable draft (do not auto-apply) and seed recents.
  useEffect(() => {
    setRecentIds(readRecentServices());
    const loaded = draft.loadDraft();
    if (loaded) {
      pendingDraft.current = loaded;
      setDraftSavedAt(loaded.__savedAt ?? null);
      setResumeOpen(true);
    } else {
      setDraftResolved(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change once the user has resolved any pre-existing draft.
  useEffect(() => {
    if (!draftResolved) return;
    draft.persist(draftState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftResolved, draftState]);

  const resumeDraft = () => {
    const d = pendingDraft.current;
    if (d) {
      setServiceId(d.serviceId ?? '');
      setBeneficiary(d.beneficiary ?? null);
      setTitleEn(d.titleEn ?? '');
      setTitleAr(d.titleAr ?? '');
      setDescription(d.description ?? '');
      setRequesterName(d.requesterName ?? '');
      setPriority(d.priority ?? 'normal');
      setUrgency(d.urgency ?? '');
      setAttachments(Array.isArray(d.attachments) ? d.attachments : []);
      setNotes(d.notes ?? '');
      // A draft saved before the field carried a time holds a bare YYYY-MM-DD,
      // which a datetime-local input rejects and renders blank — normalize so
      // resuming an old draft keeps the date the user already chose.
      setRequestedDueDate(normalizeRequestedDueDate(d.requestedDueDate ?? ''));
      // Clamp a (possibly legacy 3-step) draft into the new 1–4 range; the shared
      // provider also clamps the derived index defensively.
      const resumedStep = Math.min(Math.max(d.step ?? 1, 1), 4) as WizardStepNumber;
      setCurrentStep(resumedStep);
      setInitialIndex(resumedStep - 1);
      setWizardKey((k) => k + 1);
    }
    setResumeOpen(false);
    setDraftResolved(true);
  };

  const discardDraft = () => {
    draft.clear();
    pendingDraft.current = null;
    setResumeOpen(false);
    setDraftResolved(true);
  };

  const servicesQuery = useQuery({
    queryKey: ['lex-service-catalog', 'wizard'],
    queryFn: () => lexRequestsApi.listServices({ page: 1, per_page: 100, order: 'asc' }),
  });

  const services = useMemo(
    () => (servicesQuery.data?.data ?? []).filter((s) => s.active),
    [servicesQuery.data],
  );
  const selectedService = useMemo<ServiceCatalogEntry | undefined>(
    () => services.find((s) => s.id === serviceId),
    [services, serviceId],
  );

  // A resumed draft can carry a serviceId that no longer resolves to a live,
  // active catalog entry (the service was deleted/deactivated, or the draft
  // predates the current schema). Once the catalog has loaded, drop such a stale
  // id rather than let it linger firing the eligibility-check (a bare uuid the
  // backend has no row for → 404, or a malformed legacy value → 400).
  useEffect(() => {
    if (!servicesQuery.isSuccess) return;
    if (serviceId && !selectedService) {
      setServiceId('');
    }
  }, [servicesQuery.isSuccess, serviceId, selectedService]);

  const eligibilityQuery = useQuery({
    queryKey: ['lex-service-eligibility', serviceId, beneficiary?.code ?? ''],
    queryFn: () =>
      lexRequestsApi.checkEligibility({
        service_id: serviceId,
        beneficiary_code: beneficiary?.code || undefined,
        department: beneficiary?.department || undefined,
      }),
    // Gate on the service actually resolving in the loaded catalog, not merely on
    // a truthy serviceId string — so a stale/unknown id can never fire a request
    // the backend is bound to reject (400/404).
    enabled: Boolean(selectedService),
  });
  const eligibility: EligibilityDecision | undefined = eligibilityQuery.data;

  // Required-attachment resolution (PRD 14.1): consult the shared AttachmentPolicy
  // find-applicable/evaluate pipeline for the selected service so the submitter
  // sees the required count + named document slots — and is warned/blocked when a
  // mandatory slot is unmet — before the provider-side completeness gate.
  const attachmentPolicy = useAttachmentPolicy({
    serviceCode: selectedService?.code,
    requestType: selectedService?.request_type,
    attachments,
    enabled: Boolean(serviceId),
  });
  const apMessages = useMemo(() => getAttachmentPolicyMessages(locale), [locale]);
  // Fail closed: only a positive clean verdict passes the scan gate. A skipped
  // scan means the security service was unavailable and remains blocking.
  const attachmentsClean = attachments.every((attachment) =>
    isAcceptableScanStatus(attachment.scanStatus),
  );
  const attachmentChecklist = useMemo(() => {
    if (attachmentPolicy.hasRequirement) {
      const complete = attachmentPolicy.complete;
      return {
        label: complete
          ? apMessages.checklistLabelComplete
          : apMessages.checklistLabel(
              attachmentPolicy.providedCount,
              attachmentPolicy.requiredCount,
            ),
        required: true,
        complete,
      };
    }
    return {
      label: ux.attachmentsOptional,
      required: false,
      complete: attachments.length > 0,
    };
  }, [
    attachmentPolicy.hasRequirement,
    attachmentPolicy.complete,
    attachmentPolicy.providedCount,
    attachmentPolicy.requiredCount,
    apMessages,
    ux.attachmentsOptional,
    attachments.length,
  ]);

  const createMutation = useMutation({
    mutationFn: (payload: CreateLegalRequestPayload) =>
      createAndSubmitLegalRequest(
        lexRequestsApi,
        payload,
        notes,
        serverDraft,
      ),
    onSuccess: (request) => {
      showSuccess(t.toast.created);
      draft.clear();
      if (serviceId) pushRecentService(serviceId);
      setServerDraft(null);
      setCreated(request);
    },
    onError: (error) => {
      if (error instanceof RequestSubmissionError) {
        setServerDraft(error.draft);
        showApiError(error.originalError);
        return;
      }
      showApiError(error);
    },
  });

  // Shared field-level checks. Each gate opts into the slices it owns so the
  // step it runs behind only asserts its own fields; the final review gate
  // re-asserts everything (the real submit backstop).
  const collectRequestErrors = (opts: {
    includeService?: boolean;
    includeDetails?: boolean;
    includeAttachments?: boolean;
  }): Record<string, string> => {
    const next: Record<string, string> = {};
    if (opts.includeService && !selectedService) next.service = t.errors.serviceRequired;
    if (opts.includeDetails ?? true) {
      if (!titleEn.trim() && !titleAr.trim()) next.title = t.errors.titleRequired;
      if (!description.trim()) next.description = t.errors.descriptionRequired;
      if (!requesterName.trim()) next.requester = t.errors.requesterRequired;
      if (!beneficiary) next.beneficiary = ux.departmentRequired;
      const dueDateError = validateRequestedDueDate(requestedDueDate);
      if (dueDateError === 'required') next.requestedDueDate = ux.dueDateRequired;
      if (dueDateError === 'past') next.requestedDueDate = ux.dueDatePast;
      if (priority === 'urgent' && !urgency.trim()) next.urgency = t.errors.urgencyRequired;
    }
    if (opts.includeAttachments ?? true) {
      // Required-attachment gate (PRD 14.1) + scan backstop.
      if (attachmentPolicy.blocking) next.attachments = apMessages.blockingWarning;
      if (!attachmentsClean) next.attachments = ux.attachmentsScanning;
    }
    return next;
  };

  // Step 2 (details) — title / description / requester / urgency only.
  const validateDetails = (): boolean => {
    const next = collectRequestErrors({
      includeService: false,
      includeDetails: true,
      includeAttachments: false,
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // Step 3 (attachments) — required-slot completeness + scan-clean.
  const validateAttachments = (): boolean => {
    const next = collectRequestErrors({
      includeService: false,
      includeDetails: false,
      includeAttachments: true,
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // Final gate before the "Submit request" button runs `submit()`. Re-asserts
  // every slice plus the attestation, so a stale/unresolved service or an
  // incomplete detail can't slip past review.
  const validateReview = (): boolean => {
    const next = collectRequestErrors({
      includeService: true,
      includeDetails: true,
      includeAttachments: true,
    });
    if (!confirmed) next.confirm = reviewStrings(locale).confirmRequired;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = () => {
    if (!selectedService || !canWrite) return;
    if (attachmentPolicy.blocking) {
      showError(apMessages.blockingWarning);
      return;
    }
    if (!attachmentsClean) {
      showError(ux.attachmentsScanning);
      return;
    }
    if (!confirmed) {
      showError(reviewStrings(locale).confirmRequired);
      return;
    }
    // Notes + requested due date have no dedicated request columns; the only real
    // persistence channel on create is the `metadata` JSONB.
    const metadata: Record<string, unknown> = {};
    if (notes.trim()) metadata.notes = notes.trim();
    if (requestedDueDate) metadata.requested_due_date = requestedDueDate;
    const payload: CreateLegalRequestPayload = {
      request_type: selectedService.request_type,
      service_id: selectedService.id,
      title: { en: titleEn.trim(), ar: titleAr.trim() },
      description: description.trim(),
      requester_name: requesterName.trim(),
      beneficiary_entity_id: beneficiary?.entityId || undefined,
      department: beneficiary?.department?.trim() || undefined,
      priority,
      urgency_justification: priority === 'urgent' ? urgency.trim() : undefined,
      requester_approval_required: selectedService.requester_approval_required,
      provider_approval_required: selectedService.provider_approval_required,
      attachments: attachments.map((attachment) => ({
        file_id: attachment.fileId,
        slot_key: attachment.slotKey,
      })),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
    createMutation.mutate(payload);
  };

  // Per-step validation gates run by the shared Wizard before it advances.
  const steps = useMemo<WizardStepConfig[]>(
    () => [
      {
        id: STEP_IDS[0],
        label: t.stepService,
        icon: ListChecks,
        validate: () => {
          // Gate on the *resolved* active service, not the raw id: a stale id
          // (resumed draft, or a service deactivated after selection) is truthy
          // but resolves to nothing, and must not be treated as a selection.
          if (!selectedService) {
            setErrors({ service: t.errors.serviceRequired });
            return false;
          }
          setErrors({});
          return true;
        },
      },
      { id: STEP_IDS[1], label: t.stepDetails, icon: FileText, validate: validateDetails },
      { id: STEP_IDS[2], label: ux.stepAttachments, icon: Paperclip, validate: validateAttachments },
      { id: STEP_IDS[3], label: t.stepReview, icon: ClipboardList, validate: validateReview },
    ],
    // The validate closures read the latest field state; recreating the configs
    // each render keeps the gates reading current values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      selectedService,
      serviceId,
      titleEn,
      titleAr,
      description,
      requesterName,
      beneficiary,
      requestedDueDate,
      priority,
      urgency,
      confirmed,
      attachmentPolicy.blocking,
      attachmentsClean,
      ux,
      apMessages,
      locale,
      t,
    ],
  );

  const resetWizard = () => {
    setCreated(null);
    setServerDraft(null);
    setServiceId('');
    setBeneficiary(null);
    setTitleEn('');
    setTitleAr('');
    setDescription('');
    setRequesterName('');
    setPriority('normal');
    setUrgency('');
    setAttachments([]);
    setNotes('');
    setRequestedDueDate('');
    setConfirmed(false);
    setErrors({});
    setCurrentStep(1);
    setInitialIndex(0);
    setWizardKey((k) => k + 1);
    setDraftResolved(true);
  };

  // Success screen replaces the wizard once a request is created.
  if (created) {
    return (
      <LexRouteGuard route="/lex/service-desk/new">
        <div dir={direction} lang={locale} className="space-y-6">
          <SubmissionSuccess request={created} onCreateAnother={resetWizard} />
        </div>
      </LexRouteGuard>
    );
  }

  const breadcrumbItems = [
    { label: ux.crumbHome, href: '/dashboard' },
    { label: ux.crumbRequests, href: '/lex/service-desk' },
    { label: ux.crumbSubmit, current: true },
  ];

  return (
    <LexRouteGuard route="/lex/service-desk/new">
      <div
        dir={direction}
        lang={locale}
        className="mx-auto w-full max-w-[85rem] space-y-6 pb-8"
      >
        <WizardBreadcrumb items={breadcrumbItems} ariaLabel={ux.crumbNav} locale={locale} />

        <h1 className="text-h2 font-semibold leading-tight text-foreground">{ux.pageHeading}</h1>

        {resumeOpen && draftSavedAt ? (
          <DraftResumeBanner savedAt={draftSavedAt} onResume={resumeDraft} onDiscard={discardDraft} />
        ) : null}

        {serverDraft ? (
          <div
            className="flex flex-col gap-3 rounded-xl border border-warning-300 bg-warning-50 p-4 text-warning-900 sm:flex-row sm:items-center dark:border-warning-700/60 dark:bg-warning-900/20 dark:text-warning-100"
            role="status"
          >
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{ux.savedDraftTitle}</p>
              <p className="mt-1 text-sm">{ux.savedDraftBody(serverDraft.request_number)}</p>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href={`/lex/service-desk/${serverDraft.id}`}>{ux.viewSavedDraft}</Link>
            </Button>
          </div>
        ) : null}

        <Wizard
          key={wizardKey}
          steps={steps}
          initialIndex={initialIndex}
          onStepChange={(index) => setCurrentStep((index + 1) as WizardStepNumber)}
          onComplete={submit}
        >
          <WizardBody
            labels={labels}
            canWrite={canWrite}
            submitting={createMutation.isPending}
            onCancelToList={() => router.push('/lex/service-desk')}
            ux={ux}
            stepperLabels={stepperLabels}
            servicesLoading={servicesQuery.isLoading}
            servicesError={servicesQuery.isError}
            onRetryServices={() => void servicesQuery.refetch()}
            services={services}
            serviceId={serviceId}
            setServiceId={setServiceId}
            beneficiary={beneficiary}
            setBeneficiary={setBeneficiary}
            recentIds={recentIds}
            eligibilityLoading={eligibilityQuery.isLoading}
            eligibility={eligibility}
            onRecheckEligibility={() => void eligibilityQuery.refetch()}
            selectedService={selectedService}
            errors={errors}
            requesterName={requesterName}
            setRequesterName={setRequesterName}
            titleEn={titleEn}
            titleAr={titleAr}
            setTitleEn={setTitleEn}
            setTitleAr={setTitleAr}
            description={description}
            setDescription={setDescription}
            priority={priority}
            setPriority={setPriority}
            urgency={urgency}
            setUrgency={setUrgency}
            attachments={attachments}
            setAttachments={setAttachments}
            notes={notes}
            setNotes={setNotes}
            requestedDueDate={requestedDueDate}
            setRequestedDueDate={setRequestedDueDate}
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            attachmentPolicy={attachmentPolicy}
            attachmentChecklist={attachmentChecklist}
          />
        </Wizard>
      </div>
    </LexRouteGuard>
  );
}

interface WizardBodyProps {
  labels: ReturnType<typeof useServiceDeskLabels>;
  ux: NewRequestUxCopy;
  stepperLabels: ReadonlyArray<string>;
  canWrite: boolean;
  submitting: boolean;
  onCancelToList: () => void;
  servicesLoading: boolean;
  servicesError: boolean;
  onRetryServices: () => void;
  services: ServiceCatalogEntry[];
  serviceId: string;
  setServiceId: (id: string) => void;
  beneficiary: BeneficiarySelection | null;
  setBeneficiary: (b: BeneficiarySelection | null) => void;
  recentIds: string[];
  eligibilityLoading: boolean;
  eligibility?: EligibilityDecision;
  onRecheckEligibility: () => void;
  selectedService?: ServiceCatalogEntry;
  errors: Record<string, string>;
  requesterName: string;
  setRequesterName: (v: string) => void;
  titleEn: string;
  titleAr: string;
  setTitleEn: (v: string) => void;
  setTitleAr: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  priority: RequestPriority;
  setPriority: (p: RequestPriority) => void;
  urgency: string;
  setUrgency: (v: string) => void;
  attachments: StagedAttachment[];
  setAttachments: (a: StagedAttachment[]) => void;
  notes: string;
  setNotes: (v: string) => void;
  requestedDueDate: string;
  setRequestedDueDate: (v: string) => void;
  confirmed: boolean;
  setConfirmed: (v: boolean) => void;
  attachmentPolicy: AttachmentPolicyState;
  attachmentChecklist: { label: string; required: boolean; complete: boolean };
}

/**
 * Renders the wizard chrome (local stepper), the four step bodies, the a11y live
 * region and the sticky footer. Lives inside `<Wizard>` so it can consume
 * `useWizard()` for step focus, screen-reader announcements and the review
 * step's "edit" jumps.
 */
function WizardBody({
  labels,
  ux,
  stepperLabels,
  canWrite,
  submitting,
  onCancelToList,
  servicesLoading,
  servicesError,
  onRetryServices,
  services,
  serviceId,
  setServiceId,
  beneficiary,
  setBeneficiary,
  recentIds,
  eligibilityLoading,
  eligibility,
  onRecheckEligibility,
  selectedService,
  errors,
  requesterName,
  setRequesterName,
  titleEn,
  titleAr,
  setTitleEn,
  setTitleAr,
  description,
  setDescription,
  priority,
  setPriority,
  urgency,
  setUrgency,
  attachments,
  setAttachments,
  notes,
  setNotes,
  requestedDueDate,
  setRequestedDueDate,
  confirmed,
  setConfirmed,
  attachmentPolicy,
  attachmentChecklist,
}: WizardBodyProps) {
  const { activeIndex, activeStep, goTo, steps } = useWizard();
  const { locale } = useLocale();
  const f = useLexFormat();
  const t = labels.wizard;
  const { containerRef, liveMessage, setLiveMessage } = useStepFocus(activeIndex);
  const stepLabels = [t.stepService, t.stepDetails, ux.stepAttachments, t.stepReview];

  // Announce the step transition (skip the initial mount).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setLiveMessage(`${stepLabels[activeIndex] ?? ''} — ${t.stepOf(activeIndex + 1, steps.length)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const isService = activeStep.id === STEP_IDS[0];
  const stepperSteps = useMemo(
    () => steps.map((step, index) => ({ id: step.id, label: stepperLabels[index] ?? step.label })),
    [steps, stepperLabels],
  );
  const completionItems = useMemo<CompletionItem[]>(
    () => [
      {
        id: 'service',
        label: ux.serviceSelected,
        complete: Boolean(selectedService),
        required: true,
      },
      {
        id: 'requester',
        label: ux.requesterSet,
        complete: requesterName.trim().length > 0,
        required: true,
      },
      {
        id: 'title',
        label: ux.titleAdded,
        complete: titleEn.trim().length > 0 || titleAr.trim().length > 0,
        required: true,
      },
      {
        id: 'description',
        label: ux.descriptionAdded,
        complete: description.trim().length > 0,
        required: true,
      },
      {
        id: 'beneficiary',
        label: ux.departmentRequired,
        complete: Boolean(beneficiary),
        required: true,
      },
      {
        id: 'requestedDueDate',
        label: ux.dueDateRequired,
        complete: validateRequestedDueDate(requestedDueDate) === null,
        required: true,
      },
      {
        id: 'urgency',
        label: ux.urgencyJustified,
        complete: priority !== 'urgent' || urgency.trim().length > 0,
        required: priority === 'urgent',
      },
      {
        id: 'attachments',
        label: attachmentChecklist.label,
        complete: attachmentChecklist.complete,
        required: attachmentChecklist.required,
      },
      {
        id: 'confirm',
        label: ux.detailsConfirmed,
        complete: confirmed,
        required: true,
      },
    ],
    [
      attachmentChecklist,
      beneficiary,
      description,
      priority,
      requesterName,
      requestedDueDate,
      selectedService,
      titleAr,
      titleEn,
      urgency,
      confirmed,
      ux,
    ],
  );
  const footerMissing = completionItems.filter((item) => {
    if (!item.required || item.complete) return false;
    if (activeStep.id === STEP_IDS[0]) return item.id === 'service';
    if (activeStep.id === STEP_IDS[1]) {
      return [
        'requester',
        'title',
        'description',
        'beneficiary',
        'requestedDueDate',
        'urgency',
      ].includes(item.id);
    }
    if (activeStep.id === STEP_IDS[2]) return item.id === 'attachments';
    return true;
  });
  const footerHint = submitting
    ? ux.working
    : !canWrite
      ? ux.noPermission
      : footerMissing.length > 0
        ? `${ux.missingPrefix}: ${footerMissing.map((item) => item.label).join(', ')}`
        : ux.ready;
  const nextLabel =
    activeIndex === 0 ? ux.continueDetails : activeIndex === 1 ? ux.continueAttachments : ux.continueReview;
  const showGuidanceRail = activeIndex < 3;

  useEffect(() => {
    const messages = Object.values(errors).filter(Boolean);
    if (messages.length === 0) return;
    window.requestAnimationFrame(() => {
      const root = containerRef.current;
      const target = root?.querySelector<HTMLElement>('[aria-invalid="true"]');
      (target ?? root)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    });
  }, [containerRef, errors]);

  return (
    <div className="w-full space-y-6">
      <RequestWizardStepper
        steps={stepperSteps}
        activeIndex={activeIndex}
        onStepSelect={(index) => void goTo(index)}
        ariaLabel={t.stepOf(activeIndex + 1, steps.length)}
      />

      <div
        className={cn(
          'grid items-start gap-6',
          showGuidanceRail && 'xl:grid-cols-[minmax(0,1fr)_24rem]',
        )}
      >
        <div className="min-w-0">
          <div
            ref={containerRef}
            tabIndex={-1}
            className={cn(
              'space-y-6 outline-none focus-visible:shadow-none',
              activeIndex < 3 && [
                '[&_[data-slot=card]]:rounded-b-none [&_[data-slot=card]]:rounded-t-xl',
                '[&_[data-slot=card]]:border-border [&_[data-slot=card]]:shadow-none',
                '[&_[data-slot=card-header]]:p-6 sm:[&_[data-slot=card-header]]:p-8',
                '[&_[data-slot=card-content]]:px-6 [&_[data-slot=card-content]]:pb-6',
                'sm:[&_[data-slot=card-content]]:px-8 sm:[&_[data-slot=card-content]]:pb-8',
              ],
            )}
          >
            <ValidationSummary errors={errors} title={ux.missingFieldsTitle} />

            {/* Step 1: service selection + eligibility */}
            <Wizard.Step id={STEP_IDS[0]}>
              <ServiceStep
                labels={labels}
                services={services}
                servicesLoading={servicesLoading}
                servicesError={servicesError}
                onRetryServices={onRetryServices}
                serviceId={serviceId}
                selectedService={selectedService}
                onServiceChange={setServiceId}
                recentIds={recentIds}
                eligibility={eligibility}
                eligibilityLoading={eligibilityLoading}
                onRecheckEligibility={onRecheckEligibility}
                errors={errors}
              />
            </Wizard.Step>

            {/* Step 2: details (title, department, description, priority, due date, notes, requester) */}
            <Wizard.Step id={STEP_IDS[1]}>
              <DetailsStep
                labels={labels}
                selectedService={selectedService}
                requesterName={requesterName}
                onRequesterChange={setRequesterName}
                beneficiary={beneficiary}
                onBeneficiaryChange={setBeneficiary}
                titleEn={titleEn}
                titleAr={titleAr}
                onTitleEnChange={setTitleEn}
                onTitleArChange={setTitleAr}
                description={description}
                onDescriptionChange={setDescription}
                priority={priority}
                onPriorityChange={setPriority}
                urgency={urgency}
                onUrgencyChange={setUrgency}
                requestedDueDate={requestedDueDate}
                onDueDateChange={setRequestedDueDate}
                notes={notes}
                onNotesChange={setNotes}
                errors={errors}
                disabled={!canWrite}
              />
            </Wizard.Step>

            {/* Step 3: attachments */}
            <Wizard.Step id={STEP_IDS[2]}>
              <AttachmentsStep
                labels={labels}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                policy={attachmentPolicy}
                errors={errors}
                disabled={!canWrite}
              />
            </Wizard.Step>

            {/* Step 4: review + submit */}
            <Wizard.Step id={STEP_IDS[3]}>
              <ReviewSubmitStep
                labels={labels}
                selectedService={selectedService}
                titleEn={titleEn}
                titleAr={titleAr}
                description={description}
                requesterName={requesterName}
                beneficiary={beneficiary}
                priority={priority}
                urgency={urgency}
                notes={notes}
                requestedDueDate={requestedDueDate}
                requestedDueDateLabel={
                  requestedDueDate
                    ? f.formatDate(requestedDueDate, { dateStyle: 'medium', timeStyle: 'short' })
                    : undefined
                }
                attachments={attachments}
                confirmed={confirmed}
                onConfirmChange={setConfirmed}
                confirmError={errors.confirm}
                onEditStep={(target) => void goTo(target - 1)}
              />
            </Wizard.Step>
          </div>

          <WizardFooter
            labels={labels}
            canWrite={canWrite}
            submitting={submitting}
            canProceed={footerMissing.length === 0}
            primaryLabels={{ next: nextLabel, submit: ux.submitRequest }}
            hint={footerHint}
            onCancelFirst={isService ? onCancelToList : undefined}
          />
        </div>

        {showGuidanceRail ? (
          <RequestGuidanceRail service={selectedService} priority={priority} />
        ) : null}
      </div>

      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
    </div>
  );
}

function WizardBreadcrumb({
  items,
  ariaLabel,
  locale,
}: {
  items: { label: string; href?: string; current?: boolean }[];
  ariaLabel: string;
  locale: string;
}) {
  return (
    <nav aria-label={ariaLabel}>
      <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-2">
            {index > 0 ? (
              <ChevronRight
                className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60 rtl:-scale-x-100"
                aria-hidden
              />
            ) : null}
            {index === 0 && item.href ? (
              <Link href={item.href} aria-label={item.label}>
                <WatheeqLogo
                  locale={locale}
                  background="white"
                  height={38}
                  decorative
                  className="h-9 w-auto max-w-[10rem] object-contain"
                />
              </Link>
            ) : item.href && !item.current ? (
              <Link href={item.href} className="transition-colors hover:text-foreground">
                {item.label}
              </Link>
            ) : (
              <span
                className={cn('truncate', item.current && 'font-semibold text-primary')}
                aria-current={item.current ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function ValidationSummary({
  errors,
  title,
}: {
  errors: Record<string, string>;
  title: string;
}) {
  const messages = Object.values(errors).filter(Boolean);
  if (messages.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive shadow-sm"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Figma-aligned inline action footer. It stays attached to the active form card
 * instead of floating over the viewport. Drafts continue to autosave in the
 * background, so leaving through Cancel does not discard entered information.
 */
function WizardFooter({
  labels,
  canWrite,
  submitting,
  canProceed,
  primaryLabels,
  hint,
  onCancelFirst,
}: {
  labels: ReturnType<typeof useServiceDeskLabels>;
  canWrite: boolean;
  submitting: boolean;
  canProceed: boolean;
  primaryLabels: { next: string; submit: string };
  hint: string;
  onCancelFirst?: () => void;
}) {
  const { goBack, goNext, isFirst, isLast, isBusy, activeIndex, steps } = useWizard();
  const t = labels.wizard;
  const busy = isBusy || submitting;
  const primaryLabel = isLast ? (submitting ? t.submitting : primaryLabels.submit) : primaryLabels.next;

  return (
    <div
      className={cn(
        'border border-border bg-card px-6 py-4 sm:px-8',
        isLast ? 'mt-6 rounded-xl' : '-mt-px rounded-b-xl rounded-t-none border-t-0',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          onClick={() => void goNext()}
          disabled={!canWrite || !canProceed || busy}
          className="w-full sm:min-w-48 sm:w-auto"
        >
          {busy ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : null}
          {primaryLabel}
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={isFirst ? onCancelFirst : goBack}
            disabled={busy || (isFirst && !onCancelFirst)}
          >
            {isFirst ? t.cancel : t.back}
          </Button>

        </div>

        <div
          className="min-w-0 text-xs font-medium text-muted-foreground sm:ms-auto"
          aria-live="polite"
        >
          <span dir="ltr" className="me-2 inline-block tabular-nums">{`${activeIndex + 1} / ${steps.length}`}</span>
          <span>{hint}</span>
        </div>
      </div>
    </div>
  );
}
