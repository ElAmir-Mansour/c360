# Arabic Localization Reference — Watheeq Part 1: Cases & Intake

**Scope:** `/lex` (overview), `/lex/service-desk` (+ `/new`, `/intake`, `/[id]`, `/sla-board`, `/notifications`), `/lex/cases` (+ `/[id]`, `/classifications`), `/lex/investigations`, `/lex/consultations`, `/lex/settlements`, `/lex/case-timeline` (+ `/portfolio`), `/lex/matters` (+ `/[id]`).

**Frontend root:** `/Users/mac/clario360/frontend/src/app/(dashboard)/lex/`

## How to read this document

The lex suite is **almost fully keyed** through per-feature bilingual bundles that follow the canonical contract in `_lib/lex-i18n.ts` (`LexBilingual<T> = { en, ar }`, resolved via `resolveLexBilingual` / a `use<Feature>Labels()` hook). **Every string routed through a bundle already has a professional MSA Arabic translation** — the localization work for these is *review/QA*, not net-new translation.

**Status column values:**
- `key: <bundle>.<path> (AR ✓)` — string resolves through a bilingual bundle and Arabic already exists. Translation exists; verify quality only.
- `HARDCODED` — inline JSX/TS literal not routed through any bundle. **These are the real gaps** (net-new translation + wiring needed).
- `data-driven (<source>)` — text comes from API/seed data; needs **backend** localization, not frontend keys. Flagged separately.

Because the bundles carry the exhaustive verbatim English + Arabic already, enum/option **Record** sets are listed on one row (all member values enumerated in the English column) with a single key path; individual leaf strings get their own rows where they map to a distinct UI element. `(fn)` marks a function-valued/interpolated string (placeholders preserved on both locales).

**Shared suite bundle:** `_lib/lex-i18n.ts` (`useLexLabels`) — provides `contractStatusLabels`, `severityLabels`, `commonActions` (View / View all / Edit / Delete / Cancel / Save changes / Create / Export / Approve / Reject / Request Changes / Retry / Applying…), and the whole `overview` object. All `(AR ✓)`.

---

## Route: /lex (overview) — page.tsx
_Module bundle: `_lib/lex-i18n.ts` (`useLexLabels().overview`), `_components/first-run-banner.tsx` (local), `_components/contract-analytics.tsx` (local `CONTRACT_ANALYTICS_TITLE`), `components/lex/persona/persona-labels.ts` (`useLexPersonaLabels`)_

### command-hero.tsx (CommandHero)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | CommandHero › eyebrow chip | badge | `Watheeq Legal Affairs` | **HARDCODED** (line 221; only non-keyed literal on this page) |
| 2 | CommandHero › greeting `h1` | heading | `Legal Affairs command center · {name}` / `Legal Affairs command center` (fn) | key: overview.hero.greeting (AR ✓) |
| 3 | CommandHero › subtitle | subheading | `Unified view across litigation, service desk, contracts, obligations and compliance.` | key: overview.hero.subtitle (AR ✓) |
| 4 | CommandHero › roll-up chips | badge | `SLA Breaches` / `Overdue Obligations` / `Pending Approvals` | key: overview.commandKpis.* (AR ✓) |
| 5 | CommandHero › quick action buttons | button | `New request` · `AI drafting` · `Compliance` · `Export` | key: overview.hero.quickActions.* + commonActions.export (AR ✓) |
| 6 | CommandHero › posture aside | label | `Compliance score` · `Open alerts` · `Overdue` | key: overview.hero.posture.* (AR ✓) |
| 7 | CommandHero › trend caption | label | `Recent score trend` | key: overview.compliancePosture.trendLabel (AR ✓) |
| 8 | CommandHero › gauge aria | aria-label | `Compliance score` | key: overview.hero.posture.complianceScore (AR ✓) |

### cross-domain-kpis.tsx (CrossDomainKpis)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 9 | 6 KPI tiles › titles | heading | `Active Contracts` · `Open Matters` · `Overdue Obligations` · `Pending Approvals` · `SLA Breaches` · `Open Alerts` | key: overview.commandKpis.* (AR ✓) |
| 10 | 6 KPI tiles › descriptions | body | `Currently in force` · `Across all practice areas` · `Past their due date` · `Awaiting a decision` · `Service-desk clocks breached` · `Active compliance findings` | key: overview.commandKpis.*Description (AR ✓) |

### domain-tiles.tsx / domain-tile.tsx (DomainTiles)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 11 | DomainTiles › section title | heading | `Suite domains` | key: overview.domainsHeading (AR ✓) |
| 12 | DomainTile › 18 domain names (+ aria/title) | link | `Litigation Cases` · `Service Desk` · `Investigations` · `Consultations` · `Settlements` · `Contracts` · `Matters` · `Obligations` · `Documents` · `Clause Library` · `Playbooks` · `Regulations` · `Signatures` · `Workflow Policies` · `Compliance` · `Drafting` · `Reports` · `Administration` | key: overview.domains.* (AR ✓) |
| 13 | DomainTile › view affordance | label | `Open` | key: overview.viewLabel (AR ✓) |

### needs-attention.tsx (NeedsAttention)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 14 | NeedsAttention › header | heading/body | `Needs Attention` / `Time-critical items across every legal domain, ranked by urgency.` | key: overview.needsAttention.title/description (AR ✓) |
| 15 | Filter chips | tab | `All` · `SLA` · `Obligations` · `Approvals` · `Renewals` · `Hearings` | key: overview.needsAttention.filter* (AR ✓) |
| 16 | Empty state | empty-state | `Nothing needs attention` / `No breached, overdue or imminent items across your domains.` | key: overview.needsAttention.emptyTitle/emptyDescription (AR ✓) |
| 17 | Row type badges | badge | `SLA breach` · `Overdue obligation` · `Pending approval` · `Renewal warning` · `Upcoming hearing` | key: overview.needsAttention.typeLabels.* (AR ✓) |
| 18 | Row enum badge humanizer | badge | `Renewal due` · `Expiring soon` · `Expired` · `Pending` · `Pending approval` · `Awaiting approval` · `In review` · `Internal review` · `In progress` · `Blocked` | local `BADGE_LABELS` map, EN+AR inline (AR ✓) |
| 19 | Row subtitle/badge (owner, case no.) | data-driven | e.g. `CASE-2024-001`, owner names | data-driven (attention feed API; passthrough via `humanizeLexText`) |

### my-work.tsx (MyWork)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 20 | MyWork › header | heading/body | `My Work` / `Items assigned to or requested by you across the suite.` | key: overview.myWork.title/description (AR ✓) |
| 21 | MyWork › empty state | empty-state | `No assigned work` / `You have no cases, requests or tasks assigned to you right now.` | key: overview.myWork.emptyTitle/emptyDescription (AR ✓) |
| 22 | MyWork › row status humanizer | badge | `Draft` · `Active` · `Expired` · `Routed` · `Submitted` · `Classified` · `Responded` · `Approved` · `Rejected` · `Pending` · `In review` · `Internal review` · `Legal review` · `Negotiation` · `Pending signature` · `Open` · `Closed` · `Completed` | local `STATUS_LABELS` map, EN+AR inline (AR ✓) |
| 23 | MyWork › row title/domain badge | data-driven | contract/case/request titles | data-driven (my-work API); domain badge label keyed via overview.domains |

### persona-home.tsx (PersonaHome) — bundle `persona-labels.ts`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 24 | Persona home › variant titles | heading | `Your requests` · `Pending your approval` · `Command center` · `Case operations` · `Contract operations` · `My work` · `Advisory workspace` · `Oversight` · `Compliance & audit` · `Configuration` · `Legal Affairs` | key: persona.home.variants.*.title (AR ✓) |
| 25 | Persona home › variant subtitles | subheading | (one per variant, e.g. `Submit and track your legal service requests.`) | key: persona.home.variants.*.subtitle (AR ✓) |
| 26 | Quick-link cards | link | `My Requests` · `New Request` · `Request Approvals` · `Litigation Cases` · `Investigations` · `Settlements & ADR` · `Contracts` · `Consultations` · `Documents` · `AI Drafting` · `Clause Library` · `Playbooks` · `Reports` · `Analytics & KPIs` · `Risk Analytics` · `Compliance` · `Entities & Exposure` · `Calendar` · `Inbox` · `Administration` | key: persona.quickLinks.* (AR ✓) |

_Persona chrome bundle also carries: badge (`tier` / `Escalation L{level}` (fn) / `Your active legal role`), tiers (Business/Legal/Oversight/Admin), switcher (`Switch persona` / `Switch active persona` / `Active` / `Switching…` / `Could not switch persona. Please try again.`), the "My Lex Access" sheet (trigger/title `My Lex Access`, `Your active legal persona, available roles, and effective permissions.`, `Active role` / `Available roles` / `Effective permissions` / `Tier` / `Escalation level` / `You have no legal role assigned. Contact your administrator to request access.` / `No effective Lex permissions for this persona.` / `Granted` / `Not granted`), domain group headings, verb labels — all `(AR ✓)`. These render in the layout header, not the page body._

### first-run-banner.tsx (FirstRunBanner) — local `FIRST_RUN_COPY`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 27 | Eyebrow | badge | `Welcome to Watheeq` | key: local FIRST_RUN_COPY.eyebrow (AR ✓) |
| 28 | Title / subtitle | heading/body | `Set up your legal affairs workspace` / `Your command center is ready. Start with one of these to bring contracts, requests and compliance to life — the dashboards below fill in as you go.` | key: local FIRST_RUN_COPY.title/subtitle (AR ✓) |
| 29 | 3 steps | body | `Open a service-desk request` / `Route the first legal request through intake and SLA tracking.` · `Draft a contract with AI` / `Generate a first draft from a clause library and a playbook.` · `Configure compliance` / `Switch on the rules that watch your portfolio for risk.` | key: local FIRST_RUN_COPY.steps[] (AR ✓) |
| 30 | Step CTAs | button/link | `New request` · `AI drafting` · `Compliance` | key: local FIRST_RUN_COPY.actions.* (AR ✓) |

### contract-analytics.tsx (ContractAnalytics)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 31 | Wrapper section title/description | heading/body | `Contract analytics` / `Contract lifecycle, review queue, renewals, and compliance signals.` | key: local CONTRACT_ANALYTICS_TITLE (AR ✓) |
| 32 | Lifecycle Pipeline card | heading/body | `Lifecycle Pipeline` / `Contract volume by Watheeq lifecycle stage.` | key: overview.lifecycle.* (AR ✓) |
| 33 | Monthly Activity card + series | heading/body/legend | `Monthly Activity` / `Created, activated, renewed and expired contracts over time.`; series `Created`/`Activated`/`Renewed`/`Expired` | key: overview.monthlyActivity.* (AR ✓) |
| 34 | Renewal Warnings card | heading/body/empty | `Renewal Warnings` / `Early warnings from expiry and renewal notice windows.` / load error / empty `No renewal warnings` / `No contracts are inside the configured renewal window.` / `{days} days` (fn) | key: overview.renewals.* (AR ✓) |
| 35 | Review Queue card | heading/body | `Review Queue` / `Workflow-backed contract approvals and pending legal tasks.` | key: overview.reviewQueue.* (AR ✓) |
| 36 | Review Queue › selection controls | label/aria | `{n} selected` (fn) · `Select visible workflow tasks` (aria) · `Select visible tasks` · `{selected} of {total}` (fn) · `Unassigned` · `Started` | key: overview.reviewQueue.* (AR ✓) |
| 37 | Review Queue › bulk buttons | button | `Approve` / `Request Changes` / `Reject` / `Applying...` | key: commonActions.* (AR ✓) |
| 38 | Review Queue › empty + toasts | empty-state/toast | `Nothing to review` / `No active contract workflows are waiting for review.`; `Select workflow tasks first`; `Bulk decision applied` / `{n} workflow task(s) updated.` (fn); `Bulk decision completed with errors` / `{s} succeeded, {f} failed.` (fn); `Bulk decision failed` | key: overview.reviewQueue.* (AR ✓) |
| 39 | Review Queue › row select aria | aria-label | `Select {title}` (fn) | key: overview.reviewQueue.selectRowAria (AR ✓) |
| 40 | Compliance Alerts card | heading/body/empty | `Compliance Alerts` / `Latest non-compliance findings from the compliance dashboard.` / `No open alerts` / `No active compliance alerts are currently open.` | key: overview.complianceAlerts.* (AR ✓) |
| 41 | Recent Contracts card | heading/body/empty | `Recent Contracts` / `Latest contract records and current lifecycle state.` / `No contracts yet` / `No contracts are available for this tenant.` / `Value:` / `Undisclosed` / `Expires {date}` (fn) / `No expiry` | key: overview.recentContracts.* (AR ✓) |
| 42 | Regulations card | heading/body/empty | `Active Regulations` / `Enabled regulatory controls and rule definitions.` / `No regulations` / `No regulations are configured for this tenant.` / `Regulation library record` | key: overview.regulations.* (AR ✓) |
| 43 | Regulations row title | data-driven | `regulation.title_en` (English-only field always shown) | **data-driven — localization gap** (regulations render `title_en`; no `title_ar` shown even in AR mode) |
| 44 | "View all" links | link | `View all` | key: commonActions.viewAll (AR ✓) |
| 45 | Compliance alert status / contract type | data-driven | `alert.status` and `contract.type` humanized via `.replace(/_/g,' ')` + CSS capitalize | data-driven (contract/alert API tokens) |

