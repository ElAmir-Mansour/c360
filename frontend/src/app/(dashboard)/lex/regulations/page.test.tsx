import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexRegulationsPage from "./page";
import { RegulationFormDialog } from "./_components/regulation-form-dialog";
import { RegulationSearchPanel } from "./_components/regulation-search-panel";
import { RegulationClauseLinksDialog } from "./_components/regulation-clause-links-dialog";
import type { PaginatedResponse } from "@/types/api";
import type {
  LexClauseLibraryEntry,
  LexRegulation,
  LexRegulationClauseReference,
  LexRegulationSearchResult,
} from "@/types/suites";

const {
  createRegulationMock,
  updateRegulationMock,
  deleteRegulationMock,
  decideRegulationGovernanceMock,
  listRegulationsMock,
  searchRegulationsMock,
  getRegulationMock,
  linkRegulationClauseMock,
  unlinkRegulationClauseMock,
  listClauseLibraryMock,
  hasPermissionMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  createRegulationMock: vi.fn(),
  updateRegulationMock: vi.fn(),
  deleteRegulationMock: vi.fn(),
  decideRegulationGovernanceMock: vi.fn(),
  listRegulationsMock: vi.fn(),
  searchRegulationsMock: vi.fn(),
  getRegulationMock: vi.fn(),
  linkRegulationClauseMock: vi.fn(),
  unlinkRegulationClauseMock: vi.fn(),
  listClauseLibraryMock: vi.fn(),
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/lex/regulations",
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
      email: "fatima@example.com",
      first_name: "Fatima",
      last_name: "Reviewer",
      full_name: "Fatima Reviewer",
    },
  }),
}));

vi.mock("@/lib/toast", () => ({
  showSuccess: toastSuccessMock,
  showError: toastErrorMock,
  showApiError: toastErrorMock,
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
        createRegulation: createRegulationMock,
        updateRegulation: updateRegulationMock,
        deleteRegulation: deleteRegulationMock,
        decideRegulationGovernance: decideRegulationGovernanceMock,
        listRegulations: listRegulationsMock,
        searchRegulations: searchRegulationsMock,
        getRegulation: getRegulationMock,
        linkRegulationClause: linkRegulationClauseMock,
        unlinkRegulationClause: unlinkRegulationClauseMock,
        listClauseLibrary: listClauseLibraryMock,
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

const reference: LexRegulationClauseReference = {
  id: "ref-1",
  tenant_id: "tenant-1",
  regulation_id: "reg-1",
  clause_id: "clause-1",
  reference_type: "implements",
  notes: "Implements PDPL data handling.",
  clause_code: "CL-CONF-001",
  clause_title_en: "Watheeq Confidentiality Clause",
  created_by: "legal-user-1",
  created_at: "2026-05-01T08:00:00Z",
};

const regulation: LexRegulation = {
  id: "reg-1",
  tenant_id: "tenant-1",
  code: "PDPL-2023",
  title_en: "Personal Data Protection Law",
  title_ar: "نظام حماية البيانات الشخصية",
  description_en: "Personal data protection controls.",
  description_ar: "",
  authority: "SDAIA",
  jurisdiction: "SA",
  regulation_type: "law",
  source: "official_gazette",
  effective_date: "2026-01-01T00:00:00Z",
  last_reviewed_at: null,
  status: "draft",
  version: 1,
  source_url: null,
  clause_references: [reference],
  compliance_rule_ids: [],
  tags: ["privacy"],
  metadata: {},
  created_by: "legal-user-1",
  updated_by: "legal-user-1",
  created_at: "2026-05-01T08:00:00Z",
  updated_at: "2026-05-20T08:00:00Z",
};

const searchResult: LexRegulationSearchResult = {
  item: regulation,
  score: 0.88,
  matched_fields: ["title_en", "authority"],
};

const clauseOption: LexClauseLibraryEntry = {
  id: "clause-2",
  tenant_id: "tenant-1",
  code: "CL-RET-002",
  clause_type: "data_protection",
  title_en: "Data Retention",
  title_ar: "",
  text_en: "Data shall be retained only as required.",
  text_ar: "",
  category: "privacy",
  jurisdiction: "SA",
  source: "internal_template",
  source_url: null,
  language: "en",
  status: "active",
  governance_status: "approved",
  version: 1,
  risk_level: "low",
  supersedes_id: null,
  deprecated_by_id: null,
  deprecated_at: null,
  replacement_clause_id: null,
  tags: [],
  metadata: {},
  created_by: "legal-user-1",
  updated_by: "legal-user-1",
  created_at: "2026-05-01T08:00:00Z",
  updated_at: "2026-05-20T08:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockReturnValue(true);
  listRegulationsMock.mockResolvedValue(paginated([regulation]));
  searchRegulationsMock.mockResolvedValue(paginated([searchResult]));
  getRegulationMock.mockResolvedValue(regulation);
  listClauseLibraryMock.mockResolvedValue(paginated([clauseOption]));
  createRegulationMock.mockResolvedValue(regulation);
  updateRegulationMock.mockResolvedValue(regulation);
  deleteRegulationMock.mockResolvedValue(undefined);
  decideRegulationGovernanceMock.mockResolvedValue({
    ...regulation,
    status: "active",
  });
  linkRegulationClauseMock.mockResolvedValue(reference);
  unlinkRegulationClauseMock.mockResolvedValue(undefined);
});

describe("RegulationFormDialog", () => {
  it("creates a regulation with bilingual content via createRegulation", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithQuery(
      <RegulationFormDialog open onOpenChange={vi.fn()} onSaved={onSaved} />,
    );

    await user.type(screen.getByLabelText("Code"), "PDPL-2024");
    await user.type(
      screen.getByLabelText("Title (English)"),
      "PDPL Implementing Regulations",
    );
    await user.type(
      screen.getByLabelText("Title (Arabic)"),
      "اللائحة التنفيذية",
    );

    await user.click(screen.getByRole("button", { name: "Create regulation" }));

    await waitFor(() => expect(createRegulationMock).toHaveBeenCalledTimes(1));
    expect(createRegulationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "PDPL-2024",
        title_en: "PDPL Implementing Regulations",
        title_ar: "اللائحة التنفيذية",
      }),
    );
    expect(updateRegulationMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("edits an existing regulation via updateRegulation with its id", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <RegulationFormDialog
        open
        regulation={regulation}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const titleInput = screen.getByLabelText("Title (English)");
    await user.clear(titleInput);
    await user.type(titleInput, "Personal Data Protection Law (Amended)");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateRegulationMock).toHaveBeenCalledTimes(1));
    expect(updateRegulationMock).toHaveBeenCalledWith(
      "reg-1",
      expect.objectContaining({
        title_en: "Personal Data Protection Law (Amended)",
      }),
    );
    expect(createRegulationMock).not.toHaveBeenCalled();
  });
});

