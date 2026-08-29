import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { getMessages } from "@/lib/i18n/messages";
import type { Investigation } from "@/lib/lex/investigations";
import type { InvestigationReportDraft } from "./investigation-report-model";
import { InvestigationReportWorkspace } from "./investigation-report-workspace";

const investigation: Investigation = {
  id: "inv-1",
  tenant_id: "tenant-1",
  investigation_number: "INV-2026-001",
  subject: "Unauthorized procurement transactions",
  lead_investigator: "Ahmad Mahmoud",
  status: "results_recorded",
  priority: "critical",
  findings: "Unauthorized access was detected.",
  recommendations: "Revoke administrative access.",
  ai_drafted: false,
  department: "Procurement",
  created_by: "user-1",
  created_at: "2026-07-01T09:00:00.000Z",
  updated_at: "2026-07-12T10:30:00.000Z",
  evidence: [
    {
      id: "evidence-1",
      tenant_id: "tenant-1",
      investigation_id: "inv-1",
      title: "Procurement database export",
      description: "Forensic transaction snapshot",
      evidence_type: "system_log",
      collected_by: "Ahmad Mahmoud",
      collected_at: "2026-07-05T09:00:00.000Z",
      metadata: { sha256: "8f4a7c112233445566778899aabb2e91" },
      created_by: "user-1",
      created_at: "2026-07-05T09:00:00.000Z",
      updated_at: "2026-07-05T09:00:00.000Z",
    },
  ],
};

const draft: InvestigationReportDraft = {
  version: 2.3,
  executiveSummary: "The review identified a material control failure.",
  findings: [
    {
      id: "finding-1",
      title: "Unauthorized ERP Database Bypass Detected",
      description: "Manual changes bypassed the corporate approval workflow.",
      severity: "critical",
    },
  ],
  recommendations: [
    {
      id: "recommendation-1",
      title: "Admin Revocation",
      description: "Suspend database modification privileges.",
      owner: "IT Security",
      timing: "Immediate",
    },
  ],
};

function renderInEnglish(node: ReactNode) {
  return render(
    <LocaleProvider locale="en" direction="ltr" messages={getMessages("en")}>
      {node}
    </LocaleProvider>,
  );
}

describe("InvestigationReportWorkspace", () => {
  it("matches the reference report hierarchy using investigation data", () => {
    renderInEnglish(
      <InvestigationReportWorkspace
        investigation={investigation}
        draft={draft}
        approvalTasks={[]}
        canEdit
        canSubmit
        saving={false}
        submitting={false}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onExport={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: /Investigation Report & Findings/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Executive Summary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Key Findings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recommendations" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Approval & Sign-off Workflow",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Associated Evidence Reference Grid",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("EVID-01")).toBeInTheDocument();
    expect(screen.getByText(/SHA-256 Verified/)).toBeInTheDocument();
  });

  it("connects save, export, submit, and inline report updates", () => {
    const onDraftChange = vi.fn();
    const onSave = vi.fn();
    const onExport = vi.fn();
    const onSubmit = vi.fn();

    renderInEnglish(
      <InvestigationReportWorkspace
        investigation={investigation}
        draft={draft}
        approvalTasks={[]}
        canEdit
        canSubmit
        saving={false}
        submitting={false}
        onDraftChange={onDraftChange}
        onSave={onSave}
        onExport={onExport}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Executive Summary"), {
      target: { value: "Updated executive summary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for Review" }));

    expect(onDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        executiveSummary: "Updated executive summary",
      }),
    );
    expect(onSave).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
