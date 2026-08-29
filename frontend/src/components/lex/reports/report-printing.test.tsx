import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { getMessages } from "@/lib/i18n/messages";
import { PrintableReport } from "./printable-report";
import { ReportExportMenu } from "./report-export-menu";
import { ReportPeriodControl } from "./report-period-control";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    tenant: {
      name: "Acme Legal",
      settings: { branding: { company_name: "Acme Holdings" } },
    },
    user: {
      full_name: "Aisha Rahman",
      email: "aisha@example.test",
    },
  }),
}));

function renderEnglish(node: React.ReactNode) {
  return render(
    <LocaleProvider locale="en" direction="ltr" messages={getMessages("en")}>
      {node}
    </LocaleProvider>,
  );
}

describe("Lex report print controls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders branded report metadata and A4 landscape print rules", () => {
    const { container } = renderEnglish(
      <PrintableReport
        title="Case Portfolio Report"
        period={{ from: "2026-01-01", to: "2026-03-31" }}
      >
        <div>Report body</div>
      </PrintableReport>,
    );

    expect(screen.getByText("Case Portfolio Report")).toBeInTheDocument();
    expect(screen.getByText("Acme Holdings")).toBeInTheDocument();
    expect(screen.getByText("Aisha Rahman")).toBeInTheDocument();
    expect(screen.getByText("Confidential — Internal use only")).toBeInTheDocument();
    expect(screen.getByText("Report body")).toBeInTheDocument();
    expect(container.querySelector("style")?.textContent).toContain(
      "size: A4 landscape",
    );
    expect(container.querySelector("style")?.textContent).toContain(
      "table-header-group",
    );
    expect(container.querySelector("style")?.textContent).toContain(
      '[data-report-section="true"] { break-before: page',
    );
    expect(container.querySelector("style")?.textContent).toContain(
      'button:not([data-report-no-print="true"])',
    );
    expect(container.querySelector("style")?.textContent).toContain(
      "width: 250mm !important",
    );
  });

  it("exports PDF through print and invokes the provided data exports", async () => {
    const onCsv = vi.fn();
    const onXlsx = vi.fn();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderEnglish(<ReportExportMenu onCsv={onCsv} onXlsx={onXlsx} />);

    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "PDF (landscape)" }));
    expect(print).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "Excel (.xlsx)" }));
    expect(onXlsx).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "CSV (.csv)" }));
    expect(onCsv).toHaveBeenCalledOnce();
  });

  it("shows an honest fixed period without offering an inactive picker", () => {
    renderEnglish(
      <ReportPeriodControl
        value={{ from: undefined, to: undefined }}
        onChange={vi.fn()}
        fixedLabel="Current portfolio snapshot · next 12 months"
      />,
    );

    expect(
      screen.getAllByText("Current portfolio snapshot · next 12 months"),
    ).toHaveLength(2);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
