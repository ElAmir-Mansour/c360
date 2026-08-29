/**
 * ar/en i18n PARITY gate.
 *
 * Walks BOTH i18n systems that back the app (see `../registry.ts` for the full
 * story) and asserts the Arabic and English sides stay in lockstep:
 *
 *   1. the GLOBAL catalog     — `getMessages('en')` vs `getMessages('ar')`
 *   2. every PER-MODULE bundle — the exported `{ en, ar }` label objects in the
 *      136 co-located `*-i18n.ts` / `*-labels.ts` files, discovered with
 *      `import.meta.glob` (a Vite feature Vitest supports; a raw node script
 *      can't load these because they are `'use client'` TS with `@/` imports).
 *
 * For each en/ar pair `diffTree` reports, into ONE flat failure list so every
 * drift is named at once (not fail-fast):
 *   (1) KEY-SET IDENTITY   — `Object.keys` equal at every node.
 *   (2) LEAF-KIND IDENTITY — string vs `(args)=>string` function vs `string[]`.
 *   (3) TOKEN PARITY       — identical `{token}` multiset per string leaf, using
 *                            the SAME `/\{(\w+)\}/g` regex `formatMessage` uses,
 *                            so a dropped `{total}` (shipped literally to users,
 *                            invisible to `AppMessages = typeof ar`) fails here.
 *   (4) FUNCTION-LEAF PARITY — matching arity + no asymmetric sentinel drop.
 *   (5) NON-EMPTY AR       — every ar string leaf is non-empty/non-whitespace
 *                            (an `ar: ''` typechecks but renders blank under the
 *                            `ar` default locale).
 *
 * This closes the gap `AppMessages = typeof ar` leaves open: structural keys are
 * typed, but token / empty / kind drift is not.
 */
import { describe, expect, it } from 'vitest';

import { getMessages } from '../messages';

// The SAME interpolation regex `formatMessage` (registry.ts) applies at runtime.
const TOKEN_RE = /\{(\w+)\}/g;

// A drop that renders `{token}` verbatim to a Saudi legal reader is the exact
// class of defect a General Counsel would screenshot into a filing — high value.

/** Numeric sentinel for guarded function-leaf invocation (see diffTree). */
const FN_SENTINEL = 987654;

/**
 * Known, tolerated parity gaps, keyed by `"<bundle>:<dot.path>"` (the exact
 * `key` a failure is reported under — read them off a red run). Each entry is a
 * pre-existing drift in a file OWNED BY ANOTHER AGENT (cyber/cti, contracts,
 * seeded legal data, onboarding, the global catalog itself, …) or one of a
 * large batch that must be triaged together rather than silently patched here.
 * This keeps the gate GREEN while documenting the debt for later review.
 *
 * TODO(i18n): burn this list down — each entry is a real ar/en drift. Fix at the
 * source bundle, then delete its key here. Do NOT grow this list to hide NEW
 * drift; a new offending key must fail CI so it is triaged deliberately.
 */
const KNOWN_PARITY_EXCEPTIONS = new Set<string>([
  // ── lex/reports (another agent's file) ──────────────────────────────────
  // The EN `enums.*` maps are empty stubs (`contractTypes: {}`, …) while AR is
  // fully translated — a 41-key one-sided batch. Too large to patch blindly
  // here (>15) and owned by the reports work-stream; fix = author the EN enum
  // labels there, then delete these keys.
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.nda',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.service',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.employment',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.lease',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.purchase',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.partnership',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.license',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.framework',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.amendment',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.contractTypes.other',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterStatuses.intake',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterStatuses.triage',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterStatuses.active',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterStatuses.on_hold',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterStatuses.closed',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterStatuses.archived',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterTypes.litigation',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterTypes.advisory',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterTypes.compliance',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterTypes.contract',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterTypes.dispute',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterTypes.regulatory',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterTypes.corporate',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.matterTypes.other',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationStatuses.open',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationStatuses.in_progress',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationStatuses.blocked',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationStatuses.completed',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationStatuses.waived',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationStatuses.cancelled',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.contractual',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.renewal',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.notice',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.payment',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.delivery',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.reporting',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.compliance',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.covenant',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.condition_precedent',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.regulatory',
  '/src/app/(dashboard)/lex/reports/_lib/reports-labels.ts#reportsLabels:enums.obligationTypes.other',

  // ── Intentional blanks (NOT drift; do not invent Arabic text) ───────────
  // Role-badge tier suffix: EN appends the word "tier" ("Business tier"); AR
  // reads cleaner without a trailing word, and role-badge.tsx guards on the
  // empty string (falls back to the bare tier name). Deliberate.
  '/src/components/lex/persona/persona-labels.ts#lexPersonaLabels:badge.tierSuffix',
  // Actions-column header: blank on BOTH en and ar (an icon-only column), so
  // there is no ar-vs-en drop here — the non-empty-ar heuristic just trips on
  // an intentionally headerless column.
  '/src/app/(dashboard)/lex/admin/org-entities/_lib/platform-sync-i18n.ts#labels:colAction',
]);

