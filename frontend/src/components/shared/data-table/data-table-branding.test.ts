import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("shared DataTable visual system", () => {
  const dataTable = read("src/components/shared/data-table/data-table.tsx");
  const toolbar = read(
    "src/components/shared/data-table/data-table-toolbar.tsx",
  );
  const columnHeader = read(
    "src/components/shared/data-table/data-table-column-header.tsx",
  );
  const commonColumns = read(
    "src/components/shared/data-table/columns/common-columns.tsx",
  );
  const tablePrimitive = read("src/components/ui/table.tsx");

  it("uses one flat branded frame with an accent edge and attached pagination", () => {
    expect(dataTable).toContain(
      "data-table-shell w-full overflow-hidden rounded-xl border border-primary/20 border-t-[3px] border-t-brand-accent-500 bg-card shadow-none",
    );
    expect(dataTable).toContain(
      'className="data-table-pagination border-t border-primary/10 bg-primary/[0.025] px-3"',
    );
    expect(dataTable).not.toContain("shadow-[var(--card-shadow)]");
    expect(dataTable).not.toMatch(/bg-gradient-/);
  });

  it("renders a solid deep-teal header with high-contrast controls", () => {
    expect(dataTable).toContain(
      '"data-table-header bg-brand-primary-600 text-white"',
    );
    expect(dataTable).toContain(
      "border-b border-white/10 bg-brand-primary-600 text-white/80",
    );
    expect(columnHeader).toContain(
      "text-white/80 hover:bg-white/10 hover:text-white",
    );
    expect(columnHeader).toContain('isCurrentSort && "bg-white/10 text-white"');
    expect(commonColumns).toContain(
      "border-white/70 data-[state=checked]:border-brand-accent-500",
    );
  });

  it("keeps rows stable while using restrained branded hover and selection states", () => {
    expect(dataTable).toContain('"hover:bg-primary/[0.045]"');
    expect(dataTable).toContain("data-table-mobile-row");
    expect(dataTable).toContain("border-s-brand-accent-500 bg-primary/[0.07]");
    expect(tablePrimitive).not.toContain("motion-safe:hover:-translate-y-px");
  });

  it("gives the toolbar a flat RTL-safe brand accent", () => {
    expect(toolbar).toContain("data-table-toolbar-surface");
    expect(toolbar).toContain(
      "before:start-0 before:w-[3px] before:bg-brand-accent-500",
    );
    expect(toolbar).toContain("bg-card");
    expect(toolbar).toContain("shadow-none");
  });
});
