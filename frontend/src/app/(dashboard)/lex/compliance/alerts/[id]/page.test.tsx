import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexComplianceAlertDetailPage from "./page";
import type { LexComplianceAlert } from "@/types/suites";

const { getComplianceAlertMock, hasPermissionMock, pushMock } = vi.hoisted(
  () => ({
    getComplianceAlertMock: vi.fn(),
    hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
    pushMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "alert-123" }),
  usePathname: () => "/lex/compliance/alerts/alert-123",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
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
        getComplianceAlert: getComplianceAlertMock,
      },
    },
  };
});

const alert = {
  id: "alert-123",
  tenant_id: "tenant-1",
  title: "Missing data-processing addendum",
  description: "Counterparty contract lacks a DPA.",
  severity: "high",
  status: "open",
  evidence: { clause: "DPA", requirement: "data processing terms" },
  created_at: "2026-06-02T09:00:00Z",
  updated_at: "2026-06-02T09:00:00Z",
} as LexComplianceAlert;

describe("LexComplianceAlertDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockReturnValue(true);
    getComplianceAlertMock.mockResolvedValue(alert);
  });

  it("loads the compliance alert deep link and renders alert detail context", async () => {
    renderWithQuery(<LexComplianceAlertDetailPage />);

    expect(await screen.findByText(alert.title)).toBeInTheDocument();
    expect(screen.getByText(alert.description)).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(getComplianceAlertMock).toHaveBeenCalledWith("alert-123");
  });
});
