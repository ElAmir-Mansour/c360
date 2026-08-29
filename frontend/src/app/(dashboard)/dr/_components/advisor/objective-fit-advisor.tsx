'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TimerReset,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  DRObjectiveFit,
  DRProtectedSite,
  DRRecoveryTierProfile,
} from '@/types/clario-dr';
import {
  type AdvisorRemediation,
  type AdvisorTone,
  badgeVariantForTone,
  buildRecommendationRequest,
  deriveRemediations,
  formatObjectiveDuration,
  normalizeRecommendation,
  normalizeTierProfile,
  objectiveFitLabel,
  objectiveFitTone,
  objectiveFitVerdict,
  prettify,
} from './advisor-format';
import { type AdvisorLabels, useAdvisorLabels } from './advisor-labels';

export interface ObjectiveFitAdvisorProps {
  /** Sites whose `objective_fit` / `recovery_tier_recommendation` are surfaced. */
  sites: DRProtectedSite[];
  /** The recovery-tier catalog (from `fetchDRRecoveryTiers`), keyed by `tier`. */
  recoveryTiers: DRRecoveryTierProfile[];
  /**
   * Latest standalone recommendation from `useRecoveryTierActions().recommendTier`.
   * Shown against the site whose objectives produced it (best-effort by tier match).
   */
  latestRecommendation?: DRRecoveryTierProfile | null;
  /** Whether the operator may run write actions (`hasPermission('dr:write')`). */
  canWrite: boolean;
  loading: boolean;
  recommending: boolean;
  error: unknown;
  /** Fires `recommendDRRecoveryTier` for the given site (already dr:write-guarded by the page). */
  onRecommendTier: (site: DRProtectedSite) => void;
  onRetry: () => void;
}

