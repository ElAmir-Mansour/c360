import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { LexDocumentPreviewSheet } from './document-preview-sheet';
import type { LexDocument } from '@/types/suites';

const {
  downloadMock,
  getPresignedDownloadMock,
  listDocumentVersionsMock,
} = vi.hoisted(() => ({
  downloadMock: vi.fn(),
  getPresignedDownloadMock: vi.fn(),
  listDocumentVersionsMock: vi.fn(),
}));

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: {
    files: {
      download: downloadMock,
      getPresignedDownload: getPresignedDownloadMock,
    },
    lex: {
      listDocumentVersions: listDocumentVersionsMock,
    },
  },
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showApiError: vi.fn(),
}));

const docxDocument = {
  id: 'doc-1',
  tenant_id: 'tenant-1',
  title: 'Vendor Services Agreement',
  type: 'template',
  description: 'Editable services agreement.',
  file_id: 'file-docx-1',
  file_name: 'vendor-services-agreement.docx',
  file_size_bytes: 2048,
  extracted_text: 'Definitions\n\nProcessor must maintain audit trails for regulated data.',
  category: 'Contracts',
  confidentiality: 'confidential',
  current_version: 3,
  status: 'active',
  tags: ['vendor'],
  metadata: {
    content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content_hash: 'sha256:docx-current',
  },
  created_by: 'u-1',
  created_at: '2026-06-25T09:00:00Z',
  updated_at: '2026-06-26T09:00:00Z',
} satisfies LexDocument;

beforeEach(() => {
  vi.clearAllMocks();
  getPresignedDownloadMock.mockResolvedValue({
    url: 'https://files.example.test/vendor-services-agreement.docx',
  });
  listDocumentVersionsMock.mockResolvedValue([]);
});

describe('LexDocumentPreviewSheet Word fallback', () => {
  it('renders stored DOCX extracted text instead of downloading for client-side extraction', async () => {
    renderWithQuery(
      <LexDocumentPreviewSheet
        document={docxDocument}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Vendor Services Agreement · v3' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Processor must maintain audit trails/)).toBeInTheDocument();
    expect(screen.getByLabelText('Find in document text')).toBeInTheDocument();

    await waitFor(() => {
      expect(getPresignedDownloadMock).toHaveBeenCalledWith('file-docx-1');
    });
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('keeps find-in-document available for the DOCX fallback text layer', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <LexDocumentPreviewSheet
        document={docxDocument}
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText('Find in document text'), 'processor');

    expect(screen.getByText('1 of 1')).toBeInTheDocument();
  });
});

describe('LexDocumentPreviewSheet PDF processing proof', () => {
  it('labels embedded PDF text as text-layer extraction, not OCR', async () => {
    const pdfDocument: LexDocument = {
      ...docxDocument,
      id: 'pdf-1',
      title: 'Board Policy',
      file_id: 'file-pdf-1',
      file_name: 'board-policy.pdf',
      extracted_text: 'Searchable born-digital policy text.',
      metadata: {
        content_type: 'application/pdf',
        text_extraction: {
          status: 'extracted',
          method: 'pdf_text_layer',
          page_count: 2,
          pages_with_text: 2,
          pages_needing_ocr: 0,
        },
        ocr: { status: 'not_required', text_available: true },
      },
    };

    renderWithQuery(
      <LexDocumentPreviewSheet document={pdfDocument} open onOpenChange={vi.fn()} />,
    );

    expect(await screen.findByText('Embedded PDF text extracted')).toBeInTheDocument();
    expect(screen.getByText(/Text-layer extraction is not OCR/)).toBeInTheDocument();
    expect(screen.queryByText(/OCR needed for scanned PDF/)).not.toBeInTheDocument();
  });

  it('does not label legacy provided PDF text as proven embedded extraction', async () => {
    const legacyPdf: LexDocument = {
      ...docxDocument,
      id: 'pdf-legacy-1',
      title: 'Legacy Scan',
      file_id: 'file-pdf-legacy-1',
      file_name: 'legacy-scan.pdf',
      extracted_text: 'Text supplied during migration.',
      metadata: { content_type: 'application/pdf' },
    };

    renderWithQuery(
      <LexDocumentPreviewSheet document={legacyPdf} open onOpenChange={vi.fn()} />,
    );

    expect(await screen.findByText('Searchable text available · OCR state unverified')).toBeInTheDocument();
    expect(screen.queryByText('Embedded PDF text extracted')).not.toBeInTheDocument();
  });

  it('makes scanned-PDF OCR work visibly pending', async () => {
    const scannedDocument: LexDocument = {
      ...docxDocument,
      id: 'pdf-scan-1',
      title: 'Scanned Minutes',
      file_id: 'file-pdf-scan-1',
      file_name: 'scanned-minutes.pdf',
      extracted_text: null,
      metadata: {
        content_type: 'application/pdf',
        text_extraction: {
          status: 'ocr_pending',
          method: 'none',
          page_count: 4,
          pages_with_text: 0,
          pages_needing_ocr: 4,
        },
        ocr: { status: 'pending', text_available: false },
      },
    };

    renderWithQuery(
      <LexDocumentPreviewSheet document={scannedDocument} open onOpenChange={vi.fn()} />,
    );

    expect(await screen.findByText('OCR needed for scanned PDF · pending')).toBeInTheDocument();
    expect(screen.getByText(/real OCR must run on the server/i)).toBeInTheDocument();
  });

  it('never substitutes current-version text when previewing a scanned historical PDF', async () => {
    const user = userEvent.setup();
    const currentPdf: LexDocument = {
      ...docxDocument,
      id: 'pdf-history-1',
      title: 'Historical Board Pack',
      file_id: 'file-pdf-current',
      file_name: 'board-pack-current.pdf',
      current_version: 2,
      extracted_text: 'CURRENT REVISION ONLY: approved board resolutions.',
      metadata: {
        content_type: 'application/pdf',
        text_extraction: {
          status: 'extracted',
          method: 'pdf_text_layer',
          page_count: 3,
          pages_with_text: 3,
          pages_needing_ocr: 0,
        },
        ocr: { status: 'not_required', text_available: true },
      },
    };
    listDocumentVersionsMock.mockResolvedValue([
      {
        id: 'version-history-1',
        tenant_id: 'tenant-1',
        document_id: currentPdf.id,
        version: 1,
        file_id: 'file-pdf-scanned-v1',
        file_name: 'board-pack-scanned-v1.pdf',
        file_size_bytes: 1024,
        content_hash: 'sha256:scanned-v1',
        extracted_text: null,
        change_summary: 'Original scanned board pack.',
        uploaded_by: 'Records team',
        uploaded_at: '2026-06-20T09:00:00Z',
      },
    ]);

    renderWithQuery(
      <LexDocumentPreviewSheet document={currentPdf} open onOpenChange={vi.fn()} />,
    );

    expect(await screen.findByText(/CURRENT REVISION ONLY/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Preview version 1' }));

    expect(
      await screen.findByRole('heading', { name: 'Historical Board Pack · v1' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('OCR needed for scanned PDF · pending')).toBeInTheDocument();
    expect(screen.queryByText(/CURRENT REVISION ONLY/)).not.toBeInTheDocument();
    expect(screen.queryByText('Embedded PDF text extracted')).not.toBeInTheDocument();
  });
});
