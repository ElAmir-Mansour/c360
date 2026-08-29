'use client';

import Link from 'next/link';
import { Hero, CtaBand } from './shared';
import { RoiCalculator } from './widgets';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';

/* ============================================================
   PAGE: COMPARE — reworked as a MARKETING channel.

   Direction: lead with buyer OUTCOMES up top (fewer vendors,
   faster recovery, provable compliance, one control plane),
   surface trust/compliance early, and repeat clear CTAs. The
   category-level comparison table + structural "reasons" stay
   LOWER as evaluator depth. Existing good prose is reused from
   `m.compare.*`; all NEW marketing copy is inline + bilingual
   via the COPY const below (never touches messages.ts).
   ============================================================ */

/* Positional icon list for the three supporting reasons (lower section). */
const REASON_ICONS = ['trend', 'checkCircle', 'globe'];

/* Bilingual inline copy for the net-new marketing surfaces. */
const COPY = {
  en: {
    hero: {
      lede: 'Stop paying for the same login, workflow and audit trail inside every tool you buy. Clario360 brings resilience, legal, security and analytics onto one sovereign platform — so capability compounds, costs stay predictable, and there is a single answer to who did what.',
      ctaPrimary: 'Request a demo',
      ctaSecondary: 'See the comparison',
      trust: [
        { value: '1', label: 'platform instead of a stack of vendors' },
        { value: '4', label: 'suites share one login, workflow & audit' },
        { value: '3', label: 'ways to deploy — SaaS · on-prem · air-gapped' },
      ],
    },
    trustStrip: {
      label: 'Built to satisfy the Kingdom’s regulators',
      marks: ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'],
    },
    wins: {
      eyebrow: 'What you actually get',
      title: 'Buy a platform, get outcomes — not a bigger stack to integrate',
      lede: 'The reason to consolidate isn’t a neat diagram — it’s what lands on your desk: lower cost, faster recovery, and audits you can prove.',
      items: [
        {
          icon: 'license',
          title: 'Fewer vendors, one predictable bill',
          body: 'Replace a shelf of single-purpose tools — each with its own login, contract and renewal — with one platform, licensed by suite. No consumption surprises to reconcile.',
        },
        {
          icon: 'recover',
          title: 'Recover in minutes, not days',
          body: 'DataStream keeps your critical systems recoverable and your data mobile, so an outage is measured in minutes — not the days it takes to rebuild across disconnected tools.',
        },
        {
          icon: 'shield',
          title: 'Prove compliance once',
          body: 'Evidence gathered once maps across NCA, SAMA, PDPL and ISO 27001 at the same time — so an audit becomes a report you export, not a project you re-staff every quarter.',
        },
      ],
    },
    midCta: {
      lead: 'Evaluating specific tools right now? Send us the shortlist and we’ll build the side-by-side against your requirements.',
      primary: 'Talk to sales',
      secondary: 'See it live',
    },
  },
  ar: {
    hero: {
      lede: 'توقّفوا عن دفع ثمن تسجيل الدخول ومسار العمل والتدقيق نفسها في كل أداة تشترونها. تجمع Clario360 المرونة والشؤون القانونية والأمن والتحليلات في منصّة سيادية واحدة — فتتراكم القدرات، وتبقى التكلفة قابلة للتوقّع، وتصبح هناك إجابة واحدة عن مَن فعل ماذا.',
      ctaPrimary: 'اطلب عرضاً توضيحياً',
      ctaSecondary: 'شاهد المقارنة',
      trust: [
        { value: '١', label: 'منصّة واحدة بدل كومة من الموردين' },
        { value: '٤', label: 'مجموعات تتشارك تسجيل دخول ومسار عمل وتدقيقاً واحداً' },
        { value: '٣', label: 'طرق للنشر: سحابي · داخل المقرّ · معزول تماماً' },
      ],
    },
    trustStrip: {
      label: 'مبنيّة لتلبية متطلبات الجهات التنظيمية في المملكة',
      marks: ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'],
    },
    wins: {
      eyebrow: 'ما الذي تحصلون عليه فعلاً',
      title: 'اشترِ منصّة واحصل على نتائج — لا كومة أكبر تحتاج إلى تكامل',
      lede: 'سبب التوحيد ليس رسماً معمارياً أنيقاً، بل ما يصل إلى مكتبك: تكلفة أقل، واستعادة أسرع، وتدقيق تستطيع إثباته.',
      items: [
        {
          icon: 'license',
          title: 'موردون أقل، وفاتورة واحدة يمكن توقّعها',
          body: 'استبدلوا رفّاً من الأدوات أحاديّة الغرض — لكلٍّ تسجيل دخولها وعقدها وتجديدها — بمنصّة واحدة مرخّصة بالمجموعة. دون مفاجآت استهلاك تُسوّونها لاحقاً.',
        },
        {
          icon: 'recover',
          title: 'استعادة خلال دقائق لا أيام',
          body: 'يُبقي DataStream أنظمتكم الحرجة قابلة للاستعادة وبياناتكم قابلة للنقل، فيُقاس التعطّل بالدقائق — لا بالأيام التي يستغرقها إعادة البناء عبر أدوات متفرّقة.',
        },
        {
          icon: 'shield',
          title: 'أثبِت الامتثال مرة واحدة',
          body: 'الأدلّة التي تُجمَع مرة واحدة تُطابَق في آنٍ واحد عبر NCA وSAMA وPDPL وISO 27001 — فيغدو التدقيق تقريراً تُصدِّرونه، لا مشروعاً تُوظّفون له كل ربع سنة.',
        },
      ],
    },
    midCta: {
      lead: 'تُقيّمون أدواتٍ بعينها الآن؟ أرسلوا إلينا القائمة المختصرة وسنُعدّ المقارنة المباشرة وفق متطلباتكم.',
      primary: 'تحدّث إلى المبيعات',
      secondary: 'شاهدها مباشرة',
    },
  },
} as const;

