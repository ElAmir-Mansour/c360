'use client';

/**
 * FeatureTours — "See the platform" section for the marketing homepage.
 *
 * Four alternating .tour rows (2nd and 4th mirrored via `tour flip`), each
 * pairing benefit-led copy with a real product screenshot inside a
 * BrowserFrame, plus one floating .tour-chip stat. Rows reveal on scroll via
 * the shared Reveal primitive (reduced-motion safe).
 *
 * All routes come from the typed helpers in @/lib/marketing/routes so links
 * can never drift from the app router. Every user-visible string is inline
 * bilingual (en/ar) selected by useMarketingLocale(); presentation classes
 * (.tour, .tour-media, .tour-copy, .tour-chip, .tour-bullets, .linkarrow)
 * resolve inside .clario-site via clario-site.css, including RTL mirrors.
 *
 * NOTE: the WatheeqTech screenshot is the product's native Arabic UI — shown to
 * BOTH locales deliberately; the Arabic interface is the proof point.
 */

import Link from 'next/link';
import {
  getMarketingAppPath,
  getMarketingSuitePath,
  getPlatformEnginePath,
} from '@/lib/marketing';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { SectionHead } from './shared';
import { BrowserFrame, Reveal, Shot } from './visual-primitives';

/* ---------- localized-string helpers ---------- */

type L = { readonly en: string; readonly ar: string };

interface TourDef {
  readonly key: string;
  readonly href: string;
  /** Decorative browser-bar URL — a neutral string, never a real deployment. */
  readonly url: string;
  readonly img: { readonly src: string; readonly width: number; readonly height: number };
  readonly eyebrow: L;
  readonly title: L;
  readonly lede: L;
  readonly alt: L;
  readonly bullets: readonly [L, L, L];
  readonly linkLabel: L;
  readonly chipValue: L;
  readonly chipSub: L;
}

/* ---------- section head ---------- */

const HEAD = {
  eyebrow: { en: 'Product tour', ar: 'جولة في المنتج' },
  title: { en: 'See the platform', ar: 'شاهدوا المنصّة بأنفسكم' },
  lede: {
    en: 'Real screens from the running product — the same consoles your teams operate from day one.',
    ar: 'شاشات حقيقية من المنتج أثناء تشغيله — اللوحات نفسها التي ستعمل عليها فرقكم من اليوم الأول.',
  },
} as const;

/* ---------- the four tours ---------- */

