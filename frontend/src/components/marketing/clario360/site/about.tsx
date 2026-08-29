'use client';

import Link from 'next/link';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';
import { Breadcrumb, CtaBand } from './shared';

/* ============================================================
   AboutSite — mission / vision / trust story.

   Reworked toward marketing: leads with WHY the platform exists
   and what institutions GET (sovereign, Arabic-first, compounding
   capability), then a trust/proof band (KSA compliance framing +
   deployment choice + repeated CTAs), then the forward roadmap
   framed as "where we're going" — genuine depth, kept lower.

   Hero + roadmap rows + closing CTA reuse the already-good
   `m.about` copy (EN/LTR default, MSA Arabic/RTL on toggle). New
   marketing copy lives in the INLINE bilingual `COPY` const below
   (both languages provided) and is picked by `locale`. The former
   engineering "event-bus" BusDiagram is intentionally dropped from
   this page — it belongs on the platform/architecture surface.
   ============================================================ */

type AboutCopy = {
  belief: { eyebrow: string; title: string; p1: string; p2: string };
  principles: { term: string; def: string }[];
  trust: {
    eyebrow: string;
    title: string;
    lede: string;
    frameworks: string[];
    deployTitle: string;
    deploy: string[];
    requestDemo: string;
    talkSales: string;
  };
  roadmap: { eyebrow: string; title: string };
};

const COPY: Record<'en' | 'ar', AboutCopy> = {
  en: {
    belief: {
      eyebrow: 'Why we exist',
      title: 'Enterprise software that belongs to the Kingdom',
      p1: 'For too long, institutions in Saudi Arabia had to choose: global software that moves regulated data offshore, or local tools that never quite keep pace. Clario360 was built to end that trade-off — one sovereign platform, Arabic-first, that keeps your data in the Kingdom and your institution ahead of it.',
      p2: 'Because every suite is built on one foundation, capability compounds instead of fragmenting. Your teams learn one system, your auditors follow one trail, and each new capability you add costs less than the last — so the platform grows more valuable the longer you run it.',
    },
    principles: [
      { term: 'Arabic-first', def: 'Designed in Arabic, never translated into it' },
      { term: 'Sovereign by default', def: 'Your data stays in the Kingdom, on infrastructure you approve' },
      { term: 'One platform', def: 'Capability compounds — your teams learn one system' },
      { term: 'Trusted & auditable', def: 'Mapped to KSA regulators, with evidence built in' },
    ],
    trust: {
      eyebrow: 'Built for trust',
      title: 'Compliance your auditors already recognise',
      lede: 'Clario360 is aligned to the frameworks that govern Saudi institutions — so approval becomes a conversation, not a battle. Deploy the way your policy requires, and keep full control of where your data lives.',
      frameworks: ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'],
      deployTitle: 'Deploy on your terms',
      deploy: ['SaaS', 'On-premise', 'Air-gapped'],
      requestDemo: 'Request a demo',
      talkSales: 'Talk to sales',
    },
    roadmap: {
      eyebrow: 'Where we’re going',
      title: 'A roadmap sequenced with intent',
    },
  },
  ar: {
    belief: {
      eyebrow: 'لماذا نحن موجودون',
      title: 'برمجيات مؤسسية تنتمي إلى المملكة',
      p1: 'طويلاً كان على مؤسسات المملكة العربية السعودية أن تختار: برمجيات عالمية تنقل البيانات المنظَّمة إلى الخارج، أو أدوات محلية لا تواكب الطموح. وُجدت Clario360 لتُنهي هذه المفاضلة — منصّة سيادية واحدة، بالعربية أولاً، تُبقي بياناتكم داخل المملكة وتُبقي مؤسستكم في المقدّمة.',
      p2: 'ولأن كل مجموعة مبنيّة على أساسٍ واحد، تتراكم القدرات بدلاً من أن تتشظّى. تتعلّم فرقكم نظاماً واحداً، ويتبع مدقّقوكم مساراً واحداً، وتكلّف كل قدرة جديدة تضيفونها أقلّ من سابقتها — فتزداد قيمة المنصّة كلما طال تشغيلكم لها.',
    },
    principles: [
      { term: 'العربية أولاً', def: 'مُصمَّمة بالعربية، لا مُترجَمة إليها' },
      { term: 'سيادية افتراضياً', def: 'بياناتكم تبقى داخل المملكة، على بنية تعتمدونها' },
      { term: 'منصّة واحدة', def: 'تتراكم القدرات — تتعلّم فرقكم نظاماً واحداً' },
      { term: 'موثوقة وقابلة للتدقيق', def: 'متوائمة مع جهات المملكة التنظيمية، بأدلّة مدمجة' },
    ],
    trust: {
      eyebrow: 'مبنيّة على الثقة',
      title: 'امتثالٌ يعرفه مدقّقوكم أصلاً',
      lede: 'إن Clario360 متوائمة مع الأطر التي تحكم مؤسسات المملكة — ليغدو الاعتماد حواراً لا معركة. انشروها كما تقتضي سياستكم، واحتفظوا بالسيطرة الكاملة على مكان بياناتكم.',
      frameworks: ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'],
      deployTitle: 'انشروها بشروطكم',
      deploy: ['خدمة سحابية', 'داخل مقرّكم', 'بيئة معزولة'],
      requestDemo: 'اطلبوا عرضاً توضيحياً',
      talkSales: 'تحدّثوا إلى المبيعات',
    },
    roadmap: {
      eyebrow: 'إلى أين نمضي',
      title: 'خارطة طريق مرتّبة بنيّة واضحة',
    },
  },
};

