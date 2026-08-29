import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkforceTeamGallery } from './workforce-team-gallery';

describe('WorkforceTeamGallery', () => {
  it('renders populated and all six contract states in English and Arabic', () => {
    const { container } = render(<WorkforceTeamGallery />);

    expect(container.querySelectorAll('[data-workforce-gallery-state]')).toHaveLength(14);
    for (const id of [
      '#workforce-team-en-populated', '#workforce-team-en-loading', '#workforce-team-en-empty',
      '#workforce-team-en-error', '#workforce-team-en-zero', '#workforce-team-en-unavailable',
      '#workforce-team-en-degraded', '#workforce-team-ar-populated', '#workforce-team-ar-degraded',
    ]) {
      expect(container.querySelector(id)).toBeInTheDocument();
    }
    expect(container.querySelector('[dir="rtl"][lang="ar"]')).toBeInTheDocument();
    expect(
      within(container.querySelector<HTMLElement>('#workforce-team-en-populated')!).getByText(
        'Resolved in period / resolved + open at period end',
      ),
    ).toBeVisible();
    expect(
      within(container.querySelector<HTMLElement>('#workforce-team-ar-populated')!).getByText(
        'المستحق خلال الفترة / المنفّذ في موعده',
      ),
    ).toBeVisible();
    const zero = container.querySelector<HTMLElement>('#workforce-team-en-zero');
    expect(within(zero!).getAllByLabelText(/zero configured capacity/i).length).toBeGreaterThan(0);
  });

  it('exercises the required degraded fixture facts and retry interaction', () => {
    const { container } = render(<WorkforceTeamGallery />);
    const degraded = container.querySelector<HTMLElement>('#workforce-team-en-degraded');
    expect(degraded).not.toBeNull();
    expect(within(degraded!).getByText(/Org roster not configured/)).toBeVisible();
    expect(within(degraded!).getByText(/Contracts: you do not have permission/)).toBeVisible();
    expect(within(degraded!).getByText(/Cases: the domain could not be queried/)).toBeVisible();
    expect(within(degraded!).getByText(/36 of 59 items attributed \(61%\)/)).toBeVisible();
    expect(within(degraded!).getByText('Inactive')).toBeVisible();
    expect(within(degraded!).getByText('Unverified identity')).toBeVisible();

    const error = container.querySelector<HTMLElement>('#workforce-team-en-error');
    fireEvent.click(within(error!).getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Workforce retry interactions: 1')).toBeVisible();
  });
});
