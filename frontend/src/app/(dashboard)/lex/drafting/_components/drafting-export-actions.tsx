'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  GitCompareArrows,
  Highlighter,
  MessageSquarePlus,
  PenLine,
  Printer,
  RotateCcw,
  Save,
  Send,
  UserPlus,
  X,
} from 'lucide-react';
import { RedlineView } from '@/components/shared/redline-view';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { showError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useDraftingLabels } from './drafting-shared';
import {
  type DraftingExportFormat,
  type DraftingStorageScope,
  draftingValueToPlainText,
  readStorageJson,
  removeStorageValue,
  writeStorageJson,
} from './drafting-workspace-utils';

export type DraftingActionExportFormat = DraftingExportFormat | 'csv';

export interface DraftingPublishTarget {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  icon?: ReactNode;
  onPublish: () => void | Promise<void>;
}

export interface DraftingExportActionsProps {
  title?: string;
  filenameBase?: string;
  primaryText?: string;
  result?: unknown;
  metadata?: Record<string, unknown>;
  disabled?: boolean;
  formats?: DraftingActionExportFormat[];
  className?: string;
  onExported?: (format: DraftingActionExportFormat, filename: string) => void;
  onExportDocx?: () => void | Promise<void>;
  onExportPdf?: () => void | Promise<void>;
  publishTargets?: DraftingPublishTarget[];
  onPublished?: (targetId: string) => void;
}

interface ExportButtonConfig {
  format: DraftingActionExportFormat;
  label: string;
  disabledReason?: string;
  icon: ReactNode;
}

interface DraftingBrowserExportFile {
  content: string | Blob;
  filename: string;
  mimeType: string;
}

interface DraftingExportSection {
  heading: string;
  content: string;
}

interface PreparedDraftingExport {
  title: string;
  filenameBase: string;
  dateStamp: string;
  exportedAt: string;
  primaryText: string;
  result?: unknown;
  metadata: Record<string, unknown>;
  sections: DraftingExportSection[];
}

const DEFAULT_FORMATS: DraftingActionExportFormat[] = ['docx', 'pdf', 'markdown', 'txt', 'json', 'csv'];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function exportButtonLabel(format: DraftingActionExportFormat): string {
  if (format === 'txt') {
    return 'TXT';
  }
  if (format === 'json') {
    return 'JSON';
  }
  if (format === 'csv') {
    return 'CSV';
  }
  if (format === 'markdown') {
    return 'Markdown';
  }
  return format.toUpperCase();
}

