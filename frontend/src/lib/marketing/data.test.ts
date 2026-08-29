import { describe, expect, it } from 'vitest';
import {
  MARKETING_APP_ROUTE_PARAMS,
  MARKETING_APPS,
  MARKETING_BRAND_TOKENS,
  MARKETING_NAVIGATION,
  MARKETING_JSON_LD,
  MARKETING_LEAD_ENDPOINT_STATUS,
  MARKETING_OG_IMAGE_PATH,
  MARKETING_SOURCE,
  MARKETING_STATIC_ROUTES,
  MARKETING_SUITE_ROUTE_PARAMS,
  MARKETING_VIEWPORT,
  MARKETING_SUITES,
  PLATFORM_ENGINE_DETAILS,
  PLATFORM_ENGINE_ROUTE_PARAMS,
  PLATFORM_ENGINES,
  createMarketingMetadata,
  createLeadSubmissionFromFormData,
  formatMarketingMoney,
  getMarketingApp,
  getMarketingAppPath,
  getMarketingAppRouteParamsForSuite,
  getMarketingPublicRoutes,
  getMarketingSuitePath,
  getPlatformEngine,
  getPlatformEngineDetail,
  getPlatformEnginePath,
  getSuiteConfigurationSummary,
  roiCompute,
} from '.';

function expectUnique(values: readonly string[]) {
  expect(new Set(values).size).toBe(values.length);
}

