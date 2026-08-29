import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShieldCheck, Timer, Repeat, FileCheck2 } from 'lucide-react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { BenefitStrip, type BenefitItem } from './benefit-strip';

const benefits: BenefitItem[] = [
  { icon: Timer, label: 'Lower RTO', description: 'Recover services within target windows' },
  { icon: ShieldCheck, label: 'Sovereign by design', description: 'Data never leaves your region' },
  { icon: Repeat, label: 'Repeatable rehearsals', description: 'Test recovery on a schedule' },
  { icon: FileCheck2, label: 'Audit-ready evidence', description: 'Tamper-evident recovery proof' },
];

describe('BenefitStrip', () => {
  it('renders all benefit items in an accessible list (4-across set)', () => {
    renderWithQuery(<BenefitStrip items={benefits} ariaLabel="Key benefits" />);

    const list = screen.getByRole('list', { name: /key benefits/i });
    const listItems = within(list).getAllByRole('listitem');
    expect(listItems).toHaveLength(4);
  });

  it('renders each label and optional description', () => {
    renderWithQuery(<BenefitStrip items={benefits} ariaLabel="Key benefits" />);

    expect(screen.getByText('Lower RTO')).toBeInTheDocument();
    expect(screen.getByText('Recover services within target windows')).toBeInTheDocument();
    expect(screen.getByText('Audit-ready evidence')).toBeInTheDocument();
  });

  it('renders without descriptions when omitted', () => {
    const minimal: BenefitItem[] = benefits.map(({ icon, label }) => ({ icon, label }));
    renderWithQuery(<BenefitStrip items={minimal} ariaLabel="Key benefits" />);

    const list = screen.getByRole('list', { name: /key benefits/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByText('Recover services within target windows')).not.toBeInTheDocument();
  });
});
