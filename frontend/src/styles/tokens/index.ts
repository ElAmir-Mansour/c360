/**
 * ClarioDR Design System — Token Source of Truth (TypeScript)
 * ===========================================================
 *
 * This file is the canonical, machine-readable definition of every primitive
 * and semantic design token in the ClarioDR design system. It is consumed by:
 *
 *   1. `tailwind.config.ts`           — maps tokens onto Tailwind theme keys so
 *                                        utility classes (`bg-surface-card`,
 *                                        `rounded-card`, `shadow-elevation-2`,
 *                                        `text-display`, …) resolve to tokens.
 *   2. `src/styles/tokens/css.ts`     — emits the CSS custom properties written
 *                                        into `globals.css` (`--ds-*` vars).
 *   3. Application/runtime code        — anywhere a value must be read in JS/TS
 *                                        (SVG/canvas/recharts can't resolve
 *                                        `var()`), import the resolved value.
 *
 * ARCHITECTURE
 * ------------
 * - PRIMITIVE tokens (`primitives`) are raw, theme-agnostic values: the full
 *   colour ramps, the type scale, spacing, radii, shadow recipes, motion.
 * - SEMANTIC tokens (`lightTheme` / `darkTheme`) assign meaning by *referencing*
 *   primitives: `surface.card`, `text.primary`, `border.default`, … The dark
 *   theme is derived from the same primitive ramps — only the assignments flip.
 * - BRAND tokens live behind a single swappable anchor (`brand`). White-label is
 *   a token change here (and the matching CSS vars), never a code change.
 *
 * COLOUR FORMAT
 * -------------
 * Colours are stored as HSL *triplets* ("H S% L%") with no `hsl()` wrapper, so
 * they slot directly into the existing shadcn convention `hsl(var(--x))` and so
 * Tailwind's `<alpha-value>` opacity modifier works (`bg-primary/40`). A handful
 * of resolved hex values are provided for SVG/canvas consumers.
 *
 * DO NOT hardcode colours/spacing/type/radii/shadow/motion in components — only
 * reference these tokens (via Tailwind theme keys or `--ds-*` CSS vars).
 */

/* ========================================================================== */
/* 1. PRIMITIVE COLOUR RAMPS                                                   */
/* ========================================================================== */

/**
 * Canonical Clario palette supplied by the brand team. Keep these exact hex
 * anchors available for non-CSS consumers and contract tests.
 */
export const brandPalette = {
  deepTeal: '#005E5E',
  darkTeal: '#06352F',
  laRioja: '#ABB705',
  springTeal: '#0DA7A8',
  milk: '#FDFFF6',
  greyDark: '#6C7874',
  greyLight: '#D1D8D5',
} as const;

/**
 * Primary action controls. The supplied emerald is intentionally separate from
 * the core Clario palette so buttons can share one consistent action treatment
 * without recolouring navigation, links, charts, or other brand surfaces.
 */
export const actionPalette = {
  primary: '#218F68',
  hover: '#1F825D',
  active: '#176B4C',
} as const;

/**
 * Watheeq Legal Director dashboard colours.
 *
 * WLS-UI-SPEC-LD-001 is the source of the semantic, categorical, and domain
 * assignments. Its brand placeholders are resolved to the approved Watheeq
 * anchors above (the specification explicitly gives the brand kit precedence):
 *
 *   teal-900  -> Dark Teal  #06352F
 *   teal-700  -> Deep Teal  #005E5E
 *   teal-600  -> Dark Teal  #06352F
 *   teal-300  -> Grey Light #D1D8D5
 *   lime/nav  -> La Rioja   #ABB705
 *   canvas    -> Milk       #FDFFF6
 *
 * Keep category and domain values positional. Consumers must not derive a
 * colour from an index or data value at runtime.
 */
