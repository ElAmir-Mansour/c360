'use client';

import { useMarketingLocale } from '../marketing-locale';
import { HeroSessionBadge } from './hero-session-badge';
import { Breadcrumb, SectionHead } from './shared';
import { LeadForm } from './widgets';
import { MarketingIcon } from '../marketing-icons';
import type { MarketingIconName } from '../marketing-icons';

/* ============================================================
   PAGE: CONTACT (/contact) — conversion-focused rework.

   Direction: lead with what the buyer GETS from booking a
   session (outcomes), reassure with compliance + deployment
   proof, and keep the low-friction demo form prominent. The
   original reason-cards (m.contact.info) are retained as a
   de-emphasised "other ways to reach us" block. Hero, form and
   the Arabic callout keep their existing localised copy; all
   NEW marketing copy is inlined below (EN + AR) per the
   no-edit-to-messages.ts rule.
   ============================================================ */

/* Icons are structural — indexed positionally against m.contact.info. */
const CONTACT_ICONS = ['mail', 'shield', 'handshake', 'globe'] as const;

/* Icons for the outcome cards (indexed positionally against COPY.value). */
const VALUE_ICONS: MarketingIconName[] = ['target', 'shield', 'recover', 'server'];

/* ---- NEW inline bilingual copy (do NOT move to messages.ts) ---- */
const COPY = {
  en: {
    trustLabel: 'Trusted for regulated environments in the Kingdom',
    trustChips: ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'],
    deployLabel: 'Deploy your way',
    deployChips: ['Managed SaaS · in-Kingdom', 'On-premise', 'Air-gapped'],
    valueEyebrow: 'Why book a session',
    valueTitle: 'A demo scoped to your institution — not a generic tour',
    valueLede:
      'Tell us what matters and we build the walkthrough around it. Here is what you walk away with.',
    valueItems: [
      {
        title: 'Mapped to your suites',
        body: 'A guided walkthrough of the suites and workflows that matter to your teams — legal, security, resilience or analytics.',
      },
      {
        title: 'Answers for your auditors',
        body: 'Straight answers on NCA, SAMA, PDPL and data residency, mapped to the controls your teams already report against.',
      },
      {
        title: 'Recovery you can see',
        body: 'Watch critical systems come back in minutes with DataStream, and your day-to-day workflows run Arabic-first.',
      },
      {
        title: 'A clear path to go live',
        body: 'Leave with a deployment plan and indicative pricing — managed SaaS in-Kingdom, on your own infrastructure, or fully air-gapped.',
      },
    ],
    nextTitle: 'What happens next',
    nextSteps: [
      {
        title: 'We reply within one business day',
        body: 'A specialist from our solutions team reaches out to understand your priorities.',
      },
      {
        title: 'A session built around you',
        body: 'We tailor the walkthrough to your suites, frameworks and deployment model.',
      },
      {
        title: 'A scoped proposal',
        body: 'You get a clear plan and pricing shaped to your institution — no obligation.',
      },
    ],
    otherTitle: 'Other ways to reach us',
  },
  ar: {
    trustLabel: 'موثوقة للبيئات المنظَّمة داخل المملكة',
    trustChips: ['NCA', 'SAMA', 'PDPL', 'ZATCA', 'ISO 27001', 'Najiz'],
    deployLabel: 'انشرها بطريقتك',
    deployChips: ['سحابة مُدارة · داخل المملكة', 'داخل المقارّ', 'معزولة بالكامل'],
    valueEyebrow: 'لماذا تحجزون جلسة',
    valueTitle: 'عرض محدَّد النطاق لمؤسستكم — لا جولة عامة',
    valueLede:
      'أخبرونا بما يهمّكم ونبني الجولة حوله. وإليكم ما ستخرجون به.',
    valueItems: [
      {
        title: 'مربوطة بمجموعاتكم',
        body: 'جولة موجَّهة للمجموعات ومسارات العمل التي تهمّ فرقكم — القانونية أو الأمنية أو المرونة أو التحليلات.',
      },
      {
        title: 'إجابات لمدقّقيكم',
        body: 'إجابات واضحة حول NCA وSAMA وPDPL وإقامة البيانات، مربوطة بالضوابط التي ترفع فرقكم تقاريرها وفقها بالفعل.',
      },
      {
        title: 'تعافٍ ترونه بأعينكم',
        body: 'شاهدوا الأنظمة الحرجة تعود خلال دقائق مع DataStream، ومسارات عملكم اليومية تعمل بالعربية أولاً.',
      },
      {
        title: 'مسار واضح للانطلاق',
        body: 'اخرجوا بخطة نشر وتسعير استرشادي — سحابة مُدارة داخل المملكة، أو على بنيتكم التحتية، أو معزولة بالكامل.',
      },
    ],
    nextTitle: 'ماذا يحدث بعد ذلك',
    nextSteps: [
      {
        title: 'نردّ خلال يوم عمل واحد',
        body: 'يتواصل معكم مختصّ من فريق الحلول لفهم أولوياتكم.',
      },
      {
        title: 'جلسة مصمَّمة حولكم',
        body: 'نُصمِّم الجولة وفق مجموعاتكم وأطركم ونموذج نشركم.',
      },
      {
        title: 'عرض محدَّد النطاق',
        body: 'تحصلون على خطة وتسعير واضحين مصمَّمين لمؤسستكم — دون أي التزام.',
      },
    ],
    otherTitle: 'طرق أخرى للتواصل معنا',
  },
} as const;

