'use client';

/**
 * First-run ONBOARDING band for the Watheeq Legal-Affairs command center
 * (`/lex` landing page) — feature #30 (first-run / empty guidance).
 *
 * When a tenant has no legal data yet (no active contracts, no domain counts,
 * and nothing in the needs-attention feed) the dense KPI/analytics surface reads
 * as a wall of zeros. This band replaces that anxiety with a calm, premium
 * welcome: a brand-washed command band, a short orientation line, and three
 * guided step cards that seed the first records (open a service-desk request,
 * draft a contract with AI, configure compliance rules).
 *
 * It is purely additive and self-deciding: it returns `null` the instant ANY
 * signal of real data appears (or while the underlying queries are still
 * loading), so an established tenant never sees it and there is no flash. All
 * data is read from the SHARED command-center hooks (dashboard + domain counts +
 * needs-attention), so no extra network round-trips are issued.
 *
 * Bilingual (EN/AR) + RTL-safe. Copy lives in a LOCAL bilingual bundle (the
 * shared `lex-i18n.ts` overview bundle is owned elsewhere and must not be
 * edited here), mirroring the `CONTRACT_ANALYTICS_TITLE` precedent. Ordinal
 * step numbers render through `useLexFormat` so Arabic-Indic numerals apply.
 * Presentation is built entirely on the shared `./command-ui` primitives so the
 * band reads as one system with the rest of the page.
 */

