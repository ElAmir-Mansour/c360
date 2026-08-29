'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { PLATFORM_ENGINES, localizeMarketingEngine } from '@/lib/marketing';
import { getMarketingSuitePath, getPlatformEnginePath } from '@/lib/marketing/routes';
import type { MarketingLocale } from '@/lib/marketing/messages';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';
import { Breadcrumb, BusDiagram, CtaBand } from './shared';

/* ============================================================
   PLATFORM PAGE — reframed as a MARKETING CHANNEL.

   Structure: customer OUTCOMES and value lead the page; genuine
   architecture depth (engines, layers, event bus, tenancy) is
   demoted into a clearly-lower "For technical evaluators" band.

   Copy: benefit-led prose is authored inline (bilingual COPY,
   EN + AR) so messages.ts is untouched; the lower evaluator band
   reuses the existing, accurate `m.platform.*` technical copy.
   ============================================================ */

/* Arabic-Indic digit localisation for the small inline figures. */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function locNum(value: string | number, locale: MarketingLocale): string {
  const str = String(value);
  return locale === 'ar'
    ? str.replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)])
    : str;
}

/* --- Non-localised presentation metadata --------------------- */

/* Outcome tiles — one per suite, keyed positionally to COPY.outcomes. */
const OUTCOME_META: { suite: 'datastream' | 'business-plus' | 'clariosec' | 'clarioinsight'; icon: string; bg: string }[] = [
  { suite: 'datastream', icon: 'recover', bg: 'var(--navy-600)' },
  { suite: 'business-plus', icon: 'scale', bg: 'var(--gold-600)' },
  { suite: 'clariosec', icon: 'shield', bg: 'var(--teal-700)' },
  { suite: 'clarioinsight', icon: 'trend', bg: 'linear-gradient(135deg,var(--navy-600),var(--teal-700))' },
];

/* "Why one platform" value tiles — icons keyed to COPY.why. */
const WHY_ICONS = ['key', 'shield', 'globe', 'cube', 'trend', 'clipboard'] as const;

/* Compliance marks — recognised regulator/framework acronyms. */
const FRAMEWORKS = ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001'] as const;

/* System-context row icons — text comes from `m.platform.context.rows`. */
const CONTEXT_ICONS = ['users', 'key', 'building', 'shield'] as const;

/* Arch-card suite tiles — brand names + app counts (counts localised). */
const ARCH_SUITES: { family: string; name: string; apps: number }[] = [
  { family: 'ds', name: 'DataStream', apps: 4 },
  { family: 'bp', name: 'Business+', apps: 5 },
  { family: 'sec', name: 'ClarioSec', apps: 4 },
  { family: 'insight', name: 'ClarioInsight', apps: 2 },
];

/* Layered architecture — colours keyed positionally to
   `m.platform.master.layers` (name/detail). */
const LAYER_COLORS: { bg: string; fg: string }[] = [
  { bg: 'var(--navy-50)', fg: 'var(--navy-700)' },
  { bg: 'var(--navy-100)', fg: 'var(--navy-700)' },
  { bg: '#fff', fg: 'var(--text)' },
  { bg: 'var(--gold-100)', fg: 'var(--gold-600)' },
  { bg: 'var(--teal-100)', fg: 'var(--teal-700)' },
  { bg: 'var(--ink)', fg: '#fff' },
];

