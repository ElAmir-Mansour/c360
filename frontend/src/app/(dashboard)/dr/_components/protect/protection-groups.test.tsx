import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ProtectionGroups } from './protection-groups';
import { protectStateLabels } from './protect-labels';

/**
 * #18 first-class states for the Protect route's protection-groups surface:
 *  - with no groups, the guided EMPTY state renders its onboarding CTA and fires
 *    the real `onOpenAdvisor` action (the in-page path to a first group);
 *  - the detail-pane ERROR state's retry invokes `onRetryGroup` (the refetch).
 */
describe('ProtectionGroups first-class states', () => {
  const noop = () => undefined;

  it('renders the guided onboarding CTA when there are no protection groups', async () => {
    const user = userEvent.setup();
    const onOpenAdvisor = vi.fn();

    renderWithQuery(
      <ProtectionGroups
        groups={[]}
        selectedGroupId={null}
        groupSummary={null}
        groupSummaryLoading={false}
        groupSummaryError={null}
        onSelectGroup={noop}
        onRetryGroup={noop}
        onOpenAdvisor={onOpenAdvisor}
      />,
    );

    expect(screen.getByText(protectStateLabels.noGroupsTitle)).toBeInTheDocument();

    const cta = screen.getByRole('button', { name: protectStateLabels.noGroupsAction });
    await user.click(cta);
    expect(onOpenAdvisor).toHaveBeenCalledTimes(1);
  });

  it('detail-pane error-state retry calls onRetryGroup (refetch)', async () => {
    const user = userEvent.setup();
    const onRetryGroup = vi.fn();

    renderWithQuery(
      <ProtectionGroups
        groups={[
          {
            group_id: 'g-1',
            name: 'Payments',
            health: 'healthy',
            member_count: 1,
            stream_count: 1,
            replication_percent: 100,
            rpo_objective_seconds: 300,
            rto_objective_seconds: 900,
          },
        ]}
        selectedGroupId="g-1"
        groupSummary={null}
        groupSummaryLoading={false}
        groupSummaryError={new Error('boom')}
        onSelectGroup={noop}
        onRetryGroup={onRetryGroup}
      />,
    );

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetryGroup).toHaveBeenCalledTimes(1);
  });
});
