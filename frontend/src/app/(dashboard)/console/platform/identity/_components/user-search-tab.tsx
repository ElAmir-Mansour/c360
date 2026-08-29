'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Users } from 'lucide-react';
import { SearchInput } from '@/components/shared/forms/search-input';
import { SimpleTable } from '@/components/shared/simple-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { Badge } from '@/components/ui/badge';
import { RelativeTime } from '@/components/shared/relative-time';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/components/providers/locale-provider';
import { useAdminUserSearch } from '@/hooks/use-platform';
import type { AdminUserSummary } from '@/types/platform';

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type UserRow = AdminUserSummary & Record<string, unknown>;
interface UserColumn {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  render?: (item: UserRow) => ReactNode;
}

const STATUS_FILTERS = ['all', 'active', 'invited', 'suspended', 'deprovisioned'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export function UserSearchTab() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const params = useMemo(
    () => ({
      query: query.trim() || undefined,
      status: status === 'all' ? undefined : status,
    }),
    [query, status],
  );
  const hasQuery = Boolean(params.query);

  const { data, isLoading, isFetching, isError, error, refetch } =
    useAdminUserSearch(params, hasQuery);

  const users = data?.data ?? [];

  const statusLabel = (s: string) => {
    switch (s) {
      case 'active':
        return t('platformConsole.identity.statusActive');
      case 'invited':
        return t('platformConsole.identity.statusInvited');
      case 'suspended':
        return t('platformConsole.identity.statusSuspended');
      case 'deprovisioned':
        return t('platformConsole.identity.statusDeprovisioned');
      default:
        return s;
    }
  };

  const columns = [
    {
      key: 'user',
      header: t('platformConsole.identity.colUser'),
      render: (u: AdminUserSummary) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {u.name || u.email}
          </p>
          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'tenant_name',
      header: t('platformConsole.identity.colTenant'),
      render: (u: AdminUserSummary) => (
        <span className="text-foreground/80">{u.tenant_name || '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('platformConsole.identity.colStatus'),
      render: (u: AdminUserSummary) => (
        <Badge variant={u.status === 'active' ? 'success' : 'outline'}>
          {statusLabel(u.status)}
        </Badge>
      ),
    },
    {
      key: 'roles',
      header: t('platformConsole.identity.colRoles'),
      render: (u: AdminUserSummary) => (
        <div className="flex flex-wrap gap-1">
          {u.roles.length > 0 ? (
            u.roles.map((r) => (
              <code
                key={r}
                className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
              >
                {r}
              </code>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'last_login_at',
      header: t('platformConsole.identity.colLastLogin'),
      render: (u: AdminUserSummary) =>
        u.last_login_at ? (
          <RelativeTime date={u.last_login_at} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t('platformConsole.identity.userSearchHeading')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('platformConsole.identity.userSearchHint')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          loading={isFetching && hasQuery}
          placeholder={t('platformConsole.identity.userSearchPlaceholder')}
          className="max-w-md flex-1"
        />
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFilter)}
        >
          <SelectTrigger
            className="w-44"
            aria-label={t('platformConsole.identity.filterByStatus')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all'
                  ? t('platformConsole.identity.allStatuses')
                  : statusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div aria-live="polite">
        {!hasQuery ? (
          <EmptyState
            icon={Users}
            title={t('platformConsole.identity.searchForUserTitle')}
            description={t('platformConsole.identity.searchForUserHint')}
            size="compact"
          />
        ) : isError ? (
          <ErrorState
            variant={detectVariant(error)}
            error={error}
            message={t('platformConsole.identity.userSearchError')}
            onRetry={() => refetch()}
          />
        ) : !isLoading && users.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('platformConsole.identity.noUsersTitle')}
            description={t('platformConsole.identity.noUsersHint')}
            size="compact"
          />
        ) : (
          <SimpleTable<UserRow>
            columns={columns as UserColumn[]}
            data={users as UserRow[]}
            loading={isLoading}
            getRowKey={(u) => u.id}
            ariaLabel={t('platformConsole.identity.userTableCaption')}
            emptyMessage={t('platformConsole.identity.noUsersTitle')}
          />
        )}
      </div>
    </div>
  );
}
