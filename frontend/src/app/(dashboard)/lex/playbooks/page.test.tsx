import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexPlaybooksPage from "@/app/(dashboard)/lex/playbooks/page";
import type { PaginatedResponse } from "@/types/api";
import type {
  LexClauseDeviationReport,
  LexClausePlaybook,
  LexContractRecord,
} from "@/types/suites";

const {
  createPlaybookMock,
  deletePlaybookMock,
  getContractClauseDeviationsMock,
  hasPermissionMock,
  listContractsMock,
  listPlaybooksMock,
  toastErrorMock,
  toastSuccessMock,
  updatePlaybookMock,
} = vi.hoisted(() => ({
  createPlaybookMock: vi.fn(),
  deletePlaybookMock: vi.fn(),
  getContractClauseDeviationsMock: vi.fn(),
  hasPermissionMock: vi.fn(
    (permission: string) =>
      permission === "lex:catalog:view" ||
      permission === "lex:document:view" ||
      permission === "lex:catalog:manage",
  ),
  listContractsMock: vi.fn(),
  listPlaybooksMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  updatePlaybookMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/lex/playbooks",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    hasPermission: hasPermissionMock,
    isHydrated: true,
    isAuthenticated: true,
    user: {
      id: "legal-user-1",
      tenant_id: "tenant-1",
      email: "fatima@example.com",
      first_name: "Fatima",
      last_name: "Reviewer",
      full_name: "Fatima Reviewer",
      status: "active",
      mfa_enabled: true,
      last_login_at: null,
      roles: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
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
        listPlaybooks: listPlaybooksMock,
        createPlaybook: createPlaybookMock,
        updatePlaybook: updatePlaybookMock,
        deletePlaybook: deletePlaybookMock,
        listContracts: listContractsMock,
        getContractClauseDeviations: getContractClauseDeviationsMock,
      },
    },
  };
});

function paginated<T>(data: T[]): PaginatedResponse<T> {
  return {
    data,
    meta: {
      page: 1,
      per_page: 25,
      total: data.length,
      total_pages: 1,
    },
  };
}

const playbook = {
  id: "playbook-1",
  tenant_id: "tenant-1",
  name: "Vendor Master Standard",
  description: "Standard clause expectations for vendor master agreements.",
  contract_type: "vendor",
  status: "active",
  clauses: [
    {
      clause_type: "limitation_of_liability",
      title: "Limitation of Liability",
      standard_text:
        "Aggregate liability capped at prior twelve months of fees.",
      required: true,
      risk_weight: 2,
      similarity_threshold: 0.8,
    },
  ],
  metadata: {},
  created_by: "legal-user-1",
  updated_by: "legal-user-1",
  created_at: "2026-05-01T08:00:00Z",
  updated_at: "2026-05-20T08:00:00Z",
} satisfies LexClausePlaybook;

const contract = {
  id: "contract-1",
  tenant_id: "tenant-1",
  title: "Acme Vendor Agreement",
  contract_number: "VND-001",
  type: "vendor",
  description: "Vendor agreement under review.",
  party_a_name: "Clario",
  party_b_name: "Acme",
  status: "legal_review",
  currency: "SAR",
  total_value: 250000,
  department: "Procurement",
  effective_date: null,
  expiry_date: null,
  signed_date: null,
  renewal_date: null,
  auto_renew: false,
  renewal_notice_days: null,
  owner_id: "legal-user-1",
  risk_level: "medium",
  analysis_status: "completed",
  tags: [],
  metadata: {},
  created_by: "legal-user-1",
  updated_by: "legal-user-1",
  created_at: "2026-05-01T08:00:00Z",
  updated_at: "2026-05-10T08:00:00Z",
} as unknown as LexContractRecord;

const deviationReport = {
  contract_id: "contract-1",
  playbook_id: "playbook-1",
  playbook_name: "Vendor Master Standard",
  contract_type: "vendor",
  matched: true,
  reason: "Matched on contract type vendor.",
  threshold: 0.8,
  total_standard_clauses: 3,
  missing_count: 1,
  altered_count: 1,
  extra_count: 0,
  compliance_score: 0.66,
  deviations: [
    {
      kind: "missing",
      clause_type: "indemnification",
      title: "Indemnification",
      required: true,
      similarity: null,
      threshold: 0.8,
      risk_weight: 3,
      severity: "high",
      section_reference: null,
      expected_excerpt:
        "Each party shall indemnify the other against third-party claims.",
      actual_excerpt: "",
      message: "Required indemnification clause is missing from the contract.",
    },
    {
      kind: "altered",
      clause_type: "limitation_of_liability",
      title: "Limitation of Liability",
      required: true,
      similarity: 0.52,
      threshold: 0.8,
      risk_weight: 2,
      severity: "medium",
      section_reference: "Section 9.2",
      expected_excerpt:
        "Aggregate liability capped at prior twelve months of fees.",
      actual_excerpt:
        "Liability capped at total contract value with no time bound.",
      message: "Liability clause departs from the playbook standard.",
    },
  ],
  generated_at: "2026-06-14T10:00:00Z",
} satisfies LexClauseDeviationReport;

