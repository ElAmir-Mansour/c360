/**
 * Unified Legal Calendar — event model + normalizers (feature #15).
 *
 * The calendar aggregates EVERY dated entity across the lex suite onto one
 * timeline. Each source list is fetched independently (so a single failing
 * source degrades gracefully instead of blanking the whole surface) and mapped
 * to the canonical {@link LegalCalendarEvent} shape:
 *
 *     { id, type, title, date, severity, href, meta? }
 *
 * Sources & their dated field(s):
 *   - Court hearings ........ casesApi.listCases?expand=hearings → hearings[].hearing_date
 *                             (falls back to the next_hearing_date scalar aggregate)
 *   - Contract renewals ..... enterpriseApi.lex.listContracts → renewal_date
 *   - Contract expiries ..... enterpriseApi.lex.listContracts → expiry_date
 *   - Signature deadlines ... enterpriseApi.lex.listSignatures → due_at | expires_at
 *   - Obligation due dates .. enterpriseApi.lex.listObligations → due_date
 *   - Settlement milestones . settlementsApi.listMatterTimelines → due_date / ETA
 *   - Service-desk SLA ...... lexRequestsApi.listSlaClocks → turnaround_due_at
 *
 * All normalizers are PURE (no fetch, no React) so they can be unit-reasoned
 * about and reused. Fetching is orchestrated by the page via react-query.
 */

import { casesApi, type LegalCase } from '@/lib/lex/cases';
import { settlementsApi, type MatterTimelineSummary } from '@/lib/lex/settlements';
import { lexRequestsApi, type SLAClockView } from '@/lib/lex/requests';
import { enterpriseApi } from '@/lib/enterprise';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import type {
  LexContractRecord,
  LexObligation,
  LexSignatureEnvelope,
} from '@/types/suites';
import type { FetchParams } from '@/types/table';

/** The seven dated entity classes the calendar overlays. */
export type LegalEventType =
  | 'hearing'
  | 'contract_renewal'
  | 'contract_expiry'
  | 'signature_deadline'
  | 'obligation'
  | 'settlement_milestone'
  | 'service_sla';

/** Calendar severity palette — mirrors the shared EventCalendar union. */
export type LegalEventSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** The canonical, source-agnostic calendar event. */
export interface LegalCalendarEvent {
  /** Globally-unique id (namespaced by type to avoid cross-source collisions). */
  id: string;
  type: LegalEventType;
  /** Already locale-resolved display title. */
  title: string;
  /** ISO date string (RFC3339). */
  date: string;
  severity: LegalEventSeverity;
  /** Click-through to the owning entity. */
  href: string;
  /** Optional secondary line (counterparty, matter ref, etc.). */
  meta?: string;
}

/** Source channels, used as query keys + the per-source filter taxonomy. */
export const EVENT_TYPES: readonly LegalEventType[] = [
  'hearing',
  'contract_renewal',
  'contract_expiry',
  'signature_deadline',
  'obligation',
  'settlement_milestone',
  'service_sla',
] as const;

export const EVENT_SEVERITIES: readonly LegalEventSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
] as const;

/** A generous single-page pull is enough for a calendar horizon. */
const LIST_PARAMS: FetchParams = { page: 1, per_page: 200 };

/**
 * Cases opt into the backend's `expand=hearings` hydration so each list row
 * carries its full `hearings[]` docket (every court date). The `expand` param
 * rides through `filters`, which `buildSuiteQueryParams` flattens into the query
 * string (comma-separated, opt-in); without it the response is unchanged and the
 * calendar falls back to the `next_hearing_date` scalar.
 */
const CASE_LIST_PARAMS: FetchParams = {
  ...LIST_PARAMS,
  filters: { expand: 'hearings' },
};

/* ------------------------------------------------------------------------- *
 * Severity derivation helpers
 * ------------------------------------------------------------------------- */

const PRIORITY_SEVERITY: Record<string, LegalEventSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const RISK_SEVERITY: Record<string, LegalEventSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  none: 'info',
};

function mapPriority(value: string | null | undefined): LegalEventSeverity {
  return PRIORITY_SEVERITY[String(value ?? '').toLowerCase()] ?? 'medium';
}

/**
 * Time-proximity severity: items inside `now` get escalated. Used for date-only
 * sources (renewals, expiries, signatures) where the backing record carries no
 * intrinsic priority. Pure: `now` is injected.
 */
