'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  CalendarClock,
  ChevronRight,
  Lock,
  PlayCircle,
  Rocket,
  ShieldHalf,
  Swords,
  Timer,
} from 'lucide-react';
import { FailoverWizard } from './failover-wizard/failover-wizard';
import { isRunActive } from '@/components/product';
import { statusChipVariants } from '@/components/shared/status-chip';
import { cn } from '@/lib/utils';
import type { DRFailoverRun } from '@/types/clario-dr';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/hooks/use-auth';
import { DR_PERMISSIONS } from '../../_lib/dr-permissions';
import { useDRSelection } from '../../_lib/dr-selection';
import {
  useDRFailoverRuns,
  useDRGameDayScenarios,
  useDRGroupRecoveryPoints,
  useDRGroupSummary,
  useDRPosture,
  useDRTopologyFailoverTarget,
} from '../../_hooks/use-dr-queries';
import {
  useEvidenceActions,
  useFailoverActions,
  useRecoveryActions,
  useRehearseActions,
} from '../../_hooks/use-dr-actions';
import { DR_LIVE_REFETCH_MS, isRunLive } from '../../_hooks/use-dr-realtime';
import { useDRLabels, resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { breachState, formatCountdown, remainingToObjective } from '../../_lib/rto';
import { useDRCommandIntentStore } from '../../_lib/dr-command-intents';

/**
 * Always-visible primary command bar for the Recovery Operations Console.
 *
 * Surfaces the four lifecycle-spanning write actions — Declare failover,
 * Rehearse, Run a runbook, and Seal recovery point — so an operator never lands
 * on a read-only wall. Every action is wired to a real action hook from
 * `use-dr-actions` (no stubs), gated by `hasPermission('dr:write')` (disabled
 * with an explanatory tooltip when absent), and additionally disabled with a
 * tooltip when it requires a protection group and none is selected.
 *
 * The underlying mutation hooks already toast on success/error and invalidate
 * the shared `['clario-dr', ...]` query keys, so this bar carries no result
 * state of its own.
 */

const WRITE_PERMISSION = DR_PERMISSIONS.write;
/** Step-up permission required to actually declare/approve a failover or drill. */
const FAILOVER_PERMISSION = DR_PERMISSIONS.failover;

/** Full copy for the command bar (one identically-shaped copy per locale). */
interface CommandBarLabels {
  /** Tooltip shown when the operator lacks `dr:write`. */
  noWriteTooltip: string;
  /** Tooltip shown when an action needs a protection group and none is picked. */
  noGroupTooltip: string;
  /** Accessible name for the toolbar landmark. */
  toolbarAriaLabel: string;
  /** Eyebrow label leading the action group. */
  operations: string;
  /** Primary write-action button labels. */
  actions: {
    declareFailover: string;
    rehearse: string;
    runRunbook: string;
    sealPoint: string;
  };
  /** Rehearse dialog copy. */
  rehearseDialog: {
    title: string;
    description: string;
    scenarioLabel: string;
    scenarioPlaceholder: string;
    noScenarios: string;
    scheduleDrill: string;
    runGameDay: string;
  };
  /** Run-a-runbook dialog copy. */
  runbookDialog: {
    title: string;
    description: string;
    targetGroupLabel: string;
    noGroupSelected: string;
    cancel: string;
    startBoot: string;
  };
  /** Live-run chip copy. */
  liveRun: {
    /** Accessible name for the chip's deep link to the run. */
    openRun: (runId: string) => string;
    /** Prefix for the RTO countdown, read by assistive tech. */
    rtoRemaining: string;
    /** Shown when the run has overrun its RTO objective. */
    rtoOver: string;
  };
}

/**
 * Bilingual command-bar copy. The `en` side is byte-identical to the prior
 * English so the `renderWithQuery` `en` default keeps every existing assertion
 * green; the `ar` side is professional MSA with the same shape (the `openRun`
 * function keeps its `runId` interpolation).
 */
const commandBarLabels: DRBilingual<CommandBarLabels> = {
  en: {
    noWriteTooltip: 'Requires the dr:write permission',
    noGroupTooltip: 'Select a protection group first',
    toolbarAriaLabel: 'Recovery operations actions',
    operations: 'Operations',
    actions: {
      declareFailover: 'Declare failover',
      rehearse: 'Rehearse',
      runRunbook: 'Run a runbook',
      sealPoint: 'Seal recovery point',
    },
    rehearseDialog: {
      title: 'Rehearse recovery',
      description:
        'Run a game-day fault-injection scenario now, or schedule a recurring isolated drill for the selected protection group.',
      scenarioLabel: 'Game-day scenario',
      scenarioPlaceholder: 'Select a scenario to run',
      noScenarios: 'No game-day scenarios defined yet. Schedule an isolated drill instead.',
      scheduleDrill: 'Schedule isolated drill',
      runGameDay: 'Run game day',
    },
    runbookDialog: {
      title: 'Run recovery runbook',
      description:
        'Starts an isolated boot run for the selected protection group, executing its recovery runbook in an isolated environment so production routing is never touched.',
      targetGroupLabel: 'Target protection group',
      noGroupSelected: 'No group selected',
      cancel: 'Cancel',
      startBoot: 'Start isolated boot',
    },
    liveRun: {
      openRun: (runId: string) => `Open the live recovery run ${runId}`,
      rtoRemaining: 'RTO remaining',
      rtoOver: 'RTO over',
    },
  },
  ar: {
    noWriteTooltip: 'يتطلّب صلاحية الكتابة (dr:write)',
    noGroupTooltip: 'اختر مجموعة حماية أولًا',
    toolbarAriaLabel: 'إجراءات عمليات الاسترداد',
    operations: 'العمليات',
    actions: {
      declareFailover: 'إعلان تجاوز الفشل',
      rehearse: 'تمرين',
      runRunbook: 'تشغيل دليل تشغيل',
      sealPoint: 'ختم نقطة الاسترداد',
    },
    rehearseDialog: {
      title: 'تمرين الاسترداد',
      description:
        'شغّل سيناريو حقن أعطال (يوم محاكاة) الآن، أو جدوِل تمرينًا معزولًا متكررًا لمجموعة الحماية المحدّدة.',
      scenarioLabel: 'سيناريو يوم المحاكاة',
      scenarioPlaceholder: 'اختر سيناريو لتشغيله',
      noScenarios: 'لم تُعرَّف سيناريوهات يوم محاكاة بعد. جدوِل تمرينًا معزولًا بدلًا من ذلك.',
      scheduleDrill: 'جدولة تمرين معزول',
      runGameDay: 'تشغيل يوم المحاكاة',
    },
    runbookDialog: {
      title: 'تشغيل دليل تشغيل الاسترداد',
      description:
        'يبدأ تشغيل إقلاع معزول لمجموعة الحماية المحدّدة، وينفّذ دليل تشغيل الاسترداد الخاص بها في بيئة معزولة بحيث لا يُمَسّ توجيه الإنتاج إطلاقًا.',
      targetGroupLabel: 'مجموعة الحماية المستهدفة',
      noGroupSelected: 'لم تُحدَّد مجموعة',
      cancel: 'إلغاء',
      startBoot: 'بدء الإقلاع المعزول',
    },
    liveRun: {
      openRun: (runId: string) => `فتح عملية الاسترداد المباشرة ${runId}`,
      rtoRemaining: 'المتبقّي على هدف زمن الاسترداد (RTO)',
      rtoOver: 'تجاوُز هدف زمن الاسترداد (RTO)',
    },
  },
};

/** Resolve the command-bar copy for the active locale (en default in tests). */
function useCommandBarLabels(): CommandBarLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(commandBarLabels, locale), [locale]);
}

