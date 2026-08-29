'use client';

/**
 * Unified Lex chip system.
 *
 * @deprecated The rendering primitive is now the canonical `StatusBadge`
 * (`@/components/shared/status-badge`). These components remain as thin
 * adapters that keep the Lex domain vocabulary (per-domain token → tone/icon
 * maps + bilingual EN/AR label bundles) but delegate every pixel to the
 * canonical badge so all suites share one status language.
 *
 *   - `<LexStatusChip>` resolves a raw lex domain status token to a semantic
 *     tone and renders the canonical `<StatusBadge>` (token-driven color +
 *     icon + label, WCAG-safe: never color alone).
 *   - `<LexSeverityChip>` maps a lex severity onto the canonical `severityMap`.
 *   - `<LexPriorityChip>` maps a lex priority (critical/high/medium/low, plus
 *     the request domain's urgent/normal) onto the same severity ramp so
 *     urgency reads consistently against severity.
 *
 * Bilingual + RTL safe: labels resolve from the per-call `labels` prop when the
 * caller passes its own bundle (each domain owns its label bundle per the lex
 * i18n contract); otherwise a built-in EN/AR fallback keyed off the active
 * locale is used so a chip is always human-readable in both languages.
 */

import * as React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  Eye,
  FileSignature,
  FileText,
  Flag,
  Gavel,
  Handshake,
  Hourglass,
  Inbox,
  ListChecks,
  MinusCircle,
  PauseCircle,
  PenLine,
  PlayCircle,
  Route,
  Send,
  ShieldCheck,
  Tags,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  StatusBadge,
  severityMap,
  type StatusTone,
} from '@/components/shared/status-badge';
import type { Severity } from '@/components/shared/severity-indicator';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------------- *
 * Tone taxonomy — the six-value tone set the historic StatusChip exposed.
 * Kept as the Lex-facing vocabulary; it maps 1:1 onto canonical tones.
 * ------------------------------------------------------------------------- */

type ChipTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
type ChipSize = 'sm' | 'md' | 'lg';

const CHIP_TONE_TO_BADGE: Record<ChipTone, StatusTone> = {
  neutral: 'neutral',
  primary: 'primary',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
};

/**
 * The lex domains a status can belong to. Status tokens collide across domains
 * (e.g. `approved` exists everywhere; `closed` means different things), so the
 * caller declares the domain and we resolve within it, falling back to a global
 * token map when the domain map has no entry.
 */
export type LexStatusDomain =
  | 'case'
  | 'settlement'
  | 'contract'
  | 'matter'
  | 'obligation'
  | 'signature'
  | 'consultation'
  | 'investigation'
  | 'request'
  | 'pleading'
  | 'expert'
  | 'task'
  | 'sla'
  | 'generic';

interface StatusStyle {
  tone: ChipTone;
  icon: LucideIcon;
}

/* ------------------------------------------------------------------------- *
 * Token → { tone, icon } resolution.
 *
 * GLOBAL map covers tokens that mean the same thing everywhere. Per-domain maps
 * override where a token's tone/icon should differ. Tones are intentionally
 * conservative: success = terminal-good, danger = terminal-bad/blocked, warning
 * = needs-attention/in-flight-risk, info = active/in-progress, primary =
 * approved/affirmed, neutral = draft/inert.
 * ------------------------------------------------------------------------- */

const GLOBAL_STATUS: Record<string, StatusStyle> = {
  draft: { tone: 'neutral', icon: FileText },
  submitted: { tone: 'info', icon: Send },
  pending_approval: { tone: 'warning', icon: Clock },
  approved: { tone: 'primary', icon: ShieldCheck },
  rejected: { tone: 'danger', icon: XCircle },
  cancelled: { tone: 'neutral', icon: Ban },
  closed: { tone: 'success', icon: CheckCircle2 },
  archived: { tone: 'neutral', icon: Archive },
  routed: { tone: 'info', icon: Route },
  on_hold: { tone: 'warning', icon: PauseCircle },
  in_progress: { tone: 'info', icon: PlayCircle },
  // Document lifecycle (LexDocumentStatus): draft/archived already covered above.
  active: { tone: 'success', icon: CheckCircle2 },
  superseded: { tone: 'neutral', icon: Archive },
};

