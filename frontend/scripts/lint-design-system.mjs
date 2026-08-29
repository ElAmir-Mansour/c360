#!/usr/bin/env node
/**
 * lint-design-system.mjs — regex ratchet for design-system violations that
 * ESLint AST selectors cannot express reliably (arbitrary Tailwind values,
 * physical-direction utilities in an RTL-first app).
 *
 * Run: npm run lint:ds            (compare against the committed baseline)
 *      npm run lint:ds -- --update-baseline   (re-snapshot after cleanups)
 *
 * Behavior:
 *  - First run (no baseline file): writes scripts/lint-ds-baseline.json with
 *    per-category / per-file counts and exits 0. Commit that file.
 *  - Subsequent runs: FAILS (exit 1) if any category's total count grows past
 *    the baseline — i.e. new violations were added. Shrinking counts pass and
 *    print a hint to ratchet the baseline down.
 *
 * Categories (scanned in src/**\/*.{ts,tsx}):
 *  - arbitrary-hex-class      bg-[#...], text-[#...], border-[#...], ...
 *  - arbitrary-px-font        text-[13px] and friends (use the type scale)
 *  - inline-hex-style         style objects with hex colors (use --ds-* vars)
 *  - physical-direction-class ml-/mr-/pl-/pr-/text-left/text-right (use
 *                             logical ms-/me-/ps-/pe-/text-start/text-end —
 *                             the app is RTL-default)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASELINE_PATH = join(__dirname, 'lint-ds-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');
const VERBOSE = process.argv.includes('--verbose');

/** @type {Array<{ id: string, regex: RegExp, hint: string }>} */
const CATEGORIES = [
  {
    id: 'arbitrary-hex-class',
    // bg-[#fff], text-[#ABCDEF], border-[#0a3d3d]/40, from-[#123456], ...
    regex: /[a-z][a-z0-9-]*-\[#[0-9a-fA-F]{3,8}(?:\/\d{1,3})?\]/g,
    hint: 'Use --ds-* tokens via the Tailwind theme (bg-primary, text-muted-foreground, ...) instead of arbitrary hex classes.',
  },
  {
    id: 'arbitrary-px-font',
    // text-[13px], text-[11.5px], leading-[18px], tracking-[0.5px]
    regex: /\b(?:text|leading|tracking)-\[\d+(?:\.\d+)?px\]/g,
    hint: 'Use the type scale (text-xs/sm/base/...) — arbitrary px font values break the vertical rhythm and user zoom prefs.',
  },
  {
    id: 'inline-hex-style',
    // color: '#fff', backgroundColor: "#0a3d3d", stroke: `#8DC63F`, ...
    regex:
      /(?:\bcolor|backgroundColor|background|borderColor|outlineColor|caretColor|fill|stroke|boxShadow)\s*:\s*['"`][^'"`\n]*#[0-9a-fA-F]{3,8}/g,
    hint: "Use design tokens in style objects: style={{ color: 'var(--ds-...)' }}.",
  },
  {
    id: 'physical-direction-class',
    // ml-4, mr-px, pl-[2px], -ml-2, md:mr-auto, text-left, text-right —
    // the app is dir=rtl by default; use ms-/me-/ps-/pe-/text-start/text-end.
    regex:
      /(?<=['"`\s:(!])(?:-?(?:ml|mr|pl|pr)-(?:\d+(?:\.\d+)?|px|auto|\[[^\]]+\])|text-(?:left|right))(?=['"`\s)]|$)/gm,
    hint: 'RTL-first app: use logical utilities ms-/me-/ps-/pe-/text-start/text-end instead of physical ml-/mr-/pl-/pr-/text-left/text-right.',
  },
];

const SKIP_DIRS = new Set(['node_modules', '.next', '.next-verify', '.next-dev', 'coverage']);
const EXT_RE = /\.(?:ts|tsx)$/;

/** Recursively collect scannable files under a directory. */
function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.isFile() && EXT_RE.test(entry.name)) out.push(full);
  }
  return out;
}

/** Scan every file, returning { [categoryId]: { total, files: { relPath: count } } }. */
function scan() {
  const results = Object.fromEntries(CATEGORIES.map((c) => [c.id, { total: 0, files: {} }]));
  for (const file of collectFiles(SRC)) {
    const rel = relative(ROOT, file);
    const content = readFileSync(file, 'utf8');
    for (const cat of CATEGORIES) {
      cat.regex.lastIndex = 0;
      const matches = content.match(cat.regex);
      if (matches && matches.length > 0) {
        results[cat.id].total += matches.length;
        results[cat.id].files[rel] = matches.length;
      }
    }
  }
  return results;
}

function sortedFiles(files) {
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

function writeBaseline(current) {
  const baseline = {
    $comment:
      'Design-system ratchet baseline (scripts/lint-design-system.mjs). Counts may only go DOWN. Regenerate with: npm run lint:ds -- --update-baseline',
    generatedAt: new Date().toISOString(),
    categories: Object.fromEntries(
      Object.entries(current).map(([id, { total, files }]) => [
        id,
        { total, files: sortedFiles(files) },
      ]),
    ),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

function printSummary(current) {
  for (const cat of CATEGORIES) {
    const { total, files } = current[cat.id];
    console.log(`  ${cat.id.padEnd(26)} ${String(total).padStart(5)} in ${Object.keys(files).length} files`);
  }
}

const current = scan();

if (UPDATE || !existsSync(BASELINE_PATH)) {
  writeBaseline(current);
  console.log(
    `lint:ds — ${UPDATE ? 'baseline updated' : 'no baseline found; wrote initial baseline'}: ${relative(ROOT, BASELINE_PATH)}`,
  );
  printSummary(current);
  if (!UPDATE) console.log('\nCommit the baseline file. Future runs fail if any count grows.');
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
let failed = false;
let canRatchetDown = false;

console.log('lint:ds — design-system ratchet (current vs baseline):');
for (const cat of CATEGORIES) {
  const cur = current[cat.id];
  const base = baseline.categories?.[cat.id] ?? { total: 0, files: {} };
  const delta = cur.total - base.total;
  const marker = delta > 0 ? 'FAIL' : delta < 0 ? 'ok ↓' : 'ok';
  console.log(
    `  [${marker.padEnd(4)}] ${cat.id.padEnd(26)} ${cur.total} (baseline ${base.total}${delta ? `, ${delta > 0 ? '+' : ''}${delta}` : ''})`,
  );
  if (delta < 0) canRatchetDown = true;
  if (delta > 0) {
    failed = true;
    // Point at the files responsible: new files or files whose count grew.
    const offenders = Object.entries(cur.files)
      .map(([f, n]) => [f, n - (base.files?.[f] ?? 0)])
      .filter(([, grew]) => grew > 0)
      .sort((a, b) => b[1] - a[1]);
    for (const [f, grew] of offenders.slice(0, 20)) {
      console.log(`         +${grew}  ${f}`);
    }
    if (offenders.length > 20) console.log(`         ... and ${offenders.length - 20} more files`);
    console.log(`         fix: ${cat.hint}`);
  } else if (VERBOSE) {
    for (const [f, n] of Object.entries(sortedFiles(cur.files))) console.log(`         ${n}  ${f}`);
  }
}

if (failed) {
  console.error(
    '\nlint:ds FAILED — new design-system violations were introduced (counts above baseline).' +
      '\nFix the offending files (see hints above). If a count was legitimately reduced elsewhere' +
      '\nand you are moving violations (not adding), re-snapshot with: npm run lint:ds -- --update-baseline',
  );
  process.exit(1);
}

if (canRatchetDown) {
  console.log(
    '\nNice — some counts DROPPED below the baseline. Lock in the progress with:' +
      '\n  npm run lint:ds -- --update-baseline',
  );
}
console.log('\nlint:ds passed — no new design-system violations.');