/**
 * The single live failover run to surface in the command bar: the most recently
 * initiated run that is still mid-flight (per the canonical FSM `isRunLive`).
 * Returns `null` when nothing is in flight.
 */
function selectLiveRun(runs: DRFailoverRun[] | undefined | null): DRFailoverRun | null {
  if (!runs || runs.length === 0) return null;
  let latest: DRFailoverRun | null = null;
  let latestMs = -Infinity;
  for (const run of runs) {
    if (!isRunLive(run.status)) continue;
    const ms = Date.parse(run.initiated_at);
    const ordinal = Number.isNaN(ms) ? 0 : ms;
    if (ordinal >= latestMs) {
      latest = run;
      latestMs = ordinal;
    }
  }
  return latest;
}

interface GuardedButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabledReason: string | null;
  pending?: boolean;
  variant?: 'default' | 'outline';
}

/** A primary action button that disables + explains itself via tooltip. */
function GuardedButton({
  label,
  icon,
  onClick,
  disabledReason,
  pending = false,
  variant = 'outline',
}: GuardedButtonProps) {
  const disabled = disabledReason !== null || pending;
  const button = (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
    >
      {pending ? <Spinner size="sm" className="me-1.5" /> : <span className="me-1.5 inline-flex">{icon}</span>}
      {label}
    </Button>
  );

  if (!disabledReason) return button;

  return (
    <Tooltip>
      {/* Disabled buttons swallow pointer events, so wrap for the tooltip trigger. */}
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

export function DRCommandBar() {
  const labels = useCommandBarLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission(WRITE_PERMISSION);
  // RBAC step-up: opening + pre-flighting the failover wizard needs `dr:write`,
  // but the actual declare/approve confirm additionally requires `dr:failover`
  // (mirrors backend/internal/auth/rbac.go). The wizard enforces this on its
  // confirm action; the trigger stays `dr:write`-gated so the flow is reviewable.
  const canFailover = hasPermission(FAILOVER_PERMISSION);

  const postureQuery = useDRPosture();
  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);

  const { activeGroupId } = useDRSelection({ groups });
  const groupSummaryQuery = useDRGroupSummary(activeGroupId);
  const scenariosQuery = useDRGameDayScenarios();

  // Surface the most recently-initiated in-flight failover run as a compact LIVE
  // chip. Poll on the live cadence only while a run is actually mid-flight (the
  // console-wide realtime registration in the layout also invalidates this key
  // on DR WS events); relax to the shared baseline otherwise. Liveness is read
  // from the live query cache so the single observer adopts the new interval on
  // the next render without spawning a duplicate observer.
  const cachedRuns = useQueryClient().getQueryData<DRFailoverRun[]>(['clario-dr', 'failover-runs']);
  const cachedLiveRun = useMemo(() => selectLiveRun(cachedRuns), [cachedRuns]);
  const failoverRunsQuery = useDRFailoverRuns(cachedLiveRun ? DR_LIVE_REFETCH_MS : undefined);
  const activeRun = useMemo(() => selectLiveRun(failoverRunsQuery.data), [failoverRunsQuery.data]);

  // The guided failover wizard reports the operator's chosen recovery point here
  // so it rides the real `createDRFailoverRun` payload via the action hook's
  // `activeRecoveryPointId` context (no invented fields).
  const [failoverRecoveryPointId, setFailoverRecoveryPointId] = useState<string | null>(null);

  const failoverActions = useFailoverActions({
    activeGroupId,
    activeRecoveryPointId: failoverRecoveryPointId,
    groupSummary: groupSummaryQuery.data ?? null,
    failbackSites: { fromSite: null, toSite: null },
  });
  const rehearseActions = useRehearseActions({
    activeGroupId,
    groupSummary: groupSummaryQuery.data ?? null,
  });
  const recoveryActions = useRecoveryActions({ activeGroupId, activeStreamId: null });
  const evidenceActions = useEvidenceActions(activeGroupId);

  const [failoverOpen, setFailoverOpen] = useState(false);
  const [rehearseOpen, setRehearseOpen] = useState(false);
  const [runbookOpen, setRunbookOpen] = useState(false);
  const [scenarioId, setScenarioId] = useState<string>('');

  // Plan-step data for the guided wizard: the group's sealed recovery points and
  // the topology-selected failover target. Only enabled (via the underlying
  // hooks' `Boolean(activeGroupId)` gate) when a group is selected; the wizard
  // itself only opens with a group, so these are not over-fetched.
  const recoveryPointsQuery = useDRGroupRecoveryPoints(failoverOpen ? activeGroupId : null);
  const failoverTargetQuery = useDRTopologyFailoverTarget(failoverOpen ? activeGroupId : null);

  const writeReason = canWrite ? null : labels.noWriteTooltip;
  const groupReason = activeGroupId ? null : labels.noGroupTooltip;
  const scenarios = useMemo(() => scenariosQuery.data ?? [], [scenariosQuery.data]);

  const recoveryPoints = useMemo(
    () => recoveryPointsQuery.data ?? [],
    [recoveryPointsQuery.data],
  );

  const handleDeclareFailover = () => {
    failoverActions.createFailover();
  };

  const handleRunGameDay = () => {
    if (!scenarioId) return;
    rehearseActions.runGameDay(scenarioId);
    setRehearseOpen(false);
  };

  const handleScheduleDrill = () => {
    rehearseActions.createDrillSchedule();
    setRehearseOpen(false);
  };

  const handleRunRunbook = () => {
    failoverActions.startBoot();
    setRunbookOpen(false);
  };

  const handleSealPoint = () => {
    recoveryActions.sealPoint();
  };

  // Fulfil write-action intents raised from the global command palette (or its
  // hotkeys). Each intent opens the exact same dialog/wizard or invokes the exact
  // same action this bar's buttons use — the palette never re-implements a flow.
  // The `nonce` is in the dep list so repeating an intent re-triggers, and the
  // intent is cleared immediately so it fires once. The bar is `dr:write`-gated
  // at the action layer; palette intents only exist when the operator can write.
  const intent = useDRCommandIntentStore((s) => s.intent);
  const intentNonce = useDRCommandIntentStore((s) => s.nonce);
  const clearIntent = useDRCommandIntentStore((s) => s.clearIntent);

  useEffect(() => {
    if (!intent || !canWrite) return;
    switch (intent) {
      case 'declare-failover':
        setFailoverOpen(true);
        break;
      case 'rehearse':
        setRehearseOpen(true);
        break;
      case 'seal-recovery-point':
        recoveryActions.sealPoint();
        break;
      case 'anchor-ledger':
        evidenceActions.anchorLedger();
        break;
    }
    clearIntent();
    // `recoveryActions`/`evidenceActions` action callbacks are stable per hook
    // instance; `intentNonce` ensures a repeated intent still re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, intentNonce, canWrite, clearIntent]);

  return (
    <TooltipProvider delayDuration={150}>
      <div
        role="toolbar"
        aria-label={labels.toolbarAriaLabel}
        className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm"
      >
        <span className="me-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <ShieldHalf className="h-4 w-4" aria-hidden />
          {labels.operations}
        </span>

        <GuardedButton
          label={labels.actions.declareFailover}
          icon={<Swords className="h-4 w-4" aria-hidden />}
          variant="default"
          onClick={() => setFailoverOpen(true)}
          disabledReason={writeReason ?? groupReason}
          pending={failoverActions.createFailoverPending}
        />
        <GuardedButton
          label={labels.actions.rehearse}
          icon={<Rocket className="h-4 w-4" aria-hidden />}
          onClick={() => setRehearseOpen(true)}
          disabledReason={writeReason}
          pending={rehearseActions.runningGameDayScenario || rehearseActions.creatingDrillSchedule}
        />
        <GuardedButton
          label={labels.actions.runRunbook}
          icon={<PlayCircle className="h-4 w-4" aria-hidden />}
          onClick={() => setRunbookOpen(true)}
          disabledReason={writeReason ?? groupReason}
          pending={failoverActions.startBootPending}
        />
        <GuardedButton
          label={labels.actions.sealPoint}
          icon={<Lock className="h-4 w-4" aria-hidden />}
          onClick={handleSealPoint}
          disabledReason={writeReason ?? groupReason}
          pending={recoveryActions.sealingPoint}
        />

        {activeRun ? <DRLiveRunChip run={activeRun} /> : null}
      </div>

      {/* Declare failover — guided, pre-flighted wizard -------------------- */}
      <FailoverWizard
        open={failoverOpen}
        onOpenChange={setFailoverOpen}
        canWrite={canWrite}
        canFailover={canFailover}
        activeGroupId={activeGroupId}
        groupSummary={groupSummaryQuery.data ?? null}
        recoveryPoints={recoveryPoints}
        recoveryPointsLoading={recoveryPointsQuery.isLoading}
        failoverTarget={failoverTargetQuery.data ?? null}
        failoverTargetLoading={failoverTargetQuery.isLoading}
        onDeclare={handleDeclareFailover}
        declaring={failoverActions.createFailoverPending}
        onRecoveryPointChange={setFailoverRecoveryPointId}
      />

      {/* Rehearse ---------------------------------------------------------- */}
      <Dialog open={rehearseOpen} onOpenChange={setRehearseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.rehearseDialog.title}</DialogTitle>
            <DialogDescription>{labels.rehearseDialog.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label htmlFor="dr-gameday-scenario" className="text-sm font-medium text-foreground">
                {labels.rehearseDialog.scenarioLabel}
              </label>
              <Select value={scenarioId} onValueChange={setScenarioId}>
                <SelectTrigger id="dr-gameday-scenario">
                  <SelectValue placeholder={labels.rehearseDialog.scenarioPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {scenarios.map((scenario) => (
                    <SelectItem key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {scenarios.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {labels.rehearseDialog.noScenarios}
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleScheduleDrill}
              disabled={!activeGroupId || rehearseActions.creatingDrillSchedule}
            >
              {rehearseActions.creatingDrillSchedule ? (
                <Spinner size="sm" className="me-1.5" />
              ) : (
                <CalendarClock className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {labels.rehearseDialog.scheduleDrill}
            </Button>
            <Button
              type="button"
              onClick={handleRunGameDay}
              disabled={!scenarioId || rehearseActions.runningGameDayScenario}
            >
              {rehearseActions.runningGameDayScenario && <Spinner size="sm" className="me-1.5" />}
              {labels.rehearseDialog.runGameDay}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run a runbook ----------------------------------------------------- */}
      <Dialog open={runbookOpen} onOpenChange={setRunbookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.runbookDialog.title}</DialogTitle>
            <DialogDescription>{labels.runbookDialog.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-1">
            <p className="text-sm text-muted-foreground">{labels.runbookDialog.targetGroupLabel}</p>
            <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground">
              {groupSummaryQuery.data?.name ?? activeGroupId ?? labels.runbookDialog.noGroupSelected}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRunbookOpen(false)}>
              {labels.runbookDialog.cancel}
            </Button>
            <Button
              type="button"
              onClick={handleRunRunbook}
              disabled={!activeGroupId || failoverActions.startBootPending}
            >
              {failoverActions.startBootPending && <Spinner size="sm" className="me-1.5" />}
              {labels.runbookDialog.startBoot}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

/** One-second tick driving the live RTO countdown; only runs while `active`. */
function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Compact always-visible LIVE chip for the single in-flight failover run. Shows
 * a pulsing presence dot, the run's human status, and a mini RTO countdown, and
 * deep-links to the live execution view (`/dr/runs/[id]`). Token-driven via the
 * design-system `statusChipVariants`; the countdown ticks once a second and the
 * pulse is suppressed under reduced motion. Logical spacing keeps it RTL-correct.
 */
function DRLiveRunChip({ run }: { run: DRFailoverRun }) {
  const labels = useCommandBarLabels();
  const { drRunStatusLabels } = useDRLabels();
  const active = isRunActive(run.status);
  const now = useSecondTick(active);

  const remaining = remainingToObjective(run, now);
  const state = breachState(run, now);
  // RTO countdown is the at-a-glance health signal; on_track stays calm (info).
  const tone = state === 'breached' ? 'danger' : state === 'at_risk' ? 'warning' : 'info';
  const statusLabel = drRunStatusLabels[run.status] ?? run.status;
  const overrun = remaining !== null && remaining < 0;
  const countdownLabel = overrun
    ? labels.liveRun.rtoOver
    : labels.liveRun.rtoRemaining;

  return (
    <Link
      href={`/dr/runs/${encodeURIComponent(run.id)}`}
      aria-label={labels.liveRun.openRun(run.id)}
      className={cn(
        statusChipVariants({ tone, size: 'md' }),
        'ms-auto gap-1.5 transition-colors hover:opacity-90',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
      </span>
      <span className="font-semibold">{statusLabel}</span>
      <span className="inline-flex items-center gap-1 tabular-nums" aria-live="polite">
        <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="sr-only">{countdownLabel}: </span>
        <span dir="ltr">{formatCountdown(remaining)}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 rtl:rotate-180" aria-hidden />
    </Link>
  );
}
