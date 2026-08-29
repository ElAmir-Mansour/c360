'use client';

/**
 * HealthIssueRow — renders a single {@link AdminIssue} in the Health & QA list:
 * a severity dot/badge, the title, the "how to fix" description, the `area`
 * chip, and (when the issue carries an `href`) a deep link to the affected
 * entity. Presentational and self-contained; the parent supplies localized
 * chrome strings.
 */
import Link from 'next/link';
import { AlertOctagon, AlertTriangle, Info, ArrowRight, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AdminIssue } from '../../../_lib/admin-feature-utils';

type Severity = AdminIssue['severity'];

interface SeverityTheme {
  icon: LucideIcon;
  dot: string;
  iconColor: string;
  badgeVariant: 'destructive' | 'warning' | 'secondary';
}

const SEVERITY_THEME: Record<Severity, SeverityTheme> = {
  critical: {
    icon: AlertOctagon,
    dot: 'bg-error-500',
    iconColor: 'text-error-500',
    badgeVariant: 'destructive',
  },
  warning: {
    icon: AlertTriangle,
    dot: 'bg-warning-500',
    iconColor: 'text-warning-700 dark:text-warning-300',
    badgeVariant: 'warning',
  },
  info: {
    icon: Info,
    dot: 'bg-sky-500',
    iconColor: 'text-sky-600',
    badgeVariant: 'secondary',
  },
};

interface HealthIssueRowProps {
  issue: AdminIssue;
  /** Localized "Open entity" link label. */
  openEntityLabel: string;
  className?: string;
}

export function HealthIssueRow({ issue, openEntityLabel, className }: HealthIssueRowProps) {
  const theme = SEVERITY_THEME[issue.severity];
  const Icon = theme.icon;

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border/70 bg-card/60 p-3 transition-colors hover:bg-muted/40',
        className,
      )}
    >
      <span className="mt-0.5 grid shrink-0 place-items-center">
        <span className={cn('inline-block h-2 w-2 rounded-full', theme.dot)} aria-hidden />
      </span>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', theme.iconColor)} aria-hidden />

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{issue.title}</span>
          <Badge variant="outline" className="normal-case tracking-normal">
            {issue.area}
          </Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{issue.description}</p>
        {issue.href ? (
          <Link
            href={issue.href}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {openEntityLabel}
            <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
