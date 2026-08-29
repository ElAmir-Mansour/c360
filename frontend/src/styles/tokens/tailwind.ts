/**
 * ClarioDR Design System — Tailwind mapping
 * =========================================
 *
 * Builds the `theme.extend` fragment for `tailwind.config.ts` directly from the
 * token source of truth (`./index.ts`). This guarantees Tailwind utility classes
 * and the CSS custom properties are generated from the *same* values — Phase 2
 * components reference these keys verbatim.
 *
 * Two flavours of colour mapping are emitted:
 *
 *  - Static brand ramps (`primary.600`, `gold.500`, `teal.600`, `neutral.500`)
 *    bake the HSL triplet into `hsl(<triplet> / <alpha-value>)` so the opacity
 *    modifier works and the value is theme-agnostic (same in light + dark).
 *
 *  - Semantic, theme-aware roles (`surface.card`, `text.primary`, `border.*`,
 *    `bg.page`, `state.*`) resolve to `hsl(var(--ds-*) / <alpha-value>)`, where
 *    the `--ds-*` var is re-assigned per theme in `globals.css`. These re-theme
 *    automatically between light and dark.
 */

import {
  primitives,
  type DesignTokens,
} from './index';

type HslTriplet = string;

/** Wrap a raw HSL triplet so Tailwind's `<alpha-value>` opacity modifier works. */
function hsl(triplet: HslTriplet): string {
  return `hsl(${triplet} / <alpha-value>)`;
}

/** Resolve a Tailwind colour to a theme-aware CSS var (re-themes light/dark). */
function dsVar(name: string): string {
  return `hsl(var(--ds-${name}) / <alpha-value>)`;
}

/**
 * Resolve an exact-preserving raw-value DS token. The `--ds-*` var holds the
 * colour as space-separated sRGB channels ("R G B") in tokens.css, so wrapping
 * it as `rgb(... / <alpha-value>)` renders the *exact* original hex (RGB↔hex is
 * lossless — no HSL rounding drift) while still honouring Tailwind's opacity
 * modifier (`bg-auth-dark/50`, `ring-brand-bright/25`, `bg-table-header/96`, …).
 */
function rgbVar(name: string): string {
  return `rgb(var(--ds-${name}) / <alpha-value>)`;
}

/** Map a primitive HSL ramp object → Tailwind colour scale of `hsl(... )`. */
function ramp(scale: Record<string | number, HslTriplet>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(scale).map(([step, triplet]) => [String(step), hsl(triplet)]),
  );
}

/**
 * The design-system colour additions. Namespaced under `ds-*`-free keys that do
 * not collide with the existing shadcn keys (`primary`, `secondary`, `accent`,
 * `muted`, `card`, `border`, …) which remain mapped to their own CSS vars.
 */
