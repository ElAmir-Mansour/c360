'use client';

/**
 * Home showcase sections — integration wall + final CTA collage.
 *
 * IntegrationWall  — "fits your stack" grid of ~18 connector tiles. Each tile
 *                    is a generic drawn glyph (MarketingIcon) + name text —
 *                    third-party logos are deliberately NOT reproduced.
 *                    Government-gated connectors (Nafath / Najiz / emdha) are
 *                    honestly tagged as sandbox; ZATCA is tagged gov.
 * FinalCtaCollage  — conversion close: a .cta-band.cta-collage with three
 *                    real product screenshots fanned behind the headline
 *                    (decorative: alt="" + aria-hidden container) and the
 *                    established gold/ghost CTA pair.
 *
 * Presentation classes (.int-wall, .int-tile, .cta-collage, …) resolve inside
 * the .clario-site wrapper styled by clario-site.css. All copy is inline
 * bilingual, selected via useMarketingLocale(); RTL mirroring is handled by
 * the [dir="rtl"] rules in clario-site.css.
 */

import Link from 'next/link';
import { MarketingIcon, type MarketingIconName } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { Reveal, Shot } from './visual-primitives';

/* ============================================================
   INTEGRATION WALL
   ============================================================ */

type IntTileTag = 'sandbox' | 'gov';

interface IntTileDef {
  icon: MarketingIconName;
  en: string;
  ar: string;
  tag?: IntTileTag;
}

/* Generic glyphs only — each system is represented by an in-house icon plus
   its name in text. Najiz / Nafath / emdha are gov-gated sandbox connectors
   and are tagged as such (honesty rule); ZATCA is a government interface. */
const INT_TILES: IntTileDef[] = [
  { icon: 'key', en: 'SAML SSO', ar: 'الدخول الموحّد SAML' },
  { icon: 'users', en: 'SCIM Provisioning', ar: 'إدارة الهويات SCIM' },
  { icon: 'finger', en: 'Nafath', ar: 'نفاذ', tag: 'sandbox' },
  { icon: 'gavel', en: 'Najiz', ar: 'ناجز', tag: 'sandbox' },
  { icon: 'pen', en: 'emdha e-sign', ar: 'التوقيع الرقمي إمضاء', tag: 'sandbox' },
  { icon: 'clipboard', en: 'ZATCA', ar: 'الفوترة الإلكترونية ZATCA', tag: 'gov' },
  { icon: 'mail', en: 'SMTP Email', ar: 'البريد SMTP' },
  { icon: 'phone', en: 'SMS Gateway', ar: 'بوابة الرسائل النصية' },
  { icon: 'archive', en: 'E-Archive (WORM)', ar: 'الأرشفة الإلكترونية (WORM)' },
  { icon: 'boxes', en: 'S3-compatible Storage', ar: 'تخزين متوافق مع S3' },
  { icon: 'database', en: 'PostgreSQL', ar: 'PostgreSQL' },
  { icon: 'server', en: 'Oracle', ar: 'Oracle' },
  { icon: 'layers', en: 'SQL Server', ar: 'SQL Server' },
  { icon: 'sync', en: 'Kafka / CDC', ar: 'Kafka / CDC' },
  { icon: 'radar', en: 'Syslog / CEF', ar: 'Syslog / CEF' },
  { icon: 'zap', en: 'Webhooks', ar: 'Webhooks' },
  { icon: 'plug', en: 'Open REST API', ar: 'واجهة REST مفتوحة' },
  { icon: 'trend', en: 'Power BI-ready export', ar: 'تصدير جاهز لـ Power BI' },
];

