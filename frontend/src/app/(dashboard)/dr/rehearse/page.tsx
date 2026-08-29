'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/common/page-header';
import { useAuth } from '@/hooks/use-auth';
import { resolveDRGroupId, useDRSelection } from '../_lib/dr-selection';
import {
  useDRAgents,
  useDRAssuranceControls,
  useDRAssuranceLatest,
  useDRBootPlan,
  useDRConsistencyBarriers,
  useDRGroupDrillResults,
  useDRDrillSchedules,
  useDRFailbackRuns,
  useDRGameDayScenarios,
  useDRGroupSummary,
  useDRPosture,
  useDRTopology,
  useDRTopologyFailoverTarget,
} from '../_hooks/use-dr-queries';
import { useRecoveryActions, useRehearseActions } from '../_hooks/use-dr-actions';
import { DRAgentEnrollmentPanel } from '../_components/dr-agent-enrollment';
import { DRResilienceActionsPanel } from '../_components/dr-resilience-actions';
import { DRResilienceCockpit } from '../_components/dr-resilience-cockpit';
import { DRWriteGate } from '../_components/console/dr-write-gate';
import { DRSetupEmptyState } from '../_components/empty/dr-setup-empty-state';
import { DRActionGateNotice } from '../_components/empty/dr-action-gate-notice';
import { DrillCalendar } from './_components/calendar';
import { GameDayPanel, type ScenarioGroupOption } from './_components/gameday';
import { useRehearsePageLabels } from './rehearse-page-labels';

const WRITE_PERMISSION = 'dr:write';

/**
 * Rehearse (`/dr/rehearse`) — the resilience-engineering surface of the Recovery
 * Operations Console (replaces the legacy "resilience" tab).
 *
 * Operators enroll DR agents and mint enrollment tokens, review the resilience
 * cockpit (agent fleet, assurance controls, drills, topology/boot DAG, failback,
 * consistency barriers, game-day safety), and drive the rehearsal actions:
 * trigger app-consistent points, create isolated drill schedules, and run
 * non-production game-day fault-injection scenarios.
 *
 * Selection (`?group=`) is shared with the rest of the console via
 * `useDRSelection`; every query key/refetch interval and every mutation comes
 * from the shared `_hooks` so cross-route cache and invalidations stay coherent.
 * Write actions are gated by `dr:write` (read-only operators see the panels but
 * cannot trigger mutations).
 */
