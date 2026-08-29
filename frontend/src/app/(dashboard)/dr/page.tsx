'use client';

import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  DatabaseZap,
  FileWarning,
  Radio,
} from 'lucide-react';
import { DROrientation } from './_components/orientation/dr-orientation';
import { LiveActivityChip } from './_components/console/live-activity-chip';
import {
  PredictiveAlerts,
  predictiveAlertsLabels,
} from './_components/intel/predictive-alerts';
import { deriveAlerts } from './_components/intel/predictive-alerts-derivations';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { HelpTip } from '@/components/shared/help-tip';
import { EmptyState } from '@/components/common/empty-state';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { MultiRunbookDashboard } from '@/components/product';
import { cn } from '@/lib/utils';
import type {
  DRAttentionItem,
  DRFailoverRun,
  DRGroupRollup,
  DRPrediction,
  DRStreamSummary,
} from '@/lib/clario-dr';
import {
  useDRAttestationLedger,
  useDRBCMPacks,
  useDRBYOKKeys,
  useDRFailoverRuns,
  useDRLedgerVerify,
  useDRPosture,
  useDRPredictions,
  useDRReplicationSummary,
} from './_hooks/use-dr-queries';
import { useDRSelection, resolveDRGroupId } from './_lib/dr-selection';
import { useDRLabels, type DRBilingual, resolveDRBilingual } from './_lib/dr-i18n';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { DR_LIVE_REFETCH_MS, hasLiveRun, isRunLive } from './_hooks/use-dr-realtime';
import {
  CyberVaultCompliancePanel,
  DROperatorActions,
  RecoveryTierSummary,
} from './_components/dr-operational-panels';
import {
  buildEvidenceSummary,
  buildReadinessSummary,
  clampPercent,
  formatSeconds,
  labelFor,
  normalizeStatus,
  selectLatestRecoveryPoint,
} from './_components/overview/overview-helpers';

/**
 * ClarioDR Recovery Operations Console — Overview (`/dr`).
 *
 * The single pane of glass that sits BELOW the persistent shell (the readiness
 * banner, command bar, and console nav live in `layout.tsx` and must NOT be
 * repeated here). It leads with the live recovery events (the design-system
 * `MultiRunbookDashboard` wired to `fetchDRFailoverRuns`, where selecting a run
 * drills into `/dr/runs/[id]`), then surfaces an action-first attention queue and
 * a protection-groups-at-a-glance grid — each item deep-links into the relevant
 * lifecycle sub-route with `?group=` preset so the rest of the console opens with
 * the right group already selected.
 *
 * Every value is read from the shared `useDR*` query hooks; the evidence /
 * readiness rollups reuse the monolith's exact derivations (no fabricated data).
 * Primary WRITE actions are intentionally absent from this route — they live in
 * the always-visible command bar (Declare failover / Rehearse / Run a runbook /
 * Seal recovery point), so the overview is read-and-route only.
 */

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'rolled_back', 'attested'];

/**
 * Feature-local bilingual copy for the overview (`/dr`) route. Adopts the
 * foundation's `DRBilingual<T>` shape (two full, identically-shaped copies —
 * English + professional MSA, including the function-valued fields that
 * interpolate live counts/identifiers) and is resolved against the active locale
 * by {@link useOverviewLabels}. Resolution defaults to English (cross-locale
 * fallback) so the overview's English-asserting tests stay green under the
 * `renderWithQuery` `en` default. These strings stay local to this route (they
 * are NOT added to the shared `dr-i18n.ts`).
 */