---

## Route: /lex/service-desk — page.tsx (ServiceDeskPage) — "My Requests" list
_Module bundle: `service-desk/_components/labels.ts` (`useServiceDeskLabels`), `_components/list-extra-labels.ts` (`useListExtraLabels`)_

### page.tsx list shell
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PageHeader | heading/body | `My Requests` / `Track your legal requests, their status and SLA position.` | key: list.pageTitle/pageDescription (AR ✓) |
| 2 | Header nav buttons | button/link | `SLA board` · `Intake` · `Notifications` | key: extra.nav.slaBoard/intake/notifications (AR ✓) |
| 3 | New-request CTA | button | `New request` | key: list.newRequest (AR ✓) |
| 4 | Search input | placeholder | `Search requests...` | key: list.searchPlaceholder (AR ✓) |
| 5 | Table columns | table-header | `Number` · `Request` · `Service` · `Priority` · `Status` · `Updated` | key: list.columns.* (AR ✓) |
| 6 | Status filter options | option | `Draft` · `Submitted` · `Pending requester approval` · `Pending provider approval` · `Approved` · `Routed` · `In execution` · `Delivered` · `Closed` · `Returned` · `Cancelled` | key: statusOptions (AR ✓) |
| 7 | Priority filter options | option | `Normal` · `Urgent` | key: priorityOptions (AR ✓) |
| 8 | Filter labels | label | `Status` · `Priority` · `Service` · `Request type` (+ ph `e.g. contract_review`) · `Department` (+ ph `e.g. Procurement`) | key: list.filters.* / extra.filters.* (AR ✓) |
| 9 | View toggle | label/tab/aria | `View` · `List` · `Board` | key: extra.view.label/list/board (AR ✓) |
| 10 | Empty state | empty-state | `No requests yet` / `No legal requests matched the current filters.` | key: list.emptyTitle/emptyDescription (AR ✓) |
| 11 | Untitled row / board fallbacks | body | `Untitled request` · `No requests` (board empty col) · `No number` · `Requester` | key: list.untitled / extra.view.* (AR ✓) |
| 12 | Row title / request_type / service name | data-driven | `resolveLocalized(title)`, `request_type.replace(/_/g,' ')`, service names | data-driven (`/api/v1/lex/legal-requests`; service names `resolveLocalized(svc.name)`) |

### list-kpi-header.tsx / list-extra-labels.ts (KPIs)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 13 | KPI tiles | heading/body | `Total requests` · `SLA compliance` (+ `Target {target}%` (fn)) · `Overdue requests` / `Past their turnaround deadline` · `Avg processing` / `Hours per request` · `Closed-case ratio` / `Share of cases closed`; error `Failed to load analytics.` | key: extra.kpis.* (AR ✓) |
| 14 | KPI detail captions | label | `Current queue` · `Request share` · `SLA target` · `Performance signal` | key: extra.kpiDetails.* (AR ✓) |

### list-quick-filters.tsx / list-bulk-actions.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 15 | Quick-view chips | tab | `Quick views` · `My requests` · `Urgent` · `Awaiting approval` | key: extra.quickViews.* (AR ✓) |
| 16 | Saved views bar | button/label | `Save current view` · `Saved views` · `No saved views yet` | key: extra.savedViews.* (AR ✓) |
| 17 | Bulk action buttons | button | `Reclassify priority` · `Submit` · `Export CSV` | key: extra.bulk.* (AR ✓) |
| 18 | Bulk reclassify dialog | modal-title/label/button | `Reclassify priority` / `Set a new priority for {n} selected request(s).` (fn) / `New priority` / `Reason` (+ ph `Why is the priority changing?`) / `Cancel` / `Apply` / `Applying...` | key: extra.bulk.* (AR ✓) |
| 19 | Bulk validation + result toasts | validation/toast | `A reason is required.`; `Bulk action completed` / `{u} updated, {f} failed.` (fn); `{n} request(s) skipped (only drafts can be submitted).` (fn); `Nothing to submit` / `None of the selected requests are drafts.`; `No rows to export.` | key: extra.bulk.* (AR ✓) |

---

## Route: /lex/service-desk/new — page.tsx (New Legal Request wizard)
_Module bundles: `_components/labels.ts` (`useServiceDeskLabels().wizard`) + per-step `_lib/*-i18n.ts` (each a self-contained `{en, ar}` locale-ternary bundle)_

### Wizard shell (labels.ts › wizard)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Page title/description | heading/body | `New Legal Request` / `Submit a request to the legal department through the service catalog.` | key: wizard.pageTitle/pageDescription (AR ✓) |
| 2 | Step labels + nav | tab/button | `Service` · `Details` · `Review` · `Step {c} of {t}` (fn) · `Next` · `Back` · `Cancel` · `Submit request` · `Submitting...` | key: wizard.* (AR ✓) |
| 3 | Eligibility copy | body/badge | `Choose a service` / `Select the legal service you need. Eligibility is checked automatically.` · `Checking eligibility...` · `You are eligible for this service.` · `You are not eligible for this service.` · `Reasons` · `Re-check` | key: wizard.* (AR ✓) |
| 4 | Details step labels/placeholders | label/placeholder | `Title (English)` (ph `Contract review for vendor X`) · `Title (Arabic)` (ph `مراجعة عقد المورّد س`) · `Description` (ph `Provide the relevant context…`) · `Requester name` (ph `Full name`) · `Department` (ph `e.g. Procurement`) · `Priority` · `Urgency justification` (+ hint + ph) | key: wizard.* (AR ✓) |
| 5 | Review step | heading/label/badge | `Review and submit` / `Confirm the details before submitting to the legal department.` · `Service` · `Priority` · `Required approvals` · `Requester approval` · `Provider approval` · `Required` · `Not required` · `No service selected` | key: wizard.* (AR ✓) |
| 6 | Wizard validation errors | validation | `Please select a service.` · `A request title is required.` · `Requester name is required.` · `Urgent requests require a justification.` | key: wizard.errors.* (AR ✓) |
| 7 | Wizard toasts | toast | `Request submitted.` / `Could not submit the request.` | key: wizard.toast.* (AR ✓) |

### service-catalog-step.tsx (service-catalog-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 8 | Search + meta | label/placeholder/badge | `Search services` (ph `Search by name, description, or code`) · `Recently used` · `Clone from a previous request` · `Approval required` · `Platform` / `Email` / `Platform & email` · `Code` · `Selected` · `Recommended` · `Any requester` · `{count} entities` (fn) · `Target: {days} working days` (fn) · `Eligibility applies` | key: service-catalog-i18n STRINGS (AR ✓) |
| 9 | Empty/no-match states | empty-state | `No services match "{query}".` (fn) / `No matching services` · `No services are available.` / `No services available` · `Select the legal service you need.` | key: service-catalog-i18n (AR ✓) |
| 10 | Service names/descriptions | data-driven | catalog service name/description | data-driven (service catalog API, backend bilingual) |

### Details-step fields (details-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 11 | Bilingual title fields | label/placeholder | `Title (Arabic)` / `Title (English)` (ph `Enter a short, descriptive title in Arabic/English`) · `at least one` · `*` (`required`) · `Copy to Arabic` / `Copy to English` | key: details-i18n (AR ✓) |
| 12 | Description field | label/placeholder/button | `Description` (ph `Describe your request: context, what you need, and any deadline.`) · `Insert template` (+ confirm `This will replace your current description with a structured template. Continue?`) · `Draft with AI` | key: details-i18n (AR ✓) |
| 13 | Template skeleton headings | body | `Background` · `What I need` · `Desired outcome` · `Deadline` | key: details-i18n.tpl* (AR ✓) |
| 14 | Char counter aria | aria-label | `{used} of {max} characters used` (fn) | key: details-i18n.counterA11y (AR ✓) |
| 15 | Title validation | validation | `Provide a title in at least one language.` | key: details-i18n.titleRequired (AR ✓) |

### requester-field.tsx (requester-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 16 | Requester field | label/body/badge | `Requester` · `Submitting this request as yourself.` · `Acting on behalf of someone else?` · `Enter the requester's full name` (ph) · `Requester full name` · `Submitted by {me}` (fn) · `You` · `Avatar for {name}` (fn) · `Requester name` (fallback) | key: requesterLabels (AR ✓) |

### beneficiary-picker.tsx (beneficiary-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 17 | Beneficiary picker | label/placeholder/aria | `Beneficiary department / entity` · `This drives eligibility and routing for the request.` · `Select a beneficiary department or entity` (ph) · `Search by name or code…` (ph) · `Beneficiary department or entity` (aria) · `Code` | key: beneficiaryLabels (AR ✓) |
| 18 | Entity-type badges | badge | `Company` · `Business unit` · `Department` · `Section` · `Shared services unit` | key: beneficiaryLabels.entityType.* (AR ✓) |
| 19 | Empty/error hints | empty-state/error | `The organization registry has no entities yet. Ask an administrator to add departments or entities before requesting.` · `Could not load the organization registry. Please try again.` | key: beneficiaryLabels.emptyHint/loadError (AR ✓) |
| 20 | Entity names | data-driven | org entity display names | data-driven (org registry API) |

### priority-selector.tsx (priority-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 21 | Priority cards | legend/label/badge | `Priority` (aria `Request priority`) · `Normal` / `Standard turnaround.` · `Urgent` / `Prioritised & escalated — audited.` · `Selected` · `Urgent requests are tracked and require a justification.` · `SLA:` | key: priorityLabels (AR ✓) |
| 22 | Justification area | label/placeholder | `Urgency justification` · `Reason` (ph `Select a reason`) · `Explain the urgency` (hint `Describe the business impact (not requester delay). This is audited.`) · ph `Explain why this request must be handled urgently.` | key: priorityLabels (AR ✓) |
| 23 | Suggested reasons + seeds | option/body | `Regulatory deadline` · `Litigation timeline` · `Executive request` · `Contractual deadline` · `Other` (+ seed sentences per reason) | key: priorityLabels.reasons/reasonSeed (AR ✓) |

### attachments-field.tsx (attachments-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 24 | Attachments field | label/body/button | `Attachments` · `Drag & drop files here, or click to browse` · `No documents attached yet` / `Attach the contract or any supporting documents` · `Uploading…` · `{count} file(s) · {size}` (fn) · `Remove` / `Remove {name}` (fn) | key: attachmentsMessages (AR ✓) |
| 25 | Virus-scan badges + units | badge | `Scanning` · `Clean` · `Infected` · `Unknown`; units `B`/`KB`/`MB`/`GB` | key: attachmentsMessages.scan*/units (AR ✓) |

### sla-promise-preview.tsx (sla-preview-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 26 | SLA promise preview | heading/body | `Service-level promise` · `Acknowledged within {window}` (fn) · `Resolved within {days} working day(s) · by ~{by}` (fn) · `Escalation` · `L{level} · day {day}` (fn) · `Dates are approximate; the working calendar is authoritative.` · `Urgent`/`Normal` · `Select a service to see its SLA.` · `No SLA target configured for this service.` · `{n} working day(s)`/`{n} working hour(s)` (fn) | key: slaPreviewLabels (AR ✓) |

