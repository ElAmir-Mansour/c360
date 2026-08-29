import { KPI_CATALOG } from '../../_lib/role-dashboards/registry';
import type { KpiKey } from '../../_lib/role-dashboards/use-role-dashboard-data';

/**
 * Central route map for dashboard aggregates. Keeping these destinations in
 * one module prevents the bespoke Legal Director charts and the registry-based
 * role dashboards from drifting to different registers for the same metric.
 */
export function kpiDrilldownHref(key: KpiKey): string {
  return KPI_CATALOG[key].href;
}

export function serviceDistributionHref(key: string): string {
  switch (key) {
    case 'contracts':
      return '/lex/contracts';
    case 'consultations':
      return '/lex/consultations';
    case 'litigations':
      return '/lex/cases';
    case 'investigation':
    case 'investigations':
      return '/lex/investigations';
    case 'others':
    case 'other':
      return '/lex/reports/analytics';
    default:
      return '/lex/service-desk';
  }
}

export function workloadDrilldownHref(key: string): string {
  switch (key) {
    case 'sla':
      return '/lex/service-desk/sla-board';
    case 'obligations':
      return '/lex/obligations';
    case 'approvals':
      return '/lex/inbox';
    case 'renewals':
      return '/lex/contracts';
    case 'hearings':
      return '/lex/calendar';
    case 'alerts':
      return '/lex/compliance';
    default:
      return '/lex/reports/analytics';
  }
}

export function resolutionDrilldownHref(key: string): string {
  const normalized = key.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized.includes('contract')) return '/lex/contracts';
  if (normalized.includes('consult')) return '/lex/consultations';
  if (normalized.includes('investigat')) return '/lex/investigations';
  if (normalized.includes('litigat') || normalized.includes('case')) return '/lex/cases';
  if (normalized.includes('matter')) return '/lex/matters';
  if (normalized.includes('settlement')) return '/lex/settlements';
  if (normalized.includes('obligation')) return '/lex/obligations';
  if (normalized.includes('request') || normalized.includes('service')) {
    return '/lex/service-desk';
  }
  return '/lex/reports/analytics';
}

export function contractStatusDrilldownHref(status: string): string {
  return `/lex/contracts?status=${encodeURIComponent(status)}`;
}

export function escalationDrilldownHref(severity: string): string {
  return `/lex/inbox?severity=${encodeURIComponent(severity)}`;
}

export function workforceDomainHref(domain: string): string {
  switch (domain) {
    case 'contracts':
    case 'contract_intakes':
      return '/lex/contracts';
    case 'matters':
      return '/lex/matters';
    case 'obligations':
      return '/lex/obligations';
    case 'consultations':
      return '/lex/consultations';
    case 'cases':
      return '/lex/cases';
    case 'requests':
      return '/lex/service-desk';
    case 'support':
      return '/lex/inbox';
    default:
      return '/lex/reports/analytics';
  }
}