async function findCatalogTable() {
  const table = await screen.findByRole("table");
  await within(table).findByText(playbook.name);
  return table;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Full playbook persona: catalog/document view (route guard) + catalog:manage
  // (authoring) — RBAC §8.5/§13.
  hasPermissionMock.mockImplementation(
    (permission: string) =>
      permission === "lex:catalog:view" ||
      permission === "lex:document:view" ||
      permission === "lex:catalog:manage",
  );
  listPlaybooksMock.mockResolvedValue(paginated([playbook]));
  listContractsMock.mockResolvedValue(paginated([contract]));
  getContractClauseDeviationsMock.mockResolvedValue(deviationReport);
  createPlaybookMock.mockResolvedValue({
    ...playbook,
    id: "playbook-2",
    name: "New Playbook",
  });
  updatePlaybookMock.mockResolvedValue(playbook);
  deletePlaybookMock.mockResolvedValue(undefined);
});

describe("Lex clause playbooks page", () => {
  it("creates a playbook with the configured standard clause", async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexPlaybooksPage />);

    await findCatalogTable();

    await user.click(screen.getByRole("button", { name: /create playbook/i }));

    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Playbook name"),
      "NDA Standard",
    );
    await user.type(
      within(dialog).getByLabelText("Clause title"),
      "Confidentiality",
    );
    await user.type(
      within(dialog).getByLabelText("Standard text"),
      "Recipient shall protect confidential information for five years.",
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Create playbook" }),
    );

    await waitFor(() => {
      expect(createPlaybookMock).toHaveBeenCalledTimes(1);
    });
    const payload = createPlaybookMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "NDA Standard",
      contract_type: "vendor",
      status: "active",
    });
    expect(payload.clauses).toHaveLength(1);
    expect(payload.clauses[0]).toMatchObject({
      title: "Confidentiality",
      standard_text:
        "Recipient shall protect confidential information for five years.",
      required: true,
    });
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Playbook created.",
        expect.anything(),
      ),
    );
  });

  it("edits an existing playbook through updatePlaybook", async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexPlaybooksPage />);

    const catalog = await findCatalogTable();
    await user.click(
      within(catalog).getByRole("button", {
        name: "Edit Vendor Master Standard",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    const nameField = within(dialog).getByLabelText("Playbook name");
    await user.clear(nameField);
    await user.type(nameField, "Vendor Master Standard v2");

    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => {
      expect(updatePlaybookMock).toHaveBeenCalledWith(
        "playbook-1",
        expect.objectContaining({ name: "Vendor Master Standard v2" }),
      );
    });
    expect(createPlaybookMock).not.toHaveBeenCalled();
  });

  it("deletes a playbook after confirmation", async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexPlaybooksPage />);

    const catalog = await findCatalogTable();
    await user.click(
      within(catalog).getByRole("button", {
        name: "Delete Vendor Master Standard",
      }),
    );

    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(
      within(confirmDialog).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(deletePlaybookMock).toHaveBeenCalledWith("playbook-1");
    });
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Playbook deleted.",
        expect.anything(),
      ),
    );
  });

  it("renders a clause deviation report from getContractClauseDeviations", async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexPlaybooksPage />);

    await findCatalogTable();

    await user.click(
      screen.getByRole("button", { name: /run deviation check/i }),
    );

    await waitFor(() => {
      expect(getContractClauseDeviationsMock).toHaveBeenCalledWith(
        "contract-1",
        undefined,
      );
    });

    expect(
      await screen.findByText("Matched on contract type vendor."),
    ).toBeInTheDocument();
    expect(screen.getByText("66%")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Required indemnification clause is missing from the contract.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Liability clause departs from the playbook standard."),
    ).toBeInTheDocument();
  });

  it("hides create, edit, and delete actions without catalog:manage", async () => {
    // Grant catalog:view (route guard) but deny catalog:manage (authoring) — §13.
    hasPermissionMock.mockImplementation(
      (permission: string) => permission === "lex:catalog:view",
    );
    renderWithQuery(<LexPlaybooksPage />);

    const catalog = await findCatalogTable();
    expect(
      screen.queryByRole("button", { name: /create playbook/i }),
    ).not.toBeInTheDocument();
    expect(
      within(catalog).queryAllByRole("button", {
        name: "Edit Vendor Master Standard",
      }),
    ).toHaveLength(0);
    expect(
      within(catalog).queryAllByRole("button", {
        name: "Delete Vendor Master Standard",
      }),
    ).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Edit Vendor Master Standard" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete Vendor Master Standard" }),
    ).not.toBeInTheDocument();
  });

  it('renders the localized Arabic playbooks surface in RTL under locale "ar"', async () => {
    const { container } = renderWithQuery(<LexPlaybooksPage />, {
      locale: "ar",
    });

    expect(
      await screen.findByRole("heading", { name: "أدلة البنود الإرشادية" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /إنشاء دليل إرشادي/ }),
    ).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });
});