export const dsColors = {
  // Static brand ramps (theme-agnostic; same triplet light + dark).
  'brand-primary': ramp(primitives.primary),
  // Leaf-green accent: numbered steps are static; the DEFAULT is the theme-aware
  // semantic fill (--ds-accent, lifted in dark). `bg-brand-accent` picks the
  // theme-aware fill; `bg-brand-accent-500` pins the leaf anchor. Always pair with
  // `text-content-on-accent` (dark fg) — never as green text on white.
  'brand-accent': { ...ramp(primitives.accent), DEFAULT: dsVar('accent') },
  'brand-gold': ramp(primitives.gold),
  'brand-teal': ramp(primitives.teal),
  neutral: ramp(primitives.neutral),
  // Semantic state ramps (static triplets — 500 is the canonical state colour;
  // theme-aware versions are exposed via the `state.*` group below).
  success: ramp(primitives.success),
  warning: ramp(primitives.warning),
  error: ramp(primitives.error),
  info: ramp(primitives.info),

  // Theme-aware semantic surfaces / text / borders (re-theme via --ds-* vars).
  bg: {
    page: dsVar('bg-page'),
    subtle: dsVar('bg-subtle'),
    inset: dsVar('bg-inset'),
  },
  surface: {
    card: dsVar('surface-card'),
    raised: dsVar('surface-raised'),
    sunken: dsVar('surface-sunken'),
    overlay: dsVar('surface-overlay'),
  },
  content: {
    primary: dsVar('text-primary'),
    secondary: dsVar('text-secondary'),
    muted: dsVar('text-muted'),
    inverted: dsVar('text-inverted'),
    'on-primary': dsVar('text-on-primary'),
    'on-accent': dsVar('text-on-accent'),
  },
  outline: {
    subtle: dsVar('border-subtle'),
    DEFAULT: dsVar('border-default'),
    strong: dsVar('border-strong'),
    input: dsVar('border-input'),
    focus: dsVar('border-focus'),
  },
  state: {
    success: dsVar('state-success'),
    warning: dsVar('state-warning'),
    error: dsVar('state-error'),
    info: dsVar('state-info'),
  },

  // Canonical Clario360 palette as lossless sRGB channels. Use this group for
  // controls that must remain on the exact public-site values in every theme.
  clario: {
    primary: rgbVar('clario-primary'),
    'dark-teal': rgbVar('clario-dark-teal'),
    accent: rgbVar('clario-accent'),
    'spring-teal': rgbVar('clario-spring-teal'),
    canvas: rgbVar('clario-canvas'),
    tint: rgbVar('clario-tint'),
    border: rgbVar('clario-border'),
    ink: rgbVar('clario-ink'),
    muted: rgbVar('clario-muted'),
  },

  // Shared action-control fill. Kept separate from the Clario brand group so
  // changing buttons does not unintentionally recolour navigation or charts.
  action: {
    DEFAULT: rgbVar('action-primary'),
    hover: rgbVar('action-primary-hover'),
    active: rgbVar('action-primary-active'),
  },

  // ---------------------------------------------------------------------------
  // Exact-preserving raw-value tokens (migrated from inline hardcoded hex). Each
  // is `rgb(var(--ds-*) / <alpha-value>)` over the "R G B" channels in
  // tokens.css, so the rendered colour is byte-for-byte the original literal AND
  // the `/NN` opacity modifier keeps working. Flat keys (no `.DEFAULT`) so they
  // are addressable as `bg-brand-bright`, `text-neutral-ink`, etc. and resolvable
  // via `theme(colors.brand-bright)` inside arbitrary `[linear-gradient(...)]`.
  // ---------------------------------------------------------------------------
  // App-chrome / brand bright accent (sidebar/nav gradients, focus rings) — a
  // bright teal companion of the deep-teal anchor (re-themed from the old blue).
  'brand-bright': rgbVar('brand-bright'),
  // Near-black ink used for high-contrast badge/label text + dark surfaces.
  'neutral-ink': rgbVar('neutral-ink'),
  // Legacy green family (status pills retained from the pre-blue brand).
  'legacy-green-50': rgbVar('legacy-green-50'),
  'legacy-green-600': rgbVar('legacy-green-600'),
  'legacy-green-800': rgbVar('legacy-green-800'),
  // Deep auth/CTI canvas greens (threat-map, evidence, console surfaces).
  'auth-dark': rgbVar('auth-dark'),
  'auth-dark-raised': rgbVar('auth-dark-raised'),
  // Deep teal splash (auth provider background).
  'auth-teal': rgbVar('auth-teal'),
  // Sticky data-table header tint (exact off-white wash, used at /96).
  'table-header': rgbVar('table-header'),
  // CTI / auth navy ramp — coherent dark-canvas scale (900 → 980, deepening).
  'cti-navy': {
    900: rgbVar('cti-navy-900'),
    925: rgbVar('cti-navy-925'),
    930: rgbVar('cti-navy-930'),
    940: rgbVar('cti-navy-940'),
    945: rgbVar('cti-navy-945'),
    950: rgbVar('cti-navy-950'),
    980: rgbVar('cti-navy-980'),
  },
} as const;

/** Spacing additions (named layout rhythm + 8pt steps not already in Tailwind). */
export const dsSpacing = {
  gutter: primitives.spacing.gutter,
  'section-y': primitives.spacing['section-y'],
  'section-x': primitives.spacing['section-x'],
  'card-padding': primitives.spacing['card-padding'],
} as const;

/** Border-radius additions (named component radii). */
export const dsBorderRadius = {
  input: primitives.radius.input,
  button: primitives.radius.button,
  card: primitives.radius.card,
  pill: primitives.radius.pill,
} as const;

