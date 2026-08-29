'use client';

// SHAREABLE CLIENT QUOTE (Wave C #7) — a polished, branded, print/PDF-optimized,
// ALWAYS-margin-masked client-facing rendering of a SAVED quote. This is what a
// prospect sees: it looks like a real proposal, not the internal tier table.
//
// MARGIN DISCIPLINE (hard): this surface renders STRICTLY the masked ClientTier
// fields. It NEVER reads `row.internal` and it NEVER requests include_internal —
// even for a pricing:admin user, this is a client-facing document. The quote is
// fetched via the same GET /quotes/{id} the detail page uses; the server masks
// the internal block for non-admins, and this component additionally never
// touches it. So margin can never appear here regardless of role.
//
// It is @media print friendly (a Print / Save-as-PDF button drives window.print
// with print CSS that hides the app chrome + the toolbar), and it also offers the
// existing server exports (xlsx / pdf). Bilingual (ar/en), RTL-correct.

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Printer,
  FileSpreadsheet,
  FileText,
  Loader2,
  Link2,
  Check,
} from 'lucide-react';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Logo } from '@/components/brand/logo';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { downloadBlob, formatDate } from '@/lib/format';
import { showSuccess, showBackendError } from '@/lib/toast';
import { usePricingQuote, exportPricingQuote } from '../_lib/use-pricing-quotes';
import {
  MODEL_LABEL_KEY,
  TIER_LABEL_KEY,
  makeMoney,
} from '../_lib/quote-format';
import {
  TIER_POSITIONING_KEY,
  TIER_AI_ALLOWANCE_KEY,
  deploymentEligible,
} from '../_lib/pricing-derive';
import { findTier } from '../_lib/quote-types';
import type { QuoteExportFormat } from '../_lib/quote-types';
import type { PricingTierRow } from '../_lib/types';

interface QuoteClientViewProps {
  id: string;
}

