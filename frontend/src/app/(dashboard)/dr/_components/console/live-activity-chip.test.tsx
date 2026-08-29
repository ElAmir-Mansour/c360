import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveActivityChip } from './live-activity-chip';

/**
 * LiveActivityChip — the overview's subtle "live" indicator.
 *
 * Verifies the chip never conveys meaning by color/animation alone (it always
 * renders the provided text label) and exposes a polite live region so the
 * changing count is announced to assistive tech.
 */
describe('LiveActivityChip', () => {
  it('renders the provided label when live', () => {
    render(<LiveActivityChip liveCount={2} label="2 recoveries in flight" />);
    expect(screen.getByText('2 recoveries in flight')).toBeInTheDocument();
  });

  it('renders the provided label when idle', () => {
    render(<LiveActivityChip liveCount={0} label="No recovery in flight" />);
    expect(screen.getByText('No recovery in flight')).toBeInTheDocument();
  });

  it('marks the chip as a polite live region', () => {
    const { container } = render(
      <LiveActivityChip liveCount={1} label="1 recovery in flight" />,
    );
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
