export type ReportCell = string | number | boolean | null | undefined;

export interface TabularReport {
  name: string;
  headers: string[];
  rows: ReportCell[][];
  rtl?: boolean;
}

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function csvCell(value: ReportCell): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildTabularReportCsv(report: TabularReport): Blob {
  const lines = [report.headers, ...report.rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return new Blob(["\uFEFF", lines], { type: "text/csv;charset=utf-8" });
}

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let name = "";
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) {
    name = String.fromCharCode(65 + ((current - 1) % 26)) + name;
  }
  return name;
}

function xlsxCell(value: ReportCell, row: number, column: number, header = false) {
  const ref = `${columnName(column)}${row}`;
  const style = header ? ' s="1"' : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === "boolean") {
    return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(
    value == null ? "" : String(value),
  )}</t></is></c>`;
}

function safeSheetName(name: string): string {
  return name.replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || "Report";
}

/** Builds a dependency-light, Excel-compatible XLSX with a branded header row. */
export async function buildTabularReportXlsx(report: TabularReport): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const rows = [report.headers, ...report.rows];
  const sheetRows = rows
    .map(
      (values, rowIndex) =>
        `<row r="${rowIndex + 1}">${values
          .map((value, columnIndex) =>
            xlsxCell(value, rowIndex + 1, columnIndex, rowIndex === 0),
          )
          .join("")}</row>`,
    )
    .join("");
  const columnWidths = report.headers
    .map((header, index) => {
      const longest = Math.max(
        header.length,
        ...report.rows.map((row) => String(row[index] ?? "").length),
      );
      return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(
        45,
        Math.max(12, longest + 2),
      )}" customWidth="1"/>`;
    })
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xml(safeSheetName(report.name))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"${report.rtl ? ' rightToLeft="1"' : ""}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${columnWidths}</cols>
  <sheetData>${sheetRows}</sheetData>
  <autoFilter ref="A1:${columnName(Math.max(0, report.headers.length - 1))}1"/>
</worksheet>`,
  );

  return new Blob([await zip.generateAsync({ type: "arraybuffer" })], {
    type: XLSX_MIME,
  });
}
