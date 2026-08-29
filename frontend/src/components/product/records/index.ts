/**
 * ClarioDR records — Phase-3 product components.
 * ==============================================
 * Composable, token-driven, bilingual-ready components wired to the real DR
 * data contract (attestation ledger, failover runs/attestations, connector
 * framework). No full page assembly — these are the building blocks the
 * Phase-4 recovery-dashboard PROOF screen composes.
 */

export { AuditTrailTable } from './audit-trail-table';
export type {
  AuditTrailTableProps,
  AuditTrailLabels,
  AuditChainVerdict,
  AuditEntryTypeMeta,
} from './audit-trail-table';

export { PostImplementationReviewPanel } from './post-implementation-review-panel';
export type {
  PostImplementationReviewPanelProps,
  PIRLabels,
  PIRGate,
  PIRGateKey,
  PIRGateOutcome,
  PIRIssue,
  PIRActionItem,
} from './post-implementation-review-panel';

export { IntegrationCardsGrid } from './integration-cards-grid';
export type {
  IntegrationCardsGridProps,
  IntegrationCardsLabels,
  IntegrationDescriptor,
  IntegrationStatus,
} from './integration-cards-grid';

export {
  shortenHash,
  formatDuration,
  formatTimestamp,
  formatInteger,
  formatRatioPercent,
} from './format';