export default function DRRehearsePage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission(WRITE_PERMISSION);
  const labels = useRehearsePageLabels();

  const postureQuery = useDRPosture();
  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);

  const { activeGroupId } = useDRSelection({ groups });

  const selectedGroup = useMemo(
    () => groups.find((group) => resolveDRGroupId(group) === activeGroupId) ?? groups[0] ?? null,
    [groups, activeGroupId],
  );

  // Tenant-wide rehearse queries.
  const agentsQuery = useDRAgents();
  const assuranceControlsQuery = useDRAssuranceControls();
  const drillSchedulesQuery = useDRDrillSchedules();
  const failbackRunsQuery = useDRFailbackRuns();
  const gameDayScenariosQuery = useDRGameDayScenarios();

  // Group-scoped rehearse queries.
  const groupSummaryQuery = useDRGroupSummary(activeGroupId);
  const assuranceLatestQuery = useDRAssuranceLatest(activeGroupId);
  const bootPlanQuery = useDRBootPlan(activeGroupId);
  const consistencyBarriersQuery = useDRConsistencyBarriers(activeGroupId);
  const drillResultsQuery = useDRGroupDrillResults(activeGroupId);
  const topologyQuery = useDRTopology(activeGroupId);
  const topologySelectionQuery = useDRTopologyFailoverTarget(activeGroupId);

  const groupSummary = groupSummaryQuery.data ?? null;
  const selectedGroupName = groupSummary?.name ?? selectedGroup?.name ?? null;

  // Rehearse-domain mutations (agents, drills, game days, consistency barriers).
  const rehearse = useRehearseActions({
    activeGroupId,
    groupSummary,
    selectedGroup,
  });
  const recovery = useRecoveryActions({
    activeGroupId,
    activeStreamId: null,
  });

  const agents = agentsQuery.data ?? [];
  const consistencyBarriers = consistencyBarriersQuery.data ?? [];
  const drillSchedules = drillSchedulesQuery.data ?? [];
  const drillResults = drillResultsQuery.data ?? [];
  const gameDayScenarios = gameDayScenariosQuery.data ?? [];

  // Protection groups a game-day scenario can be scoped to (id + display name),
  // derived from the live posture rollup via the shared id resolver.
  const scenarioGroupOptions = useMemo<ScenarioGroupOption[]>(
    () =>
      groups.flatMap((group) => {
        const id = resolveDRGroupId(group);
        return id ? [{ id, name: group.name ?? id }] : [];
      }),
    [groups],
  );

  const refetchAll = () => {
    void agentsQuery.refetch();
    void assuranceControlsQuery.refetch();
    void assuranceLatestQuery.refetch();
    void bootPlanQuery.refetch();
    void consistencyBarriersQuery.refetch();
    void drillResultsQuery.refetch();
    void drillSchedulesQuery.refetch();
    void failbackRunsQuery.refetch();
    void gameDayScenariosQuery.refetch();
    void topologyQuery.refetch();
    void topologySelectionQuery.refetch();
  };

  // Cold-start on-ramp: with zero protection groups every drill/game-day action
  // is permanently gated, so show the create-a-group path instead of the wall.
  const postureLoaded = !postureQuery.isPending;
  const hasNoGroups = postureLoaded && groups.length === 0;

  if (hasNoGroups) {
    return (
      <div className="space-y-6">
        <PageHeader title={labels.title} description={labels.description} />
        <DRSetupEmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={labels.title} description={labels.description} />

      {/* Inline (not tooltip-only) reason when controls are visible but gated. */}
      {!canWrite ? (
        <DRActionGateNotice reason={labels.noWriteReason} />
      ) : !activeGroupId ? (
        <DRActionGateNotice reason={labels.noGroupReason} />
      ) : null}

      <DRWriteGate canWrite={canWrite} description={labels.enrollmentGateDescription}>
        <DRAgentEnrollmentPanel
          agents={agents}
          selectedAgentId={rehearse.selectedAgentId}
          enrollmentToken={rehearse.enrollmentToken}
          creatingAgent={rehearse.creatingAgent}
          mintingToken={rehearse.mintingToken}
          error={agentsQuery.error ?? rehearse.createAgentError ?? rehearse.mintTokenError}
          onCreateAgent={rehearse.createAgent}
          onMintToken={rehearse.mintToken}
          onSelectAgent={(agentID) => {
            rehearse.setSelectedAgentId(agentID);
            rehearse.setEnrollmentToken((token) =>
              token?.agent_id === agentID ? token : null,
            );
          }}
          onRetry={() => void agentsQuery.refetch()}
        />
      </DRWriteGate>

      <DRResilienceCockpit
        agents={agents}
        assuranceControls={assuranceControlsQuery.data ?? []}
        assuranceLatest={assuranceLatestQuery.data ?? null}
        bootPlan={bootPlanQuery.data ?? null}
        consistencyBarriers={consistencyBarriers}
        drillResults={drillResultsQuery.data ?? []}
        drillSchedules={drillSchedules}
        failbackRuns={failbackRunsQuery.data ?? []}
        gameDayScenarios={gameDayScenarios}
        selectedGroup={selectedGroup}
        topology={topologyQuery.data ?? null}
        topologySelection={topologySelectionQuery.data ?? null}
        loading={
          agentsQuery.isLoading ||
          assuranceControlsQuery.isLoading ||
          drillSchedulesQuery.isLoading ||
          failbackRunsQuery.isLoading ||
          gameDayScenariosQuery.isLoading
        }
        error={
          agentsQuery.error ??
          assuranceControlsQuery.error ??
          drillSchedulesQuery.error ??
          failbackRunsQuery.error ??
          gameDayScenariosQuery.error
        }
        onRetry={refetchAll}
      />

      <DrillCalendar
        schedules={drillSchedules}
        drillResults={drillResults}
        loading={drillSchedulesQuery.isLoading}
        error={drillSchedulesQuery.error}
        onRetry={() => void drillSchedulesQuery.refetch()}
      />

      <GameDayPanel
        canWrite={canWrite}
        activeGroupId={activeGroupId}
        groups={scenarioGroupOptions}
        drillResults={drillResults}
      />

      <DRWriteGate canWrite={canWrite} description={labels.actionsGateDescription}>
        <DRResilienceActionsPanel
          selectedGroupId={activeGroupId}
          selectedGroupName={selectedGroupName}
          consistencyBarriers={consistencyBarriers}
          drillSchedules={drillSchedules}
          gameDayScenarios={gameDayScenarios}
          latestConsistencyBarrier={recovery.latestConsistencyBarrier}
          latestDrillSchedule={rehearse.latestDrillSchedule}
          latestGameDayScorecard={rehearse.latestGameDayScorecard}
          loading={
            consistencyBarriersQuery.isLoading ||
            drillSchedulesQuery.isLoading ||
            gameDayScenariosQuery.isLoading
          }
          triggeringConsistencyPoint={recovery.triggeringConsistencyPoint}
          creatingDrillSchedule={rehearse.creatingDrillSchedule}
          runningGameDayScenario={rehearse.runningGameDayScenario}
          error={
            consistencyBarriersQuery.error ??
            drillSchedulesQuery.error ??
            gameDayScenariosQuery.error ??
            recovery.triggerConsistencyPointError ??
            rehearse.createDrillScheduleError ??
            rehearse.runGameDayError
          }
          onTriggerConsistencyPoint={recovery.triggerConsistencyPoint}
          onCreateDrillSchedule={rehearse.createDrillSchedule}
          onRunGameDayScenario={rehearse.runGameDay}
          onRetry={() => {
            void consistencyBarriersQuery.refetch();
            void drillSchedulesQuery.refetch();
            void gameDayScenariosQuery.refetch();
          }}
        />
      </DRWriteGate>
    </div>
  );
}
