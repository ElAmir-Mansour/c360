'use client';

import Link from 'next/link';
import {
  MARKETING_BRAND_TOKENS,
  getMarketingAppPath,
  localizeMarketingApp,
  localizeMarketingSuite,
  type MarketingSuiteRecord,
  type MarketingApp,
} from '@/lib/marketing';
import type { MarketingLocale } from '@/lib/marketing/messages';

import { CtaBand } from './shared';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';

type MarketingSuiteFamily = MarketingSuiteRecord['family'];

/* ============================================================
   PAGE: SUITE (/[suite])

   MARKETING REWIRE (2026-07): this page now leads with customer
   OUTCOMES and value — what the buyer GETS from the suite — with
   trust/proof (sovereignty + compliance) in the middle, and the
   genuine technical depth (shared core, cross-app connectivity)
   demoted into a clearly-lower "how it works" section for
   evaluators. Benefit copy up top, architecture down low.

   The suite/app BODY copy that is DATA (blurb, core, coreDesc,
   tagline, and each app's role/short/specs) still comes bilingual
   from the localizers in lib/marketing. All page-template CHROME —
   including the new outcome, trust and how-it-works prose — lives
   in the co-located, typed {en,ar} SUITE_COPY module below (the
   pattern INFRA uses for HOME_LINKS). The leading breadcrumb crumb
   and the request-demo verb reuse the shared chrome.
   ============================================================ */

interface CrossSuiteCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
}
interface OutcomeCopy {
  readonly title: string;
  readonly desc: string;
}
interface DeployOption {
  readonly name: string;
  readonly desc: string;
  readonly icon: string;
}
interface SuiteChromeCopy {
  readonly familyEyebrow: Record<MarketingSuiteFamily, string>;
  /** Outcome-led hero sub-headline (replaces the technical data blurb up top). */
  readonly heroLede: Record<MarketingSuiteFamily, string>;
  readonly trustMicro: string;
  readonly talkToSales: string;
  /* Outcomes ("what you get") */
  readonly outcomesEyebrow: string;
  readonly outcomesHeading: Record<MarketingSuiteFamily, string>;
  readonly outcomes: Record<MarketingSuiteFamily, readonly OutcomeCopy[]>;
  /* Apps ("as capabilities") */
  readonly appsEyebrow: string;
  /** Count word keyed by app count (1–5); the value fills {count}. */
  readonly countWords: Record<number, string>;
  /** Apps-section heading template — {count} is the localised count word. */
  readonly appsHeading: string;
  readonly appsLede: string;
  /** App-card "more" link template — {name} stays the Latin brand name. */
  readonly exploreApp: string;
  /* Trust / proof band */
  readonly trust: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly complianceLabel: string;
    readonly deployLabel: string;
    readonly deploy: readonly DeployOption[];
  };
  /* How it works (demoted technical section) */
  readonly howEyebrow: string;
  readonly seePlatformCore: string;
  readonly familyCoreHeading: Record<MarketingSuiteFamily, string>;
  readonly crossSuite: Record<MarketingSuiteFamily, CrossSuiteCopy>;
  /** Closing CTA title template — {name} stays the Latin brand name. */
  readonly ctaTitle: string;
}

/** Framework/regulator marks are language-neutral acronyms — shared across locales. */
const COMPLIANCE_MARKS = [
  'NCA',
  'SAMA',
  'PDPL',
  'ZATCA',
  'ISO 27001',
  'Najiz',
] as const;

