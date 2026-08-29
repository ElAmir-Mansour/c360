import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/utils/render-with-query";
import LexDraftingPage from "@/app/(dashboard)/lex/drafting/page";
import type {
  LexDraftingClauseRewrite,
  LexDraftingContractDraft,
  LexDraftingContractSummary,
  LexDraftingFallbackSet,
  LexDraftingGeneratedClause,
  LexDraftingGlossaryResult,
  LexDraftingObligationQaReview,
  LexDraftingRfpResponse,
  LexDraftingTranslationResult,
} from "@/types/suites";

/**
 * Co-located coverage for the AI drafting workspace. Each surfaced drafting op
 * is exercised through its tab: the form fires the REAL client fn with the
 * mapped payload and the governed result renders. A final case asserts the
 * surface is gated behind `lex:write`.
 */

const mocks = vi.hoisted(() => ({
  draftContractMock: vi.fn(),
  rewriteClauseMock: vi.fn(),
  suggestClauseFallbacksMock: vi.fn(),
  translateTextMock: vi.fn(),
  summarizeContractMock: vi.fn(),
  generateGlossaryMock: vi.fn(),
  generateRfpResponseMock: vi.fn(),
  reviewObligationExtractionMock: vi.fn(),
  generateClauseStreamMock: vi.fn(),
  routerReplaceMock: vi.fn(),
}));

const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn<(permission: string) => boolean>(() => true),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mocks.routerReplaceMock,
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/lex/drafting",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    hasPermission: hasPermissionMock,
    isHydrated: true,
    isAuthenticated: true,
    user: { id: "legal-user-1" },
  }),
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
        drafting: {
          ...actual.enterpriseApi.lex.drafting,
          draftContract: mocks.draftContractMock,
          rewriteClause: mocks.rewriteClauseMock,
          suggestClauseFallbacks: mocks.suggestClauseFallbacksMock,
          translateText: mocks.translateTextMock,
          summarizeContract: mocks.summarizeContractMock,
          generateGlossary: mocks.generateGlossaryMock,
          generateRfpResponse: mocks.generateRfpResponseMock,
          reviewObligationExtraction: mocks.reviewObligationExtractionMock,
          generateClauseStream: mocks.generateClauseStreamMock,
        },
      },
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockReturnValue(true);
});

