'use client';

import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  PowerOff,
  RefreshCw,
  Settings2,
  TestTube2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  type IntegrationHealthSummary,
  useIntegrationHealthLabels,
} from './integration-health';

/**
 * Connection-health roll-up header for the DR integrations route.
 *
 * Surfaces the #active / #configured / #untested / #errored / #disabled counts
 * across all configured connectors plus a "Test all connections" action that
 * fans out the REAL per-integration connection test (dr:write-gated by the
 * caller). Tone is paired with an icon and a visible label so meaning is never
 * carried by color alone (WCAG 1.4.1); all spacing uses logical properties so
 * the strip mirrors correctly under RTL.
 */
export interface IntegrationHealthHeaderProps {
  summary: IntegrationHealthSummary;
  /** True while a write action is allowed (gated on dr:write upstream). */
  canWrite: boolean;
  /** True while one or more connection tests are in flight. */
  testingAll: boolean;
  onTestAll: () => void;
}

interface HealthStat {
  key: keyof Omit<IntegrationHealthSummary, 'total'>;
  label: string;
  icon: LucideIcon;
  tone: string;
}

export function IntegrationHealthHeader({
  summary,
  canWrite,
  testingAll,
  onTestAll,
}: IntegrationHealthHeaderProps) {
  const copy = useIntegrationHealthLabels();

  const stats: HealthStat[] = [
    {
      key: 'active',
      label: copy.countActive,
      icon: CheckCircle2,
      tone: 'text-success-700 dark:text-success-300',
    },
    {
      key: 'configured',
      label: copy.countConfigured,
      icon: Settings2,
      tone: 'text-blue-700 dark:text-blue-400',
    },
    {
      key: 'untested',
      label: copy.countUntested,
      icon: CircleDashed,
      tone: 'text-muted-foreground',
    },
    {
      key: 'error',
      label: copy.countError,
      icon: AlertCircle,
      tone: 'text-error-700 dark:text-error-300',
    },
    {
      key: 'disabled',
      label: copy.countDisabled,
      icon: PowerOff,
      tone: 'text-muted-foreground',
    },
  ];

  const hasIntegrations = summary.total > 0;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>{copy.healthHeading}</CardTitle>
          <CardDescription>{copy.healthDescription}</CardDescription>
        </div>
        {canWrite ? (
          <Button
            variant="outline"
            onClick={onTestAll}
            disabled={!hasIntegrations || testingAll}
          >
            {testingAll ? (
              <RefreshCw className="me-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <TestTube2 className="me-2 h-4 w-4" aria-hidden />
            )}
            {testingAll
              ? copy.testAllRunning
              : hasIntegrations
                ? copy.testAll
                : copy.testAllEmpty}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <HealthCounter
            label={copy.countTotal}
            value={summary.total}
            tone="text-foreground"
          />
          {stats.map((stat) => (
            <HealthCounter
              key={stat.key}
              label={stat.label}
              value={summary[stat.key]}
              icon={stat.icon}
              tone={stat.tone}
            />
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function HealthCounter({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon?: LucideIcon;
  tone: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon ? <Icon className={cn('h-3.5 w-3.5 shrink-0', tone)} aria-hidden /> : null}
        {label}
      </dt>
      <dd className={cn('mt-1 text-2xl font-semibold tabular-nums', tone)}>{value}</dd>
    </div>
  );
}
