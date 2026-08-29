/**
 * TERMBASE LINTER — enforces the canonical Saudi-MSA glossary
 * (`frontend/scripts/i18n-glossary.json`) across every localized bundle.
 *
 * It walks the shell catalog (`getMessages('en')` / `getMessages('ar')`) plus
 * every additional bilingual `{ en, ar }` bundle discovered via
 * `import.meta.glob` (suite `*-i18n.ts` files and `*labels*` bundles — the same
 * discovery surface the i18n parity checks use). For each en/ar leaf pair it
 * runs three checks:
 *
 *   (a) GLOSSARY MAPPING — if the EN leaf word-boundary-matches a term's `en`
 *       (surface forms derived from the slash/parenthetical shapes in the
 *       glossary), the AR leaf MUST contain the term's `ar` (or one of its
 *       forms) and MUST NOT contain any of its `banned_ar` renderings.
 *   (b) GLOBAL BANNED — no AR leaf may contain any `global_banned_ar` string,
 *       regardless of the EN leaf.
 *   (c) ENGLISH-LEAK — an AR leaf that has Latin letters but NO Arabic letters
 *       fails, allow-listed against `product_names` + acronyms so brand names
 *       (Clario360, Najiz, …) and glossed acronyms (RTO, SIEM, …) pass.
 *
 * RATCHET: because existing bundles already carry off-glossary renderings, the
 * current stock of violations is frozen in a committed baseline
 * (`termbase-baseline.json`). The test only FAILS on NET-NEW violations; the
 * frozen stock is allowed to shrink but never grow. Re-snapshot after cleanups
 * (or to bootstrap the baseline) with:
 *
 *   UPDATE_TERMBASE_BASELINE=1 npx vitest run src/lib/i18n/__tests__/termbase.test.ts
 *
 * These two files (this test + the baseline) own the ratchet; the linted
 * bundles are never modified here.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { getMessages } from '@/lib/i18n/messages';
import glossaryRaw from '../../../../scripts/i18n-glossary.json';

// ---------------------------------------------------------------------------
// Glossary (single source of truth) — loaded via a plain JSON import.
// ---------------------------------------------------------------------------

interface GlossaryTerm {
  en: string;
  ar: string;
  banned_ar?: string[];
  domain?: string;
  note?: string;
}

interface Glossary {
  terms: GlossaryTerm[];
  global_banned_ar: string[];
  product_names: string[];
  acronymPolicy?: string;
}

const glossary = glossaryRaw as unknown as Glossary;

// ---------------------------------------------------------------------------
// Baseline plumbing.
// ---------------------------------------------------------------------------

// Resolve the baseline next to this test file. `import.meta.url` is not always a
// `file:` URL under Vitest, so fall back to a cwd-anchored path (the suite runs
// from the frontend package root).
function testDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.cwd(), 'src/lib/i18n/__tests__');
  }
}
const BASELINE_PATH = resolve(testDir(), 'termbase-baseline.json');
const UPDATE_BASELINE =
  process.env.UPDATE_TERMBASE_BASELINE === '1' ||
  process.env.UPDATE_TERMBASE_BASELINE === 'true';

interface BaselineFile {
  $comment?: string;
  generatedAt?: string;
  count?: number;
  violations?: Record<string, unknown>;
}

const baselineFile: BaselineFile | null = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile)
  : null;

// ---------------------------------------------------------------------------
// Character-class helpers.
// ---------------------------------------------------------------------------

// Arabic block + supplement + extended-A + presentation forms A/B.
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RE = /[A-Za-z]/;
// Strip interpolation placeholders before the English-leak analysis so that
// `{count}` / `${x}` / `%s` tokens are not mistaken for English words.
const PLACEHOLDER_RE = /\{[^}]*\}|%\{[^}]*\}|\$\{[^}]*\}|%[sd]/g;
const LATIN_TOKEN_RE = /[A-Za-z][A-Za-z0-9]*/g;
// Split points for deriving glossary surface forms: slash, en/em dash, pipe.
const FORM_SPLIT_RE = /[/\u2013\u2014|]/;

