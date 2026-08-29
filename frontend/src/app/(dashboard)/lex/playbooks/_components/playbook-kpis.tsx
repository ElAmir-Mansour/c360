'use client';

import { BookOpenCheck, CheckCircle2, Gauge, ListChecks, ShieldAlert, ShieldCheck } from 'lucide-react';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { usePlaybookLabels } from './labels';

/**
 * The headline metrics for the playbook surface, rendered through the shared
 * premium {@link LexKpiStrip} (toned tiles, icon chips, glow, KSA-localized
 * numbers). Presentational only — the page owns the data fetches and passes a
 * precomputed {@link PlaybookKpiSummary} that blends the playbook catalog totals
 * with the cross-portfolio compliance signal (avg score + needs-review count).
 */
export interface PlaybookKpiSummary {
  total: number;
  activeCount: number;
  standardClauses: number;
  requiredClauses: number;
  /** Mean compliance score (0–100) across all scored contracts, or null when none. */
  avgCompliance: number | null;
  /** Contracts scoring below the 80% review threshold. */
  needsReviewCount: number;
}

interface PlaybookKpisProps {
  summary: PlaybookKpiSummary;
  loading: boolean;
  /** Compliance signal is loaded separately; tile shows its own shimmer. */
  complianceLoading?: boolean;
  /** Deep-link target for the needs-review / compliance tiles. */
  portfolioHref: string;
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function PlaybookKpis({ summary, loading, complianceLoading = false, portfolioHref }: PlaybookKpisProps) {
  const labels = usePlaybookLabels();
  const k = labels.kpis;

  const avg = summary.avgCompliance;
  const avgTheme = avg == null ? 'sky' : avg < 60 ? 'red' : avg < 85 ? 'amber' : 'emerald';
  const activeShare = percent(summary.activeCount, summary.total);

  const items: LexKpiItem[] = [
    {
      id: 'playbooks',
      label: k.playbooks,
      value: summary.total,
      icon: BookOpenCheck,
      theme: 'primary',
      loading,
      description: labels.catalog.description,
      detail: k.playbooks,
      detailValue: summary.total,
      href: '/lex/playbooks#playbook-catalog',
    },
    {
      id: 'active',
      label: k.active,
      value: summary.activeCount,
      icon: CheckCircle2,
      theme: 'emerald',
      loading,
      description: k.active,
      progress: activeShare,
      progressLabel: k.playbooks,
      detail: k.playbooks,
      detailValue: `${activeShare}%`,
      href: '/lex/playbooks#playbook-catalog',
    },
    {
      id: 'standard-clauses',
      label: k.standardClauses,
      value: summary.standardClauses,
      icon: ListChecks,
      theme: 'teal',
      loading,
      description: k.standardClauses,
      detail: k.playbooks,
      detailValue: summary.total,
      href: '/lex/playbooks#playbook-catalog',
    },
    {
      id: 'required-clauses',
      label: k.requiredClauses,
      value: summary.requiredClauses,
      icon: ShieldCheck,
      theme: 'primary',
      loading,
      description: k.requiredClauses,
      detail: k.standardClauses,
      detailValue: summary.standardClauses,
      href: '/lex/playbooks#playbook-catalog',
    },
    {
      id: 'avg-compliance',
      label: k.avgCompliance,
      value: avg == null ? '—' : avg,
      unit: avg == null ? undefined : '%',
      icon: Gauge,
      theme: avgTheme,
      href: portfolioHref,
      loading: complianceLoading,
      description: k.avgCompliance,
      progress: avg ?? undefined,
      progressLabel: k.avgCompliance,
      detail: k.needsReview,
      detailValue: summary.needsReviewCount,
    },
    {
      id: 'needs-review',
      label: k.needsReview,
      value: summary.needsReviewCount,
      icon: ShieldAlert,
      theme: summary.needsReviewCount > 0 ? 'amber' : 'green',
      href: portfolioHref,
      loading: complianceLoading,
      description: k.needsReviewHint,
      detail: k.avgCompliance,
      detailValue: avg == null ? '—' : `${avg}%`,
    },
  ];

  return <LexKpiStrip items={items} columns={6} />;
}
