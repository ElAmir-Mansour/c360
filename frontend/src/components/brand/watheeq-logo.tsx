import { cn } from '@/lib/utils';

/**
 * WatheeqTech brand logo — canonical lockup for the WatheeqTech product surface.
 *
 * Renders the July 2026 brand-team artwork shipped under
 * `/public/brand/watheeqtech` as-is. The English and Arabic packs each have one
 * approved treatment per background: green, white, and yellow. SVG is the runtime
 * source; matching PNG exports are retained beside it for downstream/raster
 * consumers.
 */

export type WatheeqLogoVariant = 'wordmark' | 'mark';
export type WatheeqLogoTone = 'color' | 'onDark' | 'auto';
export type WatheeqLogoBackground = 'white' | 'green' | 'yellow';

export interface WatheeqLogoProps {
  /** `wordmark` (default) = full WatheeqTech lockup · `mark` = the gavel tile only. */
  variant?: WatheeqLogoVariant;
  /**
   * Legacy convenience mapping: `color` → white background, `onDark` → green
   * background, `auto` → white in light mode and green in dark mode.
   */
  tone?: WatheeqLogoTone;
  /**
   * Explicit approved background treatment. Prefer this when the containing
   * surface is known; it overrides the legacy `tone` mapping.
   */
  background?: WatheeqLogoBackground;
  /** Selects the Arabic wordmark when the locale is `ar` or an Arabic locale variant. */
  locale?: string;
  /** Convenience pixel height; width follows the aspect ratio. Prefer `className`. */
  height?: number;
  className?: string;
  /** Accessible label. Defaults to "WatheeqTech"; ignored when `decorative`. */
  title?: string;
  /** Decorative image (aria-hidden, empty alt) — when adjacent text names the brand. */
  decorative?: boolean;
}

const ASSET = {
  wordmark: {
    en: {
      green: '/brand/watheeqtech/logo-green-bg.svg',
      white: '/brand/watheeqtech/logo-white-bg.svg',
      yellow: '/brand/watheeqtech/logo-yellow-bg.svg',
    },
    ar: {
      green: '/brand/watheeqtech/arabic-logo-green-bg.svg',
      white: '/brand/watheeqtech/arabic-logo-white-bg.svg',
      yellow: '/brand/watheeqtech/arabic-logo-yellow-bg.svg',
    },
  },
  mark: {
    green: '/brand/watheeqtech/mark-green-bg.svg',
    white: '/brand/watheeqtech/mark-white-bg.svg',
    yellow: '/brand/watheeqtech/mark-yellow-bg.svg',
  },
} as const;

function isArabicLocale(locale?: string) {
  return locale?.trim().toLowerCase().startsWith('ar') ?? false;
}

function LogoImage({
  src,
  className,
  height,
  alt,
  decorative,
}: {
  src: string;
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
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={altText} className={cn('inline-block', className)} {...shared} />
  );
}

export function WatheeqLogo({
  variant = 'wordmark',
  tone = 'color',
  background,
  locale,
  height,
  className,
  title = 'WatheeqTech',
  decorative = false,
}: WatheeqLogoProps) {
  const assets =
    variant === 'mark' ? ASSET.mark : ASSET.wordmark[isArabicLocale(locale) ? 'ar' : 'en'];
  const resolvedBackground = background ?? (tone === 'onDark' ? 'green' : 'white');

  // Theme-adaptive: use the white-surface treatment in light mode and the
  // green-surface treatment in dark mode. An explicit background is authoritative.
  if (tone === 'auto' && background === undefined) {
    return (
      <>
        <span className="contents dark:hidden">
          <LogoImage
            src={assets.white}
            className={className}
            height={height}
            alt={title}
            decorative={decorative}
          />
        </span>
        <span className="hidden dark:contents">
          <LogoImage
            src={assets.green}
            className={className}
            height={height}
            alt={title}
            decorative={decorative}
          />
        </span>
      </>
    );
  }

  return (
    <LogoImage
      src={assets[resolvedBackground]}
      className={className}
      height={height}
      alt={title}
      decorative={decorative}
    />
  );
}

export default WatheeqLogo;
