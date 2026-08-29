import { SUITES } from '@/config/navigation';
import { canAccessWith } from '@/lib/permissions';

export const DASHBOARD_HUB_PATH = '/dashboard' as const;
export const WATHEEQ_HOME_PATH = '/lex' as const;

/**
 * Resolve the dashboard entry for an authenticated tenant.
 *
 * An empty/missing `enabled_suites` list is deliberately treated as legacy
 * tenant metadata and keeps the cross-suite hub. When the tenant has an
 * explicit suite allow-list, we intersect it with the current user's effective
 * permissions. A user whose only available product is Watheeq goes straight to
 * its role-aware legal command centre; everyone with multiple products retains
 * the platform hub.
 */
export function resolveSuiteAwareDashboardLanding(
  enabledSuites: readonly string[] | null | undefined,
  hasPermission: (permission: string) => boolean,
): typeof DASHBOARD_HUB_PATH | typeof WATHEEQ_HOME_PATH {
  if (!enabledSuites || enabledSuites.length === 0) {
    return DASHBOARD_HUB_PATH;
  }

  const enabled = new Set(enabledSuites.map((suite) => suite.trim().toLowerCase()));
  const availableSuites = SUITES.filter(
    (suite) =>
      enabled.has(suite.segment) && canAccessWith(hasPermission, suite.permission),
  );

  return availableSuites.length === 1 && availableSuites[0]?.segment === 'lex'
    ? WATHEEQ_HOME_PATH
    : DASHBOARD_HUB_PATH;
}
