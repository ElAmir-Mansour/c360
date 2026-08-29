'use client';

/**
 * BreakerPanel (#12) — live circuit-breaker state for one endpoint.
 *
 * Reads GET /integrations/{id}/breaker (graceful: `null` → "unavailable") and
 * renders the state badge (closed / open / half_open), the failures-vs-threshold
 * counter, the opened-at timestamp, the cooldown, and a quarantine chip. When the
 * caller can manage (`lex:integration:manage`), a Reset button manually closes
 * the breaker + clears quarantine (POST …/breaker/reset), with a confirm dialog,
 * optimistic toast + react-query invalidation. Read-only users see state only.
 *
 * Mirrors the connection-panel right-rail card chrome; RTL via `dir`/`lang`.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, ShieldHalf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/status-badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showSuccess, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { getBreaker, resetBreaker, type BreakerState } from '@/lib/lex/integrations';
import {
  useReliabilityLabels,
  fillReliabilityToken,
  buildBreakerStateConfig,
  breakerHint,
  QuarantineIcon,
  ClearIcon,
} from '../_lib/reliability-labels';

interface BreakerPanelProps {
  endpointId: string;
  /** Gated on `lex:integration:manage`; read-only users see state only. */
  canManage?: boolean;
  /** Render as a bare card (right-rail) vs an embedded block. */
  variant?: 'card' | 'embedded';
}

const BREAKER_KEY = 'lex-integration-breaker';

export function BreakerPanel({
  endpointId,
  canManage = false,
  variant = 'card',
}: BreakerPanelProps) {
  const t = useReliabilityLabels();
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();
  const stateConfig = buildBreakerStateConfig(t);

  const [resetOpen, setResetOpen] = useState(false);

  const q = useQuery({
    queryKey: [BREAKER_KEY, endpointId],
    queryFn: () => getBreaker(endpointId),
    enabled: Boolean(endpointId),
    staleTime: 15_000,
  });

  const reset = useMutation({
    mutationFn: () => resetBreaker(endpointId),
    onSuccess: async (fresh: BreakerState) => {
      showSuccess(t.toastBreakerReset);
      // Seed the fresh state immediately, then invalidate for consistency.
      qc.setQueryData([BREAKER_KEY, endpointId], fresh);
      await qc.invalidateQueries({ queryKey: [BREAKER_KEY, endpointId] });
    },
    onError: (e) => showBackendError(e, t.reliabilityError),
  });

  const breaker = q.data ?? null;

  const body = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldHalf className="h-4 w-4 text-primary" aria-hidden />
          {t.breakerTitle}
        </h3>
        {q.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : breaker ? (
          <StatusBadge status={breaker.state} config={stateConfig} size="sm" />
        ) : null}
      </div>

      <p className="text-caption text-muted-foreground">{t.breakerSubtitle}</p>

      {q.isLoading ? null : !breaker ? (
        <p className="rounded-lg border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
          {t.breakerUnknown}
        </p>
      ) : (
        <>
          {/* Failures vs threshold + cooldown. */}
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <dt className="text-muted-foreground">{t.breakerFailuresLabel}</dt>
              <dd
                className={cn(
                  'mt-0.5 font-semibold tabular-nums',
                  breaker.failures >= breaker.failure_threshold
                    ? 'text-destructive'
                    : 'text-foreground',
                )}
              >
                {fillReliabilityToken(t.breakerFailures, {
                  n: breaker.failures,
                  threshold: breaker.failure_threshold,
                })}
              </dd>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2">
              <dt className="text-muted-foreground">{t.breakerCooldownLabel}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-foreground">
                {fillReliabilityToken(t.breakerCooldown, { n: breaker.cooldown_seconds })}
              </dd>
            </div>
          </dl>

          {/* Quarantine chip. */}
          <div>
            {breaker.quarantined ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-error-300/60 bg-error-50 px-2 py-0.5 text-caption font-medium text-error-700 dark:bg-error-700/15 dark:text-error-300">
                <QuarantineIcon className="h-3 w-3" aria-hidden />
                {t.breakerQuarantined}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-neutral-100 px-2 py-0.5 text-caption font-medium text-muted-foreground dark:bg-neutral-800">
                <ClearIcon className="h-3 w-3" aria-hidden />
                {t.breakerNotQuarantined}
              </span>
            )}
          </div>

          {/* Opened-at. */}
          {breaker.opened_at ? (
            <p className="text-caption text-muted-foreground">
              {t.breakerOpenedAt}: <RelativeTime date={breaker.opened_at} />
            </p>
          ) : null}

          {/* State hint. */}
          <p className="text-caption text-muted-foreground">{breakerHint(t, breaker.state)}</p>

          {/* Reset (manage-gated). */}
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setResetOpen(true)}
              disabled={reset.isPending}
            >
              {reset.isPending ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {reset.isPending ? t.breakerResetting : t.breakerReset}
            </Button>
          ) : (
            <p className="text-caption text-muted-foreground">{t.manageOnlyNote}</p>
          )}
        </>
      )}

      {canManage ? (
        <ConfirmDialog
          open={resetOpen}
          onOpenChange={setResetOpen}
          title={t.breakerResetConfirmTitle}
          description={t.breakerResetConfirmBody}
          confirmLabel={t.breakerReset}
          loading={reset.isPending}
          onConfirm={async () => {
            await reset.mutateAsync();
          }}
        />
      ) : null}
    </div>
  );

  if (variant === 'embedded') {
    return (
      <div dir={direction} lang={locale}>
        {body}
      </div>
    );
  }

  return (
    <div className="card space-y-1 p-5" dir={direction} lang={locale}>
      {body}
    </div>
  );
}
