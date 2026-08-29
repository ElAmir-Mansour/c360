/**
 * Feature 8 — Guided empty state with curated compliance rule templates.
 *
 * Rendered inside the Watheeq compliance rule library's empty state (page.tsx,
 * when 0 rules exist). Presents a clean card grid of ready-to-create compliance
 * rules tuned for Saudi/KSA legal practice and PDPL (Personal Data Protection
 * Law). Each card can be added individually, or all at once, by calling
 * `enterpriseApi.lex.createComplianceRule(template)`. On success the
 * `['lex-compliance-rules']` and `['lex-compliance-dashboard']` queries are
 * invalidated (and `['lex-overview']` for posture consistency), a success toast
 * fires via `showSuccess`, and the optional `onSeeded` callback runs.
 *
 * Self-contained: owns its own bilingual (EN + MSA) labels following the
 * canonical lex bilingual contract (`../../_lib/lex-i18n.ts`).
 */

'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Plus, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { enterpriseApi, type LexComplianceRuleFormValues } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LexComplianceRuleType, LexComplianceSeverity } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

// ---------------------------------------------------------------------------
// Template model
// ---------------------------------------------------------------------------

/**
 * A curated template is a stable `key` (used for selection + i18n lookup) plus
 * the locale-invariant rule shape (type / severity / config). The human-facing
 * `name` + `description` are resolved per-locale from the label bundle below,
 * so the payload sent to the API carries the active-locale strings.
 */
interface RuleTemplate {
  key: string;
  rule_type: LexComplianceRuleType;
  severity: LexComplianceSeverity;
  config: Record<string, unknown>;
  contract_types: string[];
}

const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    key: 'expiry_30_day',
    rule_type: 'expiry_warning',
    severity: 'medium',
    config: { warn_before_days: 30 },
    contract_types: [],
  },
  {
    key: 'pdpl_data_protection',
    rule_type: 'data_protection_required',
    severity: 'high',
    config: {
      regulation: 'PDPL',
      required_clause: 'data_protection',
      jurisdiction: 'SA',
    },
    contract_types: [],
  },
  {
    key: 'ksa_jurisdiction',
    rule_type: 'jurisdiction_check',
    severity: 'high',
    config: {
      expected_jurisdiction: 'SA',
      expected_governing_law: 'KSA',
    },
    contract_types: [],
  },
  {
    key: 'high_value_threshold',
    rule_type: 'value_threshold',
    severity: 'high',
    config: {
      max_value: 1_000_000,
      currency: 'SAR',
      comparator: 'greater_than',
    },
    contract_types: [],
  },
  {
    key: 'unsigned_sweep',
    rule_type: 'unsigned_contract',
    severity: 'medium',
    config: { stale_after_days: 14 },
    contract_types: [],
  },
  {
    key: 'overdue_review',
    rule_type: 'review_overdue',
    severity: 'low',
    config: { review_interval_days: 90 },
    contract_types: [],
  },
] as const;

// ---------------------------------------------------------------------------
// Bilingual labels (EN + MSA)
// ---------------------------------------------------------------------------

interface TemplateCopy {
  name: string;
  description: string;
}

interface RuleTemplateLabels {
  title: string;
  description: string;
  addAll: string;
  add: string;
  added: string;
  ruleTypes: Record<string, string>;
  templates: Record<string, TemplateCopy>;
  toasts: {
    addedTitle: string;
    addedDescription: (name: string) => string;
    addAllTitle: string;
    addAllDescription: (count: number) => string;
  };
}