describe("Lex AI drafting workspace", () => {
  it("drafts a contract from deal terms and renders the governed sections", async () => {
    const user = userEvent.setup();
    const draft: LexDraftingContractDraft = {
      title: "Master Services Agreement",
      summary: "Two-year managed services engagement.",
      sections: [
        {
          heading: "Scope of Services",
          body: "Supplier delivers managed cloud operations.",
        },
      ],
      open_items: ["Confirm data residency region"],
      language: "en",
    };
    mocks.draftContractMock.mockResolvedValue(draft);

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole("tab", { name: /draft contract/i }));
    await user.click(screen.getByRole("button", { name: /^draft contract$/i }));

    await waitFor(() => {
      expect(mocks.draftContractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contract_type: "service_agreement",
          language: "en",
          deal_terms: expect.objectContaining({
            customer_name: "Watheeq Cloud LLC",
          }),
        }),
      );
    });

    expect(await screen.findByText("Scope of Services")).toBeInTheDocument();
    expect(
      screen.getByText("Confirm data residency region"),
    ).toBeInTheDocument();
  });

  it("does not crash the route when a legacy contract response has null sections", async () => {
    const user = userEvent.setup();
    mocks.draftContractMock.mockResolvedValue({
      title: "Master Services Agreement",
      summary: "The provider returned no structured sections.",
      sections: null,
      open_items: null,
      language: "en",
    } as unknown as LexDraftingContractDraft);

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole("tab", { name: /draft contract/i }));
    await user.click(screen.getByRole("button", { name: /^draft contract$/i }));

    expect((await screen.findAllByText("Master Services Agreement")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Couldn’t load Lex")).not.toBeInTheDocument();
  });

  it("rewrites a clause and renders the change log", async () => {
    const user = userEvent.setup();
    const rewrite: LexDraftingClauseRewrite = {
      rewritten_text:
        "Liability is capped at fees paid in the prior twelve months.",
      changes: [
        { summary: "Tightened cap reference", reason: "Aligns with policy." },
      ],
      risk_shift: "lower",
      residual_risks: ["Carve-outs remain uncapped"],
    };
    mocks.rewriteClauseMock.mockResolvedValue(rewrite);

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole("tab", { name: /rewrite clause/i }));
    await user.type(
      screen.getByLabelText(/clause text/i),
      "Supplier shall have unlimited liability under this agreement.",
    );
    await user.click(screen.getByRole("button", { name: /^rewrite clause$/i }));

    await waitFor(() => {
      expect(mocks.rewriteClauseMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Supplier shall have unlimited liability under this agreement.",
          language: "en",
        }),
      );
    });

    // The rewrite renders as a split redline (original vs rewritten), so the
    // rewritten text is broken into word-level diff segments rather than a
    // single text node. Assert the revised column reconstructs the full text.
    // The rewrite renders as a split redline (original vs rewritten), so the
    // rewritten text is broken into word-level diff segments, each prefixed with
    // a screen-reader-only "inserted:" hint. Strip those hints and confirm the
    // diff region reconstructs the full revised text.
    const changeSummary = await screen.findByText("Tightened cap reference");
    const resultRegion = changeSummary.closest("div.space-y-5");
    await waitFor(() => {
      const normalized = (resultRegion?.textContent ?? "").replace(
        /(inserted|deleted): /g,
        "",
      );
      expect(normalized).toContain(
        "Liability is capped at fees paid in the prior twelve months.",
      );
    });
  });

  it("suggests clause fallbacks and renders the ladder", async () => {
    const user = userEvent.setup();
    const fallbacks: LexDraftingFallbackSet = {
      fallbacks: [
        {
          label: "Mutual cap",
          text: "Each party caps liability at annual fees.",
          concession_level: "moderate",
          when_to_use: "When the counterparty rejects an uncapped position.",
        },
      ],
    };
    mocks.suggestClauseFallbacksMock.mockResolvedValue(fallbacks);

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole("tab", { name: /fallbacks/i }));
    await user.type(
      screen.getByLabelText(/clause text/i),
      "Supplier accepts unlimited liability for all claims.",
    );
    await user.click(
      screen.getByRole("button", { name: /suggest fallbacks/i }),
    );

    await waitFor(() => {
      expect(mocks.suggestClauseFallbacksMock).toHaveBeenCalledWith(
        expect.objectContaining({
          clause_text: "Supplier accepts unlimited liability for all claims.",
          count: 3,
          language: "en",
        }),
      );
    });

    expect(await screen.findByText("Mutual cap")).toBeInTheDocument();
    expect(
      screen.getByText("Each party caps liability at annual fees."),
    ).toBeInTheDocument();
  });

  it("translates text and renders the equivalence assessment", async () => {
    const user = userEvent.setup();
    const translation: LexDraftingTranslationResult = {
      translation: "تلتزم الجهة المورّدة بحماية البيانات.",
      equivalence: "equivalent",
      notes: ["Maintains the obligation owner."],
      source_lang: "en",
      target_lang: "ar",
    };
    mocks.translateTextMock.mockResolvedValue(translation);

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole("tab", { name: /translate/i }));
    await user.type(
      screen.getByLabelText(/source text/i),
      "Supplier shall protect data.",
    );
    await user.click(screen.getByRole("button", { name: /^translate$/i }));

    await waitFor(() => {
      expect(mocks.translateTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Supplier shall protect data.",
          source_lang: "en",
          target_lang: "ar",
        }),
      );
    });

    expect(
      await screen.findByText("تلتزم الجهة المورّدة بحماية البيانات."),
    ).toBeInTheDocument();
    expect(screen.getByText(/equivalent/i)).toBeInTheDocument();
  });

  it("summarizes a contract and renders the executive summary and key terms", async () => {
    const user = userEvent.setup();
    const summary: LexDraftingContractSummary = {
      executive_summary:
        "A two-year managed services agreement with a liability cap.",
      key_terms: [{ label: "Term", value: "24 months" }],
      obligations: ["Monthly uptime reporting"],
      risks: ["Uncapped confidentiality breaches"],
      renewal_notes: "Auto-renews for one year unless cancelled.",
    };
    mocks.summarizeContractMock.mockResolvedValue(summary);

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole("tab", { name: /summarize/i }));
    await user.type(
      screen.getByLabelText(/contract text/i),
      "This Master Services Agreement...",
    );
    await user.click(screen.getByRole("button", { name: /^summarize$/i }));

    await waitFor(() => {
      expect(mocks.summarizeContractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "This Master Services Agreement...",
          contract_type: "service_agreement",
          language: "en",
        }),
      );
    });

    expect(
      await screen.findByText(
        "A two-year managed services agreement with a liability cap.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("24 months")).toBeInTheDocument();
  });

  it("generates a glossary and renders defined terms", async () => {
    const user = userEvent.setup();
    const glossary: LexDraftingGlossaryResult = {
      glossary: [
        {
          term: "Confidential Information",
          definition: "Non-public information disclosed.",
        },
      ],
      inconsistencies: [
        { term: "Affiliate", issue: "Defined twice with different scope." },
      ],
    };
    mocks.generateGlossaryMock.mockResolvedValue(glossary);

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole("tab", { name: /glossary/i }));
    await user.type(
      screen.getByLabelText(/contract text/i),
      "Confidential Information means...",
    );
    await user.click(
      screen.getByRole("button", { name: /generate glossary/i }),
    );

    await waitFor(() => {
      expect(mocks.generateGlossaryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Confidential Information means...",
          language: "en",
        }),
      );
    });

    expect(
      await screen.findByText("Confidential Information"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Defined twice with different scope."),
    ).toBeInTheDocument();
  });

  it("generates an RFP response and renders per-requirement answers", async () => {
    const user = userEvent.setup();
    const rfp: LexDraftingRfpResponse = {
      sections: [
        {
          requirement: "Data must be hosted in KSA.",
          response: "All data is hosted in Riyadh region.",
        },
      ],
      summary: "Fully compliant proposal.",
      gaps: ["Pending SOC 2 Type II report"],
      language: "en",
    };
    mocks.generateRfpResponseMock.mockResolvedValue(rfp);

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole("tab", { name: /rfp response/i }));
    await user.type(
      screen.getByLabelText(/^requirements$/i),
      "Data must be hosted in KSA.",
    );
    await user.click(
      screen.getByRole("button", { name: /draft rfp response/i }),
    );

    await waitFor(() => {
      expect(mocks.generateRfpResponseMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requirements: "Data must be hosted in KSA.",
          language: "en",
        }),
      );
    });

    expect(
      await screen.findByText("All data is hosted in Riyadh region."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pending SOC 2 Type II report"),
    ).toBeInTheDocument();
  });

  it("reviews extracted obligations and renders issues with confidence", async () => {
    const user = userEvent.setup();
    const review: LexDraftingObligationQaReview = {
      issues: [
        {
          obligation_index: 0,
          severity: "warning",
          issue: "Due date is ambiguous.",
          suggestion: "Pin the report to the 5th business day.",
        },
      ],
      overall_confidence: 0.82,
      missing_obligations: ["Insurance certificate delivery"],
    };
    mocks.reviewObligationExtractionMock.mockResolvedValue(review);

    renderWithQuery(<LexDraftingPage />);

    await user.click(screen.getByRole("tab", { name: /obligation qa/i }));
    await user.type(
      screen.getByLabelText(/contract text/i),
      "Supplier provides monthly uptime reports.",
    );
    await user.click(screen.getByRole("button", { name: /run qa review/i }));

    await waitFor(() => {
      expect(mocks.reviewObligationExtractionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contract_text: "Supplier provides monthly uptime reports.",
          obligations: expect.arrayContaining([
            expect.objectContaining({ owner: "Supplier" }),
          ]),
        }),
      );
    });

    expect(
      await screen.findByText("Due date is ambiguous."),
    ).toBeInTheDocument();
    expect(screen.getByText("82.0%")).toBeInTheDocument();
  });

  it("generates a clause and renders the governed draft with risk posture", async () => {
    const user = userEvent.setup();
    const clause: LexDraftingGeneratedClause = {
      title: "Limitation of Liability",
      clause_type: "limitation_of_liability",
      text: "Supplier liability is limited to direct damages.",
      rationale: "Balanced cap aligned to the deal profile.",
      risk_level: "medium",
      assumptions: ["Annual subscription agreement"],
      language: "en",
    };
    mocks.generateClauseStreamMock.mockImplementationOnce(async (_payload, handlers) => {
      handlers.onClause(clause);
    });

    renderWithQuery(<LexDraftingPage />);

    await user.type(
      screen.getByLabelText(/drafting intent/i),
      "Limit supplier liability to direct damages with a negotiated cap.",
    );
    await user.click(screen.getByRole("button", { name: /generate clause/i }));

    await waitFor(() => {
      expect(mocks.generateClauseStreamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          intent:
            "Limit supplier liability to direct damages with a negotiated cap.",
          clause_type: "limitation_of_liability",
          contract_type: "service_agreement",
          language: "en",
        }),
        expect.objectContaining({
          onClause: expect.any(Function),
          onError: expect.any(Function),
          onToken: expect.any(Function),
        }),
      );
    });

    expect(
      await screen.findByText(
        "Supplier liability is limited to direct damages.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Annual subscription agreement"),
    ).toBeInTheDocument();
  });

  it("gates the workspace behind lex:write and redirects unauthorized users", async () => {
    hasPermissionMock.mockReturnValue(false);

    renderWithQuery(<LexDraftingPage />);

    await waitFor(() => {
      expect(mocks.routerReplaceMock).toHaveBeenCalledWith("/dashboard");
    });

    expect(
      screen.queryByRole("tab", { name: /draft contract/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the localized Arabic drafting workspace in RTL under locale "ar"', async () => {
    const { container } = renderWithQuery(<LexDraftingPage />, {
      locale: "ar",
    });

    expect(
      await screen.findByRole("heading", { name: "الصياغة بالذكاء الاصطناعي" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /صياغة عقد/ })).toBeInTheDocument();
    expect(container.querySelector('div[dir="rtl"][lang="ar"]')).not.toBeNull();
  });
});
