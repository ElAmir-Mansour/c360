'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  GitBranch,
  ListChecks,
  Loader2,
  Route,
  ShieldQuestion,
} from 'lucide-react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { LexRecordPicker } from '@/components/lex/lex-record-picker';
import {
  AsyncRecordPicker,
  type RecordPickerOption,
} from '@/components/shared/forms/async-record-picker';
import { OrgEntityPicker } from '@/components/shared/forms/org-entity-picker';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { isLocalizedText, resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  casesApi,
  CASE_COMPANY_STATUS_OPTIONS,
  CASE_STATUS_OPTIONS,
  CASE_STRENGTH_OPTIONS,
  LEGAL_PRIORITY_OPTIONS,
  type CaseClassification,
  type CaseClassificationCascade,
  type CaseCompanyStatus,
  type CaseStatus,
  type CaseStrength,
  type CreateLegalCasePayload,
  type LegalCase,
  type LegalPriority,
  type UpdateLegalCasePayload,
} from '@/lib/lex/cases';
import { type CaseLabels, resolveCaseLabels, useCaseLabels } from './labels';
import { ClassificationPicker, type ClassificationPickerSelection } from './classification-picker';

function buildSchema(errors: CaseLabels['form']['errors']) {
  return z
    .object({
      title_ar: z.string().trim().optional().default(''),
      title_en: z.string().trim().optional().default(''),
      case_type: z.string().trim().min(1, errors.caseTypeRequired),
      beneficiary_entity_id: z.string().trim().min(1, errors.organisationUnitRequired),
      company_status: z.enum(CASE_COMPANY_STATUS_OPTIONS as unknown as [CaseCompanyStatus, ...CaseCompanyStatus[]]),
      status: z.enum(CASE_STATUS_OPTIONS as unknown as [CaseStatus, ...CaseStatus[]]),
      priority: z.enum(LEGAL_PRIORITY_OPTIONS as unknown as [LegalPriority, ...LegalPriority[]]),
      strength: z.string().optional().default(''),
      classification_id: z.string().optional().nullable(),
      other_case_type: z.string().trim().optional().default(''),
      contract_id: z.string().trim().optional().default(''),
      request_id: z.string().trim().optional().default(''),
      court_id: z.string().trim().optional().default(''),
      chamber: z.string().trim().optional().default(''),
      filing_date: z.string().trim().optional().default(''),
      claim_amount: z.string().trim().optional().default(''),
      court_fees: z.string().trim().optional().default(''),
      legal_fees: z.string().trim().optional().default(''),
      currency: z.string().trim().optional().default('SAR'),
      expected_resolution_date: z.string().trim().optional().default(''),
      department: z.string().trim().optional().default(''),
      description: z.string().trim().optional().default(''),
    })
    .refine((v) => v.title_ar.length > 0 || v.title_en.length > 0, {
      path: ['title_ar'],
      message: errors.titleRequired,
    })
    .refine((v) => v.case_type !== 'OTHER' || v.other_case_type.length > 0, {
      path: ['other_case_type'],
      message: errors.otherCaseTypeRequired,
    });
}

type CaseFormValues = z.infer<ReturnType<typeof buildSchema>>;
type CaseFormField = keyof CaseFormValues;

const ACTIVE_COURT_STATUSES: CaseStatus[] = ['phase1', 'phase2', 'open', 'under_procedure'];

/** Where a catalogue administrator goes to populate the competent-court list. */
const COURTS_ADMIN_HREF = '/lex/admin/courts';

/**
 * Copy for the empty competent-court catalogue.
 *
 * `legal_courts` ships with zero rows on purpose — the customer's court list
 * arrived blank and inventing Saudi court names would be worse than an empty
 * one. An unexplained empty dropdown reads as a broken field, so the field says
 * plainly that nothing is configured, and points whoever can fix it at the
 * screen that fixes it.
 */
const COURT_CATALOGUE_EMPTY_COPY = {
  en: {
    title: 'No courts configured',
    manageBody:
      'The competent-court list is empty, so there is nothing to select. Add your courts to the catalogue and they become selectable here immediately.',
    manageCta: 'Manage courts',
    readOnlyBody:
      'The competent-court list is empty, so there is nothing to select. Ask an administrator with catalogue permissions to add your courts.',
  },
  ar: {
    title: 'لا توجد محاكم مُهيّأة',
    manageBody:
      'قائمة المحاكم المختصة فارغة، فلا يوجد ما يمكن اختياره. أضف محاكمك إلى الدليل لتصبح قابلة للاختيار هنا مباشرةً.',
    manageCta: 'إدارة المحاكم',
    readOnlyBody:
      'قائمة المحاكم المختصة فارغة، فلا يوجد ما يمكن اختياره. اطلب من مسؤول لديه صلاحية إدارة الأدلة إضافة المحاكم.',
  },
} as const;

const WIZARD_STEPS: Array<{
  id: string;
  fields: CaseFormField[];
}> = [
  {
    id: 'intake',
    fields: [
      'title_ar',
      'title_en',
      'case_type',
      'other_case_type',
      'beneficiary_entity_id',
      'company_status',
      'status',
      'priority',
      'strength',
      'description',
      'contract_id',
      'request_id',
    ],
  },
  {
    id: 'court',
    fields: [
      'court_id',
      'chamber',
      'filing_date',
      'claim_amount',
      'court_fees',
      'legal_fees',
      'currency',
      'expected_resolution_date',
      'department',
    ],
  },
];