const DOMAIN_STATUS: Record<LexStatusDomain, Record<string, StatusStyle>> = {
  case: {
    intake: { tone: 'neutral', icon: Inbox },
    phase1: { tone: 'info', icon: CircleDot },
    phase2: { tone: 'info', icon: CircleDot },
    open: { tone: 'info', icon: PlayCircle },
    under_procedure: { tone: 'warning', icon: Gavel },
    on_hold: { tone: 'warning', icon: PauseCircle },
    closed: { tone: 'success', icon: CheckCircle2 },
    cancelled: { tone: 'neutral', icon: Ban },
  },
  settlement: {
    proposed: { tone: 'neutral', icon: FileText },
    negotiating: { tone: 'info', icon: Handshake },
    pending_approval: { tone: 'warning', icon: Clock },
    approved: { tone: 'success', icon: ShieldCheck },
    executed: { tone: 'success', icon: CheckCircle2 },
    rejected: { tone: 'danger', icon: XCircle },
    abandoned: { tone: 'neutral', icon: Ban },
  },
  // Mirrors the existing `contractStatusConfig` tone vocabulary so contract
  // surfaces read identically whether they render a legacy <StatusBadge> or this
  // chip. Covers every real `LexContractStatus` value plus the extra workflow
  // tokens some flows emit (internal_approval / on_hold), so none grey-fallback.
  contract: {
    draft: { tone: 'neutral', icon: FileText },
    internal_review: { tone: 'info', icon: Eye },
    legal_review: { tone: 'info', icon: Gavel },
    negotiation: { tone: 'warning', icon: Handshake },
    internal_approval: { tone: 'warning', icon: Clock },
    pending_signature: { tone: 'warning', icon: PenLine },
    active: { tone: 'success', icon: CheckCircle2 },
    suspended: { tone: 'warning', icon: PauseCircle },
    on_hold: { tone: 'warning', icon: PauseCircle },
    renewed: { tone: 'success', icon: CheckCircle2 },
    expired: { tone: 'danger', icon: AlertTriangle },
    terminated: { tone: 'danger', icon: XCircle },
    cancelled: { tone: 'neutral', icon: Ban },
  },
  matter: {
    intake: { tone: 'neutral', icon: Inbox },
    open: { tone: 'info', icon: PlayCircle },
    in_review: { tone: 'primary', icon: ListChecks },
    waiting_on_business: { tone: 'warning', icon: Hourglass },
    on_hold: { tone: 'warning', icon: PauseCircle },
    closed: { tone: 'success', icon: CheckCircle2 },
    cancelled: { tone: 'neutral', icon: Ban },
  },
  obligation: {
    open: { tone: 'info', icon: CircleDot },
    in_progress: { tone: 'primary', icon: PlayCircle },
    blocked: { tone: 'warning', icon: AlertTriangle },
    completed: { tone: 'success', icon: CheckCircle2 },
    waived: { tone: 'neutral', icon: MinusCircle },
    cancelled: { tone: 'neutral', icon: Ban },
  },
  signature: {
    draft: { tone: 'neutral', icon: FileText },
    sent: { tone: 'info', icon: Send },
    viewed: { tone: 'info', icon: Eye },
    signed: { tone: 'success', icon: FileSignature },
    declined: { tone: 'danger', icon: XCircle },
    expired: { tone: 'danger', icon: AlertTriangle },
    cancelled: { tone: 'neutral', icon: Ban },
  },
  consultation: {
    submitted: { tone: 'info', icon: Send },
    classified: { tone: 'info', icon: Tags },
    routed: { tone: 'info', icon: Route },
    responded: { tone: 'primary', icon: ListChecks },
    approved: { tone: 'primary', icon: ShieldCheck },
    archived: { tone: 'success', icon: Archive },
  },
  investigation: {
    registered: { tone: 'neutral', icon: Inbox },
    in_progress: { tone: 'info', icon: PlayCircle },
    results_recorded: { tone: 'info', icon: ListChecks },
    pending_approval: { tone: 'warning', icon: Clock },
    approved: { tone: 'primary', icon: ShieldCheck },
    rejected: { tone: 'danger', icon: XCircle },
    closed: { tone: 'success', icon: CheckCircle2 },
    cancelled: { tone: 'neutral', icon: Ban },
  },
  request: {
    draft: { tone: 'neutral', icon: FileText },
    submitted: { tone: 'info', icon: Send },
    pending_requester_approval: { tone: 'warning', icon: Clock },
    pending_provider_approval: { tone: 'warning', icon: Clock },
    approved: { tone: 'primary', icon: ShieldCheck },
    routed: { tone: 'info', icon: Route },
    in_execution: { tone: 'info', icon: PlayCircle },
    delivered: { tone: 'primary', icon: ArrowDownToLine },
    closed: { tone: 'success', icon: CheckCircle2 },
    returned: { tone: 'warning', icon: Undo2 },
    cancelled: { tone: 'neutral', icon: Ban },
  },
  pleading: {
    draft: { tone: 'neutral', icon: FileText },
    in_approval: { tone: 'warning', icon: Clock },
    approved: { tone: 'primary', icon: ShieldCheck },
    rejected: { tone: 'danger', icon: XCircle },
    filed: { tone: 'success', icon: Gavel },
  },
  expert: {
    requested: { tone: 'info', icon: Send },
    appointed: { tone: 'info', icon: CircleDot },
    report_received: { tone: 'primary', icon: ListChecks },
    closed: { tone: 'success', icon: CheckCircle2 },
    cancelled: { tone: 'neutral', icon: Ban },
  },
  task: {
    open: { tone: 'neutral', icon: CircleDashed },
    in_progress: { tone: 'info', icon: PlayCircle },
    done: { tone: 'success', icon: CheckCircle2 },
    cancelled: { tone: 'neutral', icon: Ban },
  },
  sla: {
    on_track: { tone: 'success', icon: CheckCircle2 },
    on_time: { tone: 'success', icon: CheckCircle2 },
    pending: { tone: 'neutral', icon: Clock },
    due_soon: { tone: 'warning', icon: AlertTriangle },
    breached: { tone: 'danger', icon: AlertOctagon },
  },
  generic: {},
};

