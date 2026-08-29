'use client';

// SCENARIO BUILDER store (Wave C #6) — a small client-side CRUD hook over
// localStorage for NAMED pricing scenarios. A scenario is an EPHEMERAL what-if
// snapshot a rep captures off the live calculator: the PricingInputState, the
// selected tier, and the computed MASKED ClientTier rows. Scenarios are NOT
// backend quotes — they never hit the server, they exist only to compare
// what-if configurations side-by-side, and they survive a refresh via
// localStorage keyed per-user.
//
// MARGIN DISCIPLINE: a scenario stores ONLY the masked ClientTier fields
// (SavedTier below is a structural subset of ClientTier — no `internal` block,
// no internal_cost / gross_profit / realized_margin / guardrail). Even an admin
// capturing a scenario off an admin compute persists a client-safe snapshot, so
// the compare surface is a client-safe comparison tool by construction. The
// snapshot builder in this module deliberately picks fields one by one; it never
// spreads a PricingTierRow (which could carry `internal`).

import { useCallback, useEffect, useState } from 'react';
import type {
  ClientTier,
  Deployment,
  LineItems,
  PricingModel,
  PricingTier,
  PricingTierRow,
} from './types';
import type { PricingInputState } from '../_components/pricing-inputs';

/** localStorage namespace. The active user id is appended so scenarios are
 *  scoped per-user on a shared browser. */
const STORAGE_PREFIX = 'clario360.pricing.scenarios';
const STORAGE_VERSION = 1;

/** Hard cap on the number of scenarios compared at once (columns). */
export const MAX_COMPARE = 4;
/** Hard cap on the number of scenarios kept (keeps localStorage bounded). */
export const MAX_SCENARIOS = 24;

/**
 * A MASKED tier snapshot — a STRUCTURAL SUBSET of ClientTier. There is
 * deliberately NO `internal` field: a scenario can never carry margin. Declared
 * as `Pick<ClientTier, …>` so it stays in lockstep with the client model and the
 * compiler rejects any attempt to add an internal figure here.
 */
export type SavedTier = Pick<
  ClientTier,
  | 'tier'
  | 'line_items'
  | 'sub_total'
  | 'volume_discount'
  | 'term_discount'
  | 'sales_discount'
  | 'net_sub_total'
  | 'vat'
  | 'total_monthly'
  | 'contract_value'
>;

/** A named, persisted what-if scenario (all masked, no margin). */
export interface PricingScenario {
  /** Stable client-generated id. */
  id: string;
  /** Rep-supplied display name, e.g. "SaaS 12mo per-user". */
  name: string;
  /** Epoch millis the scenario was captured / last renamed. */
  savedAt: number;
  /** The calculator inputs at capture time (restored verbatim on load). */
  inputs: PricingInputState;
  /** The tier the rep was leading with. */
  selectedTier: PricingTier;
  /** The pricing model (mirrors inputs.model; kept explicit for the compare table). */
  model: PricingModel;
  /** Currency of the captured figures (SAR). */
  currency: string;
  /** The active pricing_config version the snapshot was computed against. */
  pricingVersion: number;
  /** The MASKED per-tier rows — client-safe subset, never any margin. */
  tiers: SavedTier[];
}

/** The persisted envelope (versioned so a future shape change can migrate). */
interface StoredEnvelope {
  version: number;
  scenarios: PricingScenario[];
}

/** Pull ONLY the masked ClientTier fields off a (possibly internal) row.
 *  Field-by-field by design: never spreads the row, so `internal` cannot ride
 *  along even if the source is an admin InternalTier. */
export function toSavedTier(row: PricingTierRow): SavedTier {
  const li: LineItems = {
    base_charge: row.line_items.base_charge,
    ai_allocation: row.line_items.ai_allocation,
    data_storage: row.line_items.data_storage,
    vm_infrastructure: row.line_items.vm_infrastructure,
    deployment_setup_premium: row.line_items.deployment_setup_premium,
  };
  return {
    tier: row.tier,
    line_items: li,
    sub_total: row.sub_total,
    volume_discount: row.volume_discount,
    term_discount: row.term_discount,
    sales_discount: row.sales_discount,
    net_sub_total: row.net_sub_total,
    vat: row.vat,
    total_monthly: row.total_monthly,
    contract_value: row.contract_value,
  };
}

export interface CaptureScenarioInput {
  name: string;
  inputs: PricingInputState;
  selectedTier: PricingTier;
  model: PricingModel;
  currency: string;
  pricingVersion: number;
  /** The live computed rows (masked or admin — masked out here regardless). */
  tiers: PricingTierRow[];
}