function buildDefaults(legalCase?: LegalCase | null): CaseFormValues {
  const beneficiaryEntityID = legalCase?.metadata?.beneficiary_entity_id;
  const inferredOtherType = Boolean(
    legalCase && !legalCase.classification_id && legalCase.case_type === 'OTHER',
  );
  return {
    title_ar: legalCase?.title?.ar ?? '',
    title_en: legalCase?.title?.en ?? '',
    case_type: inferredOtherType ? 'OTHER' : (legalCase?.case_type ?? ''),
    beneficiary_entity_id:
      typeof beneficiaryEntityID === 'string' ? beneficiaryEntityID : '',
    company_status: legalCase?.company_status ?? 'plaintiff',
    status: legalCase?.status ?? 'intake',
    priority: legalCase?.priority ?? 'medium',
    strength: legalCase?.strength ?? '',
    classification_id: legalCase?.classification_id ?? null,
    other_case_type: inferredOtherType ? (legalCase?.other_case_type ?? '') : '',
    contract_id: legalCase?.contract_id ?? '',
    request_id: legalCase?.request_id ?? '',
    court_id: legalCase?.court_id ?? '',
    chamber: legalCase?.chamber ?? '',
    filing_date: legalCase?.filing_date?.slice(0, 10) ?? '',
    claim_amount: legalCase?.claim_amount == null ? '' : String(legalCase.claim_amount),
    court_fees: legalCase?.court_fees == null ? '' : String(legalCase.court_fees),
    legal_fees: legalCase?.legal_fees == null ? '' : String(legalCase.legal_fees),
    currency: legalCase?.currency ?? 'SAR',
    expected_resolution_date: legalCase?.expected_resolution_date?.slice(0, 10) ?? '',
    department: legalCase?.department ?? '',
    description: legalCase?.description ?? '',
  };
}

function optionalAmount(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * `<input type="date">` yields a date-only `YYYY-MM-DD` string, but the API's
 * time fields decode strict RFC3339 — a bare date is rejected as "invalid
 * request body". Normalize to a UTC-midnight RFC3339 timestamp (or null when
 * empty/unparseable) so the case create/update payload matches the backend.
 */
function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type MetadataRecord = Record<string, unknown>;

interface ClassificationIntakeGuidance {
  chain: CaseClassification[];
  evidenceChecklist: string[];
  questions: string[];
  department?: string;
  priority?: LegalPriority;
  caseType?: string;
  usefulMetadataKeys: string[];
  hasMetadata: boolean;
}

const EMPTY_GUIDANCE: ClassificationIntakeGuidance = {
  chain: [],
  evidenceChecklist: [],
  questions: [],
  usefulMetadataKeys: [],
  hasMetadata: false,
};

const DEPARTMENT_METADATA_PATHS = [
  ['routing', 'department'],
  ['routing', 'default_department'],
  ['routing', 'defaultDepartment'],
  ['routing', 'responsible_department'],
  ['routing', 'queue'],
  ['routing', 'triage_queue'],
  ['intake', 'department'],
  ['intake', 'default_department'],
  ['default_department'],
  ['defaultDepartment'],
  ['routing_department'],
  ['routingDepartment'],
  ['responsible_department'],
  ['responsibleDepartment'],
  ['concerned_department'],
  ['concernedDepartment'],
  ['owner_department'],
  ['triage_queue'],
  ['triageQueue'],
  ['queue'],
  ['department'],
];

const PRIORITY_METADATA_PATHS = [
  ['routing', 'priority'],
  ['routing', 'default_priority'],
  ['routing', 'defaultPriority'],
  ['intake', 'priority'],
  ['intake', 'default_priority'],
  ['default_priority'],
  ['defaultPriority'],
  ['recommended_priority'],
  ['recommendedPriority'],
  ['suggested_priority'],
  ['suggestedPriority'],
  ['priority'],
];

const CASE_TYPE_METADATA_PATHS = [
  ['routing', 'case_type'],
  ['routing', 'caseType'],
  ['intake', 'case_type'],
  ['intake', 'caseType'],
  ['default_case_type'],
  ['defaultCaseType'],
  ['suggested_case_type'],
  ['suggestedCaseType'],
  ['matter_type'],
  ['matterType'],
  ['classification_type'],
  ['case_type'],
  ['caseType'],
  ['case', 'type'],
];

const EVIDENCE_METADATA_PATHS = [
  ['intake', 'required_evidence'],
  ['intake', 'requiredEvidence'],
  ['intake', 'evidence'],
  ['required_evidence'],
  ['requiredEvidence'],
  ['evidence', 'required'],
  ['evidence', 'checklist'],
  ['evidence_checklist'],
  ['evidenceChecklist'],
  ['required_documents'],
  ['requiredDocuments'],
  ['documents', 'required'],
  ['document_checklist'],
  ['documentChecklist'],
];

const CHECKLIST_METADATA_PATHS = [
  ['intake', 'checklist'],
  ['intake', 'checklist_items'],
  ['checklist'],
  ['checklist_items'],
  ['checklistItems'],
  ['required_checklist'],
  ['requiredChecklist'],
  ['routing', 'checklist'],
];

const QUESTION_METADATA_PATHS = [
  ['intake', 'questions'],
  ['intake', 'intake_questions'],
  ['intake_questions'],
  ['intakeQuestions'],
  ['questions'],
  ['strength', 'questions'],
  ['strength', 'indicators'],
  ['strength_questions'],
  ['strengthQuestions'],
  ['strength_indicators'],
  ['strengthIndicators'],
  ['strength_assessment'],
  ['strengthAssessment'],
  ['assessment_questions'],
  ['risk_questions'],
  ['key_questions'],
  ['success_criteria'],
  ['weakness_indicators'],
];

function isRecord(value: unknown): value is MetadataRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPath(record: MetadataRecord | null | undefined, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function formatMetadataText(value: unknown, locale: AppLocale): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (isLocalizedText(value)) {
    const localized = resolveLocalized(value, locale).trim();
    return localized || undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ['label', 'title', 'name', 'description', 'question', 'text', 'value']) {
    const nested = formatMetadataText(value[key], locale);
    if (nested) return nested;
  }
  return undefined;
}

