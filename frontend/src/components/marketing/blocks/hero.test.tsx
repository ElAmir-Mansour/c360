import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { Hero } from './hero';

describe('Hero', () => {
  const baseProps = {
    eyebrow: 'ClarioDR',
    headline: 'Recover faster with sovereign DR orchestration',
    subcopy:
      'Run, rehearse, and prove your disaster-recovery runbooks against real RTO and RTA targets — all on infrastructure you control.',
    primaryAction: { label: 'Start a recovery rehearsal', href: '/get-started' },
    secondaryAction: { label: 'Explore runbooks', href: '/runbooks' },
  } as const;

  it('renders the headline as the page H1', () => {
    renderWithQuery(<Hero {...baseProps} />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/recover faster with sovereign dr orchestration/i);
  });

  it('renders a default abstract visual when none is supplied', () => {
    const { container } = renderWithQuery(<Hero {...baseProps} />);

    // The default AbstractVisual renders an SVG inside the visual slot.
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('uses a supplied visual instead of the default', () => {
    renderWithQuery(
      <Hero
        {...baseProps}
        visual={<div data-testid="custom-visual">Recovery timeline</div>}
      />,
    );

    expect(screen.getByTestId('custom-visual')).toBeInTheDocument();
  });

  it('exposes both CTAs and makes them keyboard reachable in order', async () => {
    const user = userEvent.setup();
    renderWithQuery(<Hero {...baseProps} />);

    const primary = screen.getByRole('link', { name: /start a recovery rehearsal/i });
    const secondary = screen.getByRole('link', { name: /explore runbooks/i });

    expect(primary).toBeInTheDocument();
    expect(secondary).toBeInTheDocument();

    // Tab order reaches both CTAs.
    await user.tab();
    expect(primary).toHaveFocus();

    await user.tab();
    expect(secondary).toHaveFocus();
  });

  it('invokes onClick for button-style actions', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithQuery(
      <Hero
        {...baseProps}
        primaryAction={{ label: 'Request a demo', onClick }}
        secondaryAction={undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: /request a demo/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
