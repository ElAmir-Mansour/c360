import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { navigation } from './navigation';

// Validate the legacy DR → Recover permanent redirects declared in
// next.config.mjs: every legacy path redirects (308) to its new Recover home,
// and every redirect destination resolves to a real page file on disk (no dead
// links). The config is imported as an ES module so we assert on the actual
// redirect table the app ships.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..'); // src/config → frontend/
const appDir = resolve(repoRoot, 'src', 'app', '(dashboard)');

interface Redirect {
  source: string;
  destination: string;
  permanent: boolean;
}

async function loadRedirects(): Promise<Redirect[]> {
  const configPath = resolve(repoRoot, 'next.config.mjs');
  const mod = (await import(pathToFileURL(configPath).href)) as {
    default: { redirects?: () => Promise<Redirect[]> };
  };
  expect(typeof mod.default.redirects).toBe('function');
  return mod.default.redirects!();
}

/** Maps a Recover destination (possibly with `:path*`) to its page.tsx file. */
function destinationPageFile(destination: string): string {
  const routePath = destination.replace(/\/:path\*$/, '').replace(/^\//, '');
  return resolve(appDir, routePath, 'page.tsx');
}

function pageFileForHref(href: string): string {
  const routePath = href.split('?')[0].replace(/^\//, '');
  return resolve(appDir, routePath, 'page.tsx');
}

function recoverAndDRNavHrefs(): string[] {
  const hrefs = new Set<string>();
  for (const section of navigation) {
    for (const item of section.items) {
      if (item.href.startsWith('/recover') || item.href.startsWith('/dr')) {
        hrefs.add(item.href);
      }
      for (const child of item.children ?? []) {
        if (child.href.startsWith('/recover') || child.href.startsWith('/dr')) {
          hrefs.add(child.href);
        }
      }
    }
  }
  return [...hrefs].sort();
}

describe('legacy DR → Recover permanent redirects', () => {
  it('redirects the four legacy lifecycle pages to their Recover IT DR homes (308)', async () => {
    const redirects = await loadRedirects();
    const bySource = new Map(redirects.map((r) => [r.source, r]));

    const expected: Record<string, string> = {
      '/dr/recover': '/recover/it-dr/recover',
      '/dr/runbooks': '/recover/it-dr/runbooks',
      '/dr/rehearse': '/recover/it-dr/rehearse',
      '/dr/prove': '/recover/it-dr/prove',
    };

    for (const [source, destination] of Object.entries(expected)) {
      const r = bySource.get(source);
      expect(r, `redirect for ${source}`).toBeDefined();
      expect(r?.destination).toBe(destination);
      expect(r?.permanent).toBe(true);
    }
  });

  it('preserves the legacy /dr/prove sub-page deep links', async () => {
    const redirects = await loadRedirects();
    const wildcard = redirects.find((r) => r.source === '/dr/prove/:path*');
    expect(wildcard).toBeDefined();
    expect(wildcard?.destination).toBe('/recover/it-dr/prove/:path*');
    expect(wildcard?.permanent).toBe(true);
  });

  it('every redirect destination resolves to a real Recover page file (no dead links)', async () => {
    const redirects = await loadRedirects();
    for (const r of redirects) {
      const file = destinationPageFile(r.destination);
      expect(existsSync(file), `destination page missing for ${r.source} → ${r.destination} (${file})`).toBe(true);
    }
  });

  it('redirect target pages re-export the corresponding existing DR page (no forked logic)', () => {
    const cases: Array<[string, string]> = [
      ['recover/it-dr/recover/page.tsx', 'dr/recover/page'],
      ['recover/it-dr/runbooks/page.tsx', 'dr/runbooks/page'],
      ['recover/it-dr/rehearse/page.tsx', 'dr/rehearse/page'],
      ['recover/it-dr/prove/page.tsx', 'dr/prove/page'],
      ['recover/it-dr/prove/ledger/page.tsx', 'dr/prove/ledger/page'],
      ['recover/it-dr/prove/compliance/page.tsx', 'dr/prove/compliance/page'],
    ];
    for (const [file, expectedTarget] of cases) {
      const src = readFileSync(resolve(appDir, file), 'utf8');
      // Must be a re-export of the DR page (composition, not duplication).
      expect(src).toMatch(/export\s*\{\s*default\s*\}\s*from/);
      expect(src).toContain(expectedTarget);
    }
  });

  it('Recover/DR navigation hrefs resolve to real page files (no broken sidebar links)', () => {
    for (const href of recoverAndDRNavHrefs()) {
      const file = pageFileForHref(href);
      expect(existsSync(file), `navigation href missing page: ${href} (${file})`).toBe(true);
    }
  });
});
