/**
 * ENTITY-360 (feature #23) — counterparty/organization aggregation layer.
 *
 * The legal suite has no dedicated "counterparty master" endpoint; instead every
 * external organization a client deals with is named inline across three
 * domains:
 *   - Contracts   → `party_b_name`        (the counterparty on the agreement)
 *   - Settlements → `counterparty_name`   (the طرف مقابل in reconciliation/ADR)
 *   - Cases       → opposing `parties[]`  (plaintiff / defendant the client faces)
 *
 * ENTITY-360 stitches those inline names into a single 360° footprint per
 * organization, entirely CLIENT-SIDE from already-paginated list data (no new
 * endpoints). Names are matched on a normalized key (case/space/diacritic/legal-
 * suffix folded) so "Acme Co.", "ACME co", and "Acme Company" collapse together,
 * while the human-facing display name keeps the most complete spelling seen.
 *
 * For each organization we roll up:
 *   - contracts (count + total SAR value + active count)
 *   - cases (count + open count + as-plaintiff / as-defendant split)
 *   - settlements (count + total SAR exposure + realised settled value)
 *   - recovery % = settled (executed) value ÷ total settlement value
 *   - last activity (max updated_at across all linked records)
 *
 * The aggregation is pure + deterministic (no Date.now / Math.random at module
 * or build scope) so it is SSR-safe and unit-testable. `useEntities()` is the
 * thin React-Query hook the pages consume; `aggregateEntities()` is the pure
 * core it wraps.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { enterpriseApi } from '@/lib/enterprise';
import type { LexContractRecord } from '@/types/suites';
import { settlementsApi, type Settlement } from '@/lib/lex/settlements';
import {
  casesApi,
  type CaseCompanyStatus,
  type CaseStatus,
  type LegalCase,
} from '@/lib/lex/cases';

/* ------------------------------------------------------------------------- *
 * Normalization
 * ------------------------------------------------------------------------- */

/** Legal-form suffixes folded away when matching org names (EN + KSA AR forms). */
const LEGAL_SUFFIXES = [
  'company',
  'co',
  'corporation',
  'corp',
  'incorporated',
  'inc',
  'limited',
  'ltd',
  'llc',
  'plc',
  'group',
  'holding',
  'holdings',
  'est',
  'establishment',
  'trading',
  'شركة',
  'مؤسسة',
  'القابضة',
  'المحدودة',
  'محدودة',
  'للتجارة',
  'المساهمة',
];

const SUFFIX_PATTERN = new RegExp(
  `\\b(${LEGAL_SUFFIXES.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

/** Strip Arabic diacritics + tatweel so spelling variants collapse. */
const AR_DIACRITICS = /[ؗ-ًؚ-ْٰـ]/g;

/**
 * normalizeOrgName folds a display name to a stable matching key:
 * lower-cased, diacritic-stripped, legal-suffix-removed, punctuation-collapsed.
 * Empty / unnamed inputs return '' (which the aggregator skips).
 */
export function normalizeOrgName(raw: string | null | undefined): string {
  if (!raw) return '';
  const folded = raw
    .normalize('NFKD')
    .replace(AR_DIACRITICS, '')
    .replace(/[‌-‏]/g, '')
    .toLowerCase()
    .replace(/[.,،_/\\|"'`’‘()-]+/g, ' ')
    .replace(SUFFIX_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return folded;
}

/**
 * Stable, URL-safe id for an organization, derived from its normalized key so
 * the same org always resolves to the same `entities/[id]` route. Uses
 * percent-encoding of the normalized key (no base64 — keeps it human-debuggable
 * and avoids `+`/`/` URL hazards).
 */
export function entityIdFromKey(key: string): string {
  return encodeURIComponent(key);
}

export function keyFromEntityId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/* ------------------------------------------------------------------------- *
 * Linked-record shapes (domain-agnostic view rows the UI renders)
 * ------------------------------------------------------------------------- */

export type EntityRecordKind = 'contract' | 'case' | 'settlement';

export interface EntityContractLink {
  kind: 'contract';
  id: string;
  title: string;
  reference?: string | null;
  status: string;
  value?: number | null;
  currency?: string | null;
  updatedAt: string;
  href: string;
}

