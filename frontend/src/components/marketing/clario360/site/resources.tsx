'use client';

import Link from 'next/link';
import type { MarketingLocale } from '@/lib/marketing/messages';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';
import { Breadcrumb } from './shared';

/* ============================================================
   PAGE: RESOURCES / EVALUATION HUB (marketing-first)

   Reworked from a raw documentation list into an inviting
   marketing channel: a benefit-led hero with clear CTAs and a
   Saudi-frameworks trust strip, confidence-building GUIDES up
   top, outcome-framed datasheets, a sovereign PROOF band, and a
   de-jargoned "for developers & evaluators" section kept clearly
   LOWER. Genuine technical depth is preserved, just demoted.

   Fully chrome-owned (no suites.ts DATA layer), so ALL copy is
   localised here via a co-located, typed {en,ar} module — the
   same pattern INFRA uses for HOME_LINKS in home.tsx. Icons are
   presentation constants paired positionally with the localised
   text. The leading breadcrumb crumb reuses the shared chrome
   (`m.chrome.breadcrumbHome`). New copy lives ONLY here (not in
   messages.ts) per the parallel-edit contract; new styling is
   inline (a later pass consolidates it into clario-site.css).
   ============================================================ */

interface ResCardCopy {
  readonly title: string;
  readonly desc: string;
  readonly tag: string;
}
interface DevCopy {
  readonly title: string;
  readonly desc: string;
}
interface PointCopy {
  readonly title: string;
  readonly sub: string;
}
interface ResourcesCopy {
  readonly breadcrumb: string;
  readonly heroEyebrow: string;
  readonly heroTitle: string;
  readonly heroLede: string;
  readonly ctaDemo: string;
  readonly ctaSales: string;
  readonly trustLabel: string;
  readonly trustChips: readonly string[];
  readonly deployLine: string;
  readonly guidesEyebrow: string;
  readonly guidesTitle: string;
  readonly guidesLede: string;
  readonly guides: readonly ResCardCopy[];
  readonly datasheetsEyebrow: string;
  readonly datasheetsTitle: string;
  readonly datasheetsLede: string;
  readonly datasheets: readonly ResCardCopy[];
  readonly proofEyebrow: string;
  readonly proofTitle: string;
  readonly proofLede: string;
  readonly proofPoints: readonly PointCopy[];
  readonly proofCta: string;
  readonly devEyebrow: string;
  readonly devTitle: string;
  readonly devLede: string;
  readonly dev: readonly DevCopy[];
  readonly docsBadge: string;
  readonly requestAccess: string;
  readonly evalEyebrow: string;
  readonly evalTitle: string;
  readonly evalLede: string;
  readonly evalItems: readonly PointCopy[];
  readonly requestPack: string;
  readonly whyClario: string;
}

/* Icons stay in the component (presentation), paired positionally with the
   localised card text below. */
const GUIDE_ICONS = ['server', 'shield', 'scale', 'globe'] as const;
const DATASHEET_ICONS = ['layers', 'recover', 'gavel', 'shield', 'trend'] as const;
const PROOF_ICONS = ['pin', 'checkCircle', 'globe', 'layers'] as const;
const DEV_ICONS = ['network', 'sync', 'plug', 'key'] as const;
const EVAL_ICONS = ['clipboard', 'network', 'cube', 'checkCircle'] as const;

