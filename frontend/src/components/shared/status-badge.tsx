'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUpCircle,
  Ban,
  CheckCircle2,
  Clock,
  FileText,
  Gavel,
  Inbox,
  Info,
  PauseCircle,
  PlayCircle,
  Send,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { densityPadding, type Density } from '@/components/ui/ui-system';
import type { StatusConfig } from '@/lib/status-configs';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

/**
 * StatusBadge — THE canonical status/severity primitive for the platform.
 *
 * Every badge, chip and pill in the suite family (shared/status-chip,
 * ui/status-pill, lex/status-chip, cyber/cti/severity-badge, …) delegates here
 * so all statuses share one visual language: token-driven tone ramps
 * (`--ds-success/warning/error/info-*` state ramps + the theme-aware
 * `--status-*` group), one chrome (pill, hairline border, faint elevation,
 * token motion), and sm/md(/lg) sizes.
 *
 * Resolution order for tone / label / icon:
 *   1. explicit `tone` / `label` / `icon` props
 *   2. legacy `config` prop (a `StatusConfig` color-name map — kept so the 98
 *      historic call sites render unchanged)
 *   3. an explicit domain `map` (`severityMap`, `caseStatusMap`, `slaMap`,
 *      `genericStatusMap`, or a caller-supplied map)
 *   4. the built-in default lookup — so `<StatusBadge status="critical" />`
 *      just works with the right severity visual
 *   5. neutral + humanized token as the safety net
 *
 * WCAG 1.4.1: color is never the only signal — the label (or an `aria-label`
 * when `hideLabel`) always accompanies the tone.
 */
