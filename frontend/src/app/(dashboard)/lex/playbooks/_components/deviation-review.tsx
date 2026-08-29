'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Loader2,
  Printer,
  ScanSearch,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LexListSkeleton } from '@/components/lex/list-skeleton';
import { LexSeverityChip } from '@/components/lex/status-chip';
import { RedlineView } from '@/components/shared/redline-view';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { downloadBlob } from '@/lib/format';
import { useLexFormat } from '@/lib/lex/ksa';
import { showApiError, showSuccess } from '@/lib/toast';
import { enterpriseApi } from '@/lib/enterprise';
import type {
  LexClauseDeviation,
  LexClauseDeviationReport,
  LexContractRecord,
  LexDeviationFilters,
  LexDeviationReview,
  LexDeviationReviewStatus,
} from '@/types/suites';
import {
  clampPercent,
  kindBadgeVariant,
  type DeviationKind,
  type DeviationSeverity,
} from './deviation-meta';
import { type PlaybookLabels, usePlaybookLabels } from './labels';
import { formatToken } from './playbook-form';

const EMPTY_CONTRACTS: LexContractRecord[] = [];

const KIND_OPTIONS: DeviationKind[] = ['missing', 'altered', 'extra'];
const SEVERITY_OPTIONS: DeviationSeverity[] = ['low', 'medium', 'high', 'critical'];
const STATUS_OPTIONS: LexDeviationReviewStatus[] = ['open', 'accepted', 'rejected', 'needs_fix'];

// Hide-resolved hides rows whose triage status is `accepted` only — `rejected` and
// `needs_fix` are kept visible because they still represent open work (a rejected
// clause may need renegotiation; needs_fix is explicitly outstanding).
const RESOLVED_STATUSES: ReadonlySet<LexDeviationReviewStatus> = new Set(['accepted']);

interface DeviationFilterState {
  kinds: DeviationKind[];
  severities: DeviationSeverity[];
  requiredOnly: boolean;
}

const EMPTY_FILTERS: DeviationFilterState = {
  kinds: [],
  severities: [],
  requiredOnly: false,
};

