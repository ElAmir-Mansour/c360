import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { BulkAiActionsDialog } from '@/app/(dashboard)/lex/contracts/_components/bulk-ai-actions';
import {
  type BulkAiSummary,
  bulkAiLabels,
} from '@/app/(dashboard)/lex/contracts/_lib/use-bulk-ai';

const summaryFixture: BulkAiSummary = {
  kind: 'analyze',
  total: 3,
  succeeded: 1,
  failures: [
    {
      id: '11111111-0000-4000-8000-000000000001',
      title: 'Master Services Agreement',
      reason: 'Analysis engine timed out.',
    },
    {
      id: '22222222-0000-4000-8000-000000000002',
      title: 'Vendor NDA',
      reason: 'Contract has no document text.',
    },
  ],
};

describe('BulkAiActionsDialog', () => {
  it('lists the failed contracts with their reasons in English', async () => {
    renderWithQuery(
      <BulkAiActionsDialog summary={summaryFixture} open onOpenChange={vi.fn()} />,
    );

    const en = bulkAiLabels.en;
    expect(
      await screen.findByText(en.dialog.title(en.actions.analyze)),
    ).toBeInTheDocument();
    expect(screen.getByText(en.dialog.description('1', '2'))).toBeInTheDocument();
    expect(screen.getByText(en.dialog.failedListLabel)).toBeInTheDocument();

    // Failed ids (shortened) + titles + reasons are all surfaced.
    expect(screen.getByText('Master Services Agreement')).toBeInTheDocument();
    expect(screen.getByText('Vendor NDA')).toBeInTheDocument();
    expect(screen.getByText(/Analysis engine timed out\./)).toBeInTheDocument();
    expect(screen.getByText(/Contract has no document text\./)).toBeInTheDocument();
    // Shortened ids (first 8 chars) render for operator lookup.
    expect(screen.getByText('11111111')).toBeInTheDocument();
    expect(screen.getByText('22222222')).toBeInTheDocument();
    // Both the footer close button and the built-in shadcn X carry the
    // accessible name "Close" in English, so assert on the collection.
    expect(
      screen.getAllByRole('button', { name: en.dialog.close }).length,
    ).toBeGreaterThan(0);
  });

  it('renders the Arabic surface under the ar locale', async () => {
    renderWithQuery(
      <BulkAiActionsDialog summary={summaryFixture} open onOpenChange={vi.fn()} />,
      { locale: 'ar' },
    );

    const ar = bulkAiLabels.ar;
    expect(
      await screen.findByText(ar.dialog.title(ar.actions.analyze)),
    ).toBeInTheDocument();
    expect(screen.getByText(ar.dialog.failedListLabel)).toBeInTheDocument();
  });

  it('renders nothing until a run has produced a summary', () => {
    renderWithQuery(<BulkAiActionsDialog summary={null} open onOpenChange={vi.fn()} />);

    expect(
      screen.queryByText(bulkAiLabels.en.dialog.failedListLabel),
    ).not.toBeInTheDocument();
  });
});
