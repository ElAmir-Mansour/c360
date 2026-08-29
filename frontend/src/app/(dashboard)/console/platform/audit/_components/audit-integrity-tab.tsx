'use client';

import { useState } from 'react';
import { format, subDays } from 'date-fns';
import {
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { SimpleTable } from '@/components/shared/simple-table';
import { MetricTile } from '@/components/shared/metric-tile';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useT } from '@/components/providers/locale-provider';
import { showSuccess, showWarning, showApiError } from '@/lib/toast';
import { formatDateTime, formatNumber } from '@/lib/format';
import {
  usePlatformIntegrityStatus,
  usePlatformVerify,
  type PlatformTenantIntegrity,
  type PlatformVerifyResult,
} from './use-platform-audit';

export function AuditIntegrityTab() {
  const t = useT();
  const today = format(new Date(), 'yyyy-MM-dd');
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [lastRun, setLastRun] = useState<PlatformVerifyResult | null>(null);

  const status = usePlatformIntegrityStatus();
  const verify = usePlatformVerify();

  const handleVerify = () => {
    verify.mutate(
      {
        date_from: new Date(dateFrom).toISOString(),
        date_to: new Date(dateTo + 'T23:59:59').toISOString(),
      },
      {
        onSuccess: (res) => {
          setLastRun(res);
          if (res.verified) {
            showSuccess(t('platformConsole.audit.verifyPassedToast'));
          } else {
            showWarning(t('platformConsole.audit.verifyFailedToast'));
          }
        },
        onError: (err) => showApiError(err),
      },
    );
  };

  // Prefer the just-run result; otherwise fall back to the persisted status.
  const summary =
    lastRun ??
    (status.data
      ? {
          verified: status.data.verified,
          total_records: status.data.total_records,
          verified_records: status.data.verified_records,
          tenants_checked: status.data.tenants_checked,
          tenants_failed: status.data.tenants_failed,
          verified_at: status.data.last_run_at ?? '',
          tenants: status.data.tenants ?? [],
        }
      : null);

  const tenantRows = summary?.tenants ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">
                  {t('platformConsole.audit.verifyCardTitle')}
                </CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('platformConsole.audit.verifyCardSubtitle')}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="verify-from" className="text-xs">
                  {t('platformConsole.audit.from')}
                </Label>
                <Input
                  id="verify-from"
                  type="date"
                  value={dateFrom}
                  max={dateTo}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="verify-to" className="text-xs">
                  {t('platformConsole.audit.to')}
                </Label>
                <Input
                  id="verify-to"
                  type="date"
                  value={dateTo}
                  min={dateFrom}
                  max={today}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            {verify.isPending && (
              <div className="space-y-2 py-2" aria-live="polite">
                <p className="text-center text-xs text-muted-foreground">
                  {t('platformConsole.audit.verifyingFleet')}
                </p>
                <Progress value={undefined} className="h-2 animate-pulse" />
              </div>
            )}

            <Button
              onClick={handleVerify}
              disabled={verify.isPending || !dateFrom || !dateTo}
              className="w-full"
            >
              <ShieldCheck className="me-2 h-4 w-4" aria-hidden />
              {verify.isPending
                ? t('platformConsole.audit.verifying')
                : t('platformConsole.audit.runVerification')}
            </Button>

            {status.data?.last_run_at && (
              <p className="text-center text-xs text-muted-foreground">
                {t('platformConsole.audit.lastRun').replace(
                  '{time}',
                  formatDateTime(status.data.last_run_at),
                )}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {status.isLoading && !summary ? (
            <LoadingSkeleton variant="card" count={1} />
          ) : status.error && !lastRun ? (
            <ErrorState
              error={status.error}
              variant={detectVariant(status.error)}
              onRetry={() => status.refetch()}
              title={t('platformConsole.audit.integrityErrorTitle')}
              message={t('platformConsole.audit.integrityErrorMessage')}
            />
          ) : summary ? (
            <>
              <div
                className={`flex items-center gap-3 rounded-lg border p-4 ${
                  summary.verified
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-destructive/30 bg-destructive/5'
                }`}
                role="status"
              >
                {summary.verified ? (
                  <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden />
                ) : (
                  <ShieldAlert
                    className="h-6 w-6 text-destructive"
                    aria-hidden
                  />
                )}
                <div>
                  <p className="text-sm font-semibold">
                    {summary.verified
                      ? t('platformConsole.audit.chainVerified')
                      : t('platformConsole.audit.violationDetected')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {summary.verified_at
                      ? t('platformConsole.audit.asOf').replace(
                          '{time}',
                          formatDateTime(summary.verified_at),
                        )
                      : t('platformConsole.audit.noPriorRun')}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricTile
                  label={t('platformConsole.audit.tenantsChecked')}
                  value={summary.tenants_checked}
                  tone="primary"
                />
                <MetricTile
                  label={t('platformConsole.audit.tenantsFailed')}
                  value={summary.tenants_failed}
                  tone={summary.tenants_failed > 0 ? 'danger' : 'success'}
                />
                <MetricTile
                  label={t('platformConsole.audit.recordsVerified')}
                  value={formatNumber(summary.verified_records)}
                  tone="primary"
                />
                <MetricTile
                  label={t('platformConsole.audit.totalRecords')}
                  value={formatNumber(summary.total_records)}
                  tone="info"
                />
              </div>

              {tenantRows.length > 0 && (
                <SimpleTable<PlatformTenantIntegrity & Record<string, unknown>>
                  ariaLabel={t('platformConsole.audit.perTenantLabel')}
                  getRowKey={(r) => r.tenant_id}
                  data={
                    tenantRows as Array<
                      PlatformTenantIntegrity & Record<string, unknown>
                    >
                  }
                  columns={[
                    {
                      key: 'tenant_name',
                      header: t('platformConsole.audit.colTenant'),
                      render: (r) => (
                        <span className="text-sm font-medium">
                          {r.tenant_name || r.tenant_id}
                        </span>
                      ),
                    },
                    {
                      key: 'verified',
                      header: t('platformConsole.audit.colStatus'),
                      render: (r) =>
                        r.verified ? (
                          <Badge
                            variant="outline"
                            className="gap-1 border-primary/30 text-primary"
                          >
                            <CheckCircle2 className="h-3 w-3" aria-hidden />
                            {t('platformConsole.audit.verified')}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="gap-1 border-destructive/30 text-destructive"
                          >
                            <XCircle className="h-3 w-3" aria-hidden />
                            {t('platformConsole.audit.broken')}
                          </Badge>
                        ),
                    },
                    {
                      key: 'verified_records',
                      header: t('platformConsole.audit.colRecords'),
                      align: 'right',
                      render: (r) => (
                        <span className="tabular-nums text-sm">
                          {formatNumber(r.verified_records)} /{' '}
                          {formatNumber(r.total_records)}
                        </span>
                      ),
                    },
                    {
                      key: 'broken_chain_at',
                      header: t('platformConsole.audit.colBrokeAt'),
                      render: (r) =>
                        r.broken_chain_at ? (
                          <Link
                            href={`/platform/audit?log=${r.broken_chain_at}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {String(r.broken_chain_at).slice(0, 12)}…
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        ),
                    },
                  ]}
                />
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <div>
                <ShieldCheck
                  className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50"
                  aria-hidden
                />
                <p className="text-sm font-medium">
                  {t('platformConsole.audit.noRunYetTitle')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('platformConsole.audit.noRunYetDescription')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
