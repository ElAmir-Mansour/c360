'use client';

/**
 * Legal Director dashboard CONTAINER — LEX-LD-GAP-DESIGN G1/G2/G3/G4/G5.
 *
 * `LegalDirectorDashboardView` is deliberately transport-free: its own
 * source-discipline test bans fetch/axios/react-query/permissions/routes from
 * the view. This file is the other side of that boundary and the ONLY one in
 * the composition allowed to touch hooks, permissions or routes. It maps the
 * normalized {@link RoleDashboardModel} — plus two sources the shared model
 * does not carry (the windowed workforce report and the unified calendar
 * stream) — onto resolved view props.
 *
 * Panel state precedence is ERROR → LOADING → EMPTY → READY, never the reverse.
 * A failed react-query slice settles at `{ isLoading:false, isError:true }`, so
 * a loading-first gate renders it as a skeleton that never resolves; that bug
 * class is the reason `SliceStatus` exists at all.
 *
 * Permission masking is NOT an error. An ungated source reports
 * `{ isError:false, isAvailable:false }` and degrades to an explicit
 * unavailable/empty presentation with no retry affordance. The AI assistant
 * goes one step further: it is separately permissioned AND feature-flagged, so
 * a caller without it gets no band at all rather than a masked one.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { format as formatIsoDay, subDays } from 'date-fns';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import {
  askLexAi,
  getLexAiSession,
  isLexAiProviderOffline,
  isLexAiRefusal,
  isLexAiSurfaceAbsent,
  isLexAiUngrounded,
  listLexAiSessions,
  type LexAiMessage,
} from '@/lib/lex/ai-client';
import { useLexFormat } from '@/lib/lex/ksa';

import { LEX_DOMAINS } from '../../_lib/lex-domains';
import { useRoleDashboardStrings } from '../../_lib/role-dashboards/i18n';
import {
  useLegalDirectorDashboardLabels,
  type LegalDirectorDashboardLabels,
} from '../../_lib/role-dashboards/legal-director-i18n';
import { useManagerTasksPanel } from '../../_lib/role-dashboards/use-manager-tasks-panel';
import {
  isInvisibleWorkforceError,
  useRoleDashboardData,
  type KpiDatum,
  type KpiKey,
  type RoleDashboardModel,
  type SliceStatus,
} from '../../_lib/role-dashboards/use-role-dashboard-data';
import {
  fetchContractEvents,
  fetchHearingEvents,
  fetchObligationEvents,
  fetchServiceSlaEvents,
  fetchSettlementMilestoneEvents,
  fetchSignatureEvents,
  type LegalCalendarEvent,
} from '../../calendar/_lib/calendar-events';

import {
  LegalDirectorDashboardView,
  type LegalDirectorAiAgentState,
  type LegalDirectorCalendarState,
  type LegalDirectorDashboardUser,
  type LegalDirectorDomainsState,
  type LegalDirectorEscalationState,
  type LegalDirectorKpiState,
  type LegalDirectorKpiStrip,
  type LegalDirectorManagerTasksState,
  type LegalDirectorResolutionRateState,
  type LegalDirectorServiceRequestState,
  type LegalDirectorTeamWorkloadState,
  type PanelState,
} from './legal-director-dashboard-view';
import type { AiAgentSendFailure, AiAgentTurn } from './widgets/ai-agent-panel';
import type { DomainTile } from './widgets/domain-tile';
import type { KpiTone } from './widgets/kpi-card';
import { TimeWindowSelector, type DashboardWindow } from './widgets/time-window-selector';
import { getWorkforceReport } from './widgets/workforce-contract';
import {
  escalationDrilldownHref,
  kpiDrilldownHref,
  resolutionDrilldownHref,
  serviceDistributionHref,
} from './dashboard-drilldowns';

const SOFT = { staleTime: 60_000, retry: false as const };

/** Calendar band size — a dashboard slot shows the near horizon, not the agenda. */
const CALENDAR_EVENT_LIMIT = 6;

/**
 * The six §4.1 KPI positions, left to right. `tone` reproduces the mockup's six
 * distinct border colours and carries no semantics. Every source already exists
 * on the shared model; nothing here is derived a second time.
 */
