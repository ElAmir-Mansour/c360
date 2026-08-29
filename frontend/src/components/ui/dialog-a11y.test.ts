import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guard for the two Radix dialog a11y contracts that only surface
 * as console noise at runtime (and only once the dialog is actually opened, so
 * component tests rarely catch them):
 *
 *   - `DialogContent` requires a `DialogTitle` … — hard error, no accessible name.
 *   - Missing `Description` or `aria-describedby={undefined}` … — warning.
 *
 * Every `*Content` overlay must therefore either render its matching `*Title` /
 * `*Description`, or carry an explicit `aria-label` / `aria-describedby={undefined}`
 * opt-out on the opening tag. A title rendered visually hidden (`className="sr-only"`)
 * counts — chromeless overlays like the command palette do exactly that.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The primitives themselves define the components; they have nothing to satisfy.
const EXEMPT = new Set([
  'components/ui/dialog.tsx',
  'components/ui/sheet.tsx',
  'components/ui/alert-dialog.tsx',
  'components/ui/dialog-a11y.test.ts',
]);

const PAIRS = [
  { content: 'DialogContent', title: 'DialogTitle', description: 'DialogDescription' },
  { content: 'SheetContent', title: 'SheetTitle', description: 'SheetDescription' },
  {
    content: 'AlertDialogContent',
    title: 'AlertDialogTitle',
    description: 'AlertDialogDescription',
  },
] as const;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      tsxFiles(full, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Index just past the `>` that closes the JSX opening tag starting at `start`. */
function endOfOpeningTag(src: string, start: number): number {
  let braces = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i += 1) {
    const char = src[i];
    if (quote) {
      if (char === quote && src[i - 1] !== '\\') quote = null;
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '{') {
      braces += 1;
    } else if (char === '}') {
      braces -= 1;
    } else if (braces === 0 && char === '>') {
      return i + 1;
    }
  }
  return src.length;
}

/** All `<Tag …>…</Tag>` blocks (self-closing tags included) in source order. */
function blocks(src: string, tag: string): Array<{ line: number; open: string; body: string }> {
  const found: Array<{ line: number; open: string; body: string }> = [];
  const opener = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  const boundary = new RegExp(`<(/?)${tag}(?=[\\s/>])`, 'g');

  for (const match of src.matchAll(opener)) {
    const start = match.index!;
    const openEnd = endOfOpeningTag(src, start);
    const open = src.slice(start, openEnd);
    const line = src.slice(0, start).split('\n').length;

    if (open.trimEnd().endsWith('/>')) {
      found.push({ line, open, body: open });
      continue;
    }

    let depth = 1;
    boundary.lastIndex = openEnd;
    let end = src.length;
    let next = boundary.exec(src);
    while (next) {
      if (next[1] === '/') {
        depth -= 1;
        if (depth === 0) {
          end = next.index + next[0].length;
          break;
        }
      } else if (!src.slice(next.index, endOfOpeningTag(src, next.index)).trimEnd().endsWith('/>')) {
        depth += 1;
      }
      next = boundary.exec(src);
    }
    found.push({ line, open, body: src.slice(start, end) });
  }
  return found;
}

describe('radix dialog accessibility contracts', () => {
  const files = tsxFiles(SRC).filter((file) => !EXEMPT.has(relative(SRC, file)));

  it('gives every overlay an accessible name', () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const { content, title } of PAIRS) {
        if (!src.includes(`<${content}`)) continue;
        for (const block of blocks(src, content)) {
          const named =
            block.body.includes(`<${title}`) ||
            block.open.includes('aria-labelledby') ||
            block.open.includes('aria-label=');
          if (!named) violations.push(`${relative(SRC, file)}:${block.line} <${content}> has no <${title}>`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('gives every overlay a description or an explicit opt-out', () => {
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const { content, description } of PAIRS) {
        if (!src.includes(`<${content}`)) continue;
        for (const block of blocks(src, content)) {
          const described =
            block.body.includes(`<${description}`) || block.open.includes('aria-describedby');
          if (!described) {
            violations.push(
              `${relative(SRC, file)}:${block.line} <${content}> needs a <${description}> or aria-describedby={undefined}`,
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
