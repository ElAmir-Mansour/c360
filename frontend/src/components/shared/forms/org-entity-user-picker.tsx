'use client';

import { useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { lexAdminApi } from '@/lib/lex/admin';
import type { User } from '@/types/models';
import { AsyncRecordPicker, type AsyncRecordPickerLabels, type RecordPickerOption } from './async-record-picker';
import { TenantUserPicker } from './tenant-user-picker';

const DIRECTORY_STALE_TIME_MS = 60_000;

export interface OrgEntityUserPickerProps {
  id?: string;
  ariaLabel: string;
  entityId?: string | null;
  value: string;
  onChange: (userId: string, option?: RecordPickerOption) => void;
  enabled?: boolean;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  selectedLabel?: string;
  labels?: Partial<AsyncRecordPickerLabels>;
  excludeUserIds?: string[];
  /** Legacy cases may not yet carry beneficiary_entity_id in metadata. */
  fallbackToTenant?: boolean;
  className?: string;
}

function userName(user: Pick<User, 'first_name' | 'last_name' | 'email' | 'full_name'>): string {
  return user.full_name?.trim() || `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email;
}

/** Exported for focused tests and for consistent entity-directory matching. */
export function entityUserOptions(
  users: User[],
  search: string,
  excludeUserIds: readonly string[] = [],
): RecordPickerOption[] {
  const query = search.trim().toLocaleLowerCase();
  const excluded = new Set(excludeUserIds);

  return users
    .filter((user) => user.status === 'active' && !excluded.has(user.id))
    .filter((user) => {
      if (!query) return true;
      const haystack = [userName(user), user.email, user.first_name, user.last_name].join(' ').toLocaleLowerCase();
      return haystack.includes(query);
    })
    .sort((left, right) => userName(left).localeCompare(userName(right)))
    .map((user) => {
      const name = userName(user);
      return {
        value: user.id,
        label: name,
        triggerLabel: `${name} — ${user.email}`,
        description: user.email,
        keywords: [user.email, user.first_name, user.last_name],
      };
    });
}

/**
 * Active-user picker scoped by the organisation registry membership for one
 * entity. UUIDs remain internal values; users see names and email addresses.
 *
 * Existing cases created before entity ownership was captured can explicitly
 * fall back to the tenant directory, keeping those records assignable while
 * all newly entity-linked cases use the stricter membership list.
 */
export function OrgEntityUserPicker({
  id,
  ariaLabel,
  entityId,
  value,
  onChange,
  enabled = true,
  disabled = false,
  required = false,
  allowClear = false,
  selectedLabel,
  labels,
  excludeUserIds = [],
  fallbackToTenant = true,
  className,
}: OrgEntityUserPickerProps) {
  const queryClient = useQueryClient();
  const normalizedEntityId = entityId?.trim() ?? '';

  if (!normalizedEntityId && fallbackToTenant) {
    return (
      <TenantUserPicker
        id={id}
        ariaLabel={ariaLabel}
        value={value}
        onChange={onChange}
        enabled={enabled}
        disabled={disabled}
        required={required}
        allowClear={allowClear}
        selectedLabel={selectedLabel}
        labels={labels}
        excludeUserIds={excludeUserIds}
        className={className}
      />
    );
  }

  return (
    <AsyncRecordPicker
      id={id}
      ariaLabel={ariaLabel}
      queryKey={['org-entity-active-user-picker', normalizedEntityId, excludeUserIds.slice().sort().join(',')]}
      loadOptions={async (search) => {
        if (!normalizedEntityId) return [];

        const memberships = await queryClient.fetchQuery({
          queryKey: ['lex-org-entity-memberships', normalizedEntityId],
          queryFn: () => lexAdminApi.listOrgMemberships(normalizedEntityId),
          staleTime: DIRECTORY_STALE_TIME_MS,
        });
        const userIds = [...new Set(memberships.map((membership) => membership.user_id).filter(Boolean))];
        const users = await queryClient.fetchQuery({
          queryKey: ['lex-org-entity-active-users', normalizedEntityId, userIds.slice().sort().join(',')],
          queryFn: () => Promise.all(userIds.map((userId) => apiGet<User>(`/api/v1/users/${userId}`))),
          staleTime: DIRECTORY_STALE_TIME_MS,
        });

        return entityUserOptions(users, search, excludeUserIds);
      }}
      value={value}
      onChange={onChange}
      enabled={enabled && Boolean(normalizedEntityId)}
      disabled={disabled}
      required={required}
      allowClear={allowClear}
      selectedLabel={selectedLabel}
      labels={labels}
      className={className}
    />
  );
}
