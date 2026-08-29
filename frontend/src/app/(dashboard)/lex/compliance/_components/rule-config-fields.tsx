/**
 * Type-aware compliance rule `config` builder (Watheeq / Lex compliance surface).
 *
 * `<RuleConfigFields>` is a CONTROLLED fragment of form inputs that renders the
 * right config editor for the selected {@link LexComplianceRuleType} and
 * reads/writes a single `config` object (`Record<string, unknown>`). It owns NO
 * react-hook-form wiring: the host dialog passes the current `config` value and
 * an `onChange` that feeds `form.setValue('config', next, ...)`, so the builder
 * stays a pure presentational/controlled component reusable anywhere.
 *
 * The field KEYS below are aligned 1:1 with the backend compliance evaluator
 * (`internal/lex/service/compliance_service.go > evaluateRule`):
 *
 *   expiry_warning            → days_before  (int, default 30)
 *   review_overdue            → overdue_days (int, default 7)
 *   risk_threshold            → min_score (float 0–100, default 70) + required_status (string)
 *   value_threshold           → min_value (float, default 1,000,000)   [currency is advisory only]
 *   custom                    → field (enum) + operator (enum) + value
 *   missing_clause            → backend reads NO config (uses contract analysis)
 *   unsigned_contract         → backend reads NO config (uses signature status)
 *   jurisdiction_check        → backend reads NO config (uses analysis flag)
 *   data_protection_required  → backend reads NO config (scans document text + clauses)
 *
 * For the four "reads no config" types the evaluator ignores `config` entirely,
 * so the fields rendered here are ADVISORY documentation only (clearly flagged
 * in the UI as informational); they are still written to `config` so a future
 * evaluator upgrade can consume them without a migration.
 *
 * Bilingual: this file owns its own `LexBilingual` label bundle + `useRuleConfigLabels()`
 * hook, mirroring `_lib/compliance-labels.ts` and the canonical `_lib/lex-i18n.ts`
 * contract (full EN + professional MSA copies, same shape on both sides).
 */

'use client';

import { useCallback, useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LexComplianceRuleType } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/** A rule `config` object as stored on the form / sent to the API. */
export type RuleConfig = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Backend-aligned config keys + enum option values.
// ---------------------------------------------------------------------------

/**
 * Exact `config` map keys read by the backend evaluator, plus advisory keys for
 * the rule types whose evaluator ignores config. Centralised so labels, reads,
 * and writes never drift apart.
 */
export const RULE_CONFIG_KEYS = {
  daysBefore: 'days_before',
  overdueDays: 'overdue_days',
  minScore: 'min_score',
  requiredStatus: 'required_status',
  minValue: 'min_value',
  currency: 'currency', // advisory: backend value_threshold does NOT read currency
  customField: 'field',
  customOperator: 'operator',
  customValue: 'value',
  // Advisory keys (backend ignores config for these rule types):
  requiredClauses: 'required_clauses',
  allowedJurisdictions: 'allowed_jurisdictions',
  pdplRequired: 'pdpl_required',
  requireSignedBeforeActive: 'require_signed_before_active',
} as const;

/** Contract statuses offered for `risk_threshold.required_status`. */
const REQUIRED_STATUS_OPTIONS = [
  'internal_review',
  'legal_review',
  'negotiation',
  'pending_signature',
  'active',
] as const;

/** Supported currencies for the advisory `value_threshold.currency` field. */
const CURRENCY_OPTIONS = ['SAR', 'USD', 'EUR'] as const;

/** Fields the backend `custom` evaluator understands. */
const CUSTOM_FIELD_OPTIONS = ['risk_score', 'total_value', 'status'] as const;

/** Comparison operators the backend `custom` evaluator understands. */
const CUSTOM_OPERATOR_OPTIONS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;

// ---------------------------------------------------------------------------
// Bilingual labels.
// ---------------------------------------------------------------------------

