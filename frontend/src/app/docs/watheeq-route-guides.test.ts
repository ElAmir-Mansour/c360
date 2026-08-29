import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  watheeqRouteArticles,
  watheeqRouteGuides,
  type RouteGuide,
} from './watheeq-route-guides';

function findPages(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? findPages(path)
      : entry === 'page.tsx'
        ? [path]
        : [];
  });
}

function guideFor(route: string): RouteGuide {
  const guide = watheeqRouteGuides.find((item) => item.route === route);
  expect(guide, `${route} must have a WatheeqTech how-to guide`).toBeDefined();
  return guide!;
}

describe('WatheeqTech route how-to guides', () => {
  it('covers every shipped /lex page exactly once', () => {
    const lexRoot = join(process.cwd(), 'src', 'app', '(dashboard)', 'lex');
    const applicationRoutes = findPages(lexRoot).map((page) => {
      const nested = relative(lexRoot, page)
        .split(sep)
        .slice(0, -1)
        .join('/');
      return nested ? `/lex/${nested}` : '/lex';
    });
    const documentedRoutes = watheeqRouteGuides.map((guide) => guide.route);

    expect(new Set(documentedRoutes).size).toBe(documentedRoutes.length);
    expect(documentedRoutes.sort()).toEqual(applicationRoutes.sort());
  });

  it('provides substantive, route-specific operating instructions', () => {
    const titles = watheeqRouteGuides.map((guide) => guide.title);
    const purposes = watheeqRouteGuides.map((guide) => guide.purpose);

    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(purposes).size).toBe(purposes.length);

    for (const guide of watheeqRouteGuides) {
      expect(guide.route).toMatch(/^\/lex(?:\/|$)/);
      expect(guide.title.length).toBeGreaterThan(18);
      expect(guide.audience.length).toBeGreaterThan(8);
      expect(guide.purpose.length).toBeGreaterThan(45);
      expect(guide.actions).toHaveLength(3);

      for (const action of guide.actions) {
        expect(action.length, `${guide.route} has a shallow action`).toBeGreaterThan(45);
        expect(action).toMatch(/\.$/);
      }
    }
  });

  it('renders each guide as a complete how-to article', () => {
    expect(watheeqRouteArticles).toHaveLength(watheeqRouteGuides.length);

    for (const article of watheeqRouteArticles) {
      expect(article.group).toBe('WatheeqTech pages');
      expect(article.sections.map((section) => section.id)).toEqual([
        'page-purpose',
        'before-you-start',
        'how-to-use',
        'governance',
      ]);

      const serialized = JSON.stringify(article.sections);
      expect(serialized).toContain('Application route');
      expect(serialized).toContain('Before you start');
      expect(serialized).toContain('Expected result');
    }
  });

  it('preserves important distinctions from the implemented pages', () => {
    expect(guideFor('/lex/admin/escalations').purpose).toContain('coverage gaps');
    expect(guideFor('/lex/admin/role-matrix').actions.join(' ')).toContain('read-only');
    expect(guideFor('/lex/case-timeline').purpose).toContain('matter');
    expect(guideFor('/lex/entities').actions.join(' ')).toContain('derived and read-only');
    expect(guideFor('/lex/playbooks/portfolio').purpose).toContain('scored contracts');
    expect(guideFor('/lex/service-desk/intake').purpose).toContain('intake messages');
    expect(guideFor('/lex/service-desk/notifications').purpose).toContain('personal');
  });
});
