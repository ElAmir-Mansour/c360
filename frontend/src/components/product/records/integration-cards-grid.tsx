'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  PlugZap,
  Plus,
  RefreshCw,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { IconBadge } from '@/components/shared/icon-badge';
import { EmptyState } from '@/components/common/empty-state';
import { StatusChip, type StatusChipProps } from '@/components/shared/status-chip';
import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { formatTimestamp } from './format';

/**
 * IntegrationCardsGrid
 * ====================
 * The ClarioDR connector framework as a responsive grid of integration cards.
 * Each card describes one outbound connector (notifications, ticketing,
 * on-call, or generic webhook/REST/email) with its connection status, icon,
 * and a single primary action (connect when available, configure/reconnect
 * when connected, fix when errored).
 *
 * Status is rendered with a `StatusChip` so connectivity is never conveyed by
 * color alone (WCAG 1.4.1). The grid reflows 3 → 2 → 1 columns and each card
 * exposes its name as a heading; the action is a real, keyboard-reachable
 * button wired to `onConfigure`.
 *
 * Content (names, descriptions, labels) arrives via props so the grid is
 * bilingual-ready; tokens only; RTL-aware. The card-grid grammar mirrors the
 * Phase-2 marketing card row (rounded-card / border-outline-subtle /
 * shadow-elevation with hover lift).
 */

export type IntegrationStatus = 'connected' | 'available' | 'error';

/** A connector descriptor. Maps to the platform's connector registry shape. */
export interface IntegrationDescriptor {
  /** Stable registry key (e.g. `slack`, `pagerduty`, `webhook`). */
  id: string;
  /** Display name (bilingual via caller). */
  name: string;
  /** One-line description of what the connector delivers. */
  description: string;
  /** Connector category, surfaced as a small eyebrow. */
  category: string;
  status: IntegrationStatus;
  /** Brand/glyph icon for the connector. */
  icon: LucideIcon;
  /** Error detail to show when `status === 'error'`. */
  errorDetail?: string;
  /** ISO timestamp / Date of last successful delivery, when connected. */
  lastConnectedAt?: string | Date | null;
}

export interface IntegrationCardsLabels {
  /** Accessible name for the grid region. */
  ariaLabel: string;
  /** Status chip labels. */
  statusConnected: string;
  statusAvailable: string;
  statusError: string;
  /** Per-status action button labels. */
  actionConnect: string;
  actionConfigure: string;
  actionFix: string;
  /** Meta labels. */
  lastConnectedLabel: string;
  /** Empty state. */
  emptyTitle: string;
  emptyDescription: string;
}

/** Keys of the always-present string labels (everything except optional copy). */
type RequiredLabelKey = keyof IntegrationCardsLabels;

export interface IntegrationCardsGridProps {
  integrations: IntegrationDescriptor[];
  /** Optional section heading (rendered as H2) above the grid. */
  heading?: string;
  /** Optional supporting paragraph beneath the heading. */
  description?: string;
  /**
   * Invoked when a card's primary action is activated. Receives the descriptor
   * so the caller can open the right configure/connect flow.
   */
  onConfigure?: (integration: IntegrationDescriptor) => void;
  labels?: Partial<IntegrationCardsLabels>;
  className?: string;
}

const DEFAULT_LABELS: IntegrationCardsLabels = {
  ariaLabel: 'Integrations',
  statusConnected: 'Connected',
  statusAvailable: 'Available',
  statusError: 'Error',
  actionConnect: 'Connect',
  actionConfigure: 'Configure',
  actionFix: 'Fix connection',
  lastConnectedLabel: 'Last delivered',
  emptyTitle: 'No integrations',
  emptyDescription: 'Connect a channel to route recovery alerts, approvals, and attestations.',
};

const STATUS_META: Record<
  IntegrationStatus,
  {
    tone: NonNullable<StatusChipProps['tone']>;
    icon: LucideIcon;
    labelKey: RequiredLabelKey;
    actionKey: RequiredLabelKey;
    actionIcon: LucideIcon;
    actionVariant: React.ComponentProps<typeof Button>['variant'];
    badgeTone: React.ComponentProps<typeof IconBadge>['tone'];
  }
