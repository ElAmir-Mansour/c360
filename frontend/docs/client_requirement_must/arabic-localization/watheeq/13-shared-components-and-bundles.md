# Watheeq (Lex) Arabic Localization — Part 4: Shared Lex Components + Bundle Catalog

Scope: every reusable component under `src/components/lex/**`, the Lex UX
primitives under `src/components/shared/**` named in scope (redline / doc-viewer /
board / calendar / saved-views / sparkline), and a `key → English (→ ar?)`
catalog of the Lex i18n bundles so implementers can see, at a glance, which
copy is already translated and which is still pending.

**How to read the STATUS column**

- `key: <bundle.path>` — the string resolves through an i18n bundle / `useT` /
  a self-contained `LexBilingual<T>` bundle. Where a bundle already ships an
  Arabic side the note says **(has ar)**; those strings are DONE — an
  implementer only needs to QA the wording.
- `props-driven (caller)` — the component itself hardcodes nothing; it renders a
  string passed in by the calling page. Localization for that string lives in
  the caller's own module bundle (covered in Parts 1–3 route docs). The label
  KEYS the component's interface demands are listed so callers know the surface.
- `data-driven (<source>)` — the text comes from API/seed data (e.g. a role
  `name_en`/`name_ar`, a counterparty name, an audit action). These need
  **backend localization** and are flagged separately.
- `HARDCODED` — an inline English literal not yet keyed. **These are the real
  gaps.** In this scope they are almost entirely in the cross-suite
  `components/shared/**` primitives (English-only defaults) plus a handful of
  `aria-label` / loading / error strings.

**Headline finding for this scope:** every component that lives under
`src/components/lex/**` is already bilingual — it either carries its own
`LexBilingual<T>` bundle with a full Arabic side, or it is purely props-driven
and receives resolved labels from its caller. The outstanding HARDCODED strings
are in the shared `components/shared/**` primitives (`redline-view`,
`document-viewer`, `board-view` default), one dashboard widget
(`lifecycle-pipeline`), the two skeleton `aria-label`s, the `list-shell`
"Legal Suite" eyebrow default, one internal error fallback, and the command
palette's English search-keyword arrays.

---

## PART A — `src/components/lex/**` components

### Component: `empty-state.tsx` — `LexEmptyState`
_Thin adapter over the canonical `EmptyState`. Deprecated but still consumed._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | LexEmptyState › title | empty-state | _(none — passed by caller)_ | props-driven (caller); interface requires `title` |
| 2 | LexEmptyState › description | empty-state | _(none — passed by caller)_ | props-driven (caller); optional `description` |
| 3 | LexEmptyState › action.label | button | _(none — passed by caller)_ | props-driven (caller); optional `action.label` |

_No hardcoded user-facing text. Default icon only (`Inbox`)._

---

### Component: `list-skeleton.tsx` — `LexListSkeleton` / `LexBoardSkeleton`

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | LexListSkeleton › wrapper | aria-label | `Loading` | HARDCODED |
| 2 | LexListSkeleton › sr-only span | system | `Loading…` | HARDCODED |
| 3 | LexBoardSkeleton › wrapper | aria-label | `Loading` | HARDCODED |
| 4 | LexBoardSkeleton › sr-only span | system | `Loading…` | HARDCODED |

---

### Component: `list-shell.tsx` — `LexListShell`
_The premium wrapper for every Lex list/board page (header + KPI + filters + body)._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | LexListShell › eyebrow (default prop) | heading | `Legal Suite` | HARDCODED (default; most callers override via `eyebrow`) |
| 2 | LexListShell › title | heading | _(none — passed by caller)_ | props-driven (caller) |
| 3 | LexListShell › description | subheading | _(none — passed by caller)_ | props-driven (caller) |
| 4 | LexListShell › empty.title / empty.description / empty.action | empty-state | _(none — passed by caller)_ | props-driven (caller) |

---

### Component: `kpi-strip.tsx` — `LexKpiStrip`
_Responsive KPI tile grid over `shared/KpiCard`; localizes numbers via `useLexFormat`._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | LexKpiStrip › item.label / unit / description / trend.label / detail | label | _(none — passed by caller)_ | props-driven (caller) |

_No hardcoded strings. Sparkline SVG is `aria-hidden`._

---

### Component: `status-chip.tsx` — `LexStatusChip` / `LexSeverityChip` / `LexPriorityChip`
_Adapters over canonical `StatusBadge`. Carry a **built-in EN/AR fallback** used only when the caller passes no `labels` prop (each domain owns its own bundle elsewhere)._

`FALLBACK_LABELS` — status tokens (built-in, **has ar**), STATUS `key: status-chip.FALLBACK_LABELS (has ar)`:

| # | Token | English (verbatim) | Arabic present |
|---|---|---|---|
| 1 | draft | `Draft` | yes (مسودة) |
| 2 | intake | `Intake` | yes |
| 3 | phase1 | `Phase 1` | yes |
| 4 | phase2 | `Phase 2` | yes |
| 5 | open | `Open` | yes |
| 6 | under_procedure | `Under procedure` | yes |
| 7 | on_hold | `On hold` | yes |
| 8 | proposed | `Proposed` | yes |
| 9 | negotiating | `Negotiating` | yes |
| 10 | submitted | `Submitted` | yes |
| 11 | classified | `Classified` | yes |
| 12 | routed | `Routed` | yes |
| 13 | responded | `Responded` | yes |
| 14 | registered | `Registered` | yes |
| 15 | in_progress | `In progress` | yes |
| 16 | results_recorded | `Results recorded` | yes |
| 17 | pending_approval | `Pending approval` | yes |
| 18 | pending_requester_approval | `Pending requester` | yes |
| 19 | pending_provider_approval | `Pending provider` | yes |
| 20 | approved | `Approved` | yes |
| 21 | rejected | `Rejected` | yes |
| 22 | in_execution | `In execution` | yes |
| 23 | delivered | `Delivered` | yes |
| 24 | returned | `Returned` | yes |
| 25 | executed | `Executed` | yes |
| 26 | abandoned | `Abandoned` | yes |
| 27 | archived | `Archived` | yes |
| 28 | closed | `Closed` | yes |
| 29 | cancelled | `Cancelled` | yes |
| 30 | in_approval | `In approval` | yes |
| 31 | filed | `Filed` | yes |
| 32 | requested | `Requested` | yes |
| 33 | appointed | `Appointed` | yes |
| 34 | report_received | `Report received` | yes |
| 35 | done | `Done` | yes |
| 36 | on_track | `On track` | yes |
| 37 | on_time | `On time` | yes |
| 38 | pending | `Pending` | yes |
| 39 | due_soon | `Due soon` | yes |
| 40 | breached | `Breached` | yes |
| 41 | internal_review | `Internal review` | yes |
| 42 | legal_review | `Legal review` | yes |
| 43 | negotiation | `Negotiation` | yes |
| 44 | internal_approval | `Internal approval` | yes |
| 45 | pending_signature | `Pending signature` | yes |
| 46 | active | `Active` | yes |
| 47 | suspended | `Suspended` | yes |
| 48 | renewed | `Renewed` | yes |
| 49 | expired | `Expired` | yes |
| 50 | terminated | `Terminated` | yes |
| 51 | superseded | `Superseded` | yes |
| 52 | in_review | `In review` | yes |
| 53 | waiting_on_business | `Waiting on business` | yes |
| 54 | blocked | `Blocked` | yes |
| 55 | completed | `Completed` | yes |
| 56 | waived | `Waived` | yes |
| 57 | sent | `Sent` | yes |
| 58 | viewed | `Viewed` | yes |
| 59 | signed | `Signed` | yes |
| 60 | declined | `Declined` | yes |