/** Box-shadow additions — elevation set wired to theme-aware CSS vars. */
export const dsBoxShadow = {
  'elevation-0': 'none',
  'elevation-1': 'var(--ds-elevation-1)',
  'elevation-2': 'var(--ds-elevation-2)',
  'elevation-3': 'var(--ds-elevation-3)',
  'elevation-4': 'var(--ds-elevation-4)',
  'elevation-5': 'var(--ds-elevation-5)',
  'focus-ring': 'var(--ds-elevation-focus)',
  // Brand glows — `glow-primary` is the full CTA glow; `glow-soft` is the
  // lower-alpha resting/hover lift used on cards. Both wired to --ds-* vars.
  'glow-primary': 'var(--ds-shadow-glow-primary)',
  'glow-soft': 'var(--ds-shadow-glow-soft)',
} as const;

/** Font-family additions (mutable arrays — Tailwind's config types reject readonly). */
export const dsFontFamily: Record<string, string[]> = {
  display: [...primitives.fontFamily.display],
  arabic: [...primitives.fontFamily.arabic],
};

/** A Tailwind fontSize tuple: [size, { lineHeight, letterSpacing }]. */
type FontSizeTuple = [string, { lineHeight: string; letterSpacing: string }];

function fontSizeTuple(entry: readonly [string, { readonly lineHeight: string; readonly letterSpacing: string }]): FontSizeTuple {
  return [entry[0], { lineHeight: entry[1].lineHeight, letterSpacing: entry[1].letterSpacing }];
}

/**
 * Font-size additions — the COMPLETE type scale, derived entirely from the token
 * source of truth (primitives.fontSize). Headings (display/h1–h4) included so the
 * heading utilities are token-driven, not hardcoded in tailwind.config.ts.
 */
export const dsFontSize: Record<string, FontSizeTuple> = {
  display: fontSizeTuple(primitives.fontSize.display),
  h1: fontSizeTuple(primitives.fontSize.h1),
  h2: fontSizeTuple(primitives.fontSize.h2),
  h3: fontSizeTuple(primitives.fontSize.h3),
  h4: fontSizeTuple(primitives.fontSize.h4),
  'body-lg': fontSizeTuple(primitives.fontSize['body-lg']),
  body: fontSizeTuple(primitives.fontSize.body),
  'body-sm': fontSizeTuple(primitives.fontSize['body-sm']),
  caption: fontSizeTuple(primitives.fontSize.caption),
  overline: fontSizeTuple(primitives.fontSize.overline),
};

/** Letter-spacing additions — named uppercase-label tracking steps. */
export const dsLetterSpacing: Record<string, string> = {
  label: primitives.letterSpacing.label,
  caps: primitives.letterSpacing.caps,
  'caps-wide': primitives.letterSpacing['caps-wide'],
  'caps-xwide': primitives.letterSpacing['caps-xwide'],
};

/** Transition duration additions. */
export const dsTransitionDuration = {
  instant: primitives.duration.instant,
  fast: primitives.duration.fast,
  normal: primitives.duration.normal,
  slow: primitives.duration.slow,
  reveal: primitives.duration.reveal,
  status: primitives.duration.status,
} as const;

/** Transition timing-function additions. */
export const dsTransitionTimingFunction = {
  standard: primitives.easing.standard,
  emphasized: primitives.easing.emphasized,
  decelerate: primitives.easing.decelerate,
  accelerate: primitives.easing.accelerate,
  spring: primitives.easing.spring,
} as const;

/** The full Tailwind `theme.extend` fragment derived from tokens. */
export function buildTailwindThemeExtension() {
  return {
    colors: dsColors,
    spacing: dsSpacing,
    borderRadius: dsBorderRadius,
    boxShadow: dsBoxShadow,
    fontFamily: dsFontFamily,
    fontSize: dsFontSize,
    letterSpacing: dsLetterSpacing,
    transitionDuration: dsTransitionDuration,
    transitionTimingFunction: dsTransitionTimingFunction,
  };
}

export type TailwindThemeExtension = ReturnType<typeof buildTailwindThemeExtension>;
export type { DesignTokens };