### draft-resume-banner.tsx / autosave-indicator.tsx (draft-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 27 | Draft resume banner | body/button | `You have an unsaved draft from` … `.` · `Resume` · `Discard` · `Dismiss` | key: draftStrings (AR ✓) |
| 28 | Autosave indicator | body | `Saving…` · `Autosaved` | key: draftStrings (AR ✓) |

### review-step.tsx / what-happens-next.tsx (review-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 29 | Review groups | heading | `Review your request` / `Check the details below. Use Edit to revisit any section before submitting.` · groups `Service`/`Title`/`Description`/`Requester`/`Beneficiary`/`Priority`/`Attachments` | key: reviewStrings (AR ✓) |
| 30 | Review fields | label/value | `Selected service` · `Channel` · `Title (English)` · `Title (Arabic)` · `Description` · `Requester name` · `Beneficiary` · `Beneficiary entity` · `Priority` · `Urgency justification` · `Files attached` · `Not set` · `Edit` (aria `Edit this section`) · `Urgent`/`Normal` · `No files attached`/`1 file`/`files` | key: reviewStrings (AR ✓) |
| 31 | What-happens-next panel | heading/body | `What happens after you submit` / `A quick preview of the journey your request will take.` · `Submitted` / `Your request is logged and given a tracking number.` · `Approvals` · `Requester approval required` · `Provider approval required` · `No approvals — routed directly` · `An approval policy applies to this service.` · `Assigned` / `The request is routed to the responsible legal team.` · `SLA clock starts` / `Acknowledgement and turnaround timers begin once assigned.` | key: reviewStrings (AR ✓) |
| 32 | Escalation preview | body | `If the SLA is missed, it escalates to` · `Escalation contacts are resolved from the beneficiary entity.` · `Select a beneficiary entity to preview the escalation path.` · `No escalation contacts are configured for this entity.` · `Escalation contacts are not available right now.` · `L` (level prefix) | key: reviewStrings (AR ✓) |

### submission-success.tsx (success-i18n.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 33 | Success screen | heading/body/button | `Request submitted` / `Your legal request has been received and assigned a reference number.` · `Reference number` · `Copy reference number` / `Reference number copied.` · `Status`/`Priority` · `What happens next` / `Current` · timeline `Submitted`/`Acknowledged`/`In progress`/`Delivered` · `View request` · `Create another` · `Copy link` / `Request link copied.` · region aria `Request submission confirmation` | key: successLabels (AR ✓) |

---