const SUITE_COPY: Record<MarketingLocale, SuiteChromeCopy> = {
  en: {
    familyEyebrow: {
      ds: 'Data resilience & mobility',
      bp: 'Corporate operations',
      sec: 'Security & cyber programs',
      insight: 'Data intelligence & analytics',
    },
    heroLede: {
      ds: 'Bring critical systems back in minutes — not days — and move workloads to any cloud or data centre, on infrastructure you fully control.',
      bp: 'Run legal, delivery, risk and strategy in one Arabic-first workspace — where a task, a contract and a board decision finally connect.',
      sec: 'See real threats sooner, know exactly where your sensitive data lives, and respond automatically — turned into a security programme your board can act on.',
      insight: 'Give every leader one governed number — trusted, live, and running on data that never leaves the Kingdom.',
    },
    trustMicro:
      'Sovereign & Arabic-first · Deploy as SaaS, on-premise or fully air-gapped',
    talkToSales: 'Talk to sales',
    outcomesEyebrow: 'What you get',
    outcomesHeading: {
      ds: 'Resilience you can prove — before you need it',
      bp: 'Operations that finally join up',
      sec: 'A security programme, not just alerts',
      insight: 'Decisions built on data you can trust',
    },
    outcomes: {
      ds: [
        {
          title: 'Recover in minutes',
          desc: 'Immutable, ransomware-safe recovery points bring production back fast with one-click, boot-ordered failover.',
        },
        {
          title: 'Prove it with drills',
          desc: 'Rehearse against isolated networks on the exact recovery path — a drill is identical to the real event, with audit-grade evidence.',
        },
        {
          title: 'Move workloads anywhere',
          desc: 'Migrate VMs, databases and files between any cloud or data centre — and back — with rollback armed until you validate.',
        },
        {
          title: 'Stay continuously current',
          desc: 'Sub-10-second change capture keeps your recovery and reporting copies in step, with flat, predictable pricing.',
        },
      ],
      bp: [
        {
          title: 'Legal, natively Arabic',
          desc: 'Contracts and cases treat the Arabic document as the primary artifact — not a translation of an English one.',
        },
        {
          title: 'Delivery tied to strategy',
          desc: 'Every task traces up to an objective and across to a risk, automatically — nothing lives on an island.',
        },
        {
          title: 'Compliance without the sprawl',
          desc: 'Saudi frameworks come pre-loaded; evidence collected once satisfies every regulation it maps to.',
        },
        {
          title: 'One truth for the board',
          desc: 'Strategy, risk and legal roll up into a live executive view — the same governed numbers, not stale exports.',
        },
      ],
      sec: [
        {
          title: 'Detect threats sooner',
          desc: 'Detections, exposures and behaviour anomalies come together in one place, ranked by the risk that actually matters.',
        },
        {
          title: 'Know where your data lives',
          desc: 'Data-security posture management discovers and classifies sensitive data so you close exposure before it is breached.',
        },
        {
          title: 'Respond automatically',
          desc: 'Playbooks act the moment a threat is confirmed — containment never waits on a human queue.',
        },
        {
          title: 'Board-ready assurance',
          desc: 'A virtual CISO turns raw signals into a governed, reportable programme leadership can steer.',
        },
      ],
      insight: [
        {
          title: 'One governed number',
          desc: 'Every figure on a dashboard traces back to the same governed source — never a stale, hand-cut export.',
        },
        {
          title: 'Trusted by design',
          desc: 'Sources, pipelines and data quality are governed before anything reaches a report.',
        },
        {
          title: 'Dashboards leaders use',
          desc: 'Arabic-first board packs and operational views, live off a sovereign lakehouse.',
        },
        {
          title: 'On data you control',
          desc: 'Everything runs on sovereign infrastructure, inside the Kingdom, under your own governance.',
        },
      ],
    },
    appsEyebrow: 'Inside the suite',
    countWords: {
      1: 'One application',
      2: 'Two applications',
      3: 'Three applications',
      4: 'Four applications',
      5: 'Five applications',
    },
    appsHeading: '{count} — take what you need now, add the rest later',
    appsLede:
      'Each application solves a real problem on its own, and works better alongside the others. Start with one; the rest are ready when you are.',
    exploreApp: 'Explore {name}',
    trust: {
      eyebrow: 'Built for the Kingdom',
      title: 'Sovereignty and compliance, handled',
      lede: 'Aligned to the frameworks you already answer to, Arabic-first from the ground up, and deployable entirely within your own walls. Your data stays where you decide.',
      complianceLabel: 'Aligned with the frameworks you answer to',
      deployLabel: 'Deploy the way your mandate requires',
      deploy: [
        {
          name: 'SaaS',
          desc: 'Fully managed on sovereign infrastructure.',
          icon: 'globe',
        },
        {
          name: 'On-premise',
          desc: 'In your own data centre, under your control.',
          icon: 'server',
        },
        {
          name: 'Air-gapped',
          desc: 'Fully isolated for the most sensitive environments.',
          icon: 'lock',
        },
      ],
    },
    howEyebrow: 'How it works',
    seePlatformCore: 'See the platform core',
    familyCoreHeading: {
      ds: 'One recovery engine behind every product',
      bp: 'Modular apps on one shared workspace',
      sec: 'One console for the whole security programme',
      insight: 'Built on governed, sovereign data',
    },
    crossSuite: {
      ds: {
        eyebrow: 'Why it stays affordable',
        title: 'One engine behind every product',
        lede: 'Recovery, migration, change capture and the lakehouse share a single core. Improve it once and every product gets better at the same moment — so you pay for capability, not four separate rebuilds.',
      },
      bp: {
        eyebrow: 'Why nothing is an island',
        title: 'Everything connects, automatically',
        lede: 'Strategy cascades into delivery, delivery risks escalate to compliance, and legal events surface to the board. The links are automatic, so your teams stop stitching spreadsheets together by hand.',
      },
      sec: {
        eyebrow: 'Why it holds together',
        title: 'One security loop, end to end',
        lede: 'Detections, exposures, data risk and behaviour anomalies come together in one place — where automation responds and a virtual CISO turns it into a board-ready programme.',
      },
      insight: {
        eyebrow: 'Why the numbers are trustworthy',
        title: 'Governed first, surfaced second',
        lede: 'Data is governed for quality and lineage before it ever reaches a dashboard — so the figure on a board pack is the same trusted number the pipeline produced.',
      },
    },
    ctaTitle: 'See {name} on your own data',
  },
  ar: {
    familyEyebrow: {
      ds: 'مرونة البيانات وتنقّلها',
      bp: 'العمليات المؤسسية',
      sec: 'الأمن والبرامج السيبرانية',
      insight: 'ذكاء البيانات والتحليلات',
    },
    heroLede: {
      ds: 'أعِد أنظمتك الحسّاسة إلى العمل في دقائق — لا أيام — وانقل أحمالك إلى أي سحابة أو مركز بيانات، على بنيةٍ تتحكّم بها بالكامل.',
      bp: 'أدِر الشؤون القانونية والتنفيذ والمخاطر والاستراتيجية في مساحة عملٍ عربية أولاً — حيث تترابط أخيراً المهمّة والعقد وقرار المجلس.',
      sec: 'اكتشف التهديدات الحقيقية مبكراً، واعرف بدقّة أين تقيم بياناتك الحسّاسة، واستجب تلقائياً — كل ذلك في برنامجٍ أمني يستطيع مجلسك التصرّف بناءً عليه.',
      insight: 'امنح كل قائدٍ رقماً محوكماً واحداً — موثوقاً وحيّاً، يعمل على بياناتٍ لا تغادر المملكة.',
    },
    trustMicro:
      'سيادية وعربية أولاً · تُنشَر كخدمة سحابية أو داخل مقرّك أو معزولة تماماً',
    talkToSales: 'تحدّث إلى المبيعات',
    outcomesEyebrow: 'ما الذي تحصل عليه',
    outcomesHeading: {
      ds: 'مرونةٌ تستطيع إثباتها — قبل أن تحتاجها',
      bp: 'عملياتٌ تترابط أخيراً',
      sec: 'برنامج أمني، لا مجرّد تنبيهات',
      insight: 'قراراتٌ مبنيّة على بياناتٍ تثق بها',
    },
    outcomes: {
      ds: [
        {
          title: 'استعادةٌ في دقائق',
          desc: 'نقاط استعادةٍ ثابتة وآمنة ضد برامج الفدية تُعيد الإنتاج بسرعة عبر تجاوز فشلٍ بنقرةٍ واحدة وبترتيب إقلاعٍ صحيح.',
        },
        {
          title: 'أثبتها بالتجارب',
          desc: 'تدرّب على شبكاتٍ معزولة عبر مسار الاستعادة نفسه — فالتجربة مطابقة للحدث الحقيقي، مع أدلّةٍ صالحة للتدقيق.',
        },
        {
          title: 'انقل أحمالك أينما شئت',
          desc: 'انقل الأجهزة الافتراضية وقواعد البيانات والملفات بين أي سحابةٍ أو مركز بيانات — وبالعكس — مع تراجعٍ مُجهَّز حتى تتحقّق.',
        },
        {
          title: 'تحديثٌ متواصل',
          desc: 'التقاط تغييرٍ في أقل من عشر ثوانٍ يُبقي نسخ الاستعادة والتقارير متزامنة، بتسعيرٍ ثابتٍ يمكن توقّعه.',
        },
      ],
      bp: [
        {
          title: 'قانونٌ عربيٌّ أصيل',
          desc: 'تتعامل العقود والقضايا مع المستند العربي بوصفه الأصل — لا ترجمةً عن نصٍّ إنجليزي.',
        },
        {
          title: 'تنفيذٌ مرتبطٌ بالاستراتيجية',
          desc: 'كل مهمّةٍ تتّصل صعوداً بهدفٍ وعرضاً بمخاطرة، تلقائياً — فلا شيء يبقى منعزلاً.',
        },
        {
          title: 'التزامٌ بلا تشتّت',
          desc: 'الأطر السعودية جاهزة مسبقاً، والدليل الذي يُجمَع مرة يفي بكل نظامٍ يرتبط به.',
        },
        {
          title: 'حقيقةٌ واحدة للمجلس',
          desc: 'تتجمّع الاستراتيجية والمخاطر والشؤون القانونية في عرضٍ تنفيذيٍّ حيّ — الأرقام المحوكمة ذاتها، لا نسخاً قديمة.',
        },
      ],
      sec: [
        {
          title: 'اكتشافٌ أبكر',
          desc: 'تجتمع الاكتشافات والتعرّضات والحالات الشاذّة في مكانٍ واحد، مرتّبةً حسب المخاطر التي تهمّ فعلاً.',
        },
        {
          title: 'اعرف أين بياناتك',
          desc: 'تكتشف إدارة وضع أمن البيانات بياناتك الحسّاسة وتصنّفها لتغلق التعرّض قبل أن يُخترَق.',
        },
        {
          title: 'استجابةٌ تلقائية',
          desc: 'تتحرّك كتيّبات التشغيل لحظة تأكيد التهديد — فالاحتواء لا ينتظر طابوراً بشرياً.',
        },
        {
          title: 'اطمئنانٌ جاهز للمجلس',
          desc: 'يحوّل مدير الأمن الافتراضي الإشارات الخام إلى برنامجٍ محوكمٍ قابل للعرض تقوده القيادة.',
        },
      ],
      insight: [
        {
          title: 'رقمٌ محوكمٌ واحد',
          desc: 'كل رقمٍ على اللوحة يعود بأثره إلى المصدر المحوكم نفسه — لا نسخةً قديمة مقتطعة يدوياً.',
        },
        {
          title: 'موثوقٌ بالتصميم',
          desc: 'تُحوكَم المصادر وخطوط المعالجة وجودة البيانات قبل أن يصل أي شيءٍ إلى تقرير.',
        },
        {
          title: 'لوحاتٌ يستخدمها القادة',
          desc: 'حزم مجلسٍ ولوحات تشغيلٍ عربية أولاً، حيّةٌ من بحيرة بياناتٍ سيادية.',
        },
        {
          title: 'على بياناتٍ تتحكّم بها',
          desc: 'يعمل كل شيءٍ على بنيةٍ سيادية داخل المملكة، تحت حوكمتك أنت.',
        },
      ],
    },
    appsEyebrow: 'داخل المجموعة',
    countWords: {
      1: 'تطبيق واحد',
      2: 'تطبيقان',
      3: 'ثلاثة تطبيقات',
      4: 'أربعة تطبيقات',
      5: 'خمسة تطبيقات',
    },
    appsHeading: '{count} — خذ ما تحتاجه الآن، وأضِف الباقي لاحقاً',
    appsLede:
      'كل تطبيقٍ يحلّ مشكلةً حقيقية بمفرده، ويعمل بشكلٍ أفضل إلى جانب البقية. ابدأ بواحد، والباقي جاهزٌ متى استعددت.',
    exploreApp: 'استكشف {name}',
    trust: {
      eyebrow: 'مبنيٌّ للمملكة',
      title: 'السيادة والامتثال، مضمونان',
      lede: 'متوافقٌ مع الأطر التي تخضع لها أصلاً، عربيٌّ أولاً من الأساس، وقابلٌ للنشر بالكامل داخل جدرانك. تبقى بياناتك حيث تقرّر أنت.',
      complianceLabel: 'متوافق مع الأطر التي تخضع لها',
      deployLabel: 'انشره كما تقتضي متطلّباتك',
      deploy: [
        {
          name: 'خدمة سحابية',
          desc: 'مُدارة بالكامل على بنيةٍ سيادية.',
          icon: 'globe',
        },
        {
          name: 'داخل المقرّ',
          desc: 'في مركز بياناتك، تحت سيطرتك.',
          icon: 'server',
        },
        {
          name: 'معزولة تماماً',
          desc: 'عزلٌ كامل لأكثر البيئات حساسية.',
          icon: 'lock',
        },
      ],
    },
    howEyebrow: 'كيف يعمل',
    seePlatformCore: 'اطّلع على نواة المنصّة',
    familyCoreHeading: {
      ds: 'محرّك استعادةٍ واحد خلف كل منتج',
      bp: 'تطبيقات معيارية على مساحة عملٍ واحدة',
      sec: 'لوحةٌ واحدة للبرنامج الأمني بأكمله',
      insight: 'مبنيّة على بياناتٍ محوكمة وسيادية',
    },
    crossSuite: {
      ds: {
        eyebrow: 'لماذا يبقى في المتناول',
        title: 'محرّكٌ واحد خلف كل منتج',
        lede: 'تتشارك الاستعادة والنقل والتقاط التغيير وبحيرة البيانات نواةً واحدة. أصلِحها مرة، فتتحسّن كل المنتجات في اللحظة ذاتها — فتدفع مقابل القدرة، لا مقابل أربع عمليات بناءٍ منفصلة.',
      },
      bp: {
        eyebrow: 'لماذا لا شيء منعزل',
        title: 'كل شيءٍ يترابط، تلقائياً',
        lede: 'تتدرّج الاستراتيجية إلى التنفيذ، وتتصاعد مخاطر التنفيذ إلى الامتثال، وتَظهر الأحداث القانونية إلى المجلس. الروابط تلقائية، فتتوقّف فِرقك عن حياكة الجداول يدوياً.',
      },
      sec: {
        eyebrow: 'لماذا يتماسك معاً',
        title: 'حلقة أمنية واحدة، من طرفٍ إلى طرف',
        lede: 'تجتمع الاكتشافات والتعرّضات ومخاطر البيانات والحالات الشاذّة في مكانٍ واحد — حيث تستجيب الأتمتة، ويحوّلها مدير الأمن الافتراضي إلى برنامجٍ جاهز للمجلس.',
      },
      insight: {
        eyebrow: 'لماذا الأرقام موثوقة',
        title: 'محوكمة أولاً، معروضة ثانياً',
        lede: 'تُحوكَم البيانات من حيث الجودة والأثر قبل أن تصل إلى أي لوحة — فيكون الرقم في حزمة المجلس هو الرقم الموثوق نفسه الذي أنتجه خطّ المعالجة.',
      },
    },
    ctaTitle: 'شاهد {name} على بياناتك أنت',
  },
};

