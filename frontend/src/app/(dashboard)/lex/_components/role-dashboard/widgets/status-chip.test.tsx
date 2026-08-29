import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusChip, StatusChipSkeleton } from './status-chip';

describe('StatusChip', () => {
  it.each([
    {
      tone: 'critical' as const,
      label: 'At Limit',
      foreground: '--wt-critical',
      background: '--wt-critical-050',
    },
    {
      tone: 'ok' as const,
      label: 'Optimal',
      foreground: '--wt-teal-900',
      background: '--wt-ok-050',
    },
  ])('renders the $tone status with both an icon and visible label', ({
    tone,
    label,
    foreground,
    background,
  }) => {
    render(<StatusChip tone={tone} label={label} />);

    const chip = screen.getByRole('status', { name: label });
    const icon = chip.querySelector('svg');
    expect(chip).toHaveAttribute('data-tone', tone);
    expect(within(chip).getByText(label)).toBeInTheDocument();
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(chip.className).toContain(`var(${foreground})`);
    expect(chip.className).toContain(`var(${background})`);
    expect(chip.className).toContain('border-[length:var(--wt-card-border-width)]');
    expect(chip.className).toContain('rounded-[var(--wt-radius-pill)]');
    expect(chip.className).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(/i);
  });

  it('provides a localized, non-spinner skeleton companion', () => {
    const { container } = render(<StatusChipSkeleton label="جارٍ تحميل الحالة" />);

    const skeleton = screen.getByRole('status', { name: 'جارٍ تحميل الحالة' });
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(skeleton).toHaveAttribute('aria-live', 'polite');
    expect(container.querySelector('.skeleton-shimmer')).toHaveClass(
      'rounded-[var(--wt-radius-pill)]',
      'bg-[var(--wt-track)]',
    );
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});