function iconForFormat(format: DraftingActionExportFormat): ReactNode {
  if (format === 'json') {
    return <FileJson className="me-1.5 h-4 w-4" aria-hidden="true" />;
  }
  if (format === 'csv') {
    return <FileSpreadsheet className="me-1.5 h-4 w-4" aria-hidden="true" />;
  }
  if (format === 'pdf') {
    return <Printer className="me-1.5 h-4 w-4" aria-hidden="true" />;
  }
  return <FileText className="me-1.5 h-4 w-4" aria-hidden="true" />;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeFilenameBase(value: string | undefined): string {
  const cleaned = (value ?? 'drafting-result')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || 'drafting-result';
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function humanizeKey(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function exportValueToString(value: unknown): string {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function metadataRows(metadata: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(metadata)
    .filter(([, value]) => typeof value !== 'undefined' && value !== null && exportValueToString(value).trim())
    .map(([key, value]) => [humanizeKey(key), exportValueToString(value)]);
}

function collectBilingualSections(result: unknown): DraftingExportSection[] {
  if (!isRecord(result)) {
    return [];
  }

  const directKeys: Array<[string, string]> = [
    ['English title', 'title_en'],
    ['Arabic title', 'title_ar'],
    ['English text', 'text_en'],
    ['Arabic text', 'text_ar'],
    ['English summary', 'summary_en'],
    ['Arabic summary', 'summary_ar'],
    ['English rationale', 'rationale_en'],
    ['Arabic rationale', 'rationale_ar'],
  ];

  const sections = directKeys
    .map(([heading, key]) => {
      const content = stringValue(result[key]);
      return content ? { heading, content } : null;
    })
    .filter((section): section is DraftingExportSection => Boolean(section));

  if (Array.isArray(result.sections)) {
    result.sections.forEach((section, index) => {
      if (!isRecord(section)) {
        return;
      }
      const heading =
        stringValue(section.heading_en) ??
        stringValue(section.heading) ??
        stringValue(section.title_en) ??
        `Section ${index + 1}`;
      const body = stringValue(section.body_en) ?? stringValue(section.text_en) ?? stringValue(section.body);
      const headingAr = stringValue(section.heading_ar) ?? stringValue(section.title_ar);
      const bodyAr = stringValue(section.body_ar) ?? stringValue(section.text_ar);
      if (body) {
        sections.push({ heading: `${heading} - English`, content: body });
      }
      if (bodyAr) {
        sections.push({ heading: `${headingAr ?? heading} - Arabic`, content: bodyAr });
      }
    });
  }

  return sections;
}

function prepareDraftingExport({
  title,
  filenameBase,
  primaryText,
  result,
  metadata,
}: Pick<DraftingExportActionsProps, 'title' | 'filenameBase' | 'primaryText' | 'result' | 'metadata'>): PreparedDraftingExport {
  const resolvedTitle = title?.trim() || 'Drafting result';
  const exportedAt = nowIso();
  const text = primaryText?.trim() || draftingValueToPlainText(result, resolvedTitle);
  const bilingualSections = collectBilingualSections(result);
  const sections: DraftingExportSection[] = text.trim()
    ? [{ heading: 'Draft text', content: text }, ...bilingualSections]
    : bilingualSections;

  return {
    title: resolvedTitle,
    filenameBase: safeFilenameBase(filenameBase ?? resolvedTitle),
    dateStamp: exportedAt.slice(0, 10),
    exportedAt,
    primaryText: text,
    result,
    metadata: metadata ?? {},
    sections: sections.length ? sections : [{ heading: 'Draft text', content: '' }],
  };
}

function markdownFromPrepared(prepared: PreparedDraftingExport): string {
  const parts = [`# ${prepared.title}`, `Exported: ${prepared.exportedAt}`];
  const rows = metadataRows(prepared.metadata);
  if (rows.length) {
    parts.push(
      ['## Metadata', '| Field | Value |', '| --- | --- |', ...rows.map(([key, value]) => `| ${escapeMarkdownCell(key)} | ${escapeMarkdownCell(value)} |`)].join('\n'),
    );
  }
  prepared.sections.forEach((section) => {
    parts.push(`## ${section.heading}\n\n${section.content.trim() || '_No content_'}`);
  });
  return parts.join('\n\n');
}

function textFromPrepared(prepared: PreparedDraftingExport): string {
  const parts = [prepared.title, `Exported: ${prepared.exportedAt}`];
  const rows = metadataRows(prepared.metadata);
  if (rows.length) {
    parts.push(['Metadata', ...rows.map(([key, value]) => `${key}: ${value}`)].join('\n'));
  }
  prepared.sections.forEach((section) => {
    parts.push(`${section.heading}\n${section.content}`);
  });
  return parts.join('\n\n');
}

function flattenCsvRows(section: string, value: unknown, rows: string[][], prefix = ''): void {
  if (value === null || typeof value === 'undefined') {
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    rows.push([section, prefix || 'value', String(value)]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenCsvRows(section, item, rows, `${prefix}${prefix ? '.' : ''}${index + 1}`));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, nested]) => {
      flattenCsvRows(section, nested, rows, `${prefix}${prefix ? '.' : ''}${key}`);
    });
  }
}

function csvFromPrepared(prepared: PreparedDraftingExport): string {
  const rows: string[][] = [
    ['section', 'field', 'value'],
    ['document', 'title', prepared.title],
    ['document', 'exported_at', prepared.exportedAt],
  ];
  metadataRows(prepared.metadata).forEach(([key, value]) => rows.push(['metadata', key, value]));
  prepared.sections.forEach((section) => rows.push(['content', section.heading, section.content]));
  if (typeof prepared.result !== 'undefined') {
    flattenCsvRows('result', prepared.result, rows);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function htmlFromPrepared(
  prepared: PreparedDraftingExport,
  mode: 'print' | 'word',
  printButtonLabel = 'Print or save PDF',
  noContentLabel = 'No content',
  exportedLabel = 'Exported',
): string {
  const rows = metadataRows(prepared.metadata);
  const metadataTable = rows.length
    ? `<table><tbody>${rows
        .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
        .join('')}</tbody></table>`
    : '';
  const sections = prepared.sections
    .map(
      (section) => `
        <section>
          <h2>${escapeHtml(section.heading)}</h2>
          <div class="draft-text">${escapeHtml(section.content || noContentLabel)}</div>
        </section>`,
    )
    .join('');
  const wordMeta =
    mode === 'word'
      ? '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />'
      : '<meta charset="utf-8" />';

  return `<!doctype html>
<html>
<head>
${wordMeta}
<title>${escapeHtml(prepared.title)}</title>
<style>
  @page { margin: 0.75in; }
  body { color: #06352F; font-family: Inter, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-size: 12pt; line-height: 1.55; }
  h1 { font-size: 20pt; margin: 0 0 6pt; }
  h2 { border-bottom: 1px solid #D1D8D5; font-size: 14pt; margin: 18pt 0 8pt; padding-bottom: 4pt; }
  .meta { color: #6C7874; font-size: 9pt; margin-bottom: 14pt; }
  table { border-collapse: collapse; margin: 10pt 0 16pt; width: 100%; }
  th, td { border: 1px solid #D1D8D5; padding: 5pt 7pt; text-align: left; vertical-align: top; }
  th { background: #FDFFF6; width: 30%; }
  .draft-text { white-space: pre-wrap; }
  @media print { .no-print { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <button class="no-print" onclick="window.print()" style="margin:0 0 16px;padding:8px 12px">${escapeHtml(printButtonLabel)}</button>
  <h1>${escapeHtml(prepared.title)}</h1>
  <div class="meta">${escapeHtml(exportedLabel)}: ${escapeHtml(prepared.exportedAt)}</div>
  ${metadataTable}
  ${sections}
</body>
</html>`;
}

function createBrowserExportFile(
  format: Exclude<DraftingActionExportFormat, 'pdf'>,
  prepared: PreparedDraftingExport,
): DraftingBrowserExportFile {
  const filename = `${prepared.filenameBase}-${prepared.dateStamp}`;
  if (format === 'json') {
    return {
      content: JSON.stringify(
        {
          title: prepared.title,
          exportedAt: prepared.exportedAt,
          primaryText: prepared.primaryText,
          sections: prepared.sections,
          result: prepared.result ?? null,
          metadata: prepared.metadata,
        },
        null,
        2,
      ),
      filename: `${filename}.json`,
      mimeType: 'application/json;charset=utf-8',
    };
  }
  if (format === 'markdown') {
    return {
      content: markdownFromPrepared(prepared),
      filename: `${filename}.md`,
      mimeType: 'text/markdown;charset=utf-8',
    };
  }
  if (format === 'csv') {
    return {
      content: csvFromPrepared(prepared),
      filename: `${filename}.csv`,
      mimeType: 'text/csv;charset=utf-8',
    };
  }
  if (format === 'docx') {
    const packageBytes = createDocxPackage(prepared);
    return {
      content: new Blob([uint8ArrayToArrayBuffer(packageBytes)], { type: DOCX_MIME }),
      filename: `${filename}.docx`,
      mimeType: DOCX_MIME,
    };
  }
  return {
    content: textFromPrepared(prepared),
    filename: `${filename}.txt`,
    mimeType: 'text/plain;charset=utf-8',
  };
}

function downloadBrowserFile(file: DraftingBrowserExportFile): void {
  if (typeof document === 'undefined') {
    return;
  }
  const blob =
    file.content instanceof Blob ? file.content : new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function openPrintWindow(html: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const printWindow = window.open('', '_blank', 'width=960,height=720');
  if (!printWindow) {
    throw new Error('Unable to open the print window. Allow pop-ups and try again.');
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => {
    printWindow.print();
  }, 250);
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function docxParagraph(text: string, style?: 'Title' | 'Heading1' | 'Metadata'): string {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(text || ' ')}</w:t></w:r></w:p>`;
}

function docxParagraphsFromText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line.trim() ? docxParagraph(line) : '<w:p/>'))
    .join('');
}

function createDocxDocumentXml(prepared: PreparedDraftingExport): string {
  const rows = metadataRows(prepared.metadata);
  const metadata = rows.map(([key, value]) => docxParagraph(`${key}: ${value}`, 'Metadata')).join('');
  const sections = prepared.sections
    .map((section) => `${docxParagraph(section.heading, 'Heading1')}${docxParagraphsFromText(section.content || 'No content')}`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${docxParagraph(prepared.title, 'Title')}
    ${docxParagraph(`Exported: ${prepared.exportedAt}`, 'Metadata')}
    ${metadata}
    ${sections}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function createDocxPackage(prepared: PreparedDraftingExport): Uint8Array {
  return createStoredZip([
    {
      path: '[Content_Types].xml',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    },
    {
      path: '_rels/.rels',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    },
    {
      path: 'word/_rels/document.xml.rels',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
    },
    {
      path: 'word/document.xml',
      data: encodeUtf8(createDocxDocumentXml(prepared)),
    },
    {
      path: 'word/styles.xml',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:rPr><w:color w:val="6C7874"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`),
    },
    {
      path: 'docProps/core.xml',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(prepared.title)}</dc:title>
  <dc:creator>Clario360</dc:creator>
  <cp:lastModifiedBy>Clario360</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${prepared.exportedAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${prepared.exportedAt}</dcterms:modified>
</cp:coreProperties>`),
    },
    {
      path: 'docProps/app.xml',
      data: encodeUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Clario360</Application>
</Properties>`),
    },
  ]);
}

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) {
    return crcTable;
  }
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  data.forEach((byte) => {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function createStoredZip(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  const { date, time } = dosDateTime();
  let offset = 0;

  files.forEach((file) => {
    const name = encodeUtf8(file.path);
    const checksum = crc32(file.data);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, time);
    writeUint16(localView, 12, date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, file.data.length);
    writeUint32(localView, 22, file.data.length);
    writeUint16(localView, 26, name.length);
    writeUint16(localView, 28, 0);
    localHeader.set(name, 30);
    chunks.push(localHeader, file.data);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, time);
    writeUint16(centralView, 14, date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, file.data.length);
    writeUint32(centralView, 24, file.data.length);
    writeUint16(centralView, 28, name.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(name, 46);
    centralDirectory.push(centralHeader);

    offset += localHeader.length + file.data.length;
  });

  const centralStart = offset;
  const centralBytes = concatUint8(centralDirectory);
  chunks.push(centralBytes);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralBytes.length);
  writeUint32(endView, 16, centralStart);
  writeUint16(endView, 20, 0);
  chunks.push(end);

  return concatUint8(chunks);
}

