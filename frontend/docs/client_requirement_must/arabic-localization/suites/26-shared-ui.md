# Arabic Localization Reference — Shared UI Primitives (cross-app)

Scope: `src/components/ui/**`, `src/components/common/**`, `src/components/shared/**`, `src/components/layout/**`.
These are the **highest-leverage** strings on the platform — one translation of each covers every route that renders the primitive. Every list page, form, dialog, empty-state, sidebar and header inherits its chrome from here.

## How to read the Status column
- **`key: <path>` (Arabic exists)** — string already resolves through a central i18n bundle (`useT` / `useNavigationLabels` / `resolveLocalized`). Central bundles are `src/lib/i18n/messages.ts` (namespaces `shell` / `preferences` / `nav` / `validation` / `dynamicForm` / `brand`), `src/lib/i18n/table-messages.ts` (`table.*`), and the `charts.*` namespace registered inline in `chart-container.tsx`. These have full en+ar and just need any missing keys filled.
- **`key: <LOCAL_BUNDLE>` (component-local, Arabic exists — NOT in central catalog)** — a bilingual `{ en, ar }` object literal defined **inside the component file** (e.g. `PALETTE_TEXT`, `LABELS`, `COPY`, `CHROME`, `T`). Renders correctly today in both locales but lives outside the central catalog, so translators/reviewers will not find it in `messages.ts`. Flagged for consolidation.
- **`HARDCODED`** — inline English string literal with **no Arabic path at all**. This is the actual translation debt. In Arabic mode these render in English.
- **`data-driven`** — text comes from props/API/config (column titles, filter labels, notification title/body, saved-view names, tour step content passed by caller). The primitive itself has nothing to translate; localization happens at the data source.

Cross-referenced central bundles: `src/lib/i18n/messages.ts`, `src/lib/i18n/table-messages.ts`, `src/lib/i18n/form-validation-messages.ts`, `src/components/layout/navigation-labels.ts` (+ `nav.*` in messages.ts).

---

