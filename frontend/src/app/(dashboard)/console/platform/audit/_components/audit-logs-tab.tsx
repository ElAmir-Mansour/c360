'use client';

import { useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { Building2, Filter, ScrollText } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SimpleTable } from '@/components/shared/simple-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { RelativeTime } from '@/components/shared/relative-time';
import { SeverityIndicator, type Severity } from '@/components/shared/severity-indicator';
import { DetailPanel } from '@/components/shared/detail-panel';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { CopyButton } from '@/components/shared/copy-button';
import { useT } from '@/components/providers/locale-provider';
import { usePlatformAuditLogs, type AuditQueryParams } from '@/hooks/use-platform';
import { formatDateTime } from '@/lib/format';
import type { AuditAdminLog } from '@/types/platform';

const SERVICE_VALUES = [
  '',
  'iam-service',
  'cyber-service',
  'data-service',
  'file-service',
  'notification-service',
  'audit-service',
  'licensing-service',
] as const;

const SEVERITY_VALUES = ['', 'critical', 'high', 'medium', 'low'] as const;

function resolveSeverity(value?: string): Severity {
  switch (value) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}

export function AuditLogsTab() {
  const t = useT();
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const thirtyDaysAgo = useMemo(
    () => format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    [],
  );

  const serviceLabel = (value: string): string =>
    value === ''
      ? t('platformConsole.audit.allServices')
      : t(`platformConsole.audit.svc_${value.replace('-service', '')}` as never);

  const severityLabel = (value: string): string =>
    value === ''
      ? t('platformConsole.audit.allSeverities')
      : t(`platformConsole.audit.sev_${value}` as never);

  const [search, setSearch] = useState('');
  const [service, setService] = useState('');
  const [severity, setSeverity] = useState('');
  const [actor, setActor] = useState('');
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditAdminLog | null>(null);

  const params = useMemo<AuditQueryParams>(
    () => ({
      all_tenants: true,
      service: service || undefined,
      severity: severity || undefined,
      actor: actor || undefined,
      action: search || undefined,
      date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      date_to: dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : undefined,
      page,
      per_page: 50,
    }),
    [service, severity, actor, search, dateFrom, dateTo, page],
  );

  const { data, isLoading, error, refetch, isFetching } =
    usePlatformAuditLogs(params);

  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? rows.length;
  const totalPages = data?.meta?.total_pages ?? 1;

  const columns = useMemo(
    () => [
      {
        key: 'created_at',
        header: t('platformConsole.audit.colTimestamp'),
        render: (row: AuditAdminLog) => <RelativeTime date={row.created_at} />,
      },
      {
        key: 'tenant_name',
        header: t('platformConsole.audit.colTenant'),
        render: (row: AuditAdminLog) => (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <Building2
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            {row.tenant_name || (
              <code className="text-xs text-muted-foreground">
                {row.tenant_id?.slice(0, 8)}
              </code>
            )}
          </span>
        ),
      },
      {
        key: 'actor_email',
        header: t('platformConsole.audit.colActor'),
        render: (row: AuditAdminLog) => (
          <span className="text-sm">
            {row.actor_email || (
              <span className="text-muted-foreground">
                {t('platformConsole.audit.system')}
              </span>
            )}
          </span>
        ),
      },
      {
        key: 'action',
        header: t('platformConsole.audit.colAction'),
        render: (row: AuditAdminLog) => (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            {row.action}
          </code>
        ),
      },
      {
        key: 'resource_type',
        header: t('platformConsole.audit.colResource'),
        render: (row: AuditAdminLog) =>
          row.resource_type ? (
            <Badge variant="outline" className="text-xs">
              {row.resource_type}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: 'service',
        header: t('platformConsole.audit.colService'),
        render: (row: AuditAdminLog) => (
          <span className="text-xs text-muted-foreground">
            {row.service ?? '—'}
          </span>
        ),
      },
      {
        key: 'severity',
        header: t('platformConsole.audit.colSeverity'),
        render: (row: AuditAdminLog) => (
          <SeverityIndicator severity={resolveSeverity(row.severity)} size="sm" />
        ),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="logs-service" className="text-xs">
            {t('platformConsole.audit.colService')}
          </Label>
          <select
            id="logs-service"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={service}
            onChange={(e) => {
              setService(e.target.value);
              setPage(1);
            }}
          >
            {SERVICE_VALUES.map((v) => (
              <option key={v} value={v}>
                {serviceLabel(v)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="logs-severity" className="text-xs">
            {t('platformConsole.audit.colSeverity')}
          </Label>
          <select
            id="logs-severity"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
          >
            {SEVERITY_VALUES.map((v) => (
              <option key={v} value={v}>
                {severityLabel(v)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="logs-actor" className="text-xs">
            {t('platformConsole.audit.actorFilter')}
          </Label>
          <Input
            id="logs-actor"
            value={actor}
            placeholder={t('platformConsole.audit.actorPlaceholder')}
            className="h-9"
            onChange={(e) => {
              setActor(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="logs-from" className="text-xs">
            {t('platformConsole.audit.from')}
          </Label>
          <Input
            id="logs-from"
            type="date"
            className="h-9"
            value={dateFrom}
            max={dateTo}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="logs-to" className="text-xs">
            {t('platformConsole.audit.to')}
          </Label>
          <Input
            id="logs-to"
            type="date"
            className="h-9"
            value={dateTo}
            min={dateFrom}
            max={today}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={t('platformConsole.audit.searchActionPlaceholder')}
          loading={isFetching}
        />
        <span
          className="shrink-0 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <Filter className="me-1 inline h-3 w-3" aria-hidden />
          {t('platformConsole.audit.eventCount').replace(
            '{count}',
            total.toLocaleString(),
          )}
        </span>
      </div>

      {error ? (
        <ErrorState
          error={error}
          variant={detectVariant(error)}
          onRetry={() => refetch()}
          title={t('platformConsole.audit.logsErrorTitle')}
          message={t('platformConsole.audit.logsErrorMessage')}
        />
      ) : !isLoading && rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t('platformConsole.audit.noEventsTitle')}
          description={t('platformConsole.audit.noEventsDescription')}
        />
      ) : (
        <>
          <SimpleTable<AuditAdminLog & Record<string, unknown>>
            columns={columns}
            data={rows as Array<AuditAdminLog & Record<string, unknown>>}
            loading={isLoading}
            ariaLabel={t('platformConsole.audit.tableLabel')}
            getRowKey={(row) => row.id}
            onRowClick={(row) => setSelected(row)}
            emptyMessage={t('platformConsole.audit.noEventsTitle')}
          />
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('platformConsole.audit.previous')}
              </Button>
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {t('platformConsole.audit.pageOf')
                  .replace('{page}', String(page))
                  .replace('{total}', String(totalPages))}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('platformConsole.audit.next')}
              </Button>
            </div>
          )}
        </>
      )}

      <DetailPanel
        open={Boolean(selected)}
        onOpenChange={(o) => !o && setSelected(null)}
        title={t('platformConsole.audit.eventTitle')}
        description={selected?.action}
        width="lg"
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <Field
              label={t('platformConsole.audit.colTenant')}
              value={selected.tenant_name || selected.tenant_id}
            />
            <Field
              label={t('platformConsole.audit.colActor')}
              value={
                selected.actor_email ||
                selected.actor_id ||
                t('platformConsole.audit.system')
              }
            />
            <Field
              label={t('platformConsole.audit.colAction')}
              value={selected.action}
              mono
            />
            <Field
              label={t('platformConsole.audit.colResource')}
              value={
                selected.resource_type
                  ? `${selected.resource_type}${selected.resource_id ? ` · ${selected.resource_id}` : ''}`
                  : '—'
              }
            />
            <Field
              label={t('platformConsole.audit.colService')}
              value={selected.service ?? '—'}
            />
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t('platformConsole.audit.colSeverity')}
              </p>
              <SeverityIndicator severity={resolveSeverity(selected.severity)} />
            </div>
            <Field
              label={t('platformConsole.audit.ipAddress')}
              value={selected.ip_address ?? '—'}
              mono
            />
            <Field
              label={t('platformConsole.audit.colTimestamp')}
              value={formatDateTime(selected.created_at)}
            />

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t('platformConsole.audit.chain')}
              </p>
              <div className="space-y-1 rounded-md border bg-muted/40 p-3">
                <HashRow
                  label={t('platformConsole.audit.entryHash')}
                  value={selected.entry_hash}
                  copyLabel={t('platformConsole.audit.copyHash')}
                />
                <HashRow
                  label={t('platformConsole.audit.prevHash')}
                  value={selected.prev_hash}
                  copyLabel={t('platformConsole.audit.copyHash')}
                />
              </div>
            </div>

            {(selected.old_value != null || selected.new_value != null) && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('platformConsole.audit.change')}
                </p>
                <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
                  {JSON.stringify(
                    {
                      old: selected.old_value ?? null,
                      new: selected.new_value ?? null,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </div>
        )}
      </DetailPanel>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={mono ? 'break-all font-mono text-xs' : 'text-sm'}>
        {value || '—'}
      </p>
    </div>
  );
}

function HashRow({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value?: string;
  copyLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-1">
        <code className="break-all font-mono text-overline">
          {value ? `${value.slice(0, 16)}…` : '—'}
        </code>
        {value && <CopyButton value={value} label={copyLabel} />}
      </span>
    </div>
  );
}
