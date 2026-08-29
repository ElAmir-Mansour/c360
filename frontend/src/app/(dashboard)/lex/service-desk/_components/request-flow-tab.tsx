'use client';

/**
 * Workflow-diagram tab for a legal request: a read-only graphical swimlane of
 * the applicable Al Othaim PRD flow with the LIVE position highlighted.
 *
 *  - `request_type === 'litigation'` → PRD Diagram B (the four-lane sequential
 *    lawsuit-filing approval chain), whose per-tier position is derived from the
 *    running approval tasks.
 *  - everything else → PRD Diagram A (the two-lane Requester / Provider service
 *    request SLA flow), driven purely by the request FSM status.
 *
 * Entirely read-only: it consumes only data already loaded on the page
 * (`request`) plus the same approval-tasks query the approval surfaces use
 * (shared cache key `['lex-approval-tasks', id]`, non-fatal `retry:false`). If
 * those tasks are unavailable the diagram falls back to the request status.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SectionCard } from '@/components/suites/section-card';
import {
  SwimlaneFlow,
  SwimlaneLegend,
  selectDiagram,
  resolveActiveStage,
  useSwimlaneLabels,
} from '@/components/lex/swimlane';
import {
  lexRequestsApi,
  requestCanHaveApprovalTasks,
  type LegalRequest,
} from '@/lib/lex/requests';

interface RequestFlowTabProps {
  request: LegalRequest;
  requestId: string;
}

export function RequestFlowTab({ request, requestId }: RequestFlowTabProps) {
  const labels = useSwimlaneLabels();
  const model = useMemo(() => selectDiagram(request), [request]);
  const isDiagramB = model.id === 'B';

  // Diagram B highlights the live approval tier, so pull the running tasks
  // (shared cache with the approval panel). Non-fatal: on error/absence the
  // projection falls back to the request status. Diagram A never needs them.
  const tasksQuery = useQuery({
    queryKey: ['lex-approval-tasks', requestId],
    queryFn: () => lexRequestsApi.listApprovalTasks(requestId),
    enabled: isDiagramB && requestCanHaveApprovalTasks(request.workflow_instance_id),
    retry: false,
  });

  const active = useMemo(
    () => resolveActiveStage(model, request, tasksQuery.data ?? []),
    [model, request, tasksQuery.data],
  );

  return (
    <SectionCard
      title={labels.diagramTitle[model.id]}
      description={labels.diagramSubtitle[model.id]}
    >
      <div className="space-y-4">
        <SwimlaneFlow model={model} active={active} />
        <SwimlaneLegend />
        {active.offPath ? (
          <p className="text-caption text-muted-foreground">{labels.terminal.hint}</p>
        ) : null}
      </div>
    </SectionCard>
  );
}
