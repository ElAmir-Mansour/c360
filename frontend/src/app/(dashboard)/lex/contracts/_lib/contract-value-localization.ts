'use client';

import { titleCase } from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';
import type { LexContractBriefRisk, LexContractBriefSignal, LexRiskFinding } from '@/types/suites';

type RiskLabelMap = Record<string, string>;

export interface ContractValueFormatters {
  formatDate: (value: string) => string;
  formatNumber: (value: number) => string;
  /** Optional currency formatter; falls back to `<number> <currency>`. */
  formatCurrency?: (value: number, currency: string) => string;
}

const CLAUSE_TYPE_LABELS: Record<string, string> = {
  indemnification: 'التعويض',
  termination: 'الإنهاء',
  limitation_of_liability: 'تحديد المسؤولية',
  confidentiality: 'السرية',
  ip_ownership: 'ملكية الملكية الفكرية',
  non_compete: 'عدم المنافسة',
  payment_terms: 'شروط الدفع',
  warranty: 'الضمان',
  force_majeure: 'القوة القاهرة',
  dispute_resolution: 'تسوية النزاعات',
  data_protection: 'حماية البيانات',
  governing_law: 'القانون الحاكم',
  assignment: 'التنازل',
  insurance: 'التأمين',
  audit_rights: 'حقوق التدقيق',
  sla: 'اتفاقية مستوى الخدمة',
  auto_renewal: 'التجديد التلقائي',
  representations: 'الإقرارات والتعهدات',
  non_solicitation: 'عدم الاستقطاب',
  other: 'أخرى',
};

const SIGNAL_LABELS: Record<string, string> = {
  'Auto renew': 'التجديد التلقائي',
  'Renewal date': 'تاريخ التجديد',
  'Expiry date': 'تاريخ الانتهاء',
  'Renewal notice': 'إشعار التجديد',
  'Payment terms': 'شروط الدفع',
};

const SIGNAL_SOURCE_LABELS: Record<string, string> = {
  'contract.auto_renew': 'التجديد التلقائي',
  'contract.renewal_date': 'تاريخ التجديد',
  'contract.expiry_date': 'تاريخ الانتهاء',
  'contract.renewal_notice_days': 'إشعار التجديد',
  'contract.payment_terms': 'شروط الدفع',
};

/**
 * English display names for the `source` chip. The backend emits the raw record
 * path (`contract.payment_terms`); business readers should see the field, not
 * the column.
 */
const SIGNAL_SOURCE_LABELS_EN: Record<string, string> = {
  'contract.auto_renew': 'Auto renew',
  'contract.renewal_date': 'Renewal date',
  'contract.expiry_date': 'Expiry date',
  'contract.renewal_notice_days': 'Renewal notice',
  'contract.payment_terms': 'Payment terms',
};

const EXACT_TEXT: Record<string, string> = {
  'Renewal notice window is below policy minimum':
    'نافذة إشعار التجديد أقل من الحد الأدنى للسياسة',
  'Auto-renew contracts must provide at least 30 days notice before renewal.':
    'يجب أن تمنح العقود ذات التجديد التلقائي إشعارًا قبل التجديد بمدة لا تقل عن ٣٠ يومًا.',
  'Expected clause was not identified in the latest analysis.':
    'لم يتم العثور على البند المتوقع في أحدث تحليل.',
  'Review whether this clause is required for the contract type.':
    'راجع ما إذا كان هذا البند مطلوبًا لهذا النوع من العقود.',
  'Contract expiring soon': 'العقد يوشك على الانتهاء',
  'Missing data protection clause': 'بند حماية البيانات مفقود',
  'High-risk liability terms': 'شروط مسؤولية عالية المخاطر',
  'Renewal notice overdue': 'إشعار التجديد متأخر',
  'Unreviewed high-risk clause': 'بند عالي المخاطر لم يُراجع',
  'Auto-renewal without approval': 'تجديد تلقائي دون اعتماد',
};

function isArabic(locale: AppLocale): boolean {
  return locale === 'ar';
}

function defaultFormatters(): ContractValueFormatters {
  return {
    formatDate: (value) => value,
    formatNumber: (value) => String(value),
  };
}

function clauseTypeLabel(value: string, locale: AppLocale): string {
  if (!isArabic(locale)) return titleCase(value);
  return CLAUSE_TYPE_LABELS[value] ?? value.replace(/_/g, ' ');
}