function DisabledButton({
  reason,
  children,
}: {
  reason: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function DraftingExportActions({
  title,
  filenameBase,
  primaryText,
  result,
  metadata,
  disabled = false,
  formats = DEFAULT_FORMATS,
  className,
  onExported,
  onExportDocx,
  onExportPdf,
  publishTargets = [],
  onPublished,
}: DraftingExportActionsProps) {
  const draftingLabels = useDraftingLabels();
  const re = draftingLabels.reviewEditor;
  const resolvedTitle = title ?? re.defaultResultTitle;
  const toasts = re.toasts;
  const printButtonLabel = draftingLabels.exportActions.printOrSavePdf;
  const noContentLabel = draftingLabels.exportActions.noContent;
  const exportedLabel = draftingLabels.exportActions.exported;
  const configs: ExportButtonConfig[] = formats.map((format) => ({
    format,
    label: exportButtonLabel(format),
    icon: iconForFormat(format),
  }));

  const handleExport = async (format: DraftingActionExportFormat) => {
    try {
      const prepared = prepareDraftingExport({ title: resolvedTitle, filenameBase, primaryText, result, metadata });
      if (format === 'docx') {
        if (onExportDocx) {
          await onExportDocx();
          const filename = `${prepared.filenameBase}-${prepared.dateStamp}.docx`;
          showSuccess(toasts.docxStarted, filename);
          onExported?.(format, filename);
          return;
        }
        const file = createBrowserExportFile('docx', prepared);
        downloadBrowserFile(file);
        showSuccess(toasts.docxReady, file.filename);
        onExported?.(format, file.filename);
        return;
      }
      if (format === 'pdf') {
        const filename = `${prepared.filenameBase}-${prepared.dateStamp}.pdf`;
        if (onExportPdf) {
          await onExportPdf();
          showSuccess(toasts.pdfStarted, filename);
          onExported?.(format, filename);
          return;
        }
        openPrintWindow(htmlFromPrepared(prepared, 'print', printButtonLabel, noContentLabel, exportedLabel));
        showSuccess(toasts.printOpened, toasts.printOpenedDetail);
        onExported?.(format, filename);
        return;
      }
      const file = createBrowserExportFile(format, prepared);
      downloadBrowserFile(file);
      showSuccess(toasts.exportReady, file.filename);
      onExported?.(format, file.filename);
    } catch (error) {
      showError(toasts.exportFailed, error instanceof Error ? error.message : toasts.exportFailedDetail);
    }
  };

  const handlePublish = async (target: DraftingPublishTarget) => {
    try {
      await target.onPublish();
      showSuccess(toasts.publishComplete, target.label);
      onPublished?.(target.id);
    } catch (error) {
      showError(toasts.publishFailed, error instanceof Error ? error.message : toasts.publishFailedDetail);
    }
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        <div className="flex flex-wrap items-center gap-2">
          {configs.map((config) => {
            const button = (
              <Button
                key={config.format}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || Boolean(config.disabledReason)}
                onClick={() => void handleExport(config.format)}
              >
                {config.icon}
                {config.label}
              </Button>
            );
            return config.disabledReason ? (
              <DisabledButton key={config.format} reason={config.disabledReason}>
                {button}
              </DisabledButton>
            ) : (
              button
            );
          })}
        </div>

        {publishTargets.length ? (
          <div className="flex flex-wrap items-center gap-2 border-s ps-2">
            {publishTargets.map((target) => {
              const button = (
                <Button
                  key={target.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || target.disabled}
                  onClick={() => void handlePublish(target)}
                >
                  {target.icon ?? <Send className="me-1.5 h-4 w-4" aria-hidden="true" />}
                  {target.label}
                </Button>
              );
              return target.disabledReason ? (
                <DisabledButton key={target.id} reason={target.disabledReason}>
                  {button}
                </DisabledButton>
              ) : (
                button
              );
            })}
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

export type DraftingReviewAnnotationStatus = 'open' | 'resolved' | 'dismissed';
export type DraftingReviewSuggestionStatus = 'open' | 'accepted' | 'rejected';
export type DraftingReviewerStatus = 'assigned' | 'reviewing' | 'approved' | 'changes-requested';

export interface DraftingReviewAnnotation {
  id: string;
  comment: string;
  quote?: string;
  author?: string;
  assignee?: string;
  createdAt?: string;
  status?: DraftingReviewAnnotationStatus;
  severity?: 'info' | 'warning' | 'blocking';
}

export interface DraftingReviewSuggestion {
  id: string;
  suggestedText: string;
  originalText?: string;
  label?: string;
  reason?: string;
  reviewer?: string;
  assignee?: string;
  createdAt?: string;
  status?: DraftingReviewSuggestionStatus;
}

export interface DraftingReviewerAssignment {
  id: string;
  name: string;
  role?: string;
  status?: DraftingReviewerStatus;
  dueAt?: string;
}

export interface InlineEditableResultPanelProps {
  title?: ReactNode;
  description?: ReactNode;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  minRows?: number;
  readOnly?: boolean;
  dir?: 'ltr' | 'rtl' | 'auto';
  className?: string;
  contentClassName?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  storageKey?: string;
  storageScope?: DraftingStorageScope;
  persistDraft?: boolean;
  exportTitle?: string;
  exportFilenameBase?: string;
  exportMetadata?: Record<string, unknown>;
  showExports?: boolean;
  showReviewTools?: boolean;
  compareText?: string;
  compareLabel?: string;
  annotations?: DraftingReviewAnnotation[];
  defaultAnnotations?: DraftingReviewAnnotation[];
  onAnnotationsChange?: (annotations: DraftingReviewAnnotation[]) => void;
  suggestions?: DraftingReviewSuggestion[];
  defaultSuggestions?: DraftingReviewSuggestion[];
  onSuggestionsChange?: (suggestions: DraftingReviewSuggestion[]) => void;
  onSuggestionDecision?: (
    suggestion: DraftingReviewSuggestion,
    status: DraftingReviewSuggestionStatus,
    nextValue: string,
  ) => void;
  reviewers?: DraftingReviewerAssignment[];
  defaultReviewers?: DraftingReviewerAssignment[];
  onReviewersChange?: (reviewers: DraftingReviewerAssignment[]) => void;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void | Promise<void>;
  onReset?: () => void;
}

function statusVariant(
  status?: DraftingReviewAnnotationStatus | DraftingReviewSuggestionStatus | DraftingReviewerStatus,
): 'destructive' | 'warning' | 'success' | 'outline' {
  if (status === 'accepted' || status === 'approved' || status === 'resolved') {
    return 'success';
  }
  if (status === 'rejected' || status === 'dismissed' || status === 'changes-requested') {
    return 'destructive';
  }
  if (status === 'reviewing' || status === 'open') {
    return 'warning';
  }
  return 'outline';
}

function AnnotatedDraftText({
  text,
  placeholder,
  annotations,
}: {
  text: string;
  placeholder: string;
  annotations: DraftingReviewAnnotation[];
}) {
  const openAnnotations = annotations.filter((annotation) => annotation.status !== 'resolved' && annotation.status !== 'dismissed');
  const matches = openAnnotations
    .map((annotation) => {
      if (!annotation.quote) {
        return null;
      }
      const start = text.indexOf(annotation.quote);
      return start >= 0
        ? {
            annotation,
            start,
            end: start + annotation.quote.length,
          }
        : null;
    })
    .filter((match): match is { annotation: DraftingReviewAnnotation; start: number; end: number } => Boolean(match))
    .sort((left, right) => left.start - right.start);

  const segments: Array<{ text: string; annotation?: DraftingReviewAnnotation }> = [];
  let cursor = 0;
  matches.forEach((match) => {
    if (match.start < cursor) {
      return;
    }
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start) });
    }
    segments.push({ text: text.slice(match.start, match.end), annotation: match.annotation });
    cursor = match.end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }

  if (!text) {
    return <span className="text-muted-foreground">{placeholder}</span>;
  }

  return (
    <>
      {segments.length
        ? segments.map((segment, index) =>
            segment.annotation ? (
              <mark
                key={`${segment.annotation.id}-${index}`}
                title={segment.annotation.comment}
                className="rounded bg-warning-100 px-0.5 text-warning-700 dark:text-warning-300"
              >
                {segment.text}
              </mark>
            ) : (
              <span key={`text-${index}`}>{segment.text}</span>
            ),
          )
        : text}
    </>
  );
}

export function InlineEditableResultPanel({
  title,
  description,
  value,
  defaultValue = '',
  placeholder,
  minRows = 12,
  readOnly = false,
  dir = 'auto',
  className,
  contentClassName,
  actions,
  footer,
  storageKey,
  storageScope = 'session',
  persistDraft = true,
  exportTitle,
  exportFilenameBase,
  exportMetadata,
  showExports = true,
  showReviewTools = false,
  compareText,
  compareLabel,
  annotations,
  defaultAnnotations = [],
  onAnnotationsChange,
  suggestions,
  defaultSuggestions = [],
  onSuggestionsChange,
  onSuggestionDecision,
  reviewers,
  defaultReviewers = [],
  onReviewersChange,
  onChange,
  onSave,
  onReset,
}: InlineEditableResultPanelProps) {
  const draftingLabels = useDraftingLabels();
  const re = draftingLabels.reviewEditor;
  const resolvedTitle = title ?? re.defaultTitle;
  const resolvedDescription = description ?? re.defaultDescription;
  const resolvedPlaceholder = placeholder ?? re.placeholder;
  const resolvedCompareLabel = compareLabel ?? re.sourceDraft;
  const editorId = useId();
  const isControlled = typeof value === 'string';
  const [draft, setDraft] = useState(() => value ?? defaultValue);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localAnnotations, setLocalAnnotations] = useState<DraftingReviewAnnotation[]>(defaultAnnotations);
  const [localSuggestions, setLocalSuggestions] = useState<DraftingReviewSuggestion[]>(defaultSuggestions);
  const [localReviewers, setLocalReviewers] = useState<DraftingReviewerAssignment[]>(defaultReviewers);
  const [selection, setSelection] = useState({ start: 0, end: 0, text: '' });
  const [commentDraft, setCommentDraft] = useState('');
  const [commentAssignee, setCommentAssignee] = useState('');
  const [suggestionDraft, setSuggestionDraft] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerRole, setReviewerRole] = useState('');

  const activeAnnotations = annotations ?? localAnnotations;
  const activeSuggestions = suggestions ?? localSuggestions;
  const activeReviewers = reviewers ?? localReviewers;
  const reviewToolsEnabled =
    showReviewTools ||
    Boolean(compareText) ||
    activeAnnotations.length > 0 ||
    activeSuggestions.length > 0 ||
    activeReviewers.length > 0;

  useEffect(() => {
    if (isControlled) {
      setDraft(value ?? '');
    }
  }, [isControlled, value]);

  useEffect(() => {
    if (!storageKey || isControlled) {
      return;
    }
    const stored = readStorageJson<string | null>(storageKey, null, storageScope);
    if (typeof stored === 'string') {
      setDraft(stored);
    }
  }, [isControlled, storageKey, storageScope]);

  useEffect(() => {
    if (storageKey && persistDraft) {
      writeStorageJson(storageKey, draft, storageScope);
    }
  }, [draft, persistDraft, storageKey, storageScope]);

  const dirty = useMemo(() => draft !== (value ?? defaultValue), [defaultValue, draft, value]);
  const compareBase = compareText ?? (value ?? defaultValue);
  const hasCompare = compareBase.trim().length > 0 || draft.trim().length > 0;
  const redlineDir = dir === 'auto' ? undefined : dir;
  const openAnnotationCount = activeAnnotations.filter(
    (annotation) => annotation.status !== 'resolved' && annotation.status !== 'dismissed',
  ).length;
  const openSuggestionCount = activeSuggestions.filter(
    (suggestion) => !suggestion.status || suggestion.status === 'open',
  ).length;
  const reviewExportMetadata = useMemo(() => {
    if (!reviewToolsEnabled) {
      return exportMetadata;
    }
    return {
      ...(exportMetadata ?? {}),
      review: {
        reviewers: activeReviewers,
        annotations: activeAnnotations,
        suggestions: activeSuggestions,
      },
    };
  }, [activeAnnotations, activeReviewers, activeSuggestions, exportMetadata, reviewToolsEnabled]);

  const updateDraft = (nextValue: string) => {
    if (!isControlled) {
      setDraft(nextValue);
    }
    onChange?.(nextValue);
  };

  const setAnnotationList = (nextAnnotations: DraftingReviewAnnotation[]) => {
    if (!annotations) {
      setLocalAnnotations(nextAnnotations);
    }
    onAnnotationsChange?.(nextAnnotations);
  };

  const setSuggestionList = (nextSuggestions: DraftingReviewSuggestion[]) => {
    if (!suggestions) {
      setLocalSuggestions(nextSuggestions);
    }
    onSuggestionsChange?.(nextSuggestions);
  };

  const setReviewerList = (nextReviewers: DraftingReviewerAssignment[]) => {
    if (!reviewers) {
      setLocalReviewers(nextReviewers);
    }
    onReviewersChange?.(nextReviewers);
  };

  const handleSelectionChange = (target: HTMLTextAreaElement) => {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    setSelection({
      start,
      end,
      text: start === end ? '' : target.value.slice(Math.min(start, end), Math.max(start, end)),
    });
  };

  const addAnnotation = () => {
    const comment = commentDraft.trim();
    if (!comment) {
      return;
    }
    const nextAnnotation: DraftingReviewAnnotation = {
      id: createId('annotation'),
      comment,
      quote: selection.text.trim() || undefined,
      assignee: commentAssignee.trim() || undefined,
      createdAt: nowIso(),
      status: 'open',
      severity: 'info',
    };
    setAnnotationList([nextAnnotation, ...activeAnnotations]);
    setCommentDraft('');
    showSuccess(re.toasts.commentAdded);
  };

  const updateAnnotationStatus = (annotationId: string, status: DraftingReviewAnnotationStatus) => {
    setAnnotationList(
      activeAnnotations.map((annotation) =>
        annotation.id === annotationId ? { ...annotation, status } : annotation,
      ),
    );
  };

  const addSuggestion = () => {
    const suggestedText = suggestionDraft.trim();
    if (!suggestedText) {
      return;
    }
    const nextSuggestion: DraftingReviewSuggestion = {
      id: createId('suggestion'),
      originalText: selection.text.trim() || undefined,
      suggestedText,
      assignee: commentAssignee.trim() || undefined,
      createdAt: nowIso(),
      status: 'open',
      label: selection.text.trim() ? re.replaceSelectedText : re.insertSuggestedText,
    };
    setSuggestionList([nextSuggestion, ...activeSuggestions]);
    setSuggestionDraft('');
    showSuccess(re.toasts.suggestionAdded);
  };

  const decideSuggestion = (
    suggestion: DraftingReviewSuggestion,
    status: DraftingReviewSuggestionStatus,
  ) => {
    let nextValue = draft;
    if (status === 'accepted') {
      const originalText = suggestion.originalText?.trim();
      if (originalText && nextValue.includes(originalText)) {
        nextValue = nextValue.replace(originalText, suggestion.suggestedText);
      } else if (suggestion.suggestedText.trim()) {
        nextValue = nextValue.trim() ? `${nextValue}\n\n${suggestion.suggestedText}` : suggestion.suggestedText;
      }
      updateDraft(nextValue);
    }
    const updatedSuggestion = { ...suggestion, status };
    setSuggestionList(
      activeSuggestions.map((item) => (item.id === suggestion.id ? updatedSuggestion : item)),
    );
    onSuggestionDecision?.(updatedSuggestion, status, nextValue);
  };

  const addReviewer = () => {
    const name = reviewerName.trim();
    if (!name) {
      return;
    }
    setReviewerList([
      ...activeReviewers,
      {
        id: createId('reviewer'),
        name,
        role: reviewerRole.trim() || undefined,
        status: 'assigned',
      },
    ]);
    setReviewerName('');
    setReviewerRole('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave?.(draft);
      setIsEditing(false);
      showSuccess(re.toasts.draftSaved);
    } catch (error) {
      showError(re.toasts.saveFailed, error instanceof Error ? error.message : re.toasts.saveFailedDetail);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    updateDraft(value ?? defaultValue);
    if (storageKey) {
      removeStorageValue(storageKey, storageScope);
    }
    onReset?.();
  };

  const editorSurface =
    isEditing && !readOnly ? (
      <Textarea
        id={`${editorId}-draft`}
        value={draft}
        onChange={(event) => updateDraft(event.target.value)}
        onSelect={(event) => handleSelectionChange(event.currentTarget)}
        onKeyUp={(event) => handleSelectionChange(event.currentTarget)}
        rows={minRows}
        placeholder={resolvedPlaceholder}
        dir={dir}
        className="min-h-[18rem] text-sm leading-7"
      />
    ) : (
      <div
        dir={dir}
        className="min-h-[18rem] whitespace-pre-wrap rounded-lg border bg-muted/30 p-4 text-sm leading-7"
      >
        {reviewToolsEnabled ? (
          <AnnotatedDraftText text={draft} placeholder={resolvedPlaceholder} annotations={activeAnnotations} />
        ) : (
          draft || <span className="text-muted-foreground">{resolvedPlaceholder}</span>
        )}
      </div>
    );

  const reviewSurface = (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">{re.openComments}</p>
          <p className="mt-1 text-lg font-semibold">{openAnnotationCount}</p>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">{re.openSuggestions}</p>
          <p className="mt-1 text-lg font-semibold">{openSuggestionCount}</p>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground">{re.reviewers}</p>
          <p className="mt-1 text-lg font-semibold">{activeReviewers.length}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {re.reviewAssignments}
          </div>
          {activeReviewers.length ? (
            <div className="flex flex-wrap gap-2">
              {activeReviewers.map((reviewer) => (
                <Badge key={reviewer.id} variant={statusVariant(reviewer.status)} className="tracking-normal normal-case">
                  {reviewer.name}
                  {reviewer.role ? ` - ${reviewer.role}` : ''}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{re.noReviewersAssigned}</p>
          )}
          {!readOnly ? (
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto]">
              <Input
                value={reviewerName}
                onChange={(event) => setReviewerName(event.target.value)}
                placeholder={re.reviewers}
                aria-label={draftingLabels.exportActions.reviewerNameAria}
              />
              <Input
                value={reviewerRole}
                onChange={(event) => setReviewerRole(event.target.value)}
                placeholder={draftingLabels.exportActions.rolePlaceholder}
                aria-label={draftingLabels.exportActions.roleAria}
              />
              <Button type="button" variant="outline" size="sm" onClick={addReviewer} disabled={!reviewerName.trim()}>
                {re.add}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquarePlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {re.addReviewItem}
          </div>
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {selection.text ? re.selectedPrefix(selection.text.slice(0, 140)) : re.selectTextHint}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${editorId}-assignee`}>{re.assignee}</Label>
            <Input
              id={`${editorId}-assignee`}
              value={commentAssignee}
              onChange={(event) => setCommentAssignee(event.target.value)}
              placeholder={draftingLabels.exportActions.reviewerOrTeamPlaceholder}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${editorId}-comment`}>{re.comment}</Label>
            <Textarea
              id={`${editorId}-comment`}
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.target.value)}
              rows={3}
              placeholder={draftingLabels.exportActions.reviewCommentPlaceholder}
              disabled={readOnly}
            />
            <Button type="button" variant="outline" size="sm" onClick={addAnnotation} disabled={readOnly || !commentDraft.trim()}>
              <MessageSquarePlus className="me-1.5 h-4 w-4" aria-hidden="true" />
              {re.commentButton}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${editorId}-suggestion`}>{re.suggestion}</Label>
            <Textarea
              id={`${editorId}-suggestion`}
              value={suggestionDraft}
              onChange={(event) => setSuggestionDraft(event.target.value)}
              rows={3}
              placeholder={draftingLabels.exportActions.replacementTextPlaceholder}
              disabled={readOnly}
            />
            <Button type="button" variant="outline" size="sm" onClick={addSuggestion} disabled={readOnly || !suggestionDraft.trim()}>
              <Highlighter className="me-1.5 h-4 w-4" aria-hidden="true" />
              {re.suggestButton}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium">{re.comments}</p>
          {activeAnnotations.length ? (
            <div className="space-y-2">
              {activeAnnotations.map((annotation) => (
                <div key={annotation.id} className="space-y-2 rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{annotation.assignee ?? annotation.author ?? re.unassigned}</p>
                      {annotation.quote ? (
                        <p className="mt-1 text-xs text-muted-foreground">{re.quotePrefix(annotation.quote)}</p>
                      ) : null}
                    </div>
                    <Badge variant={statusVariant(annotation.status)} className="tracking-normal normal-case">
                      {annotation.status ?? re.statusOpen}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{annotation.comment}</p>
                  {!readOnly && annotation.status !== 'resolved' && annotation.status !== 'dismissed' ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => updateAnnotationStatus(annotation.id, 'resolved')}>
                        <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                        {re.resolve}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => updateAnnotationStatus(annotation.id, 'dismissed')}>
                        <X className="me-1.5 h-4 w-4" aria-hidden="true" />
                        {re.dismiss}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{re.noComments}</div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{re.suggestions}</p>
          {activeSuggestions.length ? (
            <div className="space-y-2">
              {activeSuggestions.map((suggestion) => {
                const open = !suggestion.status || suggestion.status === 'open';
                return (
                  <div key={suggestion.id} className="space-y-2 rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{suggestion.label ?? re.textSuggestion}</p>
                        {suggestion.assignee || suggestion.reviewer ? (
                          <p className="mt-1 text-xs text-muted-foreground">{suggestion.assignee ?? suggestion.reviewer}</p>
                        ) : null}
                      </div>
                      <Badge variant={statusVariant(suggestion.status)} className="tracking-normal normal-case">
                        {suggestion.status ?? re.statusOpen}
                      </Badge>
                    </div>
                    {suggestion.originalText ? (
                      <p className="rounded bg-error-50 p-2 text-error-600 line-through">{suggestion.originalText}</p>
                    ) : null}
                    <p className="rounded bg-success-50 p-2 text-success-700">{suggestion.suggestedText}</p>
                    {suggestion.reason ? <p className="text-muted-foreground">{suggestion.reason}</p> : null}
                    {!readOnly && open ? (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => decideSuggestion(suggestion, 'accepted')}>
                          <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
                          {re.accept}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => decideSuggestion(suggestion, 'rejected')}>
                          <X className="me-1.5 h-4 w-4" aria-hidden="true" />
                          {re.reject}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{re.noSuggestions}</div>
          )}
        </div>
      </div>
    </div>
  );

  const compareSurface = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={dirty ? 'warning' : 'success'} className="tracking-normal normal-case">
          {dirty ? re.draftChanged : re.noDraftChanges}
        </Badge>
        <Badge variant="outline" className="tracking-normal normal-case">
          {resolvedCompareLabel}
        </Badge>
      </div>
      {hasCompare ? (
        <RedlineView
          original={compareBase}
          revised={draft}
          mode="split"
          originalLabel={resolvedCompareLabel}
          revisedLabel={re.currentDraft}
          dir={redlineDir}
        />
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {re.noTextToCompare}
        </div>
      )}
    </div>
  );

  return (
    <SectionCard
      title={resolvedTitle}
      description={resolvedDescription}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
          {!readOnly ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing((next) => !next)}>
              <PenLine className="me-1.5 h-4 w-4" aria-hidden="true" />
              {isEditing ? re.preview : re.edit}
            </Button>
          ) : null}
        </div>
      }
      className={className}
      contentClassName={cn('space-y-4', contentClassName)}
    >
      {reviewToolsEnabled ? (
        <Tabs defaultValue="draft" className="space-y-4">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="draft">
              <FileText className="me-1.5 h-4 w-4" aria-hidden="true" />
              {re.draftTab}
            </TabsTrigger>
            <TabsTrigger value="review">
              <MessageSquarePlus className="me-1.5 h-4 w-4" aria-hidden="true" />
              {re.reviewTab}
            </TabsTrigger>
            <TabsTrigger value="compare">
              <GitCompareArrows className="me-1.5 h-4 w-4" aria-hidden="true" />
              {re.compareTab}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="draft" className="mt-0">
            {editorSurface}
          </TabsContent>
          <TabsContent value="review" className="mt-0">
            {reviewSurface}
          </TabsContent>
          <TabsContent value="compare" className="mt-0">
            {compareSurface}
          </TabsContent>
        </Tabs>
      ) : (
        editorSurface
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {!readOnly ? (
          <>
            <Button type="button" size="sm" onClick={() => void handleSave()} disabled={isSaving || !dirty}>
              {isSaving ? (
                <Download className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="me-1.5 h-4 w-4" aria-hidden="true" />
              )}
              {re.save}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleReset} disabled={!dirty}>
              <RotateCcw className="me-1.5 h-4 w-4" aria-hidden="true" />
              {re.reset}
            </Button>
          </>
        ) : null}

        {showExports ? (
          <DraftingExportActions
            title={exportTitle ?? (typeof title === 'string' ? title : re.defaultResultTitle)}
            filenameBase={exportFilenameBase}
            primaryText={draft}
            metadata={reviewExportMetadata}
            className="ms-auto"
          />
        ) : null}
        {footer}
      </div>
    </SectionCard>
  );
}

export function DraftingReviewEditor(props: InlineEditableResultPanelProps) {
  return <InlineEditableResultPanel {...props} showReviewTools={props.showReviewTools ?? true} />;
}
