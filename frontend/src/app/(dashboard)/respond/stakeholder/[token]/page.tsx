'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Megaphone, ShieldCheck } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { StatusBadge } from '@/components/shared/status-badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { fetchRespondStakeholderStatus } from '@/lib/respond';
import {
  useRespondCommonLabels,
  useRespondStakeholderPageLabels,
  useRespondStatusLabels,
} from '../../_lib/respond-i18n';

const formatDateTime = (value: string | null | undefined, unrecorded: string) => {
  if (!value) return unrecorded;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

export default function RespondStakeholderTokenPage() {
  const t = useRespondStakeholderPageLabels();
  const common = useRespondCommonLabels();
  const statusLabels = useRespondStatusLabels();
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const statusQuery = useQuery({
    queryKey: ['respond-stakeholder-status', token],
    queryFn: () => fetchRespondStakeholderStatus(token),
    enabled: Boolean(token),
  });

  if (statusQuery.isLoading) {
    return <LoadingSkeleton variant="detail" label={t.loading} />;
  }

  if (statusQuery.error || !statusQuery.data) {
    return (
      <ErrorState
        error={statusQuery.error}
        title={t.unavailableTitle}
        message={t.unavailableMessage}
        onRetry={() => void statusQuery.refetch()}
      />
    );
  }

  const status = statusQuery.data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow={t.eyebrow}
        title={`${status.incident_reference} · ${status.title}`}
        description={status.impact_summary}
        tags={[
          { label: status.severity, tone: status.severity === 'SEV1' ? 'danger' : 'warning' },
          { label: statusLabels[status.status] ?? status.status, tone: 'info' },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <DetailStatCard
          label={t.currentPhase}
          value={status.current_phase}
          tone="sky"
          icon={ShieldCheck}
        />
        <DetailStatCard
          label={t.lastUpdate}
          value={formatDateTime(status.last_update_at, common.unrecorded)}
          tone="neutral"
          icon={Megaphone}
        />
        <DetailStatCard
          label={t.nextUpdate}
          value={formatDateTime(status.next_update_at, common.unrecorded)}
          tone="gold"
          icon={CalendarClock}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.incidentStatusTitle()}</CardTitle>
          <CardDescription>{t.incidentStatusDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t.severityLabel}</p>
            <div className="mt-2">
              <StatusBadge status={status.severity} />
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t.statusLabel}</p>
            <div className="mt-2">
              <StatusBadge status={status.status} variant="outline" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