const KPI_POSITIONS: readonly {
  key: KpiKey;
  label: keyof LegalDirectorDashboardLabels['kpis'];
  format: 'count' | 'percent';
  tone: KpiTone;
}[] = [
  { key: 'slaCompliance', label: 'sla', format: 'percent', tone: 'slate' },
  { key: 'complianceScore', label: 'complianceScore', format: 'percent', tone: 'cyan' },
  { key: 'activeLitigations', label: 'activeCases', format: 'count', tone: 'olive' },
  { key: 'investigations', label: 'activeInvestigations', format: 'count', tone: 'green' },
  { key: 'activeContracts', label: 'activeContracts', format: 'count', tone: 'ink' },
  /*
   * Mockup defect. WLS renders Active Consultations as `82%`, but consultations
   * is a COUNT everywhere else in the same spec (donut legend `56`, domain tile
   * `56`) and the endpoint exposes no denominator to build a percentage from.
   * Shipping `count` rather than inventing one; raised with product (G1.3).
   */
  { key: 'consultations', label: 'activeConsultations', format: 'count', tone: 'blue' },
] as const;

/**
 * `EscalationPanelProps.levels` and `labels.severity` both define exactly these
 * three tiers, while the model's `bySeverity` walks five. The panel's caption is
 * re-derived from the tiers actually SHOWN so it can never contradict the bars
 * when `low`/`info` items exist.
 */
const ESCALATION_TIERS = ['critical', 'high', 'medium'] as const;

/**
 * The five §4.2 legend rows, rebuilt here from live domain counts. The shared
 * model emits four slices (investigations folded into `others`) and four other
 * role dashboards read that shape, so the split happens in the container rather
 * than in the model.
 */
const DONUT_SEGMENTS: readonly {
  key: 'contracts' | 'consultations' | 'litigations' | 'investigation' | 'other';
  label: keyof LegalDirectorDashboardLabels['serviceRequestCategories'];
  domains: readonly string[];
}[] = [
  { key: 'contracts', label: 'contracts', domains: ['contracts'] },
  { key: 'consultations', label: 'consultations', domains: ['consultations'] },
  { key: 'litigations', label: 'litigations', domains: ['litigation_cases'] },
  { key: 'investigation', label: 'investigation', domains: ['investigations'] },
  { key: 'other', label: 'other', domains: ['settlements', 'matters'] },
] as const;

/** Days subtracted from today for each window token. */
const WINDOW_DAYS: Record<DashboardWindow, number> = { today: 0, '7d': 7, '30d': 30 };

/**
 * Resolves a window token to the inclusive `from`/`to` the workforce endpoint
 * accepts. Local calendar days, matching how the report labels its own period.
 */
export function workforceWindowRange(
  timeWindow: DashboardWindow,
  now: Date,
): { from: string; to: string } {
  return {
    from: formatIsoDay(subDays(now, WINDOW_DAYS[timeWindow]), 'yyyy-MM-dd'),
    to: formatIsoDay(now, 'yyyy-MM-dd'),
  };
}

/**
 * The one gate order that matters. Error is evaluated BEFORE loading so a
 * failed slice can never present as a skeleton, and `empty` is only reachable
 * once the source has genuinely settled with nothing to show.
 */
function panelState<T>(
  slice: SliceStatus & { isLoading: boolean },
  isEmpty: boolean,
  props: () => T,
): PanelState<T> {
  if (slice.isError) return { state: 'error', onRetry: slice.refetch };
  if (slice.isLoading) return { state: 'loading' };
  if (isEmpty) return { state: 'empty' };
  return { state: 'ready', props: props() };
}

/**
 * A KPI has no retry affordance, so its failed and its ungated cases share one
 * terminal presentation: the label over an em-dash. `isError` still separates
 * them on the model for callers that can act on it.
 */
function kpiState(
  key: KpiKey,
  datum: KpiDatum,
  label: string,
  format: 'count' | 'percent',
  tone: KpiTone,
): LegalDirectorKpiState {
  if (datum.isLoading) return { state: 'loading', props: { label, tone } };
  if (!datum.isAvailable || datum.value === null) {
    return { state: 'unavailable', props: { label } };
  }
  return {
    state: 'ready',
    props: { label, value: datum.value, format, tone, href: kpiDrilldownHref(key) },
  };
}

