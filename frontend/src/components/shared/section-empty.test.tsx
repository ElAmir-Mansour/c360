import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { SectionEmpty } from './section-empty';

describe('SectionEmpty', () => {
  it('renders title and description', () => {
    render(<SectionEmpty icon={Inbox} title="No items" description="Nothing here yet." />);
    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  it('renders an action button that calls onClick', async () => {
    const onClick = vi.fn();
    render(<SectionEmpty title="Empty" action={{ label: 'Add item', onClick }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders the action as a link when href is provided', () => {
    render(<SectionEmpty title="Empty" action={{ label: 'Go', href: '/somewhere' }} />);
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link).toHaveAttribute('href', '/somewhere');
  });

  it('omits the icon when none is given', () => {
    const { container } = render(<SectionEmpty title="No icon" />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });
});
