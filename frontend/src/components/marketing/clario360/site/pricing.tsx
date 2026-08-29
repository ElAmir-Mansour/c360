'use client';

import Link from 'next/link';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';
import { Breadcrumb, CtaBand, SectionHead } from './shared';
import { FaqAccordion, SuiteConfigurator } from './widgets';

/* ============================================================
   PAGE: PRICING — reworked toward a marketing channel:
   benefit-led hero, a compliance/sovereignty trust strip, three
   value tiles ("why buyers choose Clario360"), the plan tiers,
   a repeated mid-page CTA, an interactive configurator and FAQ.
   Structural tier data + FAQ + configurator strings stay in
   `m.pricing`; NEW benefit/marketing copy lives in the inline
   bilingual COPY const below (EN/LTR + MSA Arabic/RTL).
   ============================================================ */

const TRIAL_SIGNUP_URL =
  '/register?suites=cyber,data,siem,datastream,acta,lex,visus&plan=trial';

/* Structural tier metadata — SAME ORDER as `m.pricing.tiers`
   (Starter · Growth · Enterprise · Custom). Only the route + the
   "featured" flag live here; every visible string is localised. */
const TIER_META: { href: string; featured: boolean }[] = [
  { href: TRIAL_SIGNUP_URL, featured: false },
  { href: '/contact', featured: false },
  { href: '/contact', featured: true },
  { href: '/contact', featured: false },
];

/* Regulator / assurance references shown as reassurance chips.
   Acronyms are standard proper nouns; kept in Latin in both
   locales as is customary on KSA bilingual sites. */
const TRUST_CHIPS = ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'] as const;

