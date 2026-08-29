'use client';

/**
 * Marketing shell — gallery (Storybook-ready demos).
 * ==================================================
 *
 * Composable, dependency-free demos for the Phase-2 shell chrome. This file is
 * NOT imported by any route (so it never ships in the app bundle) and is NOT a
 * test (so it is not collected by Vitest). It exists to (a) document intended
 * usage and (b) drop straight into a Storybook/gallery harness:
 *
 *   - the default export is a gallery descriptor (`title` + named `stories`),
 *   - each named export is a ready-to-render demo component.
 *
 * Wrap any demo in a `LocaleProvider` (and `next-themes` `ThemeProvider`) to see
 * the bilingual / light-dark / RTL behaviour; pass `locale="ar"` for RTL.
 */

import Link from 'next/link';
import { ThemeLocaleSwitcher } from '@/components/layout/theme-locale-switcher';
import { MarketingShell } from './marketing-shell';
import { MarketingFooter } from './marketing-footer';
import { MegaMenu } from './mega-menu';
import { MobileNav } from './mobile-nav';
import {
  clarioDrBrand,
  clarioDrFooterModel,
  clarioDrNavModel,
} from './nav-model';

const shellLabels = {
  skipToContent: 'Skip to content',
  navAriaLabel: 'Main navigation',
  mobileOpenLabel: 'Open menu',
  mobileCloseLabel: 'Close menu',
  mobileTitle: 'Menu',
  externalLinkLabel: '(opens in a new tab)',
};

const galleryAnnouncement = {
  id: 'gallery-dr-day',
  message: 'ClarioDR DR Day — rehearse a full regional failover, live.',
  link: { label: 'Reserve a seat', href: '/events/dr-day' },
  dismissLabel: 'Dismiss announcement',
};

/** A reusable header-action cluster: secondary link + primary CTA + switcher. */
function HeaderActions() {
  return (
    <>
      <Link
        href="/sign-in"
        className="inline-flex h-10 items-center rounded-button px-3 text-body-sm font-semibold text-content-secondary transition-colors duration-fast ease-standard hover:text-content-primary"
      >
        Sign in
      </Link>
      <Link
        href="/get-started"
        className="inline-flex h-10 items-center rounded-button bg-brand-primary-600 px-4 text-body-sm font-semibold text-content-on-primary shadow-elevation-1 transition-shadow duration-fast ease-standard hover:shadow-elevation-2"
      >
        Start free
      </Link>
      <ThemeLocaleSwitcher />
    </>
  );
}

/** Full shell: announcement + header (mega-menu + mobile) + content + footer. */
export function FullShellStory() {
  return (
    <MarketingShell
      brand={clarioDrBrand}
      nav={clarioDrNavModel}
      labels={shellLabels}
      announcement={galleryAnnouncement}
      headerActions={<HeaderActions />}
      mobileFooterSlot={
        <div className="flex flex-col gap-3">
          <Link
            href="/get-started"
            className="inline-flex h-11 items-center justify-center rounded-button bg-brand-primary-600 text-body-sm font-semibold text-content-on-primary"
          >
            Start free
          </Link>
          <div className="flex items-center justify-between">
            <Link href="/sign-in" className="text-body-sm font-semibold text-content-secondary">
              Sign in
            </Link>
            <ThemeLocaleSwitcher />
          </div>
        </div>
      }
      footer={
        <MarketingFooter
          brand={clarioDrBrand}
          columns={clarioDrFooterModel}
          copyright={`© ${new Date().getFullYear()} ClarioDR. All rights reserved.`}
          ariaLabel="Footer"
          externalLinkLabel={shellLabels.externalLinkLabel}
          switcherSlot={<ThemeLocaleSwitcher />}
        />
      }
    >
      <section className="mx-auto w-full max-w-7xl px-section-x py-section-y">
        <p className="text-overline font-semibold uppercase text-brand-primary-600">
          Sovereign disaster recovery
        </p>
        <h1 className="mt-3 max-w-3xl text-display font-display font-bold text-content-primary">
          Rehearse failover. Prove recovery. Pass the audit.
        </h1>
        <p className="mt-4 max-w-2xl text-body-lg text-content-secondary">
          ClarioDR turns disaster-recovery runbooks into governed, evidence-backed
          failovers your regulators accept on the first pass.
        </p>
      </section>
    </MarketingShell>
  );
}

/** Desktop mega-menu in isolation (place inside a bordered header in the host). */
export function MegaMenuStory() {
  return (
    <div className="flex h-16 items-center border-b border-outline-subtle bg-surface-card px-section-x">
      <MegaMenu
        items={clarioDrNavModel}
        ariaLabel={shellLabels.navAriaLabel}
        externalLinkLabel={shellLabels.externalLinkLabel}
      />
    </div>
  );
}

/** Mobile drawer trigger in isolation. */
export function MobileNavStory() {
  return (
    <div className="flex h-16 items-center justify-end border-b border-outline-subtle bg-surface-card px-section-x lg:hidden">
      <MobileNav
        items={clarioDrNavModel}
        openLabel={shellLabels.mobileOpenLabel}
        closeLabel={shellLabels.mobileCloseLabel}
        title={shellLabels.mobileTitle}
        externalLinkLabel={shellLabels.externalLinkLabel}
        footerSlot={<ThemeLocaleSwitcher />}
      />
    </div>
  );
}

/** Footer in isolation. */
export function FooterStory() {
  return (
    <MarketingFooter
      brand={clarioDrBrand}
      columns={clarioDrFooterModel}
      copyright={`© ${new Date().getFullYear()} ClarioDR. All rights reserved.`}
      ariaLabel="Footer"
      externalLinkLabel={shellLabels.externalLinkLabel}
      switcherSlot={<ThemeLocaleSwitcher />}
    />
  );
}

const gallery = {
  title: 'Marketing/Shell',
  stories: {
    FullShell: FullShellStory,
    MegaMenu: MegaMenuStory,
    MobileNav: MobileNavStory,
    Footer: FooterStory,
  },
};

export default gallery;
