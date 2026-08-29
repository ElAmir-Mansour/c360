'use client';

// SAVE-QUOTE dialog (Phase-3b). Opened from the calculator's Save-Quote button
// (gated on pricing:write). Prompts for account_name (required) + optional
// tenant/lead ids and CONFIRMS the currently-selected tier, then POSTs the
// current calculator inputs + selected_tier to /api/v1/pricing/quotes.
//
// It sends NO tier numbers — the server recomputes from the active pricing_config
// given the drivers + selected_tier. On success it routes to the new quote (and
// also surfaces a toast with the quote_number).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PlatformTenantPicker } from '@/components/shared/forms/platform-tenant-picker';
import { useT } from '@/components/providers/locale-provider';
import { showSuccess, showBackendError } from '@/lib/toast';
import { useCreatePricingQuote } from '../_lib/use-pricing-quotes';
import { TIER_LABEL_KEY } from '../_lib/quote-format';
import type { PricingInputState } from './pricing-inputs';
import type { CreateQuoteRequest } from '../_lib/quote-types';
import type { PricingTier } from '../_lib/types';

interface SaveQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current calculator inputs (raw UI state — discount is 0-100 here). */
  inputs: PricingInputState;
  /** The tier the quote is being created for (confirmed in the dialog). */
  selectedTier: PricingTier;
  /** Whether the sales-discount lever applies (pricing:write+). */
  canDiscount: boolean;
}

export function SaveQuoteDialog({
  open,
  onOpenChange,
  inputs,
  selectedTier,
  canDiscount,
}: SaveQuoteDialogProps) {
  const t = useT();
  const router = useRouter();
  const create = useCreatePricingQuote();

  const [accountName, setAccountName] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [touched, setTouched] = useState(false);

  const accountMissing = accountName.trim().length === 0;

  const reset = () => {
    setAccountName('');
    setTenantId('');
    setLeadId('');
    setTouched(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const buildBody = (): CreateQuoteRequest => {
    const body: CreateQuoteRequest = {
      model: inputs.model,
      deployment: inputs.deployment,
      term_months: inputs.termMonths,
      hot_storage_gb: inputs.hotStorageGb,
      cold_storage_gb: inputs.coldStorageGb,
      selected_tier: selectedTier,
      account_name: accountName.trim(),
    };
    if (inputs.model === 'per_user') {
      body.users = inputs.users;
    } else {
      body.cores = inputs.cores;
      body.vms = inputs.vms;
    }
    // Discount is a 0-1 fraction on the wire, and only sent for write+ users.
    if (canDiscount && inputs.salesDiscountPct > 0) {
      body.sales_discount = inputs.salesDiscountPct / 100;
    }
    if (tenantId.trim()) body.tenant_id = tenantId.trim();
    if (leadId.trim()) body.lead_id = leadId.trim();
    return body;
  };

  const submit = async () => {
    setTouched(true);
    if (accountMissing) return;
    try {
      const quote = await create.mutateAsync(buildBody());
      showSuccess(
        t('platformConsole.pricing.quotes.saveSuccess').replace(
          '{number}',
          quote.quote_number,
        ),
      );
      handleOpenChange(false);
      router.push(`/platform/pricing/quotes/${quote.id}`);
    } catch (err) {
      showBackendError(err, t('platformConsole.pricing.quotes.saveError'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('platformConsole.pricing.quotes.saveDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('platformConsole.pricing.quotes.saveDialogDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Confirm the tier the quote is for. */}
          <div className="flex items-center justify-between rounded-xl border border-input/80 bg-card/60 px-3.5 py-2.5">
            <span className="text-sm text-muted-foreground">
              {t('platformConsole.pricing.quotes.confirmTierLabel')}
            </span>
            <Badge variant="default">
              {t(TIER_LABEL_KEY[selectedTier])}
            </Badge>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="save-quote-account">
              {t('platformConsole.pricing.quotes.accountNameLabel')}
            </Label>
            <Input
              id="save-quote-account"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder={t('platformConsole.pricing.quotes.accountNamePlaceholder')}
              aria-invalid={touched && accountMissing}
              aria-describedby={
                touched && accountMissing ? 'save-quote-account-error' : undefined
              }
            />
            {touched && accountMissing ? (
              <p id="save-quote-account-error" className="text-xs text-destructive">
                {t('platformConsole.pricing.quotes.accountNameRequired')}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="save-quote-tenant">
                {t('platformConsole.pricing.quotes.tenantIdLabel')}
              </Label>
              <PlatformTenantPicker
                id="save-quote-tenant"
                value={tenantId}
                onChange={setTenantId}
                enabled={open}
                disabled={create.isPending}
                allowClear
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="save-quote-lead">
                {t('platformConsole.pricing.quotes.leadIdLabel')}
              </Label>
              <Input
                id="save-quote-lead"
                value={leadId}
                onChange={(e) => setLeadId(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={create.isPending}
          >
            {t('platformConsole.pricing.quotes.cancel')}
          </Button>
          <Button onClick={submit} disabled={create.isPending || accountMissing}>
            {create.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="me-1.5 h-4 w-4" aria-hidden />
            )}
            {t('platformConsole.pricing.quotes.saveConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
