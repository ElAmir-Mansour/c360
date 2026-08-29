/**
 * Feature 8b — calendar view of contract expiries.
 *
 * Plots every contract that carries an `expiry_date` as an event on the shared
 * `EventCalendar`, severity-coloured by the contract's `risk_level` (mapped
 * through `toIndicatorSeverity`). Clicking an event hands the contract id back to
 * the integrator via `onSelect`, which typically opens the preview drawer or
 * navigates to the detail console.
 *
 * Mirrors the EventCalendar usage pattern established by the obligations page
 * (`../../obligations/page.tsx`): build a `CalendarEvent[]` with `useMemo`, then
 * feed locale/direction straight from `useLocale()`. Bilingual copy follows the
 * canonical lex `LexBilingual<T>` token-record idiom.
 */

'use client';

import { useMemo } from 'react';

import { EventCalendar, type CalendarEvent } from '@/components/shared/event-calendar';
import { useLocale } from '@/components/providers/locale-provider';
import type { LexContract, LexRiskLevel } from '@/types/suites';

import { toIndicatorSeverity } from '../[id]/_components/risk-severity';

/**
 * `EventCalendar` accepts a narrower severity union than the shared
 * `SeverityIndicator` `Severity` (no `warning`). Contract risk levels only ever
 * resolve to `critical | high | medium | low | none`, so `toIndicatorSeverity`
 * never yields `warning` here — this map is the explicit, type-safe narrowing
 * onto the calendar palette, keeping the dot colours aligned with the detail
 * console's risk treatment.
 */
type CalendarSeverity = NonNullable<CalendarEvent['severity']>;

function riskToCalendarSeverity(risk: LexRiskLevel): CalendarSeverity {
  switch (toIndicatorSeverity(risk)) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}

/** Risk-level pill copy for the agenda `kind` chip, keyed by raw backend token. */
const RISK_KIND_LABELS = {
  en: {
    critical: 'Critical risk',
    high: 'High risk',
    medium: 'Medium risk',
    low: 'Low risk',
    none: 'No risk',
  },
  ar: {
    critical: 'مخاطر حرجة',
    high: 'مخاطر مرتفعة',
    medium: 'مخاطر متوسطة',
    low: 'مخاطر منخفضة',
    none: 'بلا مخاطر',
  },
} as const satisfies Record<'en' | 'ar', Record<LexRiskLevel, string>>;

/** Agenda-row meta prefix ("Expires", before the counterparty name). */
const EXPIRY_META = {
  en: (counterparty: string) => `Expiry • ${counterparty}`,
  ar: (counterparty: string) => `الانتهاء • ${counterparty}`,
} as const;

export interface ContractsCalendarViewProps {
  contracts: LexContract[];
  onSelect: (contractId: string) => void;
}

export function ContractsCalendarView({
  contracts,
  onSelect,
}: ContractsCalendarViewProps): JSX.Element {
  const { locale, direction } = useLocale();
  const lang = locale === 'ar' ? 'ar' : 'en';

  const events = useMemo<CalendarEvent[]>(() => {
    const kindLabels = RISK_KIND_LABELS[lang];
    const metaLabel = EXPIRY_META[lang];
    return contracts
      .filter((contract) => Boolean(contract.expiry_date))
      .map((contract) => ({
        id: contract.id,
        date: contract.expiry_date as string,
        title: contract.title,
        severity: riskToCalendarSeverity(contract.risk_level),
        kind: kindLabels[contract.risk_level] ?? kindLabels.none,
        meta: metaLabel(contract.party_b_name || contract.party_a_name),
      }));
  }, [contracts, lang]);

  return (
    <EventCalendar
      events={events}
      onSelectEvent={onSelect}
      dir={direction}
      locale={lang}
    />
  );
}
