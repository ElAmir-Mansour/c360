import { describe, expect, it, vi } from 'vitest';

import {
  DASHBOARD_HUB_PATH,
  resolveSuiteAwareDashboardLanding,
  WATHEEQ_HOME_PATH,
} from './dashboard-landing';

describe('resolveSuiteAwareDashboardLanding', () => {
  it('sends a Watheeq-only user to the role-aware legal home', () => {
    const hasPermission = (permission: string) => permission === 'lex:read';

    expect(resolveSuiteAwareDashboardLanding(['lex'], hasPermission)).toBe(
      WATHEEQ_HOME_PATH,
    );
  });

  it('keeps a multi-suite user on the platform dashboard', () => {
    const hasPermission = (permission: string) =>
      permission === 'lex:read' || permission === 'cyber:read';

    expect(
      resolveSuiteAwareDashboardLanding(['lex', 'cyber'], hasPermission),
    ).toBe(DASHBOARD_HUB_PATH);
  });

  it('keeps legacy tenants without an explicit suite list on the hub', () => {
    const hasPermission = vi.fn(() => true);

    expect(resolveSuiteAwareDashboardLanding(undefined, hasPermission)).toBe(
      DASHBOARD_HUB_PATH,
    );
    expect(resolveSuiteAwareDashboardLanding([], hasPermission)).toBe(
      DASHBOARD_HUB_PATH,
    );
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('does not redirect when Watheeq is enabled but inaccessible to the user', () => {
    expect(resolveSuiteAwareDashboardLanding(['lex'], () => false)).toBe(
      DASHBOARD_HUB_PATH,
    );
  });
});
