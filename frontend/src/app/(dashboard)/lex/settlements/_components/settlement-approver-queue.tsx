'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { ChevronRight, Inbox, ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { LexStatusChip } from '@/components/lex/status-chip';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { LexBilingual } from '../../_lib/lex-i18n';
import { resolveLexBilingual } from '../../_lib/lex-i18n';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  formatSettlementValue,
  settlementsApi,
  type Settlement,
  type SettlementDecisionPayload,
} from '@/lib/lex/settlements';
import { SettlementDecisionDialog } from './settlement-decision-dialog';
import { settlementMethodLabel, useSettlementLabels } from './labels';

// ---------------------------------------------------------------------------
// Feature-local bilingual labels (EN + professional MSA). Self-contained per
// the lex bilingual contract — this module owns its copy.
// ---------------------------------------------------------------------------

interface ApproverQueueLabels {
  title: string;
  description: string;
  pending: (n: number) => string;
  ageLabel: string;
  noValue: string;
  noCounterparty: string;
  decide: string;
  view: string;
  emptyTitle: string;
  emptyDescription: string;
  errorMessage: string;
  noWorkflow: string;
}

const approverQueueLabels: LexBilingual<ApproverQueueLabels> = {
  en: {
    title: 'Approval queue',
    description: 'Settlements awaiting an approval decision. Oldest first.',
    pending: (n) => `${n} awaiting approval`,
    ageLabel: 'Waiting',
    noValue: 'No value',
    noCounterparty: 'No counterparty',
    decide: 'Decide',
    view: 'Open',
    emptyTitle: 'Nothing to approve',
    emptyDescription: 'No settlements are currently awaiting an approval decision.',
    errorMessage: 'Failed to load the approval queue.',
    noWorkflow: 'No approval workflow attached.',
  },
  ar: {
    title: 'قائمة الاعتماد',
    description: 'تسويات بانتظار قرار الاعتماد. الأقدم أولًا.',
    pending: (n) => `${n} بانتظار الاعتماد`,
    ageLabel: 'الانتظار',
    noValue: 'لا توجد قيمة',
    noCounterparty: 'لا يوجد طرف مقابل',
    decide: 'اتخاذ القرار',
    view: 'فتح',
    emptyTitle: 'لا شيء للاعتماد',
    emptyDescription: 'لا توجد تسويات بانتظار قرار اعتماد حاليًا.',
    errorMessage: 'تعذّر تحميل قائمة الاعتماد.',
    noWorkflow: 'لا يوجد سير اعتماد مرتبط.',
  },
};

function useApproverQueueLabels(): ApproverQueueLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(approverQueueLabels, locale), [locale]);
}

interface SettlementApproverQueueProps {
  /** Gate: the queue only renders meaningfully for users who can approve. */
  canApprove: boolean;
}

const APPROVAL_QUEUE_KEY = ['lex-settlements-approval'] as const;

