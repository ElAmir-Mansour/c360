import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexCompliancePage from "./page";
import { complianceLabels, resolveComplianceLabels } from "./_lib/compliance-labels";
import type { PaginatedResponse } from "@/types/api";
import type {
  LexComplianceAlert,
  LexComplianceDashboard,
  LexComplianceRule,
} from "@/types/suites";

const {
  fetchSuitePaginatedMock,
  getComplianceDashboardMock,
  listComplianceRulesMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  fetchSuitePaginatedMock: vi.fn(),
  getComplianceDashboardMock: vi.fn(),
  listComplianceRulesMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/lex/compliance",
  useSearchParams: () => new URLSearchParams(),
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

vi.mock("@/lib/suite-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/suite-api")>("@/lib/suite-api");
  return {
    ...actual,
    fetchSuitePaginated: fetchSuitePaginatedMock,
  };
});

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
        getComplianceDashboard: getComplianceDashboardMock,
        listComplianceRules: listComplianceRulesMock,
      },
    },
  };
});

function paginated<T>(data: T[]): PaginatedResponse<T> {
  return {
    data,
    meta: { page: 1, per_page: 25, total: data.length, total_pages: 1 },
  };
}

const rule = {
  id: "rule-1",
  tenant_id: "tenant-1",
  name: "30-day expiry warning",
  description: "Warn when contracts expire within 30 days.",
  rule_type: "expiry_warning",
  severity: "high",
  config: {},
  contract_types: [],
  enabled: true,
  created_by: "u-1",
  created_at: "2026-06-01T09:00:00Z",
  updated_at: "2026-06-02T09:00:00Z",
} as LexComplianceRule;

const alert = {
  id: "alert-1",
  tenant_id: "tenant-1",
  title: "Missing data-processing addendum",
  description: "Counterparty contract lacks a DPA.",
  severity: "high",
  status: "open",
  evidence: {},
  created_at: "2026-06-02T09:00:00Z",
  updated_at: "2026-06-02T09:00:00Z",
} as LexComplianceAlert;

const dashboard = {
  rules_by_type: { expiry_warning: 1 },
  alerts_by_status: { open: 1 },
  alerts_by_severity: { high: 1 },
  open_alerts: 1,
  resolved_alerts: 0,
  contracts_in_scope: 5,
  compliance_score: 87,
  calculated_at: "2026-06-02T09:00:00Z",
} as LexComplianceDashboard;

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockReturnValue(true);
  getComplianceDashboardMock.mockResolvedValue(dashboard);
  listComplianceRulesMock.mockResolvedValue(paginated([rule]));
  fetchSuitePaginatedMock.mockResolvedValue(paginated([alert]));
});

describe("LexCompliancePage", () => {
  it("mounts with the English surface and renders the rule library + new rule action", async () => {
    renderWithQuery(<LexCompliancePage />);

    expect(
      await screen.findByRole("button", {
        name: complianceLabels.en.actions.newRule,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: complianceLabels.en.pageTitle }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(complianceLabels.en.ruleLibrary.title),
    ).toBeInTheDocument();
    expect(await screen.findByText(rule.name)).toBeInTheDocument();
  });

  it("hides authoring controls without catalog:manage (auditor read-only)", async () => {
    // Auditor persona: holds lex:audit:read (route guard) but no catalog:manage,
    // so the page renders read-only with no mutation controls — RBAC §6/§21.4.
    hasPermissionMock.mockImplementation(
      (permission) => permission === "lex:audit:read",
    );
    renderWithQuery(<LexCompliancePage />);

    await screen.findByRole("heading", { name: complianceLabels.en.pageTitle });
    expect(
      screen.queryByRole("button", {
        name: complianceLabels.en.actions.newRule,
      }),
    ).not.toBeInTheDocument();
  });

  it('renders the localized Arabic surface in RTL under locale "ar"', async () => {
    const ar = resolveComplianceLabels("ar");
    const { container } = renderWithQuery(<LexCompliancePage />, {
      locale: "ar",
    });

    // The new-rule action only appears in the loaded state, so wait for it.
    expect(
      await screen.findByRole("button", {
        name: ar.actions.newRule,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: ar.pageTitle }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(ar.ruleLibrary.title),
    ).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });
});
