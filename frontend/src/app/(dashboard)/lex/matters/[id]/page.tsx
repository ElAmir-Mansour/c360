'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Hash,
  Link2,
  MoreHorizontal,
  PencilLine,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Tag,
  Trash2,
  Unlink,
  User2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { RelativeTime } from '@/components/shared/relative-time';
import { LexPriorityChip, LexStatusChip } from '@/components/lex/status-chip';
import { AskForSupportButton } from '@/components/lex/support-composer';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { RecordRecent } from '@/hooks/use-recent-items';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  LexLinkMatterContractPayload,
  LexMatterContract,
  LexObligation,
  LexTriageMatterPayload,
} from '@/types/suites';
import { MatterObligationSummary } from '../_components/matter-obligation-summary';
import { MatterSlaBadge } from '../_lib/matter-sla';
import { MatterCaseTimeline } from '../_components/matter-timeline';
import { MatterDeadlineCalendar } from '../_components/obligation-deadline-calendar';
import { MatterFormDialog } from '../_components/matter-form-dialog';
import { MatterLinkContractDialog } from '../_components/matter-link-contract-dialog';
import { MatterObligationManager } from '../_components/obligation-manager';
import { MatterStatusDialog } from '../_components/matter-status-dialog';
import { MatterTriageDialog } from '../_components/matter-triage-dialog';
import { MatterActivityFeed } from '../_components/matter-activity-feed';
import { MatterCommentsThread } from '../_components/matter-comments-thread';
import { MatterDocumentsSection } from '../_components/matter-documents-section';
import { MatterRelatedItems } from '../_components/matter-related-items';
import { MATTER_STATUS_TRANSITIONS, useMatterLabels } from '../_components/labels';
// --- Detail revamp components ---
import { MatterToolbarNav } from './_components/matter-toolbar-nav';
import { MatterActionBar } from './_components/matter-action-bar';
import { MatterLifecycleStepper } from './_components/matter-lifecycle-stepper';
import { MatterPeopleCard } from './_components/matter-people-card';
import { MatterRelatedCard } from './_components/matter-related-card';
import { MatterActivityMini } from './_components/matter-activity-mini';
import { MatterSlaRibbon } from './_components/matter-sla-ribbon';
import {
  useMatterDetailTabLabels,
  useMatterKeyFactsLabels,
} from './_components/matter-detail-labels';
import { useMatterTypeLabel, useMatterRelationshipLabel } from './_components/matter-enums-i18n';

type MatterTab =
  | 'overview'
  | 'obligations'
  | 'timeline'
  | 'documents'
  | 'related'
  | 'activity'
  | 'discussion';