const TOURS: readonly TourDef[] = [
  {
    key: 'clariodr',
    href: getMarketingAppPath('datastream', 'clariodr'),
    url: 'app.clario360.sa/dr/readiness',
    img: { src: '/marketing/shots/tour-dr.webp', width: 1600, height: 900 },
    eyebrow: {
      en: 'ClarioDR · Disaster recovery',
      ar: 'ClarioDR · التعافي من الكوارث',
    },
    title: {
      en: 'Recover in minutes — and prove it to your regulator',
      ar: 'تعافَوا في دقائق — وأثبتوا ذلك للجهات التنظيمية',
    },
    lede: {
      en: 'A recovery console that turns failover into a governed, evidence-producing operation instead of a leap of faith.',
      ar: 'وحدة تحكّم للتعافي تحوّل التحويل الاحتياطي إلى عملية محوكمة تُنتج أدلّتها بنفسها، بدلًا من قفزة في المجهول.',
    },
    alt: {
      en: 'ClarioDR operations console showing a recovery-readiness score, gated failover actions and the recovery lifecycle',
      ar: 'وحدة تحكّم ClarioDR تعرض مؤشر جاهزية التعافي وإجراءات التحويل الاحتياطي المضبوطة ودورة حياة الاستعادة',
    },
    bullets: [
      {
        en: 'Gated failover with sealed, tamper-evident recovery points',
        ar: 'تحويل احتياطي مضبوط بالموافقات، مع نقاط استعادة مختومة يظهر أيّ عبث بها فورًا',
      },
      {
        en: 'Drills and game-days that generate regulator-ready evidence automatically',
        ar: 'تمارين وتجارب طوارئ دورية تولّد تلقائيًا أدلةً جاهزة للعرض على الجهات التنظيمية',
      },
      {
        en: 'Sovereign replication that keeps every copy inside the Kingdom',
        ar: 'نسخ متماثل سيادي يُبقي كل نسخة من بياناتكم داخل المملكة',
      },
    ],
    linkLabel: { en: 'Explore ClarioDR', ar: 'استكشفوا ClarioDR' },
    chipValue: { en: 'RTO-proof', ar: 'جاهزية RTO موثّقة' },
    chipSub: { en: 'evidence-first recovery', ar: 'تعافٍ قائم على الأدلة' },
  },
  {
    key: 'watheeq',
    href: getMarketingAppPath('business-plus', 'watheeq'),
    url: 'app.clario360.sa/legal/calendar',
    img: { src: '/marketing/shots/tour-legal-calendar.webp', width: 1600, height: 900 },
    eyebrow: {
      en: 'WatheeqTech · Legal operations',
      ar: 'وثيقتك · العمليات القانونية',
    },
    title: {
      en: 'Legal operations that speak Arabic first',
      ar: 'عمليات قانونية تتحدث العربية أولًا',
    },
    lede: {
      en: 'A legal command center built for departments in the Kingdom — not a translation bolted onto someone else’s tool.',
      ar: 'مركز قيادة قانوني صُمّم لإدارات الشؤون القانونية في المملكة — لا ترجمة أُلصقت على أداة صُنعت لغيرها.',
    },
    alt: {
      en: 'WatheeqTech legal calendar in its native Arabic interface, with Hijri-aware hearing dates and legal deadlines',
      ar: 'تقويم وثيقتك القانوني بواجهته العربية الأصلية، مع مواعيد جلسات ومُهَل قانونية تراعي التقويم الهجري',
    },
    bullets: [
      {
        en: 'One legal service desk covering eight legal services end to end',
        ar: 'مكتب خدمات قانونية واحد يغطي ثماني خدمات قانونية من البداية إلى النهاية',
      },
      {
        en: 'Hijri-aware deadlines and a court calendar that never misses a hearing',
        ar: 'مُهَل تراعي التقويم الهجري وتقويم جلسات لا تفوته جلسة',
      },
      {
        en: 'Najiz-, Nafath- and e-signature-ready integrations — sandbox-verified today',
        ar: 'تكاملات جاهزة مع ناجز ونفاذ والتوقيع الإلكتروني — مُختبرة اليوم في بيئة تجريبية',
      },
    ],
    linkLabel: { en: 'Explore WatheeqTech', ar: 'استكشفوا وثيقتك' },
    chipValue: { en: 'Arabic-native', ar: 'عربي المنشأ' },
    chipSub: { en: 'Hijri-aware calendaring', ar: 'تقويم يراعي التاريخ الهجري' },
  },
  {
    key: 'workflow',
    href: getPlatformEnginePath('workflow'),
    url: 'app.clario360.sa/workflows/designer',
    img: { src: '/marketing/shots/tour-workflow-designer.webp', width: 1600, height: 930 },
    eyebrow: {
      en: 'Platform · Workflow engine',
      ar: 'المنصّة · محرّك سير العمل',
    },
    title: {
      en: 'Design a process once, run it everywhere',
      ar: 'صمّموا الإجراء مرة واحدة، وشغّلوه في كل مكان',
    },
    lede: {
      en: 'One visual designer and one shared engine power every approval in every suite — no per-app workflow silos.',
      ar: 'مصمّم مرئي واحد ومحرّك مشترك واحد يشغّلان كل اعتماد في كل مجموعة — بلا جزر سير عمل منفصلة لكل تطبيق.',
    },
    alt: {
      en: 'Visual workflow designer canvas showing a commercial-registration renewal flow with approval-chain nodes',
      ar: 'لوحة مصمّم سير العمل المرئي تعرض إجراء تجديد سجل تجاري بعُقَد سلسلة اعتماد',
    },
    bullets: [
      {
        en: 'Visual designer with approval chains and four-eyes controls',
        ar: 'مصمّم مرئي بسلاسل اعتماد وضوابط الرقابة المزدوجة',
      },
      {
        en: '75+ prebuilt templates for the processes enterprises actually run',
        ar: 'أكثر من ٧٥ قالبًا جاهزًا للإجراءات التي تديرها المؤسسات فعلًا',
      },
      {
        en: 'One engine shared by every suite — model once, reuse everywhere',
        ar: 'محرّك واحد تتشاركه كل المجموعات — نمذجة واحدة وإعادة استخدام في كل مكان',
      },
    ],
    linkLabel: { en: 'Explore the workflow engine', ar: 'استكشفوا محرّك سير العمل' },
    chipValue: { en: '81 templates', ar: '٨١ قالبًا' },
    chipSub: { en: 'prebuilt, ready to run', ar: 'جاهزة للتشغيل فورًا' },
  },
  {
    key: 'sec-insight',
    href: getMarketingSuitePath('clariosec'),
    url: 'app.clario360.sa/soc/overview',
    img: { src: '/marketing/shots/tour-soc.webp', width: 1600, height: 900 },
    eyebrow: {
      en: 'ClarioSec + ClarioInsight · Security & intelligence',
      ar: 'ClarioSec + ClarioInsight · الأمن والرؤى',
    },
    title: {
      en: 'See everything — without your data leaving the Kingdom',
      ar: 'شاهدوا كل شيء — دون أن تغادر بياناتكم المملكة',
    },
    lede: {
      en: 'Security operations and executive intelligence, running on the same sovereign data plane.',
      ar: 'عمليات أمنية ورؤى تنفيذية تعمل على منظومة البيانات السيادية نفسها.',
    },
    alt: {
      en: 'Security Operations Center console with a live alert queue, severity breakdown and MITRE ATT&CK technique heatmap',
      ar: 'وحدة تحكّم مركز العمليات الأمنية بقائمة تنبيهات مباشرة وتوزيع لدرجات الخطورة وخريطة حرارية لتقنيات MITRE ATT&CK',
    },
    bullets: [
      {
        en: 'A SOC with detections mapped to MITRE ATT&CK out of the box',
        ar: 'مركز عمليات أمنية باكتشافات مُواءَمة مع إطار MITRE ATT&CK منذ اللحظة الأولى',
      },
      {
        en: 'Risk heatmaps and exposure scoring across your whole estate',
        ar: 'خرائط حرارية للمخاطر وتقييم للتعرّض عبر كامل بيئتكم',
      },
      {
        en: 'Executive dashboards on the same data — no exports, no copies',
        ar: 'لوحات معلومات تنفيذية على البيانات نفسها — بلا تصدير وبلا نسخ',
      },
    ],
    linkLabel: { en: 'Explore the security suite', ar: 'استكشفوا مجموعة الأمن' },
    chipValue: { en: 'MITRE-mapped', ar: 'مواءمة مع MITRE' },
    chipSub: { en: 'detections & heatmaps', ar: 'اكتشافات وخرائط حرارية' },
  },
] as const;