function collectMetadataList(value: unknown, locale: AppLocale): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectMetadataList(item, locale));
  }
  if (isRecord(value)) {
    for (const key of ['items', 'required', 'questions', 'evidence', 'checklist']) {
      const nested = value[key];
      if (Array.isArray(nested)) {
        return collectMetadataList(nested, locale);
      }
    }
  }

  const text = formatMetadataText(value, locale);
  if (!text) return [];
  return text
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueItems(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function collectFromChain(
  chain: CaseClassification[],
  paths: string[][],
  locale: AppLocale,
): string[] {
  const items: string[] = [];
  for (const node of chain) {
    const metadata = node.metadata ?? null;
    if (!metadata) continue;
    for (const path of paths) {
      items.push(...collectMetadataList(readPath(metadata, path), locale));
    }
  }
  return uniqueItems(items);
}

function firstStringFromChain(
  chain: CaseClassification[],
  paths: string[][],
  locale: AppLocale,
): string | undefined {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const metadata = chain[index]?.metadata ?? null;
    if (!metadata) continue;
    for (const path of paths) {
      const value = formatMetadataText(readPath(metadata, path), locale);
      if (value) return value;
    }
  }
  return undefined;
}

function firstPriorityFromChain(chain: CaseClassification[], locale: AppLocale): LegalPriority | undefined {
  const value = firstStringFromChain(chain, PRIORITY_METADATA_PATHS, locale)?.toLowerCase();
  if (!value) return undefined;
  if (value === 'urgent') return 'high';
  if (value === 'normal') return 'medium';
  return LEGAL_PRIORITY_OPTIONS.includes(value as LegalPriority) ? (value as LegalPriority) : undefined;
}

function metadataKeys(chain: CaseClassification[]): string[] {
  return uniqueItems(
    chain.flatMap((node) => {
      const metadata = node.metadata ?? null;
      return metadata ? Object.keys(metadata) : [];
    }),
  );
}

const FALLBACK_EVIDENCE: Record<'rent' | 'labor' | 'commercial' | 'enforcement' | 'investigation' | 'default', { en: string[]; ar: string[] }> = {
  rent: {
    en: [
      'Lease agreement and addenda',
      'Rent ledger, payment proof, and invoices',
      'Eviction or rental notices and tenant correspondence',
      'Court, Najiz, or committee filing references',
    ],
    ar: [
      'عقد الإيجار وملاحقه',
      'سجل الإيجار وإثبات الدفع والفواتير',
      'إشعارات الإخلاء أو الإيجار ومراسلات المستأجر',
      'مراجع الإيداع لدى المحكمة أو ناجز أو اللجنة',
    ],
  },
  labor: {
    en: [
      'Employment contract and job records',
      'Payroll, leave, or end-of-service calculations',
      'Warnings, correspondence, and internal decisions',
    ],
    ar: [
      'عقد العمل وسجلات الوظيفة',
      'حسابات الرواتب أو الإجازات أو نهاية الخدمة',
      'الإنذارات والمراسلات والقرارات الداخلية',
    ],
  },
  commercial: {
    en: [
      'Contract, purchase order, or transaction record',
      'Invoices, delivery proof, and account statement',
      'Demand letters and counterpart correspondence',
    ],
    ar: [
      'العقد أو أمر الشراء أو سجل المعاملة',
      'الفواتير وإثبات التسليم وكشف الحساب',
      'خطابات المطالبة ومراسلات الطرف المقابل',
    ],
  },
  enforcement: {
    en: [
      'Judgment, execution deed, or enforceable instrument',
      'Debtor details and asset or bank information',
      'Execution portal references and prior notices',
    ],
    ar: [
      'الحكم أو سند التنفيذ أو الأداة القابلة للتنفيذ',
      'بيانات المدين ومعلومات الأصول أو البنوك',
      'مراجع بوابة التنفيذ والإشعارات السابقة',
    ],
  },
  investigation: {
    en: [
      'Initial complaint or incident report',
      'Evidence log, interview notes, and custody trail',
      'Relevant policy, authority, or disciplinary record',
    ],
    ar: [
      'الشكوى الأولية أو تقرير الواقعة',
      'سجل الأدلة وملاحظات المقابلات وسلسلة الحيازة',
      'السياسة أو الصلاحية أو السجل التأديبي ذي الصلة',
    ],
  },
  default: {
    en: [
      'Claim or court filing reference',
      'Contracts, invoices, notices, and correspondence',
      'Authority evidence and approval basis',
    ],
    ar: [
      'مرجع المطالبة أو الإيداع لدى المحكمة',
      'العقود والفواتير والإشعارات والمراسلات',
      'إثبات الصلاحية وأساس الاعتماد',
    ],
  },
};

function fallbackEvidenceForChain(chain: CaseClassification[], locale: AppLocale): string[] {
  const codeText = chain.map((node) => node.code).join(' ').toLowerCase();
  const side = locale === 'ar' ? 'ar' : 'en';
  if (codeText.includes('rent') || codeText.includes('eviction') || codeText.includes('fair') || codeText.includes('tax')) {
    return FALLBACK_EVIDENCE.rent[side];
  }
  if (codeText.includes('labor')) {
    return FALLBACK_EVIDENCE.labor[side];
  }
  if (codeText.includes('commercial')) {
    return FALLBACK_EVIDENCE.commercial[side];
  }
  if (codeText.includes('enforcement')) {
    return FALLBACK_EVIDENCE.enforcement[side];
  }
  if (codeText.includes('investigation')) {
    return FALLBACK_EVIDENCE.investigation[side];
  }
  return FALLBACK_EVIDENCE.default[side];
}

function fallbackQuestionsForChain(chain: CaseClassification[], locale: AppLocale): string[] {
  const selected = chain[chain.length - 1];
  const fallbackClassification = resolveCaseLabels(locale).form.guidance.fallbackClassification;
  if (locale === 'ar') {
    const label = selected ? resolveLocalized(selected.name, locale) || selected.code : fallbackClassification;
    return [
      `ما الوقائع والتواريخ التي تثبت موقف الشركة بشأن ${label}؟`,
      'هل توجد جلسات أو مواعيد تقادم أو مهل تنفيذ أو مخاطر منع وشيكة؟',
      'أي إدارة تملك الوقائع أو السجلات أو القرار التجاري وراء هذه المسألة؟',
    ];
  }
  const label = selected ? resolveLocalized(selected.name, locale) || selected.code : fallbackClassification;
  return [
    `What facts and dates prove the company's position for ${label}?`,
    'Are any hearings, limitation dates, execution deadlines, or injunction risks urgent?',
    'Which department owns the facts, records, or business decision behind this matter?',
  ];
}

