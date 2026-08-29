'use client';

/**
 * "Recent Contracts" — the wide left panel's first table. A compact list of the
 * most recent contracts (via the sanctioned `SimpleTable` primitive) that deep
 * links into each contract's detail workspace, where the reviewer assignment and
 * lifecycle actions live. Type tokens localize through `useContractTypeLabels`
 * and status through the shared `<LexStatusChip domain="contract">`, so no raw
 * backend token leaks into the Arabic UI.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import type { LexContractRecord } from '@/types/suites';
import { useContractTypeLabels } from '../../_lib/contracts-labels';
import { CONTRACT_STATUS_BADGE_MAP } from '../_lib/status-maps';
import { useContractsControlLabels } from '../_lib/labels';

interface RecentContractVM extends Record<string, unknown> {
  id: string;
  reference: string;
  typeLabel: string;
  status: string;
  counterparty: string;
  reviewer: string;
  assigned: boolean;
}

export function RecentContractsCard({
  contracts,
  loading,
}: {
  contracts: LexContractRecord[];
  loading?: boolean;
}) {
  const t = useContractsControlLabels();
  const { locale, direction } = useLocale();
  const router = useRouter();
  const typeLabels = useContractTypeLabels();
  const columnLabels = t.recentContracts.columns;

  const rows = useMemo<RecentContractVM[]>(
    () =>
      contracts.map((c) => {
        const reviewer = c.legal_reviewer_name?.trim();
        return {
          id: c.id,
          reference: c.contract_number?.trim() || c.title || t.recentContracts.untitled,
          typeLabel: typeLabels[c.type] ?? c.type,
          status: c.status,
          counterparty: c.party_b_name?.trim() || '—',
          reviewer: reviewer || t.recentContracts.unassigned,
          assigned: Boolean(reviewer),
        };
      }),
    [contracts, typeLabels, t.recentContracts.untitled, t.recentContracts.unassigned],
  );

  const columns: Column<RecentContractVM>[] = [
    {
      key: 'reference',
      header: columnLabels.reference,
      render: (item) => (
        <Link
          href={`/lex/contracts/${item.id}`}
          className="font-semibold text-foreground hover:text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {item.reference}
        </Link>
      ),
    },
    {
      key: 'typeLabel',
      header: columnLabels.type,
      render: (item) => <span className="text-muted-foreground">{item.typeLabel}</span>,
    },
    {
      key: 'status',
      header: columnLabels.status,
      render: (item) => (
        <StatusBadge status={item.status} map={CONTRACT_STATUS_BADGE_MAP} size="sm" />
      ),
    },
    {
      key: 'counterparty',
      header: columnLabels.counterparty,
      render: (item) => <span className="text-muted-foreground">{item.counterparty}</span>,
    },
    {
      key: 'reviewer',
      header: columnLabels.reviewer,
      render: (item) => (
        <span className={item.assigned ? 'text-foreground' : 'text-muted-foreground'}>
          {item.reviewer}
        </span>
      ),
    },
  ];

  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      dir={direction}
      lang={locale}
      aria-label={t.recentContracts.title}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h4 font-semibold text-foreground">{t.recentContracts.title}</h2>
        <Link
          href="/lex/contracts"
          className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline"
        >
          {t.recentContracts.viewAll}
          <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>

      <div className="mt-4">
        <SimpleTable<RecentContractVM>
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessage={t.recentContracts.empty}
          ariaLabel={t.recentContracts.title}
          getRowKey={(item) => item.id}
          onRowClick={(item) => router.push(`/lex/contracts/${item.id}`)}
        />
      </div>
    </section>
  );
}
