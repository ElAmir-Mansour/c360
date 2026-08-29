'use client';

import {
  ArchiveRestore,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  KeyRound,
  Layers3,
  LockKeyhole,
  PlayCircle,
  Radio,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import { useOperationalPanelsLabels, type OperationalPanelsLabels } from './dr-operational-panels-labels';

type ConsoleTab = 'dashboard' | 'groups' | 'replication' | 'failover' | 'evidence' | 'readiness';

type HealthStatus = string | null | undefined;

type StreamShape = {
  stream_id?: string;
  site_name?: string | null;
  site_id?: string | null;
  health?: HealthStatus;
  status?: HealthStatus;
  rpo_seconds?: number | null;
  rpo_objective_seconds?: number | null;
  lag_seconds?: number | null;
  breaches_rpo?: boolean;
  measured_at?: string | Date | null;
  applied_at?: string | Date | null;
};

type RecoveryPointShape = {
  id?: string;
  marker_lsn?: string;
  rpo_seconds?: number | null;
  validation_ratio?: number | null;
  is_validated?: boolean;
  legal_hold?: boolean;
  content_hash?: string | null;
  sealed_at?: string | Date | null;
  retention_until?: string | Date | null;
};

type RunShape = {
  id?: string;
  run_id?: string;
  mode?: string;
  status?: HealthStatus;
  group_id?: string | null;
  rto_objective_seconds?: number | null;
  rto_actual_seconds?: number | null;
  met_rto?: boolean | null;
  recovery_point_id?: string | null;
  initiated_at?: string | Date | null;
};

type GroupShape = {
  id?: string;
  group_id?: string;
  groupId?: string;
  name?: string | null;
  health?: HealthStatus;
  member_count?: number | null;
  stream_count?: number | null;
  replication_percent?: number | null;
  rpo_objective_seconds?: number | null;
  rto_objective_seconds?: number | null;
  worst_live_rpo?: StreamShape | null;
  latest_recovery_point?: RecoveryPointShape | null;
  last_run?: RunShape | null;
};

type EvidenceShape = {
  immutable_reports?: number | null;
  worm_locked_count?: number | null;
  hash_chain_status?: HealthStatus;
  evidence_recency_days?: number | null;
  latest_attestation?: {
    id?: string;
    report_id?: string;
    status?: HealthStatus;
    result?: HealthStatus;
    content_hash?: string | null;
    created_at?: string | Date | null;
    generated_at?: string | Date | null;
  } | null;
  reports?: Array<unknown>;
  control_results?: Array<{
    control?: string;
    status?: HealthStatus;
    evidence_ref?: string;
  }>;
};

type ReadinessShape = {
  readiness_score?: number | null;
  generated_at?: string | Date | null;
  data_residency?: {
    status?: string;
    region?: string;
    enforced?: boolean;
  };
  air_gap?: {
    ready?: boolean;
    bundle_version?: string;
    last_verified_at?: string | Date | null;
  };
  encryption?: {
    at_rest?: string;
    key_custody?: string;
    rotation_status?: HealthStatus;
  };
  frameworks?: Array<{
    name?: string;
    score?: number | null;
    status?: HealthStatus;
    gaps?: number | null;
  }>;
  controls?: Array<{
    name?: string;
    status?: HealthStatus;
    detail?: string;
  }>;
};

type PostureShape = {
  recovery_point_count?: number | null;
  attention?: Array<unknown>;
  rpo_breaches?: StreamShape[];
};

const RECOVERY_TIERS = [
  { key: 'tier-0', maxRtoSeconds: 900 },
  { key: 'tier-1', maxRtoSeconds: 3600 },
  { key: 'tier-2', maxRtoSeconds: 14_400 },
  { key: 'tier-3', maxRtoSeconds: Number.POSITIVE_INFINITY },
] as const;

type RecoveryTierKey = (typeof RECOVERY_TIERS)[number]['key'];

export function DROperatorActions({
  groupCount,
  streamCount,
  rpoBreachCount,
  latestRecoveryPoint,
  activeRun,
  gateIndex,
  evidenceReportCount,
  readinessScore,
  onOpenTab,
}: {
  groupCount: number;
  streamCount: number;
  rpoBreachCount: number;
  latestRecoveryPoint?: RecoveryPointShape | null;
  activeRun?: RunShape | null;
  gateIndex: number;
  evidenceReportCount: number;
  readinessScore: number | null;
  onOpenTab: (tab: ConsoleTab) => void;
}) {
  const labels = useOperationalPanelsLabels();
  const t = labels.operatorActions;
  const hasValidatedPoint = Boolean(latestRecoveryPoint?.id && latestRecoveryPoint.is_validated);
  const hasActionableRun = Boolean(activeRun && !terminalRunStatus(activeRun.status));
  const actions = [
    {
      label: t.reviewGroups,
      description: groupCount > 0 ? t.groupsProtected(groupCount) : t.configureGroupFirst,
      icon: Layers3,
      enabled: groupCount > 0,
      tab: 'groups' as const,
    },
    {
      label: t.validatePoint,
      description: latestRecoveryPoint?.id
        ? latestRecoveryPoint.is_validated
          ? t.latestPointValidated
          : t.validationPending
        : t.noSealedPoint,
      icon: ClipboardCheck,
      enabled: Boolean(latestRecoveryPoint?.id),
      tab: 'groups' as const,
    },
    {
      label: t.triageRpo,
      description:
        rpoBreachCount > 0 ? t.breachesNeedReview(rpoBreachCount) : t.streamsWithinObjective(streamCount),
      icon: Radio,
      enabled: streamCount > 0 && rpoBreachCount > 0,
      tab: 'replication' as const,
    },
    {
      label: t.advanceRun,
      description: activeRun
        ? t.runAtGate(activeRun.mode ?? t.runFallback, Math.min(4, Math.max(1, gateIndex + 1)))
        : t.noActiveRunToAdvance,
      icon: PlayCircle,
      enabled: hasValidatedPoint && hasActionableRun,
      tab: 'failover' as const,
    },
    {
      label: t.exportEvidence,
      description: evidenceReportCount > 0 ? t.reportsReady(evidenceReportCount) : t.attestationRequiredFirst,
      icon: FileCheck2,
      enabled: evidenceReportCount > 0,
      tab: 'evidence' as const,
    },
    {
      label: t.reviewControls,
      description: readinessScore === null ? t.readinessNotScored : t.readinessPercent(readinessScore),
      icon: ShieldCheck,
      enabled: readinessScore !== null,
      tab: 'readiness' as const,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant={action.enabled ? 'outline' : 'secondary'}
              className={cn(
                'h-auto min-h-[78px] justify-start gap-3 whitespace-normal px-3 py-3 text-start',
                !action.enabled && 'opacity-70',
              )}
              disabled={!action.enabled}
              title={action.enabled ? action.label : action.description}
              onClick={() => onOpenTab(action.tab)}
            >
              <ActionIcon icon={action.icon} enabled={action.enabled} />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-5">{action.label}</span>
                <span className="mt-1 block text-xs leading-4 text-muted-foreground">{action.description}</span>
              </span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function RecoveryTierSummary({
  groups,
  onOpenGroup,
}: {
  groups: GroupShape[];
  onOpenGroup: (groupId: string) => void;
}) {
  const L = useOperationalPanelsLabels();
  const tiers = RECOVERY_TIERS.map((tier) => {
    const members = groups.filter((group) => tierForGroup(group) === tier.key);
    const ready = members.filter(isGroupReady).length;
    const worstRpo = maxNumber(members.map((group) => group.worst_live_rpo?.rpo_seconds));
    const weakest = [...members].sort((left, right) => groupReadinessScore(left) - groupReadinessScore(right))[0];

    return {
      ...tier,
      members,
      ready,
      worstRpo,
      weakest,
    };
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{L.recoveryTiers.title}</CardTitle>
          <CardDescription>{L.recoveryTiers.description}</CardDescription>
        </div>
        <Badge variant="outline">{L.recoveryTiers.groupsBadge(groups.length)}</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {tiers.map((tier) => {
            const readyPct = tier.members.length > 0 ? Math.round((tier.ready / tier.members.length) * 100) : 0;
            const weakestId = tier.weakest ? groupId(tier.weakest) : null;
            const tl = L.recoveryTiers.tiers[tier.key];

            return (
              <div
                key={tier.key}
                className={cn('kpi-card-themed', TONE_THEME_CLASS[tierTone(tier.members.length, readyPct)])}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{tl.label}</div>
                    <div className="text-xs text-muted-foreground">{tl.description}</div>
                  </div>
                  <Badge variant={tier.ready === tier.members.length && tier.members.length > 0 ? 'success' : 'outline'}>
                    {tl.target}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <MiniDatum label={L.recoveryTiers.ready} value={`${tier.ready}/${tier.members.length}`} />
                  <MiniDatum label={L.recoveryTiers.worstRpo} value={formatSeconds(tier.worstRpo)} />
                </div>
                <Progress
                  value={readyPct}
                  className="mt-3 h-2"
                  indicatorClassName={readyPct < 50 ? 'bg-error-500' : readyPct < 85 ? 'bg-amber-500' : 'bg-primary'}
                />
                <div className="mt-3 min-h-9 text-xs text-muted-foreground">
                  {tier.weakest ? (
                    <>
                      {L.recoveryTiers.weakest}:{' '}
                      <span className="font-medium text-foreground">{tier.weakest.name ?? weakestId}</span>
                    </>
                  ) : (
                    L.recoveryTiers.noGroupsInTier
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="mt-2 h-8 px-2"
                  disabled={!weakestId}
                  onClick={() => weakestId && onOpenGroup(weakestId)}
                >
                  {L.recoveryTiers.inspectTier}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function RecoveryPointValidationPanel({
  groups,
  selectedGroup,
  onOpenGroup,
}: {
  groups: GroupShape[];
  selectedGroup?: GroupShape | null;
  onOpenGroup: (groupId: string) => void;
}) {
  const labels = useOperationalPanelsLabels();
  const t = labels.recoveryPointValidation;
  const rows = dedupeGroups(selectedGroup ? [selectedGroup, ...groups] : groups)
    .map((group) => ({
      group,
      point: group.latest_recovery_point ?? null,
      readiness: groupReadinessScore(group),
    }))
    .sort((left, right) => left.readiness - right.readiness);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{t.title}</CardTitle>
          <CardDescription>{t.description}</CardDescription>
        </div>
        <Badge variant="outline">
          {t.validatedBadge(rows.filter((row) => row.point?.is_validated).length, rows.length)}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colGroup}</TableHead>
                <TableHead>{t.colPoint}</TableHead>
                <TableHead>{t.colValidation}</TableHead>
                <TableHead>{t.colRpo}</TableHead>
                <TableHead>{t.colRetention}</TableHead>
                <TableHead>{t.colHash}</TableHead>
                <TableHead>{t.colAction}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    {t.emptyRow}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(({ group, point }) => {
                  const id = groupId(group);
                  const validationPct = point?.is_validated
                    ? 100
                    : percentFromRatio(point?.validation_ratio) ?? (point ? 50 : 0);
                  return (
                    <TableRow key={id}>
                      <TableCell>
                        <div className="font-medium">{group.name ?? id}</div>
                        <div className="font-mono text-xs text-muted-foreground">{id}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{point?.id ?? t.noSealedPointCell}</div>
                        <div className="text-xs text-muted-foreground">{t.markerPrefix(point?.marker_lsn ?? '-')}</div>
                      </TableCell>
                      <TableCell className="min-w-44">
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <StatusBadge status={point?.is_validated ? 'healthy' : point ? 'warning' : 'empty'} label={point?.is_validated ? t.validated : point ? t.pending : t.missing} />
                          <span className="font-medium">{validationPct}%</span>
                        </div>
                        <Progress
                          value={validationPct}
                          className="h-2"
                          indicatorClassName={validationPct < 70 ? 'bg-amber-500' : 'bg-primary'}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{formatSeconds(point?.rpo_seconds ?? group.worst_live_rpo?.rpo_seconds)}</div>
                        <div className="text-xs text-muted-foreground">{t.targetPrefix(formatSeconds(group.rpo_objective_seconds))}</div>
                      </TableCell>
                      <TableCell>
                        <div>{formatDate(point?.retention_until)}</div>
                        <div className="text-xs text-muted-foreground">{point?.legal_hold ? t.legalHold : t.policyRetention}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{shortHash(point?.content_hash)}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!point?.id}
                          onClick={() => onOpenGroup(id)}
                        >
                          {t.openGroup}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function CyberVaultCompliancePanel({
  evidence,
  readiness,
  posture,
  onOpenEvidence,
  onOpenReadiness,
}: {
  evidence?: EvidenceShape;
  readiness?: ReadinessShape;
  posture?: PostureShape;
  onOpenEvidence: () => void;
  onOpenReadiness: () => void;
}) {
  const labels = useOperationalPanelsLabels();
  const t = labels.cyberVault;
  const readinessScore = clampPercent(readiness?.readiness_score);
  const reports = evidence?.reports?.length ?? evidence?.immutable_reports ?? 0;
  const lockedPoints = evidence?.worm_locked_count ?? posture?.recovery_point_count ?? 0;
  const controls = [
    {
      label: t.immutableVault,
      value: t.lockedArtifacts(lockedPoints),
      status: lockedPoints > 0 ? 'healthy' : 'warning',
      icon: LockKeyhole,
    },
    {
      label: t.hashChain,
      value: evidence?.latest_attestation?.content_hash
        ? shortHash(evidence.latest_attestation.content_hash)
        : evidence?.hash_chain_status ?? t.notAnchored,
      status: evidence?.hash_chain_status ?? (reports > 0 ? 'healthy' : 'warning'),
      icon: FileCheck2,
    },
    {
      label: t.keyCustody,
      value: readiness?.encryption?.key_custody ?? t.noActiveKey,
      status: readiness?.encryption?.rotation_status ?? 'warning',
      icon: KeyRound,
    },
    {
      label: t.airGap,
      value: readiness?.air_gap?.bundle_version ?? t.bundleNotReported,
      status: readiness?.air_gap?.ready === false ? 'warning' : 'healthy',
      icon: ArchiveRestore,
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{t.title}</CardTitle>
          <CardDescription>{t.description}</CardDescription>
        </div>
        <Badge variant={readinessScore !== null && readinessScore >= 90 ? 'success' : 'warning'}>
          {readinessScore === null ? t.unscored : t.readyPercent(readinessScore)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {controls.map((control) => (
            <div
              key={control.label}
              className={cn('kpi-card-themed', TONE_THEME_CLASS[statusTone(control.status)])}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="kpi-icon-badge shrink-0">
                  <control.icon className="h-4 w-4" aria-hidden />
                </div>
                <StatusBadge status={control.status} />
              </div>
              <div className="mt-3 text-sm font-medium text-foreground">{control.label}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">{control.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{t.packageGates}</div>
                <div className="text-xs text-muted-foreground">{t.packageGatesDesc}</div>
              </div>
              <Badge variant="outline">{t.reportsBadge(reports)}</Badge>
            </div>
            <div className="space-y-2">
              <GateLine label={t.gateValidatedPoint} passed={lockedPoints > 0} gate={labels.gateLine} />
              <GateLine label={t.gateAttestation} passed={reports > 0} gate={labels.gateLine} />
              <GateLine label={t.gateHashContinuity} passed={normalizeStatus(evidence?.hash_chain_status) !== 'warning'} gate={labels.gateLine} />
              <GateLine label={t.gateControlsScored} passed={readinessScore !== null} gate={labels.gateLine} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={reports === 0} onClick={onOpenEvidence}>
                <FileCheck2 className="me-1.5 h-3.5 w-3.5" />
                {t.exportAttestation}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={readinessScore === null || readinessScore < 80 || reports === 0}
                onClick={onOpenReadiness}
              >
                <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
                {t.regulatorPackage}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{t.frameworkCoverage}</div>
                <div className="text-xs text-muted-foreground">{t.frameworkCoverageDesc}</div>
              </div>
              <Badge variant="outline">{t.packsBadge(readiness?.frameworks?.length ?? 0)}</Badge>
            </div>
            <div className="space-y-3">
              {(readiness?.frameworks ?? []).slice(0, 3).map((framework) => {
                const score = clampPercent(framework.score) ?? 0;
                return (
                  <div key={framework.name ?? 'framework'} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium">{framework.name ?? t.compliancePack}</span>
                      <span className="text-muted-foreground">{t.gapsSuffix(framework.gaps ?? 0)}</span>
                    </div>
                    <Progress
                      value={score}
                      className="h-2"
                      indicatorClassName={score < 75 ? 'bg-amber-500' : 'bg-primary'}
                    />
                  </div>
                );
              })}
              {(readiness?.frameworks ?? []).length === 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  {t.noPacks}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionIcon({ icon: Icon, enabled }: { icon: LucideIcon; enabled: boolean }) {
  return (
    <span
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
        enabled ? 'border-primary/30 bg-primary/10 text-primary' : 'border-muted bg-muted text-muted-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function GateLine({
  label,
  passed,
  gate,
}: {
  label: string;
  passed: boolean;
  gate: OperationalPanelsLabels['gateLine'];
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
      <span>{label}</span>
      <Badge variant={passed ? 'success' : 'warning'} className="gap-1">
        {passed ? <CheckCircle2 className="h-3 w-3" /> : <Timer className="h-3 w-3" />}
        {passed ? gate.ready : gate.blocked}
      </Badge>
    </div>
  );
}

function MiniDatum({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status: HealthStatus; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error'
      ? 'destructive'
      : normalized === 'warning' || normalized === 'degraded' || normalized === 'paused' || normalized === 'pending'
        ? 'warning'
        : normalized === 'healthy' || normalized === 'completed' || normalized === 'passed' || normalized === 'attested' || normalized === 'active'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label ?? labelFor(normalized)}</span>
    </Badge>
  );
}

function tierForGroup(group: GroupShape) {
  const rto = group.rto_objective_seconds ?? Number.POSITIVE_INFINITY;
  return RECOVERY_TIERS.find((tier) => rto <= tier.maxRtoSeconds)?.key ?? 'tier-3';
}

function isGroupReady(group: GroupShape) {
  const health = normalizeStatus(group.health);
  return (
    group.latest_recovery_point?.is_validated === true &&
    (group.replication_percent ?? 0) >= 95 &&
    group.worst_live_rpo?.breaches_rpo !== true &&
    !['critical', 'failed', 'error', 'paused', 'empty'].includes(health)
  );
}

function groupReadinessScore(group: GroupShape) {
  let score = 0;
  if (group.latest_recovery_point?.is_validated) score += 35;
  if ((group.replication_percent ?? 0) >= 95) score += 30;
  else score += Math.max(0, Math.min(25, Math.round((group.replication_percent ?? 0) / 4)));
  if (group.worst_live_rpo?.breaches_rpo !== true) score += 20;
  if (!['critical', 'failed', 'error', 'paused', 'empty'].includes(normalizeStatus(group.health))) score += 15;
  return score;
}

function dedupeGroups(groups: GroupShape[]) {
  const seen = new Set<string>();
  return groups.filter((group) => {
    const id = groupId(group);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function groupId(group: GroupShape) {
  return group.group_id ?? group.groupId ?? group.id ?? 'unknown-group';
}

function terminalRunStatus(status: HealthStatus) {
  return ['completed', 'failed', 'cancelled', 'rolled_back', 'attested'].includes(normalizeStatus(status));
}

function normalizeStatus(status: HealthStatus) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

/**
 * Map a RAG health/status token onto the shared `StatTone` accent vocabulary so
 * the cyber-vault control tiles ride a tonal surface even when empty: healthy ->
 * emerald (health), warning/degraded/paused -> gold (watch), critical/failed/
 * error -> rose (risk), and an unknown/empty status -> slate (type).
 */
function statusTone(status: HealthStatus): StatTone {
  const normalized = normalizeStatus(status);
  if (normalized === 'critical' || normalized === 'failed' || normalized === 'error') return 'rose';
  if (normalized === 'warning' || normalized === 'degraded' || normalized === 'paused') return 'gold';
  if (
    normalized === 'healthy' ||
    normalized === 'completed' ||
    normalized === 'passed' ||
    normalized === 'attested' ||
    normalized === 'active'
  ) {
    return 'emerald';
  }
  return 'slate';
}

/**
 * Tone a recovery-tier tile by its readiness: an empty tier (no members) reads
 * `slate` (type/placeholder), a fully-ready tier reads `emerald` (health), a
 * low-readiness tier reads `rose` (risk), and a partially-ready tier reads
 * `gold` (in-progress).
 */
function tierTone(memberCount: number, readyPct: number): StatTone {
  if (memberCount === 0) return 'slate';
  if (readyPct >= 85) return 'emerald';
  if (readyPct < 50) return 'rose';
  return 'gold';
}

function labelFor(status: string) {
  return status.replace(/_/g, ' ');
}

function clampPercent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function percentFromRatio(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return clampPercent(value <= 1 ? value * 100 : value);
}

function maxNumber(values: Array<number | null | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return numbers.length > 0 ? Math.max(...numbers) : undefined;
}

function formatSeconds(seconds?: number | null) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${hours}h ${minRem}m` : `${hours}h`;
}

function formatDate(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
