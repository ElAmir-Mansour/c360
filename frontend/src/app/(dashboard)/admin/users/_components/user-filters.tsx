import type { FilterConfig } from '@/types/table';
import type { Role } from '@/types/models';
import { resolveAdminLabels } from '../../_lib/admin-i18n';
import type { AppLocale } from '@/lib/i18n';

export function getUserFilters(roles: Role[], locale: AppLocale = 'en'): FilterConfig[] {
  const labels = resolveAdminLabels(locale);
  return [
    {
      key: 'status',
      label: labels.users.colStatus,
      type: 'multi-select',
      options: [
        { label: labels.users.statusActive, value: 'active' },
        { label: labels.users.statusSuspended, value: 'suspended' },
        { label: labels.users.statusInactive, value: 'inactive' },
        { label: labels.users.statusPending, value: 'pending_verification' },
      ],
    },
    {
      key: 'role',
      label: labels.users.colRoles,
      type: 'multi-select',
      options: roles.map((r) => ({ label: r.name, value: r.slug })),
    },
    {
      key: 'mfa_enabled',
      label: labels.users.colMfa,
      type: 'select',
      options: [
        { label: labels.users.enabled, value: 'true' },
        { label: labels.users.disabled, value: 'false' },
      ],
    },
  ];
}
