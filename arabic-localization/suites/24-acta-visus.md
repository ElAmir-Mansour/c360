# Arabic Localization Reference — ACTA + VISUS suites

Scope: all routes under `/acta/**` and `/visus/**` in `/Users/mac/clario360/frontend/src/app/(dashboard)/`, plus the co-located `components/visus/cti/*` section rendered on the Visus landing page.

Module bundles (cross-referenced throughout):
- ACTA: `src/app/(dashboard)/acta/_lib/acta-i18n.ts` — bilingual `{en, ar}`, registered as `useT('acta')`. Groups: `common.*`, `dashboard.*`, `meetingStatus.*`, `priority.*`, `actionStatus.*`, `list.meetings.*`, `list.committees.*`, `list.actionItems.*`. **Every key already has full Arabic.**
- VISUS: `src/app/(dashboard)/visus/_lib/visus-i18n.ts` — bilingual `{en, ar}`, registered as `useT('visus')`. Groups: `common.*`, `overview.*`, `list.dashboards.*`, `list.reports.*`, `list.kpis.*`, `list.alerts.*`. **Every key already has full Arabic.**

Status legend:
- `key: <path>` — resolves through the i18n bundle. All ACTA/VISUS bundle keys ship Arabic, so `(AR ✓)` is implied for every `key:` row unless noted.
- `HARDCODED` — inline JSX/TS string literal, not keyed. Needs extraction + translation.
- `data-driven` — value comes from API/seed data; needs **backend** localization (flagged in Coverage §Backend).

General note: enum display via `StatusBadge ... config={<xStatusConfig>}` pulls labels from `src/lib/status-configs.ts` (shared, out of this scope — flag separately). `RelativeTime`, `formatDate`, `formatDateTime`, `formatNumber` are shared date/number formatters (locale-aware handling lives in those utilities — out of scope here).

---

## ACTA — Board Governance

### Route: /acta — `acta/page.tsx`
_Module bundle: `acta/_lib/acta-i18n.ts`_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1 | page.tsx › PageHeader.eyebrow | breadcrumb | Acta · Board Governance | key: acta.common.eyebrow |
| 2 | page.tsx › PageHeader.title | heading | Board Governance | key: acta.dashboard.title |
| 3 | page.tsx › PageHeader.description | subheading | Committee operations, meeting readiness, action tracking, and compliance posture from live Acta APIs. | key: acta.dashboard.description |
| 4 | page.tsx › loading PageHeader.title | heading | Board Governance | key: acta.dashboard.loadingTitle |
| 5 | page.tsx › loading PageHeader.description | subheading | Board governance operations, meetings, and compliance | key: acta.dashboard.loadingDescription |
| 6 | page.tsx › ErrorState.message | error | Failed to load board governance overview. | key: acta.dashboard.loadError |

#### Component: `_components/acta-dashboard-kpis.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 7 | KpiCard › Active Committees.title | label | Active Committees | key: acta.dashboard.kpiActiveCommittees |
| 8 | KpiCard › Active Committees.description | body | Board and governance committees | key: acta.dashboard.kpiActiveCommitteesDescription |
| 9 | KpiCard › Upcoming Meetings.title | label | Upcoming Meetings | key: acta.dashboard.kpiUpcomingMeetings |
| 10 | KpiCard › Upcoming Meetings.description | body | Scheduled within the next 30 days | key: acta.dashboard.kpiUpcomingMeetingsDescription |
| 11 | KpiCard › Open Action Items.title | label | Open Action Items | key: acta.dashboard.kpiOpenActionItems |
| 12 | KpiCard › overdue helper | body | `{count} overdue` | key: acta.dashboard.kpiOverdue (fn) |
| 13 | KpiCard › no-overdue helper | body | No overdue items | key: acta.dashboard.kpiNoOverdue |
| 14 | Compliance card › title | label | Compliance Score | key: acta.dashboard.kpiComplianceScore |
| 15 | Compliance card › minutes helper | body | `Minutes pending approval: {count}` | key: acta.dashboard.kpiMinutesPending (fn) |
| 16 | Compliance card › attendance helper | body | `Avg attendance: {rate}%` | key: acta.dashboard.kpiAvgAttendance (fn) |
| 17 | Compliance card › link | link | Open compliance | key: acta.dashboard.kpiOpenCompliance |
| 18 | GaugeChart › label | label | Governance | key: acta.dashboard.kpiGovernanceGauge |

#### Component: `_components/acta-calendar-widget.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 19 | SectionCard.title | heading | Meeting Calendar | key: acta.dashboard.calendarTitle |
| 20 | SectionCard.description | subheading | Monthly view of scheduled committee sessions. | key: acta.dashboard.calendarDescription |
| 21 | prev-month button | aria-label | Previous month | key: acta.dashboard.prevMonth |
| 22 | next-month button | aria-label | Next month | key: acta.dashboard.nextMonth |
| 23 | week-day headers | table-header | Mon / Tue / Wed / Thu / Fri / Sat / Sun | key: acta.dashboard.weekDays[] |
| 24 | selected-day fallback | label | Select a day | key: acta.dashboard.selectDay |
| 25 | meetings count | body | `{count} meeting(s)` | key: acta.dashboard.meetingsCount (fn) |
| 26 | empty day | empty-state | No meetings scheduled for the selected day. | key: acta.dashboard.noMeetingsForDay |
| 27 | dot title / meeting title / committee name / time / location | data-driven | meeting.committee_name / meeting.title / meeting.location | data-driven (acta.getCalendar) |

#### Component: `_components/acta-upcoming-meetings.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 28 | SectionCard.title | heading | Upcoming Meetings | key: acta.dashboard.upcomingTitle |
| 29 | SectionCard.description | subheading | Next scheduled committee sessions. | key: acta.dashboard.upcomingDescription |
| 30 | actions link | link | All meetings | key: acta.common.allMeetings |
| 31 | EmptyState.title | empty-state | No upcoming meetings | key: acta.dashboard.upcomingEmptyTitle |
| 32 | EmptyState.description | empty-state | The schedule is currently clear for the next committee sessions. | key: acta.dashboard.upcomingEmptyDescription |
| 33 | StatusBadge fallback label | badge | `status.replace(/_/g,' ')` via statusLabels | key: acta.meetingStatus.* |
| 34 | location fallback | body | Location to be confirmed | key: acta.common.locationTbd |
| 35 | duration unit | body | min | key: acta.common.minutesUnit |
| 36 | quorum pending | badge | Quorum pending | key: acta.common.quorumPending |
| 37 | quorum met | badge | Quorum met | key: acta.common.quorumMet |
| 38 | quorum not met | badge | Quorum not met | key: acta.common.quorumNotMet |

#### Component: `_components/acta-overdue-actions.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 39 | SectionCard.title | heading | Overdue Action Items | key: acta.dashboard.overdueTitle |
| 40 | SectionCard.description | subheading | Top overdue follow-ups across committees. | key: acta.dashboard.overdueDescription |
| 41 | actions link | link | Open tracker | key: acta.common.openTracker |
| 42 | EmptyState.title | empty-state | No overdue items | key: acta.dashboard.overdueEmptyTitle |
| 43 | EmptyState.description | empty-state | Action items are currently within due dates. | key: acta.dashboard.overdueEmptyDescription |
| 44 | days overdue | body | `{days} day(s) overdue` | key: acta.dashboard.daysOverdue (fn) |
| 45 | due on | body | `Due {date}` | key: acta.dashboard.dueOn (fn) |
| 46 | priority badge | badge | Critical/High/Medium/Low | key: acta.priority.* |
| 47 | item title / committee · assignee | data-driven | item.title / item.committee_name · item.assignee_name | data-driven (acta.getDashboard) |

#### Component: `_components/acta-compliance-bars.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 48 | SectionCard.title | heading | Compliance By Committee | key: acta.dashboard.complianceTitle |
| 49 | SectionCard.description | subheading | Committee-level governance scorecards from the latest checks. | key: acta.dashboard.complianceDescription |
| 50 | actions link | link | Full report | key: acta.common.fullReport |
| 51 | EmptyState.title | empty-state | No compliance data | key: acta.dashboard.complianceEmptyTitle |
| 52 | EmptyState.description | empty-state | Run the Acta compliance engine to populate committee scorecards. | key: acta.dashboard.complianceEmptyDescription |
| 53 | non-compliant/warnings | body | `{n} non-compliant • {w} warnings` | key: acta.dashboard.nonCompliantWarnings (fn) |

#### `error.tsx` / `loading.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 54 | error.tsx › RouteError.segment | system | ACTA | HARDCODED (segment prop; RouteError copy is shared — flag) |
| 55 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

