'use client';

/**
 * Unified Legal Calendar (feature #15).
 *
 * One calendar aggregating EVERY dated entity across the lex suite — case
 * hearings, contract renewals & expiries, signature deadlines, obligation due
 * dates, settlement milestones and service-desk SLAs — onto a single Gregorian +
 * Hijri timeline with KSA holiday shading. Gated (§8.6) on the cross-domain
 * `anyOf` view requirement from LEX_ROUTE_PERMISSIONS so any operator persona
 * that can see at least one dated domain reaches the calendar; the orchestrator
 * owns fetching, normalization and rendering.
 */

import { LexRouteGuard } from '../_guards/lex-route-guard';
import { LegalCalendar } from './_components/legal-calendar';

export default function LexCalendarPage() {
  return (
    <LexRouteGuard route="/lex/calendar">
      <LegalCalendar />
    </LexRouteGuard>
  );
}