/** Aggregate loading/error/retry across the domain tiles the caller can see. */
function domainsStatus(
  model: RoleDashboardModel,
  visible: readonly { id: string; hasCount: boolean }[],
): SliceStatus & { isLoading: boolean } {
  const counted = visible
    .filter((domain) => domain.hasCount)
    .map((domain) => model.domainCounts[domain.id])
    .filter((count): count is NonNullable<typeof count> => count !== undefined);

  return {
    isLoading: counted.some((count) => count.isLoading),
    isError: counted.some((count) => count.isError === true),
    refetch: () => {
      for (const count of counted) count.refetch?.();
    },
  };
}

/**
 * Maps the workforce report onto the panel's own six-state union. `degraded`
 * and `unavailable` are kept distinct from `empty` on purpose: the first names
 * the domains that were masked or failed, the second says the metrics could not
 * be computed. Collapsing either into "no data" would misreport capacity.
 *
 * Mirrors the derivation the generic role dashboard already uses for the same
 * report, so the two surfaces cannot drift apart.
 */
function teamWorkloadState(source: {
  report: Awaited<ReturnType<typeof getWorkforceReport>> | undefined;
  isLoading: boolean;
  isError: boolean;
  isMasked: boolean;
  refetch: () => void;
}): LegalDirectorTeamWorkloadState {
  if (source.isMasked) return { state: 'empty' };
  if (source.isError) return { state: 'error', onRetry: source.refetch };
  if (source.isLoading) return { state: 'loading' };

  const report = source.report;
  if (!report || report.team.length === 0) return { state: 'empty' };
  if (report.degraded) return { state: 'degraded', report, onRetry: source.refetch };

  const activeWorkloads = report.team.map((member) => member.metrics.activeWorkload);
  if (activeWorkloads.every((metric) => !metric.available || metric.value === null)) {
    return { state: 'unavailable', report };
  }
  if (activeWorkloads.every((metric) => metric.value === 0)) {
    return { state: 'zero', report };
  }
  return { state: 'ready', report };
}

/**
 * Persisted `tool` rows are the audit record of which grounding data the model
 * read; they carry no operator-facing prose. Their count is folded onto the
 * assistant turn instead, so the transcript reads as a conversation while still
 * disclosing that the answer was grounded.
 */
function toAiAgentTurn(message: LexAiMessage): AiAgentTurn[] {
  if (message.role !== 'user' && message.role !== 'assistant') return [];
  if (!message.content.trim()) return [];
  return [
    {
      id: message.id,
      role: message.role,
      content: message.content,
      groundedInCount: message.tool_calls?.length ?? 0,
    },
  ];
}

/**
 * Four honest outcomes for a question that produced no answer, each asking for a
 * different response from the reader. Anything unrecognised is a plain transport
 * failure, which is the only one worth simply resending.
 */
function aiSendFailure(error: unknown): AiAgentSendFailure {
  if (isLexAiProviderOffline(error)) return 'providerOffline';
  if (isLexAiRefusal(error)) return 'refused';
  if (isLexAiUngrounded(error)) return 'noGrounding';
  return 'failed';
}

/**
 * Live Legal Director landing dashboard. Mounted by `RoleDashboard` for the
 * `legal-director` persona; every value below is tenant-scoped backend data or
 * a transparent derivation of it.
 */
