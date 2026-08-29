import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ConfidenceGauge } from '@/app/(dashboard)/cyber/alerts/[id]/_components/confidence-gauge';

describe('ConfidenceGauge', () => {
  it('renders score percentage', () => {
    renderWithQuery(<ConfidenceGauge score={75} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows Very High label for score >= 85', () => {
    renderWithQuery(<ConfidenceGauge score={90} />);
    expect(screen.getByText('Very High Confidence')).toBeInTheDocument();
  });

  it('shows High label for score 70-84', () => {
    renderWithQuery(<ConfidenceGauge score={75} />);
    expect(screen.getByText('High Confidence')).toBeInTheDocument();
  });

  it('shows Medium label for score 50-69', () => {
    renderWithQuery(<ConfidenceGauge score={60} />);
    expect(screen.getByText('Medium Confidence')).toBeInTheDocument();
  });

  it('shows Low label for score < 50', () => {
    renderWithQuery(<ConfidenceGauge score={30} />);
    expect(screen.getByText('Low Confidence')).toBeInTheDocument();
  });

  it('renders SVG gauge element', () => {
    const { container } = renderWithQuery(<ConfidenceGauge score={80} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('accepts size prop', () => {
    renderWithQuery(<ConfidenceGauge score={50} size="lg" />);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });
});
