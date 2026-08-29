'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Boxes, Pencil, Archive, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import {
  useLicensePlan,
  useRetirePlan,
  useReactivatePlan,
} from '../../_lib/use-license-plans';
import { planStatusConfig } from '../../_lib/license-state';
import { EntitlementsEditor } from './_components/entitlements-editor';
import { EditPlanDialog } from './_components/edit-plan-dialog';

export default function PlanDetailPage() {
  const t = useT();
  const router = useRouter();
  const params = useParams<{ planKey: string }>();
  const rawKey = params?.planKey;
  const planKey = decodeURIComponent(
    Array.isArray(rawKey) ? rawKey[0] : (rawKey ?? ''),
  );

  const { data: plan, isLoading, isError, error, refetch } = useLicensePlan(planKey);
  const retire = useRetirePlan();
  const reactivate = useReactivatePlan();

  const [editOpen, setEditOpen] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);

  const retired = plan?.status === 'retired';

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => router.push('/platform/licensing?tab=plans')}
      >
        <ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
        {t('platformConsole.licensing.backToPlans')}
      </Button>

      {isError ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          message={t('platformConsole.licensing.planError')}
        />
      ) : isLoading || !plan ? (
        <LoadingSkeleton variant="card" count={3} />
      ) : (
        <>
          <PageHeader
            eyebrow={t('platformConsole.licensing.planEyebrow')}
            title={plan.name}
            description={plan.description || t('platformConsole.licensing.noDescription')}
            tags={[
              {
                label: plan.key,
                icon: <Boxes className="h-3.5 w-3.5" aria-hidden />,
                tone: 'neutral',
              },
            ]}
            actions={
              <>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="me-1.5 h-4 w-4" aria-hidden />
                  {t('platformConsole.licensing.edit')}
                </Button>
                {retired ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await reactivate.mutateAsync({ key: plan.key });
                        toast.success(t('platformConsole.licensing.planReactivatedToast'));
                      } catch (e) {
                        toast.error(parseApiError(e));
                      }
                    }}
                    disabled={reactivate.isPending}
                  >
                    <RotateCcw className="me-1.5 h-4 w-4" aria-hidden />
                    {t('platformConsole.licensing.reactivate')}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setRetireOpen(true)}>
                    <Archive className="me-1.5 h-4 w-4" aria-hidden />
                    {t('platformConsole.licensing.retire')}
                  </Button>
                )}
              </>
            }
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <DetailStatCard
              label={t('platformConsole.licensing.colStatus')}
              value={<StatusBadge status={plan.status} config={planStatusConfig(t)} />}
            />
            <DetailStatCard
              label={t('platformConsole.licensing.colEntitlements')}
              value={(plan.entitlements?.length ?? 0).toLocaleString()}
            />
            <DetailStatCard label={t('platformConsole.licensing.colSource')} value={plan.source || '—'} />
          </div>

          <div className="rounded-lg border bg-card p-5">
            <EntitlementsEditor
              planKey={plan.key}
              entitlements={plan.entitlements ?? []}
              readOnly={retired}
            />
          </div>

          <EditPlanDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            planKey={plan.key}
            currentName={plan.name}
            currentDescription={plan.description}
          />

          <ConfirmDialog
            open={retireOpen}
            onOpenChange={setRetireOpen}
            title={t('platformConsole.licensing.retirePlan')}
            description={t('platformConsole.licensing.retireConfirm').replace('{name}', plan.name)}
            confirmLabel={t('platformConsole.licensing.retire')}
            variant="destructive"
            loading={retire.isPending}
            onConfirm={async () => {
              try {
                await retire.mutateAsync({ key: plan.key });
                toast.success(t('platformConsole.licensing.planRetiredToast'));
                setRetireOpen(false);
              } catch (e) {
                toast.error(parseApiError(e));
                throw e;
              }
            }}
          />
        </>
      )}
    </div>
  );
}