const RESOURCES_COPY: Record<MarketingLocale, ResourcesCopy> = {
  en: {
    breadcrumb: 'Resources',
    heroEyebrow: 'Resources & guides',
    heroTitle: 'Everything you need to evaluate — and decide',
    heroLede:
      'Product overviews, deployment and security guides, compliance mappings, and a team ready to help — so your procurement, security and IT stakeholders can move forward with confidence.',
    ctaDemo: 'Request a demo',
    ctaSales: 'Talk to sales',
    trustLabel: 'Aligned to Saudi frameworks',
    trustChips: ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'],
    deployLine:
      'Deploy in the cloud, on-premise, or fully air-gapped — your data stays in the Kingdom.',
    guidesEyebrow: 'Start here',
    guidesTitle: 'Guides for the questions that matter',
    guidesLede:
      'The deployment, security and compliance answers your teams ask for — written for decision-makers, not just engineers.',
    guides: [
      {
        title: 'Deployment guide',
        desc: 'Cloud, on-premise or air-gapped — see the reference architecture and what it takes to run Clario360 in your environment.',
        tag: 'Guide',
      },
      {
        title: 'Security whitepaper',
        desc: 'How we keep every tenant isolated, encrypted and auditable — the sovereign security model, explained clearly.',
        tag: 'Whitepaper',
      },
      {
        title: 'Compliance mapping',
        desc: 'See exactly how Clario360 maps to NCA, SAMA, PDPL, ISO 27001 and NIST — evidence your auditors will recognise.',
        tag: 'Reference',
      },
      {
        title: 'Arabic-first by design',
        desc: 'Native Arabic and right-to-left across the platform, with bilingual documents generated in either language.',
        tag: 'Guide',
      },
    ],
    datasheetsEyebrow: 'One-pagers',
    datasheetsTitle: 'Product datasheets',
    datasheetsLede:
      'A quick one-page overview of the platform and each suite — easy to share with your stakeholders.',
    datasheets: [
      {
        title: 'Platform overview',
        desc: 'The whole platform on one page — suites, capabilities and deployment options.',
        tag: 'Datasheet',
      },
      {
        title: 'DataStream Suite',
        desc: 'Recover in minutes and move data with confidence — disaster recovery and data mobility at a glance.',
        tag: 'Datasheet',
      },
      {
        title: 'Business+ Suite',
        desc: 'Contracts, legal, governance and delivery — run the business of the business.',
        tag: 'Datasheet',
      },
      {
        title: 'ClarioSec Suite',
        desc: 'Detect threats, protect data and stay audit-ready — security operations at a glance.',
        tag: 'Datasheet',
      },
      {
        title: 'ClarioInsight Suite',
        desc: 'Unified data, analytics and dashboards — decisions backed by one source of truth.',
        tag: 'Datasheet',
      },
    ],
    proofEyebrow: 'Why teams trust Clario360',
    proofTitle: 'Sovereign by design, proven where it counts',
    proofLede:
      'One platform, four suites, entirely under your control — built for the Kingdom and the wider GCC.',
    proofPoints: [
      {
        title: 'Your data stays in the Kingdom',
        sub: 'SaaS, on-premise or fully air-gapped',
      },
      {
        title: 'Aligned to Saudi frameworks',
        sub: 'NCA, SAMA, PDPL, ZATCA and ISO 27001',
      },
      {
        title: 'Arabic-first',
        sub: 'Built for KSA and the GCC',
      },
      {
        title: 'One platform, four suites',
        sub: 'No vendor patchwork to stitch together',
      },
    ],
    proofCta: 'See it live',
    devEyebrow: 'For developers & evaluators',
    devTitle: 'Build on an open platform',
    devLede:
      'Stable, well-documented APIs and ready-made connectors — so Clario360 fits into the systems you already run.',
    dev: [
      {
        title: 'REST APIs',
        desc: 'Stable, versioned APIs documented with OpenAPI — integrate on your own terms.',
      },
      {
        title: 'Webhooks & events',
        desc: 'Subscribe to activity across the platform to keep your own systems in sync.',
      },
      {
        title: 'Connectors',
        desc: 'Pre-built connectors for your existing tools and Saudi government platforms.',
      },
      {
        title: 'Single sign-on',
        desc: 'Connect your identity provider with SSO and federated identity — secure by default.',
      },
    ],
    docsBadge: 'Docs',
    requestAccess: 'Get the guide',
    evalEyebrow: 'Ready to go deeper?',
    evalTitle: 'Get a tailored evaluation pack',
    evalLede:
      "Security questionnaires, reference architectures mapped to your environment, and a sandbox — we'll prepare a pack scoped to your institution and frameworks.",
    evalItems: [
      {
        title: 'Security questionnaire support',
        sub: 'SIG, CAIQ and custom questionnaires',
      },
      {
        title: 'Reference architecture',
        sub: 'Mapped to your deployment model',
      },
      {
        title: 'Proof-of-value sandbox',
        sub: 'A scoped environment to evaluate',
      },
      {
        title: 'Compliance evidence',
        sub: 'Framework mappings and attestations',
      },
    ],
    requestPack: 'Request evaluation pack',
    whyClario: 'Why Clario360',
  },
  ar: {
    breadcrumb: 'الموارد',
    heroEyebrow: 'الموارد والأدلّة',
    heroTitle: 'كل ما تحتاجونه للتقييم واتخاذ القرار',
    heroLede:
      'نظرات عامة على المنتجات، وأدلّة النشر والأمن، وربطٌ بأطر الامتثال، وفريقٌ جاهز لمساعدتكم — لتمضي فرق المشتريات والأمن وتقنية المعلومات لديكم بثقة.',
    ctaDemo: 'اطلبوا عرضاً توضيحياً',
    ctaSales: 'تحدّثوا إلى المبيعات',
    trustLabel: 'متوافق مع الأطر السعودية',
    trustChips: ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'],
    deployLine:
      'انشروا سحابياً أو داخل المقارّ أو معزولاً بالكامل — تبقى بياناتكم داخل المملكة.',
    guidesEyebrow: 'ابدأوا من هنا',
    guidesTitle: 'أدلّة للأسئلة التي تهمّكم',
    guidesLede:
      'إجابات النشر والأمن والامتثال التي تطلبها فرقكم — مكتوبة لصنّاع القرار، لا للمهندسين وحدهم.',
    guides: [
      {
        title: 'دليل النشر',
        desc: 'سحابياً أو داخل المقارّ أو معزولاً بالكامل — اطّلعوا على البنية المرجعية وما يلزم لتشغيل Clario360 في بيئتكم.',
        tag: 'دليل',
      },
      {
        title: 'ورقة الأمن البيضاء',
        desc: 'كيف نُبقي كل مستأجرٍ معزولاً ومشفَّراً وقابلاً للتدقيق — نموذج الأمن السيادي بأسلوبٍ واضح.',
        tag: 'ورقة بيضاء',
      },
      {
        title: 'ربط الامتثال',
        desc: 'شاهدوا كيف يرتبط Clario360 بضوابط NCA وSAMA وPDPL وISO 27001 وNIST — أدلّةٌ يعرفها مدقّقوكم.',
        tag: 'مرجع',
      },
      {
        title: 'التصميم بالعربية أولاً',
        desc: 'دعمٌ أصيل للعربية والكتابة من اليمين إلى اليسار عبر المنصّة، مع توليد مستندات ثنائية اللغة بأيٍّ من اللغتين.',
        tag: 'دليل',
      },
    ],
    datasheetsEyebrow: 'ملخّصات من صفحة',
    datasheetsTitle: 'صحائف بيانات المنتجات',
    datasheetsLede:
      'نظرة سريعة من صفحةٍ واحدة على المنصّة وكل مجموعة — يسهل مشاركتها مع أصحاب القرار لديكم.',
    datasheets: [
      {
        title: 'نظرة عامة على المنصّة',
        desc: 'المنصّة كاملةً في صفحةٍ واحدة — المجموعات والقدرات وخيارات النشر.',
        tag: 'صحيفة بيانات',
      },
      {
        title: 'مجموعة DataStream',
        desc: 'تعافٍ خلال دقائق ونقلٌ موثوق للبيانات — التعافي من الكوارث وتنقّل البيانات في لمحة.',
        tag: 'صحيفة بيانات',
      },
      {
        title: 'مجموعة Business+',
        desc: 'العقود والشؤون القانونية والحوكمة والتنفيذ — لإدارة أعمالكم بثقة.',
        tag: 'صحيفة بيانات',
      },
      {
        title: 'مجموعة ClarioSec',
        desc: 'اكتشفوا التهديدات واحموا البيانات وابقوا جاهزين للتدقيق — عمليات الأمن في لمحة.',
        tag: 'صحيفة بيانات',
      },
      {
        title: 'مجموعة ClarioInsight',
        desc: 'بياناتٌ موحّدة وتحليلاتٌ ولوحات معلومات — قراراتٌ تستند إلى مصدرٍ واحد للحقيقة.',
        tag: 'صحيفة بيانات',
      },
    ],
    proofEyebrow: 'لماذا تثق الفرق بـ Clario360',
    proofTitle: 'سياديّ بالتصميم، وموثوقٌ حيث يهمّ',
    proofLede:
      'منصّةٌ واحدة، وأربع مجموعات، تحت سيادتكم الكاملة — مصمّمة للمملكة ولدول الخليج.',
    proofPoints: [
      {
        title: 'تبقى بياناتكم داخل المملكة',
        sub: 'سحابياً أو داخل المقارّ أو معزولاً بالكامل',
      },
      {
        title: 'متوافق مع الأطر السعودية',
        sub: 'NCA وSAMA وPDPL وZATCA وISO 27001',
      },
      {
        title: 'بالعربية أولاً',
        sub: 'مصمّمة للمملكة ولدول الخليج',
      },
      {
        title: 'منصّة واحدة، أربع مجموعات',
        sub: 'دون ترقيعٍ بين المورّدين',
      },
    ],
    proofCta: 'شاهدوها مباشرة',
    devEyebrow: 'للمطوّرين والمقيّمين',
    devTitle: 'ابنوا على منصّة مفتوحة',
    devLede:
      'واجهات برمجية مستقرّة وموثّقة جيداً وموصّلات جاهزة — ليندمج Clario360 مع الأنظمة التي تشغّلونها اليوم.',
    dev: [
      {
        title: 'واجهات REST',
        desc: 'واجهات مستقرّة ومُصدَرة وموثّقة بمعيار OpenAPI — تكامَلوا وفق شروطكم.',
      },
      {
        title: 'الويب هوكس والأحداث',
        desc: 'اشتركوا في النشاط عبر المنصّة لإبقاء أنظمتكم متزامنة.',
      },
      {
        title: 'الموصّلات',
        desc: 'موصّلات جاهزة لأدواتكم الحالية وللمنصّات الحكومية السعودية.',
      },
      {
        title: 'الدخول الموحّد',
        desc: 'اربطوا مزوّد الهوية لديكم عبر الدخول الموحّد والهوية الاتحادية — آمنٌ افتراضياً.',
      },
    ],
    docsBadge: 'توثيق',
    requestAccess: 'احصلوا على الدليل',
    evalEyebrow: 'جاهزون للتعمّق أكثر؟',
    evalTitle: 'احصلوا على حزمة تقييمٍ مخصّصة',
    evalLede:
      'استبيانات أمنية، وبنى مرجعية مربوطة ببيئتكم، وبيئة اختبارٍ معزولة — سنُعِدّ حزمة مخصّصة لمؤسستكم وأطركم.',
    evalItems: [
      {
        title: 'دعم الاستبيانات الأمنية',
        sub: 'استبيانات SIG وCAIQ واستبيانات مخصّصة',
      },
      {
        title: 'البنية المرجعية',
        sub: 'مربوطة بنموذج نشركم',
      },
      {
        title: 'بيئة اختبار لإثبات القيمة',
        sub: 'بيئة محدّدة النطاق للتقييم',
      },
      {
        title: 'أدلّة الامتثال',
        sub: 'روابط الأطر والتوثيقات',
      },
    ],
    requestPack: 'اطلبوا حزمة التقييم',
    whyClario: 'لماذا Clario360',
  },
};

