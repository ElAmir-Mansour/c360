/**
 * ClarioDR Design System — CSS custom-property emitter
 * ====================================================
 *
 * Serialises the token source of truth into the `--ds-*` CSS custom properties
 * that `globals.css` consumes. Kept as a pure function so a build/verify script
 * can regenerate the `:root` / `.dark` blocks and diff them against the checked-
 * in `tokens.css`, guaranteeing the CSS never drifts from `index.ts`.
 *
 * The emitted property names match exactly the `var(--ds-*)` references in
 * `tailwind.ts` (`dsVar(...)`), so Tailwind utilities and raw CSS resolve to the
 * same value.
 */

import {
  actionPalette,
  brandHex,
  watheeqLegalDirector,
  primitives,
  lightTheme,
  darkTheme,
  type SemanticColorTheme,
} from './index';

/** Convert a canonical #RRGGBB brand value into lossless CSS RGB channels. */
function hexToRgbChannels(hex: string): string {
  const normalized = hex.replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`Expected a six-digit hex colour, received "${hex}"`);
  }
  return [0, 2, 4]
    .map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
    .join(' ');
}

/** Flatten a primitive ramp into `--ds-<prefix>-<step>: <triplet>;` lines. */
function rampVars(prefix: string, scale: Record<string | number, string>): string[] {
  return Object.entries(scale).map(([step, triplet]) => `--ds-${prefix}-${step}: ${triplet};`);
}

/** Theme-agnostic primitive vars (ramps, radii, spacing, type, motion). */
export function primitiveVars(): string[] {
  const lines: string[] = [];

  lines.push('/* Brand ramps (theme-agnostic HSL triplets) */');
  lines.push(...rampVars('primary', primitives.primary));
  lines.push(...rampVars('accent', primitives.accent));
  lines.push(...rampVars('gold', primitives.gold));
  lines.push(...rampVars('teal', primitives.teal));
  lines.push(...rampVars('neutral', primitives.neutral));
  lines.push(...rampVars('success', primitives.success));
  lines.push(...rampVars('warning', primitives.warning));
  lines.push(...rampVars('error', primitives.error));
  lines.push(...rampVars('info', primitives.info));

  lines.push('/* Radii */');
  for (const [k, v] of Object.entries(primitives.radius)) {
    lines.push(`--ds-radius-${k}: ${v};`);
  }

  lines.push('/* Spacing rhythm */');
  for (const [k, v] of Object.entries(primitives.spacing)) {
    lines.push(`--ds-space-${k}: ${v};`);
  }

  lines.push('/* Motion */');
  for (const [k, v] of Object.entries(primitives.duration)) {
    lines.push(`--ds-duration-${k}: ${v};`);
  }
  for (const [k, v] of Object.entries(primitives.easing)) {
    lines.push(`--ds-ease-${k}: ${v};`);
  }

  lines.push('/* Brand effects (gradients + glow) */');
  lines.push(`--ds-gradient-primary: ${primitives.brandEffects.gradientPrimary};`);
  lines.push(`--ds-gradient-accent: ${primitives.brandEffects.gradientAccent};`);
  lines.push(`--ds-gradient-gold: ${primitives.brandEffects.gradientGold};`);
  lines.push(`--ds-shadow-glow-primary: ${primitives.brandEffects.shadowGlowPrimary};`);
  lines.push(`--ds-shadow-glow-soft: ${primitives.brandEffects.shadowGlowSoft};`);
  lines.push(`--ds-surface-tint: ${primitives.brandEffects.surfaceTint};`);

  return lines;
}

/**
 * Raw-value DS tokens (exact-preserving). These hold literal colours as
 * space-separated sRGB channels ("R G B"), NOT HSL triplets, so migrated
 * utilities render the *exact* hex that was hardcoded inline with zero rounding
 * drift (RGB↔hex is lossless). They are wrapped as `rgb(var(--ds-*) / <alpha>)`
 * in tailwind.ts so Tailwind's `<alpha-value>` opacity modifier keeps working.
 * Theme-agnostic: identical in light + dark, so there is no `.dark` override. The
 * CTI navy steps form a coherent auth-canvas ramp.
 *
 * Emitted here (not just hand-written in tokens.css) so `generate-tokens.mjs`
 * is idempotent and never drops them on regeneration.
 */
