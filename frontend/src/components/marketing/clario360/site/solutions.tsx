'use client';

import Link from 'next/link';
import { Breadcrumb, CtaBand } from './shared';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';

/* ============================================================
   PAGE: Solutions — reworked as a MARKETING channel.
   Benefits UP TOP: leads with customer problems / outcomes and
   the value each buyer GETS, framed around the four suites
   (DataStream · Business+/WatheeqTech · ClarioSec · ClarioInsight).
   Technical depth (platform-vs-point-tools comparison + an
   evaluator path to /platform) sits LOWER, for due diligence.

   New marketing copy lives in the INLINE bilingual `COPY` const
   below (both EN + AR); shared/reused prose (breadcrumb, role
   titles, comparison table) still comes from `m.solutions`.
   ============================================================ */

/* Outcome-card icons — text comes from COPY[locale].outcomes.cards,
   indexed positionally (mirrors the reused-copy pattern). */
const OUTCOME_ICONS = ['recover', 'scale', 'shield', 'trend'] as const;

/* Compliance labels are rendered identically in both locales
   (proper nouns / framework acronyms), like the home strip. */
const FRAMEWORKS = ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'] as const;

const COPY = {
  en: {
    hero: {
      eyebrow: 'Solutions',
      title: 'One platform for the outcomes that matter most',
      lede: 'Whatever you need to protect, prove, or accelerate, Clario360 gives you a sovereign, Arabic-first way to get there — without stitching a dozen tools together.',
      talkToSales: 'Talk to sales',
      deployTag: 'Deploy as SaaS, on-premise, or fully air-gapped — hosted in-Kingdom.',
    },
    outcomes: {
      eyebrow: 'By outcome',
      title: 'Start with the outcome you need',
      lede: 'Most teams begin with one urgent problem. Here is where each one starts — and everything connects as you grow.',
      cards: [
        {
          suite: 'DataStream',
          problem: 'Stay running through any outage',
          outcome:
            'Recover critical systems in minutes, not days, and move data between clouds and data centres on your terms.',
          points: [
            'Recover in minutes with tested, audit-grade drills',
            'Move workloads without cloud lock-in',
            'Keep every copy of your data in-Kingdom',
          ],
        },
        {
          suite: 'Business+ · WatheeqTech',
          problem: 'Close contracts faster and stay compliant',
          outcome:
            'Author, negotiate and approve contracts Arabic-first, with governance and audit built into every step.',
          points: [
            'Arabic-native contract lifecycle',
            'Approvals and delegations without the paper chase',
            'A live compliance posture, not a quarterly scramble',
          ],
        },
        {
          suite: 'ClarioSec',
          problem: 'See and stop threats early',
          outcome:
            'Run a complete security programme — exposure, data security and behaviour — from one sovereign console.',
          points: [
            'Continuous threat detection and exposure reduction',
            'Data-security posture and behavioural analytics',
            'A board-ready virtual-CISO programme',
          ],
        },
        {
          suite: 'ClarioInsight',
          problem: 'Turn data into decisions',
          outcome:
            'Bring governed data together and put trustworthy dashboards and KPIs in front of every team.',
          points: [
            'One sovereign home for your data',
            'Live dashboards and KPIs teams can trust',
            'Every figure traceable to governed data',
          ],
        },
      ],
    },
    roles: {
      eyebrow: 'By team',
      title: 'Wherever your team starts',
      lede: 'Every function has a natural entry point — and gains from the suites already in place.',
    },
    trust: {
      eyebrow: 'Trust & sovereignty',
      title: 'Reassurance built in, not bolted on',
      lede: 'Clario360 is sovereign and Arabic-first by design. Evidence you collect once satisfies the Kingdom’s frameworks at the same time — so an audit becomes a report, not a project.',
      frameworksLabel: 'Mapped to the frameworks you answer to',
    },
    evaluator: {
      eyebrow: 'For evaluators',
      title: 'Doing technical due diligence?',
      body: 'See exactly how the suites share one sovereign foundation, one identity model and one audit trail — and how Clario360 deploys into your environment.',
      cta: 'Explore the platform',
    },
  },
  ar: {
    hero: {
      eyebrow: 'الحلول',
      title: 'منصّة واحدة للنتائج الأكثر أهمية',
      lede: 'مهما كان ما تحتاج إلى حمايته أو إثباته أو تسريعه، تمنحك Clario360 طريقاً سيادياً يعتمد العربية أولاً للوصول إليه — دون خياطة عشرات الأدوات معاً.',
      talkToSales: 'تحدّث إلى المبيعات',
      deployTag: 'انشرها كخدمة سحابية، أو داخل مقرّك، أو معزولة تماماً — مُستضافة داخل المملكة.',
    },
    outcomes: {
      eyebrow: 'حسب النتيجة',
      title: 'ابدأ بالنتيجة التي تحتاجها',
      lede: 'تبدأ معظم الفرق بمشكلة عاجلة واحدة. هنا يبدأ كلٌّ منها — ويتّصل كل شيء مع نموّك.',
      cards: [
        {
          suite: 'DataStream',
          problem: 'استمرّ في العمل خلال أيّ انقطاع',
          outcome:
            'استعِد الأنظمة الحيوية في دقائق لا أيام، وانقل بياناتك بين السُّحُب ومراكز البيانات وفق شروطك.',
          points: [
            'استعادة في دقائق عبر تجارب موثّقة بجودة تدقيقية',
            'نقل أحمال العمل دون احتكار سحابي',
            'إبقاء كل نسخة من بياناتك داخل المملكة',
          ],
        },
        {
          suite: 'Business+ · WatheeqTech',
          problem: 'أنجز العقود أسرع وابقَ ممتثلاً',
          outcome:
            'صُغ العقود وتفاوض واعتمدها بالعربية أولاً، مع الحوكمة والتدقيق مدمجَين في كل خطوة.',
          points: [
            'دورة حياة عقود بالعربية أصالةً',
            'اعتمادات وتفويضات دون مطاردة أوراق',
            'وضع امتثال حيّ لا هرولة فصلية',
          ],
        },
        {
          suite: 'ClarioSec',
          problem: 'اكشف التهديدات وأوقفها مبكراً',
          outcome:
            'أدِر برنامجاً أمنياً متكاملاً — التعرّض وأمن البيانات والسلوك — من وحدة تحكّم سيادية واحدة.',
          points: [
            'كشف مستمرّ للتهديدات وخفض للتعرّض',
            'وضع أمن للبيانات وتحليلات سلوكية',
            'برنامج مدير أمن معلومات افتراضي جاهز للمجلس',
          ],
        },
        {
          suite: 'ClarioInsight',
          problem: 'حوّل البيانات إلى قرارات',
          outcome:
            'اجمع بياناتك المحوكمة معاً، وضع لوحات ومؤشرات موثوقة أمام كل فريق.',
          points: [
            'موطن سيادي واحد لبياناتك',
            'لوحات ومؤشرات أداء حيّة يثق بها الجميع',
            'كل رقم قابل للتتبّع إلى بيانات محوكمة',
          ],
        },
      ],
    },
    roles: {
      eyebrow: 'حسب الفريق',
      title: 'أينما يبدأ فريقك',
      lede: 'لكل وظيفة نقطة انطلاق طبيعية — وتستفيد من المجموعات القائمة بالفعل.',
    },
    trust: {
      eyebrow: 'الثقة والسيادة',
      title: 'طمأنينة مبنيّة في الأساس، لا مُضافة لاحقاً',
      lede: 'Clario360 سيادية وتعتمد العربية أولاً بالتصميم. الدليل الذي تجمعه مرة واحدة يستوفي أطر المملكة في الوقت ذاته — فيصبح التدقيق تقريراً لا مشروعاً.',
      frameworksLabel: 'مُطابَقة للأطر التي تخضع لها',
    },
    evaluator: {
      eyebrow: 'لفريق التقييم',
      title: 'تُجري عناية تقنية واجبة؟',
      body: 'اطّلع على كيفية تشارك المجموعات أساساً سيادياً واحداً، ونموذج هوية واحداً، وسجلّ تدقيق واحداً — وكيف تُنشر Clario360 داخل بيئتك.',
      cta: 'استكشف المنصّة',
    },
  },
} as const;

