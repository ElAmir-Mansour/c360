import { fireEvent, render, screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ContractKpiTile } from './contracts-kpi-tile';

describe('ContractKpiTile', () => {
  it('renders the compact operational treatment without a pill label or side rail', () => {
    const { container } = render(
      <ContractKpiTile
        title="Total contracts"
        value="21"
        theme="teal"
        icon={FileText}
        href="/lex/contracts"
        progress={100}
        progressLabel="Portfolio share"
        detail="Matching filters"
        detailValue="21"
      />,
    );

    const card = container.querySelector('.contract-kpi-card');
    expect(card).toHaveClass('min-h-40', 'shadow-none');
    expect(card).not.toHaveClass('kpi-card-themed');
    expect(screen.getByText('Total contracts').closest('p')).not.toBeNull();
    expect(screen.getByText('Portfolio share')).toBeInTheDocument();
    expect(screen.getByText('Matching filters')).toBeInTheDocument();
  });

  it('preserves keyboard-operable filter behaviour and selected state', () => {
    const onClick = vi.fn();
    render(
      <ContractKpiTile
        title="Active"
        value="12"
        theme="emerald"
        icon={FileText}
        active
        onClick={onClick}
      />,
    );

    const button = screen.getByRole('button', { name: /active/i });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
