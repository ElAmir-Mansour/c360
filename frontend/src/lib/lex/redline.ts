import { diffChars, diffLines, diffWords, type Change } from 'diff';

/**
 * A single contiguous run of text in a redline (track-changes) diff.
 *  - `equal`   — present unchanged in both the original and the revised text.
 *  - `added`   — present only in the revised text (an insertion).
 *  - `removed` — present only in the original text (a deletion).
 */
export type RedlineSegment = {
  type: 'equal' | 'added' | 'removed';
  value: string;
};

export type RedlineGranularity = 'word' | 'line' | 'char';

export interface ComputeRedlineOptions {
  /** Tokenization level for the diff. Defaults to `'word'`. */
  granularity?: RedlineGranularity;
}

function toSegment(change: Change): RedlineSegment {
  if (change.added) {
    return { type: 'added', value: change.value };
  }
  if (change.removed) {
    return { type: 'removed', value: change.value };
  }
  return { type: 'equal', value: change.value };
}

/**
 * Compute a redline (insertions / deletions) diff between two strings using the
 * `diff` package, normalized into a flat list of {@link RedlineSegment}.
 *
 * The output preserves source order: a replacement surfaces as a `removed`
 * segment immediately followed by an `added` segment, which renderers can pair
 * up for an inline strikethrough + insertion view.
 */
export function computeRedline(
  original: string,
  revised: string,
  opts: ComputeRedlineOptions = {},
): RedlineSegment[] {
  const granularity = opts.granularity ?? 'word';
  const left = original ?? '';
  const right = revised ?? '';

  let changes: Change[];
  switch (granularity) {
    case 'char':
      changes = diffChars(left, right);
      break;
    case 'line':
      changes = diffLines(left, right);
      break;
    case 'word':
    default:
      changes = diffWords(left, right);
      break;
  }

  return changes
    .filter((change) => change.value.length > 0)
    .map(toSegment);
}