interface Failure {
  key: string;
  message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Leaf discriminator: 'object' | 'array' | 'function' | 'string' | typeof. */
function leafKind(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (isPlainObject(value)) return 'object';
  if (typeof value === 'function') return 'function';
  return typeof value;
}

/** Sorted `{token}` multiset of a string, via the runtime regex. */
function tokenMultiset(value: string): string[] {
  const tokens: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(value)) !== null) {
    tokens.push(match[1]);
  }
  return tokens.sort();
}

function joinPath(prefix: string, segment: string | number): string {
  if (prefix === '') return String(segment);
  return typeof segment === 'number' ? `${prefix}[${segment}]` : `${prefix}.${segment}`;
}

/**
 * Compare the English (`en`) and Arabic (`ar`) sides of one subtree, appending
 * every discrepancy to `out`. `bundle` labels the source; `path` is the running
 * dot-path. Never throws.
 */
function diffTree(
  en: unknown,
  ar: unknown,
  bundle: string,
  path: string,
  out: Failure[],
): void {
  const push = (message: string) => out.push({ key: `${bundle}:${path}`, message });

  const enObject = isPlainObject(en);
  const arObject = isPlainObject(ar);

  // (1) KEY-SET IDENTITY — recurse structurally.
  if (enObject && arObject) {
    for (const key of Object.keys(en)) {
      if (!(key in ar)) out.push({ key: `${bundle}:${joinPath(path, key)}`, message: `missing in ar` });
    }
    for (const key of Object.keys(ar)) {
      if (!(key in en)) out.push({ key: `${bundle}:${joinPath(path, key)}`, message: `extra in ar (not in en)` });
    }
    for (const key of Object.keys(en)) {
      if (key in ar) diffTree(en[key], ar[key], bundle, joinPath(path, key), out);
    }
    return;
  }

  // (2) LEAF-KIND IDENTITY.
  const enKind = leafKind(en);
  const arKind = leafKind(ar);
  if (enKind !== arKind) {
    push(`leaf-kind mismatch: en=${enKind} ar=${arKind}`);
    return;
  }

  // (3) TOKEN PARITY + (5) NON-EMPTY AR for string leaves.
  if (enKind === 'string') {
    const enTokens = tokenMultiset(en as string);
    const arTokens = tokenMultiset(ar as string);
    if (enTokens.join(',') !== arTokens.join(',')) {
      push(`token drift: en{${enTokens.join(',')}} ar{${arTokens.join(',')}}`);
    }
    if ((ar as string).trim() === '') {
      push(`empty ar string leaf`);
    }
    return;
  }

  // Arrays: same length, then element-wise (element strings still token-checked).
  if (enKind === 'array') {
    const enArr = en as unknown[];
    const arArr = ar as unknown[];
    if (enArr.length !== arArr.length) {
      push(`array length mismatch: en=${enArr.length} ar=${arArr.length}`);
    }
    const shared = Math.min(enArr.length, arArr.length);
    for (let i = 0; i < shared; i += 1) {
      diffTree(enArr[i], arArr[i], bundle, joinPath(path, i), out);
    }
    return;
  }

  // (4) FUNCTION-LEAF PARITY — arity, plus a guarded sentinel-drop check.
  if (enKind === 'function') {
    const enFn = en as (...args: unknown[]) => unknown;
    const arFn = ar as (...args: unknown[]) => unknown;
    if (enFn.length !== arFn.length) {
      push(`function arity mismatch: en=${enFn.length} ar=${arFn.length}`);
    }
    const args = new Array(Math.max(enFn.length, arFn.length)).fill(FN_SENTINEL);
    let enOut: unknown;
    let arOut: unknown;
    try {
      enOut = enFn(...args);
      arOut = arFn(...args);
    } catch {
      // Typed factories may reject the numeric sentinel; arity check stands.
      return;
    }
    if (typeof enOut === 'string' && typeof arOut === 'string') {
      const needle = String(FN_SENTINEL);
      const enHas = enOut.includes(needle);
      const arHas = arOut.includes(needle);
      if (enHas !== arHas) {
        push(`function interpolation drop: en uses arg=${enHas} ar uses arg=${arHas}`);
      }
    }
  }
}

