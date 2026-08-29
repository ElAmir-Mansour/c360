import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { FailoverOperations } from './failover-operations';
import { recoverStateLabels } from './recover-labels';

/**
 * #18 first-class states for the Recover route's failover-operations surface:
 *  - the guided EMPTY state renders its declare-run CTA and fires the real
 *    `onDeclareRun` action (only when declaring is permitted);
 *  - the consistent ERROR state's retry invokes `onRetry` (the page's refetch).
 *
 * Renders the component directly (no route mocking) — it takes plain props, so
 * the states are asserted against the real `recover-labels` copy and the shared
 * `SectionEmpty` / `ErrorState` primitives.
 */
describe('FailoverOperations first-class states', () => {
  const noop = () => undefined;

  it('renders the guided empty-state CTA and fires onDeclareRun when declaring is allowed', async () => {
    const user = userEvent.setup();
    const onDeclareRun = vi.fn();

    renderWithQuery(
      <FailoverOperations
        runs={[]}
        activeRun={null}
        gateIndex={0}
        groups={[]}
        error={null}
        onRetry={noop}
        onDeclareRun={onDeclareRun}
        canDeclareRun
      />,
    );

    // Guided onboarding copy (not a bare "no runs" line).
    expect(screen.getByText(recoverStateLabels.noRunsTitle)).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: recoverStateLabels.noRunsAction });
    await user.click(cta);
    expect(onDeclareRun).toHaveBeenCalledTimes(1);
  });

  it('omits the declare CTA when declaring is not permitted (read-only / no group)', () => {
    renderWithQuery(
      <FailoverOperations
        runs={[]}
        activeRun={null}
        gateIndex={0}
        groups={[]}
        error={null}
        onRetry={noop}
        onDeclareRun={vi.fn()}
        canDeclareRun={false}
      />,
    );

    expect(screen.getByText(recoverStateLabels.noRunsTitle)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: recoverStateLabels.noRunsAction }),
    ).not.toBeInTheDocument();
  });

  it('error-state retry calls onRetry (refetch) when the runs query failed with no data', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    renderWithQuery(
      <FailoverOperations
        runs={[]}
        activeRun={null}
        gateIndex={0}
        groups={[]}
        error={new Error('boom')}
        onRetry={onRetry}
        onOpenRun={noop}
      />,
    );

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
