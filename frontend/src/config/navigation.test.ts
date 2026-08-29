import { describe, it, expect } from 'vitest';
import {
  navigation,
  collectNavBadgeConfigs,
  filterNavItems,
  filterSectionsForRoute,
  SUITE_ROUTE_SEGMENTS,
  type NavSection,
} from './navigation';

const ids = (sections: ReturnType<typeof filterSectionsForRoute>) => sections.map((s) => s.id);
const WORKFLOW_TASK_COUNT_ENDPOINT = '/api/v1/workflows/tasks/count';

/**
 * The Watheeq (Lex) suite renders as SEVEN lex-scoped group sections (the
 * 81894f07 sub-grouping + the brand re-org IA) instead of the old single flat
 * `lex` section. Listed in sidebar order.
 */
const LEX_GROUP_IDS = [
  'lex-home',
  'lex-service-desk-group',
  'lex-cases-group',
  'lex-contracts-group',
  'lex-knowledge-group',
  'lex-insights-group',
  'lex-admin-group',
];

/** Route segment a section belongs to (mirror of the private sectionRouteSegment). */
const routeSegmentOf = (section: NavSection): string =>
  (section.items[0]?.href ?? '').split('/').filter(Boolean)[0] ?? '';

describe('filterSectionsForRoute (per-suite sidebar)', () => {
  it('shows only the active suite plus global sections inside a suite', () => {
    const result = ids(filterSectionsForRoute(navigation, '/lex'));
    // active suite (every Watheeq group section) + globals
    expect(result).toEqual(expect.arrayContaining(LEX_GROUP_IDS));
    expect(result).toContain('main');
    expect(result).toContain('administration');
    // other suites hidden
    expect(result).not.toContain('security-operations');
    expect(result).not.toContain('data-intelligence');
    expect(result).not.toContain('visus');
    expect(result).not.toContain('acta');
    expect(result).not.toContain('respond-command');
  });

  it('keeps every cyber section on a cyber sub-route', () => {
    const result = ids(filterSectionsForRoute(navigation, '/cyber/alerts'));
    expect(result).toEqual(
      expect.arrayContaining(['main', 'security-operations', 'cyber-cti', 'cyber-programs', 'administration']),
    );
    // no Watheeq group section leaks into the cyber sidebar
    expect(result.filter((id) => id.startsWith('lex-'))).toEqual([]);
  });

  it('shows the full nav (hub) on non-suite routes', () => {
    const all = ids(navigation);
    expect(ids(filterSectionsForRoute(navigation, '/dashboard'))).toEqual(all);
    expect(ids(filterSectionsForRoute(navigation, '/admin/users'))).toEqual(all);
  });

  it('treats null/empty pathname as the hub', () => {
    expect(filterSectionsForRoute(navigation, null)).toHaveLength(navigation.length);
    expect(filterSectionsForRoute(navigation, '/')).toHaveLength(navigation.length);
  });
});