export const watheeqLegalDirectorColors = {
  teal: {
    900: brandPalette.darkTeal,
    700: brandPalette.deepTeal,
    600: brandPalette.darkTeal,
    300: brandPalette.greyLight,
  },
  lime: {
    500: brandPalette.laRioja,
  },
  navActive: brandPalette.laRioja,
  canvas: brandPalette.milk,
  surface: '#FFFFFF',
  track: '#E8EBE9',
  trackAlt: '#E6E6E6',
  status: {
    critical: '#A5332D',
    critical050: '#FDF2F2',
    high: '#E87B35',
    medium: '#E9A23B',
    ok: '#438866',
    ok050: '#F3FAF6',
    ok400: '#54B483',
    warn050: '#F9E8C8',
  },
  serviceRequest: {
    contracts: { dot: brandPalette.deepTeal, halo: '#E1EAEB' },
    consultations: { dot: '#6E993B', halo: '#DAE4CB' },
    litigations: { dot: '#BA812E', halo: '#F6EFE1' },
    investigation: { dot: '#3D88E2', halo: '#87BCEE' },
    other: { dot: '#9558CF', halo: '#D6BFEC' },
  },
  domainTint: {
    blue: '#CFE5FA',
    green: '#D7F6E3',
    teal: '#E7EFEF',
    amber: '#F9E8C8',
    grey: '#F5F5F5',
  },
} as const;

/**
 * Brand anchor — matched to the approved Clario identity.
 * primary    = Deep Teal   #005E5E  → 180 100% 18.4314%
 * accentGold = La Rioja    #ABB705  →  64.0449 94.6809% 36.8627%
 * accentTeal = Spring Teal #0DA7A8  → 180.3871 85.6354% 35.4902%
 * The chartreuse accent (#ABB705) lives in its own `accent` ramp (below), wired
 * through the --ds-accent / --ds-on-accent semantic pair so consumers get AA
 * automatically. Swap these triplets (+ `accent`) to white-label the platform.
 */
export const brand = {
  primary: '180 100% 18.4314%', // #005E5E — Deep Teal
  accentGold: '64.0449 94.6809% 36.8627%', // #ABB705 — La Rioja
  accentTeal: '180.3871 85.6354% 35.4902%', // #0DA7A8 — Spring Teal
} as const;

/**
 * Primary ramp — anchored on Spring Teal #0DA7A8 at 400, Deep Teal #005E5E at
 * 600, and Dark Teal #06352F at 700/800. 50 (lightest tint) → 950 (deepest).
 */
export const primary = {
  50: '180 50% 97%',
  100: '180 44% 92%',
  200: '180 45% 82%',
  300: '180 48% 67%',
  400: '180.3871 85.6354% 35.4902%', // #0DA7A8 — Spring Teal
  500: '180 80% 28%',
  600: '180 100% 18.4314%', // #005E5E — Deep Teal
  700: '172.3404 79.661% 11.5686%', // #06352F — Dark Teal
  800: '172.3404 79.661% 11.5686%', // #06352F — Dark Teal
  900: '180 78% 10%',
  950: '180 82% 7%',
} as const;

/**
 * Accent ramp — chartreuse, anchored on the public-site #ABB705 (accent-500). This
 * drives active-nav indicators, selected states, focus glow (on dark), the mark's
 * aperture, and key CTAs that must pop. CRITICAL A11Y: chartreuse is light and
 * fails as text-on-white. It is a FILL colour only — always paired with a
 * DARK foreground (see --ds-on-accent = deep-teal near-black, ~8.4:1). 600→950 are
 * the darkened steps usable as accent text/icons on light where needed.
 */
export const accent = {
  50: '73.3333 100% 98.2353%',
  100: '66 70% 91%',
  200: '65 65% 79%',
  300: '65 70% 64%',
  400: '64 80% 49%',
  500: '64.0449 94.6809% 36.8627%', // #ABB705 — public-site secondary
  600: '64 90% 31%',
  700: '64 90% 25%',
  800: '64 86% 20%',
  900: '64 82% 15%',
  950: '64 78% 10%',
} as const;

/** Legacy "gold" alias now resolves to the one approved chartreuse secondary. */
export const gold = {
  ...accent,
} as const;

/** Spring Teal ramp, retaining the legacy numbered alias for call sites. */
export const teal = {
  ...primary,
  500: brand.accentTeal,
  600: brand.accentTeal,
  700: brand.primary,
  800: primary[800],
} as const;

/**
 * Neutral ramp — anchored on Milk, Grey Light, Grey Dark, and Dark Teal.
 */