interface OverviewCopy {
  liveEvents: { sectionLabel: string; liveOne: string; liveMany: string; idle: string };
  emptyGroups: { title: string; description: string; action: string };
  emptyAttention: { title: string; description: string };
  overviewLoadError: string;
  attention: {
    requiredFallback: string;
    rpoBreachBadge: string;
    rpoBreachTitle: (stream: string) => string;
    rpoBreachDetail: (live: string, objective: string) => string;
    runFailedTitle: (mode: string, id: string, failed: boolean) => string;
    runFailedFallbackDetail: string;
    ledgerBrokenBadge: string;
    ledgerBrokenTitle: string;
    ledgerBrokenSeqDetail: (seq: number) => string;
    ledgerBrokenFallbackDetail: string;
    notAnchoredBadge: string;
    unanchoredTitle: (count: number) => string;
    unanchoredDetail: string;
  };
  groups: {
    cardTitle: string;
    cardDescription: string;
    countBadge: (count: number) => string;
    memberStreamSummary: (id: string, members: number, streams: number) => string;
    liveRpo: string;
    rpoTarget: string;
    rtoTarget: string;
    replicationCaption: (validated: boolean) => string;
  };
  queue: { cardTitle: string; cardDescription: string; openBadge: (count: number) => string };
}

const overviewLabels: DRBilingual<OverviewCopy> = {
  en: {
    liveEvents: {
      sectionLabel: 'Recovery events',
      liveOne: 'recovery in flight',
      liveMany: 'recoveries in flight',
      idle: 'No recovery in flight',
    },
    emptyGroups: {
      title: 'Create your first protection group',
      description:
        'Protection groups bundle the sites and data that recover together. Add one to start replication and unlock failover, drills, and evidence.',
      action: 'Set up protection',
    },
    emptyAttention: {
      title: 'No open DR attention items',
      description: 'RPO breaches, broken runs, and unanchored evidence will surface here.',
    },
    overviewLoadError: 'Failed to load ClarioDR operations overview.',
    attention: {
      requiredFallback: 'Attention required',
      rpoBreachBadge: 'RPO breach',
      rpoBreachTitle: (stream) => `${stream} exceeds its RPO objective`,
      rpoBreachDetail: (live, objective) => `${live} live · objective ${objective}`,
      runFailedTitle: (mode, id, failed) =>
        `${mode} run ${id} ${failed ? 'failed' : 'rolled back'}`,
      runFailedFallbackDetail: 'Open the live run for the gate timeline and remediation.',
      ledgerBrokenBadge: 'Ledger broken',
      ledgerBrokenTitle: 'Attestation ledger hash-chain is broken',
      ledgerBrokenSeqDetail: (seq) => `First broken sequence ${seq}`,
      ledgerBrokenFallbackDetail: 'Re-verify and re-anchor the attestation ledger.',
      notAnchoredBadge: 'Not anchored',
      unanchoredTitle: (count) =>
        `${count} attestation ${count === 1 ? 'entry is' : 'entries are'} not yet anchored`,
      unanchoredDetail: 'Anchor the attestation ledger to a Merkle checkpoint for regulator export.',
    },
    groups: {
      cardTitle: 'Protection groups',
      cardDescription:
        'Recovery objectives, replication health, and latest sealed point. Open a group to protect or recover it.',
      countBadge: (count) => `${count} groups`,
      memberStreamSummary: (id, members, streams) =>
        `${id} · ${members} members · ${streams} streams`,
      liveRpo: 'Live RPO',
      rpoTarget: 'RPO target',
      rtoTarget: 'RTO target',
      replicationCaption: (validated) =>
        `Replication · ${validated ? 'validated point' : 'no validated point'}`,
    },
    queue: {
      cardTitle: 'Attention queue',
      cardDescription:
        'Operator-facing issues derived from live DR state. Each item routes to where it is resolved.',
      openBadge: (count) => `${count} open`,
    },
  },
  ar: {
    liveEvents: {
      sectionLabel: 'أحداث الاسترداد',
      liveOne: 'عملية استرداد جارية',
      liveMany: 'عمليات استرداد جارية',
      idle: 'لا توجد عملية استرداد جارية',
    },
    emptyGroups: {
      title: 'أنشئ أول مجموعة حماية',
      description:
        'تجمع مجموعات الحماية المواقع والبيانات التي تُستردّ معًا. أضِف واحدة لبدء النسخ المتماثل وتفعيل تجاوز الفشل والتمارين والأدلة.',
      action: 'إعداد الحماية',
    },
    emptyAttention: {
      title: 'لا توجد عناصر تتطلّب الانتباه في التعافي من الكوارث',
      description: 'ستظهر هنا تجاوزات هدف نقطة الاسترداد (RPO) والعمليات المتعطّلة والأدلة غير المرتبطة بمرساة.',
    },
    overviewLoadError: 'تعذّر تحميل نظرة عامة على عمليات ClarioDR.',
    attention: {
      requiredFallback: 'يلزم الانتباه',
      rpoBreachBadge: 'تجاوز هدف نقطة الاسترداد (RPO)',
      rpoBreachTitle: (stream) => `${stream} يتجاوز هدف نقطة الاسترداد (RPO) الخاص به`,
      rpoBreachDetail: (live, objective) => `${live} مباشرة · الهدف ${objective}`,
      runFailedTitle: (mode, id, failed) =>
        `${mode} عملية ${id} ${failed ? 'فشلت' : 'أُعيدت إلى الحالة السابقة'}`,
      runFailedFallbackDetail: 'افتح العملية المباشرة للاطّلاع على الخط الزمني للبوابات والمعالجة.',
      ledgerBrokenBadge: 'السجل مكسور',
      ledgerBrokenTitle: 'سلسلة تجزئة سجل الإثبات مكسورة',
      ledgerBrokenSeqDetail: (seq) => `أول تسلسل مكسور ${seq}`,
      ledgerBrokenFallbackDetail: 'أعِد التحقق من سجل الإثبات وأعِد ربطه بمرساة.',
      notAnchoredBadge: 'غير مرتبط بمرساة',
      unanchoredTitle: (count) =>
        `${count} ${count === 1 ? 'قيد إثبات غير مرتبط' : 'قيود إثبات غير مرتبطة'} بمرساة بعد`,
      unanchoredDetail: 'اربط سجل الإثبات بنقطة تحقّق ميركل لتصديره إلى الجهة التنظيمية.',
    },
    groups: {
      cardTitle: 'مجموعات الحماية',
      cardDescription:
        'أهداف الاسترداد وسلامة النسخ المتماثل وأحدث نقطة مختومة. افتح مجموعة لحمايتها أو استردادها.',
      countBadge: (count) => `${count} مجموعة`,
      memberStreamSummary: (id, members, streams) =>
        `${id} · ${members} عضو · ${streams} تدفق`,
      liveRpo: 'نقطة الاسترداد (RPO) المباشرة',
      rpoTarget: 'هدف نقطة الاسترداد (RPO)',
      rtoTarget: 'هدف زمن الاسترداد (RTO)',
      replicationCaption: (validated) =>
        `النسخ المتماثل · ${validated ? 'نقطة مُتحقَّق منها' : 'لا توجد نقطة مُتحقَّق منها'}`,
    },
    queue: {
      cardTitle: 'قائمة الانتباه',
      cardDescription:
        'مشكلات موجَّهة للمشغّل مُستمدّة من حالة التعافي من الكوارث المباشرة. يوجّه كل عنصر إلى مكان معالجته.',
      openBadge: (count) => `${count} مفتوح`,
    },
  },
};

