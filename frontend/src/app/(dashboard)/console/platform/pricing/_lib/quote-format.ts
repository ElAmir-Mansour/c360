// Shared presentation helpers for the quotes surface: status → i18n key + Badge
// tone, model / tier label keys, and a SAR money formatter. Kept framework-free
// (returns keys + variant strings) so both the list and detail render off the
// same source of truth.

import type { MessageKey } from '@/lib/i18n/messages';
import type { QuoteStatus } from './quote-types';
import type { PricingModel, PricingTier } from './types';

type BadgeVariant = 'default' | 'destructive' | 'warning' | 'outline' | 'success';

export const STATUS_LABEL_KEY: Record<QuoteStatus, MessageKey> = {
  draft: 'platformConsole.pricing.quotes.statusDraft',
  sent: 'platformConsole.pricing.quotes.statusSent',
  accepted: 'platformConsole.pricing.quotes.statusAccepted',
  rejected: 'platformConsole.pricing.quotes.statusRejected',
  expired: 'platformConsole.pricing.quotes.statusExpired',
};

export const STATUS_VARIANT: Record<QuoteStatus, BadgeVariant> = {
  draft: 'outline',
  sent: 'default',
  accepted: 'success',
  rejected: 'destructive',
  expired: 'warning',
};

export const MODEL_LABEL_KEY: Record<PricingModel, MessageKey> = {
  per_user: 'platformConsole.pricing.quotes.modelPerUser',
  per_core: 'platformConsole.pricing.quotes.modelPerCore',
};

export const TIER_LABEL_KEY: Record<PricingTier, MessageKey> = {
  standard: 'platformConsole.pricing.tierStandard',
  growth: 'platformConsole.pricing.tierGrowth',
  professional: 'platformConsole.pricing.tierProfessional',
  customized: 'platformConsole.pricing.tierCustomized',
};

/** SAR-aware currency formatter bound to the active locale. */
export function makeMoney(locale: string, currency = 'SAR') {
  return (n: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'SAR',
      maximumFractionDigits: 2,
    }).format(n);
}
