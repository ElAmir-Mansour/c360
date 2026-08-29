'use client';

import { useId, useMemo } from 'react';
import {
  ArrowDownLeft,
  ArrowDownRight,
  CheckCircle2,
  FileKey2,
  Fingerprint,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DRAttestationLedgerInclusionProof } from '@/types/clario-dr';
import { verifyInclusionProof } from './ledger-format';
import type { LedgerExplorerCopy } from './ledger-labels';

export interface InclusionProofDetailProps {
  copy: LedgerExplorerCopy;
  proof: DRAttestationLedgerInclusionProof | null | undefined;
  /** Sequence the operator selected (may differ from a stale proof's seq). */
  selectedSeq: number | null;
  loading: boolean;
}

export function InclusionProofDetail({
  copy,
  proof,
  selectedSeq,
  loading,
}: InclusionProofDetailProps) {
  const headingId = useId();
  const verification = useMemo(() => verifyInclusionProof(proof), [proof]);

  // The proof is only meaningful for the currently selected sequence.
  const proofMatchesSelection =
    Boolean(proof) && (selectedSeq === null || proof?.seq === selectedSeq);
  const showProof = Boolean(proof) && proofMatchesSelection;

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle id={headingId} className="flex items-center gap-2 text-base">
            <FileKey2 className="h-4 w-4 shrink-0" aria-hidden />
            {copy.proofHeading}
          </CardTitle>
          <CardDescription>{copy.proofDescription}</CardDescription>
        </div>
        {showProof ? (
          <Badge
            variant={verification.verified ? 'success' : 'warning'}
            className="shrink-0 normal-case tracking-normal"
          >
            <CheckCircle2 className="me-1 h-3.5 w-3.5" aria-hidden />
            {verification.verified ? copy.proofVerifiedBadge : copy.proofUnverifiedBadge}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            <span>{copy.tableProofLoading}</span>
          </div>
        ) : showProof && proof ? (
          <>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Datum label={copy.proofSelectedSeq} value={proof.seq} />
              <Datum label={copy.proofLeafIndex} value={proof.leaf_index} />
              <Datum label={copy.proofPathNodes} value={proof.path.length} />
              <Datum
                label={copy.proofWindow}
                value={`${proof.from_seq}–${proof.to_seq}`}
              />
            </dl>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <HashBox
                label={copy.proofLeafHash}
                value={proof.leaf_hash}
                naLabel={copy.notAvailable}
              />
              <HashBox label={copy.proofRoot} value={proof.root} naLabel={copy.notAvailable} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {copy.proofRecompute}
              </div>
              {proof.path.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{copy.proofNoSiblings}</span>
                </div>
              ) : (
                <ol className="space-y-2">
                  {proof.path.map((node, index) => {
                    const SiblingIcon = node.left ? ArrowDownLeft : ArrowDownRight;
                    const siblingLabel = node.left
                      ? copy.proofLeftSibling
                      : copy.proofRightSibling;
                    return (
                      <li
                        key={`${node.hash}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {copy.proofNode} {index + 1}
                          </div>
                          <div className="mt-1 truncate font-mono text-xs">{node.hash}</div>
                        </div>
                        <Badge
                          variant="outline"
                          className="shrink-0 gap-1 normal-case tracking-normal"
                        >
                          <SiblingIcon className="h-3.5 w-3.5" aria-hidden />
                          {siblingLabel}
                        </Badge>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-6 text-sm text-muted-foreground">
            <FileKey2 className="h-4 w-4 shrink-0" aria-hidden />
            <span>{copy.proofEmpty}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Datum({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate font-medium">{value}</dd>
    </div>
  );
}

function HashBox({
  label,
  value,
  naLabel,
}: {
  label: string;
  value?: string | null;
  naLabel: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-all font-mono text-xs">{value || naLabel}</div>
    </div>
  );
}
