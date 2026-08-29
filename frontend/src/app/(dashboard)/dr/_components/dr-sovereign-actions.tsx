'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  ClipboardCheck,
  FileKey2,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  ShieldQuestion,
  Vault,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
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
import type {
  DRBCMAssessmentRunResponse,
  DRBCMControl,
  DRBCMGap,
  DRBCMPack,
  DRBCMVerdict,
  DRBYOKCustodyEntry,
  DRBYOKCustodyLog,
  DRBYOKKey,
  DRCyberVault,
  DRCyberVaultFinding,
  DRCyberVaultStoredPostureAssessment,
  DRCyberVaultVerdict,
} from '@/types/clario-dr';
import {
  type SovereignActionsLabels,
  useSovereignActionsLabels,
} from './dr-sovereign-actions-labels';

export type DRSovereignActionsPanelProps = {
  selectedGroupId?: string | null;
  selectedGroupName?: string | null;
  bcmPacks: DRBCMPack[];
  byokKeys: DRBYOKKey[];
  byokCustodyLog?: DRBYOKCustodyLog | null;
  cyberVaults: DRCyberVault[];
  cyberVaultAssessments: DRCyberVaultStoredPostureAssessment[];
  latestBcmAssessment?: DRBCMAssessmentRunResponse | null;
  latestByokKey?: DRBYOKKey | null;
  latestVaultAssessment?: DRCyberVaultStoredPostureAssessment | null;
  loading: boolean;
  assessingBcm: boolean;
  rotatingByok: boolean;
  evaluatingVault: boolean;
  error: unknown;
  onAssessBcm: (packKey: string) => void;
  onRotateByok: () => void;
  onEvaluateVault: (vaultID: string) => void;
  onRetry: () => void;
};

type Tone = 'success' | 'warning' | 'critical' | 'info' | 'neutral';

