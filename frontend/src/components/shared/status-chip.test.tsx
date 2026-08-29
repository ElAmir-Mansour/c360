import { render, screen } from '@testing-library/react';
import { CheckCircle } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { StatusChip } from './status-chip';

describe('StatusChip', () => {
  it('always renders the text label alongside color (no color-only meaning)', () => {
    render(<StatusChip label="Active" tone="success" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('resolves tone color from tokens', () => {
    const { container } = render(<StatusChip label="Failed" tone="danger" />);
    expect((container.firstChild as HTMLElement).className).toContain('text-error-700');
  });

  it('renders an optional icon as decorative', () => {
    const { container } = render(<StatusChip label="Passed" tone="success" icon={CheckCircle} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies size variant classes', () => {
    const { container } = render(<StatusChip label="Big" size="lg" />);
    expect((container.firstChild as HTMLElement).className).toContain('text-sm');
  });
});
