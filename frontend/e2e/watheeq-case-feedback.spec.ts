import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

import { mintE2EToken, signInWithToken } from "./e2e-auth";

const TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const CLASSIFICATION_ID = "44444444-4444-4444-8444-444444444444";
const COURT_ID = "55555555-5555-4555-8555-555555555555";
const ENTITY_ID = "66666666-6666-4666-8666-666666666666";
const CONTRACT_ID = "77777777-7777-4777-8777-777777777777";
const REQUEST_ID = "88888888-8888-4888-8888-888888888888";
const TASK_ID = "99999999-9999-4999-8999-999999999999";
const WORKFLOW_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const DOCUMENT_ID = "bbbbbbbb-2222-4222-8222-222222222222";

const permissions = [
  "lex:case:view",
  "lex:case:add",
  "lex:case:edit",
  "lex:case:approve",
  "lex:case:assign",
  "lex:request:view",
  "lex:request:approve",
  "lex:contract:view",
  "lex:document:view",
  "lex:investigation:view",
  "lex:report:read",
];

const user = {
  id: USER_ID,
  tenant_id: TENANT_ID,
  email: "cases.manager@clario.dev",
  first_name: "Case",
  last_name: "Manager",
  status: "active",
  mfa_enabled: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  roles: [
    {
      id: "role-cases-manager",
      tenant_id: TENANT_ID,
      name: "Cases Manager",
      slug: "legal-cases-manager",
      permissions,
      is_system: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-08-01T00:00:00Z",
    },
  ],
};

