'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { DRBreadcrumbs } from '../../_components/console/dr-breadcrumbs';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';
import {
  useDRAttestationLedger,
  useDRLedgerVerify,
} from '../../_hooks/use-dr-queries';
import { useEvidenceActions } from '../../_hooks/use-dr-actions';
import type { DRAttestationLedgerFilters } from '@/types/clario-dr';
import { AnchorTimeline } from './_components/anchor-timeline';
import { InclusionProofDetail } from './_components/inclusion-proof-detail';
import {
  DEFAULT_LEDGER_FILTERS,
  LedgerFilterBar,
  type LedgerExplorerFilters,
} from './_components/ledger-filter-bar';
import { distinctEntryTypes } from './_components/ledger-format';
import { useLedgerExplorerLabels } from './_components/ledger-labels';
import { LedgerTable } from './_components/ledger-table';
import { LedgerVerifyCard } from './_components/ledger-verify-card';

const WRITE_PERMISSION = 'dr:write';

/** Bilingual breadcrumb section labels for the attestation-ledger explorer. */
const ledgerCrumbLabels: DRBilingual<{ prove: string; ledger: string }> = {
  en: { prove: 'Prove', ledger: 'Attestation ledger' },
  ar: { prove: 'الإثبات', ledger: 'سجل التصديق' },
};

/**
 * Attestation ledger explorer (`/dr/prove/ledger`) — a deep-linkable sub-route of
 * Prove dedicated to the immutable, hash-chained DR attestation ledger.
 *
 * Operators filter the ledger by entry type, subject, and sequence range; verify
 * per-entry Merkle inclusion proofs (`fetchDRAttestationLedgerProof`); review the
 * ledger-wide chain verdict (`verifyDRAttestationLedger`, intact / first_broken_seq);
 * and anchor new entries to a WORM checkpoint (`anchorDRAttestationLedger`, gated by
 * `dr:write`). Server-supported filters (type / subject / limit) drive the
 * `useDRAttestationLedger` query key; the seq range is applied client-side over the
 * fetched window because the API exposes no seq-range parameter.
 *
 * Every query/mutation comes from the shared `_hooks`, so cross-route cache and
 * invalidations (e.g. an anchor refreshing the Overview ledger card) stay coherent.
 */
export default function DRLedgerExplorerPage() {
  const copy = useLedgerExplorerLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission(WRITE_PERMISSION);
  const { locale } = useLocaleOrDefault();
  const crumbLabels = resolveDRBilingual(ledgerCrumbLabels, locale);

  // Applied filters (owned here; the filter bar edits a local draft and applies).
  const [filters, setFilters] = useState<LedgerExplorerFilters>(DEFAULT_LEDGER_FILTERS);

  // Server-supported subset of the filters scopes the query (type / subject / limit).
  const serverFilters: DRAttestationLedgerFilters = useMemo(
    () => ({
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.subject ? { subject: filters.subject } : {}),
      limit: filters.limit,
    }),
    [filters.type, filters.subject, filters.limit],
  );

  const ledgerQuery = useDRAttestationLedger(serverFilters);
  const verifyQuery = useDRLedgerVerify();
  const evidence = useEvidenceActions(null);

  const fetchedEntries = useMemo(() => ledgerQuery.data ?? [], [ledgerQuery.data]);

  // The entry-type select offers whatever types the (unfiltered-by-type) window has;
  // derive from fetched entries so it reflects real data.
  const entryTypeOptions = useMemo(() => distinctEntryTypes(fetchedEntries), [fetchedEntries]);

  // Seq range is applied client-side over the fetched, server-filtered window.
  const visibleEntries = useMemo(() => {
    return fetchedEntries.filter((entry) => {
      if (filters.seqFrom !== null && entry.seq < filters.seqFrom) return false;
      if (filters.seqTo !== null && entry.seq > filters.seqTo) return false;
      return true;
    });
  }, [fetchedEntries, filters.seqFrom, filters.seqTo]);

  const verifyVerification = verifyQuery.data ?? null;

  const ledgerLoading = ledgerQuery.isLoading && fetchedEntries.length === 0;
  const ledgerErrored = Boolean(ledgerQuery.error) && fetchedEntries.length === 0;

  const handleVerifyProof = (seq: number) => {
    evidence.setSelectedSeq(seq);
    evidence.setProof((existing) => (existing?.seq === seq ? existing : null));
    evidence.ledgerProof(seq);
  };

  const refetchAll = () => {
    void ledgerQuery.refetch();
    void verifyQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <DRBreadcrumbs
        items={[
          { label: crumbLabels.prove, href: '/dr/prove' },
          { label: crumbLabels.ledger },
        ]}
      />
      <PageHeader
        title={copy.pageTitle}
        description={copy.pageDescription}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dr/prove">
              <ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
              {copy.backToProve}
            </Link>
          </Button>
        }
      />

      <LedgerFilterBar
        copy={copy}
        value={filters}
        entryTypes={entryTypeOptions}
        resultCount={visibleEntries.length}
        onApply={setFilters}
        onReset={() => setFilters(DEFAULT_LEDGER_FILTERS)}
      />

      <LedgerVerifyCard
        copy={copy}
        verification={verifyVerification}
        refreshing={verifyQuery.isFetching}
        onRefresh={() => void verifyQuery.refetch()}
      />

      {ledgerLoading ? (
        <LoadingSkeleton variant="table-row" count={6} />
      ) : ledgerErrored ? (
        <ErrorState message={copy.loadError} onRetry={refetchAll} />
      ) : (
        <LedgerTable
          copy={copy}
          entries={visibleEntries}
          verification={verifyVerification}
          selectedSeq={evidence.selectedSeq}
          proofLoading={evidence.proofLoading}
          onVerifyProof={handleVerifyProof}
        />
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <InclusionProofDetail
          copy={copy}
          proof={evidence.proof}
          selectedSeq={evidence.selectedSeq}
          loading={evidence.proofLoading}
        />

        <AnchorTimeline
          copy={copy}
          entries={fetchedEntries}
          verification={verifyVerification}
          latestCheckpoint={evidence.checkpoint}
          anchorLoading={evidence.anchorLoading}
          canWrite={canWrite}
          onAnchor={() => evidence.anchorLedger()}
        />
      </div>
    </div>
  );
}