export function LegalDirectorDashboardContainer() {
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const labels = useLegalDirectorDashboardLabels();
  const { t } = useRoleDashboardStrings();
  const format = useLexFormat();

  // A single stable "now" per mount keeps the workforce range, the calendar's
  // proximity severity and its relative-time copy from disagreeing with each
  // other mid-session.
  const now = useMemo(() => new Date(), []);

  /*
   * The window is owned here and reaches exactly one source. Of the six
   * dashboard sources only GET /lex/reports/workforce accepts from/to; the
   * other five take no range at all, which is why the selector is rendered
   * beside the Team Workload panel rather than over the hero (G3(b)).
   */
  const [timeWindow, setTimeWindow] = useState<DashboardWindow>('30d');
  const range = useMemo(() => workforceWindowRange(timeWindow, now), [timeWindow, now]);

  // No `roleSlug`: the shared model's own workforce query stays disabled so the
  // windowed one below is the single workforce request on this surface.
  const model = useRoleDashboardData();

  const canReadWorkforce = hasPermission('lex:workforce:read');
  const workforce = useQuery({
    queryKey: ['legal-director-dash', 'workforce', range.from, range.to],
    queryFn: () => getWorkforceReport({ scope: 'org', from: range.from, to: range.to }),
    enabled: canReadWorkforce,
    ...SOFT,
  });

  // The unified calendar's six dated sources, each its own query so one failing
  // source degrades the band instead of blanking it. Normalization is reused
  // wholesale from `calendar-events.ts`; nothing is re-derived here.
  const canReadLex = hasPermission('lex:read');
  const calendarResults = useQueries({
    queries: [
      {
        queryKey: ['legal-director-dash', 'calendar', 'hearings', locale],
        queryFn: () => fetchHearingEvents(locale),
        enabled: canReadLex,
        ...SOFT,
      },
      {
        queryKey: ['legal-director-dash', 'calendar', 'contracts'],
        queryFn: () => fetchContractEvents(now),
        enabled: canReadLex,
        ...SOFT,
      },
      {
        queryKey: ['legal-director-dash', 'calendar', 'signatures'],
        queryFn: () => fetchSignatureEvents(now),
        enabled: canReadLex,
        ...SOFT,
      },
      {
        queryKey: ['legal-director-dash', 'calendar', 'obligations'],
        queryFn: () => fetchObligationEvents(),
        enabled: canReadLex,
        ...SOFT,
      },
      {
        queryKey: ['legal-director-dash', 'calendar', 'settlements'],
        queryFn: () => fetchSettlementMilestoneEvents(now),
        enabled: canReadLex,
        ...SOFT,
      },
      {
        queryKey: ['legal-director-dash', 'calendar', 'service-sla'],
        queryFn: () => fetchServiceSlaEvents(),
        enabled: canReadLex,
        ...SOFT,
      },
    ],
  });

  /*
   * The assistant is the one surface on this dashboard the deployment may not
   * have at all: it is gated on its OWN permission (`lex:ai:use`, deliberately
   * not `lex:read` — an LLM that can summarise across legal domains needs its
   * own switch) and on the `LEX_AI_ENABLED` flag, which when off leaves
   * `/lex/ai/*` unmounted rather than disabled. The session rail is therefore
   * also the flag probe, and its 404/403 is read as "no assistant here", not as
   * a failure to report.
   */
  const canUseAi = hasPermission('lex:ai:use');
  const [aiSessionId, setAiSessionId] = useState<string | null>(null);

  const aiSessions = useQuery({
    queryKey: ['legal-director-dash', 'ai', 'sessions'],
    queryFn: () => listLexAiSessions(),
    enabled: canUseAi,
    ...SOFT,
  });

  const aiTranscript = useQuery({
    queryKey: ['legal-director-dash', 'ai', 'transcript', aiSessionId],
    queryFn: () => getLexAiSession(aiSessionId as string),
    enabled: canUseAi && aiSessionId !== null,
    ...SOFT,
  });

  const askAi = useMutation({
    mutationFn: (message: string) =>
      askLexAi({ message, session_id: aiSessionId ?? undefined }),
    onSuccess: (result) => {
      // The server transcript stays the single source of truth for what was
      // said — the answer is never spliced in locally, so what the reader sees
      // is exactly what was persisted to the audit trail.
      setAiSessionId(result.session_id);
      void queryClient.invalidateQueries({ queryKey: ['legal-director-dash', 'ai'] });
    },
  });

  // Sorted by `seq` rather than trusted to arrive ordered: a transcript read out
  // of order is not a cosmetic defect, it reattributes who said what.
  const aiTurns = useMemo<AiAgentTurn[]>(
    () =>
      [...(aiTranscript.data?.messages ?? [])]
        .sort((left, right) => left.seq - right.seq)
        .flatMap(toAiAgentTurn),
    [aiTranscript.data],
  );

  const calendarEvents = useMemo<LegalCalendarEvent[]>(() => {
    const merged: LegalCalendarEvent[] = [];
    for (const result of calendarResults) {
      if (result.data) merged.push(...result.data);
    }
    return merged;
    // `dataUpdatedAt` changes exactly when a source resolves, and useQueries
    // returns a fresh array identity every render — the same dependency the
    // full calendar uses for this merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarResults.map((result) => result.dataUpdatedAt).join(',')]);

  // ── KPI strip ─────────────────────────────────────────────────────────────
  // Spelled out as a six-tuple rather than mapped: the strip's arity is part of
  // the frozen §4.1 contract, so a dropped position is a type error, not a
  // silently shorter row.
  const kpiAt = (index: number): LegalDirectorKpiState => {
    const position = KPI_POSITIONS[index];
    return kpiState(
      position.key,
      model.kpis[position.key],
      labels.kpis[position.label],
      position.format,
      position.tone,
    );
  };
  const kpis: LegalDirectorKpiStrip = [
    kpiAt(0),
    kpiAt(1),
    kpiAt(2),
    kpiAt(3),
    kpiAt(4),
    kpiAt(5),
  ];

  // ── Escalation & risk warnings ────────────────────────────────────────────
  const levels = ESCALATION_TIERS.map((level) => ({
    level,
    count: model.escalations.bySeverity.find((datum) => datum.severity === level)?.count ?? 0,
    href: escalationDrilldownHref(level),
  }));
  // Built from the SHOWN tiers, never from `escalations.total`, which also
  // counts the low/info items this panel does not chart.
  const shownWarnings = levels.reduce((sum, entry) => sum + entry.count, 0);
  const escalation: LegalDirectorEscalationState = panelState(
    model.escalations,
    model.escalations.total === 0,
    () => ({
      // All three bars always render, zeros included, so the chart shape stays
      // stable across personas and reloads.
      levels,
      totalLabel: labels.values.warnings(
        format.formatNumber(shownWarnings),
        shownWarnings === 1,
      ),
    }),
  );

  // ── Service request distribution ──────────────────────────────────────────
  const countOf = (domain: string) => model.domainCounts[domain]?.count ?? 0;
  const segments = DONUT_SEGMENTS.map((segment) => ({
    key: segment.key,
    label: labels.serviceRequestCategories[segment.label],
    value: segment.domains.reduce((sum, domain) => sum + countOf(domain), 0),
    href: serviceDistributionHref(segment.key),
  }));
  // Zero categories keep their legend row and read `0`; the panel is only empty
  // when no source count resolved at all (every domain ungated or unfetched).
  // An ABSENT domain key is not a resolved zero — it is a count that never ran.
  const donutHasSource = DONUT_SEGMENTS.some((segment) =>
    segment.domains.some((domain) => (model.domainCounts[domain]?.count ?? null) !== null),
  );
  const serviceRequests: LegalDirectorServiceRequestState = panelState(
    model.distribution,
    !donutHasSource,
    () => ({
      total: segments.reduce((sum, segment) => sum + segment.value, 0),
      segments,
    }),
  );

  // ── Legal teams resolution rate ───────────────────────────────────────────
  const resolutionRate: LegalDirectorResolutionRateState = panelState(
    model.resolutionRates,
    model.resolutionRates.bars.length === 0,
    () => ({
      bars: model.resolutionRates.bars.map((bar) => ({
        // The endpoint's own category keys, named by the already-registered
        // role-dashboard catalogue rather than a second set of translations.
        label: t(`cat.${bar.key}`),
        ratePct: bar.value,
        href: resolutionDrilldownHref(bar.key),
      })),
    }),
  );

  // ── Task Management ───────────────────────────────────────────────────────
  // Scope is the server's call: the director holds tenant-wide oversight, so
  // this band is the whole department's board.
  const managerTasksModel = useManagerTasksPanel('legal-director');
  const managerTasks: LegalDirectorManagerTasksState | undefined = !managerTasksModel.isVisible
    ? undefined
    : managerTasksModel.isError
      ? { state: 'error', onRetry: managerTasksModel.refetch }
      : managerTasksModel.isLoading
        ? { state: 'loading' }
        : !managerTasksModel.props || managerTasksModel.props.rows.length === 0
          ? { state: 'empty' }
          : { state: 'ready', props: managerTasksModel.props };

  // ── Legal domains ─────────────────────────────────────────────────────────
  const visibleDomains = LEX_DOMAINS.filter((domain) => hasPermission(domain.permission));
  const domainLabels: Record<string, string> = labels.domains;
  const legalDomains: LegalDirectorDomainsState = panelState(
    domainsStatus(model, visibleDomains),
    visibleDomains.length === 0,
    () => ({
      // `DomainTile` resolves its own icon and tint from the key, so neither is
      // passed. Navigational domains (`hasCount:false`) pass null and render as
      // label-only tiles rather than a fabricated zero.
      domains: visibleDomains.map<DomainTile>((domain) => ({
        key: domain.id,
        label: domainLabels[domain.id] ?? domain.id,
        count: domain.hasCount ? (model.domainCounts[domain.id]?.count ?? null) : null,
        href: domain.href,
      })),
    }),
  );

  // ── Team workload ─────────────────────────────────────────────────────────
  const workforceMasked =
    !canReadWorkforce || (workforce.isError && isInvisibleWorkforceError(workforce.error));
  const teamWorkload = teamWorkloadState({
    report: workforce.data,
    isLoading: workforce.isLoading,
    isError: workforce.isError,
    isMasked: workforceMasked,
    refetch: () => {
      void workforce.refetch();
    },
  });

  // ── Schedule ──────────────────────────────────────────────────────────────
  const calendarLoading = calendarResults.some((result) => result.isLoading);
  // Only a TOTAL outage is fatal — a partially loaded band still tells the truth
  // about what it managed to read, exactly as the full calendar behaves.
  const calendarFailed =
    calendarResults.length > 0 && calendarResults.every((result) => result.isError);
  const calendar: LegalDirectorCalendarState = panelState(
    {
      isLoading: calendarLoading,
      isError: calendarFailed,
      refetch: () => {
        for (const result of calendarResults) void result.refetch();
      },
    },
    calendarEvents.length === 0,
    () => ({ events: calendarEvents, limit: CALENDAR_EVENT_LIMIT, now }),
  );

  // ── My AI Agent ───────────────────────────────────────────────────────────
  // Absence is total: no permission, or no mounted route, and the band never
  // reaches the view. Everything else is an ordinary panel state, gated error
  // before loading like the rest of the composition.
  const aiSurfaceAbsent =
    !canUseAi || (aiSessions.isError && isLexAiSurfaceAbsent(aiSessions.error));
  let aiAgent: LegalDirectorAiAgentState | undefined;
  if (!aiSurfaceAbsent) {
    if (aiSessions.isError) {
      aiAgent = {
        state: 'error',
        onRetry: () => {
          void aiSessions.refetch();
        },
      };
    } else if (aiSessions.isLoading) {
      aiAgent = { state: 'loading' };
    } else {
      aiAgent = {
        state: 'ready',
        sessions: (aiSessions.data?.sessions ?? []).map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updated_at,
        })),
        activeSessionId: aiSessionId,
        turns: aiTurns,
        isLoadingTurns: aiTranscript.isLoading,
        isSending: askAi.isPending,
        sendFailure: askAi.isError ? aiSendFailure(askAi.error) : null,
        now,
        onAsk: (message) => askAi.mutate(message),
        // A stale failure from the previous conversation must not follow the
        // reader into the next one.
        onSelectSession: (sessionId) => {
          askAi.reset();
          setAiSessionId(sessionId);
        },
        onNewChat: () => {
          askAi.reset();
          setAiSessionId(null);
        },
      };
    }
  }

  // Presentation context only. `role` is a display payload — authorization and
  // data scoping are the server's, never derived from it. The email-local
  // fallback matches the generic role dashboard so the greeting is never blank.
  const viewUser: LegalDirectorDashboardUser = {
    firstName:
      user?.first_name?.trim() ||
      user?.full_name?.trim().split(/\s+/)[0] ||
      user?.email?.split('@')[0] ||
      '',
    lastName: user?.last_name?.trim() || '',
    role: 'LEGAL_DIRECTOR',
    roleLabel: labels.hero.rolePill,
  };

  return (
    <LegalDirectorDashboardView
      user={viewUser}
      kpis={kpis}
      escalation={escalation}
      serviceRequests={serviceRequests}
      teamWorkload={teamWorkload}
      teamWorkloadControl={
        canReadWorkforce ? <TimeWindowSelector value={timeWindow} onChange={setTimeWindow} /> : undefined
      }
      resolutionRate={resolutionRate}
      managerTasks={managerTasks}
      legalDomains={legalDomains}
      calendar={calendar}
      aiAgent={aiAgent}
    />
  );
}
