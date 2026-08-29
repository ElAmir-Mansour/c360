import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ServerCog, Network, GaugeCircle } from 'lucide-react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { CardGridFeatureRow, type FeatureCard } from './card-grid-feature-row';

const cards: FeatureCard[] = [
  {
    id: 'recovery-assets',
    icon: ServerCog,
    title: 'Recovery Asset Registry',
    description: 'Catalogue applications, dependencies, and recovery tiers in one metastore.',
    href: '/recovery-assets',
    linkLabel: 'Explore the registry',
  },
  {
    id: 'data-mover',
    icon: Network,
    title: 'Data Mover',
    description: 'Move and verify recovery copies across sites with integrity checks.',
    href: '/data-mover',
    linkLabel: 'See the data mover',
  },
  {
    id: 'rto-tracking',
    icon: GaugeCircle,
    title: 'RTO Tracking',
    description: 'Measure achieved recovery time against targets on every rehearsal.',
    href: '/rto-tracking',
    linkLabel: 'View RTO tracking',
  },
];

describe('CardGridFeatureRow', () => {
  it('renders the section heading', () => {
    renderWithQuery(
      <CardGridFeatureRow
        eyebrow="Platform"
        heading="Everything you need to recover with confidence"
        description="Composable building blocks for sovereign disaster recovery."
        cards={cards}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: /everything you need to recover/i }),
    ).toBeInTheDocument();
  });

  it('renders one accessible link per card', () => {
    renderWithQuery(<CardGridFeatureRow ariaLabel="Capabilities" cards={cards} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(cards.length);

    // Each card link is reachable by its visible link label as accessible name.
    expect(screen.getByRole('link', { name: /explore the registry/i })).toHaveAttribute(
      'href',
      '/recovery-assets',
    );
    expect(screen.getByRole('link', { name: /see the data mover/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view rto tracking/i })).toBeInTheDocument();
  });

  it('exposes card titles as headings', () => {
    renderWithQuery(<CardGridFeatureRow ariaLabel="Capabilities" cards={cards} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Recovery Asset Registry' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Data Mover' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'RTO Tracking' })).toBeInTheDocument();
  });

  it('fires onClick when a card link is activated', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithQuery(
      <CardGridFeatureRow
        ariaLabel="Capabilities"
        cards={[{ ...cards[0], href: '#registry', onClick }]}
      />,
    );

    await user.click(screen.getByRole('link', { name: /explore the registry/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
