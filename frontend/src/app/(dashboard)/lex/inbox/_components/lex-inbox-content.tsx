'use client';

/**
 * Cross-domain Approvals Inbox — "Awaiting me" work queue (feature #16).
 *
 * Aggregates every decision waiting on the signed-in user across the legal suite
 * (settlement approver queue, governance clause/regulation sign-offs, workflow
 * human tasks, contract approvals, service-desk approvals), normalized to a
 * single shape and grouped by kind. Each item shows a <SlaCountdown>; actionable
 * items get an inline quick-approve, the rest deep-link to the entity. A KPI
 * strip (pending / due today / overdue) sits up top.
 *
 * Built on the shared Lex primitives (<LexListShell>, <LexKpiStrip>,
 * <LexEmptyState>) at the Settlements/Compliance quality bar. Bilingual + RTL +
 * KSA-formatted via the shared providers. `loading.tsx` and `error.tsx` cover
 * the route segment.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCheck, CircleAlert, Clock, RefreshCw } from 'lucide-react';
import { LexListShell } from '@/components/lex/list-shell';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useLexFormat } from '@/lib/lex/ksa';
import { AskForSupportButton } from '@/components/lex/support-composer';
import { useInbox, type InboxItem, type InboxItemAction } from '../_lib/use-inbox';
import { useInboxLabels } from '../_lib/labels';
import { useSupportLabels } from '../_lib/support-i18n';
import { InboxGroup } from './inbox-group';
import { InboxDecisionDialog } from './inbox-decision-dialog';
import { SupportRequestsPanel } from './support-requests-panel';
import { resolveInboxView, type InboxView } from '../_lib/support-view';

/** Shared, unguarded queue body for role-facing approval routes. */
export function LexInboxContent() {
  const L = useInboxLabels();
  const supportLabels = useSupportLabels();
  const { direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const searchParams = useSearchParams();
  const f = useLexFormat();
  const inbox = useInbox();

  const canViewSupport = hasPermission('lex:support:view');
  const canCreateSupport = hasPermission('lex:support:create');
  const canRespondSupport = hasPermission('lex:support:respond');
  const requestedView = searchParams.get('view');
  const [activeAction, setActiveAction] = useState<InboxItemAction | null>(null);
  const [activeView, setActiveView] = useState<InboxView>(() =>
    resolveInboxView(requestedView, canViewSupport),
  );
  const [decisionScope, setDecisionScope] = useState<'all' | 'dueToday' | 'overdue'>('all');

  useEffect(() => {
    if (!canViewSupport) {
      setActiveView('decisions');
      return;
    }
    if (requestedView === 'incoming' || requestedView === 'sent' || requestedView === 'history') {
      setActiveView(requestedView);
    }
  }, [canViewSupport, requestedView]);

  const handleDecide = (item: InboxItem) => {
    if (item.action) {
      setActiveAction(item.action);
    }
  };

  const queueTotal = Math.max(0, inbox.kpis.pending);
  const dueTodayShare = queueTotal > 0 ? Math.round((inbox.kpis.dueToday / queueTotal) * 100) : 0;
  const overdueShare = queueTotal > 0 ? Math.round((inbox.kpis.overdue / queueTotal) * 100) : 0;
  const kpiItems: LexKpiItem[] = [
    {
      id: 'pending',
      label: L.kpis.pending,
      value: inbox.kpis.pending,
      theme: 'primary',
      icon: CheckCheck,
      description: L.kpiDetails.pending,
      progress: queueTotal > 0 ? 100 : 0,
      progressLabel: L.kpiDetails.queueShare,
      detail: L.kpiDetails.currentQueue,
      detailValue: f.formatNumber(inbox.kpis.pending),
      loading: inbox.isLoading,
      onAction: () => setDecisionScope('all'),
      pressed: decisionScope === 'all',
    },
    {
      id: 'dueToday',
      label: L.kpis.dueToday,
      value: inbox.kpis.dueToday,
      theme: 'amber',
      icon: Clock,
      description: L.kpiDetails.dueToday,
      progress: dueTodayShare,
      progressLabel: L.kpiDetails.queueShare,
      detail: L.kpiDetails.needsAction,
      detailValue: `${f.formatNumber(dueTodayShare)}%`,
      loading: inbox.isLoading,
      onAction: () => setDecisionScope('dueToday'),
      pressed: decisionScope === 'dueToday',
    },
    {
      id: 'overdue',
      label: L.kpis.overdue,
      value: inbox.kpis.overdue,
      theme: 'red',
      icon: CircleAlert,
      description: L.kpiDetails.overdue,
      progress: overdueShare,
      progressLabel: L.kpiDetails.queueShare,
      detail: L.kpis.overdue,
      detailValue: `${f.formatNumber(overdueShare)}%`,
      trend:
        inbox.kpis.overdue > 0
          ? { dir: 'up', value: inbox.kpis.overdue }
          : undefined,
      trendGoodWhenDown: true,
      loading: inbox.isLoading,
      onAction: () => setDecisionScope('overdue'),
      pressed: decisionScope === 'overdue',
    },
  ];

  const visibleGroups = useMemo(() => {
    const now = new Date();
    return inbox.groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (decisionScope === 'all') return true;
          if (!item.dueAt) return false;
          const due = new Date(item.dueAt);
          if (Number.isNaN(due.getTime())) return false;
          if (decisionScope === 'overdue') return due < now;
          return (
            due >= now &&
            due.getFullYear() === now.getFullYear() &&
            due.getMonth() === now.getMonth() &&
            due.getDate() === now.getDate()
          );
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [decisionScope, inbox.groups]);
  const visibleItemCount = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);
  const isEmpty = !inbox.isLoading && !inbox.isError && visibleItemCount === 0;

  return (
    <>
      <LexListShell
        eyebrow={L.eyebrow}
        title={L.title}
        description={L.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canCreateSupport ? <AskForSupportButton /> : null}
            {activeView === 'decisions' ? (
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                onClick={() => inbox.refetch()}
                disabled={inbox.isLoading}
              >
                <RefreshCw
                  className={inbox.isLoading ? 'h-4 w-4 motion-safe:animate-spin' : 'h-4 w-4'}
                  aria-hidden
                />
                {L.refresh}
              </Button>
            ) : null}
          </div>
        }
        kpi={activeView === 'decisions' ? <LexKpiStrip items={kpiItems} columns={3} /> : null}
        loading={false}
        empty={null}
        framedBody={false}
      >
        <Tabs
          value={activeView}
          onValueChange={(value) => setActiveView(value as InboxView)}
          dir={direction}
        >
          <div
            className="max-w-full overflow-x-auto overscroll-x-contain pb-1"
            data-testid="lex-inbox-tabs-scroll"
          >
            <TabsList aria-label={supportLabels.tabsAria} className="w-max min-w-full justify-start">
              <TabsTrigger value="decisions">{supportLabels.tabs.decisions}</TabsTrigger>
              {canViewSupport ? (
                <>
                  <TabsTrigger value="incoming">{supportLabels.tabs.incoming}</TabsTrigger>
                  <TabsTrigger value="sent">{supportLabels.tabs.sent}</TabsTrigger>
                  <TabsTrigger value="history">{supportLabels.tabs.history}</TabsTrigger>
                </>
              ) : null}
            </TabsList>
          </div>

          <TabsContent value="decisions">
            {inbox.isError ? (
              <ErrorPanel
                title={L.errorTitle}
                description={L.errorDescription}
                retryLabel={L.refresh}
                onRetry={() => inbox.refetch()}
              />
            ) : isEmpty ? (
              <EmptyState icon={CheckCheck} title={L.emptyTitle} description={L.emptyDescription} />
            ) : (
              <div className="space-y-6" dir={direction}>
                {inbox.isPartial ? (
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-lg border border-warning-300/40 bg-warning-500/5 px-3 py-2 text-xs text-warning-700 dark:text-warning-300"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                    {L.partialError}
                  </div>
                ) : null}

                {inbox.isLoading && inbox.items.length === 0 ? (
                  <Skeleton.Table rows={6} cols={3} />
                ) : (
                  visibleGroups.map((group) => (
                    <InboxGroup
                      key={group.kind}
                      kind={group.kind}
                      items={group.items}
                      onDecide={handleDecide}
                    />
                  ))
                )}
              </div>
            )}
          </TabsContent>
          {canViewSupport ? (
            <>
              <TabsContent value="incoming"><SupportRequestsPanel view="incoming" canRespond={canRespondSupport} canCancel={canCreateSupport} /></TabsContent>
              <TabsContent value="sent"><SupportRequestsPanel view="sent" canRespond={canRespondSupport} canCancel={canCreateSupport} /></TabsContent>
              <TabsContent value="history"><SupportRequestsPanel view="history" canRespond={canRespondSupport} canCancel={canCreateSupport} /></TabsContent>
            </>
          ) : null}
        </Tabs>
      </LexListShell>

      <InboxDecisionDialog
        action={activeAction}
        onOpenChange={(open) => {
          if (!open) setActiveAction(null);
        }}
        onDecided={() => inbox.refetch()}
      />
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * Inline error panel — total-failure fallback inside the shell body.
 * ------------------------------------------------------------------------- */

function ErrorPanel({
  title,
  description,
  retryLabel,
  onRetry,
}: {
  title: string;
  description: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center"
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <CircleAlert className="h-7 w-7" aria-hidden />
      </span>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      <Button
        type="button"
        className="gap-2"
        onClick={onRetry}
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        {retryLabel}
      </Button>
    </div>
  );
}
