'use client';

import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';

export interface OrgUserPickerLabels {
  user: string;
  selectUser: string;
  searchUsers: string;
  loadingUsers: string;
  noUsers: string;
  usersLoadError: string;
  retry: string;
}

interface OrgUserPickerProps {
  id: string;
  enabled: boolean;
  value: string;
  onChange: (userId: string) => void;
  labels: OrgUserPickerLabels;
  disabled?: boolean;
}

/**
 * Tenant-scoped active-user picker for organisation role bindings.
 *
 * The UI works with names and email addresses while the selected UUID remains
 * an internal form value. Search is sent to IAM so tenants with more than one
 * page of users can still resolve any person without loading the whole tenant
 * directory into the browser.
 */
export function OrgUserPicker({ id, enabled, value, onChange, labels, disabled = false }: OrgUserPickerProps) {
  return (
    <TenantUserPicker
      id={id}
      ariaLabel={labels.user}
      enabled={enabled}
      value={value}
      onChange={onChange}
      disabled={disabled}
      required
      labels={{
        select: labels.selectUser,
        search: labels.searchUsers,
        loading: labels.loadingUsers,
        empty: labels.noUsers,
        loadError: labels.usersLoadError,
        retry: labels.retry,
      }}
      className="w-full"
    />
  );
}