export interface RuleConfigLabels {
  sectionTitle: string;
  advisoryNote: string;
  noConfigNote: string;
  daysBefore: string;
  daysBeforeHint: string;
  overdueDays: string;
  overdueDaysHint: string;
  minScore: string;
  minScoreHint: string;
  requiredStatus: string;
  requiredStatusHint: string;
  minValue: string;
  minValueHint: string;
  currency: string;
  requiredClauses: string;
  requiredClausesHint: string;
  requiredClausesPlaceholder: string;
  allowedJurisdictions: string;
  allowedJurisdictionsHint: string;
  allowedJurisdictionsPlaceholder: string;
  pdplRequired: string;
  pdplRequiredHint: string;
  requireSignedBeforeActive: string;
  requireSignedBeforeActiveHint: string;
  customField: string;
  customOperator: string;
  customValue: string;
  customValuePlaceholder: string;
  unit: string;
  statusOptions: Record<string, string>;
  fieldOptions: Record<string, string>;
  operatorOptions: Record<string, string>;
}

export const ruleConfigLabels: LexBilingual<RuleConfigLabels> = {
  en: {
    sectionTitle: 'Rule configuration',
    advisoryNote:
      'These values are advisory and recorded with the rule; the current compliance engine does not yet read them for this rule type.',
    noConfigNote: 'This rule type runs from contract analysis and needs no extra configuration.',
    daysBefore: 'Warn this many days before expiry',
    daysBeforeHint: 'Triggers when an active contract expires within this many days.',
    overdueDays: 'Days in review before overdue',
    overdueDaysHint: 'Triggers when a contract stays in review longer than this.',
    minScore: 'Minimum risk score',
    minScoreHint: 'Triggers when a contract risk score exceeds this threshold (0–100).',
    requiredStatus: 'Required review status',
    requiredStatusHint: 'High-risk contracts not in this status raise an alert.',
    minValue: 'Minimum contract value',
    minValueHint: 'Triggers when total contract value meets or exceeds this amount.',
    currency: 'Currency',
    requiredClauses: 'Required clause names',
    requiredClausesHint: 'One clause per line (e.g. data protection, audit rights).',
    requiredClausesPlaceholder: 'data_protection\naudit_rights',
    allowedJurisdictions: 'Allowed jurisdictions',
    allowedJurisdictionsHint: 'One jurisdiction per line. Contracts outside these raise an alert.',
    allowedJurisdictionsPlaceholder: 'Saudi Arabia\nKSA',
    pdplRequired: 'PDPL data-protection clause required',
    pdplRequiredHint: 'Flag contracts handling personal data that omit a data protection clause.',
    requireSignedBeforeActive: 'Require signature before activation',
    requireSignedBeforeActiveHint: 'Flag active contracts that have no recorded signature.',
    customField: 'Field',
    customOperator: 'Operator',
    customValue: 'Value',
    customValuePlaceholder: 'e.g. 80 or active',
    unit: 'days',
    statusOptions: {
      internal_review: 'Internal review',
      legal_review: 'Legal review',
      negotiation: 'Negotiation',
      pending_signature: 'Pending signature',
      active: 'Active',
    },
    fieldOptions: {
      risk_score: 'Risk score',
      total_value: 'Total value',
      status: 'Status',
    },
    operatorOptions: {
      eq: 'Equals',
      neq: 'Not equal',
      gt: 'Greater than',
      gte: 'Greater or equal',
      lt: 'Less than',
      lte: 'Less or equal',
    },
  },
  ar: {
    sectionTitle: 'إعدادات القاعدة',
    advisoryNote:
      'هذه القيم إرشادية وتُحفظ مع القاعدة؛ ولا يقرؤها محرك الامتثال الحالي لهذا النوع من القواعد بعد.',
    noConfigNote: 'يعمل هذا النوع من القواعد اعتمادًا على تحليل العقد ولا يحتاج إلى إعدادات إضافية.',
    daysBefore: 'التنبيه قبل الانتهاء بهذا العدد من الأيام',
    daysBeforeHint: 'يُفعَّل عندما ينتهي عقد ساري خلال هذا العدد من الأيام.',
    overdueDays: 'أيام البقاء في المراجعة قبل اعتبارها متأخرة',
    overdueDaysHint: 'يُفعَّل عندما يبقى العقد في المراجعة أطول من هذه المدة.',
    minScore: 'الحد الأدنى لدرجة المخاطر',
    minScoreHint: 'يُفعَّل عندما تتجاوز درجة مخاطر العقد هذا الحد (0–100).',
    requiredStatus: 'حالة المراجعة المطلوبة',
    requiredStatusHint: 'تُرفع التنبيهات للعقود مرتفعة المخاطر التي ليست في هذه الحالة.',
    minValue: 'الحد الأدنى لقيمة العقد',
    minValueHint: 'يُفعَّل عندما تبلغ قيمة العقد الإجمالية هذا المبلغ أو تتجاوزه.',
    currency: 'العملة',
    requiredClauses: 'أسماء البنود المطلوبة',
    requiredClausesHint: 'بند واحد في كل سطر (مثل: حماية البيانات، حقوق التدقيق).',
    requiredClausesPlaceholder: 'data_protection\naudit_rights',
    allowedJurisdictions: 'الاختصاصات المسموح بها',
    allowedJurisdictionsHint: 'اختصاص واحد في كل سطر. تُرفع تنبيهات للعقود خارج هذه الاختصاصات.',
    allowedJurisdictionsPlaceholder: 'المملكة العربية السعودية\nKSA',
    pdplRequired: 'بند حماية البيانات وفق نظام PDPL مطلوب',
    pdplRequiredHint: 'تعليم العقود التي تعالج بيانات شخصية وتفتقر إلى بند حماية البيانات.',
    requireSignedBeforeActive: 'اشتراط التوقيع قبل التفعيل',
    requireSignedBeforeActiveHint: 'تعليم العقود السارية التي لا يوجد لها توقيع مُسجّل.',
    customField: 'الحقل',
    customOperator: 'المُعامل',
    customValue: 'القيمة',
    customValuePlaceholder: 'مثال: 80 أو active',
    unit: 'يوم',
    statusOptions: {
      internal_review: 'مراجعة داخلية',
      legal_review: 'مراجعة قانونية',
      negotiation: 'تفاوض',
      pending_signature: 'بانتظار التوقيع',
      active: 'ساري',
    },
    fieldOptions: {
      risk_score: 'درجة المخاطر',
      total_value: 'القيمة الإجمالية',
      status: 'الحالة',
    },
    operatorOptions: {
      eq: 'يساوي',
      neq: 'لا يساوي',
      gt: 'أكبر من',
      gte: 'أكبر أو يساوي',
      lt: 'أصغر من',
      lte: 'أصغر أو يساوي',
    },
  },
};

