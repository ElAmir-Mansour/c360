// Suite Catalog — static fallback mirroring docs/platform-admin-console.md §A.3
// (the canonical suite → service → entitlement map, sourced from the gateway
// route table backend/internal/gateway/config/routes.go:58-146).
//
// The live source of truth is the G13 gateway-routes endpoint
// (GET /api/v1/gateway/admin/routes, useGatewayRoutes). While that endpoint is
// unbuilt — or if it errors — the Suite Catalog screen falls back to this
// constant so the operator still sees the estate. Per §E.3 this carries a
// documented drift risk (the route map is a compiled Go slice with no read API).

import type { GatewayRoute, RouteContract } from '@/types/platform';

/**
 * Render a route contract as a short label. The gateway returns the contract as
 * a structured object {id, version, apiVersion, phase}; tolerate the legacy
 * bare-string form too. Returns undefined when absent. ALWAYS use this before
 * rendering a contract — rendering the raw object crashes React (error #31).
 */
export function formatRouteContract(
  contract: string | RouteContract | null | undefined,
): string | undefined {
  if (contract == null) return undefined;
  if (typeof contract === 'string') return contract.trim() || undefined;
  const version = [contract.apiVersion, contract.version].filter(Boolean).join(' · ');
  return version || contract.id || undefined;
}

/** A platform-billable suite/app (one row/card in the catalog). */
export interface SuiteDescriptor {
  /** Stable id (matches the entitlement key tail, e.g. "cyber"). */
  id: string;
  /** Display name shown in the UI (§A.3 "Suite (UI)" column). */
  name: string;
  /** Service binary that backs this suite (drives the fleet-health match). */
  service: string;
  /** Gateway route prefixes this suite owns. */
  prefixes: string[];
  /** Plan entitlement key — the key set/removed as an override (limit 0). */
  entitlement: string;
  /** Frontend section route, when the suite has a UI section. */
  section?: string;
  /** Suite grouping tag for the badge tone. */
  group?: string;
}

/**
 * The eight plan-gated suites/apps from §A.3. Only entries with an entitlement
 * key are billable suites the operator can enable/disable per tenant; the
 * platform-core services (gateway/iam/audit/license/file/workflow/notification/
 * automation) are intentionally omitted because they carry no entitlement and
 * are never per-tenant toggled.
 */
export const SUITE_CATALOG: SuiteDescriptor[] = [
  {
    id: 'cyber',
    name: 'Cyber',
    service: 'cyber-service',
    prefixes: ['/api/v1/cyber', '/api/v1/rca'],
    entitlement: 'suite.cyber',
    section: '/cyber',
    group: 'suite',
  },
  {
    id: 'siem',
    name: 'SIEM',
    service: 'siem-service',
    prefixes: ['/api/v1/siem'],
    entitlement: 'suite.siem',
    group: 'suite',
  },
  {
    id: 'data',
    name: 'Data',
    service: 'data-service',
    prefixes: ['/api/v1/data'],
    entitlement: 'suite.data',
    section: '/data',
    group: 'suite',
  },
  {
    id: 'acta',
    name: 'Acta',
    service: 'acta-service',
    prefixes: ['/api/v1/acta'],
    entitlement: 'app.acta',
    section: '/acta',
    group: 'app',
  },
  {
    id: 'watheeq',
    name: 'Watheeq / Lex',
    service: 'lex-service',
    prefixes: ['/api/v1/watheeq', '/api/v1/lex'],
    entitlement: 'app.watheeq',
    section: '/lex',
    group: 'app',
  },
  {
    id: 'bosalah',
    name: 'Visus / BOSALAH',
    service: 'visus-service',
    prefixes: ['/api/v1/visus'],
    entitlement: 'app.bosalah',
    section: '/visus',
    group: 'app',
  },
  {
    id: 'datastream',
    name: 'ClarioDR',
    service: 'clario-dr-service',
    prefixes: ['/api/v1/dr'],
    entitlement: 'suite.datastream',
    section: '/dr',
    group: 'suite',
  },
];

/**
 * Derive the suite catalog from the live gateway route map (G13). Routes are
 * grouped by entitlement key; only routes that carry an entitlement are
 * platform suites. Falls back to {@link SUITE_CATALOG} when the route list is
 * empty so the screen always renders a usable catalog.
 */
export function deriveCatalogFromRoutes(
  routes: GatewayRoute[] | undefined,
): SuiteDescriptor[] {
  if (!routes || routes.length === 0) return SUITE_CATALOG;

  const byEntitlement = new Map<string, SuiteDescriptor>();
  for (const r of routes) {
    if (!r.entitlement) continue; // platform-core route, not a billable suite
    const existing = byEntitlement.get(r.entitlement);
    if (existing) {
      if (!existing.prefixes.includes(r.prefix)) existing.prefixes.push(r.prefix);
      continue;
    }
    // Seed display metadata from the static table when we recognise the key,
    // otherwise synthesise a reasonable descriptor from the route fields.
    const seed = SUITE_CATALOG.find((s) => s.entitlement === r.entitlement);
    byEntitlement.set(r.entitlement, {
      id: seed?.id ?? r.entitlement.split('.').pop() ?? r.entitlement,
      name: seed?.name ?? r.service ?? r.entitlement,
      service: r.service ?? seed?.service ?? '',
      prefixes: [r.prefix],
      entitlement: r.entitlement,
      section: seed?.section,
      group: r.group ?? seed?.group,
    });
  }

  const derived = Array.from(byEntitlement.values());
  return derived.length > 0 ? derived : SUITE_CATALOG;
}

/** Look up the route contract/version for a suite from the live route map. */
export function contractForSuite(
  suite: SuiteDescriptor,
  routes: GatewayRoute[] | undefined,
): string | undefined {
  if (!routes) return undefined;
  const match = routes.find((r) => r.entitlement === suite.entitlement && r.contract);
  return formatRouteContract(match?.contract);
}
