import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { RemediationLifecycleBadge } from '@/app/(dashboard)/cyber/remediation/_components/remediation-lifecycle-badge';

describe('RemediationLifecycleBadge', () => {
  it('renders draft status', () => {
    renderWithQuery(<RemediationLifecycleBadge status="draft" />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders pending_approval status', () => {
    renderWithQuery(<RemediationLifecycleBadge status="pending_approval" />);
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
  });

  it('renders approved status', () => {
    renderWithQuery(<RemediationLifecycleBadge status="approved" />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  // The badge now delegates to the canonical StatusBadge: the label sits in an
  // inner `<span class="truncate">` while the tone/pulse/custom classes live on
  // the outer badge wrapper (its parentElement). Tones are token-driven
  // (primary → text-primary; danger → error-* ramp) rather than raw color names.
  it('renders verified status with primary brand color', () => {
    renderWithQuery(<RemediationLifecycleBadge status="verified" />);
    const badge = screen.getByText('Verified');
    expect(badge).toBeInTheDocument();
    expect(badge.parentElement?.className).toContain('primary');
  });

  it('renders rollback_failed status with red color', () => {
    renderWithQuery(<RemediationLifecycleBadge status="rollback_failed" />);
    const badge = screen.getByText('Rollback Failed');
    expect(badge).toBeInTheDocument();
    expect(badge.parentElement?.className).toContain('error');
  });

  it('applies custom className', () => {
    renderWithQuery(<RemediationLifecycleBadge status="closed" className="test-class" />);
    const badge = screen.getByText('Closed');
    expect(badge.parentElement?.className).toContain('test-class');
  });

  it('renders executing status with animate-pulse', () => {
    renderWithQuery(<RemediationLifecycleBadge status="executing" />);
    const badge = screen.getByText('Executing…');
    expect(badge.parentElement?.className).toContain('animate-pulse');
  });
});
