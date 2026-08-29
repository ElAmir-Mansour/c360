import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexClauseLibraryPage from "./page";
import { ClauseFormDialog } from "./_components/clause-form-dialog";
import { ClauseSearchPanel } from "./_components/clause-search-panel";
import type { PaginatedResponse } from "@/types/api";
import type {
  LexClauseLibraryEntry,
  LexClauseLibrarySearchResult,
} from "@/types/suites";

const {
  createClauseLibraryEntryMock,
  updateClauseLibraryEntryMock,
  deleteClauseLibraryEntryMock,
  decideClauseLibraryGovernanceMock,
  listClauseLibraryMock,
  searchClauseLibraryMock,
  hasPermissionMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  createClauseLibraryEntryMock: vi.fn(),
  updateClauseLibraryEntryMock: vi.fn(),
  deleteClauseLibraryEntryMock: vi.fn(),
  decideClauseLibraryGovernanceMock: vi.fn(),
  listClauseLibraryMock: vi.fn(),
  searchClauseLibraryMock: vi.fn(),
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
  usePathname: () => "/lex/clause-library",
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
        createClauseLibraryEntry: createClauseLibraryEntryMock,
        updateClauseLibraryEntry: updateClauseLibraryEntryMock,
        deleteClauseLibraryEntry: deleteClauseLibraryEntryMock,
        decideClauseLibraryGovernance: decideClauseLibraryGovernanceMock,
        listClauseLibrary: listClauseLibraryMock,
        searchClauseLibrary: searchClauseLibraryMock,
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

const clause: LexClauseLibraryEntry = {
  id: "clause-1",
  tenant_id: "tenant-1",
  code: "CL-CONF-001",
  clause_type: "confidentiality",
  title_en: "Watheeq Confidentiality Clause",
  title_ar: "بند السرية",
  text_en:
    "Each party shall keep the other party confidential information secret.",
  text_ar: "",
  category: "confidentiality",
  jurisdiction: "SA",
  source: "internal_template",
  source_url: null,
  language: "bilingual",
  status: "draft",
  governance_status: "pending_review",
  version: 1,
  risk_level: "medium",
  supersedes_id: null,
  deprecated_by_id: null,
  deprecated_at: null,
  replacement_clause_id: null,
  tags: ["confidentiality"],
  metadata: {},
  created_by: "legal-user-1",
  updated_by: "legal-user-1",
  created_at: "2026-05-01T08:00:00Z",
  updated_at: "2026-05-20T08:00:00Z",
};

const searchResult: LexClauseLibrarySearchResult = {
  item: clause,
  score: 0.92,
  matched_fields: ["title_en", "text_en"],
};

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockReturnValue(true);
  listClauseLibraryMock.mockResolvedValue(paginated([clause]));
  searchClauseLibraryMock.mockResolvedValue(paginated([searchResult]));
  createClauseLibraryEntryMock.mockResolvedValue(clause);
  updateClauseLibraryEntryMock.mockResolvedValue(clause);
  deleteClauseLibraryEntryMock.mockResolvedValue(undefined);
  decideClauseLibraryGovernanceMock.mockResolvedValue({
    ...clause,
    governance_status: "approved",
  });
});

