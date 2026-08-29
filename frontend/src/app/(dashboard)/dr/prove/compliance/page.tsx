'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { DRBreadcrumbs } from '../../_components/console/dr-breadcrumbs';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';
import { resolveDRGroupId, useDRSelection } from '../../_lib/dr-selection';
import {
  useDRAssuranceControls,
  useDRAssuranceLatest,
  useDRBCMPacks,
  useDRGroupSummary,
  useDRPosture,
} from '../../_hooks/use-dr-queries';
import { useEvidenceActions } from '../../_hooks/use-dr-actions';
import { DRWriteGate } from '../../_components/console/dr-write-gate';
import { useComplianceLabels } from './_components/compliance-labels';
import { FrameworkCard } from './_components/framework-card';
import { AssurancePosturePanel } from './_components/assurance-posture-panel';

const WRITE_PERMISSION = 'dr:write';

/** Bilingual breadcrumb section + back-link labels for the compliance board. */
const complianceCrumbLabels: DRBilingual<{ prove: string; compliance: string; back: string }> = {
  en: { prove: 'Prove', compliance: 'Compliance', back: 'Back to Prove' },
  ar: { prove: 'الإثبات', compliance: 'الامتثال', back: 'العودة إلى الإثبات' },
};

/**
 * Compliance posture board (`/dr/prove/compliance`).
 *
 * A deep-linkable sub-route of Prove that maps control frameworks to LIVE
 * recovery evidence:
 *
 *  - Regulatory + internal BCM frameworks (`useDRBCMPacks`) are rendered as RAG
 *    posture cards. Each card scores against the active protection group via the
 *    shared `assessDRBCMPack` action (`useEvidenceActions().assessBcm`,
 *    `dr:write`-gated) and drills down into the real `gaps[]` + failing
 *    `control_results[]`.
 *  - The internal DR assurance policy (`useDRAssuranceControls` catalogue +
 *    `useDRAssuranceLatest(group)` report) is rendered as a RAG panel whose
 *    "what is missing" drill-down lists the real `findings[]` + recommendations.
 *
 * Selection (`?group=`) is shared with the rest of the console via
 * `useDRSelection`; every query key/refetch interval and the assess mutation come
 * from the shared `_hooks` so cross-route cache and invalidations stay coherent.
 * RAG status is conveyed by colour (`state-*` tokens) AND icon AND text, never
 * colour alone (WCAG 2.1 AA). Layout uses logical spacing for RTL safety.
 */
export default function DRCompliancePostureBoardPage() {
  const L = useComplianceLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission(WRITE_PERMISSION);
  const { locale } = useLocaleOrDefault();
  const crumbLabels = resolveDRBilingual(complianceCrumbLabels, locale);

  const postureQuery = useDRPosture();
  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);

  const { activeGroupId } = useDRSelection({ groups });

  const selectedGroup = useMemo(
    () => groups.find((group) => resolveDRGroupId(group) === activeGroupId) ?? groups[0] ?? null,
    [groups, activeGroupId],
  );

  const bcmPacksQuery = useDRBCMPacks();
  const assuranceControlsQuery = useDRAssuranceControls();
  const assuranceLatestQuery = useDRAssuranceLatest(activeGroupId);
  const groupSummaryQuery = useDRGroupSummary(activeGroupId);

  // Shared evidence-domain mutations (the dr:write-gated BCM assess action).
  const evidence = useEvidenceActions(activeGroupId);

  const packs = useMemo(() => bcmPacksQuery.data ?? [], [bcmPacksQuery.data]);
  const controls = useMemo(
    () => assuranceControlsQuery.data ?? [],
    [assuranceControlsQuery.data],
  );

  const selectedGroupName = groupSummaryQuery.data?.name ?? selectedGroup?.name ?? null;

  // The shared action surfaces only the LATEST assessment run; attribute it to its
  // pack so exactly one framework card reflects the freshly-scored result. The
  // assessment carries its own `pack_key`, so no fabricated association is made.
  const latestAssessment = evidence.latestBcmAssessment;
  const latestAssessmentPackKey = latestAssessment?.assessment.pack_key ?? null;

  const packsLoading = bcmPacksQuery.isLoading && packs.length === 0;
  const packsError = bcmPacksQuery.error;

  return (
    <div className="space-y-6">
      <DRBreadcrumbs
        items={[
          { label: crumbLabels.prove, href: '/dr/prove' },
          { label: crumbLabels.compliance },
        ]}
      />
      <PageHeader
        title={L.title}
        description={L.description}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dr/prove">
              <ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
              {crumbLabels.back}
            </Link>
          </Button>
        }
      />

      <section aria-labelledby="compliance-frameworks-heading" className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle id="compliance-frameworks-heading" className="text-base">
              {L.frameworksHeading}
            </CardTitle>
            <CardDescription>{L.frameworksDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <DRWriteGate canWrite={canWrite} description={L.readOnlyNotice}>
              {packsLoading ? (
                <LoadingSkeleton variant="card" count={2} />
              ) : packsError && packs.length === 0 ? (
                <ErrorState message={L.loadError} onRetry={() => void bcmPacksQuery.refetch()} />
              ) : packs.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title={L.noFrameworksTitle}
                  description={L.noFrameworksDescription}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {packs.map((pack) => (
                    <FrameworkCard
                      key={pack.key}
                      pack={pack}
                      assessment={
                        latestAssessmentPackKey === pack.key ? latestAssessment : null
                      }
                      selectedGroupId={activeGroupId}
                      selectedGroupName={selectedGroupName}
                      canWrite={canWrite}
                      assessing={evidence.assessingBcm}
                      onAssess={(packKey) => evidence.assessBcm(packKey)}
                    />
                  ))}
                </div>
              )}
            </DRWriteGate>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="compliance-assurance-heading" className="space-y-3">
        <AssurancePosturePanel
          headingId="compliance-assurance-heading"
          controls={controls}
          report={assuranceLatestQuery.data}
          selectedGroupId={activeGroupId}
          selectedGroupName={selectedGroupName}
          loading={assuranceControlsQuery.isLoading || assuranceLatestQuery.isLoading}
          error={assuranceControlsQuery.error ?? assuranceLatestQuery.error}
          onRetry={() => {
            void assuranceControlsQuery.refetch();
            void assuranceLatestQuery.refetch();
          }}
        />
      </section>
    </div>
  );
}