`PRIORITY_LABELS` (built-in, **has ar**), STATUS `key: status-chip.PRIORITY_LABELS (has ar)`:

| # | Token | English (verbatim) | Arabic present |
|---|---|---|---|
| 61 | critical | `Critical` | yes (حرجة) |
| 62 | urgent | `Urgent` | yes (عاجلة) |
| 63 | high | `High` | yes (عالية) |
| 64 | medium | `Medium` | yes (متوسطة) |
| 65 | normal | `Normal` | yes (عادية) |
| 66 | low | `Low` | yes (منخفضة) |

_`humanizeToken()` is the last-resort fallback for unknown tokens (title-cased snake_case) — English-only, not translated; flag if any live token misses both the caller bundle AND FALLBACK_LABELS._

---

### Component: `activity-timeline.tsx` — `LexActivityTimeline`
_Audit storytelling: day-grouped timeline with actor attribution._

`DAY_LABELS` (built-in, **has ar**):

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | LexActivityTimeline › day header | table-header | `Today` | key: activity-timeline.DAY_LABELS.today (has ar: اليوم) |
| 2 | LexActivityTimeline › day header | table-header | `Yesterday` | key: activity-timeline.DAY_LABELS.yesterday (has ar: الأمس) |
| 3 | LexActivityTimeline › empty state | empty-state | `No activity yet` | key: activity-timeline.DAY_LABELS.empty (has ar: لا يوجد نشاط بعد) |
| 4 | LexActivityTimeline › emptyLabel (override) | empty-state | _(none — optional caller prop)_ | props-driven (caller) |
| 5 | ActivityRow › actor.name / action / target / detail | body | _(none)_ | data-driven (audit event stream; action verbs pre-localized by caller) |

_Non-relative dates come from `useLexFormat().formatDate` (Hijri + Arabic-Indic in AR)._

---

### Component: `comments-thread.tsx` — `CommentsThread` (CAP-110)
_Generic @mention comments thread. **Fully externalized**: renders a `CommentsThreadLabels` object the caller resolves for the active locale — zero inline copy._

STATUS for all rows below: `props-driven (caller)` — the interface `CommentsThreadLabels` demands these keys (implementers must ensure every consuming page supplies a bilingual value):

| # | Interface key | Rendered as (Type) | Notes |
|---|---|---|---|
| 1 | title | SectionCard title (heading) | required |
| 2 | description | SectionCard description (subheading) | required |
| 3 | placeholder | composer textarea (placeholder) | required |
| 4 | composerAria | composer (aria-label) | required |
| 5 | mentionHint | composer hint (body) | required |
| 6 | add | add button (button) | required |
| 7 | adding | add button pending (button) | required |
| 8 | edit | edit icon sr-only (aria-label) | required |
| 9 | editAria | edit textarea (aria-label) | required |
| 10 | save | save button (button) | required |
| 11 | cancel | cancel button (button) | required |
| 12 | delete | delete icon sr-only + confirm (button) | required |
| 13 | loading | loading line (body) | required |
| 14 | loadError | error line (error) | required |
| 15 | emptyTitle | empty state (empty-state) | required |
| 16 | emptyDescription | empty state (empty-state) | required |
| 17 | mentionsLabel | mentions chips label (label) | required |
| 18 | watchersLabel | watchers chips label (label) | required |
| 19 | editedSuffix | "(edited)" suffix (body) | required |
| 20 | unknownAuthor | author fallback (body) | required |
| 21 | deleteTitle | confirm dialog (modal-title) | required |
| 22 | deleteDescription | confirm dialog (modal-body) | required |
| 23 | toastAdded | success toast (toast) | required |
| 24 | toastUpdated | success toast (toast) | required |
| 25 | toastDeleted | success toast (toast) | required |
| 26 | comment.author_name / body / mentions | body/badge | data-driven (server; author_name from JWT) |

---

### Component: `sla-countdown.tsx` — `SlaCountdown`
_Self-contained `LexBilingual<SlaCountdownLabels>` bundle — **has ar**._ STATUS `key: sla-countdown bundle (has ar)`:

| # | Source (component › element) | Type | English (verbatim) | Arabic |
|---|---|---|---|---|
| 1 | default caption | label | `Time remaining` | الوقت المتبقّي |
| 2 | no-deadline placeholder | body | `No deadline set` | لا يوجد موعد نهائي |
| 3 | overdue prefix | badge | `Overdue` | متجاوز المهلة |
| 4 | aria (function) | aria-label | `SLA {tier} — {timing}` | اتفاقية مستوى الخدمة {tier} — {timing} |
| 5 | tier.fresh | body | `on track` | ضمن المهلة |
| 6 | tier.aging | body | `approaching` | يقترب الموعد |
| 7 | tier.stale | body | `imminent` | وشيك |
| 8 | tier.overdue | body | `overdue` | متجاوز المهلة |

---

### Component: `sla-aging-badge.tsx` — `SlaAgingBadge`
_Self-contained `LexBilingual<SlaAgingLabels>` bundle — **has ar**._ STATUS `key: sla-aging-badge bundle (has ar)`:

