import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/lex/contracts/[id]/page.tsx"),
  "utf8",
);

describe("contract detail operational metrics", () => {
  it("uses a balanced responsive grid for the four-card contract brief", () => {
    expect(source).toContain(
      "contract-brief-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4",
    );
  });

  it("routes every local metric through the compact shared treatment", () => {
    expect(source).toContain('<DetailStatCard\n      appearance="operational"');
    expect(source).toContain(
      'className="contract-detail-metric-card min-h-32"',
    );
    expect(source).toContain("icon={UserRound}");
    expect(source).toContain("icon={CircleDollarSign}");
    expect(source).toContain("icon={ShieldAlert}");
  });
});