function ResCardItem({
  r,
  icon,
  requestAccess,
}: {
  r: ResCardCopy;
  icon: string;
  requestAccess: string;
}) {
  return (
    <div className="res-card">
      <div className="res-ico" aria-hidden="true">
        <MarketingIcon name={icon} />
      </div>
      <span className="res-tag">{r.tag}</span>
      <h4>{r.title}</h4>
      <p>{r.desc}</p>
      <Link className="linkarrow" href="/contact">
        {requestAccess} <MarketingIcon name="arrow" />
      </Link>
    </div>
  );
}

export function ResourcesSite() {
  const { locale, messages: m } = useMarketingLocale();
  const c = RESOURCES_COPY[locale];
  return (
    <>
      <header className="page-hero">
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <Breadcrumb
            trail={[
              { label: m.chrome.breadcrumbHome, href: '/' },
              { label: c.breadcrumb },
            ]}
          />
          <div className="eyebrow">{c.heroEyebrow}</div>
          <h1>{c.heroTitle}</h1>
          <p className="lede">{c.heroLede}</p>

          <div
            style={{
              marginTop: '28px',
              display: 'flex',
              gap: '14px',
              flexWrap: 'wrap',
            }}
          >
            <Link className="btn btn-gold" href="/contact">
              {c.ctaDemo} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark" href="/contact">
              {c.ctaSales}
            </Link>
          </div>

          {/* Trust strip — compliance framed as reassurance, on the dark hero. */}
          <div
            style={{
              marginTop: '26px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: '.8rem',
                color: 'var(--text-inv-2)',
                marginInlineEnd: '4px',
              }}
            >
              {c.trustLabel}
            </span>
            {c.trustChips.map((chip) => (
              <span
                key={chip}
                style={{
                  fontSize: '.78rem',
                  fontWeight: 600,
                  letterSpacing: '.02em',
                  color: 'var(--text-inv)',
                  background: 'rgba(255,255,255,.06)',
                  border: '1px solid var(--ink-line)',
                  borderRadius: '999px',
                  padding: '5px 12px',
                }}
              >
                {chip}
              </span>
            ))}
          </div>
          <p
            style={{
              marginTop: '14px',
              fontSize: '.85rem',
              color: 'var(--text-inv-2)',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <span style={{ color: 'var(--gold-400)' }} aria-hidden="true">
              <MarketingIcon name="globe" />
            </span>
            {c.deployLine}
          </p>
        </div>
      </header>

      {/* GUIDES — moved up: the confidence-builders buyers actually want. */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.guidesEyebrow}</div>
            <h2>{c.guidesTitle}</h2>
            <p className="lede">{c.guidesLede}</p>
          </div>
          <div className="res-grid">
            {c.guides.map((r, i) => (
              <ResCardItem
                key={r.title}
                r={r}
                icon={GUIDE_ICONS[i] ?? 'book'}
                requestAccess={c.requestAccess}
              />
            ))}
          </div>
        </div>
      </section>

      {/* DATASHEETS — outcome-framed one-pagers. */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.datasheetsEyebrow}</div>
            <h2>{c.datasheetsTitle}</h2>
            <p className="lede">{c.datasheetsLede}</p>
          </div>
          <div className="res-grid">
            {c.datasheets.map((r, i) => (
              <ResCardItem
                key={r.title}
                r={r}
                icon={DATASHEET_ICONS[i] ?? 'doc'}
                requestAccess={c.requestAccess}
              />
            ))}
          </div>
        </div>
      </section>

      {/* PROOF BAND — sovereignty / KSA-first reassurance + repeated CTA. */}
      <section className="section" style={{ background: 'var(--ink)', color: 'var(--text-inv)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow on-dark">{c.proofEyebrow}</div>
            <h2 style={{ color: 'var(--text-inv)' }}>{c.proofTitle}</h2>
            <p className="lede" style={{ color: 'var(--text-inv-2)' }}>
              {c.proofLede}
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
              gap: '14px',
            }}
          >
            {c.proofPoints.map((p, i) => (
              <div
                key={p.title}
                style={{
                  display: 'flex',
                  gap: '13px',
                  alignItems: 'flex-start',
                  background: 'rgba(255,255,255,.05)',
                  border: '1px solid var(--ink-line)',
                  borderRadius: '11px',
                  padding: '16px 18px',
                }}
              >
                <span
                  style={{ color: 'var(--gold-400)', flexShrink: 0 }}
                  aria-hidden="true"
                >
                  <MarketingIcon name={PROOF_ICONS[i] ?? 'checkCircle'} />
                </span>
                <div>
                  <b
                    style={{
                      color: 'var(--text-inv)',
                      fontSize: '.95rem',
                      display: 'block',
                      marginBottom: '2px',
                    }}
                  >
                    {p.title}
                  </b>
                  <span
                    style={{ color: 'var(--text-inv-2)', fontSize: '.84rem' }}
                  >
                    {p.sub}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              marginTop: '26px',
              display: 'flex',
              gap: '14px',
              flexWrap: 'wrap',
            }}
          >
            <Link className="btn btn-gold" href="/contact">
              {c.proofCta} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark" href="/contact">
              {c.ctaSales}
            </Link>
          </div>
        </div>
      </section>

      {/* FOR DEVELOPERS & EVALUATORS — technical depth, kept clearly lower. */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{c.devEyebrow}</div>
            <h2>{c.devTitle}</h2>
            <p className="lede">{c.devLede}</p>
          </div>
          <div className="modules">
            {c.dev.map((r, i) => (
              <div className="module" key={r.title}>
                <div className="mi" aria-hidden="true">
                  <MarketingIcon name={DEV_ICONS[i] ?? 'server'} />
                </div>
                <div>
                  <h5>
                    {r.title}{' '}
                    <span
                      className="badge-soon"
                      style={{ marginInlineStart: '4px' }}
                    >
                      {c.docsBadge}
                    </span>
                  </h5>
                  <p>{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA — tailored evaluation pack + repeated demo/sales CTAs. */}
      <section className="section" style={{ background: 'var(--ink)', color: 'var(--text-inv)' }}>
        <div className="wrap split">
          <div>
            <div className="eyebrow on-dark">{c.evalEyebrow}</div>
            <h2 style={{ color: 'var(--text-inv)', marginBottom: '14px' }}>{c.evalTitle}</h2>
            <p className="lede" style={{ color: 'var(--text-inv-2)' }}>
              {c.evalLede}
            </p>
            <div
              style={{
                marginTop: '22px',
                display: 'flex',
                gap: '14px',
                flexWrap: 'wrap',
              }}
            >
              <Link className="btn btn-gold" href="/contact">
                {c.requestPack} <MarketingIcon name="arrow" />
              </Link>
              <Link className="btn btn-ondark" href="/contact">
                {c.ctaDemo}
              </Link>
              <Link className="btn btn-ondark" href="/compare">
                {c.whyClario}
              </Link>
            </div>
          </div>
          <div>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              {c.evalItems.map((x, i) => (
                <div
                  key={x.title}
                  style={{
                    display: 'flex',
                    gap: '13px',
                    alignItems: 'center',
                    background: 'rgba(255,255,255,.05)',
                    border: '1px solid var(--ink-line)',
                    borderRadius: '11px',
                    padding: '15px 17px',
                  }}
                >
                  <span style={{ color: 'var(--gold-400)' }} aria-hidden="true">
                    <MarketingIcon name={EVAL_ICONS[i] ?? 'checkCircle'} />
                  </span>
                  <div>
                    <b
                      style={{
                        color: 'var(--text-inv)',
                        fontSize: '.95rem',
                        display: 'block',
                      }}
                    >
                      {x.title}
                    </b>
                    <span
                      style={{
                        color: 'var(--text-inv-2)',
                        fontSize: '.84rem',
                      }}
                    >
                      {x.sub}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