export function AboutSite() {
  const { locale, messages: m } = useMarketingLocale();
  const a = m.about;
  const t = COPY[locale];

  return (
    <>
      <header className="page-hero">
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <Breadcrumb
            trail={[
              { label: m.chrome.breadcrumbHome, href: '/' },
              { label: a.breadcrumb },
            ]}
          />
          <div className="eyebrow">{a.heroEyebrow}</div>
          <h1>{a.heroTitle}</h1>
          <p className="lede">{a.heroLede}</p>
        </div>
      </header>

      {/* Why we exist — mission, benefit-led */}
      <section className="section">
        <div className="wrap split">
          <div>
            <div className="eyebrow">{t.belief.eyebrow}</div>
            <h2 style={{ marginBottom: '18px' }}>{t.belief.title}</h2>
            <p style={{ color: 'var(--text-2)' }}>{t.belief.p1}</p>
            <p style={{ color: 'var(--text-2)' }}>{t.belief.p2}</p>
          </div>
          <div>
            <div className="specs" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 0 }}>
              {t.principles.map((s) => (
                <div className="spec" key={s.term}>
                  <b>{s.term}</b>
                  <span>{s.def}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Trust / proof band — compliance reassurance, deployment choice, CTAs */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{t.trust.eyebrow}</div>
            <h2>{t.trust.title}</h2>
            <p className="lede">{t.trust.lede}</p>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '28px',
            }}
          >
            {t.trust.frameworks.map((f) => (
              <span
                key={f}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '9px 18px',
                  borderRadius: '999px',
                  border: '1px solid var(--line)',
                  background: 'var(--card)',
                  color: 'var(--text)',
                  fontSize: '.9rem',
                  fontWeight: 600,
                }}
              >
                {f}
              </span>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '24px',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-lg)',
              padding: '28px 32px',
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 700,
                  marginBottom: '12px',
                  color: 'var(--text)',
                }}
              >
                {t.trust.deployTitle}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {t.trust.deploy.map((d) => (
                  <span
                    key={d}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '999px',
                      border: '1px solid var(--line-2)',
                      color: 'var(--text-2)',
                      fontSize: '.85rem',
                      fontWeight: 600,
                    }}
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              <Link className="btn btn-primary" href="/contact">
                {t.trust.requestDemo}
              </Link>
              <Link className="btn btn-ghost" href="/contact">
                {t.trust.talkSales}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Where we're going — forward roadmap, genuine depth kept lower */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{t.roadmap.eyebrow}</div>
            <h2>{t.roadmap.title}</h2>
            <p className="lede">{a.roadmapLede}</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {a.roadmap.map((r) => (
              <div
                key={r.phase}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 1fr',
                  gap: '24px',
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-lg)',
                  padding: '28px',
                  alignItems: 'start',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '.78rem',
                      fontWeight: 700,
                      letterSpacing: '.1em',
                      color: 'var(--gold-600)',
                      marginBottom: '6px',
                    }}
                  >
                    {r.phase}
                  </div>
                  <h4 style={{ margin: 0 }}>{r.name}</h4>
                </div>
                <p style={{ margin: 0, color: 'var(--text-2)', paddingTop: '4px' }}>
                  {r.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand title={a.cta.title} sub={a.cta.sub} />
    </>
  );
}
