'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Sparkles, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { showError, showSuccess } from '@/lib/toast';
import { useAuthStore } from '@/stores/auth-store';
import {
  activateRecoverSubSolutions,
  removeRecoverDemoData,
} from '@/lib/recover/onboarding';
import { useRecoverT } from '../_lib/recover-i18n';
import type { RecoverSubSolution, RecoverSubSolutionSlug } from '@/types/recover';

/**
 * Recover onboarding panel — the sub-solution selection + demo-seed surface
 * (Prompt 9) on the product landing page.
 *
 * For an admin tenant it lists the LICENSED sub-solutions and lets them activate
 * the ones not yet turned on; activation writes the entitlement (the Prompt 1
 * model) AND seeds real demo content (applications + runbooks) server-side so the
 * dashboards land populated. A one-click "Remove demo data" fully removes it.
 *
 * Entitlement and the activation/seed/remove writes are all enforced SERVER-SIDE
 * (the endpoints self-gate on `dr:admin` and resolve the Recover entitlement);
 * this panel only renders the controls and is additionally hidden from non-admins
 * client-side. It refreshes the server components (router.refresh) after a write
 * so the cards/analytics reflect the new state.
 */
export function RecoverOnboardingPanel({
  subSolutions,
}: {
  subSolutions: RecoverSubSolution[];
}) {
  const t = useRecoverT();
  const router = useRouter();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission('dr:admin');

  // Only licensed sub-solutions can be activated; a non-licensed one shows
  // "Request access" on its card instead (handled by the landing page).
  const licensed = useMemo(
    () => subSolutions.filter((s) => s.entitlement.active),
    [subSolutions],
  );
  const activatable = useMemo(
    () => licensed.filter((s) => !s.entitlement.activated),
    [licensed],
  );
  const anyActivated = useMemo(
    () => licensed.some((s) => s.entitlement.activated),
    [licensed],
  );

  const [selected, setSelected] = useState<Set<RecoverSubSolutionSlug>>(
    () => new Set(activatable.map((s) => s.id)),
  );
  const [activating, setActivating] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Nothing to manage and no demo to remove → the panel is not useful; the
  // landing page only renders it when there is at least one licensed sub-solution.
  if (!canManage || licensed.length === 0) {
    return null;
  }

  const toggle = (slug: RecoverSubSolutionSlug) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const onActivate = async () => {
    const chosen = Array.from(selected);
    if (chosen.length === 0) {
      showError(t('onboarding.selectAtLeastOne'));
      return;
    }
    setActivating(true);
    try {
      const result = await activateRecoverSubSolutions(chosen);
      const apps = result.results.reduce((n, r) => n + r.application_count, 0);
      const runbooks = result.results.reduce((n, r) => n + r.runbook_count, 0);
      showSuccess(
        t('onboarding.activatedTitle'),
        t('onboarding.activatedBody', {
          apps,
          appsWord: apps === 1 ? t('onboarding.appOne') : t('onboarding.appMany'),
          runbooks,
          runbooksWord: runbooks === 1 ? t('onboarding.runbookOne') : t('onboarding.runbookMany'),
        }),
      );
      router.refresh();
    } catch (error) {
      showError(
        t('onboarding.activationFailed'),
        error instanceof Error ? error.message : t('onboarding.activationFailedFallback'),
      );
    } finally {
      setActivating(false);
    }
  };

  const onRemoveDemo = async () => {
    setRemoving(true);
    try {
      const result = await removeRecoverDemoData();
      const total = result.applications_removed + result.runbooks_removed;
      showSuccess(
        total > 0 ? t('onboarding.demoRemoved') : t('onboarding.noDemoToRemove'),
        total > 0
          ? t('onboarding.demoRemovedBody', {
              apps: result.applications_removed,
              appsWord: result.applications_removed === 1 ? t('onboarding.appOne') : t('onboarding.appMany'),
              runbooks: result.runbooks_removed,
              runbooksWord: result.runbooks_removed === 1 ? t('onboarding.runbookOne') : t('onboarding.runbookMany'),
            })
          : undefined,
      );
      router.refresh();
    } catch (error) {
      showError(
        t('onboarding.removalFailed'),
        error instanceof Error ? error.message : t('onboarding.removalFailedFallback'),
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-success-500" aria-hidden />
            {t('onboarding.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('onboarding.intro')}</p>
        </div>
        {anyActivated && (
          <button
            type="button"
            onClick={onRemoveDemo}
            disabled={removing}
            className="btn-secondary inline-flex items-center gap-2"
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden />
            )}
            {t('onboarding.removeDemo')}
          </button>
        )}
      </div>

      {activatable.length === 0 ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success-500" aria-hidden />
          {t('onboarding.allActive')}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {activatable.map((sub) => {
              const isSelected = selected.has(sub.id);
              return (
                <label
                  key={sub.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                    isSelected
                      ? 'border-success-500 bg-success-500/5'
                      : 'border-border hover:border-success-500/50',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-success-500"
                    checked={isSelected}
                    onChange={() => toggle(sub.id)}
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium text-foreground">{sub.label}</span>
                    <span className="block text-xs text-muted-foreground">{sub.value_prop}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={onActivate}
              disabled={activating || selected.size === 0}
              className="btn-primary inline-flex items-center gap-2"
            >
              {activating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              {t('onboarding.activateSeed')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