export interface EntityCaseLink {
  kind: 'case';
  id: string;
  title: string;
  reference?: string | null;
  status: CaseStatus;
  /** Whether the client is plaintiff or defendant in this matter. */
  companyStatus: CaseCompanyStatus;
  /** The opposing party's role label source (plaintiff/defendant/…). */
  partyRole?: string | null;
  updatedAt: string;
  href: string;
}

export interface EntitySettlementLink {
  kind: 'settlement';
  id: string;
  title: string;
  reference?: string | null;
  status: string;
  value?: number | null;
  currency?: string | null;
  updatedAt: string;
  href: string;
}

export type EntityLink = EntityContractLink | EntityCaseLink | EntitySettlementLink;

/* ------------------------------------------------------------------------- *
 * Aggregate entity
 * ------------------------------------------------------------------------- */

export interface EntityFootprint {
  /** Stable matching key (normalized). */
  key: string;
  /** URL-safe id (== entityIdFromKey(key)). */
  id: string;
  /** Best human-facing display name observed across all sources. */
  name: string;
  /** ISO timestamp of the most recent linked-record update (or undefined). */
  lastActivityAt?: string;

  contracts: EntityContractLink[];
  cases: EntityCaseLink[];
  settlements: EntitySettlementLink[];

  // Rollups (all SAR-denominated; values without currency assumed SAR).
  contractCount: number;
  activeContractCount: number;
  contractValue: number;

  caseCount: number;
  openCaseCount: number;
  asPlaintiffCount: number;
  asDefendantCount: number;

  settlementCount: number;
  /** Total value across all settlements (= SAR exposure). */
  settlementValue: number;
  /** Realised settled value (executed settlements only). */
  settledValue: number;
  /** settledValue / settlementValue, 0..1; 0 when no settlement value. */
  recoveryRate: number;

  /** contractValue + settlementValue — the org's total SAR footprint. */
  totalExposure: number;
  /** contracts + cases + settlements — total linked records. */
  totalRecords: number;
}

/* Statuses considered "active" / "open" for the rollup counters. */
const ACTIVE_CONTRACT_STATUSES = new Set([
  'active',
  'pending_signature',
  'negotiation',
  'legal_review',
  'internal_review',
]);

export function isActiveEntityContractStatus(status: string): boolean {
  return ACTIVE_CONTRACT_STATUSES.has(status);
}
const CLOSED_CASE_STATUSES = new Set<CaseStatus>(['closed', 'cancelled']);

/** Treat a missing/odd value as 0; never NaN. */
function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Pick the "richer" display name (longer, more complete spelling wins). */
function preferName(current: string | undefined, candidate: string): string {
  const c = candidate.trim();
  if (!current) return c;
  return c.length > current.length ? c : current;
}

function maxIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/* ------------------------------------------------------------------------- *
 * Source inputs
 * ------------------------------------------------------------------------- */

export interface AggregateInput {
  contracts: LexContractRecord[];
  settlements: Settlement[];
  cases: LegalCase[];
  /** Active locale, so case titles (LocalizedText) resolve to a string. */
  locale: AppLocale;
}

interface MutableEntity extends EntityFootprint {}

function emptyEntity(key: string, name: string): MutableEntity {
  return {
    key,
    id: entityIdFromKey(key),
    name,
    lastActivityAt: undefined,
    contracts: [],
    cases: [],
    settlements: [],
    contractCount: 0,
    activeContractCount: 0,
    contractValue: 0,
    caseCount: 0,
    openCaseCount: 0,
    asPlaintiffCount: 0,
    asDefendantCount: 0,
    settlementCount: 0,
    settlementValue: 0,
    settledValue: 0,
    recoveryRate: 0,
    totalExposure: 0,
    totalRecords: 0,
  };
}

/**
 * aggregateEntities — the pure core. Groups all three sources by normalized org
 * name and computes the rollups. Records with no resolvable counterparty name
 * are skipped (they can't belong to an organization). Deterministic ordering:
 * by total exposure desc, then record count desc, then name asc.
 */
