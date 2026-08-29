'use client';

/**
 * FEATURE 8 — Matter intake templates / playbooks (Matters list surface).
 *
 * `<MatterTemplateGallery>` is a curated gallery of Saudi/KSA legal-practice
 * playbooks. Each playbook ("دليل إرشادي") pre-fills a matter ("قضية / مهمة
 * قانونية") type/priority/tags/description and a list of default obligations
 * ("التزام") whose due dates ("مهلة") are derived from a relative day offset.
 *
 * On "Use template" the component:
 *   1. creates the matter via `enterpriseApi.lex.createMatter` (the user must
 *      confirm the required `title` + `owner_user_id`/`owner_name`);
 *   2. creates each default obligation via `enterpriseApi.lex.createObligation`,
 *      computing `due_date` as `new Date()` + offset days (ISO);
 *   3. invalidates `['lex-matters']` + `['lex-overview']`, toasts, and calls
 *      `onCreated(matter)`.
 *
 * Self-contained bilingual labels (EN + professional MSA) follow the canonical
 * lex `LexBilingual<T>` contract; this module owns its labels and does NOT
 * touch the shared matters `labels.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bell,
  Briefcase,
  CalendarClock,
  FileSignature,
  Gavel,
  Landmark,
  Loader2,
  ShieldAlert,
  Users,
} from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import type {
  LexCreateMatterPayload,
  LexCreateObligationPayload,
  LexLegalPriority,
  LexMatter,
  LexMatterType,
  LexObligationType,
} from '@/types/suites';

/* ------------------------------------------------------------------------- *
 * Template model.
 * ------------------------------------------------------------------------- */

/** A default obligation seeded by a playbook, due `offsetDays` after intake. */
interface MatterTemplateObligation {
  /** Stable key used for bilingual obligation copy lookup. */
  key: string;
  type: LexObligationType;
  priority: LexLegalPriority;
  /** Calendar days from "now" used to compute the obligation due date. */
  offsetDays: number;
}

/** A curated KSA legal-practice playbook. */
interface MatterTemplate {
  /** Stable identifier used for bilingual copy lookup + React keys. */
  id: string;
  icon: typeof Gavel;
  type: LexMatterType;
  priority: LexLegalPriority;
  tags: string[];
  obligations: MatterTemplateObligation[];
}

/**
 * The playbook catalog. Structural fields (type/priority/tags/offsets) are
 * locale-independent and live here; all human-facing copy is resolved from the
 * bilingual bundle keyed by `template.id` / `obligation.key`.
 */
const MATTER_TEMPLATES: readonly MatterTemplate[] = [
  {
    id: 'litigation',
    icon: Gavel,
    type: 'litigation',
    priority: 'high',
    tags: ['litigation', 'court', 'ksa'],
    obligations: [
      { key: 'engage_counsel', type: 'other', priority: 'high', offsetDays: 5 },
      { key: 'file_statement', type: 'regulatory', priority: 'critical', offsetDays: 20 },
      { key: 'evidence_bundle', type: 'delivery', priority: 'high', offsetDays: 30 },
      { key: 'hearing_prep', type: 'other', priority: 'medium', offsetDays: 45 },
    ],
  },
  {
    id: 'nda_review',
    icon: FileSignature,
    type: 'contract',
    priority: 'medium',
    tags: ['nda', 'confidentiality', 'review'],
    obligations: [
      { key: 'first_pass', type: 'reporting', priority: 'medium', offsetDays: 3 },
      { key: 'redline_return', type: 'delivery', priority: 'medium', offsetDays: 7 },
      { key: 'execution', type: 'notice', priority: 'low', offsetDays: 14 },
    ],
  },
  {
    id: 'employment_dispute',
    icon: Users,
    type: 'employment',
    priority: 'high',
    tags: ['employment', 'dispute', 'hrsd'],
    obligations: [
      { key: 'fact_gathering', type: 'reporting', priority: 'high', offsetDays: 5 },
      { key: 'settlement_offer', type: 'other', priority: 'medium', offsetDays: 15 },
      { key: 'labor_office_filing', type: 'regulatory', priority: 'critical', offsetDays: 30 },
    ],
  },
  {
    id: 'regulatory_inquiry',
    icon: Landmark,
    type: 'regulatory',
    priority: 'critical',
    tags: ['regulatory', 'inquiry', 'compliance'],
    obligations: [
      { key: 'acknowledge_regulator', type: 'notice', priority: 'critical', offsetDays: 2 },
      { key: 'compile_response', type: 'reporting', priority: 'high', offsetDays: 10 },
      { key: 'submit_response', type: 'regulatory', priority: 'critical', offsetDays: 21 },
    ],
  },
  {
    id: 'contract_advisory',
    icon: Briefcase,
    type: 'advisory',
    priority: 'medium',
    tags: ['advisory', 'contract', 'opinion'],
    obligations: [
      { key: 'scope_intake', type: 'reporting', priority: 'medium', offsetDays: 3 },
      { key: 'draft_opinion', type: 'delivery', priority: 'medium', offsetDays: 10 },
      { key: 'final_advice', type: 'delivery', priority: 'low', offsetDays: 18 },
    ],
  },
] as const;

