'use client';

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Coins,
  Hash,
  Handshake,
  MoreHorizontal,
  PencilLine,
  Plus,
  Scale,
  Send,
  ShieldCheck,
  Trash2,
  User2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { LexStatusChip } from '@/components/lex/status-chip';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexFormatter } from '@/lib/lex/ksa';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  isSettlementMutable,
  settlementsApi,
  type AddNegotiationRoundPayload,
  type RecordSettlementPayload,
  type Settlement,
  type SettlementDecisionPayload,
  type SettlementNegotiationRound,
} from '@/lib/lex/settlements';
// Existing settlement surfaces — preserved verbatim (read/keep, never removed).
import { SettlementFormDialog } from '../_components/settlement-form-dialog';
import { NegotiationRoundDialog } from '../_components/negotiation-round-dialog';
import { SettlementDecisionDialog } from '../_components/settlement-decision-dialog';
import { CaseTimelinePanel } from '../_components/case-timeline-panel';
import { SettlementStepper } from '../_components/settlement-stepper';
import { NegotiationValueChart } from '../_components/negotiation-value-chart';
import { SettlementAuditFeed } from '../_components/settlement-audit-feed';
import { SettlementAgreementButton } from '../_components/settlement-agreement-print';
import { CounterpartyInsights } from '../_components/counterparty-insights';
import { SettlementDocumentsSection } from '../_components/settlement-documents-section';
import { SettlementWorkflowStatus } from '../_components/settlement-workflow-status';
import { settlementMethodLabel, useSettlementLabels, type SettlementLabels } from '../_components/labels';
// --- Revamp wave (co-located) ---
import { SettlementToolbarNav } from './_components/settlement-toolbar-nav';
import { SettlementActionBar } from './_components/settlement-action-bar';
import { SettlementKeyFactsCard } from './_components/settlement-key-facts-card';
import { SettlementPeopleCard } from './_components/settlement-people-card';
import { SettlementRelatedCard } from './_components/settlement-related-card';
import { SettlementActivityMini } from './_components/settlement-activity-mini';
import { useSettlementDetailExtraLabels } from './_components/detail-extra-labels';

type DetailTab = 'overview' | 'rounds' | 'documents' | 'timeline' | 'activity';

