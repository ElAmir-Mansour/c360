export type MetadataRecord = Record<string, unknown> | null | undefined;

export type EvidenceCourtStatus = 'pending' | 'submitted' | 'admitted' | 'rejected' | 'withdrawn';
export type FilingDirection = 'incoming' | 'outgoing' | 'internal';
export type DecisionImpact = 'positive' | 'negative' | 'neutral' | 'mixed';

export function metadataText(metadata: MetadataRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function metadataNumber(metadata: MetadataRecord, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function metadataObject(metadata: MetadataRecord, key: string): MetadataRecord {
  const value = metadata?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function recordText(value: unknown, ...keys: string[]): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return metadataText(value as Record<string, unknown>, ...keys);
}

export function recordMetadata(value: unknown): MetadataRecord {
  if (!value || typeof value !== 'object') return undefined;
  const metadata = (value as Record<string, unknown>).metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : undefined;
}

export function resolveRecordText(value: unknown, ...keys: string[]): string | undefined {
  return recordText(value, ...keys) ?? metadataText(recordMetadata(value), ...keys);
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export interface EvidenceSummaryInput {
  status?: string | null;
  category?: string | null;
  strength?: number | null;
}

export function buildEvidenceSummary(items: EvidenceSummaryInput[]) {
  const admitted = items.filter((item) => item.status === 'admitted').length;
  const underReview = items.filter((item) => item.status === 'pending' || item.status === 'submitted').length;
  const challenged = items.filter((item) => item.status === 'rejected' || item.status === 'withdrawn').length;
  const scored = items
    .map((item) => item.strength)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const strength = scored.length
    ? clampPercent(scored.reduce((sum, value) => sum + value, 0) / scored.length)
    : items.length
      ? clampPercent(((admitted * 1 + underReview * 0.55) / items.length) * 100)
      : 0;
  const categories = items.reduce<Record<string, number>>((result, item) => {
    const category = item.category?.trim() || 'uncategorized';
    result[category] = (result[category] ?? 0) + 1;
    return result;
  }, {});

  return { total: items.length, admitted, underReview, challenged, strength, categories };
}

export interface FilingSummaryInput {
  direction?: string | null;
  status?: string | null;
  responseDeadline?: string | null;
  title: string;
}

export function buildFilingSummary(items: FilingSummaryInput[], now = new Date()) {
  const outgoing = items.filter((item) => item.direction === 'outgoing').length;
  const incoming = items.filter((item) => item.direction === 'incoming').length;
  const decided = items.filter((item) => ['approved', 'filed', 'rejected'].includes(item.status ?? ''));
  const approved = decided.filter((item) => ['approved', 'filed'].includes(item.status ?? '')).length;
  const acceptanceRate = decided.length ? Math.round((approved / decided.length) * 100) : 0;
  const deadlines = items
    .filter((item) => item.responseDeadline && Number.isFinite(new Date(item.responseDeadline).getTime()))
    .filter((item) => new Date(item.responseDeadline as string).getTime() >= now.getTime())
    .sort(
      (left, right) =>
        new Date(left.responseDeadline as string).getTime() -
        new Date(right.responseDeadline as string).getTime(),
    );

  return { total: items.length, outgoing, incoming, acceptanceRate, deadlines };
}

export interface DecisionSummaryInput {
  impact?: string | null;
  nextExpectedRulingAt?: string | null;
  nextExpectedRuling?: string | null;
}

export function buildDecisionSummary(items: DecisionSummaryInput[]) {
  const positive = items.filter((item) => item.impact === 'positive').length;
  const negative = items.filter((item) => item.impact === 'negative').length;
  const neutral = items.filter((item) => item.impact === 'neutral' || item.impact === 'mixed').length;
  const score = positive - negative;
  const trajectory: DecisionImpact = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  const next = [...items]
    .filter(
      (item) =>
        item.nextExpectedRulingAt &&
        Number.isFinite(new Date(item.nextExpectedRulingAt).getTime()),
    )
    .sort(
      (left, right) =>
        new Date(left.nextExpectedRulingAt as string).getTime() -
        new Date(right.nextExpectedRulingAt as string).getTime(),
    )[0];

  return { total: items.length, positive, negative, neutral, trajectory, next };
}