export const neutral = {
  0: '0 0% 100%',
  50: '73.3333 100% 98.2353%', // #FDFFF6 — public-site canvas
  100: '154.2857 8.2353% 94%', // Milk → Grey Light derived tint
  150: '154.2857 8.2353% 89%',
  200: '154.2857 8.2353% 86%',
  300: '154.2857 8.2353% 83.3333%', // #D1D8D5 — Grey Light
  400: '170 12% 66%',
  500: '160 5.2632% 44.7059%', // #6C7874 — Grey Dark
  600: '171 13% 39%',
  700: '175 20% 30%',
  800: '178 40% 20%',
  850: '180 55% 16%',
  900: '172.3404 79.661% 11.5686%', // #06352F — Dark Teal
  950: '180 82% 7%',
} as const;

/**
 * Semantic state ramps (success / warning / error / info).
 * `success` is an EMERALD (hue ~160), deliberately shifted off the leaf-green
 * brand accent (hue ~85) so a green "success" badge is never confused with a
 * brand-green highlight. Warning amber / error red / info blue stay distinct.
 */
export const success = {
  50: '152 76% 96%',
  100: '149 72% 89%',
  300: '156 68% 58%',
  500: '160 84% 39%', // #10b981 emerald — canonical success
  600: '161 84% 30%', // #059669
  700: '163 90% 22%',
} as const;

export const warning = {
  50: '38 92% 96%',
  100: '38 92% 88%',
  300: '38 92% 68%',
  500: '38 92% 50%',
  600: '34 92% 44%',
  700: '30 90% 36%',
  800: '30 90% 30%', // amber text on the warning-500/0.14 badge tint (AA, 5.79:1)
} as const;

export const error = {
  50: '0 84% 97%',
  100: '0 84% 92%',
  300: '0 84% 72%',
  500: '0 72% 51%',
  600: '0 72% 44%',
  700: '0 70% 36%',
} as const;

/** Info ramp — a true blue (hue ~206), nudged bluer than the old sky so it reads
 *  clearly distinct from the teal brand (hue ~180). */
export const info = {
  50: '206 90% 96%',
  100: '206 90% 89%',
  300: '206 90% 70%',
  500: '206 90% 48%',
  600: '208 90% 42%',
  700: '210 90% 34%',
} as const;

/* ========================================================================== */
/* 2. PRIMITIVE TYPOGRAPHY                                                     */
/* ========================================================================== */

/**
 * Font families. DIN Next (client-licensed) LEADS every stack: DIN Next LT Pro
 * for Latin interface + display text, DIN Next LT Arabic for `ar`. The
 * `--font-sans` / `--font-arabic` vars (globals.css :root) are already DIN-first
 * with Inter / IBM Plex Sans Arabic as the fallback face, and the literal DIN
 * family is listed first here too so the intent is explicit. Fallback faces are
 * loaded through next/font (Inter → `--font-inter`, IBM Plex Sans Arabic →
 * `--font-ibm-arabic`, see app/layout.tsx). Until the licensed DIN .woff2 files
 * land in public/fonts the interface renders in the fallback with no build break.
 */
export const fontFamily = {
  sans: [
    'DIN Next LT Pro',
    'var(--font-sans)',
    'Inter',
    'Segoe UI',
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    'Helvetica Neue',
    'Arial',
    'IBM Plex Sans Arabic',
    'Noto Sans Arabic',
    'Tahoma',
    'ui-sans-serif',
    'sans-serif',
  ],
  display: [
    'DIN Next LT Pro',
    'var(--font-display)',
    'Inter',
    'Segoe UI',
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    'Helvetica Neue',
    'Arial',
    'ui-sans-serif',
    'sans-serif',
  ],
  arabic: [
    'DIN Next LT Arabic',
    'var(--font-arabic)',
    'IBM Plex Sans Arabic',
    'Noto Sans Arabic',
    'Tahoma',
    'var(--font-sans)',
    'Inter',
    'Arial',
    'ui-sans-serif',
    'sans-serif',
  ],
  mono: [
    'var(--font-mono)',
    'ui-monospace',
    'SFMono-Regular',
    'Menlo',
    'Monaco',
    'Consolas',
    'Liberation Mono',
    'monospace',
  ],
} as const;

