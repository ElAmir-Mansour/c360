import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { RunbookTaskFlow } from './runbook-task-flow';
import {
  computeCriticalPath,
  computeFrontier,
  buildRunbookFlow,
  bootTiersToRunbookTasks,
  type RunbookTaskRunStatus,
} from './runbook-graph';
import {
  sampleRunbookTasks,
  sampleTaskRuns,
  sampleProjection,
  sampleCriticalPathIds,
  sampleCriticalPathSeconds,
  runbookTaskFlowLabelsEn,
  runbookTaskFlowLabelsAr,
} from './runbook-fixtures';
import type { DRBootService } from '@/types/clario-dr';

describe('runbook-graph critical path', () => {
  it('computes the critical path on the known dependency set', () => {
    const cp = computeCriticalPath(sampleRunbookTasks);
    expect(cp.path).toEqual(sampleCriticalPathIds);
    expect(cp.totalSeconds).toBe(sampleCriticalPathSeconds);
    // The parallel comms branch must NOT be on the critical path.
    expect(cp.pathSet.has('task-notify')).toBe(false);
  });

  it('marks every critical-path task and only those in the flow rows', () => {
    const { rows } = buildRunbookFlow(sampleRunbookTasks, sampleTaskRuns);
    const onPath = rows.filter((r) => r.onCriticalPath).map((r) => r.task.id);
    expect(onPath.sort()).toEqual([...sampleCriticalPathIds].sort());
  });

  it('orders the flow topologically (predecessors before dependents)', () => {
    const { rows } = buildRunbookFlow(sampleRunbookTasks);
    const order = rows.map((r) => r.task.id);
    for (const t of sampleRunbookTasks) {
      const ti = order.indexOf(t.id);
      for (const pre of t.predecessors) {
        expect(order.indexOf(pre)).toBeLessThan(ti);
      }
    }
  });

  it('computes the runnable frontier from per-task statuses', () => {
    // detect+quiesce complete, snapshot running → frontier is empty downstream of
    // snapshot (approve waits on snapshot); notify already complete.
    const statuses = new Map<string, RunbookTaskRunStatus>([
      ['task-detect', 'complete'],
      ['task-notify', 'complete'],
      ['task-quiesce', 'complete'],
      ['task-snapshot', 'complete'],
    ]);
    const frontier = computeFrontier(sampleRunbookTasks, statuses);
    // With detect/notify/quiesce/snapshot complete, the only newly-runnable task
    // is the approval gate.
    expect(frontier).toEqual(['task-approve']);
  });

  it('synthesizes runbook tasks from bootgraph tiers with tier-edge predecessors', () => {
    const tiers: DRBootService[][] = [
      [bootService('svc-net', 'network'), bootService('svc-dns', 'dns')],
      [bootService('svc-db', 'database')],
      [bootService('svc-app', 'app')],
    ];
    const tasks = bootTiersToRunbookTasks('group-1', tiers);
    expect(tasks).toHaveLength(4);
    const db = tasks.find((t) => t.id === 'svc-db');
    // tier-2 db depends on BOTH tier-1 services.
    expect(db?.predecessors.sort()).toEqual(['svc-dns', 'svc-net']);
    const app = tasks.find((t) => t.id === 'svc-app');
    expect(app?.predecessors).toEqual(['svc-db']);
    // The boot-plan critical path is net/dns → db → app.
    const cp = computeCriticalPath(tasks);
    expect(cp.path[cp.path.length - 1]).toBe('svc-app');
  });
});

describe('RunbookTaskFlow', () => {
  it('renders one row per task and highlights the critical path accessibly', () => {
    renderWithQuery(
      <RunbookTaskFlow
        tasks={sampleRunbookTasks}
        taskRuns={sampleTaskRuns}
        projection={sampleProjection}
        labels={runbookTaskFlowLabelsEn}
        title="Regional failover"
      />,
    );

    const list = screen.getByRole('list', {
      name: runbookTaskFlowLabelsEn.listAriaLabel,
    });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(sampleRunbookTasks.length);

    // Critical-path rows expose aria-current="step"; the comms task does not.
    const stepRows = items.filter(
      (el) => el.getAttribute('aria-current') === 'step',
    );
    expect(stepRows).toHaveLength(sampleCriticalPathIds.length);

    // Each critical-path row's accessible name mentions the critical path.
    for (const row of stepRows) {
      expect(row.getAttribute('aria-label')).toContain(
        runbookTaskFlowLabelsEn.onCriticalPath,
      );
    }
  });

  it('renders who/what/when content for a task', () => {
    renderWithQuery(
      <RunbookTaskFlow
        tasks={sampleRunbookTasks}
        taskRuns={sampleTaskRuns}
        labels={runbookTaskFlowLabelsEn}
      />,
    );
    expect(
      screen.getByText('Approve cutover to recovery region'),
    ).toBeInTheDocument();
    // automated tasks show their automation action as the "what".
    expect(screen.getByText('dr:seal-recovery-point')).toBeInTheDocument();
    // owner is rendered.
    expect(screen.getAllByText('DR Authoriser').length).toBeGreaterThan(0);
  });

  it('invokes onSelectTask when a row is activated', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <RunbookTaskFlow
        tasks={sampleRunbookTasks}
        labels={runbookTaskFlowLabelsEn}
        onSelectTask={onSelect}
      />,
    );
    const list = screen.getByRole('list', {
      name: runbookTaskFlowLabelsEn.listAriaLabel,
    });
    const firstRow = within(list).getAllByRole('listitem')[0];
    await user.click(firstRow);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('task-detect');
  });

  it('keeps the sequence order under RTL (Arabic locale)', () => {
    renderWithQuery(
      <RunbookTaskFlow
        tasks={sampleRunbookTasks}
        labels={runbookTaskFlowLabelsAr}
      />,
      { locale: 'ar' },
    );
    const list = screen.getByRole('list', {
      name: runbookTaskFlowLabelsAr.listAriaLabel,
    });
    const items = within(list).getAllByRole('listitem');
    // The first task (detect) is the topological root regardless of direction;
    // DOM/content order is preserved (the visual mirroring is the browser's job).
    expect(items[0].getAttribute('aria-label')).toContain('1.');
    expect(items[items.length - 1].getAttribute('aria-label')).toContain(
      String(sampleRunbookTasks.length),
    );
    // Arabic task-type label is used (RTL/bilingual copy flows through props).
    expect(
      screen.getAllByText((content) => content.includes('آلي')).length,
    ).toBeGreaterThan(0);
  });

  it('renders an empty state when there are no tasks', () => {
    renderWithQuery(
      <RunbookTaskFlow tasks={[]} labels={runbookTaskFlowLabelsEn} />,
    );
    expect(
      screen.getByText(runbookTaskFlowLabelsEn.emptyTitle),
    ).toBeInTheDocument();
  });
});

function bootService(id: string, name: string): DRBootService {
  return {
    id,
    tenant_id: 'tenant-clario-dr',
    group_id: 'group-1',
    name,
    kind: 'service',
    boot_action: 'start',
    probe_kind: 'http',
    probe_target: `https://${name}.recovery.local/health`,
    probe_expect_status: 200,
    boot_timeout_seconds: 120,
    health_retries: 3,
    created_at: '2026-06-15T09:00:00Z',
    updated_at: '2026-06-15T09:00:00Z',
  };
}
