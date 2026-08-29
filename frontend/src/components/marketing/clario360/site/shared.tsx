import type { ReactNode } from 'react';
import Link from 'next/link';
import { MarketingIcon } from '../marketing-icons';
import { HeroSessionBadge } from './hero-session-badge';

/* ============================================================
   Shared structural primitives for the Clario360 marketing site.
   These emit the ported HTML's EXACT class names; they style
   correctly only inside the .clario-site wrapper (clario-site.css).
   The locale-aware chrome (CtaBand + BusDiagram) lives in the
   `'use client'` sibling `shared-chrome.tsx` and is re-exported
   below to preserve existing `./shared` import sites.
   ============================================================ */

export interface BreadcrumbCrumb {
  label: string;
  href?: string;
}

/* ----------------------------------------------------------------
   Breadcrumb — the .breadcrumb pattern used on inner pages.
   HTML: <div class="breadcrumb"><a>Home</a> {chev} <span>Platform</span></div>
   ---------------------------------------------------------------- */
export function Breadcrumb({ trail }: { trail: BreadcrumbCrumb[] }) {
  return (
    <div className="breadcrumb">
      {trail.map((crumb, i) => (
        <span
          key={`${crumb.label}-${i}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          {i > 0 ? <MarketingIcon name="chev" /> : null}
          {crumb.href ? (
            <Link href={crumb.href}>{crumb.label}</Link>
          ) : (
            <span>{crumb.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------
   Hero — flexible hero matching the home hero (pageHome ~1595-1631)
   and the inner-page hero pattern. Renders the hero-bg gradient
   layers, hero-inner, badge, bilingual Arabic line, eyebrow, h1,
   lede, actions, trust counters, and a right-column aside.
   ---------------------------------------------------------------- */
export interface HeroProps {
  badge?: string;
  bilingual?: string;
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
  actions?: ReactNode;
  trust?: { value: string; label: string }[];
  aside?: ReactNode;
  breadcrumb?: BreadcrumbCrumb[];
}

export function Hero({
  badge,
  bilingual,
  eyebrow,
  title,
  lede,
  actions,
  trust,
  aside,
  breadcrumb,
}: HeroProps) {
  const left = (
    <div>
      <HeroSessionBadge />
      {breadcrumb ? <Breadcrumb trail={breadcrumb} /> : null}
      {badge ? (
        <div className="hero-badge">
          <b>Sovereign</b> <span>{badge}</span>
        </div>
      ) : null}
      {bilingual ? (
        <div className="hero-ar bilingual" dir="rtl" lang="ar">
          {bilingual}
        </div>
      ) : null}
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
      {actions ? <div className="hero-actions">{actions}</div> : null}
      {trust && trust.length > 0 ? (
        <div className="hero-trust">
          {trust.map((t, i) => (
            <div className="t" key={`${t.label}-${i}`}>
              <b>{t.value}</b>
              <span>{t.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <header className="hero">
      <div className="hero-bg">
        <div className="hero-grad" />
        <div className="hero-grad2" />
        <div className="grid-overlay" />
      </div>
      <div className="wrap hero-inner">
        <div className="hero-grid">
          {left}
          <div>{aside}</div>
        </div>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------
   StatsBand — the dark stats band with grid-overlay
   (HTML pageHome ~1683-1693).
   ---------------------------------------------------------------- */
export interface StatItem {
  value: ReactNode;
  label: ReactNode;
}

export function StatsBand({ stats }: { stats: StatItem[] }) {
  return (
    <section className="section stats-band">
      <div className="grid-overlay" />
      <div className="wrap">
        <div className="stats-grid">
          {stats.map((s, i) => (
            <div className="stat" key={i}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------
   CtaBand + BusDiagram are LOCALE-AWARE (they carry their own prose),
   so they live in the `'use client'` sibling `shared-chrome.tsx` and
   are re-exported here to preserve existing `./shared` import sites.
   ---------------------------------------------------------------- */
export { CtaBand, BusDiagram } from './shared-chrome';

/* ----------------------------------------------------------------
   SectionHead — the repeated eyebrow + h2 + lede block (.sec-head).
   ---------------------------------------------------------------- */
export interface SectionHeadProps {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  center?: boolean;
}

export function SectionHead({ eyebrow, title, lede, center }: SectionHeadProps) {
  return (
    <div className={center ? 'sec-head center' : 'sec-head'}>
      <div
        className="eyebrow"
        style={center ? { justifyContent: 'center' } : undefined}
      >
        {eyebrow}
      </div>
      <h2>{title}</h2>
      {lede ? <p className="lede">{lede}</p> : null}
    </div>
  );
}
