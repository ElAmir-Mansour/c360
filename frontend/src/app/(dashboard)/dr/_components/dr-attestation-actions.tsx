'use client';

import {
  AlertTriangle,
  Anchor,
  CheckCircle2,
  FileKey2,
  Fingerprint,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type {
  DRAttestationLedgerCheckpoint,
  DRAttestationLedgerEntry,
  DRAttestationLedgerInclusionProof,
  DRAttestationLedgerVerifyResult,
  DRJsonValue,
} from '@/types/clario-dr';

export type DRAttestationActionsPanelProps = {
  entries: DRAttestationLedgerEntry[];
  verification?: DRAttestationLedgerVerifyResult | null;
  proof?: DRAttestationLedgerInclusionProof | null;
  checkpoint?: DRAttestationLedgerCheckpoint | null;
  selectedSeq?: number | null;
  loading: boolean;
  proofLoading: boolean;
  anchorLoading: boolean;
  error: unknown;
  onSelectSeq: (seq: number) => void;
  onFetchProof: (seq: number) => void;
  onAnchor: () => void;
  onRetry: () => void;
};

export function DRAttestationActionsPanel({
  entries,
  verification,
  proof,
  checkpoint,
  selectedSeq,
  loading,
  proofLoading,
  anchorLoading,
  error,
  onSelectSeq,
  onFetchProof,
  onAnchor,
  onRetry,
}: DRAttestationActionsPanelProps) {
  if (loading && entries.length === 0 && !verification && !checkpoint && !proof) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && entries.length === 0 && !verification && !checkpoint && !proof) {
    return <ErrorState message="Failed to load DR attestation ledger data." onRetry={onRetry} />;
  }

  const sortedEntries = [...entries].sort((left, right) => right.seq - left.seq);
  const latestEntry = sortedEntries[0] ?? null;
  const hasSelectedSeq = selectedSeq !== undefined && selectedSeq !== null;
  const selectedEntry = hasSelectedSeq ? entries.find((entry) => entry.seq === selectedSeq) ?? null : null;
  const latestAnchoredEntry = sortedEntries.find((entry) => Boolean(entry.anchored_root)) ?? null;
  const verificationStatus = verification?.intact === true
    ? 'healthy'
    : verification?.intact === false
      ? 'failed'
      : 'pending';
  const checkpointVisibleEntries = checkpoint
    ? entries.filter((entry) => entry.seq >= checkpoint.from_seq && entry.seq <= checkpoint.to_seq).length
    : entries.filter((entry) => entry.anchored_root).length;
  const checkpointCoverage = entries.length > 0
    ? Math.round((checkpointVisibleEntries / entries.length) * 100)
    : 0;
  const unanchoredEntries = latestEntry
    ? checkpoint
      ? entries.filter((entry) => entry.seq > checkpoint.to_seq).length
      : entries.length
    : 0;
  const anchorReady = verification?.intact === true && entries.length > 0 && unanchoredEntries > 0;
  const anchorLabel = anchorLoading
    ? 'Anchoring'
    : entries.length === 0
      ? 'No entries'
      : verification?.intact !== true
        ? 'Verify first'
        : unanchoredEntries === 0
          ? 'Anchored'
          : 'Anchor ledger';
  const proofMatchesSelection = Boolean(proof && hasSelectedSeq && proof.seq === selectedSeq);
  const proofMatchesCheckpoint = Boolean(
    proof &&
      checkpoint &&
      proof.root === checkpoint.merkle_root &&
      proof.from_seq === checkpoint.from_seq &&
      proof.to_seq === checkpoint.to_seq,
  );

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{formatError(error)}</span>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AttestationMetric
          title="Verification"
          value={verification?.intact === true ? 'intact' : verification?.intact === false ? 'broken' : 'pending'}
          detail={verification ? `${verification.entries_checked} entries checked` : 'No verification result'}
          icon={ShieldCheck}
          tone={verification?.intact === true ? 'success' : verification?.intact === false ? 'critical' : 'warning'}
        />
        <AttestationMetric
          title="Ledger head"
          value={latestEntry ? `seq ${latestEntry.seq}` : 'n/a'}
          detail={latestEntry ? `${latestEntry.entry_type} / ${shortHash(latestEntry.entry_hash)}` : 'No entries returned'}
          icon={GitCommitHorizontal}
          tone={latestEntry ? 'info' : 'neutral'}
        />
        <AttestationMetric
          title="Checkpoint"
          value={checkpoint ? `seq ${checkpoint.to_seq}` : 'none'}
          detail={checkpoint ? `${checkpoint.entry_count} entries / ${shortHash(checkpoint.merkle_root)}` : 'No anchored checkpoint returned'}
          icon={Anchor}
          tone={checkpoint ? 'success' : entries.length > 0 ? 'warning' : 'neutral'}
        />
        <AttestationMetric
          title="Proof"
          value={proof ? `seq ${proof.seq}` : hasSelectedSeq ? selectedSeq : 'n/a'}
          detail={proof ? `${proof.path.length} Merkle path nodes` : hasSelectedSeq ? 'Proof not loaded' : 'Select a ledger sequence'}
          icon={FileKey2}
          tone={proof ? 'success' : hasSelectedSeq ? 'warning' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Attestation ledger</CardTitle>
              <CardDescription>Hash-chained DR attestation events with per-entry inclusion proof actions.</CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {loading ? <StatusBadge status="pending" label="refreshing" /> : null}
              <StatusBadge status={verificationStatus} label={verification?.intact === true ? 'verified' : verification?.intact === false ? 'broken' : 'pending'} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seq</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Payload</TableHead>
                    <TableHead>Chain</TableHead>
                    <TableHead>Anchor</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Proof</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-sm text-muted-foreground">
                        No attestation ledger entries returned.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedEntries.map((entry) => {
                      const selected = entry.seq === selectedSeq;
                      const rowProofLoading = proofLoading && selected;

                      return (
                        <TableRow key={entry.id} data-state={selected ? 'selected' : undefined}>
                          <TableCell>
                            <Button
                              type="button"
                              size="sm"
                              variant={selected ? 'secondary' : 'ghost'}
                              className="h-8 px-2 font-mono text-xs"
                              onClick={() => onSelectSeq(entry.seq)}
                            >
                              {entry.seq}
                            </Button>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="max-w-[12rem] normal-case tracking-normal">
                                <span className="truncate">{labelFor(entry.entry_type)}</span>
                              </Badge>
                            </div>
                            <div className="mt-1 max-w-[18rem] truncate font-mono text-xs text-muted-foreground">
                              {entry.subject_id}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[18rem] truncate text-sm">{summarizePayload(entry.payload)}</div>
                            <div className="mt-1 font-mono text-xs text-muted-foreground">{shortHash(entry.payload_hash)}</div>
                          </TableCell>
                          <TableCell>
                            <div className="font-mono text-xs">{shortHash(entry.entry_hash)}</div>
                            <div className="mt-1 font-mono text-xs text-muted-foreground">prev {shortHash(entry.prev_hash)}</div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              status={entry.anchored_root || (checkpoint && entry.seq >= checkpoint.from_seq && entry.seq <= checkpoint.to_seq) ? 'anchored' : 'pending'}
                              label={entry.anchored_root || (checkpoint && entry.seq >= checkpoint.from_seq && entry.seq <= checkpoint.to_seq) ? 'anchored' : 'pending'}
                            />
                            <div className="mt-1 font-mono text-xs text-muted-foreground">
                              {shortHash(entry.anchored_root ?? (checkpoint && entry.seq >= checkpoint.from_seq && entry.seq <= checkpoint.to_seq ? checkpoint.merkle_root : null))}
                            </div>
                          </TableCell>
                          <TableCell>{formatDateTime(entry.created_at)}</TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              size="sm"
                              variant={selected && proof ? 'secondary' : 'outline'}
                              disabled={rowProofLoading}
                              onClick={() => {
                                onSelectSeq(entry.seq);
                                onFetchProof(entry.seq);
                              }}
                            >
                              {rowProofLoading ? (
                                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <FileKey2 className="me-1.5 h-3.5 w-3.5" />
                              )}
                              {rowProofLoading ? 'Loading' : selected && proof ? 'Refresh' : 'Proof'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Verification status</CardTitle>
              <CardDescription>Chain continuity and current head hash for the visible ledger window.</CardDescription>
            </div>
            <StatusBadge status={verificationStatus} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MiniDatum label="Checked" value={verification?.entries_checked ?? 0} />
              <MiniDatum label="Broken seq" value={verification?.first_broken_seq ?? 'none'} />
              <MiniDatum label="Reason" value={verification?.reason ?? (verification?.intact ? 'chain intact' : 'not verified')} />
              <MiniDatum label="Head" value={shortHash(verification?.head_hash)} />
            </div>
            <ReadinessLine
              icon={ShieldCheck}
              label="Hash-chain verification"
              ready={verification?.intact === true}
              detail={verification?.reason ?? (verification?.intact ? 'All checked entries link to the expected head.' : 'Verification has not returned an intact chain.')}
            />
            <ReadinessLine
              icon={Fingerprint}
              label="Selected proof target"
              ready={Boolean(selectedEntry)}
              detail={selectedEntry ? `seq ${selectedEntry.seq} / ${labelFor(selectedEntry.entry_type)}` : 'Select a sequence from the ledger table.'}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Inclusion proof</CardTitle>
              <CardDescription>Selected Merkle path, root, and checkpoint span for ledger inclusion checks.</CardDescription>
            </div>
            <StatusBadge
              status={proofMatchesSelection ? (proofMatchesCheckpoint ? 'healthy' : 'warning') : proof ? 'warning' : 'pending'}
              label={proofMatchesSelection ? (proofMatchesCheckpoint ? 'checkpoint match' : 'proof loaded') : proof ? 'seq mismatch' : 'pending'}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label="Selected" value={selectedSeq ?? 'none'} />
              <MiniDatum label="Proof seq" value={proof?.seq ?? 'n/a'} />
              <MiniDatum label="Leaf index" value={proof?.leaf_index ?? 'n/a'} />
              <MiniDatum label="Path nodes" value={proof?.path.length ?? 0} />
            </div>

            {proof ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <HashBox label="Leaf hash" value={proof.leaf_hash} />
                  <HashBox label="Merkle root" value={proof.root} />
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Checkpoint span</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        seq {proof.from_seq}-{proof.to_seq}
                      </div>
                    </div>
                    <StatusBadge status={proofMatchesCheckpoint ? 'healthy' : 'warning'} label={proofMatchesCheckpoint ? 'root matched' : 'compare root'} />
                  </div>
                </div>
                <div className="space-y-2">
                  {proof.path.length === 0 ? (
                    <EmptyLine icon={CheckCircle2} text="No sibling nodes required; the selected leaf is the checkpoint root." />
                  ) : (
                    proof.path.map((node, index) => (
                      <div key={`${node.hash}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase text-muted-foreground">Node {index + 1}</div>
                          <div className="mt-1 truncate font-mono text-xs">{node.hash}</div>
                        </div>
                        <Badge variant="outline" className="shrink-0 normal-case tracking-normal">
                          {node.left ? 'left sibling' : 'right sibling'}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <EmptyLine
                  icon={FileKey2}
                  text={hasSelectedSeq ? `No inclusion proof loaded for seq ${selectedSeq}.` : 'Select a sequence to inspect its inclusion proof.'}
                />
                {hasSelectedSeq ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={proofLoading}
                    onClick={() => onFetchProof(selectedSeq)}
                  >
                    {proofLoading ? (
                      <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <FileKey2 className="me-1.5 h-4 w-4" />
                    )}
                    {proofLoading ? 'Loading proof' : 'Fetch proof'}
                  </Button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Anchor readiness</CardTitle>
              <CardDescription>Latest checkpoint, WORM object metadata, and readiness to anchor new ledger entries.</CardDescription>
            </div>
            <StatusBadge status={anchorReady ? 'ready' : unanchoredEntries === 0 && checkpoint ? 'anchored' : 'pending'} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label="Window" value={checkpoint ? `${checkpoint.from_seq}-${checkpoint.to_seq}` : 'n/a'} />
              <MiniDatum label="Entries" value={checkpoint?.entry_count ?? 0} />
              <MiniDatum label="Root" value={shortHash(checkpoint?.merkle_root ?? latestAnchoredEntry?.anchored_root)} />
              <MiniDatum label="Created" value={formatDateTime(checkpoint?.created_at ?? latestAnchoredEntry?.created_at)} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-muted-foreground">Visible checkpoint coverage</span>
                <span className="font-semibold">{checkpointCoverage}%</span>
              </div>
              <Progress
                value={checkpointCoverage}
                className="h-2"
                indicatorClassName={checkpointCoverage < 100 ? 'bg-amber-500' : 'bg-primary'}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <HashBox label="WORM object" value={checkpoint?.worm_object_key ?? 'n/a'} compact />
              <HashBox label="WORM version" value={checkpoint?.worm_version_id ?? 'n/a'} compact />
            </div>

            <div className="space-y-2">
              <ReadinessLine
                icon={GitCommitHorizontal}
                label="Ledger entries present"
                ready={entries.length > 0}
                detail={entries.length > 0 ? `${entries.length} visible entries, latest seq ${latestEntry?.seq}` : 'No entries returned.'}
              />
              <ReadinessLine
                icon={ShieldCheck}
                label="Ledger verified"
                ready={verification?.intact === true}
                detail={verification?.intact === true ? 'Verification is intact.' : verification?.reason ?? 'Verification result is required before anchoring.'}
              />
              <ReadinessLine
                icon={Anchor}
                label="New entries to anchor"
                ready={unanchoredEntries > 0}
                detail={checkpoint ? `${unanchoredEntries} visible entries after checkpoint seq ${checkpoint.to_seq}.` : `${unanchoredEntries} visible entries awaiting first checkpoint.`}
              />
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={!anchorReady || anchorLoading}
              onClick={onAnchor}
            >
              {anchorLoading ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Anchor className="me-1.5 h-4 w-4" />
              )}
              {anchorLabel}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AttestationMetric({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral';
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-overline font-semibold uppercase text-muted-foreground">{title}</div>
            <div className="mt-3 truncate text-3xl font-semibold tracking-tight">{value}</div>
          </div>
          <div className={cn('rounded-lg p-2.5', toneClass(tone, 'soft'))}>
            <Icon className={cn('h-5 w-5', toneClass(tone, 'text'))} />
          </div>
        </div>
        <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

function ReadinessLine({
  icon: Icon,
  label,
  ready,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  ready: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2">
      <div className={cn('mt-0.5 rounded-lg p-1.5', ready ? 'bg-primary/10 text-primary' : 'bg-amber-50 text-warning-700 dark:bg-amber-950/25 dark:text-warning-300')}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{label}</div>
          <StatusBadge status={ready ? 'ready' : 'pending'} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function MiniDatum({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function HashBox({
  label,
  value,
  compact = false,
}: {
  label: string;
  value?: string | null;
  compact?: boolean;
}) {
  return (
    <div className={cn('min-w-0 rounded-lg border bg-muted/20 px-3 py-2', !compact && 'py-3')}>
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value || 'n/a'}</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error'
      ? 'destructive'
      : normalized === 'warning' || normalized === 'pending'
        ? 'warning'
        : normalized === 'healthy' || normalized === 'verified' || normalized === 'ready' || normalized === 'anchored'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case tracking-normal">
      <span className="truncate">{label ?? labelFor(normalized)}</span>
    </Badge>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function toneClass(tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral', part: 'soft' | 'text') {
  const styles = {
    success: { soft: 'bg-primary/10', text: 'text-primary' },
    warning: { soft: 'bg-amber-50 dark:bg-amber-950/25', text: 'text-warning-700 dark:text-warning-300' },
    critical: { soft: 'bg-error-50 dark:bg-error-700/25', text: 'text-error-700 dark:text-error-300' },
    info: { soft: 'bg-sky-50 dark:bg-sky-950/25', text: 'text-sky-700 dark:text-sky-300' },
    neutral: { soft: 'bg-muted', text: 'text-muted-foreground' },
  } as const;
  return styles[tone][part];
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(value: string) {
  return value.replace(/_/g, ' ');
}

function summarizePayload(payload: DRJsonValue) {
  if (payload === null) return 'null payload';
  if (Array.isArray(payload)) return `${payload.length} item${payload.length === 1 ? '' : 's'}`;
  if (typeof payload === 'object') {
    const keys = Object.keys(payload);
    if (keys.length === 0) return 'empty object';
    return keys.length > 3 ? `${keys.slice(0, 3).join(', ')} +${keys.length - 3}` : keys.join(', ');
  }
  return String(payload);
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function formatError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return 'Failed to refresh DR attestation ledger data.';
}