const statusBadgeVariants = cva(
  // Shared chrome — mirrors the ui/badge base: pill shape, hairline border,
  // faint resting elevation and token-driven motion across hover / focus /
  // active, with the design-system focus ring.
  'inline-flex items-center rounded-full border font-medium align-middle shadow-elevation-1 outline-none transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard hover:shadow-elevation-2 focus-visible:shadow-[var(--ds-elevation-focus),var(--ds-elevation-1)] active:shadow-elevation-1',
  {
    variants: {
      // NOTE: `size` is declared before `tone` on purpose — tailwind-merge
      // cannot tell the custom type-ramp classes (`text-caption`/`text-overline`)
      // apart from text-COLOR classes, so the tone's text color must be emitted
      // AFTER the size class to survive the merge.
      size: {
        sm: 'text-overline px-1.5 py-0.5 gap-1',
        md: 'text-caption px-2 py-0.5 gap-1.5',
        lg: 'text-sm px-2.5 py-1 gap-2',
      },
      appearance: {
        solid: '',
        outline: 'bg-transparent',
        dot: 'border-transparent bg-transparent px-0 shadow-none hover:translate-y-0 hover:shadow-none active:shadow-none',
      },
      tone: {
        critical:
          'font-semibold text-error-700 border-error-300/70 dark:text-error-200 dark:border-error-700/70',
        danger:
          'text-error-700 border-error-300/60 dark:text-error-300 dark:border-error-700/60',
        warning:
          'text-warning-700 border-warning-300/60 dark:text-warning-300 dark:border-warning-700/60',
        success:
          'text-success-700 border-success-300/60 dark:text-success-300 dark:border-success-700/60',
        info: 'text-info-700 border-info-300/60 dark:text-info-300 dark:border-info-700/60',
        pending: 'text-status-pending border-status-pending/30',
        primary: 'text-primary border-primary/25',
        teal: 'text-brand-teal-700 border-brand-teal-200 dark:text-brand-teal-200 dark:border-brand-teal-700/60',
        neutral: 'text-muted-foreground border-border/70',
      },
    },
    compoundVariants: [
      { appearance: 'solid', tone: 'critical', class: 'bg-error-50 dark:bg-error-700/20' },
      { appearance: 'solid', tone: 'danger', class: 'bg-error-50 dark:bg-error-700/15' },
      { appearance: 'solid', tone: 'warning', class: 'bg-warning-50 dark:bg-warning-700/15' },
      { appearance: 'solid', tone: 'success', class: 'bg-success-50 dark:bg-success-700/15' },
      { appearance: 'solid', tone: 'info', class: 'bg-info-50 dark:bg-info-700/15' },
      { appearance: 'solid', tone: 'pending', class: 'bg-status-pending/10 dark:bg-status-pending/20' },
      { appearance: 'solid', tone: 'primary', class: 'bg-primary/10 dark:bg-primary/20' },
      { appearance: 'solid', tone: 'teal', class: 'bg-brand-teal-50 dark:bg-brand-teal-700/15' },
      { appearance: 'solid', tone: 'neutral', class: 'bg-neutral-100 dark:bg-neutral-800' },
    ],
    defaultVariants: { tone: 'neutral', size: 'md', appearance: 'solid' },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof statusBadgeVariants>['tone']>;
export type StatusBadgeSize = NonNullable<VariantProps<typeof statusBadgeVariants>['size']>;

/** Dot color per tone for the `dot` variant (token ramps only). */
const DOT_CLASS: Record<StatusTone, string> = {
  critical: 'bg-error-500',
  danger: 'bg-error-500',
  warning: 'bg-warning-500',
  success: 'bg-success-500',
  info: 'bg-info-500',
  pending: 'bg-status-pending',
  primary: 'bg-primary',
  teal: 'bg-brand-teal-500',
  neutral: 'bg-neutral-400',
};

const ICON_SIZE: Record<StatusBadgeSize, string> = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
  lg: 'h-4 w-4',
};

/* ------------------------------------------------------------------------- *
 * Domain maps — exported so callers (and the deprecated adapters) resolve a
 * raw backend token to the right tone/label/icon without ad-hoc styling.
 * ------------------------------------------------------------------------- */

export interface StatusToneEntry {
  tone: StatusTone;
  label?: string;
  /**
   * Authentic Arabic (Saudi legal/administrative register) label. Optional; the
   * `StatusBadge` prefers it over `label` when the active locale is Arabic and
   * falls back to `label` (then a humanized token) when absent.
   */
  labelAr?: string;
  icon?: LucideIcon;
}
export type StatusToneMap = Record<string, StatusToneEntry>;

/** Severity ramp — pass `status="critical"` and get the severity visual. */
export const severityMap: StatusToneMap = {
  critical: { tone: 'critical', label: 'Critical', labelAr: 'حرجة', icon: AlertTriangle },
  high: { tone: 'danger', label: 'High', labelAr: 'عالية', icon: AlertCircle },
  warning: { tone: 'warning', label: 'Warning', labelAr: 'تحذير', icon: AlertCircle },
  medium: { tone: 'warning', label: 'Medium', labelAr: 'متوسطة', icon: Info },
  moderate: { tone: 'warning', label: 'Moderate', labelAr: 'متوسطة', icon: Info },
  low: { tone: 'info', label: 'Low', labelAr: 'منخفضة', icon: ArrowDown },
  minor: { tone: 'info', label: 'Minor', labelAr: 'طفيفة', icon: ArrowDown },
  info: { tone: 'neutral', label: 'Info', labelAr: 'معلومة', icon: Info },
  informational: { tone: 'neutral', label: 'Informational', labelAr: 'معلوماتية', icon: Info },
};

/** Case / work-item lifecycle statuses (legal cases, incidents, tickets). */
export const caseStatusMap: StatusToneMap = {
  intake: { tone: 'neutral', label: 'Intake', labelAr: 'استقبال', icon: Inbox },
  new: { tone: 'info', label: 'New', labelAr: 'جديدة', icon: AlertCircle },
  open: { tone: 'info', label: 'Open', labelAr: 'مفتوحة', icon: PlayCircle },
  in_progress: { tone: 'info', label: 'In Progress', labelAr: 'قيد المعالجة', icon: PlayCircle },
  under_procedure: { tone: 'warning', label: 'Under Procedure', labelAr: 'قيد الإجراء', icon: Gavel },
  on_hold: { tone: 'warning', label: 'On Hold', labelAr: 'معلّقة', icon: PauseCircle },
  pending_approval: { tone: 'warning', label: 'Pending Approval', labelAr: 'بانتظار الاعتماد', icon: Clock },
  escalated: { tone: 'pending', label: 'Escalated', labelAr: 'مُصعّدة', icon: ArrowUpCircle },
  approved: { tone: 'primary', label: 'Approved', labelAr: 'معتمدة', icon: ShieldCheck },
  rejected: { tone: 'danger', label: 'Rejected', labelAr: 'مرفوضة', icon: XCircle },
  resolved: { tone: 'success', label: 'Resolved', labelAr: 'مُنجزة', icon: CheckCircle2 },
  closed: { tone: 'success', label: 'Closed', labelAr: 'مغلقة', icon: CheckCircle2 },
  cancelled: { tone: 'neutral', label: 'Cancelled', labelAr: 'ملغاة', icon: Ban },
  archived: { tone: 'neutral', label: 'Archived', labelAr: 'مؤرشفة', icon: Archive },
};

/** SLA health statuses. */
export const slaMap: StatusToneMap = {
  on_track: { tone: 'success', label: 'On Track', labelAr: 'ضمن المسار', icon: CheckCircle2 },
  on_time: { tone: 'success', label: 'On Time', labelAr: 'في الوقت', icon: CheckCircle2 },
  due_soon: { tone: 'warning', label: 'Due Soon', labelAr: 'تستحق قريبًا', icon: AlertTriangle },
  at_risk: { tone: 'warning', label: 'At Risk', labelAr: 'معرّضة للخطر', icon: AlertTriangle },
  breached: { tone: 'critical', label: 'Breached', labelAr: 'مُخالَفة', icon: AlertOctagon },
  overdue: { tone: 'critical', label: 'Overdue', labelAr: 'متأخرة', icon: AlertOctagon },
};

/** Generic entity / run states shared across suites. */
export const genericStatusMap: StatusToneMap = {
  active: { tone: 'success', label: 'Active', labelAr: 'نشط', icon: CheckCircle2 },
  enabled: { tone: 'success', label: 'Enabled', labelAr: 'مُفعّل', icon: CheckCircle2 },
  completed: { tone: 'success', label: 'Completed', labelAr: 'مكتمل', icon: CheckCircle2 },
  passed: { tone: 'success', label: 'Passed', labelAr: 'ناجح', icon: CheckCircle2 },
  inactive: { tone: 'neutral', label: 'Inactive', labelAr: 'غير نشط', icon: PauseCircle },
  disabled: { tone: 'neutral', label: 'Disabled', labelAr: 'مُعطّل', icon: Ban },
  draft: { tone: 'neutral', label: 'Draft', labelAr: 'مسودة', icon: FileText },
  pending: { tone: 'pending', label: 'Pending', labelAr: 'قيد الانتظار', icon: Clock },
  submitted: { tone: 'info', label: 'Submitted', labelAr: 'مُقدَّم', icon: Send },
  running: { tone: 'info', label: 'Running', labelAr: 'قيد التشغيل', icon: PlayCircle },
  paused: { tone: 'warning', label: 'Paused', labelAr: 'متوقف مؤقتًا', icon: PauseCircle },
  degraded: { tone: 'warning', label: 'Degraded', labelAr: 'متدهور', icon: AlertTriangle },
  blocked: { tone: 'warning', label: 'Blocked', labelAr: 'محجوب', icon: Ban },
  failed: { tone: 'danger', label: 'Failed', labelAr: 'فاشل', icon: XCircle },
  error: { tone: 'danger', label: 'Error', labelAr: 'خطأ', icon: AlertCircle },
  expired: { tone: 'danger', label: 'Expired', labelAr: 'منتهي', icon: AlertTriangle },
};

/**
 * Built-in fallback lookup. Severity wins on collisions (so a bare
 * `status="critical"` reads as severity), then generic, SLA and case tokens.
 */
const DEFAULT_LOOKUP: StatusToneMap = {
  ...caseStatusMap,
  ...slaMap,
  ...genericStatusMap,
  ...severityMap,
};

/** Legacy `StatusConfig` color-name → semantic tone bridge. */
const COLOR_TO_TONE: Record<string, StatusTone> = {
  red: 'danger',
  orange: 'warning',
  yellow: 'warning',
  green: 'primary',
  blue: 'info',
  purple: 'pending',
  gray: 'neutral',
  teal: 'teal',
};

/** Humanize an unknown token: `pending_approval` → `Pending approval`. */
function humanizeStatus(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}

export interface StatusBadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Raw status token, e.g. `critical`, `pending_approval`. */
  status: string;
  /** Legacy color-name config map (`@/lib/status-configs`). */
  config?: StatusConfig;
  /** Explicit domain map (`severityMap`, `caseStatusMap`, `slaMap`, …). */
  map?: StatusToneMap;
  /** Explicit tone override — wins over `config`/`map` resolution. */
  tone?: StatusTone;
  /** Explicit label override (localized copy). */
  label?: React.ReactNode;
  /** Explicit icon override; pass `null` to force icon-less. */
  icon?: LucideIcon | null;
  /** Extra classes for the leading icon (e.g. `animate-spin`). */
  iconClassName?: string;
  /** Hide the visible label (icon-only). Supply `aria-label` for AT. */
  hideLabel?: boolean;
  variant?: 'default' | 'outline' | 'dot';
  size?: StatusBadgeSize;
  /**
   * Optional density from the shared kit scale (`densityPadding.badge`). When
   * set it overrides the inline padding to sit on the platform's one density
   * rhythm; omit (the default) to keep the historic `size`-driven appearance.
   */
  density?: Density;
  className?: string;
}

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  function StatusBadge(
    {
      status,
      config,
      map,
      tone,
      label,
      icon,
      iconClassName,
      hideLabel = false,
      variant = 'default',
      size = 'md',
      density,
      className,
      ...props
    },
    ref,
  ) {
    // Locale drives ONLY the human-readable label text; keys, tones, colors and
    // icons are locale-invariant. Non-throwing hook → primitive stays testable
    // in isolation and renders the default locale without a provider.
    const { locale } = useLocaleOrDefault();
    const key = typeof status === 'string' ? status.toLowerCase() : String(status);
    const configItem = config?.[status] ?? config?.[key];
    // Only consult the built-in lookup when the caller did not bring its own
    // vocabulary — keeps the historic `config` call sites pixel-stable.
    const mapEntry = map ? map[key] : config ? undefined : DEFAULT_LOOKUP[key];

    const resolvedTone: StatusTone =
      tone ??
      (configItem
        ? COLOR_TO_TONE[configItem.color] ?? 'neutral'
        : mapEntry?.tone ?? 'neutral');

    // In Arabic locale prefer the entry's `labelAr`, falling back to the English
    // `label` (then a humanized token) for any not-yet-localized entry.
    const pickLabel = (item?: { label?: string; labelAr?: string }) =>
      locale === 'ar' ? item?.labelAr ?? item?.label : item?.label;

    const resolvedLabel =
      label ?? pickLabel(configItem) ?? pickLabel(mapEntry) ?? humanizeStatus(status);

    const ResolvedIcon: LucideIcon | undefined =
      icon === null ? undefined : icon ?? configItem?.icon ?? mapEntry?.icon;

    const appearance =
      variant === 'outline' ? 'outline' : variant === 'dot' ? 'dot' : 'solid';

    return (
      <span
        ref={ref}
        className={cn(
          statusBadgeVariants({ tone: resolvedTone, size, appearance }),
          // Optional shared-scale density override (padding only) — appended so
          // tailwind-merge lets it win over the size padding when provided.
          density && densityPadding.badge[density],
          className,
        )}
        {...props}
      >
        {variant === 'dot' ? (
          <span
            className={cn('h-2 w-2 shrink-0 rounded-full', DOT_CLASS[resolvedTone])}
            aria-hidden
          />
        ) : (
          ResolvedIcon && (
            <ResolvedIcon
              className={cn(ICON_SIZE[size], 'shrink-0', iconClassName)}
              aria-hidden
            />
          )
        )}
        {!hideLabel && <span className="truncate">{resolvedLabel}</span>}
      </span>
    );
  },
);

export { statusBadgeVariants };