function translateExact(text: string, locale: AppLocale): string | null {
  if (!isArabic(locale)) return null;
  return EXACT_TEXT[text.trim()] ?? null;
}

function localizePaymentTerm(value: string, locale: AppLocale, formatters: ContractValueFormatters): string {
  if (!isArabic(locale)) return value;

  const normalized = value.trim().toLowerCase();
  const netMatch = normalized.match(/^net[_\s-]?(\d+)$/);
  if (netMatch) {
    return `صافي ${formatters.formatNumber(Number(netMatch[1]))} يومًا`;
  }

  return value;
}

const ANALYSIS_STATUS_AR: Record<string, string> = {
  pending: 'قيد الانتظار',
  analyzing: 'قيد التنفيذ',
  completed: 'مكتمل',
  failed: 'متعثر',
  skipped: 'متجاوَز',
};

/**
 * The backend emits the "no analysis yet" risk line in English
 * ("Risk analysis is pending; current contract risk is none."), so an
 * Arabic-mode reader saw English prose. Both operands are enum tokens, so the
 * sentence is re-rendered from them rather than translated word-for-word.
 */
function localizePendingRiskSummary(
  value: string,
  riskLabels: RiskLabelMap,
): string | null {
  const match = value
    .trim()
    .match(/^Risk analysis is ([a-z_]+); current contract risk is ([a-z_]+)\.$/i);
  if (!match) return null;

  const [, rawStatus, rawRisk] = match;
  const status = ANALYSIS_STATUS_AR[rawStatus.toLowerCase()] ?? rawStatus;
  const risk = riskLabels[rawRisk.toLowerCase()] ?? rawRisk;
  return `تحليل المخاطر ${status}؛ ومستوى خطورة العقد الحالي ${risk}.`;
}

function localizeGeneratedRiskSummary(
  value: string,
  locale: AppLocale,
  riskLabels: RiskLabelMap,
  formatters: ContractValueFormatters,
): string | null {
  if (!isArabic(locale)) return null;

  const match = value
    .trim()
    .match(/^Overall risk is ([a-z_]+) with score ([\d.]+)(.*)\.$/i);
  if (!match) return null;

  const [, rawRisk, rawScore, rawTail] = match;
  const parts = [
    `المخاطر الإجمالية ${riskLabels[rawRisk] ?? rawRisk} بدرجة ${formatters.formatNumber(Number(rawScore))}`,
  ];

  for (const segment of rawTail.split(';').map((item) => item.trim()).filter(Boolean)) {
    const clauses = segment.match(/^(\d+) clauses reviewed$/i);
    if (clauses) {
      parts.push(`تمت مراجعة ${formatters.formatNumber(Number(clauses[1]))} بنود`);
      continue;
    }

    const highRisk = segment.match(/^(\d+) high-risk clauses$/i);
    if (highRisk) {
      parts.push(`${formatters.formatNumber(Number(highRisk[1]))} بنود عالية المخاطر`);
      continue;
    }

    const missing = segment.match(/^(\d+) missing clauses$/i);
    if (missing) {
      parts.push(`${formatters.formatNumber(Number(missing[1]))} بنود ناقصة`);
      continue;
    }

    const flags = segment.match(/^(\d+) compliance flags$/i);
    if (flags) {
      parts.push(`${formatters.formatNumber(Number(flags[1]))} علامات امتثال`);
    }
  }

  return `${parts.join('؛ ')}.`;
}

export function localizeContractGeneratedText(
  value: string | null | undefined,
  locale: AppLocale,
  riskLabels: RiskLabelMap,
  formatters: ContractValueFormatters = defaultFormatters(),
): string | null | undefined {
  if (!value || !isArabic(locale)) return value;

  return (
    translateExact(value, locale) ??
    localizePendingRiskSummary(value, riskLabels) ??
    localizeGeneratedRiskSummary(value, locale, riskLabels, formatters) ??
    value
  );
}

/* ------------------------------------------------------------------------- *
 * Executive summary
 *
 * `buildContractBrief` in `contract_service.go` composes the executive summary
 * as **hardcoded Arabic** prose, so an English-mode reader saw an Arabic
 * paragraph on the Contract Brief card. Every operand of that sentence is
 * available as a structured field on the brief (title, type, status,
 * counterparty, owner, value, dates), so the sentence is composed HERE in the
 * reader's own language — the same approach `contract-timeline-i18n.ts` already
 * takes for the server's Arabic timeline prose. The server string stays as the
 * fallback for a brief that somehow arrives without a title.
 * ------------------------------------------------------------------------- */

