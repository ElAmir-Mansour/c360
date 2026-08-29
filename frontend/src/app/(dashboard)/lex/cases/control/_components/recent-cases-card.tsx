'use client';

/**
 * "Recent Cases Overview" — the wide left panel. A compact table of the most
 * recently updated cases (via the sanctioned `SimpleTable` primitive) with a
 * deep-link into the full archive. Case-type and status tokens are localized
 * (via `resolveCaseTypeLabel` and the shared `<StatusBadge>` maps) so nothing
 * leaks a raw backend token into the Arabic UI.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { StatusBadge, severityMap } from '@/components/shared/status-badge';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import type { RecentCaseRow } from '../_lib/use-control-panel';
import { CASE_STATUS_BADGE_MAP } from '../_lib/status-maps';
import { useControlPanelLabels } from '../_lib/labels';

/** Flat, table-friendly view model (SimpleTable requires an index signature). */
interface RecentCaseVM extends Record<string, unknown> {
  id: string;
  reference: string;
  side: 'plaintiff' | 'defendant';
  status: string;
  priority: string;
  reviewer: string;
  assigned: boolean;
}

export function RecentCasesCard({
  cases,
  loading,
  canAssign = false,
}: {
  cases: RecentCaseRow[];
  loading?: boolean;
  canAssign?: boolean;
}) {
  const t = useControlPanelLabels();
  const { locale, direction } = useLocale();
  const router = useRouter();
  const columnLabels = t.recent.columns;

  const rows = useMemo<RecentCaseVM[]>(
    () =>
      cases.map((row) => {
        const lawyer = row.responsible_lawyer?.trim();
        return {
          id: row.id,
          reference: row.case_number,
          side: row.company_status,
          status: row.status,
          priority: row.priority,
          reviewer: lawyer || t.recent.unassigned,
          assigned: Boolean(lawyer),
        };
      }),
    [cases, t.recent.unassigned],
  );

  const columns: Column<RecentCaseVM>[] = [
    {
      key: 'reference',
      header: columnLabels.reference,
      render: (item) => (
        <Link
          href={`/lex/cases/${item.id}`}
          className="font-semibold text-foreground hover:text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {item.reference}
        </Link>
      ),
    },
    {
      key: 'side',
      header: columnLabels.side,
      render: (item) => (
        <span
          className={
            item.side === 'plaintiff'
              ? 'font-semibold text-success-600 dark:text-success-400'
              : 'font-semibold text-warning-600 dark:text-warning-400'
          }
        >
          {item.side === 'plaintiff'
            ? t.companyStatus.plaintiff
            : t.companyStatus.defendant}
        </span>
      ),
    },
    {
      key: 'status',
      header: columnLabels.status,
      render: (item) => (
        <StatusBadge status={item.status} map={CASE_STATUS_BADGE_MAP} size="sm" />
      ),
    },
    {
      key: 'priority',
      header: columnLabels.priority,
      render: (item) => (
        <StatusBadge status={item.priority} map={severityMap} size="sm" />
      ),
    },
    {
      key: 'reviewer',
      header: columnLabels.reviewer,
      render: (item) =>
        item.assigned ? (
          <span className="inline-flex rounded-full border border-success-300/70 bg-success-50 px-3 py-1 text-xs font-semibold text-success-700 dark:border-success-700/70 dark:bg-success-950/20 dark:text-success-300">
            {item.reviewer}
          </span>
        ) : canAssign ? (
          <Link
            href="/lex/cases/control/assignment"
            className="inline-flex min-w-20 justify-center rounded-full border border-info-500 px-3 py-1 text-xs font-semibold text-info-700 transition-colors hover:bg-info-50 dark:text-info-300 dark:hover:bg-info-950/20"
            onClick={(event) => event.stopPropagation()}
          >
            {t.recent.assign}
          </Link>
        ) : (
          <span className="text-muted-foreground">{item.reviewer}</span>
        ),
    },
  ];

  return (
    <section
      className="rounded-[20px] border border-border bg-card p-5 shadow-sm sm:p-6"
      dir={direction}
      lang={locale}
      aria-label={t.recent.title}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h4 font-semibold text-foreground">{t.recent.title}</h2>
        <Link
          href="/lex/cases"
          className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline"
        >
          {t.recent.viewArchive}
          <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>

      <div className="mt-4">
        <SimpleTable<RecentCaseVM>
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessage={t.recent.empty}
          ariaLabel={t.recent.title}
          getRowKey={(item) => item.id}
          onRowClick={(item) => router.push(`/lex/cases/${item.id}`)}
        />
      </div>
    </section>
  );
}
