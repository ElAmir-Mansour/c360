'use client';

import Link from 'next/link';
import {
  MARKETING_APPS,
  MARKETING_SUITES,
  PLATFORM_ENGINES,
} from '@/lib/marketing';
import type { MarketingLocale } from '@/lib/marketing/messages';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import {
  ComplianceMark,
  SovereigntyKsaDiagram,
  SprawlToPlatform,
  type ComplianceFramework,
} from './home-illustrations';
import { SectionHead } from './shared';
import { Reveal } from './visual-primitives';
import { FaqAccordion, RoiCalculator } from './widgets';

/* ============================================================
   HOME — P2 conversion + P3 structure sections.

   Every number rendered here is COMPUTED FROM THE DATA
   (suites.ts / engines.ts) — a single source of truth — and
   interpolated into localised copy via {token} placeholders.
   Presentation uses the ported .clario-site classes only.
   ============================================================ */

/* ---- Single source of truth: counts derived from the data ---- */
export const HOME_COUNTS = {
  suites: MARKETING_SUITES.length,
  apps: MARKETING_APPS.length,
  ga: MARKETING_APPS.filter((a) => a.status === 'ga').length,
  get roadmap() {
    return this.apps - this.ga;
  },
  engines: PLATFORM_ENGINES.length,
} as const;

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Localise a Western integer to Arabic-Indic numerals for `ar`. */
export function formatNum(n: number, locale: MarketingLocale): string {
  const s = String(n);
  return locale === 'ar' ? s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]) : s;
}

