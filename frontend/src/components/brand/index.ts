/**
 * Clario360 brand kit — the canonical source of truth for the logo.
 *
 *   <Logo />          convenience wrapper (wordmark | mark, tones, adapter)
 *   <Wordmark />      the "clario360" lockup
 *   <ApertureMark />  the aperture glyph alone (icon / favicon / splash)
 *
 * Static assets (favicon, app icon, wordmark SVGs, social mark) live in
 * `public/brand/`; the App Router favicon/app-icon convention files live in
 * `src/app/{icon,apple-icon}.svg`.
 */
export { Logo, default } from './logo';
export type { LogoProps, LogoVariant } from './logo';

export {
  ApertureMark,
  AptertureMark,
  ApertureGlyph,
  resolveTone,
  BRAND,
} from './aperture-mark';
export type {
  ApertureMarkProps,
  LogoTone,
  ToneFills,
} from './aperture-mark';

export { Wordmark } from './wordmark';
export type { WordmarkProps } from './wordmark';