const classification = {
  id: CLASSIFICATION_ID,
  tenant_id: TENANT_ID,
  parent_id: null,
  code: "EVICTION",
  name: { en: "Eviction", ar: "إخلاء" },
  path: [],
  is_system: true,
  active: true,
  sort: 20,
  metadata: {},
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const court = {
  id: COURT_ID,
  tenant_id: TENANT_ID,
  code: "CRT-COM-01",
  name: { en: "Configured Commercial Court", ar: "محكمة تجارية مهيأة" },
  active: true,
  is_system: false,
  sort: 1,
  metadata: {},
  created_by: USER_ID,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const storedDocument = {
  id: DOCUMENT_ID,
  tenant_id: TENANT_ID,
  title: "Eviction evidence bundle",
  type: "filing",
  description: "Filed evidence linked to the source case.",
  category: "evidence",
  confidentiality: "internal",
  current_version: 1,
  status: "active",
  tags: ["eviction", "evidence"],
  metadata: {},
  file_id: null,
  file_name: null,
  created_by: USER_ID,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

const savedCase = {
  id: CASE_ID,
  tenant_id: TENANT_ID,
  case_number: "CASE-2026-0042",
  case_type: "EVICTION",
  classification_id: CLASSIFICATION_ID,
  court_id: COURT_ID,
  court,
  request_id: REQUEST_ID,
  company_status: "plaintiff",
  title: { en: "Eviction claim", ar: "قضية إخلاء" },
  description: "Integrated browser fixture.",
  strength: null,
  status: "phase1",
  priority: "medium",
  metadata: { beneficiary_entity_id: ENTITY_ID },
  created_by: USER_ID,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  parties: [],
  hearings: [],
  tasks: [],
  documents: [],
  computed: {
    sla_outcome: null,
    sla_turnaround_due_at: null,
    days_open: 0,
    next_hearing_date: null,
    escalation_level: 0,
    open_task_count: 0,
  },
};

interface MockState {
  createdPayload: Record<string, unknown> | null;
  decisionPayload: Record<string, unknown> | null;
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function paginated(data: unknown[]) {
  return {
    data,
    meta: {
      page: 1,
      per_page: 100,
      total: data.length,
      total_pages: data.length ? 1 : 0,
    },
  };
}

async function authenticateAndMock(
  page: Page,
  baseURL: string | undefined,
  options: { emptyCourts?: boolean } = {},
): Promise<MockState> {
  const token = mintE2EToken({
    userId: USER_ID,
    email: user.email,
    fullName: "Case Manager",
    roles: ["legal-cases-manager"],
    permissions,
  });
  await signInWithToken(page, baseURL, token);

  const state: MockState = { createdPayload: null, decisionPayload: null };

  await page.route("**/api/auth/session", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await fulfillJson(route, {
      access_token: token,
      expires_at: "2099-01-01T00:00:00Z",
      tenant: {
        id: TENANT_ID,
        name: "Clario Legal",
        slug: "clario-legal",
        status: "active",
        subscription_tier: "enterprise",
        settings: {},
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
      user,
    });
  });

  await page.route("**/api/v1/lex/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/lex/me") {
      await fulfillJson(route, {
        data: {
          user_id: USER_ID,
          tenant_id: TENANT_ID,
          active_legal_role: {
            slug: "legal-cases-manager",
            name_en: "Cases Manager",
            name_ar: "مدير القضايا",
            tier: "Manager",
            org_unit: null,
            escalation_level: 1,
          },
          available_legal_roles: [],
          effective_permissions: permissions,
          permission_version: "case-feedback-e2e",
          persona_landing: "/lex/cases/control",
          capabilities: {},
          access_state: "READY",
        },
      });
      return;
    }
    if (path === "/api/v1/lex/case-classifications/selectable") {
      await fulfillJson(route, paginated([classification]));
      return;
    }
    if (
      path === `/api/v1/lex/case-classifications/${CLASSIFICATION_ID}/cascade`
    ) {
      await fulfillJson(route, {
        data: {
          classification_id: CLASSIFICATION_ID,
          code: classification.code,
          name: classification.name,
          chain: [classification],
          resolved_at: "2026-08-01T00:00:00Z",
        },
      });
      return;
    }
    if (path === "/api/v1/lex/legal-courts") {
      await fulfillJson(route, paginated(options.emptyCourts ? [] : [court]));
      return;
    }
    if (path === "/api/v1/lex/org-entities") {
      await fulfillJson(
        route,
        paginated([
          {
            id: ENTITY_ID,
            tenant_id: TENANT_ID,
            code: "LEGAL",
            name: { en: "Legal Affairs", ar: "الشؤون القانونية" },
            entity_type: "department",
            active: true,
            metadata: {},
            created_by: USER_ID,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-08-01T00:00:00Z",
          },
        ]),
      );
      return;
    }
    if (
      path === "/api/v1/lex/contracts" ||
      path === "/api/v1/lex/contracts/search"
    ) {
      await fulfillJson(
        route,
        paginated([
          {
            id: CONTRACT_ID,
            title: "Contract MSA-001",
            contract_number: "MSA-001",
            party_b_name: "Acme Vendor",
          },
        ]),
      );
      return;
    }
    if (path === "/api/v1/lex/legal-requests") {
      await fulfillJson(
        route,
        paginated([
          {
            id: REQUEST_ID,
            request_number: "REQ-2026-0042",
            request_type: "case",
            title: { en: "Case service request", ar: "طلب خدمة قضية" },
            description: "",
            requester_name: "Reem Al-Qahtani",
            status: "approved",
            priority: "normal",
            metadata: {},
            created_by: USER_ID,
            created_at: "2026-08-01T00:00:00Z",
            updated_at: "2026-08-01T00:00:00Z",
          },
        ]),
      );
      return;
    }
    if (path === "/api/v1/lex/legal-cases/intake/tasks") {
      await fulfillJson(
        route,
        paginated([
          {
            id: TASK_ID,
            name: "Approve case directive",
            description: "",
            instance_id: WORKFLOW_ID,
            step_id: "case_directive_approval",
            status: "pending",
            priority: 1,
            form_schema: [],
            form_data: null,
            sla_deadline: null,
            sla_breached: false,
            claimed_by: null,
            assignee_role: "legal-cases-manager",
            assignee_id: null,
            metadata: {
              subject_type: "legal_case",
              source: "lex_case_intake",
              case_id: CASE_ID,
              case_number: savedCase.case_number,
              submitted_by: USER_ID,
              submitted_by_name: "Reem Al-Qahtani",
              doa_authority_ref: "DOA-2026-001",
            },
            created_at: "2026-08-01T00:00:00Z",
            updated_at: "2026-08-01T00:00:00Z",
          },
        ]),
      );
      return;
    }
    if (
      path === `/api/v1/lex/legal-cases/${CASE_ID}/documents` &&
      method === "GET"
    ) {
      await fulfillJson(route, {
        data: [
          {
            id: "cccccccc-3333-4333-8333-333333333333",
            tenant_id: TENANT_ID,
            case_id: CASE_ID,
            document_id: DOCUMENT_ID,
            source: "reuse",
            category: "evidence",
            notes: "Linked evidence bundle",
            evidence_status: "submitted",
            metadata: {},
            created_by: USER_ID,
            created_at: "2026-08-01T00:00:00Z",
            document: storedDocument,
          },
        ],
      });
      return;
    }
    if (path === "/api/v1/lex/documents/repository-summary") {
      await fulfillJson(route, {
        data: {
          tenant_id: TENANT_ID,
          generated_at: "2026-08-01T00:00:00Z",
          total_documents: 1,
          by_type: { filing: 1 },
          by_status: { active: 1 },
          by_confidentiality: { internal: 1 },
          by_category: { evidence: 1 },
          folders: [],
          saved_views: [],
          taxonomy: [],
          retention: { disposition_due: 0 },
        },
      });
      return;
    }
    if (path === `/api/v1/lex/documents/${DOCUMENT_ID}/versions`) {
      await fulfillJson(route, { data: [] });
      return;
    }
    if (path === `/api/v1/lex/documents/${DOCUMENT_ID}`) {
      await fulfillJson(route, { data: storedDocument });
      return;
    }
    if (path === "/api/v1/lex/documents" && method === "GET") {
      await fulfillJson(route, paginated([storedDocument]));
      return;
    }
    if (
      path ===
        `/api/v1/lex/legal-cases/${CASE_ID}/intake/${WORKFLOW_ID}/tasks/${TASK_ID}/decision` &&
      method === "POST"
    ) {
      state.decisionPayload = request.postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, { data: { ok: true } });
      return;
    }
    if (path === "/api/v1/lex/legal-cases" && method === "POST") {
      state.createdPayload = request.postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, { data: savedCase }, 201);
      return;
    }
    if (path === "/api/v1/lex/legal-cases" && method === "GET") {
      await fulfillJson(route, paginated([]));
      return;
    }
    if (path === `/api/v1/lex/legal-cases/${CASE_ID}` && method === "GET") {
      await fulfillJson(route, { data: savedCase });
      return;
    }
    if (path.startsWith(`/api/v1/lex/legal-cases/${CASE_ID}/`)) {
      await fulfillJson(route, { data: [] });
      return;
    }

    await fulfillJson(route, paginated([]));
  });

  return state;
}