export function SolutionsSite() {
  const { locale, messages: m } = useMarketingLocale();
  const s = m.solutions;
  const c = COPY[locale];

  return (
    <>
      {/* ---------- Hero: outcome-led, strong CTAs, sovereign deploy tag ---------- */}
      <header className="page-hero">
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <Breadcrumb
            trail={[
              { label: m.chrome.breadcrumbHome, href: '/' },
              { label: s.breadcrumb },
            ]}
          />
          <div className="eyebrow">{c.hero.eyebrow}</div>
          <h1>{c.hero.title}</h1>
          <p className="lede">{c.hero.lede}</p>
          <div className="hero-actions">
            <Link className="btn btn-gold btn-lg" href="/contact">
              {m.chrome.cta.requestDemo} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark btn-lg" href="/contact">
              {c.hero.talkToSales}
            </Link>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              color: 'var(--text-inv-2)',
              fontSize: '.9rem',
            }}
          >
            <MarketingIcon name="globe" />
            <span>{c.hero.deployTag}</span>
          </div>
        </div>
      </header>

      {/* ---------- By outcome: the core value proposition ---------- */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {c.outcomes.eyebrow}
            </div>
            <h2>{c.outcomes.title}</h2>
            <p className="lede">{c.outcomes.lede}</p>
          </div>
          <div className="persona-grid">
            {c.outcomes.cards.map((card, i) => (
              <div className="persona" key={card.suite}>
                <div className="pi">
                  <MarketingIcon name={OUTCOME_ICONS[i] ?? 'shield'} />
                </div>
                <div
                  className="eyebrow"
                  style={{ marginBottom: 0, fontSize: '.7rem' }}
                >
                  {card.suite}
                </div>
                <h4>{card.problem}</h4>
                <p>{card.outcome}</p>
                <div className="uses">
                  {card.points.map((pt) => (
                    <div key={pt}>
                      <MarketingIcon name="check" />
                      <span>{pt}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- By team: reuse the good role titles from m.solutions ---------- */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {c.roles.eyebrow}
            </div>
            <h2>{c.roles.title}</h2>
            <p className="lede">{c.roles.lede}</p>
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '12px',
              maxWidth: '820px',
              marginInline: 'auto',
            }}
          >
            {s.personas.map((p) => (
              <span
                key={p.title}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '9px',
                  padding: '11px 18px',
                  borderRadius: '999px',
                  border: '1px solid var(--line)',
                  background: 'var(--card)',
                  color: 'var(--text)',
                  fontSize: '.9rem',
                  fontWeight: 600,
                }}
              >
                <MarketingIcon
                  name="check"
                  className="h-4 w-4"
                />
                {p.title}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Trust & sovereignty: compliance framed as reassurance ---------- */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {c.trust.eyebrow}
            </div>
            <h2>{c.trust.title}</h2>
            <p className="lede">{c.trust.lede}</p>
          </div>
          <p
            className="center"
            style={{
              textAlign: 'center',
              color: 'var(--text-3)',
              fontSize: '.8rem',
              fontWeight: 600,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              marginBottom: '18px',
            }}
          >
            {c.trust.frameworksLabel}
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '12px',
            }}
          >
            {FRAMEWORKS.map((f) => (
              <span
                key={f}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '9px',
                  padding: '11px 18px',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  background: 'var(--card)',
                  color: 'var(--text)',
                  fontSize: '.9rem',
                  fontWeight: 700,
                }}
              >
                <span
                  style={{ color: 'var(--navy-600)', display: 'inline-flex' }}
                >
                  <MarketingIcon name="license" className="h-4 w-4" />
                </span>
                {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Why one platform: kept LOWER, for the comparison-minded ---------- */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head center">
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {s.compare.eyebrow}
            </div>
            <h2>{s.compare.title}</h2>
          </div>
          <div className="cmp">
            <div className="cmp-row head">
              <div>{s.compare.head.capability}</div>
              <div className="c-clario">{s.compare.head.clario}</div>
              <div className="c-other">{s.compare.head.other}</div>
            </div>
            {s.compare.rows.map((r) => (
              <div className="cmp-row" key={r[0]}>
                <div className="c-label">{r[0]}</div>
                <div className="c-clario">
                  <MarketingIcon name="check" className="yes" />
                  <span>{r[1]}</span>
                </div>
                <div className="c-other">
                  <MarketingIcon name="x" className="no" />
                  <span>{r[2]}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- For evaluators: the technical-depth path to /platform ---------- */}
      <section className="section">
        <div className="wrap">
          <div
            className="sec-head center"
            style={{ marginBottom: '26px' }}
          >
            <div className="eyebrow" style={{ justifyContent: 'center' }}>
              {c.evaluator.eyebrow}
            </div>
            <h2>{c.evaluator.title}</h2>
            <p className="lede">{c.evaluator.body}</p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <Link className="btn btn-ghost btn-lg" href="/platform">
              {c.evaluator.cta} <MarketingIcon name="arrow" />
            </Link>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
