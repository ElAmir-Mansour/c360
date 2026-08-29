#!/usr/bin/env node
/**
 * Watheeq (Lex) Arabic-localization gate.
 *
 * Fails CI if a raw backend token can leak English into the Arabic UI. It flags
 * two high-confidence anti-patterns and nothing else (so legitimate last-resort
 * `?? token.replace(/_/g,' ')` fallbacks and non-display uses stay green):
 *
 *   1. DIRECT DISPLAY of a raw token — `.replace(/_/g, …)` inside a JSX display
 *      slot (`status={…}` / `label={…}` / `title={…}` / `>{…}` etc.) with no
 *      `??`/`||` bilingual-map guard on the line.
 *   2. UNTRANSLATED `ar:` LABEL — a bilingual-bundle `ar:` string value that
 *      contains letters but no Arabic script.
 *
 * Run: `node scripts/lint-lex-i18n.mjs`  (add as `npm run lint:i18n`).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [
  join(HERE, '../src/app/(dashboard)/lex'),
  join(HERE, '../src/components/lex'),
].filter(existsSync);

const AR = /[؀-ۿ]/;
const files = [];
function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const s = statSync(p);
    if (s.isDirectory()) { if (!/node_modules|\.next/.test(p)) walk(p); }
    // Skip the localization-QA meta tool: its object keys are literally named
    // `ar`/`en` (which language is *missing*), so `ar: 'Missing Arabic'` is
    // correct English UI copy, not an untranslated label.
    else if (/\.(tsx?)$/.test(p) && !/\.(test|spec)\./.test(p) && !/localization-qa/.test(p)) files.push(p);
  }
}
ROOTS.forEach(walk);

// A raw `.replace(/_/g,…)` sitting in a JSX display slot, unguarded by ?? / ||.
const DISPLAY_SLOT = /(status|label|title|children|value|text|name|placeholder|aria-label)\s*=\s*\{[^}]*\.replace\(\/_\/g/;
const JSX_CHILD = />\s*\{[^}]*\.replace\(\/_\/g/;
const AR_KEY = /(^|[\s{,])ar:\s*(['"`])((?:\\.|(?!\2).)*)\2/;

const offenders = [];
for (const f of files) {
  const rel = f.slice(f.indexOf('src/'));
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if ((DISPLAY_SLOT.test(ln) || JSX_CHILD.test(ln)) && !/\?\?|\|\|/.test(ln)) {
      offenders.push(`${rel}:${i + 1}  DIRECT-DISPLAY raw token → route through a bilingual map`);
    }
    const m = ln.match(AR_KEY);
    if (m) {
      const val = m[3].trim();
      const letters = val.replace(/\$\{[^}]*\}/g, '').replace(/[^A-Za-z؀-ۿ]/g, '');
      if (letters.length >= 3 && !AR.test(val)) {
        offenders.push(`${rel}:${i + 1}  UNTRANSLATED ar: "${val.slice(0, 50)}"`);
      }
    }
  });
}

if (offenders.length) {
  console.error(`\n✖ lex-i18n gate: ${offenders.length} untranslated / raw-token leak(s):\n`);
  offenders.forEach((o) => console.error('  ' + o));
  console.error('\nFix: resolve the token via the domain bilingual map (map[token] ?? fallback), or translate the ar: value.\n');
  process.exit(1);
}
console.log(`✓ lex-i18n gate: ${files.length} Lex files clean — no raw-token display leaks or untranslated ar: labels.`);
