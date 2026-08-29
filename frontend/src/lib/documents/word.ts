import type { Dispatch, SetStateAction } from 'react';
import {
  extractPdfTextFromBlob,
  isPdfFile,
  type PdfTextExtractionResult,
} from './pdf-text';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type MammothModule = typeof import('mammoth');

export interface UploadTextExtractionResult {
  text: string;
  source: 'pdf_text_layer' | 'docx' | 'plain_text' | 'none';
  pdf?: PdfTextExtractionResult;
}

function isDocxName(name?: string): boolean {
  return !!name && /\.docx$/i.test(name);
}

function isTextName(name?: string): boolean {
  return !!name && /\.txt$/i.test(name);
}

export function isDocxFile(file: File | Blob, fileName?: string): boolean {
  const type = 'type' in file ? file.type : '';
  return type === DOCX_MIME || isDocxName(fileName) || (typeof File !== 'undefined' && file instanceof File && isDocxName(file.name));
}

export function isDocxDocument(fileName?: string, mimeType?: string): boolean {
  return mimeType === DOCX_MIME || isDocxName(fileName);
}

export function isPlainTextFile(file: File): boolean {
  return file.type === 'text/plain' || isTextName(file.name);
}

export async function extractDocxTextFromBlob(blob: Blob, fileName?: string): Promise<string> {
  if (!isDocxFile(blob, fileName)) return '';
  const mammoth = (await import('mammoth')) as MammothModule;
  const result = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
  return normalizeExtractedText(result.value);
}

export async function extractTextFromUpload(file: File): Promise<string> {
  return (await analyzeTextFromUpload(file)).text;
}

/**
 * Inspects an uploaded document for text that is already embedded in the file.
 * PDF handling reads the text layer only; scanned/image-only pages are flagged
 * by the PDF result for a separate server-side OCR pass.
 */
export async function analyzeTextFromUpload(file: File): Promise<UploadTextExtractionResult> {
  if (isPdfFile(file)) {
    const pdf = await extractPdfTextFromBlob(file, file.name);
    return { text: pdf.text, source: 'pdf_text_layer', pdf };
  }
  if (isDocxFile(file)) {
    return { text: await extractDocxTextFromBlob(file, file.name), source: 'docx' };
  }
  if (isPlainTextFile(file)) {
    return {
      text: normalizeExtractedText(await readPlainTextFile(file)),
      source: 'plain_text',
    };
  }
  return { text: '', source: 'none' };
}

export async function resolveUploadExtractedText(
  file: File,
  currentText: string,
  analysis?: UploadTextExtractionResult | null,
): Promise<string> {
  const trimmed = currentText.trim();
  if (trimmed) return trimmed;
  return (analysis ?? await analyzeTextFromUpload(file)).text;
}

export async function prefillExtractedTextFromFile(
  file: File | null,
  setText: Dispatch<SetStateAction<string>>,
): Promise<UploadTextExtractionResult | null> {
  if (!file) return null;
  const result = await analyzeTextFromUpload(file);
  if (result.text) {
    setText((current) => (current.trim() ? current : result.text));
  }
  return result;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readPlainTextFile(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  if (typeof file.arrayBuffer === 'function') {
    return new TextDecoder().decode(await file.arrayBuffer());
  }
  return '';
}
