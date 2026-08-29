import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPdfjs } from './pdfjs';
import {
  buildPdfProcessingPayload,
  extractPdfTextFromBlob,
  isPdfDocument,
} from './pdf-text';

vi.mock('./pdfjs', () => ({
  loadPdfjs: vi.fn(),
}));

const loadPdfjsMock = vi.mocked(loadPdfjs);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PDF text-layer extraction', () => {
  it('extracts embedded page text and reports that OCR is not required', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    mockPdf([
      'Board policy text '.repeat(5),
      'Retention and legal-hold requirements '.repeat(3),
    ], destroy);

    const result = await extractPdfTextFromBlob(pdfBlob(), 'board-policy.pdf');

    expect(result.status).toBe('text_extracted');
    expect(result.pageCount).toBe(2);
    expect(result.pagesWithText).toBe(2);
    expect(result.pagesNeedingOcr).toBe(0);
    expect(result.text).toContain('Board policy text');
    expect(result.text).toContain('Retention and legal-hold requirements');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('keeps low-text/image-only pages explicitly pending for real OCR', async () => {
    mockPdf(['Searchable cover '.repeat(5), '']);

    const result = await extractPdfTextFromBlob(pdfBlob(), 'mixed-scan.pdf');

    expect(result.status).toBe('ocr_partial_pending');
    expect(result.pagesWithText).toBe(1);
    expect(result.pagesNeedingOcr).toBe(1);
    expect(buildPdfProcessingPayload(pdfFile(), result, result.text)).toEqual({
      text_status: 'partial',
      text_extraction_method: 'pdf_text_layer',
      ocr_status: 'partial_pending',
      page_count: 2,
      pages_with_text: 1,
      pages_needing_ocr: 1,
    });
  });

  it('marks a scanned PDF pending instead of calling text extraction OCR', async () => {
    mockPdf(['', '']);

    const result = await extractPdfTextFromBlob(pdfBlob(), 'scan.pdf');

    expect(result.status).toBe('ocr_pending');
    expect(result.text).toBe('');
    expect(buildPdfProcessingPayload(pdfFile(), result, '')).toMatchObject({
      text_status: 'ocr_pending',
      text_extraction_method: 'none',
      ocr_status: 'pending',
      pages_needing_ocr: 2,
    });
  });

  it('does not label user-replaced text as PDF text-layer extraction', () => {
    const extraction = {
      text: 'Original embedded text',
      pageCount: 1,
      pagesWithText: 1,
      pagesNeedingOcr: 0,
      status: 'text_extracted' as const,
    };

    expect(buildPdfProcessingPayload(pdfFile(), extraction, 'Corrected manual text')).toEqual({
      text_status: 'provided',
      text_extraction_method: 'manual',
      ocr_status: 'pending',
      page_count: 1,
      pages_with_text: 1,
      pages_needing_ocr: 0,
    });
  });

  it('recognizes PDFs by MIME type or extension', () => {
    expect(isPdfDocument('policy.bin', 'application/pdf')).toBe(true);
    expect(isPdfDocument('POLICY.PDF')).toBe(true);
    expect(isPdfDocument('policy.docx')).toBe(false);
  });
});

function mockPdf(pageTexts: string[], destroy = vi.fn().mockResolvedValue(undefined)) {
  const document = {
    numPages: pageTexts.length,
    getPage: vi.fn(async (pageNumber: number) => ({
      getTextContent: vi.fn(async () => ({
        items: pageTexts[pageNumber - 1]
          ? [{ str: pageTexts[pageNumber - 1], hasEOL: false }]
          : [],
      })),
    })),
    destroy,
  };
  const loadingTask = {
    promise: Promise.resolve(document),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  loadPdfjsMock.mockResolvedValue({
    getDocument: vi.fn(() => loadingTask),
  } as never);
}

function pdfBlob(): Blob {
  return new Blob(['%PDF-1.7'], { type: 'application/pdf' });
}

function pdfFile(): File {
  return new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' });
}
