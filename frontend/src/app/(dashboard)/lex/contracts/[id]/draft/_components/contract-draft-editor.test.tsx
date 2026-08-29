import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContractDraftEditor } from './contract-draft-editor';

vi.mock('@/lib/toast', () => ({
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
}));

describe('ContractDraftEditor', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the English Figma composition and filters the clause library', () => {
    render(
      <ContractDraftEditor contractId="CON-2024-089" locale="en" direction="ltr" />,
    );

    expect(
      screen.getByRole('heading', { name: 'Mutual IT Services Agreement', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Document Outline')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('bg-warning-100', 'text-warning-800');
    expect(screen.getByRole('button', { name: 'Save Draft' })).toHaveClass(
      'bg-success-700',
      'text-neutral-0',
    );
    expect(screen.getByRole('button', { name: 'Send for Review' })).toHaveClass(
      'text-success-700',
    );

    fireEvent.change(screen.getByPlaceholderText('Search standard templates...'), {
      target: { value: 'privacy' },
    });
    expect(screen.getByText('NDA / Strict Privacy Clause')).toBeInTheDocument();
    expect(screen.queryByText('Dispute Resolution & Jurisdiction')).not.toBeInTheDocument();
  });

  it('inserts a library clause into the editable document', () => {
    render(
      <ContractDraftEditor contractId="CON-2024-090" locale="en" direction="ltr" />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Insert' })[0]);

    expect(screen.getAllByText('NDA / Strict Privacy Clause')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Inserted' })).toHaveClass(
      'disabled:bg-neutral-200',
      'disabled:text-neutral-800',
    );
  });

  it('renders the compact RTL composition without the English-only outline', () => {
    render(
      <ContractDraftEditor contractId="CON-2024-089" locale="ar" direction="rtl" />,
    );

    expect(
      screen.getByRole('heading', {
        name: 'اتفاقية تقديم خدمات تقنية معلومات متبادلة',
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('contract-draft-editor')).toHaveAttribute('dir', 'rtl');
    expect(screen.queryByText('Document Outline')).not.toBeInTheDocument();
    expect(screen.getByText('مكتبة البنود السريعة')).toBeInTheDocument();
  });

  it('projects live contract identity and document content into the Figma editor', async () => {
    render(
      <ContractDraftEditor
        contractId="contract-uuid-42"
        locale="en"
        direction="ltr"
        identity={{
          title: 'Live Infrastructure Services Agreement',
          contractNumber: 'LEX-2026-042',
          status: 'legal_review',
          partyAName: 'Clario Arabia',
          partyBName: 'Northstar Holdings',
          draftDocumentText: 'Live contract draft text supplied by the contract API.',
        }}
      />,
    );

    expect(
      screen.getByRole('heading', {
        name: 'Live Infrastructure Services Agreement',
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'LIVE INFRASTRUCTURE SERVICES AGREEMENT',
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('LEX-2026-042')).toHaveLength(1);
    expect(screen.getByText('Reference Number: LEX-2026-042')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Legal Review');
    expect(screen.getByText('Between Clario Arabia and Northstar Holdings')).toHaveClass('sr-only');
    expect(
      await screen.findByText('Live contract draft text supplied by the contract API.'),
    ).toBeInTheDocument();
  });
});
