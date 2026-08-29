import { describe, expect, it } from "vitest";
import type { Investigation } from "@/lib/lex/investigations";
import {
  buildInvestigationReportDraft,
  investigationReportMetadata,
  nextReportVersion,
  serializeReportFindings,
  serializeReportRecommendations,
} from "./investigation-report-model";

const investigation: Investigation = {
  id: "inv-1",
  tenant_id: "tenant-1",
  investigation_number: "INV-2026-001",
  subject: "Procurement controls review",
  lead_investigator: "Ahmad Mahmoud",
  status: "in_progress",
  priority: "critical",
  findings: "Unauthorized database access.\n\nApproval controls were bypassed.",
  recommendations:
    "Suspend administrative access.\n\nComplete an infrastructure audit.",
  ai_drafted: false,
  department: "Procurement",
  metadata: { confidentiality: "restricted" },
  created_by: "user-1",
  created_at: "2026-07-01T09:00:00.000Z",
  updated_at: "2026-07-12T10:30:00.000Z",
};

describe("investigation report model", () => {
  it("builds an editable report from the live investigation record", () => {
    const draft = buildInvestigationReportDraft(investigation, {
      finding: "Finding",
      recommendation: "Recommendation",
      owner: "Procurement",
    });

    expect(draft.executiveSummary).toContain("Unauthorized database access");
    expect(draft.findings).toHaveLength(2);
    expect(draft.findings[0]).toMatchObject({ severity: "critical" });
    expect(draft.recommendations).toHaveLength(2);
    expect(draft.recommendations[0]).toMatchObject({ owner: "Procurement" });
  });

  it("round-trips a saved structured draft through investigation metadata", () => {
    const draft = buildInvestigationReportDraft(investigation, {
      finding: "Finding",
      recommendation: "Recommendation",
      owner: "Procurement",
    });
    const saved = {
      ...draft,
      version: nextReportVersion(draft.version),
      savedAt: "2026-07-26T12:00:00.000Z",
    };
    const metadata = investigationReportMetadata(investigation, saved);
    const restored = buildInvestigationReportDraft(
      { ...investigation, metadata },
      {
        finding: "Finding",
        recommendation: "Recommendation",
        owner: "Procurement",
      },
    );

    expect(restored).toEqual(saved);
    expect(metadata.confidentiality).toBe("restricted");
  });

  it("serializes findings and recommendations for the approval API", () => {
    const draft = buildInvestigationReportDraft(investigation, {
      finding: "Finding",
      recommendation: "Recommendation",
      owner: "Procurement",
    });

    expect(serializeReportFindings(draft.findings)).toContain(
      "1. Unauthorized database access.",
    );
    expect(serializeReportRecommendations(draft.recommendations)).toContain(
      "Owner: Procurement",
    );
  });
});