export default function LexSettlementDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const settlementId = params?.id ?? '';
  // §9/§18.4 — domain-specific settlement verbs replace coarse write/approve/close.
  const canWrite = hasPermission('lex:settlement:edit');
  const canApprove = hasPermission('lex:settlement:approve');
  const canClose = hasPermission('lex:settlement:close');
  const L = useSettlementLabels();
  const labels = L.detail;
  const extra = useSettlementDetailExtraLabels();

  const [tab, setTab] = useState<DetailTab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [roundOpen, setRoundOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const settlementQuery = useQuery({
    queryKey: ['lex-settlement', settlementId],
    queryFn: () => settlementsApi.get(settlementId),
    enabled: Boolean(settlementId),
  });

  const refresh = async () => {
    await Promise.all([
      settlementQuery.refetch(),
      queryClient.invalidateQueries({
        queryKey: ['lex-settlement-audit', settlementId],
      }),
      queryClient.invalidateQueries({ queryKey: ['lex-settlements'] }),
    ]);
  };

  const roundMutation = useMutation({
    mutationFn: (payload: AddNegotiationRoundPayload) => settlementsApi.addRound(settlementId, payload),
    onSuccess: async () => {
      showSuccess(L.toast.roundAdded);
      setRoundOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const recordMutation = useMutation({
    mutationFn: (payload: RecordSettlementPayload) => settlementsApi.record(settlementId, payload),
    onSuccess: async () => {
      showSuccess(L.toast.updated);
      await refresh();
    },
    onError: showApiError,
  });
  // recordMutation is exercised through the SettlementFormDialog (edit flow);
  // kept here so future inline edits can reuse it without re-wiring.
  void recordMutation;

  const submitMutation = useMutation({
    mutationFn: () => settlementsApi.submitForApproval(settlementId),
    onSuccess: async () => {
      showSuccess(L.toast.submitted);
      setSubmitOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const decideMutation = useMutation({
    mutationFn: ({
      workflowId,
      taskId,
      payload,
    }: {
      workflowId: string;
      taskId: string;
      payload: SettlementDecisionPayload;
    }) => settlementsApi.decide(settlementId, workflowId, taskId, payload),
    onSuccess: async () => {
      showSuccess(L.toast.decided);
      setDecisionOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const closeMutation = useMutation({
    mutationFn: () => settlementsApi.close(settlementId),
    onSuccess: async () => {
      showSuccess(L.toast.closed);
      setCloseOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: () => settlementsApi.remove(settlementId),
    onSuccess: async () => {
      showSuccess(L.toast.deleted);
      await queryClient.invalidateQueries({ queryKey: ['lex-settlements'] });
      router.push('/lex/settlements');
    },
    onError: showApiError,
  });

  if (settlementQuery.isLoading) {
    return (
      <LexRouteGuard route="/lex/settlements/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader title={labels.loadingTitle} description={labels.fallbackDescription} />
          <LoadingSkeleton variant="card" count={4} />
        </div>
      </LexRouteGuard>
    );
  }

  if (settlementQuery.isError || !settlementQuery.data) {
    return (
      <LexRouteGuard route="/lex/settlements/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader title={labels.loadingTitle} description={labels.fallbackDescription} />
          <ErrorState message={labels.errorMessage} onRetry={() => void settlementQuery.refetch()} />
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => router.push('/lex/settlements')}>
              {labels.viewMatter}
            </Button>
          </div>
        </div>
      </LexRouteGuard>
    );
  }

  const settlement = settlementQuery.data;
  const rounds = settlement.rounds ?? [];
  const mutable = isSettlementMutable(settlement.status);
  const awaitingApproval = settlement.status === 'pending_approval';
  const approved = settlement.status === 'approved';
  const decisionReady = awaitingApproval && Boolean(settlement.workflow_instance_id);
  const reference = settlement.reference || settlementId;

  // Which overflow-menu items the viewer can see (drives whether the ⋯ shows).
  const showAddRound = canWrite && mutable;
  const showSubmit = canWrite && mutable;
  const showDecision = canApprove && awaitingApproval;
  const showClose = canClose && approved;
  const showDelete = canWrite;
  const hasMenu = showAddRound || showSubmit || showDecision || showClose || showDelete;

  const headerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <SettlementToolbarNav settlementId={settlement.id} reference={reference} />
      <SettlementAgreementButton settlement={settlement} rounds={rounds} />
      {canWrite && mutable ? (
        <Button variant="outline" onClick={() => setEditOpen(true)} className="motion-safe:duration-fast">
          <PencilLine className="me-1.5 h-3.5 w-3.5" />
          {labels.recordTerms}
        </Button>
      ) : null}
      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={labels.edit}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {showAddRound ? (
              <DropdownMenuItem onSelect={() => setRoundOpen(true)}>
                <Plus className="me-2 h-3.5 w-3.5" />
                {labels.addRound}
              </DropdownMenuItem>
            ) : null}
            {showSubmit ? (
              <DropdownMenuItem onSelect={() => setSubmitOpen(true)}>
                <Send className="me-2 h-3.5 w-3.5" />
                {labels.submit}
              </DropdownMenuItem>
            ) : null}
            {showDecision ? (
              <DropdownMenuItem onSelect={() => setDecisionOpen(true)}>
                <ShieldCheck className="me-2 h-3.5 w-3.5" />
                {labels.decide}
              </DropdownMenuItem>
            ) : null}
            {showClose ? (
              <DropdownMenuItem onSelect={() => setCloseOpen(true)}>
                <CheckCircle2 className="me-2 h-3.5 w-3.5" />
                {labels.close}
              </DropdownMenuItem>
            ) : null}
            {showDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setDeleteOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="me-2 h-3.5 w-3.5" />
                  {labels.delete}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <LexRouteGuard route="/lex/settlements/[id]">
      <div className="space-y-6 motion-safe:animate-fade-up" dir={direction} lang={locale}>
        {/* Hero band — chips + title + key facts (amount prominent) + actions. */}
        <SettlementHero settlement={settlement} labels={L} extra={extra} actions={headerActions} f={f} />

        {/* Compact FSM lifecycle stepper (preserved). */}
        <SettlementStepper status={settlement.status} />

        {/* "What needs you now" — status-complete next action. */}
        <SettlementActionBar
          settlement={settlement}
          canWrite={canWrite}
          canApprove={canApprove}
          canClose={canClose}
          onRecordTerms={() => setEditOpen(true)}
          onAddRound={() => setRoundOpen(true)}
          onSubmit={() => setSubmitOpen(true)}
          onDecide={() => setDecisionOpen(true)}
          onClose={() => setCloseOpen(true)}
          onOpenApproval={() => setTab('overview')}
        />

        {/* Two-column layout — tabs on the left, a persistent sticky rail. */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Tabs value={tab} onValueChange={(v) => setTab(v as DetailTab)}>
              <TabsList>
                <TabsTrigger value="overview">{extra.tabs.overview}</TabsTrigger>
                <TabsTrigger value="rounds">{extra.tabs.rounds}</TabsTrigger>
                <TabsTrigger value="documents">{extra.tabs.documents}</TabsTrigger>
                <TabsTrigger value="timeline">{extra.tabs.timeline}</TabsTrigger>
                <TabsTrigger value="activity">{extra.tabs.activity}</TabsTrigger>
              </TabsList>

              {/* Overview — dense meta grid + terms + counterparty insights + workflow. */}
              <TabsContent value="overview" className="space-y-4">
                <SectionCard title={labels.overviewTitle} description={labels.overviewDescription}>
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                    <MetaField
                      label={labels.metadata.reference}
                      value={settlement.reference}
                      onAdd={mutable && canWrite ? () => setEditOpen(true) : undefined}
                      addLabel={extra.overview.addReference}
                      notSet={labels.notProvided}
                    />
                    <MetaField
                      label={labels.metadata.matter}
                      value={
                        <Link href={`/lex/matters/${settlement.matter_id}`} className="text-primary hover:underline">
                          {labels.viewMatter}
                        </Link>
                      }
                    />
                    <MetaField label={labels.metadata.method} value={settlementMethodLabel(L, settlement.method)} />
                    <MetaField
                      label={labels.metadata.value}
                      value={settlement.value != null ? formatMoney(f, settlement.value, settlement.currency) : ''}
                      onAdd={mutable && canWrite ? () => setEditOpen(true) : undefined}
                      addLabel={extra.overview.addValue}
                      notSet={labels.notProvided}
                      tabularNums
                    />
                    <MetaField
                      label={labels.metadata.counterpartyName}
                      value={settlement.counterparty_name}
                      onAdd={mutable && canWrite ? () => setEditOpen(true) : undefined}
                      addLabel={extra.overview.addCounterparty}
                      notSet={labels.notProvided}
                    />
                    <MetaField
                      label={labels.metadata.counterpartyContact}
                      value={settlement.counterparty_contact}
                      notSet={labels.notProvided}
                    />
                    <MetaField
                      label={labels.metadata.counterpartyId}
                      value={settlement.counterparty_id_number}
                      notSet={labels.notProvided}
                    />
                    <MetaField
                      label={labels.metadata.approvedBy}
                      value={settlement.approved_by}
                      notSet={labels.notProvided}
                    />
                    <MetaField
                      label={labels.metadata.approvedAt}
                      value={settlement.approved_at ? f.formatDual(settlement.approved_at) : ''}
                      notSet={labels.notProvided}
                    />
                    <MetaField
                      label={labels.metadata.executedAt}
                      value={settlement.executed_at ? f.formatDual(settlement.executed_at) : ''}
                      notSet={labels.notProvided}
                    />
                    <MetaField label={labels.metadata.created} value={f.formatDual(settlement.created_at)} />
                    <MetaField
                      label={labels.metadata.updated}
                      value={f.formatRelative(settlement.updated_at)}
                      tabularNums
                    />
                  </dl>
                </SectionCard>

                <SectionCard title={labels.termsTitle}>
                  <p className="whitespace-pre-line text-sm text-muted-foreground" dir="auto">
                    {settlement.terms || labels.termsEmpty}
                  </p>
                </SectionCard>

                <SectionCard title={labels.counterpartyTitle} description={labels.counterpartyDescription}>
                  <CounterpartyInsights settlement={settlement} canWrite={canWrite} />
                </SectionCard>

                {/* FEATURE 11 — live approval-workflow visibility while awaiting. */}
                {awaitingApproval && settlement.workflow_instance_id ? (
                  <SettlementWorkflowStatus workflowInstanceId={settlement.workflow_instance_id} />
                ) : null}
              </TabsContent>

              {/* Negotiation rounds — value chart + round rows. */}
              <TabsContent value="rounds">
                <SectionCard
                  title={labels.roundsTitle}
                  description={labels.roundsDescription}
                  actions={
                    canWrite && mutable ? (
                      <Button size="sm" onClick={() => setRoundOpen(true)}>
                        <Plus className="me-1.5 h-3.5 w-3.5" />
                        {labels.addRound}
                      </Button>
                    ) : undefined
                  }
                >
                  {rounds.length === 0 ? (
                    <EmptyState icon={Handshake} title={L.round.emptyTitle} description={L.round.emptyDescription} />
                  ) : (
                    <div className="space-y-4">
                      <NegotiationValueChart
                        rounds={rounds}
                        currency={settlement.currency}
                        settlementValue={settlement.value}
                        onRoundSelect={(roundId) =>
                          document.getElementById(`settlement-round-${roundId}`)?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center',
                          })
                        }
                      />
                      <div className="space-y-3">
                        {[...rounds]
                          .sort((a, b) => a.round_number - b.round_number)
                          .map((round) => (
                            <div key={round.id} id={`settlement-round-${round.id}`}>
                              <NegotiationRoundRow round={round} />
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </SectionCard>
              </TabsContent>

              {/* FEATURE 12 — linked repository documents (WORM links). */}
              <TabsContent value="documents">
                <SettlementDocumentsSection settlementId={settlementId} canWrite={canWrite} />
              </TabsContent>

              {/* Case timeline panel (CAP-084..088) on the owning matter. */}
              <TabsContent value="timeline">
                <CaseTimelinePanel matterId={settlement.matter_id} canWrite={canWrite} />
              </TabsContent>

              <TabsContent value="activity">
                <SettlementAuditFeed settlementId={settlementId} />
              </TabsContent>
            </Tabs>
          </div>

          {/* Persistent sticky right rail. */}
          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <SettlementKeyFactsCard settlement={settlement} />
            <SettlementPeopleCard settlement={settlement} />
            <SettlementRelatedCard settlement={settlement} onViewDocuments={() => setTab('documents')} />
            <SettlementActivityMini settlementId={settlementId} onViewAll={() => setTab('activity')} />
          </aside>
        </div>

        {/* Dialogs — all preserved with their original gating. */}
        {canWrite ? (
          <SettlementFormDialog
            open={editOpen}
            settlement={settlement}
            onOpenChange={setEditOpen}
            onSaved={() => void refresh()}
          />
        ) : null}

        {canWrite ? (
          <NegotiationRoundDialog
            open={roundOpen}
            loading={roundMutation.isPending}
            onOpenChange={setRoundOpen}
            onSubmit={(payload) => roundMutation.mutate(payload)}
          />
        ) : null}

        {canApprove ? (
          <SettlementDecisionDialog
            open={decisionOpen}
            loading={decideMutation.isPending}
            ready={decisionReady}
            onOpenChange={setDecisionOpen}
            onSubmit={(payload) => {
              if (settlement.workflow_instance_id) {
                // The approval task id is resolved server-side from the
                // workflow's single open human task; we pass the workflow id for
                // both segments when a dedicated task id is unavailable.
                decideMutation.mutate({
                  workflowId: settlement.workflow_instance_id,
                  taskId: settlement.workflow_instance_id,
                  payload,
                });
              }
            }}
          />
        ) : null}

        {canWrite ? (
          <ConfirmDialog
            open={submitOpen}
            onOpenChange={setSubmitOpen}
            title={L.confirm.submitTitle}
            description={L.confirm.submitDescription}
            confirmLabel={L.confirm.submitConfirm}
            loading={submitMutation.isPending}
            onConfirm={() => {
              submitMutation.mutate();
            }}
          />
        ) : null}

        {canClose ? (
          <ConfirmDialog
            open={closeOpen}
            onOpenChange={setCloseOpen}
            title={L.confirm.closeTitle}
            description={L.confirm.closeDescription}
            confirmLabel={L.confirm.closeConfirm}
            loading={closeMutation.isPending}
            onConfirm={() => {
              closeMutation.mutate();
            }}
          />
        ) : null}

        {canWrite ? (
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title={L.confirm.deleteTitle}
            description={L.confirm.deleteDescription(settlement.title)}
            confirmLabel={L.confirm.deleteConfirm}
            variant="destructive"
            loading={deleteMutation.isPending}
            onConfirm={async () => {
              await deleteMutation.mutateAsync();
            }}
          />
        ) : null}
      </div>
    </LexRouteGuard>
  );
}

/* ------------------------------------------------------------------------- *
 * Hero band — status/method chips, title, reference, terms summary, and four
 * key-fact tiles with the settlement AMOUNT emphasized. Flat token card surface.
 * ------------------------------------------------------------------------- */

function SettlementHero({
  settlement,
  labels,
  extra,
  actions,
  f,
}: {
  settlement: Settlement;
  labels: SettlementLabels;
  extra: ReturnType<typeof useSettlementDetailExtraLabels>;
  actions?: ReactNode;
  f: LexFormatter;
}) {
  const facts: {
    key: string;
    icon: typeof Hash;
    label: string;
    value: string;
    emphasis?: boolean;
  }[] = [
    {
      key: 'reference',
      icon: Hash,
      label: extra.hero.facts.reference,
      value: settlement.reference || extra.hero.noReference,
    },
    {
      key: 'method',
      icon: Scale,
      label: extra.hero.facts.method,
      value: settlementMethodLabel(labels, settlement.method),
    },
    {
      key: 'counterparty',
      icon: User2,
      label: extra.hero.facts.counterparty,
      value: settlement.counterparty_name || extra.hero.noCounterparty,
    },
    {
      key: 'amount',
      icon: Coins,
      label: extra.hero.facts.amount,
      value: settlement.value != null ? formatMoney(f, settlement.value, settlement.currency) : extra.hero.noValue,
      emphasis: true,
    },
  ];

  return (
    <section className="card p-6 sm:p-7">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <LexStatusChip
                value={settlement.status}
                domain="settlement"
                labels={labels.filters.statusOptions}
                size="md"
              />
              <Badge variant="outline">{settlementMethodLabel(labels, settlement.method)}</Badge>
            </div>
            <h1 className="text-h2 font-bold leading-tight tracking-tight text-foreground" dir="auto">
              {settlement.title}
            </h1>
            {settlement.reference ? (
              <p className="font-mono text-xs text-muted-foreground" dir="ltr">
                {settlement.reference}
              </p>
            ) : null}
            {settlement.terms ? (
              <p className="max-w-2xl whitespace-pre-line text-sm leading-6 text-muted-foreground" dir="auto">
                {truncate(settlement.terms, 240)}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {facts.map((fact) => {
            const Icon = fact.icon;
            return (
              <div
                key={fact.key}
                className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-elevation-1 ${
                  fact.emphasis ? 'border-primary/25 bg-primary/[0.06]' : 'border-border/60 bg-card/50'
                }`}
              >
                <span
                  className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                    fact.emphasis ? 'bg-primary/15 text-primary' : 'bg-primary/10 text-primary'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
                    {fact.label}
                  </dt>
                  <dd
                    className={`truncate text-sm font-medium text-foreground ${
                      fact.emphasis ? 'tabular-nums font-semibold' : ''
                    }`}
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
  );
}

/* A compact key/value field. Empty values become an inline "add" affordance
   (opens the edit dialog) when the viewer can write, otherwise a muted "not set". */
function MetaField({
  label,
  value,
  onAdd,
  addLabel,
  notSet,
  tabularNums = false,
}: {
  label: string;
  value: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  notSet?: string;
  tabularNums?: boolean;
}) {
  const isEmpty = value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-medium text-foreground${tabularNums ? ' tabular-nums' : ''}`} dir="auto">
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

function NegotiationRoundRow({ round }: { round: SettlementNegotiationRound }) {
  const L = useSettlementLabels();
  const f = useLexFormat();
  const labels = L.round;
  return (
    <div className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5">
      <span className="absolute inset-y-0 start-0 w-1 bg-sky-400/70" aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{labels.roundLabel(round.round_number)}</Badge>
            <span className="text-sm font-medium" dir="auto">
              {round.proposed_by}
            </span>
          </div>
          <p className="mt-1.5 whitespace-pre-line text-sm text-muted-foreground" dir="auto">
            {round.terms}
          </p>
          {round.outcome ? (
            <p className="mt-1 text-xs text-muted-foreground" dir="auto">
              {round.outcome}
            </p>
          ) : null}
        </div>
        <div className="text-end">
          {round.proposed_value != null ? (
            <p className="text-sm font-medium tabular-nums">{formatMoney(f, round.proposed_value, round.currency)}</p>
          ) : null}
          <span className="text-xs text-muted-foreground">{f.formatRelative(round.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

/** Truncate long summary text on the hero without breaking words mid-glyph. */
function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

/**
 * KSA-aware settlement money: routes through {@link useLexFormat} so Arabic mode
 * renders the Saudi Riyal symbol + Arabic-Indic digits, while honouring any
 * explicit non-SAR currency stored on the record.
 */
function formatMoney(
  f: LexFormatter,
  value: number | null | undefined,
  currency: string | null | undefined,
  placeholder = '—',
): string {
  if (value === null || value === undefined) {
    return placeholder;
  }
  return f.formatCurrency(value, { currency: currency ?? 'SAR' }) || placeholder;
}