/** Weight scale. */
export const fontWeight = {
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

/**
 * Type scale — display → caption. Each entry pairs size with line-height and
 * letter-spacing for an end-to-end documented rhythm. Tuple form is consumed
 * directly by Tailwind `theme.fontSize`.
 */
export const fontSize = {
  display: ['3rem', { lineHeight: '1.05', letterSpacing: '-0.022em' }],
  h1: ['2.25rem', { lineHeight: '1.12', letterSpacing: '-0.02em' }],
  h2: ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.018em' }],
  h3: ['1.375rem', { lineHeight: '1.28', letterSpacing: '-0.012em' }],
  h4: ['1.125rem', { lineHeight: '1.4', letterSpacing: '-0.006em' }],
  'body-lg': ['1.0625rem', { lineHeight: '1.6', letterSpacing: '0' }],
  body: ['0.9375rem', { lineHeight: '1.6', letterSpacing: '0' }],
  'body-sm': ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0.002em' }],
  caption: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.01em' }],
  overline: ['0.6875rem', { lineHeight: '1.3', letterSpacing: '0.08em' }],
} as const;

/**
 * Letter-spacing scale for uppercase labels/eyebrows. New key names only, so
 * these are ADDITIVE to Tailwind's default tracking-* scale (nothing clobbered).
 * Routes ad-hoc `tracking-[Nem]` literals onto named, intentional steps.
 */
export const letterSpacing = {
  label: '0.08em', // overline / eyebrow tracking as a standalone step
  caps: '0.12em', // uppercase dl / section labels
  'caps-wide': '0.16em', // micro uppercase (e.g. hash group labels)
  'caps-xwide': '0.2em', // extra-wide uppercase (eyebrow/kicker stat labels)
} as const;

/* ========================================================================== */
/* 3. PRIMITIVE SPACING (8pt rhythm)                                          */
/* ========================================================================== */

/**
 * Spacing scale on an 8pt grid (with 2pt/4pt half-steps for fine control). Keys
 * are multiples of the base step; `section` is the generous page/section padding
 * rhythm that defines the open enterprise-SaaS layout feel.
 */
export const spacing = {
  0: '0px',
  px: '1px',
  0.5: '0.125rem', // 2px
  1: '0.25rem', // 4px
  1.5: '0.375rem', // 6px
  2: '0.5rem', // 8px  — base step
  3: '0.75rem', // 12px
  4: '1rem', // 16px
  5: '1.25rem', // 20px
  6: '1.5rem', // 24px
  8: '2rem', // 32px
  10: '2.5rem', // 40px
  12: '3rem', // 48px
  16: '4rem', // 64px
  20: '5rem', // 80px
  24: '6rem', // 96px
  // Named layout rhythm tokens
  gutter: '1.5rem', // 24px — default content gutter
  'section-y': '4rem', // 64px — vertical section padding
  'section-x': '2rem', // 32px — horizontal section padding
  'card-padding': '1.5rem', // 24px — default card inner padding
} as const;

/* ========================================================================== */
/* 4. PRIMITIVE RADII                                                          */
/* ========================================================================== */

/** Soft, rounded-card radius scale. `card`/`button`/`input`/`pill` are the
 *  named component radii that downstream primitives reference. */
export const radius = {
  none: '0px',
  xs: '0.25rem', // 4px
  sm: '0.375rem', // 6px
  md: '0.5rem', // 8px
  lg: '0.75rem', // 12px — base (--radius)
  xl: '1rem', // 16px
  '2xl': '1.25rem', // 20px
  '3xl': '1.5rem', // 24px
  input: '0.625rem', // 10px
  button: '0.625rem', // 10px
  card: '1rem', // 16px — soft rounded card
  panel: '1.5rem', // 24px — large surface panel
  pill: '9999px',
} as const;

/** Explicit geometry contract for the Watheeq Legal Director dashboard. */
export const watheeqLegalDirectorGeometry = {
  baseSpacing: '0.5rem', // 8px
  cardRadius: '1rem', // 16px
  kpiCardRadius: '0.875rem', // 14px
  pillRadius: '9999px',
  cardBorderWidth: '1px',
  elevation: 'none',
} as const;

/**
 * Approved dashboard type scale. These values were proposed at the Step 2
 * review gate and explicitly approved before primitive implementation.
 */
export const watheeqLegalDirectorTypography = {
  kpi: { fontSize: '3rem', lineHeight: '3.25rem' }, // 48 / 52px
  label: {
    fontSize: '0.8125rem',
    lineHeight: '1.125rem',
    letterSpacing: '0.06em',
  }, // 13 / 18px
  panelTitle: { fontSize: '1.375rem', lineHeight: '1.75rem' }, // 22 / 28px
  body: { fontSize: '0.875rem', lineHeight: '1.25rem' }, // 14 / 20px
  caption: { fontSize: '0.75rem', lineHeight: '1.0625rem' }, // 12 / 17px
  heading: { fontSize: '2.125rem', lineHeight: '2.625rem' }, // 34 / 42px
} as const;

/* ========================================================================== */
/* 5. PRIMITIVE ELEVATION (layered card shadows)                              */
/* ========================================================================== */

/**
 * Subtle, layered soft-elevation shadow set. Each level composes a tight
 * key shadow with a softer ambient one. `0` is none; `1`→`5` rise. The dark
 * variants deepen the ambient layer (defined again in `darkTheme.elevation`).
 */
export const elevationLight = {
  0: 'none',
  1: '0 1px 2px -1px rgba(15, 23, 42, 0.08), 0 1px 3px -1px rgba(15, 23, 42, 0.06)',
  2: '0 2px 4px -2px rgba(15, 23, 42, 0.08), 0 6px 16px -8px rgba(15, 23, 42, 0.10)',
  3: '0 4px 8px -3px rgba(15, 23, 42, 0.10), 0 12px 28px -10px rgba(15, 23, 42, 0.12)',
  4: '0 8px 16px -6px rgba(15, 23, 42, 0.12), 0 20px 44px -16px rgba(15, 23, 42, 0.16)',
  5: '0 16px 32px -10px rgba(15, 23, 42, 0.16), 0 32px 72px -24px rgba(15, 23, 42, 0.22)',
  // Two-layer offset focus ring: a page-coloured gap (neutral-50) then a
  // full-opacity interactive-teal outline, so the visible ring itself clears
  // WCAG 1.4.11 (the old 35%-alpha teal computed ~1.76:1 on white). Leaf green
  // would fail on white so the ring is teal, not the accent.
  focus: '0 0 0 2px hsl(73.3333 100% 98.2353%), 0 0 0 4px hsl(180 100% 18.4314%)',
} as const;

export const elevationDark = {
  0: 'none',
  1: '0 1px 2px -1px rgba(0, 0, 0, 0.5), 0 1px 3px -1px rgba(0, 0, 0, 0.4)',
  2: '0 2px 6px -2px rgba(0, 0, 0, 0.5), 0 8px 20px -8px rgba(0, 0, 0, 0.55)',
  3: '0 4px 10px -3px rgba(0, 0, 0, 0.55), 0 16px 34px -12px rgba(0, 0, 0, 0.6)',
  4: '0 8px 20px -6px rgba(0, 0, 0, 0.6), 0 26px 54px -18px rgba(0, 0, 0, 0.66)',
  5: '0 16px 38px -10px rgba(0, 0, 0, 0.66), 0 40px 84px -26px rgba(0, 0, 0, 0.72)',
  // Two-layer offset focus ring for dark surfaces: a canvas-coloured gap
  // (neutral-950) then the full-opacity lifted teal (brighter than the
  // light-mode ring) so it clears 3:1 against deep-teal/near-black canvases.
  focus: '0 0 0 2px hsl(180 82% 7%), 0 0 0 4px hsl(180 55% 46%)',
} as const;

/* ========================================================================== */
/* 6. PRIMITIVE MOTION                                                         */
/* ========================================================================== */

/** Durations (ms). */
export const duration = {
  instant: '80ms',
  fast: '140ms', // hover / press feedback
  normal: '220ms', // default UI transition
  slow: '320ms', // panel / drawer
  reveal: '480ms', // scroll-reveal
  status: '600ms', // live-status / heartbeat transition
} as const;

/** Easing curves. */
export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)', // material standard
  emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  decelerate: 'cubic-bezier(0, 0, 0, 1)', // entering
  accelerate: 'cubic-bezier(0.3, 0, 1, 1)', // exiting
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // gentle overshoot
} as const;

