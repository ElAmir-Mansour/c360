import { afterEach, describe, expect, it, vi } from "vitest";

const {
  apiClientGetMock,
  apiClientDeleteMock,
  apiDeleteMock,
  apiGetMock,
  apiPatchMock,
  apiPostMock,
  apiPutMock,
  apiUploadMock,
} = vi.hoisted(() => ({
  apiClientGetMock: vi.fn(),
  apiClientDeleteMock: vi.fn(),
  apiDeleteMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPatchMock: vi.fn(),
  apiPostMock: vi.fn(),
  apiPutMock: vi.fn(),
  apiUploadMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  default: {
    get: apiClientGetMock,
    delete: apiClientDeleteMock,
  },
  apiDelete: apiDeleteMock,
  apiGet: apiGetMock,
  apiPatch: apiPatchMock,
  apiPost: apiPostMock,
  apiPut: apiPutMock,
  apiUpload: apiUploadMock,
}));

const { enterpriseApi } = await import("./api");

const nextWaveEditorMethodNames = [
  "listDocumentProviderEvents",
  "recordDocumentProviderEvent",
  "getDocumentGuestPortalStatus",
  "refreshDocumentGuestPortalStatus",
  "listDocumentAutomationTasks",
  "createDocumentAutomationTask",
  "updateDocumentAutomationTask",
  "listDocumentClauseAnchors",
  "extractDocumentClauseAnchors",
  "listDocumentRedlinePackages",
  "generateDocumentRedlinePackage",
  "getDocumentApprovalMatrix",
  "requestDocumentApproval",
  "getDocumentCompareWorkspace",
  "runDocumentCompare",
  "getDocumentCollaborationInbox",
  "markDocumentCollaborationInboxItemRead",
  "listDocumentPlaybookRuleLinks",
  "createDocumentPlaybookRuleLink",
  "listDocumentDefinedTermRepairs",
  "applyDocumentDefinedTermRepair",
  "listDocumentEvidenceBindings",
  "createDocumentEvidenceBinding",
  "getDocumentAIChangeSafety",
  "updateDocumentAIChangeSafety",
  "getDocumentOfflineRecoveryState",
  "saveDocumentOfflineRecoveryState",
  "getDocumentEditorAnalytics",
] as const;

type NextWaveEditorMethodName = (typeof nextWaveEditorMethodNames)[number];

