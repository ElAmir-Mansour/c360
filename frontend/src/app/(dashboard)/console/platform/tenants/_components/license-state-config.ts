'use client';

// Localized StatusConfig for the computed license state (active|in_grace|expired|
// suspended) returned by the backend (§E.4 — `TenantLicense.State()`). There is
// no shared `licenseStateConfig` in lib/status-configs, and that file is shared
// foundation we must not edit, so the mapping lives here in the route folder.
// StatusBadge renders `config[status].label` directly, so the labels must be
// localized — hence a hook (t() is only available in a component scope).

import { CheckCircle, Clock, XCircle, Ban } from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';
import { useT } from '@/components/providers/locale-provider';

export function useLicenseStateConfig(): StatusConfig {
  const t = useT();
  return {
    active: { label: t('platformConsole.tenants.licenseActive'), color: 'green', icon: CheckCircle },
    in_grace: { label: t('platformConsole.tenants.licenseInGrace'), color: 'yellow', icon: Clock },
    expired: { label: t('platformConsole.tenants.licenseExpired'), color: 'red', icon: XCircle },
    suspended: { label: t('platformConsole.tenants.licenseSuspended'), color: 'gray', icon: Ban },
  };
}
