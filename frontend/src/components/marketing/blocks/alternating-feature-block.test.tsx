import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import {
  AlternatingFeatureBlock,
  FeatureBlockList,
  type FeatureBlockItem,
} from './alternating-feature-block';

const items: FeatureBlockItem[] = [
  {
    id: 'replicate',
    eyebrow: 'Replication core',
    headline: 'Continuous, sovereign data replication',
    body: 'Keep recovery copies current with low-RPO replication that never leaves your jurisdiction.',
    bullets: ['Configurable RPO targets', 'WORM-backed integrity', 'Air-gapped vault support'],
    action: { label: 'See replication', href: '/replication' },
  },
  {
    id: 'orchestrate',
    eyebrow: 'Runbook orchestration',
    headline: 'Executable recovery runbooks',
    body: 'Turn recovery plans into runnable, auditable runbooks with human and automated steps.',
    bullets: ['Step-level evidence', 'Role-based approvals'],
    action: { label: 'See orchestration', href: '/orchestration' },
  },
  {
    id: 'prove',
    eyebrow: 'Recovery assurance',
    headline: 'Prove RTO and RTA on every rehearsal',
    body: 'Measure achieved recovery time against your targets and export tamper-evident evidence.',
  },
];

describe('AlternatingFeatureBlock', () => {
  it('renders headline, body, bullets and CTA', () => {
    renderWithQuery(<AlternatingFeatureBlock {...items[0]} reverse={false} />);

    expect(
      screen.getByRole('heading', { level: 2, name: /continuous, sovereign data replication/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/configurable rpo targets/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /see replication/i })).toBeInTheDocument();
  });

  it('exposes the reverse state via data-reverse for a single block', () => {
    const { container } = renderWithQuery(
      <AlternatingFeatureBlock {...items[0]} reverse />,
    );
    const section = container.querySelector('section');
    expect(section).toHaveAttribute('data-reverse', 'true');
  });

  it('auto-alternates the visual/text sides per index in FeatureBlockList', () => {
    const { container } = renderWithQuery(
      <FeatureBlockList items={items} ariaLabel="Capabilities" />,
    );

    const sections = Array.from(container.querySelectorAll('section'));
    expect(sections).toHaveLength(items.length);

    // startWithVisual default => index 0 not reversed, 1 reversed, 2 not reversed.
    expect(sections[0]).toHaveAttribute('data-reverse', 'false');
    expect(sections[1]).toHaveAttribute('data-reverse', 'true');
    expect(sections[2]).toHaveAttribute('data-reverse', 'false');
  });

  it('inverts the alternation start when startWithVisual is false', () => {
    const { container } = renderWithQuery(
      <FeatureBlockList items={items} startWithVisual={false} ariaLabel="Capabilities" />,
    );

    const sections = Array.from(container.querySelectorAll('section'));
    expect(sections[0]).toHaveAttribute('data-reverse', 'true');
    expect(sections[1]).toHaveAttribute('data-reverse', 'false');
    expect(sections[2]).toHaveAttribute('data-reverse', 'true');
  });

  it('renders one accessible heading per list item', () => {
    renderWithQuery(<FeatureBlockList items={items} ariaLabel="Capabilities" />);

    const region = screen.getByRole('region', { name: /capabilities/i });
    const headings = within(region).getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(items.length);
  });
});
