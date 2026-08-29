import type { AppLocale } from '@/lib/i18n';
import type { LexReferenceAskCitation } from '@/types/suites';
import { resolveHitTitles } from './library-helpers';

/** The subset of an answer turn needed to render a shareable export. */
export interface ExportableTurn {
  question: string;
  answer: string;
  citations: LexReferenceAskCitation[];
  model?: string;
}

/** Localized headings the formatter needs (a slice of the library labels). */
export interface AskExportLabels {
  exportQuestionLabel: string;
  exportAnswerLabel: string;
  exportSourcesLabel: string;
  exportPageLabel: (page: string) => string;
  exportGeneratedBy: (model: string) => string;
}

/**
 * Render an Ask-the-Library turn (question + grounded answer + its citations) as
 * a self-contained Markdown/plain-text document, suitable for both the clipboard
 * and a downloaded `.md`. Citations carry their resolved title, page anchor and
 * snippet so the export is verifiable on its own. Nothing is fabricated — only
 * the turn's real content is included.
 */
export function formatAskTurnForExport(
  turn: ExportableTurn,
  locale: AppLocale,
  labels: AskExportLabels,
): string {
  const lines: string[] = [];
  lines.push(`## ${labels.exportQuestionLabel}`);
  lines.push(turn.question.trim());
  lines.push('');
  lines.push(`## ${labels.exportAnswerLabel}`);
  lines.push(turn.answer.trim());

  if (turn.citations.length > 0) {
    lines.push('');
    lines.push(`## ${labels.exportSourcesLabel}`);
    turn.citations.forEach((citation, index) => {
      const titles = resolveHitTitles(citation, locale);
      const page =
        typeof citation.page === 'number'
          ? ` (${labels.exportPageLabel(String(citation.page))})`
          : '';
      lines.push(`${index + 1}. ${titles.primary}${page}`);
      const snippet = citation.snippet?.trim();
      if (snippet) {
        // Blockquote each snippet line so multi-line quotes stay readable.
        for (const snippetLine of snippet.split('\n')) {
          lines.push(`   > ${snippetLine}`);
        }
      }
    });
  }

  if (turn.model) {
    lines.push('');
    lines.push(`_${labels.exportGeneratedBy(turn.model)}_`);
  }

  return `${lines.join('\n')}\n`;
}

/** Slugify a title into a safe-ish download filename stem (keeps Arabic script). */
export function toExportFileStem(base: string, question: string): string {
  const q = question
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .slice(0, 48);
  return q ? `${base}-${q}` : base;
}