export function useRuleConfigLabels(): RuleConfigLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(ruleConfigLabels, locale), [locale]);
}

/** Pure resolver for non-React callers / tests. */
export function resolveRuleConfigLabels(locale: AppLocale = 'en'): RuleConfigLabels {
  return resolveLexBilingual(ruleConfigLabels, locale === 'ar' ? 'ar' : 'en');
}

// ---------------------------------------------------------------------------
// Value coercion helpers (mirror the backend's lenient string|number reads).
// ---------------------------------------------------------------------------

function readNumber(config: RuleConfig, key: string): string {
  const raw = config[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw;
  }
  return '';
}

function readString(config: RuleConfig, key: string, fallback = ''): string {
  const raw = config[key];
  return typeof raw === 'string' ? raw : fallback;
}

function readBoolean(config: RuleConfig, key: string, fallback = false): boolean {
  const raw = config[key];
  return typeof raw === 'boolean' ? raw : fallback;
}

function readLines(config: RuleConfig, key: string): string {
  const raw = config[key];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string').join('\n');
  }
  if (typeof raw === 'string') {
    return raw;
  }
  return '';
}

/** Split a multiline textarea into a trimmed, non-empty string array. */
function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Field-group building blocks.
// ---------------------------------------------------------------------------

interface FieldRowProps {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function FieldRow({ id, label, hint, children }: FieldRowProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function AdvisoryBanner({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-warning-300/40 bg-warning-300/10 px-3 py-2 text-xs text-muted-foreground">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Component.
// ---------------------------------------------------------------------------

export interface RuleConfigFieldsProps {
  /** Selected rule type; drives which inputs render. */
  ruleType: LexComplianceRuleType;
  /** Current config object (controlled). */
  value: RuleConfig;
  /** Receives the next config object whenever a field changes. */
  onChange: (next: RuleConfig) => void;
  /** Optional disabled state for the whole group. */
  disabled?: boolean;
}

/**
 * RuleConfigFields renders the config editor for a compliance rule type. It is a
 * controlled fragment: pass `value` (the current `config`) and `onChange` (which
 * should call `form.setValue('config', next, { shouldDirty: true })`). It never
 * mutates the incoming object — every change produces a fresh object.
 */
export function RuleConfigFields({
  ruleType,
  value,
  onChange,
  disabled = false,
}: RuleConfigFieldsProps) {
  const labels = useRuleConfigLabels();

  const setKey = useCallback(
    (key: string, next: unknown) => {
      const draft: RuleConfig = { ...value };
      if (
        next === undefined ||
        next === '' ||
        (Array.isArray(next) && next.length === 0)
      ) {
        delete draft[key];
      } else {
        draft[key] = next;
      }
      onChange(draft);
    },
    [value, onChange],
  );

  const setNumber = useCallback(
    (key: string, raw: string) => {
      if (raw.trim() === '') {
        setKey(key, undefined);
        return;
      }
      const parsed = Number(raw);
      setKey(key, Number.isFinite(parsed) ? parsed : raw);
    },
    [setKey],
  );

  const k = RULE_CONFIG_KEYS;

  switch (ruleType) {
    case 'expiry_warning':
      return (
        <div className="space-y-4">
          <FieldRow id="cfg-days-before" label={labels.daysBefore} hint={labels.daysBeforeHint}>
            <div className="flex items-center gap-2">
              <Input
                id="cfg-days-before"
                type="number"
                min={0}
                inputMode="numeric"
                disabled={disabled}
                value={readNumber(value, k.daysBefore)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNumber(k.daysBefore, e.target.value)
                }
                className="max-w-[10rem]"
              />
              <span className="text-sm text-muted-foreground">{labels.unit}</span>
            </div>
          </FieldRow>
        </div>
      );

    case 'review_overdue':
      return (
        <div className="space-y-4">
          <FieldRow id="cfg-overdue-days" label={labels.overdueDays} hint={labels.overdueDaysHint}>
            <div className="flex items-center gap-2">
              <Input
                id="cfg-overdue-days"
                type="number"
                min={0}
                inputMode="numeric"
                disabled={disabled}
                value={readNumber(value, k.overdueDays)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNumber(k.overdueDays, e.target.value)
                }
                className="max-w-[10rem]"
              />
              <span className="text-sm text-muted-foreground">{labels.unit}</span>
            </div>
          </FieldRow>
        </div>
      );

    case 'risk_threshold':
      return (
        <div className="space-y-4">
          <FieldRow id="cfg-min-score" label={labels.minScore} hint={labels.minScoreHint}>
            <Input
              id="cfg-min-score"
              type="number"
              min={0}
              max={100}
              step="1"
              inputMode="numeric"
              disabled={disabled}
              value={readNumber(value, k.minScore)}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNumber(k.minScore, e.target.value)
              }
              className="max-w-[10rem]"
            />
          </FieldRow>
          <FieldRow
            id="cfg-required-status"
            label={labels.requiredStatus}
            hint={labels.requiredStatusHint}
          >
            <Select
              value={readString(value, k.requiredStatus, 'legal_review')}
              onValueChange={(v: string) => setKey(k.requiredStatus, v)}
              disabled={disabled}
            >
              <SelectTrigger id="cfg-required-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REQUIRED_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {labels.statusOptions[status] ?? status.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        </div>
      );

    case 'value_threshold':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FieldRow
              id="cfg-min-value"
              label={labels.minValue}
              hint={labels.minValueHint}
            >
              <Input
                id="cfg-min-value"
                type="number"
                min={0}
                inputMode="decimal"
                disabled={disabled}
                value={readNumber(value, k.minValue)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNumber(k.minValue, e.target.value)
                }
              />
            </FieldRow>
            <FieldRow id="cfg-currency" label={labels.currency}>
              <Select
                value={readString(value, k.currency, 'SAR')}
                onValueChange={(v: string) => setKey(k.currency, v)}
                disabled={disabled}
              >
                <SelectTrigger id="cfg-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((currency) => (
                    <SelectItem key={currency} value={currency}>
                      {currency}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
        </div>
      );

    case 'missing_clause':
      return (
        <div className="space-y-4">
          <AdvisoryBanner message={labels.advisoryNote} />
          <FieldRow
            id="cfg-required-clauses"
            label={labels.requiredClauses}
            hint={labels.requiredClausesHint}
          >
            <Textarea
              id="cfg-required-clauses"
              rows={3}
              disabled={disabled}
              value={readLines(value, k.requiredClauses)}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setKey(k.requiredClauses, linesToArray(e.target.value))
              }
              placeholder={labels.requiredClausesPlaceholder}
            />
          </FieldRow>
        </div>
      );

    case 'jurisdiction_check':
      return (
        <div className="space-y-4">
          <AdvisoryBanner message={labels.advisoryNote} />
          <FieldRow
            id="cfg-allowed-jurisdictions"
            label={labels.allowedJurisdictions}
            hint={labels.allowedJurisdictionsHint}
          >
            <Textarea
              id="cfg-allowed-jurisdictions"
              rows={3}
              disabled={disabled}
              value={
                readLines(value, k.allowedJurisdictions) || 'Saudi Arabia\nKSA'
              }
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setKey(k.allowedJurisdictions, linesToArray(e.target.value))
              }
              placeholder={labels.allowedJurisdictionsPlaceholder}
            />
          </FieldRow>
        </div>
      );

    case 'data_protection_required':
      return (
        <div className="space-y-4">
          <AdvisoryBanner message={labels.advisoryNote} />
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">{labels.pdplRequired}</p>
              <p className="text-xs text-muted-foreground">{labels.pdplRequiredHint}</p>
            </div>
            <Switch
              checked={readBoolean(value, k.pdplRequired, true)}
              onCheckedChange={(checked: boolean) => setKey(k.pdplRequired, checked)}
              disabled={disabled}
              aria-label={labels.pdplRequired}
            />
          </div>
        </div>
      );

    case 'unsigned_contract':
      return (
        <div className="space-y-4">
          <AdvisoryBanner message={labels.advisoryNote} />
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">{labels.requireSignedBeforeActive}</p>
              <p className="text-xs text-muted-foreground">
                {labels.requireSignedBeforeActiveHint}
              </p>
            </div>
            <Switch
              checked={readBoolean(value, k.requireSignedBeforeActive, true)}
              onCheckedChange={(checked: boolean) =>
                setKey(k.requireSignedBeforeActive, checked)
              }
              disabled={disabled}
              aria-label={labels.requireSignedBeforeActive}
            />
          </div>
        </div>
      );

    case 'custom':
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FieldRow id="cfg-custom-field" label={labels.customField}>
              <Select
                value={readString(value, k.customField, 'risk_score')}
                onValueChange={(v: string) => setKey(k.customField, v)}
                disabled={disabled}
              >
                <SelectTrigger id="cfg-custom-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_OPTIONS.map((field) => (
                    <SelectItem key={field} value={field}>
                      {labels.fieldOptions[field] ?? field.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow id="cfg-custom-operator" label={labels.customOperator}>
              <Select
                value={readString(value, k.customOperator, 'gt')}
                onValueChange={(v: string) => setKey(k.customOperator, v)}
                disabled={disabled}
              >
                <SelectTrigger id="cfg-custom-operator">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_OPERATOR_OPTIONS.map((operator) => (
                    <SelectItem key={operator} value={operator}>
                      {labels.operatorOptions[operator] ?? operator}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow id="cfg-custom-value" label={labels.customValue}>
              <Input
                id="cfg-custom-value"
                disabled={disabled}
                value={readString(value, k.customValue)}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const raw = e.target.value;
                  // Custom value may be numeric (risk_score / total_value) or a
                  // string token (status). Store a number when it parses cleanly
                  // so the backend's numeric comparison path works directly.
                  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) {
                    setKey(k.customValue, Number(raw));
                  } else {
                    setKey(k.customValue, raw);
                  }
                }}
                placeholder={labels.customValuePlaceholder}
              />
            </FieldRow>
          </div>
        </div>
      );

    default:
      return <AdvisoryBanner message={labels.noConfigNote} />;
  }
}