describe('workflow navigation permissions', () => {
  const workspace = navigation.find((section) => section.id === 'workspace');
  const workflows = workspace?.items.find((item) => item.id === 'admin-workflows');
  const visibleWorkspaceItems = (permissions: readonly string[]) => {
    const allowed = new Set(permissions);
    return filterNavItems(workspace?.items ?? [], (permission) => allowed.has(permission));
  };
  const badgeEndpoints = (items: ReturnType<typeof filterNavItems>, permissions: readonly string[]) => {
    const allowed = new Set(permissions);
    return collectNavBadgeConfigs(items, (permission) => allowed.has(permission)).map(
      (config) => config.endpoint,
    );
  };

  it('shows the shared workflow workspace to users with no permissions at all', () => {
    const visible = visibleWorkspaceItems([]);
    const visibleWorkflow = visible.find((item) => item.id === 'admin-workflows');

    expect(visibleWorkflow?.children?.map((item) => item.id)).toEqual([
      'workflows-my-tasks',
      'workflows-definitions-browse',
    ]);
    expect(badgeEndpoints(visible, []).filter(
      (endpoint) => endpoint === WORKFLOW_TASK_COUNT_ENDPOINT,
    )).toHaveLength(1);
  });

  it('adds Automation Engine to the shared workspace for automation-only users', () => {
    const visible = visibleWorkspaceItems(['automation:read']);
    const visibleWorkflow = visible.find((item) => item.id === 'admin-workflows');

    expect(visibleWorkflow?.children?.map((item) => item.id)).toEqual([
      'workflows-my-tasks',
      'workflows-definitions-browse',
      'admin-automation-engine',
    ]);
    expect(badgeEndpoints(visible, ['automation:read']).filter(
      (endpoint) => endpoint === WORKFLOW_TASK_COUNT_ENDPOINT,
    )).toHaveLength(1);
  });

  it('shows shared workflow links and task-count badges to Watheeq personas', () => {
    const visible = visibleWorkspaceItems(['lex:case:view']);
    const visibleWorkflow = visible.find((item) => item.id === 'admin-workflows');

    expect(visibleWorkflow?.children?.map((item) => item.id)).toEqual([
      'workflows-my-tasks',
      'workflows-definitions-browse',
    ]);
    expect(badgeEndpoints(visible, ['lex:case:view']).filter(
      (endpoint) => endpoint === WORKFLOW_TASK_COUNT_ENDPOINT,
    )).toHaveLength(1);
  });

  it('shows shared workflow links to legacy Watheeq users with only lex:read', () => {
    const visible = visibleWorkspaceItems(['lex:read']);
    const visibleWorkflow = visible.find((item) => item.id === 'admin-workflows');

    expect(visibleWorkflow?.children?.map((item) => item.id)).toEqual([
      'workflows-my-tasks',
      'workflows-definitions-browse',
    ]);
  });

  it('keeps the shared workflow workspace and task-count badge for unrelated suite users', () => {
    const visible = visibleWorkspaceItems(['cyber:read']);
    const visibleWorkflow = visible.find((item) => item.id === 'admin-workflows');

    expect(visibleWorkflow?.children?.map((item) => item.id)).toEqual([
      'workflows-my-tasks',
      'workflows-definitions-browse',
    ]);
    expect(badgeEndpoints(visible, ['cyber:read']).filter(
      (endpoint) => endpoint === WORKFLOW_TASK_COUNT_ENDPOINT,
    )).toHaveLength(1);
  });

  it('collects the workflow task-count badge only once for workflow readers', () => {
    const visible = visibleWorkspaceItems(['workflow:read']);
    const endpoints = badgeEndpoints(visible, ['workflow:read']);

    expect(endpoints.filter((endpoint) => endpoint === WORKFLOW_TASK_COUNT_ENDPOINT)).toHaveLength(1);
  });

  it('shows only shared workflow links to workflow readers without authoring rights', () => {
    const visible = visibleWorkspaceItems(['workflow:read']);
    const visibleWorkflow = visible.find((item) => item.id === 'admin-workflows');

    expect(visibleWorkflow?.children?.map((item) => item.id)).toEqual([
      'workflows-my-tasks',
      'workflows-definitions-browse',
    ]);
  });

  it('requires workflow:write for workflow admin navigation', () => {
    expect(workflows?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'admin-workflow-tasks', permission: 'workflow:write' }),
        expect.objectContaining({ id: 'admin-workflow-instances', permission: 'workflow:write' }),
        expect.objectContaining({ id: 'admin-workflow-definitions', permission: 'workflow:write' }),
        expect.objectContaining({ id: 'admin-workflow-templates', permission: 'workflow:write' }),
        expect.objectContaining({ id: 'admin-workflow-forms', permission: 'workflow:write' }),
        expect.objectContaining({ id: 'admin-workflow-operations', permission: 'workflow:write' }),
        expect.objectContaining({ id: 'admin-workflow-analytics', permission: 'workflow:write' }),
      ]),
    );
  });

  it('shows workflow admin navigation to workflow authors', () => {
    const visible = visibleWorkspaceItems(['workflow:read', 'workflow:write']);
    const visibleWorkflow = visible.find((item) => item.id === 'admin-workflows');

    expect(visibleWorkflow?.children?.map((item) => item.id)).toEqual([
      'workflows-my-tasks',
      'workflows-definitions-browse',
      'admin-workflow-tasks',
      'admin-workflow-instances',
      'admin-workflow-definitions',
      'admin-workflow-templates',
      'admin-workflow-forms',
      'admin-workflow-operations',
      'admin-workflow-analytics',
    ]);
  });

  it('keeps the shared workspace entries and their task-count badges ungated', () => {
    expect(workflows?.permission).toBeUndefined();
    expect(workflows?.badge).toEqual(
      expect.objectContaining({ endpoint: WORKFLOW_TASK_COUNT_ENDPOINT }),
    );
    expect(workflows?.badge?.permission).toBeUndefined();

    const myTasks = workflows?.children?.find((item) => item.id === 'workflows-my-tasks');
    expect(myTasks?.permission).toBeUndefined();
    expect(myTasks?.badge).toEqual(
      expect.objectContaining({ endpoint: WORKFLOW_TASK_COUNT_ENDPOINT }),
    );
    expect(myTasks?.badge?.permission).toBeUndefined();

    const browse = workflows?.children?.find((item) => item.id === 'workflows-definitions-browse');
    expect(browse).toBeDefined();
    expect(browse?.permission).toBeUndefined();
  });
});

