'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Crosshair,
  Info,
  ShieldAlert,
  ShieldCheck,
  Swords,
} from 'lucide-react';
import type {
  DRFailoverReadiness,
  DRGroupSummary,
  DRRecoveryPoint,
  DRTopologyFailoverSelection,
} from '@/types/clario-dr';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { StatusChip } from '@/components/shared/status-chip';
import { formatRecoveryDuration } from '@/components/product';
import { cn } from '@/lib/utils';
import { useDRLabels } from '../../../_lib/dr-i18n';
import {
  type FailoverWizardMode,
  useFailoverWizardLabels,
} from './failover-wizard-labels';

/**
 * Guided, pre-flighted failover wizard.
 *
 * Replaces the bare "Declare failover" dialog with a four-step path:
 *   1. PRE-FLIGHT — reads the live `DRGroupSummary.failover_readiness`; hard-blocks
 *      proceed on `blocking_reasons` (and when `can_failover === false`), and
 *      requires an explicit acknowledgement of every `warning_reason`.
 *   2. PLAN — choose a recovery point (real `group-recovery-points`), see the
 *      topology-selected recovery target, and pick drill vs real cutover.
 *   3. IMPACT — a read-back of exactly what will be declared.
 *   4. CONFIRM — a typed confirmation phrase that gates the real declaration.
 *
 * RBAC step-up: the wizard *opens and pre-flights* on `dr:write` (the trigger is
 * disabled and the dialog cannot open without it), but the **actual declaration**
 * — the final "Declare failover" / "Declare drill" confirm — additionally
 * requires the backend step-up permission `dr:failover` (`DR_PERMISSIONS.failover`,
 * mirroring `backend/internal/auth/rbac.go`). An operator with `dr:write` but not
 * `dr:failover` can review readiness, choose a plan and read the impact, but the
 * confirm action is disabled with a clear bilingual reason. The declaration goes
 * through the shared `useFailoverActions().createFailover` (no invented endpoints):
 * the chosen recovery point is threaded via the hook's `activeRecoveryPointId`
 * context by the command bar, so this component just orchestrates the gates and
 * calls it.
 *
 * Token-driven and RTL-safe (logical spacing/`rtl:` mirroring); all copy is in
 * the feature-local label object.
 */

const STEP_ORDER = ['preflight', 'plan', 'impact', 'confirm'] as const;
type WizardStep = (typeof STEP_ORDER)[number];

/** Latest-available sentinel for the recovery-point select (no real id collides). */
const LATEST_RECOVERY_POINT = '__latest__';

export interface FailoverWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whether the operator holds `dr:write`. Required to open and pre-flight the
   * wizard; without it every step (and the declaration) is disabled.
   */
  canWrite: boolean;
  /**
   * Whether the operator holds the `dr:failover` step-up permission. Required —
   * in addition to `dr:write` — to fire the final declaration. When false the
   * wizard remains viewable/pre-flightable but the confirm action is disabled
   * with a clear bilingual reason.
   */
  canFailover: boolean;
  activeGroupId: string | null;
  groupSummary: DRGroupSummary | null;
  /** Real sealed recovery points for the group (`group-recovery-points`). */
  recoveryPoints: DRRecoveryPoint[];
  recoveryPointsLoading: boolean;
  /** Topology-selected failover target for the group. */
  failoverTarget: DRTopologyFailoverSelection | null;
  failoverTargetLoading: boolean;
  /**
   * Declares the run. The command bar wires this to
   * `useFailoverActions({ activeRecoveryPointId: <selected> }).createFailover`,
   * so the selected recovery point rides the real payload.
   */
  onDeclare: () => void;
  declaring: boolean;
  /** Reports the operator's recovery-point choice up so it lands in the payload. */
  onRecoveryPointChange: (recoveryPointId: string | null) => void;
}

