import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { MetricTile } from './metric-tile';

describe('MetricTile', () => {
  it('renders label and value', () => {
    render(<MetricTile label="Open alerts" value={42} />);
    expect(screen.getByText('Open alerts')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('formats numeric values with locale separators', () => {
    render(<MetricTile label="Events" value={12345} />);
    expect(screen.getByText('12,345')).toBeInTheDocument();
  });

  it('shows a positive delta with a + sign and success color', () => {
    const { container } = render(<MetricTile label="Coverage" value="98%" delta={3.2} />);
    expect(screen.getByText(/\+3\.2%/)).toBeInTheDocument();
    expect(container.querySelector('.text-status-success')).toBeInTheDocument();
  });

  it('shows a negative delta with a danger color', () => {
    const { container } = render(<MetricTile label="Coverage" value="80%" delta={-5} />);
    expect(screen.getByText(/-5\.0%/)).toBeInTheDocument();
    expect(container.querySelector('.text-status-error')).toBeInTheDocument();
  });

  it('renders the leading icon chip when provided', () => {
    const { container } = render(<MetricTile label="Active" value={1} icon={Activity} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