export function CompareSite() {
  const { locale, messages: m } = useMarketingLocale();
  const c = m.compare;
  const t = COPY[locale];

  return (
    <>
      <Hero
        breadcrumb={[
          { label: m.chrome.breadcrumbHome, href: '/' },
          { label: c.hero.breadcrumb },
        ]}
        eyebrow={c.hero.eyebrow}
        title={c.hero.title}
        lede={t.hero.lede}
        actions={
          <>
            <Link className="btn btn-gold btn-lg" href="/contact">
              {t.hero.ctaPrimary} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark btn-lg" href="#comparison">
              {t.hero.ctaSecondary}
            </Link>
          </>
        }
        trust={t.hero.trust.map((x) => ({ value: x.value, label: x.label }))}
      />

      {/* Trust strip — compliance framed as reassurance, surfaced early. */}
      <section className="section-tight">
        <div className="wrap">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--text-3)',
                fontSize: '.8125rem',
                letterSpacing: '.02em',
              }}
            >
              <MarketingIcon name="shield" />
              {t.trustStrip.label}
            </span>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '10px',
              }}
            >
              {t.trustStrip.marks.map((mark) => (
                <span
                  key={mark}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '999px',
                    border: '1px solid var(--line)',
                    background: 'var(--card)',
                    color: 'var(--text-2)',
                    fontSize: '.8125rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mark}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Buyer wins — the benefits, up top and in plain buyer terms. */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {t.wins.eyebrow}
            </div>
            <h2>{t.wins.title}</h2>
            <p className="lede">{t.wins.lede}</p>
          </div>
          <div className="principles">
            {t.wins.items.map((it) => (
              <div className="principle" key={it.title}>
                <div className="pic" aria-hidden="true">
                  <MarketingIcon name={it.icon} />
                </div>
                <h4>{it.title}</h4>
                <p>{it.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Detailed, category-level comparison — evaluator depth, lower down. */}
      <section className="section" id="comparison">
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {c.comparison.eyebrow}
            </div>
            <h2>{c.comparison.title}</h2>
            <p className="lede">{c.comparison.lede}</p>
          </div>
          <div className="cmp">
            <div className="cmp-row head">
              <div>{c.comparison.headDimension}</div>
              <div className="c-clario">{c.comparison.headClario}</div>
              <div className="c-other">{c.comparison.headOther}</div>
            </div>
            {c.comparison.rows.map((r) => (
              <div className="cmp-row" key={r.label}>
                <div className="c-label">{r.label}</div>
                <div className="c-clario">
                  <MarketingIcon name="check" className="yes" />
                  <span>{r.clario}</span>
                </div>
                <div className="c-other">
                  <MarketingIcon name="x" className="no" />
                  <span>{r.other}</span>
                </div>
              </div>
            ))}
          </div>
          <p
            className="center"
            style={{
              marginTop: '24px',
              color: 'var(--text-3)',
              fontSize: '.85rem',
              maxWidth: '680px',
              marginInline: 'auto',
            }}
          >
            {c.comparison.footnote}
          </p>
        </div>
      </section>

      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.economics.eyebrow}</div>
            <h2>{c.economics.title}</h2>
            <p className="lede">{c.economics.lede}</p>
          </div>
          <RoiCalculator />
        </div>
      </section>

      {/* Repeated CTA — mid-page, at peak buyer intent. */}
      <section className="section">
        <div className="wrap">
          <div
            style={{
              maxWidth: '640px',
              marginInline: 'auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '20px',
              textAlign: 'center',
            }}
          >
            <p className="lede" style={{ margin: 0 }}>
              {t.midCta.lead}
            </p>
            <div
              style={{
                display: 'flex',
                gap: '14px',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              <Link className="btn btn-primary btn-lg" href="/contact">
                {t.midCta.primary} <MarketingIcon name="arrow" />
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/contact">
                {t.midCta.secondary}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Why the platform position holds — structural, for evaluators. */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.reasons.eyebrow}</div>
            <h2>{c.reasons.title}</h2>
          </div>
          <div className="principles">
            {c.reasons.items.map((p, i) => (
              <div className="principle" key={p.title}>
                <div className="pic" aria-hidden="true">
                  <MarketingIcon name={REASON_ICONS[i]} />
                </div>
                <h4>{p.title}</h4>
                <p>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand title={c.cta.title} sub={c.cta.sub} />
    </>
  );
}
