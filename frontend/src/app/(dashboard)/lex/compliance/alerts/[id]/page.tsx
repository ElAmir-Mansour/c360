'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import { LexRouteGuard } from '../../../_guards/lex-route-guard';
import { AlertDetailPanel } from '../../_components/alert-detail-panel';
import { useComplianceLabels } from '../../_lib/compliance-labels';

export default function LexComplianceAlertDetailPage() {
  const params = useParams<{ id: string }>();
  const alertId = params?.id ?? '';
  const router = useRouter();
  const labels = useComplianceLabels();
  const { hasPermission } = useAuth();
  const [panelOpen, setPanelOpen] = useState(true);

  const alertQuery = useQuery({
    queryKey: ['lex-compliance-alert', alertId],
    queryFn: () => enterpriseApi.lex.getComplianceAlert(alertId),
    enabled: Boolean(alertId),
  });

  const returnToCompliance = () => router.push('/lex/compliance');

  return (
    <LexRouteGuard route="/lex/compliance">
      <div className="space-y-6">
        <PageHeader
          title={labels.alerts.title}
          description={labels.alerts.description}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={returnToCompliance}>
                <ArrowLeft className="me-1.5 h-4 w-4" />
                {labels.actions.cancel}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void alertQuery.refetch()}>
                <RefreshCw className="me-1.5 h-4 w-4" />
                {labels.actions.update}
              </Button>
            </div>
          }
        />

        {alertQuery.isLoading ? (
          <LoadingSkeleton variant="card" count={2} />
        ) : alertQuery.error || !alertQuery.data ? (
          <ErrorState
            error={alertQuery.error}
            message={labels.loadError}
            onRetry={() => void alertQuery.refetch()}
          />
        ) : (
          <AlertDetailPanel
            open={panelOpen}
            alert={alertQuery.data}
            onOpenChange={(open) => {
              setPanelOpen(open);
              if (!open) returnToCompliance();
            }}
            canWrite={hasPermission('lex:catalog:manage')}
          />
        )}
      </div>
    </LexRouteGuard>
  );
}
