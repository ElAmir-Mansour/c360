import { fireEvent, render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { KpiCard } from './kpi-card';
import { StatTile } from './stat-tile';

describe('StatTile operational appearance', () => {
  it('opts into a flat compact surface without changing the default card', () => {
    const { container, rerender } = render(
      <StatTile label="Open matters" value={12} icon={Activity} />,
    );

    expect(container.querySelector('.kpi-card-themed')).toBeInTheDocument();

    rerender(
      <StatTile
        appearance="operational"
        label="Open matters"
        value={12}
        icon={Activity}
      />,
    );

    const tile = screen
      .getByText('Open matters')
      .closest('[class~="group/stat-inner"]');
    expect(tile).toHaveClass('min-h-40', 'bg-card', 'shadow-none');
    expect(tile).not.toHaveClass('kpi-card-themed');
  });

  it('wraps actions in a keyboard-native toggle button', () => {
    const onAction = vi.fn();
    render(
      <StatTile
        appearance="operational"
        label="Breaching soon"
        value={3}
        onAction={onAction}
        pressed
      />,
    );

    const button = screen.getByRole('button', { name: /Breaching soon/ });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('disables an actionable tile without losing its content', () => {
    const onAction = vi.fn();
    render(
      <StatTile
        appearance="operational"
        label="Unavailable metric"
        value="—"
        onAction={onAction}
        disabled
      />,
    );

    const button = screen.getByRole('button', { name: /Unavailable metric/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('KpiCard operational adapter', () => {
  it('uses the medium StatTile layout while retaining the selected theme', () => {
    const { container } = render(
      <KpiCard
        appearance="operational"
        title="High risk"
        value={16}
        colorTheme="red"
        icon={Activity}
      />,
    );

    const tile = container.querySelector('.kpi-theme-red');
    expect(tile).toHaveClass('min-h-40', 'shadow-none');
    expect(tile).not.toHaveClass('kpi-card-themed');
    expect(screen.getByText('16')).toHaveClass('text-h2');
  });
});
