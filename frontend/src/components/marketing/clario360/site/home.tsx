'use client';

import Link from 'next/link';
import {
  MARKETING_BRAND_TOKENS,
  MARKETING_PRINCIPLES,
  MARKETING_SUITES,
  getMarketingAppPath,
  getMarketingDeployCards,
  getMarketingSuitePath,
  localizeMarketingApp,
  localizeMarketingPrinciple,
  localizeMarketingSuite,
} from '@/lib/marketing';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { StatsBand } from './shared';
import { HeroSessionBadge } from './hero-session-badge';
import {
  HOME_COUNTS,
  HomeFaq,
  HowItWorks,
  MidCtaBand,
  PricingPreview,
  ProblemSection,
  ProofBand,
  RoiSection,
  SecuritySection,
  SovereigntySection,
  countVars,
  interp,
} from './home-sections';
import {
  DeploymentModeIcon,
  GeometricBand,
  type DeploymentMode,
} from './home-illustrations';
import { FinalCtaCollage, IntegrationWall } from './home-showcase';
import { FeatureTours } from './home-tours';
import { BrowserFrame, CountUp, Shot } from './visual-primitives';

/* Narrow literal types derived from the const data so route helpers keep their
   literal id unions (the MarketingSuite interface widens ids to string). */
type Suite = (typeof MARKETING_SUITES)[number];
type App = Suite['apps'][number];
type Family = Suite['family'];

/* Small locale-picked UI verbs for the data-driven cards below (kept local so
   they travel with the render, not re-keyed into the shell message map). */
const HOME_UI = {
  learnMore: { en: 'Learn more', ar: 'اعرف المزيد' },
  explore: { en: 'Explore', ar: 'استكشف' },
} as const;

/* Hero proof counters — outcome/reassurance-framed labels that replace the
   former internal "shared core engines" count. Values are still derived from
   live data in the render (suites / apps / compliance marks / deploy models),
   never hard-coded, so they cannot drift. Bilingual. */
const HERO_TRUST_LABELS = [
  { en: 'Product suites', ar: 'مجموعات المنتجات' },
  { en: 'Enterprise applications', ar: 'تطبيقات مؤسسية' },
  { en: 'Regulatory frameworks', ar: 'أطر تنظيمية' },
  { en: 'Ways to deploy', ar: 'طرق النشر' },
] as const;

/* Hero screenshot — the real product replaces the former drawn .arch-card
   panel. Locale-matched: EN sees the DR readiness console, AR sees the
   Arabic legal command centre (real product, fictional demo data). The alt
   describes the shot each locale actually sees. */
const HERO_SHOT = {
  en: {
    src: '/marketing/shots/hero-dr-en.webp',
    alt: 'Clario360 disaster-recovery readiness console showing a live readiness score, failover actions and the recovery lifecycle',
  },
  ar: {
    src: '/marketing/shots/hero-lex-ar.webp',
    alt: 'مركز القيادة القانوني في Clario360 بواجهة عربية كاملة — القضايا والطلبات القانونية في شاشة واحدة',
  },
} as const;

/* Evaluate / proof entry-point cards (the .home-links strip) — bilingual. */
const HOME_LINKS = [
  {
    href: '/compare',
    icon: 'trend',
    en: {
      title: 'Why Clario360',
      body: 'One platform versus a stack of point tools — with an ROI model you can run.',
    },
    ar: {
      title: 'لماذا Clario360',
      body: 'منصّة واحدة مقابل كومة من الأدوات المتخصّصة — مع نموذج عائد يمكنكم تشغيله.',
    },
  },
  {
    href: '/resources',
    icon: 'doc',
    en: {
      title: 'Resources',
      body: 'Datasheets, deployment and security documentation, and developer references.',
    },
    ar: {
      title: 'الموارد',
      body: 'صحائف بيانات، ووثائق نشر وأمن، ومراجع للمطوّرين.',
    },
  },
  {
    href: '/pricing',
    icon: 'cube',
    en: {
      title: 'Build your platform',
      body: 'Configure suites and deployment to see the right tier for your institution.',
    },
    ar: {
      title: 'ابنِ منصّتك',
      body: 'هيّئ المجموعات والنشر لترى الفئة المناسبة لمؤسستكم.',
    },
  },
] as const;