/* --- Inline bilingual marketing copy (EN + AR) --------------- */
const COPY = {
  en: {
    hero: {
      eyebrow: 'One sovereign platform',
      title: 'One platform for legal, security, disaster recovery and data.',
      lede: 'Run your most critical operations on a single sovereign platform built for the Kingdom. Recover from any outage in minutes, govern every contract, stop threats before they spread, and bring all your data into one view — under one login, one audit trail, and Arabic-first from the ground up.',
      ctaDemo: 'Request a demo',
      ctaSales: 'Talk to sales',
      trustLead: 'Aligned with',
    },
    outcomes: {
      eyebrow: 'What you get',
      title: 'Four suites. One platform. Every critical operation.',
      lede: 'Start with the outcome you need most and add the rest when you are ready — every suite runs on the same core, so capability compounds instead of fragmenting.',
      cards: [
        {
          headline: 'Recover in minutes, not days',
          label: 'DataStream · Disaster recovery & data mobility',
          body: 'Bounce back from ransomware, outages and data loss with tested, sovereign disaster recovery and seamless data movement across your environments.',
          cta: 'Explore DataStream',
        },
        {
          headline: 'Govern every contract and legal matter',
          label: 'Business+ · Legal, contracts & governance',
          body: 'Run the full contract lifecycle, legal matters and corporate governance in one place — with approvals, audit and Arabic-first documents your legal team trusts.',
          cta: 'Explore Business+',
        },
        {
          headline: 'Stop threats before they spread',
          label: 'ClarioSec · Cybersecurity',
          body: 'Detect and respond across your estate with threat detection, data security posture, user-behaviour analytics and a virtual CISO — all on one console.',
          cta: 'Explore ClarioSec',
        },
        {
          headline: 'See all your data in one place',
          label: 'ClarioInsight · Data & analytics',
          body: 'Turn governed data into decisions with unified sources, quality controls, dashboards and reports — from a single sovereign lakehouse.',
          cta: 'Explore ClarioInsight',
        },
      ],
    },
    why: {
      eyebrow: 'Why one platform',
      title: 'One platform beats a stack of point tools',
      lede: 'Buy capability once and let it compound. Everything shares the same login, audit trail and controls — so your teams move faster and your auditors see one clear picture.',
      cards: [
        {
          title: 'One login for everything',
          body: 'Your people sign in once and reach every suite they are entitled to — no separate tools, no separate passwords.',
        },
        {
          title: 'Compliance built in',
          body: 'NCA, SAMA, PDPL, ZATCA and ISO 27001 alignment ships with the platform and stays current — reassurance for your risk and audit teams.',
        },
        {
          title: 'Arabic-first, not translated',
          body: 'Every screen, document and report is built for Arabic and right-to-left from the start — with English alongside, not bolted on.',
        },
        {
          title: 'Deploy your way',
          body: 'Run it as sovereign SaaS, on your own premises, or fully air-gapped — your data stays in the Kingdom and under your control.',
        },
        {
          title: 'Start small, compound fast',
          body: 'Begin with one suite and add the rest when you are ready — capability carries over instead of starting from scratch each time.',
        },
        {
          title: 'One audit trail auditors trust',
          body: 'Every action across every suite lands in one immutable, exportable audit trail — a single clear record instead of a dozen disconnected logs.',
        },
      ],
    },
    trust: {
      label: 'Built for KSA compliance',
      najiz: 'Najiz',
      sovereign: 'Sovereign and Arabic-first — deploy as SaaS, on-premise, or fully air-gapped.',
    },
    mid: {
      title: 'See Clario360 on your own environment',
      sub: 'Book a working session and we will map the platform to your priorities, systems and compliance needs.',
      primary: 'Request a demo',
      secondary: 'Talk to sales',
    },
    evaluators: {
      eyebrow: 'For technical evaluators',
      title: 'How it works under the hood',
      lede: 'Everything above runs on shared platform services — built once and inherited by every application, so you never pay to build the same thing twice. Here is the depth for architects, security and procurement teams.',
    },
    finalCta: {
      title: 'One platform for your most critical operations',
      sub: 'Legal, security, disaster recovery and data — sovereign, Arabic-first, and ready to deploy your way. Let us map it to your environment.',
    },
  },
  ar: {
    hero: {
      eyebrow: 'منصة سيادية واحدة',
      title: 'منصة واحدة للشؤون القانونية والأمن والتعافي من الكوارث والبيانات.',
      lede: 'أدِر أهم عملياتك على منصة سيادية واحدة مبنية للمملكة. تعافَ من أي انقطاع في دقائق، واحكم كل عقد، وأوقف التهديدات قبل أن تنتشر، واجمع كل بياناتك في رؤية واحدة — بتسجيل دخول واحد وسجل تدقيق واحد وبالعربية أولاً منذ الأساس.',
      ctaDemo: 'اطلب عرضاً توضيحياً',
      ctaSales: 'تحدّث إلى المبيعات',
      trustLead: 'متوافقة مع',
    },
    outcomes: {
      eyebrow: 'ما الذي تحصل عليه',
      title: 'أربع حزم. منصة واحدة. كل عملية حرجة.',
      lede: 'ابدأ بالنتيجة التي تحتاجها أكثر وأضف الباقي عندما تكون جاهزاً — كل حزمة تعمل على النواة نفسها، فتتراكم القدرات بدلاً من أن تتشتت.',
      cards: [
        {
          headline: 'تعافَ في دقائق لا أيام',
          label: 'داتاستريم · التعافي من الكوارث وحركة البيانات',
          body: 'انهض من هجمات الفدية والانقطاعات وفقدان البيانات عبر تعافٍ سيادي مُختبَر وحركة بيانات سلسة بين بيئاتك.',
          cta: 'استكشف داتاستريم',
        },
        {
          headline: 'احكم كل عقد وقضية قانونية',
          label: 'بزنس+ · القانوني والعقود والحوكمة',
          body: 'أدِر دورة حياة العقود بالكامل والقضايا القانونية والحوكمة المؤسسية في مكان واحد — مع الموافقات والتدقيق والمستندات بالعربية أولاً التي يثق بها فريقك القانوني.',
          cta: 'استكشف بزنس+',
        },
        {
          headline: 'أوقف التهديدات قبل أن تنتشر',
          label: 'كلاريو سيك · الأمن السيبراني',
          body: 'اكتشف واستجب عبر منظومتك بالكامل مع كشف التهديدات ووضع أمن البيانات وتحليلات سلوك المستخدمين ومدير أمن معلومات افتراضي — من وحدة تحكم واحدة.',
          cta: 'استكشف كلاريو سيك',
        },
        {
          headline: 'شاهد كل بياناتك في مكان واحد',
          label: 'كلاريو إنسايت · البيانات والتحليلات',
          body: 'حوّل البيانات المحوكمة إلى قرارات عبر مصادر موحّدة وضوابط جودة ولوحات معلومات وتقارير — من بحيرة بيانات سيادية واحدة.',
          cta: 'استكشف كلاريو إنسايت',
        },
      ],
    },
    why: {
      eyebrow: 'لماذا منصة واحدة',
      title: 'منصة واحدة تتفوق على مجموعة من الأدوات المنفصلة',
      lede: 'اشترِ القدرة مرة واحدة ودعها تتراكم. كل شيء يشترك في تسجيل الدخول نفسه وسجل التدقيق والضوابط — لتتحرك فرقك بشكل أسرع ويرى مدققوك صورة واحدة واضحة.',
      cards: [
        {
          title: 'تسجيل دخول واحد لكل شيء',
          body: 'يسجّل موظفوك الدخول مرة واحدة ويصلون إلى كل حزمة لهم صلاحية بها — دون أدوات منفصلة أو كلمات مرور منفصلة.',
        },
        {
          title: 'الامتثال مدمج',
          body: 'توافق مع الهيئة الوطنية للأمن السيبراني والبنك المركزي ونظام حماية البيانات وهيئة الزكاة والأيزو 27001 يأتي مع المنصة ويبقى محدثاً — طمأنينة لفرق المخاطر والتدقيق لديك.',
        },
        {
          title: 'العربية أولاً، وليست مترجمة',
          body: 'كل شاشة ومستند وتقرير مبني للعربية ومن اليمين إلى اليسار منذ البداية — مع الإنجليزية جنباً إلى جنب، لا مضافة لاحقاً.',
        },
        {
          title: 'انشرها كما تريد',
          body: 'شغّلها كخدمة سحابية سيادية، أو في منشآتك، أو معزولة تماماً — تبقى بياناتك في المملكة وتحت سيطرتك.',
        },
        {
          title: 'ابدأ صغيراً، وتراكم بسرعة',
          body: 'ابدأ بحزمة واحدة وأضف الباقي عندما تكون جاهزاً — تنتقل القدرات معك بدلاً من البدء من الصفر في كل مرة.',
        },
        {
          title: 'سجل تدقيق واحد يثق به المدققون',
          body: 'كل إجراء عبر كل حزمة يُسجَّل في سجل تدقيق واحد غير قابل للتعديل وقابل للتصدير — سجل واحد واضح بدلاً من عشرات السجلات المنفصلة.',
        },
      ],
    },
    trust: {
      label: 'مبنية لامتثال المملكة',
      najiz: 'ناجز',
      sovereign: 'سيادية وبالعربية أولاً — انشرها كخدمة سحابية أو في منشآتك أو معزولة تماماً.',
    },
    mid: {
      title: 'شاهد كلاريو360 على بيئتك',
      sub: 'احجز جلسة عمل وسنقوم بمواءمة المنصة مع أولوياتك وأنظمتك ومتطلبات الامتثال لديك.',
      primary: 'اطلب عرضاً توضيحياً',
      secondary: 'تحدّث إلى المبيعات',
    },
    evaluators: {
      eyebrow: 'لفرق التقييم التقني',
      title: 'كيف تعمل المنصة من الداخل',
      lede: 'كل ما سبق يعمل على خدمات منصة مشتركة — مبنية مرة واحدة وترثها كل التطبيقات، فلا تدفع مقابل بناء الشيء نفسه مرتين. وهنا العمق لفرق العمارة والأمن والمشتريات.',
    },
    finalCta: {
      title: 'منصة واحدة لأهم عملياتك',
      sub: 'القانوني والأمن والتعافي من الكوارث والبيانات — سيادية وبالعربية أولاً وجاهزة للنشر كما تريد. دعنا نوائمها مع بيئتك.',
    },
  },
} as const;

