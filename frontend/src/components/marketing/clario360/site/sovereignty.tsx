'use client';

import Link from 'next/link';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';
import { CtaBand } from './shared';

/* ============================================================
   Sovereignty & security page — reworked as a MARKETING channel.
   Leads with the assurance/trust BENEFIT (pass your audit, data
   stays in-Kingdom, deploy anywhere) and strong, repeated CTAs.
   Genuine technical depth is moved into a clearly-lower
   "for your security & compliance team" evaluator section.

   Existing prose comes from `m.sovereignty`; NEW marketing copy
   lives in the inline bilingual COPY const below (picked by
   locale). Styled by clario-site.css inside the .clario-site
   wrapper (dir/lang are set by the shell).
   ============================================================ */

/* Positional icon lists — copy lives in messages/COPY, icons here. */
const DEPLOY_CLASS = ['saas', 'onprem', 'airgap'];
const FRAMEWORK_ICONS = ['shield', 'building', 'lock', 'checkCircle', 'network', 'gavel'];
const OUTCOME_ICONS = ['checkCircle', 'shield', 'server'];
const SECURITY_ICONS = ['key', 'layers', 'lock', 'shield'];

/* Kingdom frameworks shown as a hero trust strip — brand/framework
   acronyms, identical across locales, so kept as a shared list. */
const TRUST_CHIPS = ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'];

/* Inline bilingual marketing copy — NEW strings only. Existing
   good prose is still read from `m.sovereignty`. Both languages
   are provided for every new string. */
const COPY = {
  en: {
    ctaDemo: 'Request a demo',
    ctaSales: 'Talk to sales',
    trustLabel: 'Mapped to the Kingdom’s frameworks',
    outcomes: {
      eyebrow: 'What you get',
      title: 'Sovereignty you can hand to your auditor',
      lede: 'Assurance you can prove — your data in-Kingdom, your regulators satisfied, and your platform running entirely on your terms.',
      cards: [
        {
          title: 'Pass your audit with evidence, not promises',
          desc: 'Controls for NCA, SAMA, PDPL and more come pre-mapped. Collect evidence once and satisfy every framework at the same time.',
        },
        {
          title: 'Your data never leaves the Kingdom',
          desc: 'Data residency is guaranteed by how the platform is built — hosted in-Kingdom, not by a policy you simply have to trust.',
        },
        {
          title: 'Deploy anywhere, with no lock-in',
          desc: 'Run it as managed SaaS, inside your own data centre, or fully air-gapped — the same product, with nothing tying you to a public cloud.',
        },
      ],
    },
    deploy: {
      eyebrow: 'Deploy your way',
      title: 'SaaS, on-premise, or fully air-gapped',
      lede: 'The same platform runs as managed SaaS, inside your data centre, or in a completely disconnected environment — with no drop in capability between them.',
    },
    security: {
      eyebrow: 'For your security & compliance team',
      lede: 'The detail your evaluators need — how identity, isolation, audit and encryption are built into the platform, not bolted on.',
    },
  },
  ar: {
    ctaDemo: 'اطلبوا عرضاً توضيحياً',
    ctaSales: 'تحدّثوا إلى فريق المبيعات',
    trustLabel: 'مُطابَقة لأطر المملكة',
    outcomes: {
      eyebrow: 'ما الذي تحصلون عليه',
      title: 'سيادةٌ يمكنكم تسليمها لمدقّقكم',
      lede: 'ضمانٌ يمكنكم إثباته — بياناتكم داخل المملكة، وجهاتكم التنظيمية راضية، ومنصّتكم تعمل بالكامل وفق شروطكم.',
      cards: [
        {
          title: 'اجتازوا التدقيق بالدليل، لا بالوعود',
          desc: 'ضوابط NCA وSAMA وPDPL وغيرها مُطابَقة مسبقاً. اجمعوا الدليل مرّةً واحدة ليستوفي كل الأطر في الوقت ذاته.',
        },
        {
          title: 'بياناتكم لا تغادر المملكة أبداً',
          desc: 'إقامة البيانات مضمونة بحكم بناء المنصّة — مستضافة داخل المملكة، لا بسياسةٍ عليكم أن تثقوا بها فحسب.',
        },
        {
          title: 'انشروا في أيّ مكان، دون احتكار',
          desc: 'شغّلوها كخدمة سحابية مُدارة، أو داخل مركز بياناتكم، أو معزولةً تماماً — المنتج نفسه، دون أيّ ارتباطٍ بسحابة عامة.',
        },
      ],
    },
    deploy: {
      eyebrow: 'انشروا بطريقتكم',
      title: 'خدمة سحابية، أو داخل المقرّ، أو معزولة تماماً',
      lede: 'تعمل المنصّة نفسها كخدمة سحابية مُدارة، أو داخل مركز بياناتكم، أو في بيئة معزولة تماماً — دون أيّ تراجع في القدرات بينها.',
    },
    security: {
      eyebrow: 'لفريق الأمن والامتثال لديكم',
      lede: 'التفاصيل التي يحتاجها مقيّموكم — كيف بُنِيت الهوية والعزل والتدقيق والتشفير في صميم المنصّة، لا مُضافةً إليها.',
    },
  },
} as const;

