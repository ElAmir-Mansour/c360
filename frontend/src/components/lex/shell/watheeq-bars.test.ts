import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('Watheeq unified top bar', () => {
  const bar = read('src/components/lex/shell/lex-top-bar.tsx');
  const layout = read('src/app/(dashboard)/layout.tsx');

  it('renders a SINGLE deep-teal bar (no more double header + nav stack)', () => {
    // The shell mounts exactly the unified bar in Watheeq mode, and the old
    // second row (LexTopNav) is no longer stacked beneath a header.
    expect(layout).toContain('<LexTopBar />');
    expect(layout).not.toContain('LexTopNav');
    // Watheeq mode swaps the standard <Header> out entirely for the unified bar.
    expect(layout).toMatch(/watheeqMode \? <LexTopBar \/> : <Header \/>/);
  });

  it('keeps the bar on the canonical flat deep teal with the La Rioja accent', () => {
    expect(bar).toContain('bg-brand-primary-600');
    expect(bar).toContain('border-t-[3px] border-t-brand-accent-500');
    // No gradient wash — the reference chrome is a solid block.
    expect(bar).not.toMatch(/\bbg-gradient-(?:to|from)-/);
    expect(bar).not.toMatch(/bg-\[[^\]]*gradient/i);
  });

  it('carries the flat primary nav, global search, and account controls', () => {
    expect(bar).toContain('LEX_PRIMARY_NAV');
    expect(bar).toContain("import { LexGlobalSearch } from './global-search'");
    expect(bar).toContain('<LexGlobalSearch');
    expect(bar.indexOf('<LexGlobalSearch')).toBeLessThan(
      bar.indexOf('<NotificationDropdown />'),
    );
    expect(bar).toContain('LocaleQuickToggle');
    expect(bar).toContain('<UserMenu />');
    expect(bar).toContain('<NotificationDropdown />');
  });

  it('resolves persona navigation from the shared Lex context query', () => {
    expect(bar).toContain('LEX_ME_QUERY_KEY');
    expect(bar).toContain('queryFn: fetchLexMe');
    expect(bar).toContain('primaryNavForRole(activeRoleSlug)');
    expect(bar).toContain("item.id === 'dashboard'");
    expect(bar).toContain('href={personaHomeHref}');
    expect(bar).toContain('roleSpecificNav');
  });
});
