/**
 * DESIGN-SYSTEM.md contract guard (Phase 1).
 * ==========================================
 *
 * `docs/DESIGN-SYSTEM.md` makes load-bearing claims about the ClarioDR token
 * foundation that Phases 2–4 build on:
 *
 *   1. The brand is anchored on a SINGLE swappable layer (`brandPalette`),
 *      locking the seven supplied Clario colors exactly; the legacy `brand`
 *      object exposes the three interactive aliases consumed by existing UI.
 *   2. Every semantic role (surface / text / border / state) exists in BOTH the
 *      light and dark themes, derived from the same primitive ramps — so light/
 *      dark "just work" without per-component overrides.
 *   3. The generated `--ds-*` CSS vars stay in lockstep with `index.ts`, and the
 *      shadcn semantic vars in `globals.css` are re-mapped onto that `--ds-*`
 *      scale (so existing shadcn components inherit the brand with no code change).
 *   4. The pattern → token-group map (§2 of the doc) is backed by real tokens:
 *      8pt spacing rhythm, named rhythm tokens, soft-rounded card radii, a
 *      layered elevation set + focus ring, the display→caption type scale, and
 *      the motion durations/easings.
 *
 * This test fails if any of those guarantees regress, keeping the documentation
 * honest and the white-label contract enforceable.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  actionPalette,
  brand,
  brandPalette,
  brandHex,
  primary,
  gold,
  teal,
  neutral,
  lightTheme,
  darkTheme,
  primitives,
  type SemanticColorTheme,
} from '@/styles/tokens';
import { renderLightRoot, renderDarkRoot } from '@/styles/tokens/css';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

describe('DESIGN-SYSTEM.md — brand anchor (single swappable layer)', () => {
  it('anchors the primary on the public Clario360 teal #005E5E', () => {
    expect(brand.primary).toBe('180 100% 18.4314%');
    expect(brandHex.primary).toBe('#005E5E');
    expect(primary[600]).toBe('180 100% 18.4314%');
  });

  it('exposes the public chartreuse and teal through legacy accent aliases', () => {
    expect(brand.accentGold).toBe('64.0449 94.6809% 36.8627%');
    expect(brand.accentTeal).toBe('180.3871 85.6354% 35.4902%');
    expect(brandHex.accentGold).toBe('#ABB705');
    expect(brandHex.accentTeal).toBe('#0DA7A8');
    expect(gold[500]).toBe(brand.accentGold);
    expect(teal[600]).toBe(brand.accentTeal);
  });

  it('locks all seven supplied brand colors exactly', () => {
    expect(brandPalette).toEqual({
      deepTeal: '#005E5E',
      darkTeal: '#06352F',
      laRioja: '#ABB705',
      springTeal: '#0DA7A8',
      milk: '#FDFFF6',
      greyDark: '#6C7874',
      greyLight: '#D1D8D5',
    });
    expect(brandHex.primaryDark).toBe(brandPalette.darkTeal);
    expect(brandHex.canvas).toBe(brandPalette.milk);
    expect(brandHex.text).toBe(brandPalette.darkTeal);
    expect(brandHex.muted).toBe(brandPalette.greyDark);
    expect(brandHex.border).toBe(brandPalette.greyLight);
  });

  it('keeps the interactive aliases behind exactly three swappable triplets', () => {
    expect(Object.keys(brand).sort()).toEqual(['accentGold', 'accentTeal', 'primary']);
  });
});

describe('DESIGN-SYSTEM.md — semantic roles exist in BOTH light + dark', () => {
  const roleGroups: Array<keyof SemanticColorTheme> = [
    'background',
    'surface',
    'text',
    'border',
    'brand',
    'state',
  ];

  it.each(roleGroups)('light + dark both define the "%s" semantic group with matching keys', (group) => {
    const lightKeys = Object.keys(lightTheme[group]).sort();
    const darkKeys = Object.keys(darkTheme[group]).sort();
    expect(darkKeys).toEqual(lightKeys);
    // Every assigned value is a non-empty primitive reference (HSL triplet).
    for (const v of Object.values(lightTheme[group])) {
      expect(typeof v).toBe('string');
      expect((v as string).length).toBeGreaterThan(0);
    }
  });

  it('derives dark surfaces from the neutral ramp while keeping interactive brand anchors exact', () => {
    // Light page surface = light neutral; dark page surface = deep neutral ink.
    expect(lightTheme.background.page).toBe(neutral[50]);
    expect(darkTheme.background.page).toBe(neutral[950]);
    // Buttons remain on the canonical public-site primary in both themes.
    expect(lightTheme.brand.primary).toBe(primary[600]);
    expect(darkTheme.brand.primary).toBe(primary[600]);
  });
});

describe('DESIGN-SYSTEM.md — generated --ds-* CSS stays in lockstep with index.ts', () => {
  const css = read('src/styles/tokens/tokens.css');

  it('checked-in tokens.css matches the emitter output (no drift)', () => {
    // The generator wraps these in :root{}/.dark{}; assert every emitted line
    // is present in the committed file.
    for (const line of renderLightRoot().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('/*')) continue;
      expect(css).toContain(trimmed);
    }
    for (const line of renderDarkRoot().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      expect(css).toContain(trimmed);
    }
  });

  it('emits the brand anchor + focus ring as --ds-* vars', () => {
    expect(css).toContain('--ds-brand-primary: 180 100% 18.4314%;');
    expect(css).toContain('--ds-primary-600: 180 100% 18.4314%;');
    expect(css).toContain('--ds-elevation-focus:');
    // Dark theme retains the exact public-site primary for controls.
    expect(renderDarkRoot()).toContain('--ds-brand-primary: 180 100% 18.4314%;');
  });

  it('emits the canonical palette as lossless RGB channels for controls', () => {
    expect(css).toContain('--ds-clario-primary: 0 94 94;');
    expect(css).toContain('--ds-clario-dark-teal: 6 53 47;');
    expect(css).toContain('--ds-clario-accent: 171 183 5;');
    expect(css).toContain('--ds-clario-spring-teal: 13 167 168;');
    expect(css).toContain('--ds-clario-canvas: 253 255 246;');
    expect(css).toContain('--ds-clario-tint: 209 216 213;');
    expect(css).toContain('--ds-clario-border: 209 216 213;');
    expect(css).toContain('--ds-clario-ink: 6 53 47;');
    expect(css).toContain('--ds-clario-muted: 108 120 116;');
  });

  it('emits the approved action green and interaction states', () => {
    expect(actionPalette.primary).toBe('#218F68');
    expect(css).toContain('--ds-action-primary: 33 143 104;');
    expect(css).toContain('--ds-action-primary-hover: 31 130 93;');
    expect(css).toContain('--ds-action-primary-active: 23 107 76;');
  });
});

describe('DESIGN-SYSTEM.md — shadcn vars are re-mapped onto the --ds-* scale', () => {
  const globals = read('src/app/globals.css');

  it('imports the generated token vars before @tailwind', () => {
    const importIdx = globals.indexOf("@import '../styles/tokens/tokens.css'");
    const tailwindIdx = globals.indexOf('@tailwind base');
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(tailwindIdx).toBeGreaterThan(importIdx);
  });

  it.each([
    ['--background', '--ds-bg-page'],
    ['--foreground', '--ds-text-primary'],
    ['--card', '--ds-surface-card'],
    ['--primary', '--ds-brand-primary'],
    ['--primary-foreground', '--ds-text-on-primary'],
    ['--border', '--ds-border-default'],
    ['--ring', '--ds-border-focus'],
    ['--radius', '--ds-radius-lg'],
  ])('shadcn %s derives from %s', (shadcnVar, dsVar) => {
    // e.g. `--primary: var(--ds-brand-primary);`
    expect(globals).toMatch(new RegExp(`${escape(shadcnVar)}:\\s*var\\(${escape(dsVar)}\\)`));
  });
});

describe('DESIGN-SYSTEM.md — §2 pattern→token groups are backed by real tokens', () => {
  it('§2.3 spacing: 8pt base step + named layout rhythm tokens exist', () => {
    expect(primitives.spacing[2]).toBe('0.5rem'); // 8px base step
    expect(primitives.spacing['section-y']).toBe('4rem'); // 64px generous section
    expect(primitives.spacing['section-x']).toBe('2rem');
    expect(primitives.spacing.gutter).toBe('1.5rem');
    expect(primitives.spacing['card-padding']).toBe('1.5rem');
  });

  it('§2.4 radii: soft-rounded card + named component radii exist', () => {
    expect(primitives.radius.card).toBe('1rem'); // soft rounded card
    expect(primitives.radius.panel).toBe('1.5rem'); // mega-menu / large panel
    expect(primitives.radius.button).toBe('0.625rem');
    expect(primitives.radius.input).toBe('0.625rem');
    expect(primitives.radius.pill).toBe('9999px');
  });

  it('§2.5 elevation: layered set (0–5) + focus ring exist for both themes', () => {
    for (const lvl of [0, 1, 2, 3, 4, 5] as const) {
      expect(primitives.elevationLight[lvl]).toBeDefined();
      expect(primitives.elevationDark[lvl]).toBeDefined();
    }
    expect(primitives.elevationLight.focus).toContain('180 100% 18.4314%');
    expect(primitives.elevationDark.focus).toBeDefined();
  });

  it('§2.2 type: compressed display→caption scale exists with line-height + tracking', () => {
    for (const key of ['display', 'h1', 'h2', 'h3', 'h4', 'body', 'caption', 'overline'] as const) {
      const entry = primitives.fontSize[key];
      expect(entry[0]).toMatch(/rem$/);
      expect(entry[1].lineHeight).toBeTruthy();
      expect(entry[1].letterSpacing).toBeTruthy();
    }
    // Tracking tightens as size grows (display tighter than body).
    const displayTrack = parseFloat(primitives.fontSize.display[1].letterSpacing);
    expect(displayTrack).toBeLessThan(0);
  });

  it('§2.6 motion: durations + easings exist, incl. live-status + scroll-reveal', () => {
    expect(primitives.duration.fast).toBeTruthy();
    expect(primitives.duration.reveal).toBeTruthy(); // scroll-reveal of feature blocks
    expect(primitives.duration.status).toBeTruthy(); // live runbook / node-map heartbeat
    expect(primitives.easing.standard).toContain('cubic-bezier');
    expect(primitives.easing.spring).toContain('cubic-bezier');
  });
});

describe('DESIGN-SYSTEM.md — IP boundary discipline in the document itself', () => {
  const doc = read('docs/DESIGN-SYSTEM.md');

  it('exists and covers all four required sections', () => {
    expect(doc).toContain('Design audit');
    expect(doc).toContain('Token map');
    expect(doc).toContain('Component inventory');
    expect(doc).toContain('the contract for Phases 2–4');
  });

  it('cites the influence only as "the reference product" — zero forbidden proper nouns', () => {
    expect(doc).toContain('the reference product');
    // No competitor/customer proper nouns may appear as ClarioDR content.
    const forbidden = [
      'cutover',
      'barclays',
      'nationwide',
      'danske',
      'zerto',
      'forrester',
      'collaborative automation',
    ];
    const lower = doc.toLowerCase();
    for (const term of forbidden) {
      expect(lower).not.toContain(term);
    }
  });

  it('maps the grammar onto ClarioDR DR concepts (runbooks / RTO-vs-RTA / failover / attestation)', () => {
    const lower = doc.toLowerCase();
    expect(lower).toContain('runbook');
    expect(lower).toContain('rto');
    expect(lower).toContain('failover');
    expect(lower).toContain('attestation');
    expect(doc).toContain('#005E5E'); // brand anchor documented
  });
});

/** RegExp-escape a CSS var name for use in dynamic matchers. */
function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}
