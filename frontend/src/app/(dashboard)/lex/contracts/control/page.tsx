'use client';

/**
 * Contracts & Consultations — Control & Monitoring Panel (`/lex/contracts/control`).
 *
 * The service-workspace dashboard for the contracts + consultations domain, the
 * twin of the Case & Investigation panel (`/lex/cases/control`) so the two read
 * as one unified system. Headline KPIs, recent-contract and recent-consultation
 * tables, an owner-scoped unassigned backlog with quick team assignment, the
 * contract/consultation type mix, and operational assignment controls — all
 * from live, fail-soft lex sources. Static sibling of `[id]`, so
 * `/lex/contracts/control` resolves here and never collides with a contract
 * detail route (same pattern as `/lex/contracts/archived`).
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, UsersRound } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { consultationsApi } from '@/lib/lex/consultations';
import { showApiError, showSuccess } from '@/lib/toast';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { ContractFormDialog } from '../_components/contract-form-dialog';
import { useContractTypeLabels } from '../_lib/contracts-labels';
import { resolveConsultationTypeLabel } from '../../consultations/[id]/_components/consultation-enums-i18n';
import { useContractsControl } from './_lib/use-contracts-control';
import { useContractsControlLabels } from './_lib/labels';
import { ControlKpis } from './_components/control-kpis';
import { RecentContractsCard } from './_components/recent-contracts-card';
import { RecentConsultationsCard } from './_components/recent-consultations-card';
import { TypeBreakdownCard } from './_components/type-breakdown-card';
import {
  UnassignedWorkCard,
  type AssignmentBacklogItem,
  type AssignmentSelection,
} from './_components/unassigned-work-card';

function SectionError({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
      <h2 className="text-h4 font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-prose text-body-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

function ControlPanelContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = useContractsControlLabels();
  const panel = useContractsControl();
  const contractTypeLabels = useContractTypeLabels();

  const canAddRequest = hasPermission('lex:request:add');
  const canAddContract = hasPermission('lex:contract:add');
  const canAssignContract = hasPermission('lex:contract:edit');
  const canAssignConsultation = hasPermission('lex:consultation:edit');
  const [createOpen, setCreateOpen] = useState(false);

  const assignmentMutation = useMutation({
    mutationFn: async ({ item, selection }: { item: AssignmentBacklogItem; selection: AssignmentSelection }) => {
      if (item.kind === 'contract') {
        await enterpriseApi.lex.updateContract(item.id, {
          legal_reviewer_id: selection.id,
          legal_reviewer_name: selection.name,
        });
        return;
      }

      const consultation = item.consultation;
      if (!consultation) {
        throw new Error('Consultation assignment target is unavailable');
      }

      // Approved requests materialise consultations in `submitted`. Quick
      // assignment preserves the audited lifecycle by classifying first and
      // routing second; already-classified rows only need the route command.
      if (consultation.status === 'submitted') {
        await consultationsApi.classify(consultation.id, {
          type: consultation.type,
          priority: consultation.priority,
          notes: 'Classified during manager quick assignment',
        });
      }
      await consultationsApi.route(consultation.id, {
        advisor_id: selection.id,
        advisor_name: selection.name,
        notes: 'Assigned from the contracts and consultations control panel',
      });
    },
    onSuccess: async () => {
      showSuccess(t.assignment.success);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contracts-control'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-consultations'] }),
      ]);
    },
    onError: showApiError,
  });

  const resolveContractType = useMemo(() => (key: string) => contractTypeLabels[key] ?? key, [contractTypeLabels]);
  const resolveConsultationType = useMemo(() => (key: string) => resolveConsultationTypeLabel(key, locale), [locale]);

  return (
    <div dir={direction} lang={locale} className="space-y-6">
      <PageHeader
        title={t.page.title}
        description={t.page.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/lex/contracts/control/assignment">
                <UsersRound className="me-1.5 h-4 w-4" aria-hidden />
                {locale === 'ar' ? 'توزيع العمل' : 'Work allocation'}
              </Link>
            </Button>
            {canAddRequest ? (
              <Button asChild>
                <Link href="/lex/service-desk/new">
                  <Plus className="me-1.5 h-4 w-4" aria-hidden />
                  {t.page.newRequest}
                </Link>
              </Button>
            ) : null}
            {canAddContract ? (
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {t.page.newContract}
              </Button>
            ) : null}
          </div>
        }
      />

      {panel.isError ? (
        <SectionError
          title={t.states.errorTitle}
          message={t.states.errorBody}
          retryLabel={t.states.retry}
          onRetry={panel.refetch}
        />
      ) : (
        <>
          <ControlKpis kpis={panel.kpis} loading={panel.isLoading} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              <RecentContractsCard contracts={panel.recentContracts} loading={panel.isLoading} />
              <RecentConsultationsCard consultations={panel.recentConsultations} loading={panel.isLoading} />
            </div>
            <div className="space-y-6">
              <UnassignedWorkCard
                contracts={panel.unassignedContracts}
                consultations={panel.unassignedConsultations}
                loading={panel.isLoading}
                assigning={assignmentMutation.isPending}
                canAssignContract={canAssignContract}
                canAssignConsultation={canAssignConsultation}
                onAssign={(item, selection) => assignmentMutation.mutateAsync({ item, selection })}
              />
              <TypeBreakdownCard
                title={t.byType.contractsTitle}
                slices={panel.contractTypes}
                resolveLabel={resolveContractType}
                emptyLabel={t.byType.empty}
                ofTotal={t.byType.ofTotal}
                hrefFor={(type) => `/lex/contracts?type=${encodeURIComponent(type)}`}
                loading={panel.isLoading}
              />
              <TypeBreakdownCard
                title={t.byType.consultationsTitle}
                slices={panel.consultationTypes}
                resolveLabel={resolveConsultationType}
                emptyLabel={t.byType.empty}
                ofTotal={t.byType.ofTotal}
                hrefFor={(type) => `/lex/consultations?type=${encodeURIComponent(type)}`}
                loading={panel.isLoading}
              />
            </div>
          </div>
        </>
      )}

      <ContractFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(contract) => router.push(`/lex/contracts/${contract.id}`)}
      />
    </div>
  );
}

export default function LexContractsControlPanelPage() {
  return (
    <LexRouteGuard route="/lex/contracts/control">
      <ControlPanelContent />
    </LexRouteGuard>
  );
}
