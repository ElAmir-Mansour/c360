import { describe, expect, it } from "vitest";

import type { LegalCase } from "@/lib/lex/cases";
import type { Settlement } from "@/lib/lex/settlements";
import { buildAnalytics } from "./use-legal-ops-analytics";

function legalCase(
  id: string,
  status: LegalCase["status"],
  overrides: Partial<LegalCase> = {},
): LegalCase {
  return {
    id,
    status,
    case_number: id,
    case_type: "commercial",
    handling_officer_id: "officer-1",
    title: { en: id, ar: id },
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    ...overrides,
  } as LegalCase;
}

describe("buildAnalytics contributor ids", () => {
  it("keeps every KPI and workload total tied to its exact source records", () => {
    const active = legalCase("case-active", "open");
    const closed = legalCase("case-closed", "closed", {
      updated_at: "2026-07-25T00:00:00Z",
    });
    const settlement = {
      id: "settlement-1",
      reference: "SET-1",
      status: "executed",
      title: "Executed settlement",
      created_at: "2026-07-01T00:00:00Z",
      executed_at: "2026-07-10T00:00:00Z",
      value: 1_000,
    } as Settlement;

    const result = buildAnalytics({
      cases: [active, closed],
      officers: new Map([["officer-1", "Maha"]]),
      settlements: [settlement],
      locale: "en",
      unassignedLabel: "Unassigned",
      now: new Date("2026-08-01T00:00:00Z"),
    });

    expect(result.kpis.activeMatterIds).toEqual([active.id]);
    expect(result.kpis.closedRecentIds).toEqual([closed.id]);
    expect(result.kpis.closedCaseIds).toEqual([closed.id]);
    expect(result.kpis.settlementIds).toEqual([settlement.id]);
    expect(result.kpis.throughputCaseIds).toContain(closed.id);
    expect(result.kpis.busiestOfficerId).toBe("officer-1");
    expect(result.workload.officers[0]?.caseIds).toEqual([active.id]);
    expect(result.workload.areas[0]?.caseIds).toEqual([active.id]);
    expect(
      result.workload.cells.get("officer-1")?.get("commercial")?.caseIds,
    ).toEqual([active.id]);
  });
});