> = {
  connected: {
    tone: 'success',
    icon: CheckCircle2,
    labelKey: 'statusConnected',
    actionKey: 'actionConfigure',
    actionIcon: Settings2,
    actionVariant: 'outline',
    badgeTone: 'success',
  },
  available: {
    tone: 'neutral',
    icon: PlugZap,
    labelKey: 'statusAvailable',
    actionKey: 'actionConnect',
    actionIcon: Plus,
    actionVariant: 'default',
    badgeTone: 'muted',
  },
  error: {
    tone: 'danger',
    icon: AlertTriangle,
    labelKey: 'statusError',
    actionKey: 'actionFix',
    actionIcon: RefreshCw,
    actionVariant: 'outline',
    badgeTone: 'danger',
  },
};

export function IntegrationCardsGrid({
  integrations,
  heading,
  description,
  onConfigure,
  labels: labelOverrides,
  className,
}: IntegrationCardsGridProps) {
  const { locale } = useLocale();
  const headingId = React.useId();
  const labels = React.useMemo<IntegrationCardsLabels>(
    () => ({ ...DEFAULT_LABELS, ...labelOverrides }),
    [labelOverrides],
  );
  const hasHeading = Boolean(heading);

  if (integrations.length === 0) {
    return (
      <EmptyState
        icon={PlugZap}
        title={labels.emptyTitle}
        description={labels.emptyDescription}
        size="compact"
        className={cn('border border-dashed border-outline-subtle bg-surface-card', className)}
      />
    );
  }

  return (
    <section
      aria-labelledby={hasHeading ? headingId : undefined}
      aria-label={hasHeading ? undefined : labels.ariaLabel}
      className={cn('w-full', className)}
    >
      {(heading || description) && (
        <header className="mb-gutter flex max-w-prose flex-col gap-2">
          {heading && (
            <h2 id={headingId} className="text-h3 font-semibold text-content-primary">
              {heading}
            </h2>
          )}
          {description && (
            <p className="text-body-sm text-content-secondary">{description}</p>
          )}
        </header>
      )}

      <ul className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          const meta = STATUS_META[integration.status];
          const ActionIcon = meta.actionIcon;
          return (
            <li key={integration.id} className="flex">
              <Card
                className={cn(
                  'flex w-full flex-col border-outline-subtle bg-surface-card shadow-elevation-1',
                  'transition-all duration-normal ease-emphasized hover:shadow-elevation-3',
                  integration.status === 'error' && 'border-state-error/40',
                )}
              >
                <CardHeader className="gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <IconBadge icon={integration.icon} tone={meta.badgeTone} size="lg" />
                    <StatusChip tone={meta.tone} icon={meta.icon} label={labels[meta.labelKey]} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-overline font-semibold uppercase tracking-caps-wide text-content-muted">
                      {integration.category}
                    </p>
                    <CardTitle className="mt-1 text-h4 text-content-primary">
                      {integration.name}
                    </CardTitle>
                  </div>
                  <CardDescription className="text-body-sm text-content-secondary">
                    {integration.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="mt-auto flex flex-col gap-3">
                  {integration.status === 'error' && integration.errorDetail && (
                    <p
                      role="alert"
                      className="rounded-button bg-state-error/10 px-3 py-2 text-caption text-state-error"
                    >
                      {integration.errorDetail}
                    </p>
                  )}
                  {integration.status === 'connected' && integration.lastConnectedAt && (
                    <p className="flex items-center gap-1.5 text-caption text-content-muted">
                      <span className="font-semibold uppercase tracking-caps">
                        {labels.lastConnectedLabel}
                      </span>
                      <span className="text-content-secondary">
                        {formatTimestamp(integration.lastConnectedAt, locale)}
                      </span>
                    </p>
                  )}
                  <Button
                    type="button"
                    variant={meta.actionVariant}
                    size="sm"
                    className="w-full justify-center gap-2"
                    onClick={() => onConfigure?.(integration)}
                  >
                    <ActionIcon className="h-4 w-4 shrink-0" aria-hidden />
                    {labels[meta.actionKey]}
                    <span className="sr-only"> — {integration.name}</span>
                  </Button>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default IntegrationCardsGrid;
