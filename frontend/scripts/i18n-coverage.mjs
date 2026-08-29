#!/usr/bin/env node
/**
 * i18n-coverage — reports translated vs hardcoded UI strings per app module.
 *
 * Scans `src/app` for .tsx files (tests/stories excluded) and, per module
 * (the first meaningful path segment under src/app, e.g. `cyber`, `lex`,
 * `platform`, `auth`), counts:
 *
 *   translated  i18n call sites: t('key') / useT(...) / use*Labels() /
 *               resolve*Bilingual(...) / labels.foo / registerMessages(...)
 *   hardcoded   raw JSX text literals plus raw string values of user-facing
 *               props (title/placeholder/label/aria-label/alt/description/
 *               emptyMessage/header/subtitle/tooltip)
 *
 * Coverage = translated / (translated + hardcoded).
 *
 * This is a HEURISTIC lexical scan (no TS parser, zero dependencies): it
 * strips comments, ignores non-linguistic strings (no letters, single chars,
 * pure interpolation), and whitelists obvious non-copy values (mime types,
 * URLs, format tokens). Treat the numbers as a trend/triage signal, not a
 * compliance gate.
 *
 * Usage:
 *   npm run i18n:coverage                 # per-module table
 *   npm run i18n:coverage -- --json       # machine-readable output
 *   npm run i18n:coverage -- --module lex # worst files within one module
 *   npm run i18n:coverage -- --top 15     # show N worst files overall
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const ROOT = new URL('..', import.meta.url).pathname;
const APP_DIR = join(ROOT, 'src', 'app');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const moduleFilter = args.includes('--module')
  ? args[args.indexOf('--module') + 1]
  : undefined;
const topN = args.includes('--top')
  ? Number(args[args.indexOf('--top') + 1]) || 10
  : undefined;

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(full, out);
    } else if (
      entry.endsWith('.tsx') &&
      !entry.endsWith('.test.tsx') &&
      !entry.endsWith('.stories.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Module = first non-route-group segment under src/app. */
function moduleOf(file) {
  const rel = relative(APP_DIR, file);
  const segments = rel.split(sep);
  for (const segment of segments.slice(0, -1)) {
    if (/^\(.*\)$/.test(segment)) continue; // route group: (dashboard), (auth)
    if (segment.startsWith('_')) break; // _components at app root
    return segment;
  }
  return '(root)';
}

// ---------------------------------------------------------------------------
// Source preparation + heuristics
// ---------------------------------------------------------------------------

/** Strip block + line comments (string-naive but adequate for counting). */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
}

/** At least two letters (Latin or Arabic) somewhere — i.e. linguistic copy. */
function isLinguistic(text) {
  const letters = text.match(/[A-Za-z؀-ۿ]/g);
  return Boolean(letters && letters.length >= 2);
}