export function ObjectiveFitAdvisor({
  sites,
  recoveryTiers,
  latestRecommendation,
  canWrite,
  loading,
  recommending,
  error,
  onRecommendTier,
  onRetry,
}: ObjectiveFitAdvisorProps) {
  const labels = useAdvisorLabels();

  const tierByName = useMemo(() => {
    const map = new Map<string, DRRecoveryTierProfile>();
    for (const tier of recoveryTiers) {
      map.set(tier.tier.toLowerCase(), tier);
    }
    return map;
  }, [recoveryTiers]);

  const hasData = sites.length > 0;

  if (loading && !hasData) {
    return <LoadingSkeleton variant="card" count={3} />;
  }

  if (error && !hasData) {
    return <ErrorState message={labels.failedToLoad} onRetry={onRetry} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-base">{labels.title}</CardTitle>
            <CardDescription>{labels.description}</CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 normal-case tracking-normal">
            {labels.sites}: {sites.length}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0">{formatError(error, labels.failedToLoad)}</span>
              </div>
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
                <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.retry}
              </Button>
            </div>
          ) : null}

          {hasData ? (
            <div className="space-y-4">
              {sites.map((site) => (
                <SiteAdvisoryCard
                  key={site.id}
                  site={site}
                  catalogTier={tierByName.get((site.recovery_tier_recommendation?.tier ?? '').toLowerCase()) ?? null}
                  latestRecommendation={latestRecommendation ?? null}
                  canWrite={canWrite}
                  recommending={recommending}
                  labels={labels}
                  onRecommendTier={() => onRecommendTier(site)}
                />
              ))}
            </div>
          ) : (
            <EmptyLine icon={Layers} text={labels.noSites} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SiteAdvisoryCard({
  site,
  catalogTier,
  latestRecommendation,
  canWrite,
  recommending,
  labels,
  onRecommendTier,
}: {
  site: DRProtectedSite;
  catalogTier: DRRecoveryTierProfile | null;
  latestRecommendation: DRRecoveryTierProfile | null;
  canWrite: boolean;
  recommending: boolean;
  labels: AdvisorLabels;
  onRecommendTier: () => void;
}) {
  const fit = site.objective_fit ?? null;
  const verdict = objectiveFitVerdict(fit);
  const tone = objectiveFitTone(fit);

  // Prefer the site's own recommendation; fall back to the catalog profile that
  // matches its tier so the strategy/cyber-vault/clean-room flags are populated.
  const recTier =
    normalizeRecommendation(site.recovery_tier_recommendation) ?? normalizeTierProfile(catalogTier);

  // A freshly-run recommendation whose tier matches this site's recommended tier.
  const freshMatch =
    latestRecommendation &&
    site.recovery_tier_recommendation &&
    latestRecommendation.tier.toLowerCase() === site.recovery_tier_recommendation.tier.toLowerCase()
      ? latestRecommendation
      : null;

  const remediations = deriveRemediations(recTier, fit);
  const request = buildRecommendationRequest(site);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{site.name}</h3>
            <Badge variant="outline" className="normal-case tracking-normal">
              {prettify(site.kind)}
            </Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{site.primary_endpoint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ObjectiveFitBadge fit={fit} labels={labels} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canWrite || recommending}
            onClick={onRecommendTier}
            title={canWrite ? `${labels.recommendHint} (${request.rto_seconds}s / ${request.rpo_seconds}s)` : labels.noWriteHint}
            aria-label={`${labels.recommendAction}: ${site.name}`}
          >
            {recommending ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="me-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {recommending ? labels.recommending : labels.recommendAction}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <ObjectiveDatum
              icon={Target}
              label={labels.rtoObjective}
              value={formatObjectiveDuration(fit?.rto_objective_seconds ?? site.rto_objective_seconds)}
            />
            <ObjectiveDatum
              icon={Gauge}
              label={labels.rpoObjective}
              value={formatObjectiveDuration(fit?.rpo_objective_seconds ?? site.rpo_objective_seconds)}
            />
          </div>

          {recTier ? (
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="truncate text-sm font-medium">{labels.recommendedTier}</span>
                </div>
                <Badge variant="success" className="normal-case tracking-normal">
                  {prettify(recTier.tier)}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <MetaRow label={labels.strategy} value={prettify(recTier.strategy)} />
                <MetaRow
                  label={labels.validationCadence}
                  value={formatObjectiveDuration(recTier.validationCadenceSeconds)}
                  icon={TimerReset}
                />
                <MetaRow
                  label={labels.cyberVault}
                  value={recTier.requiresCyberVault ? labels.required : labels.notRequired}
                  tone={recTier.requiresCyberVault ? 'warning' : 'neutral'}
                />
                <MetaRow
                  label={labels.cleanRoom}
                  value={recTier.requiresCleanRoom ? labels.required : labels.notRequired}
                  tone={recTier.requiresCleanRoom ? 'warning' : 'neutral'}
                />
              </dl>
              {recTier.capabilities.length > 0 ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    {labels.capabilities}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {recTier.capabilities.map((capability) => (
                      <Badge key={capability} variant="outline" className="normal-case tracking-normal">
                        {prettify(capability)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {freshMatch ? (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-primary">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {labels.latestRecommendation}: {prettify(freshMatch.tier)} /{' '}
                  {prettify(freshMatch.recommended_strategy)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={cn('rounded-md p-1.5', toneSoftClass(tone))}>
              <VerdictIcon verdict={verdict} />
            </span>
            <span className="text-sm font-medium">{labels.remediation}</span>
          </div>

          {!fit ? (
            <EmptyLine icon={Info} text={labels.objectiveFitMissing} />
          ) : remediations.length > 0 ? (
            <ul className="space-y-2">
              {remediations.map((step) => (
                <RemediationLine key={step.key} step={step} />
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">{labels.noRemediation}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ObjectiveFitBadge({ fit, labels }: { fit: DRObjectiveFit | null; labels: AdvisorLabels }) {
  const tone = objectiveFitTone(fit);
  return (
    <Badge variant={badgeVariantForTone(tone)} className="normal-case tracking-normal" aria-label={`${labels.objectiveFit}: ${objectiveFitLabel(fit)}`}>
      {objectiveFitLabel(fit)}
    </Badge>
  );
}

function VerdictIcon({ verdict }: { verdict: ReturnType<typeof objectiveFitVerdict> }) {
  if (verdict === 'not_achievable') {
    return <AlertTriangle className="h-4 w-4 text-error-500 dark:text-error-300" aria-hidden />;
  }
  if (verdict === 'at_risk') {
    return <Clock className="h-4 w-4 text-warning-700 dark:text-warning-300" aria-hidden />;
  }
  if (verdict === 'met') {
    return <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />;
  }
  return <Info className="h-4 w-4 text-muted-foreground" aria-hidden />;
}

function ObjectiveDatum({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <div className="mt-1.5 text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  tone?: AdvisorTone;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
        {label}
      </dt>
      <dd className={cn('mt-1 truncate font-medium', toneTextClass(tone))}>{value}</dd>
    </div>
  );
}

function RemediationLine({ step }: { step: AdvisorRemediation }) {
  return (
    <li className="flex items-start gap-2.5 rounded-lg border bg-background px-3 py-2.5">
      <span className={cn('mt-0.5 rounded-md p-1', toneSoftClass(step.tone))}>
        <RemediationIcon tone={step.tone} />
      </span>
      <span className="min-w-0 text-sm leading-5 text-foreground">{step.text}</span>
    </li>
  );
}

function RemediationIcon({ tone }: { tone: AdvisorTone }) {
  if (tone === 'critical') {
    return <AlertTriangle className="h-3.5 w-3.5 text-error-500 dark:text-error-300" aria-hidden />;
  }
  if (tone === 'warning') {
    return <ShieldCheck className="h-3.5 w-3.5 text-warning-700 dark:text-warning-300" aria-hidden />;
  }
  if (tone === 'success') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />;
  }
  return <Info className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" aria-hidden />;
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function toneSoftClass(tone: AdvisorTone): string {
  switch (tone) {
    case 'success':
      return 'bg-primary/10';
    case 'warning':
      return 'bg-amber-50 dark:bg-amber-950/25';
    case 'critical':
      return 'bg-error-50 dark:bg-error-700/25';
    case 'info':
      return 'bg-sky-50 dark:bg-sky-950/25';
    default:
      return 'bg-muted';
  }
}

function toneTextClass(tone: AdvisorTone): string {
  switch (tone) {
    case 'success':
      return 'text-primary';
    case 'warning':
      return 'text-warning-700 dark:text-warning-300';
    case 'critical':
      return 'text-error-700 dark:text-error-300';
    case 'info':
      return 'text-sky-700 dark:text-sky-300';
    default:
      return 'text-foreground';
  }
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return fallback;
}
