'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldX, ArrowRight, RefreshCw, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import type { PermissionRequirement } from '@/lib/permissions';
import { getAccessDeniedLabels } from './access-denied-labels';
import {
  describeRequirement,
  findSwitchableRoles,
  roleDisplayName,
} from './access-denied-utils';
import type { LegalRoleSummary } from './use-lex-access';

export interface LexAccessDeniedProps {
  /** The permission requirement the blocked route declared (§8 registry). */
  requirement?: PermissionRequirement;
  /** Human resource name for the route, e.g. "Litigation Cases" (optional). */
  resourceName?: string;
  /** The user's active legal role from `/lex/me` (null when none / not loaded). */
  activeRole?: LegalRoleSummary | null;
  /** All legal roles the user holds — used to offer "Switch persona" (§15). */
  availableRoles?: LegalRoleSummary[];
  /** `/lex/me.access_state`; 'NO_LEX_ROLE_ASSIGNED' shows the no-role message. */
  accessState?: string;
  /**
   * Switch the active persona then (on success) reload so the now-permitted
   * route renders. Provided by the guard; when absent the affordance is hidden.
   */
  onSwitchPersona?: (roleSlug: string) => Promise<unknown>;
  className?: string;
}

/**
 * §15 Access-Denied view. Renders — instead of a silent redirect — the required
 * permission, the user's active legal role, a one-line explanation, and (when a
 * different held role would grant access) a "Switch persona" button per role.
 *
 * Backend authorization remains authoritative; this is the UX surface a route
 * guard shows to an authenticated-but-unpermitted user.
 */
export function LexAccessDenied({
  requirement,
  resourceName,
  activeRole,
  availableRoles = [],
  accessState,
  onSwitchPersona,
  className,
}: LexAccessDeniedProps) {
  const { locale, direction } = useLocaleOrDefault();
  const t = getAccessDeniedLabels(locale);
  const router = useRouter();

  const [switchingSlug, setSwitchingSlug] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const noLexRole = accessState === 'NO_LEX_ROLE_ASSIGNED';

  const requiredLabel = describeRequirement(requirement, { and: t.and, or: t.or });
  const activeRoleName = roleDisplayName(activeRole, locale);

  const switchable = noLexRole
    ? []
    : findSwitchableRoles(requirement, availableRoles, activeRole?.slug ?? null);

  const handleSwitch = async (role: LegalRoleSummary) => {
    if (!onSwitchPersona) return;
    setSwitchError(null);
    setSwitchingSlug(role.slug);
    try {
      await onSwitchPersona(role.slug);
      // The route is now permitted under the new persona — reload to render it.
      router.refresh();
    } catch {
      setSwitchError(t.switchFailed);
      setSwitchingSlug(null);
    }
  };

  return (
    <div
      dir={direction}
      lang={locale}
      role="alert"
      aria-live="polite"
      data-testid="lex-access-denied"
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-6 motion-safe:animate-fade-up',
        className,
      )}
    >
      <div className="card flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="kpi-icon-badge kpi-theme-pink shrink-0" aria-hidden>
            <ShieldX className="h-6 w-6" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t.eyebrow}
            </p>
            <h1 className="text-h3 font-semibold text-foreground">
              {resourceName ? t.titleWithResource(resourceName) : t.title}
            </h1>
          </div>
        </div>

        {noLexRole ? (
          <p className="text-sm leading-6 text-muted-foreground">{t.noLexRole}</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2">
              {requiredLabel ? (
                <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t.requiredPermission}
                  </dt>
                  <dd
                    data-testid="required-permission"
                    className="mt-1 break-all font-mono text-sm text-foreground"
                  >
                    {requiredLabel}
                  </dd>
                </div>
              ) : null}
              <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t.yourActiveRole}
                </dt>
                <dd
                  data-testid="active-role"
                  className="mt-1 text-sm font-medium text-foreground"
                >
                  {activeRoleName ?? t.noActiveRole}
                </dd>
              </div>
            </dl>

            <p className="text-sm leading-6 text-muted-foreground">{t.explanation}</p>
          </>
        )}

        {switchable.length > 0 && onSwitchPersona ? (
          <div
            data-testid="switch-persona"
            className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-4"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <UserCog className="h-4 w-4 text-primary" aria-hidden />
              {t.switchPrompt}
            </p>
            <div className="flex flex-wrap gap-2">
              {switchable.map((role) => {
                const name = roleDisplayName(role, locale) ?? role.slug;
                const isSwitching = switchingSlug === role.slug;
                return (
                  <Button
                    key={role.slug}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={switchingSlug !== null}
                    onClick={() => handleSwitch(role)}
                  >
                    {isSwitching ? (
                      <>
                        <RefreshCw className="me-2 h-4 w-4 animate-spin" aria-hidden />
                        {t.switching}
                      </>
                    ) : (
                      <>
                        {t.switchTo(name)}
                        <ArrowRight
                          className="ms-2 h-4 w-4 rtl:-scale-x-100"
                          aria-hidden
                        />
                      </>
                    )}
                  </Button>
                );
              })}
            </div>
            {switchError ? (
              <p className="text-sm text-rose-600 dark:text-rose-400">{switchError}</p>
            ) : null}
          </div>
        ) : null}

        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.replace('/dashboard')}
          >
            {t.backToWorkspace}
          </Button>
        </div>
      </div>
    </div>
  );
}
