'use client';

/**
 * Cross-domain KPI strip for the Watheeq Legal-Affairs command center (`/lex`).
 *
 * A suite-wide headline row rendered as a balanced responsive grid of the
 * canonical {@link LexKpiStrip} primitive. Every card is a whole-tile link
 * into its domain and carries a semantic KPI theme:
 *
 *   Active contracts     → /lex/contracts            (primary)
 *   Open matters         → /lex/matters              (info)
 *   Overdue obligations  → /lex/obligations          (error)
 *   Pending approvals    → /lex/workflow-policies     (warning)
 *   SLA breaches         → /lex/service-desk/sla-board (error)
 *   Open alerts          → /lex/compliance           (warning)
 *
 * Values come from {@link useLexCommandKpis} (each field is `{ value, isLoading }`,
 * derived from the per-domain fail-soft fan-out + the shared dashboard fetch) so
 * no extra network round-trips are issued here. The hook exposes no delta/trend
 * series, so none is rendered. Counts render pre-formatted through
 * {@link useLexFormat} (tabular-nums + Arabic-Indic numerals under `dir="rtl"`).
 */

import {
  BarChart3,
  CalendarClock,
  FileText,
  ListChecks,
  Scale,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import { useLocale } from '@/components/providers/locale-provider';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { useAuth } from '@/hooks/use-auth';
import { canAccessWith, type PermissionRequirement } from '@/lib/permissions';
import { useLexFormat } from '@/lib/lex/ksa';

import { useLexLabels } from '../_lib/lex-i18n';
import {
  useLexCommandKpis,
  type CommandKpi,
  type LexCommandKpis,
} from '../_lib/use-lex-command-center';

type CommandKpiTheme = NonNullable<LexKpiItem['theme']>;

interface KpiTileSpec {
  key: keyof Pick<
    LexCommandKpis,
    | 'activeContracts'
    | 'openMatters'
    | 'overdueObligations'
    | 'pendingApprovals'
    | 'slaBreaches'
    | 'openAlerts'
  >;
  label: string;
  href: string;
  icon: LucideIcon;
  tone: CommandKpiTheme;
  permission: PermissionRequirement;
}

export function CrossDomainKpis() {
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const { overview: t } = useLexLabels();
  const kpis = useLexCommandKpis();
  const { hasPermission } = useAuth();

  const tiles: KpiTileSpec[] = [
    {
      key: 'activeContracts',
      label: t.commandKpis.activeContracts,
      href: '/lex/contracts',
      icon: FileText,
      tone: 'primary',
      permission: 'lex:contract:view',
    },
    {
      key: 'openMatters',
      label: t.commandKpis.openMatters,
      href: '/lex/matters',
      icon: Scale,
      tone: 'sky',
      permission: { anyOf: ['lex:case:view', 'lex:contract:view'] },
    },
    {
      key: 'overdueObligations',
      label: t.commandKpis.overdueObligations,
      href: '/lex/obligations',
      icon: ListChecks,
      tone: 'red',
      permission: 'lex:contract:view',
    },
    {
      key: 'pendingApprovals',
      label: t.commandKpis.pendingApprovals,
      href: '/lex/inbox',
      icon: CalendarClock,
      tone: 'amber',
      permission: { anyOf: ['lex:contract:approve', 'lex:contract:edit'] },
    },
    {
      key: 'slaBreaches',
      label: t.commandKpis.slaBreaches,
      href: '/lex/service-desk/sla-board',
      icon: BarChart3,
      tone: 'red',
      permission: 'lex:request:view',
    },
    {
      key: 'openAlerts',
      label: t.commandKpis.openAlerts,
      href: '/lex/compliance',
      icon: ShieldCheck,
      tone: 'amber',
      permission: 'lex:audit:read',
    },
  ];

  const items: LexKpiItem[] = tiles
    .filter((tile) => canAccessWith(hasPermission, tile.permission))
    .map((tile) => {
      const kpi: CommandKpi = kpis[tile.key];
      // A zero on a KPI whose semantic theme implies "bad" is actually a
      // healthy result. Inventory/info zeros remain neutral in meaning.
      const isGoodZero =
        !kpi.isLoading &&
        kpi.value === 0 &&
        (tile.tone === 'red' || tile.tone === 'amber');

      return {
        id: tile.key,
        label: tile.label,
        value: f.formatNumber(kpi.value),
        icon: tile.icon,
        theme: isGoodZero ? 'emerald' : tile.tone,
        href: tile.href,
        loading: kpi.isLoading,
      };
    });

  return (
    <div dir={direction} lang={locale}>
      <LexKpiStrip
        items={items}
        dir={direction}
        className="cross-domain-kpi-grid"
      />
    </div>
  );
}

export default CrossDomainKpis;