/* ------------------------------------------------------------------------- *
 * Bilingual labels (self-contained — EN + professional MSA).
 * ------------------------------------------------------------------------- */

interface TemplateCopy {
  name: string;
  description: string;
  /** Default matter title proposed when the playbook is selected. */
  defaultTitle: string;
  obligations: Record<string, string>;
}

interface MatterTemplateLabels {
  title: string;
  description: string;
  galleryHint: string;
  obligationCount: (count: number) => string;
  defaultDueLabel: (days: number) => string;
  back: string;
  use: string;
  using: string;
  cancel: string;
  fields: {
    matterTitle: string;
    matterTitlePlaceholder: string;
    owner: string;
    ownerPlaceholder: string;
    titleRequired: string;
    ownerRequired: string;
  };
  preview: {
    typeLabel: string;
    priorityLabel: string;
    tagsLabel: string;
    obligationsLabel: string;
    obligationsHint: string;
  };
  usersError: string;
  toast: {
    created: (title: string) => string;
    createdWithObligations: (title: string, count: number) => string;
    matterCreatedObligationsFailed: (title: string) => string;
  };
  typeOptions: Record<string, string>;
  priorityOptions: Record<string, string>;
  templates: Record<string, TemplateCopy>;
}

const matterTemplateLabelsBundle: LexBilingual<MatterTemplateLabels> = {
  en: {
    title: 'New from template',
    description:
      'Start a matter from a curated KSA legal playbook. Each template pre-fills the matter type, priority, tags, and a set of default obligations with due dates.',
    galleryHint: 'Select a playbook to review and confirm before creating the matter.',
    obligationCount: (count) => `${count} default obligation${count === 1 ? '' : 's'}`,
    defaultDueLabel: (days) => `Due +${days} day${days === 1 ? '' : 's'}`,
    back: 'Back to gallery',
    use: 'Use template',
    using: 'Creating...',
    cancel: 'Cancel',
    fields: {
      matterTitle: 'Matter title',
      matterTitlePlaceholder: 'Confirm the matter title',
      owner: 'Owner',
      ownerPlaceholder: 'Select owner',
      titleRequired: 'A matter title is required.',
      ownerRequired: 'Select a matter owner.',
    },
    preview: {
      typeLabel: 'Type',
      priorityLabel: 'Priority',
      tagsLabel: 'Tags',
      obligationsLabel: 'Default obligations',
      obligationsHint: 'These obligations are created with the matter; due dates are relative to today.',
    },
    usersError: 'Unable to load the user directory. Template use is disabled until owners can be resolved.',
    toast: {
      created: (title) => `Matter "${title}" created from template.`,
      createdWithObligations: (title, count) =>
        `Matter "${title}" created with ${count} obligation${count === 1 ? '' : 's'}.`,
      matterCreatedObligationsFailed: (title) =>
        `Matter "${title}" was created, but some obligations could not be added.`,
    },
    typeOptions: {
      general: 'General',
      contract: 'Contract',
      litigation: 'Litigation',
      regulatory: 'Regulatory',
      employment: 'Employment',
      dispute: 'Dispute',
      advisory: 'Advisory',
      other: 'Other',
    },
    priorityOptions: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    },
    templates: {
      litigation: {
        name: 'Litigation case',
        description:
          'Court or arbitration dispute before a KSA judicial body, with counsel engagement, filings, and hearing preparation.',
        defaultTitle: 'New litigation case',
        obligations: {
          engage_counsel: 'Engage external counsel / power of attorney',
          file_statement: 'File statement of claim / defense',
          evidence_bundle: 'Compile and exchange evidence bundle',
          hearing_prep: 'Prepare for first hearing',
        },
      },
      nda_review: {
        name: 'NDA review',
        description:
          'Review and negotiate a non-disclosure agreement, returning redlines and tracking the path to execution.',
        defaultTitle: 'NDA review',
        obligations: {
          first_pass: 'Complete first-pass review',
          redline_return: 'Return redlines to counterparty',
          execution: 'Confirm execution and filing',
        },
      },
      employment_dispute: {
        name: 'Employment dispute',
        description:
          'Workforce dispute under the KSA Labor Law, covering fact gathering, settlement, and labor-office escalation.',
        defaultTitle: 'Employment dispute',
        obligations: {
          fact_gathering: 'Gather facts and employment records',
          settlement_offer: 'Prepare amicable settlement offer',
          labor_office_filing: 'File with the labor office if unresolved',
        },
      },
      regulatory_inquiry: {
        name: 'Regulatory inquiry',
        description:
          'Response to a regulator request or inquiry, with acknowledgement, evidence compilation, and timely submission.',
        defaultTitle: 'Regulatory inquiry',
        obligations: {
          acknowledge_regulator: 'Acknowledge regulator and confirm scope',
          compile_response: 'Compile inquiry response and evidence',
          submit_response: 'Submit response to the regulator',
        },
      },
      contract_advisory: {
        name: 'Contract advisory',
        description:
          'Legal advisory engagement on a contract or commercial question, ending in a written opinion.',
        defaultTitle: 'Contract advisory',
        obligations: {
          scope_intake: 'Confirm advisory scope and questions',
          draft_opinion: 'Draft legal opinion',
          final_advice: 'Deliver final written advice',
        },
      },
    },
  },
  ar: {
    title: 'إنشاء من قالب',
    description:
      'ابدأ مهمة قانونية من دليل إرشادي مُعدّ للممارسة القانونية السعودية. يملأ كل قالب نوع القضية والأولوية والوسوم ومجموعة من الالتزامات الافتراضية مع تواريخ استحقاقها.',
    galleryHint: 'اختر دليلًا إرشاديًا للمراجعة والتأكيد قبل إنشاء القضية.',
    obligationCount: (count) => `${count} التزام افتراضي`,
    defaultDueLabel: (days) => `الاستحقاق بعد ${days} يومًا`,
    back: 'العودة إلى المعرض',
    use: 'استخدام القالب',
    using: 'جارٍ الإنشاء...',
    cancel: 'إلغاء',
    fields: {
      matterTitle: 'عنوان القضية',
      matterTitlePlaceholder: 'أكّد عنوان القضية',
      owner: 'المسؤول',
      ownerPlaceholder: 'اختر المسؤول',
      titleRequired: 'عنوان القضية مطلوب.',
      ownerRequired: 'اختر مسؤولًا للقضية.',
    },
    preview: {
      typeLabel: 'النوع',
      priorityLabel: 'الأولوية',
      tagsLabel: 'الوسوم',
      obligationsLabel: 'الالتزامات الافتراضية',
      obligationsHint: 'تُنشأ هذه الالتزامات مع القضية، وتواريخ الاستحقاق محسوبة نسبةً إلى اليوم.',
    },
    usersError: 'تعذّر تحميل دليل المستخدمين. استخدام القالب معطّل حتى يمكن تعيين المسؤولين.',
    toast: {
      created: (title) => `تم إنشاء القضية "${title}" من القالب.`,
      createdWithObligations: (title, count) =>
        `تم إنشاء القضية "${title}" مع ${count} التزام.`,
      matterCreatedObligationsFailed: (title) =>
        `تم إنشاء القضية "${title}"، لكن تعذّر إضافة بعض الالتزامات.`,
    },
    typeOptions: {
      general: 'عام',
      contract: 'عقد',
      litigation: 'تقاضٍ',
      regulatory: 'تنظيمي',
      employment: 'عمالي',
      dispute: 'نزاع',
      advisory: 'استشاري',
      other: 'أخرى',
    },
    priorityOptions: {
      critical: 'حرجة',
      high: 'مرتفعة',
      medium: 'متوسطة',
      low: 'منخفضة',
    },
    templates: {
      litigation: {
        name: 'قضية تقاضٍ',
        description:
          'نزاع قضائي أو تحكيمي أمام جهة قضائية سعودية، يشمل توكيل المحامي وتقديم اللوائح والاستعداد للجلسات.',
        defaultTitle: 'قضية تقاضٍ جديدة',
        obligations: {
          engage_counsel: 'توكيل محامٍ خارجي / إعداد الوكالة',
          file_statement: 'تقديم صحيفة الدعوى / مذكرة الدفاع',
          evidence_bundle: 'إعداد وتبادل حافظة المستندات',
          hearing_prep: 'الاستعداد للجلسة الأولى',
        },
      },
      nda_review: {
        name: 'مراجعة اتفاقية سرية',
        description:
          'مراجعة اتفاقية عدم إفصاح والتفاوض عليها، مع إعادة الملاحظات وتتبّع مسار التوقيع.',
        defaultTitle: 'مراجعة اتفاقية سرية',
        obligations: {
          first_pass: 'إنجاز المراجعة الأولية',
          redline_return: 'إعادة الملاحظات إلى الطرف المقابل',
          execution: 'تأكيد التوقيع والحفظ',
        },
      },
      employment_dispute: {
        name: 'نزاع عمالي',
        description:
          'نزاع عمالي وفق نظام العمل السعودي، يشمل جمع الوقائع والتسوية والتصعيد إلى مكتب العمل.',
        defaultTitle: 'نزاع عمالي',
        obligations: {
          fact_gathering: 'جمع الوقائع وسجلات التوظيف',
          settlement_offer: 'إعداد عرض تسوية ودّية',
          labor_office_filing: 'الرفع إلى مكتب العمل عند عدم التسوية',
        },
      },
      regulatory_inquiry: {
        name: 'استفسار تنظيمي',
        description:
          'الرد على طلب أو استفسار من جهة تنظيمية، مع الإقرار وجمع الأدلة وتقديم الرد في الموعد.',
        defaultTitle: 'استفسار تنظيمي',
        obligations: {
          acknowledge_regulator: 'الإقرار للجهة التنظيمية وتأكيد النطاق',
          compile_response: 'إعداد الرد على الاستفسار والأدلة',
          submit_response: 'تقديم الرد إلى الجهة التنظيمية',
        },
      },
      contract_advisory: {
        name: 'استشارة تعاقدية',
        description:
          'مهمة استشارية قانونية حول عقد أو مسألة تجارية، تنتهي برأي قانوني مكتوب.',
        defaultTitle: 'استشارة تعاقدية',
        obligations: {
          scope_intake: 'تأكيد نطاق الاستشارة والأسئلة',
          draft_opinion: 'صياغة الرأي القانوني',
          final_advice: 'تسليم الرأي القانوني النهائي',
        },
      },
    },
  },
};

