#!/usr/bin/env node
/**
 * i18n-gate.mjs — coverage RATCHET gate for the in-house i18n layer.
 *
 * A thin wrapper over `scripts/i18n-coverage.mjs` (it does NOT re-scan): it
 * shells `node scripts/i18n-coverage.mjs --json`, parses the per-module report,
 * and diffs it against a committed baseline (scripts/i18n-coverage-baseline.json).
 * Mirrors the proven `lint-design-system.mjs` + `lint-ds-baseline.json` UX so
 * both ratchets behave identically for reviewers and CI.
 *
 * Run: npm run i18n:gate                         (compare against the baseline)
 *      npm run i18n:gate:update                  (re-snapshot after real gains)
 *      node scripts/i18n-gate.mjs --update-baseline
 *
 * Behavior:
 *  - First run (no baseline file): writes scripts/i18n-coverage-baseline.json
 *    and exits 0. Commit that file.
 *  - Subsequent runs: FAIL (exit 1) on any of:
 *      1. RATCHET       any baseline module regressing — hardcoded count grew,
 *                       or module coverage dropped below (baseline - 0.001).
 *      2. NET-NEW FLOOR any brand-new module (present now, absent from baseline)
 *                       that misses the absolute floor: coverage >= 0.90 AND
 *                       hardcoded <= 5. New routes must ship translated.
 *      3. GLOBAL        totals.coverage dropped below the baseline global
 *                       coverage (monotonic global improvement).
 *    Shrinking counts / rising coverage pass and print a hint to re-snapshot.
 *
 * Because the baseline is committed and code-reviewed, ratcheting the floor
 * down (e.g. 90.6% -> 91%) is a visible, deliberate PR — same governance loop
 * as the design-system baseline.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COVERAGE_SCRIPT = join(__dirname, 'i18n-coverage.mjs');
const BASELINE_PATH = join(__dirname, 'i18n-coverage-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

// Floats from a ratio never land exactly; tolerate sub-0.1% jitter so the gate
// does not flap on rounding while still catching real regressions.
const EPS = 0.001;

// Absolute floor for BRAND-NEW modules. Raise these over quarters as the
// backlog burns down (0.90 now -> 0.98 target). Changing them is a code change,
// so the floor is reviewed like everything else.
const NET_NEW_MIN_COVERAGE = 0.9;
const NET_NEW_MAX_HARDCODED = 5;

const pct = (n) => `${(n * 100).toFixed(1)}%`;

// ---------------------------------------------------------------------------
// Coverage report (shelled — single source of truth for the scan)
// ---------------------------------------------------------------------------
function runCoverage(extraArgs = []) {
  const stdout = execFileSync(
    process.execPath,
    [COVERAGE_SCRIPT, '--json', ...extraArgs],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

function pickModule(m) {
  return {
    files: m.files,
    translated: m.translated,
    hardcoded: m.hardcoded,
    coverage: m.coverage,
  };
}

// ---------------------------------------------------------------------------
// Baseline I/O
// ---------------------------------------------------------------------------
function writeBaseline(report) {
  const baseline = {
    $comment:
      'i18n coverage ratchet baseline (scripts/i18n-gate.mjs). Per-module `hardcoded` may only go DOWN and `coverage` may only go UP; global `totals.coverage` is monotonic non-decreasing; brand-new modules must meet the net-new floor. Regenerate deliberately with: npm run i18n:gate:update',
    generatedAt: new Date().toISOString(),
    netNewFloor: {
      minCoverage: NET_NEW_MIN_COVERAGE,
      maxHardcoded: NET_NEW_MAX_HARDCODED,
    },
    totals: pickModule(report.totals),
    modules: Object.fromEntries(
      [...report.modules]
        .sort((a, b) => a.module.localeCompare(b.module))
        .map((m) => [m.module, pickModule(m)]),
    ),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

function printSnapshot(report) {
  const modules = [...report.modules].sort((a, b) => b.hardcoded - a.hardcoded);
  for (const m of modules) {
    console.log(
      `  ${m.module.padEnd(20)} hardcoded ${String(m.hardcoded).padStart(5)}   coverage ${pct(m.coverage).padStart(6)}`,
    );
  }
  console.log(
    `  ${'TOTAL'.padEnd(20)} hardcoded ${String(report.totals.hardcoded).padStart(5)}   coverage ${pct(report.totals.coverage).padStart(6)}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const report = runCoverage();

if (UPDATE || !existsSync(BASELINE_PATH)) {
  writeBaseline(report);
  console.log(
    `i18n:gate — ${UPDATE ? 'baseline updated' : 'no baseline found; wrote initial baseline'}: ${relative(ROOT, BASELINE_PATH)}`,
  );
  printSnapshot(report);
  if (!UPDATE) {
    console.log('\nCommit the baseline file. Future runs fail if any module regresses.');
  }
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const baseModules = baseline.modules ?? {};
const currentByName = new Map(report.modules.map((m) => [m.module, m]));

let failed = false;
let canRatchetDown = false;

// --- Rule 1: RATCHET — no baseline module may regress ----------------------
console.log('i18n:gate — coverage ratchet (current vs baseline):\n');
console.log('RATCHET (baseline modules — hardcoded must not grow, coverage must not drop):');
for (const name of Object.keys(baseModules).sort()) {
  const base = baseModules[name];
  const cur = currentByName.get(name);
  if (!cur) {
    // Module went away (route deleted / renamed). Not a regression.
    console.log(`  [gone]  ${name.padEnd(20)} — removed since baseline (was hardcoded ${base.hardcoded})`);
    continue;
  }
  const hcDelta = cur.hardcoded - base.hardcoded;
  const covDelta = cur.coverage - base.coverage;
  const hcRegressed = hcDelta > 0;
  const covRegressed = covDelta < -EPS;
  const improved = hcDelta < 0 || covDelta > EPS;
  if (improved) canRatchetDown = true;

  const marker = hcRegressed || covRegressed ? 'FAIL' : improved ? 'ok ↓' : 'ok';
  console.log(
    `  [${marker.padEnd(4)}] ${name.padEnd(20)} hardcoded ${cur.hardcoded} (baseline ${base.hardcoded}${hcDelta ? `, ${hcDelta > 0 ? '+' : ''}${hcDelta}` : ''})   coverage ${pct(cur.coverage)} (baseline ${pct(base.coverage)})`,
  );

  if (hcRegressed || covRegressed) {
    failed = true;
    if (hcRegressed) {
      // Point at the files responsible for the growth.
      const detail = runCoverage(['--module', name]);
      const offenders = (detail.worstFiles ?? [])
        .slice(0, 10)
        .map((f) => `           ${String(f.hardcoded).padStart(4)}  ${f.file}`);
      console.log(`         +${hcDelta} hardcoded string(s) — worst files now:`);
      if (offenders.length) console.log(offenders.join('\n'));
      console.log(
        "         fix: route new user-facing copy through the i18n layer (t('key') / use*Labels() / labels.*); do not add raw JSX text or title/placeholder/label/aria-label props.",
      );
    }
    if (covRegressed) {
      console.log(
        `         coverage fell ${pct(-covDelta)} below baseline — translate the newly-added strings in '${name}' or revert the hardcoded copy.`,
      );
    }
  }
}

// --- Rule 2: NET-NEW FLOOR — brand-new modules must ship translated --------
const newModules = report.modules
  .filter((m) => !(m.module in baseModules))
  .sort((a, b) => b.hardcoded - a.hardcoded);

console.log(
  `\nNET-NEW modules (brand-new since baseline — floor: coverage >= ${pct(NET_NEW_MIN_COVERAGE)} AND hardcoded <= ${NET_NEW_MAX_HARDCODED}):`,
);
if (newModules.length === 0) {
  console.log('  (none)');
}
for (const m of newModules) {
  const belowFloor =
    m.coverage < NET_NEW_MIN_COVERAGE - EPS || m.hardcoded > NET_NEW_MAX_HARDCODED;
  const marker = belowFloor ? 'FAIL' : 'ok';
  console.log(
    `  [${marker.padEnd(4)}] ${m.module.padEnd(20)} coverage ${pct(m.coverage)}   hardcoded ${m.hardcoded}`,
  );
  if (belowFloor) {
    failed = true;
    const detail = runCoverage(['--module', m.module]);
    const offenders = (detail.worstFiles ?? []).slice(0, 8);
    for (const f of offenders) {
      console.log(`           ${String(f.hardcoded).padStart(4)}  ${f.file}`);
      for (const s of (f.samples ?? []).slice(0, 3)) {
        console.log(`                · ${s.length > 70 ? `${s.slice(0, 70)}…` : s}`);
      }
    }
    console.log(
      '         fix: new routes must ship translated. Wire every user-facing string through the i18n catalog before merging (or the module cannot land).',
    );
  }
}

// --- Rule 3: GLOBAL DRIFT-UP — totals coverage is monotonic ----------------
const curGlobal = report.totals.coverage;
const baseGlobal = baseline.totals?.coverage ?? 0;
const globalDelta = curGlobal - baseGlobal;
const globalRegressed = globalDelta < -EPS;
if (globalDelta > EPS) canRatchetDown = true;

console.log('\nGLOBAL (totals.coverage must not drop):');
console.log(
  `  [${(globalRegressed ? 'FAIL' : globalDelta > EPS ? 'ok ↓' : 'ok').padEnd(4)}] totals.coverage ${pct(curGlobal)} (baseline ${pct(baseGlobal)}${Math.abs(globalDelta) > EPS ? `, ${globalDelta > 0 ? '+' : ''}${pct(globalDelta)}` : ''})`,
);
if (globalRegressed) {
  failed = true;
  console.log(
    `         global coverage fell ${pct(-globalDelta)} below baseline — the net hardcoded/translated ratio worsened across src/app.`,
  );
}

// ---------------------------------------------------------------------------
// Exit
// ---------------------------------------------------------------------------
if (failed) {
  console.error(
    '\ni18n:gate FAILED — the Arabic/i18n coverage ratchet caught a regression (see above).' +
      '\nEvery user-facing string must go through the i18n layer. Fix the offending files,' +
      '\nor — only if you legitimately moved strings and the totals did NOT worsen — re-snapshot with:' +
      '\n  npm run i18n:gate:update',
  );
  process.exit(1);
}

if (canRatchetDown) {
  console.log(
    '\nNice — coverage improved past the baseline. Lock in the progress with:' +
      '\n  npm run i18n:gate:update',
  );
}
console.log('\ni18n:gate passed — no i18n coverage regressions.');
process.exit(0);
