'use client';

import { tokenizeSnippet } from '../_lib/documents-helpers';

/**
 * DocumentSnippet renders a full-text-search `ts_headline` snippet with its hit
 * terms highlighted, WITHOUT injecting raw server HTML. The snippet is tokenised
 * (see {@link tokenizeSnippet}) into plain-text pieces, and matched pieces are
 * wrapped in a styled `<mark>` while the rest render in muted text. A thin
 * relevance bar conveys the `rank` subtly.
 */
export function DocumentSnippet({
  snippet,
  rank,
  relevanceLabel,
}: {
  snippet: string;
  rank: number;
  relevanceLabel: string;
}) {
  const tokens = tokenizeSnippet(snippet);
  if (tokens.length === 0) return null;

  // Normalise rank (Postgres ts_rank is typically small, often < 1) into a 0–100
  // width for the subtle relevance bar. Clamp so pathological values still render.
  const widthPct = Math.max(6, Math.min(100, Math.round(rank * 100)));

  return (
    <div className="mt-1 space-y-1">
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {tokens.map((token, index) =>
          token.highlighted ? (
            <mark key={index} className="rounded bg-yellow-100 px-0.5 text-foreground dark:bg-yellow-900/40">
              {token.text}
            </mark>
          ) : (
            <span key={index}>{token.text}</span>
          ),
        )}
      </p>
      <div className="flex items-center gap-2" title={`${relevanceLabel}: ${rank.toFixed(3)}`}>
        <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary/60" style={{ width: `${widthPct}%` }} />
        </div>
        <span className="text-overline tabular-nums text-muted-foreground">{rank.toFixed(2)}</span>
      </div>
    </div>
  );
}
