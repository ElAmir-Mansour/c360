'use client';

import { useMemo, useState } from 'react';
import {
  MoreHorizontal,
  KeyRound,
  PauseCircle,
  PlayCircle,
  Download,
  Building2,
} from 'lucide-react';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import { useFleetLicenses, type PlatformListParams } from '@/hooks/use-platform';
import type { FleetLicenseRow } from '@/types/platform';

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type LicenseRow = FleetLicenseRow & Record<string, unknown>;
import {
  useSuspendTenantLicense,
  useResumeTenantLicense,
  useIssueOfflineLicense,
} from '../_lib/use-license-plans';
import { licenseStateConfig, formatSeats, isOverSeats } from '../_lib/license-state';
import { AssignLicenseDialog } from './assign-license-dialog';
import { OfflineLicenseDialog } from './offline-license-dialog';

function tenantLabel(row: FleetLicenseRow): string {
  return row.tenant_name || row.tenant_slug || row.tenant_id;
}

export function TenantLicensesTab() {
  const t = useT();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');

  const STATE_FILTERS = [
    { value: 'all', label: t('platformConsole.licensing.filterAllStates') },
    { value: 'active', label: t('platformConsole.licensing.stateActive') },
    { value: 'suspended', label: t('platformConsole.licensing.stateSuspended') },
  ] as const;

  const stateConfig = licenseStateConfig(t);

  // status filter maps to the backend license `status` (active|suspended).
  const params = useMemo<PlatformListParams | undefined>(
    () => (stateFilter === 'all' ? undefined : { status: [stateFilter] }),
    [stateFilter],
  );
  const { data, isLoading, isError, error, refetch } = useFleetLicenses(params);

  const suspend = useSuspendTenantLicense();
  const resume = useResumeTenantLicense();
  const issueOffline = useIssueOfflineLicense();

  const [assignFor, setAssignFor] = useState<FleetLicenseRow | null>(null);
  const [suspendFor, setSuspendFor] = useState<FleetLicenseRow | null>(null);
  const [resumeFor, setResumeFor] = useState<FleetLicenseRow | null>(null);
  const [offlineLabel, setOfflineLabel] = useState('');
  const [offlineFile, setOfflineFile] = useState<string | null>(null);
  const [offlineOpen, setOfflineOpen] = useState(false);

  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        message={t('platformConsole.licensing.licensesError')}
      />
    );
  }

  // Foundation hook is typed PaginatedResponse<FleetLicenseRow>; rows live on .data.
  const allRows = data?.data ?? [];
  const rows =
    search.trim() === ''
      ? allRows
      : allRows.filter((r) =>
          tenantLabel(r).toLowerCase().includes(search.trim().toLowerCase()),
        );

  const handleOffline = async (row: FleetLicenseRow) => {
    setOfflineLabel(tenantLabel(row));
    setOfflineFile(null);
    setOfflineOpen(true);
    try {
      const res = await issueOffline.mutateAsync({ tenantId: row.tenant_id });
      setOfflineFile(res.license_file);
    } catch (e) {
      setOfflineOpen(false);
      toast.error(parseApiError(e));
    }
  };

  const columns: Column<FleetLicenseRow>[] = [
    {
      key: 'tenant',
      header: t('platformConsole.licensing.colTenant'),
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-foreground">{tenantLabel(r)}</div>
          {r.tenant_slug && (
            <div className="font-mono text-xs text-muted-foreground">{r.tenant_slug}</div>
          )}
        </div>
      ),
    },
    {
      key: 'plan',
      header: t('platformConsole.licensing.colPlan'),
      render: (r) => (
        <span className="text-sm">
          {r.plan_name ?? r.plan_key ?? '—'}
        </span>
      ),
    },
    {
      key: 'state',
      header: t('platformConsole.licensing.colState'),
      // Server-computed state — render only, never recompute (§E.4).
      render: (r) => <StatusBadge status={r.state} config={stateConfig} />,
    },
    {
      key: 'seats',
      header: t('platformConsole.licensing.colSeats'),
      align: 'right',
      render: (r) => (
        <span
          className={
            isOverSeats(r.seats_used, r.seats)
              ? 'tabular-nums font-medium text-destructive'
              : 'tabular-nums'
          }
        >
          {formatSeats(r.seats_used, r.seats)}
        </span>
      ),
    },
    {
      key: 'expires_at',
      header: t('platformConsole.licensing.colExpires'),
      render: (r) =>
        r.expires_at ? (
          <span className="text-sm text-muted-foreground">
            {new Date(r.expires_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t('platformConsole.licensing.rowActionsAria').replace('{tenant}', tenantLabel(r))}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => setAssignFor(r)}>
              <KeyRound className="me-2 h-4 w-4" aria-hidden />
              {t('platformConsole.licensing.assignChange')}
            </DropdownMenuItem>
            {r.state === 'suspended' ? (
              <DropdownMenuItem onSelect={() => setResumeFor(r)}>
                <PlayCircle className="me-2 h-4 w-4" aria-hidden />
                {t('platformConsole.licensing.resumeLicense')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => setSuspendFor(r)}>
                <PauseCircle className="me-2 h-4 w-4" aria-hidden />
                {t('platformConsole.licensing.suspendLicense')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void handleOffline(r)}>
              <Download className="me-2 h-4 w-4" aria-hidden />
              {t('platformConsole.licensing.issueOffline')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('platformConsole.licensing.searchTenants')}
          aria-label={t('platformConsole.licensing.searchTenants')}
          className="max-w-xs"
        />
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-40" aria-label={t('platformConsole.licensing.filterByState')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATE_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t('platformConsole.licensing.licensesEmptyTitle')}
          description={t('platformConsole.licensing.licensesEmptyDesc')}
        />
      ) : (
        <SimpleTable<LicenseRow>
          columns={columns as Column<LicenseRow>[]}
          data={rows as LicenseRow[]}
          loading={isLoading}
          getRowKey={(r) => r.tenant_id}
          ariaLabel={t('platformConsole.licensing.tenantLicenses')}
          emptyMessage={t('platformConsole.licensing.licensesEmptyTitle')}
        />
      )}

      {/* Assign / change */}
      <AssignLicenseDialog
        open={assignFor !== null}
        onOpenChange={(o) => !o && setAssignFor(null)}
        tenantId={assignFor?.tenant_id ?? ''}
        tenantLabel={assignFor ? tenantLabel(assignFor) : ''}
        currentSeatsUsed={assignFor?.seats_used}
        currentPlanKey={assignFor?.plan_key}
        currentSeats={assignFor?.seats}
      />

      {/* Suspend */}
      <ConfirmDialog
        open={suspendFor !== null}
        onOpenChange={(o) => !o && setSuspendFor(null)}
        title={t('platformConsole.licensing.suspendLicense')}
        description={t('platformConsole.licensing.suspendConfirm').replace(
          '{tenant}',
          suspendFor ? tenantLabel(suspendFor) : '',
        )}
        confirmLabel={t('platformConsole.licensing.suspend')}
        variant="destructive"
        loading={suspend.isPending}
        onConfirm={async () => {
          if (!suspendFor) return;
          try {
            await suspend.mutateAsync({ tenantId: suspendFor.tenant_id });
            toast.success(t('platformConsole.licensing.suspendedToast'));
            setSuspendFor(null);
          } catch (e) {
            toast.error(parseApiError(e));
            throw e;
          }
        }}
      />

      {/* Resume */}
      <ConfirmDialog
        open={resumeFor !== null}
        onOpenChange={(o) => !o && setResumeFor(null)}
        title={t('platformConsole.licensing.resumeLicense')}
        description={t('platformConsole.licensing.resumeConfirm').replace(
          '{tenant}',
          resumeFor ? tenantLabel(resumeFor) : '',
        )}
        confirmLabel={t('platformConsole.licensing.resume')}
        loading={resume.isPending}
        onConfirm={async () => {
          if (!resumeFor) return;
          try {
            await resume.mutateAsync({ tenantId: resumeFor.tenant_id });
            toast.success(t('platformConsole.licensing.resumedToast'));
            setResumeFor(null);
          } catch (e) {
            toast.error(parseApiError(e));
            throw e;
          }
        }}
      />

      {/* Offline license result */}
      <OfflineLicenseDialog
        open={offlineOpen}
        onOpenChange={setOfflineOpen}
        tenantLabel={offlineLabel}
        licenseFile={offlineFile}
      />
    </div>
  );
}
