'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileCheck2,
  FilePenLine,
  FileSignature,
  FileText,
  Loader2,
  MessageSquareText,
  PenLine,
  RotateCcw,
  ShieldCheck,
  UserRound,
  XCircle,
} from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { enterpriseApi } from '@/lib/enterprise';
import { downloadBlob } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type {
  LexContractRecord,
  LexWorkflowDecisionRequest,
  LexWorkflowSummary,
} from '@/types/suites';
import { resolveTimelineEvent } from '../../_lib/contract-timeline-i18n';
import { LexRouteGuard } from '../../../_guards/lex-route-guard';

const copy = {
  en: {
    eyebrow: 'Contracts · Approval',
    title: 'Contract Approval',
    description: 'Review the contract, inspect the approval chain, and record a decision.',
    back: 'Contract details',
    chain: 'Approval Chain',
    chainDescription: 'Sequential review and authorization path',
    summary: 'Contract Summary for Review',
    history: 'Reviewer History & Notes',
    comments: 'Review Comments',
    commentsPlaceholder: 'Add the reasoning, conditions, or changes required for this decision…',
    documents: 'Contract Documents',
    approve: 'Approve Document',
    signature: 'Approve and Add Signature',
    initials: 'Approve and Add Initials',
    requestChanges: 'Request Changes',
    reject: 'Reject',
    start: 'Start Approval Workflow',
    noWorkflow: 'No active approval workflow',
    noWorkflowDescription: 'Start legal review to make approval decisions available.',
    noHistory: 'No reviewer activity has been recorded yet.',
    noDocuments: 'No contract documents have been uploaded.',
    decided: 'Decision recorded',
    decidedDescription: 'The approval workflow and contract status were updated.',
    started: 'Approval workflow started',
    startedDescription: 'The contract is ready for legal review.',
    current: 'Current reviewer',
    completed: 'Completed',
    pending: 'Pending',
    businessOwner: 'Business Owner',
    legalReview: 'Legal Review',
    financeReview: 'Finance Review',
    authorizedSignatory: 'Authorized Signatory',
    type: 'Contract Type',
    value: 'Total Value',
    term: 'Contract Term',
    parties: 'Parties',
    department: 'Department',
    renewal: 'Renewal',
    automatic: 'Automatic',
    manual: 'Manual',
    loadError: 'The approval workspace could not be loaded.',
  },
  ar: {
    eyebrow: 'العقود · الاعتماد',
    title: 'اعتماد العقد',
    description: 'راجع العقد وسلسلة الاعتماد، ثم سجّل القرار.',
    back: 'تفاصيل العقد',
    chain: 'سلسلة الاعتماد',
    chainDescription: 'مسار المراجعة والتفويض المتسلسل',
    summary: 'ملخص العقد للمراجعة',
    history: 'سجل المراجعين والملاحظات',
    comments: 'تعليقات المراجعة',
    commentsPlaceholder: 'أضف أسباب القرار أو شروطه أو التغييرات المطلوبة…',
    documents: 'مستندات العقد',
    approve: 'اعتماد المستند',
    signature: 'اعتماد وإضافة التوقيع',
    initials: 'اعتماد وإضافة الأحرف الأولى',
    requestChanges: 'طلب تعديلات',
    reject: 'رفض',
    start: 'بدء مسار الاعتماد',
    noWorkflow: 'لا يوجد مسار اعتماد نشط',
    noWorkflowDescription: 'ابدأ المراجعة القانونية لإتاحة قرارات الاعتماد.',
    noHistory: 'لم يتم تسجيل نشاط للمراجعين بعد.',
    noDocuments: 'لم يتم رفع مستندات للعقد.',
    decided: 'تم تسجيل القرار',
    decidedDescription: 'تم تحديث مسار الاعتماد وحالة العقد.',
    started: 'بدأ مسار الاعتماد',
    startedDescription: 'العقد جاهز للمراجعة القانونية.',
    current: 'المراجع الحالي',
    completed: 'مكتمل',
    pending: 'قيد الانتظار',
    businessOwner: 'مالك العمل',
    legalReview: 'المراجعة القانونية',
    financeReview: 'المراجعة المالية',
    authorizedSignatory: 'المفوض بالتوقيع',
    type: 'نوع العقد',
    value: 'القيمة الإجمالية',
    term: 'مدة العقد',
    parties: 'الأطراف',
    department: 'الإدارة',
    renewal: 'التجديد',
    automatic: 'تلقائي',
    manual: 'يدوي',
    loadError: 'تعذّر تحميل مساحة الاعتماد.',
  },
} as const;

