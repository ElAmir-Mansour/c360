import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { StatusPill, type StatusPillStatus } from './status-pill';

const STATUS_TOKEN: Record<StatusPillStatus, string> = {
  running: 'bg-info-50',
  pending: 'bg-neutral-100',
  passed: 'bg-success-50',
  failed: 'bg-error-50',
  degraded: 'bg-warning-50',
  blocked: 'bg-warning-50',
};

describe('StatusPill', () => {
  it('renders each semantic variant with role=status and the correct token class', () => {
    (Object.keys(STATUS_TOKEN) as StatusPillStatus[]).forEach((status) => {
      const { unmount } = renderWithQuery(
        <StatusPill status={status} label={status} />,
      );

      const pill = screen.getByRole('status');
      // role="status" is the assertion that AT will announce the run-state.
      expect(pill).toHaveAttribute('data-status', status);
      // Token-driven colour: each variant carries its state-ramp background.
      expect(pill.className).toContain(STATUS_TOKEN[status]);
      // Visible localizable label.
      expect(within(pill).getByText(status)).toBeInTheDocument();

      unmount();
    });
  });

  it('falls back to the default English label when none is provided', () => {
    renderWithQuery(<StatusPill status="passed" />);
    expect(screen.getByRole('status')).toHaveTextContent('Passed');
  });

  it('accepts a localized label for bilingual surfaces', () => {
    renderWithQuery(<StatusPill status="failed" label="فشل" />);
    expect(screen.getByRole('status')).toHaveTextContent('فشل');
  });

  it('exposes an accessible name when rendered icon-only', () => {
    renderWithQuery(
      <StatusPill status="blocked" iconOnly aria-label="Blocked: approval required" />,
    );
    const pill = screen.getByRole('status');
    expect(pill).toHaveAccessibleName('Blocked: approval required');
    // No visible text node when icon-only.
    expect(pill).not.toHaveTextContent('Blocked');
  });

  it('uses a token radius (rounded-pill) rather than a hardcoded radius', () => {
    renderWithQuery(<StatusPill status="running" />);
    expect(screen.getByRole('status').className).toContain('rounded-pill');
  });
});
