import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexMattersPage from "@/app/(dashboard)/lex/matters/page";
import { resolveMatterLabels } from "@/app/(dashboard)/lex/matters/_components/labels";
import type { LexMatter, UserDirectoryEntry } from "@/types/suites";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const MATTER_ID = "matter-1";

const {
  listMattersMock,
  createMatterMock,
  checkMatterConflictMock,
  getMatterReportMock,
  usersListMock,
  showApiErrorMock,
  showSuccessMock,
} = vi.hoisted(() => ({
  listMattersMock: vi.fn(),
  createMatterMock: vi.fn(),
  checkMatterConflictMock: vi.fn(),
  getMatterReportMock: vi.fn(),
  usersListMock: vi.fn(),
  showApiErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/lex/matters",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: OWNER_ID },
  }),
}));

vi.mock("@/lib/toast", () => ({
  showSuccess: showSuccessMock,
  showApiError: showApiErrorMock,
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
      users: { ...actual.enterpriseApi.users, list: usersListMock },
      lex: {
        ...actual.enterpriseApi.lex,
        listMatters: listMattersMock,
        createMatter: createMatterMock,
        checkMatterConflict: checkMatterConflictMock,
        getMatterReport: getMatterReportMock,
      },
    },
  };
});

const directoryUsers: UserDirectoryEntry[] = [
  {
    id: OWNER_ID,
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    status: "active",
    roles: [],
  },
];

const matterRow: LexMatter = {
  id: MATTER_ID,
  tenant_id: "tenant-1",
  matter_number: "LEX-M-2026-001",
  title: "Vendor termination dispute",
  description: "Dispute over early termination clause.",
  type: "dispute",
  status: "open",
  priority: "high",
  owner_user_id: OWNER_ID,
  owner_name: "Ada Lovelace",
  requester_user_id: null,
  requester_name: "Procurement Lead",
  department: "Procurement",
  opened_at: "2026-05-01T09:00:00Z",
  due_date: "2026-07-01T09:00:00Z",
  closed_at: null,
  contracts: [],
  tags: ["dispute"],
  metadata: {},
  created_by: OWNER_ID,
  created_at: "2026-05-01T09:00:00Z",
  updated_at: "2026-05-10T09:00:00Z",
};

const createdMatter: LexMatter = {
  ...matterRow,
  id: "matter-2",
  title: "New advisory matter",
  type: "advisory",
  status: "intake",
  priority: "medium",
};

beforeEach(() => {
  listMattersMock.mockReset();
  createMatterMock.mockReset();
  checkMatterConflictMock.mockReset();
  getMatterReportMock.mockReset();
  usersListMock.mockReset();
  showApiErrorMock.mockReset();
  showSuccessMock.mockReset();

  listMattersMock.mockResolvedValue({
    data: [matterRow],
    meta: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  });
  createMatterMock.mockResolvedValue(createdMatter);
  getMatterReportMock.mockResolvedValue({
    generated_at: "2026-05-10T09:00:00Z",
    total: 1,
    filters: {},
    matters: [],
    by_status: { open: 1 },
    by_type: { dispute: 1 },
    by_priority: { high: 1 },
  });
  usersListMock.mockResolvedValue({
    data: directoryUsers,
    meta: {
      page: 1,
      per_page: 200,
      total: directoryUsers.length,
      total_pages: 1,
    },
  });
});

describe("Lex matters list", () => {
  it("renders matters and creates a matter with the correct payload", async () => {
    const user = userEvent.setup();

    renderWithQuery(<LexMattersPage />);

    expect(
      await screen.findAllByText("Vendor termination dispute"),
    ).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /New Matter/i }));

    const dialog = await screen.findByRole("dialog", { name: "Create Matter" });

    await user.type(
      within(dialog).getByPlaceholderText("Vendor termination dispute"),
      "New advisory matter",
    );

    // Resolve the owner select once the directory has loaded.
    const ownerTrigger = within(dialog).getByRole("combobox", {
      name: "Owner",
    });
    await waitFor(() => expect(ownerTrigger).not.toBeDisabled());
    await user.click(ownerTrigger);
    await user.click(
      await screen.findByRole("option", { name: "Ada Lovelace" }),
    );

    const submitButton = within(dialog).getByRole("button", {
      name: "Create matter",
    });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await waitFor(() => {
      expect(createMatterMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "New advisory matter",
          owner_user_id: OWNER_ID,
          owner_name: "Ada Lovelace",
          status: "intake",
          priority: "medium",
          type: "general",
        }),
      );
    });
    expect(showSuccessMock).toHaveBeenCalledWith("Matter created.");
  }, 60000);

  it("renders the Arabic/RTL surface under the ar locale", async () => {
    const arLabels = resolveMatterLabels("ar");
    const { container } = renderWithQuery(<LexMattersPage />, { locale: "ar" });

    expect(
      await screen.findByText(arLabels.list.title),
    ).toBeInTheDocument();
    expect(
      screen.getByText(arLabels.intake.title),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(arLabels.conflict.title),
    ).not.toHaveLength(0);
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
