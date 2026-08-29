'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/components/providers/locale-provider';
import { useFleetLicenses } from '@/hooks/use-platform';
import type { FleetLicenseRow } from '@/types/platform';

interface TenantPickerProps {
  value: string;
  onChange: (tenantId: string, label: string) => void;
  placeholder?: string;
  className?: string;
}

function label(r: FleetLicenseRow): string {
  return r.tenant_name || r.tenant_slug || r.tenant_id;
}

/**
 * Tenant selector sourced from the fleet-license list (G7) so the Overrides and
 * Usage tabs can scope a per-tenant read without a separate tenants endpoint.
 */
export function TenantPicker({ value, onChange, placeholder, className }: TenantPickerProps) {
  const t = useT();
  const { data, isLoading } = useFleetLicenses();
  const rows = data?.data ?? [];

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const row = rows.find((r) => r.tenant_id === v);
        onChange(v, row ? label(row) : v);
      }}
      disabled={isLoading}
    >
      <SelectTrigger className={className} aria-label={t('platformConsole.licensing.tenantPickerAria')}>
        <SelectValue
          placeholder={
            isLoading
              ? t('platformConsole.licensing.loadingTenants')
              : placeholder ?? t('platformConsole.licensing.selectTenant')
          }
        />
      </SelectTrigger>
      <SelectContent>
        {rows.map((r) => (
          <SelectItem key={r.tenant_id} value={r.tenant_id}>
            {label(r)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