/* ========================================================================== */
/* 6b. BRAND EFFECTS (gradients + glow)                                        */
/* ========================================================================== */

/**
 * Materialised brand effects — composed only from Deep Teal #005E5E, Dark Teal
 * #06352F, Spring Teal #0DA7A8, and La Rioja #ABB705.
 * These give buttons, cards and accents a recognisable finish while staying
 * token-bound:
 *  - gradientPrimary: the default CTA / brand-surface gradient (deep → dark teal;
 *    white foreground clears AA on every stop).
 *  - gradientAccent: the chartreuse accent gradient (for pop CTAs / hero marks —
 *    always paired with DARK foreground, never green text on it).
 *  - gradientGold: compatibility alias for the chartreuse accent gradient.
 *  - shadowGlowPrimary: a soft teal-coloured glow for elevated/active surfaces.
 * Theme-agnostic literals (the same gradient reads on light and dark surfaces);
 * the glow is alpha-based so it composites over either canvas.
 */
export const brandEffects = {
  gradientPrimary: 'linear-gradient(135deg, #005E5E 0%, #06352F 100%)',
  gradientAccent: 'linear-gradient(135deg, #ABB705 0%, #0DA7A8 100%)',
  gradientGold: 'linear-gradient(135deg, #ABB705 0%, #005E5E 100%)',
  shadowGlowPrimary: '0 10px 30px -10px rgba(0, 94, 94, 0.38), 0 2px 8px -2px rgba(6, 53, 47, 0.28)',
  // Softer, lower-alpha companion to shadowGlowPrimary — for resting/hover lift on
  // surfaces (cards) where the full CTA glow would read too hot.
  shadowGlowSoft: '0 10px 28px -14px rgba(0, 94, 94, 0.22), 0 2px 10px -6px rgba(6, 53, 47, 0.14)',
  // Brand surface tint — a single very-low-alpha teal wash colour, applied as a
  // gradient stop over card/surface backgrounds so every panel inherits a hint of
  // the brand without a hardcoded hex. Composites over light + dark canvases.
  surfaceTint: 'rgba(0, 94, 94, 0.05)',
} as const;