export function rawValueVars(): string[] {
  return [
    '/* ------------------------------------------------------------------------',
    ' * Raw-value DS tokens (exact-preserving "R G B" sRGB channels).',
    ' *   clario-*            canonical public-site palette (brandHex)',
    ' *   brand-bright       #ABB705   neutral-ink        #06352F',
    ' *   legacy-green-600   #059669   legacy-green-800   #065F46',
    ' *   legacy-green-50    #ECFDF5   auth-dark          #06352F',
    ' *   auth-dark-raised   #005E5E   auth-teal          #005E5E',
    ' *   table-header       #FDFFF6',
    ' *   cti-navy 900 #0b1830 / 925 #081426 / 930 #07162a / 940 #071421',
    ' *            945 #07111f / 950 #050d18 / 980 #040811',
    ' * ---------------------------------------------------------------------- */',
    // Canonical public-site palette. These are derived from brandHex so Button
    // utilities render the supplied values byte-for-byte with no HSL rounding.
    `--ds-clario-primary: ${hexToRgbChannels(brandHex.primary)};`,
    `--ds-clario-dark-teal: ${hexToRgbChannels(brandHex.primaryDark)};`,
    `--ds-clario-accent: ${hexToRgbChannels(brandHex.accent)};`,
    `--ds-clario-spring-teal: ${hexToRgbChannels(brandHex.springTeal)};`,
    `--ds-clario-canvas: ${hexToRgbChannels(brandHex.canvas)};`,
    `--ds-clario-tint: ${hexToRgbChannels(brandHex.tint)};`,
    `--ds-clario-border: ${hexToRgbChannels(brandHex.border)};`,
    `--ds-clario-ink: ${hexToRgbChannels(brandHex.text)};`,
    `--ds-clario-muted: ${hexToRgbChannels(brandHex.muted)};`,
    // User-approved primary action green and its interaction states.
    `--ds-action-primary: ${hexToRgbChannels(actionPalette.primary)};`,
    `--ds-action-primary-hover: ${hexToRgbChannels(actionPalette.hover)};`,
    `--ds-action-primary-active: ${hexToRgbChannels(actionPalette.active)};`,
    // Approved Clario chartreuse used for high-emphasis indicators.
    '--ds-brand-bright: 171 183 5;',
    `--ds-neutral-ink: ${hexToRgbChannels(brandHex.darkTeal)};`,
    // legacy-green ramp re-pointed forest-green (#2E7D32/#1B5E20/#F2F7F3) → success
    // emerald (#059669/#065F46/#ECFDF5) for Watheeq brand alignment. The `legacy-green-*`
    // Tailwind utility is STILL CONSUMED (workflow "completed", data-suite low-risk/public,
    // cyber rule-type, avatar hash), so the ramp is re-pointed — NOT removed — and lands on
    // the platform's canonical success emerald so genuine success signals stay green (rule 4).
    '--ds-legacy-green-600: 5 150 105;',
    '--ds-legacy-green-800: 6 95 70;',
    '--ds-legacy-green-50: 236 253 245;',
    `--ds-auth-dark: ${hexToRgbChannels(brandHex.darkTeal)};`,
    `--ds-auth-dark-raised: ${hexToRgbChannels(brandHex.deepTeal)};`,
    `--ds-auth-teal: ${hexToRgbChannels(brandHex.deepTeal)};`,
    `--ds-table-header: ${hexToRgbChannels(brandHex.milk)};`,
    '--ds-cti-navy-900: 11 24 48;',
    '--ds-cti-navy-925: 8 20 38;',
    '--ds-cti-navy-930: 7 22 42;',
    '--ds-cti-navy-940: 7 20 33;',
    '--ds-cti-navy-945: 7 17 31;',
    '--ds-cti-navy-950: 5 13 24;',
    '--ds-cti-navy-980: 4 8 17;',
  ];
}

/** Exact CSS custom properties for WLS-UI-SPEC-LD-001. */
export function watheeqLegalDirectorVars(): string[] {
  const { colors, geometry, typography } = watheeqLegalDirector;

  return [
    '/* Watheeq Legal Director dashboard (WLS-UI-SPEC-LD-001) */',
    `--wt-teal-900: ${colors.teal[900]};`,
    `--wt-teal-700: ${colors.teal[700]};`,
    `--wt-teal-600: ${colors.teal[600]};`,
    `--wt-teal-300: ${colors.teal[300]};`,
    `--wt-lime-500: ${colors.lime[500]};`,
    `--wt-nav-active: ${colors.navActive};`,
    `--wt-canvas: ${colors.canvas};`,
    `--wt-surface: ${colors.surface};`,
    `--wt-track: ${colors.track};`,
    `--wt-track-alt: ${colors.trackAlt};`,
    `--wt-critical: ${colors.status.critical};`,
    `--wt-critical-050: ${colors.status.critical050};`,
    `--wt-high: ${colors.status.high};`,
    `--wt-medium: ${colors.status.medium};`,
    `--wt-ok: ${colors.status.ok};`,
    `--wt-ok-050: ${colors.status.ok050};`,
    `--wt-ok-400: ${colors.status.ok400};`,
    `--wt-warn-050: ${colors.status.warn050};`,
    `--wt-service-contracts-dot: ${colors.serviceRequest.contracts.dot};`,
    `--wt-service-contracts-halo: ${colors.serviceRequest.contracts.halo};`,
    `--wt-service-consultations-dot: ${colors.serviceRequest.consultations.dot};`,
    `--wt-service-consultations-halo: ${colors.serviceRequest.consultations.halo};`,
    `--wt-service-litigations-dot: ${colors.serviceRequest.litigations.dot};`,
    `--wt-service-litigations-halo: ${colors.serviceRequest.litigations.halo};`,
    `--wt-service-investigation-dot: ${colors.serviceRequest.investigation.dot};`,
    `--wt-service-investigation-halo: ${colors.serviceRequest.investigation.halo};`,
    `--wt-service-other-dot: ${colors.serviceRequest.other.dot};`,
    `--wt-service-other-halo: ${colors.serviceRequest.other.halo};`,
    `--wt-domain-blue: ${colors.domainTint.blue};`,
    `--wt-domain-green: ${colors.domainTint.green};`,
    `--wt-domain-teal: ${colors.domainTint.teal};`,
    `--wt-domain-amber: ${colors.domainTint.amber};`,
    `--wt-domain-grey: ${colors.domainTint.grey};`,
    `--wt-space-base: ${geometry.baseSpacing};`,
    `--wt-radius-card: ${geometry.cardRadius};`,
    `--wt-radius-kpi-card: ${geometry.kpiCardRadius};`,
    `--wt-radius-pill: ${geometry.pillRadius};`,
    `--wt-card-border-width: ${geometry.cardBorderWidth};`,
    `--wt-elevation: ${geometry.elevation};`,
    `--wt-font-size-kpi: ${typography.kpi.fontSize};`,
    `--wt-line-height-kpi: ${typography.kpi.lineHeight};`,
    `--wt-font-size-label: ${typography.label.fontSize};`,
    `--wt-line-height-label: ${typography.label.lineHeight};`,
    `--wt-letter-spacing-label: ${typography.label.letterSpacing};`,
    `--wt-font-size-panel-title: ${typography.panelTitle.fontSize};`,
    `--wt-line-height-panel-title: ${typography.panelTitle.lineHeight};`,
    `--wt-font-size-body: ${typography.body.fontSize};`,
    `--wt-line-height-body: ${typography.body.lineHeight};`,
    `--wt-font-size-caption: ${typography.caption.fontSize};`,
    `--wt-line-height-caption: ${typography.caption.lineHeight};`,
    `--wt-font-size-heading: ${typography.heading.fontSize};`,
    `--wt-line-height-heading: ${typography.heading.lineHeight};`,
  ];
}

