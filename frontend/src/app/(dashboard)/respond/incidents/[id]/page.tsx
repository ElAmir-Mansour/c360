'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  fetchRespondCockpit,
  fetchRespondProduct,
} from '@/lib/respond';
import type { RespondCockpit, RespondTaskCard } from '@/types/respond';
import { IncidentCoordinationPanels, IncidentEvidencePanels, IncidentResponseExecutionPanels } from '../../_components/incident-command-panels';
import { IncidentTriagePanel } from '../../_components/incident-triage-panel';
import {
  useRespondCockpitLabels,
  useRespondCommonLabels,
  useRespondStatusLabels,
} from '../../_lib/respond-i18n';

const formatDateTime = (value: string | null | undefined, unrecorded: string) => {
  if (!value) return unrecorded;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const formatElapsed = (
  seconds: number,
  units: { d: string; h: string; m: string },
) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (days > 0) return `${days}${units.d} ${hours}${units.h} ${minutes}${units.m}`;
  if (hours > 0) return `${hours}${units.h} ${minutes}${units.m}`;
  return `${minutes}${units.m}`;
};

function mttrSeconds(cockpit: RespondCockpit, nowMs: number) {
  const start = new Date(
    cockpit.incident.detected_at ?? cockpit.incident.declared_at,
  ).getTime();
  const terminalTimestamp =
    cockpit.incident.resolved_at ?? cockpit.incident.mitigated_at ?? cockpit.incident.closed_at;
  const end = terminalTimestamp ? new Date(terminalTimestamp).getTime() : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

function useMinuteNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    let timeoutID: number | undefined;
    const schedule = () => {
      timeoutID = window.setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, 60_000);
    };
    schedule();
    return () => {
      if (timeoutID !== undefined) {
        window.clearTimeout(timeoutID);
      }
    };
  }, [active]);

  return now;
}

function taskProgress(tasks: RespondTaskCard[]) {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((task) =>
    ['done', 'completed', 'cancelled'].includes(task.status.toLowerCase()),
  ).length;
  return Math.round((done / tasks.length) * 100);
}

function RespondTimelineSubscription({
  incidentID,
  streamUrl,
}: {
  incidentID: string;
  streamUrl?: string | null;
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!streamUrl || typeof EventSource === 'undefined') return;
    const source = new EventSource(streamUrl);
    source.onmessage = () => {
      void queryClient.invalidateQueries({
        queryKey: ['respond-cockpit', incidentID],
      });
    };
    return () => source.close();
  }, [incidentID, queryClient, streamUrl]);

  return null;
}

export default function RespondIncidentCockpitPage() {
  const t = useRespondCockpitLabels();
  const common = useRespondCommonLabels();
  const statusLabels = useRespondStatusLabels();
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const incidentID = params?.id ?? '';

  const cockpitQuery = useQuery({
    queryKey: ['respond-cockpit', incidentID],
    queryFn: () => fetchRespondCockpit(incidentID),
    enabled: Boolean(incidentID),
  });

  const productQuery = useQuery({
    queryKey: ['respond-product'],
    queryFn: fetchRespondProduct,
  });

  const nowMs = useMinuteNow(
    Boolean(
      cockpitQuery.data &&
        !cockpitQuery.data.incident.resolved_at &&
        !cockpitQuery.data.incident.closed_at,
    ),
  );

  const refreshCockpit = async () => {
    await queryClient.invalidateQueries({ queryKey: ['respond-cockpit', incidentID] });
  };

  if (cockpitQuery.isLoading) {
    return <LoadingSkeleton variant="detail" label={t.loading} />;
  }

  if (cockpitQuery.error || !cockpitQuery.data) {
    return (
      <ErrorState
        error={cockpitQuery.error}
        title={t.unavailableTitle}
        message={t.unavailableMessage}
        onRetry={() => void cockpitQuery.refetch()}
      />
    );
  }

  const cockpit = cockpitQuery.data;
  const incident = cockpit.incident;
  const progress = taskProgress(cockpit.tasks);

  return (
    <div className="space-y-6">
      <RespondTimelineSubscription
        incidentID={incidentID}
        streamUrl={cockpit.timeline_stream_url}
      />

      <PageHeader
        eyebrow={t.eyebrow}
        title={`${incident.reference} · ${incident.title}`}
        description={incident.description ?? t.defaultDescription}
        tags={[
          { label: incident.severity, tone: incident.severity === 'SEV1' ? 'danger' : 'warning' },
          { label: statusLabels[incident.status] ?? incident.status, tone: 'info' },
          {
            label: cockpit.timeline_stream_url ? t.liveStreamConnected : t.timelineStreamUnavailable,
            icon: <Activity className="h-3.5 w-3.5" aria-hidden />,
            tone: cockpit.timeline_stream_url ? 'success' : 'neutral',
          },
        ]}
        stats={[
          { label: t.mttr, value: formatElapsed(mttrSeconds(cockpit, nowMs), t.durationUnits) },
          { label: t.tasks, value: cockpit.tasks.length },
          { label: t.roles, value: cockpit.roles.length },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <DetailStatCard
          label={t.declared}
          value={formatDateTime(incident.declared_at, common.unrecorded)}
          tone="sky"
          icon={Clock}
        />
        <DetailStatCard
          label={t.detected}
          value={formatDateTime(incident.detected_at, common.unrecorded)}
          tone="neutral"
        />
        <DetailStatCard
          label={t.impactedServices}
          value={incident.impacted_services.length}
          tone="gold"
          icon={AlertTriangle}
        />
        <DetailStatCard
          label={t.taskProgress}
          value={`${progress}%`}
          tone={progress === 100 ? 'emerald' : 'sky'}
          icon={CheckCircle2}
        />
      </div>

      <Tabs defaultValue="triage">
        <TabsList aria-label={t.workspaceAria}>
          <TabsTrigger value="triage">{t.tabTriage}</TabsTrigger>
          <TabsTrigger value="response">{t.tabResponse}</TabsTrigger>
          <TabsTrigger value="coordination">{t.tabCoordination}</TabsTrigger>
          <TabsTrigger value="evidence">{t.tabEvidence}</TabsTrigger>
        </TabsList>
        <TabsContent value="triage">
          <IncidentTriagePanel
            cockpit={cockpit}
            incidentID={incidentID}
            product={productQuery.data}
            onRefresh={refreshCockpit}
          />
        </TabsContent>
        <TabsContent value="response">
          <IncidentResponseExecutionPanels
            cockpit={cockpit}
            incidentID={incidentID}
            product={productQuery.data}
            onRefresh={refreshCockpit}
          />
        </TabsContent>
        <TabsContent value="coordination">
          <IncidentCoordinationPanels
            cockpit={cockpit}
            incidentID={incidentID}
            product={productQuery.data}
            onRefresh={refreshCockpit}
          />
        </TabsContent>
        <TabsContent value="evidence">
          <IncidentEvidencePanels
            cockpit={cockpit}
            incidentID={incidentID}
            product={productQuery.data}
            onRefresh={refreshCockpit}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
