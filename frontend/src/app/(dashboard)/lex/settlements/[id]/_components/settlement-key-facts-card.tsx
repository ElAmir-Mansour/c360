'use client';

/**
 * Right-rail "Key facts" card for the Settlement detail page — the money-and-
 * milestones summary an approver/closer scans first. Leads with the settlement
 * AMOUNT (large, KSA-formatted currency), then the ADR method, live status,
 * negotiation-round count, the latest recorded offer, and the approval /
 * execution timestamps.
 *
 * Fully driven by the `settlement` prop (no fetch). Amount + latest offer route
 * through {@link useLexFormat} so Arabic mode renders the Saudi Riyal symbol +
 * Arabic-Indic digits while honouring any explicit non-SAR currency. Bilingual
 * (EN + MSA) via {@link useSettlementDetailExtraLabels}; enum tokens localize
 * through the shared settlement catalog + the settlement status chip.
 */

import { type ReactNode, useMemo } from 'react';
import { CalendarCheck2, CheckCircle2, Handshake, Scale } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { LexStatusChip } from '@/components/lex/status-chip';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexFormatter } from '@/lib/lex/ksa';
import type { Settlement } from '@/lib/lex/settlements';
import { settlementMethodLabel, useSettlementLabels } from '../../_components/labels';
import { useSettlementDetailExtraLabels } from './detail-extra-labels';

export interface SettlementKeyFactsCardProps {
  settlement: Settlement;
  className?: string;
}

function formatMoney(
  f: LexFormatter,
  value: number | null | undefined,
  currency: string | null | undefined,
  placeholder: string,
): string {
  if (value === null || value === undefined) return placeholder;
  return f.formatCurrency(value, { currency: currency ?? 'SAR' }) || placeholder;
}

export function SettlementKeyFactsCard({ settlement, className }: SettlementKeyFactsCardProps) {
  const f = useLexFormat();
  const L = useSettlementLabels();
  const t = useSettlementDetailExtraLabels().keyFacts;
  const rounds = settlement.rounds ?? [];

  // Latest recorded offer = the highest round_number carrying a proposed value.
  const latestOffer = useMemo(() => {
    const valued = rounds.filter((r) => r.proposed_value != null);
    if (valued.length === 0) return null;
    return valued.reduce((a, b) => (b.round_number > a.round_number ? b : a));
  }, [rounds]);

  return (
    <SectionCard title={t.title} description={t.description} className={className} contentClassName="space-y-4">
      {/* Amount — the headline fact. */}
      <div className="rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
        <p className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
          {t.amount}
        </p>
        <p className="mt-0.5 text-h4 font-bold tabular-nums text-foreground" dir="auto">
          {formatMoney(f, settlement.value, settlement.currency, t.noValue)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact icon={Scale} label={t.method}>
          <Badge variant="outline" size="sm">
            {settlementMethodLabel(L, settlement.method)}
          </Badge>
        </Fact>
        <Fact icon={CheckCircle2} label={t.status}>
          <LexStatusChip
            value={settlement.status}
            domain="settlement"
            labels={L.filters.statusOptions}
            size="sm"
          />
        </Fact>
        <Fact icon={Handshake} label={t.rounds}>
          <span className="text-sm font-medium tabular-nums text-foreground">
            {f.formatNumber(rounds.length)}
          </span>
        </Fact>
        {latestOffer ? (
          <Fact icon={Handshake} label={t.latestOffer}>
            <span className="text-sm font-medium tabular-nums text-foreground" dir="auto">
              {formatMoney(f, latestOffer.proposed_value, latestOffer.currency ?? settlement.currency, t.noValue)}
            </span>
          </Fact>
        ) : null}
        {settlement.approved_at ? (
          <Fact icon={CalendarCheck2} label={t.approvedAt}>
            <span className="text-sm font-medium text-foreground" dir="auto">
              {f.formatDual(settlement.approved_at)}
            </span>
          </Fact>
        ) : null}
        {settlement.executed_at ? (
          <Fact icon={CalendarCheck2} label={t.executedAt}>
            <span className="text-sm font-medium text-foreground" dir="auto">
              {f.formatDual(settlement.executed_at)}
            </span>
          </Fact>
        ) : null}
      </dl>
    </SectionCard>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Scale;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="flex items-center gap-1.5 text-overline font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
