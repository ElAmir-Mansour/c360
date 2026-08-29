'use client';

import {
  Database,
  Layers,
  ShieldCheck,
  Sparkles,
  TimerReset,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DRRecoveryTierProfile } from '@/types/clario-dr';
import { formatObjectiveDuration, prettify } from './advisor-format';
import { type CatalogLabels, useCatalogLabels } from './advisor-labels';

export interface RecoveryTierCatalogProps {
  recoveryTiers: DRRecoveryTierProfile[];
  /** Tier name to highlight as recommended (e.g. from a site recommendation). */
  highlightedTier?: string | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function RecoveryTierCatalog({
  recoveryTiers,
  highlightedTier,
  loading,
  error,
  onRetry,
}: RecoveryTierCatalogProps) {
  const labels = useCatalogLabels();
  const hasData = recoveryTiers.length > 0;
  const highlighted = (highlightedTier ?? '').toLowerCase();

  if (loading && !hasData) {
    return <LoadingSkeleton variant="card" count={2} />;
  }

  if (error && !hasData) {
    return <ErrorState message={labels.failedToLoad} onRetry={onRetry} />;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">{labels.title}</CardTitle>
          <CardDescription>{labels.description}</CardDescription>
        </div>
        <Badge variant="outline" className="shrink-0 normal-case tracking-normal">
          {labels.tiers}: {recoveryTiers.length}
        </Badge>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {recoveryTiers.map((tier) => (
              <TierCard
                key={tier.tier}
                tier={tier}
                recommended={tier.tier.toLowerCase() === highlighted}
                labels={labels}
              />
            ))}
          </div>
        ) : (
          <EmptyLine icon={Layers} text={labels.noTiers} />
        )}
      </CardContent>
    </Card>
  );
}

function TierCard({
  tier,
  recommended,
  labels,
}: {
  tier: DRRecoveryTierProfile;
  recommended: boolean;
  labels: CatalogLabels;
}) {
  return (
    <div
      className={cn(
        'flex h-full flex-col rounded-lg border bg-card p-4',
        recommended && 'border-primary/60 ring-1 ring-primary/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{prettify(tier.tier)}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {prettify(tier.recommended_strategy)}
          </p>
        </div>
        {recommended ? (
          <Badge variant="success" className="shrink-0 normal-case tracking-normal">
            <Sparkles className="me-1 h-3 w-3" aria-hidden />
            {labels.recommended}
          </Badge>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Datum icon={TimerReset} label={labels.rto} value={formatObjectiveDuration(tier.rto_seconds)} />
        <Datum icon={Database} label={labels.rpo} value={formatObjectiveDuration(tier.rpo_seconds)} />
        <Datum
          icon={TimerReset}
          label={labels.validation}
          value={formatObjectiveDuration(tier.minimum_validation_cadence_seconds)}
        />
        <RequirementDatum
          label={labels.cyberVault}
          required={tier.requires_cyber_vault}
          requiredLabel={labels.required}
          optionalLabel={labels.notRequired}
        />
      </dl>

      <div className="mt-2 flex items-center gap-2 text-xs">
        <ShieldCheck
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            tier.requires_clean_room ? 'text-warning-700 dark:text-warning-300' : 'text-muted-foreground',
          )}
          aria-hidden
        />
        <span className="text-muted-foreground">
          {labels.cleanRoom}:{' '}
          <span className={cn('font-medium', tier.requires_clean_room ? 'text-warning-700 dark:text-warning-300' : 'text-foreground')}>
            {tier.requires_clean_room ? labels.required : labels.notRequired}
          </span>
        </span>
      </div>

      {tier.capabilities.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-muted-foreground">{labels.capabilities}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tier.capabilities.slice(0, 6).map((capability) => (
              <Badge key={capability} variant="outline" className="normal-case tracking-normal">
                {prettify(capability)}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {tier.notes.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
          {tier.notes.slice(0, 3).map((note, index) => (
            <li key={`${tier.tier}-note-${index}`} className="leading-5">
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Datum({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}

function RequirementDatum({
  label,
  required,
  requiredLabel,
  optionalLabel,
}: {
  label: string;
  required: boolean;
  requiredLabel: string;
  optionalLabel: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 truncate font-medium', required ? 'text-warning-700 dark:text-warning-300' : 'text-foreground')}>
        {required ? requiredLabel : optionalLabel}
      </dd>
    </div>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0">{text}</span>
    </div>
  );
}
