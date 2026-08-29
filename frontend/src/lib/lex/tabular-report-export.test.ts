import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  buildTabularReportCsv,
  buildTabularReportXlsx,
} from "./tabular-report-export";

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

describe("tabular report exports", () => {
  it("escapes CSV and includes a UTF-8 BOM for Arabic-safe Excel imports", async () => {
    const blob = buildTabularReportCsv({
      name: "تقرير",
      headers: ["المؤشر", "القيمة"],
      rows: [["Quoted, \"value\"", 12]],
      rtl: true,
    });

    const buffer = await readBlob(blob);
    expect([...new Uint8Array(buffer).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(buffer);
    expect(csv).toContain('"Quoted, ""value"""');
  });

  it("builds a branded, RTL-aware XLSX worksheet", async () => {
    const blob = await buildTabularReportXlsx({
      name: "Risk / Portfolio",
      headers: ["Metric", "Value"],
      rows: [["High risk", 7]],
      rtl: true,
    });
    const zip = await JSZip.loadAsync(await readBlob(blob));
    const worksheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const workbook = await zip.file("xl/workbook.xml")!.async("string");
    const styles = await zip.file("xl/styles.xml")!.async("string");

    expect(worksheet).toContain('rightToLeft="1"');
    expect(worksheet).toContain('state="frozen"');
    expect(workbook).toContain('name="Risk   Portfolio"');
    expect(styles).toContain("FF0F766E");
  });
});
