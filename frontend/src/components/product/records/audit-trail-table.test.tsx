import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { AuditTrailTable } from './audit-trail-table';
import {
  sampleBrokenVerification,
  sampleIntactVerification,
  sampleLedgerEntries,
} from './records.gallery';
import type { DRAttestationLedgerEntry } from '@/types/clario-dr';

describe('AuditTrailTable', () => {
  it('renders one table row per hash-chained ledger entry', () => {
    renderWithQuery(
      <AuditTrailTable entries={sampleLedgerEntries} verification={sampleIntactVerification} />,
    );

    const table = screen.getByRole('table');
    // Header row + one row per entry.
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(sampleLedgerEntries.length + 1);

    // The chain spine is rendered: seq + entry type label are present.
    expect(within(table).getByText('Failover attestation')).toBeInTheDocument();
    expect(within(table).getByText('Recovery point validation')).toBeInTheDocument();
  });

  it('marks every row intact when the ledger verifies', () => {
    renderWithQuery(
      <AuditTrailTable entries={sampleLedgerEntries} verification={sampleIntactVerification} />,
    );

    const table = screen.getByRole('table');
    const intactChips = within(table).getAllByText('Intact');
    expect(intactChips).toHaveLength(sampleLedgerEntries.length);
    expect(within(table).queryByText('Chain broken')).not.toBeInTheDocument();
  });

  it('shows a broken-chain verdict from the first broken seq onward', () => {
    renderWithQuery(
      <AuditTrailTable entries={sampleLedgerEntries} verification={sampleBrokenVerification} />,
    );

    const table = screen.getByRole('table');
    // first_broken_seq is 3 → entries with seq 3 and 4 are broken (2 of 4).
    const brokenChips = within(table).getAllByText('Chain broken');
    expect(brokenChips).toHaveLength(2);

    // Entries before the break remain intact.
    const intactChips = within(table).getAllByText('Intact');
    expect(intactChips).toHaveLength(2);

    // The exact tampered row is flagged via the data-verdict attribute.
    const brokenRows = table.querySelectorAll('tr[data-verdict="broken"]');
    expect(brokenRows).toHaveLength(2);
  });

  it('marks rows unverified when no verification result is supplied', () => {
    renderWithQuery(<AuditTrailTable entries={sampleLedgerEntries} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Unverified')).toHaveLength(sampleLedgerEntries.length);
  });

  it('renders a stacked-card fallback list alongside the table (WCAG 1.4.10 reflow)', () => {
    renderWithQuery(
      <AuditTrailTable entries={sampleLedgerEntries} verification={sampleBrokenVerification} />,
    );

    // The reflow list is a labelled <ul> mirroring the table caption.
    const stacked = screen.getByRole('list', { name: 'Attestation trail' });
    expect(stacked).toBeInTheDocument();
    expect(stacked.tagName).toBe('UL');

    // It carries the responsive class that hides it at ≥640px.
    expect(stacked).toHaveClass('sm:hidden');

    // One stacked card per entry, with the same chain data fields.
    const cards = within(stacked).getAllByRole('listitem');
    expect(cards).toHaveLength(sampleLedgerEntries.length);
    // Field labels from the definition lists are present in the card layout.
    expect(within(stacked).getAllByText('Subject').length).toBe(sampleLedgerEntries.length);
  });

  it('falls back to a neutral chip for an unknown entry_type', () => {
    const exotic: DRAttestationLedgerEntry[] = [
      {
        ...sampleLedgerEntries[0],
        id: 'led-exotic',
        seq: 99,
        entry_type: 'future_unmapped_type',
      },
    ];
    renderWithQuery(<AuditTrailTable entries={exotic} verification={sampleIntactVerification} />);
    // Unknown type renders its raw name rather than crashing.
    expect(screen.getAllByText('future_unmapped_type').length).toBeGreaterThan(0);
  });

  it('renders an empty state when there are no entries', () => {
    renderWithQuery(<AuditTrailTable entries={[]} />);
    expect(screen.getByText('No attestation entries yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('resolves bilingual content from labels under the Arabic (RTL) locale', () => {
    renderWithQuery(
      <AuditTrailTable
        entries={sampleLedgerEntries}
        verification={sampleIntactVerification}
        labels={{ caption: 'سجل التصديق', verdictIntact: 'سليم' }}
      />,
      { locale: 'ar' },
    );
    expect(screen.getByRole('list', { name: 'سجل التصديق' })).toBeInTheDocument();
    // The verdict label renders in both the table and the stacked-card fallback
    // (both DOM trees are present; CSS — not removal — toggles them per viewport).
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('سليم').length).toBe(sampleLedgerEntries.length);
  });
});