/** Fill `{token}` placeholders in a localised template. */
export function interp(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

/** The count tokens (locale-formatted) shared by every templated string. */
export function countVars(locale: MarketingLocale): Record<string, string> {
  return {
    suites: formatNum(HOME_COUNTS.suites, locale),
    total: formatNum(HOME_COUNTS.apps, locale),
    ga: formatNum(HOME_COUNTS.ga, locale),
    roadmap: formatNum(HOME_COUNTS.roadmap, locale),
    engines: formatNum(HOME_COUNTS.engines, locale),
  };
}

/* ============================================================
   PROOF BAND — early social proof: dated, linked compliance
   badges rendered as in-house drawn framework seals. The former
   dashed "partner slot" placeholders are gone — an empty dashed
   logo row signals "no customers" and shipped to production.
   ============================================================ */

/** Map a localized badge name onto the drawn seal artwork. */
function frameworkFor(name: string): ComplianceFramework {
  const n = name.toLowerCase();
  if (n.includes('nca')) return 'nca';
  if (n.includes('sama')) return 'sama';
  if (n.includes('pdpl') || n.includes('البيانات')) return 'pdpl';
  if (n.includes('iso')) return 'iso';
  if (n.includes('zatca') || n.includes('الزكاة')) return 'zatca';
  return 'najiz';
}

export function ProofBand() {
  const { messages: m } = useMarketingLocale();
  const p = m.home.proof;
  return (
    <section className="section-tight">
      <div className="wrap">
        <div className="sec-head center">
          <div className="eyebrow" style={{ justifyContent: 'center' }}>
            {p.eyebrow}
          </div>
          <h2>{p.title}</h2>
          <p className="lede">{p.lede}</p>
        </div>

        {/* Regulatory alignment — each card leads with its drawn seal. */}
        <div className="res-grid">
          {p.badges.map((b) => (
            <Link className="res-card" href="/trust" key={b.name}>
              <div
                aria-hidden="true"
                style={{ color: 'var(--navy-600)', marginBottom: '10px' }}
              >
                <ComplianceMark framework={frameworkFor(b.name)} />
              </div>
              <span className="res-tag">{p.dateTag}</span>
              <h4>{b.name}</h4>
              <p>{b.note}</p>
            </Link>
          ))}
        </div>

        {/* Honesty note — alignment/readiness wording, not certification. */}
        <p
          style={{
            marginTop: '30px',
            marginBottom: 0,
            color: 'var(--text-3)',
            fontSize: '.82rem',
            maxWidth: '560px',
            marginLeft: 'auto',
            marginRight: 'auto',
            textAlign: 'center',
          }}
        >
          {p.badgeNote}
        </p>
      </div>
    </section>
  );
}

/* ============================================================
   PROBLEM — reframes the point-tool sprawl as cost.
   ============================================================ */
const PROBLEM_ICONS = ['layers', 'network', 'globe', 'eye'] as const;

export function ProblemSection() {
  const { messages: m } = useMarketingLocale();
  const p = m.home.problem;
  return (
    <section className="section" style={{ background: 'var(--paper-2)' }}>
      <div className="wrap">
        <div className="sec-head">
          <div className="eyebrow">{p.eyebrow}</div>
          <h2>{p.title}</h2>
          <p className="lede">{p.lede}</p>
        </div>
        <div className="modules">
          {p.items.map((it, i) => (
            <div className="module fade-up" key={it.title}>
              <div className="mi" aria-hidden="true">
                <MarketingIcon name={PROBLEM_ICONS[i] ?? 'alert'} />
              </div>
              <div>
                <h5>{it.title}</h5>
                <p>{it.body}</p>
              </div>
            </div>
          ))}
        </div>
        {/* Sprawl → one platform, drawn: the argument as a single visual. */}
        <Reveal className="fade-up" delay={120}>
          <div style={{ marginTop: '40px' }}>
            <SprawlToPlatform />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
   HOW IT WORKS — four-step adoption flow.
   Step titles render as styled divs (not h6) to keep heading
   order clean under the section's h2.
   ============================================================ */
export function HowItWorks() {
  const { locale, messages: m } = useMarketingLocale();
  const h = m.home.how;
  return (
    <section className="section">
      <div className="wrap">
        <div className="sec-head">
          <div className="eyebrow">{h.eyebrow}</div>
          <h2>{h.title}</h2>
          <p className="lede">{h.lede}</p>
        </div>
        <div className="flow">
          {h.steps.map((s, i) => (
            <div className="flow-step" key={s.title}>
              <div className="fs-num">{formatNum(i + 1, locale)}</div>
              <div
                style={{
                  fontFamily: 'var(--sans)',
                  fontWeight: 700,
                  fontSize: '.92rem',
                  margin: '0 0 5px',
                  color: 'var(--text)',
                }}
              >
                {s.title}
              </div>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   MID-PAGE CTA BAND — after the suites block. One primary
   (demo) + one secondary (Sign in), matching the hero.
   ============================================================ */
export function MidCtaBand() {
  const { messages: m } = useMarketingLocale();
  return (
    <section className="section">
      <div className="wrap">
        <div className="cta-band">
          <div className="hero-grad" />
          <h2>{m.home.midCta.title}</h2>
          <p>{m.home.midCta.sub}</p>
          <div className="cta-actions">
            <Link className="btn btn-gold btn-lg" href="/contact">
              {m.home.ctaRequestDemo} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark btn-lg" href="/login">
              {m.nav.signIn}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SOVEREIGNTY — the strongest prop, made explicit and prominent:
   in-Kingdom residency, air-gapped capability, BYOK.
   ============================================================ */
export function SovereigntySection() {
  const { messages: m } = useMarketingLocale();
  const s = m.home.sovereignty;
  return (
    <section className="section" style={{ background: 'var(--paper-2)' }}>
      <div className="wrap">
        <div className="split">
          <div>
            <div className="eyebrow">{s.eyebrow}</div>
            <h2>{s.title}</h2>
            <p className="lede" style={{ marginTop: '14px' }}>
              {s.lede}
            </p>
            <ul
              style={{
                listStyle: 'none',
                margin: '24px 0 0',
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '11px',
              }}
            >
              {s.points.map((pt) => (
                <li
                  key={pt}
                  style={{
                    display: 'flex',
                    gap: '11px',
                    alignItems: 'flex-start',
                    color: 'var(--text-2)',
                    fontSize: '.95rem',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      color: 'var(--navy-600)',
                      flex: 'none',
                      marginTop: '2px',
                      display: 'inline-flex',
                    }}
                  >
                    <MarketingIcon name="check" />
                  </span>
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* The page's signature visual: data stays inside the Kingdom,
              on a sovereign substrate (BYOK · WORM · chained audit). */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <SovereigntyKsaDiagram />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SECURITY & COMPLIANCE — controls-as-platform-features depth.
   ============================================================ */
const SECURITY_ICONS = ['shield', 'clipboard', 'finger', 'key'] as const;

export function SecuritySection() {
  const { messages: m } = useMarketingLocale();
  const s = m.home.security;
  return (
    <section className="section">
      <div className="wrap">
        <div className="sec-head">
          <div className="eyebrow">{s.eyebrow}</div>
          <h2>{s.title}</h2>
          <p className="lede">{s.lede}</p>
        </div>
        <div className="modules">
          {s.items.map((it, i) => (
            <div className="module fade-up" key={it.title}>
              <div className="mi" aria-hidden="true">
                <MarketingIcon name={SECURITY_ICONS[i] ?? 'shield'} />
              </div>
              <div>
                <h5>{it.title}</h5>
                <p>{it.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   OUTCOMES / ROI — quantified economics block (reuses the
   ported RoiCalculator widget).
   ============================================================ */
export function RoiSection() {
  const { messages: m } = useMarketingLocale();
  return (
    <section className="section" style={{ background: 'var(--paper-2)' }}>
      <div className="wrap">
        <SectionHead
          eyebrow={m.home.roi.eyebrow}
          title={m.home.roi.title}
          lede={m.home.roi.lede}
          center
        />
        <RoiCalculator />
      </div>
    </section>
  );
}

/* ============================================================
   PRICING PREVIEW — compact tiers linking to the full page.
   ============================================================ */
export function PricingPreview() {
  const { messages: m } = useMarketingLocale();
  const pp = m.home.pricingPreview;
  return (
    <section className="section">
      <div className="wrap">
        <div className="sec-head center">
          <div className="eyebrow" style={{ justifyContent: 'center' }}>
            {pp.eyebrow}
          </div>
          <h2>{pp.title}</h2>
          <p className="lede">{pp.lede}</p>
        </div>
        <div className="tiers">
          {pp.tiers.map((t, i) => (
            <div className={`tier${i === 2 ? ' featured' : ''}`} key={t.name}>
              <h3>{t.name}</h3>
              <p className="tdesc">{t.blurb}</p>
              <div className="price">{t.price}</div>
              <div className="pnote">{t.note}</div>
            </div>
          ))}
        </div>
        <div
          className="cta-actions"
          style={{ marginTop: '38px', justifyContent: 'center' }}
        >
          <Link className="btn btn-primary" href="/pricing">
            {pp.cta} <MarketingIcon name="arrow" />
          </Link>
          <Link className="btn btn-ghost" href="/pricing">
            {pp.configure}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   HOME FAQ — reuses the ported accordion; the "how many apps"
   answer is interpolated from the live counts.
   ============================================================ */
export function HomeFaq() {
  const { locale, messages: m } = useMarketingLocale();
  const vars = countVars(locale);
  const items = m.home.faq.items.map((it) => ({
    q: interp(it.q, vars),
    a: interp(it.a, vars),
  }));
  return (
    <section className="section" style={{ background: 'var(--paper-2)' }}>
      <div className="wrap">
        <SectionHead eyebrow={m.home.faq.eyebrow} title={m.home.faq.title} center />
        <FaqAccordion items={items} />
      </div>
    </section>
  );
}
