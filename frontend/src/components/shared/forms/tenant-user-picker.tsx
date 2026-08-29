'use client';

import { apiGet } from '@/lib/api';
import type { PaginatedResponse } from '@/types/api';
import type { User } from '@/types/models';
import {
  AsyncRecordPicker,
  type AsyncRecordPickerLabels,
  type RecordPickerOption,
} from './async-record-picker';

const USER_SEARCH_PAGE_SIZE = 50;

export interface TenantUserPickerProps {
  id?: string;
  ariaLabel: string;
  value: string;
  onChange: (userId: string, option?: RecordPickerOption) => void;
  enabled?: boolean;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  selectedLabel?: string;
  labels?: Partial<AsyncRecordPickerLabels>;
  excludeUserIds?: string[];
  className?: string;
}

function userName(user: Pick<User, 'first_name' | 'last_name' | 'email' | 'full_name'>): string {
  return user.full_name?.trim() || `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email;
}

/** Tenant-scoped searchable active-user directory. */
export function TenantUserPicker({
  id,
  ariaLabel,
  value,
  onChange,
  enabled = true,
  disabled = false,
  required = false,
  allowClear = false,
  selectedLabel,
  labels,
  excludeUserIds = [],
  className,
}: TenantUserPickerProps) {
  return (
    <AsyncRecordPicker
      id={id}
      ariaLabel={ariaLabel}
      queryKey={['tenant-active-user-picker', excludeUserIds.slice().sort().join(',')]}
      loadOptions={async (search) => {
        const response = await apiGet<PaginatedResponse<User>>('/api/v1/users', {
          page: 1,
          per_page: USER_SEARCH_PAGE_SIZE,
          status: 'active',
          sort: 'first_name',
          order: 'asc',
          search: search || undefined,
        });
        const excluded = new Set(excludeUserIds);
        return response.data
          .filter((user) => !excluded.has(user.id))
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
      }}
      value={value}
      onChange={onChange}
      enabled={enabled}
      disabled={disabled}
      required={required}
      allowClear={allowClear}
      selectedLabel={selectedLabel}
      labels={labels}
      className={className}
    />
  );
}