/** Build the API filter payload (CSV strings) from local multi-select filter state. */
function toApiFilters(state: DeviationFilterState): LexDeviationFilters | undefined {
  const filters: LexDeviationFilters = {};
  if (state.kinds.length > 0) {
    filters.kind = state.kinds.join(',');
  }
  if (state.severities.length > 0) {
    filters.severity = state.severities.join(',');
  }
  if (state.requiredOnly) {
    filters.required_only = true;
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
}

interface DeviationReviewProps {
  contracts: LexContractRecord[];
  contractsLoading: boolean;
  contractsError: boolean;
  onRetryContracts: () => void;
}

export function DeviationReview({
  contracts,
  contractsError,
  contractsLoading,
  onRetryContracts,
}: DeviationReviewProps) {
  const labels = usePlaybookLabels();
  const searchParams = useSearchParams();
  const [selectedContractId, setSelectedContractId] = useState('');
  const [activeContractId, setActiveContractId] = useState('');
  const [filters, setFilters] = useState<DeviationFilterState>(EMPTY_FILTERS);

  const availableContracts = contracts ?? EMPTY_CONTRACTS;

  // Cross-agent contract with the Portfolio dashboard: it links here with
  // `?contract={id}`. On mount (or when the param/contract list changes) preselect
  // that contract and auto-run the deviation check. The ref guards against
  // re-triggering after the user manually changes selection.
  const autoRanParamRef = useRef<string | null>(null);
  const linkedContractId = searchParams?.get('contract') ?? '';
  useEffect(() => {
    if (!linkedContractId || autoRanParamRef.current === linkedContractId) {
      return;
    }
    if (!availableContracts.some((contract) => contract.id === linkedContractId)) {
      return;
    }
    autoRanParamRef.current = linkedContractId;
    setSelectedContractId(linkedContractId);
    setActiveContractId(linkedContractId);
    setFilters(EMPTY_FILTERS);
  }, [linkedContractId, availableContracts]);

  const selectedContract = useMemo(
    () =>
      availableContracts.find(
        (contract) => contract.id === selectedContractId,
      ) ?? availableContracts[0],
    [availableContracts, selectedContractId],
  );
  const activeContract = useMemo(
    () =>
      availableContracts.find((contract) => contract.id === activeContractId),
    [availableContracts, activeContractId],
  );

  const apiFilters = useMemo(() => toApiFilters(filters), [filters]);

  const deviationQuery = useQuery({
    queryKey: ['lex-clause-deviations', activeContractId, apiFilters],
    queryFn: () =>
      enterpriseApi.lex.getContractClauseDeviations(activeContractId, apiFilters),
    enabled: activeContractId !== '',
  });

  const runCheck = () => {
    if (selectedContract) {
      // Reset filters when switching to a different contract so stale narrowing
      // doesn't carry over; keep them when re-running the same contract.
      if (selectedContract.id !== activeContractId) {
        setFilters(EMPTY_FILTERS);
      }
      setActiveContractId(selectedContract.id);
    }
  };

  return (
    <SectionCard
      title={labels.deviations.title}
      description={labels.deviations.description}
    >
      <div className="space-y-4">
        {contractsError ? (
          <ErrorState
            message={labels.deviations.contractsLoadError}
            onRetry={onRetryContracts}
          />
        ) : availableContracts.length === 0 && !contractsLoading ? (
          <p className="text-sm text-muted-foreground">
            {labels.deviations.noContracts}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end print:hidden">
            <div className="space-y-2">
              <Label htmlFor="deviation-contract">
                {labels.deviations.contractLabel}
              </Label>
              <Select
                value={selectedContract?.id ?? ''}
                onValueChange={setSelectedContractId}
                disabled={contractsLoading || availableContracts.length === 0}
              >
                <SelectTrigger id="deviation-contract">
                  <SelectValue
                    placeholder={labels.deviations.contractPlaceholder}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableContracts.map((contract) => (
                    <SelectItem key={contract.id} value={contract.id}>
                      {contract.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              onClick={runCheck}
              disabled={
                !selectedContract ||
                (deviationQuery.isFetching &&
                  activeContractId === selectedContract?.id)
              }
            >
              {deviationQuery.isFetching &&
              activeContractId === selectedContract?.id ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
              ) : (
                <ScanSearch className="me-1.5 h-4 w-4" />
              )}
              {labels.deviations.runButton}
            </Button>
          </div>
        )}

        {activeContractId === '' ? (
          <EmptyDeviationState labels={labels} />
        ) : deviationQuery.isLoading ? (
          <LexListSkeleton rows={5} cols={6} />
        ) : deviationQuery.isError ? (
          <ErrorState
            message={labels.deviations.deviationLoadError}
            onRetry={() => void deviationQuery.refetch()}
          />
        ) : deviationQuery.data ? (
          <DeviationReport
            report={deviationQuery.data}
            contract={activeContract}
            contractId={activeContractId}
            labels={labels}
            filters={filters}
            apiFilters={apiFilters}
            onFiltersChange={setFilters}
            tableRefetching={deviationQuery.isFetching}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}

function EmptyDeviationState({ labels }: { labels: PlaybookLabels }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center">
      <p className="text-sm font-medium">{labels.deviations.emptyTitle}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {labels.deviations.emptyDescription}
      </p>
    </div>
  );
}

function DeviationReport({
  contract,
  contractId,
  report,
  labels,
  filters,
  apiFilters,
  onFiltersChange,
  tableRefetching,
}: {
  contract?: LexContractRecord;
  contractId: string;
  report: LexClauseDeviationReport;
  labels: PlaybookLabels;
  filters: DeviationFilterState;
  apiFilters?: LexDeviationFilters;
  onFiltersChange: (next: DeviationFilterState) => void;
  tableRefetching: boolean;
}) {
  const { hasPermission } = useAuth();
  // §9/§13 — playbook deviation governance is catalog configuration.
  const canWrite = hasPermission('lex:catalog:manage');
  const f = useLexFormat();
  const score = clampPercent(report.compliance_score);
  const [hideResolved, setHideResolved] = useState(false);
  const [exporting, setExporting] = useState(false);

  // #3 — per-clause-type triage dispositions for this contract. Keyed by clause_type.
  const reviewsQuery = useQuery({
    queryKey: ['lex-deviation-reviews', contractId],
    queryFn: () => enterpriseApi.lex.listDeviationReviews(contractId),
    enabled: contractId !== '',
  });
  const reviewsByClauseType = useMemo(() => {
    const map = new Map<string, LexDeviationReview>();
    for (const review of reviewsQuery.data ?? []) {
      map.set(String(review.clause_type), review);
    }
    return map;
  }, [reviewsQuery.data]);

  const toggleKind = (kind: DeviationKind) => {
    onFiltersChange({
      ...filters,
      kinds: filters.kinds.includes(kind)
        ? filters.kinds.filter((value) => value !== kind)
        : [...filters.kinds, kind],
    });
  };
  const toggleSeverity = (severity: DeviationSeverity) => {
    onFiltersChange({
      ...filters,
      severities: filters.severities.includes(severity)
        ? filters.severities.filter((value) => value !== severity)
        : [...filters.severities, severity],
    });
  };
  const setKindFilter = (kind: DeviationKind) => {
    // Clicking a summary tile focuses the table on that single kind (or clears it
    // when it's already the sole active kind).
    const isSoleActive =
      filters.kinds.length === 1 && filters.kinds[0] === kind;
    onFiltersChange({
      ...filters,
      kinds: isSoleActive ? [] : [kind],
    });
  };

  const filtersActive =
    filters.kinds.length > 0 ||
    filters.severities.length > 0 ||
    filters.requiredOnly;

  const handleExportCsv = async () => {
    if (typeof window === 'undefined') {
      return;
    }
    setExporting(true);
    try {
      const blob = await enterpriseApi.lex.exportContractClauseDeviations(
        contractId,
        apiFilters,
      );
      const slug = (contract?.title ?? contractId)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      downloadBlob(blob, `clause-deviations-${slug || contractId}.csv`);
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const visibleDeviations = useMemo(() => {
    if (!hideResolved) {
      return report.deviations;
    }
    return report.deviations.filter((deviation) => {
      const review = reviewsByClauseType.get(String(deviation.clause_type));
      return !review || !RESOLVED_STATUSES.has(review.status);
    });
  }, [report.deviations, hideResolved, reviewsByClauseType]);

  return (
    <div className="space-y-5 motion-safe:animate-fade-up">
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-4 shadow-elevation-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{report.playbook_name}</p>
              <Badge variant={report.matched ? 'success' : 'warning'}>
                {report.matched
                  ? labels.deviations.matched
                  : labels.deviations.review}
              </Badge>
              <Badge variant="outline">
                {labels.contractTypeLabels[String(report.contract_type)] ??
                  formatToken(String(report.contract_type))}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{report.reason}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={exporting}>
                  {exporting ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {labels.deviations.export}
                  <ChevronDown className="ms-1 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void handleExportCsv()}>
                  <Download className="me-2 h-4 w-4" />
                  {labels.deviations.exportCsv}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handlePrint}>
                  <Printer className="me-2 h-4 w-4" />
                  {labels.deviations.print}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {contract ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/lex/contracts/${contract.id}`}>
                  {labels.deviations.openContract}
                  <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {labels.deviations.complianceScore}
            </span>
            <span className="font-semibold tabular-nums">
              {f.formatNumber(score)}%
            </span>
          </div>
          <Progress
            value={score}
            aria-label={labels.deviations.complianceScore}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <DeviationStat
            label={labels.deviations.standardClauses}
            value={report.total_standard_clauses}
            active={!filtersActive}
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
          />
          <DeviationStat
            label={labels.deviations.missing}
            value={report.missing_count}
            active={filters.kinds.length === 1 && filters.kinds[0] === 'missing'}
            onClick={() => setKindFilter('missing')}
          />
          <DeviationStat
            label={labels.deviations.altered}
            value={report.altered_count}
            active={filters.kinds.length === 1 && filters.kinds[0] === 'altered'}
            onClick={() => setKindFilter('altered')}
          />
          <DeviationStat
            label={labels.deviations.extra}
            value={report.extra_count}
            active={filters.kinds.length === 1 && filters.kinds[0] === 'extra'}
            onClick={() => setKindFilter('extra')}
          />
          <DeviationStat
            label={labels.deviations.threshold}
            value={`${clampPercent(report.threshold)}%`}
            onClick={() => document.getElementById('deviation-report-filters')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
        </div>

        <p className="mt-3 text-xs text-muted-foreground" dir="auto">
          {labels.deviations.generatedAt}{' '}
          {f.formatRelative(report.generated_at)}
          <span className="mx-1.5 opacity-50">·</span>
          {f.formatDual(report.generated_at)}
        </p>
      </div>

      <div id="deviation-report-filters" className="scroll-mt-24">
        <DeviationFilters
          labels={labels}
          filters={filters}
          filtersActive={filtersActive}
          hideResolved={hideResolved}
          onToggleKind={toggleKind}
          onToggleSeverity={toggleSeverity}
          onToggleRequiredOnly={() =>
            onFiltersChange({ ...filters, requiredOnly: !filters.requiredOnly })
          }
          onToggleHideResolved={() => setHideResolved((value) => !value)}
          onClear={() => onFiltersChange(EMPTY_FILTERS)}
          refetching={tableRefetching}
        />
      </div>

      {report.deviations.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center">
          <p className="text-sm font-medium">
            {labels.deviations.noDeviationsTitle}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {labels.deviations.noDeviationsDescription}
          </p>
        </div>
      ) : visibleDeviations.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center">
          <p className="text-sm font-medium">
            {labels.deviations.noDeviationsTitle}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60 shadow-elevation-1">
          <Table className="table-premium">
            <TableHeader>
              <TableRow>
                <TableHead>{labels.deviations.table.clause}</TableHead>
                <TableHead>{labels.deviations.table.kind}</TableHead>
                <TableHead>{labels.deviations.table.severity}</TableHead>
                <TableHead className="text-end">
                  {labels.deviations.table.similarity}
                </TableHead>
                <TableHead className="text-end">
                  {labels.deviations.table.riskWeight}
                </TableHead>
                <TableHead>{labels.deviations.table.reference}</TableHead>
                <TableHead>{labels.deviations.reviewStatus}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleDeviations.map((deviation, index) => (
                <DeviationRow
                  key={`${deviation.clause_type}-${deviation.kind}-${index}`}
                  deviation={deviation}
                  contractId={contractId}
                  review={reviewsByClauseType.get(String(deviation.clause_type))}
                  canWrite={canWrite}
                  labels={labels}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function DeviationFilters({
  labels,
  filters,
  filtersActive,
  hideResolved,
  onToggleKind,
  onToggleSeverity,
  onToggleRequiredOnly,
  onToggleHideResolved,
  onClear,
  refetching,
}: {
  labels: PlaybookLabels;
  filters: DeviationFilterState;
  filtersActive: boolean;
  hideResolved: boolean;
  onToggleKind: (kind: DeviationKind) => void;
  onToggleSeverity: (severity: DeviationSeverity) => void;
  onToggleRequiredOnly: () => void;
  onToggleHideResolved: () => void;
  onClear: () => void;
  refetching: boolean;
}) {
  const t = labels.deviations;
  const kindLabel: Record<DeviationKind, string> = {
    missing: t.kindMissing,
    altered: t.kindAltered,
    extra: t.kindExtra,
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-muted/20 px-3 py-3 print:hidden">
      <FilterChipGroup label={t.filterKind}>
        {KIND_OPTIONS.map((kind) => (
          <FilterChip
            key={kind}
            label={kindLabel[kind]}
            active={filters.kinds.includes(kind)}
            onClick={() => onToggleKind(kind)}
          />
        ))}
      </FilterChipGroup>

      <FilterChipGroup label={t.filterSeverity}>
        {SEVERITY_OPTIONS.map((severity) => (
          <FilterChip
            key={severity}
            label={t.severityLabels[severity] ?? formatToken(severity)}
            active={filters.severities.includes(severity)}
            onClick={() => onToggleSeverity(severity)}
          />
        ))}
      </FilterChipGroup>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={filters.requiredOnly}
          onCheckedChange={onToggleRequiredOnly}
          aria-label={t.requiredOnly}
        />
        {t.requiredOnly}
      </label>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={hideResolved}
          onCheckedChange={onToggleHideResolved}
          aria-label={t.hideResolved}
        />
        {t.hideResolved}
      </label>

      {refetching ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      ) : null}

      {filtersActive ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ms-auto"
          onClick={onClear}
        >
          {t.clearFilters}
        </Button>
      ) : null}
    </div>
  );
}

function FilterChipGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background text-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  );
}

function DeviationRow({
  deviation,
  contractId,
  review,
  canWrite,
  labels,
}: {
  deviation: LexClauseDeviation;
  contractId: string;
  review?: LexDeviationReview;
  canWrite: boolean;
  labels: PlaybookLabels;
}) {
  const queryClient = useQueryClient();
  const f = useLexFormat();
  const t = labels.deviations;
  const kindLabel: Record<string, string> = {
    missing: t.kindMissing,
    altered: t.kindAltered,
    extra: t.kindExtra,
  };
  const [note, setNote] = useState(review?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(false);

  // Keep the local note draft in sync when the server review changes (e.g. after a
  // refetch) but only while the editor isn't open, so we don't clobber typing.
  useEffect(() => {
    if (!noteOpen) {
      setNote(review?.note ?? '');
    }
  }, [review?.note, noteOpen]);

  const upsertMutation = useMutation({
    mutationFn: (payload: { status: LexDeviationReviewStatus; note?: string }) =>
      enterpriseApi.lex.upsertDeviationReview(
        contractId,
        String(deviation.clause_type),
        payload,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['lex-deviation-reviews', contractId],
      });
      showSuccess(labels.toast.reviewSaved);
    },
    onError: (error) => showApiError(error),
  });

  const currentStatus: LexDeviationReviewStatus = review?.status ?? 'open';
  const statusLabel: Record<LexDeviationReviewStatus, string> = {
    open: t.statusOpen,
    accepted: t.statusAccepted,
    rejected: t.statusRejected,
    needs_fix: t.statusNeedsFix,
  };

  const handleStatusChange = (status: LexDeviationReviewStatus) => {
    upsertMutation.mutate({ status, note: note.trim() ? note.trim() : undefined });
  };
  const handleSaveNote = () => {
    upsertMutation.mutate({
      status: currentStatus,
      note: note.trim() ? note.trim() : undefined,
    });
    setNoteOpen(false);
  };

  // #5 — deep-link into the contract clause viewer. Only ALTERED/EXTRA deviations
  // backed by a persisted contract clause carry a contract_clause_id; MISSING
  // clauses have no clause to jump to, so we omit the link there.
  const clauseHref = deviation.contract_clause_id
    ? `/lex/contracts/${contractId}#clause-${deviation.contract_clause_id}`
    : null;

  return (
    <TableRow>
      <TableCell className="min-w-[240px] align-top">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{deviation.title}</span>
            {deviation.required ? (
              <Badge variant="outline">{t.requiredTag}</Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {labels.clauseTypeLabels[String(deviation.clause_type)] ??
              formatToken(String(deviation.clause_type))}
          </p>
          <p className="text-xs text-muted-foreground">{deviation.message}</p>
          <ExcerptComparison deviation={deviation} labels={labels} />
          {clauseHref ? (
            <Link
              href={clauseHref}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80 print:hidden"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              {t.jumpToClause}
            </Link>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="align-top">
        <Badge variant={kindBadgeVariant(String(deviation.kind))}>
          {kindLabel[String(deviation.kind)] ?? formatToken(String(deviation.kind))}
        </Badge>
      </TableCell>
      <TableCell className="align-top">
        <LexSeverityChip value={String(deviation.severity)} size="sm" />
      </TableCell>
      <TableCell className="text-end align-top">
        {formatSimilarity(deviation.similarity, deviation.threshold)}
      </TableCell>
      <TableCell className="text-end align-top tabular-nums">
        {f.formatNumber(deviation.risk_weight)}
      </TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">
        {deviation.section_reference || '-'}
      </TableCell>
      <TableCell className="min-w-[180px] align-top">
        <div className="space-y-1.5">
          <Badge variant={reviewStatusVariant(currentStatus)}>
            {statusLabel[currentStatus]}
          </Badge>
          {canWrite ? (
            <div className="space-y-1.5 print:hidden">
              <Select
                value={currentStatus}
                onValueChange={(value) =>
                  handleStatusChange(value as LexDeviationReviewStatus)
                }
                disabled={upsertMutation.isPending}
              >
                <SelectTrigger
                  className="h-8 text-xs"
                  aria-label={t.reviewStatus}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status} value={status}>
                      {statusLabel[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {noteOpen ? (
                <div className="space-y-1.5">
                  <Textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t.addNote}
                    rows={2}
                    className="text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-7"
                    onClick={handleSaveNote}
                    disabled={upsertMutation.isPending}
                  >
                    {upsertMutation.isPending ? (
                      <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {t.markReviewed}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setNoteOpen(true)}
                  className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                >
                  {t.addNote}
                </button>
              )}
            </div>
          ) : review?.note ? (
            <p className="text-xs text-muted-foreground">{review.note}</p>
          ) : null}
          {review?.reviewed_by ? (
            <p className="text-xs text-muted-foreground">
              {t.reviewedBy(review.reviewed_by)}
            </p>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function reviewStatusVariant(
  status: LexDeviationReviewStatus,
): React.ComponentProps<typeof Badge>['variant'] {
  switch (status) {
    case 'accepted':
      return 'success';
    case 'rejected':
      return 'destructive';
    case 'needs_fix':
      return 'warning';
    case 'open':
    default:
      return 'outline';
  }
}

/**
 * Renders the expected-vs-actual clause excerpts for a deviation. When BOTH an
 * expected standard and the contract text are present, it shows an inline
 * {@link RedlineView} (split columns) so reviewers see exactly what changed
 * rather than two truncated blocks. When only one side exists (e.g. a missing
 * clause has no contract text, an extra clause has no standard), it falls back
 * to a single expandable excerpt block.
 */
function ExcerptComparison({
  deviation,
  labels,
}: {
  deviation: LexClauseDeviation;
  labels: PlaybookLabels;
}) {
  const { direction } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const t = labels.deviations;
  const expected = deviation.expected_excerpt?.trim() ?? '';
  const actual = deviation.actual_excerpt?.trim() ?? '';

  if (!expected && !actual) {
    return null;
  }

  if (expected && actual) {
    return (
      <div className="space-y-1.5">
        {expanded ? (
          <RedlineView
            original={expected}
            revised={actual}
            mode="split"
            originalLabel={t.expectedExcerpt}
            revisedLabel={t.actualExcerpt}
            dir={direction}
          />
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            <ExcerptBlock label={t.expectedExcerpt} text={expected} clamp />
            <ExcerptBlock label={t.actualExcerpt} text={actual} clamp />
          </div>
        )}
        <ExcerptToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} labels={labels} />
      </div>
    );
  }

  const onlyLabel = expected ? t.expectedExcerpt : t.actualExcerpt;
  const onlyText = expected || actual;
  return (
    <div className="space-y-1.5">
      <ExcerptBlock label={onlyLabel} text={onlyText} clamp={!expanded} />
      <ExcerptToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} labels={labels} />
    </div>
  );
}

function ExcerptToggle({
  expanded,
  onToggle,
  labels,
}: {
  expanded: boolean;
  onToggle: () => void;
  labels: PlaybookLabels;
}) {
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {expanded ? labels.deviations.collapseRedline : labels.deviations.showRedline}
    </button>
  );
}

function ExcerptBlock({ label, text, clamp }: { label: string; text: string; clamp?: boolean }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-0.5 text-xs text-foreground', clamp ? 'line-clamp-3' : 'whitespace-pre-wrap')}>{text}</p>
    </div>
  );
}

function DeviationStat({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  active?: boolean;
  onClick?: () => void;
}) {
  const f = useLexFormat();
  const formatted = typeof value === 'number' ? f.formatNumber(value) : value;
  if (!onClick) {
    return (
      <div className="rounded-lg border px-3 py-3" title={statisticHint(label, false)}>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold">{formatted}</p>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={statisticHint(label)}
      aria-pressed={active}
      className={cn(
        'rounded-lg border px-3 py-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:cursor-default',
        active ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{formatted}</p>
    </button>
  );
}

function formatSimilarity(
  similarity?: number | null,
  threshold?: number | null,
): string {
  if (similarity == null || !Number.isFinite(similarity)) {
    return '-';
  }
  const value = `${clampPercent(similarity)}%`;
  if (threshold != null && Number.isFinite(threshold)) {
    return `${value} / ${clampPercent(threshold)}%`;
  }
  return value;
}