function severityByProximity(
  iso: string,
  now: Date,
  base: LegalEventSeverity = 'medium',
): LegalEventSeverity {
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) {
    return base;
  }
  const days = (due - now.getTime()) / 86_400_000;
  if (days < 0) return 'critical';
  if (days <= 7) return 'high';
  if (days <= 30) return 'medium';
  return base === 'info' ? 'info' : 'low';
}

/* ------------------------------------------------------------------------- *
 * Per-source normalizers (pure)
 * ------------------------------------------------------------------------- */

/**
 * The case-list row shape the backend serializes (`dto.LegalCaseListItem`): the
 * embedded `LegalCase` plus the WS9 list aggregates. With `expand=hearings` each
 * row also carries its hydrated `hearings[]` relation (every court date). The
 * `next_hearing_date` scalar is the derived earliest-upcoming aggregate and
 * remains the fallback when `hearings[]` is absent (no expand / no rows).
 */
type LegalCaseListRow = LegalCase & {
  next_hearing_date?: string | null;
};

export function hearingEvents(cases: LegalCaseListRow[], locale: AppLocale): LegalCalendarEvent[] {
  const out: LegalCalendarEvent[] = [];
  for (const legalCase of cases) {
    const caseTitle = resolveLocalized(legalCase.title, locale) || legalCase.case_number;
    const hearings = legalCase.hearings ?? [];

    if (hearings.length > 0) {
      // `expand=hearings` hydrated the full docket — emit one event per court
      // date so the calendar shows ALL hearings, not just the next one.
      for (const hearing of hearings) {
        if (!hearing.hearing_date) continue;
        out.push({
          id: `hearing:${legalCase.id}:${hearing.id}`,
          type: 'hearing',
          title: caseTitle,
          date: hearing.hearing_date,
          severity: mapPriority(legalCase.priority),
          href: `/lex/cases/${legalCase.id}`,
          meta: [legalCase.case_number, hearing.location ?? undefined]
            .filter(Boolean)
            .join(' · '),
        });
      }
      continue;
    }

    // Fallback: no hydrated `hearings[]` (expand omitted or no rows) — fall back
    // to the `next_hearing_date` scalar aggregate, one event for the next date.
    const nextHearing = legalCase.next_hearing_date;
    if (!nextHearing) continue;
    out.push({
      id: `hearing:${legalCase.id}`,
      type: 'hearing',
      title: caseTitle,
      date: nextHearing,
      severity: mapPriority(legalCase.priority),
      href: `/lex/cases/${legalCase.id}`,
      meta: legalCase.case_number,
    });
  }
  return out;
}

export function contractEvents(
  contracts: LexContractRecord[],
  now: Date,
): LegalCalendarEvent[] {
  const out: LegalCalendarEvent[] = [];
  for (const contract of contracts) {
    const href = `/lex/contracts/${contract.id}`;
    const counterparty = contract.party_b_name || contract.party_a_name;
    const riskBase = RISK_SEVERITY[String(contract.risk_level ?? 'none')] ?? 'info';

    if (contract.renewal_date) {
      out.push({
        id: `contract_renewal:${contract.id}`,
        type: 'contract_renewal',
        title: contract.title,
        date: contract.renewal_date,
        severity: severityByProximity(contract.renewal_date, now, riskBase),
        href,
        meta: [contract.contract_number ?? undefined, counterparty]
          .filter(Boolean)
          .join(' · '),
      });
    }
    if (contract.expiry_date) {
      out.push({
        id: `contract_expiry:${contract.id}`,
        type: 'contract_expiry',
        title: contract.title,
        date: contract.expiry_date,
        severity: severityByProximity(contract.expiry_date, now, riskBase),
        href,
        meta: [contract.contract_number ?? undefined, counterparty]
          .filter(Boolean)
          .join(' · '),
      });
    }
  }
  return out;
}

