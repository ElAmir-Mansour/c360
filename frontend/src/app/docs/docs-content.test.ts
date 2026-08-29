import { describe, expect, it } from 'vitest';
import { docArticles, docGroups, findDoc } from './docs-content';
import { watheeqRouteGuides } from './watheeq-route-guides';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

describe('documentation registry', () => {
  it('has unique routes and substantive articles', () => {
    const slugs = docArticles.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(docArticles.length).toBeGreaterThanOrEqual(15);

    for (const article of docArticles) {
      expect(article.title.length).toBeGreaterThan(2);
      expect(article.description.length).toBeGreaterThan(20);
      expect(article.sections.length).toBeGreaterThan(0);
      expect(new Set(article.sections.map((section) => section.id)).size).toBe(
        article.sections.length,
      );
      expect(findDoc(article.slug)).toBe(article);
    }
  });

  it('includes every article in navigation exactly once', () => {
    const navigationSlugs = docGroups.flatMap((group) =>
      group.items.map((article) => article.slug),
    );
    expect(navigationSlugs.sort()).toEqual(
      docArticles.map((article) => article.slug).sort(),
    );
  });

  it('does not advertise unverified SDKs or a hard-coded cloud host', () => {
    const content = JSON.stringify(docArticles);
    expect(content).not.toContain('@clario360/sdk');
    expect(content).not.toContain('api.clario360.com');
    expect(content).toContain('X-API-Key');
    expect(content).toContain('/api/v1');
  });

  it('documents every shipped WatheeqTech application page', () => {
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
});
