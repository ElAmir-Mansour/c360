'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, Users } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  StatusBadge,
  type StatusToneMap,
} from '@/components/shared/status-badge';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { useDataTable } from '@/hooks/use-data-table';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { IdentityProfile } from '@/types/cyber';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams } from '@/types/table';
import { useDspmLabels } from '../../_lib/dspm-i18n';

function flattenParams(params: FetchParams): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    page: params.page,
    per_page: params.per_page,
    sort: params.sort,
    order: params.order,
    search: params.search,
  };

  for (const [key, value] of Object.entries(params.filters ?? {})) {
    flat[key] = value;
  }

  return flat;
}

function fetchIdentities(params: FetchParams): Promise<PaginatedResponse<IdentityProfile>> {
  return apiGet<PaginatedResponse<IdentityProfile>>(
    API_ENDPOINTS.CYBER_DSPM_ACCESS_IDENTITIES,
    flattenParams(params),
  );
}

// Risk-score buckets ride the severity token ramp (re-themes in dark mode; no
// hardcoded palette). Low stays on the brand ink to read as "healthy".
function scoreColor(score: number): string {
  if (score >= 75) return 'bg-severity-critical';
  if (score >= 50) return 'bg-severity-high';
  if (score >= 25) return 'bg-severity-medium';
  return 'bg-primary';
}

function scoreTextColor(score: number): string {
  if (score >= 75) return 'text-severity-critical';
  if (score >= 50) return 'text-severity-high';
  if (score >= 25) return 'text-warning-700 dark:text-warning-300';
  return 'text-primary';
}

function identityTypeLabel(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function DspmAccessIdentitiesPage() {
  const router = useRouter();
  const t = useDspmLabels().identities;

  /** Identity lifecycle → canonical StatusBadge tones. */
  const IDENTITY_STATUS_MAP: StatusToneMap = {
    active: { tone: 'primary', label: t.statusActive },
    inactive: { tone: 'neutral', label: t.statusInactive },
    under_review: { tone: 'warning', label: t.statusUnderReview },
    remediated: { tone: 'info', label: t.statusRemediated },
  };

  const { tableProps, refetch } = useDataTable<IdentityProfile>({
    queryKey: 'dspm-access-identities',
    fetchFn: fetchIdentities,
    defaultSort: { column: 'access_risk_score', direction: 'desc' },
  });

  const columns: ColumnDef<IdentityProfile>[] = useMemo(
    () => [
      {
        accessorKey: 'identity_name',
        header: t.colName,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.identity_name}</span>
            <Badge variant="outline" className="px-1.5 py-0 text-xs">
              {identityTypeLabel(row.original.identity_type)}
            </Badge>
          </div>
        ),
      },
      {
        accessorKey: 'access_risk_score',
        header: t.colRiskScore,
        cell: ({ row }) => {
          const score = row.original.access_risk_score;
          return (
            <div className="flex items-center gap-2">
              <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${scoreColor(score)}`}
                  style={{ width: `${Math.min(score, 100)}%` }}
                />
              </div>
              <span className={`text-xs font-semibold ${scoreTextColor(score)}`}>
                {score}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: 'blast_radius_score',
        header: t.colBlastRadius,
        cell: ({ row }) => {
          const score = row.original.blast_radius_score;
          return (
            <div className="flex items-center gap-2">
              <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${scoreColor(score)}`}
                  style={{ width: `${Math.min(score, 100)}%` }}
                />
              </div>
              <span className={`text-xs font-semibold ${scoreTextColor(score)}`}>
                {score}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: 'overprivileged_count',
        header: t.colOverprivileged,
        cell: ({ row }) => {
          const count = row.original.overprivileged_count;
          return (
            <Badge variant={count > 0 ? 'destructive' : 'secondary'} className="text-xs">
              {count}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'stale_permission_count',
        header: t.colStalePermissions,
        cell: ({ row }) => {
          const count = row.original.stale_permission_count;
          return (
            <Badge variant={count > 0 ? 'default' : 'secondary'} className="text-xs">
              {count}
            </Badge>
          );
        },
      },
      {
        accessorKey: 'total_assets_accessible',
        header: t.colAssetsAccessible,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.total_assets_accessible}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: t.colStatus,
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            map={IDENTITY_STATUS_MAP}
            size="sm"
          />
        ),
      },
      {
        accessorKey: 'last_activity_at',
        header: t.colLastActivity,
        cell: ({ row }) => {
          const dt = row.original.last_activity_at;
          if (!dt) {
            return <span className="text-xs text-muted-foreground">{t.never}</span>;
          }
          return (
            <span className="text-xs text-muted-foreground">
              {format(new Date(dt), 'MMM d, yyyy HH:mm')}
            </span>
          );
        },
      },
    ],
    [t],
  );

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/cyber/dspm/access')}
            >
              <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
              {t.back}
            </Button>
          }
        />

        <DataTable
          columns={columns}
          searchPlaceholder={t.searchPlaceholder}
          emptyState={{
            icon: Users,
            title: t.noIdentitiesTitle,
            description: t.noIdentitiesDescription,
          }}
          getRowId={(row) => row.id}
          onRowClick={(row) =>
            router.push(`/cyber/dspm/access/identities/${row.identity_id}`)
          }
          {...tableProps}
        />
      </div>
    </PermissionRedirect>
  );
}
