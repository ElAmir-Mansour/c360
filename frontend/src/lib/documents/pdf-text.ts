'use client';

import { loadPdfjs } from './pdfjs';

const PDF_MIME = 'application/pdf';

/** Mirrors the server OCR sidecar's default low-text threshold. */
export const PDF_OCR_MIN_CHARS_PER_PAGE = 60;

export type PdfTextLayerStatus =
  | 'text_extracted'
  | 'ocr_partial_pending'
  | 'ocr_pending';

export interface PdfTextExtractionResult {
  text: string;
  pageCount: number;
  pagesWithText: number;
  pagesNeedingOcr: number;
  status: PdfTextLayerStatus;
}

export interface DocumentTextProcessingPayload {
  text_status: 'extracted' | 'partial' | 'provided' | 'ocr_pending';
  text_extraction_method: 'pdf_text_layer' | 'manual' | 'none';
  ocr_status: 'not_required' | 'pending' | 'partial_pending';
  page_count?: number;
  pages_with_text?: number;
  pages_needing_ocr?: number;
}

export function isPdfDocument(fileName?: string, mimeType?: string): boolean {
  return mimeType?.toLowerCase() === PDF_MIME || !!fileName && /\.pdf$/i.test(fileName);
}

export function isPdfFile(file: File | Blob, fileName?: string): boolean {
  const type = 'type' in file ? file.type : '';
  const resolvedName =
    fileName ?? (typeof File !== 'undefined' && file instanceof File ? file.name : undefined);
  return isPdfDocument(resolvedName, type);
}

/**
 * Extracts a born-digital PDF's embedded text layer. This is deliberately not
 * called OCR: image-only/low-text pages are reported as needing the server OCR
 * sidecar instead of pretending that client extraction succeeded.
 */
export async function extractPdfTextFromBlob(
  blob: Blob,
  fileName?: string,
): Promise<PdfTextExtractionResult> {
  if (!isPdfFile(blob, fileName)) {
    return emptyResult();
  }

  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await readBlobArrayBuffer(blob)) });
  let pdf: Awaited<typeof loadingTask.promise> | null = null;

  try {
    pdf = await loadingTask.promise;
    const pageTexts: string[] = [];
    let pagesWithText = 0;
    let pagesNeedingOcr = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizePdfPageText(
        content.items
          .map((item) => {
            if (!('str' in item)) return '';
            return `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`;
          })
          .join(''),
      );
      pageTexts.push(text);
      if (text.length > 0) pagesWithText += 1;
      if (text.length < PDF_OCR_MIN_CHARS_PER_PAGE) pagesNeedingOcr += 1;
    }

    const text = normalizePdfDocumentText(pageTexts);
    const status: PdfTextLayerStatus =
      text.length === 0
        ? 'ocr_pending'
        : pagesNeedingOcr > 0
          ? 'ocr_partial_pending'
          : 'text_extracted';

    return {
      text,
      pageCount: pdf.numPages,
      pagesWithText,
      pagesNeedingOcr,
      status,
    };
  } finally {
    if (pdf) {
      await pdf.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

/** Builds the small processing proof persisted with a legal-document version. */
export function buildPdfProcessingPayload(
  file: File | null,
  extraction: PdfTextExtractionResult | null,
  resolvedText: string,
): DocumentTextProcessingPayload | undefined {
  if (!file || !isPdfFile(file)) return undefined;

  const hasText = resolvedText.trim().length > 0;
  const extractedFromLayer = !!extraction?.text.trim();
  const base = extraction
    ? {
        page_count: extraction.pageCount,
        pages_with_text: extraction.pagesWithText,
        pages_needing_ocr: extraction.pagesNeedingOcr,
      }
    : {};

  if (!hasText) {
    return {
      text_status: 'ocr_pending',
      text_extraction_method: 'none',
      ocr_status: 'pending',
      ...base,
    };
  }

  // If the user replaced the extracted layer with pasted/edited text, retain
  // searchability but do not mislabel that content as PDF-layer proof.
  const matchesExtractedLayer = extractedFromLayer && resolvedText.trim() === extraction?.text.trim();
  if (!matchesExtractedLayer) {
    return {
      text_status: 'provided',
      text_extraction_method: 'manual',
      // Pasted text makes search available, but is not proof that every scanned
      // page was processed. Keep OCR pending for the authoritative sidecar.
      ocr_status: 'pending',
      ...base,
    };
  }

  const partial = (extraction?.pagesNeedingOcr ?? 0) > 0;
  return {
    text_status: partial ? 'partial' : 'extracted',
    text_extraction_method: 'pdf_text_layer',
    ocr_status: partial ? 'partial_pending' : 'not_required',
    ...base,
  };
}

function emptyResult(): PdfTextExtractionResult {
  return {
    text: '',
    pageCount: 0,
    pagesWithText: 0,
    pagesNeedingOcr: 0,
    status: 'ocr_pending',
  };
}

function normalizePdfPageText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizePdfDocumentText(pages: string[]): string {
  return pages.filter(Boolean).join('\n\n').trim();
}

async function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read PDF'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Unable to read PDF as binary data'));
      }
    };
    reader.readAsArrayBuffer(blob);
  });
}