describe('resilience suite navigation (Wave E)', () => {
  // ClarioDR is now grouped into three lifecycle sections (Operations / Lifecycle
  // / Infrastructure) instead of one flat section — all still scoped to /dr.
  const drSectionIds = [
    'resilience-operations',
    'resilience-lifecycle',
    'resilience-infrastructure',
  ];
  const drSections = navigation.filter((section) => drSectionIds.includes(section.id));
  const drItems = drSections.flatMap((section) => section.items);

  it('mounts the three grouped resilience sections', () => {
    expect(drSections.map((s) => s.id)).toEqual(expect.arrayContaining(drSectionIds));
  });

  it('exposes the Topology and Runbooks routes under dr:read (Infrastructure group)', () => {
    const infra = navigation.find((section) => section.id === 'resilience-infrastructure');
    const items = infra?.items ?? [];

    const topology = items.find((item) => item.id === 'dr-topology');
    expect(topology).toEqual(
      expect.objectContaining({ label: 'Topology', href: '/dr/topology', permission: 'dr:read' }),
    );

    const runbooks = items.find((item) => item.id === 'dr-runbooks');
    expect(runbooks).toEqual(
      expect.objectContaining({ label: 'Runbooks', href: '/recover/it-dr/runbooks', permission: 'dr:read' }),
    );
  });

  it('groups the lifecycle stages and points Recover lifecycle pages at canonical Recover routes', () => {
    const lifecycle = navigation.find((section) => section.id === 'resilience-lifecycle');
    expect((lifecycle?.items ?? []).map((item) => item.id)).toEqual([
      'dr-protect',
      'dr-recover',
      'dr-rehearse',
      'dr-prove',
      'dr-readiness',
    ]);
    expect((lifecycle?.items ?? []).find((item) => item.id === 'dr-recover')?.href).toBe(
      '/recover/it-dr/recover',
    );
    expect((lifecycle?.items ?? []).find((item) => item.id === 'dr-rehearse')?.href).toBe(
      '/recover/it-dr/rehearse',
    );
    expect((lifecycle?.items ?? []).find((item) => item.id === 'dr-prove')?.href).toBe(
      '/recover/it-dr/prove',
    );
  });

  it('keeps every DR route reachable across the three groups', () => {
    expect(drItems.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'dr-overview',
        'dr-approvals',
        'dr-insights',
        'dr-protect',
        'dr-recover',
        'dr-rehearse',
        'dr-prove',
        'dr-readiness',
        'dr-topology',
        'dr-runbooks',
        'dr-integrations',
      ]),
    );
  });

  it('keeps the resilience sections visible inside the runbooks/topology sub-routes', () => {
    expect(ids(filterSectionsForRoute(navigation, '/recover/it-dr/runbooks'))).toEqual(
      expect.arrayContaining(drSectionIds),
    );
    expect(ids(filterSectionsForRoute(navigation, '/dr/topology'))).toEqual(
      expect.arrayContaining(drSectionIds),
    );
    // other suites stay hidden inside the DR suite
    expect(
      ids(filterSectionsForRoute(navigation, '/recover/it-dr/runbooks')).filter((id) =>
        id.startsWith('lex-'),
      ),
    ).toEqual([]);
  });
});

describe('respond suite navigation', () => {
  const respond = navigation.find((section) => section.id === 'respond-command');

  it('registers Respond as a suite-scoped command section', () => {
    expect(respond).toEqual(
      expect.objectContaining({
        label: 'Respond · Command',
        permission: 'respond:incident:read',
      }),
    );
  });

  it('exposes the product overview and incident queue under the Respond entitlement', () => {
    expect((respond?.items ?? []).map((item) => item.id)).toEqual([
      'respond-overview',
      'respond-incidents',
    ]);
    expect(respond?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/respond',
          permission: 'respond:incident:read',
        }),
        expect.objectContaining({
          href: '/respond/incidents',
          permission: 'respond:incident:read',
        }),
      ]),
    );
  });

  it('keeps Respond navigation isolated inside Respond routes', () => {
    const result = ids(filterSectionsForRoute(navigation, '/respond/incidents/INC-2026-0001'));

    expect(result).toContain('main');
    expect(result).toContain('respond-command');
    expect(result).toContain('administration');
    expect(result).not.toContain('security-operations');
    expect(result).not.toContain('resilience-operations');
    expect(result.filter((id) => id.startsWith('lex-'))).toEqual([]);
  });
});

