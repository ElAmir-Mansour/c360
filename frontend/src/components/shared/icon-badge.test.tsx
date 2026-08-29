import { render, screen } from '@testing-library/react';
import { Shield } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { IconBadge } from './icon-badge';

describe('IconBadge', () => {
  it('renders the icon decoratively (aria-hidden) when no label is given', () => {
    const { container } = render(<IconBadge icon={Shield} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper.querySelector('svg')).toBeInTheDocument();
  });

  it('exposes an accessible label as role="img" when provided', () => {
    render(<IconBadge icon={Shield} label="Protected" />);
    const el = screen.getByRole('img', { name: 'Protected' });
    expect(el).toBeInTheDocument();
    expect(el).not.toHaveAttribute('aria-hidden');
  });

  it('applies tone token classes', () => {
    const { container } = render(<IconBadge icon={Shield} tone="success" />);
    expect((container.firstChild as HTMLElement).className).toContain('text-success-700');
  });

  it('applies size variant classes', () => {
    const { container } = render(<IconBadge icon={Shield} size="lg" />);
    expect((container.firstChild as HTMLElement).className).toContain('h-11');
  });
});
