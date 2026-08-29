'use client';

import { useT } from '@/components/providers/locale-provider';
import { apiGet } from '@/lib/api';
import type { PaginatedResponse } from '@/types/api';
import type { AdminTenantSummary } from '@/types/platform';
import { AsyncRecordPicker, type RecordPickerOption } from './async-record-picker';

async function loadTenantOptions(search: string): Promise<RecordPickerOption[]> {
  const response = await apiGet<PaginatedResponse<AdminTenantSummary>>(
    '/api/v1/admin/tenants',
    {
      page: 1,
      per_page: 30,
      sort: 'name',
      order: 'asc',
      search: search || undefined,
    },
  );

  return response.data.map((tenant) => ({
    value: tenant.id,
    label: tenant.name,
    description: `${tenant.slug} · ${tenant.status}`,
    keywords: [tenant.slug, tenant.status, tenant.subscription_tier],
  }));
}

interface PlatformTenantPickerProps {
  value: string;
  onChange: (tenantId: string, option?: RecordPickerOption) => void;
  id?: string;
  enabled?: boolean;
  disabled?: boolean;
  allowClear?: boolean;
  selectedLabel?: string;
}

/** Searchable platform-tenant selector. Tenant UUIDs remain an API detail. */
export function PlatformTenantPicker({
  value,
  onChange,
  id,
  enabled = true,
  disabled = false,
  allowClear = false,
  selectedLabel,
}: PlatformTenantPickerProps) {
  const t = useT();

  return (
    <AsyncRecordPicker
      id={id}
      ariaLabel={t('platformConsole.licensing.tenantPickerAria')}
      queryKey={['platform-tenant-picker']}
      loadOptions={loadTenantOptions}
      value={value}
      onChange={onChange}
      selectedLabel={selectedLabel}
      enabled={enabled}
      disabled={disabled}
      allowClear={allowClear}
      labels={{
        select: t('platformConsole.licensing.selectTenant'),
        search: t('platformConsole.licensing.searchTenants'),
      }}
    />
  );
}