export function SettlementApproverQueue({ canApprove }: SettlementApproverQueueProps) {
  const queryClient = useQueryClient();
  const { direction } = useLocaleOrDefault();
  const QL = useApproverQueueLabels();
  const L = useSettlementLabels();

  const [decisionTarget, setDecisionTarget] = useState<Settlement | null>(null);

  const queueQuery = useQuery({
    queryKey: APPROVAL_QUEUE_KEY,
    // Server-side filter on status; the list endpoint forwards `filters.status`
    // as the `status` query param (see buildSuiteQueryParams). We still defend
    // client-side below in case the backend ignores the filter.
    queryFn: () =>
      settlementsApi.list({
        page: 1,
        per_page: 50,
        sort: 'updated_at',
        order: 'asc',
        filters: { status: 'pending_approval' },
      }),
    enabled: canApprove,
  });

  const pending = useMemo(() => {
    const rows = queueQuery.data?.data ?? [];
    return rows
      .filter((s) => s.status === 'pending_approval')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [queueQuery.data]);

  const decideMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SettlementDecisionPayload }) => {
      const wf = decisionTarget?.workflow_instance_id;
      if (!wf) {
        return Promise.reject(new Error(QL.noWorkflow));
      }
      // Mirror [id]/page.tsx: the approval task id is resolved server-side from
      // the workflow's single open human task, so we pass the workflow id for
      // both the workflow and task segments.
      return settlementsApi.decide(id, wf, wf, payload);
    },
    onSuccess: async () => {
      showSuccess(L.toast.decided);
      setDecisionTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-settlements'] }),
        queryClient.invalidateQueries({ queryKey: APPROVAL_QUEUE_KEY }),
      ]);
    },
    onError: showApiError,
  });

  if (!canApprove) {
    return null;
  }

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-warning-700 dark:text-warning-300" aria-hidden />
          {QL.title}
        </span>
      }
      description={QL.description}
      actions={
        pending.length > 0 ? (
          <Badge variant="outline" className="border-warning-300/60 text-warning-700 dark:text-warning-300">
            {QL.pending(pending.length)}
          </Badge>
        ) : undefined
      }
    >
      <div dir={direction}>
        {queueQuery.isLoading ? (
          <LoadingSkeleton variant="list-item" count={3} />
        ) : queueQuery.isError ? (
          <ErrorState
            message={QL.errorMessage}
            onRetry={() => void queueQuery.refetch()}
            error={queueQuery.error}
          />
        ) : pending.length === 0 ? (
          <EmptyState
            icon={Inbox}
            size="compact"
            title={QL.emptyTitle}
            description={QL.emptyDescription}
          />
        ) : (
          <div className="space-y-2">
            {pending.map((settlement) => (
              <QueueRow
                key={settlement.id}
                settlement={settlement}
                labels={QL}
                statusLabels={L.filters.statusOptions}
                methodLabel={settlementMethodLabel(L, settlement.method)}
                onDecide={() => setDecisionTarget(settlement)}
              />
            ))}
          </div>
        )}
      </div>

      <SettlementDecisionDialog
        open={decisionTarget !== null}
        loading={decideMutation.isPending}
        ready={Boolean(decisionTarget?.workflow_instance_id)}
        onOpenChange={(open) => {
          if (!open) setDecisionTarget(null);
        }}
        onSubmit={(payload) => {
          if (decisionTarget) {
            decideMutation.mutate({ id: decisionTarget.id, payload });
          }
        }}
      />
    </SectionCard>
  );
}

function QueueRow({
  settlement,
  labels,
  statusLabels,
  methodLabel,
  onDecide,
}: {
  settlement: Settlement;
  labels: ApproverQueueLabels;
  statusLabels: Record<string, string>;
  methodLabel: string;
  onDecide: () => void;
}) {
  const age = useMemo(() => {
    const d = new Date(settlement.created_at);
    return Number.isNaN(d.getTime()) ? null : formatDistanceToNowStrict(d, { addSuffix: false });
  }, [settlement.created_at]);

  return (
    <div className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5 transition-colors hover:bg-muted/40">
      <span className="absolute inset-y-0 start-0 w-1 bg-warning-300/70" aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/lex/settlements/${settlement.id}`}
              className="truncate text-sm font-medium hover:underline"
            >
              {settlement.title}
            </Link>
            <LexStatusChip
              value={settlement.status}
              domain="settlement"
              labels={statusLabels}
              size="sm"
            />
            <Badge variant="outline">{methodLabel}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {settlement.value != null
                ? formatSettlementValue(settlement.value, settlement.currency)
                : labels.noValue}
            </span>
            <span>{settlement.counterparty_name || labels.noCounterparty}</span>
            {age ? (
              <span>
                {labels.ageLabel}: {age}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={onDecide} disabled={!settlement.workflow_instance_id}>
            <ShieldCheck className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {labels.decide}
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={labels.view}>
            <Link href={`/lex/settlements/${settlement.id}`}>
              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