const ruleTemplateLabels: LexBilingual<RuleTemplateLabels> = {
  en: {
    title: 'Start with a recommended rule',
    description:
      'No compliance rules yet. Add a curated rule tuned for Saudi legal practice and PDPL, then refine it later.',
    addAll: 'Add all',
    add: 'Add',
    added: 'Added',
    ruleTypes: {
      expiry_warning: 'expiry warning',
      missing_clause: 'missing clause',
      risk_threshold: 'risk threshold',
      review_overdue: 'review overdue',
      unsigned_contract: 'unsigned contract',
      value_threshold: 'value threshold',
      jurisdiction_check: 'jurisdiction check',
      data_protection_required: 'data protection required',
      custom: 'custom',
    },
    templates: {
      expiry_30_day: {
        name: '30-day expiry warning',
        description:
          'Raise an alert when an active contract is within 30 days of its expiry date, so renewals are actioned in time.',
      },
      pdpl_data_protection: {
        name: 'PDPL data-protection clause required',
        description:
          'Flag contracts that process personal data but are missing a data-protection clause compliant with the Saudi Personal Data Protection Law (PDPL).',
      },
      ksa_jurisdiction: {
        name: 'KSA jurisdiction check',
        description:
          'Verify that the governing law and jurisdiction are set to the Kingdom of Saudi Arabia, and flag contracts that point elsewhere.',
      },
      high_value_threshold: {
        name: 'High-value contract threshold',
        description:
          'Alert on contracts whose value exceeds ⃁1,000,000 so high-value commitments receive senior legal review.',
      },
      unsigned_sweep: {
        name: 'Unsigned-contract sweep',
        description:
          'Surface contracts that have remained pending signature for more than 14 days so stalled executions are chased.',
      },
      overdue_review: {
        name: 'Overdue review',
        description:
          'Flag active contracts that have not been reviewed within the last 90 days to keep the portfolio current.',
      },
    },
    toasts: {
      addedTitle: 'Template added.',
      addedDescription: (name) => `"${name}" was added to your rule library.`,
      addAllTitle: 'Templates added.',
      addAllDescription: (count) =>
        `${count} compliance rule${count === 1 ? '' : 's'} added to your library.`,
    },
  },
  ar: {
    title: 'ابدأ بقاعدة موصى بها',
    description:
      'لا توجد قواعد امتثال بعد. أضف قاعدة مُعدّة لِلممارسة القانونية السعودية ونظام حماية البيانات الشخصية، ثم نقّحها لاحقًا.',
    addAll: 'إضافة الكل',
    add: 'إضافة',
    added: 'مُضافة',
    ruleTypes: {
      expiry_warning: 'تنبيه انتهاء',
      missing_clause: 'بند مفقود',
      risk_threshold: 'حدّ المخاطر',
      review_overdue: 'مراجعة متأخرة',
      unsigned_contract: 'عقد غير موقّع',
      value_threshold: 'حدّ القيمة',
      jurisdiction_check: 'فحص الاختصاص',
      data_protection_required: 'حماية البيانات مطلوبة',
      custom: 'مخصّص',
    },
    templates: {
      expiry_30_day: {
        name: 'تنبيه انتهاء قبل 30 يومًا',
        description:
          'إصدار تنبيه عندما يصبح العقد الساري على بُعد 30 يومًا من تاريخ انتهائه، لمعالجة التجديدات في وقتها.',
      },
      pdpl_data_protection: {
        name: 'اشتراط بند حماية البيانات (PDPL)',
        description:
          'تعليم العقود التي تعالج بيانات شخصية وتفتقر إلى بند حماية بيانات متوافق مع نظام حماية البيانات الشخصية السعودي (PDPL).',
      },
      ksa_jurisdiction: {
        name: 'فحص الاختصاص (المملكة العربية السعودية)',
        description:
          'التحقق من أن القانون الواجب التطبيق والاختصاص القضائي محددان للمملكة العربية السعودية، وتعليم العقود التي تشير إلى غير ذلك.',
      },
      high_value_threshold: {
        name: 'حدّ العقود عالية القيمة',
        description:
          'تنبيه على العقود التي تتجاوز قيمتها 1,000,000 ريال سعودي لضمان خضوع الالتزامات عالية القيمة لمراجعة قانونية عليا.',
      },
      unsigned_sweep: {
        name: 'مسح العقود غير الموقّعة',
        description:
          'إظهار العقود التي ظلّت بانتظار التوقيع لأكثر من 14 يومًا لمتابعة عمليات التنفيذ المتعثرة.',
      },
      overdue_review: {
        name: 'مراجعة متأخرة',
        description:
          'تعليم العقود السارية التي لم تُراجَع خلال آخر 90 يومًا للحفاظ على تحديث المحفظة.',
      },
    },
    toasts: {
      addedTitle: 'تمت إضافة القالب.',
      addedDescription: (name) => `تمت إضافة "${name}" إلى مكتبة القواعد لديك.`,
      addAllTitle: 'تمت إضافة القوالب.',
      addAllDescription: (count) => `تمت إضافة ${count} قاعدة امتثال إلى مكتبتك.`,
    },
  },
};

function useRuleTemplateLabels(): RuleTemplateLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(ruleTemplateLabels, locale), [locale]);
}

/** resolveRuleTemplateLabels is the pure resolver for non-React callers/tests. */
export function resolveRuleTemplateLabels(locale: AppLocale = 'en'): RuleTemplateLabels {
  return resolveLexBilingual(ruleTemplateLabels, locale === 'ar' ? 'ar' : 'en');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a compliance severity onto the shared SeverityIndicator's Severity set. */
function toIndicatorSeverity(severity: LexComplianceSeverity): Severity {
  switch (severity) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return severity;
    default:
      return 'info';
  }
}

