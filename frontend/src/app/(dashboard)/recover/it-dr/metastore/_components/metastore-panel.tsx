'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { showError, showSuccess } from '@/lib/toast';
import {
  useMetastoreApplications,
  usePopulateFromMetastore,
  useSyncFromMetastore,
} from '@/lib/recover/use-metastore';
import { useRecoverT } from '../../../_lib/recover-i18n';
import type {
  MetastoreApplication,
  MetastoreSyncResult,
} from '@/types/recover-metastore';

type RecoverTranslate = ReturnType<typeof useRecoverT>;

const TIER_LABEL_KEY: Record<MetastoreApplication['recovery_tier'], string> = {
  mission_critical: 'metastore.tierMissionCritical',
  tier_1: 'metastore.tier1',
  tier_2: 'metastore.tier2',
  tier_3: 'metastore.tier3',
};

function rtoLabel(t: RecoverTranslate, seconds: number): string {
  if (seconds <= 0) return t('metastore.rtoInstant');
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/**
 * Application Metastore panel (Prompt 7 frontend seam).
 *
 * Lists the tenant's Metastore applications from the real
 * `GET /api/recover/metastore/applications` endpoint and exposes the two seam
 * actions against real endpoints: "Populate from Metastore" (materializes a
 * runbook from the application's metadata) and "Sync" (diffs each linked runbook
 * against current metadata and flags drift). Every control hits a real endpoint
 * that mutates/reads real state; authorization is enforced server-side (populate
 * requires dr:write, registry mutation dr:admin) — this UI only reflects it.
 */
export function MetastorePanel() {
  const t = useRecoverT();
  const { hasPermission } = useAuth();
  const canPopulate = hasPermission('dr:write');

  const query = useMetastoreApplications(1, 50);
  const populate = usePopulateFromMetastore();
  const sync = useSyncFromMetastore();

  const [syncResults, setSyncResults] = useState<Record<string, MetastoreSyncResult>>({});

  const onPopulate = (app: MetastoreApplication) => {
    populate.mutate(app.id, {
      onSuccess: (res) => {
        showSuccess(
          t('metastore.populatedTitle'),
          t('metastore.populatedBody', {
            name: res.runbook_name,
            tasks: res.task_count,
            revision: res.source_revision,
          }),
        );
      },
      onError: (err) => showError(t('metastore.populateFailed'), err.message),
    });
  };

  const onSync = (app: MetastoreApplication, runbookId: string) => {
    sync.mutate(
      { applicationId: app.id, runbookId },
      {
        onSuccess: (res) => {
          setSyncResults((prev) => ({ ...prev, [runbookId]: res }));
          if (res.drifted) {
            showSuccess(
              t('metastore.driftDetected'),
              t('metastore.driftBody', { from: res.source_revision, to: res.current_revision }),
            );
          } else {
            showSuccess(t('metastore.inSyncTitle'), t('metastore.inSyncBody'));
          }
        },
        onError: (err) => showError(t('metastore.syncFailed'), err.message),
      },
    );
  };

  if (query.isLoading) {
    return (
      <div className="space-y-3" data-testid="metastore-loading">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('metastore.loadErrorTitle')}</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
      </Alert>
    );
  }

  const apps = query.data?.data ?? [];

  if (apps.length === 0) {
    return (
      <Alert>
        <AlertTitle>{t('metastore.noAppsTitle')}</AlertTitle>
        <AlertDescription>{t('metastore.noAppsBody')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {apps.map((app) => (
        <Card key={app.id} data-testid={`metastore-app-${app.app_key}`}>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                {app.name}
                <Badge variant="outline">{app.app_key}</Badge>
              </CardTitle>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{t(TIER_LABEL_KEY[app.recovery_tier])}</Badge>
                <Badge variant="secondary">{t('metastore.rtoBadge', { value: rtoLabel(t, app.rto_target_seconds) })}</Badge>
                <span>{t('metastore.envCount', { count: app.environments.length })}</span>
                <span>{t('metastore.depsCount', { count: app.dependencies.length })}</span>
                <span>{t('metastore.accountsCount', { count: app.cloud_accounts.length })}</span>
                <span>{t('metastore.revShort', { rev: app.metadata_revision })}</span>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => onPopulate(app)}
              disabled={!canPopulate || populate.isPending}
              title={canPopulate ? undefined : t('metastore.requiresWrite')}
            >
              {populate.isPending ? t('metastore.populating') : t('metastore.populate')}
            </Button>
          </CardHeader>

          {app.linked_runbooks.length > 0 && (
            <CardContent className="space-y-2">
              <p className="text-sm font-medium">{t('metastore.linkedRunbooks')}</p>
              {app.linked_runbooks.map((link) => {
                const result = syncResults[link.runbook_id];
                return (
                  <div
                    key={link.runbook_id}
                    className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                    data-testid={`metastore-link-${link.runbook_id}`}
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-xs">{link.runbook_id.slice(0, 8)}</code>
                      <span className="text-muted-foreground">
                        {t('metastore.populatedAtRev', { rev: link.source_revision })}
                      </span>
                      {result &&
                        (result.drifted ? (
                          <Badge variant="destructive">{t('metastore.driftStale')}</Badge>
                        ) : (
                          <Badge variant="secondary">{t('metastore.inSyncBadge')}</Badge>
                        ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onSync(app, link.runbook_id)}
                      disabled={sync.isPending}
                    >
                      {sync.isPending ? t('metastore.syncing') : t('metastore.sync')}
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
