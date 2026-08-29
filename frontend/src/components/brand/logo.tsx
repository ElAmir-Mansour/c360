import { cn } from '@/lib/utils';
import type { LogoTone } from './aperture-mark';

/**
 * Clario360 brand logo — the single canonical entry point for the APPROVED
 * brand-identity lockups across the whole platform (app chrome, auth, marketing,
 * onboarding, tenant-branding fallback).
 *
 * Renders the brand-team SVGs from `/public/brand` AS-IS (no re-drawing):
 *   · wordmark, Latin   Clario360_logo-colored.svg / Clario360_logo-white.svg
 *   · wordmark, Arabic  clario360-arabic-colored.svg / clario360-arabic-white.svg
 *   · mark (app tile)   fav-icon.svg  (rounded lime tile + white aperture)
 *
 * Direction-aware, SERVER-SAFE (no client hook — the auth layout that renders
 * <Logo> is a Server Component): the Arabic lockup shows under `[dir="rtl"]`,
 * the Latin lockup otherwise, via Tailwind `rtl:` / `ltr:` variants. Tone:
 * `color` on light surfaces · `onDark`/`light` on the deep-teal sidebar ·
 * `auto` swaps color↔white by the class-based dark theme · `mono` falls back to
 * the white lockup (there is no single-colour asset).
 */

export type LogoVariant = 'wordmark' | 'mark';
export type { LogoTone };

export interface LogoProps {
  /** `wordmark` (default) = full clario360 lockup · `mark` = the app-icon tile. */
  variant?: LogoVariant;
  /** `color` (light) · `onDark`/`light` (deep-teal) · `mono` · `auto` (theme-swap). */
  tone?: LogoTone;
  /** Deprecated no-op, kept so pre-existing call sites keep compiling. */
  simplified?: boolean;
  /** Convenience pixel height (width follows the aspect ratio). Prefer `className`. */
  height?: number;
  className?: string;
  /** Accessible label. Defaults to "Clario360"; ignored when `decorative`. */
  title?: string;
  /** Decorative image (aria-hidden, empty alt) — when adjacent text names the brand. */
  decorative?: boolean;
}

const ASSET = {
  colorLatin: '/brand/Clario360_logo-colored.svg',
  whiteLatin: '/brand/Clario360_logo-white.svg',
  colorArabic: '/brand/clario360-arabic-colored.svg',
  whiteArabic: '/brand/clario360-arabic-white.svg',
  mark: '/brand/fav-icon.svg',
} as const;

/**
 * Direction-aware wordmark pair: Latin by default (also when no `dir` ancestor),
 * Arabic under `[dir="rtl"]`. Only the visible one lands in the a11y tree (the
 * other is `display:none`), so a single label is announced.
 */
function WordmarkPair({
  latin,
  arabic,
  className,
  height,
  alt,
  decorative,
}: {
  latin: string;
  arabic: string;
  className?: string;
  height?: number;
  alt: string;
  decorative: boolean;
}) {
  const altText = decorative ? '' : alt;
  const shared = {
    height,
    draggable: false,
    ...(decorative ? { 'aria-hidden': true as const } : {}),
  };
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={latin} alt={altText} className={cn('inline-block rtl:hidden', className)} {...shared} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={arabic} alt={altText} className={cn('hidden rtl:inline-block', className)} {...shared} />
    </>
  );
}

export function Logo({
  variant = 'wordmark',
  tone = 'color',
  height,
  className,
  title = 'Clario360',
  decorative = false,
}: LogoProps) {
  if (variant === 'mark') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={ASSET.mark}
        height={height}
        draggable={false}
        className={className}
        alt={decorative ? '' : title}
        {...(decorative ? { 'aria-hidden': true } : {})}
      />
    );
  }

  // Theme-adaptive: colour lockup on light, white lockup on dark, toggled by the
  // class-based dark theme. `contents` keeps the wrapper out of layout so the
  // inner wordmark flows exactly like a single element would.
  if (tone === 'auto') {
    return (
      <>
        <span className="contents dark:hidden">
          <WordmarkPair
            latin={ASSET.colorLatin}
            arabic={ASSET.colorArabic}
            className={className}
            height={height}
            alt={title}
            decorative={decorative}
          />
        </span>
        <span className="hidden dark:contents">
          <WordmarkPair
            latin={ASSET.whiteLatin}
            arabic={ASSET.whiteArabic}
            className={className}
            height={height}
            alt={title}
            decorative={decorative}
          />
        </span>
      </>
    );
  }

  const onDark = tone === 'onDark' || tone === 'light' || tone === 'mono';
  return (
    <WordmarkPair
      latin={onDark ? ASSET.whiteLatin : ASSET.colorLatin}
      arabic={onDark ? ASSET.whiteArabic : ASSET.colorArabic}
      className={className}
      height={height}
      alt={title}
      decorative={decorative}
    />
  );
}

export default Logo;
