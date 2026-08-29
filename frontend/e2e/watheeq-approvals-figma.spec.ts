import { expect, test, type Page, type Route } from "@playwright/test";
import { mintE2EToken, signInWithToken } from "./e2e-auth";

const permissions = [
  "lex:request:view",
  "lex:request:approve",
  "lex:escalation:view",
  "lex:escalation:manage",
  "workflow:write",
];
const user = {
  id: "bbbbbbbb-0000-4000-8000-000000000010",
  tenant_id: "aaaaaaaa-0000-4000-8000-000000000001",
  email: "approver@clario.dev",
  first_name: "Ahmad",
  last_name: "Mahmoud",
  status: "active",
  mfa_enabled: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-07-26T00:00:00Z",
  roles: [
    {
      id: "approval-manager",
      name: "Approval Manager",
      slug: "approval-manager",
      permissions,
    },
  ],
};
const request = {
  id: "11111111-1111-4111-8111-111111111101",
  tenant_id: user.tenant_id,
  request_number: "REQ-2026-089",
  request_type: "contract_review",
  service_id: "service-contract",
  title: { en: "NDA review — SABIC", ar: "مراجعة اتفاقية سابك" },
  description: "Review the mutual NDA before signature.",
  requester_user_id: "requester-1",
  requester_name: "Sarah Al-Jamri",
  department: "Procurement",
  priority: "urgent",
  status: "pending_provider_approval",
  requester_approval_required: true,
  provider_approval_required: true,
  workflow_instance_id: "workflow-1",
  metadata: {},
  created_by: "requester-1",
  created_at: "2026-07-25T09:00:00Z",
  updated_at: "2026-07-26T09:00:00Z",
};
const task = {
  id: "task-1",
  tenant_id: user.tenant_id,
  instance_id: "workflow-1",
  step_id: "provider-approval",
  name: "Legal manager approval",
  description: "",
  status: "pending",
  assignee_id: user.id,
  assignee_role: "approval-manager",
  sla_deadline: "2026-07-27T09:00:00Z",
  sla_breached: false,
  priority: 1,
  metadata: {},
  completed_at: null,
  created_at: "2026-07-25T09:00:00Z",
  updated_at: "2026-07-25T09:00:00Z",
  can_decide: true,
};
const clock = {
  id: "clock-1",
  tenant_id: user.tenant_id,
  legal_request_id: request.id,
  service_code: "CONTRACT_REVIEW",
  priority: "urgent",
  clock_started_at: "2026-07-20T09:00:00Z",
  ack_due_at: "2026-07-20T13:00:00Z",
  turnaround_due_at: "2026-07-21T09:00:00Z",
  escalation_l1_due_at: "2026-07-21T10:00:00Z",
  escalation_l2_due_at: "2026-07-22T09:00:00Z",
  escalation_l3_due_at: "2026-07-23T09:00:00Z",
  ack_done: false,
  escalation_level: 2,
  breached: true,
  outcome: "breached",
  resolved_at: null,
  metadata: { request_number: request.request_number },
  created_at: "2026-07-20T09:00:00Z",
  updated_at: "2026-07-26T09:00:00Z",
  evaluated_at: "2026-07-26T09:00:00Z",
  next_escalation_level: 3,
  next_escalation_recipient: "Legal Director",
  ack_overdue: true,
  ack_risk: true,
  breach_imminent: false,
  escalation_imminent: true,
};

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function setup(page: Page, baseURL?: string) {
  const token = mintE2EToken({
    userId: user.id,
    email: user.email,
    roles: ["approval-manager"],
    permissions,
  });
  await signInWithToken(page, baseURL, token);
  await page.route("**/api/auth/session", (route) =>
    json(route, {
      access_token: token,
      expires_at: "2099-01-01T00:00:00Z",
      tenant: {
        id: user.tenant_id,
        name: "Clario Legal",
        slug: "clario-legal",
        status: "active",
        subscription_tier: "enterprise",
        settings: {},
      },
      user,
    }),
  );
  await page.route("**/api/v1/lex/me", (route) =>
    json(route, {
      data: {
        user_id: user.id,
        tenant_id: user.tenant_id,
        active_legal_role: {
          slug: "approval-manager",
          name_en: "Approval Manager",
          name_ar: "مدير الموافقات",
          tier: "Manager",
          escalation_level: 2,
        },
        available_legal_roles: [],
        effective_permissions: permissions,
        permission_version: "approval-e2e",
        persona_landing: "/lex/approvals/requests",
        capabilities: {},
        access_state: "READY",
      },
    }),
  );
  await page.route("**/api/v1/users*", (route) =>
    json(route, {
      data: [
        {
          id: "manager-2",
          first_name: "Yasmin",
          last_name: "Farooq",
          email: "yasmin@clario.dev",
          status: "active",
          roles: [],
        },
      ],
      meta: { page: 1, per_page: 100, total: 1, total_pages: 1 },
    }),
  );
  await page.route("**/api/v1/lex/service-catalog*", (route) =>
    json(route, {
      data: [
        {
          id: "service-contract",
          code: "CONTRACT_REVIEW",
          request_type: "contract_review",
          name: { en: "Contract Review", ar: "مراجعة العقود" },
        },
      ],
      meta: { page: 1, per_page: 100, total: 1, total_pages: 1 },
    }),
  );
  await page.route("**/api/v1/lex/requests/*/approval/tasks", (route) =>
    json(route, { data: [task] }),
  );
  await page.route("**/api/v1/lex/legal-requests*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/${request.id}/attachments`)) {
      return json(route, { data: [] });
    }
    if (url.pathname.endsWith(`/${request.id}/audit`)) {
      return json(route, { data: [] });
    }
    if (url.pathname.endsWith(`/${request.id}`)) {
      return json(route, { data: request });
    }
    const status = url.searchParams.get("status");
    const data =
      !status ||
      status === "pending_provider_approval" ||
      status === "approved"
        ? [request]
        : [];
    return json(route, {
      data,
      meta: { page: 1, per_page: 100, total: data.length, total_pages: 1 },
    });
  });
  await page.route("**/api/v1/lex/sla/clocks*", (route) =>
    json(route, {
      data: [clock],
      meta: { page: 1, per_page: 200, total: 1, total_pages: 1 },
    }),
  );
  await page.route("**/api/v1/lex/sla/requests/*/clock", (route) =>
    json(route, { data: clock }),
  );
}

