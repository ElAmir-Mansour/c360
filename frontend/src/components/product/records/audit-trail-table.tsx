'use client';

import * as React from 'react';
import {
  Anchor,
  FileCheck2,
  Fingerprint,
  Link2,
  Link2Off,
  ShieldCheck,
  ShieldX,
  type LucideIcon,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { IconBadge } from '@/components/shared/icon-badge';
import { EmptyState } from '@/components/common/empty-state';
import { StatusChip, type StatusChipProps } from '@/components/shared/status-chip';
import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import type {
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
} from '@/types/clario-dr';
import { formatInteger, formatTimestamp, shortenHash } from './format';

/**
 * AuditTrailTable
 * ===============
 * Renders the ClarioDR immutable attestation trail: a hash-chained ledger where
 * every entry links to its predecessor via `prev_hash`/`entry_hash`. The table
 * surfaces the cryptographic spine (seq, entry_type, subject, payload hash,
 * chain links, anchored Merkle root, timestamp) and a per-row verification
 * verdict driven by the ledger-wide verify result.
 *
 * Real contract: typed to `DRAttestationLedgerEntry` (lib/clario-dr
 * `fetchDRAttestationLedger`) and `DRAttestationLedgerVerifyResult`
 * (`verifyDRAttestationLedger`). The verify result's `first_broken_seq` flags
 * the exact entry where the chain diverged; rows at or after that sequence are
 * shown as broken so tamper evidence is never conveyed by color alone.
 *
 * Reflow (WCAG 1.4.10): below 640px the data table is replaced by a
 * stacked-card list of the same entries, so no horizontal scrolling of the
 * dense grid is required on small viewports.
 *
 * Token-driven only; bilingual-ready via the `labels` prop; RTL-aware.
 */

/** Verdict for a single ledger row, derived from the ledger verify result. */
export type AuditChainVerdict = 'intact' | 'broken' | 'unverified';

/** Per-entry-type presentation: an accessible label + a token-toned icon. */
export interface AuditEntryTypeMeta {
  label: string;
  icon: LucideIcon;
  tone: NonNullable<StatusChipProps['tone']>;
}

export interface AuditTrailLabels {
  /** Accessible name for the table region / `<caption>`. */
  caption: string;
  /** Column headers (also used as field labels in the stacked-card fallback). */
  columnSeq: string;
  columnType: string;
  columnSubject: string;
  columnPayloadHash: string;
  columnChain: string;
  columnAnchor: string;
  columnTimestamp: string;
  columnVerification: string;
  /** Verification verdict chip labels. */
  verdictIntact: string;
  verdictBroken: string;
  verdictUnverified: string;
  /** Chain-link sublabels in the chain cell. */
  prevHashLabel: string;
  entryHashLabel: string;
  /** Shown in the anchor cell when an entry has no Merkle anchor yet. */
  notAnchored: string;
  /** Empty-state copy when the ledger has no entries. */
  emptyTitle: string;
  emptyDescription: string;
}

export interface AuditTrailTableProps {
  /** Hash-chained ledger entries, ascending by `seq` (chain order). */
  entries: DRAttestationLedgerEntry[];
  /**
   * Ledger-wide verification result. When `intact` is false, `first_broken_seq`
   * marks the entry where the chain diverged; that entry and every later entry
   * render the `broken` verdict. When omitted, every row is `unverified`.
   */
  verification?: DRAttestationLedgerVerifyResult;
  /** Bilingual content. Defaults to English. */
  labels?: Partial<AuditTrailLabels>;
  /**
   * Per-entry-type presentation. Falls back to a generic neutral chip for
   * unknown types so a new backend entry_type never crashes the table.
   */
  entryTypeMeta?: Record<string, AuditEntryTypeMeta>;
  className?: string;
}

const DEFAULT_LABELS: AuditTrailLabels = {
  caption: 'Attestation trail',
  columnSeq: 'Seq',
  columnType: 'Entry type',
  columnSubject: 'Subject',
  columnPayloadHash: 'Payload hash',
  columnChain: 'Chain link',
  columnAnchor: 'Anchored root',
  columnTimestamp: 'Recorded',
  columnVerification: 'Verification',
  verdictIntact: 'Intact',
  verdictBroken: 'Chain broken',
  verdictUnverified: 'Unverified',
  prevHashLabel: 'Prev',
  entryHashLabel: 'Entry',
  notAnchored: 'Not anchored',
  emptyTitle: 'No attestation entries yet',
  emptyDescription:
    'Recovery validations, drill and failover attestations, and clean-room verdicts append here as an append-only hash chain.',
};

/** Default presentation for the known backend `entry_type` values. */
const DEFAULT_ENTRY_TYPE_META: Record<string, AuditEntryTypeMeta> = {
  failover_attestation: { label: 'Failover attestation', icon: ShieldCheck, tone: 'primary' },
  drill_attestation: { label: 'Drill attestation', icon: FileCheck2, tone: 'info' },
  recovery_point_validation: { label: 'Recovery point validation', icon: Fingerprint, tone: 'success' },
  cleanroom_verdict: { label: 'Clean-room verdict', icon: ShieldCheck, tone: 'warning' },
  anchor_checkpoint: { label: 'Anchor checkpoint', icon: Anchor, tone: 'neutral' },
};

function resolveEntryTypeMeta(
  entryType: string,
  overrides?: Record<string, AuditEntryTypeMeta>,
): AuditEntryTypeMeta {
  return (
    overrides?.[entryType] ??
    DEFAULT_ENTRY_TYPE_META[entryType] ?? {
      label: entryType,
      icon: FileCheck2,
      tone: 'neutral',
    }
  );
}

/**
 * Compute the per-row verdict from the ledger verify result. A row is `broken`
 * iff the ledger is reported broken AND its sequence is at/after the first
 * broken sequence (tamper invalidates everything downstream of the break).
 */
function rowVerdict(
  seq: number,
  verification: DRAttestationLedgerVerifyResult | undefined,
): AuditChainVerdict {
  if (!verification) {
    return 'unverified';
  }
  if (verification.intact) {
    return 'intact';
  }
  if (verification.first_broken_seq != null && seq >= verification.first_broken_seq) {
    return 'broken';
  }
  return 'intact';
}

const VERDICT_CHIP: Record<
  AuditChainVerdict,
  { tone: NonNullable<StatusChipProps['tone']>; icon: LucideIcon; labelKey: keyof AuditTrailLabels }
> = {
  intact: { tone: 'success', icon: Link2, labelKey: 'verdictIntact' },
  broken: { tone: 'danger', icon: Link2Off, labelKey: 'verdictBroken' },
  unverified: { tone: 'neutral', icon: ShieldX, labelKey: 'verdictUnverified' },
};

function VerificationChip({
  verdict,
  labels,
}: {
  verdict: AuditChainVerdict;
  labels: AuditTrailLabels;
}) {
  const chip = VERDICT_CHIP[verdict];
  return <StatusChip tone={chip.tone} icon={chip.icon} label={labels[chip.labelKey]} />;
}

/** Monospace hash token with a copy-friendly full value in the `title`. */
function HashToken({ value, className }: { value: string | null | undefined; className?: string }) {
  return (
    <span
      dir="ltr"
      title={value ?? undefined}
      className={cn(
        'inline-block font-mono text-caption text-content-secondary',
        className,
      )}
    >
      {shortenHash(value)}
    </span>
  );
}

export function AuditTrailTable({
  entries,
  verification,
  labels: labelOverrides,
  entryTypeMeta,
  className,
}: AuditTrailTableProps) {
  const { locale } = useLocale();
  const labels = React.useMemo<AuditTrailLabels>(
    () => ({ ...DEFAULT_LABELS, ...labelOverrides }),
    [labelOverrides],
  );

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Fingerprint}
        title={labels.emptyTitle}
        description={labels.emptyDescription}
        size="compact"
        className={cn('border border-dashed border-outline-subtle bg-surface-card', className)}
      />
    );
  }

  return (
    <div className={cn('w-full', className)}>
      {/* ≥640px: dense data table. */}
      <div className="hidden rounded-card border border-outline-subtle bg-surface-card sm:block">
        <Table>
          <caption className="sr-only">{labels.caption}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="text-start">{labels.columnSeq}</TableHead>
              <TableHead scope="col" className="text-start">{labels.columnType}</TableHead>
              <TableHead scope="col" className="text-start">{labels.columnSubject}</TableHead>
              <TableHead scope="col" className="text-start">{labels.columnPayloadHash}</TableHead>
              <TableHead scope="col" className="text-start">{labels.columnChain}</TableHead>
              <TableHead scope="col" className="text-start">{labels.columnAnchor}</TableHead>
              <TableHead scope="col" className="text-start">{labels.columnTimestamp}</TableHead>
              <TableHead scope="col" className="text-start">{labels.columnVerification}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const meta = resolveEntryTypeMeta(entry.entry_type, entryTypeMeta);
              const verdict = rowVerdict(entry.seq, verification);
              return (
                <TableRow
                  key={entry.id}
                  data-verdict={verdict}
                  className={cn(
                    verdict === 'broken' && 'bg-state-error/5 hover:bg-state-error/10',
                  )}
                >
                  <TableCell className="align-top">
                    <span className="font-mono text-body-sm font-semibold tabular-nums text-content-primary">
                      {formatInteger(entry.seq, locale)}
                    </span>
                  </TableCell>
                  <TableCell className="align-top">
                    <span className="inline-flex items-center gap-2">
                      <IconBadge icon={meta.icon} tone={meta.tone === 'neutral' ? 'muted' : meta.tone} size="sm" />
                      <span className="text-body-sm font-medium text-content-primary">{meta.label}</span>
                    </span>
                  </TableCell>
                  <TableCell className="align-top">
                    <span
                      dir="ltr"
                      title={entry.subject_id}
                      className="inline-block max-w-[18ch] truncate align-bottom font-mono text-caption text-content-secondary"
                    >
                      {entry.subject_id}
                    </span>
                  </TableCell>
                  <TableCell className="align-top">
                    <HashToken value={entry.payload_hash} />
                  </TableCell>
                  <TableCell className="align-top">
                    <span className="flex flex-col gap-0.5">
                      <span className="inline-flex items-center gap-1">
                        <span className="text-overline font-semibold uppercase tracking-caps-wide text-content-muted">
                          {labels.prevHashLabel}
                        </span>
                        <HashToken value={entry.prev_hash} />
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="text-overline font-semibold uppercase tracking-caps-wide text-content-muted">
                          {labels.entryHashLabel}
                        </span>
                        <HashToken value={entry.entry_hash} />
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="align-top">
                    {entry.anchored_root ? (
                      <span className="inline-flex items-center gap-1">
                        <Anchor className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden />
                        <HashToken value={entry.anchored_root} />
                      </span>
                    ) : (
                      <span className="text-caption text-content-muted">{labels.notAnchored}</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <span className="text-caption text-content-secondary">
                      {formatTimestamp(entry.created_at, locale)}
                    </span>
                  </TableCell>
                  <TableCell className="align-top">
                    <VerificationChip verdict={verdict} labels={labels} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* <640px: stacked-card reflow fallback (WCAG 1.4.10). */}
      <ul className="flex flex-col gap-3 sm:hidden" aria-label={labels.caption}>
        {entries.map((entry) => {
          const meta = resolveEntryTypeMeta(entry.entry_type, entryTypeMeta);
          const verdict = rowVerdict(entry.seq, verification);
          return (
            <li
              key={entry.id}
              data-verdict={verdict}
              className={cn(
                'rounded-card border border-outline-subtle bg-surface-card p-card-padding',
                verdict === 'broken' && 'border-state-error/40 bg-state-error/5',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex items-center gap-2">
                  <IconBadge icon={meta.icon} tone={meta.tone === 'neutral' ? 'muted' : meta.tone} size="sm" />
                  <span className="flex flex-col">
                    <span className="text-body-sm font-semibold text-content-primary">{meta.label}</span>
                    <span className="text-caption text-content-muted">
                      {labels.columnSeq} {formatInteger(entry.seq, locale)}
                    </span>
                  </span>
                </span>
                <VerificationChip verdict={verdict} labels={labels} />
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-caption">
                <div className="flex flex-col gap-0.5">
                  <dt className="font-semibold uppercase tracking-caps text-content-muted">
                    {labels.columnSubject}
                  </dt>
                  <dd>
                    <span dir="ltr" title={entry.subject_id} className="block truncate font-mono text-content-secondary">
                      {entry.subject_id}
                    </span>
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-semibold uppercase tracking-caps text-content-muted">
                    {labels.columnPayloadHash}
                  </dt>
                  <dd><HashToken value={entry.payload_hash} /></dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-semibold uppercase tracking-caps text-content-muted">
                    {labels.prevHashLabel}
                  </dt>
                  <dd><HashToken value={entry.prev_hash} /></dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-semibold uppercase tracking-caps text-content-muted">
                    {labels.entryHashLabel}
                  </dt>
                  <dd><HashToken value={entry.entry_hash} /></dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-semibold uppercase tracking-caps text-content-muted">
                    {labels.columnAnchor}
                  </dt>
                  <dd>
                    {entry.anchored_root ? (
                      <HashToken value={entry.anchored_root} />
                    ) : (
                      <span className="text-content-muted">{labels.notAnchored}</span>
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="font-semibold uppercase tracking-caps text-content-muted">
                    {labels.columnTimestamp}
                  </dt>
                  <dd className="text-content-secondary">{formatTimestamp(entry.created_at, locale)}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default AuditTrailTable;
