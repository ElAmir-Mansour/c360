'use client';

/** Figma-aligned recent-investigations table backed by the control projection. */

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

import { useLocale } from '@/components/providers/locale-provider';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import type { CasesControlRecentInvestigation } from '@/lib/lex/cases-control';

import { resolveCaseTypeLabel } from '../../[id]/_components/case-enums-i18n';
import { useControlPanelLabels } from '../_lib/labels';
import { INVESTIGATION_STATUS_BADGE_MAP } from '../_lib/status-maps';

interface InvestigationVM extends Record<string, unknown> {
  id: string;
  reference: string;
  caseType: string;
  status: string;
  investigator: string;
  assigned: boolean;
}

export function ActiveInvestigationsCard({
  investigations,
  loading,
  canAssign = false,
}: {
  investigations: CasesControlRecentInvestigation[];
  loading?: boolean;
  canAssign?: boolean;
}) {
  const t = useControlPanelLabels();
  const { locale, direction } = useLocale();
  const router = useRouter();

  const rows = useMemo<InvestigationVM[]>(
    () =>
      investigations.slice(0, 6).map((row) => ({
        id: row.id,
        reference: row.investigation_number,
        caseType: row.case_type
          ? resolveCaseTypeLabel(row.case_type, locale)
          : '—',
        status: row.status,
        investigator: row.lead_investigator?.trim() || t.recent.unassigned,
        assigned: Boolean(row.lead_investigator?.trim()),
      })),
    [investigations, locale, t.recent.unassigned],
  );

  const columns: Column<InvestigationVM>[] = [
    {
      key: 'reference',
      header: t.investigations.columns.reference,
      render: (item) => (
        <Link
          href={`/lex/investigations/${item.id}`}
          className="font-semibold text-foreground hover:text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {item.reference}
        </Link>
      ),
    },
    {
      key: 'caseType',
      header: t.investigations.columns.caseType,
      render: (item) => (
        <span className="font-medium text-muted-foreground">{item.caseType}</span>
      ),
    },
    {
      key: 'status',
      header: t.investigations.columns.status,
      render: (item) => (
        <StatusBadge
          status={item.status}
          map={INVESTIGATION_STATUS_BADGE_MAP}
          size="sm"
        />
      ),
    },
    {
      key: 'investigator',
      header: t.investigations.columns.investigator,
      render: (item) =>
        item.assigned ? (
          <span className="inline-flex rounded-full border border-success-300/70 bg-success-50 px-3 py-1 text-xs font-semibold text-success-700 dark:border-success-700/70 dark:bg-success-950/20 dark:text-success-300">
            {item.investigator}
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
          <span className="text-muted-foreground">{item.investigator}</span>
        ),
    },
  ];

  return (
    <section
      className="rounded-[20px] border border-border bg-card p-5 shadow-sm sm:p-6"
      dir={direction}
      lang={locale}
      aria-label={t.investigations.title}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h4 font-semibold text-foreground">
          {t.investigations.title}
        </h2>
        <Link
          href="/lex/investigations"
          className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline"
        >
          {t.investigations.viewAll}
          <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>

      <div className="mt-4">
        <SimpleTable<InvestigationVM>
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessage={t.investigations.empty}
          ariaLabel={t.investigations.title}
          getRowKey={(item) => item.id}
          onRowClick={(item) => router.push(`/lex/investigations/${item.id}`)}
        />
      </div>
    </section>
  );
}