/* ============================================================
   HOME PAGE — hero + product architecture, then a conversion-
   ordered narrative (proof → problem → how → suites-as-outcomes
   → sovereignty → security → outcomes → pricing → FAQ → CTA).

   All numeric claims are derived from the DATA via HOME_COUNTS
   (see home-sections.tsx) so the hero, arch card, FAQ and
   pricing can never drift apart. Class names are the ported
   .clario-site names styled by clario-site.css.
   ============================================================ */

/* statusBadge() — HTML 1760-1764.
   The data layer's status union is 'ga' | 'soon' (no 'new'), so only the
   GA and Roadmap branches can render; kept faithful to statusBadge() logic. */
function StatusBadge({ status }: { status: App['status'] }) {
  if (status === 'ga') return <span className="badge-ga">GA</span>;
  return <span className="badge-soon">Roadmap</span>;
}

/* appCard() — HTML 1766-1780 */
function AppCard({ app, suite }: { app: App; suite: Suite }) {
  const { locale } = useMarketingLocale();
  const t = localizeMarketingApp(app, locale);
  const grad =
    MARKETING_BRAND_TOKENS.suiteFamilies[
      suite.family as keyof typeof MARKETING_BRAND_TOKENS.suiteFamilies
    ]?.gradient ?? '';
  return (
    <Link className="app-card" href={getMarketingAppPath(suite.id, app.id)}>
      <div className="ac-h">
        <div className="app-ico" style={{ background: grad }}>
          <MarketingIcon name={app.icon} />
        </div>
        <div style={{ flex: 1 }}>
          <h4>
            {app.name} <span className="ar bilingual">{app.ar}</span>{' '}
            <StatusBadge status={app.status} />
          </h4>
          <p className="role">{t.role}</p>
        </div>
      </div>
      <p>{t.short}</p>
      <span className="more">
        {HOME_UI.learnMore[locale]} <MarketingIcon name="arrow" />
      </span>
    </Link>
  );
}

/* suiteSummary() — HTML 1735-1758 */
const SUITE_SUMMARY_META: Record<Family, { n: string; nAr: string; bg: string }> = {
  ds: {
    n: 'Suite 01 · Recover in minutes',
    nAr: 'المجموعة الأولى · تعافٍ في دقائق',
    bg: 'Data',
  },
  bp: {
    n: 'Suite 02 · Legal, governance & operations',
    nAr: 'المجموعة الثانية · القانونية والحوكمة والعمليات',
    bg: 'Ops',
  },
  sec: {
    n: 'Suite 03 · Cybersecurity & threat defence',
    nAr: 'المجموعة الثالثة · الأمن السيبراني والتصدّي للتهديدات',
    bg: 'Sec',
  },
  insight: {
    n: 'Suite 04 · Unified data & analytics',
    nAr: 'المجموعة الرابعة · بيانات وتحليلات موحّدة',
    bg: 'BI',
  },
};

/* Suite banner screenshots — a real product shot floats beside each suite's
   gradient banner (.suite-thumb inside .suite-hero.has-thumb). Alt text is
   bilingual; the legal shot's native Arabic UI is the proof point and is
   deliberately shown to BOTH locales. Fictional demo data only. */
const SUITE_THUMBS: Record<
  Family,
  { src: string; width: number; height: number; alt: { en: string; ar: string } }
