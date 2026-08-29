import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { CtaBand } from './cta-band';

describe('CtaBand', () => {
  it('renders the primary background variant with a labelled landmark', () => {
    renderWithQuery(
      <CtaBand
        background="primary"
        headline="Rehearse recovery"
        primaryAction={{ label: 'Book a walkthrough', href: '#book' }}
      />,
    );

    const region = screen.getByRole('region', { name: 'Rehearse recovery' });
    expect(region.className).toContain('bg-brand-primary-700');
  });

  it('renders the surface background variant', () => {
    renderWithQuery(
      <CtaBand
        background="surface"
        headline="Keep your sovereignty"
        primaryAction={{ label: 'Start a trial', href: '#trial' }}
      />,
    );

    const region = screen.getByRole('region', { name: 'Keep your sovereignty' });
    expect(region.className).toContain('bg-surface-card');
  });

  it('renders the primary CTA as a real anchor with its href', () => {
    renderWithQuery(
      <CtaBand
        headline="Prove your RTO"
        primaryAction={{ label: 'Book a walkthrough', href: '/book' }}
      />,
    );

    const link = screen.getByRole('link', { name: /Book a walkthrough/i });
    expect(link).toHaveAttribute('href', '/book');
  });

  it('renders an optional secondary action', () => {
    renderWithQuery(
      <CtaBand
        headline="Prove your RTO"
        primaryAction={{ label: 'Primary', href: '#p' }}
        secondaryAction={{ label: 'Secondary', href: '#s' }}
      />,
    );

    expect(screen.getByRole('link', { name: /Primary/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Secondary/i })).toBeInTheDocument();
  });

  it('invokes onClick when a CTA has no href and is activated by keyboard', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithQuery(
      <CtaBand
        headline="Prove your RTO"
        primaryAction={{ label: 'Run drill', onClick }}
      />,
    );

    const button = screen.getByRole('button', { name: /Run drill/i });
    button.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('adds rel=noopener for external links', () => {
    renderWithQuery(
      <CtaBand
        headline="External"
        primaryAction={{ label: 'Docs', href: 'https://example.com', external: true }}
      />,
    );
    const link = screen.getByRole('link', { name: /Docs/i });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