/** Fallback style for unknown tokens — neutral, with a soft flag icon. */
const FALLBACK_STATUS: StatusStyle = { tone: 'neutral', icon: Flag };

function resolveStatusStyle(domain: LexStatusDomain, value: string): StatusStyle {
  return DOMAIN_STATUS[domain]?.[value] ?? GLOBAL_STATUS[value] ?? FALLBACK_STATUS;
}

/* ------------------------------------------------------------------------- *
 * Built-in EN/AR fallback labels.
 *
 * Each domain owns its own rich bundle elsewhere; this is only the safety net
 * for callers that don't pass a `labels` map, so a chip is never an unreadable
 * snake_case token. Professional MSA copies for the common tokens.
 * ------------------------------------------------------------------------- */

const FALLBACK_LABELS: Record<'en' | 'ar', Record<string, string>> = {
  en: {
    draft: 'Draft',
    intake: 'Intake',
    phase1: 'Phase 1',
    phase2: 'Phase 2',
    open: 'Open',
    under_procedure: 'Under procedure',
    on_hold: 'On hold',
    proposed: 'Proposed',
    negotiating: 'Negotiating',
    submitted: 'Submitted',
    classified: 'Classified',
    routed: 'Routed',
    responded: 'Responded',
    registered: 'Registered',
    in_progress: 'In progress',
    results_recorded: 'Results recorded',
    pending_approval: 'Pending approval',
    pending_requester_approval: 'Pending requester',
    pending_provider_approval: 'Pending provider',
    approved: 'Approved',
    rejected: 'Rejected',
    routed_request: 'Routed',
    in_execution: 'In execution',
    delivered: 'Delivered',
    returned: 'Returned',
    executed: 'Executed',
    abandoned: 'Abandoned',
    responded_to: 'Responded',
    archived: 'Archived',
    closed: 'Closed',
    cancelled: 'Cancelled',
    in_approval: 'In approval',
    filed: 'Filed',
    requested: 'Requested',
    appointed: 'Appointed',
    report_received: 'Report received',
    done: 'Done',
    on_track: 'On track',
    on_time: 'On time',
    pending: 'Pending',
    due_soon: 'Due soon',
    breached: 'Breached',
    // contract / document lifecycle
    internal_review: 'Internal review',
    legal_review: 'Legal review',
    negotiation: 'Negotiation',
    internal_approval: 'Internal approval',
    pending_signature: 'Pending signature',
    active: 'Active',
    suspended: 'Suspended',
    renewed: 'Renewed',
    expired: 'Expired',
    terminated: 'Terminated',
    superseded: 'Superseded',
    // matter / obligation
    in_review: 'In review',
    waiting_on_business: 'Waiting on business',
    blocked: 'Blocked',
    completed: 'Completed',
    waived: 'Waived',
    // signature envelope
    sent: 'Sent',
    viewed: 'Viewed',
    signed: 'Signed',
    declined: 'Declined',
  },
  ar: {
    draft: 'مسودة',
    intake: 'استقبال',
    phase1: 'المرحلة الأولى',
    phase2: 'المرحلة الثانية',
    open: 'مفتوحة',
    under_procedure: 'قيد الإجراء',
    on_hold: 'معلّقة',
    proposed: 'مقترحة',
    negotiating: 'قيد التفاوض',
    submitted: 'مُقدَّمة',
    classified: 'مصنّفة',
    routed: 'مُوجَّهة',
    responded: 'تمت الإجابة',
    registered: 'مُسجَّلة',
    in_progress: 'قيد التنفيذ',
    results_recorded: 'سُجّلت النتائج',
    pending_approval: 'بانتظار الاعتماد',
    pending_requester_approval: 'بانتظار مقدّم الطلب',
    pending_provider_approval: 'بانتظار الجهة المزوّدة',
    approved: 'معتمدة',
    rejected: 'مرفوضة',
    in_execution: 'قيد التنفيذ',
    delivered: 'مُسلَّمة',
    returned: 'مُعادة',
    executed: 'مُنفَّذة',
    abandoned: 'متروكة',
    archived: 'مؤرشفة',
    closed: 'مغلقة',
    cancelled: 'ملغاة',
    in_approval: 'قيد الاعتماد',
    filed: 'مُودَعة',
    requested: 'مطلوبة',
    appointed: 'معيَّنة',
    report_received: 'استُلم التقرير',
    done: 'منجزة',
    on_track: 'على المسار',
    on_time: 'في الوقت',
    pending: 'قيد الانتظار',
    due_soon: 'تقترب',
    breached: 'متجاوزة',
    // contract / document lifecycle
    internal_review: 'مراجعة داخلية',
    legal_review: 'مراجعة قانونية',
    negotiation: 'تفاوض',
    internal_approval: 'اعتماد داخلي',
    pending_signature: 'بانتظار التوقيع',
    active: 'ساري',
    suspended: 'موقوف',
    renewed: 'مُجدَّد',
    expired: 'منتهٍ',
    terminated: 'مُنهى',
    superseded: 'مُستبدَل',
    // matter / obligation
    in_review: 'قيد المراجعة',
    waiting_on_business: 'بانتظار جهة العمل',
    blocked: 'مُعطَّلة',
    completed: 'مكتملة',
    waived: 'مُتنازَل عنها',
    // signature envelope
    sent: 'مُرسَلة',
    viewed: 'تمت المشاهدة',
    signed: 'مُوقَّعة',
    declined: 'مرفوضة',
  },
};