/** Build a client-safe scenario from the live calculator state. Exported so the
 *  save flow (and tests) can assert the snapshot is margin-free. */
export function buildScenario(input: CaptureScenarioInput): PricingScenario {
  return {
    id: makeId(),
    name: input.name.trim(),
    savedAt: Date.now(),
    inputs: { ...input.inputs },
    selectedTier: input.selectedTier,
    model: input.model,
    currency: input.currency,
    pricingVersion: input.pricingVersion,
    // MASK: map every row through toSavedTier so no internal block survives.
    tiers: input.tiers.map(toSavedTier),
  };
}

function makeId(): string {
  // crypto.randomUUID where available; a timestamp+rand fallback otherwise
  // (jsdom / older browsers).
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `scn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function storageKey(userId: string | null | undefined): string {
  return `${STORAGE_PREFIX}.${userId || 'anon'}`;
}

function readStore(key: string): PricingScenario[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredEnvelope | PricingScenario[];
    // Tolerate a bare array (pre-envelope) as well as the versioned envelope.
    const list = Array.isArray(parsed) ? parsed : parsed?.scenarios;
    return Array.isArray(list) ? list.filter(isScenario) : [];
  } catch {
    return [];
  }
}

function writeStore(key: string, scenarios: PricingScenario[]): void {
  if (typeof window === 'undefined') return;
  try {
    const envelope: StoredEnvelope = { version: STORAGE_VERSION, scenarios };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Quota / disabled storage — fail soft; scenarios stay in-memory this session.
  }
}

/** Narrow an unknown record to a PricingScenario defensively (bad localStorage). */
function isScenario(v: unknown): v is PricingScenario {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.selectedTier === 'string' &&
    Array.isArray(s.tiers) &&
    typeof s.inputs === 'object'
  );
}

export interface UsePricingScenarios {
  scenarios: PricingScenario[];
  /** Capture the current calculator config as a named scenario. Returns it. */
  save: (input: CaptureScenarioInput) => PricingScenario;
  /** Rename a scenario in place. */
  rename: (id: string, name: string) => void;
  /** Delete a scenario. */
  remove: (id: string) => void;
  /** Clear every scenario for this user. */
  clear: () => void;
  /** Whether the store is at the cap. */
  atCapacity: boolean;
}

/**
 * localStorage-backed scenario CRUD, scoped per-user. Hydrates on mount (so SSR
 * renders an empty list, then the client fills it), and mirrors every mutation
 * back to storage. No backend, no network.
 */
export function usePricingScenarios(userId: string | null | undefined): UsePricingScenarios {
  const key = storageKey(userId);
  const [scenarios, setScenarios] = useState<PricingScenario[]>([]);

  // Hydrate from storage once we know the key (client-only).
  useEffect(() => {
    setScenarios(readStore(key));
  }, [key]);

  const persist = useCallback(
    (next: PricingScenario[]) => {
      setScenarios(next);
      writeStore(key, next);
    },
    [key],
  );

  const save = useCallback(
    (input: CaptureScenarioInput): PricingScenario => {
      const scenario = buildScenario(input);
      // Newest first; keep at most MAX_SCENARIOS.
      const next = [scenario, ...scenarios].slice(0, MAX_SCENARIOS);
      persist(next);
      return scenario;
    },
    [scenarios, persist],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      persist(
        scenarios.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
      );
    },
    [scenarios, persist],
  );

  const remove = useCallback(
    (id: string) => {
      persist(scenarios.filter((s) => s.id !== id));
    },
    [scenarios, persist],
  );

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  return {
    scenarios,
    save,
    rename,
    remove,
    clear,
    atCapacity: scenarios.length >= MAX_SCENARIOS,
  };
}

/** Deployment code → i18n label key (shared by the scenario compare + client view). */
export const DEPLOYMENT_LABEL_KEY: Record<Deployment, MessageKeyLike> = {
  1: 'platformConsole.pricing.deploySaas',
  2: 'platformConsole.pricing.deployOnPrem',
  3: 'platformConsole.pricing.deployAirGapped',
};

// Local alias to avoid importing the heavy MessageKey union here; the consuming
// components pass these straight to t(), which accepts MessageKey. Kept as the
// literal string type so the values above are validated at their use sites.
type MessageKeyLike =
  | 'platformConsole.pricing.deploySaas'
  | 'platformConsole.pricing.deployOnPrem'
  | 'platformConsole.pricing.deployAirGapped';