import Link from 'next/link';
import {
  ArrowRight,
  FilePlus2,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { useLocale } from '@/components/providers/locale-provider';
import { IconBadge } from '@/components/shared/icon-badge';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

import { CommandCard, SectionHeader } from './command-ui';
import {
  useLexCommandKpis,
  useLexDomainCounts,
  useLexNeedsAttention,
} from '../_lib/use-lex-command-center';

/* ------------------------------------------------------------------------- *
 * Local bilingual copy (the shared overview bundle is owned elsewhere).
 * ------------------------------------------------------------------------- */

interface FirstRunCopy {
  eyebrow: string;
  title: string;
  subtitle: string;
  steps: Array<{ title: string; description: string }>;
  actions: { newRequest: string; draft: string; compliance: string };
}

const FIRST_RUN_COPY: Record<'en' | 'ar', FirstRunCopy> = {
  en: {
    eyebrow: 'Welcome to Watheeq',
    title: 'Set up your legal affairs workspace',
    subtitle:
      'Your workspace is ready. Start with one of these to bring contracts, requests and compliance to life — the dashboards below fill in as you go.',
    steps: [
      {
        title: 'Open a service-desk request',
        description: 'Route the first legal request through intake and SLA tracking.',
      },
      {
        title: 'Draft a contract with AI',
        description: 'Generate a first draft from a clause library and a playbook.',
      },
      {
        title: 'Configure compliance',
        description: 'Switch on the rules that watch your portfolio for risk.',
      },
    ],
    actions: {
      newRequest: 'New request',
      draft: 'AI drafting',
      compliance: 'Compliance',
    },
  },
  ar: {
    eyebrow: 'مرحبًا بك في وثيق',
    title: 'هيّئ مساحة عمل الشؤون القانونية',
    subtitle:
      'مركز القيادة جاهز. ابدأ بأحد هذه الإجراءات لتفعيل العقود والطلبات والامتثال — وتمتلئ اللوحات أدناه تباعًا مع تقدّمك.',
    steps: [
      {
        title: 'افتح طلبًا في مكتب الخدمة',
        description: 'وجّه أول طلب قانوني عبر الاستلام وتتبّع اتفاقية مستوى الخدمة.',
      },
      {
        title: 'صُغ عقدًا بالذكاء الاصطناعي',
        description: 'أنشئ مسودة أولى من مكتبة البنود ودليل إرشادي.',
      },
      {
        title: 'هيّئ الامتثال',
        description: 'فعّل القواعد التي تراقب محفظتك بحثًا عن المخاطر.',
      },
    ],
    actions: {
      newRequest: 'طلب جديد',
      draft: 'الصياغة بالذكاء الاصطناعي',
      compliance: 'الامتثال',
    },
  },
};

const STEP_ICONS: LucideIcon[] = [FilePlus2, Sparkles, ShieldCheck];
const STEP_HREFS = ['/lex/service-desk/new', '/lex/drafting', '/lex/compliance'];
/** IconBadge tones per step (each already a valid IconBadge tone). */
const STEP_TONES = ['info', 'primary', 'success'] as const;

/* ------------------------------------------------------------------------- *
 * Component
 * ------------------------------------------------------------------------- */

export function FirstRunBanner() {
  const { locale, direction } = useLocale();
  const copy = FIRST_RUN_COPY[locale === 'ar' ? 'ar' : 'en'];
  const f = useLexFormat();

  const kpis = useLexCommandKpis();
  const counts = useLexDomainCounts();
  const attention = useLexNeedsAttention();

  // Still resolving any of the headline signals → render nothing (no flash, no
  // premature "you're empty" claim).
  const anyLoading =
    kpis.activeContracts.isLoading ||
    kpis.openMatters.isLoading ||
    attention.isLoading ||
    Object.values(counts).some((c) => c.isLoading);
  if (anyLoading) return null;

  // Any real data anywhere → not a first run. Domain counts of `null` mean
  // "ungated / no-count", which we treat as absence; any positive count counts
  // as data.
  const hasDomainData = Object.values(counts).some(
    (c) => typeof c.count === 'number' && c.count > 0,
  );
  const hasKpiData =
    kpis.activeContracts.value > 0 ||
    kpis.openMatters.value > 0 ||
    kpis.overdueObligations.value > 0 ||
    kpis.pendingApprovals.value > 0;
  const hasData =
    hasDomainData || hasKpiData || attention.items.length > 0;

  if (hasData) return null;

  const actionLabels = [
    copy.actions.newRequest,
    copy.actions.draft,
    copy.actions.compliance,
  ];

  return (
    <CommandCard
      as="section"
      accent="primary"
      dir={direction}
      lang={locale}
      className="motion-safe:animate-fade-up"
    >
      {/* Subtle brand wash behind the onboarding content. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[var(--lex-landing-tint)]/15"
      />

      <div className="relative space-y-6">
        <SectionHeader
          icon={Sparkles}
          tone="primary"
          eyebrow={copy.eyebrow}
          title={copy.title}
          description={copy.subtitle}
        />

        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {copy.steps.map((step, index) => {
            const Icon = STEP_ICONS[index] ?? Sparkles;
            const href = STEP_HREFS[index] ?? '/lex';
            const tone = STEP_TONES[index] ?? 'primary';
            const actionLabel = actionLabels[index];
            return (
              <li
                key={step.title}
                className="motion-safe:animate-fade-up"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <Link
                  href={href}
                  className={cn(
                    'group flex h-full flex-col gap-3 rounded-softest border border-border bg-card p-4 text-start shadow-elevation-1 outline-none',
                    'transition-[box-shadow,border-color,background-color] duration-fast ease-standard',
                    'hover:border-primary/30 hover:shadow-elevation-2',
                    'focus-visible:border-primary/40 focus-visible:shadow-focus-ring',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <IconBadge icon={Icon} tone={tone} size="md" />
                    <span
                      aria-hidden
                      className="inline-grid h-6 w-6 place-items-center rounded-full border border-border bg-muted text-caption font-semibold tabular-nums text-muted-foreground"
                    >
                      {f.formatNumber(index + 1)}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-body-sm font-semibold text-foreground">
                      {step.title}
                    </p>
                    <p className="text-caption leading-5 text-muted-foreground">
                      {step.description}
                    </p>
                  </div>

                  <span className="mt-auto inline-flex items-center gap-1.5 text-caption font-medium text-primary">
                    {actionLabel}
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform duration-fast ease-standard rtl:-scale-x-100 motion-safe:group-hover:translate-x-0.5 motion-safe:rtl:group-hover:-translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </CommandCard>
  );
}

export default FirstRunBanner;
