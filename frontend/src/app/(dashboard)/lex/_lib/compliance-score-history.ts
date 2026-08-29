/**
 * Tenant-scoped compliance-score history (localStorage trend).
 *
 * Single store shared by the compliance page trend (`compliance/page.tsx`) and
 * the command-center hero posture panel (`_components/command-hero.tsx`), which
 * previously kept two forked copies under two different localStorage keys (and
 * two point shapes). Points are recorded per tenant under
 * `lex.compliance.scoreHistory.<tenantId>` with shape `{ at: ISO string, score }`.
 *
 * On first read, any points found under the legacy keys
 * (`lex.compliance.scoreHistory` — `{at, score}` — and
 * `lex.compliance-score-history` — `{date, score}`) are merged into the
 * tenant-scoped key and the legacy keys are removed.
 *
 * SSR-safe (no-op without a window) and resilient to malformed values / storage
 * failures (private mode / quota) — the trend is best-effort.
 */

export interface ComplianceScorePoint {
  /** ISO timestamp the score was recorded. */
  at: string;
  score: number;
}

const COMPLIANCE_SCORE_HISTORY_MAX = 12;

/** Legacy key formerly used by `compliance/page.tsx` (points shaped {at, score}). */
const LEGACY_PAGE_KEY = 'lex.compliance.scoreHistory';
/** Legacy key formerly used by the hero (points shaped {date, score}). */
const LEGACY_HERO_KEY = 'lex.compliance-score-history';

function storageKey(tenantId: string): string {
  return `lex.compliance.scoreHistory.${tenantId || 'default'}`;
}

/** Parses a raw localStorage value into valid {at, score} points (empty on failure). */
function parsePoints(raw: string | null): ComplianceScorePoint[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry): ComplianceScorePoint[] => {
      if (typeof entry !== 'object' || entry === null) {
        return [];
      }
      const { at, date, score } = entry as { at?: unknown; date?: unknown; score?: unknown };
      if (typeof score !== 'number' || Number.isNaN(score)) {
        return [];
      }
      // Accept both the canonical {at} shape and the legacy hero {date} shape.
      if (typeof at === 'string') {
        return [{ at, score }];
      }
      if (typeof date === 'string') {
        return [{ at: date, score }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

/**
 * Merges any legacy (pre-tenant-scoping) histories into the tenant-scoped key,
 * then removes the legacy keys. Runs at most once per key pair (subsequent
 * reads find no legacy keys). Returns the merged, chronologically sorted series.
 */
function readWithMigration(tenantId: string): ComplianceScorePoint[] {
  const key = storageKey(tenantId);
  const current = parsePoints(window.localStorage.getItem(key));

  const legacyRaw = [
    window.localStorage.getItem(LEGACY_PAGE_KEY),
    window.localStorage.getItem(LEGACY_HERO_KEY),
  ];
  if (legacyRaw.every((raw) => raw === null)) {
    return current;
  }

  const legacy = legacyRaw.flatMap(parsePoints);
  // Merge, dropping legacy points that duplicate an existing timestamp.
  const seen = new Set(current.map((point) => point.at));
  const merged = [...current, ...legacy.filter((point) => !seen.has(point.at))]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-COMPLIANCE_SCORE_HISTORY_MAX);
  try {
    window.localStorage.setItem(key, JSON.stringify(merged));
    window.localStorage.removeItem(LEGACY_PAGE_KEY);
    window.localStorage.removeItem(LEGACY_HERO_KEY);
  } catch {
    // Storage unavailable — serve the merged series in-memory only.
  }
  return merged;
}

/**
 * Reads the tenant's recorded score series (oldest first), migrating any legacy
 * unscoped histories on first read. Returns [] on the server.
 */
export function readComplianceScoreHistory(tenantId: string): ComplianceScorePoint[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    return readWithMigration(tenantId);
  } catch {
    return [];
  }
}

/**
 * Records `score` for `tenantId`: appends a new point per UTC day, replaces
 * today's point when the score changed, and no-ops when today's point already
 * carries the same score. Caps the series at {@link COMPLIANCE_SCORE_HISTORY_MAX}
 * and returns the resulting series so callers can render it directly.
 */
export function recordComplianceScore(
  tenantId: string,
  score: number,
): ComplianceScorePoint[] {
  if (typeof window === 'undefined') {
    return [];
  }
  const rounded = Math.round(score);
  const history = readComplianceScoreHistory(tenantId);
  const last = history[history.length - 1];
  const today = new Date().toISOString().slice(0, 10);
  const lastDay = last ? last.at.slice(0, 10) : null;
  if (last && lastDay === today && last.score === rounded) {
    return history;
  }
  const point: ComplianceScorePoint = { at: new Date().toISOString(), score: rounded };
  const next = (
    last && lastDay === today ? [...history.slice(0, -1), point] : [...history, point]
  ).slice(-COMPLIANCE_SCORE_HISTORY_MAX);
  try {
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(next));
  } catch {
    // Ignore storage failures (private mode / quota) — trend is best-effort.
  }
  return next;
}
