'use client';

import { apiGet } from '@/lib/api';
import type { Role } from '@/types/models';
import {
  AsyncRecordPicker,
  type AsyncRecordPickerLabels,
  type RecordPickerOption,
} from './async-record-picker';

interface TenantRolePickerProps {
  id?: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string, option?: RecordPickerOption) => void;
  valueKind?: 'id' | 'slug';
  enabled?: boolean;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  selectedLabel?: string;
  labels?: Partial<AsyncRecordPickerLabels>;
  className?: string;
}

/** Searchable tenant role picker; callers can store either the role UUID or its workflow slug. */
export function TenantRolePicker({
  id,
  ariaLabel,
  value,
  onChange,
  valueKind = 'id',
  enabled = true,
  disabled = false,
  required = false,
  allowClear = false,
  selectedLabel,
  labels,
  className,
}: TenantRolePickerProps) {
  return (
    <AsyncRecordPicker
      id={id}
      ariaLabel={ariaLabel}
      queryKey={['tenant-role-picker', valueKind]}
      loadOptions={async (search) => {
        const roles = await apiGet<Role[]>('/api/v1/roles');
        const term = search.toLocaleLowerCase();
        return roles
          .filter((role) =>
            !term || role.name.toLocaleLowerCase().includes(term) || role.slug.toLocaleLowerCase().includes(term),
          )
          .map((role) => ({
            value: valueKind === 'slug' ? role.slug : role.id,
            label: role.name,
            description: role.slug,
            keywords: [role.slug],
          }));
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