type NextWaveEditorApi = {
  listDocumentProviderEvents: (id: string) => Promise<unknown>;
  recordDocumentProviderEvent: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  getDocumentGuestPortalStatus: (id: string) => Promise<unknown>;
  refreshDocumentGuestPortalStatus: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  listDocumentAutomationTasks: (id: string) => Promise<unknown>;
  createDocumentAutomationTask: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  updateDocumentAutomationTask: (
    id: string,
    taskId: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  listDocumentClauseAnchors: (id: string) => Promise<unknown>;
  extractDocumentClauseAnchors: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  listDocumentRedlinePackages: (id: string) => Promise<unknown>;
  generateDocumentRedlinePackage: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  getDocumentApprovalMatrix: (id: string) => Promise<unknown>;
  requestDocumentApproval: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  getDocumentCompareWorkspace: (id: string) => Promise<unknown>;
  runDocumentCompare: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  getDocumentCollaborationInbox: (id: string) => Promise<unknown>;
  markDocumentCollaborationInboxItemRead: (
    id: string,
    itemId: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  listDocumentPlaybookRuleLinks: (id: string) => Promise<unknown>;
  createDocumentPlaybookRuleLink: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  listDocumentDefinedTermRepairs: (id: string) => Promise<unknown>;
  applyDocumentDefinedTermRepair: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  listDocumentEvidenceBindings: (id: string) => Promise<unknown>;
  createDocumentEvidenceBinding: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  getDocumentAIChangeSafety: (id: string) => Promise<unknown>;
  updateDocumentAIChangeSafety: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  getDocumentOfflineRecoveryState: (id: string) => Promise<unknown>;
  saveDocumentOfflineRecoveryState: (
    id: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  getDocumentEditorAnalytics: (id: string) => Promise<unknown>;
};

function expectNextWaveEditorApi(): NextWaveEditorApi | null {
  const lexApi = enterpriseApi.lex as Record<string, unknown>;
  const missing = nextWaveEditorMethodNames.filter(
    (name) => typeof lexApi[name] !== "function",
  );
  expect(missing).toEqual([]);
  if (missing.length > 0) return null;
  return lexApi as unknown as NextWaveEditorApi;
}

const backendOnlyNextWaveEditorMethods = [
  "addDocumentGuestPortalComment",
  "restoreDocumentOfflineRecoveryState",
] as const;

describe("enterpriseApi.lex Watheeq first-class domains", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads assignment candidates from the tenant role directory", async () => {
    apiGetMock.mockResolvedValue([]);

    await enterpriseApi.users.listByRole("legal-advisor");

    expect(apiGetMock).toHaveBeenCalledWith(
      "/api/v1/roles/legal-advisor/users",
    );
  });

  it("requests an actor-scoped workflow queue for Awaiting me", async () => {
    apiGetMock.mockResolvedValue({
      data: [],
      meta: { page: 1, per_page: 50, total: 0, total_pages: 1 },
    });

    await enterpriseApi.lex.listMyWorkflows({ page: 1, per_page: 50 });

    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/lex/workflows", {
      page: 1,
      per_page: 50,
      sort: undefined,
      order: undefined,
      search: undefined,
      mine: true,
    });
  });

  it("constructs all Lex drafting routes under /api/v1/lex/drafting", async () => {
    apiPostMock.mockResolvedValue({ data: {} });
    apiPostMock
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: {
          title: "Master Services Agreement",
          sections: [{ heading: "Services", body: "Supplier provides the services." }],
          open_items: [],
        },
      });

    await enterpriseApi.lex.drafting.generateClause({
      intent: "Limit SaaS supplier liability to direct damages.",
      clause_type: "limitation_of_liability",
      contract_type: "service_agreement",
      language: "en",
      context: "Saudi enterprise subscription agreement.",
    });
    await enterpriseApi.lex.drafting.draftContract({
      contract_type: "service_agreement",
      deal_terms: { customer: "Watheeq Cloud LLC", value: 250000 },
      template_hint: "Managed cloud services.",
      language: "en",
    });
    await enterpriseApi.lex.drafting.rewriteClause({
      text: "Supplier is never liable for any damages.",
      target_tone: "formal",
      risk_posture: "balanced",
      instructions: "Keep a reasonable liability cap.",
      language: "en",
    });
    await enterpriseApi.lex.drafting.suggestClauseFallbacks({
      clause_text: "Customer may terminate for convenience at any time.",
      position: "preserve setup fee recovery",
      count: 3,
      language: "en",
    });
    await enterpriseApi.lex.drafting.translateText({
      text: "The parties agree to maintain confidentiality.",
      source_lang: "en",
      target_lang: "ar",
    });
    await enterpriseApi.lex.drafting.summarizeContract({
      text: "Long services agreement text.",
      contract_type: "service_agreement",
      language: "en",
    });
    await enterpriseApi.lex.drafting.generateGlossary({
      text: '"Services" means the managed cloud services.',
      language: "en",
    });
    await enterpriseApi.lex.drafting.assembleTemplate({
      sections: [
        {
          id: "intro",
          heading: "Agreement",
          body: "This agreement is between {{customer}} and {{supplier}}.",
        },
      ],
      variables: { customer: "Watheeq", supplier: "Clario360" },
    });
    await enterpriseApi.lex.drafting.generateRfpResponse({
      requirements: "Describe ISO 27001 controls.",
      company_profile: "Cloud compliance platform.",
      language: "en",
    });
    await enterpriseApi.lex.drafting.reviewObligationExtraction({
      contract_text: "Supplier shall deliver reports monthly.",
      obligations: [{ title: "Monthly reports", due: "monthly" }],
    });

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/drafting/clauses",
      {
        intent: "Limit SaaS supplier liability to direct damages.",
        clause_type: "limitation_of_liability",
        contract_type: "service_agreement",
        language: "en",
        context: "Saudi enterprise subscription agreement.",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/drafting/contracts",
      {
        contract_type: "service_agreement",
        deal_terms: { customer: "Watheeq Cloud LLC", value: 250000 },
        template_hint: "Managed cloud services.",
        language: "en",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/drafting/clauses/rewrite",
      {
        text: "Supplier is never liable for any damages.",
        target_tone: "formal",
        risk_posture: "balanced",
        instructions: "Keep a reasonable liability cap.",
        language: "en",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/lex/drafting/clauses/fallbacks",
      {
        clause_text: "Customer may terminate for convenience at any time.",
        position: "preserve setup fee recovery",
        count: 3,
        language: "en",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/lex/drafting/translate",
      {
        text: "The parties agree to maintain confidentiality.",
        source_lang: "en",
        target_lang: "ar",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      6,
      "/api/v1/lex/drafting/summary",
      {
        text: "Long services agreement text.",
        contract_type: "service_agreement",
        language: "en",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      7,
      "/api/v1/lex/drafting/glossary",
      {
        text: '"Services" means the managed cloud services.',
        language: "en",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      8,
      "/api/v1/lex/drafting/assemble",
      {
        sections: [
          {
            id: "intro",
            heading: "Agreement",
            body: "This agreement is between {{customer}} and {{supplier}}.",
          },
        ],
        variables: { customer: "Watheeq", supplier: "Clario360" },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      9,
      "/api/v1/lex/drafting/rfp-response",
      {
        requirements: "Describe ISO 27001 controls.",
        company_profile: "Cloud compliance platform.",
        language: "en",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      10,
      "/api/v1/lex/drafting/obligations/qa-review",
      {
        contract_text: "Supplier shall deliver reports monthly.",
        obligations: [{ title: "Monthly reports", due: "monthly" }],
      },
    );
  });

  it("rejects a contract draft whose required sections are null", async () => {
    apiPostMock.mockResolvedValueOnce({
      data: { title: "Master Services Agreement", sections: null, open_items: null },
    });

    await expect(
      enterpriseApi.lex.drafting.draftContract({
        contract_type: "service_agreement",
        deal_terms: { customer: "Watheeq" },
        language: "en",
      }),
    ).rejects.toThrow("invalid contract result");
  });

  it("canonicalizes null optional open items in a valid contract draft", async () => {
    apiPostMock.mockResolvedValueOnce({
      data: {
        title: "Master Services Agreement",
        sections: [{ heading: "Services", body: "Supplier provides the services." }],
        open_items: null,
      },
    });

    const result = await enterpriseApi.lex.drafting.draftContract({
      contract_type: "service_agreement",
      deal_terms: { customer: "Watheeq" },
      language: "en",
    });
    expect(result.open_items).toEqual([]);
  });

  it("constructs the Watheeq drafting alias routes under /api/v1/watheeq/drafting", async () => {
    apiPostMock.mockResolvedValue({ data: {} });

    await enterpriseApi.watheeq.drafting.generateClause({
      intent: "Draft a Saudi-law confidentiality clause.",
    });
    await enterpriseApi.watheeq.drafting.assembleTemplate({
      sections: [
        { id: "term", heading: "Term", body: "Effective {{effective_date}}." },
      ],
      variables: { effective_date: "2026-06-14" },
    });
    await enterpriseApi.watheeq.drafting.reviewObligationExtraction({
      contract_text: "Customer shall pay invoices within 30 days.",
      obligations: [{ title: "Pay invoices", due: "30 days" }],
    });

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/watheeq/drafting/clauses",
      {
        intent: "Draft a Saudi-law confidentiality clause.",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/watheeq/drafting/assemble",
      {
        sections: [
          {
            id: "term",
            heading: "Term",
            body: "Effective {{effective_date}}.",
          },
        ],
        variables: { effective_date: "2026-06-14" },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/watheeq/drafting/obligations/qa-review",
      {
        contract_text: "Customer shall pay invoices within 30 days.",
        obligations: [{ title: "Pay invoices", due: "30 days" }],
      },
    );
  });

  it("lists matters with suite pagination params", async () => {
    apiGetMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, per_page: 25, total_pages: 0 },
    });

    await enterpriseApi.lex.listMatters({
      page: 1,
      per_page: 25,
      sort: "updated_at",
      order: "desc",
      search: "vendor",
      filters: { status: "open" },
    });

    expect(apiGetMock).toHaveBeenCalledWith("/api/v1/lex/matters", {
      page: 1,
      per_page: 25,
      sort: "updated_at",
      order: "desc",
      search: "vendor",
      status: "open",
    });
  });

  it("lists obligations, clause library entries, and regulations under /api/v1/lex", async () => {
    apiGetMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, per_page: 10, total_pages: 0 },
    });
    const params = { page: 1, per_page: 10, order: "asc" as const };

    await enterpriseApi.lex.listObligations(params);
    await enterpriseApi.lex.listClauseLibrary(params);
    await enterpriseApi.lex.listRegulations(params);

    expect(apiGetMock).toHaveBeenNthCalledWith(1, "/api/v1/lex/obligations", {
      page: 1,
      per_page: 10,
      sort: undefined,
      order: "asc",
      search: undefined,
    });
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/clause-library",
      {
        page: 1,
        per_page: 10,
        sort: undefined,
        order: "asc",
        search: undefined,
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(3, "/api/v1/lex/regulations", {
      page: 1,
      per_page: 10,
      sort: undefined,
      order: "asc",
      search: undefined,
    });
  });

  it("gets individual Watheeq domain records by id", async () => {
    apiGetMock.mockResolvedValue({ data: { id: "record-1" } });

    await enterpriseApi.lex.getContractBrief("contract-1");
    await enterpriseApi.lex.getContractTimeline("contract-1");
    await enterpriseApi.lex.getDocumentRepositorySummary();
    await enterpriseApi.lex.getMatter("matter-1");
    await enterpriseApi.lex.getObligation("obligation-1");
    await enterpriseApi.lex.getClauseLibraryEntry("clause-1");
    await enterpriseApi.lex.getRegulation("reg-1");

    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/contracts/contract-1/brief",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/contracts/contract-1/timeline",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/documents/repository-summary",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/lex/matters/matter-1",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/lex/obligations/obligation-1",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      6,
      "/api/v1/lex/clause-library/clause-1",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      7,
      "/api/v1/lex/regulations/reg-1",
      undefined,
    );
  });

  it("constructs contract stats and single-record read routes for alerts, playbooks, deviations, and rendering", async () => {
    apiGetMock.mockResolvedValue({
      data: { id: "record-1" },
      meta: { total: 0, page: 1, per_page: 20, total_pages: 0 },
    });

    await enterpriseApi.lex.getContractStats();
    await enterpriseApi.lex.getComplianceAlert("alert-1");
    await enterpriseApi.lex.getContractClauseDeviations("contract-1");
    await enterpriseApi.lex.listPlaybooks({ page: 1, per_page: 20 });
    await enterpriseApi.lex.getPlaybook("playbook-1");
    await enterpriseApi.lex.getSignatureRecipientRendering(
      "signature-1",
      "recipient-1",
    );

    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/contracts/stats",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/compliance/alerts/alert-1",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/contracts/contract-1/clause-deviations",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(4, "/api/v1/lex/playbooks", {
      page: 1,
      per_page: 20,
      sort: undefined,
      order: undefined,
      search: undefined,
    });
    expect(apiGetMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/lex/playbooks/playbook-1",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      6,
      "/api/v1/lex/signatures/signature-1/recipients/recipient-1/rendering",
      undefined,
    );
  });

  it("constructs semantic clause and regulation library search routes", async () => {
    apiGetMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, per_page: 5, total_pages: 0 },
    });

    await enterpriseApi.lex.searchClauseLibrary({
      query: "privacy duties",
      page: 1,
      per_page: 5,
      semantic: true,
      language: "en",
      risk_level: "high",
      governance_status: "approved",
    });
    await enterpriseApi.lex.searchRegulations({
      q: "privacy duties",
      page: 1,
      per_page: 5,
      semantic: true,
      language: "en",
      jurisdiction: "SA",
      authority: "SDAIA",
    });

    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/clause-library/search",
      {
        page: 1,
        per_page: 5,
        sort: undefined,
        order: undefined,
        search: undefined,
        q: "privacy duties",
        clause_type: undefined,
        category: undefined,
        jurisdiction: undefined,
        status: undefined,
        governance_status: "approved",
        risk_level: "high",
        language: "en",
        semantic: true,
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/regulations/search",
      {
        page: 1,
        per_page: 5,
        sort: undefined,
        order: undefined,
        search: undefined,
        q: "privacy duties",
        jurisdiction: "SA",
        authority: "SDAIA",
        regulation_type: undefined,
        status: undefined,
        risk_level: undefined,
        language: "en",
        semantic: true,
      },
    );
  });

  it("constructs clause and regulation governance decision routes", async () => {
    apiPostMock
      .mockResolvedValueOnce({
        data: { id: "clause-1", governance_status: "approved" },
      })
      .mockResolvedValueOnce({ data: { id: "reg-1", status: "active" } });

    const approvePayload = {
      decision: "approve" as const,
      activate: true,
      notes: "Approved by legal ops.",
      evidence: { ticket_id: "GOV-1" },
    };
    const rejectPayload = {
      decision: "reject" as const,
      notes: "Citation mismatch.",
    };

    await enterpriseApi.lex.decideClauseLibraryGovernance(
      "clause-1",
      approvePayload,
    );
    await enterpriseApi.lex.decideRegulationGovernance("reg-1", rejectPayload);

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/clause-library/clause-1/governance",
      approvePayload,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/regulations/reg-1/governance",
      rejectPayload,
    );
  });

  it("constructs matter CRUD, status, triage, and contract link routes", async () => {
    apiPostMock.mockResolvedValue({ data: { id: "matter-1" } });
    apiPutMock.mockResolvedValue({ data: { id: "matter-1" } });
    apiDeleteMock.mockResolvedValue(undefined);

    const createPayload = {
      title: "Vendor dispute",
      description: "Procurement escalation",
      type: "contract",
      owner_user_id: "owner-1",
      owner_name: "Owner One",
      contract_ids: ["contract-1"],
    };
    const updatePayload = { priority: "high" as const, department: "legal" };
    const statusPayload = { status: "in_review" as const };
    const triagePayload = {
      status: "in_review" as const,
      priority: "high" as const,
      notes: "Escalate to legal operations.",
    };
    const linkPayload = { contract_id: "contract-1", relationship: "primary" };

    await enterpriseApi.lex.createMatter(createPayload);
    await enterpriseApi.lex.updateMatter("matter-1", updatePayload);
    await enterpriseApi.lex.updateMatterStatus("matter-1", statusPayload);
    await enterpriseApi.lex.triageMatter("matter-1", triagePayload);
    await enterpriseApi.lex.linkMatterContract("matter-1", linkPayload);
    await enterpriseApi.lex.unlinkMatterContract("matter-1", "contract-1");
    await enterpriseApi.lex.deleteMatter("matter-1");

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/matters",
      createPayload,
    );
    expect(apiPutMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/matters/matter-1",
      updatePayload,
    );
    expect(apiPutMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/matters/matter-1/status",
      statusPayload,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/matters/matter-1/triage",
      triagePayload,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/matters/matter-1/contracts",
      linkPayload,
    );
    expect(apiDeleteMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/matters/matter-1/contracts/contract-1",
    );
    expect(apiDeleteMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/matters/matter-1",
    );
  });

  it("constructs clause-library and regulation CRUD plus regulation-clause link routes", async () => {
    apiPostMock.mockResolvedValue({ data: { id: "record-1" } });
    apiPutMock.mockResolvedValue({ data: { id: "record-1" } });
    apiDeleteMock.mockResolvedValue(undefined);

    const clausePayload = {
      code: "CLAUSE-DP-1",
      clause_type: "data_protection",
      title_en: "Data protection",
      text_en: "Protect personal data.",
      jurisdiction: "SA",
    };
    const regulationPayload = {
      code: "REG-PDPL",
      title_en: "PDPL",
      jurisdiction: "SA",
      authority: "SDAIA",
      regulation_type: "law",
    };
    const regulationClausePayload = {
      clause_id: "clause-1",
      reference_type: "implements" as const,
      notes: "Maps to PDPL controls.",
    };

    await enterpriseApi.lex.createClauseLibraryEntry(clausePayload);
    await enterpriseApi.lex.updateClauseLibraryEntry("clause-1", {
      title_en: "Data protection updated",
    });
    await enterpriseApi.lex.deleteClauseLibraryEntry("clause-1");
    await enterpriseApi.lex.createRegulation(regulationPayload);
    await enterpriseApi.lex.updateRegulation("reg-1", { status: "active" });
    await enterpriseApi.lex.linkRegulationClause(
      "reg-1",
      regulationClausePayload,
    );
    await enterpriseApi.lex.unlinkRegulationClause("reg-1", {
      clause_id: "clause-1",
      reference_type: "implements",
    });
    await enterpriseApi.lex.deleteRegulation("reg-1");

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/clause-library",
      clausePayload,
    );
    expect(apiPutMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/clause-library/clause-1",
      {
        title_en: "Data protection updated",
      },
    );
    expect(apiDeleteMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/clause-library/clause-1",
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/regulations",
      regulationPayload,
    );
    expect(apiPutMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/regulations/reg-1",
      { status: "active" },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/regulations/reg-1/clauses",
      regulationClausePayload,
    );
    expect(apiDeleteMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/regulations/reg-1/clauses?clause_id=clause-1&reference_type=implements",
    );
    expect(apiDeleteMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/regulations/reg-1",
    );
  });

  it("constructs playbook CRUD routes", async () => {
    apiPostMock.mockResolvedValue({ data: { id: "playbook-1" } });
    apiPutMock.mockResolvedValue({ data: { id: "playbook-1" } });
    apiDeleteMock.mockResolvedValue(undefined);

    const playbookPayload = {
      name: "Vendor MSA standard",
      description: "Default vendor agreement clauses.",
      contract_type: "vendor",
      status: "active",
      clauses: [
        {
          clause_type: "data_protection",
          title: "Data protection",
          standard_text: "Protect personal data.",
          required: true,
          risk_weight: 0.8,
          similarity_threshold: 0.75,
        },
      ],
    };

    await enterpriseApi.lex.createPlaybook(playbookPayload);
    await enterpriseApi.lex.updatePlaybook("playbook-1", {
      status: "archived",
    });
    await enterpriseApi.lex.deletePlaybook("playbook-1");

    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/v1/lex/playbooks",
      playbookPayload,
    );
    expect(apiPutMock).toHaveBeenCalledWith(
      "/api/v1/lex/playbooks/playbook-1",
      { status: "archived" },
    );
    expect(apiDeleteMock).toHaveBeenCalledWith(
      "/api/v1/lex/playbooks/playbook-1",
    );
  });

  it("unwraps the playbook portfolio suite envelope", async () => {
    apiGetMock.mockResolvedValue({
      data: {
        data: [
          {
            contract_id: "contract-1",
            contract_title: "Vendor MSA",
            contract_type: "vendor",
            playbook_id: "playbook-1",
            playbook_name: "Vendor baseline",
            compliance_score: 58,
            missing_count: 2,
            altered_count: 1,
            extra_count: 0,
            generated_at: "2026-06-28T12:00:00Z",
          },
        ],
        page: 2,
        per_page: 25,
        total: 40,
        truncated: true,
      },
    });

    const result = await enterpriseApi.lex.getPlaybookPortfolio({
      contract_type: "vendor",
      max_score: 80,
      order: "asc",
      page: 2,
      per_page: 25,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.contract_id).toBe("contract-1");
    expect(result.total).toBe(40);
    expect(result.truncated).toBe(true);
    expect(apiGetMock).toHaveBeenCalledWith(
      "/api/v1/lex/playbooks/portfolio",
      {
        contract_type: "vendor",
        max_score: 80,
        order: "asc",
        page: 2,
        per_page: 25,
      },
    );
  });

  it("constructs document repository bulk import route", async () => {
    apiPostMock.mockResolvedValue({
      data: {
        batch_id: "batch-1",
        requested: 1,
        succeeded: 1,
        failed: 0,
        items: [],
      },
    });

    await enterpriseApi.lex.bulkImportDocuments({
      batch_id: "batch-1",
      source_system: "legacy-dms",
      documents: [{ title: "Legacy policy" }],
    });

    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/v1/lex/documents/bulk-import",
      {
        batch_id: "batch-1",
        source_system: "legacy-dms",
        documents: [{ title: "Legacy policy" }],
      },
    );
  });

  it("constructs Word editor document routes", async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    apiPostMock.mockResolvedValue({ data: { document_id: "doc-1" } });
    apiClientDeleteMock.mockResolvedValue({
      data: { data: { document_id: "doc-1" } },
    });

    await enterpriseApi.lex.getDocumentEditorSession("doc-1");
    await enterpriseApi.lex.openDocumentEditor("doc-1", {
      source: "repository",
      current_version: 3,
    });
    await enterpriseApi.lex.checkOutDocument("doc-1", {
      reason: "Drafting changes",
    });
    await enterpriseApi.lex.releaseDocumentLock("doc-1", {
      reason: "Done editing",
    });
    await enterpriseApi.lex.runDocumentPreflight("doc-1", {
      source: "preview",
    });
    await enterpriseApi.lex.createDocumentVersionSnapshot("doc-1", {
      change_summary: "Before editor changes",
    });
    await enterpriseApi.lex.listDocumentAudit("doc-1");

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/documents/doc-1/editor/session",
      {
        mode: "view",
        provider: "onlyoffice",
        options: {},
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/documents/doc-1/editor/session",
      {
        mode: "edit",
        provider: "onlyoffice",
        options: {
          source: "repository",
          current_version: 3,
        },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/documents/doc-1/editor/lock",
      {
        lock_type: "checkout",
        reason: "Drafting changes",
        metadata: {},
      },
    );
    expect(apiClientDeleteMock).toHaveBeenCalledWith(
      "/api/v1/lex/documents/doc-1/editor/lock",
      {
        data: {
          reason: "Done editing",
        },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/lex/documents/doc-1/editor/preflight",
      {
        status: "passed",
        blocking: false,
        summary: "Document editor preflight requested.",
        checks: [],
        metadata: {
          source: "preview",
        },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/lex/documents/doc-1/editor/snapshot",
      {
        change_summary: "Before editor changes",
        metadata: {},
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/documents/doc-1/editor/audit",
      undefined,
    );
  });

  it("constructs additional Word editor maturity routes", async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    apiPostMock.mockResolvedValue({ data: { id: "created-1" } });
    apiPutMock.mockResolvedValue({ data: { id: "updated-1" } });
    apiPatchMock.mockResolvedValue({ data: { id: "patched-1" } });
    apiClientDeleteMock.mockResolvedValue({
      data: { data: { id: "revoked-1" } },
    });

    await enterpriseApi.lex.getDocumentNegotiationRoom("doc-1");
    await enterpriseApi.lex.upsertDocumentNegotiationRoom("doc-1", {
      status: "open",
      source: "editor",
    });
    await enterpriseApi.lex.addDocumentNegotiationMessage("doc-1", {
      body: "Counterparty accepted fallback language.",
      section_id: "section-1",
    });
    await enterpriseApi.lex.getDocumentPlaybookEnforcement("doc-1");
    await enterpriseApi.lex.runDocumentPlaybookEnforcement("doc-1", {
      playbook_id: "playbook-1",
      enforce_required_clauses: true,
    });
    await enterpriseApi.lex.getDocumentTermsCrossReferences("doc-1");
    await enterpriseApi.lex.analyzeDocumentTermsCrossReferences("doc-1", {
      include_defined_terms: true,
      include_cross_references: true,
    });
    await enterpriseApi.lex.listDocumentSectionAssignments("doc-1");
    await enterpriseApi.lex.upsertDocumentSectionAssignments("doc-1", {
      assignments: [
        {
          section_id: "section-1",
          assignee_user_id: "user-1",
          role: "reviewer",
        },
      ],
    });
    await enterpriseApi.lex.listDocumentGuestReviewLinks("doc-1");
    await enterpriseApi.lex.createDocumentGuestReviewLink("doc-1", {
      reviewer_email: "guest@example.test",
      permissions: ["comment"],
    });
    await enterpriseApi.lex.revokeDocumentGuestReviewLink("doc-1", "link-1", {
      reason: "Review closed",
    });
    await enterpriseApi.lex.listDocumentLegalIssues("doc-1");
    await enterpriseApi.lex.createDocumentLegalIssue("doc-1", {
      issue_type: "missing_clause",
      title: "Missing limitation of liability",
    });
    await enterpriseApi.lex.updateDocumentLegalIssue("doc-1", "issue-1", {
      status: "in_progress",
    });
    await enterpriseApi.lex.resolveDocumentLegalIssue("doc-1", "issue-1", {
      status: "resolved",
    });
    await enterpriseApi.lex.getDocumentSignatureReadiness("doc-1");
    await enterpriseApi.lex.runDocumentSignatureReadiness("doc-1", {
      signature_provider: "najiz",
    });
    await enterpriseApi.lex.runDocumentClauseAIAction("doc-1", {
      action: "rewrite",
      clause_id: "clause-1",
      instructions: "Make this clause balanced.",
    });
    await enterpriseApi.lex.getDocumentHealthScore("doc-1");
    await enterpriseApi.lex.refreshDocumentHealthScore("doc-1", {
      include_ai_signals: true,
    });
    await enterpriseApi.lex.getDocumentPrivilegedControls("doc-1");
    await enterpriseApi.lex.updateDocumentPrivilegedControls("doc-1", {
      privileged: true,
      ethical_wall: true,
    });

    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/documents/doc-1/editor/negotiation-room",
      undefined,
    );
    expect(apiPutMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/documents/doc-1/editor/negotiation-room",
      {
        status: "open",
        source: "editor",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/documents/doc-1/editor/negotiation-room/messages",
      {
        body: "Counterparty accepted fallback language.",
        section_id: "section-1",
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/documents/doc-1/editor/playbook-enforcement",
      undefined,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/documents/doc-1/editor/playbook-enforcement",
      {
        playbook_id: "playbook-1",
        enforce_required_clauses: true,
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/documents/doc-1/editor/terms-cross-references",
      undefined,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/documents/doc-1/editor/terms-cross-references",
      {
        include_defined_terms: true,
        include_cross_references: true,
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/lex/documents/doc-1/editor/section-assignments",
      undefined,
    );
    expect(apiPutMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/documents/doc-1/editor/section-assignments",
      {
        assignments: [
          {
            section_id: "section-1",
            assignee_user_id: "user-1",
            role: "reviewer",
          },
        ],
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/lex/documents/doc-1/editor/guest-review-links",
      undefined,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/lex/documents/doc-1/editor/guest-review-links",
      {
        reviewer_email: "guest@example.test",
        permissions: ["comment"],
      },
    );
    expect(apiClientDeleteMock).toHaveBeenCalledWith(
      "/api/v1/lex/documents/doc-1/editor/guest-review-links/link-1",
      {
        data: {
          reason: "Review closed",
        },
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      6,
      "/api/v1/lex/documents/doc-1/editor/legal-issues",
      undefined,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/lex/documents/doc-1/editor/legal-issues",
      {
        issue_type: "missing_clause",
        title: "Missing limitation of liability",
      },
    );
    expect(apiPatchMock).toHaveBeenCalledWith(
      "/api/v1/lex/documents/doc-1/editor/legal-issues/issue-1",
      {
        status: "in_progress",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      6,
      "/api/v1/lex/documents/doc-1/editor/legal-issues/issue-1/resolve",
      {
        status: "resolved",
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      7,
      "/api/v1/lex/documents/doc-1/editor/signature-readiness",
      undefined,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      7,
      "/api/v1/lex/documents/doc-1/editor/signature-readiness",
      {
        signature_provider: "najiz",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      8,
      "/api/v1/lex/documents/doc-1/editor/clause-ai-actions",
      {
        action: "rewrite",
        clause_id: "clause-1",
        instructions: "Make this clause balanced.",
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      8,
      "/api/v1/lex/documents/doc-1/editor/health-score",
      undefined,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      9,
      "/api/v1/lex/documents/doc-1/editor/health-score",
      {
        include_ai_signals: true,
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      9,
      "/api/v1/lex/documents/doc-1/editor/privileged-controls",
      undefined,
    );
    expect(apiPutMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/documents/doc-1/editor/privileged-controls",
      {
        privileged: true,
        ethical_wall: true,
      },
    );
  });

  it("exposes frontend helpers for backend-only next-wave editor actions", () => {
    const lexApi = enterpriseApi.lex as Record<string, unknown>;
    const missing = backendOnlyNextWaveEditorMethods.filter(
      (name) => typeof lexApi[name] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("constructs next-wave Word editor enterprise routes", async () => {
    const lexApi = expectNextWaveEditorApi();
    if (!lexApi) return;

    apiGetMock.mockResolvedValue({ data: {} });
    apiPostMock.mockResolvedValue({ data: { id: "created-1" } });
    apiPatchMock.mockResolvedValue({ data: { id: "patched-1" } });
    apiPutMock.mockResolvedValue({ data: { id: "updated-1" } });

    await lexApi.listDocumentProviderEvents("doc-1");
    await lexApi.recordDocumentProviderEvent("doc-1", {
      provider: "onlyoffice",
      event_type: "save",
      provider_event_id: "evt-1",
    });
    await lexApi.getDocumentGuestPortalStatus("doc-1");
    await lexApi.refreshDocumentGuestPortalStatus("doc-1", {
      link_id: "link-1",
      token: "guest-token-1",
    });
    await lexApi.listDocumentAutomationTasks("doc-1");
    await lexApi.createDocumentAutomationTask("doc-1", {
      title: "Resolve limitation issue",
      task_type: "legal_issue",
      source_type: "legal_issue",
      source_id: "issue-1",
      owner_user_id: "user-1",
    });
    await lexApi.updateDocumentAutomationTask("doc-1", "task-1", {
      status: "done",
    });
    await lexApi.listDocumentClauseAnchors("doc-1");
    await lexApi.extractDocumentClauseAnchors("doc-1", {
      force: true,
    });
    await lexApi.listDocumentRedlinePackages("doc-1");
    await lexApi.generateDocumentRedlinePackage("doc-1", {
      include_clean_docx: true,
      include_pdf: true,
    });
    await lexApi.getDocumentApprovalMatrix("doc-1");
    await lexApi.requestDocumentApproval("doc-1", {
      gate_id: "external_share",
      reason: "Counterparty review requested.",
    });
    await lexApi.getDocumentCompareWorkspace("doc-1");
    await lexApi.runDocumentCompare("doc-1", {
      base_version_id: "version-6",
      target_version_id: "version-7",
    });
    await lexApi.getDocumentCollaborationInbox("doc-1");
    await lexApi.markDocumentCollaborationInboxItemRead("doc-1", "inbox-1", {
      source: "editor",
    });
    await lexApi.listDocumentPlaybookRuleLinks("doc-1");
    await lexApi.createDocumentPlaybookRuleLink("doc-1", {
      playbook_id: "playbook-1",
      name: "Vendor MSA rules",
    });
    await lexApi.listDocumentDefinedTermRepairs("doc-1");
    await lexApi.applyDocumentDefinedTermRepair("doc-1", {
      repair_id: "repair-1",
      action: "define",
    });
    await lexApi.listDocumentEvidenceBindings("doc-1");
    await lexApi.createDocumentEvidenceBinding("doc-1", {
      section_id: "section-1",
      source_type: "policy",
      source_id: "policy-1",
    });
    await lexApi.getDocumentAIChangeSafety("doc-1");
    await lexApi.updateDocumentAIChangeSafety("doc-1", {
      mode: "approval_required",
    });
    await lexApi.getDocumentOfflineRecoveryState("doc-1");
    await lexApi.saveDocumentOfflineRecoveryState("doc-1", {
      queued_edits: 2,
      recovery_payload: { encrypted_buffer: "ciphertext" },
    });
    await lexApi.getDocumentEditorAnalytics("doc-1");

    expect(apiPostMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/lex/documents/doc-1/editor/provider-events",
      "/api/v1/lex/documents/doc-1/editor/guest-review-links/link-1/portal/validate",
      "/api/v1/lex/documents/doc-1/editor/tasks",
      "/api/v1/lex/documents/doc-1/editor/redline-packages",
      "/api/v1/lex/documents/doc-1/editor/approval-matrix/requests",
      "/api/v1/lex/documents/doc-1/editor/compare",
      "/api/v1/lex/documents/doc-1/editor/collaboration-inbox/inbox-1/read",
      "/api/v1/lex/documents/doc-1/editor/terms-cross-references/repair",
      "/api/v1/lex/documents/doc-1/editor/citations",
      "/api/v1/lex/documents/doc-1/editor/ai-change-safety",
      "/api/v1/lex/documents/doc-1/editor/offline-recovery",
    ]);
    expect(apiGetMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/lex/documents/doc-1/editor/provider-events",
      "/api/v1/lex/documents/doc-1/editor/guest-portal",
      "/api/v1/lex/documents/doc-1/editor/tasks",
      "/api/v1/lex/documents/doc-1/editor/clause-anchors",
      "/api/v1/lex/documents/doc-1/editor/redline-packages",
      "/api/v1/lex/documents/doc-1/editor/approval-matrix",
      "/api/v1/lex/documents/doc-1/editor/compare-workspace",
      "/api/v1/lex/documents/doc-1/editor/collaboration-inbox",
      "/api/v1/lex/documents/doc-1/editor/playbook-rules",
      "/api/v1/lex/documents/doc-1/editor/term-repairs",
      "/api/v1/lex/documents/doc-1/editor/evidence-bindings",
      "/api/v1/lex/documents/doc-1/editor/ai-change-safety",
      "/api/v1/lex/documents/doc-1/editor/offline-recovery",
      "/api/v1/lex/documents/doc-1/editor/analytics",
    ]);
    expect(apiPutMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/lex/documents/doc-1/editor/clause-anchors",
      "/api/v1/lex/documents/doc-1/editor/playbook-rules",
    ]);
    expect(apiPatchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/lex/documents/doc-1/editor/tasks/task-1",
    ]);
  });

  it("normalizes Word editor maturity payloads and preflight results", async () => {
    apiPostMock
      .mockResolvedValueOnce({ data: { session: { id: "session-1" } } })
      .mockResolvedValueOnce({
        data: { document_id: "doc-1", status: "locked" },
      })
      .mockResolvedValueOnce({
        data: {
          accepted: false,
          preflight: {
            status: "failed",
            blocking: true,
            recorded_at: "2026-06-26T10:00:00Z",
            metadata: { stage: "preflight" },
            checks: [
              { key: "docx_format", status: "passed", severity: "info" },
              {
                key: "macro_scan",
                status: "failed",
                severity: "blocker",
                message: "Macros disabled",
                metadata: { line: 12 },
              },
              { status: "warning", message: "Missing tracked-change author" },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          document_id: "doc-1",
          version: 8,
          metadata: { source: "word_editor" },
        },
      });

    await enterpriseApi.lex.openDocumentEditor("doc-1", {
      mode: "comment",
      provider: "collabora",
      locale: "ar",
      user_display_name: "Aisha Counsel",
      document_url: "https://files.example.test/doc-1.docx",
      callback_url: "https://lex.example.test/editor/callback",
      source: "repository",
      current_version: 7,
      return_url: "/lex/documents?panel=editor",
      metadata: { jurisdiction: "SA" },
      options: { track_changes: true },
    });
    await enterpriseApi.lex.checkOutDocument("doc-1", {
      session_id: "session-1",
      lock_type: "edit",
      reason: "Negotiation turn",
      expires_in_seconds: 900,
      source: "word_editor",
      current_version: 7,
      expires_at: "2026-06-26T11:00:00Z",
      metadata: { department: "legal" },
    });
    const preflight = await enterpriseApi.lex.runDocumentPreflight("doc-1", {
      session_id: "session-1",
      status: "failed",
      score: 62,
      blocking: true,
      summary: "Blocking Word editor preflight",
      source: "word_editor",
      current_version: 7,
      checks: [{ key: "macro_scan", status: "failed", severity: "blocker" }],
      metadata: { requested_by: "aisha@example.test" },
    });
    await enterpriseApi.lex.createDocumentVersionSnapshot("doc-1", {
      session_id: "session-1",
      change_summary: "Before tracked changes",
      current_version: 7,
      source: "word_editor",
      metadata: { requested_by: "aisha@example.test" },
    });

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/documents/doc-1/editor/session",
      {
        mode: "comment",
        provider: "collabora",
        locale: "ar",
        user_display_name: "Aisha Counsel",
        document_url: "https://files.example.test/doc-1.docx",
        callback_url: "https://lex.example.test/editor/callback",
        options: {
          jurisdiction: "SA",
          source: "repository",
          current_version: 7,
          return_url: "/lex/documents?panel=editor",
          track_changes: true,
        },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/documents/doc-1/editor/lock",
      {
        session_id: "session-1",
        lock_type: "edit",
        reason: "Negotiation turn",
        expires_in_seconds: 900,
        metadata: {
          department: "legal",
          source: "word_editor",
          current_version: 7,
          expires_at: "2026-06-26T11:00:00Z",
        },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/documents/doc-1/editor/preflight",
      {
        session_id: "session-1",
        status: "failed",
        score: 62,
        blocking: true,
        summary: "Blocking Word editor preflight",
        checks: [{ key: "macro_scan", status: "failed", severity: "blocker" }],
        metadata: {
          requested_by: "aisha@example.test",
          source: "word_editor",
          current_version: 7,
        },
      },
    );
    expect(preflight).toEqual({
      document_id: "doc-1",
      ready: false,
      can_edit: false,
      status: "blocked",
      checked_at: "2026-06-26T10:00:00Z",
      metadata: { stage: "preflight" },
      issues: [
        {
          code: "macro_scan",
          severity: "blocker",
          message: "Macros disabled",
          metadata: { line: 12 },
        },
        {
          code: "editor_preflight",
          severity: "warning",
          message: "Missing tracked-change author",
          metadata: undefined,
        },
      ],
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/lex/documents/doc-1/editor/snapshot",
      {
        session_id: "session-1",
        change_summary: "Before tracked changes",
        current_version: 7,
        source: "word_editor",
        metadata: { requested_by: "aisha@example.test" },
      },
    );
  });

  it("constructs obligation CRUD, scoped list, extraction, and reminder routes", async () => {
    apiGetMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 2, per_page: 15, total_pages: 0 },
    });
    apiPostMock.mockResolvedValue({ data: { id: "obligation-1" } });
    apiPutMock.mockResolvedValue({ data: { id: "obligation-1" } });
    apiDeleteMock.mockResolvedValue(undefined);

    const params = {
      page: 2,
      per_page: 15,
      sort: "due_date",
      order: "asc" as const,
      search: "certificate",
      filters: { status: "open", owner_user_id: "owner-1", overdue: "true" },
    };

    await enterpriseApi.lex.listContractObligations("contract-1", params);
    await enterpriseApi.lex.listMatterObligations("matter-1", params);
    await enterpriseApi.lex.getObligationReminderPlan({
      as_of: "2026-06-14T00:00:00Z",
      horizon_days: 45,
      include_escalations: false,
    });
    await enterpriseApi.lex.createObligation({
      title: "Submit compliance certificate",
      owner_user_id: "owner-1",
      owner_name: "Owner One",
      contract_id: "contract-1",
      due_date: "2026-07-01T00:00:00Z",
    });
    await enterpriseApi.lex.updateObligation("obligation-1", {
      status: "in_progress",
      reminder_lead_days: [14, 7],
    });
    await enterpriseApi.lex.updateObligationStatus("obligation-1", {
      status: "completed",
    });
    await enterpriseApi.lex.deleteObligation("obligation-1");
    await enterpriseApi.lex.extractContractObligations("contract-1", {
      owner_user_id: "owner-1",
      owner_name: "Owner One",
      items: [
        {
          title: "Pay invoice",
          description: "Pay net-30 invoice",
          due_date: "2026-07-14T00:00:00Z",
          source: "payload",
          source_reference: "section-4.2",
        },
      ],
    });
    await enterpriseApi.lex.enqueueObligationReminders({
      as_of: "2026-06-14T00:00:00Z",
      horizon_days: 30,
      include_escalations: true,
      channels: ["email", "calendar"],
    });
    await enterpriseApi.lex.markObligationReminderSent("obligation-1", {
      channel: "email",
      event_type: "reminder",
      lead_days: 7,
      provider: "mailgun",
    });
    await enterpriseApi.lex.markObligationReminderDelivery("outbox-1", {
      status: "sent",
      provider: "mailgun",
      provider_message_id: "msg-1",
    });

    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/contracts/contract-1/obligations",
      {
        page: 2,
        per_page: 15,
        sort: "due_date",
        order: "asc",
        search: "certificate",
        status: "open",
        owner_user_id: "owner-1",
        overdue: "true",
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/matters/matter-1/obligations",
      {
        page: 2,
        per_page: 15,
        sort: "due_date",
        order: "asc",
        search: "certificate",
        status: "open",
        owner_user_id: "owner-1",
        overdue: "true",
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/obligations/reminders",
      {
        as_of: "2026-06-14T00:00:00Z",
        horizon_days: 45,
        include_escalations: false,
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(1, "/api/v1/lex/obligations", {
      title: "Submit compliance certificate",
      owner_user_id: "owner-1",
      owner_name: "Owner One",
      contract_id: "contract-1",
      due_date: "2026-07-01T00:00:00Z",
    });
    expect(apiPutMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/obligations/obligation-1",
      {
        status: "in_progress",
        reminder_lead_days: [14, 7],
      },
    );
    expect(apiPutMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/obligations/obligation-1/status",
      {
        status: "completed",
      },
    );
    expect(apiDeleteMock).toHaveBeenCalledWith(
      "/api/v1/lex/obligations/obligation-1",
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/contracts/contract-1/obligations/extract",
      {
        owner_user_id: "owner-1",
        owner_name: "Owner One",
        items: [
          {
            title: "Pay invoice",
            description: "Pay net-30 invoice",
            due_date: "2026-07-14T00:00:00Z",
            source: "payload",
            source_reference: "section-4.2",
          },
        ],
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/obligations/reminders/enqueue",
      {
        as_of: "2026-06-14T00:00:00Z",
        horizon_days: 30,
        include_escalations: true,
        channels: ["email", "calendar"],
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/lex/obligations/obligation-1/reminders/sent",
      {
        channel: "email",
        event_type: "reminder",
        lead_days: 7,
        provider: "mailgun",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/lex/obligations/reminders/outbox/outbox-1/delivery",
      {
        status: "sent",
        provider: "mailgun",
        provider_message_id: "msg-1",
      },
    );
  });

  it("constructs contract renewal warning and classification routes", async () => {
    apiGetMock.mockResolvedValue({
      data: { total: 0, urgent: 0, warning: 0, items: [] },
    });
    apiPostMock.mockResolvedValue({
      data: {
        contract_id: "contract-1",
        previous_type: "other",
        recommended_type: "nda",
        applied_type: "nda",
        applied: true,
        confidence: 1,
        matched_terms: ["confidentiality"],
        rationale: "Matched NDA terms.",
        classified_at: "2026-06-14T00:00:00Z",
      },
    });

    await enterpriseApi.lex.getContractRenewalWarnings({
      horizon_days: 90,
      lead_days: 45,
    });
    await enterpriseApi.lex.classifyContract("contract-1", {
      apply: true,
      candidate_text: "mutual confidentiality agreement",
      override_type: "nda",
    });

    expect(apiGetMock).toHaveBeenCalledWith(
      "/api/v1/lex/contracts/renewal-warnings",
      {
        horizon_days: 90,
        lead_days: 45,
      },
    );
    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/v1/lex/contracts/contract-1/classify",
      {
        apply: true,
        candidate_text: "mutual confidentiality agreement",
        override_type: "nda",
      },
    );
  });

  it("constructs the bounded matter conflict-check route", async () => {
    apiPostMock.mockResolvedValue({
      data: { conflicts: [], warnings: [], checked_at: "2026-06-14T00:00:00Z" },
    });

    await enterpriseApi.lex.checkMatterConflict({
      title: "Vendor dispute",
      description: "Counterparty has overlapping procurement work.",
      counterparty: "Acme LLC",
      contract_title: "Acme MSA",
    });

    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/v1/lex/matters/conflict-check",
      {
        title: "Vendor dispute",
        description: "Counterparty has overlapping procurement work.",
        counterparty: "Acme LLC",
        contract_title: "Acme MSA",
      },
    );
  });

  it("constructs signature envelope routes under /api/v1/lex/signatures", async () => {
    apiGetMock.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, per_page: 25, total_pages: 0 },
    });
    apiPostMock.mockResolvedValue({ data: { id: "signature-1" } });
    apiPutMock.mockResolvedValue({ data: { user_id: "user-1" } });
    apiDeleteMock.mockResolvedValue(undefined);

    await enterpriseApi.lex.listSignatures({
      page: 1,
      per_page: 25,
      sort: "updated_at",
      order: "desc",
      filters: { contract_id: "contract-1", status: "draft" },
    });
    await enterpriseApi.lex.getSignature("signature-1");
    await enterpriseApi.lex.getMySignatureProfile();
    await enterpriseApi.lex.upsertMySignatureProfile({
      typed_name: "Signer One",
      initials: "SO",
      signature_image: "data:image/png;base64,abc",
    });
    await enterpriseApi.lex.deleteMySignatureProfile();
    await enterpriseApi.lex.createSignature({
      contract_id: "contract-1",
      title: "Vendor MSA signature",
      recipients: [{ name: "Signer One", email: "signer@example.com" }],
    });
    await enterpriseApi.lex.sendSignature("signature-1");
    await enterpriseApi.lex.cancelSignature("signature-1", {
      reason: "wrong recipients",
    });
    await enterpriseApi.lex.updateSignaturePlacements("signature-1", {
      placements: [
        {
          id: "field-1",
          recipient_id: "recipient-1",
          kind: "signature",
          page: 1,
          x: 60,
          y: 78,
          width: 28,
          height: 8,
          required: true,
        },
      ],
    });
    await enterpriseApi.lex.recordSignatureRecipientAction("signature-1", {
      recipient_id: "recipient-1",
      action: "sign",
    });
    await enterpriseApi.lex.recordSelfSignatureRecipientAction("signature-1", {
      recipient_id: "recipient-1",
      action: "sign",
    });
    await enterpriseApi.lex.recordSignatureProviderEvent("signature-1", {
      provider: "nafath",
      provider_status: "signed",
    });
    await enterpriseApi.lex.recordSignatureCustody("signature-1", {
      file_id: "file-1",
      file_name: "signed.pdf",
      file_size_bytes: 1200,
      content_hash: "sha256:signed",
      evidence_hash: "sha256:evidence",
    });

    expect(apiGetMock).toHaveBeenNthCalledWith(1, "/api/v1/lex/signatures", {
      page: 1,
      per_page: 25,
      sort: "updated_at",
      order: "desc",
      search: undefined,
      contract_id: "contract-1",
      status: "draft",
    });
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/signatures/signature-1",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/signatures/me/profile",
      undefined,
    );
    expect(apiPutMock).toHaveBeenCalledWith(
      "/api/v1/lex/signatures/me/profile",
      {
        typed_name: "Signer One",
        initials: "SO",
        signature_image: "data:image/png;base64,abc",
      },
    );
    expect(apiDeleteMock).toHaveBeenCalledWith(
      "/api/v1/lex/signatures/me/profile",
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(1, "/api/v1/lex/signatures", {
      contract_id: "contract-1",
      title: "Vendor MSA signature",
      recipients: [{ name: "Signer One", email: "signer@example.com" }],
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/signatures/signature-1/send",
      undefined,
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/signatures/signature-1/cancel",
      {
        reason: "wrong recipients",
      },
    );
    expect(apiPutMock).toHaveBeenCalledWith(
      "/api/v1/lex/signatures/signature-1/placements",
      {
        placements: [
          {
            id: "field-1",
            recipient_id: "recipient-1",
            kind: "signature",
            page: 1,
            x: 60,
            y: 78,
            width: 28,
            height: 8,
            required: true,
          },
        ],
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/lex/signatures/signature-1/recipients/recipient-1/actions",
      {
        recipient_id: "recipient-1",
        action: "sign",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      5,
      "/api/v1/lex/signatures/signature-1/recipients/recipient-1/self-actions",
      {
        recipient_id: "recipient-1",
        action: "sign",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      6,
      "/api/v1/lex/signatures/signature-1/provider-events",
      {
        provider: "nafath",
        provider_status: "signed",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      7,
      "/api/v1/lex/signatures/signature-1/custody",
      {
        file_id: "file-1",
        file_name: "signed.pdf",
        file_size_bytes: 1200,
        content_hash: "sha256:signed",
        evidence_hash: "sha256:evidence",
      },
    );
  });

  it("constructs workflow, report, and reminder dispatch routes", async () => {
    apiGetMock.mockResolvedValue({ data: { total: 0 } });
    apiClientGetMock.mockResolvedValue({ data: new Blob() });
    apiPostMock.mockResolvedValue({
      data: { workflow_instance_id: "workflow-1", task_id: "task-1" },
    });

    await enterpriseApi.lex.startContractReview("contract-1", {
      approver_role: "legal_approver",
      description: "Watheeq DoA review",
      sla_hours: 24,
      approval_policy_id: "policy-1",
      approval_policy: {
        policy_id: "DOA-KSA-LEGAL-001",
        required_role: "finance_director",
        required_authority_amount: 500000,
        currency: "SAR",
        require_authority_evidence: true,
      },
      form_fields: [
        {
          name: "business_justification",
          type: "textarea",
          label: "Business justification",
          required: true,
        },
      ],
      out_of_office: {
        active: true,
        delegated_to: "delegate-1",
        reason: "Approver unavailable",
        evidence_id: "OOO-CALENDAR-123",
      },
    });
    await enterpriseApi.lex.decideWorkflowTask("workflow-1", "task-1", {
      decision: "approve",
      form_data: {
        business_justification: "Critical renewal",
      },
      authority_evidence: {
        policy_id: "DOA-KSA-LEGAL-001",
        role: "finance_director",
        authority_amount: 750000,
        currency: "SAR",
        evidence_id: "DOA-BOARD-MINUTES-001",
      },
    });
    await enterpriseApi.lex.getContractReport({
      page: 1,
      per_page: 100,
      filters: { status: "active" },
    });
    await enterpriseApi.lex.getMatterReport({
      page: 1,
      per_page: 100,
      filters: { status: "open" },
    });
    await enterpriseApi.lex.getObligationReport({
      page: 1,
      per_page: 100,
      filters: { overdue: "true" },
    });
    await enterpriseApi.lex.exportContractReportCsv({
      page: 1,
      per_page: 100,
      filters: { risk_level: "high" },
    });
    await enterpriseApi.lex.exportMatterReportCsv({
      page: 1,
      per_page: 100,
      filters: { priority: "high" },
    });
    await enterpriseApi.lex.exportObligationReportCsv({
      page: 1,
      per_page: 100,
      filters: { status: "open" },
    });
    await enterpriseApi.lex.dispatchObligationReminderOutbox({
      provider: "local",
    });
    await enterpriseApi.lex.dispatchObligationReminderOutboxItem("outbox-1", {
      retry: true,
    });

    expect(apiPostMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/contracts/contract-1/review",
      {
        approver_role: "legal_approver",
        description: "Watheeq DoA review",
        sla_hours: 24,
        approval_policy_id: "policy-1",
        approval_policy: {
          policy_id: "DOA-KSA-LEGAL-001",
          required_role: "finance_director",
          required_authority_amount: 500000,
          currency: "SAR",
          require_authority_evidence: true,
        },
        form_fields: [
          {
            name: "business_justification",
            type: "textarea",
            label: "Business justification",
            required: true,
          },
        ],
        out_of_office: {
          active: true,
          delegated_to: "delegate-1",
          reason: "Approver unavailable",
          evidence_id: "OOO-CALENDAR-123",
        },
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/workflows/workflow-1/tasks/task-1/decision",
      {
        decision: "approve",
        form_data: {
          business_justification: "Critical renewal",
        },
        authority_evidence: {
          policy_id: "DOA-KSA-LEGAL-001",
          role: "finance_director",
          authority_amount: 750000,
          currency: "SAR",
          evidence_id: "DOA-BOARD-MINUTES-001",
        },
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/reports/contracts",
      {
        page: 1,
        per_page: 100,
        sort: undefined,
        order: undefined,
        search: undefined,
        status: "active",
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/reports/matters",
      {
        page: 1,
        per_page: 100,
        sort: undefined,
        order: undefined,
        search: undefined,
        status: "open",
      },
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/reports/obligations",
      {
        page: 1,
        per_page: 100,
        sort: undefined,
        order: undefined,
        search: undefined,
        overdue: "true",
      },
    );
    expect(apiClientGetMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/reports/contracts",
      {
        params: { page: 1, per_page: 100, risk_level: "high", format: "csv" },
        responseType: "blob",
      },
    );
    expect(apiClientGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/reports/matters",
      {
        params: { page: 1, per_page: 100, priority: "high", format: "csv" },
        responseType: "blob",
      },
    );
    expect(apiClientGetMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/reports/obligations",
      {
        params: { page: 1, per_page: 100, status: "open", format: "csv" },
        responseType: "blob",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/obligations/reminders/outbox/dispatch",
      {
        provider: "local",
      },
    );
    expect(apiPostMock).toHaveBeenNthCalledWith(
      4,
      "/api/v1/lex/obligations/reminders/outbox/outbox-1/dispatch",
      {
        retry: true,
      },
    );
  });

  it("constructs the workflow bulk decision route", async () => {
    apiPostMock.mockResolvedValue({
      data: {
        decision: "approve",
        requested: 2,
        succeeded: 1,
        failed: 1,
        decided_by: "user-1",
        decided_at: "2026-06-14T12:00:00Z",
        results: [],
        errors: [
          {
            workflow_instance_id: "workflow-2",
            task_id: "task-2",
            code: "task_not_pending",
            message: "Task is no longer pending.",
          },
        ],
      },
    });

    await enterpriseApi.lex.bulkDecideWorkflowTasks({
      decision: "approve",
      notes: "Bulk approved from Lex overview.",
      metadata: { source: "lex_overview" },
      items: [
        { workflow_instance_id: "workflow-1", task_id: "task-1" },
        {
          workflow_instance_id: "workflow-2",
          task_id: "task-2",
          notes: "Escalated approval",
          metadata: { priority: "high" },
        },
      ],
    });

    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/v1/lex/workflows/tasks/bulk-decision",
      {
        decision: "approve",
        notes: "Bulk approved from Lex overview.",
        metadata: { source: "lex_overview" },
        items: [
          { workflow_instance_id: "workflow-1", task_id: "task-1" },
          {
            workflow_instance_id: "workflow-2",
            task_id: "task-2",
            notes: "Escalated approval",
            metadata: { priority: "high" },
          },
        ],
      },
    );
  });

  it("constructs approval policy catalog, analytics, and recommendation routes", async () => {
    const policy = {
      id: "policy-1",
      tenant_id: "tenant-1",
      name: "Finance DoA approvals",
      description: "Finance authority matrix approvals.",
      status: "active",
      priority: 10,
      contract_type: "vendor",
      department: "finance",
      min_value: 100000,
      max_value: 500000,
      currency: "SAR",
      mode: "sequential",
      quorum: "all",
      quorum_n: null,
      approvers: [
        { type: "role", ref: "finance_director", label: "Finance Director" },
      ],
      form_fields: [
        {
          name: "business_justification",
          type: "textarea",
          label: "Business justification",
          required: true,
        },
      ],
      require_authority_evidence: true,
      required_role: "finance_director",
      required_authority_amount: 500000,
      metadata: { source: "watheeq" },
      created_by: "user-1",
      updated_by: null,
      created_at: "2026-06-14T12:00:00Z",
      updated_at: "2026-06-14T12:00:00Z",
    };
    const analytics = {
      tenant_id: "tenant-1",
      generated_at: "2026-06-14T12:30:00Z",
      total_policies: 1,
      active_policies: 1,
      draft_policies: 0,
      archived_policies: 0,
      total_routed_tasks: 8,
      active_tasks: 2,
      completed_tasks: 5,
      rejected_tasks: 1,
      cancelled_tasks: 0,
      awaiting_quorum_tasks: 1,
      average_decision_hours: 4.5,
      policies: [
        {
          policy_id: "policy-1",
          name: "Finance DoA approvals",
          status: "active",
          mode: "sequential",
          quorum: "all",
          quorum_n: null,
          require_authority_evidence: true,
          total_tasks: 8,
          active_tasks: 2,
          completed_tasks: 5,
          rejected_tasks: 1,
          cancelled_tasks: 0,
          awaiting_quorum_tasks: 1,
          average_decision_hours: 4.5,
          last_task_at: "2026-06-14T12:15:00Z",
        },
      ],
    };
    const createPayload: Parameters<
      typeof enterpriseApi.lex.createApprovalPolicy
    >[0] = {
      name: "Finance DoA approvals",
      description: "Finance authority matrix approvals.",
      status: "active",
      priority: 10,
      contract_type: "vendor",
      department: "finance",
      min_value: 100000,
      max_value: 500000,
      currency: "SAR",
      mode: "sequential",
      quorum: "all",
      quorum_n: null,
      approvers: [
        { type: "role", ref: "finance_director", label: "Finance Director" },
      ],
      form_fields: [
        {
          name: "business_justification",
          type: "textarea",
          label: "Business justification",
          required: true,
        },
      ],
      require_authority_evidence: true,
      required_role: "finance_director",
      required_authority_amount: 500000,
      metadata: { source: "watheeq" },
    };

    apiGetMock
      .mockResolvedValueOnce({ data: [policy] })
      .mockResolvedValueOnce({ data: analytics })
      .mockResolvedValueOnce({
        data: {
          policy,
          matched: true,
          reason: "Matched finance vendor contract value.",
        },
      });
    apiPostMock.mockResolvedValue({ data: policy });
    apiPatchMock.mockResolvedValue({
      data: { ...policy, name: "Updated Finance DoA approvals" },
    });
    apiDeleteMock.mockResolvedValue(undefined);

    await enterpriseApi.lex.listApprovalPolicies();
    await enterpriseApi.lex.createApprovalPolicy(createPayload);
    await enterpriseApi.lex.updateApprovalPolicy("policy-1", {
      ...createPayload,
      name: "Updated Finance DoA approvals",
    });
    await enterpriseApi.lex.archiveApprovalPolicy("policy-1");
    const analyticsResult =
      await enterpriseApi.lex.getApprovalPolicyAnalytics();
    await enterpriseApi.lex.recommendApprovalPolicy("contract-1");

    expect(apiGetMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/lex/workflow-policies/approval",
      undefined,
    );
    expect(apiPostMock).toHaveBeenCalledWith(
      "/api/v1/lex/workflow-policies/approval",
      createPayload,
    );
    expect(apiPatchMock).toHaveBeenCalledWith(
      "/api/v1/lex/workflow-policies/approval/policy-1",
      {
        ...createPayload,
        name: "Updated Finance DoA approvals",
      },
    );
    expect(apiDeleteMock).toHaveBeenCalledWith(
      "/api/v1/lex/workflow-policies/approval/policy-1",
    );
    expect(analyticsResult.total_routed_tasks).toBe(8);
    expect(apiGetMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/lex/workflow-policies/approval/analytics",
      undefined,
    );
    expect(apiGetMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/lex/workflow-policies/approval/recommend",
      {
        contract_id: "contract-1",
      },
    );
  });
});