/* ========================================================================== */
/* 7. SEMANTIC THEMES (light + derived dark)                                  */
/* ========================================================================== */

export interface SemanticColorTheme {
  /** Layered background/surface tokens. */
  background: {
    page: string; // app canvas
    subtle: string; // muted page section
    inset: string; // sunken well
  };
  surface: {
    card: string; // default card
    raised: string; // popover / dropdown / dialog
    sunken: string; // input wells, inset rows
    overlay: string; // scrim base (with alpha applied downstream)
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    inverted: string;
    onPrimary: string;
    onAccent: string;
  };
  border: {
    subtle: string;
    default: string;
    strong: string;
    /** Form-control boundary (inputs/selects) — heavier than `default` so
     *  control edges reach ~3:1 (WCAG 1.4.11) without darkening hairlines. */
    input: string;
    focus: string;
  };
  brand: {
    primary: string;
    primaryHover: string;
    primaryActive: string;
    /** Leaf-green highlight (fill only — always pair with `text.onAccent`). */
    accent: string;
    accentGold: string;
    accentTeal: string;
  };
  state: {
    success: string;
    warning: string;
    error: string;
    info: string;
  };
}

/** LIGHT theme — assigns primitives to semantic roles. */
export const lightTheme: SemanticColorTheme = {
  background: {
    page: neutral[50],
    subtle: neutral[100],
    inset: neutral[150],
  },
  surface: {
    card: neutral[0],
    raised: neutral[0],
    sunken: neutral[100],
    overlay: neutral[900],
  },
  text: {
    primary: primary[800], // #06352F — Dark Teal
    secondary: neutral[500], // #6C7874 — Grey Dark
    // Canonical Grey Dark. Reserve this for supporting/disabled copy.
    muted: neutral[500], // #6C7874
    inverted: neutral[0],
    onPrimary: neutral[0],
    // Deep-teal near-black foreground for ON the leaf-green accent (dark-on-green
    // ≈ 8.4:1). Leaf green is never used as a text colour on white; only as a fill
    // beneath this dark foreground.
    onAccent: primary[800],
  },
  border: {
    subtle: neutral[150],
    default: neutral[300], // #D1D8D5 — Grey Light
    strong: neutral[500],
    input: neutral[500],
    focus: primary[600],
  },
  brand: {
    primary: primary[600],
    primaryHover: primary[700],
    primaryActive: primary[800],
    accent: accent[500],
    accentGold: gold[500],
    accentTeal: teal[600],
  },
  state: {
    success: success[500],
    warning: warning[500],
    error: error[500],
    info: info[500],
  },
};

