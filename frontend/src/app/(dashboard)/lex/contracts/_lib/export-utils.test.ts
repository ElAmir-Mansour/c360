import { describe, expect, it } from 'vitest';

import {
  CSV_BOM,
  contractsReportFilename,
  csvBlobWithBom,
  csvEscapeCell,
  csvWithBom,
  serverExportLabels,
} from './export-utils';

describe('csvWithBom', () => {
  it('prepends exactly one UTF-8 BOM (the Arabic-in-Excel mojibake fix)', () => {
    const csv = csvWithBom([
      ['Contract', 'الحالة'],
      ['اتفاقية الخدمات الرئيسية', 'نشط'],
    ]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    // Exactly one BOM, at the head — not re-prepended per row.
    expect(csv.split(CSV_BOM)).toHaveLength(2);
  });

  it('keeps the previous inline builder output byte-identical apart from the BOM', () => {
    const rows = [
      ['Contract', 'Value'],
      ['MSA "Gold" tier', '125,000'],
    ];
    // The exact expression the page used before the swap (page.tsx:384-386).
    const legacy = rows
      .map((cells) => cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    expect(csvWithBom(rows)).toBe(CSV_BOM + legacy);
  });

  it('quotes every cell and doubles embedded quotes', () => {
    expect(csvEscapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscapeCell(null)).toBe('""');
    expect(csvEscapeCell(1250)).toBe('"1250"');
  });
});

describe('csvBlobWithBom', () => {
  it('wraps the BOM-prefixed CSV in a UTF-8 text/csv blob', async () => {
    const blob = csvBlobWithBom([['عقد']]);

    expect(blob.type).toBe('text/csv;charset=utf-8;');
    // jsdom's Blob has no .text(); read raw bytes via FileReader. (readAsText
    // would strip the BOM during decode, per spec — the bytes are the proof.)
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    // UTF-8 encoding of U+FEFF — the on-disk signature Excel keys off.
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8').decode(bytes)).toBe('"عقد"');
  });
});

describe('contractsReportFilename', () => {
  it('stamps the server-report filename with the ISO date', () => {
    expect(contractsReportFilename(new Date('2026-07-09T13:00:00Z'))).toBe(
      'contracts-report-2026-07-09.csv',
    );
  });
});

describe('serverExportLabels', () => {
  it('exposes same-shaped EN/AR bundles per the lex bilingual contract', () => {
    expect(Object.keys(serverExportLabels.ar).sort()).toEqual(
      Object.keys(serverExportLabels.en).sort(),
    );
    expect(serverExportLabels.en.serverExport).toBe('Server export (watermarked)');
    expect(serverExportLabels.ar.serverExport).not.toBe(serverExportLabels.en.serverExport);
  });
});
