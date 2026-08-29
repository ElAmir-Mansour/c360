import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexReportsPage from "./page";
import { reportsLabels } from "./_lib/reports-labels";
import type {
  LexContractReport,
  LexMatterReport,
  LexObligationReport,
} from "@/types/suites";

const {
  getContractReportMock,
  getMatterReportMock,
  getObligationReportMock,
  getCaseReportMock,
  getInvestigationReportMock,
  hasPermissionMock,
  searchParamsMock,
} = vi.hoisted(() => ({
  getContractReportMock: vi.fn(),
  getMatterReportMock: vi.fn(),
  getObligationReportMock: vi.fn(),
  getCaseReportMock: vi.fn(),
  getInvestigationReportMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
  searchParamsMock: { value: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/lex/reports",
  useSearchParams: () => new URLSearchParams(searchParamsMock.value),
  useParams: () => ({}),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    hasPermission: hasPermissionMock,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: "u-1", email: "legal@example.com", full_name: "Legal Owner" },
  }),
}));

vi.mock("@/lib/toast", () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showApiError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock("@/lib/enterprise", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/enterprise")>(
      "@/lib/enterprise",
    );
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      lex: {
        ...actual.enterpriseApi.lex,
        getContractReport: getContractReportMock,
        getMatterReport: getMatterReportMock,
        getObligationReport: getObligationReportMock,
      },
    },
  };
});

vi.mock("@/lib/lex/reports", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lex/reports")>("@/lib/lex/reports");
  return {
    ...actual,
    lexReportsApi: {
      ...actual.lexReportsApi,
      getCaseReport: getCaseReportMock,
      getInvestigationReport: getInvestigationReportMock,
    },
  };
});

const contractReport = {
  generated_at: "2026-06-02T09:00:00Z",
  total: 12,
  filters: {},
  contracts: [],
  by_status: { active: 12 },
  by_type: { service: 8, nda: 4 },
  by_risk_level: { high: 1 },
} as LexContractReport;

const matterReport = {
  generated_at: "2026-06-02T09:00:00Z",
  total: 3,
  filters: {},
  matters: [],
  by_status: { active: 3 },
  by_type: { advisory: 3 },
  by_priority: { high: 1 },
} as LexMatterReport;

const obligationReport = {
  generated_at: "2026-06-02T09:00:00Z",
  total: 5,
  filters: {},
  obligations: [],
  overdue: 1,
  due_soon: 2,
  completed: 2,
  by_status: { open: 3 },
  by_type: { compliance: 5 },
  by_priority: { medium: 5 },
} as LexObligationReport;

const caseReport = {
  generated_at: "2026-06-02T09:00:00Z",
  filters: {},
  total: 8,
  by_type: [{ key: "litigation", count: 8 }],
  by_department: [{ key: "Legal", count: 8 }],
  by_status: [{ key: "open", count: 5 }, { key: "closed", count: 3 }],
  by_company_status: [{ key: "plaintiff", count: 6 }, { key: "defendant", count: 2 }],
  closed: 3,
  under_procedure: 2,
};

const investigationReport = {
  generated_at: "2026-06-02T09:00:00Z",
  filters: {},
  total: 2,
  by_status: [{ key: "registered", count: 1 }, { key: "in_progress", count: 1 }],
  by_category: [{ key: "fraud", count: 2 }],
  open: 2,
  closed: 0,
  avg_open_age_days: 4.5,
  avg_register_to_approved_hours: 0,
  approval_sample_size: 0,
  sla: { on_time: 0, breached: 1, pending: 1, compliance_rate_pct: 0 },
  items: [{ id: "i-1", investigation_number: "INV-001", status: "in_progress", category: "fraud", priority: "high", department: "Legal", created_at: "2026-06-01T09:00:00Z", age_days: 1, sla_outcome: "pending" }],
  items_truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsMock.value = "";
  hasPermissionMock.mockReturnValue(true);
  getContractReportMock.mockResolvedValue(contractReport);
  getMatterReportMock.mockResolvedValue(matterReport);
  getObligationReportMock.mockResolvedValue(obligationReport);
  getCaseReportMock.mockResolvedValue(caseReport);
  getInvestigationReportMock.mockResolvedValue(investigationReport);
});

describe("LexReportsPage", () => {
  it("mounts with the English surface, renders the export action and the contract report", async () => {
    renderWithQuery(<LexReportsPage />);

    expect(
      await screen.findByRole("heading", { name: reportsLabels.en.pageTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: reportsLabels.en.reportRows.contracts,
      }),
    ).toBeInTheDocument();
    expect(getContractReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        per_page: 25,
        sort: "created_at",
        order: "desc",
      }),
    );
  });

  it('renders the localized Arabic surface in RTL under locale "ar"', async () => {
    const { container } = renderWithQuery(<LexReportsPage />, { locale: "ar" });

    expect(
      await screen.findByRole("heading", { name: reportsLabels.ar.pageTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "تصدير" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: reportsLabels.ar.reportRows.contracts,
      }),
    ).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });

  it("hydrates URL state into the active report request filters", async () => {
    searchParamsMock.value =
      "report=obligations&page=2&per_page=50&search=renewal&sort=due_date&order=asc&overdue=true&from=2026-06-01&to=2026-06-30";

    renderWithQuery(<LexReportsPage />);

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: reportsLabels.en.reportRows.obligations,
      }),
    ).toBeInTheDocument();
    expect(getObligationReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        per_page: 50,
        sort: "due_date",
        order: "asc",
        search: "renewal",
        filters: {
          overdue: "true",
          due_after: "2026-06-01",
          due_before: "2026-06-30",
        },
      }),
    );
  });

  it("surfaces the existing cases report with clickable drilldowns", async () => {
    searchParamsMock.value = "report=cases&from=2026-06-01&to=2026-06-30";
    renderWithQuery(<LexReportsPage />);

    expect(await screen.findByText(reportsLabels.en.reportRows.cases)).toBeInTheDocument();
    expect(
      screen.getAllByRole("link").some((link) => link.getAttribute("href")?.startsWith("/lex/cases")),
    ).toBe(true);
    expect(getCaseReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-06-01", to: "2026-06-30" }),
    );
  });

  it("renders privacy-safe investigation rows and direct record links", async () => {
    searchParamsMock.value = "report=investigations&status=in_progress";
    renderWithQuery(<LexReportsPage />);

    expect(await screen.findByText("INV-001")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "INV-001" })).toHaveAttribute(
      "href",
      "/lex/investigations/i-1",
    );
    expect(getInvestigationReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress" }),
    );
  });
});