export default function ContractApprovalPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <LexRouteGuard route="/lex/contracts/[id]">
      <ContractApprovalWorkspace contractId={id} />
    </LexRouteGuard>
  );
}

function ContractApprovalWorkspace({ contractId }: { contractId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { locale, direction } = useLocale();
  const t = copy[locale];
  const [comments, setComments] = useState('');
  const [lateJustification, setLateJustification] = useState('');
  const mark = searchParams.get('mark');

  const contractQuery = useQuery({
    queryKey: ['lex-contract', contractId],
    queryFn: () => enterpriseApi.lex.getContract(contractId),
  });
  const workflowQuery = useQuery({
    queryKey: ['lex-contract-approval-workflows', contractId],
    queryFn: () => enterpriseApi.lex.listWorkflows({ page: 1, per_page: 100, order: 'desc' }),
  });
  const timelineQuery = useQuery({
    queryKey: ['lex-contract-timeline', contractId],
    queryFn: () => enterpriseApi.lex.getContractTimeline(contractId),
  });
  const versionsQuery = useQuery({
    queryKey: ['lex-contract-versions', contractId],
    queryFn: () => enterpriseApi.lex.listContractVersions(contractId),
  });

  const workflow = useMemo(
    () => workflowQuery.data?.data.find((item) => item.contract_id === contractId && isOpenWorkflow(item))
      ?? workflowQuery.data?.data.find((item) => item.contract_id === contractId)
      ?? null,
    [contractId, workflowQuery.data?.data],
  );
  const isLate = Boolean(
    workflow?.sla_deadline && Date.now() > new Date(workflow.sla_deadline).getTime(),
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lex-contract', contractId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contract-approval-workflows', contractId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contract-timeline', contractId] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contracts'] }),
    ]);
  };

  const startMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.startContractReview(contractId, {
      approver_role: 'legal',
      description: locale === 'ar'
        ? 'مراجعة قانونية من مساحة اعتماد العقود'
        : 'Legal review from the contract approval workspace',
    }),
    onSuccess: async () => {
      showSuccess(t.started, t.startedDescription);
      await refresh();
    },
    onError: showApiError,
  });

  const decisionMutation = useMutation({
    mutationFn: async (decision: LexWorkflowDecisionRequest['decision']) => {
      if (!workflow?.task_id) throw new Error('No actionable workflow task is available.');
      return enterpriseApi.lex.decideWorkflowTask(
        workflow.workflow_instance_id,
        workflow.task_id,
        {
          decision,
          notes: comments.trim() || null,
          metadata: {
            source: 'contract-approval-workspace',
            mark: decision === 'approve' ? mark || 'approval' : null,
          },
          ...(isLate ? { late_justification: lateJustification.trim() } : {}),
        },
      );
    },
    onSuccess: async (result) => {
      showSuccess(t.decided, t.decidedDescription);
      setComments('');
      setLateJustification('');
      await refresh();
      if (result.decision === 'approve' && (mark === 'signature' || mark === 'initials')) {
        router.push(`/lex/contracts/${contractId}/signature?mark=${mark}`);
      }
    },
    onError: showApiError,
  });

  if (contractQuery.isLoading || workflowQuery.isLoading) {
    return <Skeleton variant="page" />;
  }
  if (contractQuery.isError || !contractQuery.data) {
    return <ErrorState message={t.loadError} onRetry={() => void contractQuery.refetch()} />;
  }

  const contract = contractQuery.data.contract;
  const currentActionable = Boolean(workflow?.task_id && isOpenWorkflow(workflow));

  return (
    <div dir={direction} lang={locale} className="space-y-6">
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.description}
        tags={[
          { label: contract.contract_number || contract.id.slice(0, 8).toUpperCase(), tone: 'neutral' },
          { label: contract.status.replaceAll('_', ' '), tone: currentActionable ? 'warning' : 'success' },
        ]}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/lex/contracts/${contractId}`}>
              {direction === 'rtl' ? <ArrowRight className="me-2 h-4 w-4" /> : <ArrowLeft className="me-2 h-4 w-4" />}
              {t.back}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <ContractReviewSummary contract={contract} locale={locale} />
          <DocumentsCard
            title={t.documents}
            empty={t.noDocuments}
            versions={versionsQuery.data ?? []}
            locale={locale}
          />
          <HistoryCard
            title={t.history}
            empty={t.noHistory}
            events={timelineQuery.data?.events ?? []}
            locale={locale}
          />
        </div>

        <div className="space-y-6">
          <ApprovalChainCard workflow={workflow} contract={contract} locale={locale} />
          <Surface variant="card" padding="lg">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">{t.comments}</h2>
            </div>
            <Textarea
              value={comments}
              onChange={(event) => setComments(event.target.value)}
              placeholder={t.commentsPlaceholder}
              rows={5}
            />
          </Surface>

          {currentActionable && isLate ? (
            <Surface variant="card" padding="lg" className="space-y-2 border-warning-300 bg-warning-50/60 dark:bg-warning-700/10">
              <Label htmlFor="contract-approval-late-justification">
                {locale === 'ar' ? 'مبرر تجاوز اتفاقية مستوى الخدمة' : 'Late SLA justification'}{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="contract-approval-late-justification"
                value={lateJustification}
                onChange={(event) => setLateJustification(event.target.value)}
                placeholder={locale === 'ar' ? 'اشرح سبب اكتمال الإجراء بعد الموعد المحدد.' : 'Explain why this approval ended after its SLA deadline.'}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                {locale === 'ar'
                  ? 'يظهر فقط لمدير الإدارة القانونية ومدير العقود.'
                  : 'Visible only to the Legal Director and Contracts Manager.'}
              </p>
            </Surface>
          ) : null}

          {currentActionable ? (
            <Surface variant="card" padding="lg" className="space-y-3">
              <Button
                className="w-full"
                onClick={() => void decisionMutation.mutate('approve')}
                disabled={decisionMutation.isPending || (isLate && !lateJustification.trim())}
              >
                {decisionMutation.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : approvalIcon(mark)}
                {mark === 'signature' ? t.signature : mark === 'initials' ? t.initials : t.approve}
              </Button>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  onClick={() => void decisionMutation.mutate('request_changes')}
                  disabled={decisionMutation.isPending || (isLate && !lateJustification.trim())}
                >
                  <RotateCcw className="me-2 h-4 w-4" />
                  {t.requestChanges}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void decisionMutation.mutate('reject')}
                  disabled={decisionMutation.isPending || (isLate && !lateJustification.trim())}
                >
                  <XCircle className="me-2 h-4 w-4" />
                  {t.reject}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t pt-3">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/lex/contracts/${contractId}/approval?mark=signature`}>
                    <FileSignature className="me-2 h-4 w-4" />{locale === 'ar' ? 'توقيع' : 'Signature'}
                  </Link>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/lex/contracts/${contractId}/approval?mark=initials`}>
                    <PenLine className="me-2 h-4 w-4" />{locale === 'ar' ? 'أحرف أولى' : 'Initials'}
                  </Link>
                </Button>
              </div>
            </Surface>
          ) : (
            <Surface variant="card" padding="lg">
              <EmptyState
                icon={ShieldCheck}
                title={t.noWorkflow}
                description={t.noWorkflowDescription}
              />
              <Button
                className="mt-4 w-full"
                onClick={() => void startMutation.mutate()}
                disabled={startMutation.isPending}
              >
                {startMutation.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="me-2 h-4 w-4" />}
                {t.start}
              </Button>
            </Surface>
          )}
        </div>
      </div>
    </div>
  );
}

function ContractReviewSummary({ contract, locale }: { contract: LexContractRecord; locale: 'en' | 'ar' }) {
  const t = copy[locale];
  const value = contract.total_value == null
    ? '—'
    : new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
        style: 'currency',
        currency: contract.currency || 'SAR',
        maximumFractionDigits: 0,
      }).format(contract.total_value);
  return (
    <Surface variant="card" padding="lg">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t.summary}</p>
          <h2 className="mt-1 text-xl font-semibold">{contract.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{contract.description || '—'}</p>
        </div>
        <FileCheck2 className="h-9 w-9 text-primary/70" />
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryItem label={t.type} value={contract.type.replaceAll('_', ' ')} />
        <SummaryItem label={t.value} value={value} />
        <SummaryItem label={t.term} value={`${formatDate(contract.effective_date, locale)} – ${formatDate(contract.expiry_date, locale)}`} />
        <SummaryItem label={t.parties} value={`${contract.party_a_name} · ${contract.party_b_name}`} />
        <SummaryItem label={t.department} value={contract.department || '—'} />
        <SummaryItem label={t.renewal} value={contract.auto_renew ? t.automatic : t.manual} />
      </dl>
    </Surface>
  );
}

function ApprovalChainCard({
  workflow,
  contract,
  locale,
}: {
  workflow: LexWorkflowSummary | null;
  contract: LexContractRecord;
  locale: 'en' | 'ar';
}) {
  const t = copy[locale];
  const currentOpen = Boolean(workflow && isOpenWorkflow(workflow));
  const members = [
    { label: t.businessOwner, name: contract.owner_name, status: 'completed' },
    { label: t.legalReview, name: contract.legal_reviewer_name || workflow?.assignee_role || t.current, status: currentOpen ? 'current' : workflow ? 'completed' : 'pending' },
    { label: t.financeReview, name: contract.department || t.pending, status: currentOpen ? 'pending' : workflow ? 'current' : 'pending' },
    { label: t.authorizedSignatory, name: t.pending, status: 'pending' },
  ];
  return (
    <Surface variant="card" padding="lg">
      <div className="mb-5">
        <h2 className="font-semibold">{t.chain}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.chainDescription}</p>
      </div>
      <ol className="space-y-0">
        {members.map((member, index) => (
          <li key={member.label} className="relative flex gap-3 pb-6 last:pb-0">
            {index < members.length - 1 ? <span className="absolute start-[17px] top-9 h-[calc(100%-30px)] w-px bg-border" /> : null}
            <span
              className={cn(
                'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border',
                member.status === 'completed' && 'border-success-600 bg-success-600 text-white',
                member.status === 'current' && 'border-primary bg-primary text-primary-foreground',
                member.status === 'pending' && 'border-border bg-muted text-muted-foreground',
              )}
            >
              {member.status === 'completed' ? <Check className="h-4 w-4" /> : member.status === 'current' ? <Clock3 className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-semibold">{member.label}</p>
              <p className="text-sm text-muted-foreground">{member.name}</p>
              <Badge className="mt-2" variant={member.status === 'completed' ? 'success' : member.status === 'current' ? 'warning' : 'secondary'}>
                {member.status === 'completed' ? t.completed : member.status === 'current' ? t.current : t.pending}
              </Badge>
            </div>
          </li>
        ))}
      </ol>
    </Surface>
  );
}

function DocumentsCard({
  title,
  empty,
  versions,
  locale,
}: {
  title: string;
  empty: string;
  versions: Awaited<ReturnType<typeof enterpriseApi.lex.listContractVersions>>;
  locale: 'en' | 'ar';
}) {
  const download = async (fileId: string, fileName: string) => {
    try {
      downloadBlob(await enterpriseApi.files.download(fileId), fileName);
    } catch (error) {
      showApiError(error);
    }
  };
  return (
    <Surface variant="card" padding="lg">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><FileText className="h-5 w-5 text-primary" />{title}</h2>
      {versions.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <div className="space-y-3">
          {versions.map((version) => (
            <div key={version.id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{version.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'ar' ? 'الإصدار' : 'Version'} {version.version} · {formatDate(version.uploaded_at, locale)}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" aria-label="Download" onClick={() => void download(version.file_id, version.file_name)}>
                <Download className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

function HistoryCard({
  title,
  empty,
  events,
  locale,
}: {
  title: string;
  empty: string;
  events: Awaited<ReturnType<typeof enterpriseApi.lex.getContractTimeline>>['events'];
  locale: 'en' | 'ar';
}) {
  const reviewEvents = events.filter((event) => /review|workflow|approval|status/i.test(`${event.event_type} ${event.title}`)).slice(0, 6);
  return (
    <Surface variant="card" padding="lg">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><FilePenLine className="h-5 w-5 text-primary" />{title}</h2>
      {reviewEvents.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <ol className="space-y-4">
          {reviewEvents.map((event) => {
            // The server pre-renders these strings in Arabic only; resolve them
            // from the stable event_type + metadata so an English reader gets
            // English. Falls back to the server text for unknown event types.
            const resolved = resolveTimelineEvent(event, locale);
            return (
              <li key={event.id} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-600" />
                <div>
                  <p className="text-sm font-medium" dir="auto">{resolved.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground" dir="auto">{resolved.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                    {resolved.actor ?? 'Watheeq'} · {formatDate(event.occurred_at, locale)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Surface>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-semibold capitalize">{value}</dd>
    </div>
  );
}

function isOpenWorkflow(workflow: LexWorkflowSummary) {
  const value = `${workflow.workflow_status} ${workflow.task_status ?? ''}`.toLowerCase();
  return !/(completed|approved|rejected|cancelled|closed)/.test(value);
}

function formatDate(value: string | null | undefined, locale: 'en' | 'ar') {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function approvalIcon(mark: string | null) {
  if (mark === 'signature') return <FileSignature className="me-2 h-4 w-4" />;
  if (mark === 'initials') return <PenLine className="me-2 h-4 w-4" />;
  return <CheckCircle2 className="me-2 h-4 w-4" />;
}
