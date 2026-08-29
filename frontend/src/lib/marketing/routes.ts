import { PLATFORM_ENGINES } from './engines';
import { MARKETING_APP_ROUTE_PARAMS, MARKETING_SUITES } from './suites';
import type { PlatformEngineId } from './engines';
import type { MarketingAppId, MarketingSuiteId } from './suites';

export const MARKETING_STATIC_ROUTES = [
  '/',
  '/platform',
  '/solutions',
  '/sovereignty',
  '/resources',
  '/trust',
  '/compare',
  '/pricing',
  '/about',
  '/contact',
] as const;

export function getMarketingSuitePath(suite: MarketingSuiteId): `/${MarketingSuiteId}` {
  return `/${suite}`;
}

export function getMarketingAppPath(
  suite: MarketingSuiteId,
  app: MarketingAppId,
): `/${MarketingSuiteId}/${MarketingAppId}` {
  return `/${suite}/${app}`;
}

export function getPlatformEnginePath(
  engine: PlatformEngineId,
): `/platform/${PlatformEngineId}` {
  return `/platform/${engine}`;
}

export function getMarketingPublicRoutes(): readonly `/${string}`[] {
  return [
    ...MARKETING_STATIC_ROUTES,
    ...PLATFORM_ENGINES.map((engine) => getPlatformEnginePath(engine.id)),
    ...MARKETING_SUITES.map((suite) => getMarketingSuitePath(suite.id)),
    ...MARKETING_APP_ROUTE_PARAMS.map((param) =>
      getMarketingAppPath(param.suite, param.app),
    ),
  ];
}
