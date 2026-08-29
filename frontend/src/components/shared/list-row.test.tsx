import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { ListRow } from './list-row';

describe('ListRow', () => {
  it('renders title and subtitle', () => {
    render(<ListRow title="Primary site" subtitle="us-east-1" />);
    expect(screen.getByText('Primary site')).toBeInTheDocument();
    expect(screen.getByText('us-east-1')).toBeInTheDocument();
  });

  it('renders as a link when href is provided', () => {
    render(<ListRow title="Go to detail" href="/sites/1" />);
    const link = screen.getByRole('link', { name: /Go to detail/ });
    expect(link).toHaveAttribute('href', '/sites/1');
  });

  it('renders as a button and calls onClick', async () => {
    const onClick = vi.fn();
    render(<ListRow title="Clickable" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: /Clickable/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders a plain div when neither href nor onClick is given', () => {
    render(<ListRow title="Static" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reflects selected state via aria attributes', () => {
    const { rerender } = render(<ListRow title="Linked" href="/x" selected />);
    expect(screen.getByRole('link')).toHaveAttribute('aria-current', 'true');

    rerender(<ListRow title="Pressable" onClick={() => undefined} selected />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders leading and trailing slots', () => {
    render(
      <ListRow
        title="With slots"
        leading={<span data-testid="lead">L</span>}
        trailing={<span data-testid="trail">T</span>}
      />,
    );
    expect(screen.getByTestId('lead')).toBeInTheDocument();
    expect(screen.getByTestId('trail')).toBeInTheDocument();
  });
});
