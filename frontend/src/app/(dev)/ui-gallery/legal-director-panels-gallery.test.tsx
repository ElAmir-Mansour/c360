import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LegalDirectorPanelsGallery } from './legal-director-panels-gallery';

// Team Workload is no longer a Legal Director panel specimen: the composition
// consumes the real workforce contract, whose own gallery is
// `workforce-team-gallery.tsx` (LEX-LD-GAP-DESIGN G2).
const PANELS = [
  'Escalation panel',
  'Service Request Donut',
  'Resolution Rate panel',
  'Legal Domains Grid',
] as const;

const STATES = [
  'Populated',
  'Loading',
  'Empty',
  'Error with retry',
  'Zero',
  'Partial and overflow',
] as const;

describe('LegalDirectorPanelsGallery', () => {
  it('shows every Step 4 panel state in both English/LTR and Arabic/RTL', () => {
    render(<LegalDirectorPanelsGallery />);

    for (const localeName of ['English · LTR', 'العربية · من اليمين إلى اليسار']) {
      const localeSection = screen.getByRole('heading', { name: localeName }).closest('section');
      expect(localeSection).not.toBeNull();

      for (const panel of PANELS) {
        const panelSection = within(localeSection!).getByRole('heading', { name: panel }).closest('section');
        expect(panelSection).not.toBeNull();
        for (const state of STATES) {
          expect(within(panelSection!).getByText(state)).toBeInTheDocument();
        }
      }
    }
  });

  it('exposes stable gallery references and working retry interactions', () => {
    const { container } = render(<LegalDirectorPanelsGallery />);

    expect(
      container.querySelector('#legal-director-panels-en-escalation-panel-populated'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('#legal-director-panels-ar-legal-domains-grid-zero'),
    ).toBeInTheDocument();
    expect(screen.getByText('Step 4 retry interactions: 0')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(screen.getByText('Step 4 retry interactions: 1')).toBeInTheDocument();
  });

  it('renders Arabic numerals, RTL direction, chart tables, and complete domain grids', () => {
    const { container } = render(<LegalDirectorPanelsGallery />);
    const arabic = screen
      .getByRole('heading', { name: 'العربية · من اليمين إلى اليسار' })
      .closest('section');

    expect(within(arabic!).getAllByText('٧').length).toBeGreaterThan(0);
    expect(arabic!.querySelector('[dir="rtl"][lang="ar"]')).toBeInTheDocument();
    expect(within(arabic!).getAllByRole('table').length).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('#legal-director-panels-en-legal-domains-grid-populated a'),
    ).toHaveLength(18);
  });

  it('is mounted on the internal UI gallery page', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(dev)/ui-gallery/page.tsx'),
      'utf8',
    );

    expect(page).toContain('<LegalDirectorPanelsGallery />');
  });
});
