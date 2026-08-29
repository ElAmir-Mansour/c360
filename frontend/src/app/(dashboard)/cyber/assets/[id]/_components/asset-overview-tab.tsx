'use client';

import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { timeAgo } from '@/lib/utils';
import { TYPE_ICONS } from '../../_components/asset-columns';
import type { CyberAsset } from '@/types/cyber';
import { useAssetLabels } from '../../_lib/assets-i18n';

interface AssetOverviewTabProps {
  asset: CyberAsset;
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value ?? '—'}</p>
    </div>
  );
}

export function AssetOverviewTab({ asset }: AssetOverviewTabProps) {
  const t = useAssetLabels();
  const o = t.overview;
  const Icon = TYPE_ICONS[asset.type] ?? TYPE_ICONS.server;

  return (
    <div className="space-y-6">
      {/* Identity */}
      <div className="rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-semibold">{o.identity}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <Field label={o.fType} value={
            <span className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              {t.typeLabels[asset.type] ?? asset.type}
            </span>
          } />
          <Field label={o.fCriticality} value={<SeverityIndicator severity={asset.criticality} showLabel />} />
          <Field label={o.fStatus} value={<StatusBadge status={asset.status} />} />
          <Field label={o.fDiscoverySource} value={asset.discovery_source} />
        </div>
      </div>

      {/* Network */}
      <div className="rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-semibold">{o.network}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label={o.fIpAddress} value={asset.ip_address ? <span className="font-mono">{asset.ip_address}</span> : undefined} />
          <Field label={o.fHostname} value={asset.hostname ? <span className="font-mono text-xs">{asset.hostname}</span> : undefined} />
          <Field label={o.fMacAddress} value={asset.mac_address ? <span className="font-mono text-xs">{asset.mac_address}</span> : undefined} />
        </div>
      </div>

      {/* System */}
      <div className="rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-semibold">{o.system}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label={o.fOperatingSystem} value={asset.os} />
          <Field label={o.fOsVersion} value={asset.os_version} />
          <Field label={o.fLocation} value={asset.location} />
        </div>
      </div>

      {/* Ownership */}
      <div className="rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-semibold">{o.ownership}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label={o.fOwner} value={asset.owner} />
          <Field label={o.fDepartment} value={asset.department} />
        </div>
      </div>

      {/* Security */}
      <div className="rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-semibold">{o.securityPosture}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={o.fTotalVulns} value={
            <span className={(asset.vulnerability_count ?? 0) > 0 ? 'text-warning-700 dark:text-warning-300' : 'text-primary'}>
              {asset.vulnerability_count ?? 0}
            </span>
          } />
          <Field label={o.fCriticalVulns} value={
            <span className={(asset.critical_vuln_count ?? 0) > 0 ? 'text-error-500 font-semibold' : ''}>
              {asset.critical_vuln_count ?? 0}
            </span>
          } />
          <Field label={o.fHighVulns} value={
            <span className={(asset.high_vuln_count ?? 0) > 0 ? 'text-warning-700 dark:text-warning-300' : ''}>
              {asset.high_vuln_count ?? 0}
            </span>
          } />
          <Field label={o.fOpenAlerts} value={asset.alert_count ?? 0} />
        </div>
      </div>

      {/* Tags */}
      {(asset.tags?.length ?? 0) > 0 && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 text-sm font-semibold">{o.tags}</h3>
          <div className="flex flex-wrap gap-1.5">
            {asset.tags.map((tag) => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-semibold">{o.timeline}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          <Field label={o.fDiscovered} value={asset.discovered_at ? timeAgo(asset.discovered_at) : undefined} />
          <Field label={o.fLastSeen} value={asset.last_seen_at ? timeAgo(asset.last_seen_at) : undefined} />
          <Field label={o.fLastUpdated} value={timeAgo(asset.updated_at)} />
          <Field label={o.fCreated} value={timeAgo(asset.created_at)} />
        </div>
      </div>
    </div>
  );
}
