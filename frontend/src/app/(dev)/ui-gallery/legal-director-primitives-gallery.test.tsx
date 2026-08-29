import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LegalDirectorPrimitivesGallery } from './legal-director-primitives-gallery';

const PRIMITIVES = [
  'KPI card',
  'Progress bar',
  'Status chip',
  'Panel shell',
  'Domain tile',
] as const;

describe('LegalDirectorPrimitivesGallery', () => {
  it('shows the approved four-state story matrix for every primitive', () => {
    render(<LegalDirectorPrimitivesGallery />);

    for (const name of PRIMITIVES) {
      const heading = screen.getByRole('heading', { name });
      const section = heading.closest('section');

      expect(section).not.toBeNull();
      expect(within(section!).getByText('Loading')).toBeInTheDocument();
      expect(within(section!).getByText('Empty')).toBeInTheDocument();
      expect(within(section!).getByText('Error with retry')).toBeInTheDocument();
      expect(within(section!).getByText('Zero')).toBeInTheDocument();
      expect(within(section!).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    }
  });

  it('keeps every PanelShell state inside panel chrome', () => {
    render(<LegalDirectorPrimitivesGallery />);
    const section = screen
      .getByRole('heading', { name: 'Panel shell' })
      .closest('section');

    expect(within(section!).getAllByRole('heading', { name: 'Escalations' })).toHaveLength(4);
  });

  it('gives retry specimens a working interaction', async () => {
    const user = userEvent.setup();
    render(<LegalDirectorPrimitivesGallery />);

    expect(screen.getByText('Retry interactions: 0')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(screen.getByText('Retry interactions: 1')).toBeInTheDocument();
  });

  it('is mounted on the internal UI gallery page', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(dev)/ui-gallery/page.tsx'),
      'utf8',
    );

    expect(page).toContain('<LegalDirectorPrimitivesGallery />');
  });
});