const COPY = {
  en: {
    heroEyebrow: 'Plans & pricing',
    heroTitle: 'Simple, predictable pricing — sovereign by default',
    heroLede:
      'Flat SAR pricing you can build a budget around. Start with a production-ready proof of concept, scale by the suites you actually need, and deploy the way your compliance requires — SaaS, on-premise or fully air-gapped. Every plan is Arabic-first and hosted in-Kingdom.',
    trustLabel: 'Built to satisfy the Kingdom’s regulators',
    deployLine:
      'Deploy SaaS · on-premise · air-gapped — your data stays in Saudi Arabia',
    valueEyebrow: 'Why teams choose Clario360',
    valueTitle: 'Pricing designed around your outcomes',
    values: [
      {
        icon: 'gauge',
        title: 'No per-seat surprises',
        body: 'Transparent, flat SAR pricing so finance can plan with confidence — adoption is never penalised as your teams grow.',
      },
      {
        icon: 'sparkle',
        title: 'Try the real product, free',
        body: 'Every Enterprise engagement starts with a white-glove, production-ready proof of concept — evaluate the actual platform before you commit.',
      },
      {
        icon: 'shield',
        title: 'Deploy on your terms',
        body: 'SaaS, on-premise or fully air-gapped, hosted in-Kingdom with BYOK — meet NCA, SAMA and PDPL requirements without compromise.',
      },
    ],
    tiersEyebrow: 'WatheeqTech · Legal suite',
    tiersTitle: 'Plans for legal teams of every size',
    tiersLede:
      'Every plan includes AI contract review, drafting and legal chat — from self-serve onboarding to sovereign, air-gapped deployment.',
    midCtaTitle: 'Not sure which plan fits?',
    midCtaBody:
      'Tell us about your team and how you deploy — we’ll map the right plan and pricing to your environment, and show you the platform live.',
    midCtaPrimary: 'Talk to sales',
    midCtaSecondary: 'Start a free trial',
    configLede:
      'Pick the suites you need and how you want to deploy — we’ll suggest the right plan and put pricing to your exact configuration.',
  },
  ar: {
    heroEyebrow: 'الباقات والأسعار',
    heroTitle: 'تسعير بسيط وقابل للتوقّع — سيادي افتراضياً',
    heroLede:
      'تسعير ثابت بالريال يمكنكم بناء ميزانيتكم عليه. ابدؤوا بإثبات مفهوم جاهز للإنتاج، وتوسّعوا بحسب المجموعات التي تحتاجونها فعلاً، وانشروا بالطريقة التي يتطلّبها امتثالكم — سحابياً أو داخل مقارّكم أو معزولاً بالكامل. وكل باقة بالعربية أولاً ومستضافة داخل المملكة.',
    trustLabel: 'مبنيّة لتلبية متطلّبات الجهات التنظيمية في المملكة',
    deployLine:
      'انشروا سحابياً · داخل المقارّ · معزولاً — تبقى بياناتكم داخل المملكة',
    valueEyebrow: 'لماذا تختار الفرق Clario360',
    valueTitle: 'تسعير مُصمَّم حول نتائجكم',
    values: [
      {
        icon: 'gauge',
        title: 'لا مفاجآت في تكلفة المقاعد',
        body: 'تسعير ثابت وشفّاف بالريال، لتخطّط الإدارة المالية بثقة — ولا يُعاقَب توسّع الاستخدام مع نموّ فرقكم.',
      },
      {
        icon: 'sparkle',
        title: 'جرّبوا المنتج الحقيقي مجاناً',
        body: 'يبدأ كل تعاقد مؤسسي بإثبات مفهوم متكامل وجاهز للإنتاج — قيّموا المنصّة الفعلية قبل أي التزام.',
      },
      {
        icon: 'shield',
        title: 'انشروا بشروطكم',
        body: 'سحابياً أو داخل مقارّكم أو معزولاً بالكامل، مستضافاً داخل المملكة مع مفاتيحكم الخاصة (BYOK) — لتلبية متطلّبات الهيئة الوطنية للأمن السيبراني ومؤسسة النقد ونظام حماية البيانات الشخصية دون تنازل.',
      },
    ],
    tiersEyebrow: 'وثيقتك · المجموعة القانونية',
    tiersTitle: 'باقات لفرق قانونية بكل الأحجام',
    tiersLede:
      'تشمل كل باقة مراجعة العقود والصياغة والمحادثة القانونية بالذكاء الاصطناعي — من الإعداد الذاتي إلى النشر السيادي المعزول.',
    midCtaTitle: 'غير متأكّدين من الباقة المناسبة؟',
    midCtaBody:
      'أخبرونا عن فريقكم وطريقة نشركم — وسنُطابق الباقة والتسعير المناسبين لبيئتكم، ونعرض لكم المنصّة مباشرةً.',
    midCtaPrimary: 'تحدّث إلى المبيعات',
    midCtaSecondary: 'ابدأ تجربة مجانية',
    configLede:
      'اختاروا المجموعات التي تحتاجونها وطريقة نشركم — وسنقترح الباقة المناسبة ونضع تسعيراً لتهيئتكم بالضبط.',
  },
} as const;

