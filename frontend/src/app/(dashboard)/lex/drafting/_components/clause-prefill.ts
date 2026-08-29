'use client';

/**
 * Closed-loop "Save to Clause Library" cross-launch contract.
 *
 * The AI drafting surface hands a generated draft to the clause-library create
 * dialog without coupling the two route trees: drafting writes a small JSON
 * payload to `sessionStorage` under {@link CLAUSE_PREFILL_KEY} and navigates to
 * `/lex/clause-library`, which reads (and clears) the key on mount to open a
 * pre-filled {@link ClauseFormDialog}.
 *
 * Both modules are owned by the same agent, so the shape lives here (the
 * writer) and is imported by the reader; keep it minimal and serialisable.
 */
export const CLAUSE_PREFILL_KEY = 'lex.clause-library.prefill';

export const CLAUSE_LIBRARY_PATH = '/lex/clause-library';

/**
 * Fields the create dialog can pre-populate. Everything is optional so any
 * drafting op can contribute whatever it produced (a clause body, a title, a
 * suggested clause type, the AR side, or a free-form risk hint).
 */
export interface ClausePrefill {
  title_en?: string;
  title_ar?: string;
  text_en?: string;
  text_ar?: string;
  clause_type?: string;
  /** Free-form risk posture / level surfaced by the drafting op, if any. */
  risk_level?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Persists a draft for the clause-library create dialog to pick up on mount. */
export function writeClausePrefill(prefill: ClausePrefill): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.setItem(CLAUSE_PREFILL_KEY, JSON.stringify(prefill));
  } catch {
    // Storage may be unavailable (private mode / quota); cross-launch simply
    // degrades to an empty create dialog, which is acceptable.
  }
}

/**
 * Reads and clears any pending clause prefill. Returns `null` when nothing is
 * queued or the payload is malformed.
 */
export function consumeClausePrefill(): ClausePrefill | null {
  if (typeof window === 'undefined') {
    return null;
  }
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(CLAUSE_PREFILL_KEY);
    if (raw !== null) {
      window.sessionStorage.removeItem(CLAUSE_PREFILL_KEY);
    }
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const prefill: ClausePrefill = {};
    for (const key of ['title_en', 'title_ar', 'text_en', 'text_ar', 'clause_type', 'risk_level'] as const) {
      const value = parsed[key];
      if (typeof value === 'string') {
        prefill[key] = value;
      }
    }
    return prefill;
  } catch {
    return null;
  }
}
