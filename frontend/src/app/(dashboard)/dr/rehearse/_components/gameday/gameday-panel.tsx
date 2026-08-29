'use client';

import { useEffect, useMemo, useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DRWriteGate } from '../../../_components/console/dr-write-gate';
import { useGameDayActions } from '../../../_hooks/use-dr-actions';
import { useDRDrillDiff, useDRGameDayScorecard } from '../../../_hooks/use-dr-queries';
import type { DRDrillResult } from '@/types/clario-dr';
import {
  CreateScenarioDialog,
  type ScenarioGroupOption,
} from './create-scenario-dialog';
import { DrillDiffPanel } from './drill-diff-panel';
import { ScorecardPanel, type ScorecardRunOption } from './scorecard-panel';
import { useGameDayLabels } from './gameday-labels';

export interface GameDayPanelProps {
  /** Whether the operator holds `dr:write` (gates scenario authoring). */
  canWrite: boolean;
  /** The console's active protection group id (seeds the create form). */
  activeGroupId: string | null;
  /** Protection groups the scenario can be scoped to. */
  groups: ScenarioGroupOption[];
  /** Drill results for the active group (the diff picker source). */
  drillResults: DRDrillResult[];
}

/**
 * Game Day authoring + evidence surface for the Rehearse route.
 *
 * Adds the three pieces the rehearse page could not previously do:
 *   1. Author a new game-day scenario (gated by `dr:write` via the shared write
 *      gate) — {@link CreateScenarioDialog} → `useGameDayActions().createScenario`.
 *   2. Read a completed run's scorecard — {@link ScorecardPanel}; the live
 *      `runScenario` result is shown immediately, and any completed run can be
 *      re-opened by its run id via `useDRGameDayScorecard`.
 *   3. Compare a drill result against its predecessor — {@link DrillDiffPanel} →
 *      `useDRDrillDiff` (planned-vs-actual).
 *
 * The existing run-scenario / drill-calendar content on the page is untouched;
 * this panel is purely additive. Token-driven, bilingual, RTL-safe.
 */
export function GameDayPanel({
  canWrite,
  activeGroupId,
  groups,
  drillResults,
}: GameDayPanelProps) {
  const labels = useGameDayLabels();
  const actions = useGameDayActions();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);

  // Default the diff picker to the most recent drill result once results load.
  useEffect(() => {
    if (!selectedResultId && drillResults.length > 0) {
      const latest = [...drillResults].sort(
        (left, right) => timestampMs(right.observed_at) - timestampMs(left.observed_at),
      )[0];
      if (latest) setSelectedResultId(latest.id);
    }
  }, [drillResults, selectedResultId]);

  // A freshly run scenario surfaces its run id; preselect it in the picker.
  useEffect(() => {
    if (actions.latestRunId) {
      setSelectedRunId(actions.latestRunId);
    }
  }, [actions.latestRunId]);

  // Re-open a prior run's scorecard by run id; the live action already returns
  // the latest scorecard, so only query when re-selecting a different run.
  const scorecardQuery = useDRGameDayScorecard(
    selectedRunId && selectedRunId !== actions.latestScorecard?.run.id ? selectedRunId : null,
  );
  const diffQuery = useDRDrillDiff(selectedResultId);

  // Scorecard runs the operator can re-open: the live run plus the active
  // group's recorded drill runs (each drill result carries its run id).
  const runOptions = useMemo<ScorecardRunOption[]>(() => {
    const seen = new Set<string>();
    const options: ScorecardRunOption[] = [];
    if (actions.latestScorecard) {
      const id = actions.latestScorecard.run.id;
      seen.add(id);
      options.push({ id, label: `${labels.runTriggerLabel} — ${shortId(id)}` });
    }
    for (const result of drillResults) {
      if (result.run_id && !seen.has(result.run_id)) {
        seen.add(result.run_id);
        options.push({ id: result.run_id, label: shortId(result.run_id) });
      }
    }
    return options;
  }, [actions.latestScorecard, drillResults, labels.runTriggerLabel]);

  const scorecard =
    selectedRunId && actions.latestScorecard?.run.id === selectedRunId
      ? actions.latestScorecard
      : (scorecardQuery.data ?? actions.latestScorecard ?? null);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <CardTitle className="text-base">{labels.title}</CardTitle>
          <CardDescription>{labels.description}</CardDescription>
        </div>
        <DRWriteGate canWrite={canWrite} description={labels.createDialogDescription}>
          <Button type="button" onClick={() => setCreateOpen(true)} disabled={groups.length === 0}>
            <PlusCircle className="me-2 h-4 w-4" aria-hidden />
            {labels.createTriggerLabel}
          </Button>
        </DRWriteGate>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScorecardPanel
          scorecard={scorecard}
          runOptions={runOptions}
          selectedRunId={selectedRunId}
          onSelectRun={setSelectedRunId}
          loading={scorecardQuery.isLoading}
          error={scorecardQuery.error}
          onRetry={() => void scorecardQuery.refetch()}
        />

        <DrillDiffPanel
          results={drillResults}
          selectedResultId={selectedResultId}
          onSelectResult={setSelectedResultId}
          diff={diffQuery.data ?? null}
          loading={diffQuery.isLoading}
          error={diffQuery.error}
          onRetry={() => void diffQuery.refetch()}
        />
      </CardContent>

      <CreateScenarioDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        groups={groups}
        defaultGroupId={activeGroupId}
        onCreate={(payload) => {
          actions.createScenario(payload);
          setCreateOpen(false);
        }}
        submitting={actions.createScenarioPending}
      />
    </Card>
  );
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}

function timestampMs(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
