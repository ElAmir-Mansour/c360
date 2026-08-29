'use client';

/**
 * Interactive marketing widgets — ported verbatim from clario360-website (2).html.
 *
 * RoiCalculator   -> roiCalculator()/roiCompute()/fmtMoney()/updateRoi() (HTML 1456-1524)
 * SuiteConfigurator -> suiteConfigurator()/toggleCfg/setCfgDeploy/renderCfg() (HTML 1525-1588)
 * FaqAccordion    -> faqBlock() + toggleFaq() (HTML 2345-2357, 2889-2897)
 * LeadForm        -> pageContact form + submitForm() (HTML 2417-2476, 2898+)
 * ScrollReveal    -> observeFade() (HTML 2814-2826)
 *
 * Presentation classes are the HTML's exact class names; they resolve inside the
 * .clario-site wrapper styled by clario-site.css.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  MARKETING_BRAND_TOKENS,
  MARKETING_SUITES,
  createLeadSubmissionFromFormData,
  formatMarketingMoney,
  roiCompute,
} from '@/lib/marketing';
import type { MarketingLocale } from '@/lib/marketing/messages';
import { MarketingIcon } from '../marketing-icons';
import { useMarketingLocale } from '../marketing-locale';

/* Localise a Western integer to Arabic-Indic numerals for `ar` (kept local so
   these widgets don't import the home-sections module and form a cycle). */
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;
function locNum(n: number, locale: MarketingLocale): string {
  const s = String(n);
  return locale === 'ar' ? s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]) : s;
}

/* ============================================================
   ROI CALCULATOR
   ============================================================ */

const ROI_LABELS = {
  en: {
    tools: "Point tools you'd otherwise license",
    users: 'Internal users (hundreds)',
    integrations: 'Cross-tool integrations to maintain',
    stackLabel: 'Estimated point-tool stack',
    stackSub: 'licences + integration upkeep, per year',
    platformLabel: 'Clario360 platform',
    platformSub: 'four suites on one core, per year',
    diffLabel: 'Indicative annual difference',
    diffSub: 'redirected from duplication to outcomes',
    note: 'Illustrative model for comparison only — not a quote. It assumes a per-tool licence baseline, per-user scaling, and ongoing integration maintenance that a unified platform removes. We’ll build a costed model for your environment on request.',
  },
  ar: {
    tools: 'أدوات نقطية كنتم ستُرخِّصونها بدلاً من ذلك',
    users: 'المستخدمون الداخليون (بالمئات)',
    integrations: 'تكاملات بينية بين الأدوات تتطلّب صيانة',
    stackLabel: 'التكلفة التقديرية لحزمة الأدوات النقطية',
    stackSub: 'التراخيص وصيانة التكامل، سنوياً',
    platformLabel: 'منصّة Clario360',
    platformSub: 'أربع مجموعات على نواة واحدة، سنوياً',
    diffLabel: 'الفرق السنوي الإرشادي',
    diffSub: 'مُعاد توجيهه من الازدواجية إلى النتائج',
    note: 'نموذج توضيحي للمقارنة فقط — وليس عرض سعر. يفترض النموذج تكلفة ترخيص أساسية لكل أداة، وتوسّعاً بحسب عدد المستخدمين، وصيانة تكامل مستمرة تُلغيها المنصّة الموحّدة. سنُعِدّ لكم نموذج تكلفة مُفصّلاً لبيئتكم عند الطلب.',
  },
} as const;

export function RoiCalculator() {
  const { locale } = useMarketingLocale();
  const [tools, setTools] = useState(6);
  const [users, setUsers] = useState(10);
  const [integrations, setIntegrations] = useState(12);

  const r = roiCompute(tools, users, integrations);
  const t = ROI_LABELS[locale];
  // Locale-aware integer formatting → Arabic-Indic numerals in RTL.
  const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-US');

  return (
    <div className="calc" id="roi-calc">
      <div className="calc-controls">
        <div className="calc-field">
          <label htmlFor="roi-tools">{t.tools}</label>
          <div className="calc-range">
            <input
              type="range"
              id="roi-tools"
              min="2"
              max="12"
              value={tools}
              onChange={(e) => setTools(+e.target.value)}
              aria-describedby="roi-tools-val"
            />
            <output id="roi-tools-val">{num(tools)}</output>
          </div>
        </div>
        <div className="calc-field">
          <label htmlFor="roi-users">{t.users}</label>
          <div className="calc-range">
            <input
              type="range"
              id="roi-users"
              min="1"
              max="50"
              value={users}
              onChange={(e) => setUsers(+e.target.value)}
              aria-describedby="roi-users-val"
            />
            <output id="roi-users-val">{num(users * 100)}</output>
          </div>
        </div>
        <div className="calc-field">
          <label htmlFor="roi-integrations">{t.integrations}</label>
          <div className="calc-range">
            <input
              type="range"
              id="roi-integrations"
              min="0"
              max="40"
              value={integrations}
              onChange={(e) => setIntegrations(+e.target.value)}
              aria-describedby="roi-int-val"
            />
            <output id="roi-int-val">{num(integrations)}</output>
          </div>
        </div>
      </div>
      <div className="calc-results" id="roi-results" aria-live="polite">
        <div className="calc-result">
          <span className="calc-result-label">{t.stackLabel}</span>
          <b id="roi-stack" dir="ltr">
            {formatMarketingMoney(r.stack, locale)}
          </b>
          <span className="calc-result-sub">{t.stackSub}</span>
        </div>
        <div className="calc-result featured">
          <span className="calc-result-label">{t.platformLabel}</span>
          <b id="roi-platform" dir="ltr">
            {formatMarketingMoney(r.platform, locale)}
          </b>
          <span className="calc-result-sub">{t.platformSub}</span>
        </div>
        <div className="calc-result accent">
          <span className="calc-result-label">{t.diffLabel}</span>
          <b id="roi-save" dir="ltr">
            {formatMarketingMoney(r.save, locale)}
          </b>
          <span className="calc-result-sub">{t.diffSub}</span>
        </div>
      </div>
      <p className="calc-note">{t.note}</p>
    </div>
  );
}

