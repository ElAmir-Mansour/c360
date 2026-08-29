/**
 * Case-classification usage + safety surface.
 *
 * Self-contained bilingual (English + Modern Standard Arabic) building blocks
 * consumed by the classifications page integrator inside the cascade preview and
 * the delete-impact dialog:
 *
 *   - {@link useClassificationUsage}  react-query hook over
 *     `lexAdminApi.getCaseClassificationUsage()` (the shared usage map).
 *   - {@link ClassificationUsageStat}  one cell of the 3-col stat grid ("Used in
 *     N cases").
 *   - {@link ClassificationSafetyVerdict}  a StatusBadge / SeverityIndicator
 *     verdict explaining whether a node is safe to delete.
 *
 * Following the lex bilingual contract (see `../../_lib/lex-i18n.ts`), this file
 * carries its OWN `{ en, ar }` label bundle and resolves it with
 * `resolveLexBilingual` against the active locale — it does NOT depend on
 * `admin-labels.ts` (owned by another agent). All JSX uses RTL-safe logical
 * spacing (me-/ms-/ps-/pe-) and Western digits on both locales.
 */
'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, AlertTriangle, GitBranch, Lock } from 'lucide-react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { StatusBadge } from '@/components/shared/status-badge';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { cn } from '@/lib/utils';
import { lexAdminApi } from '@/lib/lex/admin';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

/* ========================================================================= *
 * Self-contained bilingual labels
 * ========================================================================= */

interface UsageLabels {
  /** Stat-cell heading. */
  usedInCases: string;
  /** Stat-cell value, e.g. "12 cases" / "No cases". */
  caseCount: (count: number) => string;
  /** Loading placeholder for the stat value. */
  loading: string;
  verdict: {
    safe: string;
    /** Referenced by N cases — deactivate & reassign instead. */
    referenced: (count: number) => string;
    hasChildren: string;
    systemProtected: string;
  };
}

const usageBundle: LexBilingual<UsageLabels> = {
  en: {
    usedInCases: 'Used in cases',
    caseCount: (count) => (count === 0 ? 'No cases' : `${count} ${count === 1 ? 'case' : 'cases'}`),
    loading: '—',
    verdict: {
      safe: 'Safe to delete',
      referenced: (count) =>
        `Referenced by ${count} ${count === 1 ? 'case' : 'cases'} — deactivate & reassign instead`,
      hasChildren: 'Has children — remove or reassign them first',
      systemProtected: 'System-protected',
    },
  },
  ar: {
    usedInCases: 'مستخدم في القضايا',
    caseCount: (count) => (count === 0 ? 'لا توجد قضايا' : `${count} قضية`),
    loading: '—',
    verdict: {
      safe: 'آمن للحذف',
      referenced: (count) => `مُشار إليه في ${count} قضية — قم بالتعطيل وإعادة الإسناد بدلًا من ذلك`,
      hasChildren: 'يحتوي على فروع — أزِلها أو أعِد إسنادها أولًا',
      systemProtected: 'محمي من النظام',
    },
  },
};

function useUsageLabels(): UsageLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(usageBundle, locale), [locale]);
}

/* ========================================================================= *
 * Data hook
 * ========================================================================= */

/**
 * Query key for the classification usage map. Exported so the page integrator
 * can invalidate it after merge / reorder / bulk mutations.
 */
export const CLASSIFICATION_USAGE_QUERY_KEY = ['lex-admin-classifications', 'usage'] as const;

export interface UseClassificationUsageResult {
  /** Map of classification id -> number of cases referencing it. Never null. */
  usage: Record<string, number>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * react-query hook wrapping {@link lexAdminApi.getCaseClassificationUsage}.
 * Returns a never-null usage map plus the usual query flags. Consumers read a
 * per-node count via `usage[node.id] ?? 0`.
 */
export function useClassificationUsage(): UseClassificationUsageResult {
  const query = useQuery({
    queryKey: CLASSIFICATION_USAGE_QUERY_KEY,
    queryFn: () => lexAdminApi.getCaseClassificationUsage(),
    staleTime: 30_000,
  });

  return {
    usage: query.data ?? {},
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

/* ========================================================================= *
 * Presentational: usage stat cell
 * ========================================================================= */

export interface ClassificationUsageStatProps {
  /** Number of cases referencing the classification. */
  count: number;
  /** Show a skeleton placeholder instead of the value while the map loads. */
  loading?: boolean;
  className?: string;
  /** Exact case-list drilldown for the classification. */
  href?: string;
}

/**
 * A single cell for the 3-col stat grid in the cascade preview / delete-impact
 * dialog, rendering "Used in cases / N cases". Self-sizing; the caller owns the
 * grid container.
 */
export function ClassificationUsageStat({
  count,
  loading = false,
  className,
  href,
}: ClassificationUsageStatProps) {
  const labels = useUsageLabels();
  const content = (
    <>
      <p className="text-overline font-medium uppercase text-muted-foreground">
        {labels.usedInCases}
      </p>
      {loading ? (
        <span
          className="mt-1.5 block h-5 w-16 animate-pulse rounded bg-muted-foreground/20"
          aria-hidden
        />
      ) : (
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
          {labels.caseCount(count)}
        </p>
      )}
    </>
  );
  const statClassName = cn(
    'block rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-start transition',
    href && !loading && 'hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    className,
  );

  return href && !loading ? (
    <Link href={href} className={statClassName} title={statisticHint(labels.usedInCases)}>
      {content}
    </Link>
  ) : (
    <div className={statClassName} title={statisticHint(labels.usedInCases, false)}>{content}</div>
  );
}

/* ========================================================================= *
 * Presentational: safety verdict
 * ========================================================================= */

export interface ClassificationSafetyVerdictProps {
  /** Number of cases referencing the classification. */
  count: number;
  /** True for system-protected nodes (`is_system`). */
  isSystem: boolean;
  /** True when the node has at least one child. */
  hasChildren: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Renders a single verdict badge describing whether a classification can be
 * deleted. The node is "Safe to delete" only when it has no case references, is
 * not system-protected, and has no children; otherwise the most blocking reason
 * is surfaced as a SeverityIndicator (precedence: system > children >
 * references).
 */
export function ClassificationSafetyVerdict({
  count,
  isSystem,
  hasChildren,
  size = 'md',
  className,
}: ClassificationSafetyVerdictProps) {
  const labels = useUsageLabels();

  if (isSystem) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <SeverityIndicator severity="high" showLabel={false} size={size} className="me-1.5" />
        <Lock className="me-1 h-3.5 w-3.5 text-warning-700 dark:text-warning-300" aria-hidden />
        <span className="text-sm font-medium text-warning-700 dark:text-warning-300">
          {labels.verdict.systemProtected}
        </span>
      </span>
    );
  }

  if (hasChildren) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <SeverityIndicator severity="warning" showLabel={false} size={size} className="me-1.5" />
        <GitBranch className="me-1 h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" aria-hidden />
        <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
          {labels.verdict.hasChildren}
        </span>
      </span>
    );
  }

  if (count > 0) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <SeverityIndicator severity="warning" showLabel={false} size={size} className="me-1.5" />
        <AlertTriangle className="me-1 h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" aria-hidden />
        <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
          {labels.verdict.referenced(count)}
        </span>
      </span>
    );
  }

  return (
    <StatusBadge
      status="safe"
      size={size}
      config={{
        safe: { label: labels.verdict.safe, color: 'green', icon: ShieldCheck },
      }}
      className={className}
    />
  );
}