/* Small pill used in the hero trust/deployment strips. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '6px 13px',
        borderRadius: '999px',
        border: '1px solid var(--line-2)',
        background: 'var(--paper-2)',
        color: 'var(--text-2)',
        fontSize: '.78rem',
        letterSpacing: '.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function ContactSite() {
  const { locale, messages: m } = useMarketingLocale();
  const c = m.contact;
  const t = COPY[locale];

  // The callout flourish shows the OPPOSITE script to the active locale (an
  // Arabic accent while reading English, a Latin accent while reading Arabic) —
  // the message map already carries the opposite-script string per locale.
  const flourishIsArabic = locale === 'en';

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

          {/* Trust strip — compliance reassurance, high and scannable. */}
          <div style={{ marginTop: '26px' }}>
            <div
              className="eyebrow"
              style={{ marginBottom: '12px', opacity: 0.9 }}
            >
              {t.trustLabel}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px' }}>
              {t.trustChips.map((chip) => (
                <Chip key={chip}>{chip}</Chip>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '9px',
                alignItems: 'center',
                marginTop: '14px',
              }}
            >
              <span
                style={{
                  fontSize: '.82rem',
                  color: 'var(--text-3)',
                  marginInlineEnd: '2px',
                }}
              >
                {t.deployLabel}:
              </span>
              {t.deployChips.map((chip) => (
                <Chip key={chip}>{chip}</Chip>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* OUTCOMES — what the buyer gets, up top. */}
      <section className="section" style={{ background: 'var(--paper-2)' }}>
        <div className="wrap">
          <SectionHead
            eyebrow={t.valueEyebrow}
            title={t.valueTitle}
            lede={t.valueLede}
          />
          <div className="modules">
            {t.valueItems.map((item, i) => (
              <div className="module fade-up" key={item.title}>
                <div className="mi" aria-hidden="true">
                  <MarketingIcon name={VALUE_ICONS[i] ?? 'check'} />
                </div>
                <div>
                  <h5>{item.title}</h5>
                  <p>{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FORM + reassurance. The form stays the primary CTA. */}
      <section className="section">
        <div className="wrap">
          <div className="contact-grid">
            <div className="contact-info">
              {/* What happens next — lowers friction before the form. */}
              <h3 style={{ margin: '0 0 18px' }}>{t.nextTitle}</h3>
              <div style={{ display: 'grid', gap: '18px', marginBottom: '34px' }}>
                {t.nextSteps.map((step, i) => (
                  <div
                    key={step.title}
                    style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}
                  >
                    <div
                      aria-hidden="true"
                      style={{
                        flex: '0 0 auto',
                        width: '30px',
                        height: '30px',
                        borderRadius: '999px',
                        display: 'grid',
                        placeItems: 'center',
                        background: 'var(--navy-700)',
                        color: 'var(--text-inv)',
                        fontSize: '.85rem',
                        fontWeight: 700,
                        fontFamily: 'var(--display)',
                      }}
                    >
                      {locale === 'ar'
                        ? ['١', '٢', '٣'][i] ?? String(i + 1)
                        : String(i + 1)}
                    </div>
                    <div>
                      <div
                        style={{
                          fontFamily: 'var(--sans)',
                          fontWeight: 700,
                          fontSize: '.94rem',
                          color: 'var(--text)',
                          marginBottom: '3px',
                        }}
                      >
                        {step.title}
                      </div>
                      <p style={{ margin: 0, fontSize: '.9rem', color: 'var(--text-2)' }}>
                        {step.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Arabic-first reassurance (existing localised copy). */}
              <div
                style={{
                  background: 'var(--navy-50)',
                  border: '1px solid var(--navy-100)',
                  borderRadius: 'var(--r)',
                  padding: '22px',
                  marginBottom: '34px',
                }}
              >
                <div
                  className={flourishIsArabic ? 'bilingual' : undefined}
                  dir={flourishIsArabic ? 'rtl' : 'ltr'}
                  lang={flourishIsArabic ? 'ar' : 'en'}
                  style={{
                    fontFamily: flourishIsArabic ? 'var(--arabic)' : 'var(--display)',
                    color: 'var(--navy-700)',
                    fontSize: '1.05rem',
                    marginBottom: '6px',
                  }}
                >
                  {c.arabicCallout.flourish}
                </div>
                <p style={{ margin: 0, fontSize: '.9rem', color: 'var(--text-2)' }}>
                  {c.arabicCallout.body}
                </p>
              </div>

              {/* Secondary: other ways to reach us (existing reason cards). */}
              <h3 style={{ margin: '0 0 18px' }}>{t.otherTitle}</h3>
              {c.info.map((item, i) => (
                <div className="ci-item" key={item.title}>
                  <div className="cii">
                    <MarketingIcon name={CONTACT_ICONS[i] ?? 'mail'} />
                  </div>
                  <div>
                    <h5>{item.title}</h5>
                    <p>{item.copy}</p>
                  </div>
                </div>
              ))}
            </div>
            <LeadForm />
          </div>
        </div>
      </section>
    </>
  );
}