function buildIntakeGuidance(
  chain: CaseClassification[],
  locale: AppLocale,
): ClassificationIntakeGuidance {
  if (!chain.length) return EMPTY_GUIDANCE;

  const keys = metadataKeys(chain);
  const selected = chain[chain.length - 1];
  const evidenceChecklist = collectFromChain(
    chain,
    [...EVIDENCE_METADATA_PATHS, ...CHECKLIST_METADATA_PATHS],
    locale,
  );
  const questions = collectFromChain(chain, QUESTION_METADATA_PATHS, locale);
  const caseTypeFromName = selected ? resolveLocalized(selected.name, locale).trim() : '';
  const caseType = firstStringFromChain(chain, CASE_TYPE_METADATA_PATHS, locale) ?? (caseTypeFromName || undefined);

  return {
    chain,
    evidenceChecklist: evidenceChecklist.length ? evidenceChecklist : fallbackEvidenceForChain(chain, locale),
    questions: questions.length ? questions : fallbackQuestionsForChain(chain, locale),
    department: firstStringFromChain(chain, DEPARTMENT_METADATA_PATHS, locale),
    priority: firstPriorityFromChain(chain, locale),
    caseType,
    usefulMetadataKeys: keys,
    hasMetadata: keys.length > 0,
  };
}

function cascadeChain(
  cascade: CaseClassificationCascade | undefined,
  selection: ClassificationPickerSelection | null,
  classificationId: string | null,
): CaseClassification[] {
  if (cascade?.chain?.length) return cascade.chain;
  if (selection?.id === classificationId && selection.chain.length) return selection.chain;
  return [];
}

interface CaseFormDialogProps {
  legalCase?: LegalCase | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (legalCase: LegalCase) => void;
}