> = {
  ds: {
    src: '/marketing/shots/suite-ds-ops.webp',
    width: 1200,
    height: 425,
    alt: {
      en: 'ClarioDR operations console with readiness score and recovery lifecycle',
      ar: 'لوحة عمليات ClarioDR مع مؤشر الجاهزية ودورة التعافي',
    },
  },
  bp: {
    src: '/marketing/shots/suite-legal-ar.webp',
    width: 1200,
    height: 600,
    alt: {
      en: 'Legal operations workspace with a full Arabic interface',
      ar: 'مساحة عمل الشؤون القانونية بواجهة عربية كاملة',
    },
  },
  sec: {
    src: '/marketing/shots/suite-sec-heatmap.webp',
    width: 1200,
    height: 827,
    alt: {
      en: 'Security operations MITRE ATT&CK coverage heatmap',
      ar: 'خريطة حرارية لتغطية MITRE ATT&CK في عمليات الأمن',
    },
  },
  insight: {
    src: '/marketing/shots/suite-insight.webp',
    width: 1200,
    height: 879,
    alt: {
      en: 'Unified analytics dashboards with cross-suite indicators',
      ar: 'لوحات تحليلات موحّدة بمؤشرات عبر المجموعات',
    },
  },
};

function SuiteSummary({ suite }: { suite: Suite }) {
  const { locale, messages: m } = useMarketingLocale();
  const meta = SUITE_SUMMARY_META[suite.family];
  const st = localizeMarketingSuite(suite, locale);
  const outcome = m.home.suiteOutcomes[suite.family];
  const thumb = SUITE_THUMBS[suite.family];
  return (
    <div className="suite-block fade-up">
      <div className={`suite-hero ${suite.family} has-thumb`}>
        {/* Decorative Latin watermark — kept as-is in both locales. */}
        <div className="suite-bgtext" aria-hidden="true">
          {meta.bg}
        </div>
        <div style={{ position: 'relative', zIndex: 2, maxWidth: '640px' }}>
          <div className="eyebrow">{locale === 'ar' ? meta.nAr : meta.n}</div>
          <h2 style={{ fontSize: 'clamp(1.8rem,3.5vw,2.6rem)' }}>{suite.name}</h2>
          <p className="lede">{st.tagline}</p>
          {/* Outcome-first reframe — lead with the business result. */}
          <div
            style={{
              marginTop: '14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              color: 'rgba(255,255,255,.92)',
              fontSize: '.98rem',
              maxWidth: '560px',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: '.68rem',
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: 'var(--gold-400)',
                flex: 'none',
                marginTop: '4px',
              }}
            >
              {m.home.suiteOutcomeLabel}
            </span>
            <span>{outcome}</span>
          </div>
          <Link
            className="btn btn-ondark"
            style={{ marginTop: '20px' }}
            href={getMarketingSuitePath(suite.id)}
          >
            {HOME_UI.explore[locale]} {suite.name} <MarketingIcon name="arrow" />
          </Link>
        </div>
        {/* floating, tilted product shot (lazy — below the fold) */}
        <div className="suite-thumb">
          <Shot
            src={thumb.src}
            alt={thumb.alt[locale]}
            width={thumb.width}
            height={thumb.height}
          />
        </div>
      </div>
      <div className="apps-grid">
        {suite.apps.map((app) => (
          <AppCard key={app.id} app={app} suite={suite} />
        ))}
      </div>
    </div>
  );
}

/* deployGrid() — HTML 1915-1949. Card copy is data-driven + bilingual
   (MARKETING_DEPLOY_CARDS); the `deploy saas|onprem|airgap` modifier class
   comes from each card's stable `key`. */