const CONTRACT_TYPE_PROSE: Record<string, { en: string; ar: string }> = {
  service_agreement: { en: 'service agreement', ar: 'اتفاقية خدمات' },
  nda: { en: 'non-disclosure agreement', ar: 'اتفاقية عدم إفصاح' },
  employment: { en: 'employment contract', ar: 'عقد عمل' },
  vendor: { en: 'vendor contract', ar: 'عقد مورّد' },
  license: { en: 'licence agreement', ar: 'عقد ترخيص' },
  lease: { en: 'lease agreement', ar: 'عقد إيجار' },
  partnership: { en: 'partnership agreement', ar: 'عقد شراكة' },
  consulting: { en: 'consulting agreement', ar: 'عقد استشارات' },
  procurement: { en: 'procurement contract', ar: 'عقد توريد' },
  sla: { en: 'service-level agreement', ar: 'اتفاقية مستوى خدمة' },
  mou: { en: 'memorandum of understanding', ar: 'مذكرة تفاهم' },
  amendment: { en: 'amendment', ar: 'ملحق تعديلي' },
  renewal: { en: 'renewal contract', ar: 'عقد تجديد' },
  other: { en: 'contract', ar: 'عقد آخر' },
};

const CONTRACT_STATUS_PROSE: Record<string, { en: string; ar: string }> = {
  draft: { en: 'draft', ar: 'مسودة' },
  internal_review: { en: 'internal review', ar: 'مراجعة داخلية' },
  legal_review: { en: 'legal review', ar: 'مراجعة قانونية' },
  negotiation: { en: 'negotiation', ar: 'تفاوض' },
  pending_signature: { en: 'pending signature', ar: 'بانتظار التوقيع' },
  active: { en: 'active', ar: 'نافذ' },
  suspended: { en: 'suspended', ar: 'موقوف' },
  expired: { en: 'expired', ar: 'منتهي المدة' },
  terminated: { en: 'terminated', ar: 'منهى' },
  renewed: { en: 'renewed', ar: 'مُجدَّد' },
  cancelled: { en: 'cancelled', ar: 'ملغى' },
};

/** The subset of a contract brief the summary is composed from. */
export interface ContractSummarySource {
  title?: string | null;
  type?: string | null;
  status?: string | null;
  counterparty?: string | null;
  owner?: string | null;
  value?: number | null;
  currency?: string | null;
  effective_date?: string | null;
  expiry_date?: string | null;
  executive_summary?: string | null;
}

function prose(
  table: Record<string, { en: string; ar: string }>,
  token: string | null | undefined,
  locale: AppLocale,
): string | null {
  if (!token) return null;
  const entry = table[token];
  if (!entry) return token.replace(/_/g, ' ');
  return isArabic(locale) ? entry.ar : entry.en;
}

function summaryDateRange(
  source: ContractSummarySource,
  locale: AppLocale,
  formatters: ContractValueFormatters,
): string | null {
  const from = source.effective_date ? formatters.formatDate(source.effective_date) : null;
  const to = source.expiry_date ? formatters.formatDate(source.expiry_date) : null;
  const ar = isArabic(locale);

  if (from && to) return ar ? `يسري من ${from} حتى ${to}` : `running from ${from} to ${to}`;
  if (from) return ar ? `يسري من ${from}` : `effective from ${from}`;
  if (to) return ar ? `تنتهي مدته في ${to}` : `expiring on ${to}`;
  return null;
}

