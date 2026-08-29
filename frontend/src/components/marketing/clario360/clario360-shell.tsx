'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MARKETING_SUITES,
  PLATFORM_ENGINES,
  getMarketingSuiteSub,
  localizeMarketingApp,
  localizeMarketingEngine,
} from '@/lib/marketing';
import { MARKETING_JSON_LD } from '@/lib/marketing/metadata';
import {
  getMarketingAppPath,
  getMarketingSuitePath,
  getPlatformEnginePath,
} from '@/lib/marketing/routes';
import type { MarketingLocale } from '@/lib/marketing/messages';
import { MarketingIcon } from './marketing-icons';
import { ScrollReveal } from './site/widgets';
import { MarketingLocaleProvider, useMarketingLocale } from './marketing-locale';
import { marketingArabicFont } from './marketing-fonts';
import './clario-site.css';

/* ============================================================
   Suite chrome metadata — ports COLORS[family].grad + the
   short mega-menu labels/subs from clario360-website (2).html.
   ============================================================ */
const SUITE_GRADIENT: Record<string, string> = {
  ds: 'linear-gradient(150deg,var(--teal-700),var(--teal-600))',
  bp: 'linear-gradient(150deg,var(--navy-800),var(--navy-600))',
  sec: 'linear-gradient(150deg,var(--sec-1),var(--sec-2))',
  insight: 'linear-gradient(150deg,var(--insight-1),var(--insight-2))',
};

const SUITE_NAV: Record<string, { label: string; sub: string }> = {
  datastream: { label: 'DataStream', sub: 'Data resilience & mobility' },
  'business-plus': { label: 'Business+', sub: 'Corporate operations' },
  clariosec: { label: 'ClarioSec', sub: 'Security & cyber programs' },
  clarioinsight: {
    label: 'ClarioInsight',
    sub: 'Data intelligence & analytics',
  },
};

const PRODUCT_SUITE_IDS = [
  'datastream',
  'business-plus',
  'clariosec',
  'clarioinsight',
];

/* ------------------------------------------------------------
   Language toggle (EN | ع). Compact segmented control used in
   both the desktop nav and the mobile drawer.
   ------------------------------------------------------------ */
function LanguageToggle({ variant }: { variant: 'nav' | 'drawer' }) {
  const { locale, messages, setLocale } = useMarketingLocale();
  return (
    <div
      className={`lang-toggle lang-toggle--${variant}`}
      role="group"
      aria-label={messages.nav.language}
    >
      <button
        type="button"
        className={`lang-opt${locale === 'en' ? ' active' : ''}`}
        aria-pressed={locale === 'en'}
        aria-label={messages.nav.switchToEnglish}
        lang="en"
        onClick={() => setLocale('en')}
      >
        EN
      </button>
      <span className="lang-sep" aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className={`lang-opt${locale === 'ar' ? ' active' : ''}`}
        aria-pressed={locale === 'ar'}
        aria-label={messages.nav.switchToArabic}
        lang="ar"
        onClick={() => setLocale('ar')}
      >
        ع
      </button>
    </div>
  );
}

/**
 * Public shell wrapper. Establishes the marketing locale context (seeded from
 * the server-resolved cookie via `initialLocale`) so the chrome and home tree
 * can render bilingually and SSR-safely.
 */
export function Clario360MarketingShell({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: MarketingLocale;
}) {
  return (
    <MarketingLocaleProvider initialLocale={initialLocale}>
      <ShellChrome>{children}</ShellChrome>
    </MarketingLocaleProvider>
  );
}

function ShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const { locale, dir, messages: m } = useMarketingLocale();

  /* ---- dark-on-scroll nav (ports initScroll: scrolled @ scrollY>20) ---- */
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Every route rendered inside this shell has a dark hero pinned behind the
  // fixed nav at scroll-top (home = .hero, every interior page = .page-hero /
  // <Hero> — /trust renders its own light layout and does NOT use this shell),
  // so the nav needs its on-dark (light-text) treatment while it sits over that
  // hero. Home keeps the on-dark bar even when scrolled (tall full-bleed hero +
  // dark translucent bar); interior pages hand off to the light glass
  // `.scrolled` bar once you scroll past their hero.
  const isHome = pathname === '/';
  const dark = isHome || !scrolled;

  /* ---- Arabic ⇄ Latin logo lockups (Arabic wordmark surfaces in RTL) ---- */
  const isArabic = locale === 'ar';
  const logoColorSrc = isArabic
    ? '/brand/clario360-arabic-colored.svg'
    : '/brand/Clario360_logo-colored.svg';
  const logoLightSrc = isArabic
    ? '/brand/clario360-arabic-white.svg'
    : '/brand/Clario360_logo-white.svg';
  const homeAriaLabel = isArabic ? 'Clario360 — الصفحة الرئيسية' : 'Clario360 home';

  /* ---- mega-menu state (ports toggleMega / closeMega / megaKey) ---- */
  const [openMega, setOpenMega] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  const closeMega = useCallback(() => setOpenMega(null), []);
  const toggleMega = useCallback((id: string) => {
    setOpenMega((cur) => (cur === id ? null : id));
  }, []);

  const megaKey = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpenMega(id);
        const root = e.currentTarget.closest('.has-mega');
        const first = root?.querySelector<HTMLElement>('.mega a');
        first?.focus();
      } else if (e.key === 'Escape') {
        closeMega();
        e.currentTarget.focus();
      }
    },
    [closeMega],
  );

  // Close mega on outside click and when focus leaves the nav entirely.
  useEffect(() => {
    if (!openMega) return;
    const onDocClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node))
        closeMega();
    };
    const onFocusIn = (e: FocusEvent) => {
      const open = document.querySelector('.has-mega.mega-open');
      if (open && !open.contains(e.target as Node)) closeMega();
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [openMega, closeMega]);

  // Close mega on route change.
  useEffect(() => {
    closeMega();
  }, [pathname, closeMega]);

  /* ---- drawer state (ports toggleDrawer / trapDrawer / closeDrawer) ---- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const setDrawer = useCallback((open: boolean) => {
    if (open) lastFocus.current = document.activeElement as HTMLElement | null;
    setDrawerOpen(open);
  }, []);

  // Body scroll lock + focus management.
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
      const first =
        drawerRef.current?.querySelector<HTMLElement>('.drawer-close');
      first?.focus();
    } else {
      document.body.style.overflow = '';
      lastFocus.current?.focus?.();
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  // Close drawer on route change.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape closes drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Focus trap inside drawer (ports trapDrawer).
  const trapDrawer = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const d = drawerRef.current;
    if (!d) return;
    const focusable = [
      ...d.querySelectorAll<HTMLElement>(
        'button,a,[tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const productsActive = PRODUCT_SUITE_IDS.some(
    (id) => pathname === `/${id}` || pathname.startsWith(`/${id}/`),
  );
  const platformActive =
    pathname === '/platform' || pathname.startsWith('/platform/');
  // `nav-ondark` (not bare `dark`) so it doesn't collide with the app-wide
  // Tailwind `.dark` theme selector, which would otherwise inject the app's
  // HSL-channel design tokens (e.g. --card) into this marketing nav subtree and
  // break `background:var(--card)` on the mega dropdowns (renders transparent).
  const navClass = `nav${dark ? ' nav-ondark' : ''}${scrolled ? ' scrolled' : ''}`;

  // Flourish under the footer wordmark: shows the OPPOSITE script to the active
  // locale (Arabic accent while browsing English, and vice-versa).
  const footerFlourishIsArabic = locale === 'en';

  const navLink = (label: string, href: string) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        className={`nav-link${active ? ' active' : ''}`}
        href={href}
        aria-current={active ? 'page' : undefined}
      >
        {label}
      </Link>
    );
  };

  return (
    <div
      className={`clario-site ${marketingArabicFont.variable}`}
      dir={dir}
      lang={locale}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(MARKETING_JSON_LD).replace(/</g, '\\u003c'),
        }}
      />

      <a href="#main" className="skip-link">
        {m.nav.skipToContent}
      </a>

      <nav className={navClass} id="nav" aria-label={m.nav.primaryNav} ref={navRef}>
        <div className="nav-inner">
          <Link className="logo" href="/" aria-label={homeAriaLabel}>
            {/* Single wordmark rendered as a direct <img> — NOT the bilingual
                <Logo> pair, whose Arabic half cannot be hidden inside
                .clario-site (`img{display:block}` outranks Tailwind `.hidden`).
                The src set swaps to the Arabic lockup in RTL; the nav-ondark
                state toggles which tone is visible via CSS. The wrapping <Link>
                carries the accessible name, so both imgs are decorative. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoColorSrc}
              alt=""
              className="clario-site-logo clario-site-logo--color"
              draggable={false}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoLightSrc}
              alt=""
              aria-hidden="true"
              className="clario-site-logo clario-site-logo--light"
              draggable={false}
            />
          </Link>

          <div className="nav-links">
            {/* Products mega-menu */}
            <div
              className={`has-mega${openMega === 'products' ? ' mega-open' : ''}`}
              id="products-menu"
            >
              <button
                className={`nav-link nav-trigger${
                  productsActive ? ' active' : ''
                }`}
                aria-haspopup="true"
                aria-expanded={openMega === 'products'}
                aria-controls="products-mega"
                onClick={() => toggleMega('products')}
                onKeyDown={(e) => megaKey(e, 'products')}
              >
                {m.nav.products} <MarketingIcon name="chev" className="chev" />
              </button>
              <div
                className="mega mega-products"
                id="products-mega"
                role="menu"
                aria-label={m.nav.products}
              >
                <div className="mega-products-head">
                  <div>
                    <h5
                      style={{
                        fontFamily: isArabic ? 'var(--arabic)' : 'var(--display)',
                        fontSize: '1.1rem',
                        margin: 0,
                      }}
                    >
                      {m.nav.productsMegaTitle}
                    </h5>
                    <p
                      style={{
                        fontSize: '.78rem',
                        color: 'var(--text-3)',
                        margin: '3px 0 0',
                      }}
                    >
                      {m.nav.productsMegaSub}
                    </p>
                  </div>
                  <Link className="mega-arch-link" href="/platform">
                    {m.nav.platformArchitecture} {m.arrow}
                  </Link>
                </div>
                <div className="mega-grid">
                  {MARKETING_SUITES.map((suite) => {
                    const meta = SUITE_NAV[suite.id];
                    return (
                      <div
                        className="mega-col"
                        role="group"
                        aria-label={`${meta?.label ?? suite.name} suite`}
                        key={suite.id}
                      >
                        <Link
                          className="mega-col-head"
                          href={getMarketingSuitePath(suite.id)}
                          role="menuitem"
                        >
                          <div
                            className="mega-ico sm"
                            style={{
                              background: SUITE_GRADIENT[suite.family],
                            }}
                            aria-hidden="true"
                          >
                            <MarketingIcon name={suite.apps[0].icon} />
                          </div>
                          <div>
                            <h5>{meta?.label ?? suite.name}</h5>
                            <p>
                              {getMarketingSuiteSub(
                                suite.id,
                                locale,
                                meta?.sub ?? suite.tagline,
                              )}
                            </p>
                          </div>
                        </Link>
                        {suite.apps.map((app) => (
                          <Link
                            className="mega-app"
                            href={getMarketingAppPath(suite.id, app.id)}
                            key={app.id}
                            role="menuitem"
                          >
                            {app.name}
                            <span>{localizeMarketingApp(app, locale).role}</span>
                          </Link>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Platform mega-menu (the 12 engines) */}
            <div
              className={`has-mega${openMega === 'platform' ? ' mega-open' : ''}`}
              id="platform-menu"
            >
              <button
                className={`nav-link nav-trigger${
                  platformActive ? ' active' : ''
                }`}
                aria-haspopup="true"
                aria-expanded={openMega === 'platform'}
                aria-controls="platform-mega"
                onClick={() => toggleMega('platform')}
                onKeyDown={(e) => megaKey(e, 'platform')}
              >
                {m.nav.platform} <MarketingIcon name="chev" className="chev" />
              </button>
              <div
                className="mega"
                id="platform-mega"
                role="menu"
                aria-label={m.nav.platform}
              >
                <div className="mega-head">
                  <small>{m.nav.platformCoreEngines}</small>
                  <Link className="mega-arch-link" href="/platform">
                    {m.nav.architecture} {m.arrow}
                  </Link>
                </div>
                {PLATFORM_ENGINES.map((engine) => (
                  <Link
                    className="mega-item"
                    href={getPlatformEnginePath(engine.id)}
                    key={engine.id}
                    role="menuitem"
                  >
                    <div className="mega-ico" style={{ background: 'var(--navy-600)' }}>
                      <MarketingIcon name={engine.icon} />
                    </div>
                    <div>
                      <h5>{engine.name}</h5>
                      <p>{localizeMarketingEngine(engine, locale).description}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {navLink(m.nav.solutions, '/solutions')}
            {navLink(m.nav.sovereignty, '/sovereignty')}
            {navLink(m.nav.resources, '/resources')}
            {navLink(m.nav.pricing, '/pricing')}
            {navLink(m.nav.about, '/about')}
          </div>

          <div className="nav-cta">
            <LanguageToggle variant="nav" />
            <Link className="btn btn-ghost btn-demo" href="/login">
              {m.nav.signIn}
            </Link>
            <Link className="btn btn-gold" href="/contact">
              {m.nav.requestDemo}
            </Link>
            <button
              className="burger"
              onClick={() => setDrawer(true)}
              aria-label={m.nav.openMenu}
              aria-expanded={drawerOpen}
              aria-controls="drawer"
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile drawer */}
      <div
        className={`drawer${drawerOpen ? ' open' : ''}`}
        id="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={m.nav.siteMenu}
        aria-hidden={!drawerOpen}
        ref={drawerRef}
        onKeyDown={trapDrawer}
      >
        <button
          className="drawer-close"
          onClick={() => setDrawer(false)}
          aria-label={m.nav.closeMenu}
        >
          &times;
        </button>
        <LanguageToggle variant="drawer" />
        <Link className="d-link" href="/platform">
          {m.nav.platform}
        </Link>
        {MARKETING_SUITES.map((suite) => {
          const suiteLabel = SUITE_NAV[suite.id]?.label ?? suite.name;
          return (
            <div key={suite.id}>
              <Link className="d-link" href={getMarketingSuitePath(suite.id)}>
                {isArabic
                  ? `${m.nav.suiteWord} ${suiteLabel}`
                  : `${suiteLabel} ${m.nav.suiteWord}`}
              </Link>
              {suite.apps.map((app) => (
                <Link
                  className="d-sub"
                  href={getMarketingAppPath(suite.id, app.id)}
                  key={app.id}
                >
                  {app.name} — {localizeMarketingApp(app, locale).role}
                </Link>
              ))}
            </div>
          );
        })}
        <Link className="d-link" href="/solutions">
          {m.nav.solutions}
        </Link>
        <Link className="d-link" href="/sovereignty">
          {m.nav.sovereignty}
        </Link>
        <Link className="d-link" href="/resources">
          {m.nav.resources}
        </Link>
        <Link className="d-link" href="/pricing">
          {m.nav.pricing}
        </Link>
        <Link className="d-link" href="/about">
          {m.nav.about}
        </Link>
        <Link className="d-link" href="/login">
          {m.nav.signIn}
        </Link>
        <Link className="d-link" href="/contact">
          {m.nav.requestDemo}
        </Link>
      </div>

      <main id="main" tabIndex={-1}>
        {children}
      </main>

      <footer className="footer">
        <div
          className="hero-grad"
          style={{
            opacity: 0.18,
            top: 'auto',
            bottom: '-400px',
            insetInlineEnd: '-200px',
          }}
        />
        <div className="wrap">
          <div className="footer-top">
            <div className="footer-brand">
              <Link className="logo" href="/" style={{ marginBottom: 0 }} aria-label={homeAriaLabel}>
                {/* Footer sits on the dark --ink surface — always the on-dark
                    wordmark (Arabic lockup in RTL). Direct <img>. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoLightSrc}
                  alt=""
                  className="clario-site-logo"
                  draggable={false}
                />
              </Link>
              <p style={{ marginTop: '14px' }}>{m.footer.tagline}</p>
              <div
                className={`footer-ar${
                  footerFlourishIsArabic ? ' bilingual' : ' footer-ar--latin'
                }`}
                dir={footerFlourishIsArabic ? 'rtl' : 'ltr'}
                lang={footerFlourishIsArabic ? 'ar' : 'en'}
              >
                {m.footer.flourish}
              </div>
            </div>

            <div className="footer-col">
              <FooterSuiteHeading latin="DataStream" suiteId="datastream" />
              {(getFooterSuite('datastream')?.apps ?? []).map((app) => (
                <Link
                  href={getMarketingAppPath('datastream', app.id)}
                  key={app.id}
                >
                  {app.name}{' '}
                  <span className="bilingual footer-app-ar">{app.ar}</span>
                </Link>
              ))}
              <Link
                href={getMarketingSuitePath('datastream')}
                style={{ color: 'var(--text-inv)', fontWeight: 600 }}
              >
                {m.footer.overview} {m.arrow}
              </Link>
              <FooterSuiteHeading latin="ClarioSec" suiteId="clariosec" withGap />
              {(getFooterSuite('clariosec')?.apps ?? []).map((app) => (
                <Link
                  href={getMarketingAppPath('clariosec', app.id)}
                  key={app.id}
                >
                  {app.name}{' '}
                  <span className="bilingual footer-app-ar">{app.ar}</span>
                </Link>
              ))}
              <Link
                href={getMarketingSuitePath('clariosec')}
                style={{ color: 'var(--text-inv)', fontWeight: 600 }}
              >
                {m.footer.overview} {m.arrow}
              </Link>
            </div>

            <div className="footer-col">
              <FooterSuiteHeading latin="Business+" suiteId="business-plus" />
              {(getFooterSuite('business-plus')?.apps ?? []).map((app) => (
                <Link
                  href={getMarketingAppPath('business-plus', app.id)}
                  key={app.id}
                >
                  {app.name}{' '}
                  <span className="bilingual footer-app-ar">{app.ar}</span>
                </Link>
              ))}
              <Link
                href={getMarketingSuitePath('business-plus')}
                style={{ color: 'var(--text-inv)', fontWeight: 600 }}
              >
                {m.footer.overview} {m.arrow}
              </Link>
              <FooterSuiteHeading
                latin="ClarioInsight"
                suiteId="clarioinsight"
                withGap
              />
              {(getFooterSuite('clarioinsight')?.apps ?? []).map((app) => (
                <Link
                  href={getMarketingAppPath('clarioinsight', app.id)}
                  key={app.id}
                >
                  {app.name}{' '}
                  <span className="bilingual footer-app-ar">{app.ar}</span>
                </Link>
              ))}
              <Link
                href={getMarketingSuitePath('clarioinsight')}
                style={{ color: 'var(--text-inv)', fontWeight: 600 }}
              >
                {m.footer.overview} {m.arrow}
              </Link>
            </div>

            <div className="footer-col">
              <h6>{m.footer.colPlatform}</h6>
              <Link href="/platform">{m.footer.architecture}</Link>
              <Link href="/platform">{m.footer.platformCore}</Link>
              <Link href="/sovereignty">{m.footer.deployment}</Link>
              <Link href="/sovereignty">{m.footer.compliance}</Link>
              <Link href="/solutions">{m.footer.solutions}</Link>
              <Link href="/compare">{m.footer.whyClario}</Link>
              <h6 style={{ marginTop: '22px' }}>{m.footer.colCompany}</h6>
              <Link href="/about">{m.footer.about}</Link>
              <Link href="/resources">{m.footer.resources}</Link>
              <Link href="/pricing">{m.footer.pricing}</Link>
              <Link href="/contact">{m.footer.contact}</Link>
              <Link href="/contact">{m.footer.requestDemo}</Link>
            </div>
          </div>

          <div className="footer-bottom">
            <div className="footer-badges">
              {m.footer.badges.map((badge) => (
                <span className="fbadge" key={badge}>
                  {badge}
                </span>
              ))}
            </div>
            <div className="footer-legal">
              <Link href="/sovereignty">{m.footer.security}</Link>
              <Link href="/trust">{m.footer.privacy}</Link>
              <Link href="/trust">{m.footer.terms}</Link>
              <span style={{ fontSize: '.82rem' }}>{m.footer.copyright}</span>
            </div>
          </div>
        </div>
      </footer>

      <ScrollReveal />
    </div>
  );
}

function getFooterSuite(id: string) {
  return MARKETING_SUITES.find((s) => s.id === id);
}

function FooterSuiteHeading({
  latin,
  suiteId,
  withGap,
}: {
  latin: string;
  suiteId: string;
  withGap?: boolean;
}) {
  const ar = getFooterSuite(suiteId)?.ar;
  return (
    <h6 style={withGap ? { marginTop: '22px' } : undefined}>
      {latin}
      {ar ? (
        <>
          {/* Separator stays OUTSIDE the RTL isolate so it resolves to the
              base direction and sits between the Latin and Arabic runs in
              both LTR and RTL. */}
          {' · '}
          <span className="bilingual footer-h6-ar">{ar}</span>
        </>
      ) : null}
    </h6>
  );
}
