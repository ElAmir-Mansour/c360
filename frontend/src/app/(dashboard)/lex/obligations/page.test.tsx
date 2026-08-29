import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexObligationsPage from "./page";
import { obligationsLabels } from "./_lib/obligations-labels";
import type { PaginatedResponse } from "@/types/api";
import type { LexObligation } from "@/types/suites";

const {
  listObligationsMock,
  getContractRenewalWarningsMock,
  getObligationReminderPlanMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  listObligationsMock: vi.fn(),
  getContractRenewalWarningsMock: vi.fn(),
  getObligationReminderPlanMock: vi.fn(),
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
  usePathname: () => "/lex/obligations",
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
        listObligations: listObligationsMock,
        getContractRenewalWarnings: getContractRenewalWarningsMock,
        getObligationReminderPlan: getObligationReminderPlanMock,
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

const obligation = {
  id: "ob-1",
  tenant_id: "tenant-1",
  title: "Submit insurance certificate",
  description: "Counterparty must provide evidence before renewal.",
  type: "compliance",
  status: "open",
  priority: "high",
  contract_id: "contract-1",
  contract_title: "Master services agreement",
  owner_user_id: "u-1",
  owner_name: "Legal Owner",
  due_date: "2026-07-01T09:00:00Z",
  reminder_enabled: true,
  reminder_lead_days: [30, 7, 1],
  escalation_enabled: false,
  escalation_lead_days: [],
  tags: ["renewal"],
  metadata: {},
  created_by: "u-1",
  created_at: "2026-06-01T09:00:00Z",
  updated_at: "2026-06-02T09:00:00Z",
  days_until_due: 15,
} as LexObligation;

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockReturnValue(true);
  listObligationsMock.mockResolvedValue(paginated([obligation]));
  getContractRenewalWarningsMock.mockResolvedValue({
    tenant_id: "tenant-1",
    generated_at: "2026-06-02T09:00:00Z",
    urgent: 0,
    warning: 0,
    items: [],
  });
  getObligationReminderPlanMock.mockResolvedValue({
    as_of: "2026-06-02T09:00:00Z",
    horizon_days: 30,
    total: 0,
    events: [],
  });
});

describe("LexObligationsPage", () => {
  it("mounts with the English surface and renders the create action", async () => {
    renderWithQuery(<LexObligationsPage />);

    expect(
      await screen.findByRole("heading", {
        name: obligationsLabels.en.pageTitle,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: obligationsLabels.en.actions.newObligation,
      }),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText(obligation.title)).length,
    ).toBeGreaterThan(0);
  });

  it("hides authoring controls without contract:edit", async () => {
    // Grant contract:view (route guard) but deny contract:edit — RBAC §9.
    hasPermissionMock.mockImplementation(
      (permission) => permission === "lex:contract:view",
    );
    renderWithQuery(<LexObligationsPage />);

    await screen.findByRole("heading", {
      name: obligationsLabels.en.pageTitle,
    });
    expect(
      screen.queryByRole("button", {
        name: obligationsLabels.en.actions.newObligation,
      }),
    ).not.toBeInTheDocument();
  });

  it('renders the localized Arabic surface in RTL under locale "ar"', async () => {
    const { container } = renderWithQuery(<LexObligationsPage />, {
      locale: "ar",
    });

    expect(
      await screen.findByRole("heading", {
        name: obligationsLabels.ar.pageTitle,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: obligationsLabels.ar.actions.newObligation,
      }),
    ).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });
});
