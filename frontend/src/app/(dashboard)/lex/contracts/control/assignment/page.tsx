'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { useLocale } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { consultationsApi } from '@/lib/lex/consultations';
import { showApiError, showSuccess } from '@/lib/toast';
import { LexRouteGuard } from '../../../_guards/lex-route-guard';
import type { UserDirectoryEntry } from '@/types/suites';

import {
  UnassignedWorkCard,
  type AssignmentBacklogItem,
  type AssignmentSelection,
} from '../_components/unassigned-work-card';
import { useContractsControl } from '../_lib/use-contracts-control';
import { useContractsControlLabels } from '../_lib/labels';

const COPY = {
  en: {
    title: 'Contracts & Consultations Allocation',
    description:
      'Assign approved incoming work and balance live capacity across the legal team.',
    back: 'Control dashboard',
    capacity: 'Consultant Allocations & Live Capacity',
    capacityHint:
      'Use current assignments to keep distributions balanced and preserve response deadlines.',
    load: 'Allocation load',
    assigned: (value: number) => `${value} active`,
    available: (value: number) => `${value} slots`,
    noTeam: 'No eligible consultants are available.',
    success: 'Assignment saved',
  },
  ar: {
    title: 'توزيع العقود والاستشارات',
    description: 'إسناد الأعمال الواردة المعتمدة وموازنة الطاقة الاستيعابية للفريق القانوني.',
    back: 'لوحة التحكم',
    capacity: 'توزيع المستشارين والطاقة الاستيعابية المباشرة',
    capacityHint:
      'استخدم التكليفات الحالية لموازنة توزيع العمل والمحافظة على مواعيد الاستجابة.',
    load: 'حمل التكليفات',
    assigned: (value: number) => `${value} نشطة`,
    available: (value: number) => `${value} شواغر`,
    noTeam: 'لا يوجد مستشارون مؤهلون متاحون.',
    success: 'تم حفظ التعيين',
  },
} as const;

async function loadConsultants(): Promise<UserDirectoryEntry[]> {
  try {
    const groups = await Promise.all([
      enterpriseApi.users.listByRole('legal-contracts-supervisor'),
      enterpriseApi.users.listByRole('legal-advisor'),
    ]);
    const byId = new Map<string, UserDirectoryEntry>();
    for (const user of groups.flat()) byId.set(user.id, user);
    if (byId.size > 0) return [...byId.values()];
  } catch {
    // Fall back to the active tenant directory when role slugs are not seeded.
  }
  const response = await enterpriseApi.users.list({
    page: 1,
    per_page: 200,
    sort: 'first_name',
    order: 'asc',
  });
  return response.data.filter((entry) => entry.status.toLocaleLowerCase() === 'active');
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase();
}

function AllocationContent() {
  const { locale, direction } = useLocale();
  const copy = COPY[locale === 'ar' ? 'ar' : 'en'];
  const labels = useContractsControlLabels();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const panel = useContractsControl();
  const usersQuery = useQuery({
    queryKey: ['contracts-control', 'allocation-team'],
    queryFn: loadConsultants,
    staleTime: 5 * 60_000,
  });

  const canAssignContract = hasPermission('lex:contract:edit');
  const canAssignConsultation = hasPermission('lex:consultation:edit');

  const assignmentMutation = useMutation({
    mutationFn: async ({
      item,
      selection,
    }: {
      item: AssignmentBacklogItem;
      selection: AssignmentSelection;
    }) => {
      if (item.kind === 'contract') {
        await enterpriseApi.lex.updateContract(item.id, {
          legal_reviewer_id: selection.id,
          legal_reviewer_name: selection.name,
        });
        return;
      }
      if (!item.consultation) throw new Error('Consultation assignment target is unavailable');
      if (item.consultation.status === 'submitted') {
        await consultationsApi.classify(item.id, {
          type: item.consultation.type,
          priority: item.consultation.priority,
          notes: 'Classified during manager quick assignment',
        });
      }
      await consultationsApi.route(item.id, {
        advisor_id: selection.id,
        advisor_name: selection.name,
        notes: 'Assigned from the contracts and consultations allocation workspace',
      });
    },
    onSuccess: async () => {
      showSuccess(copy.success);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contracts-control'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-consultations'] }),
      ]);
    },
    onError: showApiError,
  });

  const users = usersQuery.data ?? [];
  const activeContracts = panel.recentContracts.filter(
    (item) => !['expired', 'terminated', 'cancelled'].includes(item.status),
  );
  const activeConsultations = panel.recentConsultations.filter(
    (item) => !['closed', 'cancelled', 'rejected'].includes(item.status),
  );

  return (
    <div dir={direction} lang={locale} className="space-y-6 rounded-2xl bg-background">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button variant="outline" asChild>
            <Link href="/lex/contracts/control">
              <ArrowLeft className="me-1.5 h-4 w-4 rtl:-scale-x-100" aria-hidden />
              {copy.back}
            </Link>
          </Button>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(320px,520px)_minmax(0,1fr)]">
        <UnassignedWorkCard
          contracts={panel.unassignedContracts}
          consultations={panel.unassignedConsultations}
          loading={panel.isLoading}
          assigning={assignmentMutation.isPending}
          canAssignContract={canAssignContract}
          canAssignConsultation={canAssignConsultation}
          onAssign={(item, selection) =>
            assignmentMutation.mutateAsync({ item, selection })
          }
        />

        <section className="rounded-2xl border border-border bg-white p-6">
          <h2 className="text-lg font-bold text-foreground">{copy.capacity}</h2>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">{copy.capacityHint}</p>

          <div className="mt-5 space-y-3">
            {usersQuery.isLoading ? (
              Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-[74px] w-full rounded-lg" />
              ))
            ) : users.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">{copy.noTeam}</p>
            ) : (
              users.slice(0, 10).map((user) => {
                const name = userDisplayName(user);
                const contracts = activeContracts.filter(
                  (item) =>
                    item.legal_reviewer_id === user.id ||
                    item.legal_reviewer_name?.toLocaleLowerCase() ===
                      name.toLocaleLowerCase(),
                ).length;
                const consultations = activeConsultations.filter(
                  (item) =>
                    item.advisor_id === user.id ||
                    item.advisor_name?.toLocaleLowerCase() === name.toLocaleLowerCase(),
                ).length;
                const total = contracts + consultations;
                const capacity = 5;
                const percent = Math.min(100, Math.round((total / capacity) * 100));
                const available = Math.max(0, capacity - total);
                return (
                  <div
                    key={user.id}
                    className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-center"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {initials(name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-foreground">
                        {name}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {user.roles[0]?.name ?? user.email}
                      </span>
                    </span>
                    <span className="w-full shrink-0 sm:w-60">
                      <span className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{copy.load}</span>
                        <strong className="text-foreground">{percent}%</strong>
                      </span>
                      <span
                        className="block h-1.5 overflow-hidden rounded-full bg-primary/10"
                        role="progressbar"
                        aria-label={`${copy.load}: ${percent}%`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                      >
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                    </span>
                    <span className="min-w-24 shrink-0 text-end">
                      <strong className="block text-sm text-foreground">
                        {copy.available(available)}
                      </strong>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {copy.assigned(total)}
                      </span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {assignmentMutation.isPending ? (
        <span className="sr-only" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {labels.assignment.assigning}
        </span>
      ) : null}
    </div>
  );
}

export default function ContractsConsultationsAllocationPage() {
  return (
    <LexRouteGuard route="/lex/contracts/control/assignment">
      <AllocationContent />
    </LexRouteGuard>
  );
}