/* ============================================================
   SUITE CONFIGURATOR ("build your platform")
   ============================================================ */

// Brand display labels (kept as-is) + the message key for each localised
// sub-label. Suite ids match the DATA; `subKey` indexes m.pricing.configurator.cards.
const CFG_CARDS: {
  id: string;
  label: string;
  subKey: 'datastream' | 'business' | 'clariosec' | 'clarioinsight';
}[] = [
  { id: 'datastream', label: 'DataStream', subKey: 'datastream' },
  { id: 'business-plus', label: 'Business+', subKey: 'business' },
  { id: 'clariosec', label: 'ClarioSec', subKey: 'clariosec' },
  { id: 'clarioinsight', label: 'ClarioInsight', subKey: 'clarioinsight' },
];

type DeployModel = 'SaaS' | 'On-premise' | 'Air-gapped';

export function SuiteConfigurator() {
  const { locale, messages: m } = useMarketingLocale();
  const cfg = m.pricing.configurator;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deploy, setDeploy] = useState<DeployModel>('SaaS');

  const suiteById = useMemo(
    () =>
      new Map<string, (typeof MARKETING_SUITES)[number]>(
        MARKETING_SUITES.map((s) => [s.id, s] as const),
      ),
    [],
  );

  function toggleCfg(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sel = [...selected];
  const appCount = sel.reduce((n, id) => n + (suiteById.get(id)?.apps.length ?? 0), 0);
  // Suite names are brand identifiers — kept as-is in both locales.
  const namesLabel = sel.length
    ? sel
        .map((id) => CFG_CARDS.find((c) => c.id === id)?.label ?? id)
        .join(', ')
    : cfg.noSuites;

  let tierKey: 'none' | 'suite' | 'platform' | 'sovereign' = 'none';
  if (deploy === 'Air-gapped') tierKey = 'sovereign';
  else if (sel.length >= 3) tierKey = 'platform';
  else if (sel.length >= 1) tierKey = 'suite';
  const tierLabel = tierKey === 'none' ? cfg.tierNone : cfg.tierNames[tierKey];

  // Deploy values stay logical (state + aria-checked); labels are localised.
  const deployOpts: DeployModel[] = ['SaaS', 'On-premise', 'Air-gapped'];
  const deployLabel: Record<DeployModel, string> = {
    SaaS: cfg.deployOptions.saas,
    'On-premise': cfg.deployOptions.onprem,
    'Air-gapped': cfg.deployOptions.airgap,
  };

  return (
    <div className="cfg" id="suite-cfg">
      <div className="cfg-grid">
        {CFG_CARDS.map((c) => {
          const suite = suiteById.get(c.id);
          const family = suite?.family ?? 'ds';
          const grad =
            MARKETING_BRAND_TOKENS.suiteFamilies[
              family as keyof typeof MARKETING_BRAND_TOKENS.suiteFamilies
            ]?.gradient ?? '';
          const isSel = selected.has(c.id);
          return (
            <button
              key={c.id}
              className={`cfg-suite${isSel ? ' selected' : ''}`}
              data-suite={c.id}
              aria-pressed={isSel}
              onClick={() => toggleCfg(c.id)}
              type="button"
            >
              <span className="cfg-check" aria-hidden="true">
                <MarketingIcon name="check" />
              </span>
              <span className="cfg-ico" style={{ background: grad }} aria-hidden="true">
                <MarketingIcon name={suite?.apps[0]?.icon ?? 'cube'} />
              </span>
              <span className="cfg-name">{c.label}</span>
              <span className="cfg-sub">{cfg.cards[c.subKey]}</span>
              <span className="cfg-apps">
                {locNum(suite?.apps.length ?? 0, locale)} {cfg.appsWord}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cfg-summary" aria-live="polite">
        <div className="cfg-summary-row">
          <div>
            <span className="cfg-sum-label">{cfg.selectedLabel}</span>
            <b id="cfg-suites">{namesLabel}</b>
          </div>
          <div>
            <span className="cfg-sum-label">{cfg.applicationsLabel}</span>
            <b id="cfg-appcount">{locNum(appCount, locale)}</b>
          </div>
          <div>
            <span className="cfg-sum-label">{cfg.platformCoreLabel}</span>
            <b>{cfg.platformCoreValue}</b>
          </div>
          <div>
            <span className="cfg-sum-label">{cfg.suggestedTierLabel}</span>
            <b id="cfg-tier">{tierLabel}</b>
          </div>
        </div>
        <div className="cfg-deploy">
          <span className="cfg-sum-label">{cfg.deploymentLabel}</span>
          <div
            className="cfg-deploy-opts"
            role="radiogroup"
            aria-label={cfg.deployAriaLabel}
          >
            {deployOpts.map((opt) => (
              <button
                key={opt}
                className={`cfg-deploy-opt${deploy === opt ? ' active' : ''}`}
                role="radio"
                aria-checked={deploy === opt}
                onClick={() => setDeploy(opt)}
                type="button"
              >
                {deployLabel[opt]}
              </button>
            ))}
          </div>
        </div>
        <Link className="btn btn-primary" href="/contact" style={{ marginTop: '6px' }}>
          {cfg.cta} <MarketingIcon name="arrow" />
        </Link>
      </div>
    </div>
  );
}

/* ============================================================
   FAQ ACCORDION
   ============================================================ */

export interface FaqItem {
  q: string;
  a: string;
}

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="faq">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div className={`faq-item${isOpen ? ' open' : ''}`} id={`faq-${i}`} key={i}>
            <div
              className="faq-q"
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpen(isOpen ? null : i);
                }
              }}
            >
              {it.q}
              <span className="fi">
                <MarketingIcon name="x" />
              </span>
            </div>
            <div
              className="faq-a"
              style={{ maxHeight: isOpen ? undefined : '0' }}
            >
              <p>{it.a}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   LEAD FORM (contact)
   ============================================================ */

export function LeadForm() {
  const { messages: m } = useMarketingLocale();
  const f = m.contact.form;
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const submission = createLeadSubmissionFromFormData(
      new FormData(form),
      '/contact',
    );
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch('/api/marketing/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submission),
      });
      const payload = (await response.json().catch(() => null)) as
        | { id?: string; message?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? f.errorDefault);
      }
      form.reset();
      setNotice(
        payload?.id
          ? f.successWithRef.replace('{id}', payload.id)
          : f.successDefault,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : f.errorDefault);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form-card" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
      <h3 style={{ marginBottom: '6px' }}>{f.title}</h3>
      <p style={{ color: 'var(--text-3)', fontSize: '.9rem', marginBottom: '24px' }}>
        {f.subtitle}
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="lead-name">{f.nameLabel}</label>
          <input
            id="lead-name"
            name="name"
            type="text"
            placeholder={f.namePlaceholder}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="lead-email">{f.emailLabel}</label>
          <input
            id="lead-email"
            name="email"
            type="email"
            placeholder={f.emailPlaceholder}
            required
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="lead-org">{f.orgLabel}</label>
          <input
            id="lead-org"
            name="organisation"
            type="text"
            placeholder={f.orgPlaceholder}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="lead-role">{f.roleLabel}</label>
          <input
            id="lead-role"
            name="role"
            type="text"
            placeholder={f.rolePlaceholder}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="lead-interest">{f.interestLabel}</label>
        <select
          id="lead-interest"
          name="interest"
          defaultValue={f.interestOptions[0]}
          required
        >
          {f.interestOptions.map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="lead-deploy">{f.deploymentLabel}</label>
        <select
          id="lead-deploy"
          name="deployment"
          defaultValue={f.deploymentOptions[0]}
          required
        >
          {f.deploymentOptions.map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="lead-message">{f.messageLabel}</label>
        <textarea
          id="lead-message"
          name="message"
          placeholder={f.messagePlaceholder}
        />
      </div>
      <button
        className="btn btn-primary"
        style={{ width: '100%', justifyContent: 'center' }}
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? f.submitting : f.submit} <MarketingIcon name="arrow" />
      </button>
      {notice ? (
        <p className="form-note" role="status" aria-live="polite">
          {notice}
        </p>
      ) : (
        <p className="form-note">{f.consent}</p>
      )}
    </form>
  );
}

/* ============================================================
   SCROLL REVEAL — ported from observeFade()
   ============================================================ */

export function ScrollReveal() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const els = [
      ...document.querySelectorAll<HTMLElement>('.clario-site .fade-up'),
    ];
    if (!els.length) return;

    const reveal = (el: HTMLElement) => el.classList.add('in');

    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(reveal);
      return;
    }

    const vh = window.innerHeight || 800;
    els.forEach((el) => {
      if (el.getBoundingClientRect().top < vh * 1.1) reveal(el);
    });

    const io = new IntersectionObserver(
      (ents) => {
        ents.forEach((e) => {
          if (e.isIntersecting) {
            reveal(e.target as HTMLElement);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -10% 0px' },
    );
    els.forEach((e) => {
      if (!e.classList.contains('in')) io.observe(e);
    });

    const t = window.setTimeout(() => els.forEach(reveal), 1200);

    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  return null;
}