/** Obvious non-copy values we never want counted as hardcoded UI strings. */
const NON_COPY = [
  /^https?:\/\//i,
  /^[a-z-]+\/[a-z0-9.+-]+$/i, // mime types: text/csv, application/json
  /^#[0-9a-f]{3,8}$/i,
  /^[a-z0-9_-]+\.(png|svg|jpg|jpeg|webp|ico|css|js|json|csv|pdf)$/i,
  /^\d{4}-\d{2}-\d{2}/, // date formats / ISO samples
  /^[A-Za-z0-9_,:;=&?/[\]().{}#%+*|^$\\ -]*\{\d*\}[A-Za-z0-9_,:;=&?/[\]().{}#%+*|^$\\ -]*$/, // pure format tokens
  /^(asc|desc|ltr|rtl|csv|json|xlsx|pdf|utf-8|en|ar|true|false|null|undefined)$/i,
  /^[A-Z0-9_]+$/, // SCREAMING_CONSTANTS / acronyms
  /^[a-z0-9]+([-_.:][a-z0-9]+)+$/, // slug-like / token-like / class-ish
];

function isNonCopy(text) {
  const trimmed = text.trim();
  return NON_COPY.some((re) => re.test(trimmed));
}

/**
 * Code fragments that leak through the JSX-text regex when `>` appears in
 * generics/arrow functions (e.g. "Record<string, X>; const y ="). Reject
 * anything that reads like code rather than copy.
 */
const CODE_FRAGMENT_RE =
  /(;|=>|=\s|\bconst\b|\blet\b|\breturn\b|\bimport\b|\bexport\b|\?\?|&&|\|\|)/;

function looksLikeCode(text) {
  return CODE_FRAGMENT_RE.test(text);
}

/** Patterns marking a string as flowing through the i18n layer. */
const TRANSLATED_PATTERNS = [
  /\bt\(\s*['"`]/g, // t('key')
  /\buseT\s*\(/g, // useT() / useT('ns')
  /\buse[A-Z]\w*Labels\s*\(/g, // useCyberCommonLabels()
  /\bresolve\w*Bilingual\w*\s*\(/g, // resolveLexBilingual(...)
  /\buseBilingual\s*\(/g,
  /\blabels\.[A-Za-z_]/g, // labels.title
  /\bcreateTranslator\s*\(/g,
  /\bregisterMessages\s*\(/g,
  /\breadMessage\s*\(/g,
  /\bresolveLocalized\s*\(/g,
];

/** User-facing props whose raw string values count as hardcoded copy. */
const PROP_ATTR_RE =
  /\b(?:title|placeholder|label|aria-label|alt|description|emptyMessage|errorTitle|header|subtitle|tooltip|heading|caption)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*"([^"]+)"\s*\}|\{\s*'([^']+)'\s*\})/g;

/** JSX text nodes: content between a closing `>` and the next `<`. */
const JSX_TEXT_RE = />([^<>{}]+)</g;

function scanFile(file) {
  const source = stripComments(readFileSync(file, 'utf8'));

  let translated = 0;
  for (const re of TRANSLATED_PATTERNS) {
    re.lastIndex = 0;
    const matches = source.match(re);
    if (matches) translated += matches.length;
  }

  const hardcodedSamples = [];

  for (const match of source.matchAll(JSX_TEXT_RE)) {
    const text = match[1].replace(/\s+/g, ' ').trim();
    if (!text || !isLinguistic(text) || isNonCopy(text) || looksLikeCode(text)) {
      continue;
    }
    hardcodedSamples.push(text);
  }

  for (const match of source.matchAll(PROP_ATTR_RE)) {
    const text = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || !isLinguistic(text) || isNonCopy(text)) continue;
    hardcodedSamples.push(text);
  }

  return { translated, hardcoded: hardcodedSamples.length, hardcodedSamples };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
const files = walk(APP_DIR);
const perModule = new Map();
const perFile = [];

for (const file of files) {
  const mod = moduleOf(file);
  if (moduleFilter && mod !== moduleFilter) continue;
  const { translated, hardcoded, hardcodedSamples } = scanFile(file);

  const entry = perModule.get(mod) ?? {
    module: mod,
    files: 0,
    translated: 0,
    hardcoded: 0,
  };
  entry.files += 1;
  entry.translated += translated;
  entry.hardcoded += hardcoded;
  perModule.set(mod, entry);

  perFile.push({
    file: relative(ROOT, file),
    module: mod,
    translated,
    hardcoded,
    samples: hardcodedSamples.slice(0, 5),
  });
}

function coverage(entry) {
  const total = entry.translated + entry.hardcoded;
  return total === 0 ? 1 : entry.translated / total;
}

const modules = [...perModule.values()].sort(
  (a, b) => b.hardcoded - a.hardcoded,
);
const totals = modules.reduce(
  (acc, m) => ({
    module: 'TOTAL',
    files: acc.files + m.files,
    translated: acc.translated + m.translated,
    hardcoded: acc.hardcoded + m.hardcoded,
  }),
  { module: 'TOTAL', files: 0, translated: 0, hardcoded: 0 },
);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
if (asJson) {
  const payload = {
    generatedAt: new Date().toISOString(),
    scope: moduleFilter ?? 'src/app',
    modules: modules.map((m) => ({ ...m, coverage: coverage(m) })),
    totals: { ...totals, coverage: coverage(totals) },
    ...(moduleFilter || topN
      ? {
          worstFiles: perFile
            .filter((f) => f.hardcoded > 0)
            .sort((a, b) => b.hardcoded - a.hardcoded)
            .slice(0, topN ?? 20),
        }
      : {}),
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const pad = (value, width, alignEnd = false) => {
  const s = String(value);
  return alignEnd ? s.padStart(width) : s.padEnd(width);
};

const nameWidth = Math.max(8, ...modules.map((m) => m.module.length)) + 2;
console.log('');
console.log('i18n coverage — src/app (heuristic lexical scan)');
console.log('');
console.log(
  `${pad('module', nameWidth)}${pad('files', 7, true)}${pad('translated', 12, true)}${pad('hardcoded', 11, true)}${pad('coverage', 10, true)}`,
);
console.log('-'.repeat(nameWidth + 40));
for (const m of modules) {
  console.log(
    `${pad(m.module, nameWidth)}${pad(m.files, 7, true)}${pad(m.translated, 12, true)}${pad(m.hardcoded, 11, true)}${pad(`${(coverage(m) * 100).toFixed(1)}%`, 10, true)}`,
  );
}
console.log('-'.repeat(nameWidth + 40));
console.log(
  `${pad(totals.module, nameWidth)}${pad(totals.files, 7, true)}${pad(totals.translated, 12, true)}${pad(totals.hardcoded, 11, true)}${pad(`${(coverage(totals) * 100).toFixed(1)}%`, 10, true)}`,
);
console.log('');

if (moduleFilter || topN) {
  const worst = perFile
    .filter((f) => f.hardcoded > 0)
    .sort((a, b) => b.hardcoded - a.hardcoded)
    .slice(0, topN ?? 20);
  console.log(
    moduleFilter
      ? `Worst files in '${moduleFilter}' (by hardcoded strings):`
      : `Worst files overall (by hardcoded strings):`,
  );
  for (const f of worst) {
    console.log(`  ${pad(f.hardcoded, 5, true)}  ${f.file}`);
    for (const s of f.samples) {
      console.log(`           · ${s.length > 70 ? `${s.slice(0, 70)}…` : s}`);
    }
  }
  console.log('');
}
