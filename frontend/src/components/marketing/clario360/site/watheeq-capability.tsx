'use client';

import Link from 'next/link';
import type { MarketingSuiteRecord } from '@/lib/marketing';
import { getMarketingAppPath } from '@/lib/marketing/routes';
import type {
  WatheeqDomain,
  WatheeqCapStatus,
} from '@/lib/marketing/watheeq-capabilities';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';
import { CtaBand } from './shared';

type SuiteRecord = MarketingSuiteRecord;
type AppRecord = MarketingSuiteRecord['apps'][number];

/* ============================================================
   WatheeqTech capability-domain detail page — the drill-down reached
   from an "Inside WatheeqTech" module card (/{suite}/watheeq/{slug}).
   Chrome is localised via a co-located {en,ar} map; the domain
   body is bilingual DATA from lib/marketing/watheeq-capabilities.
   ============================================================ */

const UI = {
  home: { en: 'Home', ar: 'الرئيسية' },
  back: { en: 'Back to WatheeqTech', ar: 'العودة إلى وثيقتك' },
  requestDemo: { en: 'Request a demo', ar: 'اطلب عرضاً توضيحياً' },
  capabilities: { en: 'capabilities', ar: 'قدرة' },
  eyebrow: { en: 'WatheeqTech · Capability', ar: 'وثيقتك · القدرات' },
  ctaTitle: {
    en: 'See this in your own environment',
    ar: 'شاهد ذلك في بيئتكم الخاصة',
  },
} as const;

const STATUS: Record<WatheeqCapStatus, { en: string; ar: string; cls: string }> = {
  production: { en: 'Live', ar: 'متاح', cls: 'badge-ga' },
  configurable: { en: 'Configurable', ar: 'قابل للتهيئة', cls: 'badge-soon' },
  roadmap: { en: 'Roadmap', ar: 'خارطة الطريق', cls: 'badge-soon' },
};

export function WatheeqCapabilityPage({
  suite,
  app,
  domain,
}: {
  suite: SuiteRecord;
  app: AppRecord;
  domain: WatheeqDomain;
}) {
  const { locale } = useMarketingLocale();
  const appPath = getMarketingAppPath(suite.id, app.id);

  return (
    <>
      {/* Dark hero — the fixed nav renders on-dark and sits over this.
         Mirrors the app page's page-hero chrome (suite-bp = Business+). */}
      <header className={`page-hero suite-${suite.family}`}>
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <div className="breadcrumb">
            <Link href="/">{UI.home[locale]}</Link>{' '}
            <MarketingIcon name="chev" />
            <Link href={appPath}>{app.name}</Link>{' '}
            <MarketingIcon name="chev" />
            <span>{domain.title[locale]}</span>
          </div>
          <div className="eyebrow">
            <MarketingIcon name={domain.icon} /> {UI.eyebrow[locale]}
          </div>
          <h1 style={{ margin: '6px 0 0' }}>{domain.title[locale]}</h1>
          <p className="lede" style={{ marginTop: '14px' }}>
            {domain.intro[locale]}
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '14px',
              alignItems: 'center',
              marginTop: '28px',
            }}
          >
            <Link className="btn btn-gold" href="/contact">
              {UI.requestDemo[locale]} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark" href={appPath}>
              {UI.back[locale]}
            </Link>
            <span style={{ color: 'rgba(255,255,255,.6)', fontSize: '.85rem' }}>
              {domain.capabilities.length} {UI.capabilities[locale]}
            </span>
          </div>
        </div>
      </header>

      {/* Capabilities */}
      <section className="section">
        <div className="wrap">
          <div className="modules">
            {domain.capabilities.map((cap, i) => {
              const s = STATUS[cap.status];
              return (
                <div className="module" key={`${cap.title.en}-${i}`}>
                  <div style={{ flex: 1 }}>
                    <h5
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                        marginBottom: '6px',
                      }}
                    >
                      {cap.title[locale]}
                      <span className={s.cls}>{s[locale]}</span>
                    </h5>
                    <p style={{ margin: 0 }}>{cap.what[locale]}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <CtaBand title={UI.ctaTitle[locale]} sub={domain.intro[locale]} />
    </>
  );
}
