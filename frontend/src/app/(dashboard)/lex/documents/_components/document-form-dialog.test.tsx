import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { DocumentFormDialog } from './document-form-dialog';

const { createDocumentMock, extractPdfTextMock, uploadMock } = vi.hoisted(() => ({
  createDocumentMock: vi.fn(),
  extractPdfTextMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock('@/lib/enterprise', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/enterprise')>();
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      files: { ...actual.enterpriseApi.files, upload: uploadMock },
      lex: { ...actual.enterpriseApi.lex, createDocument: createDocumentMock },
    },
  };
});

vi.mock('@/lib/documents/pdf-text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/documents/pdf-text')>();
  return { ...actual, extractPdfTextFromBlob: extractPdfTextMock };
});

vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showApiError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  extractPdfTextMock.mockResolvedValue({
    text: 'Born-digital board policy text for repository search.',
    pageCount: 1,
    pagesWithText: 1,
    pagesNeedingOcr: 0,
    status: 'text_extracted',
  });
  uploadMock.mockResolvedValue({
    id: '10000000-0000-4000-8000-000000000001',
    original_name: 'board-policy.pdf',
    size_bytes: 1024,
    checksum_sha256: 'sha256:board-policy',
  });
  createDocumentMock.mockResolvedValue({
    id: '20000000-0000-4000-8000-000000000002',
    title: 'Board Policy',
  });
});

describe('DocumentFormDialog PDF text extraction', () => {
  it('persists born-digital PDF text and processing proof through document create', async () => {
    const user = userEvent.setup();
    const initialFile = new File(['%PDF-1.7'], 'board-policy.pdf', {
      type: 'application/pdf',
    });

    renderWithQuery(
      <DocumentFormDialog
        initialFile={initialFile}
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /Title/ }), 'Board Policy');
    await user.type(screen.getByRole('textbox', { name: /Description/ }), 'Corporate board policy.');

    expect(await screen.findByText('Embedded PDF text extracted')).toBeInTheDocument();
    expect(screen.getByLabelText('Extracted text')).toHaveValue(
      'Born-digital board policy text for repository search.',
    );

    await user.click(screen.getByRole('button', { name: 'Create document' }));

    await waitFor(() => expect(createDocumentMock).toHaveBeenCalledOnce());
    expect(createDocumentMock).toHaveBeenCalledWith(expect.objectContaining({
      document: expect.objectContaining({
        file_id: '10000000-0000-4000-8000-000000000001',
        extracted_text: 'Born-digital board policy text for repository search.',
      }),
      processing: {
        text_status: 'extracted',
        text_extraction_method: 'pdf_text_layer',
        ocr_status: 'not_required',
        page_count: 1,
        pages_with_text: 1,
        pages_needing_ocr: 0,
      },
    }));
  });
});
