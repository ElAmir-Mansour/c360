"use client";

import { useState } from "react";

import {
  LegalDirectorDashboardView,
  type LegalDirectorDashboardViewProps,
  type LegalDirectorKpiStrip,
} from "@/app/(dashboard)/lex/_components/role-dashboard/legal-director-dashboard-view";
import type { LegalCalendarEvent } from "@/app/(dashboard)/lex/calendar/_lib/calendar-events";
import type { DomainTile } from "@/app/(dashboard)/lex/_components/role-dashboard/widgets/domain-tile";
import type {
  WorkforceMetricValue,
  WorkforceReport,
} from "@/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-contract";
import { useLegalDirectorDashboardLabels } from "@/app/(dashboard)/lex/_lib/role-dashboards/legal-director-i18n";
import { LocaleProvider } from "@/components/providers/locale-provider";
import type { AppDirection, AppLocale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n/messages";
import { useLexFormat } from "@/lib/lex/ksa";

type DashboardSpecimenState =
  "ready" | "loading" | "empty" | "error" | "zero" | "partial" | "overflow";

const DEV_COPY = {
  locales: {
    en: "English · LTR",
    ar: "العربية · من اليمين إلى اليسار",
  },
  states: {
    ready: {
      label: "Ready",
      description:
        "Populated composition; Active Consultations remains loading while Q1 is unresolved.",
    },
    loading: {
      label: "Loading",
      description:
        "All six KPI positions and every approved panel are loading.",
    },
    empty: {
      label: "Empty",
      description:
        "Every approved panel is empty; the KPI contract has no empty variant.",
    },
    error: {
      label: "Error with retry",
      description:
        "Each approved panel displays its retry-capable presentation state; retries share the dev-only counter.",
    },
    zero: {
      label: "Zero",
      description:
        "Numeric zero is rendered as ready data and remains distinct from empty.",
    },
    partial: {
      label: "Partial",
      description: "Only a subset of each approved collection is present.",
    },
    overflow: {
      label: "Overflow",
      description:
        "Long labels, long names, large counts, and out-of-range rates remain contained.",
    },
  },
  retryCount: (count: number) => `Step 5 retry interactions: ${count}`,
  longCategory: {
    en: "A deliberately long legal category label that must wrap without escaping its chart column",
    ar: "تسمية طويلة عمدًا لفئة قانونية يجب أن تلتف من دون أن تتجاوز عمود الرسم البياني",
  },
  people: {
    en: {
      firstName: "Mohammed",
      lastName: "Almoqhem",
      member: "Layla Al-Hashimi",
      title: "Senior Legal Counsel",
      overflowName:
        "A legal team member with an intentionally long display name for containment testing",
      overflowTitle:
        "Senior legal counsel for complex international regulatory and cross-border commercial matters",
    },
    ar: {
      firstName: "محمد",
      lastName: "المقيم",
      member: "ليلى الهاشمي",
      title: "مستشارة قانونية أولى",
      overflowName:
        "عضو في الفريق القانوني باسم عرض طويل عمدًا لاختبار احتواء النص",
      overflowTitle:
        "مستشارة قانونية أولى للقضايا التنظيمية الدولية والتجارية العابرة للحدود والمعقدة",
    },
  },
} as const;

const SPECIMEN_STATES: DashboardSpecimenState[] = [
  "ready",
  "loading",
  "empty",
  "error",
  "zero",
  "partial",
  "overflow",
];

const LOCALES: { locale: AppLocale; direction: AppDirection }[] = [
  { locale: "en", direction: "ltr" },
  { locale: "ar", direction: "rtl" },
];

/** Stable specimen "now" so the calendar band renders deterministically. */
const GALLERY_NOW = new Date("2026-08-01T09:00:00.000Z");

const measure = (value: number): WorkforceMetricValue => ({ value, available: true });
const UNMEASURED: WorkforceMetricValue = {
  value: null,
  available: false,
  reason: "aggregation_not_implemented",
};

const DOMAIN_DEFINITIONS = [
  {
    key: "litigation_cases",
    labelKey: "litigation_cases",
    href: "/lex/cases",
  },
  {
    key: "service_desk",
    labelKey: "service_desk",
    href: "/lex/service-desk",
  },
  { key: "matters", labelKey: "matters", href: "/lex/matters" },
  {
    key: "consultations",
    labelKey: "consultations",
    href: "/lex/consultations",
  },
  {
    key: "investigations",
    labelKey: "investigations",
    href: "/lex/investigations",
  },
  {
    key: "settlements",
    labelKey: "settlements",
    href: "/lex/settlements",
  },
  {
    key: "contracts",
    labelKey: "contracts",
    href: "/lex/contracts",
  },
  {
    key: "obligations",
    labelKey: "obligations",
    href: "/lex/obligations",
  },
  {
    key: "documents",
    labelKey: "documents",
    href: "/lex/documents",
  },
  {
    key: "clause_library",
    labelKey: "clause_library",
    href: "/lex/clause-library",
  },
  {
    key: "playbooks",
    labelKey: "playbooks",
    href: "/lex/playbooks",
  },
  {
    key: "regulations",
    labelKey: "regulations",
    href: "/lex/regulations",
  },
  {
    key: "signatures",
    labelKey: "signatures",
    href: "/lex/signatures",
  },
  {
    key: "workflow_policies",
    labelKey: "workflow_policies",
    href: "/lex/workflow-policies",
  },
  {
    key: "compliance",
    labelKey: "compliance",
    href: "/lex/compliance",
  },
  {
    key: "drafting",
    labelKey: "drafting",
    href: "/lex/drafting",
  },
  { key: "reports", labelKey: "reports", href: "/lex/reports" },
  {
    key: "admin",
    labelKey: "admin",
    href: "/lex/admin",
  },
] as const;

function kpiStrip(
  labels: ReturnType<typeof useLegalDirectorDashboardLabels>,
  state: DashboardSpecimenState,
): LegalDirectorKpiStrip {
  const tones = ["slate", "cyan", "olive", "green", "ink", "blue"] as const;
  const names = [
    labels.kpis.sla,
    labels.kpis.complianceScore,
    labels.kpis.activeCases,
    labels.kpis.activeInvestigations,
    labels.kpis.activeContracts,
    labels.kpis.activeConsultations,
  ] as const;

  if (state === "loading") {
    return [
      { state: "loading", props: { label: names[0], tone: tones[0] } },
      { state: "loading", props: { label: names[1], tone: tones[1] } },
      { state: "loading", props: { label: names[2], tone: tones[2] } },
      { state: "loading", props: { label: names[3], tone: tones[3] } },
      { state: "loading", props: { label: names[4], tone: tones[4] } },
      { state: "loading", props: { label: names[5], tone: tones[5] } },
    ];
  }

  const values =
    state === "zero"
      ? ([0, 0, 0, 0, 0] as const)
      : state === "overflow"
        ? ([100, 100, 987654321, 76543210, 54321098] as const)
        : ([90, 99, 33, 8, 45] as const);

  return [
    {
      state: "ready",
      props: {
        label: names[0],
        value: values[0],
        format: "percent",
        tone: tones[0],
        href: "/lex/service-desk/sla-board",
      },
    },
    {
      state: "ready",
      props: {
        label: names[1],
        value: values[1],
        format: "percent",
        tone: tones[1],
        href: "/lex/compliance",
      },
    },
    {
      state: "ready",
      props: {
        label: names[2],
        value: values[2],
        format: "count",
        tone: tones[2],
        href: "/lex/cases",
      },
    },
    {
      state: "ready",
      props: {
        label: names[3],
        value: values[3],
        format: "count",
        tone: tones[3],
        href: "/lex/investigations",
      },
    },
    {
      state: "ready",
      props: {
        label: names[4],
        value: values[4],
        format: "count",
        tone: tones[4],
        href: "/lex/contracts",
      },
    },
    // WLS §6-Q1 remains unresolved, so the gallery does not assign a count or
    // percent format to Active Consultations even in otherwise-ready specimens.
    { state: "loading", props: { label: names[5], tone: tones[5] } },
  ];
}

function LocaleDashboardGallery({
  locale,
  onRetry,
}: {
  locale: AppLocale;
  onRetry: () => void;
}) {
  const labels = useLegalDirectorDashboardLabels();
  const format = useLexFormat();
  const people = DEV_COPY.people[locale];

  const domains = DOMAIN_DEFINITIONS.map<DomainTile>((domain, index) => ({
    key: domain.key,
    label: labels.domains[domain.labelKey],
    count:
      domain.key === "drafting" ||
      domain.key === "reports" ||
      domain.key === "admin"
        ? null
        : index + 1,
    href: domain.href,
  }));

  const serviceSegments = [
    {
      key: "contracts" as const,
      label: labels.serviceRequestCategories.contracts,
      value: 32,
      href: "/lex/contracts",
    },
    {
      key: "consultations" as const,
      label: labels.serviceRequestCategories.consultations,
      value: 56,
      href: "/lex/consultations",
    },
    {
      key: "litigations" as const,
      label: labels.serviceRequestCategories.litigations,
      value: 33,
      href: "/lex/cases",
    },
    {
      key: "investigation" as const,
      label: labels.serviceRequestCategories.investigation,
      value: 13,
      href: "/lex/investigations",
    },
    {
      key: "other" as const,
      label: labels.serviceRequestCategories.other,
      value: 20,
      href: "/lex/reports/analytics",
    },
  ];

  // Team Workload now consumes the real workforce contract, so the specimen is
  // a WorkforceReport rather than the retired {active, capacity} row shape.
  const workforceReport = (activeWorkloads: number[]): WorkforceReport => ({
    scope: { mode: "org", entityIds: [], userIds: [], memberCount: activeWorkloads.length },
    period: {
      from: "2026-07-01",
      to: "2026-07-31",
      timezone: "Asia/Riyadh",
      calendarSource: "tenant",
      workingDays: measure(22),
    },
    team: activeWorkloads.map((active, index) => ({
      userId: `${locale}-member-${index + 1}`,
      displayName: index === 0 ? people.member : locale === "ar" ? "سارة الغامدي" : "Sarah Al-Ghamdi",
      title:
        index === 0
          ? { [locale]: people.title }
          : { [locale]: locale === "ar" ? "أخصائية العقود" : "Contract Specialist" },
      identityStatus: "resolved",
      userStatus: "active",
      linkedCount: 0,
      byDomain: [],
      metrics: {
        activeWorkload: measure(active),
        loadIndexPct: measure(active === 0 ? 0 : 93),
        utilisationPct: UNMEASURED,
        completionRatePct: measure(active === 0 ? 0 : 75),
        onTimePct: UNMEASURED,
        medianCycleDays: measure(active === 0 ? 0 : 4),
        approvalLatencyHrs: UNMEASURED,
        obligationDischargePct: measure(active === 0 ? 0 : 80),
        overdueCount: measure(active === 0 ? 0 : 1),
        idleAssignmentPct: UNMEASURED,
      },
    })),
    rollup: {
      distributionGini: UNMEASURED,
      keyPersonConcentrationPct: UNMEASURED,
      backlogBurnPct: UNMEASURED,
      unroutedRequests: UNMEASURED,
      aging: {},
    },
    coverage: {
      domainsRequested: 2,
      domainsReturned: 2,
      itemsTotal: activeWorkloads.reduce((sum, active) => sum + active, 0),
      itemsAttributed: activeWorkloads.reduce((sum, active) => sum + active, 0),
      itemsUnattributed: 0,
      attributionPct: 100,
      rowsReturned: activeWorkloads.length,
      rowsTruncated: 0,
      exclusions: [],
    },
    degraded: false,
    errors: [],
  });

  const calendarEvents: LegalCalendarEvent[] = [
    {
      id: "hearing:gallery-case",
      type: "hearing",
      title: locale === "ar" ? "جلسة استئناف" : "Appeal hearing",
      date: "2026-08-03T09:00:00.000Z",
      severity: "high",
      href: "/lex/cases/gallery-case",
    },
    {
      id: "obligation:gallery-obligation",
      type: "obligation",
      title: locale === "ar" ? "تجديد شهادة التأمين" : "Insurance certificate renewal",
      date: "2026-08-05T09:00:00.000Z",
      severity: "medium",
      href: "/lex/obligations/gallery-obligation",
    },
  ];

  function readyProps(
    state: DashboardSpecimenState,
  ): LegalDirectorDashboardViewProps {
    const base: LegalDirectorDashboardViewProps = {
      user: {
        firstName:
          state === "overflow" ? people.overflowName : people.firstName,
        lastName: state === "overflow" ? people.overflowTitle : people.lastName,
        role: "LEGAL_DIRECTOR",
        roleLabel: labels.hero.rolePill,
      },
      kpis: kpiStrip(labels, state),
      escalation: {
        state: "ready",
        props: {
          levels: [
            { level: "critical", count: 13, href: "/lex/inbox?severity=critical" },
            { level: "high", count: 31, href: "/lex/inbox?severity=high" },
            { level: "medium", count: 1, href: "/lex/inbox?severity=medium" },
          ],
          totalLabel: labels.values.warnings(format.formatNumber(45), false),
        },
      },
      serviceRequests: {
        state: "ready",
        props: { total: 154, segments: serviceSegments },
      },
      teamWorkload: { state: "ready", report: workforceReport([14, 8]) },
      resolutionRate: {
        state: "ready",
        props: {
          bars: [
            { label: labels.serviceRequestCategories.contracts, ratePct: 52, href: "/lex/contracts" },
            {
              label: labels.serviceRequestCategories.consultations,
              ratePct: 6,
              href: "/lex/consultations",
            },
            { label: labels.serviceRequestCategories.litigations, ratePct: 21, href: "/lex/cases" },
            {
              label: labels.serviceRequestCategories.investigation,
              ratePct: 19,
              href: "/lex/investigations",
            },
          ],
        },
      },
      legalDomains: { state: "ready", props: { domains } },
      calendar: {
        state: "ready",
        props: { events: calendarEvents, now: GALLERY_NOW },
      },
    };

    if (state === "zero") {
      return {
        ...base,
        escalation: {
          state: "ready",
          props: {
            levels: [
              { level: "critical", count: 0, href: "/lex/inbox?severity=critical" },
              { level: "high", count: 0, href: "/lex/inbox?severity=high" },
              { level: "medium", count: 0, href: "/lex/inbox?severity=medium" },
            ],
            totalLabel: labels.values.warnings(format.formatNumber(0), false),
          },
        },
        serviceRequests: {
          state: "ready",
          props: {
            total: 0,
            segments: serviceSegments.map((segment) => ({
              ...segment,
              value: 0,
            })),
          },
        },
        // The workforce contract has its own zero state, distinct from empty.
        teamWorkload: { state: "zero", report: workforceReport([0]) },
        resolutionRate: {
          state: "ready",
          props: {
            bars: serviceSegments
              .slice(0, 4)
              .map((segment) => ({ label: segment.label, ratePct: 0, href: segment.href })),
          },
        },
        legalDomains: {
          state: "ready",
          props: {
            domains: domains.map((domain) => ({
              ...domain,
              count: domain.count === null ? null : 0,
            })),
          },
        },
      };
    }

    if (state === "partial") {
      return {
        ...base,
        escalation: {
          state: "ready",
          props: {
            levels: [{ level: "critical", count: 1, href: "/lex/inbox?severity=critical" }],
            totalLabel: labels.values.warnings(format.formatNumber(1), true),
          },
        },
        serviceRequests: {
          state: "ready",
          props: { total: 1, segments: [serviceSegments[4]] },
        },
        teamWorkload: { state: "ready", report: workforceReport([14]) },
        resolutionRate: {
          state: "ready",
          props: {
            bars: [
              { label: labels.serviceRequestCategories.contracts, ratePct: 52, href: "/lex/contracts" },
            ],
          },
        },
        legalDomains: {
          state: "ready",
          props: { domains: domains.slice(0, 3) },
        },
        calendar: {
          state: "ready",
          props: { events: calendarEvents.slice(0, 1), now: GALLERY_NOW },
        },
      };
    }

    if (state === "overflow") {
      const longCategory = DEV_COPY.longCategory[locale];
      return {
        ...base,
        escalation: {
          state: "ready",
          props: {
            levels: [
              { level: "critical", count: 987654321, href: "/lex/inbox?severity=critical" },
              { level: "high", count: 123456789, href: "/lex/inbox?severity=high" },
              { level: "medium", count: 1, href: "/lex/inbox?severity=medium" },
            ],
            totalLabel: labels.values.warnings(
              format.formatNumber(1111111111),
              false,
            ),
          },
        },
        serviceRequests: {
          state: "ready",
          props: {
            total: 987654321,
            segments: [{ key: "other", label: longCategory, value: 987654321, href: "/lex/reports/analytics" }],
          },
        },
        teamWorkload: {
          state: "ready",
          report: (() => {
            const overflowing = workforceReport([123456789]);
            overflowing.team[0].displayName = people.overflowName;
            overflowing.team[0].title = { [locale]: people.overflowTitle };
            return overflowing;
          })(),
        },
        resolutionRate: {
          state: "ready",
          props: { bars: [{ label: longCategory, ratePct: 112, href: "/lex/reports/analytics" }] },
        },
        legalDomains: {
          state: "ready",
          props: {
            domains: [
              ...domains.map((domain) => ({
                ...domain,
                count: domain.count === null ? null : 987654321,
              })),
              {
                key: "gallery_overflow_domain",
                label: longCategory,
                count: 987654321,
                href: "/lex",
              },
            ],
          },
        },
      };
    }

    return base;
  }

  function propsFor(
    state: DashboardSpecimenState,
  ): LegalDirectorDashboardViewProps {
    const props = readyProps(state);

    if (state === "loading") {
      return {
        ...props,
        escalation: { state: "loading" },
        serviceRequests: { state: "loading" },
        teamWorkload: { state: "loading" },
        resolutionRate: { state: "loading" },
        legalDomains: { state: "loading" },
        calendar: { state: "loading" },
      };
    }

    if (state === "empty") {
      return {
        ...props,
        escalation: { state: "empty" },
        serviceRequests: { state: "empty" },
        teamWorkload: { state: "empty" },
        resolutionRate: { state: "empty" },
        legalDomains: { state: "empty" },
        calendar: { state: "empty" },
      };
    }

    if (state === "error") {
      return {
        ...props,
        escalation: { state: "error", onRetry },
        serviceRequests: { state: "error", onRetry },
        teamWorkload: { state: "error", onRetry },
        resolutionRate: { state: "error", onRetry },
        legalDomains: { state: "error", onRetry },
        calendar: { state: "error", onRetry },
      };
    }

    return props;
  }

  return (
    <div className="space-y-10">
      {SPECIMEN_STATES.map((state) => {
        const copy = DEV_COPY.states[state];
        const id = `legal-director-dashboard-${locale}-${state}`;

        return (
          <article
            key={state}
            id={id}
            data-dashboard-state={state}
            className="min-w-0 space-y-3 scroll-mt-6"
          >
            <header>
              <h4 className="text-body font-semibold text-foreground">
                {copy.label}
              </h4>
              <p className="text-caption text-muted-foreground">
                {copy.description}
              </p>
            </header>
            <div className="min-w-0 overflow-hidden rounded-softest border border-border bg-[var(--wt-canvas)] p-4 sm:p-6">
              <LegalDirectorDashboardView {...propsFor(state)} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Dev-only Step 5 full-composition regression surface. */
export function LegalDirectorDashboardGallery() {
  const [retryCount, setRetryCount] = useState(0);

  return (
    <div className="space-y-12" data-legal-director-dashboard-gallery="">
      <p aria-live="polite" className="text-caption text-muted-foreground">
        {DEV_COPY.retryCount(retryCount)}
      </p>
      {LOCALES.map(({ locale, direction }) => (
        <section
          key={locale}
          aria-labelledby={`legal-director-dashboard-${locale}-title`}
          className="space-y-6"
        >
          <h3
            id={`legal-director-dashboard-${locale}-title`}
            className="text-[length:var(--wt-font-size-panel-title)] font-bold leading-[var(--wt-line-height-panel-title)] text-foreground"
          >
            {DEV_COPY.locales[locale]}
          </h3>
          <LocaleProvider
            locale={locale}
            direction={direction}
            messages={getMessages(locale)}
          >
            <div dir={direction} lang={locale}>
              <LocaleDashboardGallery
                locale={locale}
                onRetry={() => setRetryCount((current) => current + 1)}
              />
            </div>
          </LocaleProvider>
        </section>
      ))}
    </div>
  );
}
