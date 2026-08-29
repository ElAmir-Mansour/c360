'use client';

import { AlertTriangle, CheckCircle2, Clock3, GitCommitHorizontal, KeyRound, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { type StatTone } from '@/components/shared/stat-card';
import { type ConnectionTestResult } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface WizardStepTestProps {
  loading: boolean;
  connectionLabel: string;
  result: ConnectionTestResult | null;
  error: string | null;
  onEditConnection: () => void;
  onRetry: () => void;
  onContinueWithoutDetails: () => void;
}

export function WizardStepTest({
  loading,
  connectionLabel,
  result,
  error,
  onEditConnection,
  onRetry,
  onContinueWithoutDetails,
}: WizardStepTestProps) {
  const labels = useDataLabels();
  // Warnings tile reflects test health: clean (0) reads as success, otherwise risk.
  const warningsTone: StatTone = (result?.warnings?.length ?? 0) > 0 ? 'rose' : 'emerald';

  return (
    <div className="space-y-4">
      {loading ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center gap-3 py-8">
            <Spinner />
            <div>
              <p className="font-medium">{labels.sources.testingConnectionTo(connectionLabel)}</p>
              <p className="text-sm text-muted-foreground">{labels.sources.provisioningVerifying}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result?.success ? (
        <div className="space-y-4">
          <Alert className="border-primary/30 bg-primary/10">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">{labels.sources.connectedSuccessfully}</AlertTitle>
            <AlertDescription className="text-primary">{result.message}</AlertDescription>
          </Alert>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {/* Latency is a duration -> gold; version/permissions are structural
                metadata -> slate; warnings reflect health -> emerald when clean,
                rose when the test surfaced issues. */}
            <DetailStatCard label={labels.sources.mLatency} value={`${result.latency_ms}ms`} tone="gold" icon={Clock3} />
            <DetailStatCard label={labels.sources.mVersion} value={result.version || labels.sources.unknown} tone="slate" icon={GitCommitHorizontal} />
            <DetailStatCard label={labels.sources.mPermissions} value={result.permissions?.join(', ') || labels.sources.readAccessConfirmed} tone="slate" icon={KeyRound} />
            <DetailStatCard
              label={labels.sources.mWarnings}
              value={`${result.warnings?.length ?? 0}`}
              tone={warningsTone}
              icon={warningsTone === 'rose' ? TriangleAlert : CheckCircle2}
            />
          </div>
          {(result.warnings ?? []).length > 0 ? (
            <div className="space-y-2">
              {(result.warnings ?? []).map((warning) => (
                <Alert key={warning} className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <AlertTriangle className="h-4 w-4 text-warning-700 dark:text-warning-300" />
                  <AlertTitle className="text-warning-700 dark:text-warning-300">{labels.common.warning}</AlertTitle>
                  <AlertDescription className="text-warning-700 dark:text-warning-300">{warning}</AlertDescription>
                </Alert>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Alert className="border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30">
          <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          <AlertTitle className="text-rose-700 dark:text-rose-300">{labels.sources.connectionFailed}</AlertTitle>
          <AlertDescription className="space-y-2 text-rose-700 dark:text-rose-300">
            <p>{error}</p>
            <p>{labels.sources.checkServiceReachable}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onEditConnection}>
                {labels.sources.editConnection}
              </Button>
              <Button type="button" onClick={onRetry}>
                {labels.common.retry}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Button type="button" variant="ghost" onClick={onContinueWithoutDetails} className="px-0 text-destructive">
        <Clock3 className="me-1.5 h-4 w-4" />
        {labels.sources.continueWithoutDetails}
      </Button>
    </div>
  );
}
