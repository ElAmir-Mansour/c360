'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { showWarning } from '@/lib/toast';
import {
  useDRGroupSummary,
  useDRPosture,
  useDRRecoveryTiers,
  useDRReplicationSummary,
  useDRSites,
} from '../_hooks/use-dr-queries';
import { useRecoveryTierActions, useReplicationActions } from '../_hooks/use-dr-actions';
import { selectWorkbenchStreamId, useDRSelection } from '../_lib/dr-selection';
import { ProtectionGroups } from '../_components/protect/protection-groups';
import { ReplicationOperations } from '../_components/protect/replication-operations';
import { RecoveryPointValidationPanel } from '../_components/dr-operational-panels';
import { DRReplicationActionsPanel } from '../_components/dr-replication-actions';
import { ObjectiveFitAdvisor } from '../_components/advisor';
import { buildRecommendationRequest } from '../_components/advisor/advisor-format';
import { ProvisionInventory } from '../_components/provision/provision-inventory';
import { useProtectPageLabels } from './protect-page-labels';
import type { DRProtectedSite } from '@/types/clario-dr';

/**
 * PROTECT (/dr/protect) — merges the original monolith "groups" + "replication"
 * tabs. Protection groups are selectable via `?group=` (shared `useDRSelection`)
 * and show members / boot order / streams / latest recovery point; replication
 * operations render the live stream telemetry plus pause/resume actions.
 *
 * Console chrome (posture banner, command bar, sub-nav) is mounted by
 * `dr/layout.tsx`; this page renders only its own content.
 */
export default function DRProtectPage() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('dr:write');
  const labels = useProtectPageLabels();

  // Controlled tab so the empty-state onboarding CTA ("Create your first
  // protection group") can route the operator straight into the recovery advisor.
  const [activeTab, setActiveTab] = useState('groups');

  // First-run routing: a brand-new tenant (no posture groups once posture has
  // loaded) lands on the Inventory tab so the guided onboarding panel is the
  // first thing they see. Runs at most once so it never fights an operator who
  // deliberately switches tabs afterwards.
  const firstRunRoutedRef = useRef(false);

  const postureQuery = useDRPosture();
  const replicationQuery = useDRReplicationSummary();

  const posture = postureQuery.data;
  const replication = replicationQuery.data;
  const groups = posture?.groups ?? [];

  useEffect(() => {
    if (firstRunRoutedRef.current) return;
    if (postureQuery.isLoading) return;
    firstRunRoutedRef.current = true;
    if (groups.length === 0) setActiveTab('inventory');
  }, [postureQuery.isLoading, groups.length]);

  const { streamId, activeGroupId, setGroup } = useDRSelection({ groups });

  // --- Recovery-tier & objective-fit advisor data/actions ------------------
  const sitesQuery = useDRSites();
  const recoveryTiersQuery = useDRRecoveryTiers();
  const { recommendTier, recommendingTier, recommendTierError, latestRecommendation } =
    useRecoveryTierActions();

  const handleRecommendTier = (site: DRProtectedSite) => {
    if (!canWrite) {
      showWarning(labels.noWriteToastTitle, labels.noWriteToastBody);
      return;
    }
    recommendTier(buildRecommendationRequest(site));
  };

  const groupSummaryQuery = useDRGroupSummary(activeGroupId);
  const groupSummary = groupSummaryQuery.data ?? null;

  // `?stream=` falls back to the workbench-stream derivation (member stream,
  // worst-live RPO, or first replication stream) — byte-identical to the monolith.
  const activeStreamId =
    streamId ?? selectWorkbenchStreamId(groupSummary, replication ?? null);

  const {
    pauseStream,
    pauseStreamPending,
    pauseStreamError,
    latestPausedStreamId,
    resumeStream,
    resumeStreamPending,
    resumeStreamError,
    latestResumedStreamId,
  } = useReplicationActions(activeGroupId);

  const isInitialLoading = postureQuery.isLoading || replicationQuery.isLoading;
  const hasCoreError =
    (postureQuery.error || replicationQuery.error) && !posture && !replication;

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title={labels.title} description={labels.loadingDescription} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <LoadingSkeleton variant="card" count={2} />
          <LoadingSkeleton variant="card" count={2} />
        </div>
      </div>
    );
  }

  if (hasCoreError) {
    return (
      <div className="space-y-6">
        <PageHeader title={labels.title} description={labels.errorDescription} />
        <ErrorState
          message={labels.loadError}
          onRetry={() => {
            void postureQuery.refetch();
            void replicationQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={labels.title} description={labels.description} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="groups">{labels.tabGroups}</TabsTrigger>
          <TabsTrigger value="replication">{labels.tabReplication}</TabsTrigger>
          <TabsTrigger value="advisor">{labels.tabAdvisor}</TabsTrigger>
          <TabsTrigger value="inventory">{labels.tabInventory}</TabsTrigger>
        </TabsList>

        <TabsContent value="groups" className="space-y-4">
          <ProtectionGroups
            groups={groups}
            selectedGroupId={activeGroupId}
            groupSummary={groupSummary}
            groupSummaryLoading={groupSummaryQuery.isLoading && Boolean(activeGroupId)}
            groupSummaryError={groupSummaryQuery.error}
            onSelectGroup={(id) => setGroup(id)}
            onRetryGroup={() => void groupSummaryQuery.refetch()}
            onOpenAdvisor={() => setActiveTab('advisor')}
          />
          <RecoveryPointValidationPanel
            groups={groups}
            selectedGroup={groupSummary}
            onOpenGroup={(id) => setGroup(id)}
          />
        </TabsContent>

        <TabsContent value="replication" className="space-y-4">
          <ReplicationOperations
            replication={replication}
            error={replicationQuery.error}
            onRetry={() => void replicationQuery.refetch()}
          />
          <DRReplicationActionsPanel
            streams={replication?.streams ?? []}
            activeStreamId={activeStreamId}
            selectedGroupId={activeGroupId}
            latestPausedStreamId={latestPausedStreamId}
            latestResumedStreamId={latestResumedStreamId}
            loading={replicationQuery.isLoading}
            pausingStream={pauseStreamPending}
            resumingStream={resumeStreamPending}
            error={replicationQuery.error ?? pauseStreamError ?? resumeStreamError}
            onPauseStream={(streamID) => pauseStream(streamID)}
            onResumeStream={(streamID) => resumeStream(streamID)}
            onRetry={() => void replicationQuery.refetch()}
          />
        </TabsContent>

        <TabsContent value="advisor" className="space-y-4">
          <ObjectiveFitAdvisor
            sites={sitesQuery.data ?? []}
            recoveryTiers={recoveryTiersQuery.data ?? []}
            latestRecommendation={latestRecommendation}
            canWrite={canWrite}
            loading={sitesQuery.isLoading || recoveryTiersQuery.isLoading}
            recommending={recommendingTier}
            error={sitesQuery.error ?? recoveryTiersQuery.error ?? recommendTierError}
            onRecommendTier={handleRecommendTier}
            onRetry={() => {
              void sitesQuery.refetch();
              void recoveryTiersQuery.refetch();
            }}
          />
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <ProvisionInventory canWrite={canWrite} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
