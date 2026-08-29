'use client';

import { useId, useMemo } from 'react';
import { Anchor, GitCommitHorizontal, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type {
  DRAttestationLedgerCheckpoint,
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
} from '@/types/clario-dr';
import {
  countUnanchored,
  deriveAnchorWindows,
  formatLedgerTimestamp,
  shortHash,
  type DerivedAnchorWindow,
} from './ledger-format';
import type { LedgerExplorerCopy } from './ledger-labels';

export interface AnchorTimelineProps {
  copy: LedgerExplorerCopy;
  /** Full fetched ledger window (NOT the seq-filtered subset) for accurate anchoring. */
  entries: DRAttestationLedgerEntry[];
  verification: DRAttestationLedgerVerifyResult | null | undefined;
  /** Freshly created checkpoint from the anchor action (may be ahead of the entries). */
  latestCheckpoint: DRAttestationLedgerCheckpoint | null | undefined;
  anchorLoading: boolean;
  /** dr:write verdict — drives whether the anchor control is operable. */
  canWrite: boolean;
  onAnchor: () => void;
}

export function AnchorTimeline({
  copy,
  entries,
  verification,
  latestCheckpoint,
  anchorLoading,
  canWrite,
  onAnchor,
}: AnchorTimelineProps) {
  const headingId = useId();

  const derivedWindows = useMemo(() => deriveAnchorWindows(entries), [entries]);
  const unanchoredCount = useMemo(() => countUnanchored(entries), [entries]);

  // Merge the freshly-anchored checkpoint into the timeline if it is not already
  // represented by an entry's anchored_root (the entries list may lag the anchor).
  const windows: DerivedAnchorWindow[] = useMemo(() => {
    if (!latestCheckpoint) return derivedWindows;
    const alreadyPresent = derivedWindows.some(
      (window) => window.root === latestCheckpoint.merkle_root,
    );
    if (alreadyPresent) return derivedWindows;
    const fromCheckpoint: DerivedAnchorWindow = {
      root: latestCheckpoint.merkle_root,
      fromSeq: latestCheckpoint.from_seq,
      toSeq: latestCheckpoint.to_seq,
      entryCount: latestCheckpoint.entry_count,
      latestCreatedAt: latestCheckpoint.created_at ?? null,
    };
    return [fromCheckpoint, ...derivedWindows].sort((a, b) => b.toSeq - a.toSeq);
  }, [derivedWindows, latestCheckpoint]);

  const verified = verification?.intact === true;
  const anchorReady = canWrite && verified && entries.length > 0 && unanchoredCount > 0;

  const anchorLabel = anchorLoading
    ? copy.anchorActionPending
    : entries.length === 0
      ? copy.anchorActionNoEntries
      : !verified
        ? copy.anchorActionVerifyFirst
        : unanchoredCount === 0
          ? copy.anchorActionUpToDate
          : copy.anchorAction;

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle id={headingId} className="flex items-center gap-2 text-base">
            <Anchor className="h-4 w-4 shrink-0" aria-hidden />
            {copy.anchorHeading}
          </CardTitle>
          <CardDescription>{copy.anchorDescription}</CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={!anchorReady || anchorLoading}
          onClick={onAnchor}
        >
          {anchorLoading ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Anchor className="me-1.5 h-4 w-4" aria-hidden />
          )}
          {anchorLabel}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canWrite ? (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            {copy.anchorReadOnlyNotice}
          </p>
        ) : null}

        {/* Pending window: entries awaiting the next checkpoint. */}
        <div className="rounded-lg border bg-muted/20 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitCommitHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              {copy.anchorPendingWindow}
            </div>
            <Badge variant={unanchoredCount > 0 ? 'warning' : 'outline'} className="normal-case tracking-normal">
              {unanchoredCount} {copy.anchorPendingEntries}
            </Badge>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {copy.anchorTimelineHeading}
          </div>
          {windows.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
              <Anchor className="h-4 w-4 shrink-0" aria-hidden />
              <span>{copy.anchorTimelineEmpty}</span>
            </div>
          ) : (
            <ol className="space-y-2">
              {windows.map((window, index) => (
                <li
                  key={window.root}
                  className="rounded-lg border px-3 py-2.5"
                  aria-current={index === 0 ? 'true' : undefined}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span
                        className="inline-flex h-2 w-2 shrink-0 rounded-full bg-primary"
                        aria-hidden
                      />
                      {copy.anchorWindow} {window.fromSeq}–{window.toSeq}
                    </div>
                    {index === 0 ? (
                      <Badge variant="success" className="normal-case tracking-normal">
                        {copy.anchorLatestCheckpoint}
                      </Badge>
                    ) : null}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Datum label={copy.anchorEntries} value={window.entryCount} />
                    <Datum
                      label={copy.anchorRoot}
                      value={shortHash(window.root, copy.notAvailable)}
                      mono
                    />
                    <Datum
                      label={copy.anchorCreated}
                      value={formatLedgerTimestamp(window.latestCreatedAt, copy.notAvailable)}
                    />
                  </dl>
                </li>
              ))}
            </ol>
          )}
        </div>

        {latestCheckpoint ? (
          <div className="rounded-lg border bg-muted/20 px-3 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {copy.anchorLatestCheckpoint}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Datum
                label={copy.anchorWindow}
                value={`${latestCheckpoint.from_seq}–${latestCheckpoint.to_seq}`}
              />
              <Datum label={copy.anchorEntries} value={latestCheckpoint.entry_count} />
              <Datum
                label={copy.anchorWormObject}
                value={latestCheckpoint.worm_object_key ?? copy.notAvailable}
                mono
              />
              <Datum
                label={copy.anchorWormVersion}
                value={latestCheckpoint.worm_version_id ?? copy.notAvailable}
                mono
              />
            </dl>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Datum({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={['mt-1 truncate font-medium', mono ? 'font-mono text-xs' : ''].filter(Boolean).join(' ')}>
        {value}
      </dd>
    </div>
  );
}