/** Resolve the bilingual overview copy against the active locale (en fallback). */
function useOverviewLabels(): OverviewCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(overviewLabels, locale), [locale]);
}

/** Map the operational panels' legacy tab keys to the new console routes. */
const TAB_ROUTE: Record<string, string> = {
  dashboard: '/dr',
  groups: '/dr/protect',
  replication: '/dr/protect',
  failover: '/dr/recover',
  evidence: '/dr/prove',
  readiness: '/dr/readiness',
};

function withGroup(path: string, groupId: string | null): string {
  return groupId ? `${path}?group=${encodeURIComponent(groupId)}` : path;
}

function streamLabel(stream: DRStreamSummary): string {
  return stream.site_name ?? stream.stream_id ?? stream.site_id ?? 'stream';
}

function attentionTone(severity?: string | null): 'destructive' | 'warning' | 'outline' {
  const normalized = normalizeStatus(severity);
  if (normalized === 'critical' || normalized === 'error' || normalized === 'failed') {
    return 'destructive';
  }
  if (normalized === 'warning' || normalized === 'high' || normalized === 'medium') {
    return 'warning';
  }
  return 'outline';
}

function groupHealthVariant(health?: string | null): 'success' | 'warning' | 'destructive' | 'outline' {
  const normalized = normalizeStatus(health);
  if (normalized === 'critical' || normalized === 'failed' || normalized === 'error') {
    return 'destructive';
  }
  if (normalized === 'warning' || normalized === 'degraded' || normalized === 'paused') {
    return 'warning';
  }
  if (normalized === 'healthy' || normalized === 'completed') return 'success';
  return 'outline';
}

