/**
 * Regenerates the checked-in design-token artifacts from the TypeScript source
 * of truth (src/styles/tokens/index.ts):
 *
 *   - src/styles/tokens/tokens.css   — the --ds-* CSS custom properties
 *                                       (:root light + .dark overrides)
 *   - src/styles/tokens/tokens.json  — the full token inventory as JSON
 *
 * Run:  node scripts/generate-tokens.mjs
 *
 * It bundles the TS modules with the project's esbuild (a Vite dependency) into
 * a throwaway ESM file, imports it, and writes the artifacts. This keeps the CSS
 * and JSON provably in sync with index.ts — no hand-maintained duplication.
 */
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tokensDir = join(root, 'src', 'styles', 'tokens');

const work = mkdtempSync(join(tmpdir(), 'ds-tokens-'));
const outfile = join(work, 'bundle.mjs');

await build({
  entryPoints: [join(tokensDir, 'entry.gen.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'error',
});

const mod = await import(pathToFileURL(outfile).href);
const { renderLightRoot, renderDarkRoot } = mod.css;
const { tokens } = mod;

const indent = (block, pad) =>
  block
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');

const cssOut = `/* ============================================================================
 * ClarioDR Design System — design tokens (GENERATED).
 * Source of truth: src/styles/tokens/index.ts
 * Regenerate with: node scripts/generate-tokens.mjs
 * Do not edit by hand.
 *
 * Plain :root / .dark selectors (no @layer wrapper) so this file is valid when
 * processed standalone by the CSS loader. It is @import-ed at the top of
 * globals.css, before the @tailwind directives.
 * ========================================================================== */

:root {
${indent(renderLightRoot(), '  ')}
}

.dark {
${indent(renderDarkRoot(), '  ')}
}
`;

writeFileSync(join(tokensDir, 'tokens.css'), cssOut, 'utf8');
writeFileSync(join(tokensDir, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n', 'utf8');

rmSync(work, { recursive: true, force: true });

console.log('Generated tokens.css and tokens.json');
