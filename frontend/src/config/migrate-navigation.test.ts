import { describe, expect, it } from 'vitest';
import { filterSectionsForRoute, navigation, SUITE_ROUTE_SEGMENTS, SUITES } from './navigation';

describe('Clario Migrate navigation registration', () => {
  it('registers migrate as a suite route segment and switcher entry', () => {
    expect(SUITE_ROUTE_SEGMENTS).toContain('migrate');
    expect(SUITES.find((suite) => suite.segment === 'migrate')).toEqual(
      expect.objectContaining({
        segment: 'migrate',
        href: '/migrate',
        permission: 'migrate:read',
      }),
    );
  });

  it('scopes the Migrate sidebar to migration routes', () => {
    const ids = filterSectionsForRoute(navigation, '/migrate/portfolio').map((section) => section.id);
    expect(ids).toContain('migrate-command');
    expect(ids).toContain('main');
    expect(ids).toContain('administration');
    expect(ids).not.toContain('respond-command');
    expect(ids).not.toContain('security-operations');
  });

  it('exposes the required Migrate sub-routes', () => {
    const items = navigation.find((section) => section.id === 'migrate-command')?.items ?? [];
    expect(items.map((item) => item.href)).toEqual(
      expect.arrayContaining([
        '/migrate',
        '/migrate/portfolio',
        '/migrate/move-groups',
        '/migrate/waves',
        '/migrate/cutovers',
        '/migrate/command-center',
        '/migrate/integrations',
      ]),
    );
  });
});