test("approval queue matches the Figma workflow surface", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL);
  await page.goto("/lex/approvals/requests?page=1");
  await expect(page.getByRole("heading", { name: "Awaiting me" })).toBeVisible();
  await expect(page.getByText("NDA review — SABIC").first()).toBeVisible();

  await page.getByRole("tab", { name: "Request approvals" }).click();
  await expect(page.getByRole("heading", { name: "Pending Approvals" })).toBeVisible();
  await expect(page.getByText("REQ-2026-089").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "View Details" })).toBeVisible();
  await expect(
    page.getByRole("searchbox", {
      name: "Search by request ID, title or client name…",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Select all requests on this page",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve Selected" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reject Selected" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});

test("approval detail includes decisions, transfer, and lifecycle", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL);
  await page.goto(`/lex/approvals/requests/${request.id}`);
  await expect(page.getByText("REQ-2026-089:", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request details" })).toBeVisible();
  await expect(page.getByText("Take action")).toBeVisible();
  await expect(page.getByText("Transfer to another manager")).toBeVisible();
  await expect(page.getByText("Lifecycle history")).toBeVisible();
});

test("escalation management renders live SLA data and actions", async ({
  page,
  baseURL,
}) => {
  await setup(page, baseURL);
  await page.goto("/lex/approvals/escalations");
  await expect(
    page.getByRole("heading", { name: "Escalation Management" }),
  ).toBeVisible();
  await expect(page.getByText("REQ-2026-089")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reassign" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Force Escalate" })).toBeVisible();
  await expect(page.getByText("Monthly Escalation Trend")).toBeVisible();
});