| # | Source (component › element) | Type | English (verbatim) | Arabic |
|---|---|---|---|---|
| 1 | tier.fresh | badge | `On track` | ضمن المهلة |
| 2 | tier.aging | badge | `Approaching` | يقترب الموعد |
| 3 | tier.stale | badge | `Imminent` | موعد وشيك |
| 4 | tier.overdue | badge | `Overdue` | متجاوز المهلة |
| 5 | tierAria.fresh | aria-label | `On track — comfortably ahead of the deadline` | ضمن المهلة — متقدّم بوقت مريح على الموعد النهائي |
| 6 | tierAria.aging | aria-label | `Approaching — deadline within a week` | يقترب الموعد — الموعد النهائي خلال أسبوع |
| 7 | tierAria.stale | aria-label | `Imminent — deadline within two days` | موعد وشيك — الموعد النهائي خلال يومين |
| 8 | tierAria.overdue | aria-label | `Overdue — deadline has passed` | متجاوز المهلة — انقضى الموعد النهائي |
| 9 | noDueDate | badge | `No deadline` | بلا موعد نهائي |

---

### Shell — `shell/global-search.tsx` — `LexGlobalSearch`
_Consumes `useLexShellLabels()` (bundle catalog §C-2)._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | icon button + label | aria-label / label | `Search legal suite` | key: lexShellLabels.search.label (has ar) |
| 2 | input | placeholder | `Search cases, contracts, requests…` | key: lexShellLabels.search.placeholder (has ar) |
| 3 | ⌘K / Ctrl K hint | badge | `⌘K` / `Ctrl K` | HARDCODED (keyboard glyph — not translatable, OS-derived) |

---

### Shell — `shell/lex-breadcrumbs.tsx` — `LexBreadcrumbs`

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | root crumb | breadcrumb | `Legal` | key: lexShellLabels.breadcrumbs.home (has ar: القانونية) |
| 2 | nav element | aria-label | `Breadcrumb` | key: lexShellLabels.breadcrumbs.ariaLabel (has ar) |
| 3 | known route crumbs | breadcrumb | _(from `lexShellLabels.routes`)_ | key: lexShellLabels.routes.* (has ar) |
| 4 | unknown slug crumbs | breadcrumb | _(title-cased slug)_ | data-driven (`humanise()` — English casing only; not translated) |

---

### Shell — `shell/recent-items.tsx` — `RecentItems`

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | strip label | label | `Recent` | key: lexShellLabels.recent.title (has ar: الأخيرة) |
| 2 | clear button | button | `Clear` | key: lexShellLabels.recent.clear (has ar: مسح) |
| 3 | chip titles | link | _(none)_ | data-driven (recent-items store; entity titles) |

_`recent.empty` (`No recently viewed items yet.` / has ar) exists in the bundle; this component renders nothing when empty._

---