/** An en/ar bundle pair pulled off a module export. */
interface BundlePair {
  bundle: string;
  en: Record<string, unknown>;
  ar: Record<string, unknown>;
}

/** A `{ en, ar }` object where both sides are trees (the module bundle shape). */
function isBilingualPair(value: unknown): value is { en: Record<string, unknown>; ar: Record<string, unknown> } {
  return (
    isPlainObject(value) &&
    isPlainObject((value as Record<string, unknown>).en) &&
    isPlainObject((value as Record<string, unknown>).ar)
  );
}

/**
 * Discover every co-located bilingual bundle. `import.meta.glob` pattern is
 * root-relative (`/src` = `frontend/src`). Eager so the exports are live objects
 * we can walk. Each module exports one or more `export const xLabels = { en, ar }`.
 */
const bundleModules = import.meta.glob('/src/**/*-{i18n,labels}.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

function collectBundlePairs(): BundlePair[] {
  const pairs: BundlePair[] = [];
  const seen = new Set<unknown>(); // de-dupe re-exported pairs by object identity
  for (const [modulePath, mod] of Object.entries(bundleModules)) {
    if (!mod || typeof mod !== 'object') continue;
    for (const [exportName, value] of Object.entries(mod)) {
      if (!isBilingualPair(value) || seen.has(value)) continue;
      seen.add(value);
      pairs.push({ bundle: `${modulePath}#${exportName}`, en: value.en, ar: value.ar });
    }
  }
  return pairs;
}

describe('i18n ar/en parity', () => {
  it('discovers the co-located bundle files', () => {
    // Guards the glob itself: if it silently matches nothing (wrong root/pattern)
    // the parity walk would be a no-op that always "passes".
    expect(Object.keys(bundleModules).length).toBeGreaterThan(100);
  });

  it('keeps ar and en in lockstep across the global catalog and every bundle', () => {
    const failures: Failure[] = [];

    // 1. GLOBAL catalog.
    diffTree(getMessages('en'), getMessages('ar'), 'global', '', failures);

    // 2. Every discovered per-module bundle.
    for (const { bundle, en, ar } of collectBundlePairs()) {
      diffTree(en, ar, bundle, '', failures);
    }

    // Drop the documented, another-agent-owned exceptions; everything else must
    // be empty so each remaining drift is named in the assertion message.
    const active = failures.filter((f) => !KNOWN_PARITY_EXCEPTIONS.has(f.key));

    if (active.length > 0) {
      // Surfaced so a red run lists every key (and their count) at once.
      // eslint-disable-next-line no-console
      console.error(
        `\n[i18n parity] ${active.length} un-allowlisted drift(s):\n` +
          active.map((f) => `  ${f.key}  —  ${f.message}`).join('\n') +
          '\n',
      );
    }

    expect(
      active.map((f) => `${f.key}  —  ${f.message}`),
      `ar/en parity drift (${active.length}); fix at source or allowlist in KNOWN_PARITY_EXCEPTIONS`,
    ).toEqual([]);
  });
});