export function aggregateEntities(input: AggregateInput): EntityFootprint[] {
  const { contracts, settlements, cases, locale } = input;
  const byKey = new Map<string, MutableEntity>();

  const ensure = (rawName: string): MutableEntity | null => {
    const key = normalizeOrgName(rawName);
    if (!key) return null;
    let entity = byKey.get(key);
    if (!entity) {
      entity = emptyEntity(key, rawName.trim());
      byKey.set(key, entity);
    } else {
      entity.name = preferName(entity.name, rawName);
    }
    return entity;
  };

  // Contracts → party_b_name is the counterparty.
  for (const c of contracts) {
    const entity = ensure(c.party_b_name);
    if (!entity) continue;
    const value = num(c.total_value);
    entity.contracts.push({
      kind: 'contract',
      id: c.id,
      title: c.title,
      reference: c.contract_number,
      status: c.status,
      value: c.total_value ?? null,
      currency: c.currency ?? 'SAR',
      updatedAt: c.updated_at,
      href: `/lex/contracts/${c.id}`,
    });
    entity.contractCount += 1;
    entity.contractValue += value;
    if (isActiveEntityContractStatus(c.status)) entity.activeContractCount += 1;
    entity.lastActivityAt = maxIso(entity.lastActivityAt, c.updated_at);
  }

  // Settlements → counterparty_name.
  for (const s of settlements) {
    const entity = ensure(s.counterparty_name ?? '');
    if (!entity) continue;
    const value = num(s.value);
    entity.settlements.push({
      kind: 'settlement',
      id: s.id,
      title: s.title,
      reference: s.reference,
      status: s.status,
      value: s.value ?? null,
      currency: s.currency ?? 'SAR',
      updatedAt: s.updated_at,
      href: `/lex/settlements/${s.id}`,
    });
    entity.settlementCount += 1;
    entity.settlementValue += value;
    if (s.status === 'executed') entity.settledValue += value;
    entity.lastActivityAt = maxIso(entity.lastActivityAt, s.updated_at);
  }

  // Cases → opposing parties. With `expand=parties` the list rows carry their
  // hydrated `parties[]`, so we attribute each case to its opposing-side party
  // name(s). A case with no opposing party named can't be tied to an org and is
  // skipped (graceful).
  for (const k of cases) {
    const opposingRole: CaseCompanyStatus =
      k.company_status === 'plaintiff' ? 'defendant' : 'plaintiff';
    const opposing = (k.parties ?? []).filter(
      (p) => p.role === opposingRole && p.name?.trim(),
    );
    if (opposing.length === 0) continue;
    const title = resolveLocalized(k.title, locale) || k.case_number;
    for (const party of opposing) {
      const entity = ensure(party.name);
      if (!entity) continue;
      entity.cases.push({
        kind: 'case',
        id: k.id,
        title,
        reference: k.case_number,
        status: k.status,
        companyStatus: k.company_status,
        partyRole: party.role,
        updatedAt: k.updated_at,
        href: `/lex/cases/${k.id}`,
      });
      entity.caseCount += 1;
      if (!CLOSED_CASE_STATUSES.has(k.status)) entity.openCaseCount += 1;
      if (k.company_status === 'plaintiff') entity.asPlaintiffCount += 1;
      else entity.asDefendantCount += 1;
      entity.lastActivityAt = maxIso(entity.lastActivityAt, k.updated_at);
    }
  }

  // Finalize derived rollups.
  const list = [...byKey.values()];
  for (const e of list) {
    e.recoveryRate = e.settlementValue > 0 ? e.settledValue / e.settlementValue : 0;
    e.totalExposure = e.contractValue + e.settlementValue;
    e.totalRecords = e.contractCount + e.caseCount + e.settlementCount;
    // Sort each link list newest-first for stable, readable detail tabs.
    e.contracts.sort(byUpdatedDesc);
    e.cases.sort(byUpdatedDesc);
    e.settlements.sort(byUpdatedDesc);
  }

  list.sort((a, b) => {
    if (b.totalExposure !== a.totalExposure) return b.totalExposure - a.totalExposure;
    if (b.totalRecords !== a.totalRecords) return b.totalRecords - a.totalRecords;
    return a.name.localeCompare(b.name);
  });

  return list;
}

function byUpdatedDesc(a: { updatedAt: string }, b: { updatedAt: string }): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/* ------------------------------------------------------------------------- *
 * Portfolio-level rollup (for the list page's KPI strip)
 * ------------------------------------------------------------------------- */