function readinessTone(readiness: DRFailoverReadiness): 'success' | 'warning' | 'danger' {
  if (!readiness.can_failover || readiness.blocking_reasons.length > 0) return 'danger';
  if (readiness.warning_reasons.length > 0) return 'warning';
  return 'success';
}

/** Locale-light absolute timestamp for recovery-point rows (English-now). */
function formatPointTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function FailoverWizard({
  open,
  onOpenChange,
  canWrite,
  canFailover,
  activeGroupId,
  groupSummary,
  recoveryPoints,
  recoveryPointsLoading,
  failoverTarget,
  failoverTargetLoading,
  onDeclare,
  declaring,
  onRecoveryPointChange,
}: FailoverWizardProps) {
  const L = useFailoverWizardLabels();
  const [step, setStep] = useState<WizardStep>('preflight');
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [recoveryPointId, setRecoveryPointId] = useState<string>(LATEST_RECOVERY_POINT);
  const [mode, setMode] = useState<FailoverWizardMode>('drill');
  const [confirmText, setConfirmText] = useState('');

  // Reset all wizard state whenever it is (re)opened so a prior attempt never
  // leaks into a new declaration.
  useEffect(() => {
    if (!open) return;
    setStep('preflight');
    setWarningsAcknowledged(false);
    setRecoveryPointId(LATEST_RECOVERY_POINT);
    setMode('drill');
    setConfirmText('');
    onRecoveryPointChange(null);
  }, [open, onRecoveryPointChange]);

  const readiness = groupSummary?.failover_readiness ?? null;
  const blockingReasons = readiness?.blocking_reasons ?? [];
  const warningReasons = readiness?.warning_reasons ?? [];
  const hasReadiness = Boolean(readiness);
  // Readiness-level allowance (the `can_failover` signal from the live summary) —
  // distinct from the operator's `canFailover` RBAC step-up permission prop.
  const readinessAllowsFailover = Boolean(readiness?.can_failover);

  // Hard block: missing readiness, an explicit can_failover=false, or any
  // blocking reason. Warnings are a soft block cleared by acknowledgement.
  const hardBlocked = !hasReadiness || !readinessAllowsFailover || blockingReasons.length > 0;
  const warningsCleared = warningReasons.length === 0 || warningsAcknowledged;
  const preflightCleared = !hardBlocked && warningsCleared;

  const selectedPoint = useMemo(
    () => recoveryPoints.find((point) => point.id === recoveryPointId) ?? null,
    [recoveryPoints, recoveryPointId],
  );
  const selectedTarget = failoverTarget?.selected ?? null;
  const targetMissing = !failoverTargetLoading && !selectedTarget;

  const confirmPhrase = mode === 'real' ? L.confirm.phraseReal : L.confirm.phraseDrill;
  const confirmMatches = confirmText.trim() === confirmPhrase;

  const stepIndex = STEP_ORDER.indexOf(step);
  const isFirst = stepIndex === 0;

  const handleRecoveryPointChange = (value: string) => {
    setRecoveryPointId(value);
    onRecoveryPointChange(value === LATEST_RECOVERY_POINT ? null : value);
  };

  const goNext = () => {
    const next = STEP_ORDER[stepIndex + 1];
    if (next) setStep(next);
  };
  const goBack = () => {
    const prev = STEP_ORDER[stepIndex - 1];
    if (prev) setStep(prev);
  };

  // Per-step gate for the "Continue" button.
  const canAdvance = (() => {
    if (!canWrite) return false;
    switch (step) {
      case 'preflight':
        return preflightCleared;
      case 'plan':
        return !targetMissing;
      case 'impact':
        return true;
      default:
        return false;
    }
  })();

  // The wizard opens and pre-flights on `dr:write`, but the actual declaration
  // additionally requires the `dr:failover` step-up permission. `canAdvance`
  // (above) deliberately does NOT depend on `canFailover` so a `dr:write`-only
  // operator can still view readiness, plan and impact — only the final confirm
  // is locked.
  const canDeclare =
    canWrite &&
    canFailover &&
    preflightCleared &&
    !targetMissing &&
    confirmMatches &&
    !declaring;

  const handleDeclare = () => {
    if (!canDeclare) return;
    onDeclare();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{L.dialogTitle}</DialogTitle>
          <DialogDescription>{L.dialogDescription}</DialogDescription>
        </DialogHeader>

        <WizardStepper current={stepIndex} />

        <div className="space-y-4 py-1" data-testid="failover-wizard-body">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {L.stepProgress(stepIndex + 1, STEP_ORDER.length)}
            </p>
            <p className="truncate text-xs font-medium text-foreground">
              <span className="text-muted-foreground">{L.groupLabel}: </span>
              {groupSummary?.name ?? activeGroupId ?? L.noGroup}
            </p>
          </div>

          {step === 'preflight' && (
            <PreflightStep
              readiness={readiness}
              warningsAcknowledged={warningsAcknowledged}
              onAcknowledge={setWarningsAcknowledged}
            />
          )}

          {step === 'plan' && (
            <PlanStep
              recoveryPoints={recoveryPoints}
              recoveryPointsLoading={recoveryPointsLoading}
              recoveryPointId={recoveryPointId}
              onRecoveryPointChange={handleRecoveryPointChange}
              failoverTarget={failoverTarget}
              failoverTargetLoading={failoverTargetLoading}
              mode={mode}
              onModeChange={setMode}
            />
          )}

          {step === 'impact' && (
            <ImpactStep
              mode={mode}
              groupName={groupSummary?.name ?? activeGroupId ?? L.noGroup}
              selectedPoint={selectedPoint}
              selectedTargetName={selectedTarget?.site_name ?? null}
              rtoObjectiveSeconds={groupSummary?.rto_objective_seconds ?? null}
              rpoObjectiveSeconds={groupSummary?.rpo_objective_seconds ?? null}
            />
          )}

          {step === 'confirm' && (
            <ConfirmStep
              mode={mode}
              phrase={confirmPhrase}
              value={confirmText}
              onChange={setConfirmText}
              matches={confirmMatches}
              canFailover={canFailover}
            />
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={isFirst ? () => onOpenChange(false) : goBack}
          >
            {isFirst ? (
              L.cancel
            ) : (
              <>
                <ChevronLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
                {L.back}
              </>
            )}
          </Button>

          {step === 'confirm' ? (
            <Button
              type="button"
              onClick={handleDeclare}
              disabled={!canDeclare}
              variant={mode === 'real' ? 'destructive' : 'default'}
            >
              {declaring ? (
                <Spinner size="sm" className="me-1.5" />
              ) : (
                <Swords className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {mode === 'real' ? L.confirm.submitReal : L.confirm.submitDrill}
            </Button>
          ) : (
            <Button type="button" onClick={goNext} disabled={!canAdvance}>
              {L.next}
              <ChevronRight className="ms-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Numbered step rail; the current step is highlighted, prior steps marked done. */
function WizardStepper({ current }: { current: number }) {
  const L = useFailoverWizardLabels();
  return (
    <ol className="flex items-center gap-1.5" aria-hidden>
      {STEP_ORDER.map((key, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={key} className="flex flex-1 items-center gap-1.5">
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                active && 'border-primary bg-primary text-primary-foreground',
                done && 'border-primary/40 bg-primary/10 text-primary',
                !active && !done && 'border-border bg-muted text-muted-foreground',
              )}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                'truncate text-xs font-medium',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {L.steps[key]}
            </span>
            {index < STEP_ORDER.length - 1 && (
              <span className="h-px flex-1 bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function PreflightStep({
  readiness,
  warningsAcknowledged,
  onAcknowledge,
}: {
  readiness: DRFailoverReadiness | null;
  warningsAcknowledged: boolean;
  onAcknowledge: (next: boolean) => void;
}) {
  const { drRunStatusLabels } = useDRLabels();
  const L = useFailoverWizardLabels();
  if (!readiness) {
    return (
      <Alert variant="warning">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <AlertTitle>{L.preflight.heading}</AlertTitle>
        <AlertDescription>{L.preflight.unavailable}</AlertDescription>
      </Alert>
    );
  }

  const tone = readinessTone(readiness);
  const blocking = readiness.blocking_reasons;
  const warnings = readiness.warning_reasons;
  const activeRun = readiness.active_run ?? null;
  const clean = blocking.length === 0 && warnings.length === 0 && readiness.can_failover;

  return (
    <section className="space-y-4" aria-labelledby="dr-preflight-heading">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3 id="dr-preflight-heading" className="text-sm font-semibold text-foreground">
            {L.preflight.heading}
          </h3>
          <StatusChip
            tone={tone}
            label={readiness.status}
            icon={tone === 'success' ? ShieldCheck : AlertTriangle}
          />
        </div>
        <p className="text-sm text-muted-foreground">{L.preflight.description}</p>
      </div>

      {!readiness.can_failover && (
        <Alert variant="destructive">
          <CircleSlash className="h-4 w-4" aria-hidden />
          <AlertTitle>{L.preflight.cannotFailover}</AlertTitle>
        </Alert>
      )}

      {blocking.length > 0 && (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-semibold text-destructive">{L.preflight.blockingTitle}</p>
          <p className="text-xs text-muted-foreground">{L.preflight.blockingBody}</p>
          <ul className="space-y-1.5">
            {blocking.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-sm text-foreground">
                <CircleSlash
                  className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                  aria-hidden
                />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-300/50 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/20">
          <p className="text-sm font-semibold text-warning-700 dark:text-warning-300">
            {L.preflight.warningsTitle}
          </p>
          <p className="text-xs text-muted-foreground">{L.preflight.warningsBody}</p>
          <ul className="space-y-1.5">
            {warnings.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-sm text-foreground">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300"
                  aria-hidden
                />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          <label className="mt-1 flex items-start gap-2.5 rounded-md border border-amber-300/60 bg-card/60 p-2.5">
            <Checkbox
              checked={warningsAcknowledged}
              onCheckedChange={(checked) => onAcknowledge(checked === true)}
              aria-label={L.preflight.ackAll}
              className="mt-0.5"
            />
            <span className="text-sm text-foreground">{L.preflight.ackAll}</span>
          </label>
        </div>
      )}

      {activeRun && (
        <Alert variant="warning">
          <Info className="h-4 w-4" aria-hidden />
          <AlertTitle>{L.preflight.activeRunTitle}</AlertTitle>
          <AlertDescription>
            {L.preflight.activeRunBody(
              activeRun.run_id,
              drRunStatusLabels[activeRun.status] ?? activeRun.status,
            )}
          </AlertDescription>
        </Alert>
      )}

      {clean && (
        <Alert variant="success">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <AlertTitle>{L.preflight.readyTitle}</AlertTitle>
          <AlertDescription>{L.preflight.readyBody}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}

function PlanStep({
  recoveryPoints,
  recoveryPointsLoading,
  recoveryPointId,
  onRecoveryPointChange,
  failoverTarget,
  failoverTargetLoading,
  mode,
  onModeChange,
}: {
  recoveryPoints: DRRecoveryPoint[];
  recoveryPointsLoading: boolean;
  recoveryPointId: string;
  onRecoveryPointChange: (value: string) => void;
  failoverTarget: DRTopologyFailoverSelection | null;
  failoverTargetLoading: boolean;
  mode: FailoverWizardMode;
  onModeChange: (mode: FailoverWizardMode) => void;
}) {
  const L = useFailoverWizardLabels();
  const selectedTarget = failoverTarget?.selected ?? null;
  const targetMissing = !failoverTargetLoading && !selectedTarget;

  return (
    <section className="space-y-5" aria-labelledby="dr-plan-heading">
      <div className="space-y-1.5">
        <h3 id="dr-plan-heading" className="text-sm font-semibold text-foreground">
          {L.plan.heading}
        </h3>
        <p className="text-sm text-muted-foreground">{L.plan.description}</p>
      </div>

      {/* Recovery point ----------------------------------------------------- */}
      <div className="space-y-1.5">
        <Label htmlFor="dr-failover-recovery-point">{L.plan.recoveryPointLabel}</Label>
        <Select value={recoveryPointId} onValueChange={onRecoveryPointChange}>
          <SelectTrigger id="dr-failover-recovery-point">
            <SelectValue placeholder={L.plan.recoveryPointPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LATEST_RECOVERY_POINT}>{L.plan.recoveryPointLatest}</SelectItem>
            {recoveryPoints.map((point) => (
              <SelectItem key={point.id} value={point.id}>
                {formatPointTime(point.sealed_at)} ·{' '}
                {L.plan.recoveryPointRpo(formatRecoveryDuration(point.rpo_seconds))}
                {point.is_validated
                  ? ` · ${L.plan.recoveryPointValidated}`
                  : ` · ${L.plan.recoveryPointUnvalidated}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {recoveryPointsLoading ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner size="sm" /> {L.plan.recoveryPointHelp}
          </p>
        ) : recoveryPoints.length === 0 ? (
          <p className="text-xs text-muted-foreground">{L.plan.recoveryPointEmpty}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{L.plan.recoveryPointHelp}</p>
        )}
      </div>

      {/* Recovery target --------------------------------------------------- */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-foreground">{L.plan.targetLabel}</span>
        {failoverTargetLoading ? (
          <p className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Spinner size="sm" /> {L.plan.targetLoading}
          </p>
        ) : selectedTarget ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <Crosshair className="h-4 w-4 text-primary" aria-hidden />
              {L.plan.targetSelected(selectedTarget.site_name)}
            </span>
            <StatusChip
              tone={selectedTarget.eligible ? 'success' : 'danger'}
              label={
                selectedTarget.eligible ? L.plan.targetEligible : L.plan.targetIneligible
              }
            />
          </div>
        ) : (
          <Alert variant="destructive">
            <CircleSlash className="h-4 w-4" aria-hidden />
            <AlertDescription>{L.plan.targetNone}</AlertDescription>
          </Alert>
        )}
        {selectedTarget?.reason && !targetMissing && (
          <p className="text-xs text-muted-foreground">{L.plan.targetReason(selectedTarget.reason)}</p>
        )}
        {!targetMissing && !failoverTargetLoading && <p className="text-xs text-muted-foreground">{L.plan.targetHelp}</p>}
      </div>

      {/* Mode -------------------------------------------------------------- */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-foreground">{L.plan.modeLabel}</span>
        <RadioGroup
          value={mode}
          onValueChange={(value) => onModeChange(value as FailoverWizardMode)}
          className="gap-2"
          aria-label={L.plan.modeLabel}
        >
          <label
            htmlFor="dr-failover-mode-drill"
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3',
              mode === 'drill' ? 'border-primary bg-primary/5' : 'border-border',
            )}
          >
            <RadioGroupItem value="drill" id="dr-failover-mode-drill" className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">{L.plan.modeDrill}</span>
              <span className="block text-xs text-muted-foreground">{L.plan.modeDrillHint}</span>
            </span>
          </label>
          <label
            htmlFor="dr-failover-mode-real"
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3',
              mode === 'real' ? 'border-destructive bg-destructive/5' : 'border-border',
            )}
          >
            <RadioGroupItem value="real" id="dr-failover-mode-real" className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">{L.plan.modeReal}</span>
              <span className="block text-xs text-muted-foreground">{L.plan.modeRealHint}</span>
            </span>
          </label>
        </RadioGroup>
        <p className="text-xs text-muted-foreground">{L.plan.modeHelp}</p>
      </div>
    </section>
  );
}

function ImpactStep({
  mode,
  groupName,
  selectedPoint,
  selectedTargetName,
  rtoObjectiveSeconds,
  rpoObjectiveSeconds,
}: {
  mode: FailoverWizardMode;
  groupName: string;
  selectedPoint: DRRecoveryPoint | null;
  selectedTargetName: string | null;
  rtoObjectiveSeconds: number | null;
  rpoObjectiveSeconds: number | null;
}) {
  const L = useFailoverWizardLabels();
  const rows: Array<{ label: string; value: string }> = [
    {
      label: L.impact.rowMode,
      value: mode === 'real' ? L.impact.modeRealValue : L.impact.modeDrillValue,
    },
    { label: L.impact.rowGroup, value: groupName },
    {
      label: L.impact.rowRecoveryPoint,
      value: selectedPoint
        ? `${formatPointTime(selectedPoint.sealed_at)} · ${L.plan.recoveryPointRpo(
            formatRecoveryDuration(selectedPoint.rpo_seconds),
          )}`
        : L.impact.rowRecoveryPointLatest,
    },
    {
      label: L.impact.rowTarget,
      value: selectedTargetName ?? L.plan.targetNone,
    },
    {
      label: L.impact.rowRtoObjective,
      value: formatRecoveryDuration(rtoObjectiveSeconds),
    },
    {
      label: L.impact.rowRpoObjective,
      value: formatRecoveryDuration(rpoObjectiveSeconds),
    },
  ];

  return (
    <section className="space-y-4" aria-labelledby="dr-impact-heading">
      <div className="space-y-1.5">
        <h3 id="dr-impact-heading" className="text-sm font-semibold text-foreground">
          {L.impact.heading}
        </h3>
        <p className="text-sm text-muted-foreground">{L.impact.description}</p>
      </div>

      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {row.label}
            </dt>
            <dd className="text-sm font-medium text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>

      {mode === 'real' && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>{L.impact.realCutoverWarningTitle}</AlertTitle>
          <AlertDescription>{L.impact.realCutoverWarningBody}</AlertDescription>
        </Alert>
      )}

      <p className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
        {L.impact.gatesNote}
      </p>
    </section>
  );
}

function ConfirmStep({
  mode,
  phrase,
  value,
  onChange,
  matches,
  canFailover,
}: {
  mode: FailoverWizardMode;
  phrase: string;
  value: string;
  onChange: (value: string) => void;
  matches: boolean;
  /** Holds the `dr:failover` step-up permission; gates the declaration. */
  canFailover: boolean;
}) {
  const L = useFailoverWizardLabels();
  return (
    <section className="space-y-4" aria-labelledby="dr-confirm-heading">
      <div className="space-y-1.5">
        <h3 id="dr-confirm-heading" className="text-sm font-semibold text-foreground">
          {L.confirm.heading}
        </h3>
        <p className="text-sm text-muted-foreground">{L.confirm.description}</p>
      </div>

      {!canFailover && (
        <Alert variant="warning">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>{L.confirm.stepUpRequired}</AlertTitle>
        </Alert>
      )}

      <div className="space-y-2">
        <p className="text-sm text-foreground">
          {mode === 'real' ? L.confirm.phraseLabelReal : L.confirm.phraseLabelDrill}{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-semibold text-foreground">
            {phrase}
          </code>
        </p>
        <Label htmlFor="dr-failover-confirm">{L.confirm.inputLabel}</Label>
        <Input
          id="dr-failover-confirm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={L.confirm.inputPlaceholder}
          autoComplete="off"
          aria-invalid={value.length > 0 && !matches}
          aria-describedby={value.length > 0 && !matches ? 'dr-failover-confirm-error' : undefined}
        />
        {value.length > 0 && !matches && (
          <p id="dr-failover-confirm-error" className="text-xs text-destructive">
            {L.confirm.mismatch}
          </p>
        )}
      </div>
    </section>
  );
}
