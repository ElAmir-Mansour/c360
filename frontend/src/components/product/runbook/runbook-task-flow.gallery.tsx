'use client';

/**
 * RunbookTaskFlow — gallery (Storybook-ready demos).
 * ==================================================
 *
 * Composable, dependency-free demos for the ClarioDR runbook task-flow. NOT
 * imported by any route (never ships in the app bundle) and NOT a test (not
 * collected by Vitest). Wrap a demo in a `LocaleProvider` (and `next-themes`
 * `ThemeProvider`) to exercise bilingual / light-dark / RTL; pass `locale="ar"`
 * for the RTL Arabic variant.
 *
 * Sample data is the REAL DR shape (`DRRunbookTask` / `DRRunbookTaskRun` /
 * `DRRunbookProjection`) — no fake contract masking.
 */

import { RunbookTaskFlow } from './runbook-task-flow';
import { bootTiersToRunbookTasks } from './runbook-graph';
import {
  sampleRunbookTasks,
  sampleTaskRuns,
  sampleProjection,
  runbookTaskFlowLabelsEn,
  runbookTaskFlowLabelsAr,
} from './runbook-fixtures';
import type { DRBootService } from '@/types/clario-dr';

const NOW = '2026-06-15T09:00:00Z';

function bootService(
  id: string,
  name: string,
  kind: string,
  timeout: number,
): DRBootService {
  return {
    id,
    tenant_id: 'tenant-clario-dr',
    group_id: 'group-payments',
    name,
    kind,
    boot_action: 'start',
    site_id: 'site-recovery',
    probe_kind: 'http',
    probe_target: `https://${name}.recovery.local/health`,
    probe_expect_status: 200,
    boot_timeout_seconds: timeout,
    health_retries: 3,
    created_at: NOW,
    updated_at: NOW,
  };
}

/** A live run: spine through `approve` executed, `snapshot` running. */
export function LiveRunStory() {
  return (
    <div className="bg-bg-page p-section-x">
      <RunbookTaskFlow
        tasks={sampleRunbookTasks}
        taskRuns={sampleTaskRuns}
        projection={sampleProjection}
        labels={runbookTaskFlowLabelsEn}
        title="Regional failover — live run"
        description="Sovereign cutover to the recovery region, with the critical path highlighted."
        onSelectTask={(task) => console.info('selected task', task.task_key)}
      />
    </div>
  );
}

/** Plan-only view (no live run rows). */
export function PlanOnlyStory() {
  return (
    <div className="bg-bg-page p-section-x">
      <RunbookTaskFlow
        tasks={sampleRunbookTasks}
        labels={runbookTaskFlowLabelsEn}
        title="Regional failover — authored plan"
      />
    </div>
  );
}

/** RTL / Arabic variant — wrap the host in `dir="rtl"` and `LocaleProvider ar`. */
export function ArabicRtlStory() {
  return (
    <div dir="rtl" className="bg-bg-page p-section-x">
      <RunbookTaskFlow
        tasks={sampleRunbookTasks}
        taskRuns={sampleTaskRuns}
        projection={sampleProjection}
        labels={runbookTaskFlowLabelsAr}
        title="التعافي الإقليمي — تشغيل مباشر"
      />
    </div>
  );
}

/** A bootgraph boot plan rendered through the same critical-path task-flow. */
export function BootPlanStory() {
  const tiers: DRBootService[][] = [
    [
      bootService('svc-net', 'network-fabric', 'network', 120),
      bootService('svc-dns', 'dns', 'dns', 90),
    ],
    [
      bootService('svc-db', 'payments-db', 'database', 540),
      bootService('svc-cache', 'session-cache', 'cache', 180),
    ],
    [bootService('svc-app', 'payments-api', 'app', 360)],
    [bootService('svc-edge', 'edge-gateway', 'gateway', 150)],
  ];
  const tasks = bootTiersToRunbookTasks('group-payments', tiers);
  return (
    <div className="bg-bg-page p-section-x">
      <RunbookTaskFlow
        tasks={tasks}
        labels={runbookTaskFlowLabelsEn}
        title="Boot plan — tiered service start order"
        description="Bootgraph tiers projected as an automated task DAG; tier N+1 starts after tier N."
      />
    </div>
  );
}

const gallery = {
  title: 'Product/Runbook/RunbookTaskFlow',
  stories: {
    LiveRun: LiveRunStory,
    PlanOnly: PlanOnlyStory,
    ArabicRtl: ArabicRtlStory,
    BootPlan: BootPlanStory,
  },
};

export default gallery;
