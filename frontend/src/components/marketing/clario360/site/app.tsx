'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import {
  localizeMarketingApp,
  type MarketingSuiteRecord,
} from '@/lib/marketing';
import type { MarketingLocale } from '@/lib/marketing/messages';

type SuiteRecord = MarketingSuiteRecord;
type AppRecord = MarketingSuiteRecord['apps'][number];
import {
  getMarketingAppPath,
  getMarketingSuitePath,
} from '@/lib/marketing/routes';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';
import { CtaBand } from './shared';

/* ============================================================
   App detail page — port of pageApp() (HTML 2048-2138).

   The app BODY copy (role, hero, desc, specs, flow, modules,
   bench) is DATA and comes bilingual from localizeMarketingApp;
   the app/suite NAMES are Latin brand names kept as-is. Only the
   page-template CHROME is localised here, via a co-located, typed
   {en,ar} module. The leading breadcrumb crumb and the closing
   CTA request-demo verb reuse the shared chrome.
   ============================================================ */

interface AppChromeCopy {
  /** Hero "back to suite" template — {name} stays the Latin brand name. */
  readonly backToSuite: string;
  readonly talkToSales: string;
  readonly trustChipLead: string;
  readonly overviewEyebrow: string;
  readonly overviewHeading: string;
  readonly deployEyebrow: string;
  readonly deployTitle: string;
  readonly deployLine: string;
  readonly deployModes: readonly string[];
  readonly sovereignEyebrow: string;
  readonly sovereignTitle: string;
  readonly sovereignLine: string;
  readonly flowEyebrow: string;
  readonly flowHeadingDs: string;
  readonly flowHeadingDefault: string;
  readonly modulesEyebrow: string;
  readonly modulesHeading: string;
  readonly modulesLede: string;
  readonly benchEyebrow: string;
  readonly benchHeading: string;
  readonly moreInSuite: string;
  readonly siblingsHeading: string;
  readonly learnMore: string;
  readonly ctaTitle: string;
}

/* Compliance frameworks shown as reassurance chips. These are proper-noun /
   standard identifiers (like the GA/Roadmap status badges) and stay literal
   in both languages. */
const COMPLIANCE_TAGS = [
  'NCA',
  'SAMA',
  'PDPL',
  'ZATCA',
  'ISO 27001',
  'Najiz',
] as const;

/** Small rounded reassurance chip on light surfaces. */
const LIGHT_CHIP: CSSProperties = {
  fontSize: '.8rem',
  fontWeight: 600,
  color: 'var(--text)',
  background: 'var(--paper-2)',
  border: '1px solid var(--line)',
  borderRadius: '999px',
  padding: '5px 14px',
};

