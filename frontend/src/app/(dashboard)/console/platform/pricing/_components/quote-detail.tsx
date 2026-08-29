'use client';

// QUOTE DETAIL (Phase-3b). Shows a single quote's masked tier breakdown (the
// internal margin block ONLY for pricing:admin — the page passes showMargin gated
// on pricing:admin, and QuoteTierTable additionally requires the server to have
// returned the `internal` block, which it only does for pricing:admin).
//
// Actions:
//  - Send / Accept / Reject: pricing:write. For a below_floor quote with no
//    override recorded, Send/Accept return 409; we surface that as a clear
//    "below floor — override required" message and (for pricing:admin) point at
//    the Override-Floor action.
//  - Override-Floor: pricing:admin only. Must be used before Send/Accept on a
//    below-floor quote. After it succeeds the quote re-hydrates (floor_override)
//    and Send/Accept stop 409-ing.
//  - Export XLSX / PDF: a client-facing blob download (margin never present).

import { useState } from 'react';
import Link from 'next/link';
import type { AxiosError } from 'axios';
import {
  ArrowLeft,
  Send,
  Check,
  X,
  ShieldAlert,
  FileSpreadsheet,
  FileText,
  Loader2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { downloadBlob, formatDate, formatDateTime, parseApiError } from '@/lib/format';
import { showSuccess, showError, showBackendError } from '@/lib/toast';
import type { ApiError } from '@/types/api';
import { QuoteTierTable } from './quote-tier-table';
import { OverrideFloorDialog } from './override-floor-dialog';
import {
  usePricingQuote,
  useTransitionPricingQuote,
  exportPricingQuote,
} from '../_lib/use-pricing-quotes';
import type { Quote, QuoteExportFormat, QuoteTransition } from '../_lib/quote-types';
import {
  STATUS_LABEL_KEY,
  MODEL_LABEL_KEY,
  TIER_LABEL_KEY,
} from '../_lib/quote-format';

interface QuoteDetailProps {
  id: string;
}

/**
 * Whether Send/Accept would be blocked by the below-floor guard. A below-floor
 * quote with no override recorded requires the override first (mirrors the
 * backend's 409). We use this both to disable the buttons AND to explain why.
 */
function needsOverride(quote: Quote): boolean {
  return quote.below_floor && !quote.floor_override;
}

export function QuoteDetail({ id }: QuoteDetailProps) {
  const t = useT();
  const { locale } = useLocale();
  const { hasPermission } = useAuth();

  const canWrite = hasPermission('pricing:write') || hasPermission('pricing:admin');
  const canOverride = hasPermission('pricing:admin');
  // Margin surface is gated on pricing:admin here; the server also structurally
  // masks (a non-admin never receives the `internal` block), so this is defence
  // in depth for the internal-only rule.
  const canSeeMargin = hasPermission('pricing:admin');

  const { data: quote, isLoading, isError, error, refetch } = usePricingQuote(id);
  const transition = useTransitionPricingQuote();

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [exporting, setExporting] = useState<QuoteExportFormat | null>(null);
  const [pending, setPending] = useState<QuoteTransition | null>(null);

  if (isError) {
    return (
      <div className="space-y-6">
        <BackLink label={t('platformConsole.pricing.quotes.backToList')} />
        <ErrorState
          variant={detectVariant(error)}
          error={error}
          message={t('platformConsole.pricing.quotes.detailError')}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (isLoading || !quote) {
    return (
      <div className="space-y-6">
        <BackLink label={t('platformConsole.pricing.quotes.backToList')} />
        <LoadingSkeleton variant="table" count={8} />
      </div>
    );
  }

  const overrideRequired = needsOverride(quote);

  const runTransition = async (action: QuoteTransition) => {
    setPending(action);
    try {
      await transition.mutateAsync({ id, action });
      const key =
        action === 'send'
          ? 'platformConsole.pricing.quotes.sendSuccess'
          : action === 'accept'
            ? 'platformConsole.pricing.quotes.acceptSuccess'
            : 'platformConsole.pricing.quotes.rejectSuccess';
      showSuccess(t(key));
    } catch (err) {
      const axiosErr = err as AxiosError<ApiError>;
      // 409 == below-floor guard: send/accept blocked until an override exists.
      if (axiosErr.response?.status === 409) {
        showError(t('platformConsole.pricing.quotes.overrideRequired'));
      } else {
        showBackendError(err, parseApiError(err));
      }
    } finally {
      setPending(null);
    }
  };

  const runExport = async (format: QuoteExportFormat) => {
    setExporting(format);
    try {
      const blob = await exportPricingQuote(id, format);
      const filename = `${quote.quote_number}.${format}`;
      downloadBlob(blob, filename);
      showSuccess(t('platformConsole.pricing.quotes.exportSuccess'));
    } catch (err) {
      showBackendError(err, t('platformConsole.pricing.quotes.exportError'));
    } finally {
      setExporting(null);
    }
  };

  const busy = pending !== null || transition.isPending;

  return (
    <div className="space-y-6">
      <BackLink label={t('platformConsole.pricing.quotes.backToList')} />

      <PageHeader
        eyebrow={t('platformConsole.eyebrow')}
        title={t('platformConsole.pricing.quotes.detailTitle').replace(
          '{number}',
          quote.quote_number,
        )}
        description={t('platformConsole.pricing.quotes.detailDescription')}
        tags={[
          {
            label: t(STATUS_LABEL_KEY[quote.status]),
            tone:
              quote.status === 'accepted'
                ? 'success'
                : quote.status === 'rejected'
                  ? 'danger'
                  : quote.status === 'expired'
                    ? 'warning'
                    : 'info',
          },
          ...(quote.below_floor
            ? [
                {
                  label: t('platformConsole.pricing.quotes.belowFloorFlag'),
                  icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
                  tone: 'danger' as const,
                },
              ]
            : []),
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Shareable, branded, always-margin-masked client proposal view. */}
            <Button variant="outline" size="sm" asChild data-testid="open-client-view">
              <Link href={`/platform/pricing/quotes/${id}/client-view`}>
                <ExternalLink className="me-1.5 h-4 w-4" aria-hidden />
                {t('platformConsole.pricing.clientView.openButton')}
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting !== null}
              onClick={() => void runExport('xlsx')}
            >
              {exporting === 'xlsx' ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <FileSpreadsheet className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {t('platformConsole.pricing.quotes.exportXlsx')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting !== null}
              onClick={() => void runExport('pdf')}
            >
              {exporting === 'pdf' ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <FileText className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {t('platformConsole.pricing.quotes.exportPdf')}
            </Button>
          </div>
        }
      />

      {/* Metadata + lifecycle actions. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('platformConsole.pricing.quotes.actionsTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Meta label={t('platformConsole.pricing.quotes.account')} value={quote.account_name} />
            <Meta
              label={t('platformConsole.pricing.quotes.selectedTier')}
              value={t(TIER_LABEL_KEY[quote.selected_tier])}
            />
            <Meta
              label={t('platformConsole.pricing.quotes.colModel')}
              value={t(MODEL_LABEL_KEY[quote.model])}
            />
            <Meta
              label={t('platformConsole.pricing.quotes.pricingVersion')}
              value={String(quote.pricing_version)}
            />
            <Meta
              label={t('platformConsole.pricing.quotes.validUntil')}
              value={quote.valid_until ? formatDate(quote.valid_until) : '—'}
            />
            <Meta
              label={t('platformConsole.pricing.quotes.created')}
              value={formatDateTime(quote.created_at)}
            />
          </dl>

          {/* Below-floor: explain the override-required guard clearly. */}
          {overrideRequired ? (
            <div
              className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive"
              role="alert"
              data-testid="override-required-banner"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{t('platformConsole.pricing.quotes.overrideRequired')}</span>
            </div>
          ) : null}

          {/* Lifecycle actions. */}
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* Override-Floor — pricing:admin, shown when required. */}
              {canOverride && overrideRequired ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setOverrideOpen(true)}
                  data-testid="override-floor-action"
                >
                  <ShieldAlert className="me-1.5 h-4 w-4" aria-hidden />
                  {t('platformConsole.pricing.quotes.overrideFloor')}
                </Button>
              ) : null}

              <Button
                size="sm"
                // Send/Accept are blocked by the below-floor guard until override.
                disabled={busy || overrideRequired}
                onClick={() => void runTransition('send')}
                data-testid="quote-send"
              >
                {pending === 'send' ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="me-1.5 h-4 w-4" aria-hidden />
                )}
                {t('platformConsole.pricing.quotes.send')}
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={busy || overrideRequired}
                onClick={() => void runTransition('accept')}
                data-testid="quote-accept"
              >
                {pending === 'accept' ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="me-1.5 h-4 w-4" aria-hidden />
                )}
                {t('platformConsole.pricing.quotes.accept')}
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void runTransition('reject')}
                data-testid="quote-reject"
              >
                {pending === 'reject' ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <X className="me-1.5 h-4 w-4" aria-hidden />
                )}
                {t('platformConsole.pricing.quotes.reject')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Tier breakdown (masked) + margin panel (pricing:admin only). */}
      <QuoteTierTable
        tiers={quote.tiers}
        model={quote.model}
        currency={quote.currency}
        selectedTier={quote.selected_tier}
        showMargin={canSeeMargin}
      />

      {canOverride ? (
        <OverrideFloorDialog
          open={overrideOpen}
          onOpenChange={setOverrideOpen}
          quoteId={id}
        />
      ) : null}
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/platform/pricing/quotes"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
      {label}
    </Link>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}
