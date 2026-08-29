'use client';

import Link from 'next/link';
import { LifeBuoy, Lock, ServerCrash } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { useRecoverT } from '../_lib/recover-i18n';
import type { RecoverSubSolution, RecoverSubSolutionSlug } from '@/types/recover';

/**
 * Self-serve upgrade target for an unentitled Recover sub-solution. Mirrors the
 * gateway's 402 `upgrade_url` (RECOVER_CONTRACT.md §2) so the in-app affordance
 * and the API denial point at the same place.
 */
const RECOVER_UPGRADE_URL = '/register?suites=recover&plan=trial';

/** Slug → localized workspace title key (the guard-screen heading). */
const TITLE_KEY: Record<RecoverSubSolutionSlug, string> = {
  'it-dr': 'itdr.pageTitle',
  'cloud-dr': 'clouddr.pageTitle',
  'cyber-recovery': 'cyber.title',
};

interface DeniedProps {
  /** Sub-solution slug; when present the localized workspace title is derived. */
  slug?: RecoverSubSolutionSlug;
  /** Fallback human label (e.g. the product brand) when no slug is resolvable. */
  label?: string;
  /** The resolved sub-solution (carries the denial reason), when available. */
  subSolution?: RecoverSubSolution;
}

/**
 * Rendered when an authenticated tenant reaches a Recover sub-solution they are
 * not licensed for. The route guard has already REJECTED access server-side
 * (this is not a hidden link); this surface explains the gate and offers the
 * real self-serve "request access" path.
 */
export function RecoverAccessDenied({ slug, label, subSolution }: DeniedProps) {
  const t = useRecoverT();
  const reason = subSolution?.entitlement.reason?.trim();
  const title = slug ? t(TITLE_KEY[slug]) : label ?? '';
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clario Recover"
        title={title}
        description={t('guard.notInPlanDesc')}
      />
      <div className="card flex flex-col items-start gap-4 p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-warning-700 dark:text-warning-300">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{t('guard.accessNotLicensed')}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {reason
              ? t('guard.reasonWith', { label: title, reason })
              : t('guard.reasonWithout', { label: title })}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={RECOVER_UPGRADE_URL} className="btn-primary inline-flex items-center gap-2">
            <LifeBuoy className="h-4 w-4" aria-hidden />
            {t('common.requestAccess')}
          </Link>
          <Link href="/recover" className="btn-secondary inline-flex items-center gap-2">
            {t('common.backToRecover')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Rendered when the licensing engine is unreachable. Recover fails CLOSED — we
 * never silently grant access during an outage — so the workspace is withheld
 * and the operator is offered a real retry (re-requesting the route re-runs the
 * server-side entitlement resolution).
 */
export function RecoverEntitlementUnavailable({ slug, label }: { slug?: RecoverSubSolutionSlug; label?: string }) {
  const t = useRecoverT();
  const title = slug ? t(TITLE_KEY[slug]) : label ?? '';
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clario Recover"
        title={title}
        description={t('guard.unavailableDesc')}
      />
      <div className="card flex flex-col items-start gap-4 p-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-error-500/10 text-error-500">
          <ServerCrash className="h-5 w-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{t('guard.checkUnavailable')}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{t('guard.unavailableBody')}</p>
        </div>
        <Link href="/recover/it-dr" className="btn-secondary inline-flex items-center gap-2">
          {t('common.retry')}
        </Link>
      </div>
    </div>
  );
}