export function CaseFormDialog({ legalCase, open, onOpenChange, onSaved }: CaseFormDialogProps) {
  const isEdit = Boolean(legalCase);
  const queryClient = useQueryClient();
  const caseLabels = useCaseLabels();
  const labels = caseLabels.form;
  const { locale } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const schema = useMemo(() => buildSchema(caseLabels.form.errors), [caseLabels.form.errors]);
  const [classificationId, setClassificationId] = useState<string | null>(
    legalCase?.classification_id ?? null,
  );
  const [classificationSelection, setClassificationSelection] =
    useState<ClassificationPickerSelection | null>(null);
  const [otherCaseType, setOtherCaseType] = useState(
    legalCase?.case_type === 'OTHER' && !legalCase?.classification_id,
  );
  const [activeStep, setActiveStep] = useState(0);

  const form = useForm<CaseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: buildDefaults(legalCase),
  });

  const cascadeQuery = useQuery({
    queryKey: ['lex-case-classification-cascade', classificationId],
    queryFn: () => casesApi.getClassificationCascade(classificationId as string),
    enabled: open && Boolean(classificationId),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(buildDefaults(legalCase));
    setClassificationId(legalCase?.classification_id ?? null);
    setClassificationSelection(null);
    setOtherCaseType(legalCase?.case_type === 'OTHER' && !legalCase?.classification_id);
    setActiveStep(0);
  }, [legalCase, form, open]);

  const save = useMutation({
    mutationFn: (values: CaseFormValues) => {
      const titleAr = values.title_ar.trim();
      const titleEn = values.title_en.trim();
      const payload: Omit<CreateLegalCasePayload, 'status'> = {
        case_type: otherCaseType ? 'OTHER' : values.case_type,
        other_case_type: otherCaseType ? values.other_case_type : null,
        company_status: values.company_status,
        priority: values.priority,
        title: { ar: titleAr || titleEn, en: titleEn || titleAr },
        description: values.description,
        strength: (values.strength as CaseStrength) || null,
        classification_id: otherCaseType ? null : classificationId,
        contract_id: values.contract_id || null,
        request_id: values.request_id || null,
        court_id: values.court_id || null,
        chamber: values.chamber ?? '',
        filing_date: toIsoDate(values.filing_date),
        claim_amount: optionalAmount(values.claim_amount),
        court_fees: optionalAmount(values.court_fees),
        legal_fees: optionalAmount(values.legal_fees),
        currency: values.currency || 'SAR',
        expected_resolution_date: toIsoDate(values.expected_resolution_date),
        department: values.department ?? '',
        metadata: {
          ...(legalCase?.metadata ?? {}),
          beneficiary_entity_id: values.beneficiary_entity_id,
        },
      };
      if (isEdit && legalCase) {
        const clearedFields = [
          legalCase.contract_id && !values.contract_id ? 'contract_id' : null,
          legalCase.request_id && !values.request_id ? 'request_id' : null,
          legalCase.court_id && !values.court_id ? 'court_id' : null,
          legalCase.classification_id && (!classificationId || otherCaseType)
            ? 'classification_id'
            : null,
          legalCase.other_case_type && !otherCaseType ? 'other_case_type' : null,
        ].filter((field): field is string => Boolean(field));
        const update: UpdateLegalCasePayload = {
          ...payload,
          ...(clearedFields.length ? { cleared_fields: clearedFields } : {}),
        };
        return casesApi.updateCase(legalCase.id, update);
      }
      return casesApi.createCase({ ...payload, status: 'intake' });
    },
    onSuccess: async (saved) => {
      showSuccess(isEdit ? caseLabels.toast.updated : caseLabels.toast.created);
      await queryClient.invalidateQueries({ queryKey: ['lex-cases'] });
      if (isEdit) {
        await queryClient.invalidateQueries({ queryKey: ['lex-case', saved.id] });
      }
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });

  const wizardLabels = labels.wizard;
  const wizardSteps = useMemo(
    () => [
      { id: 'intake', title: wizardLabels.intakeTitle, description: wizardLabels.intakeDescription },
      { id: 'court', title: wizardLabels.courtTitle, description: wizardLabels.courtDescription },
    ],
    [wizardLabels],
  );
  const companyStatusValue = form.watch('company_status');
  const beneficiaryEntityValue = form.watch('beneficiary_entity_id');
  const contractValue = form.watch('contract_id');
  const requestValue = form.watch('request_id');
  const courtValue = form.watch('court_id');
  const caseTypeValue = form.watch('case_type');
  const statusValue = form.watch('status');
  const priorityValue = form.watch('priority');
  const strengthValue = form.watch('strength');
  const departmentValue = form.watch('department');
  const isLastStep = activeStep === WIZARD_STEPS.length - 1;
  const needsCourtCue = ACTIVE_COURT_STATUSES.includes(statusValue);

  // Shared by the picker and the emptiness probe below so both sit on the same
  // React Query entry (`['lex-legal-courts', locale, search]`) — one request,
  // one shape, no chance of the two disagreeing about whether the list is empty.
  const loadCourtOptions = useCallback(
    async (search: string): Promise<RecordPickerOption[]> => {
      const response = await casesApi.listCourts({
        page: 1,
        per_page: 100,
        search: search || undefined,
        sort: 'sort',
        order: 'asc',
        filters: { active: 'true' },
      });
      return response.data
        .filter((court) => court.active)
        .map((court) => ({
          value: court.id,
          label: resolveLocalized(court.name, locale) || court.code,
          description: court.code,
          keywords: [court.name.ar, court.name.en, court.code].filter(
            (item): item is string => Boolean(item),
          ),
        }));
    },
    [locale],
  );

  // Mirrors the picker's unsearched fetch so the "nothing is configured" notice
  // is visible on the step itself, not only after opening an empty popover.
  const courtCatalogueQuery = useQuery({
    queryKey: ['lex-legal-courts', locale, ''],
    queryFn: () => loadCourtOptions(''),
    enabled: open && activeStep === 1,
    staleTime: 60_000,
  });
  const courtCatalogueEmpty =
    courtCatalogueQuery.isSuccess && (courtCatalogueQuery.data?.length ?? 0) === 0;
  const courtEmptyCopy = COURT_CATALOGUE_EMPTY_COPY[locale === 'ar' ? 'ar' : 'en'];
  const canManageCourtCatalogue = hasPermission('lex:catalog:manage');
  const selectedClassificationChain = useMemo(
    () => cascadeChain(cascadeQuery.data, classificationSelection, classificationId),
    [cascadeQuery.data, classificationSelection, classificationId],
  );
  const intakeGuidance = useMemo(
    () => buildIntakeGuidance(selectedClassificationChain, locale),
    [selectedClassificationChain, locale],
  );
  const sideCue =
    companyStatusValue === 'defendant'
      ? wizardLabels.sideCueDefendant
      : wizardLabels.sideCuePlaintiff;
  const classificationCue = classificationId
    ? wizardLabels.classificationCueSelected
    : statusValue === 'intake'
      ? wizardLabels.classificationCueIntake
      : wizardLabels.classificationCueExpected;

  const handleClassificationChange = (id: string | null) => {
    setClassificationId(id);
    form.setValue('classification_id', id, { shouldDirty: true });
    if (!id) {
      setOtherCaseType(false);
      form.setValue('other_case_type', '', { shouldDirty: true });
      form.setValue('case_type', '', { shouldDirty: true, shouldValidate: true });
    }
  };

  const handleClassificationSelection = (selection: ClassificationPickerSelection) => {
    setClassificationSelection(selection);
    if (!selection.node) return;
    setOtherCaseType(false);
    form.setValue('other_case_type', '', { shouldDirty: true });
    form.setValue('case_type', selection.node.code, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  const selectOtherCaseType = () => {
    setOtherCaseType(true);
    setClassificationId(null);
    setClassificationSelection(null);
    form.setValue('classification_id', null, { shouldDirty: true });
    form.setValue('case_type', 'OTHER', { shouldDirty: true, shouldValidate: true });
  };

  const applyRoutingSuggestion = () => {
    if (!intakeGuidance.department) return;
    form.setValue('department', intakeGuidance.department, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  const applyPrioritySuggestion = () => {
    if (!intakeGuidance.priority) return;
    form.setValue('priority', intakeGuidance.priority, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  const applyCaseTypeSuggestion = () => {
    if (!intakeGuidance.caseType) return;
    form.setValue('case_type', intakeGuidance.caseType, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  const goNext = async () => {
    const isValid = await form.trigger(WIZARD_STEPS[activeStep].fields, { shouldFocus: true });
    if (isValid) setActiveStep((current) => Math.min(current + 1, WIZARD_STEPS.length - 1));
  };

  const submit = form.handleSubmit(
    (values) => save.mutate(values),
    (errors) => {
      const firstStepWithError = WIZARD_STEPS.findIndex((step) =>
        step.fields.some((field) => Boolean(errors[field])),
      );
      if (firstStepWithError >= 0) setActiveStep(firstStepWithError);
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? labels.editTitle : labels.createTitle}</DialogTitle>
          <DialogDescription>{isEdit ? labels.editDescription : labels.createDescription}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={submit}>
            {!isEdit ? (
              <LexCreationGuidance workflow="case" className="[&_p]:text-foreground" />
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {wizardSteps.map((step, index) => {
                const complete = index < activeStep;
                const active = index === activeStep;
                return (
                  <Button
                    key={step.id}
                    type="button"
                    variant="outline"
                    className={cn(
                      // `Button` is `whitespace-nowrap` by default, which kept the
                      // step description on one line and let it overflow into the
                      // neighbouring card. These cards are multi-line by design, so
                      // the wrap is re-enabled and `min-w-0` lets the grid track
                      // actually shrink instead of being forced to the text width.
                      'h-auto min-w-0 flex-col items-stretch justify-start whitespace-normal rounded-lg p-3 text-start transition-colors',
                      active ? 'border-primary bg-primary/5' : 'bg-muted/30 hover:bg-muted/50',
                    )}
                    onClick={() => setActiveStep(index)}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {complete ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      ) : (
                        <Circle
                          className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 break-words">{step.title}</span>
                    </span>
                    <span className="mt-1 block break-words text-xs text-foreground">{step.description}</span>
                  </Button>
                );
              })}
            </div>

            {activeStep === 0 ? (
              <div className="space-y-4">
                <RequiredCue tone="primary" text={sideCue} />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField name="title_ar" label={labels.titleAr} required>
                    <Input id="title_ar" dir="rtl" {...form.register('title_ar')} placeholder={labels.titleArPlaceholder} />
                  </FormField>
                  <FormField name="title_en" label={labels.titleEn}>
                    <Input id="title_en" dir="ltr" {...form.register('title_en')} placeholder={labels.titleEnPlaceholder} />
                  </FormField>
                  <FormField name="case_type" label={labels.caseType} required>
                    <ClassificationPicker
                      id="case_type"
                      value={classificationId}
                      selectedLabel={
                        cascadeQuery.data
                          ? resolveLocalized(cascadeQuery.data.name, locale) || cascadeQuery.data.code
                          : undefined
                      }
                      otherSelected={otherCaseType}
                      onChange={handleClassificationChange}
                      onOtherSelect={selectOtherCaseType}
                      onSelectionChange={handleClassificationSelection}
                      disabled={save.isPending}
                    />
                    {otherCaseType ? (
                      <FormField name="other_case_type" label={labels.otherCaseType} required>
                        <Input
                          id="other_case_type"
                          {...form.register('other_case_type')}
                          placeholder={labels.otherCaseTypePlaceholder}
                        />
                      </FormField>
                    ) : null}
                  </FormField>
                  <FormField name="beneficiary_entity_id" label={labels.organisationUnit} required>
                    <OrgEntityPicker
                      id="beneficiary_entity_id"
                      ariaLabel={labels.organisationUnit}
                      value={beneficiaryEntityValue}
                      onChange={(value) =>
                        form.setValue('beneficiary_entity_id', value, {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        })
                      }
                      required
                      disabled={save.isPending}
                      labels={{
                        select: labels.organisationUnitPlaceholder,
                        search: labels.organisationUnitSearch,
                        loading: labels.organisationUnitLoading,
                        empty: labels.organisationUnitEmpty,
                        loadError: labels.organisationUnitLoadError,
                        retry: labels.organisationUnitRetry,
                      }}
                      className="w-full"
                    />
                  </FormField>
                  <FormField name="company_status" label={labels.companyStatus} required>
                    <Select
                      value={companyStatusValue}
                      onValueChange={(v) => form.setValue('company_status', v as CaseCompanyStatus, { shouldValidate: true })}
                    >
                      <SelectTrigger id="company_status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CASE_COMPANY_STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o} value={o}>
                            {caseLabels.filters.companyStatusOptions[o]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField name="status" label={labels.status} required>
                    <Select
                      value={statusValue}
                      disabled
                    >
                      <SelectTrigger id="status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CASE_STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o} value={o}>
                            {caseLabels.filters.statusOptions[o]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField name="priority" label={labels.priority} required>
                    <Select
                      value={priorityValue}
                      onValueChange={(v) => form.setValue('priority', v as LegalPriority, { shouldValidate: true })}
                    >
                      <SelectTrigger id="priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEGAL_PRIORITY_OPTIONS.map((o) => (
                          <SelectItem key={o} value={o}>
                            {caseLabels.filters.priorityOptions[o]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>

                <div className="rounded-lg border bg-muted/20 p-3">
                  <h3 className="text-sm font-semibold">{labels.relatedRecordTitle}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {labels.relatedRecordDescription}
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField name="contract_id" label={labels.relatedContract}>
                      <LexRecordPicker
                        id="contract_id"
                        kind="contract"
                        ariaLabel={labels.relatedContract}
                        value={contractValue}
                        onChange={(value) => {
                          form.setValue('contract_id', value, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          });
                          if (value) {
                            form.setValue('request_id', '', {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }
                        }}
                        allowClear
                        disabled={save.isPending}
                        labels={{
                          select: labels.relatedContractPlaceholder,
                          search: labels.relatedContractSearch,
                          empty: labels.relatedContractEmpty,
                          loadError: labels.relatedContractLoadError,
                          retry: labels.retry,
                        }}
                      />
                    </FormField>
                    <FormField name="request_id" label={labels.relatedRequest}>
                      <LexRecordPicker
                        id="request_id"
                        kind="legal_request"
                        ariaLabel={labels.relatedRequest}
                        value={requestValue}
                        onChange={(value) => {
                          form.setValue('request_id', value, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          });
                          if (value) {
                            form.setValue('contract_id', '', {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }
                        }}
                        allowClear
                        disabled={save.isPending}
                        labels={{
                          select: labels.relatedRequestPlaceholder,
                          search: labels.relatedRequestSearch,
                          empty: labels.relatedRequestEmpty,
                          loadError: labels.relatedRequestLoadError,
                          retry: labels.retry,
                        }}
                      />
                    </FormField>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {labels.relatedRecordExclusive}
                  </p>
                </div>

                <RequiredCue tone={classificationId || statusValue === 'intake' ? 'muted' : 'warning'} text={classificationCue} />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField name="strength" label={labels.strength}>
                    <Select
                      value={strengthValue || 'none'}
                      onValueChange={(v) => form.setValue('strength', v === 'none' ? '' : v, { shouldValidate: true })}
                    >
                      <SelectTrigger id="strength">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{labels.noStrength}</SelectItem>
                        {CASE_STRENGTH_OPTIONS.map((o) => (
                          <SelectItem key={o} value={o}>
                            {caseLabels.filters.strengthOptions[o]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
                {classificationId ? (
                  <ClassificationIntakeGuidancePanel
                    guidance={intakeGuidance}
                    loading={cascadeQuery.isFetching && selectedClassificationChain.length === 0}
                    cascadeUnavailable={cascadeQuery.isError}
                    locale={locale}
                    priorityLabels={caseLabels.filters.priorityOptions}
                    currentDepartment={departmentValue}
                    currentPriority={priorityValue}
                    currentCaseType={caseTypeValue}
                    onApplyRouting={applyRoutingSuggestion}
                    onApplyPriority={applyPrioritySuggestion}
                    onApplyCaseType={applyCaseTypeSuggestion}
                  />
                ) : null}
                <FormField name="description" label={labels.description}>
                  <Textarea id="description" rows={4} {...form.register('description')} placeholder={labels.descriptionPlaceholder} />
                </FormField>
              </div>
            ) : null}

            {activeStep === 1 ? (
              <div className="space-y-4">
                <RequiredCue
                  tone={needsCourtCue ? 'warning' : 'muted'}
                  text={needsCourtCue ? wizardLabels.courtCueNeeded : wizardLabels.courtCueOptional}
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField name="court_id" label={labels.competentCourt}>
                    <AsyncRecordPicker
                      id="court_id"
                      ariaLabel={labels.competentCourt}
                      queryKey={['lex-legal-courts', locale]}
                      loadOptions={loadCourtOptions}
                      value={courtValue}
                      onChange={(value) =>
                        form.setValue('court_id', value, {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        })
                      }
                      allowClear
                      disabled={save.isPending}
                      selectedLabel={
                        legalCase?.court
                          ? resolveLocalized(legalCase.court.name, locale) || legalCase.court.code
                          : (legalCase?.competent_court ?? undefined)
                      }
                      labels={{
                        select: labels.competentCourtPlaceholder,
                        search: labels.competentCourtSearch,
                        loading: labels.competentCourtLoading,
                        empty: labels.competentCourtEmpty,
                        loadError: labels.competentCourtLoadError,
                        retry: labels.retry,
                      }}
                    />
                    {courtCatalogueEmpty ? (
                      <div
                        className="mt-2 rounded-md border border-warning-300/60 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-300"
                        role="status"
                        data-testid="court-catalogue-empty"
                      >
                        <span className="block font-medium">{courtEmptyCopy.title}</span>
                        <span className="mt-1 block">
                          {canManageCourtCatalogue
                            ? courtEmptyCopy.manageBody
                            : courtEmptyCopy.readOnlyBody}
                        </span>
                        {canManageCourtCatalogue ? (
                          <Link
                            href={COURTS_ADMIN_HREF}
                            className="mt-1.5 inline-flex items-center gap-1 font-medium underline underline-offset-2"
                          >
                            {courtEmptyCopy.manageCta}
                            <ArrowRight className="h-3 w-3 rtl:-scale-x-100" aria-hidden />
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                    {legalCase?.competent_court && !legalCase.court_id ? (
                      <div
                        className="mt-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                        role="status"
                      >
                        <span className="block font-medium text-foreground">
                          {labels.legacyCourtLabel}
                        </span>
                        <span className="mt-1 block">
                          {labels.legacyCourtDescription(legalCase.competent_court)}
                        </span>
                      </div>
                    ) : null}
                  </FormField>
                  <FormField name="chamber" label={locale === 'ar' ? 'الدائرة القضائية' : 'Court chamber'}>
                    <Input
                      id="chamber"
                      {...form.register('chamber')}
                      placeholder={locale === 'ar' ? 'مثال: الدائرة التجارية الخامسة' : 'e.g. Fifth Commercial Circuit'}
                    />
                  </FormField>
                  <FormField name="filing_date" label={locale === 'ar' ? 'تاريخ القيد' : 'Filing date'}>
                    <Input id="filing_date" type="date" {...form.register('filing_date')} />
                  </FormField>
                  <FormField name="claim_amount" label={locale === 'ar' ? 'مبلغ المطالبة' : 'Claim amount'}>
                    <Input id="claim_amount" type="number" min="0" step="0.01" {...form.register('claim_amount')} />
                  </FormField>
                  <FormField name="court_fees" label={locale === 'ar' ? 'الرسوم القضائية' : 'Court fees'}>
                    <Input id="court_fees" type="number" min="0" step="0.01" {...form.register('court_fees')} />
                  </FormField>
                  <FormField name="legal_fees" label={locale === 'ar' ? 'الأتعاب القانونية' : 'Legal fees'}>
                    <Input id="legal_fees" type="number" min="0" step="0.01" {...form.register('legal_fees')} />
                  </FormField>
                  <FormField name="currency" label={locale === 'ar' ? 'العملة' : 'Currency'}>
                    <Input id="currency" maxLength={3} {...form.register('currency')} />
                  </FormField>
                  <FormField
                    name="expected_resolution_date"
                    label={locale === 'ar' ? 'التاريخ المتوقع للحسم' : 'Expected resolution date'}
                  >
                    <Input
                      id="expected_resolution_date"
                      type="date"
                      {...form.register('expected_resolution_date')}
                    />
                  </FormField>
                  <FormField name="department" label={labels.department}>
                    <Input id="department" {...form.register('department')} placeholder={labels.departmentPlaceholder} />
                  </FormField>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.cancel}
              </Button>
              {activeStep > 0 ? (
                <Button type="button" variant="outline" onClick={() => setActiveStep((current) => current - 1)}>
                  <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden />
                  {labels.back}
                </Button>
              ) : null}
              {isLastStep ? (
                <Button
                  key="submit-case"
                  type="submit"
                  disabled={save.isPending}
                  className="bg-action-hover hover:bg-action-active"
                >
                  {save.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                  {isEdit ? labels.save : labels.create}
                </Button>
              ) : (
                <Button
                  key="next-step"
                  type="button"
                  onClick={(event) => {
                    // This control occupies the same footer position as the
                    // final submit button. Prevent the browser's default action
                    // before advancing so a synchronous React reconciliation
                    // cannot turn this click into an unintended form submit.
                    event.preventDefault();
                    void goNext();
                  }}
                >
                  {labels.next}
                  <ArrowRight className="ms-1.5 h-4 w-4" aria-hidden />
                </Button>
              )}
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function RequiredCue({ text, tone }: { text: string; tone: 'primary' | 'warning' | 'muted' }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-xs',
        tone === 'primary'
          ? 'border-primary/20 bg-primary/5 text-primary'
          : tone === 'warning'
            ? 'border-warning-300/60 bg-warning-50 text-warning-700 dark:text-warning-300'
            : 'bg-muted/40 text-foreground',
      )}
    >
      {text}
    </div>
  );
}

function ClassificationIntakeGuidancePanel({
  guidance,
  loading,
  cascadeUnavailable,
  locale,
  priorityLabels,
  currentDepartment,
  currentPriority,
  currentCaseType,
  onApplyRouting,
  onApplyPriority,
  onApplyCaseType,
}: {
  guidance: ClassificationIntakeGuidance;
  loading: boolean;
  cascadeUnavailable: boolean;
  locale: AppLocale;
  priorityLabels: Record<string, string>;
  currentDepartment: string;
  currentPriority: LegalPriority;
  currentCaseType: string;
  onApplyRouting: () => void;
  onApplyPriority: () => void;
  onApplyCaseType: () => void;
}) {
  const g = useCaseLabels().form.guidance;
  const departmentSuggestion = guidance.department;
  const prioritySuggestion = guidance.priority;
  const caseTypeSuggestion = guidance.caseType;
  const priorityLabel = prioritySuggestion ? priorityLabels[prioritySuggestion] ?? prioritySuggestion : undefined;
  const departmentMatches = Boolean(
    departmentSuggestion &&
      currentDepartment.trim().toLocaleLowerCase() === departmentSuggestion.trim().toLocaleLowerCase(),
  );
  const priorityMatches = Boolean(prioritySuggestion && currentPriority === prioritySuggestion);
  const caseTypeMatches = Boolean(
    caseTypeSuggestion &&
      currentCaseType.trim().toLocaleLowerCase() === caseTypeSuggestion.trim().toLocaleLowerCase(),
  );

  return (
    <div className="rounded-lg border bg-muted/25 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="h-4 w-4 text-primary" aria-hidden />
            {g.title}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{g.description}</p>
        </div>
        {loading ? (
          <Badge variant="secondary" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {g.loading}
          </Badge>
        ) : cascadeUnavailable ? (
          <Badge variant="warning">{g.treeFallback}</Badge>
        ) : guidance.hasMetadata ? (
          <Badge variant="success">{g.metadata}</Badge>
        ) : (
          <Badge variant="outline">{g.fallback}</Badge>
        )}
      </div>

      {guidance.chain.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {guidance.chain.map((node, index) => (
            <span key={node.id} className="inline-flex min-w-0 items-center gap-2">
              <Badge variant={index === guidance.chain.length - 1 ? 'default' : 'outline'} className="max-w-[14rem] truncate">
                {node.code}
              </Badge>
              <span className="max-w-[12rem] truncate text-xs text-muted-foreground">
                {resolveLocalized(node.name, locale) || node.code}
              </span>
              {index < guidance.chain.length - 1 ? (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground rtl:-scale-x-100" aria-hidden />
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {loading ? g.cascadeLoading : g.cascadeUnavailable}
        </p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <GuidanceList
          icon={<ListChecks className="h-4 w-4" aria-hidden />}
          title={g.requiredEvidence}
          items={guidance.evidenceChecklist}
          empty={g.noEvidence}
        />

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
            <Route className="h-4 w-4" aria-hidden />
            {g.routingHints}
          </div>
          <div className="space-y-2 text-xs">
            <SuggestionRow
              label={g.department}
              value={departmentSuggestion ?? g.notConfigured}
              actionLabel={g.applyRouting}
              disabled={!departmentSuggestion || departmentMatches}
              onApply={onApplyRouting}
            />
            <SuggestionRow
              label={g.priority}
              value={priorityLabel ?? g.notConfigured}
              actionLabel={g.applyPriority}
              disabled={!prioritySuggestion || priorityMatches}
              onApply={onApplyPriority}
            />
            <SuggestionRow
              label={g.caseType}
              value={caseTypeSuggestion ?? g.notConfigured}
              actionLabel={g.applyType}
              disabled={!caseTypeSuggestion || caseTypeMatches}
              onApply={onApplyCaseType}
            />
          </div>
          {!guidance.department && !guidance.priority ? (
            <p className="text-xs text-muted-foreground">{g.noRoutingDefaults}</p>
          ) : null}
        </div>

        <GuidanceList
          icon={<ShieldQuestion className="h-4 w-4" aria-hidden />}
          title={g.strengthQuestions}
          items={guidance.questions}
          empty={g.noQuestions}
        />
      </div>

      {guidance.hasMetadata ? (
        <p className="mt-3 truncate text-[11px] text-muted-foreground">
          {g.metadataKeys}: {guidance.usefulMetadataKeys.slice(0, 8).join(', ')}
          {guidance.usefulMetadataKeys.length > 8 ? '...' : ''}
        </p>
      ) : null}
    </div>
  );
}

function GuidanceList({
  icon,
  title,
  items,
  empty,
}: {
  icon: ReactNode;
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
        {icon}
        {title}
      </div>
      {items.length ? (
        <ul className="space-y-1 text-xs">
          {items.slice(0, 5).map((item) => (
            <li key={item} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function SuggestionRow({
  label,
  value,
  actionLabel,
  disabled,
  onApply,
}: {
  label: string;
  value: string;
  actionLabel: string;
  disabled: boolean;
  onApply: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-background/70 px-2 py-1.5">
      <div className="min-w-0">
        <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
      <Button type="button" size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" disabled={disabled} onClick={onApply}>
        {actionLabel}
      </Button>
    </div>
  );
}
