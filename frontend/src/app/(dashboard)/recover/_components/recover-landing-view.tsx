'use client';

import Link from 'next/link';
import { ArrowRight, LifeBuoy, Lock, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { cn } from '@/lib/utils';
import { recoverSubSolutionHref } from '@/lib/recover/products';
import type { RecoverProductView, RecoverSubSolution } from '@/types/recover';
import { RECOVER_SUBSOLUTION_META } from './sub-solution-meta';
import { RecoverAnalyticsDashboard } from './recover-analytics-dashboard';
import { RecoverOnboardingPanel } from './recover-onboarding-panel';
import { useRecoverT } from '../_lib/recover-i18n';

/** Self-serve upgrade target (mirrors the gateway 402 upgrade_url). */
const RECOVER_UPGRADE_URL = '/register?suites=recover&plan=trial';

/**
 * Client view for the Clario Recover landing page. The async server page
 * resolves per-tenant entitlement and hands the resolved product view here; this
 * component owns all localized chrome (title, capability cards, the DR console
 * entry, onboarding + analytics), reading strings from the 'recover' namespace.
 */
export function RecoverLandingView({ products }: { products: RecoverProductView }) {
  const t = useRecoverT();
  const entitledCount = products.sub_solutions.filter((s) => s.entitlement.active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clario Recover"
        title={products.label}
        description={t('landing.description')}
        tags={[
          {
            label: t('landing.licensedTag', { entitled: entitledCount, total: products.sub_solutions.length }),
            tone: entitledCount > 0 ? 'success' : 'neutral',
          },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {products.sub_solutions.map((sub) => (
          <SubSolutionCard key={sub.id} sub={sub} />
        ))}
      </div>

      {/* Nested deep-operations entry. Recover is the product / exec framing
          (plan · orchestrate · prove); the DR Operations Console is the live
          operational surface it sits over. */}
      <Link
        href="/dr"
        className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{t('landing.drConsoleTitle')}</span>
          <span className="block text-sm text-muted-foreground">{t('landing.drConsoleDesc')}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      {/* Onboarding sub-solution selection + demo seeding (Prompt 9). */}
      {entitledCount > 0 && <RecoverOnboardingPanel subSolutions={products.sub_solutions} />}

      {/* Portfolio recovery health — the REAL cross-sub-solution analytics. */}
      {entitledCount > 0 && (
        <section className="space-y-4 pt-2">
          <h2 className="text-base font-semibold text-foreground">{t('landing.portfolioHealth')}</h2>
          <RecoverAnalyticsDashboard />
        </section>
      )}
    </div>
  );
}

function SubSolutionCard({ sub }: { sub: RecoverSubSolution }) {
  const t = useRecoverT();
  const meta = RECOVER_SUBSOLUTION_META[sub.id];
  const Icon = meta?.icon ?? LifeBuoy;
  const active = sub.entitlement.active;
  const href = recoverSubSolutionHref(sub.id);

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm',
            meta?.accent ?? 'from-success-700 to-success-500',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        {active ? (
          <span className="badge-success">{sub.entitlement.activated ? t('landing.active') : t('landing.licensed')}</span>
        ) : (
          <span className="badge-neutral inline-flex items-center gap-1">
            <Lock className="h-3 w-3" aria-hidden />
            {t('landing.notLicensed')}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">{sub.label}</h2>
        <p className="text-sm text-muted-foreground">{sub.value_prop}</p>
      </div>

      <div className="mt-auto pt-1">
        {active ? (
          <Link href={href} className="btn-primary inline-flex items-center gap-2">
            {t('landing.openWorkspace')}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : (
          <Link href={RECOVER_UPGRADE_URL} className="btn-secondary inline-flex items-center gap-2">
            <LifeBuoy className="h-4 w-4" aria-hidden />
            {t('common.requestAccess')}
          </Link>
        )}
      </div>
    </div>
  );
}
