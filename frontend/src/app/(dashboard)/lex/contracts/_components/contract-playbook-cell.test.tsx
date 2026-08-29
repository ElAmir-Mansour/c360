import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { formatPercent } from '@/lib/lex/ksa';
import {
  ContractPlaybookCell,
  PlaybookThresholdChip,
  contractPlaybookCellLabels,
} from '@/app/(dashboard)/lex/contracts/_components/contract-playbook-cell';
import { PLAYBOOK_OK_THRESHOLD } from '@/app/(dashboard)/lex/contracts/_lib/use-playbook-scores';

describe('ContractPlaybookCell', () => {
  it('renders an ok-toned compliance chip for scores at or above 90', () => {
    const display = formatPercent(95, 'en', { fromPercent: true });
    renderWithQuery(<ContractPlaybookCell score={95} playbookName="Standard MSA" />);

    const value = screen.getByLabelText(contractPlaybookCellLabels.en.scoreLabel(display));
    expect(value).toHaveTextContent(display);
    const chip = value.closest('span[title]');
    expect(chip?.className).toContain('text-success-700');
    // Tooltip carries the matched playbook name.
    expect(chip?.getAttribute('title')).toContain(
      contractPlaybookCellLabels.en.playbookPrefix('Standard MSA'),
    );
  });

  it('renders warn and danger tones across the 70/90 thresholds', () => {
    const warnDisplay = formatPercent(75, 'en', { fromPercent: true });
    const dangerDisplay = formatPercent(40, 'en', { fromPercent: true });
    renderWithQuery(
      <>
        <ContractPlaybookCell score={75} />
        <ContractPlaybookCell score={40} />
      </>,
    );

    const warn = screen.getByLabelText(
      contractPlaybookCellLabels.en.scoreLabel(warnDisplay),
    );
    expect(warn.closest('span[title]')?.className).toContain('text-warning-700');

    const danger = screen.getByLabelText(
      contractPlaybookCellLabels.en.scoreLabel(dangerDisplay),
    );
    expect(danger.closest('span[title]')?.className).toContain('text-error-700');
  });

  it('degrades to the neutral off-playbook pill when there is no score', () => {
    renderWithQuery(<ContractPlaybookCell score={null} />);

    const pill = screen.getByText(contractPlaybookCellLabels.en.offPlaybook);
    expect(pill).toHaveAttribute('title', contractPlaybookCellLabels.en.offPlaybookHint);
    expect(pill.className).toContain('border-dashed');
  });

  it('renders the Arabic-Indic percent under the ar locale', () => {
    const display = formatPercent(82, 'ar', { fromPercent: true });
    renderWithQuery(<ContractPlaybookCell score={82} />, { locale: 'ar' });

    expect(
      screen.getByLabelText(contractPlaybookCellLabels.ar.scoreLabel(display)),
    ).toHaveTextContent(display);
  });
});

describe('PlaybookThresholdChip', () => {
  it('renders the bilingual quick-filter label and toggles on click', () => {
    const onToggle = vi.fn();
    const threshold = formatPercent(PLAYBOOK_OK_THRESHOLD, 'en', { fromPercent: true });
    renderWithQuery(
      <PlaybookThresholdChip active={false} onToggle={onToggle} count={3} />,
    );

    const chip = screen.getByRole('button', {
      name: new RegExp(
        contractPlaybookCellLabels.en
          .quickFilter(threshold)
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    });
    expect(chip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('marks the chip pressed while the narrowing is active', () => {
    renderWithQuery(<PlaybookThresholdChip active onToggle={vi.fn()} />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