function hasArabic(value: string): boolean {
  return ARABIC_RE.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Derive matchable surface forms from a glossary `en` / `ar` string. The
 * glossary encodes alternates as `a / b`, and glosses/expansions inside
 * parentheses (e.g. `case (litigation case)`, `RTO — هدف زمن الاسترداد`). We
 * flatten those into individual forms so a compound entry still enforces.
 */
function surfaceForms(raw: string): string[] {
  const parenContents = [...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  const mainless = raw.replace(/\([^)]*\)/g, ' ');
  const chunks = [
    ...mainless.split(FORM_SPLIT_RE),
    ...parenContents.flatMap((p) => p.split(FORM_SPLIT_RE)),
  ];
  const forms = new Set<string>();
  for (const chunk of chunks) {
    const form = normalize(chunk);
    if (form.length >= 2) forms.add(form);
  }
  return [...forms];
}

// ---------------------------------------------------------------------------
// Compile the glossary into a fast lookup structure.
// ---------------------------------------------------------------------------

interface CompiledTerm {
  en: string;
  /** Word-boundary matchers over the EN surface forms (case-insensitive, no `g`). */
  enMatchers: RegExp[];
  /** AR surface forms — the leaf must contain at least one. */
  arForms: string[];
  /** Renderings the AR leaf must never contain. */
  banned: string[];
}

const compiledTerms: CompiledTerm[] = glossary.terms.map((term) => {
  const enForms = surfaceForms(term.en);
  const arForms = surfaceForms(term.ar).filter(hasArabic);
  return {
    en: term.en,
    enMatchers: enForms.map((form) => new RegExp(`\\b${escapeRegExp(form)}\\b`, 'i')),
    arForms,
    banned: (term.banned_ar ?? []).filter((b) => b.trim().length > 0),
  };
});

// Allow-list for the English-leak check: product names + acronyms.
const CURATED_ACRONYMS = [
  'RTO', 'RPO', 'RTA', 'WORM', 'SLA', 'MFA', 'SSO', 'SIEM', 'PDPL', 'VAT', 'CR',
  'NDA', 'MOU', 'POA', 'DOA', 'RBAC', 'RLS', 'SOD', 'BYOK', 'SAML', 'OIDC',
  'CSV', 'PDF', 'KPI', 'ADR', 'SAR', 'NCA', 'ZATCA', 'API', 'URL', 'ID', 'IP',
  'HR', 'SCIM', 'DR', 'CLM', '2FA', 'OTP', 'DEK', 'KEK', 'MTLS', 'TLS', 'SSL',
  'X', 'Y',
];

const allowSet = new Set<string>();
for (const name of glossary.product_names) allowSet.add(name.toLowerCase());
for (const acr of CURATED_ACRONYMS) allowSet.add(acr.toLowerCase());
// Auto-derive all-caps acronyms that appear anywhere in the glossary terms.
for (const term of glossary.terms) {
  for (const source of [term.en, term.ar]) {
    for (const m of source.matchAll(/\b[A-Z][A-Z0-9]{1,}\b/g)) {
      allowSet.add(m[0].toLowerCase());
    }
  }
}
// The acronym policy line names the verbatim acronyms explicitly.
if (glossary.acronymPolicy) {
  for (const m of glossary.acronymPolicy.matchAll(/\b[A-Z]{2,}\b/g)) {
    allowSet.add(m[0].toLowerCase());
  }
}

/** An AR leaf with Latin letters, no Arabic letters, and a non-allow-listed Latin token. */
function isEnglishLeak(value: string): boolean {
  if (hasArabic(value)) return false;
  const cleaned = value.replace(PLACEHOLDER_RE, ' ');
  if (!LATIN_RE.test(cleaned)) return false;
  if (allowSet.has(normalize(cleaned).toLowerCase())) return false;
  const tokens = cleaned.match(LATIN_TOKEN_RE);
  if (!tokens || tokens.length === 0) return false;
  return tokens.some((tok) => !allowSet.has(tok.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Bundle discovery + tree walking.
// ---------------------------------------------------------------------------

interface Bundle {
  id: string;
  en: Record<string, unknown>;
  ar: Record<string, unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBilingual(value: unknown): value is { en: unknown; ar: unknown } {
  if (!isPlainRecord(value)) return false;
  const en = (value as Record<string, unknown>).en;
  const ar = (value as Record<string, unknown>).ar;
  return isPlainRecord(en) && isPlainRecord(ar);
}

// `import.meta.glob` is a Vite build-time macro. This project does not reference
// the `vite/client` ambient types, so declare a permissive shape locally to keep
// the type-check clean. The value is narrowed with an `as` cast at the call site;
// Vite still recognises the literal call and rewrites it at transform time.
declare global {
  interface ImportMeta {
    glob(pattern: string | string[], options?: Record<string, unknown>): Record<string, unknown>;
  }
}

// Lazy glob over the bilingual bundle surface — the same `*-i18n.ts` / `*labels`
// discovery the parity test uses, widened to bare `labels.ts` / `_labels.ts`
// bundles. Restricted to data-only `.ts` modules (every bilingual bundle is one);
// `.tsx` React components and server-only helpers (e.g. `i18n.server.ts`, which
// pulls `next/headers`) are outside these patterns. Kept lazy + defensive so any
// module that throws at import (or is a test file) is skipped, not fatal.
const bundleModules = import.meta.glob(
  ['/src/**/*labels*.ts', '/src/**/*-i18n.ts'],
  { eager: false },
) as Record<string, () => Promise<Record<string, unknown>>>;

async function discoverBundles(): Promise<Bundle[]> {
  const en = getMessages('en') as unknown as Record<string, unknown>;
  const ar = getMessages('ar') as unknown as Record<string, unknown>;
  const bundles: Bundle[] = [{ id: 'messages', en, ar }];
  // Dedupe by EN object identity so a re-exported bundle is only walked once.
  const seen = new Set<object>([en]);

  for (const [path, importer] of Object.entries(bundleModules)) {
    if (/(?:\.test\.|\.spec\.|__tests__|\.stories\.)/.test(path)) continue;
    let mod: Record<string, unknown>;
    try {
      mod = await importer();
    } catch {
      continue; // module blew up at import — not our concern here.
    }
    for (const [exportName, value] of Object.entries(mod)) {
      if (!isBilingual(value)) continue;
      const bEn = value.en as Record<string, unknown>;
      const bAr = value.ar as Record<string, unknown>;
      if (seen.has(bEn)) continue;
      seen.add(bEn);
      bundles.push({ id: `${path.replace(/^\//, '')}#${exportName}`, en: bEn, ar: bAr });
    }
  }
  return bundles;
}

/** Walk paired EN/AR string leaves (glossary mapping needs both sides). */
function walkPaired(
  en: unknown,
  ar: unknown,
  cb: (path: string, enText: string, arText: string) => void,
  prefix = '',
): void {
  if (!isPlainRecord(en) && !Array.isArray(en)) return;
  const enObj = en as Record<string, unknown>;
  const arObj = isPlainRecord(ar) || Array.isArray(ar) ? (ar as Record<string, unknown>) : undefined;
  for (const [key, enValue] of Object.entries(enObj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const arValue = arObj ? arObj[key] : undefined;
    if (typeof enValue === 'string') {
      if (typeof arValue === 'string') cb(path, enValue, arValue);
    } else if (isPlainRecord(enValue) || Array.isArray(enValue)) {
      walkPaired(enValue, arValue, cb, path);
    }
  }
}

/** Walk every AR string leaf (global-banned + english-leak are AR-only). */
function walkStrings(node: unknown, cb: (path: string, text: string) => void, prefix = ''): void {
  if (!isPlainRecord(node) && !Array.isArray(node)) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') cb(path, value);
    else if (isPlainRecord(value) || Array.isArray(value)) walkStrings(value, cb, path);
  }
}

// ---------------------------------------------------------------------------
// Violation model.
// ---------------------------------------------------------------------------

type ViolationType = 'glossary-missing' | 'glossary-banned' | 'global-banned' | 'english-leak';

interface Violation {
  key: string;
  type: ViolationType;
  bundle: string;
  path: string;
  term?: string;
  banned?: string;
  ar: string;
  en?: string;
}

function collectViolations(bundles: Bundle[]): Map<string, Violation> {
  const map = new Map<string, Violation>();
  const add = (v: Violation): void => {
    if (!map.has(v.key)) map.set(v.key, v);
  };

  for (const bundle of bundles) {
    // (a) GLOSSARY MAPPING — paired EN/AR leaves.
    walkPaired(bundle.en, bundle.ar, (path, enText, arText) => {
      for (const term of compiledTerms) {
        if (!term.enMatchers.some((re) => re.test(enText))) continue;
        if (term.arForms.length > 0 && !term.arForms.some((form) => arText.includes(form))) {
          add({
            key: `G-missing|${bundle.id}|${path}|${term.en}`,
            type: 'glossary-missing',
            bundle: bundle.id,
            path,
            term: term.en,
            en: enText,
            ar: arText,
          });
        }
        for (const banned of term.banned) {
          if (arText.includes(banned)) {
            add({
              key: `G-banned|${bundle.id}|${path}|${term.en}|${banned}`,
              type: 'glossary-banned',
              bundle: bundle.id,
              path,
              term: term.en,
              banned,
              en: enText,
              ar: arText,
            });
          }
        }
      }
    });

    // (b) GLOBAL BANNED + (c) ENGLISH-LEAK — every AR leaf.
    walkStrings(bundle.ar, (path, arText) => {
      for (const banned of glossary.global_banned_ar) {
        if (arText.includes(banned)) {
          add({
            key: `global|${bundle.id}|${path}|${banned}`,
            type: 'global-banned',
            bundle: bundle.id,
            path,
            banned,
            ar: arText,
          });
        }
      }
      if (isEnglishLeak(arText)) {
        add({
          key: `leak|${bundle.id}|${path}`,
          type: 'english-leak',
          bundle: bundle.id,
          path,
          ar: arText,
        });
      }
    });
  }

  return map;
}

function writeBaseline(map: Map<string, Violation>): void {
  const violations: Record<string, Omit<Violation, 'key'>> = {};
  for (const key of [...map.keys()].sort()) {
    const v = map.get(key)!;
    violations[key] = {
      type: v.type,
      bundle: v.bundle,
      path: v.path,
      ...(v.term ? { term: v.term } : {}),
      ...(v.banned ? { banned: v.banned } : {}),
      ...(v.en ? { en: v.en } : {}),
      ar: v.ar,
    };
  }
  const out = {
    $comment:
      'Frozen termbase-violation stock (src/lib/i18n/__tests__/termbase.test.ts). ' +
      'Only NET-NEW violations fail the test; this stock may shrink but never grow. ' +
      'Regenerate with: UPDATE_TERMBASE_BASELINE=1 npx vitest run src/lib/i18n/__tests__/termbase.test.ts',
    generatedAt: new Date().toISOString(),
    count: map.size,
    violations,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(out, null, 2)}\n`);
}

function describeViolation(v: Violation): string {
  const parts = [`[${v.type}] ${v.bundle} :: ${v.path}`];
  if (v.term) parts.push(`term="${v.term}"`);
  if (v.banned) parts.push(`banned="${v.banned}"`);
  return `${parts.join(' ')}\n      en="${v.en ?? ''}"\n      ar="${v.ar}"`;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('i18n termbase ratchet', () => {
  // Discovery imports ~150 bundle modules; that transform cost is done once in a
  // hook (generous timeout) so it is not charged against the per-test budget.
  let bundles: Bundle[] = [];
  beforeAll(async () => {
    bundles = await discoverBundles();
  }, 180_000);

  it('has no net-new termbase violations beyond the frozen baseline', () => {
    const current = collectViolations(bundles);

    if (UPDATE_BASELINE || !baselineFile) {
      writeBaseline(current);
      // eslint-disable-next-line no-console
      console.log(
        `termbase: ${baselineFile ? 're-snapshotted' : 'bootstrapped'} baseline with ` +
          `${current.size} violation(s) across ${bundles.length} bundle(s) → ${BASELINE_PATH}`,
      );
      expect(current.size).toBeGreaterThanOrEqual(0);
      return;
    }

    const baselineKeys = new Set(Object.keys(baselineFile.violations ?? {}));
    const netNew = [...current.values()].filter((v) => !baselineKeys.has(v.key));
    const resolved = [...baselineKeys].filter((k) => !current.has(k));

    if (resolved.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `termbase: ${resolved.length} baselined violation(s) resolved — lock in the ` +
          'progress with UPDATE_TERMBASE_BASELINE=1 to ratchet the baseline down.',
      );
    }

    const message =
      `Found ${netNew.length} NET-NEW termbase violation(s) not present in the frozen ` +
      `baseline. Fix the Arabic rendering to match scripts/i18n-glossary.json, or — if you ` +
      `are intentionally moving violations — re-snapshot with UPDATE_TERMBASE_BASELINE=1.\n\n` +
      netNew
        .slice(0, 30)
        .map((v) => `  ${describeViolation(v)}`)
        .join('\n\n') +
      (netNew.length > 30 ? `\n\n  …and ${netNew.length - 30} more.` : '');

    expect(netNew, message).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Self-tests — lock the linter's own behaviour so the ratchet stays honest.
// ---------------------------------------------------------------------------

describe('termbase linter behaviour', () => {
  const bundle = (en: Record<string, unknown>, ar: Record<string, unknown>): Bundle[] => [
    { id: 'synthetic', en, ar },
  ];

  it('flags an off-glossary Arabic rendering (banned term)', () => {
    const v = collectViolations(bundle({ x: 'This contract' }, { x: 'هذه الاتفاقية' }));
    const hit = [...v.values()].find((e) => e.type === 'glossary-banned' && e.banned === 'اتفاقية');
    expect(hit).toBeDefined();
  });

  it('flags a missing canonical Arabic term', () => {
    const v = collectViolations(bundle({ x: 'Open dashboard' }, { x: 'افتح الشاشة' }));
    const hit = [...v.values()].find((e) => e.type === 'glossary-missing' && e.term?.includes('dashboard'));
    expect(hit).toBeDefined();
  });

  it('passes a correct glossary rendering', () => {
    const v = collectViolations(bundle({ x: 'New contract' }, { x: 'عقد جديد' }));
    expect([...v.values()].some((e) => e.term === 'contract')).toBe(false);
  });

  it('flags a global-banned rendering regardless of the English leaf', () => {
    const v = collectViolations(bundle({ x: 'My account' }, { x: 'بروفايل المستخدم' }));
    expect([...v.values()].some((e) => e.type === 'global-banned' && e.banned === 'بروفايل')).toBe(true);
  });

  it('flags an English leak but allows product names and acronyms', () => {
    const leak = collectViolations(bundle({ a: 'Save', b: 'Product' }, { a: 'Save', b: 'Clario360' }));
    expect([...leak.values()].some((e) => e.type === 'english-leak' && e.path === 'a')).toBe(true);
    expect([...leak.values()].some((e) => e.type === 'english-leak' && e.path === 'b')).toBe(false);
    const acr = collectViolations(bundle({ a: 'SIEM' }, { a: 'SIEM' }));
    expect([...acr.values()].some((e) => e.type === 'english-leak')).toBe(false);
  });

  it('does not treat mixed Arabic/Latin (glossed acronym) as an English leak', () => {
    const v = collectViolations(bundle({ a: 'RTO' }, { a: 'RTO — هدف زمن الاسترداد' }));
    expect([...v.values()].some((e) => e.type === 'english-leak')).toBe(false);
  });
});