export interface EntityPortfolioSummary {
  organizationCount: number;
  totalExposure: number;
  contractValue: number;
  settlementExposure: number;
  settledValue: number;
  recoveryRate: number;
  openCaseCount: number;
  activeContractCount: number;
}

export function summarizeEntities(entities: EntityFootprint[]): EntityPortfolioSummary {
  let contractValue = 0;
  let settlementExposure = 0;
  let settledValue = 0;
  let openCaseCount = 0;
  let activeContractCount = 0;
  for (const e of entities) {
    contractValue += e.contractValue;
    settlementExposure += e.settlementValue;
    settledValue += e.settledValue;
    openCaseCount += e.openCaseCount;
    activeContractCount += e.activeContractCount;
  }
  return {
    organizationCount: entities.length,
    totalExposure: contractValue + settlementExposure,
    contractValue,
    settlementExposure,
    settledValue,
    recoveryRate: settlementExposure > 0 ? settledValue / settlementExposure : 0,
    openCaseCount,
    activeContractCount,
  };
}

/* ------------------------------------------------------------------------- *
 * Data hook
 * ------------------------------------------------------------------------- */

/**
 * Page size for each source fetch. Entity-360 aggregates the loaded register
 * client-side, so we pull a generous first page from each domain (the legal-
 * affairs demo tenant is well within this) rather than invent a server rollup.
 */
const SOURCE_PAGE_SIZE = 200;

const LIST_PARAMS = {
  page: 1,
  per_page: SOURCE_PAGE_SIZE,
  sort: 'updated_at',
  order: 'desc' as const,
};

/**
 * The cases pull opts into the backend's `expand=parties` hydration so each list
 * row carries its `parties[]` (with `role` + `name`). Opposing-party attribution
 * (plaintiff/defendant ⇒ the org the client faces) is then computable directly
 * from list data — no per-case `Get(id)` fetch, no N+1. The `expand` param rides
 * through `filters`, which `buildSuiteQueryParams` flattens into the query string
 * (comma-separated, opt-in); without it the response is byte-for-byte unchanged.
 */
const CASE_LIST_PARAMS = {
  ...LIST_PARAMS,
  filters: { expand: 'parties' },
};

export interface UseEntitiesResult {
  entities: EntityFootprint[];
  summary: EntityPortfolioSummary;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * useEntities fetches contracts, settlements and cases in parallel and returns
 * the aggregated org footprints + portfolio summary. The three queries share a
 * stable cache key so the list and detail pages reuse the same fetch.
 */
export function useEntities(locale: AppLocale): UseEntitiesResult {
  const contractsQuery = useQuery({
    queryKey: ['lex-entities', 'contracts'],
    queryFn: () => enterpriseApi.lex.listContracts(LIST_PARAMS),
  });
  const settlementsQuery = useQuery({
    queryKey: ['lex-entities', 'settlements'],
    queryFn: () => settlementsApi.list(LIST_PARAMS),
  });
  const casesQuery = useQuery({
    queryKey: ['lex-entities', 'cases'],
    queryFn: () => casesApi.listCases(CASE_LIST_PARAMS),
  });

  const entities = useMemo(
    () =>
      aggregateEntities({
        contracts: contractsQuery.data?.data ?? [],
        settlements: settlementsQuery.data?.data ?? [],
        cases: casesQuery.data?.data ?? [],
        locale,
      }),
    [contractsQuery.data, settlementsQuery.data, casesQuery.data, locale],
  );

  const summary = useMemo(() => summarizeEntities(entities), [entities]);

  return {
    entities,
    summary,
    isLoading:
      contractsQuery.isLoading || settlementsQuery.isLoading || casesQuery.isLoading,
    isError: contractsQuery.isError || settlementsQuery.isError || casesQuery.isError,
    error: contractsQuery.error ?? settlementsQuery.error ?? casesQuery.error,
    refetch: () => {
      void contractsQuery.refetch();
      void settlementsQuery.refetch();
      void casesQuery.refetch();
    },
  };
}

/** Helper used by the detail page: find one org by its route id. */
export function selectEntityById(
  entities: EntityFootprint[],
  id: string,
): EntityFootprint | undefined {
  const key = keyFromEntityId(id);
  return entities.find((e) => e.key === key);
}
