'use client';

/**
 * A grouped-by-kind card: kind icon + bilingual name/blurb, a gov-gated badge,
 * a worst-of rollup health dot, the connector count, and the list of registered
 * endpoints (each with its own Test quick-action, uptime sparkline, and bulk
 * selection checkbox). Empty kinds render an "+ Configure" CTA so an operator
 * can register their first connector.
 */
import Link from 'next/link';
import { Plus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { resolveLocalized } from '@/lib/i18n/localized';
import type {
  HealthCheckRecord,
  IntegrationEndpoint,
  IntegrationHealth,
  TestResult,
} from '@/lib/lex/integrations';
import { kindMeta } from '../_lib/integration-kinds';
import { HEALTH_DOT_CLASS, rollupGrade } from '../_lib/health-presentation';
import type { IntegrationsListLabels } from '../_lib/integrations-i18n';
import { IntegrationEndpointRow } from './integration-endpoint-row';

interface IntegrationKindCardProps {
  kind: IntegrationEndpoint['kind'];
  endpoints: IntegrationEndpoint[];
  health: Map<string, IntegrationHealth>;
  locale: 'ar' | 'en';
  direction: 'ltr' | 'rtl';
  labels: IntegrationsListLabels;
  canWrite: boolean;
  /** Build a detail/edit href for an endpoint. */
  endpointHref: (id: string) => string;
  /** Build the "configure new" href for this kind. */
  configureHref: string;
  /** Id of the endpoint currently being tested, if any. */
  testingId?: string | null;
  onTest?: (endpoint: IntegrationEndpoint) => void;
  /** Health-probe series per endpoint id (Feature 6 sparkline). */
  historyById?: Map<string, HealthCheckRecord[]>;
  /** True while the shared health-history query is loading. */
  historyLoading?: boolean;
  /** Per-endpoint health-history read failures. */
  historyDegradedById?: Map<string, boolean>;
  /** Last connection-test outcome per endpoint id (Feature 2 summary). */
  lastTestById?: Map<string, TestResult>;
  /** When true, rows render a selection checkbox (operator has MANAGE). */
  selectable?: boolean;
  /** Currently-selected endpoint ids (shared across all cards). */
  selectedIds?: Set<string>;
  onSelectChange?: (id: string, checked: boolean) => void;
  /** Toggle every endpoint in this kind on/off. */
  onSelectKind?: (ids: string[], checked: boolean) => void;
}

export function IntegrationKindCard({
  kind,
  endpoints,
  health,
  locale,
  direction,
  labels: t,
  canWrite,
  endpointHref,
  configureHref,
  testingId,
  onTest,
  historyById,
  historyLoading = false,
  historyDegradedById,
  lastTestById,
  selectable = false,
  selectedIds,
  onSelectChange,
  onSelectKind,
}: IntegrationKindCardProps) {
  const meta = kindMeta(kind);
  const Icon = meta.icon;
  const rollup = rollupGrade(endpoints, health);
  const isEmpty = endpoints.length === 0;

  const ids = endpoints.map((ep) => ep.id);
  const selectedInKind = ids.filter((id) => selectedIds?.has(id)).length;
  const allSelected = !isEmpty && selectedInKind === ids.length;
  const someSelected = selectedInKind > 0 && !allSelected;

  return (
    <div className="card flex flex-col gap-4 p-5" data-testid="integration-kind-card" data-kind={kind}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary/70',
            meta.accent,
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {resolveLocalized(meta.name, locale)}
            </h3>
            {rollup ? (
              <span
                role="img"
                className={cn('h-2 w-2 shrink-0 rounded-full', HEALTH_DOT_CLASS[rollup])}
                title={t.grade[rollup]}
                aria-label={t.grade[rollup]}
              />
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {resolveLocalized(meta.blurb, locale)}
          </p>
        </div>
        {meta.govGated ? (
          <span className="badge-warning inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold">
            <ShieldAlert className="h-3 w-3" aria-hidden />
            {t.govGated}
          </span>
        ) : null}
      </div>

      {/* Count + per-kind select-all */}
      <div className="flex items-center justify-between text-overline uppercase text-muted-foreground">
        <span>{isEmpty ? t.noConnectors : t.connectorsCount(endpoints.length)}</span>
        {selectable && !isEmpty ? (
          <label className="flex cursor-pointer items-center gap-1.5 normal-case">
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={(v) => onSelectKind?.(ids, v === true)}
              aria-label={t.bulkSelectAll}
            />
            <span>{t.bulkSelectAll}</span>
          </label>
        ) : null}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/70 px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">{t.configureFirst}</p>
          {canWrite ? (
            <Button asChild size="sm" variant="outline">
              <Link href={configureHref}>
                <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {t.configure}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {endpoints.map((ep) => (
            <IntegrationEndpointRow
              key={ep.id}
              endpoint={ep}
              probe={health.get(ep.id)}
              href={endpointHref(ep.id)}
              locale={locale}
              direction={direction}
              labels={t}
              canWrite={canWrite}
              testing={testingId === ep.id}
              onTest={onTest ? () => onTest(ep) : undefined}
              history={historyById?.get(ep.id)}
              historyLoading={historyLoading}
              historyDegraded={historyDegradedById?.get(ep.id) ?? false}
              lastTest={lastTestById?.get(ep.id) ?? null}
              selectable={selectable}
              selected={selectedIds?.has(ep.id) ?? false}
              onSelectChange={
                onSelectChange ? (checked) => onSelectChange(ep.id, checked) : undefined
              }
            />
          ))}
          {canWrite ? (
            <Button asChild size="sm" variant="ghost" className="mt-1 self-start">
              <Link href={configureHref}>
                <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {t.configure}
              </Link>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default IntegrationKindCard;