export function QuoteClientView({ id }: QuoteClientViewProps) {
  const t = useT();
  const { locale } = useLocale();

  // Same fetch as the detail page. We NEVER pass include_internal; and even if
  // the server returned an internal block (admin), this component never reads it.
  const { data: quote, isLoading, isError, error, refetch } = usePricingQuote(id);

  const [exporting, setExporting] = useState<QuoteExportFormat | null>(null);
  const [copied, setCopied] = useState(false);

  const runExport = async (format: QuoteExportFormat) => {
    if (!quote) return;
    setExporting(format);
    try {
      const blob = await exportPricingQuote(id, format);
      downloadBlob(blob, `${quote.quote_number}.${format}`);
      showSuccess(t('platformConsole.pricing.quotes.exportSuccess'));
    } catch (err) {
      showBackendError(err, t('platformConsole.pricing.quotes.exportError'));
    } finally {
      setExporting(null);
    }
  };

  const copyShareLink = async () => {
    if (typeof window === 'undefined') return;
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      showSuccess(t('platformConsole.pricing.clientView.linkCopied'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showBackendError(null, t('platformConsole.pricing.clientView.linkCopyError'));
    }
  };

  if (isError) {
    return (
      <div className="space-y-6">
        <ClientViewBackLink id={id} label={t('platformConsole.pricing.clientView.backToQuote')} />
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
        <ClientViewBackLink id={id} label={t('platformConsole.pricing.clientView.backToQuote')} />
        <LoadingSkeleton variant="table" count={8} />
      </div>
    );
  }

  const money = makeMoney(locale, quote.currency);

  // The hero tier is the quote's selected tier (masked row). Fall back to the
  // first tier defensively.
  const hero: PricingTierRow | undefined =
    findTier(quote, quote.selected_tier) ?? quote.tiers[0];

  // Model-conditional usage line label + value for the line-item breakdown.
  const usageKey: keyof PricingTierRow['line_items'] =
    quote.model === 'per_core' ? 'vm_infrastructure' : 'data_storage';
  const usageLabel =
    quote.model === 'per_core'
      ? t('platformConsole.pricing.rowVmInfrastructure')
      : t('platformConsole.pricing.rowDataStorage');

  // MASKED line items for the hero tier — client fields only.
  const lineItems = hero
    ? [
        { label: t('platformConsole.pricing.rowBaseCharge'), value: hero.line_items.base_charge },
        { label: t('platformConsole.pricing.rowAiAllocation'), value: hero.line_items.ai_allocation },
        { label: usageLabel, value: hero.line_items[usageKey] },
        {
          label: t('platformConsole.pricing.rowSetupPremium'),
          value: hero.line_items.deployment_setup_premium,
        },
      ]
    : [];

  const discounts = hero
    ? [
        { label: t('platformConsole.pricing.rowVolumeDiscount'), value: hero.volume_discount },
        { label: t('platformConsole.pricing.rowTermDiscount'), value: hero.term_discount },
        { label: t('platformConsole.pricing.rowSalesDiscount'), value: hero.sales_discount },
      ].filter((d) => d.value > 0)
    : [];

  const features = hero
    ? [
        t(TIER_AI_ALLOWANCE_KEY[hero.tier]),
        deploymentEligible(hero.tier)
          ? t('platformConsole.pricing.cards.deployAll')
          : t('platformConsole.pricing.cards.deploySaasOnly'),
      ]
    : [];

  return (
    <div className="space-y-6" data-testid="quote-client-view">
      {/* Toolbar — hidden in print output. */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <ClientViewBackLink id={id} label={t('platformConsole.pricing.clientView.backToQuote')} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={copyShareLink}
            data-testid="client-view-copy-link"
          >
            {copied ? (
              <Check className="me-1.5 h-4 w-4 text-success-600" aria-hidden />
            ) : (
              <Link2 className="me-1.5 h-4 w-4" aria-hidden />
            )}
            {t('platformConsole.pricing.clientView.copyLink')}
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
          <Button
            size="sm"
            onClick={() => window.print()}
            data-testid="client-view-print"
          >
            <Printer className="me-1.5 h-4 w-4" aria-hidden />
            {t('platformConsole.pricing.clientView.print')}
          </Button>
        </div>
      </div>

      {/* THE PROPOSAL — the printable document. */}
      <article
        data-testid="client-view-proposal"
        className="mx-auto max-w-3xl rounded-card border border-border bg-card p-8 shadow-elevation-1 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        {/* Letterhead */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div className="space-y-1" data-testid="client-view-logo">
            <Logo className="h-9 w-auto" />
            <p className="text-xs text-muted-foreground">
              {t('platformConsole.pricing.clientView.proposalKicker')}
            </p>
          </div>
          <div className="text-end">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('platformConsole.pricing.clientView.quoteNumberLabel')}
            </p>
            <p className="font-semibold tabular-nums text-foreground">
              {quote.quote_number}
            </p>
          </div>
        </header>

        {/* Prepared-for + dates */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('platformConsole.pricing.clientView.preparedFor')}
            </p>
            <p className="mt-0.5 text-lg font-semibold text-foreground">
              {quote.account_name}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('platformConsole.pricing.clientView.date')}
            </p>
            <p className="mt-0.5 font-medium tabular-nums text-foreground">
              {formatDate(quote.created_at)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('platformConsole.pricing.quotes.validUntil')}
            </p>
            <p className="mt-0.5 font-medium tabular-nums text-foreground">
              {quote.valid_until ? formatDate(quote.valid_until) : '—'}
            </p>
          </div>
        </section>

        {hero ? (
          <>
            {/* Hero tier */}
            <section
              className="mt-8 rounded-card border border-primary/30 bg-primary/[0.04] p-6"
              data-testid="client-view-hero"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">{t(TIER_LABEL_KEY[hero.tier])}</Badge>
                <span className="text-sm text-muted-foreground">
                  {t(MODEL_LABEL_KEY[quote.model])}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(TIER_POSITIONING_KEY[hero.tier])}
              </p>

              <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('platformConsole.pricing.summary.totalMonthly')}
                  </p>
                  <p className="text-3xl font-bold tabular-nums text-primary">
                    {money(hero.total_monthly)}
                    <span className="ms-1 text-base font-normal text-muted-foreground">
                      {t('platformConsole.pricing.summary.perMonth')}
                    </span>
                  </p>
                </div>
              </div>

              {/* Included features */}
              {features.length > 0 ? (
                <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span className="text-start">{f}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {/* Line-item breakdown + totals (MASKED) */}
            <section className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t('platformConsole.pricing.clientView.breakdownTitle')}
              </h2>
              <table
                className="mt-3 w-full text-sm"
                aria-label={t('platformConsole.pricing.clientView.breakdownTitle')}
              >
                <tbody>
                  {lineItems.map((li) => (
                    <tr key={li.label} className="border-b border-border/60">
                      <th scope="row" className="py-2 text-start font-normal text-muted-foreground">
                        {li.label}
                      </th>
                      <td className="py-2 text-end tabular-nums text-foreground">
                        {money(li.value)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-b border-border/60">
                    <th scope="row" className="py-2 text-start font-medium text-foreground">
                      {t('platformConsole.pricing.rowSubTotal')}
                    </th>
                    <td className="py-2 text-end font-semibold tabular-nums text-foreground">
                      {money(hero.sub_total)}
                    </td>
                  </tr>
                  {discounts.map((d) => (
                    <tr key={d.label} className="border-b border-border/60">
                      <th scope="row" className="py-2 text-start font-normal text-muted-foreground">
                        {d.label}
                      </th>
                      <td className="py-2 text-end tabular-nums text-success-700 dark:text-success-300">
                        − {money(d.value)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-b border-border/60">
                    <th scope="row" className="py-2 text-start font-medium text-foreground">
                      {t('platformConsole.pricing.rowNetSubTotal')}
                    </th>
                    <td className="py-2 text-end font-semibold tabular-nums text-foreground">
                      {money(hero.net_sub_total)}
                    </td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <th scope="row" className="py-2 text-start font-normal text-muted-foreground">
                      {t('platformConsole.pricing.rowVat')}
                    </th>
                    <td className="py-2 text-end tabular-nums text-foreground">
                      {money(hero.vat)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-3 text-start text-base font-bold text-foreground">
                      {t('platformConsole.pricing.summary.totalMonthly')}
                    </th>
                    <td className="py-3 text-end text-base font-bold tabular-nums text-primary">
                      {money(hero.total_monthly)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            {/* TOTAL CONTRACT VALUE — the headline. */}
            <section
              className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-card bg-primary/[0.06] px-6 py-5"
              data-testid="client-view-contract-value"
            >
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('platformConsole.pricing.summary.contractValue')}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('platformConsole.pricing.clientView.contractValueNote')}
                </p>
              </div>
              <p className="text-3xl font-bold tabular-nums text-primary">
                {money(hero.contract_value)}
              </p>
            </section>
          </>
        ) : null}

        {/* Terms / validity footer */}
        <footer className="mt-8 border-t border-border pt-6 text-xs text-muted-foreground">
          <p>
            {t('platformConsole.pricing.clientView.termsValidity').replace(
              '{date}',
              quote.valid_until ? formatDate(quote.valid_until) : '—',
            )}
          </p>
          <p className="mt-1">{t('platformConsole.pricing.clientView.termsVat')}</p>
          <p className="mt-3 flex items-center gap-1.5">
            <Logo variant="mark" className="h-4 w-4" decorative />
            <span>
              {t('platformConsole.pricing.clientView.footerBrand').replace(
                '{number}',
                quote.quote_number,
              )}
            </span>
          </p>
        </footer>
      </article>
    </div>
  );
}

function ClientViewBackLink({ id, label }: { id: string; label: string }) {
  return (
    <Link
      href={`/platform/pricing/quotes/${id}`}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
      {label}
    </Link>
  );
}
