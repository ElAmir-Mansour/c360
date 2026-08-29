'use client';

/**
 * MarketingShell — the marketing/site chrome wrapper.
 * ===================================================
 *
 * Composes the full top-of-page chrome for marketing routes:
 *
 *   1. a dismissible, sticky ANNOUNCEMENT / promo bar (optional),
 *   2. a sticky top navigation bar:
 *        - brand wordmark (home link),
 *        - desktop `MegaMenu` (lg+),
 *        - header actions slot (e.g. CTAs) + theme/locale switcher,
 *        - `MobileNav` hamburger (< lg),
 *   3. the page-content slot (`children`) as the `<main>` landmark,
 *   4. an optional `MarketingFooter`.
 *
 * This does NOT touch the `(dashboard)` shell — it is for public marketing pages
 * only. Everything is token-driven, light/dark aware, WCAG 2.1 AA (skip link,
 * landmarks, labelled controls) and RTL-first.
 *
 * Announcement dismissal is deliberately page-local state. Public marketing
 * pages must not persist this chrome state in browser storage.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MegaMenu } from './mega-menu';
import { MobileNav } from './mobile-nav';
import type { NavModel, ShellBrand } from './nav-model';

export interface ShellAnnouncement {
  /** Stable id for tests and analytics hooks. */
  id: string;
  /** Localized message. */
  message: string;
  /** Optional inline link (e.g. "Read more"). */
  link?: { label: string; href: string; external?: boolean };
  /** Localized accessible label for the dismiss button. */
  dismissLabel: string;
}

export interface MarketingShellLabels {
  /** Skip-to-content link text. */
  skipToContent: string;
  /** Accessible label for the primary navigation. */
  navAriaLabel: string;
  /** Mobile drawer: open trigger label. */
  mobileOpenLabel: string;
  /** Mobile drawer: close button label. */
  mobileCloseLabel: string;
  /** Mobile drawer: dialog title. */
  mobileTitle: string;
  /** Hint appended to external links. */
  externalLinkLabel?: string;
}

export interface MarketingShellProps {
  /** Brand block (wordmark + home link). */
  brand: ShellBrand;
  /** Primary navigation model (shared by desktop + mobile nav). */
  nav: NavModel;
  /** All localized chrome labels. */
  labels: MarketingShellLabels;
  /** Optional dismissible announcement/promo bar. */
  announcement?: ShellAnnouncement;
  /**
   * Header actions rendered at the inline-end of the bar on desktop — typically
   * a sign-in link, a primary CTA and `<ThemeLocaleSwitcher />`.
   */
  headerActions?: React.ReactNode;
  /**
   * Actions rendered at the bottom of the mobile drawer (CTAs + switcher).
   */
  mobileFooterSlot?: React.ReactNode;
  /** Footer element (usually `<MarketingFooter />`). Optional for composition. */
  footer?: React.ReactNode;
  /** Page content (rendered inside the `<main>` landmark). */
  children: React.ReactNode;
  className?: string;
}

function AnnouncementBar({
  announcement,
  onDismiss,
}: {
  announcement: ShellAnnouncement;
  onDismiss: () => void;
}) {
  return (
    <div
      role="region"
      aria-label={announcement.message}
      data-testid="announcement-bar"
      className={cn(
        'sticky top-0 z-50 w-full',
        'bg-brand-primary-700 text-content-on-primary',
      )}
    >
      <div className="flex w-full items-center gap-3 px-section-x py-2">
        <p className="flex-1 text-center text-body-sm">
          {announcement.message}
          {announcement.link ? (
            <>
              {' '}
              <a
                href={announcement.link.href}
                {...(announcement.link.external
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
                className={cn(
                  'font-semibold underline underline-offset-4',
                  'transition-opacity duration-fast ease-standard hover:opacity-90',
                  'focus-visible:outline-none focus-visible:rounded-input focus-visible:ring-2 focus-visible:ring-content-on-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary-700',
                )}
              >
                {announcement.link.label}
              </a>
            </>
          ) : null}
        </p>
        <button
          type="button"
          aria-label={announcement.dismissLabel}
          data-testid="announcement-dismiss"
          onClick={onDismiss}
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-button',
            'text-content-on-primary/80 transition-colors duration-fast ease-standard',
            'hover:bg-content-on-primary/15 hover:text-content-on-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-content-on-primary focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary-700',
          )}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function MarketingShell({
  brand,
  nav,
  labels,
  announcement,
  headerActions,
  mobileFooterSlot,
  footer,
  children,
  className,
}: MarketingShellProps) {
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);

  const dismissAnnouncement = () => {
    setAnnouncementDismissed(true);
  };

  const showAnnouncement = Boolean(announcement) && !announcementDismissed;

  return (
    <div
      className={cn(
        'flex min-h-screen flex-col bg-bg-page text-content-primary',
        className,
      )}
    >
      {/* Skip link — first focusable element, visible only on focus. */}
      <a
        href="#marketing-main"
        className={cn(
          'sr-only z-[60] rounded-button bg-brand-primary-600 px-4 py-2 text-body-sm font-semibold text-content-on-primary',
          'focus:not-sr-only focus:absolute focus:start-4 focus:top-4',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page',
        )}
      >
        {labels.skipToContent}
      </a>

      {showAnnouncement && announcement ? (
        <AnnouncementBar
          announcement={announcement}
          onDismiss={dismissAnnouncement}
        />
      ) : null}

      {/* Sticky header */}
      <header
        className={cn(
          'sticky z-40 w-full border-b border-outline-subtle',
          'bg-surface-card/95 supports-[backdrop-filter]:bg-surface-card/80 supports-[backdrop-filter]:backdrop-blur',
          // Stick below the announcement bar when it is shown.
          showAnnouncement ? 'top-[var(--marketing-announcement-h,2.5rem)]' : 'top-0',
        )}
      >
        <div className="flex h-16 w-full items-center gap-4 px-section-x">
          {/* Brand */}
          <a
            href={brand.href}
            aria-label={brand.homeLabel}
            className={cn(
              'inline-flex shrink-0 items-center text-h4 font-display font-bold text-content-primary',
              'transition-colors duration-fast ease-standard hover:text-brand-primary-600',
              'focus-visible:outline-none focus-visible:rounded-input focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card',
            )}
          >
            {brand.name}
          </a>

          {/* Desktop mega-menu (centered) */}
          <div className="flex flex-1 justify-center">
            <MegaMenu
              items={nav}
              ariaLabel={labels.navAriaLabel}
              externalLinkLabel={labels.externalLinkLabel}
            />
          </div>

          {/* Header actions (desktop) */}
          {headerActions ? (
            <div className="hidden items-center gap-2 lg:flex">
              {headerActions}
            </div>
          ) : null}

          {/* Mobile hamburger + drawer */}
          <div className="ms-auto flex items-center gap-2 lg:hidden">
            <MobileNav
              items={nav}
              openLabel={labels.mobileOpenLabel}
              closeLabel={labels.mobileCloseLabel}
              title={labels.mobileTitle}
              externalLinkLabel={labels.externalLinkLabel}
              footerSlot={mobileFooterSlot}
            />
          </div>
        </div>
      </header>

      {/* Page content */}
      <main id="marketing-main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>

      {footer}
    </div>
  );
}
