'use client';

/**
 * Obligations — folded into the Risk Portfolio page.
 *
 * Obligations were a standalone nav destination; they are reference/oversight
 * content that belongs alongside the risk they mitigate, so the ledger now lives
 * here on one page. Each obligation traces back to the contract it protects (its
 * risk record in the register above). This is a read/oversight surface; full
 * create/edit stays on the routable `/lex/obligations` deep link.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronRight, FileText, ListChecks } from 'lucide-react';

import { cn } from '@/lib/utils';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { useLexFormat } from '@/lib/lex/ksa';
import { SectionCard } from '@/components/suites/section-card';
import type { LexObligation } from '@/types/suites';
import { useRiskLabels } from '../_lib/risk-labels';

const OPEN_STATUSES: ReadonlySet<string> = new Set(['open', 'in_progress', 'blocked']);

export function ObligationsPanel() {
  const labels = useRiskLabels();
  const f = useLexFormat();
  const P = labels.obligationsPanel;

  const { data, isLoading } = useQuery({
    queryKey: ['lex-risk-portfolio', 'obligations-panel'],
    queryFn: () =>
      fetchSuitePaginated<LexObligation>('/api/v1/lex/obligations', {
        page: 1,
        per_page: 200,
        sort: 'due_date',
        order: 'asc',
      }),
    retry: false,
  });

  const rows = useMemo(() => data?.data ?? [], [data]);
  const isEmpty = !isLoading && rows.length === 0;

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-primary" aria-hidden />
          {P.title}
        </span>
      }
      description={P.description}
      className="border-border/70 shadow-elevation-1"
      actions={
        <Link
          href="/lex/obligations"
          className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/40"
        >
          {P.linkHint}
          <ChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      }
    >
      {isLoading ? (
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 w-full rounded-lg skeleton-shimmer" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/10 px-6 py-10 text-center">
          <ListChecks className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">{P.empty}</p>
          <p className="max-w-md text-xs text-muted-foreground">{P.emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[44rem]">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_8rem_7rem] items-center gap-3 border-b border-border/60 px-3 pb-2 text-caption font-medium uppercase tracking-label text-muted-foreground">
              <span>{P.colObligation}</span>
              <span>{P.colLinked}</span>
              <span>{P.colDue}</span>
              <span>{P.colStatus}</span>
            </div>
            <ul className="divide-y divide-border/50">
              {rows.map((o) => {
                const overdue = o.days_until_due < 0 && OPEN_STATUSES.has(String(o.status));
                return (
                  <li key={o.id}>
                    <Link
                      href={`/lex/obligations?highlight=${o.id}`}
                      className="grid grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_8rem_7rem] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30 focus:outline-none focus-visible:bg-muted/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{o.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{o.owner_name}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{o.contract_title || P.unlinked}</span>
                      </span>
                      <span className={cn('flex items-center gap-1 text-xs', overdue ? 'font-medium text-error-600 dark:text-error-300' : 'text-muted-foreground')}>
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {overdue ? P.overdue : f.formatDate(o.due_date)}
                      </span>
                      <span>
                        <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                          {String(o.status)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
