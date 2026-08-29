'use client';

// Platform Console — Screen 2: Tenant Management list (§E.2).
//
// KPI row (G3 estate rollup) + status/tier filters + search over the G2 admin
// list (AdminTenantSummary, with aggregates: user counts, seats, license state,
// last activity). Per-row lifecycle actions (provision/reprovision/deprovision/
// reactivate/suspend/unsuspend/impersonate) live in <TenantRowActions/>. The
// /platform/layout already gates on `admin:console` and mounts the impersonation
// banner, so this page omits its own PermissionRedirect.

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { KpiCard } from '@/components/shared/kpi-card';
import { SimpleTable } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { SearchInput } from '@/components/shared/forms/search-input';
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { tenantStatusConfig, tenantPlanConfig } from '@/lib/status-configs';
import { formatBytes, formatNumber } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import { useAdminTenants, usePlatformTenantsSummary } from '@/hooks/use-platform';
import type { AdminTenantSummary } from '@/types/platform';
import { TenantRowActions } from './_components/tenant-row-actions';
import { useLicenseStateConfig } from './_components/license-state-config';

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type TenantRow = AdminTenantSummary & Record<string, unknown>;
interface TenantColumn {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  render?: (item: AdminTenantSummary) => ReactNode;
}

export default function PlatformTenantsPage() {
  const t = useT();
  const router = useRouter();
  const licenseStateConfig = useLicenseStateConfig();

  const tierOptions = [
    { value: 'free', label: t('platformConsole.tenants.tierFree') },
    { value: 'starter', label: t('platformConsole.tenants.tierStarter') },
    { value: 'professional', label: t('platformConsole.tenants.tierProfessional') },
    { value: 'enterprise', label: t('platformConsole.tenants.tierEnterprise') },
  ];

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string[]>([]);
  const [tier, setTier] = useState<string[]>([]);

  const params = useMemo(
    () => ({
      search: search || undefined,
      status: status.length ? status : undefined,
      tier: tier.length ? tier : undefined,
      sort: 'created_at',
      order: 'desc' as const,
    }),
    [search, status, tier],
  );

  const { data, isLoading, error, refetch } = useAdminTenants(params);
  const summary = usePlatformTenantsSummary();

  const tenants = data?.data ?? [];

  const view = (tnt: AdminTenantSummary) =>
    router.push(`/platform/tenants/${tnt.id}`);

  // The 6 tenant lifecycle statuses (§E.2: status multi-select of 6 enum values).
  const statusOptions = [
    { value: 'active', label: t('platformConsole.tenants.active') },
    { value: 'suspended', label: t('platformConsole.tenants.suspended') },
    { value: 'trial', label: t('platformConsole.tenants.trial') },
    { value: 'provisioning', label: t('platformConsole.overview.provisioning') },
    { value: 'deprovisioning', label: t('platformConsole.tenants.deprovisioning') },
    { value: 'deprovisioned', label: t('platformConsole.tenants.deprovisioned') },
  ];

  const columns: TenantColumn[] = [
    {
      key: 'name',
      header: t('platformConsole.tenants.title'),
      render: (tnt) => (
        <button
          className="text-start"
          onClick={(e) => {
            e.stopPropagation();
            view(tnt);
          }}
        >
          <span className="block text-sm font-medium hover:underline">{tnt.name}</span>
          <code className="text-xs font-mono text-muted-foreground">{tnt.slug}</code>
        </button>
      ),
    },
    {
      key: 'status',
      header: t('platformConsole.tenants.statusColumn'),
      render: (tnt) => (
        <StatusBadge status={tnt.status} config={tenantStatusConfig} size="sm" />
      ),
    },
    {
      key: 'subscription_tier',
      header: t('platformConsole.tenants.tier'),
      render: (tnt) => (
        <StatusBadge
          status={tnt.subscription_tier}
          config={tenantPlanConfig}
          variant="outline"
          size="sm"
        />
      ),
    },
    {
      key: 'users',
      header: t('platformConsole.tenants.users'),
      align: 'right',
      render: (tnt) => (
        <span className="tabular-nums text-sm">
          {formatNumber(tnt.active_user_count ?? 0)}
          <span className="text-muted-foreground"> / {formatNumber(tnt.user_count ?? 0)}</span>
        </span>
      ),
    },
    {
      key: 'seats',
      header: t('platformConsole.tenants.seats'),
      align: 'right',
      render: (tnt) =>
        tnt.seats == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums text-sm">
            {formatNumber(tnt.seats_used ?? 0)}
            <span className="text-muted-foreground"> / {formatNumber(tnt.seats)}</span>
          </span>
        ),
    },
    {
      key: 'license_state',
      header: t('platformConsole.tenants.licenseState'),
      render: (tnt) =>
        tnt.license_state ? (
          <StatusBadge status={tnt.license_state} config={licenseStateConfig} size="sm" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'storage',
      header: t('platformConsole.tenants.storage'),
      align: 'right',
      render: (tnt) => (
        <span className="tabular-nums text-sm">{formatBytes(tnt.storage_used_bytes ?? 0)}</span>
      ),
    },
    {
      key: 'last_activity_at',
      header: t('platformConsole.tenants.lastActivity'),
      render: (tnt) =>
        tnt.last_activity_at ? (
          <RelativeTime date={tnt.last_activity_at} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'created_at',
      header: t('platformConsole.tenants.created'),
      render: (tnt) => <RelativeTime date={tnt.created_at} />,
    },
    {
      key: 'actions',
      header: t('platformConsole.tenants.actionsColumn'),
      align: 'right',
      render: (tnt) => <TenantRowActions tenant={tnt} onView={view} />,
    },
  ];

  const s = summary.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('platformConsole.eyebrow')}
        title={t('platformConsole.tenants.title')}
        description={t('platformConsole.subtitle')}
        actions={
          <Button onClick={() => router.push('/admin/tenants/new')}>
            <Plus className="me-2 h-4 w-4" />
            {t('platformConsole.tenants.provision')}
          </Button>
        }
      />

      {/* KPI row (G3 estate rollup): total / active / suspended / trial / deprovisioned. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          title={t('platformConsole.tenants.total')}
          value={s ? formatNumber(s.tenant_count) : '—'}
          icon={Building2}
          tone="slate"
          loading={summary.isLoading}
        />
        <KpiCard
          title={t('platformConsole.tenants.active')}
          value={s ? formatNumber(s.active) : '—'}
          tone="emerald"
          loading={summary.isLoading}
        />
        <KpiCard
          title={t('platformConsole.tenants.suspended')}
          value={s ? formatNumber(s.suspended) : '—'}
          tone="rose"
          loading={summary.isLoading}
        />
        <KpiCard
          title={t('platformConsole.tenants.trial')}
          value={s ? formatNumber(s.trial) : '—'}
          tone="gold"
          loading={summary.isLoading}
        />
        <KpiCard
          title={t('platformConsole.tenants.deprovisioned')}
          value={s ? formatNumber(s.deprovisioned) : '—'}
          icon={Users}
          tone="neutral"
          loading={summary.isLoading}
        />
      </div>

      {/* Filters + search. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:flex-1">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('platformConsole.tenants.searchPlaceholder')}
            loading={isLoading}
          />
        </div>
        <div className="w-full sm:w-48">
          <MultiSelect
            options={statusOptions}
            selected={status}
            onChange={setStatus}
            placeholder={t('platformConsole.tenants.statusFilter')}
          />
        </div>
        <div className="w-full sm:w-48">
          <MultiSelect
            options={tierOptions}
            selected={tier}
            onChange={setTier}
            placeholder={t('platformConsole.tenants.tier')}
          />
        </div>
      </div>

      {error ? (
        <ErrorState
          variant={detectVariant(error)}
          error={error}
          message={error.message}
          onRetry={() => refetch()}
        />
      ) : (
        <SimpleTable<TenantRow>
          columns={columns as TenantColumn[]}
          data={tenants as TenantRow[]}
          loading={isLoading}
          emptyMessage={t('platformConsole.tenants.empty')}
          getRowKey={(tnt) => tnt.id}
          onRowClick={(tnt) => view(tnt)}
          ariaLabel={t('platformConsole.tenants.title')}
        />
      )}
    </div>
  );
}