/* deployGrid() — HTML 1915-1949 */
function DeployGrid({
  cards,
}: {
  cards: {
    tag: string;
    name: string;
    body: string;
    points: string[];
  }[];
}) {
  return (
    <div className="deploy-grid">
      {cards.map((card, i) => (
        <div className={`deploy ${DEPLOY_CLASS[i]}`} key={card.name}>
          <span className="dtag">{card.tag}</span>
          <h4>{card.name}</h4>
          <p>{card.body}</p>
          <ul>
            {card.points.map((point) => (
              <li key={point}>
                <MarketingIcon name="check" /> {point}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function SovereigntySite() {
  const { locale, messages: m } = useMarketingLocale();
  const s = m.sovereignty;
  const t = COPY[locale];

  return (
    <>
      {/* page-hero (dark) — assurance benefit + CTAs + trust strip */}
      <header className="page-hero">
        <div className="grid-overlay" />
        <div className="wrap page-hero-inner">
          <HeroSessionBadge />
          <div className="breadcrumb">
            <Link href="/">{m.chrome.breadcrumbHome}</Link>{' '}
            <MarketingIcon name="chev" /> <span>{s.breadcrumb}</span>
          </div>
          <div className="eyebrow">{s.hero.eyebrow}</div>
          <h1>{s.hero.title}</h1>
          <p className="lede">{s.hero.lede}</p>

          <div className="hero-actions" style={{ marginTop: '28px' }}>
            <Link className="btn btn-gold btn-lg" href="/contact">
              {t.ctaDemo} <MarketingIcon name="arrow" />
            </Link>
            <Link className="btn btn-ondark btn-lg" href="/contact">
              {t.ctaSales}
            </Link>
          </div>

          <div style={{ marginTop: '4px' }}>
            <div
              className="eyebrow"
              style={{ color: 'var(--gold-400)', marginBottom: '12px' }}
            >
              {t.trustLabel}
            </div>
            <div className="footer-badges">
              {TRUST_CHIPS.map((chip) => (
                <span
                  className="fbadge"
                  key={chip}
                  style={{
                    borderColor: 'var(--gold-500)',
                    color: 'var(--gold-400)',
                  }}
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Outcomes — what sovereignty gets the buyer (benefits up top) */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{t.outcomes.eyebrow}</div>
            <h2>{t.outcomes.title}</h2>
            <p className="lede">{t.outcomes.lede}</p>
          </div>
          <div className="principles">
            {t.outcomes.cards.map((c, i) => (
              <div className="principle" key={c.title}>
                <div className="pic">
                  <MarketingIcon name={OUTCOME_ICONS[i]} />
                </div>
                <h4>{c.title}</h4>
                <p>{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance — frameworks mapped (proof / reassurance) */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{s.compliance.eyebrow}</div>
            <h2>{s.compliance.title}</h2>
            <p className="lede">{s.compliance.lede}</p>
          </div>
          <div className="principles">
            {s.compliance.frameworks.map((f, i) => (
              <div className="principle" key={f.title}>
                <div className="pic">
                  <MarketingIcon name={FRAMEWORK_ICONS[i]} />
                </div>
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Deployment — flexibility benefit (de-jargoned header) */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div className="eyebrow">{t.deploy.eyebrow}</div>
            <h2>{t.deploy.title}</h2>
            <p className="lede">{t.deploy.lede}</p>
          </div>
          <DeployGrid cards={s.deploy.cards} />
        </div>
      </section>

      {/* Security architecture — technical depth, for evaluators (lower) */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap split">
          <div>
            <div className="eyebrow">{t.security.eyebrow}</div>
            <h2 style={{ marginBottom: '12px' }}>{s.security.title}</h2>
            <p
              className="lede"
              style={{ marginBottom: '22px', fontSize: '1rem' }}
            >
              {t.security.lede}
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              {s.security.items.map((x, i) => (
                <div key={x.title} style={{ display: 'flex', gap: '15px' }}>
                  <div
                    style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '12px',
                      background: 'var(--navy-50)',
                      display: 'grid',
                      placeItems: 'center',
                      color: 'var(--navy-600)',
                      flex: 'none',
                    }}
                  >
                    <MarketingIcon name={SECURITY_ICONS[i]} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.05rem', margin: '0 0 4px' }}>
                      {x.title}
                    </h4>
                    <p
                      style={{
                        margin: 0,
                        fontSize: '.92rem',
                        color: 'var(--text-2)',
                      }}
                    >
                      {x.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div
            className="deploy airgap"
            style={{
              alignSelf: 'stretch',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <span className="dtag">{s.security.guarantee.tag}</span>
            <h3 style={{ color: '#fff', marginBottom: '16px' }}>
              {s.security.guarantee.title}
            </h3>
            <p style={{ color: 'var(--text-inv-2)' }}>
              {s.security.guarantee.body}
            </p>
            <div className="footer-badges" style={{ marginTop: '20px' }}>
              {s.security.guarantee.badges.map((badge) => (
                <span
                  className="fbadge"
                  key={badge}
                  style={{
                    borderColor: 'var(--gold-500)',
                    color: 'var(--gold-400)',
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <CtaBand title={s.cta.title} sub={s.cta.sub} />
    </>
  );
}
