import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { TestResult } from '@/lib/lex/integrations';
import { logsLabels } from './logs-labels';
import { TestResultsTimeline, type TestResultEntry } from './test-results-timeline';

const local = logsLabels.en;

function makeEntry(reachable: boolean, id = 'e1'): TestResultEntry {
  const result: TestResult = {
    endpoint_id: 'ep-1',
    reachable,
    detail: reachable ? 'All good' : 'Connection refused',
    sample_count: reachable ? 12 : 0,
    latency_millis: 84,
  };
  return { id, result, at: Date.now() };
}

describe('TestResultsTimeline', () => {
  it('renders a genuine empty state when no tests have run', () => {
    renderWithQuery(
      <TestResultsTimeline
        entries={[]}
        running={false}
        canTest
        onRunTest={() => undefined}
        local={local}
      />,
    );
    expect(screen.getByText(local.testsEmptyTitle)).toBeInTheDocument();
  });

  it('renders reachable and unreachable entries with latency and sample counts', () => {
    renderWithQuery(
      <TestResultsTimeline
        entries={[makeEntry(true, 'ok'), makeEntry(false, 'bad')]}
        running={false}
        canTest
        onRunTest={() => undefined}
        local={local}
      />,
    );
    expect(screen.getByText(local.testReachable)).toBeInTheDocument();
    expect(screen.getByText(local.testUnreachable)).toBeInTheDocument();
    // Latency interpolation renders.
    expect(screen.getAllByText('84 ms').length).toBeGreaterThan(0);
  });

  it('fires onRunTest from the trigger when allowed', async () => {
    const user = userEvent.setup();
    const onRunTest = vi.fn();
    renderWithQuery(
      <TestResultsTimeline
        entries={[]}
        running={false}
        canTest
        onRunTest={onRunTest}
        local={local}
      />,
    );
    await user.click(screen.getByRole('button', { name: local.testsRunNow }));
    expect(onRunTest).toHaveBeenCalledTimes(1);
  });

  it('disables the trigger while a test is running (no double-submit)', () => {
    renderWithQuery(
      <TestResultsTimeline
        entries={[]}
        running
        canTest
        onRunTest={() => undefined}
        local={local}
      />,
    );
    expect(screen.getByRole('button', { name: local.testsRunning })).toBeDisabled();
  });

  it('hides the trigger entirely when the operator lacks write permission', () => {
    renderWithQuery(
      <TestResultsTimeline
        entries={[]}
        running={false}
        canTest={false}
        onRunTest={() => undefined}
        local={local}
      />,
    );
    expect(screen.queryByRole('button', { name: local.testsRunNow })).toBeNull();
  });

  it('renders Arabic copy under the ar locale', () => {
    renderWithQuery(
      <TestResultsTimeline
        entries={[]}
        running={false}
        canTest
        onRunTest={() => undefined}
        local={logsLabels.ar}
      />,
      { locale: 'ar' },
    );
    expect(screen.getByText(logsLabels.ar.testsEmptyTitle)).toBeInTheDocument();
  });
});