export function signatureEvents(
  envelopes: LexSignatureEnvelope[],
  now: Date,
): LegalCalendarEvent[] {
  const out: LegalCalendarEvent[] = [];
  for (const envelope of envelopes) {
    const date = envelope.due_at ?? envelope.expires_at ?? null;
    if (!date) continue;
    out.push({
      id: `signature_deadline:${envelope.id}`,
      type: 'signature_deadline',
      title: envelope.title || envelope.subject || envelope.contract_title || 'Signature',
      date,
      severity: severityByProximity(date, now, 'medium'),
      href: `/lex/signatures/${envelope.id}`,
      meta: [
        envelope.contract_number ?? undefined,
        typeof envelope.recipient_count === 'number'
          ? `${envelope.signed_count ?? 0}/${envelope.recipient_count}`
          : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return out;
}

export function obligationEvents(obligations: LexObligation[]): LegalCalendarEvent[] {
  const out: LegalCalendarEvent[] = [];
  for (const obligation of obligations) {
    if (!obligation.due_date) continue;
    // Completed / waived / cancelled obligations carry no live deadline.
    const status = String(obligation.status);
    if (status === 'completed' || status === 'waived' || status === 'cancelled') {
      continue;
    }
    out.push({
      id: `obligation:${obligation.id}`,
      type: 'obligation',
      title: obligation.title,
      date: obligation.due_date,
      severity: mapPriority(obligation.priority as string),
      href: `/lex/obligations/${obligation.id}`,
      meta: [obligation.contract_title ?? undefined, obligation.matter_title ?? undefined]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return out;
}

export function settlementMilestoneEvents(
  matters: MatterTimelineSummary[],
  now: Date,
): LegalCalendarEvent[] {
  const out: LegalCalendarEvent[] = [];
  for (const matter of matters) {
    const date = matter.due_date ?? matter.estimated_completion_date ?? null;
    if (!date) continue;
    out.push({
      id: `settlement_milestone:${matter.matter_id}`,
      type: 'settlement_milestone',
      title: matter.title || matter.matter_number,
      date,
      severity: severityByProximity(date, now, 'low'),
      href: `/lex/settlements`,
      meta: matter.matter_number,
    });
  }
  return out;
}

export function serviceSlaEvents(clocks: SLAClockView[]): LegalCalendarEvent[] {
  const out: LegalCalendarEvent[] = [];
  for (const clock of clocks) {
    const date = clock.turnaround_due_at;
    if (!date) continue;
    // Resolved SLA clocks are historical, not actionable.
    if (clock.resolved_at) continue;
    const severity: LegalEventSeverity = clock.breached
      ? 'critical'
      : clock.breach_imminent || clock.escalation_imminent
        ? 'high'
        : clock.ack_risk
          ? 'medium'
          : 'low';
    out.push({
      id: `service_sla:${clock.id}`,
      type: 'service_sla',
      title: clock.service_code,
      date,
      severity,
      href: `/lex/service-desk`,
      meta: clock.priority ? String(clock.priority) : undefined,
    });
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * Fetchers — thin wrappers returning already-normalized events. Each is its
 * own react-query query so failures isolate per source.
 * ------------------------------------------------------------------------- */

export async function fetchHearingEvents(locale: AppLocale): Promise<LegalCalendarEvent[]> {
  // `expand=hearings` hydrates each row's full `hearings[]` docket; rows also
  // carry the `next_hearing_date` aggregate (dto.LegalCaseListItem) used as a
  // fallback when the relation is absent.
  const res = await casesApi.listCases(CASE_LIST_PARAMS);
  return hearingEvents(res.data as LegalCaseListRow[], locale);
}

export async function fetchContractEvents(now: Date): Promise<LegalCalendarEvent[]> {
  const res = await enterpriseApi.lex.listContracts(LIST_PARAMS);
  return contractEvents(res.data, now);
}

export async function fetchSignatureEvents(now: Date): Promise<LegalCalendarEvent[]> {
  const res = await enterpriseApi.lex.listSignatures(LIST_PARAMS);
  return signatureEvents(res.data, now);
}

export async function fetchObligationEvents(): Promise<LegalCalendarEvent[]> {
  const res = await enterpriseApi.lex.listObligations(LIST_PARAMS);
  return obligationEvents(res.data);
}

export async function fetchSettlementMilestoneEvents(now: Date): Promise<LegalCalendarEvent[]> {
  // `listMatterTimelines` narrows `sort` to a literal union, so pass an inline
  // literal (no `sort: string`) rather than the shared `FetchParams` constant.
  const res = await settlementsApi.listMatterTimelines({
    page: LIST_PARAMS.page,
    per_page: LIST_PARAMS.per_page,
  });
  return settlementMilestoneEvents(res.data, now);
}

export async function fetchServiceSlaEvents(): Promise<LegalCalendarEvent[]> {
  const res = await lexRequestsApi.listSlaClocks(LIST_PARAMS);
  return serviceSlaEvents(res.data);
}