/** DARK theme — same primitives, roles flipped/lifted for AA contrast. */
export const darkTheme: SemanticColorTheme = {
  background: {
    page: neutral[950],
    subtle: neutral[900],
    inset: neutral[850],
  },
  surface: {
    card: neutral[900],
    raised: neutral[850],
    sunken: neutral[950],
    overlay: neutral[950],
  },
  text: {
    primary: neutral[50],
    secondary: neutral[300],
    muted: neutral[400],
    inverted: neutral[950],
    // Primary actions stay on the canonical #005E5E in both themes, so their
    // foreground remains the exact cream canvas instead of flipping dark.
    onPrimary: neutral[50],
    // Leaf green is light in both themes, so the on-accent foreground stays a
    // deep-teal near-black on dark surfaces too (dark-on-green ≈ 8.6:1).
    onAccent: primary[800],
  },
  border: {
    subtle: neutral[850],
    default: neutral[800],
    strong: neutral[700],
    input: neutral[500],
    focus: primary[400],
  },
  brand: {
    // Interactive brand anchors do not drift in dark mode. Every button state
    // resolves to one of the approved, exact public-site colours.
    primary: primary[600], // #005E5E
    primaryHover: primary[700], // #06352F
    primaryActive: primary[800], // #06352F
    accent: accent[500], // #ABB705
    accentGold: gold[500],
    accentTeal: teal[600],
  },
  state: {
    success: success[300],
    warning: warning[300],
    error: error[300],
    info: info[300],
  },
};

/* ========================================================================== */
/* 8. RESOLVED HEX (SVG / canvas / recharts — cannot resolve var())           */
/* ========================================================================== */

/** Resolved brand hex anchors and backwards-compatible semantic aliases. */
export const brandHex = {
  ...brandPalette,
  primary: brandPalette.deepTeal,
  primaryDark: brandPalette.darkTeal,
  accent: brandPalette.laRioja,
  accentGold: brandPalette.laRioja,
  accentTeal: brandPalette.springTeal,
  canvas: brandPalette.milk,
  tint: brandPalette.greyLight,
  border: brandPalette.greyLight,
  text: brandPalette.darkTeal,
  muted: brandPalette.greyDark,
} as const;

/* ========================================================================== */
/* 9. AGGREGATE EXPORT                                                         */
/* ========================================================================== */

/** Every primitive, in one object — consumed by the Tailwind + CSS emitters. */
export const primitives = {
  brand,
  primary,
  accent,
  gold,
  teal,
  neutral,
  success,
  warning,
  error,
  info,
  fontFamily,
  fontWeight,
  fontSize,
  letterSpacing,
  spacing,
  radius,
  elevationLight,
  elevationDark,
  duration,
  easing,
  brandEffects,
} as const;

/** Both semantic themes. */
export const themes = {
  light: lightTheme,
  dark: darkTheme,
} as const;

export type ThemeName = keyof typeof themes;

/** Page-specific contract kept alongside the platform primitives it reuses. */
export const watheeqLegalDirector = {
  colors: watheeqLegalDirectorColors,
  geometry: watheeqLegalDirectorGeometry,
  typography: watheeqLegalDirectorTypography,
} as const;

/** The full design-token config object (primitives + semantic themes). */
export const tokens = {
  brandPalette,
  actionPalette,
  watheeqLegalDirector,
  primitives,
  themes,
  brandHex,
} as const;

export type DesignTokens = typeof tokens;

export default tokens;