/** Humanize an unknown token: spaced + capitalized. */
function humanizeToken(value: string): string {
  const spaced = value.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}

/* ------------------------------------------------------------------------- *
 * <LexStatusChip>
 * ------------------------------------------------------------------------- */

export interface LexStatusChipProps {
  /** Raw backend status token, e.g. `pending_approval`. */
  value: string;
  /**
   * Domain the token belongs to, so colliding tokens resolve correctly.
   * `kind` is accepted as an alias for ergonomics at call sites.
   */
  domain?: LexStatusDomain;
  kind?: LexStatusDomain;
  /**
   * Caller-provided label map (its own bilingual bundle, already resolved for
   * the active locale). When a label for `value` is present it wins; otherwise
   * the built-in EN/AR fallback is used.
   */
  labels?: Record<string, string>;
  size?: ChipSize;
  /** Drop the leading icon (color + label still convey meaning). */
  hideIcon?: boolean;
  className?: string;
}

/** @deprecated Thin adapter over the canonical `StatusBadge`. */
export function LexStatusChip({
  value,
  domain,
  kind,
  labels,
  size = 'md',
  hideIcon = false,
  className,
}: LexStatusChipProps) {
  const { locale } = useLocaleOrDefault();
  const resolvedDomain = domain ?? kind ?? 'generic';
  const style = resolveStatusStyle(resolvedDomain, value);
  const label =
    labels?.[value] ??
    FALLBACK_LABELS[locale === 'ar' ? 'ar' : 'en'][value] ??
    humanizeToken(value);

  return (
    <StatusBadge
      status={value}
      label={label}
      tone={CHIP_TONE_TO_BADGE[style.tone]}
      icon={hideIcon ? null : style.icon}
      size={size}
      className={className}
    />
  );
}