describe("RegulationSearchPanel", () => {
  it("calls searchRegulations with the typed query and renders scored results", async () => {
    const user = userEvent.setup();
    renderWithQuery(<RegulationSearchPanel />);

    expect(
      screen.getByText(/enter a query above to search/i),
    ).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(/search regulations by title/i),
      "data protection",
    );

    await waitFor(() =>
      expect(searchRegulationsMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: "data protection", semantic: false }),
      ),
    );
    expect(
      await screen.findByText("Personal Data Protection Law"),
    ).toBeInTheDocument();
    expect(screen.getByText(/88%/)).toBeInTheDocument();
  });
});

describe("RegulationClauseLinksDialog", () => {
  it("links a clause to the regulation via linkRegulationClause", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <RegulationClauseLinksDialog
        open
        regulation={regulation}
        onOpenChange={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/implements pdpl data handling/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(listClauseLibraryMock).toHaveBeenCalled());

    const clauseCombobox = screen.getAllByRole("combobox")[0];
    await waitFor(() => expect(clauseCombobox).not.toBeDisabled());
    await user.click(clauseCombobox);
    await user.click(await screen.findByText(/CL-RET-002/));
    await user.click(screen.getByRole("button", { name: "Link clause" }));

    await waitFor(() =>
      expect(linkRegulationClauseMock).toHaveBeenCalledTimes(1),
    );
    expect(linkRegulationClauseMock).toHaveBeenCalledWith(
      "reg-1",
      expect.objectContaining({
        clause_id: "clause-2",
        reference_type: "implements",
      }),
    );
  });

  it("unlinks an existing clause reference via unlinkRegulationClause", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <RegulationClauseLinksDialog
        open
        regulation={regulation}
        onOpenChange={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    const unlinkButton = await screen.findByRole("button", {
      name: /unlink watheeq confidentiality clause/i,
    });
    await user.click(unlinkButton);

    await waitFor(() =>
      expect(unlinkRegulationClauseMock).toHaveBeenCalledWith("reg-1", {
        clause_id: "clause-1",
        reference_type: "implements",
      }),
    );
  });
});

describe("LexRegulationsPage authoring + governance", () => {
  it("deletes a regulation through the row action confirm dialog", async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexRegulationsPage />);

    await screen.findAllByText("Personal Data Protection Law");

    await user.click(screen.getAllByRole("button", { name: "Row actions" })[0]);
    await user.click(
      await screen.findByRole("menuitem", { name: /delete regulation/i }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteRegulationMock).toHaveBeenCalledWith("reg-1"),
    );
  });

  it("keeps the governance approval flow available alongside authoring", async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexRegulationsPage />);

    await screen.findAllByText("Personal Data Protection Law");

    await user.click(screen.getAllByRole("button", { name: "Row actions" })[0]);
    await user.click(
      await screen.findByRole("menuitem", { name: /approve governance/i }),
    );
    await user.type(
      screen.getByLabelText("Comment"),
      "Authority citation verified.",
    );
    await user.click(
      screen.getByRole("button", { name: "Approve Regulation" }),
    );

    await waitFor(() =>
      expect(decideRegulationGovernanceMock).toHaveBeenCalledWith(
        "reg-1",
        expect.objectContaining({
          decision: "approve",
          notes: "Authority citation verified.",
        }),
      ),
    );
  });

  it("hides authoring controls when the user lacks catalog:manage", async () => {
    // Grant catalog:view (route guard) but deny catalog:manage (authoring) — §13.
    hasPermissionMock.mockImplementation(
      (permission: string) => permission === "lex:catalog:view",
    );
    renderWithQuery(<LexRegulationsPage />);

    await screen.findAllByText("Personal Data Protection Law");

    expect(
      screen.queryByRole("button", { name: /new regulation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Row actions" }),
    ).not.toBeInTheDocument();
  });

  it('renders the localized Arabic regulation surface in RTL under locale "ar"', async () => {
    const { container } = renderWithQuery(<LexRegulationsPage />, {
      locale: "ar",
    });

    expect(
      await screen.findByRole("heading", { name: "مكتبة اللوائح" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "لائحة جديدة" }),
    ).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });
});