export default function LexMatterDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const matterId = params?.id ?? '';
  // §9 — matters surface legal case work; gate mutation on lex:case:edit.
  const canWrite = hasPermission('lex:case:edit');
  // Support requests are raised from the record, not just the inbox/top bar.
  // Same verb the inbox uses for its own "Ask for support" entry point.
  const canAskSupport = hasPermission('lex:support:create');
  const matterLabels = useMatterLabels();
  const labels = matterLabels.detail;
  const tabLabels = useMatterDetailTabLabels();
  const keyFactsLabels = useMatterKeyFactsLabels();
  const typeLabel = useMatterTypeLabel();
  const relationshipLabel = useMatterRelationshipLabel();

  const [tab, setTab] = useState<MatterTab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<LexMatterContract | null>(null);

  const matterQuery = useQuery({
    queryKey: ['lex-matter', matterId],
    queryFn: () => enterpriseApi.lex.getMatter(matterId),
    enabled: Boolean(matterId),
  });

  const obligationsQuery = useQuery({
    queryKey: ['lex-matter-obligations', matterId],
    queryFn: () =>
      enterpriseApi.lex.listMatterObligations(matterId, { page: 1, per_page: 50, order: 'asc' }),
    enabled: Boolean(matterId),
  });

  const refreshMatter = async () => {
    await Promise.all([
      matterQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ['lex-matter-obligations', matterId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-matters'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
    ]);
  };

  const statusMutation = useMutation({
    mutationFn: (status: string) => enterpriseApi.lex.updateMatterStatus(matterId, { status }),
    onSuccess: async () => {
      showSuccess(matterLabels.toast.statusUpdated);
      setStatusOpen(false);
      await refreshMatter();
    },
    onError: showApiError,
  });

  const triageMutation = useMutation({
    mutationFn: (payload: LexTriageMatterPayload) => enterpriseApi.lex.triageMatter(matterId, payload),
    onSuccess: async () => {
      showSuccess(matterLabels.toast.triaged);
      setTriageOpen(false);
      await refreshMatter();
    },
    onError: showApiError,
  });

  const linkMutation = useMutation({
    mutationFn: (payload: LexLinkMatterContractPayload) =>
      enterpriseApi.lex.linkMatterContract(matterId, payload),
    onSuccess: async () => {
      showSuccess(matterLabels.toast.linked);
      setLinkOpen(false);
      await refreshMatter();
    },
    onError: showApiError,
  });

  const unlinkMutation = useMutation({
    mutationFn: (contractId: string) => enterpriseApi.lex.unlinkMatterContract(matterId, contractId),
    onSuccess: async () => {
      showSuccess(matterLabels.toast.unlinked);
      setUnlinkTarget(null);
      await refreshMatter();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.deleteMatter(matterId),
    onSuccess: async () => {
      showSuccess(matterLabels.toast.deleted);
      await queryClient.invalidateQueries({ queryKey: ['lex-matters'] });
      router.push('/lex/matters');
    },
    onError: showApiError,
  });

  // Feature 6 — matter-scoped reminder send. The summary widget surfaces this
  // affordance only when a handler is supplied; we gate it on write access and
  // dispatch a per-obligation markObligationReminderSent (the tenant-wide
  // enqueue endpoint is intentionally not used from this matter-scoped surface).
  const remindersMutation = useMutation({
    mutationFn: (targets: LexObligation[]) =>
      Promise.all(targets.map((o) => enterpriseApi.lex.markObligationReminderSent(o.id))),
    onSuccess: async () => {
      showSuccess(matterLabels.toast.updated);
      await queryClient.invalidateQueries({ queryKey: ['lex-matter-obligations', matterId] });
    },
    onError: showApiError,
  });

  if (matterQuery.isLoading) {
    return (
      <LexRouteGuard requirement="lex:case:view">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader title={labels.loadingTitle} description={labels.loadingDescription} />
          <LoadingSkeleton variant="card" count={4} />
        </div>
      </LexRouteGuard>
    );
  }

  if (matterQuery.isError || !matterQuery.data) {
    return (
      <LexRouteGuard requirement="lex:case:view">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader title={labels.loadingTitle} description={labels.fallbackDescription} />
          <ErrorState message={labels.errorMessage} onRetry={() => void matterQuery.refetch()} />
        </div>
      </LexRouteGuard>
    );
  }

  const matter = matterQuery.data;
  const contracts = matter.contracts ?? [];
  const obligations = obligationsQuery.data?.data ?? [];
  const allowedStatuses = MATTER_STATUS_TRANSITIONS[matter.status] ?? [];

  const heroFacts: { key: string; icon: typeof Hash; label: string; value: string }[] = [
    {
      key: 'number',
      icon: Hash,
      label: labels.metadata.matterNumber,
      value: matter.matter_number || labels.autoGenerated,
    },
    { key: 'type', icon: Tag, label: labels.metricType, value: typeLabel(matter.type) },
    {
      key: 'owner',
      icon: User2,
      label: labels.metadata.owner,
      value: matter.owner_name || labels.unassigned,
    },
    {
      key: 'opened',
      icon: CalendarClock,
      label: labels.metadata.openedAt,
      value: matter.opened_at ? f.formatDual(matter.opened_at) : labels.notSet,
    },
  ];

  const headerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <MatterToolbarNav matterId={matter.id} matterNumber={matter.matter_number} />
      {/*
        Context is passed EXPLICITLY rather than derived from the URL so nested
        matter routes bind to this record too.
      */}
      {canAskSupport ? (
        <AskForSupportButton context={{ subjectType: 'matter', subjectId: matter.id }} />
      ) : null}
      {canWrite ? (
        <>
          <Button
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="motion-safe:duration-fast"
          >
            <PencilLine className="me-1.5 h-3.5 w-3.5" />
            {labels.edit}
          </Button>
          <Button variant="outline" onClick={() => setTriageOpen(true)}>
            <SlidersHorizontal className="me-1.5 h-3.5 w-3.5" />
            {labels.triage}
          </Button>
          <Button
            variant="outline"
            onClick={() => setStatusOpen(true)}
            disabled={allowedStatuses.length === 0}
          >
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            {labels.changeStatus}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={matterLabels.list.columns.actions}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setDeleteOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="me-2 h-3.5 w-3.5" />
                {labels.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  );

  return (
    <LexRouteGuard requirement="lex:case:view">
      <div className="space-y-6 motion-safe:animate-fade-up" dir={direction} lang={locale}>
        {/* Feeds the global recents (Cmd+K palette + lex recent strip). */}
        <RecordRecent
          type="matter"
          id={matter.id}
          title={matter.title}
          href={`/lex/matters/${matter.id}`}
        />

        {/* #1 Hero band — chips + title + key facts + actions */}
        <section className="card p-6 sm:p-7">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <LexStatusChip
                    value={matter.status}
                    domain="matter"
                    labels={matterLabels.filters.statusOptions}
                    size="md"
                  />
                  <LexPriorityChip
                    value={matter.priority}
                    labels={matterLabels.filters.priorityOptions}
                    size="md"
                  />
                  <MatterSlaBadge matter={matter} size="md" />
                </div>
                <h1
                  className="text-h2 font-bold leading-tight tracking-tight text-foreground"
                  dir="auto"
                >
                  {matter.title}
                </h1>
                {matter.description ? (
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground" dir="auto">
                    {matter.description}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0">{headerActions}</div>
            </div>

            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {heroFacts.map((fact) => {
                const Icon = fact.icon;
                return (
                  <div
                    key={fact.key}
                    className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 shadow-elevation-1"
                  >
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
                        {fact.label}
                      </dt>
                      <dd
                        className="truncate text-sm font-medium text-foreground"
                        dir="auto"
                        title={fact.value}
                      >
                        {fact.value}
                      </dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          </div>
        </section>

        {/* #4 Compact lifecycle stepper */}
        <MatterLifecycleStepper status={matter.status} matterId={matterId} />

        {/* #3 Status-complete "What needs you now" action bar */}
        <MatterActionBar
          matter={matter}
          canWrite={canWrite}
          allowedStatuses={allowedStatuses}
          onTriage={() => setTriageOpen(true)}
          onStatus={() => setStatusOpen(true)}
        />

        {/* #5 Two-column layout — tabs left, persistent sticky rail right */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Tabs value={tab} onValueChange={(v) => setTab(v as MatterTab)} className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">{tabLabels.overview}</TabsTrigger>
                <TabsTrigger value="obligations">{tabLabels.obligations}</TabsTrigger>
                <TabsTrigger value="timeline">{tabLabels.timeline}</TabsTrigger>
                <TabsTrigger value="documents">{tabLabels.documents}</TabsTrigger>
                <TabsTrigger value="related">{tabLabels.related}</TabsTrigger>
                <TabsTrigger value="activity">{tabLabels.activity}</TabsTrigger>
                <TabsTrigger value="discussion">{tabLabels.discussion}</TabsTrigger>
              </TabsList>

              <TabsContent
                value="overview"
                forceMount
                className="space-y-6 data-[state=inactive]:hidden"
              >
                <MatterObligationSummary
                  matterId={matterId}
                  variant="full"
                  onSendReminders={
                    canWrite
                      ? (targets) => {
                          if (targets.length > 0) {
                            remindersMutation.mutate(targets);
                          }
                        }
                      : undefined
                  }
                />

                {/* #6 Dense, localized overview grid with inline add for empty
                    writable fields. Matter number lives in the hero, so it is
                    intentionally omitted here. */}
                <SectionCard title={labels.overviewTitle} description={labels.overviewDescription}>
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                    <MetaField label={labels.metadata.type} value={typeLabel(matter.type)} />
                    <MetaField
                      label={labels.metadata.owner}
                      value={matter.owner_name || ''}
                      notSet={labels.unassigned}
                    />
                    <MetaField
                      label={labels.metadata.requester}
                      value={matter.requester_name || ''}
                      onAdd={canWrite ? () => setEditOpen(true) : undefined}
                      addLabel={labels.edit}
                      notSet={labels.notSet}
                    />
                    <MetaField
                      label={labels.metadata.department}
                      value={matter.department || ''}
                      onAdd={canWrite ? () => setEditOpen(true) : undefined}
                      addLabel={labels.edit}
                      notSet={labels.notSet}
                    />
                    <MetaField
                      label={labels.metadata.dueDate}
                      value={
                        matter.due_date ? <RelativeTime date={matter.due_date} /> : ''
                      }
                      onAdd={canWrite ? () => setEditOpen(true) : undefined}
                      addLabel={labels.edit}
                      notSet={labels.noDueDate}
                    />
                    <MetaField
                      label={labels.metadata.closedAt}
                      value={matter.closed_at ? f.formatDual(matter.closed_at) : ''}
                      notSet={labels.notSet}
                    />
                    <MetaField label={labels.metadata.created} value={f.formatDual(matter.created_at)} />
                    <MetaField
                      label={labels.metadata.updated}
                      value={<RelativeTime date={matter.updated_at} />}
                    />
                    <MetaField
                      label={labels.metadata.tags}
                      value={
                        matter.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {matter.tags.map((tag) => (
                              <Badge key={tag} variant="outline">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          ''
                        )
                      }
                      notSet={labels.noTags}
                    />
                  </dl>
                </SectionCard>

                <SectionCard title={labels.descriptionTitle}>
                  <p className="whitespace-pre-line text-sm text-muted-foreground" dir="auto">
                    {matter.description || labels.descriptionEmpty}
                  </p>
                </SectionCard>

                <SectionCard
                  title={labels.contractsTitle}
                  description={labels.contractsDescription}
                  actions={
                    canWrite ? (
                      <Button size="sm" onClick={() => setLinkOpen(true)}>
                        <Plus className="me-1.5 h-3.5 w-3.5" />
                        {labels.linkContract}
                      </Button>
                    ) : undefined
                  }
                >
                  {contracts.length === 0 ? (
                    <EmptyState
                      icon={Link2}
                      title={labels.contractsEmptyTitle}
                      description={labels.contractsEmptyDescription}
                    />
                  ) : (
                    <div className="space-y-3">
                      {contracts.map((contract) => (
                        <div
                          key={contract.id}
                          className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5"
                        >
                          <span className="absolute inset-y-0 start-0 w-1 bg-sky-400/70" aria-hidden />
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Link
                                href={`/lex/contracts/${contract.contract_id}`}
                                className="font-medium hover:underline"
                              >
                                {contract.contract_title || contract.contract_id}
                              </Link>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {labels.relationship}: {relationshipLabel(contract.relationship)} •{' '}
                                {f.formatDual(contract.created_at)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{relationshipLabel(contract.relationship)}</Badge>
                              {canWrite ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setUnlinkTarget(contract)}
                                  disabled={unlinkMutation.isPending}
                                >
                                  <Unlink className="me-1.5 h-3.5 w-3.5" />
                                  {labels.unlink}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </TabsContent>

              <TabsContent
                value="obligations"
                forceMount
                className="space-y-6 data-[state=inactive]:hidden"
              >
                <SectionCard title={labels.obligationsTitle} description={labels.obligationsDescription}>
                  <MatterObligationManager matterId={matterId} canWrite={canWrite} />
                </SectionCard>
                <MatterDeadlineCalendar matterId={matterId} matter={matter} obligations={obligations} />
              </TabsContent>

              <TabsContent value="timeline" className="space-y-6">
                <MatterCaseTimeline matterId={matterId} canWrite={canWrite} />
              </TabsContent>

              <TabsContent value="documents" className="space-y-6">
                <MatterDocumentsSection matterId={matterId} canWrite={canWrite} />
              </TabsContent>

              <TabsContent value="related" className="space-y-6">
                <MatterRelatedItems matterId={matterId} canWrite={canWrite} />
              </TabsContent>

              <TabsContent value="activity" className="space-y-6">
                <MatterActivityFeed matterId={matterId} />
              </TabsContent>

              <TabsContent value="discussion" className="space-y-6">
                <MatterCommentsThread matterId={matterId} canWrite={canWrite} />
              </TabsContent>
            </Tabs>
          </div>

          {/* #5 Persistent sticky right rail */}
          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <MatterSlaRibbon matter={matter} />
            <MatterPeopleCard matter={matter} />
            <SectionCard title={keyFactsLabels.title}>
              <dl className="space-y-3">
                <KeyFactRow label={keyFactsLabels.opened}>
                  {matter.opened_at ? f.formatDual(matter.opened_at) : keyFactsLabels.notSet}
                </KeyFactRow>
                <KeyFactRow label={keyFactsLabels.due}>
                  {matter.due_date ? <RelativeTime date={matter.due_date} /> : keyFactsLabels.noDueDate}
                </KeyFactRow>
                <KeyFactRow label={keyFactsLabels.closed}>
                  {matter.closed_at ? f.formatDual(matter.closed_at) : keyFactsLabels.notSet}
                </KeyFactRow>
                <KeyFactRow label={keyFactsLabels.department}>
                  {matter.department || keyFactsLabels.notSet}
                </KeyFactRow>
              </dl>
            </SectionCard>
            <MatterRelatedCard matter={matter} />
            <MatterActivityMini matterId={matterId} onViewAll={() => setTab('activity')} />
          </aside>
        </div>

        {canWrite ? (
          <>
            <MatterFormDialog
              open={editOpen}
              matter={matter}
              onOpenChange={setEditOpen}
              onSaved={() => void refreshMatter()}
            />
            <MatterStatusDialog
              open={statusOpen}
              loading={statusMutation.isPending}
              options={allowedStatuses}
              onOpenChange={setStatusOpen}
              onSubmit={(status) => statusMutation.mutate(status)}
            />
            <MatterTriageDialog
              open={triageOpen}
              matter={matter}
              loading={triageMutation.isPending}
              onOpenChange={setTriageOpen}
              onSubmit={(payload) => triageMutation.mutate(payload)}
            />
            <MatterLinkContractDialog
              open={linkOpen}
              loading={linkMutation.isPending}
              linkedContracts={contracts}
              onOpenChange={setLinkOpen}
              onSubmit={(payload) => linkMutation.mutate(payload)}
            />
            <ConfirmDialog
              open={Boolean(unlinkTarget)}
              onOpenChange={(open) => {
                if (!open) setUnlinkTarget(null);
              }}
              title={matterLabels.confirm.unlinkTitle}
              description={matterLabels.confirm.unlinkDescription(
                unlinkTarget?.contract_title ?? unlinkTarget?.contract_id ?? '',
              )}
              confirmLabel={matterLabels.confirm.unlinkConfirm}
              variant="destructive"
              loading={unlinkMutation.isPending}
              onConfirm={() => {
                if (unlinkTarget) {
                  unlinkMutation.mutate(unlinkTarget.contract_id);
                }
              }}
            />
            <ConfirmDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title={matterLabels.confirm.deleteTitle}
              description={matterLabels.confirm.deleteDescription(matter.title)}
              confirmLabel={labels.delete}
              variant="destructive"
              loading={deleteMutation.isPending}
              onConfirm={async () => {
                await deleteMutation.mutateAsync();
              }}
            />
          </>
        ) : null}
      </div>
    </LexRouteGuard>
  );
}

/* #6 A compact key/value field. Empty values become an inline "add" affordance
   (opens the edit dialog) when the viewer can write, otherwise a muted fallback. */
function MetaField({
  label,
  value,
  onAdd,
  addLabel,
  notSet,
}: {
  label: string;
  value: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  notSet?: string;
}) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '');
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground" dir="auto">
        {isEmpty ? (
          onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {addLabel}
            </button>
          ) : (
            <span className="font-normal text-muted-foreground">{notSet ?? '—'}</span>
          )
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function KeyFactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-end text-sm font-medium text-foreground" dir="auto">
        {children}
      </dd>
    </div>
  );
}