function seriousViolations(
  results: Awaited<ReturnType<AxeBuilder["analyze"]>>,
) {
  return results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
}

test.describe("Cases feedback UI integration", () => {
  test.setTimeout(180_000);

  test("creates a linked case through the canonical desktop flow", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const state = await authenticateAndMock(page, baseURL);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/lex/cases", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: "Litigation Cases" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New Case" }).click();

    const dialog = page.getByRole("dialog", { name: "Create Case" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("textbox", { name: /Title \(Arabic\)/ })
      .fill("قضية إخلاء");

    await dialog.getByRole("combobox", { name: "Classification" }).click();
    await page.getByText("Eviction", { exact: true }).click();

    await dialog
      .getByRole("combobox", { name: "Owning organisational unit" })
      .click();
    await page.getByText("Legal Affairs", { exact: true }).click();

    await dialog.getByRole("combobox", { name: "Related contract" }).click();
    await page.getByText("Contract MSA-001", { exact: true }).click();
    await dialog
      .getByRole("combobox", { name: "Related legal request" })
      .click();
    await page.getByText("Case service request", { exact: true }).click();

    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByLabel("Court number")).toHaveCount(0);
    await dialog.getByRole("combobox", { name: "Competent court" }).click();
    await page
      .getByText("Configured Commercial Court", { exact: true })
      .click();

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(seriousViolations(accessibility)).toEqual([]);

    await dialog.getByRole("button", { name: "Create case" }).click();
    await expect.poll(() => state.createdPayload).not.toBeNull();
    expect(state.createdPayload).toMatchObject({
      case_type: "EVICTION",
      classification_id: CLASSIFICATION_ID,
      contract_id: null,
      request_id: REQUEST_ID,
      court_id: COURT_ID,
      status: "intake",
    });
    await expect(page).toHaveURL(new RegExp(`/lex/cases/${CASE_ID}$`));
    expect(pageErrors).toEqual([]);
  });

  test("decides an assigned Phase-1 case in place without navigation", async ({
    page,
    baseURL,
  }) => {
    const state = await authenticateAndMock(page, baseURL);
    await page.goto(`/lex/cases/${CASE_ID}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    const originalPath = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Review decision" }).click();
    const dialog = page.getByRole("dialog", {
      name: `Decision · ${savedCase.case_number}`,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByLabel("Delegation-of-authority reference"),
    ).toHaveValue("DOA-2026-001");
    await dialog
      .getByLabel("Notes")
      .fill("Evidence reviewed in the source case.");
    await dialog.getByRole("button", { name: "Submit decision" }).click();

    await expect.poll(() => state.decisionPayload).not.toBeNull();
    expect(state.decisionPayload).toMatchObject({
      decision: "approve",
      notes: "Evidence reviewed in the source case.",
      authority_evidence: {
        role: "legal-cases-manager",
        evidence_id: "DOA-2026-001",
        source: "case_intake",
      },
    });
    await expect(dialog).toBeHidden();
    expect(new URL(page.url()).pathname).toBe(originalPath);
  });

  test("opens a linked case record in Documents by exact document id", async ({
    page,
    baseURL,
  }) => {
    await authenticateAndMock(page, baseURL);
    await page.goto(`/lex/cases/${CASE_ID}?tab=documents`, {
      waitUntil: "domcontentloaded",
    });

    const openInDocuments = page.getByRole("link", {
      name: "Open in Documents",
    });
    await expect(openInDocuments).toBeVisible({ timeout: 20_000 });
    await expect(openInDocuments).toHaveAttribute(
      "href",
      `/lex/documents?document=${DOCUMENT_ID}`,
    );
    await openInDocuments.click();

    await expect(page).toHaveURL(
      new RegExp(`/lex/documents\\?document=${DOCUMENT_ID}$`),
      { timeout: 120_000 },
    );
    await expect(
      page.getByRole("dialog", { name: new RegExp(storedDocument.title) }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByPlaceholder("Search legal documents...")).not.toHaveValue(
      DOCUMENT_ID,
    );
  });

  test("uses the approved Documents wording in the Arabic RTL case tab", async ({
    page,
    baseURL,
  }) => {
    await authenticateAndMock(page, baseURL);
    await page.context().addCookies([
      {
        name: "clario360_locale",
        value: "ar",
        domain: "localhost",
        path: "/",
        sameSite: "Lax",
      },
    ]);

    await page.goto(`/lex/cases/${CASE_ID}?tab=documents`, {
      waitUntil: "domcontentloaded",
    });

    const documentsPanel = page.getByRole("tabpanel", { name: /المستندات/ });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      documentsPanel.getByRole("button", { name: /^في المستندات 1$/ }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      documentsPanel.getByText("مرتبطة بالمستندات", { exact: true }),
    ).toBeVisible();
    await expect(
      documentsPanel.getByRole("link", { name: "فتح في المستندات" }),
    ).toBeVisible();
    await expect(documentsPanel.getByText(/مستودع|المستودع/)).toHaveCount(0);
  });

  test("keeps the Arabic mobile creation flow RTL, accessible, and overflow-free", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await authenticateAndMock(page, baseURL, { emptyCourts: true });
    await page.context().addCookies([
      {
        name: "clario360_locale",
        value: "ar",
        domain: "localhost",
        path: "/",
        sameSite: "Lax",
      },
    ]);

    await page.goto("/lex/cases", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", { level: 1, name: "قضايا التقاضي" }),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "قضية جديدة" }).click();

    const dialog = page.getByRole("dialog", { name: "إنشاء قضية" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: /العنوان \(عربي\)/ }),
    ).toHaveAttribute("dir", "rtl");
    await expect
      .poll(() =>
        dialog.evaluate((element) => getComputedStyle(element).direction),
      )
      .toBe("rtl");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);

    await dialog
      .getByRole("textbox", { name: /العنوان \(عربي\)/ })
      .fill("قضية إخلاء");
    await dialog.getByRole("combobox", { name: "التصنيف" }).click();
    await page.getByText("إخلاء", { exact: true }).click();
    await dialog
      .getByRole("combobox", { name: "الوحدة التنظيمية المالكة" })
      .click();
    await page.getByText("الشؤون القانونية", { exact: true }).click();
    await dialog.getByRole("button", { name: "التالي" }).click();
    await dialog.getByRole("combobox", { name: "المحكمة المختصة" }).click();
    await expect(
      page.getByText(
        "لم تُهيّأ محاكم بعد. اطلب من المسؤول إضافة دليل المحاكم.",
      ),
    ).toBeVisible();

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(seriousViolations(accessibility)).toEqual([]);
  });
});