## Group: src/components/layout/**  (app shell chrome)
_Central bundle: `messages.ts` → `shell.*` / `preferences.*` / `nav.*` / `brand.*`, resolved via `useNavigationLabels()` (`nav()` + `shell()`), `useT()`, `useLocale()._

### Component: sidebar.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | sidebar › `<aside>` | aria-label | Main navigation | key: shell.mainNavigation (Arabic exists) |
| 2 | sidebar › logo `<Link>` | aria-label | Clario360 home | HARDCODED |
| 3 | sidebar › brand subtitle | body | Enterprise Grid | HARDCODED |
| 4 | sidebar › pinned group | label / aria-label | Pinned | key: inline ternary `direction==='rtl'?'المثبّتة':'Pinned'` (component-local, Arabic exists — not in central catalog) |
| 5 | sidebar › collapse button | button / aria-label | Collapse | key: shell.collapse (Arabic exists) |
| 6 | sidebar › collapse button (expanded) | aria-label | Expand sidebar / Collapse sidebar | key: shell.expandSidebar / shell.collapseSidebar (Arabic exists) |
| 7 | sidebar › section labels | label | (per NavSection) | data-driven via nav(section.id, section.label) → nav.* |
| 8 | sidebar › tier labels | label | (per tier) | data-driven via resolveTierLabel(tier, locale) |

### Component: sidebar-nav-item.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | PinButton › star | aria-label | Pin {label} to top / Unpin {label} | key: inline `pinLabel()` ternary (component-local, Arabic exists — `تثبيت {label} في الأعلى` / `إزالة تثبيت {label}`) |
| 2 | parent row › expand toggle | aria-label | Collapse {label} / Expand {label} | HARDCODED |
| 3 | nav item label | link | (per NavItem) | data-driven via nav() → nav.* |

### Component: sidebar-section.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | section `<div role=group>` | aria-label | Navigation (fallback when label empty) | HARDCODED |

### Component: sidebar-tier-header.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | tier header label | heading | (per tier) | data-driven (label prop from resolveTierLabel) |

### Component: sidebar-user-footer.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | avatar `<Link>` | aria-label | Profile (fallback when no name) | HARDCODED |
| 2 | settings `<Link>` | aria-label | Settings | HARDCODED |
| 3 | sign-out button | aria-label / tooltip | Sign out | HARDCODED |
| 4 | primaryRole fallback | body | Viewer | HARDCODED (fallback when user has no role) |

### Component: header.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | mobile menu button | aria-label | Open navigation menu | key: shell.openNavigationMenu (Arabic exists) |
| 2 | connection status pill | badge / status | Live / Connecting / Reconnecting / Offline | key: shell.live / shell.connecting / shell.reconnecting / shell.offline (Arabic exists) |
| 3 | connection pill | aria-label / tooltip | {Real-time connection}: {status} | key: shell.realTimeConnection (Arabic exists) |
| 4 | search button | aria-label / tooltip | Search ({shortcut}) | key: shell.search (Arabic exists) |
| 5 | search button | button | Search or jump to | key: shell.searchOrJumpTo (Arabic exists) |
| 6 | active-section chip | badge | (per suite/section) | data-driven via nav() |

### Component: breadcrumbs.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | `<nav>` | aria-label | Breadcrumb | key: shell.breadcrumb (Arabic exists) |
| 2 | crumb labels | breadcrumb | (per route) | data-driven via useBreadcrumbs() |

### Component: notification-dropdown.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | bell button | aria-label | Notifications / Notifications ({n} unread) | HARDCODED |
| 2 | panel heading | heading | Notifications | HARDCODED |
| 3 | mark-all button | button | Mark all read | HARDCODED |
| 4 | empty state | empty-state | You're all caught up! No new notifications. | HARDCODED |
| 5 | footer link | link | View all notifications | HARDCODED |
| 6 | notification title/body | body | (per notification) | data-driven (notification API) — needs backend localization |

### Component: user-menu.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger button | aria-label | Open user menu | HARDCODED |
| 2 | role line (verified) | label | Email verification pending | key: shell.emailVerificationPending (Arabic exists) |
| 3 | verify-email item | link | Verify email | key: shell.emailVerificationVerify (Arabic exists) |
| 4 | menu item | link | Profile Settings | HARDCODED |
| 5 | menu item | link | Notification Preferences | HARDCODED |
| 6 | menu item | link | Security (MFA) | HARDCODED |
| 7 | tour item | button | Show tour | key: inline ternary `locale==='ar'?'عرض الجولة التعريفية':'Show tour'` (component-local, Arabic exists) |
| 8 | sign-out item | button | Sign out | HARDCODED |
| 9 | primaryRole fallback | label | Viewer | HARDCODED |

### Component: suite-switcher.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger | aria-label | Switch suite | key: shell.switchSuite (Arabic exists) |
| 2 | trigger sub-label | label | Suite | key: shell.suite (Arabic exists) |
| 3 | trigger / hub row | link | All Suites | key: shell.allSuites (Arabic exists) |
| 4 | menu label | label | Switch suite | key: shell.switchSuite (Arabic exists) |
| 5 | hub description | body | Every suite in one launcher grid. | key: inline ternary (component-local, Arabic exists — `كل الحزم في شبكة انطلاق واحدة.`) |
| 6 | suite name / description | link | (per suite) | data-driven via nav() + resolveNavText() |

### Component: mobile-sidebar.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | panel `<aside>` | aria-label | Mobile navigation | key: shell.mobileNavigation (Arabic exists) |
| 2 | logo `<Link>` | aria-label | Clario360 home | HARDCODED |
| 3 | brand subtitle | body | Enterprise Grid | HARDCODED |
| 4 | close button | aria-label | Close navigation menu | key: shell.closeNavigationMenu (Arabic exists) |

### Component: mobile-quick-nav.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | `<nav>` | aria-label | Quick navigation | key: shell.quickNavigation (Arabic exists) |
| 2 | more button | aria-label | Open full navigation menu | key: shell.openFullNavigationMenu (Arabic exists) |
| 3 | more button | button | More | key: shell.more (Arabic exists) |
| 4 | tab labels | tab | (per suite/section) | data-driven via nav() |

### Component: command-palette.tsx
_Component-local bilingual bundle `PALETTE_TEXT` (en/ar) — group + entity-type labels. Not in central catalog._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | dialog / listbox | aria-label | Command palette | key: shell.commandPalette (Arabic exists) |
| 2 | search input | placeholder | Search pages and actions... | key: shell.searchPagesAndActions (Arabic exists) |
| 3 | search input | aria-label | Search | key: shell.search (Arabic exists) |
| 4 | clear button | aria-label | Clear search | key: shell.clearSearch (Arabic exists) |
| 5 | empty state | empty-state | No results found for "{query}" | key: shell.noResultsFor (Arabic exists) |
| 6 | footer hints | system | ↑↓ navigate / ↵ open / esc close | key: shell.keyboardNavigate / keyboardOpen / keyboardClose (Arabic exists) |
| 7 | group labels | table-header | Recent / Favorites / Navigation / Actions | key: PALETTE_TEXT.groups.* (component-local, Arabic exists) |
| 8 | result-type labels | table-header | Pages / Matters / Cases / Contracts / Requests / Documents / Obligations / Regulations / Clauses / Signatures / Meetings / Committees / Reports / Dashboards / Data Sources / Pipelines / Alerts / Assets / Users / Tenants / Other | key: PALETTE_TEXT.types.* (component-local, Arabic exists) |
| 9 | searching indicator | system | Searching… | key: PALETTE_TEXT.searching (component-local, Arabic exists) |
| 10 | favorite toggle | aria-label | Add to favorites / Remove from favorites | key: PALETTE_TEXT.addFavorite / removeFavorite (component-local, Arabic exists) |
| 11 | search-result rows | option | (entity titles from API) | data-driven (acta/lex/visus/data/cyber/admin search endpoints) |

### Component: tenant-switcher.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | admin trigger | aria-label | Switch tenant | HARDCODED |
| 2 | menu label | label | Tenants | HARDCODED |
| 3 | manage item | link | Manage tenants | HARDCODED |
| 4 | tenant name | label | (per tenant) | data-driven (tenant API) |

### Component: theme-locale-switcher.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger | aria-label | Appearance and language | key: preferences.appearanceAndLanguage (Arabic exists) |
| 2 | theme group label + radiogroup | label | Theme | key: preferences.theme (Arabic exists) |
| 3 | theme options | option | Light / Dark / System | key: preferences.themeLight / themeDark / themeSystem (Arabic exists) |
| 4 | language group label | label | Language | key: preferences.language (Arabic exists) |
| 5 | language options | option | English / العربية | key: preferences.languageEnglish / languageArabic (Arabic exists) |

### Component: theme-toggle.tsx (legacy, header alt)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger | aria-label | Change theme | HARDCODED |
| 2 | options | option | Light / Dark / System | HARDCODED |

### Component: connection-banner.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | restored banner | system | Connection restored. | HARDCODED |
| 2 | reconnecting banner | system | Connection lost. Attempting to reconnect in {n}s / Connection lost. Attempting to reconnect... | HARDCODED |
| 3 | failed banner | system | Unable to establish real-time connection. Some features may not update automatically. | HARDCODED |
| 4 | attempt counter | system | Attempt {n} | HARDCODED |
| 5 | refresh button | button | Refresh page | HARDCODED |
| 6 | dismiss button | aria-label | Dismiss banner | HARDCODED |

### Component: email-verification-reminder.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | title | heading | Verify your email | key: shell.emailVerificationReminderTitle (Arabic exists) |
| 2 | body | body | Your account email still needs verification… | key: shell.emailVerificationReminderBody (Arabic exists) |
| 3 | sent state | body | A new verification code has been sent. | key: shell.emailVerificationSent (Arabic exists) |
| 4 | error state | body | We could not send a new code. You can still open verification from profile settings. | key: shell.emailVerificationSendFailed (Arabic exists) |
| 5 | verify CTA | button | Verify email | key: shell.emailVerificationVerify (Arabic exists) |
| 6 | resend CTA | button | Resend code / Sending... | key: shell.emailVerificationResend / emailVerificationSending (Arabic exists) |
| 7 | dismiss | aria-label | Remind me later | key: shell.emailVerificationDismiss (Arabic exists) |

---

## Group: src/components/common/**  (canonical page states)

### Component: page-header.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | title / description / eyebrow / tags / stats | heading/body/badge | (all from props) | data-driven (callers pass localized copy) |

### Component: empty-state.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | title / description / action labels | empty-state | (all from props) | data-driven (callers pass copy; illustrations are decorative aria-hidden) |

### Component: error-state.tsx
_Variant fallback copy, English only._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | network variant | heading | Connection problem | HARDCODED |
| 2 | network variant | body | We couldn’t reach the server. Check your connection and try again. | HARDCODED |
| 3 | permission variant | heading | Access denied | HARDCODED (delegates to ForbiddenState which is bilingual) |
| 4 | permission variant | body | You don’t have permission to view this resource. | HARDCODED |
| 5 | notFound variant | heading | Not found | HARDCODED |
| 6 | notFound variant | body | The resource you’re looking for doesn’t exist or was removed. | HARDCODED |
| 7 | generic variant | heading | Something went wrong | HARDCODED |
| 8 | generic variant | body | An unexpected error occurred. Please try again. | HARDCODED |
| 9 | retry button | button | Try again | HARDCODED |

### Component: forbidden-state.tsx
_Component-local bilingual `COPY` (en/ar) — the designed 403 experience. Not in central catalog._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | code | badge | Error 403 | key: COPY.code (component-local, Arabic exists) |
| 2 | title | heading | Access restricted | key: COPY.title (component-local, Arabic exists) |
| 3 | message | body | You don’t have permission to view this page. If you believe you need access, send a request to your administrator. | key: COPY.message (component-local, Arabic exists) |
| 4 | required-permission chip | label | Required permission | key: COPY.requiredPermission (component-local, Arabic exists) |
| 5 | request-access CTA | button | Request access | key: COPY.requestAccess (component-local, Arabic exists) |
| 6 | copy-details CTA | button | Copy request details | key: COPY.copyDetails (component-local, Arabic exists) |
| 7 | back CTA | link | Back to home | key: COPY.backToHome (component-local, Arabic exists) |
| 8 | copy success toast | toast | Request details copied / Paste them into a message to your administrator. | key: COPY.copied / copiedDescription (component-local, Arabic exists) |
| 9 | copy failure toast | toast | Could not copy the request details | key: COPY.copyFailed (component-local, Arabic exists) |
| 10 | mailto subject + body | system | Access request — Clario360 / Access request / Requested by / Page / Required permission / Reason (please describe why you need access): | key: COPY.mailSubject / detail* (component-local, Arabic exists) |

### Component: connection-status-banner.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | reconnecting | system | Connection lost. Reconnecting... | HARDCODED |
| 2 | failed | system | Unable to connect to real-time updates. Refresh the page to try again. | HARDCODED |
| 3 | dismiss | aria-label | Dismiss | HARDCODED |

### Component: loading-skeleton.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | sr-only live label (default) | aria-label | Loading… | HARDCODED (default; callers may pass `label`) |

### Component: page-loader.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | container | aria-label | Loading page | HARDCODED |

### Component: permission-redirect.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | (delegates to LoadingSkeleton + ForbiddenState) | — | — | see forbidden-state.tsx |

### Component: route-error.tsx (shared App Router error.tsx body)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | heading (with segment) | heading | Couldn’t load {segment} | HARDCODED |
| 2 | heading (no segment) | heading | Something went wrong | HARDCODED |
| 3 | body | body | An unexpected error occurred while rendering this page. You can retry, or navigate elsewhere and come back. | HARDCODED |
| 4 | digest line | system | Reference: {digest} | HARDCODED |
| 5 | retry button | button | Try again | HARDCODED |
| 6 | dashboard link | link | Go to dashboard | HARDCODED |

_(page-loader/route-error segment labels e.g. "Cyber" are passed as props → data-driven.)_

---

## Group: src/components/ui/**  (shadcn primitives)
Most primitives (button, badge, alert, card, input, textarea, tabs, accordion, avatar, checkbox, switch, slider, radio-group, separator, popover, tooltip, dropdown-menu, select, table, progress, calendar, spinner, stat-block) are **children-driven** and carry no default user-facing strings. The exceptions:

### Component: dialog.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | close button | aria-label (sr-only) | Close | HARDCODED |

### Component: sheet.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | close button | aria-label (sr-only) | Close | HARDCODED |

### Component: status-pill.tsx (deprecated → StatusBadge adapter)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | DEFAULT_LABEL map | badge | Running / Pending / Passed / Failed / Degraded / Blocked | HARDCODED (default; callers SHOULD pass localized `label`) |

### Component: table-sort-header.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | sort button (active) | aria-label | Sorted {ascending\|descending}. Activate to change sort. | HARDCODED |
| 2 | sort button (inactive) | aria-label | Sort by this column | HARDCODED |

### Component: hinted-label.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | hint trigger (default) | aria-label | More information | HARDCODED (default; callers may pass `hintAriaLabel`) |

### Component: form-error-summary.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | heading (default `title`) | heading | Please fix the following | HARDCODED (default; callers may pass `title`) |
| 2 | field labels | error | (humanized field name) | data-driven (humanize() from field key) |

### Component: virtual-table.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | empty (default `emptyMessage`) | empty-state | No data found | HARDCODED (default) |
| 2 | wrapper (default `ariaLabel`) | aria-label | Data table | HARDCODED (default) |

### Component: form.tsx / form-field.tsx / label.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | FormMessage / FormLabel | error/label | (RHF messages + field labels) | data-driven (validation messages via form-validation-messages.ts / zod; labels from callers) |

---

## Group: src/components/shared/data-table/**  (the DataTable family)
_Central bundle: `table-messages.ts` (`table.*`), resolved via `useT('table')`. **Fully bilingual already** for pagination/toolbar/filter/export chrome._

### Component: data-table-toolbar.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | clear-filters button | button | Clear | key: table.toolbar.clear (Arabic exists) |
| 2 | density trigger | button / aria-label | Density / Row density | key: table.toolbar.density / rowDensity (Arabic exists) |
| 3 | density options | option | Comfortable / Compact | key: table.toolbar.comfortable / compact (Arabic exists) |
| 4 | columns trigger + label | button | Columns / Toggle columns | key: table.toolbar.columns / toggleColumns (Arabic exists) |
| 5 | export trigger + label | button | Export / Export as | key: table.toolbar.export / exportAs (Arabic exists) |
| 6 | export items | option | CSV / JSON | key: table.export.csv / json (verbatim across locales) |
| 7 | selection count | label | {n} selected | key: table.toolbar.selected (Arabic exists) |
| 8 | bulk-action busy | button | Processing... | key: table.toolbar.processing (Arabic exists) |
| 9 | column-toggle items | option | (column labels) | data-driven via getColumnLabel() |
| 10 | bulk-action labels | button | (per BulkAction) | data-driven (callers pass label) |

### Component: data-table-pagination.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | region | aria-label | Table pagination | key: table.pagination.label (Arabic exists) |
| 2 | summary (empty) | body | No results | key: table.pagination.noResults (Arabic exists) |
| 3 | summary | body | Showing {start}–{end} of {total} results | key: table.pagination.showing (Arabic exists) |
| 4 | rows-per-page | label / aria-label | Rows per page | key: table.pagination.rowsPerPage (Arabic exists) |
| 5 | nav buttons | aria-label | Go to first/previous/next/last page | key: table.pagination.firstPage / previousPage / nextPage / lastPage (Arabic exists) |
| 6 | page buttons | aria-label | Go to page {page} | key: table.pagination.goToPage (Arabic exists) |
| 7 | mobile page indicator | body | Page {page} of {total} | key: table.pagination.pageOf (Arabic exists) |

### Component: data-table-filter.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | text-filter input (default) | placeholder | Filter by {label}… | key: table.filter.filterBy (Arabic exists) |
| 2 | text-filter actions | button | Clear / Apply | key: table.filter.clear / apply (Arabic exists) |
| 3 | range-filter actions | button | Reset / Apply | key: table.filter.reset / apply (Arabic exists) |
| 4 | filter trigger labels / options | button/option | (per FilterConfig) | data-driven (config.label / option.label) |

### Component: data-table-active-filters.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | heading | label | Active filters: | key: table.toolbar.activeFilters (Arabic exists) |
| 2 | remove chip | aria-label | Remove {label} filter | key: table.toolbar.removeFilter (Arabic exists) |
| 3 | clear-all | button | Clear all | key: table.toolbar.clearAll (Arabic exists) |
| 4 | chip text | badge | {label}: {value} | data-driven (config.label + values) |

### Component: data-table-empty.tsx (deprecated → EmptyState adapter)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | default title | empty-state | No results found | HARDCODED |
| 2 | default desc (filtered) | empty-state | No results match your current filters. Try adjusting or clearing your filters. | HARDCODED |
| 3 | default desc (unfiltered) | empty-state | No data available yet. | HARDCODED |

### Component: data-table-error.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | heading | heading | Failed to load data | HARDCODED |
| 2 | retry button | button | Retry | HARDCODED |
| 3 | error detail | body | (error message prop) | data-driven |

### Component: data-table-column-header.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | menu trigger | aria-label | {title}: column options | HARDCODED |
| 2 | move items | option | Move to start / Move to end | HARDCODED |
| 3 | hide item | option | Hide column | HARDCODED |
| 4 | sort button | aria-label | {title}, sorted {ascending\|descending} / {title}, not sorted | HARDCODED |
| 5 | resize handle | aria-label | Resize {label} column | HARDCODED |

### Component: data-table-row-actions.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger | aria-label | Row actions | HARDCODED |
| 2 | action items | option | (per RowAction) | data-driven (callers pass label) |

### Component: data-table-skeleton.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | container | aria-label | Loading table data | HARDCODED |

### Component: data-table.tsx (main)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | search input (default `searchPlaceholder`) | placeholder | Search... | HARDCODED (default; callers usually override) |

### Component: columns/common-columns.tsx (column factories)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | selectColumn header checkbox | aria-label | Select all | HARDCODED |
| 2 | selectColumn cell checkbox | aria-label | Select row | HARDCODED |
| 3 | severityColumn default header | table-header | Severity | HARDCODED (default arg) |
| 4 | userColumn default header | table-header | User | HARDCODED (default arg) |
| 5 | idColumn default header | table-header | ID | HARDCODED (default arg) |
| 6 | idColumn copy button | aria-label | Copy ID | HARDCODED |

---

## Group: src/components/shared/charts/**
_Central `charts.*` namespace registered inline in `chart-container.tsx` (en/ar)._

### Component: chart-container.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | loading sr-only | system | Loading chart… | key: charts.loading (Arabic exists) |
| 2 | error title (default) | heading | Couldn't load this chart | key: charts.errorTitle (Arabic exists) |
| 3 | retry action | button | Retry | key: charts.retry (Arabic exists) |
| 4 | empty (default) | empty-state | No data available | key: charts.empty (Arabic exists) |
| 5 | title / subtitle / emptyDescription | heading/body | (from props) | data-driven |

### Components: chart-legend.tsx / chart-tooltip.tsx / area-/bar-/line-/pie-/gauge-chart(-impl).tsx / chart-theme.ts
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | legend labels / tooltip series names / axis ticks | label | (series names + formatted numbers) | data-driven (recharts payload; numbers via useFormat → Arabic-Indic digits) |

---

## Group: src/components/shared/forms/**

### Component: search-input.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | input (default `placeholder`) | placeholder | Search... | HARDCODED (default) |
| 2 | clear button (default `clearLabel`) | aria-label | Clear search | HARDCODED (default) |

### Component: combobox.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger (default `placeholder`) | placeholder | Select... | HARDCODED (default) |
| 2 | search (default `searchPlaceholder`) | placeholder | Search... | HARDCODED (default) |
| 3 | empty | empty-state | No results found. | HARDCODED |
| 4 | option labels | option | (from options prop) | data-driven |

### Component: multi-select.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger (default `placeholder`) | placeholder | Select... | HARDCODED (default) |
| 2 | remove chip | aria-label | Remove {label} | HARDCODED |
| 3 | empty | empty-state | No options found. | HARDCODED |
| 4 | option labels | option | (from options prop) | data-driven |

### Component: date-range-picker.tsx
_Component-local bilingual `defaultLabels` (en/ar). Not in central catalog._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | trigger (default) | placeholder | Select date range | key: defaultLabels.placeholder (component-local, Arabic exists) |
| 2 | preset buttons | option | Last 24 hours / Last 7 days / Last 30 days / Last 90 days / This month / Last month | key: defaultLabels.presets.* (component-local, Arabic exists) |

### Component: file-upload.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | dropzone | aria-label | Upload file area | HARDCODED |
| 2 | dropzone prompt | body | Drag & drop files here, or click to browse | HARDCODED |
| 3 | size hint | body | Maximum file size: {n}MB | HARDCODED |
| 4 | size error | error | "{name}" exceeds the maximum size of {n}MB. | HARDCODED |
| 5 | progress | aria-label | Uploading {name} | HARDCODED |

### Components: form-field.tsx / form-section.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | label / description / title / error | label/body/error | (from props / RHF) | data-driven |

---

## Group: src/components/shared/wizard/**

### Component: wizard-controls.tsx
_Component-local bilingual `COPY` (en/ar). Not in central catalog._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | back button | button | Back | key: COPY.back (component-local, Arabic exists — `السابق`) |
| 2 | next button | button | Next | key: COPY.next (component-local, Arabic exists — `التالي`) |
| 3 | submit button (last step) | button | Finish | key: COPY.submit (component-local, Arabic exists — `إنهاء`) |
| 4 | cancel button | button | Cancel | key: COPY.cancel (component-local, Arabic exists — `إلغاء`) |

_(wizard-step-indicator / wizard-step / wizard.tsx / wizard-context.tsx: step titles are data-driven from the wizard's step config.)_

---

## Group: src/components/shared/tour/**

### Component: tour.tsx
_Component-local bilingual `CHROME` (en/ar). Not in central catalog._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | back button | button | Back | key: CHROME.back (component-local, Arabic exists) |
| 2 | next button | button | Next | key: CHROME.next (component-local, Arabic exists) |
| 3 | done button (last step) | button | Done | key: CHROME.done (component-local, Arabic exists) |
| 4 | close/skip button | aria-label | Skip tour | key: CHROME.skip (component-local, Arabic exists) |
| 5 | progress sr-only | system | Step {current} of {total} | key: CHROME.progress (component-local, Arabic exists) |

### Component: dashboard-tour.tsx
_Component-local bilingual `DASHBOARD_TOUR_STEPS` (en/ar) — 4 first-run steps passed to `<Tour>`._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | step 1 title/body | modal-title/modal-body | Your suites / Clario360 is organized into suites — Cyber, Data, Legal, Recover and more. Switch between them here; the sidebar always shows the sections of the active suite. | key: DASHBOARD_TOUR_STEPS[0] (component-local, Arabic exists) |
| 2 | step 2 title/body | modal-title/modal-body | Search everything / Press ⌘K (or Ctrl+K) to open the command palette — jump to any page, record, or action without leaving the keyboard. | key: DASHBOARD_TOUR_STEPS[1] (component-local, Arabic exists) |
| 3 | step 3 title/body | modal-title/modal-body | Stay on top of alerts / Real-time notifications land here — approvals, security alerts, and task assignments. The badge shows your unread count. | key: DASHBOARD_TOUR_STEPS[2] (component-local, Arabic exists) |
| 4 | step 4 title/body | modal-title/modal-body | Make it yours / Switch between light and dark themes, and between English and Arabic. Your preference is remembered on this device. | key: DASHBOARD_TOUR_STEPS[3] (component-local, Arabic exists) |

---

## Group: src/components/shared/**  (top-level primitives)

### Component: confirm-dialog.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | confirm button (default) | button | Confirm | HARDCODED (default `confirmLabel`) |
| 2 | cancel button (default) | button | Cancel | HARDCODED (default `cancelLabel`) |
| 3 | busy state | button | Processing... | HARDCODED |
| 4 | type-to-confirm label | label | Type {value} to confirm | HARDCODED |
| 5 | title / description | modal-title/modal-body | (from props) | data-driven |

### Component: status-badge.tsx  (THE canonical status primitive — very high leverage)
_Default English label maps used whenever a caller does not pass `label`. `humanizeStatus()` title-cases unknown tokens._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | severityMap | badge | Critical / High / Warning / Medium / Moderate / Low / Minor / Info / Informational | HARDCODED (default labels) |
| 2 | caseStatusMap | badge | Intake / New / Open / In Progress / Under Procedure / On Hold / Pending Approval / Escalated / Approved / Rejected / Resolved / Closed / Cancelled / Archived | HARDCODED (default labels) |
| 3 | slaMap | badge | On Track / On Time / Due Soon / At Risk / Breached / Overdue | HARDCODED (default labels) |
| 4 | genericStatusMap | badge | Active / Enabled / Completed / Passed / Inactive / Disabled / Draft / Pending / Submitted / Running / Paused / Degraded / Blocked / Failed / Error / Expired | HARDCODED (default labels) |
| 5 | unknown-token fallback | badge | (humanized token, e.g. "Pending approval") | data-driven (humanizeStatus) |
| 6 | explicit `label` prop | badge | (localized copy) | data-driven (callers may override) |

### Component: severity-indicator.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | severityConfig labels | badge | Critical / High / Warning / Medium / Low / Info | HARDCODED |

### Component: priority-indicator.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | priorityConfig labels | badge | P0 Critical / P1 High / P2 Medium / P3 Low | HARDCODED |

### Component: copy-button.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | button (default `label`) | aria-label / tooltip | Copy | HARDCODED (default) |
| 2 | copied state | aria-label / tooltip | Copied! | HARDCODED |

### Component: help-tip.tsx
_Component-local bilingual defaults; content is caller-supplied bilingual._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | learn-more link (default) | link | Learn more | key: DEFAULT_LEARN_MORE (component-local, Arabic exists — `معرفة المزيد`) |
| 2 | trigger (default aria) | aria-label | Help | key: DEFAULT_ARIA_LABEL (component-local, Arabic exists — `مساعدة`) |
| 3 | title / content | tooltip | (from props) | data-driven (caller-supplied `{en, ar}` bundle) |

### Component: document-viewer.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | no-content empty | empty-state | No preview available / There is no document or extracted text to display. | HARDCODED |
| 2 | PDF iframe (fallback title) | aria-label | PDF document | HARDCODED |
| 3 | image (fallback alt) | aria-label | Document image | HARDCODED |
| 4 | binary file name (fallback) | body | Document | HARDCODED |
| 5 | download link | button | Download | HARDCODED |
| 6 | anchors rail | aria-label | Document sections | HARDCODED |
| 7 | anchors rail heading | heading | Sections | HARDCODED |
| 8 | non-previewable empty | empty-state | No preview available / This file type cannot be previewed. | HARDCODED |
| 9 | preview sheet title (fallback) | modal-title | Document preview | HARDCODED |

### Component: event-calendar.tsx
_Component-local bilingual `T` (en/ar). Not in central catalog._
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | view toggle | tab | Month / Agenda | key: T.month / agenda (component-local, Arabic exists) |
| 2 | nav buttons | aria-label | Previous month / Next month | key: T.prev / next (component-local, Arabic exists) |
| 3 | empty | empty-state | No events scheduled | key: T.noEvents (component-local, Arabic exists) |
| 4 | overflow chip | badge | +{n} more | key: T.more() (component-local, Arabic exists — `+{n} المزيد`) |
| 5 | weekday headers | table-header | Sun / Mon / Tue / Wed / Thu / Fri / Sat | key: T.weekdays (component-local, Arabic exists) |
| 6 | month/day headings | heading | (date-fns "MMMM yyyy" / "EEEE, MMM d") | data-driven (date-fns format with ar/en locale) |
| 7 | event titles | body | (from events prop) | data-driven |

### Component: redline-view.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | mode toggle group | aria-label | Redline display mode | HARDCODED |
| 2 | mode buttons | button | Inline / Split | HARDCODED |
| 3 | empty | empty-state | No content to compare. | HARDCODED |

### Component: board-view.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | empty column (default) | empty-state | No items | HARDCODED (default `emptyColumnLabel`) |
| 2 | column titles / card content | heading/body | (from props) | data-driven |

### Component: stat-tile.tsx
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | error value | tooltip (title attr) | Failed to load | HARDCODED |
| 2 | label / value / hint / deltaLabel | label/body | (from props) | data-driven |

### Components (data-driven, no owned strings): kpi-card.tsx, stat-card.tsx, metric-tile.tsx, detail-stat-card.tsx, list-row.tsx, timeline.tsx, status-chip.tsx, icon-badge.tsx, detail-panel.tsx, trend-sparkline.tsx, truncated-text.tsx, user-avatar.tsx, relative-time.tsx, section-empty.tsx, code-editor.tsx, virtual-list.tsx, motion/* , simple-table.tsx
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | labels / values / titles | all | (from props) | data-driven |
| 2 | relative-time.tsx tooltip | tooltip | (date-fns "MMM d, yyyy 'at' …" format) | data-driven (date-fns locale) |

---

## Coverage

**Routes/areas covered:** N/A (this is the cross-app shared-primitive scope). Directories fully enumerated and read:
- `src/components/layout/**` — 24 files (all read; `.test.*` and `navigation-labels.test.ts` skipped as tests). Includes sidebar family, header, breadcrumbs, command-palette, notification-dropdown, user-menu, suite/tenant/theme-locale switchers, mobile-sidebar, mobile-quick-nav, connection-banner, email-verification-reminder, section-grid.
- `src/components/common/**` — 9 files (all read): empty-state, error-state, forbidden-state, connection-status-banner, loading-skeleton, page-header, page-loader, permission-redirect, route-error.
- `src/components/ui/**` — 44 files. All string-bearing ones read in full (dialog, sheet, status-pill, table-sort-header, hinted-label, form-error-summary, virtual-table, form). Remaining ~30 confirmed children-driven with **no** default user-facing strings via targeted grep (button, badge, alert, card, input, textarea, tabs, accordion, avatar, checkbox, switch, slider, radio-group, separator, popover, tooltip, dropdown-menu, select, table, progress, calendar, spinner, stat-block, scroll-area, surface, with-tooltip, sonner).
- `src/components/shared/**` — top-level (44 entries) + subdirs `data-table/` (13 + columns/common-columns), `charts/` (15), `forms/` (8), `wizard/` (6), `tour/` (5), `motion/` (3). All string-bearing files read; grep-confirmed the rest are data-driven.

**Approx string count:** ~250 distinct source strings catalogued. Rough breakdown:
- Already keyed in **central** bundles (Arabic exists, ready): ~85 (`shell.*` shell chrome, `preferences.*`, `table.*` DataTable family — the single biggest win, `charts.*`, plus `nav.*`/`brand.*` used here).
- Keyed in **component-local** bilingual bundles (Arabic exists but outside central catalog — recommend consolidating): ~75 across `PALETTE_TEXT`, `COPY` (forbidden-state), `LABELS` (saved-views), `defaultLabels` (date-range-picker), `T` (event-calendar), `COPY` (wizard-controls), `CHROME` + `DASHBOARD_TOUR_STEPS` (tour), `DEFAULT_LEARN_MORE`/`DEFAULT_ARIA_LABEL` (help-tip), and inline ternaries in sidebar/suite-switcher/user-menu/sidebar-nav-item.
- **HARDCODED English-only** (the real translation debt): ~90. Highest-impact clusters: `status-badge.tsx` default label maps (~50 status tokens, rendered on nearly every list/detail page), `error-state.tsx` variant copy (9), `route-error.tsx` (6), notification-dropdown (5), user-menu items (5), document-viewer (11), data-table-column-header/row-actions/empty/error/skeleton + common-columns aria/headers (~18), file-upload (5), severity-indicator/priority-indicator/copy-button/confirm-dialog/status-pill defaults (~20), plus sidebar/footer/tenant-switcher/theme-toggle aria-labels.
- **data-driven** (localize at data source/caller, not here): column labels, filter configs, notification title/body (needs backend localization), saved-view names, chart series/tooltip labels, wizard/board titles, tour step content passed by callers.

**Priority recommendation for translators/engineers:**
1. `status-badge.tsx` default maps — single highest-leverage HARDCODED cluster (every table/detail badge). Add an `ar` label to each map entry (or route through a new `status.*` central namespace).
2. Promote the ~9 component-local bilingual bundles into `messages.ts` namespaces so they appear in the central catalog for review.
3. Fill the remaining HARDCODED aria-labels/empty-states listed above (mostly one-liners).

**Files I could not fully read / follow-ups:** none unresolved. `saved-views-bar.tsx` (450+ lines) and `event-calendar.tsx` (13 KB) were read only through their label/bundle regions — their remaining lines are logic (persistence, date math) with no additional user-facing literals beyond those catalogued. `command-palette.tsx` was read in full. Co-located `*.test.tsx` files were intentionally excluded from string extraction.
