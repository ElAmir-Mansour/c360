import { useId } from 'react';

/**
 * Clario360 aperture mark — the standalone brand glyph.
 *
 * A leaf-green disc, sliced by horizontal gaps into concentric strata, with a
 * hollow circular aperture punched through the centre. It evokes the brand
 * story: layered technology / an end-to-end, full-lifecycle solution. It is the
 * "o" of the clario360 wordmark and doubles as the app icon, favicon, collapsed
 * sidebar glyph and loading splash.
 *
 * Rendering notes:
 *  - The strata are painted as a single filled disc that is *masked* down to
 *    "disc − aperture − gaps". The gaps are TRANSPARENT (never painted with a
 *    background colour) so the mark drops cleanly onto any surface: leaf-green
 *    on light, near-white on the deep-teal sidebar, or mono/currentColor.
 *  - Two levels of detail keep it crisp from 16px to 240px:
 *      · `full`    — 5 strata, for ≥ ~26px (standalone mark, splash, app icon)
 *      · `compact` — 3 bolder strata, for ≤ ~24px (favicon, the wordmark "o")
 *    Below ~24px the thin full-detail gaps alias into mud, so the compact mark
 *    trades band count for legibility while keeping the banded-donut identity.
 *
 * Brand colour lives literally in this file on purpose: a logo legitimately
 * carries its own brand hex. Everything else in the app consumes --ds-* tokens.
 * These literals mirror the public Clario360 palette:
 *   teal (ink)   #005E5E
 *   leaf (glyph) #ABB705
 *   on-dark ink  #FDFFF6
 */

/** Deck-palette brand literals — the one place hardcoded brand hex is correct. */
export const BRAND = {
  /** Deep teal — dominant brand colour (mirrors --ds-primary). */
  teal: '#005E5E',
  /** Leaf green — accent / the aperture glyph (mirrors --ds-accent). */
  leaf: '#ABB705',
  /** Near-white ink for deep-teal / dark surfaces (AA on teal). */
  onDarkInk: '#FDFFF6',
} as const;

export type LogoTone = 'color' | 'onDark' | 'mono' | 'light' | 'auto';

/** Resolved fills for a tone. `light` is a back-compat alias of `onDark`. */
export interface ToneFills {
  /** Wordmark letterforms + any ink. */
  ink: string;
  /** The aperture strata. */
  aperture: string;
}

export function resolveTone(tone: Exclude<LogoTone, 'auto'>): ToneFills {
  if (tone === 'color') return { ink: BRAND.teal, aperture: BRAND.leaf };
  if (tone === 'mono') return { ink: 'currentColor', aperture: 'currentColor' };
  // 'onDark' | 'light': near-white text on deep teal; leaf aperture stays the accent.
  return { ink: BRAND.onDarkInk, aperture: BRAND.leaf };
}

/**
 * Aperture geometry, authored in an 80×80 box (centre 40,40). Gaps are the
 * transparent slices between strata; the aperture is the punched-out hole.
 */
interface ApertureGeometry {
  disc: number;
  hole: number;
  /** y-top of each transparent gap rect (full-width, clipped by the disc). */
  gaps: number[];
  gapHeight: number;
}

const FULL: ApertureGeometry = {
  disc: 34,
  hole: 13,
  gaps: [20.5, 32.5, 44.5, 56.5],
  gapHeight: 3,
};

const COMPACT: ApertureGeometry = {
  disc: 36,
  hole: 15,
  gaps: [26, 48],
  gapHeight: 6,
};

/**
 * The masked banded disc, authored in the 80×80 box. Renders nothing but the
 * glyph geometry (no <svg> wrapper) so it can be embedded in the wordmark or an
 * <svg> of any viewBox. `uid` must be unique per rendered instance.
 */
export function ApertureGlyph({
  uid,
  fill,
  compact = false,
}: {
  uid: string;
  fill: string;
  compact?: boolean;
}) {
  const g = compact ? COMPACT : FULL;
  const maskId = `${uid}-ap`;
  return (
    <>
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="80"
        height="80"
      >
        {/* reveal everything… */}
        <rect x="0" y="0" width="80" height="80" fill="#fff" />
        {/* …then punch the central aperture… */}
        <circle cx="40" cy="40" r={g.hole} fill="#000" />
        {/* …and cut the transparent strata gaps. */}
        {g.gaps.map((y) => (
          <rect key={y} x="0" y={y} width="80" height={g.gapHeight} fill="#000" />
        ))}
      </mask>
      <circle cx="40" cy="40" r={g.disc} fill={fill} mask={`url(#${maskId})`} />
    </>
  );
}

export interface ApertureMarkProps {
  /** Colour treatment. `color` = leaf on light · `onDark`/`light` = leaf on teal · `mono` = currentColor. */
  tone?: Exclude<LogoTone, 'auto'>;
  /** Override the strata fill directly (e.g. `#fff` for the app-icon chip). Wins over `tone`. */
  color?: string;
  /** Use the bolder 3-strata mark for ≤24px renders (favicon, tiny chips). */
  compact?: boolean;
  /** Convenience square pixel size. Prefer `className`. */
  size?: number;
  className?: string;
  /** Accessible label; ignored when `decorative`. */
  title?: string;
  /** aria-hidden decorative glyph — use when adjacent text already names the brand. */
  decorative?: boolean;
}

/**
 * `<ApertureMark />` — the aperture glyph alone, wrapped in its own <svg>.
 * The icon for the collapsed sidebar, favicon, app icon and loading splash.
 */
export function ApertureMark({
  tone = 'color',
  color,
  compact = false,
  size,
  className,
  title = 'Clario360',
  decorative = false,
}: ApertureMarkProps) {
  const uid = useId();
  const fill = color ?? resolveTone(tone).aperture;

  const a11y = decorative
    ? { 'aria-hidden': true as const, role: 'presentation' as const }
    : { role: 'img' as const, 'aria-label': title };

  return (
    <svg
      viewBox="0 0 80 80"
      className={className}
      style={size ? { height: size, width: size } : undefined}
      {...a11y}
    >
      {!decorative && <title>{title}</title>}
      <ApertureGlyph uid={uid} fill={fill} compact={compact} />
    </svg>
  );
}

/**
 * Back-compat alias for the task's literal spelling ("AptertureMark"). Points at
 * the same component so importers using either name compile.
 */
export const AptertureMark = ApertureMark;

export default ApertureMark;