export function PricingSite() {
  const { locale, messages: m } = useMarketingLocale();
  const p = m.pricing;
  const c = COPY[locale];

  return (
    <>
      <header className="page-hero suite-bp">
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <Breadcrumb
            trail={[
              { label: m.chrome.breadcrumbHome, href: '/' },
              { label: p.breadcrumb },
            ]}
          />
          <div className="eyebrow">{c.heroEyebrow}</div>
          <h1>{c.heroTitle}</h1>
          <p className="lede">{c.heroLede}</p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              marginTop: '28px',
            }}
          >
            <Link className="btn btn-gold btn-lg" href="/contact">
              {c.midCtaPrimary} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark btn-lg" href={TRIAL_SIGNUP_URL}>
              {c.midCtaSecondary}
            </Link>
          </div>
        </div>
      </header>

      {/* Trust / sovereignty reassurance strip — compliance framed as
          confidence, not a spec list. */}
      <section className="section" style={{ paddingTop: '44px', paddingBottom: '44px' }}>
        <div className="wrap">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              textAlign: 'center',
            }}
          >
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {c.trustLabel}
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '10px',
              }}
            >
              {TRUST_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="chip"
                  style={{ fontSize: '.8125rem', padding: '6px 13px' }}
                >
                  {chip}
                </span>
              ))}
            </div>
            <p
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '9px',
                color: 'var(--text-2)',
                fontSize: '.95rem',
                fontWeight: 500,
                margin: 0,
              }}
            >
              <MarketingIcon name="lock" />
              <span>{c.deployLine}</span>
            </p>
          </div>
        </div>
      </section>

      {/* Value tiles — lead with outcomes before the price table. */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <SectionHead
            eyebrow={c.valueEyebrow}
            title={c.valueTitle}
            center
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '22px',
              marginTop: '8px',
            }}
          >
            {c.values.map((v) => (
              <div
                key={v.title}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-lg)',
                  padding: '28px',
                }}
              >
                <div
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '12px',
                    background: 'var(--navy-50)',
                    color: 'var(--navy-600)',
                    display: 'grid',
                    placeItems: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <MarketingIcon name={v.icon} />
                </div>
                <h3 style={{ marginBottom: '8px', fontSize: '1.15rem' }}>{v.title}</h3>
                <p style={{ color: 'var(--text-2)', fontSize: '.95rem', margin: 0 }}>
                  {v.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plan tiers — clearly scoped to the WatheeqTech legal suite. */}
      <section className="section">
        <div className="wrap">
          <SectionHead
            eyebrow={c.tiersEyebrow}
            title={c.tiersTitle}
            lede={c.tiersLede}
            center
          />
          <div className="tiers">
            {p.tiers.map((t, i) => {
              const meta = TIER_META[i] ?? { href: '/contact', featured: false };
              return (
                <div className={`tier ${meta.featured ? 'featured' : ''}`} key={t.name}>
                  {meta.featured ? <span className="ribbon">{p.ribbon}</span> : null}
                  <h3>{t.name}</h3>
                  {t.desc ? <p className="tdesc">{t.desc}</p> : null}
                  <div className="price">{t.price}</div>
                  <div className="pnote">{t.note}</div>
                  {t.sub ? <div className="pmeta">{t.sub}</div> : null}
                  <ul>
                    {t.feats.map((f) => {
                      // A leading ★ marks a highlighted callout (e.g. the free PoC)
                      // — rendered gold/bold with no check bullet.
                      const highlight = f.trimStart().startsWith('★');
                      return (
                        <li key={f} className={highlight ? 'poc-highlight' : undefined}>
                          {highlight ? null : <MarketingIcon name="check" />}
                          <span>{f}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <Link
                    className={`btn ${meta.featured ? 'btn-primary' : 'btn-ghost'}`}
                    href={meta.href}
                  >
                    {t.cta}
                  </Link>
                </div>
              );
            })}
          </div>
          <p
            className="center"
            style={{ marginTop: '40px', color: 'var(--text-3)', fontSize: '.9rem' }}
          >
            {p.tiersNote}
          </p>
        </div>
      </section>

      {/* Repeated CTA — human help + a way to start now. */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div
            style={{
              background: 'var(--navy-50)',
              border: '1px solid var(--navy-200)',
              borderRadius: 'var(--r-lg)',
              padding: 'clamp(28px, 4vw, 44px)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '20px',
            }}
          >
            <div style={{ maxWidth: '560px' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '1.35rem' }}>{c.midCtaTitle}</h3>
              <p style={{ margin: 0, color: 'var(--text-2)', fontSize: '.98rem' }}>
                {c.midCtaBody}
              </p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              <Link className="btn btn-primary" href="/contact">
                {c.midCtaPrimary} <MarketingIcon name="arrow" />
              </Link>
              <Link className="btn btn-ghost" href={TRIAL_SIGNUP_URL}>
                {c.midCtaSecondary}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive configurator — de-jargoned lede; the tool itself
          handles multi-suite / deployment pricing. */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <SectionHead
            eyebrow={p.configuratorHead.eyebrow}
            title={p.configuratorHead.title}
            lede={c.configLede}
          />
          <SuiteConfigurator />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow={p.faqHead.eyebrow} title={p.faqHead.title} center />
          <FaqAccordion items={p.faq} />
        </div>
      </section>

      <CtaBand title={p.cta.title} sub={p.cta.sub} />
    </>
  );
}
