'use client';

import { CheckCircle2, MinusCircle } from 'lucide-react';
import { StatusBadge } from '@/components/shared/status-badge';
import type { StatusConfig } from '@/lib/status-configs';
import { useTenantOverrides } from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';
import type { AdminTenantSummary } from '@/types/platform';
import type { SuiteDescriptor } from './suite-catalog';
import { SuiteTenantToggle } from './suite-tenant-toggle';

interface SuiteTenantRowProps {
  suite: SuiteDescriptor;
  tenant: AdminTenantSummary;
}

/**
 * One tenant row inside an expanded suite. Owns its own G9 overrides query
 * (one query per visible tenant — acceptable for the expanded view, and each is
 * cached under platformKeys.licensing so re-expanding is instant). Renders the
 * current enablement badge plus the per-tenant enable/disable toggle.
 */
export function SuiteTenantRow({ suite, tenant }: SuiteTenantRowProps) {
  const t = useT();
  const { data: overrides, isLoading } = useTenantOverrides(tenant.id);

  const revoked = overrides?.some(
    (o) => o.key === suite.entitlement && o.limit === 0,
  );
  const enabled = !revoked;

  const enablementConfig: StatusConfig = {
    enabled: {
      label: t('platformConsole.suites.enabled'),
      color: 'green',
      icon: CheckCircle2,
    },
    disabled: {
      label: t('platformConsole.suites.disabled'),
      color: 'gray',
      icon: MinusCircle,
    },
  };

  return (
    <tr className="border-t border-border/60">
      <td className="px-4 py-2.5">
        <div className="font-medium text-foreground">{tenant.name}</div>
        <div className="text-xs text-muted-foreground">{tenant.slug}</div>
      </td>
      <td className="px-4 py-2.5">
        {isLoading ? (
          <span className="text-xs text-muted-foreground">…</span>
        ) : (
          <StatusBadge
            status={enabled ? 'enabled' : 'disabled'}
            config={enablementConfig}
            variant="dot"
          />
        )}
      </td>
      <td className="px-4 py-2.5 text-end">
        <SuiteTenantToggle suite={suite} tenant={tenant} overrides={overrides} />
        <span className="sr-only">
          {enabled
            ? t('platformConsole.suites.enabled')
            : t('platformConsole.suites.disabled')}
        </span>
      </td>
    </tr>
  );
}