interface AttentionRow {
  key: string;
  badge: string;
  badgeTone: 'destructive' | 'warning' | 'outline';
  title: string;
  detail: string;
  href: string;
  icon: typeof AlertTriangle;
}

export default function DROverviewPage() {
  const router = useRouter();
  const { multiRunbookDashboardLabels, drHealthLabels, drRunStatusLabels } = useDRLabels();
  const overview = useOverviewLabels();

  // Locale-aware badge label for a severity / health / run-status token: resolve
  // via the shared health map, then the run-status map (upper-cased), else the
  // humanized token — preserving the legacy English fallback shape.
  const labelForToken = useCallback(
    (token?: string | null): string => {
      const normalized = normalizeStatus(token);
      return (
        drHealthLabels[normalized] ??
        drRunStatusLabels[normalized.toUpperCase()] ??
        labelFor(token)
      );
    },
    [drHealthLabels, drRunStatusLabels],
  );

  const postureQuery = useDRPosture();
  const replicationQuery = useDRReplicationSummary();
  // Tighten the failover-runs poll to a live cadence while any run is mid-flight
  // so the concurrent-events board keeps ticking even where the DR WebSocket
  // topic is not delivered; relax to the shared baseline otherwise. Liveness is
  // read from the live query client cache so the single failover-runs observer
  // adopts the new interval on the very next render (no duplicate observer).
  const cachedRuns = useQueryClient().getQueryData<DRFailoverRun[]>(['clario-dr', 'failover-runs']);
  const runsAreLive = hasLiveRun(cachedRuns);
  const failoverRunsQuery = useDRFailoverRuns(runsAreLive ? DR_LIVE_REFETCH_MS : undefined);
  const ledgerQuery = useDRAttestationLedger();
  const ledgerVerifyQuery = useDRLedgerVerify();
  const bcmPacksQuery = useDRBCMPacks();
  const byokKeysQuery = useDRBYOKKeys();
  const predictionsQuery = useDRPredictions();

  const posture = postureQuery.data;
  const replication = replicationQuery.data;
  const groups = useMemo<DRGroupRollup[]>(() => posture?.groups ?? [], [posture?.groups]);

  const { activeGroupId, setGroup } = useDRSelection({ groups });

  const failoverRuns = useMemo<DRFailoverRun[]>(
    () => failoverRunsQuery.data ?? [],
    [failoverRunsQuery.data],
  );

  const predictions = useMemo<DRPrediction[]>(
    () => predictionsQuery.data ?? [],
    [predictionsQuery.data],
  );

  const evidence = useMemo(
    () => buildEvidenceSummary(ledgerQuery.data, posture?.recent_runs ?? []),
    [ledgerQuery.data, posture?.recent_runs],
  );
  const readiness = useMemo(
    () => buildReadinessSummary(bcmPacksQuery.data, byokKeysQuery.data, posture, evidence),
    [bcmPacksQuery.data, byokKeysQuery.data, posture, evidence],
  );

  const liveRunCount = useMemo(
    () => failoverRuns.filter((run) => isRunLive(run.status)).length,
    [failoverRuns],
  );

  const latestRecoveryPoint = useMemo(() => selectLatestRecoveryPoint(groups), [groups]);
  const readinessScore = clampPercent(readiness.readiness_score);
  const evidenceReportCount = evidence.reports?.length ?? evidence.immutable_reports ?? 0;
  const streamTotal = replication?.total_streams ?? posture?.stream_count ?? 0;
  const rpoBreachCount = replication?.rpo_breaches?.length ?? posture?.rpo_breaches?.length ?? 0;

  const attentionRows = useMemo<AttentionRow[]>(() => {
    const rows: AttentionRow[] = [];
    const a = overview.attention;

    // Backend-emitted attention items (RPO breaches, stale streams, etc.).
    for (const item of (posture?.attention ?? []) as DRAttentionItem[]) {
      rows.push({
        key: `attention-${item.resource_type}-${item.resource_id}-${item.kind}`,
        badge: labelForToken(item.severity),
        badgeTone: attentionTone(item.severity),
        title: item.message || a.requiredFallback,
        detail: `${item.resource_type} · ${item.resource_id}`,
        href: withGroup('/dr/protect', activeGroupId),
        icon: AlertTriangle,
      });
    }

    // Live RPO breaches not already represented by an attention item.
    const breaches = (replication?.rpo_breaches ?? posture?.rpo_breaches ?? []) as DRStreamSummary[];
    for (const stream of breaches) {
      rows.push({
        key: `rpo-breach-${stream.stream_id}`,
        badge: a.rpoBreachBadge,
        badgeTone: 'warning',
        title: a.rpoBreachTitle(streamLabel(stream)),
        detail: a.rpoBreachDetail(
          formatSeconds(stream.rpo_seconds),
          formatSeconds(stream.rpo_objective_seconds),
        ),
        href: withGroup('/dr/protect', activeGroupId),
        icon: Radio,
      });
    }

    // Failed / rolled-back failover runs — drill straight into the live run view.
    for (const run of failoverRuns) {
      const normalized = normalizeStatus(run.status);
      if (normalized === 'failed' || normalized === 'rolled_back') {
        rows.push({
          key: `failed-run-${run.id}`,
          badge: labelForToken(run.status),
          badgeTone: 'destructive',
          title: a.runFailedTitle(run.mode, run.id, normalized === 'failed'),
          detail: run.last_error ?? a.runFailedFallbackDetail,
          href: `/dr/runs/${encodeURIComponent(run.id)}`,
          icon: FileWarning,
        });
      }
    }

    // Unanchored / broken attestation ledger — route to Prove.
    const verify = ledgerVerifyQuery.data;
    if (verify && verify.intact === false) {
      rows.push({
        key: 'ledger-broken',
        badge: a.ledgerBrokenBadge,
        badgeTone: 'destructive',
        title: a.ledgerBrokenTitle,
        detail:
          verify.reason ??
          (verify.first_broken_seq !== undefined
            ? a.ledgerBrokenSeqDetail(verify.first_broken_seq)
            : a.ledgerBrokenFallbackDetail),
        href: '/dr/prove',
        icon: FileWarning,
      });
    } else {
      const unanchored = (ledgerQuery.data ?? []).filter((entry) => !entry.anchored_root);
      if (unanchored.length > 0) {
        rows.push({
          key: 'ledger-unanchored',
          badge: a.notAnchoredBadge,
          badgeTone: 'warning',
          title: a.unanchoredTitle(unanchored.length),
          detail: a.unanchoredDetail,
          href: '/dr/prove',
          icon: FileWarning,
        });
      }
    }

    return rows;
  }, [
    overview.attention,
    labelForToken,
    posture?.attention,
    posture?.rpo_breaches,
    replication?.rpo_breaches,
    failoverRuns,
    ledgerVerifyQuery.data,
    ledgerQuery.data,
    activeGroupId,
  ]);

  const isInitialLoading =
    postureQuery.isLoading || replicationQuery.isLoading || failoverRunsQuery.isLoading;
  const hasCoreError =
    (postureQuery.error || replicationQuery.error) && !posture && !replication;

  const refetchCore = () => {
    void postureQuery.refetch();
    void replicationQuery.refetch();
    void failoverRunsQuery.refetch();
    void ledgerQuery.refetch();
    void ledgerVerifyQuery.refetch();
    void bcmPacksQuery.refetch();
    void byokKeysQuery.refetch();
    void predictionsQuery.refetch();
  };

  const openGroup = (groupID: string) => {
    setGroup(groupID);
    router.push(withGroup('/dr/protect', groupID));
  };

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        {/* First-time orientation stays visible while live data loads. */}
        <DROrientation />
        <LoadingSkeleton variant="card" count={1} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <LoadingSkeleton variant="table-row" count={6} />
          </div>
          <LoadingSkeleton variant="card" count={2} />
        </div>
      </div>
    );
  }

  if (hasCoreError) {
    return (
      <div className="space-y-6">
        {/* The orientation map is data-free, so it still helps users navigate
            even when the live operations data fails to load. */}
        <DROrientation />
        <ErrorState message={overview.overviewLoadError} onRetry={refetchCore} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Orientation landing — a map of the recovery lifecycle + capabilities for
          first-time users. The live operations dashboard follows below for
          returning operators. */}
      <DROrientation />

      <DROperatorActions
        groupCount={posture?.group_count ?? groups.length}
        streamCount={streamTotal}
        rpoBreachCount={rpoBreachCount}
        latestRecoveryPoint={latestRecoveryPoint}
        activeRun={null}
        gateIndex={0}
        evidenceReportCount={evidenceReportCount}
        readinessScore={readinessScore}
        onOpenTab={(tab) => router.push(withGroup(TAB_ROUTE[tab] ?? '/dr', activeGroupId))}
      />

      <section aria-label={overview.liveEvents.sectionLabel} className="space-y-3">
        <div className="flex items-center justify-end gap-2">
          <HelpTip
            title={{ en: 'Reading the DR console', ar: 'قراءة وحدة التعافي من الكوارث' }}
            content={{
              en: 'This console tracks protection groups, live RPO against targets, and failover runs end to end. Live events stream below; anything drifting from its objective lands in the attention queue with a direct route to where it is resolved.',
              ar: 'تتابع هذه الوحدة مجموعات الحماية، وقيم RPO الحية مقابل الأهداف، وعمليات التحويل عند الفشل من البداية إلى النهاية. تُعرض الأحداث الحية أدناه؛ وكل ما ينحرف عن هدفه يظهر في قائمة الانتباه مع مسار مباشر إلى مكان معالجته.',
            }}
          />
          <LiveActivityChip
            liveCount={liveRunCount}
            label={
              liveRunCount === 0
                ? overview.liveEvents.idle
                : `${liveRunCount} ${
                    liveRunCount === 1
                      ? overview.liveEvents.liveOne
                      : overview.liveEvents.liveMany
                  }`
            }
          />
        </div>
        <MultiRunbookDashboard
          runs={failoverRuns}
          labels={multiRunbookDashboardLabels}
          onSelectRun={(run) => router.push(`/dr/runs/${encodeURIComponent(run.id)}`)}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ProtectionGroupsGlance
            groups={groups}
            activeGroupId={activeGroupId}
            onOpenGroup={openGroup}
            onSetUp={() => router.push('/dr/protect')}
            labels={overview}
            labelForToken={labelForToken}
          />
        </div>
        <AttentionQueue rows={attentionRows} predictions={predictions} labels={overview} />
      </div>

      <RecoveryTierSummary groups={groups} onOpenGroup={openGroup} />

      <CyberVaultCompliancePanel
        evidence={evidence}
        readiness={readiness}
        posture={posture}
        onOpenEvidence={() => router.push('/dr/prove')}
        onOpenReadiness={() => router.push('/dr/readiness')}
      />
    </div>
  );
}