/**
 * Build the create-rule payload for a template in the active locale. The result
 * satisfies `LexComplianceRuleFormValues` (the same shape the rule form submits).
 */
function buildPayload(
  template: RuleTemplate,
  labels: RuleTemplateLabels,
): LexComplianceRuleFormValues {
  const copy = labels.templates[template.key];
  return {
    name: copy.name,
    description: copy.description,
    rule_type: template.rule_type,
    severity: template.severity,
    config: template.config,
    contract_types: template.contract_types,
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RuleTemplateGalleryProps {
  /** Called after one or more templates are successfully created. */
  onSeeded?: () => void;
  className?: string;
}

/**
 * RuleTemplateGallery renders the curated compliance rule templates as a card
 * grid for the rule library's empty state. Each card seeds a single rule;
 * "Add all" seeds every not-yet-added template sequentially.
 */
export function RuleTemplateGallery({ onSeeded, className }: RuleTemplateGalleryProps) {
  const labels = useRuleTemplateLabels();
  const queryClient = useQueryClient();
  const [addedKeys, setAddedKeys] = useState<Set<string>>(() => new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lex-compliance-rules'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-compliance-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-command'] }),
    ]);
  };

  const addMutation = useMutation({
    mutationFn: (template: RuleTemplate) =>
      enterpriseApi.lex.createComplianceRule(buildPayload(template, labels)),
    onSuccess: async (_data, template) => {
      const copy = labels.templates[template.key];
      setAddedKeys((current) => new Set(current).add(template.key));
      showSuccess(labels.toasts.addedTitle, labels.toasts.addedDescription(copy.name));
      await invalidate();
      onSeeded?.();
    },
    onError: showApiError,
    onSettled: () => setPendingKey(null),
  });

  const addAllMutation = useMutation({
    mutationFn: async () => {
      const remaining = RULE_TEMPLATES.filter((t) => !addedKeys.has(t.key));
      const seeded: string[] = [];
      for (const template of remaining) {
        await enterpriseApi.lex.createComplianceRule(buildPayload(template, labels));
        seeded.push(template.key);
      }
      return seeded;
    },
    onSuccess: async (seeded) => {
      if (seeded.length > 0) {
        setAddedKeys((current) => {
          const next = new Set(current);
          seeded.forEach((key) => next.add(key));
          return next;
        });
        showSuccess(labels.toasts.addAllTitle, labels.toasts.addAllDescription(seeded.length));
        await invalidate();
        onSeeded?.();
      }
    },
    onError: showApiError,
  });

  const busy = addMutation.isPending || addAllMutation.isPending;
  const allAdded = RULE_TEMPLATES.every((t) => addedKeys.has(t.key));

  return (
    <div className={['space-y-4', className].filter(Boolean).join(' ')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium">{labels.title}</p>
            <p className="text-xs text-muted-foreground">{labels.description}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => addAllMutation.mutate()}
          disabled={busy || allAdded}
        >
          {addAllMutation.isPending ? (
            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="me-1.5 h-3.5 w-3.5" />
          )}
          {labels.addAll}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {RULE_TEMPLATES.map((template) => {
          const copy = labels.templates[template.key];
          const isAdded = addedKeys.has(template.key);
          const isPending = addMutation.isPending && pendingKey === template.key;
          const ruleTypeLabel =
            labels.ruleTypes[template.rule_type] ?? template.rule_type.replace(/_/g, ' ');

          return (
            <div
              key={template.key}
              className="flex h-full flex-col gap-3 rounded-lg border bg-card/40 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium leading-tight">{copy.name}</p>
                  <Badge variant="outline" className="text-xs">
                    {ruleTypeLabel}
                  </Badge>
                </div>
                <SeverityIndicator
                  severity={toIndicatorSeverity(template.severity)}
                  size="sm"
                  className="shrink-0"
                />
              </div>

              <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                {copy.description}
              </p>

              <Button
                variant={isAdded ? 'ghost' : 'outline'}
                size="sm"
                className="self-start"
                disabled={isAdded || busy}
                onClick={() => {
                  setPendingKey(template.key);
                  addMutation.mutate(template);
                }}
              >
                {isPending ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                ) : isAdded ? (
                  <CheckCircle2 className="me-1.5 h-3.5 w-3.5 text-success-600" />
                ) : (
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                )}
                {isAdded ? labels.added : labels.add}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