export function composeContractExecutiveSummary(
  source: ContractSummarySource,
  locale: AppLocale,
  formatters: ContractValueFormatters = defaultFormatters(),
): string {
  const title = source.title?.trim();
  if (!title) return source.executive_summary?.trim() ?? '';

  const ar = isArabic(locale);
  const type = prose(CONTRACT_TYPE_PROSE, source.type, locale);
  const status = prose(CONTRACT_STATUS_PROSE, source.status, locale);
  const counterparty = source.counterparty?.trim();
  const owner = source.owner?.trim();
  const parts: string[] = [];

  if (ar) {
    parts.push(
      [`«${title}»`, type ?? 'عقد', counterparty ? `مع ${counterparty}` : null]
        .filter(Boolean)
        .join(' '),
    );
    if (owner) parts.push(`بعهدة ${owner}`);
    if (status) parts.push(`وحالته الحالية ${status}`);
  } else {
    const lead = type ? `is a ${type}` : 'is a contract';
    parts.push(
      [`“${title}”`, lead, counterparty ? `with ${counterparty}` : null].filter(Boolean).join(' '),
    );
    if (owner) parts.push(`owned by ${owner}`);
    if (status) parts.push(`currently ${status}`);
  }

  if (source.value != null) {
    const currency = source.currency?.trim() || 'SAR';
    const amount = formatters.formatCurrency
      ? formatters.formatCurrency(source.value, currency)
      : `${formatters.formatNumber(source.value)} ${currency}`;
    parts.push(ar ? `بقيمة ${amount}` : `valued at ${amount}`);
  }

  const range = summaryDateRange(source, locale, formatters);
  if (range) parts.push(range);

  return `${parts.join(ar ? '، ' : ', ')}.`;
}

export function localizeContractSignal(
  signal: LexContractBriefSignal,
  locale: AppLocale,
  formatters: ContractValueFormatters = defaultFormatters(),
): LexContractBriefSignal {
  if (!isArabic(locale)) {
    return {
      ...signal,
      source: SIGNAL_SOURCE_LABELS_EN[signal.source] ?? signal.source,
    };
  }

  const label = SIGNAL_SOURCE_LABELS[signal.source] ?? SIGNAL_LABELS[signal.label] ?? signal.label;
  let value = signal.value;
  const dateLike = /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (signal.source === 'contract.auto_renew' || signal.label === 'Auto renew') {
    value = value === 'enabled' ? 'مفعّل' : value;
  } else if (dateLike) {
    value = formatters.formatDate(value);
  } else if (signal.source === 'contract.renewal_notice_days' || signal.label === 'Renewal notice') {
    const days = value.match(/^(\d+)\s+days?$/i);
    value = days ? `${formatters.formatNumber(Number(days[1]))} يومًا` : value;
  } else if (signal.source === 'contract.payment_terms' || signal.label === 'Payment terms') {
    value = localizePaymentTerm(value, locale, formatters);
  }

  return {
    ...signal,
    label,
    value,
    source: SIGNAL_SOURCE_LABELS[signal.source] ?? signal.source,
  };
}

export function localizeContractBriefRisk(
  risk: LexContractBriefRisk,
  locale: AppLocale,
  riskLabels: RiskLabelMap,
  formatters: ContractValueFormatters = defaultFormatters(),
): LexContractBriefRisk {
  if (!isArabic(locale)) return risk;

  const missingMatch = risk.title.match(/^Missing (.+) clause$/i);
  const clauseType = risk.clause_type ?? missingMatch?.[1]?.replace(/\s+/g, '_').toLowerCase();
  const title = missingMatch && clauseType
    ? `بند ${clauseTypeLabel(clauseType, locale)} مفقود`
    : localizeContractGeneratedText(risk.title, locale, riskLabels, formatters) ?? risk.title;

  return {
    ...risk,
    title,
    description:
      localizeContractGeneratedText(risk.description, locale, riskLabels, formatters) ??
      risk.description,
    recommendation:
      localizeContractGeneratedText(risk.recommendation, locale, riskLabels, formatters) ??
      risk.recommendation,
  };
}

export function localizeLexRiskFinding(
  finding: LexRiskFinding,
  locale: AppLocale,
  riskLabels: RiskLabelMap,
  formatters: ContractValueFormatters = defaultFormatters(),
): LexRiskFinding {
  if (!isArabic(locale)) return finding;

  return {
    ...finding,
    title:
      localizeContractGeneratedText(finding.title, locale, riskLabels, formatters) ??
      finding.title,
    description:
      localizeContractGeneratedText(finding.description, locale, riskLabels, formatters) ??
      finding.description,
    recommendation:
      localizeContractGeneratedText(finding.recommendation, locale, riskLabels, formatters) ??
      finding.recommendation,
  };
}

export function localizeClauseTypeToken(value: string, locale: AppLocale): string {
  return clauseTypeLabel(value, locale);
}

export function localizeRiskLevelToken(
  value: string | null | undefined,
  locale: AppLocale,
  riskLabels: RiskLabelMap,
): string {
  if (!value) return '';
  return riskLabels[value] ?? (isArabic(locale) ? value.replace(/_/g, ' ') : titleCase(value));
}