function ProtectionGroupsGlance({
  groups,
  activeGroupId,
  onOpenGroup,
  onSetUp,
  labels,
  labelForToken,
}: {
  groups: DRGroupRollup[];
  activeGroupId: string | null;
  onOpenGroup: (groupId: string) => void;
  onSetUp: () => void;
  labels: OverviewCopy;
  labelForToken: (token?: string | null) => string;
}) {
  const g = labels.groups;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{g.cardTitle}</CardTitle>
          <CardDescription>{g.cardDescription}</CardDescription>
        </div>
        <Badge variant="outline">{g.countBadge(groups.length)}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.length === 0 ? (
          <EmptyState
            icon={DatabaseZap}
            title={labels.emptyGroups.title}
            description={labels.emptyGroups.description}
            action={{ label: labels.emptyGroups.action, onClick: onSetUp }}
            className="border border-dashed"
            size="compact"
          />
        ) : (
          groups.map((group) => {
            const id = resolveDRGroupId(group);
            if (!id) return null;
            const selected = id === activeGroupId;
            const replicationPct = clampPercent(group.replication_percent) ?? 0;
            const validated = group.latest_recovery_point?.is_validated ?? false;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onOpenGroup(id)}
                className={cn(
                  'w-full rounded-lg border bg-card px-4 py-3 text-start transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  selected
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border hover:border-primary/30 hover:bg-muted/50',
                )}
                aria-current={selected ? 'true' : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{group.name || id}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {g.memberStreamSummary(id, group.member_count, group.stream_count)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={groupHealthVariant(group.health)}>{labelForToken(group.health)}</Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" aria-hidden />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <GlanceDatum
                    label={g.liveRpo}
                    value={formatSeconds(group.worst_live_rpo?.rpo_seconds)}
                  />
                  <GlanceDatum label={g.rpoTarget} value={formatSeconds(group.rpo_objective_seconds)} />
                  <GlanceDatum label={g.rtoTarget} value={formatSeconds(group.rto_objective_seconds)} />
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{g.replicationCaption(validated)}</span>
                    <span className="font-medium">{replicationPct}%</span>
                  </div>
                  <Progress
                    value={replicationPct}
                    className="h-2"
                    indicatorClassName={
                      replicationPct < 75
                        ? 'bg-warning-500'
                        : replicationPct < 95
                          ? 'bg-info-500'
                          : 'bg-primary'
                    }
                  />
                </div>
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function AttentionQueue({
  rows,
  predictions,
  labels,
}: {
  rows: AttentionRow[];
  predictions: DRPrediction[];
  labels: OverviewCopy;
}) {
  // Forecast (forward-looking) alerts are derived once here so the header badge
  // counts them alongside the backend-emitted issues; the reusable
  // `PredictiveAlerts` surface re-derives + renders them (single rendering path,
  // keyed by prediction id so nothing is duplicated against the live rows).
  const predictiveAlerts = useMemo(() => deriveAlerts(predictions), [predictions]);
  const openCount = rows.length + predictiveAlerts.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{labels.queue.cardTitle}</CardTitle>
          <CardDescription>{labels.queue.cardDescription}</CardDescription>
        </div>
        <Badge variant={openCount > 0 ? 'warning' : 'outline'}>{labels.queue.openBadge(openCount)}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {rows.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={labels.emptyAttention.title}
              description={labels.emptyAttention.description}
              className="border border-dashed"
              size="compact"
            />
          ) : (
            rows.map((row) => {
              const Icon = row.icon;
              return (
                <Link
                  key={row.key}
                  href={row.href}
                  className={cn(
                    'block rounded-lg border bg-card px-3 py-3 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    'hover:border-primary/30 hover:bg-muted/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={row.badgeTone} className="gap-1">
                      <Icon className="h-3 w-3" aria-hidden />
                      {row.badge}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" aria-hidden />
                  </div>
                  <p className="mt-2 text-sm font-medium">{row.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.detail}</p>
                </Link>
              );
            })
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {predictiveAlertsLabels.title}
            </p>
            <Badge variant={predictiveAlerts.length > 0 ? 'warning' : 'outline'}>
              {predictiveAlerts.length} {predictiveAlertsLabels.countSuffix}
            </Badge>
          </div>
          <PredictiveAlerts predictions={predictions} embedded />
        </div>
      </CardContent>
    </Card>
  );
}

// RPO/RTO objectives are time/deadline metrics → `gold` tonal accent. The
// `DetailStatCard` toned tile keeps the value text neutral and only the label
// rides `--kpi-accent`, so the dense 3-up glance grid stays readable.
function GlanceDatum({ label, value }: { label: string; value: string }) {
  return <DetailStatCard label={label} value={value} tone="gold" className="p-3" />;
}
