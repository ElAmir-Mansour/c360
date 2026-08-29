'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { MarketingIcon } from '../marketing-icons';
import {
  PLATFORM_ENGINES,
  localizeMarketingEngine,
  localizeMarketingEngineDetail,
  type PlatformEngineRecord,
} from '@/lib/marketing';
import { getPlatformEnginePath } from '@/lib/marketing/routes';
import type { MarketingEngineDetail } from '@/lib/marketing/types';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';
import { Breadcrumb, CtaBand } from './shared';

/* ============================================================
   EngineSite — per-capability page (platform/[engine]).

   Reframed for marketing: the page leads with the OUTCOME a
   buyer gets from this capability (configure-don't-code, govern
   once, sovereign) and a compliance trust strip. The genuine
   technical depth (what it does, where it is used, how it holds
   up for evaluators) sits lower on the page — kept, not led with.

   Chrome reuses `m.platformEngine.*` where it is still on-message;
   new benefit-led copy is an inline bilingual COPY const so the
   shared messages.ts is untouched. The engine's own prose still
   comes from the DATA localizers (`localizeMarketingEngine*`);
   engine names stay Latin (product).
   ============================================================ */

const COPY = {
  en: {
    heroTagline:
      'One capability, governed once and reused across every Clario360 suite.',
    ctaSales: 'Talk to sales',
    ctaAll: 'Explore all capabilities',
    trustLabel: 'Assured against Saudi frameworks',
    valueEyebrow: 'Why it matters',
    valueTitle: 'What you get',
    pillars: [
      {
        icon: 'sync',
        title: 'Configure it — don’t wait on code',
        desc: 'Your administrators change the rules and behaviour in place. No engineering release cycle to sit through.',
      },
      {
        icon: 'shield',
        title: 'Governed once, everywhere',
        desc: 'Access, policy and audit live in one place and apply the same way across every suite you run.',
      },
      {
        icon: 'globe',
        title: 'Sovereign by default',
        desc: 'Your data stays in-Kingdom. Deploy as SaaS, in your own data centre, or fully air-gapped.',
      },
    ],
    whereTitle: 'Where you’ll use it',
    evalEyebrow: 'For evaluators',
    evalTitle: 'How it holds up',
    evalPoints: [
      {
        icon: 'lock',
        title: 'One authenticated access layer',
        desc: 'Every request is authenticated and authorised before it ever reaches your data.',
      },
      {
        icon: 'clipboard',
        title: 'Audit-ready by design',
        desc: 'Actions are recorded on a tamper-evident trail your auditors can rely on.',
      },
      {
        icon: 'server',
        title: 'Deploy your way',
        desc: 'SaaS, in your own data centre, or fully offline — the same platform, under your control.',
      },
    ],
    moreEyebrow: 'More of the platform',
    moreTitle: 'Explore more capabilities',
    moreLede:
      'Every Clario360 capability is built once and reused across your suites — so what you standardise here compounds everywhere else.',
    ctaTitle: 'See it in your environment',
    ctaSub:
      'Book a working session and we’ll show this capability running against your own scenarios — SaaS, on-prem or air-gapped.',
  },
  ar: {
    heroTagline:
      'قدرةٌ واحدة، تُحكَم مرة وتُعاد الاستفادة منها عبر كل مجموعات Clario360.',
    ctaSales: 'تحدّث إلى المبيعات',
    ctaAll: 'استعرض كل القدرات',
    trustLabel: 'متوافقة مع الأطر التنظيمية السعودية',
    valueEyebrow: 'لماذا يهمّك',
    valueTitle: 'ما الذي تحصل عليه',
    pillars: [
      {
        icon: 'sync',
        title: 'اضبطها بنفسك — دون انتظار البرمجة',
        desc: 'يغيّر المسؤولون لديك القواعد والسلوك مباشرةً. لا حاجة لانتظار دورة إصدار هندسية.',
      },
      {
        icon: 'shield',
        title: 'حَوكمة مرة، في كل مكان',
        desc: 'الوصول والسياسات والتدقيق في مكان واحد وتُطبَّق بالطريقة ذاتها عبر كل مجموعاتك.',
      },
      {
        icon: 'globe',
        title: 'سيادية بالأصل',
        desc: 'تبقى بياناتك داخل المملكة. انشرها كخدمة سحابية أو داخل مركز بياناتك أو معزولة تماماً.',
      },
    ],
    whereTitle: 'أين ستستخدمها',
    evalEyebrow: 'لفريق التقييم',
    evalTitle: 'كيف تصمد تقنياً',
    evalPoints: [
      {
        icon: 'lock',
        title: 'طبقة وصول موثّقة واحدة',
        desc: 'كل طلب يُوثَّق ويُصرَّح به قبل أن يصل إلى بياناتك.',
      },
      {
        icon: 'clipboard',
        title: 'جاهزة للتدقيق بالتصميم',
        desc: 'تُسجَّل الإجراءات في سجلّ مقاوم للعبث يعتمد عليه مدقّقوك.',
      },
      {
        icon: 'server',
        title: 'انشرها كما تريد',
        desc: 'كخدمة سحابية أو داخل مركز بياناتك أو معزولة تماماً — المنصّة ذاتها، وتحت تحكّمك.',
      },
    ],
    moreEyebrow: 'المزيد من المنصّة',
    moreTitle: 'استكشف قدراتٍ أخرى',
    moreLede:
      'كل قدرة في Clario360 تُبنى مرة وتُعاد الاستفادة منها عبر مجموعاتك — فما توحّده هنا يتراكم أثره في كل مكان آخر.',
    ctaTitle: 'شاهدها في بيئتك',
    ctaSub:
      'احجز جلسة عمل ونعرض لك هذه القدرة تعمل على سيناريوهاتك الخاصة — سحابياً أو داخل منشآتك أو معزولة.',
  },
} as const;