/* ---------- section ---------- */

export function FeatureTours() {
  const { locale } = useMarketingLocale();

  return (
    <section className="section" id="product-tour">
      <div className="wrap">
        <SectionHead
          center
          eyebrow={HEAD.eyebrow[locale]}
          title={HEAD.title[locale]}
          lede={HEAD.lede[locale]}
        />

        {TOURS.map((tour, i) => (
          <Reveal
            key={tour.key}
            className={i % 2 === 1 ? 'tour flip' : 'tour'}
          >
            <div className="tour-copy">
              <div className="eyebrow">{tour.eyebrow[locale]}</div>
              <h3>{tour.title[locale]}</h3>
              <p className="lede">{tour.lede[locale]}</p>
              <ul className="tour-bullets">
                {tour.bullets.map((b) => (
                  <li key={b.en}>
                    <MarketingIcon name="check" />
                    <span>{b[locale]}</span>
                  </li>
                ))}
              </ul>
              <p style={{ marginTop: 18 }}>
                <Link className="linkarrow" href={tour.href}>
                  {tour.linkLabel[locale]} <MarketingIcon name="arrow" />
                </Link>
              </p>
            </div>

            <div className="tour-media">
              <BrowserFrame url={tour.url}>
                <Shot
                  src={tour.img.src}
                  alt={tour.alt[locale]}
                  width={tour.img.width}
                  height={tour.img.height}
                />
              </BrowserFrame>
              <div className="tour-chip">
                {tour.chipValue[locale]}
                <small>{tour.chipSub[locale]}</small>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