function DeployGrid() {
  const { locale } = useMarketingLocale();
  const cards = getMarketingDeployCards(locale);
  return (
    <div className="deploy-grid">
      {cards.map((card) => (
        <div className={`deploy ${card.key}`} key={card.key}>
          {/* Drawn mode illustration — saas / onprem / airgap. */}
          <div aria-hidden="true" style={{ marginBottom: '10px' }}>
            <DeploymentModeIcon mode={card.key as DeploymentMode} />
          </div>
          <span className="dtag">{card.tag}</span>
          <h4>{card.title}</h4>
          <p>{card.body}</p>
          <ul>
            {card.items.map((item) => (
              <li key={item}>
                <MarketingIcon name="check" /> {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const SUITES_BY_FAMILY = Object.fromEntries(
  MARKETING_SUITES.map((s) => [s.family, s]),
) as Record<Family, Suite>;

export function HomeSite() {
  const { locale, messages: m } = useMarketingLocale();
  const vars = countVars(locale);
  return (
    <>
      {/* hero — HTML 1591-1641 */}
      <header className="hero">
        <div className="hero-bg">
          <div className="hero-grad" />
          <div className="hero-grad2" />
          <div className="grid-overlay" />
        </div>
        <div className="wrap hero-inner">
          <div className="hero-grid">
            <div>
              <HeroSessionBadge />
              <div className="hero-badge">
                <b>{m.home.heroBadgeLabel}</b>{' '}
                <span>{m.home.heroBadgeText}</span>
              </div>
              <h1>
                {m.home.heroTitleLine1}
                <br />
                {m.home.heroTitleLine2}
                <br />
                <span className="accent">{m.home.heroTitleAccent}</span>
              </h1>
              <p className="lede">{m.home.heroLede}</p>
              {/* CTA hierarchy: one primary (demo) + one secondary (Sign in). */}
              <div className="hero-actions">
                <Link className="btn btn-gold btn-lg" href="/contact">
                  {m.home.ctaRequestDemo} <MarketingIcon name="arrow" />
                </Link>
                <Link className="btn btn-ondark btn-lg" href="/login">
                  {m.nav.signIn}
                </Link>
              </div>
              <div className="hero-trust">
                {HERO_TRUST_LABELS.map((t, i) => {
                  /* Values stay DATA-derived: suites / applications / the
                     regulatory marks we actually show below / deployment
                     models — so the counters can never drift from the page.
                     CountUp animates on view and localizes numerals. */
                  const value =
                    i === 0
                      ? HOME_COUNTS.suites
                      : i === 1
                        ? HOME_COUNTS.apps
                        : i === 2
                          ? m.home.proof.badges.length
                          : getMarketingDeployCards(locale).length;
                  return (
                    <div className="t" key={i}>
                      <b>
                        <CountUp to={value} />
                      </b>
                      <span>{t[locale]}</span>
                    </div>
                  );
                })}
              </div>
              {/* Honest GA-vs-roadmap split, computed from the data. */}
              <p
                style={{
                  marginTop: '16px',
                  marginBottom: 0,
                  color: 'var(--text-inv-2)',
                  fontSize: '.84rem',
                }}
              >
                {interp(m.home.coverageLine, vars)}
              </p>
            </div>
            <div>
              {/* The real product replaces the drawn arch-card: a live
                  console shot in a browser frame, locale-matched (EN sees
                  the DR readiness console, AR the Arabic legal workspace). */}
              <div className="hero-shot">
                <BrowserFrame dark>
                  <Shot
                    src={HERO_SHOT[locale].src}
                    alt={HERO_SHOT[locale].alt}
                    width={1920}
                    height={1140}
                    eager
                  />
                </BrowserFrame>
              </div>
            </div>
          </div>
        </div>
        <div className="strip" style={{ marginTop: '84px' }}>
          <div className="wrap strip-inner">
            <span className="strip-label">{m.home.stripLabel}</span>
            <div className="strip-items">
              <span>NCA</span>
              <span>SAMA</span>
              <span>PDPL</span>
              <span>Najiz</span>
              <span>ZATCA</span>
              <span>ISO 27001</span>
            </div>
          </div>
        </div>
      </header>

      {/* Proof — early social proof + dated, linked compliance badges */}
      <ProofBand />

      {/* Problem — the cost of point-tool sprawl */}
      <ProblemSection />

      {/* Product tour — four benefit-led screenshots of the real platform */}
      <FeatureTours />

      {/* Four suites, reframed as outcomes — lead with what buyers get */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {m.home.suitesEyebrow}
            </div>
            <h2>{m.home.suitesTitle}</h2>
            <p className="lede">{m.home.suitesLede}</p>
          </div>
          <SuiteSummary suite={SUITES_BY_FAMILY.ds} />
          <div style={{ height: '30px' }} />
          <SuiteSummary suite={SUITES_BY_FAMILY.bp} />
          <div style={{ height: '30px' }} />
          <SuiteSummary suite={SUITES_BY_FAMILY.sec} />
          <div style={{ height: '30px' }} />
          <SuiteSummary suite={SUITES_BY_FAMILY.insight} />
        </div>
      </section>

      {/* Mid-page CTA band — convert straight after the product */}
      <MidCtaBand />

      {/* Geometric divider — quiet KSA identity between narrative acts */}
      <GeometricBand />

      {/* Sovereignty — the strongest differentiator, kept prominent */}
      <SovereigntySection />

      {/* ---- Lower "how it works / for evaluators" band: the adoption flow,
             platform principles and deployment/security depth now sit BELOW
             the outcome + CTA sections, not above them. The former event-bus
             architecture diagram (<BusDiagram/>) was dropped from this page —
             it read as a system diagram, not a marketing proof point. ---- */}

      {/* How it works — four-step adoption flow */}
      <HowItWorks />

      {/* Principles — platform depth for evaluators */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{m.home.principlesEyebrow}</div>
            <h2>{m.home.principlesTitle}</h2>
            <p className="lede">{m.home.principlesLede}</p>
          </div>
          <div className="principles">
            {MARKETING_PRINCIPLES.map((p, i) => {
              const pl = localizeMarketingPrinciple(i, p, locale);
              return (
                <div className="principle fade-up" key={p.title}>
                  <div className="num">P{String(i + 1).padStart(2, '0')}</div>
                  <div className="pic">
                    <MarketingIcon name={p.icon} />
                  </div>
                  <h4>{pl.title}</h4>
                  <p>{pl.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Deployment — SaaS · on-prem · air-gapped */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{m.home.deployEyebrow}</div>
            <h2>{m.home.deployTitle}</h2>
            <p className="lede">{m.home.deployLede}</p>
          </div>
          <DeployGrid />
        </div>
      </section>

      {/* Security & compliance depth */}
      <SecuritySection />

      {/* Integrations — the connector wall (fits your stack) */}
      <IntegrationWall />

      {/* Geometric divider before the outcomes band */}
      <GeometricBand />

      {/* Outcomes — Stats (count up on scroll; numerals localize) */}
      <StatsBand
        stats={[
          {
            value: (
              <>
                ≤
                <em>
                  <CountUp to={15} />
                </em>
                min
              </>
            ),
            label: m.home.statLabels[0],
          },
          {
            value: (
              <>
                ≤
                <em>
                  <CountUp to={10} />
                </em>
                s
              </>
            ),
            label: m.home.statLabels[1],
          },
          {
            value: (
              <>
                −
                <em>
                  <CountUp to={40} />
                </em>
                %
              </>
            ),
            label: m.home.statLabels[2],
          },
          {
            value: (
              <>
                <em>
                  <CountUp to={100} />
                </em>
                %
              </>
            ),
            label: m.home.statLabels[3],
          },
        ]}
      />

      {/* Outcomes — ROI economics */}
      <RoiSection />

      {/* Pricing preview */}
      <PricingPreview />

      {/* Evaluate / proof entry points — HTML 1707-1728 */}
      <section className="section-tight">
        <div className="wrap">
          <div className="home-links">
            {HOME_LINKS.map((link) => (
              <Link className="home-link" href={link.href} key={link.href}>
                <div className="hl-ico" aria-hidden="true">
                  <MarketingIcon name={link.icon} />
                </div>
                <div>
                  <h4>{link[locale].title}</h4>
                  <p>{link[locale].body}</p>
                </div>
                <MarketingIcon name="arrow" className="hl-arrow" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <HomeFaq />

      {/* Conversion close — CTA over a faded collage of real product shots */}
      <FinalCtaCollage />
    </>
  );
}