function LayeredView({
  layers,
  rtlMono,
}: {
  layers: { name: string; detail: string }[];
  rtlMono?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxWidth: '880px',
        margin: '0 auto',
      }}
    >
      {layers.map((l, i) => {
        const c = LAYER_COLORS[i] ?? LAYER_COLORS[0];
        return (
          <div
            key={l.name}
            style={{
              background: c.bg,
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
              padding: '20px 26px',
              display: 'flex',
              alignItems: 'center',
              gap: '22px',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: '.7rem',
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: c.fg,
                minWidth: '120px',
                fontWeight: 600,
                ...rtlMono,
              }}
            >
              {l.name}
            </span>
            <span style={{ color: c.fg, fontSize: '.92rem', fontWeight: 500 }}>
              {l.detail}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PlatformSite() {
  const { locale, dir, messages: m } = useMarketingLocale();
  const p = m.platform;
  const c = COPY[locale];
  // Inline mono/tracked labels are styled by class or inline style, so the
  // stylesheet's [dir=rtl] resets can't reach them; force the Arabic face and
  // drop tracking/uppercase (which sever Arabic joining) for RTL.
  const rtlMono: CSSProperties | undefined =
    dir === 'rtl'
      ? { fontFamily: 'var(--arabic)', letterSpacing: 'normal', textTransform: 'none' }
      : undefined;

  const frameworks = [...FRAMEWORKS, c.trust.najiz];

  return (
    <>
      {/* ===== HERO — benefit-led, outcomes over architecture ===== */}
      <header className="page-hero">
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <Breadcrumb
            trail={[
              { label: m.chrome.breadcrumbHome, href: '/' },
              { label: p.breadcrumb },
            ]}
          />
          <div className="eyebrow">{c.hero.eyebrow}</div>
          <h1>{c.hero.title}</h1>
          <p className="lede">{c.hero.lede}</p>
          <div
            style={{
              marginTop: '30px',
              display: 'flex',
              gap: '14px',
              flexWrap: 'wrap',
            }}
          >
            <Link className="btn btn-gold" href="/contact">
              {c.hero.ctaDemo} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark" href="/contact">
              {c.hero.ctaSales}
            </Link>
          </div>
          <div
            style={{
              marginTop: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap',
              color: 'var(--text-inv-2)',
              fontSize: '.82rem',
            }}
          >
            <span style={{ ...rtlMono, opacity: 0.8 }}>{c.hero.trustLead}</span>
            <span style={{ fontWeight: 600, color: 'rgba(255,255,255,.72)' }}>
              {frameworks.join('  ·  ')}
            </span>
          </div>
        </div>
      </header>

      {/* ===== OUTCOMES — four suites framed as what you get ===== */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {c.outcomes.eyebrow}
            </div>
            <h2>{c.outcomes.title}</h2>
            <p className="lede">{c.outcomes.lede}</p>
          </div>
          <div className="apps-grid">
            {c.outcomes.cards.map((card, i) => {
              const meta = OUTCOME_META[i];
              return (
                <Link
                  className="app-card"
                  key={card.label}
                  href={getMarketingSuitePath(meta.suite)}
                  style={{ textDecoration: 'none', color: 'var(--text)' }}
                >
                  <div className="ac-h">
                    <div className="app-ico" style={{ background: meta.bg }}>
                      <MarketingIcon name={meta.icon} />
                    </div>
                    <div>
                      <h4>{card.headline}</h4>
                      <p className="role" style={rtlMono}>
                        {card.label}
                      </p>
                    </div>
                  </div>
                  <p>{card.body}</p>
                  <span className="more">
                    {card.cta} <MarketingIcon name="arrow" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== WHY ONE PLATFORM — value over feature list ===== */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.why.eyebrow}</div>
            <h2>{c.why.title}</h2>
            <p className="lede">{c.why.lede}</p>
          </div>
          <div className="principles">
            {c.why.cards.map((card, i) => (
              <div className="principle" key={card.title}>
                <div className="pic">
                  <MarketingIcon name={WHY_ICONS[i] ?? 'checkCircle'} />
                </div>
                <h4>{card.title}</h4>
                <p>{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== TRUST STRIP — compliance as reassurance ===== */}
      <section className="strip">
        <div className="wrap strip-inner">
          <span className="strip-label" style={rtlMono}>
            {c.trust.label}
          </span>
          <div className="strip-items">
            {frameworks.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </div>
      </section>
      <section className="section section-tight">
        <div className="wrap">
          <p
            className="center"
            style={{
              maxWidth: '720px',
              margin: '0 auto',
              color: 'var(--text-2)',
              fontSize: '1.02rem',
              fontWeight: 500,
            }}
          >
            {c.trust.sovereign}
          </p>
        </div>
      </section>

      {/* ===== MID CTA — repeat the ask ===== */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head center" style={{ marginBottom: '4px' }}>
            <h2>{c.mid.title}</h2>
            <p className="lede">{c.mid.sub}</p>
          </div>
          <div
            className="cta-actions"
            style={{ justifyContent: 'center', display: 'flex', gap: '14px', flexWrap: 'wrap' }}
          >
            <Link className="btn btn-primary btn-lg" href="/contact">
              {c.mid.primary} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ghost btn-lg" href="/contact">
              {c.mid.secondary}
            </Link>
          </div>
        </div>
      </section>

      {/* ========================================================
          FOR TECHNICAL EVALUATORS — architecture depth, demoted
          below the value story. Reuses the accurate m.platform.*
          technical copy.
          ======================================================== */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {c.evaluators.eyebrow}
            </div>
            <h2>{c.evaluators.title}</h2>
            <p className="lede">{c.evaluators.lede}</p>
          </div>
        </div>
      </section>

      {/* Shared engines — built once, consumed everywhere */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{p.engines.eyebrow}</div>
            <h2>{p.engines.title}</h2>
            <p className="lede">{p.engines.lede}</p>
          </div>
          <div className="engines">
            {PLATFORM_ENGINES.map((e) => (
              <Link
                key={e.id}
                className="engine"
                href={getPlatformEnginePath(e.id)}
                style={{ cursor: 'pointer', textDecoration: 'none' }}
              >
                <div className="ei" aria-hidden="true">
                  <MarketingIcon name={e.icon} />
                </div>
                <h5>
                  {e.name} <MarketingIcon name="arrow" className="eng-arrow" />
                </h5>
                <p>{localizeMarketingEngine(e, locale).description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Layered architecture */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {p.master.eyebrow}
            </div>
            <h2>{p.master.title}</h2>
          </div>
          <LayeredView layers={p.master.layers} rtlMono={rtlMono} />
        </div>
      </section>

      {/* System context — how Clario360 connects to what the Kingdom runs */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap split">
          <div>
            <div className="eyebrow">{p.context.eyebrow}</div>
            <h2>{p.context.title}</h2>
            <p className="lede" style={{ marginBottom: '22px' }}>
              {p.context.lede}
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              {p.context.rows.map((text, i) => (
                <div
                  key={text}
                  style={{
                    display: 'flex',
                    gap: '14px',
                    alignItems: 'flex-start',
                  }}
                >
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '11px',
                      background: 'var(--navy-50)',
                      display: 'grid',
                      placeItems: 'center',
                      color: 'var(--navy-600)',
                      flex: 'none',
                    }}
                  >
                    <MarketingIcon name={CONTEXT_ICONS[i] ?? 'shield'} />
                  </div>
                  <p
                    style={{
                      margin: 0,
                      paddingTop: '8px',
                      fontSize: '.95rem',
                    }}
                  >
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div
            className="arch-card"
            style={{
              background:
                'linear-gradient(160deg,var(--ink),var(--ink-soft))',
              borderColor: 'var(--ink-line)',
            }}
          >
            <div className="ac-top">
              <span style={rtlMono}>{p.context.cardTop}</span>
              <div className="ac-dots">
                <i style={{ background: 'var(--gold-400)' }} />
              </div>
            </div>
            <div
              style={{
                background: 'rgba(0,51,161,.18)',
                border: '1px solid rgba(79,123,240,.3)',
                borderRadius: '12px',
                padding: '14px',
                textAlign: 'center',
                marginBottom: '10px',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: '.7rem',
                  letterSpacing: '.14em',
                  color: 'var(--navy-300)',
                }}
              >
                API GATEWAY · GO
              </span>
            </div>
            <div className="ac-suites">
              {ARCH_SUITES.map((s) => (
                <div className={`ac-suite ${s.family}`} key={s.family}>
                  <h6>{s.name}</h6>
                  <div className="apps">
                    <em style={rtlMono}>
                      {locNum(s.apps, locale)} {p.context.appsWord}
                    </em>
                  </div>
                </div>
              ))}
            </div>
            <div className="ac-bus">
              <span className="pulse" />
              <span style={rtlMono}>{p.context.cardAi}</span>
            </div>
            <div
              style={{
                textAlign: 'center',
                marginTop: '10px',
                fontFamily: 'var(--mono)',
                fontSize: '.66rem',
                color: 'var(--text-inv-2)',
                ...rtlMono,
              }}
            >
              {p.context.cardFoundation}
            </div>
          </div>
        </div>
      </section>

      {/* The event bus is the boundary */}
      <BusDiagram />

      {/* Tenancy & isolation — your data stays yours */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap split">
          <div>
            <div className="eyebrow">{p.tenancy.eyebrow}</div>
            <h2>{p.tenancy.title}</h2>
            <p className="lede" style={{ marginBottom: '20px' }}>
              {p.tenancy.lede}
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              {p.tenancy.points.map((t) => (
                <div
                  key={t}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={{ color: 'var(--navy-600)', marginTop: '2px' }}>
                    <MarketingIcon name="checkCircle" />
                  </span>
                  <span style={{ fontSize: '.94rem' }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div
              className="specs"
              style={{ gridTemplateColumns: '1fr 1fr', marginTop: 0 }}
            >
              {p.tenancy.specs.map((s) => (
                <div className="spec" key={s.label}>
                  <b>{s.value}</b>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== CLOSING CTA — benefit-led override ===== */}
      <CtaBand title={c.finalCta.title} sub={c.finalCta.sub} />
    </>
  );
}