describe('marketing source data', () => {
  it('pins the extracted source artifact', () => {
    expect(MARKETING_SOURCE).toEqual({
      file: 'clario360-website (2).html',
      sha256: 'd039b932cae44bf1360ab1680f993b395b952971841e527c591a2d138c2e2fa5',
    });
  });

  it('preserves the approved four-suite taxonomy and app counts', () => {
    expect(
      MARKETING_SUITES.map((suite) => ({
        id: suite.id,
        name: suite.name,
        family: suite.family,
        appCount: suite.apps.length,
      })),
    ).toEqual([
      { id: 'datastream', name: 'DataStream Suite', family: 'ds', appCount: 4 },
      { id: 'business-plus', name: 'Business+ Suite', family: 'bp', appCount: 5 },
      { id: 'clariosec', name: 'ClarioSec', family: 'sec', appCount: 4 },
      { id: 'clarioinsight', name: 'ClarioInsight', family: 'insight', appCount: 2 },
    ]);
    expect(MARKETING_APPS).toHaveLength(15);
    expectUnique(MARKETING_SUITES.map((suite) => suite.id));
    expectUnique(MARKETING_APPS.map((app) => app.id));
  });

  it('keeps Acta under Business+', () => {
    expect(getMarketingApp('acta')).toMatchObject({
      id: 'acta',
      name: 'Acta',
      suiteId: 'business-plus',
      suiteName: 'Business+ Suite',
    });
    expect(MARKETING_APP_ROUTE_PARAMS).toContainEqual({
      suite: 'business-plus',
      app: 'acta',
    });
    expect(getMarketingAppRouteParamsForSuite('business-plus')).toContainEqual({
      app: 'acta',
    });
  });

  it('keeps each app page payload complete', () => {
    for (const app of MARKETING_APPS) {
      expect(app.ar).not.toHaveLength(0);
      expect(['ga', 'soon']).toContain(app.status);
      // Watheeq's production page deliberately carries the expanded six-point
      // capability proof; the remaining app cards retain the compact trio.
      expect(app.specs).toHaveLength(app.id === 'watheeq' ? 6 : 3);
      expect(app.modules).toHaveLength(app.id === 'watheeq' ? 9 : 8);
      expect(app.flow).toHaveLength(5);
      expect(app.bench).not.toHaveLength(0);
    }
  });

  it('exports route params from data for suite and app pages', () => {
    expect(MARKETING_SUITE_ROUTE_PARAMS).toEqual([
      { suite: 'datastream' },
      { suite: 'business-plus' },
      { suite: 'clariosec' },
      { suite: 'clarioinsight' },
    ]);
    expect(MARKETING_APP_ROUTE_PARAMS).toHaveLength(15);
    expect(MARKETING_APP_ROUTE_PARAMS).toContainEqual({
      suite: 'datastream',
      app: 'clariodr',
    });
    expect(MARKETING_APP_ROUTE_PARAMS).toContainEqual({
      suite: 'clarioinsight',
      app: 'dashboards',
    });
    expect(getMarketingSuitePath('clariosec')).toBe('/clariosec');
    expect(getMarketingAppPath('business-plus', 'acta')).toBe('/business-plus/acta');
  });

  it('preserves the platform engine taxonomy and detail payloads', () => {
    const engineIds = [
      'workflow',
      'forms',
      'automation',
      'integration',
      'iam',
      'files',
      'notifications',
      'licensing',
      'ai',
      'gateway',
      'event-bus',
      'observability',
    ];

    expect(PLATFORM_ENGINES.map((engine) => engine.id)).toEqual(engineIds);
    expectUnique(PLATFORM_ENGINES.map((engine) => engine.id));
    expect(PLATFORM_ENGINE_ROUTE_PARAMS).toEqual(
      engineIds.map((engine) => ({ engine })),
    );
    expect(Object.keys(PLATFORM_ENGINE_DETAILS).sort()).toEqual([...engineIds].sort());
    expect(getPlatformEngine('workflow')).toMatchObject({
      id: 'workflow',
      name: 'Workflow Engine',
    });
    expect(getPlatformEnginePath('workflow')).toBe('/platform/workflow');

    for (const engine of PLATFORM_ENGINES) {
      const detail = getPlatformEngineDetail(engine.id);

      expect(detail?.long).not.toHaveLength(0);
      expect(detail?.points).toHaveLength(4);
      expect(detail?.consumers.length).toBeGreaterThan(0);
    }
  });

  it('centralizes public navigation labels from the taxonomy', () => {
    const suitesNav = MARKETING_NAVIGATION.primary.find((item) => item.id === 'suites');
    const platformNav = MARKETING_NAVIGATION.primary.find((item) => item.id === 'platform');

    expect(suitesNav?.items?.map((item) => item.label)).toEqual(
      MARKETING_SUITES.map((suite) => suite.name),
    );
    expect(platformNav?.items?.map((item) => item.label)).toEqual(
      PLATFORM_ENGINES.map((engine) => engine.name),
    );
    expect(MARKETING_STATIC_ROUTES).toContain('/pricing');
  });

  it('pins the approved public brand tokens', () => {
    expect(MARKETING_BRAND_TOKENS.brand).toEqual({
      navy: '#005E5E',
      gold: '#ABB705',
      teal: '#0DA7A8',
      clarioSecRed: '#B23A48',
      clarioInsightViolet: '#5B3FA8',
    });
    expect(MARKETING_BRAND_TOKENS.suiteFamilies.sec[600]).toBe('#B23A48');
    expect(MARKETING_BRAND_TOKENS.suiteFamilies.insight[600]).toBe('#5B3FA8');
  });

  it('derives the full Phase 3 public route inventory from taxonomy data', () => {
    const routes = getMarketingPublicRoutes();

    expect(routes).toHaveLength(41);
    expectUnique(routes);
    expect(routes.slice(0, MARKETING_STATIC_ROUTES.length)).toEqual(
      MARKETING_STATIC_ROUTES,
    );
    expect(routes).toContain('/platform/workflow');
    expect(routes).toContain('/business-plus/acta');
    expect(routes).toContain('/clarioinsight/dashboards');
  });

  it('ports the source ROI and configurator logic as pure functions', () => {
    expect(roiCompute(6, 10, 12)).toEqual({
      stack: 732000,
      platform: 472000,
      save: 260000,
    });
    expect(formatMarketingMoney(260000)).toBe('$260K');
    expect(formatMarketingMoney(1250000)).toBe('$1.25M');
    expect(formatMarketingMoney(260000, 'ar')).toBe('$٢٦٠K');
    expect(formatMarketingMoney(1250000, 'ar')).toBe('$١٫٢٥M');

    expect(
      getSuiteConfigurationSummary(['datastream', 'business-plus'], 'SaaS'),
    ).toMatchObject({
      appCount: 9,
      tier: 'Suite',
      selectedLabel: 'DataStream, Business+',
    });
    expect(
      getSuiteConfigurationSummary(
        ['datastream', 'business-plus', 'clariosec'],
        'SaaS',
      ).tier,
    ).toBe('Platform');
    expect(
      getSuiteConfigurationSummary(['datastream'], 'Air-gapped').tier,
    ).toBe('Sovereign');
  });

  it('ports source SEO metadata, canonical and JSON-LD defaults', () => {
    const metadata = createMarketingMetadata({
      title: 'Workflow Engine — Platform Core — Clario360',
      description: 'Configurable approvals, stage gates and state machines',
      path: '/platform/workflow',
    });

    expect(MARKETING_VIEWPORT.themeColor).toBe('#005E5E');
    expect(MARKETING_OG_IMAGE_PATH).toBe('/opengraph-image');
    expect(metadata.alternates?.canonical).toBe('/platform/workflow');
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'Clario360',
      title: 'Workflow Engine — Platform Core — Clario360',
      description: 'Configurable approvals, stage gates and state machines',
      url: '/platform/workflow',
      locale: 'en_US',
    });
    expect(JSON.stringify(metadata)).not.toContain('/og-image.png');
    expect(JSON.stringify(metadata.twitter)).toContain('/opengraph-image');
    expect(MARKETING_JSON_LD['@graph'].map((node) => node['@type'])).toEqual([
      'Organization',
      'SoftwareApplication',
    ]);
    expect(JSON.stringify(MARKETING_JSON_LD)).toContain('Arabic-first');
  });

  it('defines the implemented lead submission contract', () => {
    const formData = new FormData();

    formData.set('name', '  Fatima Example  ');
    formData.set('email', 'fatima@example.com');
    formData.set('organisation', 'Clario Bank');
    formData.set('role', 'CIO');
    formData.set('interest', 'Business+ Suite');
    formData.set('deployment', 'Air-gapped / disconnected');
    formData.set('message', 'Air-gapped deployment discussion');

    expect(createLeadSubmissionFromFormData(formData, '/pricing')).toEqual({
      fullName: 'Fatima Example',
      workEmail: 'fatima@example.com',
      organisation: 'Clario Bank',
      role: 'CIO',
      interest: 'Business+ Suite',
      deployment: 'Air-gapped / disconnected',
      message: 'Air-gapped deployment discussion',
      sourcePath: '/pricing',
    });
    expect(MARKETING_LEAD_ENDPOINT_STATUS).toBe('implemented');
  });
});
