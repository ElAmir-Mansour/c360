'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RecordRecent } from '@/hooks/use-recent-items';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { CyberAlert } from '@/types/cyber';

import { AlertComments } from './_components/alert-comments';
import { AlertEvidence } from './_components/alert-evidence';
import { AlertExplanation } from './_components/alert-explanation';
import { AlertHeader } from './_components/alert-header';
import { AlertRelated } from './_components/alert-related';
import { AlertTimeline } from './_components/alert-timeline';
import { useAlertLabels } from '../_lib/alerts-i18n';

export default function AlertDetailPage() {
  const params = useParams<{ id: string }>();
  const alertId = params?.id ?? '';
  const router = useRouter();
  const t = useAlertLabels();

  const alertQuery = useQuery({
    queryKey: ['cyber-alert', alertId],
    queryFn: () => apiGet<{ data: CyberAlert }>(API_ENDPOINTS.CYBER_ALERT_DETAIL(alertId)),
    enabled: Boolean(alertId),
    refetchInterval: 60000,
  });

  const alert = alertQuery.data?.data;

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.detail.title}
          description={t.detail.description}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => router.push('/cyber/alerts')}>
                <ArrowLeft className="me-1.5 h-4 w-4" />
                {t.detail.backToAlerts}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void alertQuery.refetch()}>
                <RefreshCw className="me-1.5 h-4 w-4" />
                {t.detail.refresh}
              </Button>
            </div>
          }
        />

        {alertQuery.isLoading ? (
          <LoadingSkeleton variant="card" />
        ) : alertQuery.error || !alert ? (
          <ErrorState message={t.detail.loadError} onRetry={() => void alertQuery.refetch()} />
        ) : (
          <>
            {/* Feeds the global recents (Cmd+K palette Recent section). */}
            <RecordRecent
              type="alert"
              id={alert.id}
              title={alert.title}
              href={`/cyber/alerts/${alert.id}`}
            />
            <AlertHeader alert={alert} onUpdated={() => void alertQuery.refetch()} />

            {(alert.tags?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2">
                {alert.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            <Tabs defaultValue="explanation" className="space-y-4">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="explanation">{t.detail.tabExplanation}</TabsTrigger>
                <TabsTrigger value="evidence">{t.detail.tabEvidence}</TabsTrigger>
                <TabsTrigger value="comments">{t.detail.tabComments}</TabsTrigger>
                <TabsTrigger value="timeline">{t.detail.tabTimeline}</TabsTrigger>
                <TabsTrigger value="related">{t.detail.tabRelated}</TabsTrigger>
              </TabsList>

              <TabsContent value="explanation">
                <AlertExplanation alert={alert} />
              </TabsContent>

              <TabsContent value="evidence">
                <AlertEvidence alert={alert} />
              </TabsContent>

              <TabsContent value="comments">
                <AlertComments alertId={alert.id} />
              </TabsContent>

              <TabsContent value="timeline">
                <AlertTimeline alertId={alert.id} />
              </TabsContent>

              <TabsContent value="related">
                <AlertRelated alert={alert} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