/* ------------------------------------------------------------------------- *
 * <LexSeverityChip>
 *
 * Delegates to the canonical `severityMap` so severity reads identically
 * everywhere. Accepts the lex severity vocabulary (critical/high/medium/low/
 * info, plus the aliases the platform already understands).
 * ------------------------------------------------------------------------- */

export type LexSeverity = Severity;

export interface LexSeverityChipProps {
  value: LexSeverity | string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showIcon?: boolean;
  className?: string;
}

const SEVERITY_ALIASES: Record<string, string> = {
  critical: 'critical',
  high: 'high',
  warning: 'warning',
  medium: 'medium',
  moderate: 'medium',
  low: 'low',
  minor: 'low',
  info: 'info',
  informational: 'info',
};

function coerceSeverity(value: string): string {
  return SEVERITY_ALIASES[value.toLowerCase()] ?? 'info';
}

/** @deprecated Thin adapter over the canonical `StatusBadge` + `severityMap`. */
export function LexSeverityChip({
  value,
  size = 'md',
  showLabel = true,
  showIcon = true,
  className,
}: LexSeverityChipProps) {
  const key = coerceSeverity(String(value));
  return (
    <StatusBadge
      status={key}
      map={severityMap}
      size={size}
      icon={showIcon ? undefined : null}
      hideLabel={!showLabel}
      aria-label={!showLabel ? severityMap[key]?.label ?? key : undefined}
      className={className}
    />
  );
}

/* ------------------------------------------------------------------------- *
 * <LexPriorityChip>
 *
 * Priority shares the severity ramp so urgency is visually comparable to
 * severity. Maps the litigation vocabulary (critical/high/medium/low) AND the
 * request domain's two-level urgent/normal onto the same ramp, with localized
 * labels (priority labels differ from severity labels, so kept distinct).
 * ------------------------------------------------------------------------- */

export type LexPriority = 'critical' | 'high' | 'medium' | 'low' | 'urgent' | 'normal' | string;

const PRIORITY_TO_SEVERITY: Record<string, Severity> = {
  critical: 'critical',
  urgent: 'critical',
  high: 'high',
  medium: 'medium',
  normal: 'medium',
  low: 'low',
};

const PRIORITY_LABELS: Record<'en' | 'ar', Record<string, string>> = {
  en: {
    critical: 'Critical',
    urgent: 'Urgent',
    high: 'High',
    medium: 'Medium',
    normal: 'Normal',
    low: 'Low',
  },
  ar: {
    critical: 'حرجة',
    urgent: 'عاجلة',
    high: 'عالية',
    medium: 'متوسطة',
    normal: 'عادية',
    low: 'منخفضة',
  },
};

const PRIORITY_ICON: Record<string, LucideIcon> = {
  critical: AlertOctagon,
  urgent: AlertOctagon,
  high: AlertTriangle,
  medium: Flag,
  normal: Flag,
  low: ArrowDownToLine,
};

const SEVERITY_TONE: Record<Severity, ChipTone> = {
  critical: 'danger',
  high: 'danger',
  warning: 'warning',
  medium: 'warning',
  low: 'info',
  info: 'neutral',
};

export interface LexPriorityChipProps {
  value: LexPriority;
  /** Caller's resolved label map; wins over the built-in fallback. */
  labels?: Record<string, string>;
  size?: ChipSize;
  hideIcon?: boolean;
  className?: string;
}

/** @deprecated Thin adapter over the canonical `StatusBadge`. */
export function LexPriorityChip({
  value,
  labels,
  size = 'md',
  hideIcon = false,
  className,
}: LexPriorityChipProps) {
  const { locale } = useLocaleOrDefault();
  const key = String(value).toLowerCase();
  const severity = PRIORITY_TO_SEVERITY[key] ?? 'medium';
  const tone = SEVERITY_TONE[severity];
  const label =
    labels?.[key] ??
    PRIORITY_LABELS[locale === 'ar' ? 'ar' : 'en'][key] ??
    humanizeToken(String(value));
  const icon = PRIORITY_ICON[key] ?? Flag;

  return (
    <StatusBadge
      status={key}
      label={label}
      tone={CHIP_TONE_TO_BADGE[tone]}
      icon={hideIcon ? null : icon}
      size={size}
      className={cn('font-semibold', className)}
    />
  );
}

/* Re-export the resolver so callers (e.g. row-accents, board columns) can share
 * the same tone mapping without re-rendering a chip. */
export { resolveStatusStyle as resolveLexStatusStyle };
export type { ChipTone as LexChipTone };