### Shell — `shell/lex-command-palette.tsx` — `LexCommandPalette`
_Delegate that registers Lex commands into the global palette._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | jump commands (labels) | option | _(from `lexShellLabels.routes`)_ | key: lexShellLabels.routes.* (has ar) |
| 2 | quick action: New request | option | `New request` | key: lexShellLabels.palette.actions.newRequest (has ar) |
| 3 | quick action: New case | option | `New case` | key: lexShellLabels.palette.actions.newCase (has ar) |
| 4 | quick action: AI drafting | option | `AI drafting` | key: lexShellLabels.palette.actions.aiDrafting (has ar) |
| 5 | quick action: Export | option | `Export` | key: lexShellLabels.palette.actions.export (has ar) |
| 6 | section headings (jump/actions/cases/requests) | table-header | _(from `lexShellLabels.palette.*Section`)_ | key: lexShellLabels.palette.* (has ar) |
| 7 | jump keywords | system | `lex`, `legal`, `new`, `request`, `intake`, `service desk`, `case`, `litigation`, `matter`, `ai`, `draft`, `drafting`, `generate`, `export`, `download`, `report` | HARDCODED (English-only search keywords — AR queries won't match these; consider AR synonyms) |
| 8 | case/request result labels | option | _(record title/number)_ | data-driven (`casesApi`/`lexRequestsApi`; title via `resolveLocalized`) |

---

### Shell — `shell/lex-sidebar.tsx` — `LexSidebar`

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | rail | aria-label | `Legal suite navigation` | key: lexShellLabels.sidebar.railLabel (has ar) |
| 2 | brand glyph | system | `ع` | HARDCODED (Arabic monogram — intentional brand mark, not translatable) |
| 3 | suite name | heading | `ClarioLegal` | key: lexShellLabels.sidebar.suiteName (has ar: كلاريو ليجال) |
| 4 | suite tagline | subheading | `Watheeq · Legal Affairs` | key: lexShellLabels.sidebar.suiteTagline (has ar: وثيق · الشؤون القانونية) |
| 5 | group headings | table-header | _(from `lexShellLabels.groups`)_ | key: lexShellLabels.groups.* (has ar) |
| 6 | nav item labels + tooltips | link / tooltip | _(from `lexShellLabels.routes`)_ | key: lexShellLabels.routes.* (has ar) |
| 7 | collapse toggle | aria-label / button | `Collapse` / `Expand navigation` | key: lexShellLabels.sidebar.collapse / .expand (has ar) |

_`lex-routes.ts` is structural only (route ids + icons; no user-facing literals — labels resolved from the bundle)._

---

### Persona — `persona/role-badge.tsx` — `LexRoleBadge`

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | badge | aria-label | `Your active legal role` | key: lexPersonaLabels.badge.ariaLabel (has ar) |
| 2 | role name | badge | _(role `name_en`/`name_ar`)_ | data-driven (persona context / `/lex/me`) |
| 3 | tier name | badge | _(from `lexPersonaLabels.tiers`)_ | key: lexPersonaLabels.tiers.* (has ar) |
| 4 | tier suffix | badge | `tier` | key: lexPersonaLabels.badge.tierSuffix (has ar: empty in AR by design) |
| 5 | escalation (function) | badge | `Escalation L{level}` | key: lexPersonaLabels.badge.escalation (has ar: مستوى التصعيد {level}) |

---

### Persona — `persona/persona-switcher.tsx` — `LexPersonaSwitcher`

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger | button / aria-label | `Switch persona` | key: lexPersonaLabels.switcher.trigger (has ar) |
| 2 | menu heading | modal-title | `Switch active persona` | key: lexPersonaLabels.switcher.heading (has ar) |
| 3 | active marker | badge | `Active` | key: lexPersonaLabels.switcher.activeBadge (has ar: نشطة) |
| 4 | switching state | button | `Switching…` | key: lexPersonaLabels.switcher.switching (has ar) |
| 5 | error line | error | `Could not switch persona. Please try again.` | key: lexPersonaLabels.switcher.error (has ar) |
| 6 | role names | option | _(role `name_en`/`name_ar`)_ | data-driven (persona context) |

---

### Persona — `persona/capabilities-sheet.tsx` — `LexCapabilitiesSheet` ("My Lex Access")

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger chip | button | `My Lex Access` | key: lexPersonaLabels.sheet.trigger (has ar) |
| 2 | sheet title | modal-title | `My Lex Access` | key: lexPersonaLabels.sheet.title (has ar) |
| 3 | sheet description | modal-body | `Your active legal persona, available roles, and effective permissions.` | key: lexPersonaLabels.sheet.description (has ar) |
| 4 | active role heading | table-header | `Active role` | key: lexPersonaLabels.sheet.activeRoleHeading (has ar) |
| 5 | available roles heading | table-header | `Available roles` | key: lexPersonaLabels.sheet.availableRolesHeading (has ar) |
| 6 | permissions heading | table-header | `Effective permissions` | key: lexPersonaLabels.sheet.permissionsHeading (has ar) |
| 7 | tier label | label | `Tier` | key: lexPersonaLabels.sheet.tierLabel (has ar) |
| 8 | escalation label | label | `Escalation level` | key: lexPersonaLabels.sheet.escalationLabel (has ar) |
| 9 | no-role message | empty-state | `You have no legal role assigned. Contact your administrator to request access.` | key: lexPersonaLabels.sheet.noRole (has ar) |
| 10 | no-permissions message | empty-state | `No effective Lex permissions for this persona.` | key: lexPersonaLabels.sheet.noPermissions (has ar) |
| 11 | granted marker (sr-only) | aria-label | `Granted` | key: lexPersonaLabels.sheet.granted (has ar: مُتاحة) |
| 12 | domain group headings | table-header | _(from `lexPersonaLabels.domains`)_ | key: lexPersonaLabels.domains.* (has ar) |
| 13 | verb rows | label | _(from `lexPersonaLabels.verbs`)_ | key: lexPersonaLabels.verbs.* (has ar) |
| 14 | role names | body / badge | _(role `name_en`/`name_ar`)_ | data-driven (persona context) |

_`sheet.denied` (`Not granted` / غير مُتاحة) is defined in the bundle but the current sheet only renders granted rows._

---

### Access — `access/lex-access-denied.tsx` — `LexAccessDenied` (§15)
_Consumes `ACCESS_DENIED_LABELS` (bundle catalog §C-4)._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | eyebrow | heading | `Access restricted` | key: ACCESS_DENIED_LABELS.eyebrow (has ar) |
| 2 | title (no resource) | heading | `You do not have access to this page.` | key: ACCESS_DENIED_LABELS.title (has ar) |
| 3 | title (with resource, fn) | heading | `You do not have access to {resource}.` | key: ACCESS_DENIED_LABELS.titleWithResource (has ar) |
| 4 | required-permission label | label | `Required permission` | key: ACCESS_DENIED_LABELS.requiredPermission (has ar) |
| 5 | active-role label | label | `Your active Lex role` | key: ACCESS_DENIED_LABELS.yourActiveRole (has ar) |
| 6 | no active role | body | `No active legal role` | key: ACCESS_DENIED_LABELS.noActiveRole (has ar) |
| 7 | explanation | body | `Your current role does not grant this permission. Backend authorization is the source of truth — switching persona below, or asking an administrator to grant the permission, is the way to gain access.` | key: ACCESS_DENIED_LABELS.explanation (has ar) |
| 8 | no-lex-role message | body | `You are not assigned any legal-affairs role in this workspace, so Lex pages are unavailable. Ask an administrator to assign you a legal role.` | key: ACCESS_DENIED_LABELS.noLexRole (has ar) |
| 9 | switch prompt | body | `You have another role that can access this page:` | key: ACCESS_DENIED_LABELS.switchPrompt (has ar) |
| 10 | switch button (fn) | button | `Switch to {roleName}` | key: ACCESS_DENIED_LABELS.switchTo (has ar) |
| 11 | switching state | button | `Switching persona…` | key: ACCESS_DENIED_LABELS.switching (has ar) |
| 12 | switch failed | error | `Could not switch persona. You may no longer hold that role.` | key: ACCESS_DENIED_LABELS.switchFailed (has ar) |
| 13 | back link | button | `Back to my workspace` | key: ACCESS_DENIED_LABELS.backToWorkspace (has ar) |
| 14 | requirement joiner AND | body | `AND` | key: ACCESS_DENIED_LABELS.and (has ar: و) |
| 15 | requirement joiner OR | body | `OR` | key: ACCESS_DENIED_LABELS.or (has ar: أو) |
| 16 | required-permission value | body | _(permission slug e.g. `lex:case:view`)_ | data-driven (route registry — slug, not translated) |
| 17 | role names | body / button | _(role `name_en`/`name_ar`)_ | data-driven (`/lex/me`) |

---

### Access — `access/lex-access-guard.tsx` — `LexAccessGuard`

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | loading state | system | _(none — renders `LoadingSkeleton`)_ | delegated (no literal) |
| 2 | denied view | — | _(delegates to `LexAccessDenied`)_ | see above |

_No inline user-facing strings._

### Access — `access/use-lex-access.ts` (hook)

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | `extractMessage()` fallback | error | `Failed to load Lex access context.` | HARDCODED (internal error fallback surfaced via `error` state) |

_`access-denied-utils.ts` and `lex-role-permissions.ts` are pure helpers (permission slugs + role-name picker) — no user-facing literals._

---

### Dashboard — `dashboard/lifecycle-pipeline.tsx` — `LifecyclePipeline`
_Watheeq contract lifecycle funnel + stage tiles._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | funnel bar | aria-label | `Contract lifecycle distribution` | HARDCODED |
| 2 | total caption (pluralized) | body | `{n} contract{s} across {n} lifecycle stages` | HARDCODED (inline plural `contract`/`contracts` — not localizable as-is) |
| 3 | per-tile footer | body | `{pct}% of pipeline` | HARDCODED |
| 4 | stage tile labels | badge | _(from `contractStatusConfig[stage].label`)_ | data-driven (`@/lib/status-configs` — English-only config; localize the config or map via `lexContractStatusLabels`) |
| 5 | stage bar tooltip (`title`) | tooltip | `{label}: {count} ({pct}%)` | HARDCODED (composed from config label) |

---

## PART B — Lex UX primitives under `src/components/shared/**`

These are the "7 reusable shared primitives" from the Lex UX overhaul. They are
cross-suite, so several ship **English-only defaults** (the biggest concrete
localization gap in this scope).

### Primitive: `shared/redline-view.tsx` — `RedlineView`
_Contract redline (inline / split diff)._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | inserted segment (sr-only) | aria-label | `inserted: ` | HARDCODED |
| 2 | deleted segment (sr-only) | aria-label | `deleted: ` | HARDCODED |
| 3 | mode toggle group | aria-label | `Redline display mode` | HARDCODED |
| 4 | inline toggle | button | `Inline` | HARDCODED |
| 5 | split toggle | button | `Split` | HARDCODED |
| 6 | original column header (default) | table-header | `Original` | HARDCODED (default prop `originalLabel`; caller may override) |
| 7 | revised column header (default) | table-header | `Revised` | HARDCODED (default prop `revisedLabel`; caller may override) |
| 8 | empty inline body | empty-state | `No content to compare.` | HARDCODED |

### Primitive: `shared/document-viewer.tsx` — `DocumentViewer` / `DocumentPreviewSheet`
_Inline PDF/image/text viewer + preview sheet._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | no-content empty state | empty-state | `No preview available` | HARDCODED |
| 2 | no-content empty description | empty-state | `There is no document or extracted text to display.` | HARDCODED |
| 3 | PDF iframe fallback title | aria-label | `PDF document` | HARDCODED (fallback when no `fileName`) |
| 4 | image alt fallback | aria-label | `Document image` | HARDCODED (fallback) |
| 5 | binary filename fallback | body | `Document` | HARDCODED (fallback) |
| 6 | download link | button | `Download` | HARDCODED |
| 7 | unpreviewable empty title | empty-state | `No preview available` | HARDCODED |
| 8 | unpreviewable empty description | empty-state | `This file type cannot be previewed.` | HARDCODED |
| 9 | anchor rail | aria-label | `Document sections` | HARDCODED |
| 10 | anchor rail heading | table-header | `Sections` | HARDCODED |
| 11 | preview sheet title fallback | modal-title | `Document preview` | HARDCODED (fallback when no `title`/`fileName`) |
| 12 | anchor labels / filename | link / body | _(none)_ | data-driven (caller anchors / file metadata) |

### Primitive: `shared/event-calendar.tsx` — `EventCalendar`
_Month + agenda calendar. Carries a **self-contained bilingual `T` object** (has ar); month/day formatting uses date-fns `ar`/`enUS` locales._

| # | Source (component › element) | Type | English (verbatim) | Arabic | Status |
|---|---|---|---|---|---|
| 1 | month view toggle | button | `Month` | شهر | key: event-calendar T.month (has ar) |
| 2 | agenda view toggle | button | `Agenda` | قائمة | key: event-calendar T.agenda (has ar) |
| 3 | prev nav | aria-label | `Previous month` | الشهر السابق | key: event-calendar T.prev (has ar) |
| 4 | next nav | aria-label | `Next month` | الشهر التالي | key: event-calendar T.next (has ar) |
| 5 | agenda empty | empty-state | `No events scheduled` | لا توجد أحداث مجدولة | key: event-calendar T.noEvents (has ar) |
| 6 | overflow chip (fn) | badge | `+{n} more` | +{n} المزيد | key: event-calendar T.more (has ar) |
| 7 | weekday headers | table-header | `Sun` `Mon` `Tue` `Wed` `Thu` `Fri` `Sat` | أحد إثن ثلا أرب خمي جمع سبت | key: event-calendar T.weekdays (has ar) |
| 8 | event title / kind / meta | body / badge | _(none)_ | — | data-driven (caller events) |

### Primitive: `shared/board-view.tsx` — `BoardView`
_Kanban board (drag-and-drop)._

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | empty column (default prop) | empty-state | `No items` | HARDCODED (default `emptyColumnLabel`; Lex callers should pass a localized value) |
| 2 | column labels + counts | table-header / badge | _(none)_ | props-driven (caller `columns[].label`) |
| 3 | card content | — | _(none)_ | props-driven (caller `renderCard`) |

### Primitive: `shared/saved-views-bar.tsx` — `SavedViewsBar`
_Per-route saved views. Carries a **self-contained bilingual `LABELS`** (has ar); the `labels` prop overrides individual keys._

| # | Source (component › element) | Type | English (verbatim) | Arabic | Status |
|---|---|---|---|---|---|
| 1 | save trigger + popover | button / aria-label | `Save current view` | حفظ العرض الحالي | key: saved-views LABELS.save (has ar) |
| 2 | (aria heading) | label | `Saved views` | العروض المحفوظة | key: saved-views LABELS.saved (has ar) |
| 3 | empty | empty-state | `No saved views yet` | لا توجد عروض محفوظة بعد | key: saved-views LABELS.empty (has ar) |
| 4 | name input | placeholder | `View name` | اسم العرض | key: saved-views LABELS.namePlaceholder (has ar) |
| 5 | rename menu item | button | `Rename view` | إعادة تسمية العرض | key: saved-views LABELS.rename (has ar) |
| 6 | delete menu item | button | `Delete view` | حذف العرض | key: saved-views LABELS.delete (has ar) |
| 7 | set-default menu item | button | `Set as default` | تعيين كعرض افتراضي | key: saved-views LABELS.setDefault (has ar) |
| 8 | clear-default menu item | button | `Clear default` | إلغاء التعيين الافتراضي | key: saved-views LABELS.clearDefault (has ar) |
| 9 | default badge (sr-only / title) | badge | `Default view` | العرض الافتراضي | key: saved-views LABELS.defaultBadge (has ar) |
| 10 | row menu | aria-label | `View options` | خيارات العرض | key: saved-views LABELS.menu (has ar) |
| 11 | view names | chip / link | _(none)_ | — | data-driven (user-saved view names) |

### Primitive: `shared/trend-sparkline.tsx` — `TrendSparkline`

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | axis ticks / tooltip | body | _(none)_ | data-driven (caller `data[].label`/`value`) |

_No hardcoded user-facing strings._

---

## PART C — Lex i18n BUNDLE catalog (`key → English (→ ar?)`)

Every bundle below is a `LexBilingual<T>` (or equivalent `{en, ar}` record) and
is **fully translated** — every leaf on the `en` side has a matching `ar` leaf.
The `ar?` column is therefore uniformly **yes**; the value to implementers is
the inventory of WHICH surfaces are already covered so no route re-keys copy
that already exists. Tables list the top-level groups with a representative
English string; nested leaves are noted inline where useful.

### §C-1 `lex/_lib/lex-i18n.ts` — suite-wide `useLexLabels()` (the canonical contract)

| # | Key group | Representative English | ar? |
|---|---|---|---|
| 1 | `lexContractStatusLabels` (11 tokens) | `draft` → `Draft` … `cancelled` → `Cancelled` | yes |
| 2 | `lexSeverityLabels` (5) | `critical` → `Critical`, `info` → `Info` | yes |
| 3 | `lexCommonActionLabels` (13) | `view` `View`, `save` `Save changes`, `requestChanges` `Request Changes`, `applying` `Applying...` | yes |
| 4 | `lexOverviewLabels.pageTitle` | `Legal` | yes (وثيق) |
| 5 | `lexOverviewLabels.pageDescription` | `Live legal operations view across contracts, document lifecycle, and compliance posture.` | yes |
| 6 | `.nav` (4) | `contracts` `Contracts` … | yes |
| 7 | `.hero.greeting` (fn) | `Legal Affairs command center · {name}` | yes |
| 8 | `.hero.subtitle` | `Unified view across litigation, service desk, contracts, obligations and compliance.` | yes |
| 9 | `.hero.quickActions` (4) | `New request`, `AI drafting`, `Compliance`, `Export` | yes |
| 10 | `.hero.posture` (4) | `Compliance score`, `Open alerts`, `SLA compliance`, `Overdue` | yes |
| 11 | `.commandKpis` (12: 6 titles + 6 descriptions) | `Active Contracts` / `Currently in force` … | yes |
| 12 | `.domainsHeading` / `.viewLabel` | `Suite domains` / `Open` | yes |
| 13 | `.domains` (18 domain ids) | `litigation_cases` `Litigation Cases` … `admin` `Administration` | yes |
| 14 | `.needsAttention` (title, description, 6 filters, empty title/desc, 5 typeLabels) | `Needs Attention`; `SLA breach`, `Upcoming hearing` | yes |
| 15 | `.myWork` (title, desc, empty×2, assignedTo) | `My Work` / `Assigned to you` | yes |
| 16 | `.loadError` | `Failed to load legal operations overview.` | yes |
| 17 | `.kpis` (12) | `Active Contracts`, `createdThisMonth`(fn) `{count} created this month`, `Renewal Warnings` `Within 60-day window` | yes |
| 18 | `.compliancePosture` (10) | `Compliance Posture`, `Open compliance console` | yes |
| 19 | `.lifecycle` (title/desc) | `Lifecycle Pipeline` | yes |
| 20 | `.monthlyActivity` (title, desc, 4 series) | `Monthly Activity`; `Created`/`Activated`/`Renewed`/`Expired` | yes |
| 21 | `.renewals` (title, desc, loadError, empty×2, daysShort fn) | `Renewal Warnings`; `{days} days` | yes |
| 22 | `.reviewQueue` (17: incl. `selected`(fn), `selectionCount`(fn), toasts×5, `selectRowAria`(fn)) | `Review Queue`; `{count} selected`; `Bulk decision applied` | yes |
| 23 | `.complianceAlerts` (4) | `Compliance Alerts` / `No open alerts` | yes |
| 24 | `.recentContracts` (8: incl. `expiresPrefix`(fn), `valueUndisclosed`) | `Recent Contracts`; `Expires {date}`; `Undisclosed` | yes |
| 25 | `.regulations` (5) | `Active Regulations` / `Regulation library record` | yes |

_Consumers: `/lex` overview + every list page via `useLexLabels()`; also re-used by shell/sla bundles which import `resolveLexBilingual`._

### §C-2 `components/lex/shell/lex-shell-labels.ts` — `useLexShellLabels()`

| # | Key group | Representative English | ar? |
|---|---|---|---|
| 1 | `groups` (4) | `Active Work`, `Library`, `Insight`, `Operations` | yes |
| 2 | `routes` (24) | `command_center` `Command Center`, `cases` `Litigation Cases`, `analytics_risk` `Risk Analytics`, `admin` `Administration` | yes |
| 3 | `sidebar` (6) | `railLabel` `Legal suite navigation`, `suiteName` `ClarioLegal`, `suiteTagline` `Watheeq · Legal Affairs`, `collapse` `Collapse`, `expand` `Expand navigation`, `home` `Command Center` | yes |
| 4 | `breadcrumbs` (2) | `home` `Legal`, `ariaLabel` `Breadcrumb` | yes |
| 5 | `recent` (3) | `title` `Recent`, `clear` `Clear`, `empty` `No recently viewed items yet.` | yes |
| 6 | `palette` (placeholder, searchPlaceholder, 8 section headings, `open`, 4 actions) | `Search the legal suite, jump to a domain, or run an action…`; `New request` | yes |
| 7 | `search` (3) | `label` `Search legal suite`, `placeholder` `Search cases, contracts, requests…`, `hint` `Search` | yes |

### §C-3 `components/lex/persona/persona-labels.ts` — `useLexPersonaLabels()`

| # | Key group | Representative English | ar? |
|---|---|---|---|
| 1 | `badge` (tierSuffix, escalation fn, ariaLabel) | `tier`; `Escalation L{level}`; `Your active legal role` | yes |
| 2 | `tiers` (4) | `Business`, `Legal`, `Oversight`, `Admin` | yes |
| 3 | `switcher` (5) | `Switch persona`, `Active`, `Switching…`, `Could not switch persona. Please try again.` | yes |
| 4 | `sheet` (14) | `My Lex Access`; `Your active legal persona, available roles, and effective permissions.`; `Granted`/`Not granted` | yes |
| 5 | `domains` (18) | `request` `Requests` … `security` `Security`, `other` `Other` | yes |
| 6 | `verbs` (10) | `view` `View`, `approve` `Approve`, `distribute` `Distribute`, `admin` `Administer` | yes |
| 7 | `quickLinks` (20) | `my_requests` `My Requests`, `risk_analytics` `Risk Analytics`, `entities` `Entities & Exposure` | yes |
| 8 | `home.quickLinksHeading` + `home.variants` (11 × {title, subtitle}) | `For your role`; `Your requests` / `Submit and track your legal service requests.` | yes |

### §C-4 `components/lex/access/access-denied-labels.ts` — `getAccessDeniedLabels()`

| # | Key | English | ar? |
|---|---|---|---|
| 1 | eyebrow | `Access restricted` | yes |
| 2 | title | `You do not have access to this page.` | yes |
| 3 | titleWithResource (fn) | `You do not have access to {resource}.` | yes |
| 4 | requiredPermission | `Required permission` | yes |
| 5 | yourActiveRole | `Your active Lex role` | yes |
| 6 | noActiveRole | `No active legal role` | yes |
| 7 | explanation | `Your current role does not grant this permission. …` | yes |
| 8 | noLexRole | `You are not assigned any legal-affairs role in this workspace, …` | yes |
| 9 | switchPrompt | `You have another role that can access this page:` | yes |
| 10 | switchTo (fn) | `Switch to {roleName}` | yes |
| 11 | switching | `Switching persona…` | yes |
| 12 | switchFailed | `Could not switch persona. You may no longer hold that role.` | yes |
| 13 | backToWorkspace | `Back to my workspace` | yes |
| 14 | and / or | `AND` / `OR` | yes |

### §C-5 `lex/entities/_lib/entity-i18n.ts` — `useEntityLabels()` (Entity 360)

| # | Key group | Representative English | ar? |
|---|---|---|---|
| 1 | `list` (eyebrow, title `Entity 360`, description, searchPlaceholder, empty×2, error×2, retry, 5 columns, `recordSummary` fn, noActivity) | `Search organizations…`; `{c} contracts · {n} cases · {s} settlements` | yes |
| 2 | `kpis` (6) | `Organizations`, `Total SAR exposure`, `Recovery rate` | yes |
| 3 | `caseUnavailable` (value, title, description) | `Case metrics need case detail` | yes |
| 4 | `detail.backToList` / `notFoundTitle` / `notFoundDescription` | `All organizations`; `Organization not found` | yes |
| 5 | `detail.hero` (eyebrow, `records` fn, lastActivity, noActivity, 5 facts) | `{n} linked record(s)` | yes |
| 6 | `detail.kpis` (4) | `Contract value`, `Realised settled` | yes |
| 7 | `detail.posture` (4) | `As plaintiff`, `As defendant`, `Settlement recovery` | yes |
| 8 | `detail.tabs` (5) | `Overview`, `Contracts`, `Cases`, `Settlements`, `Activity` | yes |
| 9 | `detail.sections` (5) | `Activity timeline`, `Exposure breakdown` | yes |
| 10 | `detail.empty` (4) | `No contracts with this organization.` | yes |
| 11 | `detail.record` (6) | `No reference`, `Plaintiff`, `Defendant`, `Open` | yes |
| 12 | `detail.activityVerbs` (3) | `updated contract` / `updated case` / `updated settlement` | yes |

### §C-6 `lex/reports/_lib/reports-labels.ts` — `useReportsLabels()`

| # | Key group | Representative English | ar? |
|---|---|---|---|
| 1 | pageTitle | `Reports` (contracts/matters/obligations tabs) | yes |
| 2 | `tabs` / `descriptions` (per ReportKind) | `Contracts`/`Matters`/`Obligations` | yes |
| 3 | `actions` (5) | `signatures`, `exportCsv`, `exportXlsx`, `exportSelectedCsv`, `downloadPdf` | yes |
| 4 | `dateRange` (label, all, clear, 4 presets) | `Next 30`/`Next 90`/`This month`/`This year` | yes |
| 5 | `presets` (label + 5) | `High-risk contracts`, `Overdue obligations` | yes |
| 6 | `savedViews` (3) | `save`/`saved`/`empty` | yes |
| 7 | `filters` (8) | `status`, `type`, `riskLevel`, `priority`, `department`, `tag`, `overdue`, `overdueYes` | yes |
| 8 | `errors` (per ReportKind) | load-error copy | yes |
| 9 | `empty` (title + 3 kinds) | empty-state copy | yes |
| 10 | `generated` (fn) | `Generated {when}` | yes |
| 11 | `reportRows` / `table` (13) | column headers: `status`,`type`,`risk`,`priority`,`owner`,`source`,`expiryDate`,`dueDate`,`createdAt`,`action`,`open` | yes |
| 12 | `metrics` (10) + `metricDetails` (10) | tile labels + descriptions | yes |
| 13 | `breakdown` (6) | `By status`, `By risk`, `Distribution`, `No data` | yes |
| 14 | `rows` (versionPrefix fn, noExpiryDate, noDueDate, unassigned, unlinked) | `v{version}` | yes |
| 15 | `dueWindow` (overdue fn, today, dueIn fn) | `Overdue {days}` / `Due in {days}` | yes |
| 16 | `enums` (contractTypes, matterStatuses, matterTypes, obligationStatuses, obligationTypes) | enum → label maps | yes |

### §C-7 `lex/reports/_lib/analytics-labels.ts` — `useAnalyticsLabels()` (reports → analytics drill-in)

| # | Key group | Representative English | ar? |
|---|---|---|---|
| 1 | pageTitle / pageDescription / backToReports | analytics dashboard header | yes |
| 2 | `tabs` / `tabDescriptions` (6: overview, sla, performance, cases, contracts, consultations) | tab labels | yes |
| 3 | `actions` | export/refresh actions | yes |
| 4 | `filters` | filter labels | yes |
| 5 | `overview` | overview cards/series | yes |
| 6 | `comparison` | comparison chart copy | yes |
| 7 | `sla` | SLA analytics copy | yes |
| 8 | `performance` | performance analytics copy | yes |

_(large bundle, 496 lines; every leaf has an `ar` counterpart.)_

### §C-8 `lex/analytics/_components/analytics-labels.ts` — `useAnalyticsLabels()` (Legal-Ops Analytics route)

| # | Key group | Representative English | ar? |
|---|---|---|---|
| 1 | `page` (4) | `Legal-Ops Analytics`; `Refresh` | yes |
| 2 | `kpi` (9) | `Active matters`, `Closed (90d)`, `Avg. days to close`, `Weekly throughput`, `Busiest officer` | yes |
| 3 | `kpiDetails` (9) | KPI tooltip descriptions | yes |
| 4 | `heatmap` (13: incl. `cellTooltip` fn) | `officer`/`practiceArea`/`Total`; light/heavy legend | yes |
| 5 | `velocity` (16) | `Closed per week`, `Avg days in phase`, `Settlement cycle` | yes |
| 6 | `companyStatus` (Record<CaseCompanyStatus>) | company-status enum labels | yes |
| 7 | `status` (Record<CaseStatus>) | case-status enum labels | yes |

### §C-9 `lex/analytics/risk/_lib/risk-labels.ts` — `useRiskLabels()` (Portfolio Risk & Value)

| # | Key group | Representative English | ar? |
|---|---|---|---|
| 1 | `page` (4) | `Portfolio Risk & Value`; `Refresh` | yes |
| 2 | `kpi` (9) | `Portfolio value`, `Value at risk`, `High-risk share`, `Expiring (90d)`, `Avg. risk score`, `/ 100` | yes |
| 3 | `kpiDetails` (9) | KPI descriptions + `Portfolio share`/`Active exposure`/`Scored contracts` | yes |
| 4 | `risk` (14) | `Risk distribution`; `Awaiting analysis`; `No risk-scored contracts` | yes |
| 5 | `urgency` (5) | `Matter urgency`; `Open`/`Overdue`/`Matters` | yes |
| 6 | `maturity` (8) | `Obligation maturity`; `Next 30 days`/`Next 90 days`/`Later` | yes |
| 7 | `cliff` (8: incl. `contractsExpiring` fn) | `Renewal cliff`; `{count} contract(s) expiring`; `Peak exposure` | yes |
| 8 | `bands` (3) | `High`/`Medium`/`Low` | yes |
| 9 | `priority` (Record<LexLegalPriority>, 4) | `Critical`/`High`/`Medium`/`Low` | yes |
| 10 | `obligationType` (Record<LexObligationType>, 11) | `Contractual`/`Renewal`/`Notice`/`Condition precedent`/`Regulatory`/`Other` | yes |

### §C-10 `lex/investigations/_components/labels.ts` — `useInvestigationLabels()`

| # | Key group | Representative English | ar? |
|---|---|---|---|
| 1 | option consts | `INVESTIGATION_STATUS_OPTIONS`, `INVESTIGATION_PRIORITY_OPTIONS` (`critical`/`high`/`medium`/`low`), `INVESTIGATION_PARTY_ROLE_OPTIONS` | (option values; labels in bundle) |
| 2 | pageTitle / pageDescription / eyebrow | investigations list header | yes |
| 3 | `create` / `createFirst` / `searchPlaceholder` | `Create` CTA + search | yes |
| 4 | empty×2 / loadError | list empty + error | yes |
| 5 | `view` / `clearLoadedView` / `searchHint` | saved-view chrome | yes |
| 6 | `savedViews` | saved-views labels | yes |
| 7 | `stats` (grid) + `statDetails` | KPI tiles + descriptions | yes |
| 8 | `columns` | table headers | yes |
| 9 | `filters` | filter labels | yes |
| 10 | `form` (large: create/edit form labels, placeholders, validation) | investigation form copy | yes |
| 11 | `detail` (large: detail workspace, tabs, actions, timeline) | investigation detail copy | yes |

_(largest lex bundle, 1696 lines; fully bilingual — `formatInvestigationToken()` is the last-resort humanizer for unmapped tokens.)_

---

## Coverage

**Components covered (all read in full):**

- `src/components/lex/**` — `empty-state`, `list-skeleton`, `list-shell`,
  `kpi-strip`, `status-chip`, `activity-timeline`, `comments-thread`,
  `sla-countdown`, `sla-aging-badge`; shell: `global-search`,
  `lex-breadcrumbs`, `recent-items`, `lex-command-palette`, `lex-sidebar`,
  `lex-routes`, `lex-shell-labels`; persona: `role-badge`, `persona-switcher`,
  `capabilities-sheet`, `persona-labels`; access: `lex-access-denied`,
  `lex-access-guard`, `use-lex-access`, `access-denied-labels`,
  `access-denied-utils`, `lex-role-permissions`, `row-accents`; dashboard:
  `lifecycle-pipeline`.
- `src/components/shared/**` (Lex UX primitives named in scope) — `redline-view`,
  `document-viewer`, `event-calendar`, `board-view`, `saved-views-bar`,
  `trend-sparkline`.

**Bundles catalogued (§C-1 … §C-10):** `lex-i18n.ts`, `lex-shell-labels.ts`,
`persona-labels.ts`, `access-denied-labels.ts`, `entity-i18n.ts`,
`reports-labels.ts`, two `analytics-labels.ts` (reports drill-in + analytics
route), `risk-labels.ts`, `investigations/labels.ts`. **All ten are fully
bilingual — every English leaf already has an Arabic counterpart.**

**Approx string count in this doc:** ~205 catalogued strings/rows — ~120
component-surface strings in Parts A–B (of which ~30 are the real HARDCODED
gaps) plus ~85 bundle key-groups in Part C (each group covering 1–20+ leaves;
the full leaf count across the 10 bundles is well over 700, all translated).

**Real localization gaps to action (everything else is already bilingual):**

1. `components/shared/redline-view.tsx` — 8 hardcoded strings (`Inline`, `Split`,
   `Original`, `Revised`, `No content to compare.`, `inserted: `, `deleted: `,
   `Redline display mode`).
2. `components/shared/document-viewer.tsx` — 11 hardcoded strings (`No preview
   available`, `Download`, `Sections`, `Document sections`, fallbacks, …).
3. `components/shared/board-view.tsx` — `No items` default (localize at Lex call
   sites via `emptyColumnLabel`).
4. `components/lex/dashboard/lifecycle-pipeline.tsx` — `Contract lifecycle
   distribution` aria-label, the `{n} contract(s) across {n} lifecycle stages`
   pluralized caption, `{pct}% of pipeline`, and the config-driven stage labels
   (`@/lib/status-configs` is English-only).
5. `components/lex/list-skeleton.tsx` — `Loading` aria-label + `Loading…` sr-only
   (×2 variants).
6. `components/lex/list-shell.tsx` — `Legal Suite` eyebrow default.
7. `components/lex/access/use-lex-access.ts` — `Failed to load Lex access
   context.` error fallback.
8. `components/lex/shell/lex-command-palette.tsx` — English-only search
   `keywords` arrays (AR queries won't match; add Arabic synonyms).

**Data-driven surfaces needing BACKEND localization (flagged separately):**

- Legal role display names (`name_en` / `name_ar`) — persona badge / switcher /
  capabilities sheet / access-denied. AR is served via `name_ar`, so the
  frontend is ready; ensure the backend populates `name_ar` for every role.
- Command-palette / recent-items / breadcrumb entity titles, counterparty names,
  audit-timeline actions & targets — sourced from `casesApi`/`lexRequestsApi`/
  seed data; localize at the API/seed layer (titles route through
  `resolveLocalized`).
- `lifecycle-pipeline` stage labels via `contractStatusConfig` — either localize
  that config or remap through `lexContractStatusLabels` (which is bilingual).

**Files that could not be fully read:** none — every file in scope was read in
full. The two `analytics-labels.ts` bundles (§C-7 reports drill-in, 496 lines)
and `investigations/labels.ts` (§C-10, 1696 lines) were catalogued at the
top-level-group grain rather than per-leaf because of their size; their `ar`
sides are present and complete (`grep` confirmed the `ar:` bundle in each), so
they are DONE for translation and listed here for inventory completeness.