const TRUST_ITEMS = [
  'NCA',
  'SAMA',
  'PDPL',
  'ZATCA',
  'ISO 27001',
  'Najiz',
] as const;

export function EngineSite({
  engine,
  detail,
}: {
  engine: PlatformEngineRecord;
  detail: MarketingEngineDetail;
}) {
  const { locale, dir, messages: m } = useMarketingLocale();
  const pe = m.platformEngine;
  const t = COPY[locale];
  const rtlMono: CSSProperties | undefined =
    dir === 'rtl'
      ? { fontFamily: 'var(--arabic)', letterSpacing: 'normal', textTransform: 'none' }
      : undefined;

  const others = PLATFORM_ENGINES.filter((x) => x.id !== engine.id);

  const engineDescription = localizeMarketingEngine(engine, locale).description;
  const d = localizeMarketingEngineDetail(engine.id, detail, locale);
  // `tag` is not covered by the DATA localizer, so AR is supplied by the page
  // chrome map (EN falls back to the DATA-owned tag). Shown as a plain-language
  // category chip rather than the old "Engine 01 of 12" counter.
  const tag = pe.tags[engine.id] ?? detail.tag;
  const insideTitle = pe.insideTitle.replace('{name}', engine.name);

  return (
    <>
      <header className="page-hero">
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <Breadcrumb
            trail={[
              { label: m.chrome.breadcrumbHome, href: '/' },
              { label: pe.breadcrumbPlatform, href: '/platform' },
              { label: engine.name },
            ]}
          />
          <div className="app-hero">
            <div
              className="big-ico"
              style={{
                background:
                  'linear-gradient(150deg,rgba(255,255,255,.22),rgba(255,255,255,.08))',
                border: '1px solid rgba(255,255,255,.25)',
              }}
              aria-hidden="true"
            >
              <MarketingIcon name={engine.icon} />
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
                <h1 style={{ margin: 0 }}>{engine.name}</h1>
                <span className="badge-ga" style={rtlMono}>
                  {tag}
                </span>
              </div>
              <p
                style={{
                  color: 'var(--gold-400)',
                  margin: '8px 0 0',
                  fontSize: '1rem',
                  fontWeight: 600,
                  maxWidth: '46ch',
                }}
              >
                {t.heroTagline}
              </p>
            </div>
          </div>
          <p className="lede" style={{ marginTop: '10px' }}>
            {engineDescription}.
          </p>
          <div
            style={{
              marginTop: '28px',
              display: 'flex',
              gap: '14px',
              flexWrap: 'wrap',
            }}
          >
            <Link className="btn btn-gold" href="/contact">
              {pe.ctaRequestDemo} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark" href="/contact">
              {t.ctaSales}
            </Link>
            <Link className="btn btn-ondark" href="/platform">
              {t.ctaAll}
            </Link>
          </div>
        </div>
        <div className="strip" style={{ marginTop: '40px' }}>
          <div className="wrap strip-inner">
            <span className="strip-label">{t.trustLabel}</span>
            <div className="strip-items">
              {TRUST_ITEMS.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Outcome-led value pillars — what the buyer GETS, up top. */}
      <section className="section-tight" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{t.valueEyebrow}</div>
            <h3>{t.valueTitle}</h3>
          </div>
          <div className="modules">
            {t.pillars.map((p) => (
              <div className="module" key={p.title}>
                <div className="mi" aria-hidden="true">
                  <MarketingIcon name={p.icon} />
                </div>
                <div>
                  <h5>{p.title}</h5>
                  <p>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap split">
          <div>
            <div className="eyebrow">{pe.whatItDoes}</div>
            <h2 style={{ marginBottom: '18px' }}>{engine.name}</h2>
            <p className="lede" style={{ fontSize: '1.1rem' }}>
              {d.long}
            </p>
          </div>
          <div>
            <div className="eyebrow">{t.whereTitle}</div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                marginTop: '8px',
              }}
            >
              {d.consumers.map((c) => (
                <div
                  key={c}
                  style={{
                    display: 'flex',
                    gap: '11px',
                    alignItems: 'center',
                    background: 'var(--card)',
                    border: '1px solid var(--line)',
                    borderRadius: '10px',
                    padding: '13px 16px',
                  }}
                >
                  <span style={{ color: 'var(--navy-600)' }} aria-hidden="true">
                    <MarketingIcon name="checkCircle" />
                  </span>
                  <span style={{ fontSize: '.92rem', fontWeight: 500 }}>{c}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section-tight" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{pe.capabilities}</div>
            <h3>{insideTitle}</h3>
          </div>
          <div className="modules">
            {d.points.map((mod) => (
              <div className="module" key={mod.title}>
                <div className="mi" aria-hidden="true">
                  <MarketingIcon name={mod.icon} />
                </div>
                <div>
                  <h5>{mod.title}</h5>
                  <p>{mod.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Technical reassurance — kept, but LOWER on the page. */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{t.evalEyebrow}</div>
            <h3>{t.evalTitle}</h3>
          </div>
          <div className="modules">
            {t.evalPoints.map((p) => (
              <div className="module" key={p.title}>
                <div className="mi" aria-hidden="true">
                  <MarketingIcon name={p.icon} />
                </div>
                <div>
                  <h5>{p.title}</h5>
                  <p>{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{t.moreEyebrow}</div>
            <h3>{t.moreTitle}</h3>
            <p className="lede">{t.moreLede}</p>
          </div>
          <div className="engines">
            {others.map((x) => (
              <Link
                className="engine"
                href={getPlatformEnginePath(x.id)}
                key={x.id}
                style={{ cursor: 'pointer', textDecoration: 'none' }}
              >
                <div className="ei" aria-hidden="true">
                  <MarketingIcon name={x.icon} />
                </div>
                <h5>{x.name}</h5>
                <p>{localizeMarketingEngine(x, locale).description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <CtaBand title={t.ctaTitle} sub={t.ctaSub} />
    </>
  );
}