### Route: /acta/meetings — `acta/meetings/page.tsx`
_Module bundle: `acta/_lib/acta-i18n.ts` (`list.meetings`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 56 | page.tsx › PageHeader.title | heading | Meetings | key: acta.list.meetings.title |
| 57 | page.tsx › PageHeader.description | subheading | Schedule, track, and conduct board and committee meetings. | key: acta.list.meetings.description |
| 58 | view toggle › table | button | Table | key: acta.list.meetings.viewTable |
| 59 | view toggle › calendar | button | Calendar | key: acta.list.meetings.viewCalendar |
| 60 | schedule button | button | Schedule Meeting | key: acta.list.meetings.schedule |
| 61 | KpiCard total | label | Total meetings | key: acta.list.meetings.kpiTotal |
| 62 | KpiCard scheduled | label | Scheduled | key: acta.list.meetings.kpiScheduled |
| 63 | KpiCard completed | label | Completed | key: acta.list.meetings.kpiCompleted |
| 64 | DataTable empty.title | empty-state | No meetings found | key: acta.list.meetings.emptyTitle |
| 65 | DataTable empty.description | empty-state | No meetings matched the current filters. | key: acta.list.meetings.emptyDescription |

#### Component: `_components/meeting-columns.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 66 | column header | table-header | Meeting | HARDCODED |
| 67 | column header | table-header | Scheduled | HARDCODED |
| 68 | column header | table-header | Attendance | HARDCODED |
| 69 | column header | table-header | Quorum | HARDCODED |
| 70 | quorum cell suffix | body | `{n} required` | HARDCODED ("required") |
| 71 | column header | table-header | Minutes | HARDCODED |
| 72 | minutes cell fallback | body | Not started | HARDCODED |
| 73 | column header | table-header | Status | HARDCODED |

#### Component: `_components/meeting-filters.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 74 | search input | placeholder | Search meetings... | HARDCODED |
| 75 | committee select | aria-label | Filter by committee | HARDCODED |
| 76 | committee select | placeholder | All committees | HARDCODED |
| 77 | committee option | option | All committees | HARDCODED |
| 78 | status select | aria-label | Filter by status | HARDCODED |
| 79 | status select | placeholder | All statuses | HARDCODED |
| 80 | status option | option | All statuses | HARDCODED |
| 81 | status option | option | Draft | HARDCODED |
| 82 | status option | option | Scheduled | HARDCODED |
| 83 | status option | option | In progress | HARDCODED |
| 84 | status option | option | Completed | HARDCODED |
| 85 | status option | option | Cancelled | HARDCODED |
| 86 | status option | option | Postponed | HARDCODED |

#### Component: `_components/schedule-meeting-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 87 | success toast title | toast | Meeting scheduled. | HARDCODED |
| 88 | success toast body | toast | Calendar and attendee records have been created. | HARDCODED |
| 89 | DialogTitle | modal-title | Schedule Meeting | HARDCODED |
| 90 | DialogDescription | modal-body | Create a meeting and initialize attendance from the committee roster. | HARDCODED |
| 91 | FormField label | label | Committee | HARDCODED |
| 92 | committee select | placeholder | Select committee | HARDCODED |
| 93 | FormField label | label | Meeting title | HARDCODED |
| 94 | title input | placeholder | Q2 Board Meeting | HARDCODED |
| 95 | FormField label | label | Location type | HARDCODED |
| 96 | location_type option | option | Physical | HARDCODED |
| 97 | location_type option | option | Virtual | HARDCODED |
| 98 | location_type option | option | Hybrid | HARDCODED |
| 99 | FormField label | label | Description | HARDCODED |
| 100 | FormField label | label | Start | HARDCODED |
| 101 | FormField label | label | End | HARDCODED |
| 102 | FormField label | label | Duration (minutes) | HARDCODED |
| 103 | FormField label | label | Location | HARDCODED |
| 104 | location input | placeholder | Boardroom 4A or Teams Room | HARDCODED |
| 105 | FormField label | label | Virtual link | HARDCODED |
| 106 | virtual_link input | placeholder | https://meet.example.com/... | HARDCODED |
| 107 | FormField label | label | Virtual platform | HARDCODED |
| 108 | virtual_platform input | placeholder | Teams, Zoom, Webex | HARDCODED |
| 109 | cancel button | button | Cancel | HARDCODED |
| 110 | submit button (idle) | button | Schedule meeting | HARDCODED |
| 111 | submit button (pending) | button | Scheduling… | HARDCODED |

#### Component: `_components/meeting-calendar.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 112 | calendar subheading | body | Calendar view of meetings and board sessions. | HARDCODED |
| 113 | week-day headers | table-header | Mon / Tue / Wed / Thu / Fri / Sat / Sun | HARDCODED (inline array; note acta-i18n has `weekDays[]`) |

#### `loading.tsx`
| # | Source | Type | English | Status |
|---|---|---|---|---|
| 114 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

### Route: /acta/meetings/[id] — `acta/meetings/[id]/page.tsx`
_Module bundle: none consumed here (fully HARDCODED)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 115 | loading PageHeader.title | heading | Meeting Details | HARDCODED |
| 116 | loading PageHeader.description | body | `Meeting ID: {id}` | HARDCODED |
| 117 | ErrorState.message | error | Failed to load meeting details. | HARDCODED |
| 118 | PageHeader.description | body | `Committee: {meeting.committee_name}` | HARDCODED prefix + data-driven |
| 119 | edit button | button | Edit | HARDCODED |
| 120 | toast (start) | toast | Meeting started. | HARDCODED |
| 121 | toast (end) | toast | Meeting completed. | HARDCODED |
| 122 | toast (cancel) | toast | Meeting cancelled. | HARDCODED |
| 123 | toast (postpone) | toast | Meeting postponed. | HARDCODED |
| 124 | toast (bulk attendance) | toast | Attendance updated. | HARDCODED |
| 125 | toast (bulk attendance body) | toast | `{n} attendee(s) marked as absent.` | HARDCODED |
| 126 | toast (agenda create) | toast | Agenda item created. | HARDCODED |
| 127 | toast (minutes generate) | toast | Minutes generated. | HARDCODED |
| 128 | toast (minutes create) | toast | Minutes created. | HARDCODED |
| 129 | toast (minutes submit) | toast | Minutes submitted for review. | HARDCODED |
| 130 | toast (revision) | toast | Revision requested. | HARDCODED |
| 131 | toast (minutes approve) | toast | Minutes approved. | HARDCODED |
| 132 | toast (minutes publish) | toast | Minutes published. | HARDCODED |
| 133 | DetailStatCard.label | label | Status | HARDCODED |
| 134 | DetailStatCard.label | label | Scheduled | HARDCODED |
| 135 | DetailStatCard.label | label | Quorum | HARDCODED |
| 136 | quorum value | body | `{present}/{attendee} present` | HARDCODED ("present") |
| 137 | quorum helper (met) | body | Quorum met | HARDCODED |
| 138 | quorum helper (not met) | body | Quorum pending / not met | HARDCODED |
| 139 | DetailStatCard.label | label | Action Items | HARDCODED |
| 140 | SectionCard.title | heading | Meeting Context | HARDCODED |
| 141 | SectionCard.description | subheading | Core scheduling and participation context. | HARDCODED |
| 142 | virtual link | link | Join virtual session | HARDCODED |
| 143 | duration badge | badge | `{n} minutes` | HARDCODED ("minutes") |
| 144 | actions badge | badge | `{n} linked actions` | HARDCODED ("linked actions") |
| 145 | SectionCard.title | heading | Meeting Workspace | HARDCODED |
| 146 | SectionCard.description | subheading | Conduct the session across agenda, attendance, minutes, and follow-ups. | HARDCODED |
| 147 | workspace row | body | `Agenda items: {n}` | HARDCODED |
| 148 | workspace row | body | `Attendance records: {n}` | HARDCODED |
| 149 | workspace row | body | `Minutes: {v# or 'Not started'}` | HARDCODED ("Not started") |
| 150 | workspace row | body | `Attachments: {n}` | HARDCODED |
| 151 | Tab | tab | Agenda | HARDCODED |
| 152 | Tab | tab | Attendance | HARDCODED |
| 153 | Tab | tab | Minutes | HARDCODED |
| 154 | Tab | tab | Action Items | HARDCODED |
| 155 | Tab | tab | Attachments | HARDCODED |

#### Component: `_components/meeting-status-controls.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 156 | start button | button | Start Meeting | HARDCODED |
| 157 | postpone button | button | Postpone | HARDCODED |
| 158 | cancel button | button | Cancel | HARDCODED |
| 159 | end button | button | End Meeting | HARDCODED |
| 160 | cancel DialogTitle | modal-title | Cancel Meeting | HARDCODED |
| 161 | cancel DialogDescription | modal-body | Record a cancellation reason for the audit trail. | HARDCODED |
| 162 | FormField label | label | Reason | HARDCODED |
| 163 | cancel close button | button | Close | HARDCODED |
| 164 | cancel submit button | button | Cancel meeting | HARDCODED |
| 165 | postpone DialogTitle | modal-title | Postpone Meeting | HARDCODED |
| 166 | postpone DialogDescription | modal-body | Move the meeting while retaining the original schedule history. | HARDCODED |
| 167 | FormField label | label | New start | HARDCODED |
| 168 | FormField label | label | New end | HARDCODED |
| 169 | FormField label | label | Reason | HARDCODED |
| 170 | postpone close button | button | Close | HARDCODED |
| 171 | postpone submit button | button | Postpone | HARDCODED |
| 172 | end DialogTitle | modal-title | End Meeting | HARDCODED |
| 173 | end DialogDescription | modal-body | Finalize attendance, compute quorum, and close the meeting. | HARDCODED |
| 174 | end summary | body | `Attendance: {p}/{a}. Quorum: {met/pending recalculation}.` | HARDCODED (incl. "met" / "pending recalculation") |
| 175 | end keep-open button | button | Keep open | HARDCODED |
| 176 | end submit button | button | End meeting | HARDCODED |

#### Component: `_components/quorum-indicator.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 177 | heading | label | Attendance | HARDCODED |
| 178 | count line | body | `{n} of {t} members counted for quorum` | HARDCODED ("of ... members counted for quorum") |
| 179 | badge (met) | badge | Quorum Met | HARDCODED |
| 180 | badge (not met) | badge | Quorum Not Met | HARDCODED |
| 181 | footer stat | body | `{n} present` | HARDCODED ("present") |
| 182 | footer stat | body | `{n} proxy` | HARDCODED ("proxy") |
| 183 | footer stat | body | `{n} absent` | HARDCODED ("absent") |
| 184 | footer stat | body | `{n} excused` | HARDCODED ("excused") |
| 185 | footer stat | body | `{n} required` | HARDCODED ("required") |

#### Component: `_components/agenda-tab.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 186 | add-form heading | label | Add Agenda Item | HARDCODED |
| 187 | FormField label | label | Title | HARDCODED |
| 188 | FormField label | label | Duration (minutes) | HARDCODED |
| 189 | FormField label | label | Description | HARDCODED |
| 190 | FormField label | label | Presenter | HARDCODED |
| 191 | presenter select | placeholder | Select presenter | HARDCODED |
| 192 | FormField label | label | Category | HARDCODED |
| 193 | category options | option | regular / special / information / decision / discussion / ratification | HARDCODED (raw enum values shown) |
| 194 | FormField label | label | Vote type | HARDCODED |
| 195 | vote_type select | placeholder | No vote required | HARDCODED |
| 196 | vote_type option | option | No vote required | HARDCODED |
| 197 | vote_type option | option | Unanimous | HARDCODED |
| 198 | vote_type option | option | Simple majority | HARDCODED |
| 199 | vote_type option | option | Two-thirds | HARDCODED |
| 200 | vote_type option | option | Roll call | HARDCODED |
| 201 | submit button | button | Add agenda item | HARDCODED |

#### Component: `_components/agenda-item-card.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 202 | reorder handle | aria-label | Reorder agenda item | HARDCODED |
| 203 | duration badge | badge | `{n} min` | HARDCODED ("min") |
| 204 | presenter line | body | `Presenter: {name ?? 'Unassigned'}` | HARDCODED ("Presenter:" / "Unassigned") |
| 205 | status badge | badge | `status.replace(/_/g,' ')` | data-driven (raw status; capitalized) |
| 206 | detail heading | label | Description | HARDCODED |
| 207 | notes heading | label | Discussion Notes | HARDCODED |
| 208 | autosave hint | body | Autosaves after 500ms | HARDCODED |
| 209 | read-only hint | body | Read only | HARDCODED |
| 210 | notes textarea | placeholder | Capture discussion notes during the meeting. | HARDCODED |
| 211 | record-vote button | button | Record Vote | HARDCODED |
| 212 | remove button | button | Remove | HARDCODED |
| 213 | voting heading | label | Voting | HARDCODED |
| 214 | vote summary | body | `agendaVoteSummary(item)` | data-driven (computed in `lib/enterprise`) |

#### Component: `_components/agenda-vote-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 215 | DialogTitle | modal-title | Record Vote | HARDCODED |
| 216 | DialogDescription | modal-body | `Capture the voting outcome for {item?.title ?? 'agenda item'}.` | HARDCODED (incl. "agenda item") |
| 217 | vote-total error | validation | `Vote total cannot exceed {n} present attendees.` | HARDCODED |
| 218 | FormField label | label | Vote type | HARDCODED |
| 219 | vote_type option | option | Unanimous | HARDCODED |
| 220 | vote_type option | option | Simple Majority | HARDCODED |
| 221 | vote_type option | option | Two-thirds Majority | HARDCODED |
| 222 | vote_type option | option | Roll Call | HARDCODED |
| 223 | FormField label | label | In favor | HARDCODED |
| 224 | FormField label | label | Against | HARDCODED |
| 225 | FormField label | label | Abstained | HARDCODED |
| 226 | result heading | label | Result preview | HARDCODED |
| 227 | result outcome | body | `{outcome.label}` | data-driven (calculateVoteOutcome in lib/enterprise) |
| 228 | tied suffix | body | ` — Chair may cast deciding vote.` | HARDCODED |
| 229 | total votes | body | `Total votes: {n} / {present}` | HARDCODED ("Total votes:") |
| 230 | FormField label | label | Notes | HARDCODED |
| 231 | cancel button | button | Cancel | HARDCODED |
| 232 | submit button (idle) | button | Record vote | HARDCODED |
| 233 | submit button (pending) | button | Saving… | HARDCODED |

#### Component: `_components/attendance-tab.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 234 | bulk absent button | button | Mark All Remaining as Absent | HARDCODED (+ ` ({n})` count suffix) |
| 235 | member subline | body | `{email} • {member_role.replace(/_/g,' ')}` | data-driven (role raw) |
| 236 | status option | option | Present | HARDCODED |
| 237 | status option | option | Absent | HARDCODED |
| 238 | status option | option | Proxy | HARDCODED |
| 239 | status option | option | Excused | HARDCODED |
| 240 | proxy input | placeholder | Proxy name | HARDCODED |
| 241 | notes fallback | body | No notes | HARDCODED |
| 242 | save button | button | Save | HARDCODED |

#### Component: `_components/action-items-tab.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 243 | create button | button | Create Action Item | HARDCODED |
| 244 | empty state | empty-state | No action items are currently linked to this meeting. | HARDCODED |
| 245 | item subline | body | `{assignee_name} • due {due_date}` | HARDCODED ("due") + data-driven |

#### Component: `_components/attachments-tab.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 246 | empty state | empty-state | No attachments have been uploaded for this meeting. | HARDCODED |
| 247 | content-type fallback | body | Unknown type | HARDCODED |
| 248 | remove button | button | Remove | HARDCODED |

#### Component: `_components/minutes-tab.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 249 | no-minutes heading | heading | No minutes yet | HARDCODED |
| 250 | no-minutes body | body | Generate deterministic minutes from attendance, agenda notes, votes, and action items, or write them manually. | HARDCODED |
| 251 | generate button (idle) | button | Generate AI Minutes | HARDCODED |
| 252 | generate button (pending) | button | Generating minutes… | HARDCODED |
| 253 | write-manual button | button | Write Manually | HARDCODED |
| 254 | workflow step badge | badge | `step.replace(/_/g,' ')` (draft/review/revision_requested/approved/published) | data-driven (raw enum) |
| 255 | version badge | badge | `v{version}` | data-driven |
| 256 | edit button | button | Edit | HARDCODED |
| 257 | submit-review button | button | Submit for Review | HARDCODED |
| 258 | approve button | button | Approve | HARDCODED |
| 259 | request-revision button | button | Request Revision | HARDCODED |
| 260 | publish button | button | Publish | HARDCODED |
| 261 | chair-only note | body | Only the committee chair can approve or request revisions. | HARDCODED |
| 262 | revision textarea | placeholder | Describe what needs to be revised… | HARDCODED |
| 263 | send-revision button | button | Send Revision Request | HARDCODED |
| 264 | revision cancel button | button | Cancel | HARDCODED |
| 265 | revision-requested heading | label | Revision requested | HARDCODED |
| 266 | version-history heading | label | Version history | HARDCODED |

#### Component: `_components/minutes-editor.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 267 | cancel button | button | Cancel | HARDCODED |
| 268 | save button (idle) | button | Save minutes | HARDCODED |
| 269 | save button (pending) | button | Saving… | HARDCODED |
| 270 | preview heading | label | Preview | HARDCODED |

#### Component: `_components/ai-actions-sidebar.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 271 | toast title | toast | Action items created. | HARDCODED |
| 272 | toast body | toast | AI-extracted action items have been pushed to the tracker. | HARDCODED |
| 273 | heading | label | AI-extracted actions | HARDCODED |
| 274 | subheading | body | Deterministic extraction from discussion notes and minutes content. | HARDCODED |
| 275 | create-all button | button | Create All | HARDCODED |
| 276 | empty state | empty-state | No action items were extracted from the minutes. | HARDCODED |
| 277 | action subline | body | `{assigned_to} • {due_date ?? 'No due date'}` | HARDCODED ("No due date") + data-driven |
| 278 | created badge | badge | Created | HARDCODED |
| 279 | priority badge | badge | `action.priority` | data-driven (raw) |
| 280 | create-item button | button | Create Action Item | HARDCODED |

#### Component: `_components/edit-meeting-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 281 | toast title | toast | Meeting updated. | HARDCODED |
| 282 | toast body | toast | Changes have been saved. | HARDCODED |
| 283 | DialogTitle | modal-title | Edit Meeting | HARDCODED |
| 284 | DialogDescription | modal-body | Update meeting details. Committee assignment cannot be changed. | HARDCODED |
| 285 | FormField label | label | Meeting title | HARDCODED |
| 286 | title input | placeholder | Q2 Board Meeting | HARDCODED |
| 287 | FormField label | label | Location type | HARDCODED |
| 288 | location_type option | option | Physical / Virtual / Hybrid | HARDCODED |
| 289 | FormField label | label | Description | HARDCODED |
| 290 | FormField label | label | Start / End | HARDCODED |
| 291 | FormField label | label | Duration (minutes) | HARDCODED |
| 292 | FormField label | label | Location | HARDCODED |
| 293 | location input | placeholder | Boardroom 4A or Teams Room | HARDCODED |
| 294 | FormField label | label | Virtual link | HARDCODED |
| 295 | virtual_link input | placeholder | https://meet.example.com/... | HARDCODED |
| 296 | FormField label | label | Virtual platform | HARDCODED |
| 297 | virtual_platform input | placeholder | Teams, Zoom, Webex | HARDCODED |
| 298 | cancel button | button | Cancel | HARDCODED |
| 299 | submit button (idle/pending) | button | Save changes / Saving... | HARDCODED |

---

### Route: /acta/committees — `acta/committees/page.tsx`
_Module bundle: `acta/_lib/acta-i18n.ts` (`list.committees`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 300 | ErrorState.message | error | Failed to load committees. | key: acta.list.committees.loadError |
| 301 | PageHeader.title | heading | Committees | key: acta.list.committees.title |
| 302 | PageHeader.description | subheading | Board and governance committee roster, cadence, and operating profile. | key: acta.list.committees.description |
| 303 | search input | placeholder | Search committees... | key: acta.list.committees.searchPlaceholder |

#### Component: `_components/committee-card.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 304 | type subline | body | `type.replace(/_/g,' ')` | data-driven (raw enum) |
| 305 | member count | body | `{n} active members` | HARDCODED ("active members") |
| 306 | frequency | body | `meeting_frequency.replace(/_/g,' ')` | data-driven (raw enum) |
| 307 | quorum line | body | `Quorum {n members / n%}` | HARDCODED ("Quorum" / "members") |
| 308 | open button | button | Open Committee | HARDCODED |

#### Component: `_components/committee-grid.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 309 | EmptyState.title | empty-state | No committees found | HARDCODED |
| 310 | EmptyState.description | empty-state | Create the first governance committee to start managing board operations. | HARDCODED |

#### Component: `_components/committee-stats.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 311 | KpiCard.title | label | Members | HARDCODED |
| 312 | KpiCard.title | label | Upcoming Meetings | HARDCODED |
| 313 | KpiCard.title | label | Open Actions | HARDCODED |
| 314 | Open Actions description (overdue) | body | `{n} overdue` | HARDCODED |
| 315 | Open Actions description (none) | body | No overdue items | HARDCODED |
| 316 | KpiCard.title | label | Pending Minutes | HARDCODED |

#### Component: `_components/create-committee-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 317 | toast title | toast | Committee created. | HARDCODED |
| 318 | toast body | toast | The governance committee has been added. | HARDCODED |
| 319 | trigger button | button | Create Committee | HARDCODED |
| 320 | DialogTitle | modal-title | Create Committee | HARDCODED |
| 321 | DialogDescription | modal-body | Define committee charter, cadence, and leadership with live directory data. | HARDCODED |
| 322 | FormField label | label | Committee name | HARDCODED |
| 323 | name input | placeholder | Board of Directors | HARDCODED |
| 324 | FormField label | label | Committee type | HARDCODED |
| 325 | type options | option | board / audit / risk / compensation / nomination / executive / governance / ad_hoc (`.replace(/_/g,' ')`) | HARDCODED (raw enum values) |
| 326 | FormField label | label | Description | HARDCODED |
| 327 | description textarea | placeholder | Mandate, remit, and oversight scope. | HARDCODED |
| 328 | RoleSelect label | label | Chair | HARDCODED |
| 329 | RoleSelect label | label | Vice chair | HARDCODED |
| 330 | RoleSelect label | label | Secretary | HARDCODED |
| 331 | RoleSelect placeholder | placeholder | `Select {label.toLowerCase()}` | HARDCODED |
| 332 | FormField label | label | Meeting frequency | HARDCODED |
| 333 | frequency options | option | weekly / bi_weekly / monthly / quarterly / semi_annual / annual / ad_hoc (`.replace(/_/g,' ')`) | HARDCODED (raw enum values) |
| 334 | fixed-quorum toggle title | label | Use fixed quorum count | HARDCODED |
| 335 | fixed-quorum toggle body | body | Switch from percentage-based quorum to absolute count. | HARDCODED |
| 336 | FormField label | label | Fixed quorum count | HARDCODED |
| 337 | FormField label | label | Quorum percentage | HARDCODED |
| 338 | FormField label | label | Established date | HARDCODED |
| 339 | FormField label | label | Charter | HARDCODED |
| 340 | charter textarea | placeholder | Paste the committee charter or mandate text. | HARDCODED |
| 341 | cancel button | button | Cancel | HARDCODED |
| 342 | submit button (idle/pending) | button | Create committee / Creating… | HARDCODED |

#### Component: `_components/member-management.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 343 | toast (add) | toast | Member added. | HARDCODED |
| 344 | toast (add body) | toast | Committee roster has been updated. | HARDCODED |
| 345 | toast (role) | toast | Role updated. | HARDCODED |
| 346 | toast (role body) | toast | Committee member role has been changed. | HARDCODED |
| 347 | toast (remove) | toast | Member removed. | HARDCODED |
| 348 | toast (remove body) | toast | The committee roster has been updated. | HARDCODED |
| 349 | SectionCard.title | heading | Member Management | HARDCODED |
| 350 | SectionCard.description | subheading | Maintain committee membership and role assignments. | HARDCODED |
| 351 | role badge / options | badge/option | chair / vice_chair / secretary / member / observer (`.replace(/_/g,' ')`) | HARDCODED (raw enum values) |
| 352 | remove button | aria-label | `Remove {member.user_name}` | HARDCODED ("Remove") |
| 353 | FormField label | label | Add member | HARDCODED |
| 354 | user select | placeholder | Select user | HARDCODED |
| 355 | FormField label | label | Role | HARDCODED |
| 356 | add button | button | Add | HARDCODED |

#### `loading.tsx`
| # | Source | Type | English | Status |
|---|---|---|---|---|
| 357 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

### Route: /acta/committees/[id] — `acta/committees/[id]/page.tsx`
_Module bundle: none consumed here (fully HARDCODED)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 358 | toast (delete) | toast | Committee deleted. | HARDCODED |
| 359 | toast (delete body) | toast | The committee has been permanently removed. | HARDCODED |
| 360 | ErrorState.message | error | Failed to load committee details. | HARDCODED |
| 361 | edit button | button | Edit | HARDCODED |
| 362 | delete button | button | Delete | HARDCODED |
| 363 | type/frequency badges | badge | `type.replace(/_/g,' ')` / `meeting_frequency.replace(/_/g,' ')` | data-driven (raw enum) |
| 364 | quorum badge | badge | `Quorum {fixed_count / n%}` | HARDCODED ("Quorum") |
| 365 | SectionCard.title | heading | Committee Profile | HARDCODED |
| 366 | SectionCard.description | subheading | Governance mandate and operating model. | HARDCODED |
| 367 | charter heading | label | Charter | HARDCODED |
| 368 | charter fallback | body | No charter text is currently recorded. | HARDCODED |
| 369 | established heading | label | Established | HARDCODED |
| 370 | established fallback | body | Not recorded | HARDCODED |
| 371 | tags heading | label | Tags | HARDCODED |
| 372 | tags empty | body | No tags | HARDCODED |
| 373 | SectionCard.title | heading | Recent Meetings | HARDCODED |
| 374 | SectionCard.description | subheading | Latest scheduled and completed sessions for this committee. | HARDCODED |
| 375 | actions link | link | All meetings | HARDCODED |
| 376 | meetings empty | empty-state | No meetings found for this committee. | HARDCODED |
| 377 | meeting subline | body | `{date} • {n} min` | HARDCODED ("min") + data-driven |
| 378 | meeting location fallback | body | Location TBD | HARDCODED |
| 379 | meeting attendance | body | `{present}/{attendee} present` | HARDCODED ("present") |
| 380 | SectionCard.title | heading | Open Actions | HARDCODED |
| 381 | SectionCard.description | subheading | Current committee follow-ups and due dates. | HARDCODED |
| 382 | actions link | link | Open tracker | HARDCODED |
| 383 | actions empty | empty-state | No action items found for this committee. | HARDCODED |
| 384 | action subline | body | `{assignee_name} • due {date}` | HARDCODED ("due") + data-driven |
| 385 | priority | body | `{priority} priority` | HARDCODED ("priority") + data-driven |
| 386 | meeting-linked chip | body | Meeting linked | HARDCODED |
| 387 | completed chip | body | Completed | HARDCODED |
| 388 | ConfirmDialog.title | modal-title | Delete Committee | HARDCODED |
| 389 | ConfirmDialog.description | modal-body | `Are you sure you want to delete "{name}"? This action cannot be undone and will remove all associated records.` | HARDCODED |
| 390 | ConfirmDialog.confirmLabel | button | Delete committee | HARDCODED |

#### Component: `[id]/_components/edit-committee-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 391 | toast title | toast | Committee updated. | HARDCODED |
| 392 | toast body | toast | Changes have been saved. | HARDCODED |
| 393 | DialogTitle | modal-title | Edit Committee | HARDCODED |
| 394 | DialogDescription | modal-body | Update committee charter, cadence, and leadership. | HARDCODED |
| 395 | FormField label | label | Committee name | HARDCODED |
| 396 | FormField label | label | Committee type | HARDCODED |
| 397 | type options | option | board / audit / risk / compensation / nomination / executive / governance / ad_hoc | HARDCODED (raw enum) |
| 398 | FormField label | label | Status | HARDCODED |
| 399 | status options | option | active / inactive / dissolved | HARDCODED (raw enum, capitalize CSS) |
| 400 | FormField label | label | Description | HARDCODED |
| 401 | RoleSelect label | label | Chair / Vice chair / Secretary | HARDCODED |
| 402 | RoleSelect placeholder | placeholder | `Select {label.toLowerCase()}` | HARDCODED |
| 403 | FormField label | label | Meeting frequency | HARDCODED |
| 404 | frequency options | option | weekly / bi_weekly / monthly / quarterly / semi_annual / annual / ad_hoc | HARDCODED (raw enum) |
| 405 | fixed-quorum toggle title | label | Use fixed quorum count | HARDCODED |
| 406 | fixed-quorum toggle body | body | Switch from percentage-based quorum to absolute count. | HARDCODED |
| 407 | FormField label | label | Fixed quorum count | HARDCODED |
| 408 | FormField label | label | Quorum percentage | HARDCODED |
| 409 | FormField label | label | Established date | HARDCODED |
| 410 | FormField label | label | Charter | HARDCODED |
| 411 | cancel button | button | Cancel | HARDCODED |
| 412 | submit button (idle/pending) | button | Save changes / Saving... | HARDCODED |

---

### Route: /acta/action-items — `acta/action-items/page.tsx`
_Module bundle: `acta/_lib/acta-i18n.ts` (`list.actionItems`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 413 | toast title | toast | Action item updated. | key: acta.list.actionItems.toastUpdatedTitle |
| 414 | toast body | toast | The action item status has been changed. | key: acta.list.actionItems.toastUpdatedBody |
| 415 | PageHeader.title | heading | Action Items | key: acta.list.actionItems.title |
| 416 | PageHeader.description | subheading | Track governance follow-ups in table or kanban view. | key: acta.list.actionItems.description |
| 417 | view toggle › table | button | Table | key: acta.list.actionItems.viewTable |
| 418 | view toggle › kanban | button | Kanban | key: acta.list.actionItems.viewKanban |
| 419 | create button | button | Create Action | key: acta.list.actionItems.create |
| 420 | KpiCard | label | Open | key: acta.list.actionItems.kpiOpen |
| 421 | KpiCard | label | Overdue | key: acta.list.actionItems.kpiOverdue |
| 422 | KpiCard | label | Completed | key: acta.list.actionItems.kpiCompleted |
| 423 | tab | tab | All | key: acta.list.actionItems.tabAll |
| 424 | tab | tab | My Items | key: acta.list.actionItems.tabMy |
| 425 | tab | tab | Overdue | key: acta.list.actionItems.tabOverdue |
| 426 | tab | tab | Completed | key: acta.list.actionItems.tabCompleted |
| 427 | search input | placeholder | Search action items... | key: acta.list.actionItems.searchPlaceholder |
| 428 | DataTable error | error | Failed to load action items. | key: acta.list.actionItems.loadError |
| 429 | DataTable empty.title | empty-state | No action items | key: acta.list.actionItems.emptyTitle |
| 430 | DataTable empty.description | empty-state | No action items matched the current scope. | key: acta.list.actionItems.emptyDescription |

#### Component: `_components/action-item-columns.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 431 | column header | table-header | Action Item | HARDCODED |
| 432 | column header | table-header | Meeting | HARDCODED |
| 433 | column header | table-header | Due Date | HARDCODED |
| 434 | overdue cell | body | `{n} day(s) overdue` | HARDCODED ("day/days overdue") |
| 435 | column header | table-header | Priority | HARDCODED |
| 436 | priority cell | badge | `row.priority` | data-driven (raw, capitalize CSS) |
| 437 | column header | table-header | Status | HARDCODED |
| 438 | complete button | button | Complete | HARDCODED |
| 439 | extend button | button | Extend | HARDCODED |

#### Component: `_components/action-item-kanban.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 440 | column label | table-header | Pending | HARDCODED |
| 441 | column label | table-header | In Progress | HARDCODED |
| 442 | column label | table-header | Completed | HARDCODED |
| 443 | column label | table-header | Overdue | HARDCODED |
| 444 | BulkToolbar region | aria-label | Bulk actions | HARDCODED |
| 445 | BulkToolbar count | body | `{n} selected` | HARDCODED ("selected") |
| 446 | bulk mark-pending button | button | Mark pending | HARDCODED |
| 447 | bulk mark-in-progress button | button | Mark in progress | HARDCODED |
| 448 | bulk clear button | button | Clear | HARDCODED |
| 449 | card checkbox | aria-label | `Deselect {title}` / `Select {title}` | HARDCODED ("Select"/"Deselect") |
| 450 | card priority badge | badge | `item.priority` | data-driven (raw) |
| 451 | card due | body | `Due {due_date}` | HARDCODED ("Due") |
| 452 | card overdue | body | `{n} day(s) overdue` | HARDCODED ("day/days overdue") |

#### Component: `_components/complete-action-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 453 | toast title | toast | Action item completed. | HARDCODED |
| 454 | toast body | toast | Completion notes and evidence have been saved. | HARDCODED |
| 455 | reject error | error | No action item selected. | HARDCODED |
| 456 | DialogTitle | modal-title | Complete Action Item | HARDCODED |
| 457 | DialogDescription | modal-body | Capture closure notes and optional evidence for the completed follow-up. | HARDCODED |
| 458 | FormField label | label | Completion notes | HARDCODED |
| 459 | evidence heading | label | Completion evidence | HARDCODED |
| 460 | evidence count | body | `{n} evidence file(s) attached.` | HARDCODED ("evidence file(s) attached.") |
| 461 | cancel button | button | Cancel | HARDCODED |
| 462 | submit button (idle/pending) | button | Complete action / Saving… | HARDCODED |

#### Component: `_components/create-action-item-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 463 | toast title | toast | Action item created. | HARDCODED |
| 464 | toast body | toast | The follow-up has been added to the tracker. | HARDCODED |
| 465 | DialogTitle | modal-title | Create Action Item | HARDCODED |
| 466 | DialogDescription | modal-body | Assign a follow-up from meeting decisions or governance reviews. | HARDCODED |
| 467 | FormField label | label | Meeting | HARDCODED |
| 468 | meeting select | placeholder | Select meeting | HARDCODED |
| 469 | FormField label | label | Committee | HARDCODED |
| 470 | committee select | placeholder | Select committee | HARDCODED |
| 471 | FormField label | label | Title | HARDCODED |
| 472 | title input | placeholder | Prepare Q2 board pack | HARDCODED |
| 473 | FormField label | label | Description | HARDCODED |
| 474 | FormField label | label | Priority | HARDCODED |
| 475 | priority options | option | Critical / High / Medium / Low | HARDCODED |
| 476 | FormField label | label | Assigned to | HARDCODED |
| 477 | assignee select | placeholder | Select assignee | HARDCODED |
| 478 | FormField label | label | Due date | HARDCODED |
| 479 | cancel button | button | Cancel | HARDCODED |
| 480 | submit button (idle/pending) | button | Create action / Creating… | HARDCODED |

#### Component: `_components/extend-due-date-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 481 | toast title | toast | Due date extended. | HARDCODED |
| 482 | toast body | toast | The action item timeline has been updated. | HARDCODED |
| 483 | reject error | error | No action item selected. | HARDCODED |
| 484 | DialogTitle | modal-title | Extend Due Date | HARDCODED |
| 485 | DialogDescription | modal-body | Record the extension rationale and preserve the original due date for auditability. | HARDCODED |
| 486 | extension summary | body | `Extension #{n} • original due {date}` | HARDCODED ("Extension #" / "original due") |
| 487 | FormField label | label | New due date | HARDCODED |
| 488 | FormField label | label | Reason | HARDCODED |
| 489 | cancel button | button | Cancel | HARDCODED |
| 490 | submit button (idle/pending) | button | Extend due date / Saving… | HARDCODED |

#### `loading.tsx`
| # | Source | Type | English | Status |
|---|---|---|---|---|
| 491 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

### Route: /acta/compliance — `acta/compliance/page.tsx`
_Module bundle: none consumed here (fully HARDCODED)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 492 | toast title | toast | Compliance checks completed. | HARDCODED |
| 493 | toast body | toast | Stored findings and scorecards have been refreshed. | HARDCODED |
| 494 | column header | table-header | Check | HARDCODED |
| 495 | column header | table-header | Type | HARDCODED |
| 496 | check_type cell | badge | `check_type.replace(/_/g,' ')` | data-driven (raw) |
| 497 | column header | table-header | Severity | HARDCODED |
| 498 | severity cell | badge | `row.severity` | data-driven (raw) |
| 499 | column header | table-header | Status | HARDCODED |
| 500 | column header | table-header | Finding | HARDCODED |
| 501 | finding fallback | body | No exception found | HARDCODED |
| 502 | PageHeader.title | heading | Compliance | HARDCODED |
| 503 | PageHeader.description | subheading | Automated governance checks, committee scorecards, and auditable findings. | HARDCODED |
| 504 | run button (idle/pending) | button | Run checks / Running checks… | HARDCODED |
| 505 | KpiCard.title | label | Compliance Score | HARDCODED |
| 506 | KpiCard.title | label | Non-Compliant | HARDCODED |
| 507 | KpiCard.title | label | Warnings | HARDCODED |
| 508 | KpiCard.title | label | Checks Logged | HARDCODED |
| 509 | SectionCard.title | heading | Latest Scorecard | HARDCODED |
| 510 | SectionCard.description | subheading | Current committee-level compliance distribution. | HARDCODED |
| 511 | SectionCard.title | heading | Check Distribution | HARDCODED |
| 512 | SectionCard.description | subheading | Counts by compliance status from the last report run. | HARDCODED |
| 513 | status row label | body | `status.replace(/_/g,' ')` | data-driven (raw by_status keys) |
| 514 | DataTable empty.title | empty-state | No compliance findings | HARDCODED |
| 515 | DataTable empty.description | empty-state | Run compliance checks to populate auditable results. | HARDCODED |

_Note: this page also renders `<ActaComplianceBars>` (see #48-53, keyed) inside the "Latest Scorecard" SectionCard._

#### `loading.tsx`
| # | Source | Type | English | Status |
|---|---|---|---|---|
| 516 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

## VISUS — Executive Intelligence

### Route: /visus — `visus/page.tsx`
_Module bundle: `visus/_lib/visus-i18n.ts` (`common.*`, `overview.*`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 517 | loading PageHeader.title | heading | Executive Intelligence | key: visus.overview.loadingTitle |
| 518 | loading PageHeader.description | subheading | Executive dashboards and reports | key: visus.overview.loadingDescription |
| 519 | ErrorState.message | error | Failed to load executive intelligence views. | key: visus.overview.loadError |
| 520 | PageHeader.eyebrow | breadcrumb | Visus · Executive Intelligence | key: visus.common.eyebrow |
| 521 | PageHeader.title | heading | Executive Intelligence | key: visus.overview.title |
| 522 | PageHeader.description | subheading | Live executive reporting inventory across dashboards, widgets, and scheduled reports. | key: visus.overview.description |
| 523 | tag | badge | `{count} dashboards` | key: visus.overview.tagDashboards (fn) |
| 524 | tag | badge | `{count} reports` | key: visus.overview.tagReports (fn) |
| 525 | tag | badge | `{count} widgets` | key: visus.overview.tagWidgets (fn) |
| 526 | stat label | label | Dashboards | key: visus.common.dashboards |
| 527 | stat label | label | Reports | key: visus.common.reports |
| 528 | manage button | button | Manage dashboards | key: visus.overview.manageDashboards |
| 529 | open button | button | Open reports | key: visus.overview.openReports |
| 530 | KpiCard | label | Dashboards | key: visus.overview.kpiDashboards |
| 531 | KpiCard | label | Reports | key: visus.overview.kpiReports |
| 532 | KpiCard | label | Widgets | key: visus.overview.kpiWidgets |
| 533 | KpiCard | label | Default Dashboards | key: visus.overview.kpiDefaultDashboards |
| 534 | SectionCard.title | heading | Dashboards | key: visus.overview.dashboardsTitle |
| 535 | SectionCard.description | subheading | Dashboard definitions currently available to the tenant. | key: visus.overview.dashboardsDescription |
| 536 | actions link | link | Reports | key: visus.common.reports |
| 537 | EmptyState.title | empty-state | No dashboards configured | key: visus.overview.dashboardsEmptyTitle |
| 538 | EmptyState.description | empty-state | No executive dashboards are configured. | key: visus.overview.dashboardsEmptyDescription |
| 539 | dashboard description fallback | body | No description provided | key: visus.common.noDescription |
| 540 | default badge | badge | Default | key: visus.overview.defaultBadge |
| 541 | widget count | body | `{count} widget(s)` | key: visus.overview.widgetCount (fn) |
| 542 | SectionCard.title | heading | Widget Mix | key: visus.overview.widgetMixTitle |
| 543 | SectionCard.description | subheading | Distribution of widget types across dashboard inventory. | key: visus.overview.widgetMixDescription |
| 544 | EmptyState.title | empty-state | No widgets configured | key: visus.overview.widgetMixEmptyTitle |
| 545 | EmptyState.description | empty-state | No dashboard widgets have been configured. | key: visus.overview.widgetMixEmptyDescription |
| 546 | BarChart y-label | label | Widgets | key: visus.overview.widgetMixChartLabel |
| 547 | SectionCard.title | heading | Executive Health | key: visus.overview.executiveHealthTitle |
| 548 | SectionCard.description | subheading | Cross-suite health and latest executive rollup returned by the Visus executive endpoint. | key: visus.overview.executiveHealthDescription |
| 549 | actions link | link | Dashboard studio | key: visus.overview.dashboardStudio |
| 550 | generated-at prefix | body | Generated | key: visus.overview.generatedAt |
| 551 | suite name | body | `suite.replace(/_/g,' ')` | data-driven (executiveView.suite_health keys) |
| 552 | health badge (available) | badge | Available | key: visus.overview.available |
| 553 | health badge (unavailable) | badge | Unavailable | key: visus.overview.unavailable |
| 554 | latency line | body | `Latency {ms} ms` | key: visus.overview.latencyMs (fn) |
| 555 | last-success line | body | `Last success {at}` | key: visus.overview.lastSuccess (fn) |
| 556 | no-sync line | body | No successful sync yet | key: visus.overview.noSuccessfulSync |
| 557 | StatCard label | label | Cached Executive Alerts | key: visus.overview.cachedExecutiveAlerts |
| 558 | StatCard label | label | Cached KPI Snapshots | key: visus.overview.cachedKpiSnapshots |
| 559 | EmptyState.title | empty-state | No executive health data | key: visus.overview.executiveHealthEmptyTitle |
| 560 | EmptyState.description | empty-state | Executive health data is unavailable for this tenant. | key: visus.overview.executiveHealthEmptyDescription |
| 561 | SectionCard.title | heading | Recent Reports | key: visus.overview.recentReportsTitle |
| 562 | SectionCard.description | subheading | Most recently updated report definitions. | key: visus.overview.recentReportsDescription |
| 563 | EmptyState.title | empty-state | No reports configured | key: visus.overview.recentReportsEmptyTitle |
| 564 | EmptyState.description | empty-state | No executive reports are currently configured. | key: visus.overview.recentReportsEmptyDescription |
| 565 | report type subline | body | `report_type.replace(/_/g,' ')` (fallback 'custom') | data-driven (raw) |
| 566 | last-output line (has) | body | Last output available | key: visus.overview.lastOutputAvailable |
| 567 | last-output line (none) | body | No output generated yet | key: visus.overview.noOutputYet |
| 568 | never-generated | body | Never generated | key: visus.overview.neverGenerated |

#### `error.tsx`
| # | Source | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 569 | error.tsx › RouteError.segment | system | Visus | HARDCODED (segment prop; RouteError copy shared — flag) |

#### Co-located: `components/visus/cti/cti-executive-section.tsx` (rendered on /visus)
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 570 | WidgetErrorCard.description (prop, generic) | error | (see per-widget titles below) | HARDCODED |
| 571 | Retry button | button | Retry | HARDCODED |
| 572 | eyebrow | breadcrumb | Cyber Threat Intelligence | HARDCODED |
| 573 | heading | heading | Executive CTI Snapshot | HARDCODED |
| 574 | subheading | body | Live threat posture, active campaigns, geographic hotspots, and sector targeting from the cyber suite. | HARDCODED |
| 575 | refresh button | button | Refresh | HARDCODED |
| 576 | view-full button | link | View Full CTI | HARDCODED |
| 577 | error card title | modal-title | CTI Risk Summary | HARDCODED |
| 578 | error card description | error | The executive risk snapshot could not be loaded. | HARDCODED |
| 579 | error card title | modal-title | Threat Map | HARDCODED |
| 580 | error card description | error | The CTI threat map is temporarily unavailable. | HARDCODED |
| 581 | error card title | modal-title | Active Campaigns | HARDCODED |
| 582 | error card description | error | Campaign data could not be loaded from the CTI bridge. | HARDCODED |
| 583 | error card title | modal-title | Critical Brand Abuse | HARDCODED |
| 584 | error card description | error | Brand abuse signals are temporarily unavailable. | HARDCODED |
| 585 | error card title | modal-title | Sector Targeting | HARDCODED |
| 586 | error card description | error | Sector aggregation data is temporarily unavailable. | HARDCODED |

#### Co-located: `components/visus/cti/cti-kpi-row-widget.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 587 | empty state | empty-state | CTI KPI snapshots are currently unavailable. | HARDCODED |
| 588 | stat label | label | Events 24h | HARDCODED |
| 589 | stat label | label | Active Campaigns | HARDCODED |
| 590 | stat label | label | Total IOCs | HARDCODED |
| 591 | stat label | label | Brand Abuse | HARDCODED |
| 592 | stat label | label | MTTD | HARDCODED |
| 593 | stat label | label | MTTR | HARDCODED |

#### Co-located: `components/visus/cti/cti-risk-summary-widget.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 594 | empty CardTitle | modal-title | CTI Risk Summary | HARDCODED |
| 595 | empty CardDescription | body | Threat intelligence risk data is currently unavailable. | HARDCODED |
| 596 | CardTitle | heading | CTI Risk Summary | HARDCODED |
| 597 | CardDescription | subheading | Executive threat posture from the live CTI aggregation pipeline. | HARDCODED |
| 598 | risk-score label | label | Risk Score | HARDCODED |
| 599 | stat label | label | Events 24h | HARDCODED |
| 600 | stat label | label | MTTD | HARDCODED |
| 601 | stat label | label | MTTR | HARDCODED |
| 602 | view button | button | View Full CTI | HARDCODED |

#### Co-located: `components/visus/cti/cti-campaigns-widget.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 603 | CardTitle | heading | Active Campaigns | HARDCODED |
| 604 | CardDescription | subheading | Highest pressure campaigns requiring executive awareness. | HARDCODED |
| 605 | empty state | empty-state | No active campaigns are available. | HARDCODED |
| 606 | column header | table-header | Campaign | HARDCODED |
| 607 | column header | table-header | Actor | HARDCODED |
| 608 | column header | table-header | Severity | HARDCODED |
| 609 | column header | table-header | IOCs | HARDCODED |
| 610 | campaign subline | body | `{campaign_code} · Last seen {relTime}` | HARDCODED ("Last seen") + data-driven |
| 611 | actor fallback | body | Unassigned | HARDCODED |
| 612 | view-all button | button | View All | HARDCODED |

#### Co-located: `components/visus/cti/cti-brand-abuse-widget.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 613 | CardTitle | heading | Critical Brand Abuse | HARDCODED |
| 614 | CardDescription | subheading | Executive watchlist of active impersonation and phishing incidents. | HARDCODED |
| 615 | empty state | empty-state | No critical brand abuse incidents are active. | HARDCODED |
| 616 | incident subline | body | `{abuse_type} · {n} detections · {relTime}` | HARDCODED ("detections") + data-driven |
| 617 | view-all button | button | View All | HARDCODED |

#### Co-located: `components/visus/cti/cti-sector-chart-mini-widget.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 618 | CardTitle | heading | Sector Targeting | HARDCODED |
| 619 | CardDescription | subheading | Industries absorbing the highest CTI event volume. | HARDCODED |
| 620 | empty state | empty-state | No sector aggregation data is available. | HARDCODED |
| 621 | sector label | body | `sector.sector_label` | data-driven |
| 622 | view-details button | button | View Details | HARDCODED |

#### Co-located: `components/visus/cti/cti-threat-map-mini-widget.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 623 | CardTitle | heading | Threat Map | HARDCODED |
| 624 | CardDescription | subheading | Top ten global CTI hotspots over the last 24 hours. | HARDCODED |
| 625 | svg | aria-label | Mini CTI threat map | HARDCODED |
| 626 | empty state | empty-state | No hotspot data is available for this tenant yet. | HARDCODED |
| 627 | hotspot label | body | `{city}, {country_code}` | data-driven |
| 628 | expand button | button | Expand | HARDCODED |

#### `loading.tsx`
| # | Source | Type | English | Status |
|---|---|---|---|---|
| 629 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

### Route: /visus/dashboards — `visus/dashboards/page.tsx`
_Module bundle: `visus/_lib/visus-i18n.ts` (`list.dashboards`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 630 | DASHBOARD_FILTERS label | label | Visibility | HARDCODED |
| 631 | visibility option | option | Private | HARDCODED |
| 632 | visibility option | option | Team | HARDCODED |
| 633 | visibility option | option | Organization | HARDCODED |
| 634 | visibility option | option | Public | HARDCODED |
| 635 | toast (create) | toast | Dashboard created. | HARDCODED |
| 636 | toast (update) | toast | Dashboard updated. | HARDCODED |
| 637 | toast (share) | toast | Dashboard access updated. | HARDCODED |
| 638 | toast (duplicate) | toast | Dashboard duplicated. | HARDCODED |
| 639 | toast (delete) | toast | Dashboard deleted. | HARDCODED |
| 640 | column header | table-header | Dashboard | HARDCODED |
| 641 | default badge | badge | Default | HARDCODED |
| 642 | system badge | badge | System | HARDCODED |
| 643 | column header | table-header | Visibility | HARDCODED |
| 644 | visibility cell | badge | `row.visibility` | data-driven (raw) |
| 645 | column header | table-header | Widgets | HARDCODED |
| 646 | column header | table-header | Updated | HARDCODED |
| 647 | rowAction | link | Open | HARDCODED |
| 648 | rowAction | link | Edit | HARDCODED |
| 649 | rowAction | link | Share | HARDCODED |
| 650 | rowAction | link | Duplicate | HARDCODED |
| 651 | rowAction | link | Delete | HARDCODED |
| 652 | PageHeader.eyebrow | breadcrumb | Visus · Dashboards | key: visus.list.dashboards.eyebrow |
| 653 | PageHeader.title | heading | Dashboards | key: visus.list.dashboards.title |
| 654 | PageHeader.description | subheading | Author, duplicate, share, and maintain executive dashboard definitions. | key: visus.list.dashboards.description |
| 655 | tag | badge | `{count} dashboards` | key: visus.list.dashboards.tag (fn) |
| 656 | create button | button | Create Dashboard | key: visus.list.dashboards.create |
| 657 | DataTable search | placeholder | Search dashboards... | key: visus.list.dashboards.searchPlaceholder |
| 658 | DataTable empty.title | empty-state | No dashboards found | key: visus.list.dashboards.emptyTitle |
| 659 | DataTable empty.description | empty-state | Create an executive dashboard to start composing a reusable reporting surface. | key: visus.list.dashboards.emptyDescription |
| 660 | empty action | button | Create Dashboard | key: visus.list.dashboards.create |
| 661 | ConfirmDialog.title | modal-title | Delete Dashboard | HARDCODED |
| 662 | ConfirmDialog.description | modal-body | `Delete "{name}"? Widgets attached to this dashboard will no longer be accessible from Visus.` | HARDCODED |
| 663 | ConfirmDialog.confirmLabel | button | Delete Dashboard | HARDCODED |

#### Component: `_components/dashboard-form-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 664 | VISIBILITY_OPTIONS | option | Private / Team / Organization / Public | HARDCODED |
| 665 | metadata parse error | validation | Invalid JSON metadata. | HARDCODED |
| 666 | DialogTitle (edit/create) | modal-title | Edit Dashboard / Create Dashboard | HARDCODED |
| 667 | DialogDescription | modal-body | Configure dashboard visibility, default layout, and sharing using the Visus dashboard contract. | HARDCODED |
| 668 | FormField label | label | Name | HARDCODED |
| 669 | name input | placeholder | Executive weekly command center | HARDCODED |
| 670 | FormField label | label | Grid Columns | HARDCODED |
| 671 | FormField label | label | Description | HARDCODED |
| 672 | description textarea | placeholder | Summarize the operating view this dashboard supports. | HARDCODED |
| 673 | FormField label | label | Visibility | HARDCODED |
| 674 | visibility select | placeholder | Select visibility | HARDCODED |
| 675 | Label | label | Tags | HARDCODED |
| 676 | tags input | placeholder | board, weekly, executive | HARDCODED |
| 677 | tags helper | body | Comma-separated tags persisted as the dashboard tag array. | HARDCODED |
| 678 | Label | label | Shared With | HARDCODED |
| 679 | MultiSelect | placeholder | Select users with direct access | HARDCODED |
| 680 | is_default label | label | Set as the tenant default dashboard | HARDCODED |
| 681 | metadata Label | label | Metadata JSON | HARDCODED |
| 682 | metadata textarea | placeholder | `{"owner_team":"executive","cadence":"weekly"}` | HARDCODED |
| 683 | cancel button | button | Cancel | HARDCODED |
| 684 | submit button | button | Saving... / Save Changes / Create Dashboard | HARDCODED |

#### Component: `_components/dashboard-share-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 685 | DialogTitle | modal-title | Share Dashboard | HARDCODED |
| 686 | DialogDescription | modal-body | `Update access for {name ?? 'this dashboard'} using the dedicated share contract.` | HARDCODED (incl. "this dashboard") |
| 687 | Label | label | Visibility | HARDCODED |
| 688 | visibility select | placeholder | Select visibility | HARDCODED |
| 689 | visibility option | option | Private / Team / Organization / Public | HARDCODED |
| 690 | Label | label | Shared With | HARDCODED |
| 691 | MultiSelect | placeholder | Grant dashboard access to users | HARDCODED |
| 692 | cancel button | button | Cancel | HARDCODED |
| 693 | submit button | button | Saving... / Save Access | HARDCODED |

#### `loading.tsx`
| # | Source | Type | English | Status |
|---|---|---|---|---|
| 694 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

### Route: /visus/dashboards/[dashboardId] — `visus/dashboards/[dashboardId]/page.tsx`
_Module bundle: none consumed here (fully HARDCODED)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 695 | toast (create) | toast | Widget created. | HARDCODED |
| 696 | toast (update) | toast | Widget updated. | HARDCODED |
| 697 | toast (delete) | toast | Widget deleted. | HARDCODED |
| 698 | toast (arrange) | toast | Layout normalized. | HARDCODED |
| 699 | ErrorState.title | error | Unable to load dashboard | HARDCODED |
| 700 | ErrorState.message | error | The requested dashboard could not be loaded. | HARDCODED |
| 701 | back button | link | Back to dashboards | HARDCODED |
| 702 | view-mode group | aria-label | View mode | HARDCODED |
| 703 | view button | button | View | HARDCODED |
| 704 | edit button | button | Edit | HARDCODED |
| 705 | auto-arrange button (idle/pending) | button | Auto-arrange / Arranging... | HARDCODED |
| 706 | add-widget button | button | Add Widget | HARDCODED |
| 707 | DetailStatCard.label | label | Visibility | HARDCODED |
| 708 | visibility value | body | `dashboard.visibility` | data-driven (raw, capitalize CSS) |
| 709 | default badge | badge | Default | HARDCODED |
| 710 | system badge | badge | System | HARDCODED |
| 711 | DetailStatCard.label | label | Widgets | HARDCODED |
| 712 | widgets helper | body | `Grid columns: {n}` | HARDCODED ("Grid columns:") |
| 713 | DetailStatCard.label | label | Updated | HARDCODED |
| 714 | created helper | body | `Created {relTime}` | HARDCODED ("Created") |
| 715 | DetailStatCard.label | label | Tags | HARDCODED |
| 716 | tags empty | body | No tags | HARDCODED |
| 717 | EmptyState.title | empty-state | No widgets configured | HARDCODED |
| 718 | EmptyState.description | empty-state | Add widgets to make this dashboard useful to executive viewers. | HARDCODED |
| 719 | EmptyState action | button | Add Widget | HARDCODED |
| 720 | edit-mode widget type badge | badge | `widget.type.replace(/_/g,' ')` | data-driven (raw) |
| 721 | edit-mode meta | body | `{w}x{h}` / `{n}s refresh` | HARDCODED ("s refresh") |
| 722 | preview-data button | button | Preview Data | HARDCODED |
| 723 | edit button | button | Edit | HARDCODED |
| 724 | delete button | button | Delete | HARDCODED |
| 725 | ConfirmDialog.title | modal-title | Delete Widget | HARDCODED |
| 726 | ConfirmDialog.description | modal-body | `Delete "{title}" from this dashboard?` | HARDCODED |
| 727 | ConfirmDialog.confirmLabel | button | Delete Widget | HARDCODED |

#### Component: `[dashboardId]/_components/widget-form-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 728 | config parse error | validation | Invalid widget configuration JSON. | HARDCODED |
| 729 | DialogTitle (edit/create) | modal-title | Edit Widget / Add Widget | HARDCODED |
| 730 | DialogDescription | modal-body | Configure widget layout, data source hints, and refresh settings for this dashboard. | HARDCODED |
| 731 | FormField label | label | Title | HARDCODED |
| 732 | title input | placeholder | Executive KPI | HARDCODED |
| 733 | FormField label | label | Subtitle | HARDCODED |
| 734 | subtitle input | placeholder | Optional widget context | HARDCODED |
| 735 | FormField label | label | Widget Type | HARDCODED |
| 736 | widget-type FormField description | body | Widget type is immutable after creation. | HARDCODED |
| 737 | widget-type select | placeholder | Select widget type | HARDCODED |
| 738 | widget-type option | option | `item.type.replace(/_/g,' ')` | data-driven (visus.listWidgetTypes) |
| 739 | FormField label | label | Refresh Interval (seconds) | HARDCODED |
| 740 | FormField label | label | X / Y / Width / Height | HARDCODED |
| 741 | Label | label | Linked KPI | HARDCODED |
| 742 | kpi select | placeholder | Select KPI | HARDCODED |
| 743 | Label | label | Content | HARDCODED |
| 744 | content textarea | placeholder | Write an executive note or operational annotation. | HARDCODED |
| 745 | Label | label | Config JSON | HARDCODED |
| 746 | config textarea | placeholder | `{"kpi_id":"uuid"}` | HARDCODED |
| 747 | schema-hint heading | label | Type Schema Hint | HARDCODED |
| 748 | schema-hint body | body | `Backend-declared schema for {type}.` | HARDCODED ("Backend-declared schema for") |
| 749 | cancel button | button | Cancel | HARDCODED |
| 750 | submit button | button | Saving... / Save Widget / Create Widget | HARDCODED |

#### Component: `[dashboardId]/_components/widget-preview-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 751 | DialogTitle | modal-title | `{widget?.title ?? 'Widget preview'}` | HARDCODED ("Widget preview") + data-driven |
| 752 | DialogDescription | modal-body | Live data payload returned by the widget endpoint. | HARDCODED |
| 753 | loading | body | Loading widget data... | HARDCODED |
| 754 | error | error | Unable to load widget data. | HARDCODED |
| 755 | DetailStatCard.label | label | Value | HARDCODED |
| 756 | DetailStatCard.label | label | Status | HARDCODED |
| 757 | DetailStatCard.label | label | Delta % | HARDCODED |
| 758 | section heading | label | Alert Feed | HARDCODED |
| 759 | section heading | label | Table Preview | HARDCODED |
| 760 | section heading | label | Status Items | HARDCODED |
| 761 | section heading | label | Raw Payload | HARDCODED |
| 762 | table headers / alert fields | data-driven | column.label / alert.title / alert.severity / item.label | data-driven (widget data endpoint) |

#### `_widgets/widget-renderer.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 763 | unsupported fallback | body | `Unsupported widget type: {type}` | HARDCODED ("Unsupported widget type:") |

#### `_widgets/widget-shell.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 764 | actions trigger | aria-label | `Actions for {widget.title}` | HARDCODED ("Actions for") |
| 765 | menu item | link | View raw data | HARDCODED |
| 766 | menu item | link | Edit widget | HARDCODED |
| 767 | menu item | link | Delete | HARDCODED |
| 768 | type badge | badge | `widget.type.replace(/_/g,' ')` | data-driven (raw) |

#### `_widgets/kpi-widgets.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 769 | Sparkline default | aria-label | Trend sparkline | HARDCODED |
| 770 | WidgetError | body | Couldn't load data. | HARDCODED |
| 771 | WidgetError retry | button | Retry | HARDCODED |
| 772 | WidgetEmpty default | empty-state | No data yet. | HARDCODED |
| 773 | KpiCard empty | empty-state | No measurement yet. | HARDCODED |
| 774 | KpiCard delta | aria-label | `Change {pct}` | HARDCODED ("Change") |
| 775 | KpiCard sparkline | aria-label | KPI trend | HARDCODED |
| 776 | KpiCard target | body | `Target: {value}{unit}` | HARDCODED ("Target:") |
| 777 | TrendIndicator empty | empty-state | No trend recorded. | HARDCODED |
| 778 | TrendIndicator arrow | aria-label | `Trending {direction}` | HARDCODED ("Trending") |
| 779 | TrendIndicator suffix | body | vs previous | HARDCODED |
| 780 | Sparkline empty | empty-state | No samples yet. | HARDCODED |
| 781 | Sparkline arrow | aria-label | `Trending {direction}` | HARDCODED ("Trending") |
| 782 | Sparkline body | aria-label | Value sparkline | HARDCODED |

#### `_widgets/gauge-widget.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 783 | STATUS_LABEL | label | Normal / Warning / Critical / Unknown | HARDCODED |
| 784 | error body | error | Couldn't load gauge data. | HARDCODED |
| 785 | retry button | button | Retry | HARDCODED |
| 786 | no-data body | empty-state | No data available. | HARDCODED |
| 787 | status prefix | label | Status: | HARDCODED |

#### `_widgets/series-chart-widget.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 788 | EMPTY_MESSAGE | empty-state | No data to display | HARDCODED |
| 789 | error body | error | Couldn't load this chart. | HARDCODED |
| 790 | retry button | button | Retry | HARDCODED |

#### `_widgets/distribution-widgets.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 791 | WidgetError body | error | Couldn't load this widget. | HARDCODED |
| 792 | WidgetError retry | button | Retry | HARDCODED |
| 793 | PieChart center | label | Total | HARDCODED |
| 794 | PieChart empty | empty-state | No data to display | HARDCODED |
| 795 | Heatmap grid | aria-label | Heatmap | HARDCODED |
| 796 | Heatmap empty | empty-state | No data to display | HARDCODED |
| 797 | Heatmap cell | aria-label | `{y}, {x}: {value}` / `{y}, {x}: no data` | HARDCODED ("no data") + data-driven |

#### `_widgets/feed-widgets.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 798 | AlertFeed error | error | Unable to load alerts. | HARDCODED |
| 799 | AlertFeed empty | empty-state | No active alerts | HARDCODED |
| 800 | alert occurrence | aria-label | `{n} occurrences` | HARDCODED ("occurrences") |
| 801 | alert severity | body | `{severity} severity` | HARDCODED ("severity") + data-driven |
| 802 | StatusGrid error | error | Unable to load status. | HARDCODED |
| 803 | StatusGrid empty | empty-state | No status metrics | HARDCODED |
| 804 | status tile | aria-label | `Status: {status}` | HARDCODED ("Status:") + data-driven |
| 805 | ErrorState/EmptyState retry | button | Retry | HARDCODED |

#### `_widgets/table-text-widgets.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 806 | boolean cell | body | true / false | HARDCODED (data render) |
| 807 | ErrorState retry | button | Retry | HARDCODED |
| 808 | Table error | error | Unable to load table data. | HARDCODED |
| 809 | Table no-data | empty-state | No data | HARDCODED |
| 810 | Table no-rows | empty-state | No rows | HARDCODED |
| 811 | table footer | body | `Showing {n} of {total}` | HARDCODED ("Showing ... of") |
| 812 | Text error | error | Unable to load text content. | HARDCODED |
| 813 | Text no-content | empty-state | No content | HARDCODED |
| 814 | table headers | table-header | `column.label` | data-driven (widget data endpoint) |

_Note: `use-widget-data.ts` and `widget-body-props.ts` contain no user-facing strings._

---

### Route: /visus/reports — `visus/reports/page.tsx`
_Module bundle: `visus/_lib/visus-i18n.ts` (`list.reports`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 815 | REPORT_FILTERS label | label | Type | HARDCODED |
| 816 | report_type option | option | Executive Summary | HARDCODED |
| 817 | report_type option | option | Security Posture | HARDCODED |
| 818 | report_type option | option | Data Intelligence | HARDCODED |
| 819 | report_type option | option | Governance | HARDCODED |
| 820 | report_type option | option | Legal | HARDCODED |
| 821 | report_type option | option | Custom | HARDCODED |
| 822 | REPORT_FILTERS label | label | Auto Send | HARDCODED |
| 823 | auto_send option | option | Enabled | HARDCODED |
| 824 | auto_send option | option | Disabled | HARDCODED |
| 825 | toast (create) | toast | Report created. | HARDCODED |
| 826 | toast (update) | toast | Report updated. | HARDCODED |
| 827 | toast (delete) | toast | Report deleted. | HARDCODED |
| 828 | toast (generate) | toast | Report generation started. | HARDCODED |
| 829 | toast (generate body) | toast | `Snapshot {id} queued for {name}.` | HARDCODED ("Snapshot ... queued for") |
| 830 | rowAction | link | View snapshots | HARDCODED |
| 831 | rowAction | link | Edit | HARDCODED |
| 832 | rowAction | link | Delete | HARDCODED |
| 833 | column header | table-header | Report | HARDCODED |
| 834 | report type subline | body | `report_type.replace(/_/g,' ')` (fallback 'custom') | data-driven (raw) |
| 835 | column header | table-header | Schedule | HARDCODED |
| 836 | schedule fallback | body | On demand | HARDCODED |
| 837 | column header | table-header | Last Generated | HARDCODED |
| 838 | last-generated fallback | body | Never | HARDCODED |
| 839 | column header | table-header | Generations | HARDCODED |
| 840 | generate button (idle/pending) | button | Generate / Generating... | HARDCODED |
| 841 | PageHeader.eyebrow | breadcrumb | Visus · Reports | key: visus.list.reports.eyebrow |
| 842 | PageHeader.title | heading | Reports | key: visus.list.reports.title |
| 843 | PageHeader.description | subheading | Executive report definitions, delivery schedules, and historical output snapshots. | key: visus.list.reports.description |
| 844 | tag | badge | `{count} reports` | key: visus.list.reports.tag (fn) |
| 845 | create button | button | Create Report | key: visus.list.reports.create |
| 846 | DataTable empty.title | empty-state | No reports found | key: visus.list.reports.emptyTitle |
| 847 | DataTable empty.description | empty-state | No executive reports are configured for this tenant. | key: visus.list.reports.emptyDescription |
| 848 | ConfirmDialog.title | modal-title | Delete Report | HARDCODED |
| 849 | ConfirmDialog.description | modal-body | `Delete "{name}"? Existing snapshots remain historical records, but future generation for this definition will stop.` | HARDCODED |
| 850 | ConfirmDialog.confirmLabel | button | Delete Report | HARDCODED |

#### Component: `_components/report-form-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 851 | DialogTitle (edit/create) | modal-title | Edit Report / Create Report | HARDCODED |
| 852 | DialogDescription | modal-body | Configure reusable executive report definitions, schedules, and recipients. | HARDCODED |
| 853 | FormField label | label | Name | HARDCODED |
| 854 | name input | placeholder | Weekly board briefing | HARDCODED |
| 855 | FormField label | label | Report Type | HARDCODED |
| 856 | report_type select | placeholder | Report type | HARDCODED |
| 857 | report_type option | option | `item.replace(/_/g,' ')` (executive_summary / security_posture / data_intelligence / governance / legal / custom) | HARDCODED (raw enum values) |
| 858 | FormField label | label | Description | HARDCODED |
| 859 | description textarea | placeholder | Describe the audience and purpose of this report. | HARDCODED |
| 860 | FormField label | label | Reporting Period | HARDCODED |
| 861 | period select | placeholder | Select period | HARDCODED |
| 862 | period option | option | 7d / 14d / 30d / 90d / quarterly / annual / custom | HARDCODED (raw values) |
| 863 | FormField label | label | Schedule | HARDCODED |
| 864 | schedule input | placeholder | 0 7 * * MON | HARDCODED |
| 865 | FormField label | label | Custom Period Start | HARDCODED |
| 866 | FormField label | label | Custom Period End | HARDCODED |
| 867 | Label | label | Sections | HARDCODED |
| 868 | sections input | placeholder | summary, risks, posture, trends | HARDCODED |
| 869 | sections helper | body | Comma-separated report sections. The backend requires at least one section. | HARDCODED |
| 870 | Label | label | Recipients | HARDCODED |
| 871 | MultiSelect | placeholder | Select report recipients | HARDCODED |
| 872 | auto_send label | label | Automatically send this report when generated on schedule | HARDCODED |
| 873 | cancel button | button | Cancel | HARDCODED |
| 874 | submit button | button | Saving... / Save Report / Create Report | HARDCODED |

#### Component: `_components/report-snapshots-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 875 | DialogTitle | modal-title | Report Snapshots | HARDCODED |
| 876 | DialogDescription | modal-body | Browse historical outputs generated for this report definition. | HARDCODED |
| 877 | loading | body | Loading snapshots... | HARDCODED |
| 878 | error | error | Failed to load snapshots. | HARDCODED |
| 879 | snapshot list item | body | `Snapshot {id}` | HARDCODED ("Snapshot") |
| 880 | empty state | empty-state | No snapshots have been generated yet. | HARDCODED |
| 881 | DetailStatCard.label | label | Generated | HARDCODED |
| 882 | DetailStatCard.label | label | Period | HARDCODED |
| 883 | DetailStatCard.label | label | Generation Time | HARDCODED |
| 884 | generation-time value | body | `{n} ms` (fallback 'n/a') | HARDCODED ("n/a" / "ms") |
| 885 | sections heading | label | Sections | HARDCODED |
| 886 | section badge | badge | `section.replace(/_/g,' ')` | data-driven |
| 887 | payload heading | label | Report Payload | HARDCODED |

#### Component: `_components/snapshot-preview-dialog.tsx`
_(Defined but not currently imported by any /visus route page — dormant. Included for completeness.)_
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 888 | DialogTitle | modal-title | Latest Snapshot | HARDCODED |
| 889 | DialogDescription | modal-body | Most recent report generation output. | HARDCODED |
| 890 | loading | body | Loading snapshot... | HARDCODED |
| 891 | error | error | Failed to load snapshot. | HARDCODED |
| 892 | field label | label | Period | HARDCODED |
| 893 | field label | label | Generated | HARDCODED |
| 894 | field label | label | Generation Time | HARDCODED |
| 895 | field label | label | Format | HARDCODED |
| 896 | field label | label | Sections | HARDCODED |
| 897 | field label | label | Narrative | HARDCODED |

#### `loading.tsx`
| # | Source | Type | English | Status |
|---|---|---|---|---|
| 898 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

### Route: /visus/kpis — `visus/kpis/page.tsx`
_Module bundle: `visus/_lib/visus-i18n.ts` (`list.kpis`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 899 | KPI_FILTERS label | label | Suite | HARDCODED |
| 900 | suite option | option | Cyber / Data / Acta / Lex / Platform / Custom | HARDCODED |
| 901 | KPI_FILTERS label | label | Enabled | HARDCODED |
| 902 | enabled option | option | Enabled / Disabled | HARDCODED |
| 903 | toast (create) | toast | KPI created. | HARDCODED |
| 904 | toast (update) | toast | KPI updated. | HARDCODED |
| 905 | toast (delete) | toast | KPI deleted. | HARDCODED |
| 906 | toast (snapshot) | toast | Snapshot refresh started. | HARDCODED |
| 907 | column header | table-header | KPI | HARDCODED |
| 908 | column header | table-header | Suite | HARDCODED |
| 909 | column header | table-header | Latest | HARDCODED |
| 910 | latest fallback | body | — | HARDCODED (em-dash) |
| 911 | column header | table-header | Status | HARDCODED |
| 912 | status cell fallback | badge | unknown | HARDCODED |
| 913 | rowAction | link | Edit | HARDCODED |
| 914 | rowAction | link | Delete | HARDCODED |
| 915 | PageHeader.eyebrow | breadcrumb | Visus · KPIs | key: visus.list.kpis.eyebrow |
| 916 | PageHeader.title | heading | KPIs | key: visus.list.kpis.title |
| 917 | PageHeader.description | subheading | Executive KPI catalogue, thresholds, and collection configuration. | key: visus.list.kpis.description |
| 918 | tag | badge | `{count} KPIs` | key: visus.list.kpis.tag (fn) |
| 919 | snapshot button (idle) | button | Run Snapshot Refresh | key: visus.list.kpis.runSnapshot |
| 920 | snapshot button (pending) | button | Refreshing... | key: visus.list.kpis.refreshing |
| 921 | create button | button | Create KPI | key: visus.list.kpis.create |
| 922 | DataTable empty.title | empty-state | No KPIs found | key: visus.list.kpis.emptyTitle |
| 923 | DataTable empty.description | empty-state | No KPI definitions are configured for this tenant. | key: visus.list.kpis.emptyDescription |
| 924 | SectionCard.title fallback | heading | KPI detail | HARDCODED |
| 925 | SectionCard.description fallback | subheading | Select a KPI to inspect its latest history. | HARDCODED |
| 926 | KpiCard.title | label | Latest Value | HARDCODED |
| 927 | KpiCard.title | label | Target | HARDCODED |
| 928 | Target fallback | body | — | HARDCODED (em-dash) |
| 929 | history heading | label | History | HARDCODED |
| 930 | LineChart empty | empty-state | No snapshot history yet | HARDCODED |
| 931 | no-definition fallback | body | Select a KPI to inspect its current status. | HARDCODED |
| 932 | ConfirmDialog.title | modal-title | Delete KPI | HARDCODED |
| 933 | ConfirmDialog.description | modal-body | `Delete "{name}"? Historical snapshots will remain, but the KPI definition will no longer be available for widgets or executive rollups.` | HARDCODED |
| 934 | ConfirmDialog.confirmLabel | button | Delete KPI | HARDCODED |

#### Component: `_components/kpi-form-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 935 | query_params parse error | validation | Invalid query params JSON. | HARDCODED |
| 936 | DialogTitle (edit/create) | modal-title | Edit KPI / Create KPI | HARDCODED |
| 937 | DialogDescription | modal-body | Register an executive KPI definition backed by a live endpoint and value path. | HARDCODED |
| 938 | FormField label | label | Name | HARDCODED |
| 939 | name input | placeholder | Mean time to remediation | HARDCODED |
| 940 | FormField label | label | Icon | HARDCODED |
| 941 | icon input | placeholder | shield-check | HARDCODED |
| 942 | FormField label | label | Description | HARDCODED |
| 943 | description textarea | placeholder | Executive summary of what this KPI measures. | HARDCODED |
| 944 | FormField label | label | Category | HARDCODED |
| 945 | category select | placeholder | Category | HARDCODED |
| 946 | category option | option | security / data / governance / legal / operations / general | HARDCODED (raw enum values) |
| 947 | FormField label | label | Suite | HARDCODED |
| 948 | suite select | placeholder | Suite | HARDCODED |
| 949 | suite option | option | cyber / data / acta / lex / platform / custom | HARDCODED (raw enum values) |
| 950 | FormField label | label | Unit | HARDCODED |
| 951 | unit select | placeholder | Unit | HARDCODED |
| 952 | unit option | option | count / percentage / hours / minutes / score / currency / ratio / bytes | HARDCODED (raw enum values) |
| 953 | FormField label | label | Query Endpoint | HARDCODED |
| 954 | query_endpoint input | placeholder | /api/v1/cyber/remediation/stats | HARDCODED |
| 955 | FormField label | label | Value Path | HARDCODED |
| 956 | value_path input | placeholder | summary.avg_mttr_hours | HARDCODED |
| 957 | FormField label | label | Direction | HARDCODED |
| 958 | direction select | placeholder | Direction | HARDCODED |
| 959 | direction option | option | higher_is_better / lower_is_better | HARDCODED (raw values) |
| 960 | FormField label | label | Calculation | HARDCODED |
| 961 | calculation select | placeholder | Calculation | HARDCODED |
| 962 | calculation option | option | direct / delta / percentage_change / average_over_period / sum_over_period | HARDCODED (raw values) |
| 963 | FormField label | label | Snapshot Frequency | HARDCODED |
| 964 | frequency select | placeholder | Frequency | HARDCODED |
| 965 | frequency option | option | every_15m / hourly / every_4h / daily / weekly | HARDCODED (raw values) |
| 966 | FormField label | label | Target Value | HARDCODED |
| 967 | FormField label | label | Warning Threshold | HARDCODED |
| 968 | FormField label | label | Critical Threshold | HARDCODED |
| 969 | FormField label | label | Format Pattern | HARDCODED |
| 970 | format_pattern input | placeholder | 0.0% | HARDCODED |
| 971 | FormField label | label | Calculation Window | HARDCODED |
| 972 | calculation_window input | placeholder | 30d | HARDCODED |
| 973 | Label | label | Tags | HARDCODED |
| 974 | tags input | placeholder | executive, remediation, cyber | HARDCODED |
| 975 | enabled label | label | Enabled | HARDCODED |
| 976 | Label | label | Query Params JSON | HARDCODED |
| 977 | query_params textarea | placeholder | `{"status":"open","window":"30d"}` | HARDCODED |
| 978 | cancel button | button | Cancel | HARDCODED |
| 979 | submit button | button | Saving... / Save KPI / Create KPI | HARDCODED |

#### `loading.tsx`
| # | Source | Type | English | Status |
|---|---|---|---|---|
| 980 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

### Route: /visus/alerts — `visus/alerts/page.tsx`
_Module bundle: `visus/_lib/visus-i18n.ts` (`list.alerts`)_

| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 981 | ALERT_FILTERS label | label | Severity | HARDCODED |
| 982 | severity option | option | Critical / High / Medium / Low / Info | HARDCODED |
| 983 | ALERT_FILTERS label | label | Status | HARDCODED |
| 984 | status option | option | New / Viewed / Acknowledged / Actioned / Dismissed / Escalated | HARDCODED |
| 985 | ALERT_FILTERS label | label | Category | HARDCODED |
| 986 | category option | option | Risk / Compliance / Data Quality / Governance / Legal / Operational / Financial / Strategic | HARDCODED |
| 987 | toast (update) | toast | Alert updated. | HARDCODED |
| 988 | column header | table-header | Alert | HARDCODED |
| 989 | severity cell | badge | `row.severity` | data-driven (raw) |
| 990 | column header | table-header | Severity | HARDCODED |
| 991 | category cell | badge | `row.category` | data-driven (raw) |
| 992 | column header | table-header | Category | HARDCODED |
| 993 | status cell | badge | `row.status` | data-driven (raw) |
| 994 | column header | table-header | Status | HARDCODED |
| 995 | column header | table-header | Created | HARDCODED |
| 996 | acknowledge button | button | Acknowledge | HARDCODED |
| 997 | dismiss button | button | Dismiss | HARDCODED |
| 998 | PageHeader.eyebrow | breadcrumb | Visus · Alerts | key: visus.list.alerts.eyebrow |
| 999 | PageHeader.title | heading | Alerts | key: visus.list.alerts.title |
| 1000 | PageHeader.description | subheading | Executive alerts aggregated across all suites. | key: visus.list.alerts.description |
| 1001 | tag | badge | `{count} total` | key: visus.list.alerts.tag (fn) |
| 1002 | StatCard label (per severity) | label | `severity` | data-driven (statsQuery.by_severity keys, raw) |
| 1003 | DataTable search | placeholder | Search alerts... | key: visus.list.alerts.searchPlaceholder |
| 1004 | DataTable empty.title | empty-state | No alerts | key: visus.list.alerts.emptyTitle |
| 1005 | DataTable empty.description | empty-state | No executive alerts are currently open. | key: visus.list.alerts.emptyDescription |

#### Component: `_components/dismiss-alert-dialog.tsx`
| # | Source (component › element) | Type | English (verbatim) | Status |
|---|---|---|---|---|
| 1006 | AlertDialogTitle | modal-title | Dismiss Alert | HARDCODED |
| 1007 | AlertDialogDescription (has alert) | modal-body | `Dismiss "{title}"? This will remove it from the active alerts view.` | HARDCODED |
| 1008 | AlertDialogDescription (fallback) | modal-body | Dismiss this alert? | HARDCODED |
| 1009 | reason Label | label | Reason (optional) | HARDCODED |
| 1010 | reason textarea | placeholder | Why is this alert being dismissed? | HARDCODED |
| 1011 | cancel button | button | Cancel | HARDCODED |
| 1012 | confirm button | button | Dismiss | HARDCODED |

#### `loading.tsx`
| # | Source | Type | English | Status |
|---|---|---|---|---|
| 1013 | loading.tsx | — | (PageLoader skeleton, no text) | n/a |

---

## Coverage

### Routes covered (13 route segments)
ACTA (7): `/acta`, `/acta/meetings`, `/acta/meetings/[id]`, `/acta/committees`, `/acta/committees/[id]`, `/acta/action-items`, `/acta/compliance`.
VISUS (6): `/visus`, `/visus/dashboards`, `/visus/dashboards/[dashboardId]`, `/visus/reports`, `/visus/kpis`, `/visus/alerts`.

All `page.tsx`, `_components/**`, `_widgets/**`, `_lib/**`, `loading.tsx`, and `error.tsx` files in scope were opened and read in full, plus the co-located `components/visus/cti/*` section (7 files) rendered on the Visus landing page.

### Approximate string count
~1013 enumerated user-facing rows (excluding the ~14 "no text" loading/skeleton rows). Breakdown:
- **Keyed (already resolve through i18n bundle, Arabic present):** ~150 rows — the ACTA landing/dashboard + its 5 widgets, ACTA meetings/committees/action-items **list headers** only, and almost the entire VISUS **landing + all four list-page headers** (eyebrow/title/description/tag/create/empty/search/toasts-partial). Every keyed row already ships full MSA Arabic in `acta-i18n.ts` / `visus-i18n.ts`.
- **HARDCODED (needs extraction + translation):** ~800 rows — the bulk of the work. Concentrated in: every ACTA detail page and dialog (`meetings/[id]/*` fully hardcoded, `committees/[id]/*`, `compliance`), every ACTA form dialog (schedule/edit/create committee/member-mgmt/create-action/complete/extend), all ACTA table `columns` files, `meeting-filters`; on VISUS side — every dialog (dashboard/share/report/kpi/widget form + snapshots/dismiss), every DataTable `columns`/`rowActions`/`FilterConfig`, all toasts, the entire `[dashboardId]` detail page + widget bodies (`_widgets/*`), and the entire co-located CTI section.
- **data-driven (needs BACKEND localization — see below):** ~60 rows.

### Backend / data-driven items to localize separately
These render API/seed values verbatim and cannot be fixed in the frontend bundle:
- ACTA: `committee_name`, `meeting.title`, `meeting.location`, `assignee_name`, `item.title/description`, `check_name/description/finding`, `by_status` keys, agenda `status`/`category`, minutes `status`, action `priority`/`status` raw enums, `member_role` — sources: `enterpriseApi.acta.*` (getDashboard, getCalendar, listMeetings, getMeeting, listAgenda, getMinutes, listActionItems, getComplianceReport, listComplianceResults, committees).
- VISUS: `dashboard.name/description/visibility`, `report.name/report_type`, `kpi.name/description/suite/last_status`, `alert.title/description/severity/category/status`, widget `type`, widget-data payload fields (`column.label`, alert fields, status items, sector labels, hotspot city/country), `suite_health` keys — sources: `enterpriseApi.visus.*` and `enterpriseApi.visus.getWidgetData`.
- CTI section: `campaign.name/actor_name`, `incident.brand_name/abuse_type`, `sector.sector_label`, hotspot `city/country_code` — source: `useVisusCTIWidgets` hook (cyber CTI bridge).

### Shared components referenced but OUT of this scope (flag for their own pass)
- `src/lib/status-configs.ts` — `meetingStatusConfig`, `committeeStatusConfig`, `actionItemStatusConfig`, `complianceStatusConfig` supply `StatusBadge` label text (ACTA/VISUS rely on these for status labels). Not keyed here; needs its own extraction.
- `src/components/common/route-error.tsx` — receives `segment="ACTA"` / `segment="Visus"` (rows 54, 569); the surrounding error copy lives in that shared component.
- Shared form/table primitives that emit their own copy (`DataTable` pagination/loading, `EmptyState` defaults, `FormField` required-marker, `MultiSelect`, `FileUpload`, `ConfirmDialog` default labels, `page-loader`) — text originates outside the ACTA/VISUS trees.
- `src/lib/enterprise/*` — thrown `Error` messages surfaced via `showApiError` (e.g. `form-utils.ts` "JSON configuration must be an object.", `agendaVoteSummary`, `calculateVoteOutcome().label`) are computed in the enterprise lib, not the route tree.
- `CTISeverityBadge` (`src/components/cyber/cti/severity-badge`) — rendered inside CTI campaign/brand-abuse widgets; label text lives in the cyber tree.

### Files that could not be fully read
None. Every in-scope file was read completely.
