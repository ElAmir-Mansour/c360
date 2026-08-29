import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, type LucideIcon } from 'lucide-react';

import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export interface AuthInsightItem {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}

interface AuthPageIntroProps {
  badge: string;
  badgeIcon: LucideIcon;
  showBadge?: boolean;
  title: string;
  description: ReactNode;
  statusLabel?: string;
  statusValue?: string;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}

interface AuthInsightGridProps {
  items: AuthInsightItem[];
}

interface AuthFormSurfaceProps {
  children: ReactNode;
  className?: string;
}

interface AuthGuardGridProps {
  items: readonly string[];
}

interface AuthCalloutProps {
  icon: LucideIcon;
  title?: string;
  children: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  className?: string;
}

interface AuthActionStripProps {
  description: string;
  href: string;
  cta: string;
}

interface AuthCenteredStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  secondary?: ReactNode;
  className?: string;
  children?: ReactNode;
}

interface AuthLoadingStateProps {
  label: string;
  detail?: string;
  className?: string;
}

const CALLOUT_STYLES = {
  default: 'border-primary/15 bg-secondary/70 text-foreground/70',
  success: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-brand-gold/50 bg-brand-gold/15 text-brand-gold-dark',
  danger: 'border-error-100 bg-error-50 text-error-700',
} as const;

export const AUTH_INPUT_CLASSNAME =
  'h-11 rounded-xl border-primary/20 bg-card text-[15px] text-foreground shadow-sm placeholder:text-foreground/35 focus-visible:ring-ring/30';

export const AUTH_SELECT_CLASSNAME =
  'flex h-11 w-full appearance-none rounded-xl border border-primary/20 bg-card px-3 py-2 text-[15px] text-foreground shadow-sm ring-offset-background placeholder:text-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2';

function AuthInsightCard({ icon: Icon, label, value, detail }: AuthInsightItem) {
  return (
    <div className="rounded-xl border border-primary/12 bg-card p-3.5 shadow-elevation-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-overline uppercase tracking-[0.22em] text-foreground/55">{label}</p>
          <p className="mt-1.5 text-base font-semibold tracking-tight text-foreground">{value}</p>
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-6 text-foreground/60">{detail}</p>
    </div>
  );
}

export function AuthPageIntro({
  badge,
  badgeIcon: BadgeIcon,
  showBadge = true,
  title,
  description,
  statusLabel,
  statusValue,
  className,
  titleClassName,
  descriptionClassName,
}: AuthPageIntroProps) {
  return (
    <div className={cn('space-y-2.5', className)}>
      {showBadge ? (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-0.5 text-overline font-medium uppercase tracking-caps-xwide text-primary">
          <BadgeIcon className="h-3 w-3 text-primary" />
          {badge}
        </div>
      ) : null}
      <h1
        className={cn(
          'text-balance text-h2 font-semibold leading-tight tracking-[-0.025em] text-foreground rtl:tracking-normal',
          titleClassName,
        )}
      >
        {title}
      </h1>
      {/* text-muted-foreground (not an alpha-diluted foreground) uses the exact
          Clario Grey Dark #6C7874 in light mode and lifts in dark mode. */}
      <p
        className={cn(
          'max-w-[48ch] text-pretty text-[15px] leading-6 text-muted-foreground',
          descriptionClassName,
        )}
      >
        {description}
      </p>
      {statusLabel && statusValue ? (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="uppercase tracking-caps-wide text-overline text-primary/70">{statusLabel}</span>
          <span className="font-semibold">{statusValue}</span>
        </div>
      ) : null}
    </div>
  );
}

export function AuthInsightGrid({ items }: AuthInsightGridProps) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {items.map((item) => (
        <AuthInsightCard key={`${item.label}-${item.value}`} {...item} />
      ))}
    </div>
  );
}

export function AuthFormSurface({ children, className }: AuthFormSurfaceProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {children}
    </div>
  );
}

export function AuthGuardGrid({ items }: AuthGuardGridProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <div
          key={item}
          className="flex items-center gap-2 rounded-lg border border-primary/12 bg-secondary/50 px-3 py-2 text-[12px] leading-5 text-foreground/65"
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

export function AuthCallout({
  icon: Icon,
  title,
  children,
  tone = 'default',
  className,
}: AuthCalloutProps) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3.5 py-3 text-[13px]',
        CALLOUT_STYLES[tone],
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="rounded-lg bg-card/70 p-1.5 text-inherit shadow-sm">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          {title ? <p className="font-semibold">{title}</p> : null}
          <div className={cn('leading-6', title ? 'mt-0.5' : '')}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function AuthActionStrip({ description, href, cta }: AuthActionStripProps) {
  return (
    <div className="flex items-center justify-between border-t border-primary/10 pt-4 text-[13px] text-foreground/65">
      <p>{description}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 font-semibold text-primary hover:text-primary hover:underline"
      >
        {cta}
        <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
      </Link>
    </div>
  );
}

export function AuthCenteredState({
  icon: Icon,
  title,
  description,
  secondary,
  className,
  children,
}: AuthCenteredStateProps) {
  return (
    <div className={cn('space-y-5 text-center', className)}>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/15">
        <Icon className="h-7 w-7" />
      </div>
      <div className="space-y-2">
        <h1 className="text-h2 font-semibold text-foreground">{title}</h1>
        <div className="text-sm leading-6 text-foreground/65">{description}</div>
        {secondary ? <div className="text-xs text-foreground/55">{secondary}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function AuthLoadingState({ label, detail, className }: AuthLoadingStateProps) {
  return (
    <div className={cn('space-y-4 py-2 text-center', className)}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/15">
        <Spinner className="text-primary" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-h3 font-semibold text-foreground">{label}</h1>
        {detail ? <p className="text-sm leading-6 text-foreground/65">{detail}</p> : null}
      </div>
    </div>
  );
}
