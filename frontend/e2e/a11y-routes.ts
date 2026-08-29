/* ==================================================================
 *  Canonical authed a11y route list — every major section of the app
 *  (each suite's landing page + its 2-3 key working pages), enumerated
 *  from src/app. Consumed by:
 *    - e2e/a11y-broad.spec.ts  (the WCAG 2.1 AA gate, `npm run test:a11y`)
 *    - e2e/axe-param.spec.ts   (fallback when A11Y_ROUTES is not set)
 *  Static routes only — dynamic [id] detail pages need seeded fixtures
 *  and are exercised by the per-suite functional specs instead.
 * ================================================================== */

export const A11Y_ROUTES: string[] = [
  // ---- platform home + suite launcher ----
  '/platform',
  '/dashboard',

  // ---- lex (Watheeq legal suite) ----
  '/lex',
  '/lex/contracts',
  '/lex/cases',
  '/lex/matters',
  '/lex/service-desk',
  '/lex/investigations',
  '/lex/investigations/fraud',
  '/lex/investigations/compliance',
  '/lex/investigations/forensics',
  '/lex/investigations/board-review',
  '/lex/calendar',
  '/lex/inbox',
  '/lex/analytics',
  '/lex/reports',
  '/lex/knowledge-hub',
  '/lex/clause-library',
  '/lex/playbooks',
  '/lex/policies',
  '/lex/learning-centre',
  '/lex/admin/integrations',

  // ---- cyber core ----
  '/cyber',
  '/cyber/alerts',
  '/cyber/assets',
  '/cyber/threats',
  '/cyber/indicators',
  '/cyber/detection-rules',
  '/cyber/remediation',
  '/cyber/risk-heatmap',
  '/cyber/siem',

  // ---- cyber sub-suites (dspm / cti / ctem / ueba / vciso) ----
  '/cyber/dspm',
  '/cyber/dspm/assets',
  '/cyber/dspm/compliance',
  '/cyber/cti',
  '/cyber/cti/actors',
  '/cyber/ctem',
  '/cyber/ueba',
  '/cyber/vciso',
  '/cyber/vciso/risk-register',
  '/cyber/vciso/compliance',

  // ---- acta (meetings & committees) ----
  '/acta',
  '/acta/meetings',
  '/acta/committees',
  '/acta/action-items',

  // ---- data (sources / pipelines / models) ----
  '/data',
  '/data/sources',
  '/data/pipelines',
  '/data/models',

  // ---- dr (ClarioDR) ----
  '/dr',
  '/dr/runbooks',
  '/dr/readiness',
  '/dr/topology',

  // ---- migrate ----
  '/migrate',
  '/migrate/waves',
  '/migrate/cutovers',
  '/migrate/portfolio',

  // ---- recover ----
  '/recover',
  '/recover/it-dr',
  '/recover/cloud-dr',
  '/recover/cyber-recovery',

  // ---- respond ----
  '/respond',
  '/respond/incidents',

  // ---- visus (dashboards & KPIs) ----
  '/visus',
  '/visus/dashboards',
  '/visus/kpis',
  '/visus/reports',

  // ---- tenant workflows ----
  '/workflows',
  '/workflows/tasks',
  '/workflows/definitions',

  // ---- tenant admin ----
  '/admin',
  '/admin/users',
  '/admin/roles',
  '/admin/audit',
  '/admin/billing',
  '/admin/tenants',
  '/admin/integrations',
  '/admin/automation',
  '/admin/notifications',
  '/admin/ai-governance',
  '/admin/workflows/tasks',
  '/admin/workflows/definitions',

  // ---- platform console (cross-tenant super-admin) ----
  '/console/platform',
  '/console/platform/tenants',
  '/console/platform/licensing',
  '/console/platform/pricing',

  // ---- shared authed surfaces ----
  '/notifications',
  '/settings',
  '/files',
  '/notebooks',
];
