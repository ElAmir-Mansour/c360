'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { StatusBadge } from '@/components/shared/status-badge';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import type { StatTone } from '@/components/shared/stat-card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Pencil, Tag, Trash2, Scan, ShieldAlert, ShieldX, ShieldQuestion, Bell } from 'lucide-react';
import { TYPE_ICONS } from '../_components/asset-columns';
import { useAssetLabels } from '../_lib/assets-i18n';
import { EditAssetDialog } from '../_components/edit-asset-dialog';
import { DeleteAssetDialog } from '../_components/delete-asset-dialog';
import { TagManagementDialog } from '../_components/tag-management-dialog';
import { ScanDialog } from '../_components/scan-dialog';
import { AssetOverviewTab } from './_components/asset-overview-tab';
import { AssetVulnerabilitiesTab } from './_components/asset-vulnerabilities-tab';
import { AssetAlertsTab } from './_components/asset-alerts-tab';
import { AssetRelationshipsTab } from './_components/asset-relationships-tab';
import { AssetActivityTab } from './_components/asset-activity-tab';
import { AssetConfigTab } from './_components/asset-config-tab';
import type { CyberAsset } from '@/types/cyber';

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const t = useAssetLabels();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  const { data: envelope, isLoading, error, refetch } = useQuery({
    queryKey: [`cyber-asset-${id}`],
    queryFn: () => apiGet<{ data: CyberAsset }>(`${API_ENDPOINTS.CYBER_ASSETS}/${id}`),
  });

  const asset = envelope?.data;
  const Icon = asset ? (TYPE_ICONS[asset.type] ?? TYPE_ICONS.server) : null;

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        {isLoading ? (
          <>
            <div className="h-8 w-48 animate-pulse rounded bg-muted" />
            <LoadingSkeleton variant="card" />
          </>
        ) : error || !asset ? (
          <ErrorState message={t.detail.loadError} onRetry={() => refetch()} />
        ) : (
          <>
            <PageHeader
              title={
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={t.detail.goBack}
                    onClick={() => router.back()}
                    className="flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
                  <span>{asset.name}</span>
                </div>
              }
              description={
                <div className="flex items-center gap-3 ps-11">
                  <span className="text-sm text-muted-foreground">{t.typeLabels[asset.type] ?? asset.type}</span>
                  <SeverityIndicator severity={asset.criticality} showLabel />
                  <StatusBadge status={asset.status} />
                  {asset.ip_address && (
                    <span className="font-mono text-xs text-muted-foreground">{asset.ip_address}</span>
                  )}
                </div>
              }
              actions={
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setScanOpen(true)}>
                    <Scan className="me-1.5 h-3.5 w-3.5" />
                    {t.detail.scan}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setTagOpen(true)}>
                    <Tag className="me-1.5 h-3.5 w-3.5" />
                    {t.detail.tags}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil className="me-1.5 h-3.5 w-3.5" />
                    {t.detail.edit}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="me-1.5 h-3.5 w-3.5" />
                    {t.detail.delete}
                  </Button>
                </div>
              }
            />

            {/* Security summary bar */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([
                { label: t.detail.statVulnerabilities, value: asset.vulnerability_count ?? 0, icon: ShieldAlert, tone: (asset.vulnerability_count ?? 0) > 0 ? 'gold' : 'sky' },
                { label: t.detail.statCriticalVulns, value: asset.critical_vuln_count ?? 0, icon: ShieldX, tone: (asset.critical_vuln_count ?? 0) > 0 ? 'rose' : 'sky' },
                { label: t.detail.statHighVulns, value: asset.high_vuln_count ?? 0, icon: ShieldQuestion, tone: (asset.high_vuln_count ?? 0) > 0 ? 'gold' : 'sky' },
                { label: t.detail.statOpenAlerts, value: asset.alert_count ?? 0, icon: Bell, tone: (asset.alert_count ?? 0) > 0 ? 'rose' : 'sky' },
              ] as { label: string; value: number; icon: typeof ShieldAlert; tone: StatTone }[]).map(({ label, value, icon, tone }) => (
                <DetailStatCard
                  key={label}
                  label={label}
                  value={value.toLocaleString()}
                  icon={icon}
                  tone={tone}
                  className=""
                />
              ))}
            </div>

            {/* Tabs */}
            <Tabs defaultValue="overview">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview">{t.detail.tabOverview}</TabsTrigger>
                <TabsTrigger value="vulnerabilities">
                  {t.detail.tabVulnerabilities}
                  {(asset.vulnerability_count ?? 0) > 0 && (
                    <span className="ms-1.5 rounded-full bg-warning-100 px-1.5 py-0.5 text-xs font-medium text-warning-700">
                      {asset.vulnerability_count}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="alerts">
                  {t.detail.tabAlerts}
                  {(asset.alert_count ?? 0) > 0 && (
                    <span className="ms-1.5 rounded-full bg-error-100 px-1.5 py-0.5 text-xs font-medium text-error-600">
                      {asset.alert_count}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="relationships">{t.detail.tabRelationships}</TabsTrigger>
                <TabsTrigger value="config">{t.detail.tabConfiguration}</TabsTrigger>
                <TabsTrigger value="activity">{t.detail.tabActivity}</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4">
                <AssetOverviewTab asset={asset} />
              </TabsContent>
              <TabsContent value="vulnerabilities" className="mt-4">
                <AssetVulnerabilitiesTab assetId={asset.id} />
              </TabsContent>
              <TabsContent value="alerts" className="mt-4">
                <AssetAlertsTab assetId={asset.id} />
              </TabsContent>
              <TabsContent value="relationships" className="mt-4">
                <AssetRelationshipsTab asset={asset} />
              </TabsContent>
              <TabsContent value="config" className="mt-4">
                <AssetConfigTab asset={asset} />
              </TabsContent>
              <TabsContent value="activity" className="mt-4">
                <AssetActivityTab assetId={asset.id} />
              </TabsContent>
            </Tabs>

            {/* Dialogs */}
            <EditAssetDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              asset={asset}
              onSuccess={() => refetch()}
            />
            <DeleteAssetDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              asset={asset}
              onSuccess={() => router.push('/cyber/assets')}
            />
            <TagManagementDialog
              open={tagOpen}
              onOpenChange={setTagOpen}
              asset={asset}
              onSuccess={() => refetch()}
            />
            <ScanDialog
              open={scanOpen}
              onOpenChange={setScanOpen}
              defaultTarget={asset.ip_address ?? asset.hostname}
            />
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