/** Semantic (theme-aware) vars for one theme. */
export function semanticVars(theme: SemanticColorTheme): string[] {
  return [
    `--ds-bg-page: ${theme.background.page};`,
    `--ds-bg-subtle: ${theme.background.subtle};`,
    `--ds-bg-inset: ${theme.background.inset};`,
    `--ds-surface-card: ${theme.surface.card};`,
    `--ds-surface-raised: ${theme.surface.raised};`,
    `--ds-surface-sunken: ${theme.surface.sunken};`,
    `--ds-surface-overlay: ${theme.surface.overlay};`,
    `--ds-text-primary: ${theme.text.primary};`,
    `--ds-text-secondary: ${theme.text.secondary};`,
    `--ds-text-muted: ${theme.text.muted};`,
    `--ds-text-inverted: ${theme.text.inverted};`,
    `--ds-text-on-primary: ${theme.text.onPrimary};`,
    `--ds-text-on-accent: ${theme.text.onAccent};`,
    `--ds-border-subtle: ${theme.border.subtle};`,
    `--ds-border-default: ${theme.border.default};`,
    `--ds-border-strong: ${theme.border.strong};`,
    `--ds-border-input: ${theme.border.input};`,
    `--ds-border-focus: ${theme.border.focus};`,
    `--ds-brand-primary: ${theme.brand.primary};`,
    `--ds-brand-primary-hover: ${theme.brand.primaryHover};`,
    `--ds-brand-primary-active: ${theme.brand.primaryActive};`,
    // Leaf-green accent + its REQUIRED dark foreground. --ds-accent / --ds-primary-accent
    // are aliases so consumers can grab the highlight by either name; --ds-on-accent is
    // the deep-teal near-black text/icon colour that MUST sit on any accent fill (AA).
    `--ds-brand-accent: ${theme.brand.accent};`,
    `--ds-accent: ${theme.brand.accent};`,
    `--ds-primary-accent: ${theme.brand.accent};`,
    `--ds-on-accent: ${theme.text.onAccent};`,
    `--ds-brand-gold: ${theme.brand.accentGold};`,
    `--ds-brand-teal: ${theme.brand.accentTeal};`,
    `--ds-state-success: ${theme.state.success};`,
    `--ds-state-warning: ${theme.state.warning};`,
    `--ds-state-error: ${theme.state.error};`,
    `--ds-state-info: ${theme.state.info};`,
  ];
}

/** Elevation vars for one theme. */
export function elevationVars(set: Record<string, string>): string[] {
  return Object.entries(set).map(([k, v]) => `--ds-elevation-${k}: ${v};`);
}

/** Render the full `:root` light block (primitives + light semantics + raw vars). */
export function renderLightRoot(): string {
  return [
    ...primitiveVars(),
    ...watheeqLegalDirectorVars(),
    ...semanticVars(lightTheme),
    ...elevationVars(primitives.elevationLight),
    ...rawValueVars(),
  ].join('\n');
}

/** Render the `.dark` overrides (dark semantics + dark elevation). */
export function renderDarkRoot(): string {
  return [...semanticVars(darkTheme), ...elevationVars(primitives.elevationDark)].join('\n');
}
