'use client';

import { useLegalDirectorDashboardLabels } from '../../../_lib/role-dashboards/legal-director-i18n';
import { DashboardPrimitiveState } from './dashboard-primitive-state';
import {
  DomainTile,
  DomainTileSkeleton,
  type DomainTile as DomainTileRecord,
} from './domain-tile';
import { PanelShell } from './panel-shell';
import styles from './legal-domains-grid.module.css';

export interface LegalDomainsGridProps {
  domains: DomainTileRecord[];
}

export interface LegalDomainsGridErrorProps {
  onRetry: () => void;
}

const GRID_CLASS =
  `grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 ${styles.grid}`;
const LOADING_TILE_COUNT = 18;

const LEGAL_DOMAIN_ORDER = [
  'litigation_cases',
  'service_desk',
  'matters',
  'consultations',
  'investigations',
  'settlements',
  'contracts',
  'obligations',
  'documents',
  'clause_library',
  'playbooks',
  'regulations',
  'signatures',
  'workflow_policies',
  'compliance',
  'drafting',
  'reports',
  'admin',
] as const;

const LEGAL_DOMAIN_RANK = new Map<string, number>(
  LEGAL_DOMAIN_ORDER.map((key, index) => [key, index]),
);

function inApprovedDomainOrder(domains: DomainTileRecord[]): DomainTileRecord[] {
  return domains
    .map((tile, inputIndex) => ({ tile, inputIndex }))
    .sort((a, b) => {
      const aRank = LEGAL_DOMAIN_RANK.get(a.tile.key);
      const bRank = LEGAL_DOMAIN_RANK.get(b.tile.key);

      if (aRank === undefined && bRank === undefined) {
        return a.inputIndex - b.inputIndex;
      }
      if (aRank === undefined) return 1;
      if (bRank === undefined) return -1;
      return aRank - bRank;
    })
    .map(({ tile }) => tile);
}

/**
 * Presentation-only Legal Domains composition. Known stable keys follow the
 * fixed §4.6 order; unknown records follow in their original relative order.
 * Labels, routes, tints, counts, and missing entries are never derived.
 */
export function LegalDomainsGrid({ domains }: LegalDomainsGridProps) {
  const labels = useLegalDirectorDashboardLabels();
  const orderedDomains = inApprovedDomainOrder(domains);

  return (
    <PanelShell title={labels.panels.legalDomains}>
      {domains.length === 0 ? (
        <DashboardPrimitiveState
          state="empty"
          title={labels.states.legalDomains.empty}
        />
      ) : (
        <div className={GRID_CLASS} data-legal-domains-grid="">
          {orderedDomains.map((tile, index) => (
            <DomainTile key={`${tile.key}:${index}`} tile={tile} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

/** Responsive grid-shaped loading companion. */
export function LegalDomainsGridLoading() {
  const labels = useLegalDirectorDashboardLabels();

  return (
    <PanelShell title={labels.panels.legalDomains}>
      <div
        role="status"
        aria-label={labels.states.legalDomains.loading}
        aria-busy="true"
      >
        <div className={GRID_CLASS} aria-hidden="true">
          {Array.from({ length: LOADING_TILE_COUNT }, (_, index) => (
            <DomainTileSkeleton
              key={index}
              label={labels.states.legalDomains.loading}
            />
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

/** Retryable error companion. */
export function LegalDomainsGridError({ onRetry }: LegalDomainsGridErrorProps) {
  const labels = useLegalDirectorDashboardLabels();

  return (
    <PanelShell title={labels.panels.legalDomains}>
      <DashboardPrimitiveState
        state="error"
        title={labels.states.legalDomains.error}
        retryLabel={labels.actions.retry}
        onRetry={onRetry}
      />
    </PanelShell>
  );
}