describe("ClauseFormDialog", () => {
  it("creates a clause-library entry with bilingual content via createClauseLibraryEntry", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithQuery(
      <ClauseFormDialog open onOpenChange={vi.fn()} onSaved={onSaved} />,
    );

    await user.type(screen.getByLabelText("Code"), "CL-NEW-009");
    await user.type(
      screen.getByLabelText("Title (English)"),
      "Mutual confidentiality",
    );
    await user.type(
      screen.getByLabelText("Title (Arabic)"),
      "السرية المتبادلة",
    );
    await user.type(
      screen.getByLabelText("Clause text (English)"),
      "Confidential information must remain secret.",
    );

    await user.click(screen.getByRole("button", { name: "Create clause" }));

    await waitFor(() =>
      expect(createClauseLibraryEntryMock).toHaveBeenCalledTimes(1),
    );
    expect(createClauseLibraryEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CL-NEW-009",
        title_en: "Mutual confidentiality",
        title_ar: "السرية المتبادلة",
        text_en: "Confidential information must remain secret.",
      }),
    );
    expect(updateClauseLibraryEntryMock).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("edits an existing clause via updateClauseLibraryEntry with its id", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <ClauseFormDialog
        open
        entry={clause}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const titleInput = screen.getByLabelText("Title (English)");
    await user.clear(titleInput);
    await user.type(titleInput, "Watheeq Confidentiality Clause v2");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateClauseLibraryEntryMock).toHaveBeenCalledTimes(1),
    );
    expect(updateClauseLibraryEntryMock).toHaveBeenCalledWith(
      "clause-1",
      expect.objectContaining({
        title_en: "Watheeq Confidentiality Clause v2",
      }),
    );
    expect(createClauseLibraryEntryMock).not.toHaveBeenCalled();
  });
});

describe("ClauseSearchPanel", () => {
  it("calls searchClauseLibrary with the typed query and renders scored results", async () => {
    const user = userEvent.setup();
    renderWithQuery(<ClauseSearchPanel />);

    expect(
      screen.getByText(/enter a query above to search/i),
    ).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(/search clauses by title/i),
      "confidentiality",
    );

    await waitFor(() =>
      expect(searchClauseLibraryMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: "confidentiality", semantic: false }),
      ),
    );
    expect(
      await screen.findByText("Watheeq Confidentiality Clause"),
    ).toBeInTheDocument();
    expect(screen.getByText(/92%/)).toBeInTheDocument();
  });
});

describe("LexClauseLibraryPage authoring + governance", () => {
  it("deletes a clause through the row action confirm dialog", async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexClauseLibraryPage />);

    await screen.findAllByText("Watheeq Confidentiality Clause");

    await user.click(screen.getAllByRole("button", { name: "Row actions" })[0]);
    await user.click(
      await screen.findByRole("menuitem", { name: /delete clause/i }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deleteClauseLibraryEntryMock).toHaveBeenCalledWith("clause-1"),
    );
  });

  it("keeps the governance approval flow available alongside authoring", async () => {
    const user = userEvent.setup();
    renderWithQuery(<LexClauseLibraryPage />);

    await screen.findAllByText("Watheeq Confidentiality Clause");

    await user.click(screen.getAllByRole("button", { name: "Row actions" })[0]);
    await user.click(
      await screen.findByRole("menuitem", { name: /approve governance/i }),
    );
    await user.type(
      screen.getByLabelText("Comment"),
      "Bilingual text verified.",
    );
    await user.click(screen.getByRole("button", { name: "Approve Clause" }));

    await waitFor(() =>
      expect(decideClauseLibraryGovernanceMock).toHaveBeenCalledWith(
        "clause-1",
        expect.objectContaining({
          decision: "approve",
          notes: "Bilingual text verified.",
        }),
      ),
    );
  });

  it("hides authoring controls when the user lacks catalog:manage", async () => {
    // Grant the view side of the route guard (catalog/contract view) but deny
    // the clause-authoring verb (lex:catalog:manage) — RBAC §9/§13.
    hasPermissionMock.mockImplementation(
      (permission: string) => permission !== "lex:catalog:manage",
    );
    renderWithQuery(<LexClauseLibraryPage />);

    await screen.findAllByText("Watheeq Confidentiality Clause");

    expect(
      screen.queryByRole("button", { name: /new clause/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Row actions" }),
    ).not.toBeInTheDocument();
  });

  it('renders the localized Arabic clause-library surface in RTL under locale "ar"', async () => {
    const { container } = renderWithQuery(<LexClauseLibraryPage />, {
      locale: "ar",
    });

    expect(
      await screen.findByRole("heading", { name: "مكتبة البنود" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "بند جديد" }),
    ).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });
});