function resolveMatterTemplateLabels(locale: AppLocale = 'en'): MatterTemplateLabels {
  return resolveLexBilingual(matterTemplateLabelsBundle, locale);
}

function useMatterTemplateLabels(): MatterTemplateLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveMatterTemplateLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

export interface MatterTemplateGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the freshly created matter after the template is applied. */
  onCreated?: (matter: LexMatter) => void;
}

export function MatterTemplateGallery({
  open,
  onOpenChange,
  onCreated,
}: MatterTemplateGalleryProps) {
  const { locale, direction } = useLocaleOrDefault();
  const labels = useMatterTemplateLabels();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [matterTitle, setMatterTitle] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [touched, setTouched] = useState(false);

  const selected = useMemo(
    () => MATTER_TEMPLATES.find((template) => template.id === selectedId) ?? null,
    [selectedId],
  );
  const selectedCopy = selected ? labels.templates[selected.id] : null;

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-matter-template-gallery'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open,
  });
  const users = useMemo(() => usersQuery.data?.data ?? [], [usersQuery.data]);
  const usersById = useMemo(() => new Map(users.map((entry) => [entry.id, entry])), [users]);

  // Reset transient state whenever the dialog closes so a reopen starts at the
  // gallery with a clean form.
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setMatterTitle('');
      setOwnerUserId('');
      setTouched(false);
    }
  }, [open]);

  const selectTemplate = useCallback(
    (template: MatterTemplate) => {
      setSelectedId(template.id);
      setTouched(false);
      setMatterTitle(labels.templates[template.id]?.defaultTitle ?? '');
    },
    [labels.templates],
  );

  const backToGallery = useCallback(() => {
    setSelectedId(null);
    setTouched(false);
  }, []);

  const trimmedTitle = matterTitle.trim();
  const titleError = touched && trimmedTitle.length === 0 ? labels.fields.titleRequired : null;
  const ownerError = touched && ownerUserId.length === 0 ? labels.fields.ownerRequired : null;

  const createMutation = useMutation({
    mutationFn: async ({
      template,
      copy,
    }: {
      template: MatterTemplate;
      copy: TemplateCopy;
    }) => {
      const owner = usersById.get(ownerUserId);
      const ownerName = owner ? userDisplayName(owner) : '';

      const matterPayload: LexCreateMatterPayload = {
        title: trimmedTitle,
        description: copy.description,
        type: template.type,
        status: 'intake',
        priority: template.priority,
        owner_user_id: ownerUserId,
        owner_name: ownerName,
        tags: template.tags,
        metadata: { intake_template: template.id },
      };

      const matter = await enterpriseApi.lex.createMatter(matterPayload);

      // Seed default obligations; compute due_date from the relative offset in
      // the browser runtime. A partial obligation failure must not discard the
      // already-created matter, so we count successes and surface a soft warning.
      let obligationsCreated = 0;
      let obligationsFailed = false;
      const now = Date.now();
      for (const obligation of template.obligations) {
        const dueDate = new Date(now + obligation.offsetDays * DAY_MS).toISOString();
        const obligationPayload: LexCreateObligationPayload = {
          title: copy.obligations[obligation.key] ?? obligation.key,
          type: obligation.type,
          status: 'open',
          priority: obligation.priority,
          matter_id: matter.id,
          owner_user_id: ownerUserId,
          owner_name: ownerName,
          due_date: dueDate,
          tags: template.tags,
          metadata: { intake_template: template.id, obligation_key: obligation.key },
        };
        try {
          await enterpriseApi.lex.createObligation(obligationPayload);
          obligationsCreated += 1;
        } catch {
          obligationsFailed = true;
        }
      }

      return { matter, obligationsCreated, obligationsFailed };
    },
    onSuccess: async ({ matter, obligationsCreated, obligationsFailed }) => {
      if (obligationsFailed) {
        showApiError(new Error(labels.toast.matterCreatedObligationsFailed(matter.title)));
      } else if (obligationsCreated > 0) {
        showSuccess(labels.toast.createdWithObligations(matter.title, obligationsCreated));
      } else {
        showSuccess(labels.toast.created(matter.title));
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-matters'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-matter-obligations', matter.id] }),
      ]);
      onOpenChange(false);
      onCreated?.(matter);
    },
    onError: showApiError,
  });

  const handleUse = useCallback(() => {
    setTouched(true);
    if (!selected || !selectedCopy) {
      return;
    }
    if (trimmedTitle.length === 0 || ownerUserId.length === 0) {
      return;
    }
    createMutation.mutate({ template: selected, copy: selectedCopy });
  }, [createMutation, ownerUserId.length, selected, selectedCopy, trimmedTitle.length]);

  const usersDisabled = usersQuery.isLoading || usersQuery.isError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
        dir={direction}
        lang={locale}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        {selected && selectedCopy ? (
          <div className="space-y-5">
            <button
              type="button"
              onClick={backToGallery}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              {labels.back}
            </button>

            <div className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <selected.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold">{selectedCopy.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{selectedCopy.description}</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {labels.preview.typeLabel}
                  </dt>
                  <dd className="mt-1">
                    <Badge variant="outline">{labels.typeOptions[selected.type] ?? selected.type}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {labels.preview.priorityLabel}
                  </dt>
                  <dd className="mt-1">
                    <Badge variant={priorityVariant(selected.priority)}>
                      {labels.priorityOptions[selected.priority] ?? selected.priority}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {labels.preview.tagsLabel}
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {selected.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="matter-template-title">
                  {labels.fields.matterTitle}
                  <span className="ms-0.5 text-destructive">*</span>
                </Label>
                <Input
                  id="matter-template-title"
                  value={matterTitle}
                  onChange={(event) => setMatterTitle(event.target.value)}
                  placeholder={labels.fields.matterTitlePlaceholder}
                  aria-invalid={titleError ? true : undefined}
                />
                {titleError ? <p className="text-xs text-destructive">{titleError}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="matter-template-owner">
                  {labels.fields.owner}
                  <span className="ms-0.5 text-destructive">*</span>
                </Label>
                <Select
                  value={ownerUserId || undefined}
                  onValueChange={setOwnerUserId}
                  disabled={usersDisabled}
                >
                  <SelectTrigger id="matter-template-owner" aria-label={labels.fields.owner}>
                    <SelectValue placeholder={labels.fields.ownerPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {userDisplayName(entry)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ownerError ? <p className="text-xs text-destructive">{ownerError}</p> : null}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">{labels.preview.obligationsLabel}</p>
                <Badge variant="outline">
                  {labels.obligationCount(selected.obligations.length)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{labels.preview.obligationsHint}</p>
              <ul className="mt-3 space-y-2">
                {selected.obligations.map((obligation) => (
                  <li
                    key={obligation.key}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Bell className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm">
                        {selectedCopy.obligations[obligation.key] ?? obligation.key}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={priorityVariant(obligation.priority)}>
                        {labels.priorityOptions[obligation.priority] ?? obligation.priority}
                      </Badge>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {labels.defaultDueLabel(obligation.offsetDays)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {usersQuery.isError ? (
              <p className="text-sm text-destructive">{labels.usersError}</p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.cancel}
              </Button>
              <Button
                type="button"
                onClick={handleUse}
                disabled={createMutation.isPending || usersDisabled}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                    {labels.using}
                  </>
                ) : (
                  labels.use
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{labels.galleryHint}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {MATTER_TEMPLATES.map((template) => {
                const copy = labels.templates[template.id];
                const Icon = template.icon;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => selectTemplate(template)}
                    className="group flex flex-col rounded-lg border p-4 text-start transition-[box-shadow,border-color] duration-200 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{copy.name}</p>
                        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                          {copy.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{labels.typeOptions[template.type] ?? template.type}</Badge>
                      <Badge variant={priorityVariant(template.priority)}>
                        {labels.priorityOptions[template.priority] ?? template.priority}
                      </Badge>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        {labels.obligationCount(template.obligations.length)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function priorityVariant(priority: string): 'destructive' | 'warning' | 'secondary' {
  if (priority === 'critical' || priority === 'high') {
    return 'destructive';
  }
  if (priority === 'medium') {
    return 'warning';
  }
  return 'secondary';
}
