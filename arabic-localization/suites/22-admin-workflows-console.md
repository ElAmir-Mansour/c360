# Arabic Localization Reference — Admin, Workflows & Platform Console

**Scope:** `/admin/**` (users, roles, tenants, audit, billing, api-keys, invitations, notifications, ai-governance, automation, integrations, settings), `/admin/workflows/**`, top-level `/workflows/**`, and `/console/platform/**`.

**Source root:** `frontend/src/app/(dashboard)/`

**Cross-referenced bundles / resolvers:**
- `admin/_lib/admin-i18n.ts` — `useAdminT()`, a full bilingual (en/ar) tree with groups: `common, users, roles, audit, aiGovernance, apiKeys, billing, invitations, notifications, tenants, settings, workflows`.
- `admin/integrations/_lib/integrations-i18n.ts` — `useIntegrationsT()` (`INTEGRATIONS_I18N`), full bilingual (en/ar).
- `src/lib/i18n/messages.ts` — global catalog behind `useT()` / `useT(ns)`. The console uses the `platformConsole.*` namespace (full en + ar).
- `src/components/providers/locale-provider.tsx` — `useT`, `useLocale`, `useLocaleOrDefault`, `useBilingual`.

---

## CRITICAL FINDING — Keying map (read first)

The bilingual bundles exist, but **most of this scope does not consume them.** Status by route:

| Route group | i18n mechanism actually wired | Status |
|---|---|---|
| `/admin/users/**` | `useAdminT().users` | KEYED (ar exists) — plus hardcoded pockets (form placeholders) |
| `/admin/roles/**` | `useAdminT().roles` | KEYED (ar exists) — plus hardcoded pockets |
| `/admin/audit/**` (dashboard/list/verify/export/partitions/charts) | `useAdminT().audit` | KEYED (ar exists) on 8 components; log-detail / timeline / columns / filters / detail-panel / verify-dialog / json-diff **HARDCODED** |
| `/admin/ai-governance/**` | `useAdminT().aiGovernance` on **page.tsx only** | Mostly **HARDCODED** — the ~25 `_components` (dialogs, charts, columns, validate/*) do NOT consume the bundle |
| `/admin/integrations/**` | `useIntegrationsT()` (7 files) | KEYED (ar exists) — most complete route in scope |
| `/admin/tenants/**` | none | **HARDCODED** (bundle `tenants` group is orphaned/unused) |
| `/admin/billing/**` | none | **HARDCODED** (bundle `billing` group orphaned) |
| `/admin/api-keys/**` | none | **HARDCODED** (bundle `apiKeys` group orphaned) |
| `/admin/invitations/**` | none | **HARDCODED** (bundle `invitations` group orphaned) |
| `/admin/notifications/**` | none | **HARDCODED** (bundle `notifications` group orphaned) |
| `/admin/automation/**` | none | **HARDCODED** |
| `/admin/settings/**` | none | **HARDCODED** (bundle `settings` group orphaned) |
| `/admin/workflows/**` | none (designer uses `useLocaleOrDefault` for RTL + inline `isAr?` ternaries in some files) | **HARDCODED** (bundle `workflows` group orphaned); designer has scattered inline en/ar |
| `/workflows/**` (top-level) | none | **HARDCODED** end-to-end |
| `/console/platform/**` | `useT()` → `platformConsole.*` | KEYED (ar exists) — plus hardcoded pockets (data-catalog labels, some dialogs) |

**Orphaned bundle groups** (translated Arabic already written but not rendered): `admin-i18n.ts` → `apiKeys, billing, invitations, notifications, tenants, settings, workflows` and the `aiGovernance` group beyond `page.tsx`. Wiring these existing bundles into the components is the fastest path to coverage for those routes; the English/Arabic strings are largely already authored there (see `admin-i18n.ts`).

`Status` legend used below: `key: <bundle.path>` = resolves through a bundle (ar present unless noted); `HARDCODED` = inline English literal, no i18n; `HARDCODED (en+ar inline)` = inline literal with a hand-written Arabic sibling (ternary or `{en,ar}`), not in a central bundle; `data-driven` = value from API/seed (needs backend localization).

---

# PART A — Top-level `/workflows/**` (fully HARDCODED)

_Module bundle: none. Shared child components live under `src/components/workflows/*` (out of this path — see Coverage)._

### Route: /workflows — `workflows/page.tsx` + `workflows-page-client.tsx`
_Module bundle: none_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › metadata.title | system | Workflows | HARDCODED |
| 2 | client › PageHeader.eyebrow | breadcrumb | Process Orchestration | HARDCODED |
| 3 | client › PageHeader.title | heading | Workflows | HARDCODED |
| 4 | client › PageHeader.description | subheading | Monitor workflow instances across your organization. | HARDCODED |
| 5 | client › header tag | badge | `{n} active` | HARDCODED (interpolated) |
| 6 | client › header tag | badge | `{n} failed` | HARDCODED |
| 7 | client › Start button | button | Start Workflow | HARDCODED |
| 8 | client › KpiCard | label | Active Workflows | HARDCODED |
| 9 | client › KpiCard | label | 24h Success Rate | HARDCODED |
| 10 | client › KpiCard.description | body | `{n} settled in last 24h` | HARDCODED |
| 11 | client › KpiCard | label | Open Tasks | HARDCODED |
| 12 | client › KpiCard | label | Failed Workflows | HARDCODED |
| 13 | client › SearchInput | placeholder | Search workflows... | HARDCODED |
| 14 | client › retry mutation | toast | Workflow retry initiated. | HARDCODED |
| 15 | client › error branch | error | Failed to load workflows | HARDCODED |
| 16 | client › WorkflowCancelDialog fallback | body | Workflow | HARDCODED |

### Route: /workflows/definitions — `definitions-browser-client.tsx`
_Module bundle: none_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader.eyebrow | breadcrumb | Process Orchestration | HARDCODED |
| 2 | PageHeader.title (loading/error) | heading | Browse Workflows | HARDCODED |
| 3 | PageHeader.description (loading) | subheading | Explore and start available workflow processes. | HARDCODED |
| 4 | PageHeader.description (main) | subheading | Explore available workflow processes and start new instances. | HARDCODED |
| 5 | header tag | badge | `{n} available` | HARDCODED |
| 6 | header tag | badge | `{n} categories` | HARDCODED |
| 7 | Start button | button | Start Workflow | HARDCODED |
| 8 | KpiCard | label | Available Workflows | HARDCODED |
| 9 | KpiCard | label | Categories | HARDCODED |
| 10 | KpiCard | label | Total Runs | HARDCODED |
| 11 | search Input | placeholder | Search workflows... | HARDCODED |
| 12 | category Select | placeholder | All categories | HARDCODED |
| 13 | category option (all) | option | All Categories | HARDCODED |
| 14 | category options | option | approval, onboarding, review, escalation, notification, data_pipeline, compliance, custom (rendered via `titleCase`) | HARDCODED (enum) |
| 15 | results count | body | `{n} workflow(s) available` | HARDCODED (pluralized) |
| 16 | empty state | empty-state | No workflows match your search. | HARDCODED |
| 17 | DefinitionCard › no-desc | body | No description. | HARDCODED |
| 18 | DefinitionCard › steps | body | `{n} step(s)` | HARDCODED (pluralized) |
| 19 | DefinitionCard › runs | body | `{n} run(s)` | HARDCODED (pluralized) |
| 20 | DefinitionCard › version | body | `v{n}` | HARDCODED |
| 21 | DefinitionCard button | button | View Details | HARDCODED |
| 22 | DefinitionCard button | button | Start | HARDCODED |
| 23 | error state | error | Failed to load workflow definitions | HARDCODED |
| 24 | StatusBadge / category badge | badge | (status + category via `titleCase` / `workflowDefinitionStatusConfig`) | data-driven / status-config |

### Route: /workflows/tasks — `tasks-page-client.tsx`
_Module bundle: none_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader.eyebrow | breadcrumb | Process Orchestration | HARDCODED |
| 2 | PageHeader.title | heading | My Tasks | HARDCODED |
| 3 | PageHeader.description | subheading | Tasks assigned to you across all workflows. | HARDCODED |
| 4 | header tag | badge | `{n} pending` | HARDCODED |
| 5 | header tag | badge | `{n} overdue` | HARDCODED |
| 6 | KpiCard | label | Pending | HARDCODED |
| 7 | KpiCard | label | Claimed by Me | HARDCODED |
| 8 | KpiCard | label | Overdue | HARDCODED |
| 9 | KpiCard | label | Escalated | HARDCODED |
| 10 | SearchInput | placeholder | Search tasks... | HARDCODED |
| 11 | claim mutation | toast | Task claimed. | HARDCODED |
| 12 | claim 409 | error | This task was claimed by someone else. | HARDCODED |
| 13 | claim 403 | error | You don't have the required role to claim this task. | HARDCODED |
| 14 | claim fail | error | Failed to claim task. | HARDCODED |
| 15 | error state | error | Failed to load tasks | HARDCODED |
| — | TaskStatusTabs / filters / columns | tab/table-header | (from `src/components/workflows/*` — see Coverage) | HARDCODED (shared) |

### Route: /workflows/tasks/[id] — `task-detail-page-client.tsx`
_Module bundle: none_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | back link | link | Back to My Tasks | HARDCODED |
| 2 | PageHeader.eyebrow | breadcrumb | Process Orchestration | HARDCODED |
| 3 | header tags | badge | (task.status / priorityLabel / sla.text) | data-driven / util |
| 4 | draft banner | body | `Draft restored from {datetime}.` | HARDCODED |
| 5 | draft discard | button | Discard draft | HARDCODED |
| 6 | claimed-by-other notice | body | This task is claimed by {name}. You are viewing in read-only mode. | HARDCODED |
| 7 | completed notice | body | This task has been {status}. Showing submitted data. | HARDCODED |
| 8 | unclaimed restricted | empty-state | This task is currently unclaimed and restricted to the required role. | HARDCODED |
| 9 | form heading | heading | Task Form | HARDCODED |
| 10 | no-form notice | empty-state | No form fields required for this task. | HARDCODED |
| 11 | action button | button | Reject | HARDCODED |
| 12 | action button | button | Delegate | HARDCODED |
| 13 | action button | button | Save Draft | HARDCODED |
| 14 | action button | button | Complete ✓ | HARDCODED |
| 15 | comments heading | heading | `Comments ({n})` | HARDCODED |
| 16 | comments empty | empty-state | No comments yet. | HARDCODED |
| 17 | comment textarea | placeholder | Add a comment... | HARDCODED |
| 18 | error state | error | Task not found or failed to load. | HARDCODED |
| 19 | priority fallback (`PRIORITY_LABELS`) | badge | Normal | HARDCODED (from `lib/workflow-utils`) |

### Route: /workflows/[id] — `workflow-instance-page-client.tsx`
_Module bundle: none_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | back link | link | Back to Workflows | HARDCODED |
| 2 | PageHeader.eyebrow | breadcrumb | Process Orchestration | HARDCODED |
| 3 | PageHeader.title fallback | heading | Workflow Instance | HARDCODED |
| 4 | PageHeader.description | body | `Started {datetime}` / `by {name}` | HARDCODED |
| 5 | header tag | badge | (titleCase(status)) | data-driven |
| 6 | action button | button | Suspend | HARDCODED |
| 7 | action button | button | Cancel Workflow | HARDCODED |
| 8 | action button | button | Retry | HARDCODED |
| 9 | action button | button | Resume | HARDCODED |
| 10 | retry toast | toast | Workflow retry initiated. | HARDCODED |
| 11 | retry error | toast | Failed to retry workflow. | HARDCODED |
| 12 | suspend toast | toast | Workflow suspended. | HARDCODED |
| 13 | suspend error | toast | Failed to suspend workflow. | HARDCODED |
| 14 | resume toast | toast | Workflow resumed. | HARDCODED |
| 15 | resume error | toast | Failed to resume workflow. | HARDCODED |
| 16 | error state | error | Failed to load workflow instance | HARDCODED |
| 17 | cancel dialog fallback | body | Workflow | HARDCODED |

### Route: /workflows/error.tsx & loading states
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | error.tsx › RouteError segment | error | Workflows | HARDCODED |
| 2 | loading.tsx / definitions/loading / tasks/loading | system | (skeletons, no visible text) | n/a |

---

# PART B — `/admin/workflows/**` (HARDCODED; bundle `workflows` group orphaned)

_Module bundle: `admin/_lib/admin-i18n.ts` (`workflows` group EXISTS with ar, but is NOT imported by these files). Designer chrome uses `useLocaleOrDefault` for RTL only._

### Route: /admin/workflows/analytics — `page.tsx` + `_components/*`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › PageHeader.title | heading | Workflow Analytics | HARDCODED |
| 2 | page › PageHeader.description | subheading | Monitor workflow execution health, task workload, and definition usage. | HARDCODED |
| 3 | workflow-kpi-cards | label | Total Instances | HARDCODED |
| 4 | workflow-kpi-cards | label | Running | HARDCODED |
| 5 | workflow-kpi-cards | label | Completed | HARDCODED |
| 6 | workflow-kpi-cards | label | Failed | HARDCODED |
| 7 | workflow-kpi-cards | label | Pending Tasks | HARDCODED |
| 8 | workflow-kpi-cards | label | Overdue Tasks | HARDCODED |
| 9 | instance-status-chart | heading | Instances by Status | HARDCODED |
| 10 | task-workload-table | table-header | (columns — see follow-up; not fully read) | HARDCODED (assumed) |

### Route: /admin/workflows/operations — `page.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader.eyebrow | breadcrumb | Workflow administration | HARDCODED |
| 2 | PageHeader.title | heading | Workflow Operations | HARDCODED |
| 3 | PageHeader.description | subheading | Operate trigger replays, SLA escalation policies, business calendars, and tenant LLM credentials. | HARDCODED |
| 4 | MetricCard | label | Trigger executions | HARDCODED |
| 5 | MetricCard.detail | body | Replayable evaluation log | HARDCODED |
| 6 | MetricCard | label | Failed triggers | HARDCODED |
| 7 | MetricCard | label | SLA policies | HARDCODED |
| 8 | MetricCard.detail | body | Tenant and definition scoped | HARDCODED |
| 9 | MetricCard | label | Calendars | HARDCODED |
| 10 | MetricCard.detail | body | Business-time controls | HARDCODED |
| 11 | Card | heading | Trigger Executions | HARDCODED |
| 12 | Card | subheading | Inspect workflow trigger decisions and replay known-good trigger payloads. | HARDCODED |
| 13 | Card | subheading | Define reminder and escalation tiers using business time. | HARDCODED |
| 14 | button | button | Cancel edit | HARDCODED |
| 15 | Card | heading | SLA Policy Catalog | HARDCODED |
| 16 | Card | subheading | Load existing policies into the editor or retire obsolete policies. | HARDCODED |
| 17 | Card | subheading | Define weekday windows and holidays used for SLA calculations. | HARDCODED |
| 18 | Card | heading | Business Calendars | HARDCODED |
| 19 | Card | subheading | Reuse calendars across task SLA policies. | HARDCODED |
| 20 | Card | heading | Tenant LLM Credential | HARDCODED |
| 21 | Card | subheading | Store or rotate the write-only API key used by workflow AI helpers and shared LLM resolution. | HARDCODED |
| 22 | MetricCard | label | Configured / Enabled / Model / Last rotated | HARDCODED |
| 23 | MetricCard values | body | Yes / No / Never / `Version {n}` / No credential status available / Write-only key store / Key value is never returned | HARDCODED |
| 24 | toast | toast | Trigger execution replay started | HARDCODED |
| 25 | toast | toast | SLA policy deleted | HARDCODED |
| 26 | toast | toast | Calendar deleted | HARDCODED |
| 27 | toast | toast | LLM credential saved | HARDCODED |
| 28 | toast | toast | LLM credential rotated | HARDCODED |
| 29 | toast | toast | LLM credential removed | HARDCODED |

### Route: /admin/workflows/definitions — `page.tsx` + `components/definition-list.tsx` + `_components/definition-kpi-cards.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | definition-list › PageHeader.title | heading | Workflow Definitions | HARDCODED |
| 2 | definition-list › PageHeader.description | subheading | Design and manage workflow definitions. | HARDCODED |
| 3 | definition-list › search | placeholder | Search definitions... | HARDCODED |
| 4 | definition-list › action | button | Delete Definition | HARDCODED |
| 5 | definition-list › action | button | Publish Definition | HARDCODED |
| 6 | definition-list › action | button | Archive Definition | HARDCODED |
| 7 | definition-kpi-cards | label | Active Definitions | HARDCODED |
| 8 | definition-kpi-cards.description | body | Published and available to run | HARDCODED |
| 9 | definition-kpi-cards | label | Recent Edits | HARDCODED |
| 10 | definition-kpi-cards.description | body | Updated in the last 7 days | HARDCODED |
| 11 | definition-kpi-cards | label | Avg Exec Time | HARDCODED |
| 12 | definition-kpi-cards.description | body | Across recent completed runs | HARDCODED |
| 13 | definition-columns | table-header | (columns — not fully read) | HARDCODED (assumed) |

### Route: /admin/workflows/definitions/[defId] — `components/definition-detail.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader.eyebrow | breadcrumb | Process Orchestration | HARDCODED |
| 2 | instances tab search | placeholder | Search instances... | HARDCODED |
| — | remaining chrome (tabs, buttons, meta labels) | mixed | (not fully read — file ~500 lines) | HARDCODED (assumed) |

### Route: /admin/workflows/definitions/[defId]/designer — `designer-page-client.tsx` + `components/*`
_Designer uses `useLocaleOrDefault()` for RTL/`direction`; some components hard-code English, some carry inline en/ar._

**canvas-toolbar.tsx**
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Undo button | aria-label / tooltip | Undo (Ctrl+Z) | HARDCODED |
| 2 | Redo button | aria-label / tooltip | Redo (Ctrl+Shift+Z) | HARDCODED |
| 3 | Zoom out | aria-label / tooltip | Zoom Out | HARDCODED |
| 4 | Zoom in | aria-label / tooltip | Zoom In | HARDCODED |
| 5 | Fit | aria-label / tooltip | Fit to Screen | HARDCODED |
| 6 | Auto layout | aria-label / tooltip | Auto Layout | HARDCODED |
| 7 | Save button | button | Save Draft | HARDCODED |
| 8 | Publish button | button | Publish | HARDCODED |
| 9 | HelpTip.title | tooltip | Designing a workflow / تصميم سير العمل | HARDCODED (en+ar inline) |
| 10 | HelpTip.content | tooltip | Add steps to the canvas and connect them… (full en + full ar present) | HARDCODED (en+ar inline) |

**step-palette.tsx** — inline `isAr ? ar : en` throughout (Arabic already written inline)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | header | heading | Step Palette (ar: لوحة الخطوات) | HARDCODED (en+ar inline) |
| 2 | header hint | body | Drag or click to add steps (ar: اسحب أو انقر لإضافة خطوات) | HARDCODED (en+ar inline) |
| 3 | group | label | Human Tasks (المهام البشرية) | HARDCODED (en+ar inline) |
| 4 | group | label | Automation (الأتمتة) | HARDCODED (en+ar inline) |
| 5 | group | label | Flow Control (التحكم في المسار) | HARDCODED (en+ar inline) |
| 6 | item | label | Approval (موافقة) | HARDCODED (en+ar inline) |
| 7 | item | label | Approval Chain (سلسلة الموافقات) | HARDCODED (en+ar inline) |
| 8 | item | label | Review (مراجعة) | HARDCODED (en+ar inline) |
| 9 | item | label | Task (مهمة) | HARDCODED (en+ar inline) |
| 10 | item | label | Notification (إشعار) | HARDCODED (en+ar inline) |
| 11 | item | label | Webhook (ويب هوك) | HARDCODED (en+ar inline) |
| 12 | item | label | Script (برنامج نصي) | HARDCODED (en+ar inline) |
| 13 | item | label | Sub-workflow (سير عمل فرعي) | HARDCODED (en+ar inline) |
| 14 | item | label | Condition (شرط) | HARDCODED (en+ar inline) |
| 15 | item | label | Parallel Fork (تفرع متوازٍ) | HARDCODED (en+ar inline) |
| 16 | item | label | Parallel Join (دمج متوازٍ) | HARDCODED (en+ar inline) |
| 17 | item | label | Delay (تأخير) | HARDCODED (en+ar inline) |
| 18 | item | label | End (نهاية) | HARDCODED (en+ar inline) |

**properties-panel.tsx** (partially surveyed via grep)
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | field | label | Approval Type | HARDCODED |
| 2 | option | option | Single Approver | HARDCODED |
| 3 | field | label | Min Approvers | HARDCODED |
| 4 | input | placeholder | Template name or ID | HARDCODED |
| 5 | field | label | Body Template | HARDCODED |
| 6 | field | label | Assignee Strategy | HARDCODED |
| 7 | option | option | Specific User | HARDCODED |
| 8 | option | option | By Role | HARDCODED |
| 9 | option | option | Round Robin | HARDCODED |
| 10 | option | option | Least Loaded | HARDCODED |
| 11 | input | placeholder | User ID | HARDCODED |
| 12 | input | placeholder | Role ID | HARDCODED |
| 13 | input | placeholder | No timeout | HARDCODED |
| 14 | field | label | On Timeout | HARDCODED |
| — | rest of panel (~640 lines) | mixed | not fully enumerated | HARDCODED (follow-up) |

**Other designer components (grep-surfaced placeholders; not fully read):**
`form-schema-builder.tsx` placeholders: Label, Placeholder, Description, Default value, Direction, AR, EN, Error (AR), Error (EN) — all HARDCODED. `simulate-config-dialog.tsx` placeholder `Select…` HARDCODED. `approval-chain-editor.tsx`, `condition-builder.tsx`, `trigger-config-editor.tsx`, `variables-editor.tsx`, `version-browser-modal.tsx`, `simulate-result-modal.tsx`, `rf-step-node.tsx`, `step-node.tsx`, `properties-panel.tsx` (remainder) — HARDCODED chrome, follow-up needed.

### Route: /admin/workflows/instances — `components/instances-list.tsx`, `start-workflow-dialog.tsx`, `[instanceId]/components/instance-detail.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | instance-detail › PageHeader.eyebrow | breadcrumb | Process Orchestration | HARDCODED |
| 2 | start-workflow-dialog › search | placeholder | Search definitions... | HARDCODED |
| — | instances-list / admin-instance-columns / instance-progress / step-history | table-header/body | not fully read | HARDCODED (follow-up) |

### Route: /admin/workflows/tasks — `components/*`, `[id]/admin-task-detail-client.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | admin-task-detail | heading | Task Form | HARDCODED |
| 2 | admin-task-detail | heading | Task Info | HARDCODED |
| 3 | admin-task-detail | label | Required Role | HARDCODED |
| 4 | task-detail-panel | placeholder | User ID | HARDCODED |
| — | admin-task-list / task-form-renderer chrome | mixed | task-form-renderer resolves DATA-DRIVEN field labels via `resolveLocalized`; its own chrome not fully read | HARDCODED (follow-up) |

### Route: /admin/workflows/forms — `page.tsx` + `_components/form-definition-dialog.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › PageHeader.title | heading | Forms | HARDCODED |
| 2 | page › error | error | Failed to load forms | HARDCODED |
| 3 | page › empty | empty-state | No forms yet | HARDCODED |
| 4 | page › delete dialog | modal-title | Delete Form | HARDCODED |
| — | form-definition-dialog (imports `getMessages`/`getLocaleDirection`) | mixed | builds bilingual field schema for data forms; own chrome not fully read | HARDCODED (follow-up) |

### Route: /admin/workflows/templates — `components/template-gallery.tsx`, `template-card.tsx`, `[templateId]/template-detail-client.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | template-gallery › PageHeader.eyebrow | breadcrumb | Process Orchestration | HARDCODED |
| 2 | template-gallery › PageHeader.title | heading | Workflow Templates | HARDCODED |
| 3 | template-gallery › search | placeholder | Search templates... | HARDCODED |
| 4 | template-gallery › category Select | placeholder | Category | HARDCODED |
| — | template-card / template-detail-client | mixed | not fully read | HARDCODED (follow-up) |

---

# PART C — `/admin/**` core routes

## C.1 KEYED routes (cross-reference the bundle; Arabic already authored)

These routes render page chrome through `useAdminT()` (or `useIntegrationsT()`), so **the strings below already resolve to Arabic** via the named bundle keys. Enumerated by bundle group; verbatim English is in `admin-i18n.ts` / `integrations-i18n.ts`.

### Route: /admin/users — `users/page.tsx` + `_components/*`
_Module bundle: `admin-i18n.ts` → `users` (8 files consume `useAdminT().users`)._

| Element cluster | Type | Representative English | Status |
|---|---|---|---|
| Page header / tag | heading | User Management · Manage users, roles, and permissions · Identity & Access | key: users.title/description/tagIdentity (ar) |
| KPIs | label | Total users · Active · Pending invites | key: users.totalUsers/activeUsers/pendingInvites (ar) |
| Table columns | table-header | Name · Email · Roles · Status · MFA · Last Login | key: users.colName…colLastLogin (ar) |
| Row/bulk actions | button | Edit · Assign Roles · Suspend · Activate · Delete · Suspend Selected · Delete Selected | key: users.* (ar) |
| Create dialog | modal-title/label | Add New User · First Name · Last Name · Email Address · Password · Initial Status · Assign Roles · Send welcome email… | key: users.createTitle/firstName/… (ar) |
| Password rules | validation | 12+ characters · Uppercase · Lowercase · Number · Special character | key: users.pwLength/pwUpper/… (ar) |
| Edit / detail / roles / reset / status dialogs | modal-title/body | Edit User · User Details · Assign Roles · Reset Password · Suspend User · Change Status (+ all descriptions & toasts) | key: users.* (ar) |
| Toasts | toast | User created successfully · User updated successfully · User deleted · Roles updated · Password reset email sent to {email} · etc. | key: users.* (ar) |
| Status labels | badge | Active · Suspended · Inactive · Pending | key: users.statusActive/… (ar) |
| **Hardcoded pockets** | placeholder | `John` / `Doe` (user-create-dialog first/last name placeholders) | HARDCODED |

### Route: /admin/roles — `roles/page.tsx` + `_components/*`
_Module bundle: `admin-i18n.ts` → `roles` (5 files)._

| Element cluster | Type | Representative English | Status |
|---|---|---|---|
| Page header / tag | heading | Role Management · Define roles and permissions for your organization · Role-Based Access | key: roles.title/description/tagRbac (ar) |
| KPIs / filters | label | Total roles · System roles · Custom roles · Search roles... · All | key: roles.* (ar) |
| Table columns | table-header | Role · Description · Permissions · Users · Type | key: roles.colName…colType (ar) |
| Actions | button | Edit · Duplicate · Delete · View Details · Create Role | key: roles.* (ar) |
| Form dialog | modal-title/label | Create Role / Edit Role · Role Name · Description · Permissions · Select at least one permission | key: roles.createRoleTitle/roleName/… (ar) |
| Permission groups | label | Cybersecurity · Data Intelligence · Governance — Acta · Legal — Lex · Executive — Visus · Platform Admin · Reports · Audit | key: roles.pgCyber…pgAudit (ar) |
| Permission leaves (~60) | label | Read data · Write data · Read alerts · … · Requests — view · Cases — approve · … · View audit logs | key: roles.pReadData…pViewAuditLogs (ar) |
| Detail / delete dialogs + toasts | modal/toast | System role · Custom role · Permissions ({n}) · Assigned Users ({n}) · Role created/updated/deleted · Cannot modify system roles. | key: roles.* (ar) |
| **Hardcoded pockets** | placeholder | `Search permissions...` (permission-tree.tsx) | HARDCODED |

### Route: /admin/audit — `audit/page.tsx` + `_components/*` (8 keyed) + hardcoded subroutes
_Module bundle: `admin-i18n.ts` → `audit`. Keyed: page, audit-charts, audit-dashboard, audit-export-form, audit-partitions, audit-stats-cards, audit-top-tables, audit-verify-panel._

| Element cluster | Type | Representative English | Status |
|---|---|---|---|
| Header / tabs | heading/tab | Audit Logs · Immutable record of all platform activity · WORM Compliance · Dashboard/Logs/Export/Integrity/Partitions | key: audit.title/tab* (ar) |
| Stats / charts | label | Total Events · Events Today · Unique Users · Unique Services · Events Over Time · Events by Service/Action/Severity | key: audit.stat*/chart* (ar) |
| Table columns / filters | table-header | Timestamp · Actor · Action · Resource · Status · Service · Severity (+ filter labels) | key: audit.col*/filter* (ar) |
| Verify panel | body/button | Chain-of-Custody Verification · Run Verification · Integrity Verified · Integrity Violation Detected · Records Verified · Chain broke at: | key: audit.chainOfCustody/… (ar) |
| Export form | label/button | Export Configuration · Format · From · To · Service (optional) · Columns · Export Audit Logs | key: audit.exportConfiguration/… (ar) |
| Partitions | label/button | Partition Coverage · Run Maintenance · Delete Partition · No partitions created yet. | key: audit.partitionCoverage/… (ar) |
| **Hardcoded subroutes** | mixed | `logs/[logId]/_components/log-detail.tsx` eyebrow **Audit Trail**; `timeline/[resourceId]/_components/resource-timeline.tsx` eyebrow **Audit Trail**; `audit-columns.tsx`, `audit-detail-panel.tsx`, `audit-filters.tsx`, `audit-verify-dialog.tsx`, `json-diff-viewer.tsx`, `changes-diff.tsx`, `json-viewer.tsx` | HARDCODED (follow-up) |

### Route: /admin/integrations — `page.tsx` + `_components/*` + `[id]` + `ticket-links`
_Module bundle: `admin/integrations/_lib/integrations-i18n.ts` (`useIntegrationsT`) — fully bilingual, 7 files. This is the most complete route in scope._

| Element cluster | Type | Representative English | Status |
|---|---|---|---|
| List header / KPIs | heading | External Integrations · Operate Slack, Teams, Jira, ServiceNow, and webhook connectors… · Integration Hub · Connectors/Active/Deliveries/Errors | key: pageTitle/kpi* (ar) |
| Provider readiness | body | Provider Readiness · ready · runtime config needed · Connect via OAuth · Advanced Setup | key: providerReadiness*/… (ar) |
| Configured list | body/button | Configured Integrations · View Details · Edit · Test · Retry Failed · Enable · Disable · Delete | key: configured*/edit/test/… (ar) |
| Form dialog | modal/label | Configure Integration · Provider · Name · Type · Description · Event Filters · (all connection field labels: Bot token, Signing secret, Workspace ID, Channel ID, Base URL, Project key, Instance URL, Auth type, URL, Method, Content type, Shared secret, Headers JSON, …) | key: configureIntegration/botToken/… (ar) |
| Delivery log / ticket links | table-header | Event · Attempts · Response · Latency · Next Retry · Created · Status · External Ticket · Entity · Direction · Last Synced | key: event/attempts/… (ar) |
| Detail + ticket-link detail page | modal/label | Usage · Configuration Summary · External Record · Clario Linkage · Timestamps · Last Sync Error · Back to Integration | key: usageTitle/… (ar) |
| Toasts | toast | Test completed with HTTP {code} · Re-queued {n} failed deliveries · Integration deleted · Ticket link synchronized | key: testCompleted/… (ar) |

### Route: /admin/ai-governance — `page.tsx` (keyed) + `_components/*` (HARDCODED)
_Module bundle: `admin-i18n.ts` → `aiGovernance`, but ONLY `page.tsx` consumes it._

| Element cluster | Type | Representative English | Status |
|---|---|---|---|
| Page header / KPIs / registry (page.tsx) | heading | AI Governance · Responsible AI · Total Models · In Production · Shadow Testing · Predictions 24h · Drift Alerts · Model Registry · Register Model | key: aiGovernance.title/kpi*/modelRegistry (ar) |
| **model-form-dialog.tsx** | placeholder/label | `Threat scoring classifier` · `Select suite` · `Select model type` · `Select risk tier` · `Select status` · `Explain the decision domain, intended use, and governance expectations.` · `Security Analytics` | HARDCODED |
| **version-form-dialog.tsx** | placeholder | `What changed in this model version and why it should be evaluated.` · `Select artifact type` · `Select explainability type` · `Optional human-readable explanation template.` · `Dataset provenance, scope, and labeling notes.` | HARDCODED |
| **feedback-dialog.tsx** | placeholder | `Context for auditors and model owners.` | HARDCODED |
| **rollback-dialog.tsx** | placeholder | `Explain the regression, drift issue, or governance exception.` | HARDCODED |
| **validate/page.tsx + _components** | placeholder/label | `Select a version` · `Select a dataset` · `Select a time range` · `Document the metric regressions or follow-up work required.` (+ metrics cards, confusion-matrix, roc-curve, severity/fp/fn tables) | HARDCODED |
| **benchmarks/page.tsx, benchmarks/[suiteId], compute/page.tsx** | placeholder | `Choose an inference server` (+ page chrome) | HARDCODED |
| model-columns / model-card / drift-chart / performance-chart / prediction-log-table / shadow-comparison / version-timeline / promote-dialog / explanation-viewer | mixed | not fully read | HARDCODED (follow-up) |

_Note: because only `page.tsx` calls `useAdminT`, the `aiGovernance` group's keys like `validateTitle`, `confusionMatrix`, `metricsAccuracy`, `promoteTitle`, etc. are authored (ar present) but **not wired** — wiring them closes most of this route._

## C.2 HARDCODED routes (bundle groups orphaned — strings enumerated)

### Route: /admin/billing — `billing/page.tsx` + `_components/*`
_Module bundle: `admin-i18n.ts` → `billing` group EXISTS but is NOT used. Page is forced `dir="ltr"`._

| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader.title | heading | Billing & Usage | HARDCODED |
| 2 | PageHeader.description | subheading | Workspace subscription, suite entitlements, metered usage and billing operations. | HARDCODED |
| 3 | header stats | label | Suites · Seats · Period | HARDCODED |
| 4 | action | button | Export usage | HARDCODED |
| 5 | action | button | Payment methods | HARDCODED |
| 6 | action | button/link | Licensing console | HARDCODED |
| 7 | trial banner | body | You're on a trial | HARDCODED |
| 8 | trial banner | body | Upgrade to preserve suite access and historical telemetry when the trial closes. | HARDCODED |
| 9 | trial banner | button | Upgrade now | HARDCODED |
| 10 | fallback banner | body | Tenant record pending | HARDCODED |
| 11 | fallback banner | body | Billing is rendering from the session tenant ID until the tenant details endpoint returns. | HARDCODED |
| 12 | usage banner | body | Usage telemetry pending | HARDCODED |
| 13 | usage banner | body | The tenant usage endpoint is unavailable, so live counters are shown as zero… | HARDCODED |
| 14 | BillingLedger | heading | Workspace ledger | HARDCODED |
| 15 | BillingLedger | subheading | Subscription, renewal and account ownership for this tenant. | HARDCODED |
| 16 | BillingLedger | label | Current plan · Seats · Storage · Support | HARDCODED |
| 17 | BillingLedger detail labels | label | Commercial model · Contract term · Currency · Billing owner · Usage period · Next review | HARDCODED |
| 18 | plan values | body | Free · Starter · Professional · Enterprise (TIER_LABEL) | HARDCODED (enum) |
| 19 | plan defaults | body | Community · Email support · Priority support · 24/7 success · $0 evaluation · Quote-based · Custom agreement · Monthly · Annual · Enterprise MSA | HARDCODED |
| 20 | MetricTile | label | Active users · Storage used · API calls · Suite coverage | HARDCODED |
| 21 | SectionCard | heading | Usage against allowances | HARDCODED |
| 22 | SectionCard | subheading | Live period consumption compared with tenant settings and plan defaults. | HARDCODED |
| 23 | QuotaMeter/UsageRiskCard | label | Users · Storage · API calls · Bandwidth · Enabled suites · No cap | HARDCODED |
| 24 | SuiteMatrix | heading | Product and service coverage | HARDCODED |
| 25 | SuiteMatrix | subheading | Billing alignment across the Clario360 suite entitlements and backing services. | HARDCODED |
| 26 | SuiteMatrix badges | badge | Included · Off plan · Tenant settings · `{Plan} default` | HARDCODED |
| 27 | SuiteMatrix labels | label | Calls · Users · Last active · No activity yet · Not provisioned | HARDCODED |
| 28 | Product names | body | Cyber Defense · SIEM Operations · Data Intelligence · ClarioDR Resilience · Acta Governance · Watheeq / Lex · Visus / BOSALAH (+ descriptions) | HARDCODED (catalog) |
| 29 | PlatformServicesPanel | heading | Core platform services | HARDCODED |
| 30 | PlatformServicesPanel | subheading | Always-on services that support billing, governance and operations. | HARDCODED |
| 31 | platform service names | body | IAM and tenant administration · Licensing and entitlements · Audit chain · Workflow and automation · Files and notifications | HARDCODED (catalog) |
| 32 | InvoicesPanel | heading | Invoices and payment operations | HARDCODED |
| 33 | InvoicesPanel | subheading | Enterprise billing is handled by your account team; no payment processor connector is configured… | HARDCODED |
| 34 | InvoicesPanel | badge | Account-team managed | HARDCODED |
| 35 | InvoicesPanel empty | empty-state | Billing history will appear here | HARDCODED |
| 36 | InvoicesPanel empty | empty-state | Invoices are issued in {currency} by your account team… | HARDCODED |
| 37 | SectionCard | heading | Plans | HARDCODED |
| 38 | SectionCard | subheading | Compare plans and request a change. | HARDCODED |
| 39 | empty | empty-state | No metered suite events yet | HARDCODED |
| 40 | empty | empty-state | Suite-level usage appears once users work in the provisioned products. | HARDCODED |
| 41 | loading/error header | heading | Billing & Usage · Plan, usage and quotas for your workspace. | HARDCODED |
| 42 | error | error | Tenant billing context unavailable | HARDCODED |
| 43 | error | error | The session did not include a tenant record, and the tenant lookup could not resolve one. | HARDCODED |
| 44 | toast | toast | Usage export generated | HARDCODED |
| 45 | toast | toast | Plan change requested | HARDCODED |
| 46 | toast | toast | We'll reach out about moving to the {Plan} plan. Plan changes are handled by your account team. | HARDCODED |
| 47 | toast | toast | Payment methods are managed by your account team. | HARDCODED |
| 48 | csv header row | table-header | Product · Entitlement · Enabled · API calls · Active users · Last active | HARDCODED |
| 49 | limit fallback | body | Unlimited · Current period · Account owner · Account team | HARDCODED |
| — | `_components/plan-cards.tsx`, `quota-meter.tsx` | mixed | not fully read | HARDCODED (follow-up) |

### Route: /admin/api-keys — `page.tsx` (shell) + `api-keys-client.tsx` + `_components/*`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page metadata.title | system | API Keys | HARDCODED |
| 2 | PageHeader.title | heading | API Keys | HARDCODED |
| 3 | PageHeader.description | subheading | Manage API keys for programmatic platform access | HARDCODED |
| 4 | action | button | Create API Key | HARDCODED |
| 5 | filter label | label | Status | HARDCODED |
| 6 | filter options | option | Active · Revoked · Expired | HARDCODED |
| 7 | columns | table-header | Name · Key · Scopes · Status · Last Used · Expires | HARDCODED |
| 8 | cell fallback | body | Never | HARDCODED |
| 9 | scopes overflow | body | `+{n} more` | HARDCODED |
| 10 | row action | button | Rotate | HARDCODED |
| 11 | row action | button | Revoke | HARDCODED |
| 12 | search | placeholder | Search API keys... | HARDCODED |
| 13 | empty | empty-state | No API keys yet | HARDCODED |
| 14 | empty | empty-state | Create your first API key to enable programmatic access. | HARDCODED |
| 15 | revoke dialog | modal-title | Revoke API Key | HARDCODED |
| 16 | revoke dialog | modal-body | Revoke "{name}"? Any services using this key will lose access immediately. | HARDCODED |
| 17 | revoke confirm | button | Revoke | HARDCODED |
| 18 | rotate dialog | modal-title | Rotate API Key | HARDCODED |
| 19 | rotate dialog | modal-body | Rotate the secret for "{name}"? The current secret will be immediately invalidated. | HARDCODED |
| 20 | rotate confirm | button | Rotate | HARDCODED |
| — | `_components/create-key-dialog.tsx`, `key-secret-dialog.tsx` | mixed | not fully read (name field, scopes, expiry, "copy this key now" secret reveal) | HARDCODED (follow-up) |

### Route: /admin/invitations — `page.tsx` + `_components/invite-user-dialog.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader.title | heading | Invitations | HARDCODED |
| 2 | PageHeader.description | subheading | Manage user invitations to the platform | HARDCODED |
| 3 | action | button | Invite User | HARDCODED |
| 4 | KpiCard | label | Total Sent · Pending · Accepted · Acceptance Rate | HARDCODED |
| 5 | filter label | label | Status | HARDCODED |
| 6 | filter options | option | Pending · Accepted · Expired · Cancelled · Revoked | HARDCODED |
| 7 | columns | table-header | Email · Role · Status · Invited By · Expires · Sent | HARDCODED |
| 8 | row action | button | Resend | HARDCODED |
| 9 | row action | button | Cancel | HARDCODED |
| 10 | search | placeholder | Search invitations... | HARDCODED |
| 11 | empty | empty-state | No invitations yet | HARDCODED |
| 12 | empty | empty-state | Invite users to join the platform. | HARDCODED |
| 13 | cancel dialog | modal-title | Cancel Invitation | HARDCODED |
| 14 | cancel dialog | modal-body | Cancel the invitation to {email}? They will no longer be able to accept it. | HARDCODED |
| 15 | cancel confirm | button | Cancel Invitation | HARDCODED |
| — | `invite-user-dialog.tsx` | mixed | not fully read (email/role fields, send button, success toast) | HARDCODED (follow-up) |

### Route: /admin/notifications — `page.tsx` + `components/*` + `webhooks/**`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › PageHeader.title | heading | Notification Management | HARDCODED |
| 2 | page › PageHeader.description | subheading | Monitor delivery performance, manage webhooks, and test notifications. | HARDCODED |
| 3 | action | button | Manage webhooks | HARDCODED |
| 4 | tabs | tab | Dashboard · Test | HARDCODED |
| 5 | test-notification-form | placeholder | Select type · Select webhook | HARDCODED |
| — | delivery-dashboard / delivery-charts / test-notification-form (labels, send button, toasts) | mixed | not fully read | HARDCODED (follow-up) |
| — | webhooks/page.tsx, create-webhook-dialog (`My webhook`, `Header name`, `Value`), webhook-columns, webhook-secret-dialog, webhook-settings-form, webhook-deliveries, webhook-overview | mixed | grep confirms placeholders HARDCODED; not fully read | HARDCODED (follow-up) |

### Route: /admin/automation — `automation/page.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader.eyebrow | breadcrumb | Workspace operations | HARDCODED |
| 2 | PageHeader.title | heading | Automation Engine | HARDCODED |
| 3 | PageHeader.description | subheading | Manage trigger-to-runbook automations, manual invocations, run approvals, and replay. | HARDCODED |
| 4 | MetricCard | label | Automations · Runs · Awaiting approval · Failed runs | HARDCODED |
| 5 | MetricCard.detail | body | `{n} enabled` · Latest 50 executions · Human gates open · Needs review | HARDCODED |
| 6 | tabs | tab | Automations · Runs · Runbooks | HARDCODED |
| 7 | Card | heading | Create Automation | HARDCODED |
| 8 | Card | subheading | Bind a trigger and ordered rules to a runbook. | HARDCODED |
| 9 | Field labels | label | Name · Runbook ID · Enabled · Trigger · Rules · Manual invoke payload · Steps · Approval comment | HARDCODED |
| 10 | button | button | Create automation | HARDCODED |
| 11 | Card | heading | Automation Catalog | HARDCODED |
| 12 | Card | subheading | Toggle, invoke, and retire existing automations. | HARDCODED |
| 13 | row badge | badge | enabled · disabled · trigger | HARDCODED |
| 14 | row body | body | `Runbook {id}` | HARDCODED |
| 15 | row action | button | Invoke · Disable · Enable · Delete | HARDCODED |
| 16 | empty | empty-state | No automations have been configured. | HARDCODED |
| 17 | Card | heading | Run History | HARDCODED |
| 18 | Card | subheading | Approve human gates, reject unsafe runs, or replay terminal executions from recorded inputs. | HARDCODED |
| 19 | run badge | badge | `step {n}` | HARDCODED |
| 20 | run body | body | `Automation {id} · started {datetime}` | HARDCODED |
| 21 | run action | button | Approve · Reject · Replay | HARDCODED |
| 22 | empty | empty-state | No automation runs have been recorded. | HARDCODED |
| 23 | Card | heading | Create Runbook | HARDCODED |
| 24 | Card | subheading | Runbook steps are validated by the automation service and executed in order. | HARDCODED |
| 25 | button | button | Create runbook | HARDCODED |
| 26 | Card | heading | Runbook Lookup | HARDCODED |
| 27 | Card | subheading | The backend exposes direct runbook retrieval for known IDs. | HARDCODED |
| 28 | loading | body | Loading runbook... | HARDCODED |
| 29 | empty | empty-state | Enter a runbook ID to inspect its ordered steps. | HARDCODED |
| 30 | toast | toast | Runbook created · Automation created · Automation updated · Automation deleted · Manual invocation accepted · Replay queued · Decision recorded | HARDCODED |
| 31 | run status values | badge | AWAITING_APPROVAL · COMPLETED · FAILED · ABORTED | data-driven (API enum) |
| 32 | JSON validation labels | validation | Runbook steps · Trigger · Rules · Invoke payload (parse-error field names) | HARDCODED |

### Route: /admin/settings — `page.tsx` → `_components/current-tenant-settings.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader.title | heading | Platform Settings | HARDCODED |
| 2 | PageHeader.description | subheading | Manage the active tenant configuration, branding, and platform limits using the live tenant contract. | HARDCODED |
| 3 | tenant picker | placeholder | Select tenant | HARDCODED |
| 4 | tenant picker suffix | option | ` (current)` | HARDCODED |
| 5 | action link | link | Open tenant record | HARDCODED |
| 6 | KpiCard | label | Tenant Status · Subscription · Storage Used · Active Users | HARDCODED |
| 7 | KpiCard values | body | `{n} suite(s) enabled` · Unavailable · `Limit {n} GB` · No storage limit configured · `Limit {n}` · No user limit configured | HARDCODED |
| 8 | Card | subheading | Tenant-wide settings stored in the IAM tenant record. | HARDCODED |
| 9 | Card labels | label | Tenant ID · Slug · Created · Updated | HARDCODED |
| 10 | tabs | tab | Configuration · Branding · Usage | HARDCODED |
| 11 | usage Card | heading | Tenant Usage | HARDCODED |
| 12 | usage Card | subheading | Current consumption and enabled suite footprint. | HARDCODED |
| 13 | usage KPIs | label | API Calls · Bandwidth · Enabled Suites | HARDCODED |
| 14 | usage KPI value | body | None | HARDCODED |
| 15 | suite usage | heading | Suite Usage | HARDCODED |
| 16 | suite usage | body | No recent activity | HARDCODED |
| 17 | suite usage | label | API Calls · Active Users | HARDCODED |
| 18 | suite usage empty | empty-state | Usage telemetry is not currently available for this tenant. | HARDCODED |
| 19 | error | error | Tenant context unavailable · Current tenant information is not available for this session. | HARDCODED |
| 20 | error | error | Unable to load tenant settings · The tenant configuration could not be loaded. | HARDCODED |
| — | `tenants/[tenantId]/_components/tenant-settings-form.tsx`, `tenant-branding-form.tsx` (shared into settings tabs) | mixed | not fully read (field labels, save toasts) | HARDCODED (follow-up) |

### Route: /admin/tenants — `page.tsx` + `new/page.tsx` + `[tenantId]/**`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page › PageHeader.title | heading | Tenant Management | HARDCODED |
| 2 | page › PageHeader.description | subheading | Manage tenants, plans, and provisioning | HARDCODED |
| 3 | action | button | Provision Tenant | HARDCODED |
| 4 | filter label | label | Status · Plan | HARDCODED |
| 5 | status options | option | Active · Inactive · Suspended · Trial · Onboarding · Deprovisioned | HARDCODED |
| 6 | plan options | option | Free · Starter · Professional · Enterprise | HARDCODED |
| 7 | columns | table-header | Name · Slug · Status · Plan · Created | HARDCODED |
| 8 | row actions | button | View · Edit · Suspend · Activate · Deprovision | HARDCODED |
| 9 | search | placeholder | Search tenants... | HARDCODED |
| 10 | empty | empty-state | No tenants found | HARDCODED |
| 11 | empty | empty-state | Get started by provisioning your first tenant. | HARDCODED |
| 12 | deprovision dialog | modal-title | Deprovision Tenant | HARDCODED |
| 13 | deprovision dialog | modal-body | This will permanently deprovision "{name}" and all associated data. This action cannot be undone. | HARDCODED |
| 14 | deprovision confirm | button | Deprovision | HARDCODED |
| 15 | toast | toast | Tenant suspended · Tenant activated | HARDCODED |
| 16 | new/page.tsx | placeholder | Acme Corporation · Select a plan · John Doe · Auto-generated if empty | HARDCODED |
| — | `new/page.tsx` (full form), `[tenantId]/_components/tenant-detail.tsx`, `tenant-settings-form.tsx`, `tenant-branding-form.tsx` | mixed | not fully read | HARDCODED (follow-up) |

---

# PART D — `/console/platform/**` (KEYED via `platformConsole.*`; Arabic exists)

_Module bundle: `src/lib/i18n/messages.ts` → `platformConsole.*` namespace (full en + full ar). Consumed through `useT()`. `console/platform/layout.tsx` gates on `admin:console`._

The console renders almost all chrome through `t('platformConsole.<area>.<key>')`, so **these strings already resolve to Arabic**. Enumerated by sub-area (key prefixes verified against the running app's `t('…')` calls).

### Route: /console/platform (Overview) — `page.tsx` + `_components/*`
| Element cluster | Type | Representative English | Status |
|---|---|---|---|
| Eyebrow / header | breadcrumb/heading | Platform (eyebrow) + overview title/subtitle | key: platformConsole.eyebrow / overview.* (ar) |
| KPI tiles | label | Fleet health · Active tenants · Seats used · Critical events (24h) | key: platformConsole.overview.* (ar) |
| Panels | heading | Service Health · License Expiries · Critical Audit · Provisioning ticker | key: platformConsole.overview.* (ar) |
| Refresh / last-updated | button/body | Refresh · Last updated {time} | key: platformConsole.overview.* (ar) |
| **Hardcoded pockets** | — | overview-status.ts config strings; verify service-health-table cell text | HARDCODED (follow-up) |

### Route: /console/platform/ai — `page.tsx` + `_components/*`
| Element cluster | Type | English | Status |
|---|---|---|---|
| Header | heading | AI fleet title/subtitle | key: platformConsole.ai.title/subtitle (ar) |
| KPIs | label | Total Models · In Production · Shadow · Total Tenants · Drift Alerts | key: platformConsole.ai.totalModels/inProduction/shadow/totalTenants/driftAlerts (ar) |
| Fleet table | table-header | Model · Suite · Tenant · Risk Tier | key: platformConsole.ai.model/suite/tenant/riskTier (ar) |
| Filters / search | placeholder/button | Search · Clear filters · By suite · Unassigned | key: platformConsole.ai.searchPlaceholder/clearFilters/bySuite/unassigned (ar) |
| Panels | heading | Fleet Adoption · Per-tenant adoption · Drift Health · Tenants using | key: platformConsole.ai.fleetAdoption/perTenantAdoption/driftHealthTitle/tenantsUsing (ar) |
| Empty states | empty-state | No models · No tenants · No matches · No suite data · No adoption | key: platformConsole.ai.empty*/no* (ar) |

### Route: /console/platform/audit — `page.tsx` + `_components/*` (tabs)
| Element cluster | Type | English | Status |
|---|---|---|---|
| Header / tags | heading/badge | Platform audit title/subtitle · Tamper-evident · Platform-wide · Per-tenant | key: platformConsole.audit.title/subtitle/tamperEvident/platformWide/perTenantLabel (ar) |
| Tabs | tab | Logs · Export · Integrity · Partitions | key: platformConsole.audit.tabLogs/tabExport/tabIntegrity/tabPartitions (ar) |
| Logs columns/filters | table-header | Timestamp · Actor · Action · Resource · Service · Severity · Tenant · Status (+ All Services, All Severities, actor placeholder) | key: platformConsole.audit.col*/allServices/allSeverities/actorPlaceholder (ar) |
| Export tab | label/button | Format · From · To · Service (optional) · Columns · Start Export · CSV · NDJSON | key: platformConsole.audit.format/from/to/serviceOptional/columns/startExport/formatCsv/formatNdjson (ar) |
| Integrity tab | body/button | Run Verification · Records Verified · Verified · Broken · Chain verified · Violation detected · Verifying fleet… | key: platformConsole.audit.runVerification/recordsVerified/verified/broken/chainVerified/violationDetected/verifyingFleet (ar) |
| Partitions tab | table-header | Name · Date Range · Records · Size · Created · Actions · Run Maintenance · Archive · Delete | key: platformConsole.audit.colName/colDateRange/colRecords/colSize/colCreated/colActions/runMaintenance/archive/delete (ar) |
| Dialogs | modal | Archive/Delete titles + descriptions + confirm | key: platformConsole.audit.archiveTitle/deleteTitle/… (ar) |
| Toasts | toast | Export queued · Export failed · Verify passed · Verify failed | key: platformConsole.audit.exportQueuedToast/exportFailed/verifyPassedToast/verifyFailedToast (ar) |

### Route: /console/platform/identity — `page.tsx` + `_components/*`
| Element cluster | Type | English | Status |
|---|---|---|---|
| ABAC policies tab | heading/label | ABAC Policies · New Policy · Effect (Allow/Deny) · Conditions · Enabled · Evaluation Trace · Divergence | key: platformConsole.identity.abacPolicies/newPolicy/effect*/conditions/enabled/evaluationTrace/divergence* (ar) |
| Policy editor | label/validation | Description · Attribute · Action · JSON invalid · JSON must be an object | key: platformConsole.identity.description/attribute/action/jsonInvalid/jsonNotObject (ar) |
| User search tab | table-header/filter | User · Tenant · Roles · Status · Last Login · All statuses · Filter by status | key: platformConsole.identity.colUser/colTenant/colRoles/colStatus/colLastLogin/allStatuses/filterByStatus (ar) |
| Roles catalog tab | mixed | (roles list) | key: platformConsole.identity.* (ar) |
| Delete confirms | modal | Delete policy title/confirm | key: platformConsole.identity.deletePolicyTitle/deletePolicyConfirm (ar) |

### Route: /console/platform/licensing — `page.tsx` + `_components/*` + `plans/[planKey]/**`
| Element cluster | Type | English | Status |
|---|---|---|---|
| Page + tabs | heading/tab | Licensing title · Plans · Tenant Licenses · Overrides · Usage & Seats · Expiries | key: platformConsole.licensing.* via useT() (ar) |
| Dialogs | modal | Assign License · Create Plan · Offline License · Set Override · Edit Plan | key/hardcoded — mixed; **needs per-dialog verification** |
| Entitlements editor | label | (plan entitlements) | key/hardcoded — verify |
| **Note** | — | licensing consumes `useT()` (global); verify each `_components` dialog uses keys vs. literals | KEYED where `t(...)`, else HARDCODED (follow-up) |

### Route: /console/platform/pricing — `page.tsx` + `_components/*` + `quotes/**`
| Element cluster | Type | English | Status |
|---|---|---|---|
| Pricing calculator, margin cockpit, deal summary, tier comparison, scenario compare, quote detail/client-view, save dialogs | mixed | (extensive commercial UI) | KEYED where `t(...)` present; verify hardcoded pockets |
| Data-catalog literals surfaced by grep | option/label | Professional · Standard · SaaS · Annualized · Growth · deployment · cores · hotStorageGb · coldStorageGb · csv · pdf · ndjson · internal · model | HARDCODED / data-driven (follow-up) |

### Route: /console/platform/provisioning — `page.tsx` + `_components/*`
| Element cluster | Type | English | Status |
|---|---|---|---|
| Provisioning table, step list, status config | table-header/badge | (provisioning runs) | KEYED via `t()` where present; `provisioning-status-config.ts` status labels — verify | 

### Route: /console/platform/services — `page.tsx` + `_components/*` (tabs)
| Element cluster | Type | English | Status |
|---|---|---|---|
| Health grid · Circuit Breakers · Event DLQ · Kill Switches · Rate Limits tabs | tab/table-header | (service ops) | KEYED via `t()` where present (follow-up: confirm each tab) |

### Route: /console/platform/suites — `suites-client.tsx` + `_components/*`
| Element cluster | Type | English | Status |
|---|---|---|---|
| Suite catalog, route-map table, tenant toggle rows | table-header/toggle | (suite entitlement matrix) | KEYED via `useT()`; `suite-catalog.ts` suite names/descriptions likely HARDCODED (follow-up) |

### Route: /console/platform/tenants — `page.tsx` + `[tenantId]/**` + `_components/*`
| Element cluster | Type | English | Status |
|---|---|---|---|
| Tenant list, row actions, reason-confirm dialog, lifecycle, license-state config, platform-tenant-detail | table-header/modal | (tenant control plane) | KEYED via `useT()`; `license-state-config.ts` / `use-tenant-lifecycle.ts` status/reason strings — verify | 

---

## Coverage

**Routes covered (enumerated in this doc):** all in-scope route groups —
- `/workflows/**` (5 route files + error/loading): FULLY READ (page + all client components).
- `/admin/workflows/**` (analytics, operations, definitions/list+kpi, definitions/[defId] detail+designer, instances, tasks, forms, templates): page-level + list chrome READ or grep-surfaced; designer `step-palette.tsx` + `canvas-toolbar.tsx` FULLY READ; other designer/instance/task leaf components grep-surfaced.
- `/admin/**` core: billing, api-keys, invitations, notifications (page), automation, settings (`current-tenant-settings`), tenants (`page`) FULLY READ; users, roles, audit, integrations, ai-governance cross-referenced against their bundles + hardcoded pockets grep-surfaced.
- `/console/platform/**`: overview + ai + audit + identity FULLY key-mapped from `t('platformConsole.*')` call inventory; licensing/pricing/provisioning/services/suites/tenants key-mapped at route level with hardcoded-pocket follow-ups noted.

**Approx. string count catalogued:** ~430 distinct user-facing strings itemised in tables, plus ~600+ additional already-keyed strings referenced by bundle group (admin-i18n `users/roles/audit/aiGovernance/integrations` groups + full `platformConsole.*` namespace ≈ 250 keys). Total addressable surface ≈ **1,000+ strings**.

**Biggest translation GAPS (hardcoded, no Arabic yet), in priority order:**
1. `/workflows/**` top-level — 100% hardcoded (list, tasks, definitions, instance/task detail). Shared components under `src/components/workflows/*` (columns, filters, dialogs, `workflow-utils` PRIORITY_LABELS, status tabs) also hardcoded.
2. `/admin/workflows/**` — 100% hardcoded chrome (operations, analytics, definitions, instances, tasks, forms, templates) + designer (mixed: some inline en/ar in `step-palette`/HelpTips, rest English-only).
3. `/admin/ai-governance/_components/**` — all dialogs/charts/tables hardcoded (bundle `aiGovernance` group authored but only wired in `page.tsx`).
4. `/admin/billing`, `/admin/tenants`, `/admin/api-keys`, `/admin/invitations`, `/admin/notifications`, `/admin/automation`, `/admin/settings` — hardcoded despite matching bundle groups existing in `admin-i18n.ts` (fastest fix = wire the orphaned groups).

**Files NOT fully read (grep-surfaced or bundle-referenced only) — for follow-up exhaustive pass:**
- `src/components/workflows/*` (shared: workflow-instance-columns, task-table-columns, task-filters, workflow-instance-filters, task-status-tabs, task-context-panel, task-complete/reject/delegate dialogs, workflow-cancel-dialog, workflow-instance-detail, task-detail-form) — referenced by both `/workflows` and `/admin/workflows` but live outside the scope path.
- `/admin/workflows/definitions/[defId]/components/definition-detail.tsx` (~500 lines), designer `properties-panel.tsx` (~640 lines, remainder), `condition-builder.tsx`, `approval-chain-editor.tsx`, `trigger-config-editor.tsx`, `variables-editor.tsx`, `version-browser-modal.tsx`, `simulate-result-modal.tsx`, `simulate-config-dialog.tsx`, `form-schema-builder.tsx`, `rf-step-node.tsx`, `step-node.tsx`, `connection-line.tsx`, `workflow-canvas.tsx`, `workflow-lint.ts`.
- `/admin/workflows/instances/components/*` (instances-list, admin-instance-columns, instance-progress, step-history), `/tasks/components/*` (admin-task-list, task-detail-panel, task-form-renderer chrome), `/templates/components/*` (template-card, template-detail-client), `/forms/_components/form-definition-dialog.tsx`, `/analytics/_components/task-workload-table.tsx`.
- `/admin/ai-governance/_components/*` (model-form-dialog, version-form-dialog, feedback-dialog, rollback-dialog, promote-dialog, version-lifecycle-dialog, model-columns, model-card, drift-chart, performance-chart, shadow-comparison-chart, prediction-log-table, version-timeline, explanation-viewer) and `validate/_components/*` (metrics-cards, confusion-matrix, roc-curve-chart, severity-breakdown-table, fp/fn-sample-table, dataset-selector, comparison-indicator, recommendation-banner); `benchmarks/page.tsx`, `benchmarks/[suiteId]/page.tsx`, `compute/page.tsx`, `[modelId]/page.tsx`.
- `/admin/audit` hardcoded subroutes: `logs/[logId]/**`, `timeline/[resourceId]/**`, `_components/{audit-columns,audit-detail-panel,audit-filters,audit-verify-dialog,json-diff-viewer}`.
- `/admin/billing/_components/{plan-cards,quota-meter}`, `/admin/api-keys/_components/*`, `/admin/invitations/_components/invite-user-dialog`, `/admin/notifications/**` (delivery-dashboard, delivery-charts, test-notification-form, all `webhooks/**`), `/admin/tenants/new/page.tsx` + `[tenantId]/_components/*`.
- `/admin/users`, `/admin/roles` `_components/*` hardcoded placeholders (John/Doe/Search permissions…) — otherwise keyed.
- `/console/platform/**` `_components` and `_lib` config files (`overview-status.ts`, `provisioning-status-config.ts`, `license-state-config.ts`, `suite-catalog.ts`, pricing `_lib/*`, licensing/pricing/services/suites dialogs) — confirm keyed vs. hardcoded per dialog; catalog/enum labels likely hardcoded or data-driven.

**Data-driven strings (need BACKEND localization, flagged separately):** workflow status/priority/category enums; automation run statuses (AWAITING_APPROVAL/COMPLETED/FAILED/ABORTED); tenant status/subscription tiers; audit action/resource/service names; AI model names, suites, risk tiers; provisioning step names; licensing plan keys; pricing tier/deployment/model catalog values; all seed/API-provided names surfaced in tables and badges.