const APP_COPY: Record<MarketingLocale, AppChromeCopy> = {
  en: {
    backToSuite: 'Explore {name}',
    talkToSales: 'Talk to sales',
    trustChipLead: 'Aligned with',
    overviewEyebrow: 'What you get',
    overviewHeading: 'What {name} does for you',
    deployEyebrow: 'Deploy your way',
    deployTitle: 'SaaS, on-premise, or fully air-gapped',
    deployLine:
      'The same product with no feature trade-offs — run it in our sovereign cloud, inside your own data centre, or in a disconnected classified environment.',
    deployModes: ['SaaS', 'On-premise', 'Air-gapped'],
    sovereignEyebrow: 'Sovereign · Arabic-first',
    sovereignTitle: 'Your data stays in the Kingdom',
    sovereignLine:
      'Built KSA-first with Arabic as a first-class language and one audit trail, aligned to the frameworks your regulators already expect.',
    flowEyebrow: 'For evaluators · How it works',
    flowHeadingDs: 'The sequence, gated end to end',
    flowHeadingDefault: 'From start to connected outcome',
    modulesEyebrow: 'Capabilities',
    modulesHeading: 'Inside {name}',
    modulesLede:
      'Everything your teams work in every day, in one place — configured to your process and ready from day one.',
    benchEyebrow: 'How it compares',
    benchHeading: 'The honest benchmark',
    moreInSuite: 'More in {name}',
    siblingsHeading: 'The rest of the suite',
    learnMore: 'Learn more',
    ctaTitle: 'See {name} on your own data',
  },
  ar: {
    backToSuite: 'استكشف {name}',
    talkToSales: 'تحدّث إلى المبيعات',
    trustChipLead: 'متوافق مع',
    overviewEyebrow: 'ما الذي تحصلون عليه',
    overviewHeading: 'ماذا يقدّم لكم {name}',
    deployEyebrow: 'انشر بطريقتك',
    deployTitle: 'سحابة، أو داخل مقرّكم، أو معزولة تماماً',
    deployLine:
      'المنتج نفسه دون أي تنازلٍ في الميزات — شغّله في سحابتنا السيادية، أو داخل مركز بياناتكم، أو في بيئةٍ معزولة ومصنّفة.',
    deployModes: ['سحابة', 'داخل المقرّ', 'معزولة تماماً'],
    sovereignEyebrow: 'سيادة · العربية أولاً',
    sovereignTitle: 'بياناتكم تبقى داخل المملكة',
    sovereignLine:
      'مبنيّ للمملكة أولاً مع العربية كلغةٍ من الدرجة الأولى وسجلّ تدقيقٍ واحد، متوافقٌ مع الأطر التي يتوقّعها منظّموكم.',
    flowEyebrow: 'للمُقيّمين · كيف يعمل',
    flowHeadingDs: 'التسلسل، مضبوطٌ ببوّابات من طرفٍ إلى طرف',
    flowHeadingDefault: 'من البداية إلى نتيجةٍ متّصلة',
    modulesEyebrow: 'القدرات',
    modulesHeading: 'داخل {name}',
    modulesLede:
      'كلّ ما تعمل عليه فرقكم يومياً في مكانٍ واحد — مُهيّأ وفق سير عملكم وجاهز من اليوم الأوّل.',
    benchEyebrow: 'كيف يُقارَن',
    benchHeading: 'المقارنة الصادقة',
    moreInSuite: 'المزيد في {name}',
    siblingsHeading: 'بقيّة المجموعة',
    learnMore: 'اعرف المزيد',
    ctaTitle: 'شاهد {name} على بياناتكم',
  },
};

/** Fill a single {token} in a localised template. */
function fill(template: string, token: string, value: string): string {
  return template.split(`{${token}}`).join(value);
}

/* statusBadge() (HTML 1760-1764). GA/Roadmap are treated as language-neutral
   status chips, matching the fully-bilingual home reference. */
function StatusBadge({ status }: { status: AppRecord['status'] }) {
  if (status === 'ga') return <span className="badge-ga">GA</span>;
  return <span className="badge-soon">Roadmap</span>;
}

/* appCard() (HTML 1766-1780) — used for the siblings grid. */
function AppCard({ app, suite }: { app: AppRecord; suite: SuiteRecord }) {
  const { locale } = useMarketingLocale();
  const at = localizeMarketingApp(app, locale);
  const learnMore = APP_COPY[locale].learnMore;
  return (
    <Link className="app-card" href={getMarketingAppPath(suite.id, app.id)}>
      <div className="ac-h">
        <div className="app-ico">
          <MarketingIcon name={app.icon} />
        </div>
        <div style={{ flex: 1 }}>
          <h4>
            {app.name}{' '}
            <span className="ar bilingual" dir="rtl" lang="ar">
              {app.ar}
            </span>{' '}
            <StatusBadge status={app.status} />
          </h4>
          <p className="role">{at.role}</p>
        </div>
      </div>
      <p>{at.short}</p>
      <span className="more">
        {learnMore} <MarketingIcon name="arrow" />
      </span>
    </Link>
  );
}

export interface AppSiteProps {
  suite: SuiteRecord;
  app: AppRecord;
}