describe('legal-affairs navigation usability (CAP-187..189)', () => {
  // The Watheeq sidebar is sub-grouped into seven lex-scoped category sections
  // (Legal Service Desk / Cases & Investigations / Contracts & Consultations /
  // Documents / Insights / Administration plus the header-less landing group).
  // The CAP intents are unchanged: simple domain-grouped IA (187), shallow
  // /lex reachability (188), and suite isolation inside /lex routes (189).
  const lexGroups = navigation.filter((section) => LEX_GROUP_IDS.includes(section.id));
  const lexItems = lexGroups.flatMap((section) => section.items);
  const allLexNavEntries = lexItems.flatMap((item) => [item, ...(item.children ?? [])]);

  it('keeps the legal-affairs interface simple by exposing the workbook domains from grouped Watheeq suite sections (CAP-187)', () => {
    // All seven groups exist, in sidebar order — and they are the ONLY lex-*
    // sections, each scoped to the /lex suite on the Business+ tier so
    // filterSectionsForRoute presents them together as one suite.
    expect(navigation.filter((s) => s.id.startsWith('lex-')).map((s) => s.id)).toEqual(
      LEX_GROUP_IDS,
    );
    for (const section of lexGroups) {
      expect(section.tier).toBe('business-plus');
      expect(section.items.length).toBeGreaterThan(0);
      expect(routeSegmentOf(section)).toBe('lex');
      expect(
        section.items.every((item) => item.href === '/lex' || item.href.startsWith('/lex/')),
      ).toBe(true);
    }

    // Together the groups expose the legal-affairs workbook domains…
    expect(lexItems.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'lex-overview',
        'lex-service-desk',
        'lex-service-desk-new',
        'lex-cases',
        'lex-investigations',
        'lex-settlements',
        'lex-case-timeline',
        'lex-contracts',
        'lex-drafting',
        'lex-signatures',
        'lex-consultations',
        'lex-clause-library',
        'lex-playbooks',
        'lex-documents',
        'lex-reports',
        'lex-analytics',
        'lex-workflow-policies',
        'lex-admin',
      ]),
    );
    // …and stay easy to scan: every route appears in exactly one group.
    const hrefs = lexItems.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('keeps every legal-affairs route mobile-reachable through shallow /lex paths (CAP-188)', () => {
    // Walk EVERY item across all lex group sections (admin children included).
    const hrefs = allLexNavEntries.map((item) => item.href);

    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => href === '/lex' || href.startsWith('/lex/'))).toBe(true);
    expect(hrefs).toEqual(expect.arrayContaining(['/lex/service-desk/new', '/lex/reports/analytics']));

    const adminChildren = lexItems.find((item) => item.id === 'lex-admin')?.children ?? [];
    expect(adminChildren.map((item) => item.href)).toEqual(
      expect.arrayContaining([
        '/lex/admin/working-calendars',
        '/lex/admin/service-catalog',
        '/lex/admin/sla-targets',
        '/lex/admin/attachment-policies',
        '/lex/admin/org-entities',
        '/lex/admin/classifications',
      ]),
    );
  });

  it('keeps legal-affairs navigation isolated and easy to scan inside Lex routes (CAP-189)', () => {
    const result = filterSectionsForRoute(navigation, '/lex/service-desk/new');
    const resultIds = ids(result);

    // every Watheeq group survives (asserted via the lex-* section-id prefix)…
    expect(resultIds.filter((id) => id.startsWith('lex-'))).toEqual(LEX_GROUP_IDS);
    // …alongside the global sections
    expect(resultIds).toContain('main');
    expect(resultIds).toContain('administration');
    // …and every surviving SUITE-scoped section belongs to the lex suite — no
    // foreign suite section leaks into the Watheeq sidebar.
    const suiteSegments = SUITE_ROUTE_SEGMENTS as readonly string[];
    for (const section of result) {
      const segment = routeSegmentOf(section);
      if (suiteSegments.includes(segment)) expect(segment).toBe('lex');
    }
    expect(resultIds).not.toContain('security-operations');
    expect(resultIds).not.toContain('data-intelligence');
    expect(resultIds).not.toContain('resilience-operations');
    expect(resultIds).not.toContain('resilience-lifecycle');
    expect(resultIds).not.toContain('resilience-infrastructure');
    expect(resultIds).not.toContain('respond-command');
    expect(resultIds).not.toContain('acta');
    expect(resultIds).not.toContain('visus');
  });
});