export function DRSovereignActionsPanel({
  selectedGroupId,
  selectedGroupName,
  bcmPacks,
  byokKeys,
  byokCustodyLog,
  cyberVaults,
  cyberVaultAssessments,
  latestBcmAssessment,
  latestByokKey,
  latestVaultAssessment,
  loading,
  assessingBcm,
  rotatingByok,
  evaluatingVault,
  error,
  onAssessBcm,
  onRotateByok,
  onEvaluateVault,
  onRetry,
}: DRSovereignActionsPanelProps) {
  const L = useSovereignActionsLabels();
  const [selectedPackKey, setSelectedPackKey] = useState<string | null>(null);
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);

  const sortedPacks = useMemo(() => [...bcmPacks].sort((left, right) => left.standard.localeCompare(right.standard) || left.key.localeCompare(right.key)), [bcmPacks]);
  const sortedKeys = useMemo(() => [...byokKeys].sort((left, right) => right.key_version - left.key_version || timestampMs(right.updated_at) - timestampMs(left.updated_at)), [byokKeys]);
  const sortedVaults = useMemo(
    () =>
      [...cyberVaults].sort((left, right) => {
        const leftGroupMatch = selectedGroupId && left.group_id === selectedGroupId ? 0 : 1;
        const rightGroupMatch = selectedGroupId && right.group_id === selectedGroupId ? 0 : 1;
        return leftGroupMatch - rightGroupMatch || left.name.localeCompare(right.name);
      }),
    [cyberVaults, selectedGroupId],
  );
  const sortedVaultAssessments = useMemo(
    () => [...cyberVaultAssessments].sort((left, right) => timestampMs(right.EvaluatedAt ?? right.CreatedAt) - timestampMs(left.EvaluatedAt ?? left.CreatedAt)),
    [cyberVaultAssessments],
  );
  const recentCustodyEntries = useMemo(
    () => [...(byokCustodyLog?.entries ?? [])].sort((left, right) => right.seq - left.seq).slice(0, 5),
    [byokCustodyLog?.entries],
  );

  const selectedPack =
    sortedPacks.find((pack) => pack.key === selectedPackKey) ??
    sortedPacks.find((pack) => pack.key === latestBcmAssessment?.assessment.pack_key) ??
    sortedPacks[0] ??
    null;
  const selectedVault =
    sortedVaults.find((vault) => vault.id && vault.id === selectedVaultId) ??
    sortedVaults.find((vault) => vault.id && vault.id === latestVaultAssessment?.VaultID) ??
    sortedVaults.find((vault) => Boolean(vault.id)) ??
    null;
  const selectedVaultAssessment =
    selectedVault?.id
      ? sortedVaultAssessments.find((assessment) => assessment.VaultID === selectedVault.id) ?? null
      : latestVaultAssessment ?? sortedVaultAssessments[0] ?? null;
  const activeKeys = sortedKeys.filter((key) => isActiveKeyState(key.state));
  const effectiveLatestKey = latestByokKey ?? sortedKeys[0] ?? null;
  const latestBcmScore = clampPercent(latestBcmAssessment?.score);
  const latestVaultScore = clampPercent(selectedVaultAssessment?.Score);
  const custodyEntryCount = byokCustodyLog?.entries?.length ?? 0;
  const groupLabel = selectedGroupName ?? selectedGroupId ?? L.noGroupSelected;
  const hasData = Boolean(
    bcmPacks.length > 0 ||
      byokKeys.length > 0 ||
      byokCustodyLog ||
      cyberVaults.length > 0 ||
      cyberVaultAssessments.length > 0 ||
      latestBcmAssessment ||
      latestVaultAssessment,
  );

  if (loading && !hasData) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && !hasData) {
    return <ErrorState message={L.loadError} onRetry={onRetry} />;
  }

  const assessDisabled = loading || assessingBcm || !selectedGroupId || !selectedPack;
  const rotateDisabled = loading || rotatingByok;
  const evaluateDisabled = loading || evaluatingVault || !selectedVault?.id;
  const custodyStatus = byokCustodyLog?.intact === true ? 'healthy' : byokCustodyLog?.intact === false ? 'failed' : 'pending';

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{formatError(error, L)}</span>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            {L.retry}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SovereignMetric
          title={L.metricBcmPacks}
          value={latestBcmScore === null ? sortedPacks.length : `${latestBcmScore}%`}
          detail={latestBcmAssessment ? L.controlsSatisfied(latestBcmAssessment.assessment.satisfied, latestBcmAssessment.assessment.total_controls) : L.packsAvailable(sortedPacks.length)}
          icon={ClipboardCheck}
          tone={scoreTone(latestBcmScore, sortedPacks.length > 0)}
        />
        <SovereignMetric
          title={L.metricActiveByok}
          value={activeKeys.length}
          detail={effectiveLatestKey ? L.keyDetail(effectiveLatestKey.key_version, labelFor(effectiveLatestKey.state), effectiveLatestKey.provider) : L.noKeyMaterial}
          icon={KeyRound}
          tone={activeKeys.length > 0 ? 'success' : byokKeys.length > 0 ? 'warning' : 'neutral'}
        />
        <SovereignMetric
          title={L.metricCustodyChain}
          value={byokCustodyLog?.intact === true ? L.custodyIntact : byokCustodyLog?.intact === false ? L.custodyBroken : L.custodyPending}
          detail={byokCustodyLog ? L.custodyDetail(custodyEntryCount, shortHash(byokCustodyLog.merkle_root)) : L.noCustodyLog}
          icon={FileKey2}
          tone={byokCustodyLog?.intact === true ? 'success' : byokCustodyLog?.intact === false ? 'critical' : 'warning'}
        />
        <SovereignMetric
          title={L.metricVaultScore}
          value={latestVaultScore === null ? L.na : `${latestVaultScore}%`}
          detail={selectedVaultAssessment ? L.verdictFindings(labelFor(selectedVaultAssessment.Verdict), selectedVaultAssessment.Assessment.findings.length) : L.vaultsAvailable(cyberVaults.length)}
          icon={Vault}
          tone={scoreTone(latestVaultScore, cyberVaults.length > 0)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.actionsTitle}</CardTitle>
              <CardDescription>{L.actionsDescription}</CardDescription>
            </div>
            {loading ? <StatusBadge status="pending" label={L.refreshing} /> : <StatusBadge status={selectedGroupId ? 'ready' : 'pending'} />}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MiniDatum label={L.selectedGroup} value={groupLabel} />
              <MiniDatum label={L.bcmPack} value={selectedPack ? selectedPack.standard : L.na} />
              <MiniDatum label={L.vault} value={selectedVault?.name ?? L.na} />
            </div>

            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
              <ActionButton
                label={L.assessBcmPack}
                loadingText={L.assessLoading}
                description={assessDisabled ? bcmAssessDisabledReason(selectedGroupId, selectedPack, L) : L.packVersion(selectedPack?.standard ?? '', selectedPack?.version ?? '')}
                icon={ClipboardCheck}
                loading={assessingBcm}
                disabled={assessDisabled}
                onClick={() => selectedPack && onAssessBcm(selectedPack.key)}
              />
              <ActionButton
                label={L.rotateByokKey}
                loadingText={L.rotateLoading}
                description={effectiveLatestKey ? L.currentKey(effectiveLatestKey.key_version, labelFor(effectiveLatestKey.state)) : L.createFirstKey}
                icon={RotateCw}
                loading={rotatingByok}
                disabled={rotateDisabled}
                onClick={onRotateByok}
              />
              <ActionButton
                label={L.evaluateCyberVault}
                loadingText={L.evaluateLoading}
                description={selectedVault?.id ? L.vaultProvider(selectedVault.name, labelFor(selectedVault.provider)) : L.noVaultId}
                icon={Vault}
                loading={evaluatingVault}
                disabled={evaluateDisabled}
                onClick={() => selectedVault?.id && onEvaluateVault(selectedVault.id)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.gatesTitle}</CardTitle>
              <CardDescription>{L.gatesDescription}</CardDescription>
            </div>
            <StatusBadge status={overallReadinessStatus(latestBcmScore, activeKeys.length, byokCustodyLog, latestVaultScore)} />
          </CardHeader>
          <CardContent className="space-y-2">
            <ReadinessLine
              icon={ShieldQuestion}
              label={L.gateGroupScope}
              ready={Boolean(selectedGroupId)}
              detail={selectedGroupId ? L.gateGroupScopeReady(groupLabel) : L.gateGroupScopePending}
            />
            <ReadinessLine
              icon={ClipboardCheck}
              label={L.gateBcmCurrent}
              ready={latestBcmScore !== null && latestBcmScore >= 80}
              detail={latestBcmAssessment ? L.gateBcmCurrentReady(latestBcmScore ?? 0, latestBcmAssessment.assessment.standard) : L.gateBcmCurrentPending}
            />
            <ReadinessLine
              icon={KeyRound}
              label={L.gateByokCustody}
              ready={activeKeys.length > 0 && byokCustodyLog?.intact === true}
              detail={activeKeys.length > 0 ? L.gateByokCustodyReady(activeKeys.length, labelFor(custodyStatus)) : L.gateByokCustodyPending}
            />
            <ReadinessLine
              icon={LockKeyhole}
              label={L.gateVaultPosture}
              ready={latestVaultScore !== null && latestVaultScore >= 80}
              detail={selectedVaultAssessment ? L.gateVaultPostureReady(latestVaultScore ?? 0, labelFor(selectedVaultAssessment.Verdict), selectedVaultAssessment.Posture.name ?? selectedVault?.name ?? L.selectedVaultFallback) : L.gateVaultPosturePending()}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.bcmTitle}</CardTitle>
              <CardDescription>{L.bcmDescription}</CardDescription>
            </div>
            <StatusBadge status={latestBcmAssessment?.compliant ? 'satisfied' : latestBcmAssessment ? 'partial' : 'pending'} label={latestBcmAssessment?.compliant ? L.bcmCompliant : latestBcmAssessment ? L.bcmReviewGaps : L.bcmNotAssessed} />
          </CardHeader>
          <CardContent className="space-y-4">
            <PackChooser packs={sortedPacks} selectedKey={selectedPack?.key ?? null} onSelect={setSelectedPackKey} L={L} />

            {selectedPack ? (
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{selectedPack.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {L.packAuthority(selectedPack.authority, selectedPack.standard, selectedPack.version)}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 normal-case tracking-normal">
                    {L.controlsBadge(selectedPack.controls.length)}
                  </Badge>
                </div>
                <div className="mt-3 line-clamp-2 text-xs text-muted-foreground">{selectedPack.description}</div>
              </div>
            ) : (
              <EmptyLine icon={ClipboardCheck} text={L.noBcmPacks} />
            )}

            {latestBcmAssessment ? (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MiniDatum label={L.colScore} value={`${latestBcmScore ?? 0}%`} />
                  <MiniDatum label={L.colSatisfied} value={latestBcmAssessment.assessment.satisfied} />
                  <MiniDatum label={L.colPartial} value={latestBcmAssessment.assessment.partial} />
                  <MiniDatum label={L.colFailed} value={latestBcmAssessment.assessment.failed} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-muted-foreground">{L.controlCoverage}</span>
                    <span className="font-semibold">{latestBcmScore ?? 0}%</span>
                  </div>
                  <Progress
                    value={latestBcmScore ?? 0}
                    className="h-2"
                    indicatorClassName={(latestBcmScore ?? 0) < 80 ? 'bg-amber-500' : 'bg-primary'}
                  />
                </div>
                <GapList gaps={latestBcmAssessment.gaps} controls={selectedPack?.controls ?? []} L={L} />
              </>
            ) : (
              <EmptyLine icon={ArchiveRestore} text={L.noAssessmentLoaded} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.byokTitle}</CardTitle>
              <CardDescription>{L.byokDescription}</CardDescription>
            </div>
            <StatusBadge status={custodyStatus} label={byokCustodyLog?.intact === true ? L.chainIntact : byokCustodyLog?.intact === false ? L.chainBroken : L.notVerified} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={L.latestKey} value={effectiveLatestKey ? `v${effectiveLatestKey.key_version}` : L.na} />
              <MiniDatum label={L.provider} value={effectiveLatestKey?.provider ?? L.na} />
              <MiniDatum label={L.activeKeys} value={activeKeys.length} />
              <MiniDatum label={L.custodySeq} value={recentCustodyEntries[0]?.seq ?? L.na} />
            </div>

            {effectiveLatestKey ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <HashBox label={L.keyReference} value={effectiveLatestKey.reference} />
                <HashBox label={L.merkleRoot} value={byokCustodyLog?.merkle_root} />
              </div>
            ) : (
              <EmptyLine icon={KeyRound} text={L.noByokKeys} />
            )}

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{L.colSeq}</TableHead>
                    <TableHead>{L.colAction}</TableHead>
                    <TableHead>{L.colVersion}</TableHead>
                    <TableHead>{L.colHash}</TableHead>
                    <TableHead>{L.colCreated}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentCustodyEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        {L.noCustodyEntries}
                      </TableCell>
                    </TableRow>
                  ) : (
                    recentCustodyEntries.map((entry) => (
                      <CustodyEntryRow key={entry.id} entry={entry} L={L} />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">{L.vaultTitle}</CardTitle>
            <CardDescription>{L.vaultDescription}</CardDescription>
          </div>
          <StatusBadge status={selectedVaultAssessment?.Verdict ?? 'pending'} />
        </CardHeader>
        <CardContent className="space-y-4">
          <VaultChooser vaults={sortedVaults} selectedId={selectedVault?.id ?? null} selectedGroupId={selectedGroupId} onSelect={setSelectedVaultId} L={L} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <div className="space-y-4">
              {selectedVault ? (
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{selectedVault.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {labelFor(selectedVault.provider)} / {selectedVault.posture.primary_region ?? L.regionNa}
                      </div>
                    </div>
                    <StatusBadge status={selectedVault.group_id === selectedGroupId ? 'ready' : selectedVault.group_id ? 'pending' : 'outline'} label={selectedVault.group_id ? shortHash(selectedVault.group_id) : L.unscoped} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <PostureFlag label={L.flagImmutable} passed={selectedVault.posture.immutability_enabled} L={L} />
                    <PostureFlag label={L.flagVaultLock} passed={selectedVault.posture.vault_lock_enabled} L={L} />
                    <PostureFlag label={L.flagCmk} passed={selectedVault.posture.customer_managed_key} L={L} />
                    <PostureFlag label={L.flagBreakGlassMfa} passed={selectedVault.posture.break_glass_mfa} L={L} />
                  </div>
                </div>
              ) : (
                <EmptyLine icon={Vault} text={L.noVaults} />
              )}

              {selectedVaultAssessment ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <MiniDatum label={L.colScore} value={`${latestVaultScore ?? 0}%`} />
                    <MiniDatum label={L.colVerdict} value={labelFor(selectedVaultAssessment.Verdict)} />
                    <MiniDatum label={L.colControls} value={selectedVaultAssessment.Assessment.total_controls} />
                    <MiniDatum label={L.colEvaluated} value={formatDateTime(selectedVaultAssessment.EvaluatedAt)} />
                  </div>
                  <Progress
                    value={latestVaultScore ?? 0}
                    className="h-2"
                    indicatorClassName={(latestVaultScore ?? 0) < 80 ? 'bg-amber-500' : 'bg-primary'}
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">{L.recentVaultFindings}</div>
                <Badge variant="outline">{L.findingsBadge(selectedVaultAssessment?.Assessment.findings.length ?? 0)}</Badge>
              </div>
              <FindingList findings={selectedVaultAssessment?.Assessment.findings ?? []} L={L} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SovereignMetric({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-overline font-semibold uppercase text-muted-foreground">{title}</div>
            <div className="mt-3 truncate text-2xl font-semibold tracking-tight">{value}</div>
          </div>
          <div className={cn('rounded-lg p-2.5', toneClass(tone, 'soft'))}>
            <Icon className={cn('h-5 w-5', toneClass(tone, 'text'))} />
          </div>
        </div>
        <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

function ActionButton({
  label,
  loadingText,
  description,
  icon: Icon,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  loadingText: string;
  description: string;
  icon: LucideIcon;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={disabled ? 'secondary' : 'outline'}
      className={cn(
        'h-auto min-h-[82px] justify-start gap-3 whitespace-normal px-3 py-3 text-start',
        disabled && 'opacity-70',
      )}
      disabled={disabled || loading}
      onClick={onClick}
      title={description}
      aria-label={label}
    >
      <span className={cn('rounded-lg p-2', disabled ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-5">{loading ? loadingText : label}</span>
        <span className="mt-1 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

function PackChooser({
  packs,
  selectedKey,
  onSelect,
  L,
}: {
  packs: DRBCMPack[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  L: SovereignActionsLabels;
}) {
  if (packs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{L.selectedBcmPack}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {packs.slice(0, 4).map((pack) => {
          const selected = pack.key === selectedKey;
          return (
            <Button
              key={pack.key}
              type="button"
              variant={selected ? 'default' : 'outline'}
              className="h-auto justify-start whitespace-normal px-3 py-2 text-start"
              aria-pressed={selected}
              onClick={() => onSelect(pack.key)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{pack.standard}</span>
                <span className="mt-1 block truncate text-xs opacity-80">{pack.title}</span>
              </span>
            </Button>
          );
        })}
      </div>
      {packs.length > 4 ? (
        <div className="text-xs text-muted-foreground">{L.additionalPacksHidden(packs.length - 4)}</div>
      ) : null}
    </div>
  );
}

function VaultChooser({
  vaults,
  selectedId,
  selectedGroupId,
  onSelect,
  L,
}: {
  vaults: DRCyberVault[];
  selectedId: string | null;
  selectedGroupId?: string | null;
  onSelect: (id: string) => void;
  L: SovereignActionsLabels;
}) {
  if (vaults.length === 0) {
    return <EmptyLine icon={Vault} text={L.noVaults} />;
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
      {vaults.slice(0, 4).map((vault) => {
        const selected = vault.id === selectedId;
        const disabled = !vault.id;
        return (
          <Button
            key={vault.id ?? `${vault.provider}-${vault.name}`}
            type="button"
            variant={selected ? 'default' : 'outline'}
            className={cn('h-auto justify-start whitespace-normal px-3 py-2 text-start', disabled && 'opacity-70')}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => vault.id && onSelect(vault.id)}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{vault.name}</span>
              <span className="mt-1 block truncate text-xs opacity-80">
                {labelFor(vault.provider)} / {vault.group_id === selectedGroupId ? L.selectedGroupTag : vault.group_id ? shortHash(vault.group_id) : L.unscoped}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function ReadinessLine({
  icon: Icon,
  label,
  ready,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  ready: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2">
      <div className={cn('mt-0.5 rounded-lg p-1.5', ready ? 'bg-primary/10 text-primary' : 'bg-amber-50 text-warning-700 dark:bg-amber-950/25 dark:text-warning-300')}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{label}</div>
          <StatusBadge status={ready ? 'ready' : 'pending'} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function GapList({ gaps, controls, L }: { gaps: DRBCMGap[]; controls: DRBCMControl[]; L: SovereignActionsLabels }) {
  const visibleGaps = gaps.slice(0, 4);

  if (visibleGaps.length === 0) {
    return <EmptyLine icon={CheckCircle2} text={controls.length > 0 ? L.noControlGaps : L.selectPackForGaps} />;
  }

  return (
    <div className="space-y-2">
      {visibleGaps.map((gap) => (
        <div key={gap.code} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{gap.code}</span>
              {gap.mandatory ? <Badge variant="warning">{L.mandatory}</Badge> : null}
            </div>
            <div className="mt-1 truncate text-sm font-medium">{gap.title}</div>
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{gap.reason}</div>
          </div>
          <StatusBadge status={gap.verdict} />
        </div>
      ))}
      {gaps.length > visibleGaps.length ? (
        <div className="text-xs text-muted-foreground">{L.additionalGapsHidden(gaps.length - visibleGaps.length)}</div>
      ) : null}
    </div>
  );
}

function FindingList({ findings, L }: { findings: DRCyberVaultFinding[]; L: SovereignActionsLabels }) {
  const visibleFindings = findings.slice(0, 5);

  if (visibleFindings.length === 0) {
    return <EmptyLine icon={ShieldCheck} text={L.noVaultFindings} />;
  }

  return (
    <div className="space-y-2">
      {visibleFindings.map((finding) => (
        <div key={finding.code} className="rounded-lg border px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{finding.code}</span>
                <StatusBadge status={finding.severity} />
              </div>
              <div className="mt-1 truncate text-sm font-medium">{finding.title}</div>
            </div>
            <StatusBadge status={finding.verdict} />
          </div>
          <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{finding.message}</div>
          <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{finding.remediation}</div>
        </div>
      ))}
      {findings.length > visibleFindings.length ? (
        <div className="text-xs text-muted-foreground">{L.additionalFindingsHidden(findings.length - visibleFindings.length)}</div>
      ) : null}
    </div>
  );
}

function CustodyEntryRow({ entry, L }: { entry: DRBYOKCustodyEntry; L: SovereignActionsLabels }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{entry.seq}</TableCell>
      <TableCell>
        <div className="text-sm">{labelFor(entry.action)}</div>
        <div className="mt-1 max-w-[16rem] truncate text-xs text-muted-foreground">{entry.detail ?? entry.dek_id ?? L.custodyEvent}</div>
      </TableCell>
      <TableCell>v{entry.kek_version}</TableCell>
      <TableCell className="font-mono text-xs">{shortHash(entry.entry_hash)}</TableCell>
      <TableCell>{formatDateTime(entry.created_at)}</TableCell>
    </TableRow>
  );
}

function PostureFlag({ label, passed, L }: { label: string; passed: boolean; L: SovereignActionsLabels }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-card px-2.5 py-2 text-xs">
      <span className="truncate">{label}</span>
      <Badge variant={passed ? 'success' : 'warning'} className="shrink-0 gap-1">
        {passed ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        {passed ? L.flagOn : L.flagOff}
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

function HashBox({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value || 'n/a'}</div>
    </div>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' ||
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'broken' ||
    normalized === 'high'
      ? 'destructive'
      : normalized === 'warning' ||
          normalized === 'pending' ||
          normalized === 'partial' ||
          normalized === 'degraded'
        ? 'warning'
        : normalized === 'healthy' ||
            normalized === 'ready' ||
            normalized === 'satisfied' ||
            normalized === 'compliant' ||
            normalized === 'active' ||
            normalized === 'intact'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case tracking-normal">
      <span className="truncate">{label ?? labelFor(normalized)}</span>
    </Badge>
  );
}

function scoreTone(score: number | null, hasSource: boolean): Tone {
  if (score === null) return hasSource ? 'warning' : 'neutral';
  if (score >= 85) return 'success';
  if (score >= 65) return 'warning';
  return 'critical';
}

function toneClass(tone: Tone, part: 'soft' | 'text') {
  const styles = {
    success: { soft: 'bg-primary/10', text: 'text-primary' },
    warning: { soft: 'bg-amber-50 dark:bg-amber-950/25', text: 'text-warning-700 dark:text-warning-300' },
    critical: { soft: 'bg-error-50 dark:bg-error-700/25', text: 'text-error-700 dark:text-error-300' },
    info: { soft: 'bg-sky-50 dark:bg-sky-950/25', text: 'text-sky-700 dark:text-sky-300' },
    neutral: { soft: 'bg-muted', text: 'text-muted-foreground' },
  } as const;
  return styles[tone][part];
}

function overallReadinessStatus(
  bcmScore: number | null,
  activeKeyCount: number,
  custodyLog: DRBYOKCustodyLog | null | undefined,
  vaultScore: number | null,
) {
  if (bcmScore !== null && bcmScore >= 80 && activeKeyCount > 0 && custodyLog?.intact === true && vaultScore !== null && vaultScore >= 80) {
    return 'ready';
  }
  if (bcmScore === null && activeKeyCount === 0 && !custodyLog && vaultScore === null) {
    return 'pending';
  }
  return 'warning';
}

function bcmAssessDisabledReason(
  selectedGroupId: string | null | undefined,
  selectedPack: DRBCMPack | null,
  L: SovereignActionsLabels,
) {
  if (!selectedGroupId) return L.reasonSelectGroup;
  if (!selectedPack) return L.reasonNoBcmPack;
  return L.reasonPackReady(selectedPack.standard);
}

function isActiveKeyState(state: string) {
  const normalized = normalizeStatus(state);
  return normalized === 'active' || normalized === 'enabled' || normalized === 'current';
}

function clampPercent(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(value?: string | null) {
  return normalizeStatus(value).replace(/_/g, ' ');
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function timestampMs(value?: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function formatError(error: unknown, L: SovereignActionsLabels) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return L.refreshError;
}