export function AppSite({ suite, app }: AppSiteProps) {
  const { locale, messages: m } = useMarketingLocale();
  const c = APP_COPY[locale];
  const at = localizeMarketingApp(app, locale);
  const siblings = suite.apps.filter((x) => x.id !== app.id);

  /* "How it works" heading — the DataStream suite is a gated sequence, every
     other suite frames the flow as connected outcomes. (HTML 2099) */
  const flowHeading =
    suite.family === 'ds' ? c.flowHeadingDs : c.flowHeadingDefault;

  return (
    <>
      <header className={`page-hero suite-${suite.family}`}>
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <div className="breadcrumb">
            <Link href="/">{m.chrome.breadcrumbHome}</Link>{' '}
            <MarketingIcon name="chev" />
            <Link href={getMarketingSuitePath(suite.id)}>{suite.name}</Link>{' '}
            <MarketingIcon name="chev" />
            <span>{app.name}</span>
          </div>
          <div className="app-hero">
            <div
              className="big-ico"
              style={{
                background:
                  'linear-gradient(150deg,rgba(255,255,255,.22),rgba(255,255,255,.08))',
                border: '1px solid rgba(255,255,255,.25)',
              }}
            >
              <MarketingIcon name={app.icon} />
            </div>
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <h1 style={{ margin: 0 }}>{app.name}</h1>
                <span className="ar-big bilingual" dir="rtl" lang="ar">
                  {app.ar}
                </span>
                <StatusBadge status={app.status} />
              </div>
              <p
                style={{
                  color: 'var(--gold-400)',
                  margin: '6px 0 0',
                  fontWeight: 600,
                  fontSize: '.95rem',
                }}
              >
                {suite.name} · {at.role}
              </p>
            </div>
          </div>
          <p className="lede" style={{ marginTop: '10px' }}>
            {at.hero}
          </p>
          <div
            style={{
              marginTop: '28px',
              display: 'flex',
              gap: '14px',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <Link className="btn btn-gold" href="/contact">
              {m.chrome.cta.requestDemo} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark" href="/contact">
              {c.talkToSales}
            </Link>
            <Link
              href={getMarketingSuitePath(suite.id)}
              style={{
                color: 'rgba(255,255,255,.85)',
                fontWeight: 600,
                fontSize: '.9rem',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {fill(c.backToSuite, 'name', suite.name)}{' '}
              <MarketingIcon name="arrow" />
            </Link>
          </div>

          {/* Compliance reassurance — proof up top, framed as trust not spec. */}
          <div
            style={{
              marginTop: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: '.72rem',
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,.6)',
              }}
            >
              {c.trustChipLead}
            </span>
            {COMPLIANCE_TAGS.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: '.78rem',
                  fontWeight: 600,
                  color: 'rgba(255,255,255,.9)',
                  background: 'rgba(255,255,255,.08)',
                  border: '1px solid rgba(255,255,255,.2)',
                  borderRadius: '999px',
                  padding: '4px 12px',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Overview + specs */}
      <section className="section">
        <div className="wrap split">
          <div>
            <div className="eyebrow">{c.overviewEyebrow}</div>
            <h2 style={{ marginBottom: '18px' }}>
              {fill(c.overviewHeading, 'name', app.name)}
            </h2>
            <p className="lede" style={{ fontSize: '1.1rem' }}>
              {at.desc}
            </p>
          </div>
          <div
            className="specs"
            style={{ gridTemplateColumns: '1fr', gap: '14px', marginTop: 0 }}
          >
            {at.specs.map((sp, i) => (
              <div
                className="spec"
                key={`${sp.metric}-${i}`}
                style={{
                  textAlign: 'start',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '18px',
                }}
              >
                <b style={{ margin: 0 }}>{sp.metric}</b>
                <span style={{ fontSize: '.9rem' }}>{sp.description}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Deploy + sovereignty — reassurance before the deep dive. */}
      <section className="section-tight">
        <div className="wrap">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
              gap: '18px',
            }}
          >
            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: '16px',
                padding: '26px',
                background: 'var(--card)',
              }}
            >
              <div className="eyebrow">{c.deployEyebrow}</div>
              <h4 style={{ margin: '8px 0' }}>{c.deployTitle}</h4>
              <p
                style={{
                  color: 'var(--text-2)',
                  margin: 0,
                  lineHeight: 1.55,
                }}
              >
                {c.deployLine}
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  marginTop: '16px',
                }}
              >
                {c.deployModes.map((mode) => (
                  <span key={mode} style={LIGHT_CHIP}>
                    {mode}
                  </span>
                ))}
              </div>
            </div>
            <div
              style={{
                border: '1px solid var(--line)',
                borderRadius: '16px',
                padding: '26px',
                background: 'var(--card)',
              }}
            >
              <div className="eyebrow">{c.sovereignEyebrow}</div>
              <h4 style={{ margin: '8px 0' }}>{c.sovereignTitle}</h4>
              <p
                style={{
                  color: 'var(--text-2)',
                  margin: 0,
                  lineHeight: 1.55,
                }}
              >
                {c.sovereignLine}
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  flexWrap: 'wrap',
                  marginTop: '16px',
                }}
              >
                {COMPLIANCE_TAGS.map((tag) => (
                  <span key={tag} style={LIGHT_CHIP}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Flow */}
      <section
        className="section-tight"
        style={{ background: 'var(--paper-2)' }}
      >
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.flowEyebrow}</div>
            <h3>{flowHeading}</h3>
          </div>
          <div className="flow">
            {at.flow.map((f, i) => (
              <div className="flow-step" key={`${f.step}-${i}`}>
                <div className="fs-num">{i + 1}</div>
                <h6>{f.step}</h6>
                <p>{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.modulesEyebrow}</div>
            <h2>{fill(c.modulesHeading, 'name', app.name)}</h2>
            <p className="lede">{c.modulesLede}</p>
          </div>
          <div className="modules">
            {at.modules.map((mod, i) => {
              /* The drill-down slug is structural (lives on the EN data), so
                 read it from the raw app.modules, not the localised copy. */
              const slug = (app.modules[i] as { slug?: string } | undefined)
                ?.slug;
              const inner = (
                <>
                  <div className="mi">
                    <MarketingIcon name={mod.icon} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h5>{mod.title}</h5>
                    <p>{mod.description}</p>
                    {slug ? (
                      <span
                        className="more"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginTop: '10px',
                          color: 'var(--gold-600)',
                          fontWeight: 600,
                          fontSize: '.82rem',
                        }}
                      >
                        {locale === 'ar' ? 'استكشف التفاصيل' : 'Explore'}{' '}
                        <MarketingIcon name="arrow" />
                      </span>
                    ) : null}
                  </div>
                </>
              );
              return slug ? (
                <Link
                  className="module module-link"
                  key={`${mod.title}-${i}`}
                  href={`${getMarketingAppPath(suite.id, app.id)}/${slug}`}
                >
                  {inner}
                </Link>
              ) : (
                <div className="module" key={`${mod.title}-${i}`}>
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benchmark */}
      <section
        className="section"
        style={{ background: 'var(--ink)', color: '#fff' }}
      >
        <div
          className="wrap"
          style={{ maxWidth: '820px', textAlign: 'center' }}
        >
          <div
            className="eyebrow on-dark"
            style={{ justifyContent: 'center' }}
          >
            {c.benchEyebrow}
          </div>
          <h2 style={{ color: '#fff', marginBottom: '18px' }}>
            {c.benchHeading}
          </h2>
          <p
            className="lede"
            style={{ color: 'var(--text-inv-2)', fontSize: '1.25rem' }}
          >
            {at.bench}
          </p>
        </div>
      </section>

      {/* Siblings */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">
              {fill(c.moreInSuite, 'name', suite.name)}
            </div>
            <h3>{c.siblingsHeading}</h3>
          </div>
          <div className="apps-grid">
            {siblings.map((x) => (
              <AppCard key={x.id} app={x} suite={suite} />
            ))}
          </div>
        </div>
      </section>

      <CtaBand title={fill(c.ctaTitle, 'name', app.name)} sub={at.short} />
    </>
  );
}
