'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Clock, RadioTower } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { ListRow } from '@/components/shared/list-row';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { fetchRespondIncidents } from '@/lib/respond';
import type { RespondIncidentListItem, RespondSeverity } from '@/types/respond';
import { IncidentDeclarationPanel } from '../_components/incident-declaration-panel';
import {
  useRespondCommonLabels,
  useRespondIncidentsLabels,
  useRespondStatusLabels,
} from '../_lib/respond-i18n';

const severityAccent: Record<RespondSeverity, string> = {
  SEV1: 'hsl(var(--severity-critical))',
  SEV2: 'hsl(var(--severity-high))',
  SEV3: 'hsl(var(--severity-medium))',
  SEV4: 'hsl(var(--severity-low))',
};

/** SEV code → semantic tone so severity badges read by color, not just text. */
const severityTone: Record<RespondSeverity, StatusTone> = {
  SEV1: 'critical',
  SEV2: 'danger',
  SEV3: 'warning',
  SEV4: 'info',
};

function IncidentTrailing({
  incident,
  labels,
}: {
  incident: RespondIncidentListItem;
  labels: ReturnType<typeof useRespondIncidentsLabels>;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-end sm:block">
        <p className="text-xs font-medium text-foreground">
          {incident.commander_name ?? labels.noCommander}
        </p>
        <p className="text-overline text-muted-foreground">
          {labels.taskSummary(incident.open_tasks ?? 0, incident.overdue_tasks ?? 0)}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
    </div>
  );
}

export default function RespondIncidentsPage() {
  const common = useRespondCommonLabels();
  const t = useRespondIncidentsLabels();
  const statusLabels = useRespondStatusLabels();

  const formatDateTime = (value?: string | null) => {
    if (!value) return common.unrecorded;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  };

  const incidentsQuery = useQuery({
    queryKey: ['respond-incidents', { page: 1, per_page: 50 }],
    queryFn: () => fetchRespondIncidents({ page: 1, per_page: 50 }),
  });

  if (incidentsQuery.isLoading) {
    return <LoadingSkeleton variant="list" count={6} label={t.loading} />;
  }

  if (incidentsQuery.error) {
    return (
      <ErrorState
        error={incidentsQuery.error}
        title={t.unavailableTitle}
        message={t.unavailableMessage}
        onRetry={() => void incidentsQuery.refetch()}
      />
    );
  }

  const incidents = incidentsQuery.data?.incidents ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={common.eyebrow}
        title={t.title}
        description={t.description}
        tags={[
          { label: t.totalTag(incidentsQuery.data?.total ?? incidents.length), tone: 'neutral' },
          { label: t.loadedTag(incidents.length), tone: 'info' },
        ]}
        actions={
          <Button asChild variant="outline">
            <Link href="/respond">
              <RadioTower className="me-2 h-4 w-4" aria-hidden />
              {common.product}
            </Link>
          </Button>
        }
      />

      <IncidentDeclarationPanel />

      <Card>
        <CardHeader>
          <CardTitle>{t.queueTitle}</CardTitle>
          <CardDescription>{t.queueDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {incidents.length ? (
            <div className="space-y-3">
              {incidents.map((incident) => (
                <ListRow
                  key={incident.id}
                  href={`/respond/incidents/${encodeURIComponent(incident.id)}`}
                  leadingAccent
                  accentColor={severityAccent[incident.severity]}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{incident.reference}</span>
                      <StatusBadge
                        status={incident.severity}
                        tone={severityTone[incident.severity]}
                        size="sm"
                      />
                      <StatusBadge
                        status={incident.status}
                        label={statusLabels[incident.status] ?? incident.status}
                        size="sm"
                        variant="outline"
                      />
                    </span>
                  }
                  subtitle={incident.title}
                  trailing={<IncidentTrailing incident={incident} labels={t} />}
                >
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      {t.declaredAt(formatDateTime(incident.declared_at))}
                    </span>
                    {incident.impacted_services.length ? (
                      <span>{incident.impacted_services.join(', ')}</span>
                    ) : (
                      <span>{t.noImpactedServices}</span>
                    )}
                  </div>
                </ListRow>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title={t.emptyTitle}
              description={t.emptyDescription}
              size="compact"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