/** Fill a single {token} in a localised template. */
function fill(template: string, token: string, value: string): string {
  return template.split(`{${token}}`).join(value);
}

/* statusBadge() — HTML 1760-1764. GA/Roadmap are treated as language-neutral
   status chips (kept identical to the fully-bilingual home reference, whose
   StatusBadge renders the same literals in both locales). */
function StatusBadge({ status }: { status: MarketingApp['status'] }) {
  if (status === 'ga') return <span className="badge-ga">GA</span>;
  return <span className="badge-soon">Roadmap</span>;
}

function CrossSuite({ copy }: { copy: CrossSuiteCopy }) {
  return (
    <section className="section stats-band">
      <div className="grid-overlay" />
      <div className="wrap">
        <div className="sec-head center" style={{ marginBottom: '30px' }}>
          <div className="eyebrow on-dark" style={{ justifyContent: 'center' }}>
            {copy.eyebrow}
          </div>
          <h2 style={{ color: 'var(--text-inv)' }}>{copy.title}</h2>
          <p className="lede" style={{ color: 'var(--text-inv-2)' }}>
            {copy.lede}
          </p>
        </div>
      </div>
    </section>
  );
}

export function SuiteSite({ suite }: { suite: MarketingSuiteRecord }) {
  const { locale, messages: m } = useMarketingLocale();
  const c = SUITE_COPY[locale];
  const family = suite.family;
  const grad = MARKETING_BRAND_TOKENS.suiteFamilies[family].gradient;
  const st = localizeMarketingSuite(suite, locale);
  const countWord =
    c.countWords[suite.apps.length] ?? String(suite.apps.length);
  const countHeading = fill(c.appsHeading, 'count', countWord);
  const outcomes = c.outcomes[family];

  return (
    <>
      {/* Hero — outcome-led */}
      <header className={`page-hero suite-${family}`}>
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <div className="breadcrumb">
            <Link href="/">{m.chrome.breadcrumbHome}</Link>{' '}
            <MarketingIcon name="chev" /> <span>{suite.name}</span>
          </div>
          <div className="eyebrow">{c.familyEyebrow[family]}</div>
          <h1>{suite.name}</h1>
          <p className="lede">{c.heroLede[family]}</p>
          <div
            style={{
              marginTop: '30px',
              display: 'flex',
              gap: '14px',
              flexWrap: 'wrap',
            }}
          >
            <Link className="btn btn-gold" href="/contact">
              {m.chrome.cta.requestDemo} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark" href="/contact">
              {c.talkToSales}
            </Link>
          </div>
          <div
            style={{
              marginTop: '22px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              color: 'var(--text-inv-2)',
              fontSize: '.86rem',
              fontWeight: 500,
            }}
          >
            <MarketingIcon name="shield" />
            <span>{c.trustMicro}</span>
          </div>
        </div>
      </header>

      {/* Outcomes — "what you get" (benefits up top) */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.outcomesEyebrow}</div>
            <h2>{c.outcomesHeading[family]}</h2>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '18px',
            }}
          >
            {outcomes.map((o) => (
              <div
                key={o.title}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: '14px',
                  padding: '24px',
                }}
              >
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '11px',
                    background: grad,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--text-inv)',
                    marginBottom: '14px',
                  }}
                >
                  <MarketingIcon name="check" />
                </div>
                <h4 style={{ marginBottom: '8px' }}>{o.title}</h4>
                <p style={{ color: 'var(--text-2)', margin: 0 }}>{o.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Apps as capabilities */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.appsEyebrow}</div>
            <h2>{countHeading}</h2>
            <p className="lede">{c.appsLede}</p>
          </div>
          <div className="apps-grid">
            {suite.apps.map((a) => {
              const at = localizeMarketingApp(a, locale);
              return (
                <Link
                  key={a.id}
                  className="app-card"
                  href={getMarketingAppPath(suite.id, a.id)}
                  style={{ gridColumn: 'span 1' }}
                >
                  <div className="ac-h">
                    <div className="app-ico" style={{ background: grad }}>
                      <MarketingIcon name={a.icon} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4>
                        {a.name}{' '}
                        <span className="ar bilingual" dir="rtl" lang="ar">
                          {a.ar}
                        </span>{' '}
                        <StatusBadge status={a.status} />
                      </h4>
                      <p className="role">{at.role}</p>
                    </div>
                  </div>
                  <p>{at.short}</p>
                  <div className="chips">
                    {at.specs.map((sp, i) => (
                      <span className="chip" key={i}>
                        {sp.metric}
                      </span>
                    ))}
                  </div>
                  <span className="more">
                    {fill(c.exploreApp, 'name', a.name)}{' '}
                    <MarketingIcon name="arrow" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Trust / proof — sovereignty + compliance reassurance */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {c.trust.eyebrow}
            </div>
            <h2>{c.trust.title}</h2>
            <p className="lede">{c.trust.lede}</p>
          </div>

          {/* Compliance marks */}
          <p
            style={{
              textAlign: 'center',
              color: 'var(--text-2)',
              fontSize: '.82rem',
              fontWeight: 600,
              letterSpacing: '.02em',
              textTransform: 'uppercase',
              margin: '0 0 16px',
            }}
          >
            {c.trust.complianceLabel}
          </p>
          <div
            className="chips"
            style={{ justifyContent: 'center', marginBottom: '44px' }}
          >
            {COMPLIANCE_MARKS.map((mark) => (
              <span
                className="chip"
                key={mark}
                style={{ fontSize: '.85rem', padding: '8px 16px' }}
              >
                {mark}
              </span>
            ))}
          </div>

          {/* Deployment options */}
          <p
            style={{
              textAlign: 'center',
              color: 'var(--text-2)',
              fontSize: '.82rem',
              fontWeight: 600,
              letterSpacing: '.02em',
              textTransform: 'uppercase',
              margin: '0 0 16px',
            }}
          >
            {c.trust.deployLabel}
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
            }}
          >
            {c.trust.deploy.map((d) => (
              <div
                key={d.name}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: '14px',
                  padding: '22px',
                  display: 'flex',
                  gap: '14px',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: grad,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--text-inv)',
                    flex: 'none',
                  }}
                >
                  <MarketingIcon name={d.icon} />
                </div>
                <div>
                  <h4 style={{ marginBottom: '4px', fontSize: '1.02rem' }}>
                    {d.name}
                  </h4>
                  <p style={{ color: 'var(--text-2)', margin: 0, fontSize: '.92rem' }}>
                    {d.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Below the fold: how it works, for evaluators ── */}

      {/* Shared core explainer (demoted technical depth) */}
      <section className="section-tight" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap split">
          <div>
            <div className="eyebrow">{c.howEyebrow}</div>
            <h3 style={{ marginBottom: '14px' }}>
              {c.familyCoreHeading[family]}
            </h3>
            <p style={{ color: 'var(--text-2)', margin: '0 0 10px' }}>
              {st.coreDesc}
            </p>
            <Link className="linkarrow" href="/platform">
              {c.seePlatformCore} <MarketingIcon name="arrow" />
            </Link>
          </div>
          <div className="ac-core" style={{ gap: '10px' }}>
            {suite.apps.map((a) => (
              <div
                key={a.id}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: '10px',
                  padding: '14px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '9px',
                    background: grad,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--text-inv)',
                    margin: '0 auto 8px',
                  }}
                >
                  <MarketingIcon name={a.icon} />
                </div>
                <span
                  style={{
                    fontSize: '.78rem',
                    fontWeight: 700,
                    color: 'var(--text)',
                  }}
                >
                  {a.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Family-specific cross-suite narrative (demoted) */}
      <CrossSuite copy={c.crossSuite[family]} />

      {/* Closing CTA */}
      <CtaBand title={fill(c.ctaTitle, 'name', suite.name)} sub={st.tagline} />
    </>
  );
}