const INT_T = {
  en: {
    eyebrow: 'Integrations',
    title: 'Fits the stack you already run',
    lede:
      'Identity, government services, data stores, and event streams connect over open, documented interfaces — no rip-and-replace, no proprietary lock-in.',
    note:
      'Government-gated connectors (Nafath, Najiz, emdha) ship sandbox-first and are enabled per tenant once official credentials are issued.',
    tags: { sandbox: 'sandbox', gov: 'gov' } as Record<IntTileTag, string>,
  },
  ar: {
    eyebrow: 'التكاملات',
    title: 'تتكامل مع منظومتك القائمة كما هي',
    lede:
      'الهوية والخدمات الحكومية وقواعد البيانات وتدفقات الأحداث تتصل عبر واجهات مفتوحة وموثّقة — دون استبدال أنظمتك ودون احتكار تقني.',
    note:
      'الموصّلات الحكومية (نفاذ، ناجز، إمضاء) تُطرح أولاً في بيئة تجريبية وتُفعَّل لكل منشأة بعد إصدار الاعتمادات الرسمية.',
    tags: { sandbox: 'تجريبي', gov: 'حكومي' } as Record<IntTileTag, string>,
  },
} as const;

export function IntegrationWall() {
  const { locale } = useMarketingLocale();
  const t = INT_T[locale];

  return (
    <section className="section">
      <div className="wrap">
        <Reveal>
          <div className="sec-head">
            <div className="eyebrow">{t.eyebrow}</div>
            <h2>{t.title}</h2>
            <p className="lede">{t.lede}</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div className="int-wall">
            {INT_TILES.map((tile) => (
              <div className="int-tile" key={tile.en}>
                <span className="int-tile-icon" aria-hidden="true">
                  <MarketingIcon name={tile.icon} />
                </span>
                <span>{locale === 'ar' ? tile.ar : tile.en}</span>
                {tile.tag ? (
                  <span className="int-tag">{t.tags[tile.tag]}</span>
                ) : null}
              </div>
            ))}
          </div>
          <p
            style={{
              margin: '16px 0 0',
              fontSize: '.8125rem',
              color: 'var(--text-3)',
              maxWidth: '640px',
            }}
          >
            {t.note}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
   FINAL CTA COLLAGE — the conversion close. Extends the
   established .cta-band (see MidCtaBand in home-sections.tsx)
   with a fanned, decorative screenshot collage behind the copy.
   ============================================================ */

const CTA_T = {
  en: {
    title: 'One sovereign platform. Every critical operation.',
    sub: 'See resilience, legal, security, and insight working together — a guided demo on your scenarios, in English or Arabic.',
    demo: 'Request a demo',
    explore: 'Explore the platform',
  },
  ar: {
    title: 'منصة سيادية واحدة لكل عملياتك الحرجة.',
    sub: 'شاهد الاستمرارية والشؤون القانونية والأمن والتحليلات تعمل معاً — عرض موجّه على سيناريوهاتكم بالعربية أو الإنجليزية.',
    demo: 'اطلب عرضاً توضيحياً',
    explore: 'استكشف المنصة',
  },
} as const;

/* Real product screenshots (fictional demo data), purely decorative here:
   alt="" plus an aria-hidden container keeps them out of the a11y tree. */
const CTA_SHOTS = [
  { src: '/marketing/shots/collage-dashboard.webp', width: 1200, height: 496 },
  { src: '/marketing/shots/collage-alerts.webp', width: 1200, height: 661 },
  { src: '/marketing/shots/collage-gauge.webp', width: 900, height: 513 },
] as const;

export function FinalCtaCollage() {
  const { locale } = useMarketingLocale();
  const t = CTA_T[locale];

  return (
    <section className="section">
      <div className="wrap">
        <Reveal>
          <div className="cta-band cta-collage">
            <div className="cta-collage-bg" aria-hidden="true">
              {CTA_SHOTS.map((shot) => (
                <Shot
                  key={shot.src}
                  className="cta-collage-img"
                  src={shot.src}
                  alt=""
                  width={shot.width}
                  height={shot.height}
                />
              ))}
            </div>
            <h2>{t.title}</h2>
            <p>{t.sub}</p>
            <div className="cta-actions">
              <Link className="btn btn-gold btn-lg" href="/contact">
                {t.demo} <MarketingIcon name="arrow" />
              </Link>
              <Link className="btn btn-ondark btn-lg" href="/platform">
                {t.explore}
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
