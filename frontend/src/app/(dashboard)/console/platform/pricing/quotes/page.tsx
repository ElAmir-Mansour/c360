'use client';

// QUOTES LIST / HISTORY (Phase-3b). A paginated, filterable table of saved
// pricing quotes (masked). Columns: quote #, account, model, selected tier, the
// selected tier's total-monthly, status badge, below-floor flag, valid-until,
// created. Filters: status + model. A row routes to the quote detail page.
//
// Self-gates on pricing:read (matched by pricing:* / *); the /platform layout
// additionally gates the console on admin:console. No margin appears here — the
// list is masked and the internal block is never rendered in a list row.

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileText, Calculator, AlertTriangle } from 'lucide-react';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { RelativeTime } from '@/components/shared/relative-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { formatDate } from '@/lib/format';
import { usePricingQuotes } from '../_lib/use-pricing-quotes';
import {
  QUOTE_STATUSES,
  findTier,
  type Quote,
  type QuoteStatus,
  type QuoteListParams,
} from '../_lib/quote-types';
import {
  STATUS_LABEL_KEY,
  STATUS_VARIANT,
  MODEL_LABEL_KEY,
  TIER_LABEL_KEY,
  makeMoney,
} from '../_lib/quote-format';
import type { PricingModel } from '../_lib/types';

const PAGE_SIZE = 20;

// Widen for the SimpleTable's Record<string, unknown> row constraint.
type QuoteRow = Quote & Record<string, unknown>;

const ALL = '__all__';

function QuotesBody() {
  const t = useT();
  const router = useRouter();
  const { locale } = useLocale();

  const [status, setStatus] = useState<QuoteStatus | ''>('');
  const [model, setModel] = useState<PricingModel | ''>('');
  const [page, setPage] = useState(1);

  const params = useMemo<QuoteListParams>(
    () => ({
      status: status || undefined,
      model: model || undefined,
      page,
      page_size: PAGE_SIZE,
    }),
    [status, model, page],
  );

  const { data, isLoading, isError, error, refetch } = usePricingQuotes(params);

  const quotes = data?.quotes ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const money = makeMoney(locale);

  const view = (q: Quote) => router.push(`/platform/pricing/quotes/${q.id}`);

  const columns: Column<QuoteRow>[] = [
    {
      key: 'quote_number',
      header: t('platformConsole.pricing.quotes.colNumber'),
      render: (q) => (
        <button
          className="text-start"
          onClick={(e) => {
            e.stopPropagation();
            view(q);
          }}
        >
          <code className="text-xs font-mono font-medium hover:underline">
            {q.quote_number}
          </code>
        </button>
      ),
    },
    {
      key: 'account_name',
      header: t('platformConsole.pricing.quotes.colAccount'),
      render: (q) => <span className="text-sm">{q.account_name}</span>,
    },
    {
      key: 'model',
      header: t('platformConsole.pricing.quotes.colModel'),
      render: (q) => (
        <span className="text-sm text-muted-foreground">
          {t(MODEL_LABEL_KEY[q.model])}
        </span>
      ),
    },
    {
      key: 'selected_tier',
      header: t('platformConsole.pricing.quotes.colTier'),
      render: (q) => (
        <Badge variant="outline">{t(TIER_LABEL_KEY[q.selected_tier])}</Badge>
      ),
    },
    {
      key: 'total',
      header: t('platformConsole.pricing.quotes.colTotal'),
      align: 'right',
      render: (q) => {
        const row = findTier(q, q.selected_tier);
        return (
          <span className="tabular-nums text-sm font-semibold">
            {row ? money(row.total_monthly) : '—'}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('platformConsole.pricing.quotes.colStatus'),
      render: (q) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={STATUS_VARIANT[q.status]}>
            {t(STATUS_LABEL_KEY[q.status])}
          </Badge>
          {q.below_floor ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {t('platformConsole.pricing.quotes.belowFloorFlag')}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'valid_until',
      header: t('platformConsole.pricing.quotes.colValidUntil'),
      render: (q): ReactNode =>
        q.valid_until ? (
          <span className="text-sm text-muted-foreground">
            {formatDate(q.valid_until)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'created_at',
      header: t('platformConsole.pricing.quotes.colCreated'),
      render: (q) => <RelativeTime date={q.created_at} />,
    },
  ];

  const statusValue = status || ALL;
  const modelValue = model || ALL;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('platformConsole.eyebrow')}
        title={t('platformConsole.pricing.quotes.title')}
        description={t('platformConsole.pricing.quotes.description')}
        tags={[
          {
            label: t('platformConsole.pricing.quotes.tag'),
            icon: <FileText className="h-3.5 w-3.5" aria-hidden />,
            tone: 'primary',
          },
        ]}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/platform/pricing">
              <Calculator className="me-1.5 h-4 w-4" aria-hidden />
              {t('platformConsole.pricing.calculatorTab')}
            </Link>
          </Button>
        }
      />

      {/* Filters. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full space-y-1.5 sm:w-48">
          <Label htmlFor="quotes-filter-status">
            {t('platformConsole.pricing.quotes.filterStatus')}
          </Label>
          <Select
            value={statusValue}
            onValueChange={(v) => {
              setStatus(v === ALL ? '' : (v as QuoteStatus));
              setPage(1);
            }}
          >
            <SelectTrigger id="quotes-filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('platformConsole.pricing.quotes.filterAll')}
              </SelectItem>
              {QUOTE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(STATUS_LABEL_KEY[s])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full space-y-1.5 sm:w-48">
          <Label htmlFor="quotes-filter-model">
            {t('platformConsole.pricing.quotes.filterModel')}
          </Label>
          <Select
            value={modelValue}
            onValueChange={(v) => {
              setModel(v === ALL ? '' : (v as PricingModel));
              setPage(1);
            }}
          >
            <SelectTrigger id="quotes-filter-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                {t('platformConsole.pricing.quotes.filterAll')}
              </SelectItem>
              <SelectItem value="per_user">
                {t('platformConsole.pricing.quotes.modelPerUser')}
              </SelectItem>
              <SelectItem value="per_core">
                {t('platformConsole.pricing.quotes.modelPerCore')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isError ? (
        <ErrorState
          variant={detectVariant(error)}
          error={error}
          message={t('platformConsole.pricing.quotes.loadError')}
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          <SimpleTable<QuoteRow>
            columns={columns}
            data={quotes as QuoteRow[]}
            loading={isLoading}
            emptyMessage={t('platformConsole.pricing.quotes.empty')}
            getRowKey={(q) => q.id}
            onRowClick={(q) => view(q)}
            ariaLabel={t('platformConsole.pricing.quotes.listAria')}
          />

          {/* Pagination. */}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t('platformConsole.pricing.quotes.pageOf')
                  .replace('{page}', String(page))
                  .replace('{total}', String(totalPages))}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('platformConsole.pricing.quotes.prev')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('platformConsole.pricing.quotes.next')}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function PricingQuotesPage() {
  return (
    <PermissionRedirect permission="pricing:read">
      <QuotesBody />
    </PermissionRedirect>
  );
}