## Route: /lex/service-desk/intake — page.tsx (Intake Triage)
_Module bundle: `service-desk/intake/_labels.ts` (`useIntakeLabels`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Page hero | heading/body | `Intake Triage` / `Email-ingested and direct-submission intake messages awaiting triage into legal requests.` | key: intake.pageTitle/pageDescription (AR ✓) |
| 2 | Search / empty | placeholder/empty-state | `Search intake messages...` · `No intake messages` / `No intake messages matched the current filters.` · `Not linked` | key: intake.* (AR ✓) |
| 3 | Stat tiles | heading/body | `Pending` / `Messages waiting for triage.` · `Processed` / `Messages already converted or dismissed.` · `Errored` / `Messages that failed intake processing.` · `Loaded messages` · `Intake share` | key: intake.stats/statDetails (AR ✓) |
| 4 | Table columns | table-header | `From` · `Subject` · `Status` · `Attachments` · `Linked request` · `Received` | key: intake.columns.* (AR ✓) |
| 5 | Status filter/options | option | `Pending` · `Processed` · `Errored` | key: intake.statusOptions (AR ✓) |
| 6 | Attachments count / no subject | body | `{count} attachment(s)` (fn) · `(No subject)` | key: intake.attachmentsCount/noSubject (AR ✓) |
| 7 | Message sheet (`_intake-message-sheet.tsx`) | modal-title/label/link | `Intake message` / `Full intake message and its routing into the request register.` · `Message` · `Routing` · `From`/`To`/`Subject`/`Status`/`Received`/`Mailbox` · `Direct submission` · `Attachments` · `Linked request` · `View linked request` · `Not linked to a request` · `Create request from this message` | key: intake.sheet.* (AR ✓) |
| 8 | Message from/subject | data-driven | sender address, subject line | data-driven (intake message API) |

---

## Route: /lex/service-desk/[id] — page.tsx (Request Detail)
_Module bundles: `_components/labels.ts` (`useServiceDeskLabels`), `_components/detail-extra-labels.ts` (`useDetailExtraLabels`), `_components/execution-extra-labels.ts`, `_components/sla-extra-labels.ts`_

### Detail shell + tabs (labels.detail / detail-extra.tabs / actionBar / stepper)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Detail states | heading/error/empty | `Request` (loading) · `Legal service request.` · `Failed to load the request.` · `Request not found` / `This request doesn't exist or was removed. It may have been deleted, or the link is out of date.` · `Back to Service Desk` | key: detail.* (AR ✓) |
| 2 | Header action buttons | button | `Edit` · `Submit` · `Reclassify priority` · `Delete` | key: detail.* (AR ✓) |
| 3 | Metric strip | label | `Status` · `Priority` · `Service` · `Number` | key: detail.metric* (AR ✓) |
| 4 | Overview card + metadata | heading/label | `Request overview` / `Core request state and intake context.` · `Requester` · `Department` · `Request type` · `Requester approval` · `Provider approval` · `Created` · `Updated` · `Not set` · `Required`/`Not required` | key: detail.* (AR ✓) |
| 5 | Description / urgency sections | heading/empty | `Description` / `No description provided.` · `Urgency justification` / `No urgency justification recorded.` | key: detail.* (AR ✓) |
| 6 | Priority history | heading/body | `Priority history` / `Audited reclassifications between urgent and normal.` / `No priority changes recorded.` · `{from} → {to}` (fn) | key: detail.priorityHistory* (AR ✓) |
| 7 | Tabs | tab | `Overview` · `SLA` · `Approval` · `Execution` · `Activity` | key: detail-extra.tabs.* (AR ✓) |
| 8 | "What needs you now" action bar | heading/button/body | `What needs you now` · `Submit request` / `This draft is ready to submit to the legal department.` · `Route request` / `Approved — route it to spawn the matter and start execution.` · `Confirm completeness` / `All required items are satisfied — confirm completeness to start the execution clock.` · `Manage delivery confirmation` / `Delivered — request or await the requester's delivery confirmation.` · `No action needed from you` / `This request is progressing through its workflow.` · `You have read-only access to this request.` | key: detail-extra.actionBar.* (AR ✓) |
| 9 | Lifecycle stepper (`request-lifecycle-stepper.tsx`) | breadcrumb/label | `Lifecycle`; steps `Draft`/`Submitted`/`Approval`/`Approved`/`Routed`/`In execution`/`Delivered`/`Closed`; `Returned`/`Cancelled` + `This request left the main lifecycle.` | key: detail-extra.stepper.* (AR ✓) |

### route-request-dialog.tsx / linked-subject-card.tsx / clone-lineage-banner.tsx (detail-extra)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 10 | Route dialog | button/modal-title/body/toast | `Route request` / `Route this request` / `Routing the approved request spawns the legal matter and moves it into execution. This cannot be undone.` / `Route request` / `Request routed.` | key: detail-extra.route.* (AR ✓) |
| 11 | Linked-subject card | heading/link/label | `Linked matter` / `The case or consultation spawned from this request.` · `Open linked case` · `Open linked consultation` · `Subject type` · `Reference` | key: detail-extra.linkedSubject.* (AR ✓) |
| 12 | Clone-lineage banner | link/badge | `Clone of {ref}` (fn) · `continued as {ref}` (fn) · `Lineage` · `View origin request` · `View continuation request` · `REQ {id}` (fn) | key: detail-extra.clone.* (AR ✓) |

### request-activity-timeline.tsx (detail-extra.activity)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 13 | Activity timeline | heading/body/empty | `Activity` / `A unified, reverse-chronological history of everything on this request.` / `No activity has been recorded yet.` / `Some activity sources could not be loaded.` | key: detail-extra.activity.* (AR ✓) |
| 14 | Activity event templates | body | `by {actor}` (fn) · `Priority changed: {from} → {to}` (fn) · `Review round {n} opened` (fn) · `Review round {n} closed ({outcome})` (fn) · `Delivery confirmation requested` · `Delivery confirmation {status}` (fn) · `Approval task "{name}" — {status}` (fn) · `Status: {from} → {to}` (fn) | key: detail-extra.activity.* (AR ✓) |

### revise-request-dialog.tsx (detail-extra.revise)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 15 | Revise dialog | button/modal-title/body | `Revise request` / `Revise request in execution` / `Edit the request while it is in execution. Substantial edits reopen the completeness gate and reset the SLA clock.` | key: detail-extra.revise.* (AR ✓) |
| 16 | Revise fields | label | `Title (English)`/`Title (Arabic)`/`Description`/`Department`/`Request type`/`Requester approval required`/`Provider approval required` · `Cancel`/`Apply revision` | key: detail-extra.revise.* (AR ✓) |
| 17 | Revise result banners | modal-body/validation | `A request title is required.`; `Substantial edit applied` / `This revision is substantial: the completeness gate has reopened and the execution SLA clock has reset.`; `Revision applied` / `This was a minor edit — the completeness gate and SLA clock are unaffected.`; `Why it is substantial`; reason labels (`Service changed`/`Request type changed`/`Priority tier changed`/`Scope changed`/`A required item was added`/`A required item was removed`/`Requirements churned significantly`); `Close`; `Revision applied.` | key: detail-extra.revise.* (AR ✓) |

### sla-panel.tsx (labels.sla + sla-extra-labels.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 18 | SLA panel | heading/body/label | `SLA clock` / `Acknowledgement, turnaround and escalation deadlines.` / `The SLA clock has not started yet.` · `Acknowledgement` · `Acknowledge by` · `Acknowledged` · `Pending acknowledgement` · `Acknowledge` · `Turnaround` · `Deliver by` · `Escalation` · `Level {level}` (fn) · `No escalation` · `Outcome` · `Breached` · `On track` · `Started` · `Overdue` | key: sla.* (AR ✓) |
| 19 | SLA outcome options + toast | option/toast | `Pending`/`On time`/`Breached`; `Request acknowledged.` | key: sla.outcomeOptions/toast (AR ✓) |
| 20 | SLA escalation chain (sla-extra) | heading/button/toast | `Escalation recipients` · `No recipient resolved` · `No escalation chain configured for this beneficiary.` · `Escalate now` · `Escalating...` · `Currently at level {c} · advances to level {n}` (fn) · `Already at the highest escalation level.` · `Escalation advanced.` | key: slaExtraLabels (AR ✓) |

### approval-panel.tsx (labels.approval)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 21 | Approval panel | heading/body/button | `Approval chain` / `Two-stage requester then provider approval.` / `No approval workflow has been started for this request.` · `Start approval` / `Starting...` · `Open approval tasks` / `There are no open approval tasks.` · `Approve`/`Reject`/`Submitting...` · `Decision notes` (ph `Optional notes for the decision.`) · `Requester stage`/`Provider stage` · `Status` · `SLA deadline` · `SLA breached` | key: approval.* (AR ✓) |
| 22 | Approval toasts + reject confirm | toast/modal | `Approval started.` / `Decision recorded.`; `Reject approval task` / `This records a rejection on the current approval task. Continue?` / `Reject` | key: approval.* (AR ✓) |

### execution-panel.tsx + dialogs (labels.execution + execution-extra-labels.ts)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 23 | Execution panel | heading/body | `Execution` / `Requirements completeness, review rounds and delivery confirmation.` / `This request has not entered execution yet.` · `Execution status` | key: execution.* (AR ✓) |
| 24 | Execution status options | option | `Awaiting completeness` · `In progress` · `Delivered` · `Returned` · `Auto-closed` · `Closed` | key: execution.statusOptions (AR ✓) |
| 25 | Requirements checklist | heading/body/button/badge | `Requirements checklist` / `Every required item must be satisfied before the execution clock starts.` / `No requirement items.` · `Add requirement`/`Mark satisfied`/`Mark pending`/`Remove` · `Satisfied`/`Pending`/`Required`/`Optional` · `Attachment`/`Data` | key: execution.* (AR ✓) |
| 26 | Completeness / review rounds / delivery | label/body | `Completeness`/`Confirmed complete`/`Not yet confirmed`/`Confirm completeness` (hint) · `Return incomplete` · `Review rounds` / `Return-incomplete cycles. After the second return the request auto-closes.` / `No review rounds.` · `Round {n}` (fn) / `Open` · round outcomes `Accepted`/`Returned`/`Auto-closed` · `{n} review round(s) remaining` (fn) · `Delivery confirmation` (+ desc/empty) · `Request confirmation`/`Respond`/`Confirm delivery`/`Deny`/`Auto-closes` · delivery status `Requested`/`Confirmed`/`Denied`/`Expired` | key: execution.* (AR ✓) |
| 27 | Execution toasts + remove confirm | toast/modal | `Requirement added.`/`Requirement updated.`/`Requirement removed.`/`Completeness confirmed.`/`Request returned as incomplete.`/`Delivery confirmation requested.`/`Response recorded.`; `Remove requirement` / `Remove this requirement item from the checklist?` / `Remove` | key: execution.toast/confirmRemove (AR ✓) |
| 28 | requirement-satisfy-controls (execution-extra) | button/placeholder/toast | `Upload` · `Replace file` · `Uploading… {pct}%` (fn) · `View file` · `Enter value…` (ph) · `Save` · `Value:` · `Satisfied by {by} · {at}` (fn) · `a team member` · toasts `File uploaded and requirement satisfied.`/`Could not upload the file.`/`Value saved and requirement satisfied.` | key: execution-extra.satisfy.* (AR ✓) |
| 29 | Delivery countdown (execution-extra) | body | `Auto-closes in {remaining}` (fn) · `Auto-close window expired` · duration `{d}d {h}h`/`{h}h {m}m`/`{m}m` (fn) | key: execution-extra.countdown.* (AR ✓) |

### Detail dialogs (labels.ts: addRequirement/completeness/return/deliveryRequest/deliveryRespond/reclassify/edit/submit/confirm)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 30 | add-requirement-dialog | modal-title/label/validation | `Add requirement` / `Add a required attachment or data item to the checklist.` · `Code` (ph `e.g. signed_nda`) · `Label (English)`/`Label (Arabic)` · `Kind` · `Required` · `Cancel`/`Add`; `A code is required.`/`A label is required.` | key: addRequirementDialog.* (AR ✓) |
| 31 | completeness-dialog | modal | `Confirm completeness` / `Confirm that all required items are satisfied. This starts the execution clock.` · `Notes` (ph `Optional notes.`) · `Cancel`/`Confirm completeness` | key: completenessDialog.* (AR ✓) |
| 32 | return-incomplete-dialog | modal/validation | `Return incomplete` / `Return the request to the requester as incomplete, opening a review round.` · `Reason` (ph `Explain what is missing or needs revision.`) · `Cancel`/`Return incomplete`; `A reason is required.` | key: returnDialog.* (AR ✓) |
| 33 | delivery-request-dialog | modal/validation | `Request delivery confirmation` / `Ask the requester to confirm delivery. A working-hour deadline is applied automatically.` · `Recipient name` (ph `Full name`) · `Recipient contact` (ph `Email or phone`) · `Notes` · `Cancel`/`Request confirmation`; `A recipient name is required.` | key: deliveryRequestDialog.* (AR ✓) |
| 34 | delivery-respond-dialog | modal | `Respond to delivery confirmation` / `Confirm or deny that the request was delivered.` · `Note` (ph `Optional note.`) · `Cancel`/`Confirm delivery`/`Deny` | key: deliveryRespondDialog.* (AR ✓) |
| 35 | reclassify-dialog | modal/validation | `Reclassify priority` / `Change the request priority. Moving to urgent requires a justification.` · `New priority` · `Reason` (ph `Why is the priority changing?`) · `Urgency justification` (ph `Business impact requiring urgent handling.`) · `Cancel`/`Reclassify`; `A reason is required.`/`Urgent priority requires a justification.` | key: reclassifyDialog.* (AR ✓) |
| 36 | edit-request-dialog | modal/toast | `Edit request` / `Update request metadata. Status and priority changes use dedicated actions.` · `Title (English)`/`Title (Arabic)`/`Description`/`Requester name`/`Department` · `Cancel`/`Save changes`; `A request title is required.`; `Request updated.` | key: editDialog.* (AR ✓) |
| 37 | submit-request-dialog | modal | `Submit request` / `Submit the draft request to the legal department.` · `Notes` (ph `Optional notes recorded on submission.`) · `Cancel`/`Submit` | key: submitDialog.* (AR ✓) |
| 38 | Delete confirm | modal | `Delete request` / `Delete "{title}"? This removes it from the active register.` (fn) / `Delete` | key: confirm.* (AR ✓) |
| 39 | request-board.tsx columns | table-header/board | status column labels reuse `statusOptions`; priority chip reuses `priorityOptions` | key: statusOptions/priorityOptions (AR ✓) |

---

## Route: /lex/service-desk/sla-board — page.tsx (SLA Operations Board)
_Module bundle: `service-desk/sla-board/_labels.ts` (`useSlaBoardLabels`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Page hero | heading/body | `SLA Operations Board` / `Cross-request triage of SLA clocks. Surface acknowledgement and turnaround deadlines about to breach, and escalate before they do.` | key: pageTitle/pageDescription (AR ✓) |
| 2 | Load/empty/search | error/empty/placeholder | `Failed to load SLA clocks.` · `No SLA clocks` / `No SLA clocks match the current filters.` · `Search by request number…` | key: * (AR ✓) |
| 3 | KPI tiles | heading/body | `Breach Imminent` / `On the loaded page` · `Acknowledgement Risk` / `Ack window at risk` · `Breached` / `SLA already missed` · `Escalated` / `Past level 0` | key: kpis.* (AR ✓) |
| 4 | Table columns | table-header | `Request` · `Service` · `Priority` · `Outcome` · `Acknowledgement` · `Turnaround Due` · `Escalation` · `Risk` · `Actions` | key: columns.* (AR ✓) |
| 5 | Priority / outcome options | option | `Urgent`/`Normal`; `Pending`/`On time`/`Breached` | key: priorityOptions/outcomeOptions (AR ✓) |
| 6 | Ack / risk badges | badge | `Acknowledged`/`Overdue`/`At risk`; `Breach imminent`/`Ack risk`/`Escalation imminent`/`Clear` | key: ack.*/risk.* (AR ✓) |
| 7 | Escalation / turnaround cells | body | `Level {level}` (fn) · `No escalation` · `Next:` · `No recipient`; `{formatted} left` (fn) · `Overdue` | key: escalation.*/turnaround.* (AR ✓) |
| 8 | Filters | label/option | `Outcome` · `Breached` · `Escalation level` · `Priority` · `Service code` (ph `e.g. contract_review`) · `Turnaround due before` (+ `Clear`); boolean `Breached`/`Not breached`; escalation levels `Level 0..3` | key: filters.*/booleanOptions/escalationLevelOptions (AR ✓) |
| 9 | Escalate action + toasts | button/toast | `Escalate now` · `Escalating…`; `Escalated` / `SLA clock for {requestNumber} escalated to the next level.` (fn) / `Escalation failed` | key: actions.*/toast.* (AR ✓) |

---

## Route: /lex/service-desk/notifications — page.tsx (Notifications)
_Module bundle: `service-desk/notifications/_labels.ts` (`useNotificationsLabels`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Page hero | heading/body | eyebrow `Legal Service Desk` · `Notifications` / `Your in-app inbox for requests, cases, hearings and judgments, plus the channels each category is delivered on.` | key: pageEyebrow/pageTitle/pageDescription (AR ✓) |
| 2 | Tabs | tab | `Inbox` · `Channel preferences` | key: tabs.* (AR ✓) |
| 3 | Inbox | heading/body/button | `Inbox` / `Notifications addressed to you across the legal service desk.` · `{n} unread` (fn) / `{n} total` (fn) · `Mark read`/`Mark all read`/`Open` · `Untitled notification` · empty `You are all caught up` / `New notifications will appear here as they arrive.` | key: inbox.* (AR ✓) |
| 4 | Inbox toasts | toast | `Notification marked as read.` · `All notifications marked as read.` · `Could not update the notification. Please try again.` | key: inbox.* (AR ✓) |
| 5 | Preferences | heading/body | `Channel preferences` / `Choose which channels deliver each category of notification. Toggles are on by default; turn one off to mute that category on that channel.` · `Category` · `You always receive notifications in your inbox; these toggles control extra delivery channels.` · toasts `Preference saved.` / `Could not save the preference. Please try again.` | key: preferences.* (AR ✓) |
| 6 | Channels | table-header/body | `In-app` / `Shown in this inbox and the bell menu.` · `Email` / `Sent to your registered email address.` | key: channelLabels/channelDescriptions (AR ✓) |
| 7 | Category rows | label/body | `Requests`/`Cases`/`Hearings`/`Judgments`/`Contracts`/`General` + one-line description each (e.g. `Updates on service-desk requests you raised, own or are assigned to.`) | key: categoryLabels/categoryDescriptions (AR ✓) |
| 8 | Notification title/body | data-driven | notification titles/messages | data-driven (notifications API) |

---

## Route: /lex/cases — page.tsx (Litigation Cases)
_Module bundle: `cases/_components/labels.ts` (`useCaseLabels`) — the single largest lex bundle (~1,600 keys, fully bilingual)_

> The list page renders `case-list-workspace.tsx` (command center, table/pipeline/calendar views, bulk actions, preview sheet); the detail page renders `case-command-header.tsx` + 10 tab components. All copy resolves through `useCaseLabels()`. Every row below is `(AR ✓)`.

### case-list-workspace.tsx (list + workspace)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | List header | heading/body/button | `Litigation Cases` / `First-class litigation case management: intake, plaintiff and defendant flows, parties, hearings, tasks, judgments.` · `New Case` · search `Search cases...` | key: list.* (AR ✓) |
| 2 | Table columns | table-header | `Case` · `Case no.` · `Type` · `Company side` · `Status` · `Strength` · `Priority` · `Court` · `Updated` | key: list.columns.* (AR ✓) |
| 3 | List fallbacks/empty | empty-state/body | `No cases found` / `No litigation cases matched the current filters.` · `Untitled case` · `No court set` · `Not assessed` | key: list.* (AR ✓) |
| 4 | Stat tiles | heading | `Total cases` · `As plaintiff` · `As defendant` · `Open / in procedure` | key: stats.* (AR ✓) |
| 5 | Filter labels + enum options | label/option | `Status` / `Company side` / `Strength` / `Priority` / `Case type` (ph `e.g. commercial, labor`); statusOptions (`Intake`/`Phase 1 (directive)`/`Phase 2 (handoff)`/`Open`/`Under procedure`/`Closed`/`Cancelled`), companyStatusOptions (`Plaintiff`/`Defendant`), strengthOptions (`Strong`/`Weak`), priorityOptions (`Critical`/`High`/`Medium`/`Low`) | key: filters.* (AR ✓) |
| 6 | Workspace command center | heading/aria/body | `Closed` (stat) · deadline-risk stat + `{urgent} urgent · {soon} soon` (fn) · statDetails (`Portfolio scope`/`Active docket`/`Closed docket`/`Plaintiff position`/`Defense position`/`Deadline exposure`/`Visible portfolio`/`Portfolio share`/`7-day risk`/`30-day risk`) · `Command center` (aria + subtitle `{visible} of {total}` (fn)) · `Loading…` | key: workspace.* (AR ✓) |
| 7 | Attention cards | heading/body/button | `Assigned to you`/`{name}`/`Unassigned critical`/`Overdue`/`Hearings`/`Weak cases`/`Intake` + descriptions; card actions `Focus table`/`Show critical`/`Open calendar`/`Show weak`/`Open intake` | key: workspace.cards.* (AR ✓) |
| 8 | Workspace toolbar | label/placeholder/button | `Deadline risk` (col) · `Department` (filter + ph) · search + hint · presets (`Portfolio`/`Plaintiff`/`Defendant`/`Intake`/`Critical`) · `Export`/`Clear` · view modes (`Table`/`Pipeline`/`Calendar` + aria) · saved views (`Save current view`/`Saved views`/`No saved views yet`) · `Pick a matter…` empty calendar/pipeline hints · row select/preview aria (fn) · `{count} selected` (fn) | key: workspace.* (AR ✓) |
| 9 | Bulk actions + result toasts | button/toast | bulkActions (`Export center`/`Set status`/`Set priority`/`Assign lawyer`/`Notify department`/`Archive selected`/`Classify / tag`) · `Archive reason` · `{count} cases` (fn) · per-action `…updated` toasts (one/many variants) | key: workspace.bulkActions/* (AR ✓) |
| 10 | Bulk status/priority/assign/classify dialogs | modal-title/label | `Move`/`Archive`/`Set` status dialogs + descriptions (fn) · `Status`/`Reason` (ph) · `Archive`/`Apply status` · priority dialog (`Priority`, ph) · assign/notify dialogs (`Responsible lawyer`/`Department` + ph) · classify dialog (`Classify / tag` + hint) · `Apply …` buttons | key: workspace.* (AR ✓) |
| 11 | Export center | modal-title/body/button | `Export center` / `Export selected`/`Export current`/`Export filtered` sections + descriptions (fn) · `Export CSV`/`Close` · `Server export unavailable` fallback | key: workspace.export* (AR ✓) |
| 12 | Deadline utils / preview sheet | body | deadlines (`Task`/`Court hearing`/`{count} overdue` (fn)/`Deadline elapsed`/`Due in 7d`/`Immediate deadline`/`Due in 30d`/`Upcoming deadline`/`Scheduled`/`Future deadline`/`No visible deadlines`) · preview (`Snapshot`/`Deadline strip`/`Portfolio metadata`/`Remove from selection`/`Select case`/`Open detail`) | key: deadlines.*/preview.* (AR ✓) |
| 13 | Case title / classification name | data-driven | `resolveLocalized(title)`, classification `resolveLocalized(name)` | data-driven (`/api/v1/lex/legal-cases`, classification registry — backend bilingual) |

### case-command-header.tsx + detail shell (detail / tabs)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 14 | Detail states | heading/error | `Case` (loading) / `Loading case data, parties, hearings, and tasks.` / `Failed to load case details.` / `Litigation case detail.` · `Back to cases` | key: detail.* (AR ✓) |
| 15 | Header actions | button | `Edit` · `Intake` · `Change status` · `Set strength` · `Set priority` · `Delete case` | key: detail.* (AR ✓) |
| 16 | Metric strip + overview | label/heading | `Status`/`Company side`/`Strength`/`Priority` · `Case Overview` / `Core case data, court details, and assignments.` · metadata (`Case number`/`Court number`/`Case type`/`Classification`/`Company side`/`Competent court`/`Responsible lawyer`/`Department`/`Section manager`/`Supervisor`/`Handling officer`/`Created`/`Updated`) · `Auto-generated`/`Not set` · `Description` / `No description was captured for this case.` | key: detail.* (AR ✓) |
| 17 | Tabs | tab | `Overview` · `Parties` · `Hearings` · `Tasks` · `Documents` · `Statement of claim` · `Experts` · `Judgments` · `Incoming lawsuit` · `Audit trail` | key: tabs.* (AR ✓) |

### Tab panels (parties/hearings/tasks/documents/pleadings/experts/judgments/defendant/audit)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 18 | parties-tab | heading/body/button/label | `Parties` / `Plaintiffs, defendants, lawyers, witnesses, and experts on this case.` · `Add party` · empty `No parties` / `No parties have been added to this case yet.` · `Role`/`Name`/`Identifier`/`Contact`/`No identifier`/`No contact`/`Remove`; partyForm (`Add party`, `Register a participant…`, `Name is required.`); partyRoleOptions (`Plaintiff`/`Defendant`/`Lawyer`/`Witness`/`Expert`/`Other`) | key: parties.*/partyForm.*/filters.partyRoleOptions (AR ✓) |
| 19 | hearings-tab | heading/body/label | `Hearings` / `Scheduled and recorded hearings with rulings, minutes, and reports.` · `Add hearing`/`No hearings`/… · `Hearing date`/`Location`/`Notes`/`Decision`/`No location`/`No decision recorded`/`Reports & minutes`/`Add report`/`No reports for this hearing yet.`/`Hijri`/`Public holiday`/`Today`/`Upcoming`/`Concluded`; hearingForm + hearingReportForm labels + report-type options (`Minutes`/`Decision`/`Report`) | key: hearings.*/hearingForm.*/hearingReportForm.* (AR ✓) |
| 20 | tasks-tab | heading/body/label | `Tasks` / `Work items defined against this case…` · `Add task`/`No tasks`/… · `Task`/`Assignee`/`Priority`/`Status`/`Due`/`Unassigned`/`No due date`/`Remove` · `Templates`/`Task templates`/… /`Create tasks`/`Task templates created`/`Due in {days} day(s)` (fn); template titles (`Review case file and classification`, `Prepare evidence and document index`, `Draft pleading or response memo`, `Prepare hearing bundle and talking points`, `Validate court deadlines and owner assignments`); taskStatusOptions (`Open`/`In progress`/`Done`/`Cancelled`) | key: tasks.*/taskForm.* (AR ✓) |
| 21 | documents-tab | heading/body/label | `Documents` / `Files and attachments associated with this case…` + very large sub-tree: source labels, meta keys, caption text (fn), local-state warnings, add-dialog (upload/link/reuse modes, title/tags/caption/URL), version compare (`Before`/`After`/`No diff`/`{count} more` (fn)), readiness health (`{percent} ready` (fn), required/recommended badges, checklist items with descriptions). ~180 keys | key: documents.* (AR ✓) |
| 22 | documents-tab › external URL input | placeholder | `https://...` | **HARDCODED** (line 1383) |
| 23 | pleadings-tab | heading/body/label | `Statement of claim` / … · `Add`/`No pleadings`/… · `Type`/`Status`/`Pleading number`/`AI` badge/`Submit`/`File`/`Remove`/`View`/`Body` · AI workspace (`Draft workspace`, `Revision prompt` + ph, `Regenerate`/`Save revision`/`Submit`/`File`), version compare, readiness; pleadingForm + pleadingTypeOptions (`Statement of claim`/`Reply`/`Brief`/`Other`) + pleadingStatusOptions (`Draft`/`In approval`/`Approved`/`Rejected`/`Filed`) | key: pleadings.*/pleadingForm.* (AR ✓) |
| 24 | experts-tab | heading/body/label | `Experts` / … · `Expert name`/`Specialization`/`Mandate`/`Status`/`Report due`/`No report due`/`Report received` · expertForm + expertStatusOptions (`Requested`/`Appointed`/`Report received`/`Closed`/`Cancelled`) | key: experts.*/expertForm.* (AR ✓) |
| 25 | judgments-tab | heading/body/label | `Judgments` / … · `Judgment ref`/`Outcome`/`Summary`/`Recommendation`/`Objection deadline`/`Study`/`No outcome` · judgmentForm + studyForm; judgmentRecommendationOptions (`Pending`/`Object (appeal)`/`Accept`) + judgmentOutcomeOptions (`Won`/`Lost`/`Partial`/`Other`) | key: judgments.*/judgmentForm.*/studyForm.* (AR ✓) |
| 26 | defendant-tab (Incoming lawsuit) | heading/body/label/signal | `Register`/`Plaintiff name`/`Court name`/`Notification date`/`Najiz rep`/`Najiz status`/`Response memo`/`Notify dept`/`Draft memo`/`Start review`/`Concerned dept` + metric/signal strings (`Najiz sync`, `Dept notification`, `Response memo`, `Notified`/`Not notified`, `{days} days ago` (fn), `Sync failed`/`Resolve sync`); defendantForm/najizForm/notifyDeptForm/memoForm; defendantStatusOptions (`Registered`/`Department notified`/`Response drafting`/`Response in review`/`Response approved`/`Response rejected`/`Closed`/`Cancelled`), najizStatusOptions (`Manual`/`Synced`/`Failed`) | key: defendant.*/defendantForm.*/najizForm.*/notifyDeptForm.*/memoForm.* (AR ✓) |
| 27 | audit-tab | heading/body/empty | `Audit trail` / … · `No audit entries`/… · `Actor` · load error | key: audit.* (AR ✓) |

### Dialogs + toasts (case-form-dialog, case-management-dialogs, intake, strength/priority/status)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 28 | case-form-dialog | modal/label/wizard | `Create Case`/`Edit Case` + descriptions · `Title (Arabic)`/`Title (English)` (+ ph) · `Case type` (ph)/`Company status`/`Status`/`Priority`/`Strength` (`No strength`)/`Classification` (`No classification`/`Loading classifications…`)/`Court number`/`Competent court`/`Responsible lawyer`/`Department`/`Description` (all + ph) · `Cancel`/`Create`/`Save changes`/`Back`/`Next` · errors (`titleRequired`/`caseTypeRequired`) · wizard step titles/cues + guidance sub-tree (`Guidance`/`Required evidence`/`Routing hints`/`Apply routing`/`Strength questions`/…) | key: form.* (AR ✓) |
| 29 | case-form-dialog › classification fallback | body | `this classification` / `هذا التصنيف` (locale-branched inline literal) | **HARDCODED** (inline `locale === 'ar' ? …` ternary, lines 477/484; both locales present but not in a bundle) |
| 30 | intake dialog | modal/label | `Intake`/… · `CEO directive ref`/`DoA authority ref` (+ ph) · `Strength assessment`/`Keep strength` · `Status`/`Workflow` · `Not started`/… · `Start`/`Cancel`/`Submit` · `Failed to load…` | key: intake.* (AR ✓) |
| 31 | strength/priority/status dialogs | modal/label | strengthDialog / priorityDialog (`Reason` + ph, `Cancel`/`Submit`) · statusDialog (`Change status`, `Next status`, `Select status`, `No transitions available`) | key: strengthDialog.*/priorityDialog.*/statusDialog.* (AR ✓) |
| 32 | Toasts (26) | toast | `Case created.`/`updated`/`Status updated.`/`Strength updated.`/`Priority updated.`/`Intake started.`/`deleted`/party/hearing/task/pleading/expert/judgment/defendant/najiz/memo/report/classification add-remove/etc. | key: toast.* (AR ✓) |
| 33 | Confirm dialogs | modal | `Delete case`/`Delete "{title}"? …` (fn) · remove party/hearing/task/pleading/expert/judgment/defendant confirms (fn) · `Confirm` | key: confirm.* (AR ✓) |
| 34 | classification-picker.tsx | label/body | `Classification` · `Select at level {level}` (fn) · `None` · `Cleared` · `Loading…` | key: picker.* (AR ✓) |

---

## Route: /lex/cases/classifications — page.tsx (Case Classifications)
_Module bundle: `cases/_components/labels.ts` (`useCaseLabels().classification`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Page header | heading/body/button | `Case classifications` (pageTitle) / pageDescription · `Add` · search `Search classifications...` | key: classification.* (AR ✓) |
| 2 | Empty state | empty-state | classification.emptyTitle / emptyDescription | key: classification.* (AR ✓) |
| 3 | Table columns | table-header | `Code` · `Name` · `Path` · `System` · `Active` | key: classification.columns.* (AR ✓) |
| 4 | Badges + row actions | badge/button | `System`/`Active`/`Inactive` · `Edit`/`Delete` · cascade tree (`Cascade`/`Root level`/empty) | key: classification.* (AR ✓) |
| 5 | classification-form-dialog | modal/label/validation | `Add`/`Edit` titles + description · `Code` (ph) · `Name (Arabic)`/`Name (English)` (+ ph) · `Parent`/`No parent` · `Active`/`Sort` · `Cancel`/`Create`/`Save` · errors (`codeRequired`/`nameRequired`) | key: classification.form.* (AR ✓) |
| 6 | Delete confirm | modal | `Delete "{code}"? …` (fn) | key: classification.confirm.* (AR ✓) |
| 7 | Toasts | toast | `Classification created.`/`updated`/`deleted` | key: toast.classification* (AR ✓) |
| 8 | Classification name | data-driven | `resolveLocalized(node.name)` | data-driven (classification registry, backend bilingual) |

---

## Route: /lex/investigations — page.tsx + /[id]
_Module bundle: `investigations/_components/labels.ts` (`useInvestigationLabels`) — ~700 keys, fully bilingual_

### page.tsx (list) + investigation-board.tsx + investigation-preview-drawer.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | List header | heading/body/button | `Investigations` / `Legal investigations: parties, statements, evidence, findings and approval.` · eyebrow `Legal Suite` · `New Investigation` · `Register your first investigation` · search `Search investigations...` | key: * (AR ✓) |
| 2 | Empty / load error / search hint | empty-state/error/body | `No investigations found` / `No legal investigations matched the current filters. Register a new investigation to start the chain of custody.` · `Failed to load investigations.` · `Clear loaded view` · long searchHint | key: * (AR ✓) |
| 3 | View toggle + saved views | tab/button | `Table`/`Board` · `Save current investigation view`/`Saved investigation views`/`No saved investigation views yet` | key: view.*/savedViews.* (AR ✓) |
| 4 | Stat tiles | heading/body | `Total`/`In Progress`/`Pending Approval`/`Approved` · `Across the register`/`From loaded rows`/`{n} shown in loaded view` (fn)/`{n} on this page` (fn) · statDetails (`Visible portfolio`/`Workload share`/`Active share`/`Approval queue`/`Completion share` + sentences) | key: stats.*/statDetails.* (AR ✓) |
| 5 | Table columns | table-header | `Subject` · `Number` · `Status` · `Priority` · `Lead Investigator` · `Updated` | key: columns.* (AR ✓) |
| 6 | Filters + enum options | label/option | `Status`/`Priority`; statusOptions (`Registered`/`In Progress`/`Results Recorded`/`Pending Approval`/`Approved`/`Rejected`/`Closed`/`Cancelled`), priorityOptions (`Critical`/`High`/`Medium`/`Low`), roleOptions (`Subject`/`Complainant`/`Witness`/`Investigator`/`Expert`/`Other`) | key: filters.* (AR ✓) |
| 7 | Quick-filter presets | label/body | server presets (`Portfolio`/`Critical`/`Pending approval`/`In progress`/`Results recorded` + descriptions) · loaded presets (`My investigations`/`Missing evidence`/`No parties`/`AI drafted`/`Linked to case` + descriptions) · `Signals`/`Case`/`AI`/`No signals` · `Compliance` (dept) · `Case ID` | key: quickFilters.* (AR ✓) |
| 8 | Preview drawer | button/label | `Open record`/`Updated`/`Next action`/`Latest known date`/`Loading...`/`Not available`/`Not set` · next-action labels (`Begin fact gathering`/`Collect evidence`/`Record findings`/`Record recommendations`/`Submit for approval`/`Await approval decision`/`Close investigation`/`Revise findings`/`Closed`/`Cancelled`) | key: preview.* (AR ✓) |

### investigation-form-dialog.tsx (form)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 9 | Form steps | modal/heading | `Create Investigation`/`Edit Investigation` + descriptions · `Case-linked intake`/`Ownership and priority`/`Readiness checklist` + step descriptions | key: form.* (AR ✓) |
| 10 | Form fields | label/placeholder/body | `Linked case ID` (ph `Case UUID or reference`, desc) · `Subject` (ph `Alleged procurement irregularity`, desc) · `Investigation number` (ph `Auto-generated if empty`) · `Lead investigator` (ph `Full name`, desc) · `Priority` (desc) · `Department` (ph `e.g. Compliance`) · readiness checklist items + cues (`Case link present`/`Subject is clear`/`Lead assigned`/`Parties mapped`/`Evidence path mapped`/`Approval route mapped`/`Ready to capture…`/`Complete the remaining cues…`) | key: form.* (AR ✓) |
| 11 | Form buttons/errors | button/validation | `Cancel`/`Create investigation`/`Save changes` · `Subject is required.`/`Lead investigator is required.` | key: form.* (AR ✓) |

### [id]/page.tsx detail + command-header + timeline + approval-ops + dialogs
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 12 | Detail states + header | heading/error/button | `Investigation` / `Loading investigation details.` / `Failed to load investigation details.` / `Legal investigation detail.` · `Edit`/`Delete`/`Change status`/`Start approval` | key: detail.* (AR ✓) |
| 13 | Metric strip + overview | label/heading | `Status`/`Priority`/`Parties`/`Evidence` · `Investigation Overview` / `Core investigation state and context.` · metadata (`Investigation number`/`Lead investigator`/`Department`/`Linked case`/`AI-drafted body`/`Created`/`Updated`) · `Auto-generated`/`Not set`/`None`/`Yes`/`No` | key: detail.* (AR ✓) |
| 14 | Detail sections | heading/body/button | `Parties`/`Statements`/`Evidence`/`Findings`/`Recommendations`/`Results Approval`/`Audit Trail` each with description + empty state + add/record button + `Taken by {name}`/`Collected by {name}` (fn) + `AI-drafted` badge | key: detail.* (AR ✓) |
| 15 | command-header (hero band) | badge/label/action | `Investigation command` · `Approval`/`Readiness` · `{done}/{total} checks` (fn) · `Updated` · required warning · readiness rows (status/findings/recommendations/parties/statements/evidence + helpers, some fn) · action tiles (`Decide approval`/`Review approval`/`Resume investigation`/`Add party`/`Record statement`/`Add evidence`/`Record findings`/`Record recommendations`/`Start approval`/`Change status`/`View timeline` + helpers) · state labels (`Approved`/`Rejected`/`Pending approval`/`Ready to route`/`Not routed`/`{n} pending` (fn)/`Ready`/`Not started`) | key: commandHeader.* (AR ✓) |
| 16 | approval-operations-panel | heading/body/label/button | `Approval Operations` / description · `Loading approval tasks`/`Retry`/`Resume`/`Start approval` · metrics (`Approval state`/`Readiness`/`{done}/{total} checks` (fn)/`Workflow`/`Linked`/`Not started`/`Approval chain has not created a workflow instance.`) · `Approval rejected`/rejectedBody · `Reviewer note: {note}` (fn) · `Ready to route`/readyBody · readiness attention · routing notes · tasks (`Approval tasks`/`{n} open` (fn)/`Task ID`/`Workflow`/`Assignee role`/`Assignee user`/`Created`/`Due`/`Completed`/`Updated`/`Priority`/`Missing`/`Not set`/`Not assigned`/`Task notes`/`Decision notes` (+ ph)) · `Approve`/`Reject` · missing-workflow warning · empty states (5) | key: approvalOps.* (AR ✓) |
| 17 | investigation-timeline | heading/body/event | `Unified Investigation Timeline` / description · `Loading activity`/`Retry audit`/`Retry approvals`/partialError · empty (`No timeline events`/`Activity will appear after…`) · event templates (`Investigation registered`/`Investigation updated`/`Party added: {name}` (fn)/`Statement recorded: {name}` (fn)/`Evidence catalogued: {title}` (fn)/`Findings recorded`/`Recommendations recorded`/`Approval task opened: {title}` (fn)/`Approval task due: {title}` (fn)/`Audit: {action}` (fn)/`Type:`/`Role:`/`Assignee:`/`Actor:` prefixes (fn)) | key: timeline.* (AR ✓) |
| 18 | investigation-dialogs (status/party/statement/evidence/results/recommendations/approval) | modal/label/option | status dialog · party dialog (+ edit; `National ID / employee no. (encrypted)` etc.) · statement dialog (`Deponent name`/`Statement`/`Taken by`/`Taken at`) · evidence workspace (title/category/description/`Collected by`/`Collected date`/`Source`, evidenceTypeOptions [`Document`/`Email`/`Image`/`Video`/`Audio`/`Statement`/`System log`/`Financial record`/`Physical item`/`Other`], evidenceSourceOptions [`Existing file`/`Case document`/`Email archive`/`Interview`/`System export`/`Physical collection`/`Other`], file-id hints) · results/AI brief (`Generate or regenerate an AI brief`, `Brief instructions` + ph, guidance, `Mark this brief ready for approval routing`, `Regenerate brief`/`Accept brief`) · recommendations · approval (`Approver role` (ph `legal_director`)/`Notes`/`Decision notes`) · `Submit`/`Save changes`/`Cancel`/`This field is required.` | key: dialogs.* (AR ✓) |
| 19 | Toasts + confirm | toast/modal | `Investigation created.`/`updated`/`deleted`/`Status updated.`/party/statement/evidence/results/recommendations/approval toasts; confirm (`Delete investigation`/`Delete "{subject}"? …` (fn)/remove party/statement/evidence (fn)/`Confirm`) | key: toast.*/confirm.* (AR ✓) |
| 20 | Subject / lead / evidence titles | data-driven | investigation subject, lead name, evidence title | data-driven (`/api/v1/lex/investigations`) |

---

## Route: /lex/consultations — page.tsx + /[id]
_Module bundle: `consultations/_components/labels.ts` (`useConsultationLabels`)_

### page.tsx (list) + consultations-board / consultations-columns / consultations-kpis
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | List header | heading/body/button | `Consultations` / `Legal advisory: submit, classify, route, respond and approve.` · eyebrow `Legal Suite` · `New Consultation` · search `Search consultations...` | key: * (AR ✓) |
| 2 | Empty / load error | empty-state/error | `No consultations found` / `No consultations matched the current filters.` · `Failed to load consultations.` | key: * (AR ✓) |
| 3 | Stat tiles | heading/body | `Total`/`Open`/`Responded`/`Approved`/`Breaching soon`/`Breached` + statDetails (workload/response coverage/closure rate/SLA risk/breach share/avg response sentences) | key: stats.*/statDetails.* (AR ✓) |
| 4 | Table columns | table-header | `Title`/`Number`/`Type`/`Status`/`Priority`/`Advisor`/`Updated`/`Due / SLA` | key: columns.* (AR ✓) |
| 5 | SLA cell copy | badge/body | `Acknowledged`/`Response due`/`Breached`/`Due soon`/`On track`/`Escalation level {n}` (fn)/`Breached {time}` (fn)/`Outcome`/`Met`/`Pending`/`Ack due`/`Overdue by {x}` (fn)/`in {x}` (fn) | key: sla.* (AR ✓) |
| 6 | Filters + enum options | label/option | `Status`/`Type`/`Priority`; statusOptions (`Submitted`/`Classified`/`Routed`/`Responded`/`Approved`/`Archived`), typeOptions (`General`/`Contractual`/`Labor`/`Regulatory`/`Corporate`/`Litigation`/`Intellectual Property`/`Tax`/`Other`), priorityOptions (`Critical`/`High`/`Medium`/`Low`) | key: filters.* (AR ✓) |
| 7 | Saved views / date range / row + bulk actions | button/label | savedViews (`My queue`/`Assigned to me`/`Awaiting my response`/`Awaiting my approval`/`Unassigned`/`All`/`Save current view`/`Saved views`/`No saved views yet`) · dateRange (`Created from`/`Created to`/`Date range`/`Clear`) · rowActions (`Classify`/`Route`/`Respond`/`Archive`/`Open`/`Actions`) · bulk (`Selected ({n})` (fn)/`Bulk classify`/`Bulk route`/`Bulk archive`/`Bulk tag`/`Bulk delete`/`Apply`/`Clear selection`) · board (`Board`/`Table`/`List view`/`Board view`) | key: savedViews.*/dateRange.*/rowActions.*/bulk.*/board.* (AR ✓) |
| 8 | Pickers / tags / hold / AI draft | label/body/badge | filePicker (`Choose file`/`Upload`/`Browse files`/`No file selected`) · advisorPicker (`Search advisors…`/`{n} open` (fn)/`Workload`) · tags (`Add tag`/`Filter by tag`/`Suggestions`/`No tags yet`) · legalHold (`On legal hold`/banner/`Hold reason`) · aiDraft (`Draft with AI`/`Regenerate`/`AI-generated`/`Use draft`/`Drafting…`/`Edit draft`) | key: filePicker.*/advisorPicker.*/tags.*/legalHold.*/aiDraft.* (AR ✓) |
| 9 | Analytics/audit filters | button/label | audit (`Audit trail`/`Filter by actor`/`Filter by action`/`Export`/`Export CSV`/`by {actor}` (fn)) · analytics (`Export list`/`Time to respond`/`Time to approve`/`Avg`/`Median`) | key: audit.*/analytics.* (AR ✓) |
| 10 | Consultation title | data-driven | `resolveLocalized(title)` | data-driven (`/api/v1/lex/consultations`) |

### consultation-form-dialog.tsx (form)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 11 | Submit form | modal/label/placeholder | `Submit Consultation` / `Open a new legal advisory request.` · `Title (English)` (ph `Vendor contract review`) · `Title (Arabic)` (ph `مراجعة عقد المورّد`) · `Type`/`Priority`/`Requester name` (ph `Full name`)/`Department` (ph `e.g. Procurement`)/`Question` (ph `Describe the legal question or matter...`)/`Tags` (ph `comma, separated, tags`) · `Cancel`/`Submit consultation` | key: form.* (AR ✓) |
| 12 | Form validation | validation | `A title is required in at least one language.`/`The question is required.`/`Requester name is required.` | key: form.errors.* (AR ✓) |

### [id]/page.tsx detail + consultation-dialogs + sla-panel + audit-timeline + legal-hold-banner
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 13 | Detail states + actions | heading/error/button | `Consultation` / `Loading consultation details.` / `Failed to load consultation details.` / `Legal consultation detail.` · `Classify`/`Route`/`Respond`/`Start approval`/`Archive`/`Delete` | key: detail.* (AR ✓) |
| 14 | Metric strip + overview | label/heading | `Status`/`Type`/`Priority`/`Advisor` · `Consultation Overview` / `Core consultation state and routing context.` · metadata (`Consultation number`/`Requester`/`Department`/`Advisor`/`Legal request`/`Responded at`/`Approved at`/`Created`/`Updated`) · `Not set`/`None`/`Unassigned` | key: detail.* (AR ✓) |
| 15 | Detail sections | heading/body/empty | `Question`/`Response` (+ `No response has been recorded yet.`)/`Tags` (`No tags.`)/`Documents` (+ `Attach document`/empty)/`Approval` (+ empty/`Start approval`/`Approve`/`Reject`)/`Audit Trail` (+ empty) | key: detail.* (AR ✓) |
| 16 | Dialogs | modal/label/placeholder | classify (`Classify consultation`/`Assign the subject-matter type and priority.`) · route (`Route consultation`/`Advisor`/`Select an advisor`) · respond (`Record response`/`Record the advisor's response.`/`Response` (ph)/`Draft first response with AI`) · archive (`Archive consultation`/`Reason` (ph `Reason for archiving`)) · attach (`Attach document`/`File ID` (ph `Files-service UUID`)/`File name` (ph `document.pdf`)/`File size (bytes)`/`Kind` (ph `attachment`)) · approval (`Start approval`/`Approver role` (ph `legal_director`)/`Notes`) · `Submit`/`Cancel` | key: dialogs.* (AR ✓) |
| 17 | legal-hold-banner | badge/body | `On legal hold` / `This consultation is under legal hold and cannot be archived or have documents removed.` | key: legalHold.* (AR ✓) |
| 18 | Toasts + confirm | toast/modal | `Consultation submitted.`/`deleted`/`classified`/`routed`/`Response recorded.`/`archived`/`Document attached.`/`Document removed.`/`Approval chain started.`/`Decision applied.` · confirm (`Delete consultation`/`Delete "{title}"? …` (fn)/`Remove document`/`Remove "{name}" from this consultation?` (fn)/`Confirm`) | key: toast.*/confirm.* (AR ✓) |

---

## Route: /lex/settlements — page.tsx + /[id]
_Module bundle: `settlements/_components/labels.ts` (`useSettlementLabels`); print doc `settlement-agreement-print.tsx` (local `agreementLabels`); `_lib/settlement-sla.tsx`_

### page.tsx (list) + settlement-board + settlement-analytics + settlement-approver-queue
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | List header | heading/body/button | `Settlements & ADR` / `Reconciliation and alternative-dispute-resolution attempts across legal matters.` · `New Settlement` · search `Search settlements...` | key: list.* (AR ✓) |
| 2 | Empty + columns + row actions | empty-state/table-header/button | `No settlements found` / `No settlement or reconciliation attempts matched the current filters.` · columns (`Settlement`/`Reference`/`Status`/`Method`/`Value`/`Counterparty`/`Updated`/`Actions`) · rowActions (`View`/`Record terms`/`Submit for approval`/`Close by reconciliation`/`Delete`) · `Not set`/`No value` | key: list.* (AR ✓) |
| 3 | Stat tiles | heading/body | `Total`/`Negotiating`/`Pending approval`/`Executed` + statDetails (`Matching filters`/`Portfolio share`/`Negotiation share`/`Approval queue`/`Approval share`/`Execution share` + sentences) | key: stats.*/statDetails.* (AR ✓) |
| 4 | Filters + enum options | label/option | `Status`/`Method`; statusOptions (`Proposed`/`Negotiating`/`Pending approval`/`Approved`/`Executed`/`Rejected`/`Abandoned`), methodOptions (`Reconciliation`/`Mediation`/`Arbitration`/`Negotiation`/`Other`) | key: filters.* (AR ✓) |

### settlement-form-dialog / negotiation-round-dialog / settlement-decision-dialog
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 5 | settlement-form-dialog | modal/label/placeholder | `Open settlement`/`Record settlement terms` + descriptions · `Matter` (ph `Select a matter`, hint `Search by title or matter number.`) · `Title` (ph `Reconciliation with vendor X`) · `Reference` (ph `Auto-generated if left blank`) · `Method`/`Terms` (ph)/`Value` (ph `0.00`)/`Currency` (ph `SAR`)/`Counterparty name` (ph `Other party`)/`Counterparty contact` (ph `Email or phone`)/`Counterparty ID` (ph `CR / national ID`) · `Counterparty details are encrypted at rest.` · `Cancel`/`Open settlement`/`Save terms` · errors (matter/title/terms required, `Value must be a non-negative number.`) | key: form.* (AR ✓) |
| 6 | negotiation-round-dialog | modal/label/empty | `Negotiation rounds` / `Recorded offers and counter-offers in the negotiation.` · `Add round` · `Proposed by` (ph `Our side / counterparty`)/`Proposed value` (ph `0.00`)/`Currency` (ph `SAR`)/`Terms` (ph)/`Outcome` (ph `e.g. countered, accepted in principle`) · `Round {n}` (fn) · empty (`No rounds recorded`/`Add the first negotiation round to start the record.`) · validation (`Value must be a non-negative number.`/`Round terms are required.`/`Proposing party is required.`) | key: round.* (AR ✓) |
| 7 | settlement-decision-dialog | modal/label | `Approve settlement` / `Record an approval decision for the pending settlement.` · `Decision`/`Approve`/`Reject`/`Notes` (ph `Optional decision rationale...`)/`Cancel`/`Submit decision` · `This settlement is not awaiting an approval decision.`/`No approval workflow is attached to this settlement.` | key: decision.* (AR ✓) |

### [id]/page.tsx detail + settlement-stepper + counterparty-insights + settlement-audit-feed + settlement-documents-section + settlement-agreement-print
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 8 | Detail states + actions | heading/error/button | `Settlement` / `Settlement / ADR detail.` / `Failed to load settlement details.` · `Record terms`/`Add round`/`Submit for approval`/`Approval decision`/`Close by reconciliation`/`Delete` | key: detail.* (AR ✓) |
| 9 | Metric strip + overview | label/heading | `Status`/`Method`/`Value`/`Rounds` · `Settlement overview` / `Core settlement state and approval context.` · `Settlement terms` (`No terms recorded yet.`) · `Counterparty` / `Encrypted at rest; visible to authorized users.` · `Negotiation rounds`/`Governance audit` (+ empty/error) · metadata (`Reference`/`Matter`/`Method`/`Value`/`Name`/`Contact`/`Identifier`/`Approved by`/`Approved at`/`Executed at`/`Created`/`Updated`) · `View matter`/`Not provided` | key: detail.* (AR ✓) |
| 10 | Audit feed | label/body | `Actor` · `{from} → {to}` (fn) | key: audit.* (AR ✓) |
| 11 | Toasts + confirm | toast/modal | `Settlement opened.`/`Settlement terms saved.`/`deleted`/`Negotiation round added.`/`Settlement submitted for approval.`/`Matter closed by reconciliation.`/`Approval decision recorded.` · confirm (`Delete settlement`/`Delete "{title}"? …` (fn)/`Submit for approval`/`… Terms become locked.`/`Close by reconciliation`/`Execute this approved settlement and close the owning matter?`/`Close matter`) | key: toast.*/confirm.* (AR ✓) |
| 12 | settlement-agreement-print (print doc) | button/print | `Print agreement` · popup-blocked toast · `Settlement Agreement — {reference}` (fn) · letterhead (org/department/docType) · meta/particulars/counterparty/terms/history/signatures blocks + status/method options | key: local agreementLabels (AR ✓) |
| 13 | print doc › org / first-party brand | print heading | `Clario Legal Affairs` / `كلاريو للشؤون القانونية` and `First party (Clario)` / `الطرف الأول (كلاريو)` | key: agreementLabels (AR ✓) but **hardcodes the "Clario" brand** — flag for tenant-branding (should reflect Watheeq/tenant org, not "Clario") |

### Timeline sub-tree (settlement-sla + case-timeline reuse) — `timeline.*`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 14 | Timeline panel | heading/body/label | `Case timeline` / `Estimated duration, external holds, and classified delay events.` · `Estimated duration`/`Estimated completion`/`Open delay (days)`/`External hold`/`On hold`/`Active`/`Not estimated`/`{n} days` (fn)/`Set estimate`/`Clear estimate` · hold (`Since`/`Category`/`Reason`) · `Record delay` | key: timeline.* (AR ✓) |
| 15 | Delay events list + filter/sort/search/pagination/bulk | body/label/button | `Delay events`/… · `Open`/`Resolved`/`Resolve`/`Opened`/`Resolved` · categoryOptions (`Court`/`Government`/`Department`/`Expert`) · duration (`Duration`/`{n} days`/`{n} hours` (fn)/`ongoing — {amount}` (fn)) · filter (`Filter`/`All`/`Open`/`Resolved`/`All categories`) · sort (`Sort by`/`Newest first`/`Oldest first`/`Opened`/`Resolved`/`Category`/`Created`) · search (`Search delay reasons…`) · pagination (`Load more`/`Showing {n} of {total}` (fn)/`Page {n}` (fn)) · bulk (`Select`/`Resolve selected ({n})` (fn)/`Clear selection`) · attribution (`Recorded by`/`Resolved by`) · editEvent (`Edit delay`/`Reopen`/`Save changes`/reopen confirm (fn)) | key: timeline.* (AR ✓) |
| 16 | Projection / breakdown / track | body/label | projection (`On track`/`At risk`/`Overdue`/`Projected completion`/`Adjusted for {n} delay days` (fn)) · breakdown (`Delay by category`/`No open delays`) · track (`Timeline`/`Opened`/`Estimated completion`/`Due`/`External hold`/`Today`) | key: timeline.* (AR ✓) |
| 17 | Deadlines / hold history / export / dashboard / realtime | label/body/toast | deadlines (`Add deadline`/`Upcoming deadlines`/`No deadlines`/`in {n} days` (fn)/`{n} days ago` (fn)/`due today`/dialog fields/`Hearing`/`Objection`) · holdHistory (`Hold history`/`Placed on hold`/`Hold cleared`/`No hold changes`) · exportMenu (`Export`/`Export CSV`/`Print`/CSV headers/`Yes`/`No`) · dashboard (`Case timelines`/…/`Matters on hold`/`Matters with open delays`/`All matters`/`View timeline`) · realtime (`Timeline updated`/`{name} recorded a delay` (fn)/`{name} resolved a delay` (fn)) | key: timeline.* (AR ✓) |
| 18 | Timeline dialogs + toasts | modal/toast | estimateDialog/holdDialog/delayDialog/resolveDialog (all fields + validation) · toasts (`Timeline estimate updated.`/`External hold updated.`/`Delay event recorded.`/`Delay event resolved.`) | key: timeline.*Dialog/timeline.toast (AR ✓) |

---

## Route: /lex/case-timeline — page.tsx + /portfolio
_Module bundle: `case-timeline/_components/labels.ts` (`useTimelineExtra`) for NEW copy; **reuses `settlements/_components/labels.ts` `timeline.*`** for the shared CaseTimelinePanel (see settlements rows 14–18)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | Page eyebrow | badge | `Legal Suite · Case timelines` | key: timelineExtra.eyebrow (AR ✓) |
| 2 | Portfolio KPI strip | heading | `Matters tracked` · `On external hold` · `With open delays` · `Overdue` · `Avg. open delay` (+ unit `days`) · `Due this week` | key: timelineExtra.kpi.* (AR ✓) |
| 3 | Holiday markers | tooltip | `Falls on a Saudi holiday` · `Eid date is approximate` | key: timelineExtra.holiday.* (AR ✓) |
| 4 | Picker empty state | empty-state | `Browse the case portfolio` / `Pick a matter above to open its duration, hold and delay register.` | key: timelineExtra.empty.* (AR ✓) |
| 5 | Triage micro-copy | label | `Practice-wide triage` · `Worst delay first` · `Recently viewed` | key: timelineExtra.* (AR ✓) |
| 6 | Timeline panel body (all delay/hold/estimate copy) | — | see Settlements rows 14–18 | key: settlements `timeline.*` (AR ✓) |
| 7 | Matter titles / numbers | data-driven | matter title/number in picker + recent-matters | data-driven (matters/cases API) |

---

## Route: /lex/matters — page.tsx + /[id]
_Module bundle: `matters/_components/labels.ts` (`useMatterLabels`)_

### page.tsx (list) + matter-board + matter-preview-drawer + matter-bulk-dialogs
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | List header | heading/body/button | `Matters` / `Legal intake, triage, owner assignment, and contract-linked matter tracking.` · `New Matter` · search `Search matters...` | key: list.* (AR ✓) |
| 2 | Empty + columns + row actions | empty-state/table-header/button | `No matters found` / `No legal matters matched the current filters.` · columns (`Matter`/`Status`/`Type`/`Priority`/`Owner`/`Requester`/`Linked contracts`/`Due`/`Updated`/`Matter actions`) · rowActions (`View detail`/`Edit`/`Triage`/`Change status`/`Delete`) · `Unassigned`/`Not captured`/`Not linked`/`No due date`/`{count} linked` (fn) | key: list.* (AR ✓) |
| 3 | Filters + enum options | label/option | `Status`/`Type`/`Priority`; statusOptions (`Intake`/`Open`/`In Review`/`Waiting on Business`/`On Hold`/`Closed`/`Cancelled`), typeOptions (`General`/`Contract`/`Litigation`/`Regulatory`/`Employment`/`Dispute`/`Advisory`/`Other`), priorityOptions (`Critical`/`High`/`Medium`/`Low`) | key: filters.* (AR ✓) |
| 4 | View toggle + saved views + due filter | tab/button/label | `Table`/`Board`/`No matters` (empty col)/`Owner`/`Unassigned`/`No due date` · `Cannot move a matter from "{from}" to "{to}".` (fn) · savedViews (`Save current view`/`Saved views`/`No saved views yet`) · `Due date` | key: view.*/savedViews.*/filtersExtra.* (AR ✓) |
| 5 | Intake & triage grouping | heading/body | `Intake & Triage` / `Current matters grouped by the backend matter status lifecycle.` · `No requester` | key: intake.* (AR ✓) |
| 6 | Bulk dialogs | button/modal/toast | `Export selected`/`Change status`/`Reassign owner` · `Bulk change status`/`Move {count} selected matter(s)…` (fn) · `Bulk reassign owner`/`Reassign the owner for {count} selected matter(s).` (fn) · `Owner` (ph `Select owner`)/`Apply`/`Cancel` · toasts (`{count} matter(s) updated.` (fn)/`{count} matter(s) reassigned.` (fn)/`No selected matters could accept this change.`/`Unable to load the user directory.`) | key: bulk.* (AR ✓) |
| 7 | Matter title | data-driven | matter title | data-driven (`/api/v1/lex/matters`) |

### matter-form-dialog / matter-triage-dialog / matter-status-dialog / matter-link-contract-dialog
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 8 | matter-form-dialog | modal/label/placeholder | `Create Matter`/`Edit Matter` + descriptions · `Title` (ph `Vendor termination dispute`)/`Matter number` (ph `LEX-M-2026-001`)/`Type`/`Status`/`Priority`/`Owner` (ph `Select owner`)/`Requester` (`Not captured`)/`Department` (ph `Procurement`)/`Due date`/`Description` (ph)/`Tags` (ph `dispute, vendor, urgent`) · users-load error · `Cancel`/`Create matter`/`Save changes` · errors (title/owner/owner-name required) | key: form.* (AR ✓) |
| 9 | matter-triage-dialog | modal/label | `Triage Matter` / `Set the working status, priority, owner, and target due date for this matter.` · `Status`/`Priority`/`Owner` (ph)/`Keep current owner`/`Due date`/`Notes` (ph `Triage rationale, escalation, or assignment context.`) · `Cancel`/`Apply Triage` | key: triageDialog.* (AR ✓) |
| 10 | matter-status-dialog | modal/label | `Change Status` / `Move the matter to a valid lifecycle state.` · `Next status`/`Select status`/`Cancel`/`Update Status` | key: statusDialog.* (AR ✓) |
| 11 | matter-link-contract-dialog | modal/label/empty | `Link Contract` / `Associate an existing contract with this matter.` · `Contract` (ph `Select contract`)/`Loading contracts...`/`Relationship`/`Cancel`/`Link Contract` · `No contracts are available to link.`/`Failed to load contracts.` | key: linkDialog.* (AR ✓) |
| 12 | Relationship enum | option/badge | `Primary`/`Related`/`Amendment`/`Dispute`/`Reference` | key: matterRelationshipLabels (AR ✓) |

### [id]/page.tsx detail + matter-related-items + matter-obligation-summary/manager + matter-documents-section + matter-timeline/activity-feed/comments-thread
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 13 | Detail states + actions | heading/error/button | `Matter` / `Loading matter intake, ownership, and linked-contract context.` / `Failed to load matter details.` / `Legal matter intake and lifecycle detail.` · `Edit`/`Triage`/`Change Status`/`Delete Matter` | key: detail.* (AR ✓) |
| 14 | Metric strip + overview | label/heading | `Status`/`Priority`/`Type`/`Linked contracts` · `Matter Overview` / `Core matter state, ownership, and intake context.` · metadata (`Matter number`/`Type`/`Owner`/`Requester`/`Department`/`Opened`/`Due date`/`Closed`/`Tags`/`Created`/`Updated`) · `Auto-generated`/`Not set`/`No tags` · `Description` / `No description was captured for this matter.` | key: detail.* (AR ✓) |
| 15 | Linked contracts + obligations sections | heading/body/button | `Linked Contracts` / `Contracts associated with this matter and their relationship.` · `Link Contract`/empty (`No linked contracts`/`Link a contract to associate it with this matter.`)/`Unlink`/`Relationship` · `Matter Obligations` / `Obligations tied to this matter with owners and due dates.` · empty/`Failed to load matter obligations.`/`View`/`No due date`/`Unassigned` | key: detail.* (AR ✓) |
| 16 | Conflict check (matter-triage / conflict panel) | heading/body/label/badge | `Conflict Check` / `Bounded tenant-scoped screening before matter intake or contract linkage.` · `Matter title`/`Counterparty` (ph `Acme LLC`)/`Contract` (ph `Acme MSA`)/`Context` (ph) · `Check Conflicts` · `Screening in progress` / `Checking current matters and linked contracts.` · empty (`No screening result`/`Run a check to compare…`) · `Screening result`/`Checked`/`conflicts`/`warnings`/`Conflict`/`Warning`/`Potential match`/`No conflicts or warnings found.` | key: conflict.* (AR ✓) |
| 17 | Toasts + confirm | toast/modal | `Matter created.`/`updated`/`Matter status updated.`/`triaged`/`Contract linked.`/`Contract unlinked.`/`deleted` · confirm (`Delete matter`/`Delete "{title}"? …` (fn)/`Unlink contract`/`Unlink "{title}" from this matter?` (fn)) | key: toast.*/confirm.* (AR ✓) |

_Not label-bundle-backed but present under matters: `matter-analytics.tsx`, `matter-timeline.tsx`, `matter-activity-feed.tsx`, `matter-comments-thread.tsx`, `obligation-manager.tsx`, `obligation-deadline-calendar.tsx`, `inline-edit-cells.tsx`, `matter-templates.tsx`. These consume `useMatterLabels()` and shared primitives; no hardcoded literals surfaced by grep (see Coverage note)._

---

## Coverage

**Routes covered (24 route entry points):**
`/lex` · `/lex/service-desk` · `/lex/service-desk/new` · `/lex/service-desk/intake` · `/lex/service-desk/[id]` · `/lex/service-desk/sla-board` · `/lex/service-desk/notifications` · `/lex/cases` · `/lex/cases/[id]` · `/lex/cases/classifications` · `/lex/investigations` · `/lex/investigations/[id]` · `/lex/consultations` · `/lex/consultations/[id]` · `/lex/settlements` · `/lex/settlements/[id]` · `/lex/case-timeline` · `/lex/case-timeline/portfolio` · `/lex/matters` · `/lex/matters/[id]`.

**Approximate string count:** ~2,650 distinct user-facing strings across the in-scope bundles (service-desk suite ~720, cases ~1,000, investigations ~400, consultations ~250, settlements ~260 [incl. print + timeline], matters ~190, overview ~130). The overwhelming majority (>99%) already resolve through bilingual `LexBilingual<T>` bundles **with professional MSA Arabic present** — the localization effort here is translation **QA/review**, not net-new authoring.

**Genuine gaps (net-new work), in priority order:**
1. **HARDCODED — `_components/command-hero.tsx:221`** — eyebrow chip literal `Watheeq Legal Affairs` (only fully-unkeyed user-facing string in the overview). Add to a bundle + wire.
2. **HARDCODED — `cases/_components/tabs/documents-tab.tsx:1383`** — URL input `placeholder="https://..."` (cosmetic; a URL placeholder, arguably locale-neutral).
3. **HARDCODED (bilingual inline) — `cases/_components/case-form-dialog.tsx:477/484`** — classification fallback label `this classification` / `هذا التصنيف` via inline `locale === 'ar' ? …` ternary; both locales present but not routed through a bundle. Move into `caseLabels` for consistency.
4. **Brand hardcoding — `settlements/_components/settlement-agreement-print.tsx`** — the printed agreement letterhead/signature block hardcode the `Clario` brand (`Clario Legal Affairs`, `First party (Clario)`). Keyed + translated, but the org name should be tenant/Watheeq-branded, not "Clario", for a client-facing legal document.
5. **Data-driven (backend localization) — flagged inline, notable ones:**
   - `contract-analytics.tsx` regulations render `regulation.title_en` **only** (no `title_ar` even in Arabic mode) — a backend/data localization gap.
   - Request/case/consultation/matter **titles** via `resolveLocalized(title)` and classification/service/org-entity **names** — bilingual data owned by the backend seed/API; needs backend content localization, not frontend keys.
   - Notification titles/bodies, investigation subjects/leads, settlement counterparty names, alert titles/descriptions — free-text data-driven fields.

**Files I could not fully page through (very large; English side + full interface read, Arabic side is the mirror per the enforced `LexBilingual` contract — spot-verified present):**
- `cases/_components/labels.ts` (3,317 lines) — read interface (full) + English bundle through the `documents` sub-tree; Arabic mirror not paged line-by-line. The `documents-tab`/`pleadings`/`defendant` sub-trees are the densest; individual leaf strings within those Records were summarized (row grouping) rather than enumerated 1:1.
- `investigations/_components/labels.ts` (1,697 lines) — English side fully read; Arabic side paged to line ~1261 (mirror confirmed present for all read sections).

Both are covered structurally and by section; a follow-up pass could expand the grouped `documents.*` / `dialogs.*` Records into 1-row-per-leaf if a literal per-string sheet is required for the translation vendor. No unread co-located component surfaced a hardcoded literal in the targeted grep sweeps (`placeholder=`/`aria-label=`/`title=`/`alt=`, `toast.*('…')`, JSX text nodes) — only the four items listed above.
