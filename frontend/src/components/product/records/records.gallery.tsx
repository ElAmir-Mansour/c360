'use client';

/**
 * ClarioDR records — gallery (Storybook-ready demos).
 * ===================================================
 *
 * Composable demos for the Phase-3 audit / PIR / integrations product
 * components. This file is NOT imported by any route (so it never ships in the
 * app bundle) and is NOT a test (so Vitest does not collect it). It documents
 * intended usage and drops straight into a Storybook/gallery harness:
 *
 *   - the default export is a gallery descriptor (`title` + named `stories`),
 *   - each named export is a ready-to-render demo component,
 *   - all sample data uses the REAL DR contract shapes (no fake masking types).
 *
 * Wrap any demo in a `LocaleProvider` (+ `next-themes` ThemeProvider) to see the
 * bilingual / light-dark / RTL behaviour; pass `locale="ar"` for RTL.
 */

import {
  Bell,
  GitPullRequestArrow,
  Globe,
  Mail,
  MessagesSquare,
  Send,
  ServerCog,
  Webhook,
} from 'lucide-react';
import type {
  DRAttestation,
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
  DRFailoverRun,
  DRFailoverStep,
} from '@/types/clario-dr';
import { AuditTrailTable } from './audit-trail-table';
import {
  PostImplementationReviewPanel,
  type PIRActionItem,
  type PIRGate,
  type PIRIssue,
} from './post-implementation-review-panel';
import {
  IntegrationCardsGrid,
  type IntegrationDescriptor,
} from './integration-cards-grid';

/* -------------------------------------------------------------------------- */
/* Sample data — real DR shapes.                                              */
/* -------------------------------------------------------------------------- */

/** An intact hash-chained attestation ledger (ascending by seq). */
export const sampleLedgerEntries: DRAttestationLedgerEntry[] = [
  {
    id: 'led-0001',
    tenant_id: 'tenant-riyadh-1',
    seq: 1,
    entry_type: 'recovery_point_validation',
    subject_id: 'rp-2026-06-14-0200',
    payload: { validation_ratio: 1, marker_lsn: '0/1A2B3C4D' },
    payload_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
    prev_hash: '0000000000000000000000000000000000000000000000000000000000000000',
    entry_hash: 'f0e1d2c3b4a5968778695a4b3c2d1e0fa9b8c7d6e5f4039281726354fefe1212',
    anchored_root: null,
    created_at: '2026-06-14T02:01:40Z',
  },
  {
    id: 'led-0002',
    tenant_id: 'tenant-riyadh-1',
    seq: 2,
    entry_type: 'cleanroom_verdict',
    subject_id: 'rp-2026-06-14-0200',
    payload: { verdict: 'clean', scanned_objects: 12840 },
    payload_hash: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    prev_hash: 'f0e1d2c3b4a5968778695a4b3c2d1e0fa9b8c7d6e5f4039281726354fefe1212',
    entry_hash: '99aabbccddeeff00112233445566778899aabbccddeeff0011223344556677ab',
    anchored_root: null,
    created_at: '2026-06-14T02:06:11Z',
  },
  {
    id: 'led-0003',
    tenant_id: 'tenant-riyadh-1',
    seq: 3,
    entry_type: 'drill_attestation',
    subject_id: 'run-1f4c9a20-drill',
    payload: { rto_actual_seconds: 742, met_rto: true },
    payload_hash: 'ddeeff00112233445566778899aabbccddeeff00112233445566778899aabbcc',
    prev_hash: '99aabbccddeeff00112233445566778899aabbccddeeff0011223344556677ab',
    entry_hash: '5566778899aabbccddeeff00112233445566778899aabbccddeeff0011223344',
    anchored_root: 'cafebabedeadbeef0011223344556677cafebabedeadbeef0011223344556677',
    created_at: '2026-06-14T02:21:03Z',
  },
  {
    id: 'led-0004',
    tenant_id: 'tenant-riyadh-1',
    seq: 4,
    entry_type: 'failover_attestation',
    subject_id: 'run-9b7e1d33-real',
    payload: { rto_actual_seconds: 818, rpo_seconds: 22, validation_ratio: 1 },
    payload_hash: '223344556677889900aabbccddeeff11223344556677889900aabbccddeeff11',
    prev_hash: '5566778899aabbccddeeff00112233445566778899aabbccddeeff0011223344',
    entry_hash: '8899aabbccddeeff11223344556677889900aabbccddeeff1122334455667788',
    anchored_root: 'cafebabedeadbeef0011223344556677cafebabedeadbeef0011223344556677',
    created_at: '2026-06-14T09:48:55Z',
  },
];

/** A ledger-wide verify result reporting a tamper at seq 3. */
export const sampleBrokenVerification: DRAttestationLedgerVerifyResult = {
  intact: false,
  entries_checked: 4,
  first_broken_seq: 3,
  reason: 'entry_hash mismatch: recomputed chain hash diverges at seq 3',
  head_hash: '8899aabbccddeeff11223344556677889900aabbccddeeff1122334455667788',
};

export const sampleIntactVerification: DRAttestationLedgerVerifyResult = {
  intact: true,
  entries_checked: 4,
  head_hash: '8899aabbccddeeff11223344556677889900aabbccddeeff1122334455667788',
};

/** A completed real failover run. */
export const sampleFailoverRun: DRFailoverRun = {
  id: 'run-9b7e1d33-real',
  tenant_id: 'tenant-riyadh-1',
  group_id: 'grp-core-banking',
  mode: 'real',
  status: 'COMPLETED',
  recovery_point_id: 'rp-2026-06-14-0200',
  rto_objective_seconds: 900,
  initiated_by: 'amal.k@operator',
  approved_by: 'duty.manager@approver',
  initiated_at: '2026-06-14T09:35:12Z',
  completed_at: '2026-06-14T09:48:50Z',
  rto_actual_seconds: 818,
  last_error: null,
  claimed_at: '2026-06-14T09:35:20Z',
  updated_at: '2026-06-14T09:48:55Z',
};

export const sampleAttestation: DRAttestation = {
  id: 'att-9b7e1d33',
  tenant_id: 'tenant-riyadh-1',
  run_id: 'run-9b7e1d33-real',
  rto_objective_seconds: 900,
  rto_actual_seconds: 818,
  rpo_seconds: 22,
  validation_ratio: 1,
  report_object_key: 'attestations/2026/06/run-9b7e1d33-real.json',
  content_hash: '223344556677889900aabbccddeeff11223344556677889900aabbccddeeff11',
  created_at: '2026-06-14T09:48:55Z',
};

export const sampleSteps: DRFailoverStep[] = [
  { id: 's1', run_id: 'run-9b7e1d33-real', step: 'quiesce.final_sync', status: 'passed', started_at: '2026-06-14T09:35:20Z', finished_at: '2026-06-14T09:36:02Z' },
  { id: 's2', run_id: 'run-9b7e1d33-real', step: 'gate1.validate', status: 'passed', started_at: '2026-06-14T09:36:02Z', finished_at: '2026-06-14T09:37:10Z' },
  { id: 's3', run_id: 'run-9b7e1d33-real', step: 'gate2.approved', status: 'passed', started_at: '2026-06-14T09:39:44Z', finished_at: '2026-06-14T09:39:45Z' },
  { id: 's4', run_id: 'run-9b7e1d33-real', step: 'gate3.execute', status: 'passed', started_at: '2026-06-14T09:39:45Z', finished_at: '2026-06-14T09:46:31Z' },
  { id: 's5', run_id: 'run-9b7e1d33-real', step: 'gate3.health', status: 'passed', started_at: '2026-06-14T09:46:31Z', finished_at: '2026-06-14T09:48:12Z' },
  { id: 's6', run_id: 'run-9b7e1d33-real', step: 'gate4.attest', status: 'passed', started_at: '2026-06-14T09:48:12Z', finished_at: '2026-06-14T09:48:55Z' },
];

export const sampleGates: PIRGate[] = [
  { key: 'validate', outcome: 'passed', detail: 'Replication confirmed, recovery point pinned, RPO 22s.' },
  { key: 'approve', outcome: 'passed', detail: 'Signed off by duty.manager@approver.' },
  { key: 'execute', outcome: 'passed', detail: 'Boot order completed across 6 members.' },
  { key: 'attest', outcome: 'passed', detail: 'Immutable evidence sealed to the attestation ledger.' },
];

export const sampleIssues: PIRIssue[] = [
  {
    id: 'iss-1',
    severity: 'medium',
    title: 'DNS propagation lagged service health by ~90s',
    description: 'Recursive resolvers served the previous A record after cutover, delaying client reconnects.',
  },
  {
    id: 'iss-2',
    severity: 'low',
    title: 'Boot-order weight for the reporting service can be lowered',
    description: 'Reporting booted ahead of its upstream cache with no functional impact; reorder for cleaner sequencing.',
  },
];

export const sampleActions: PIRActionItem[] = [
  { id: 'act-1', title: 'Lower TTL on customer-facing zones to 60s', owner: 'network@team', status: 'in_progress', dueLabel: 'Due 21 Jun' },
  { id: 'act-2', title: 'Re-weight reporting service in the boot graph', owner: 'platform@team', status: 'open', dueLabel: 'Due 28 Jun' },
  { id: 'act-3', title: 'Attach drill recording to the BCM evidence pack', owner: 'grc@team', status: 'done' },
];

export const sampleIntegrations: IntegrationDescriptor[] = [
  { id: 'slack', name: 'Slack', category: 'Notifications', description: 'Post failover, drill, and RPO-breach alerts to recovery channels.', status: 'connected', icon: MessagesSquare, lastConnectedAt: '2026-06-14T09:48:58Z' },
  { id: 'teams', name: 'Microsoft Teams', category: 'Notifications', description: 'Mirror recovery events and approvals into a Teams response channel.', status: 'available', icon: MessagesSquare },
  { id: 'jira', name: 'Jira', category: 'Ticketing', description: 'Open a tracked incident and follow-up issues from a recovery event.', status: 'connected', icon: GitPullRequestArrow, lastConnectedAt: '2026-06-14T09:49:10Z' },
  { id: 'servicenow', name: 'ServiceNow', category: 'Ticketing', description: 'Sync runs and action items to ServiceNow change and incident records.', status: 'error', icon: ServerCog, errorDetail: 'OAuth token expired — re-authorize the connection.' },
  { id: 'pagerduty', name: 'PagerDuty', category: 'On-call', description: 'Page the on-call rotation the moment a real failover is initiated.', status: 'connected', icon: Bell, lastConnectedAt: '2026-06-14T09:35:14Z' },
  { id: 'webhook', name: 'Outbound webhook', category: 'Custom', description: 'Deliver signed JSON events to any HTTPS endpoint you control.', status: 'available', icon: Webhook },
  { id: 'rest', name: 'REST API', category: 'Custom', description: 'Pull attestations, runs, and posture via the read API with a scoped key.', status: 'available', icon: Globe },
  { id: 'email', name: 'Email', category: 'Notifications', description: 'Send digest and per-event summaries to a distribution list.', status: 'connected', icon: Mail, lastConnectedAt: '2026-06-14T09:49:00Z' },
  { id: 'sms', name: 'SMS gateway', category: 'On-call', description: 'Fan out critical recovery alerts as SMS to responders.', status: 'available', icon: Send },
];

/* -------------------------------------------------------------------------- */
/* Demos.                                                                     */
/* -------------------------------------------------------------------------- */

export function AuditTrailIntactDemo() {
  return <AuditTrailTable entries={sampleLedgerEntries} verification={sampleIntactVerification} />;
}

export function AuditTrailBrokenChainDemo() {
  return <AuditTrailTable entries={sampleLedgerEntries} verification={sampleBrokenVerification} />;
}

export function PostImplementationReviewDemo() {
  return (
    <PostImplementationReviewPanel
      run={sampleFailoverRun}
      attestation={sampleAttestation}
      steps={sampleSteps}
      gates={sampleGates}
      issues={sampleIssues}
      actionItems={sampleActions}
      rpoObjectiveSeconds={60}
    />
  );
}

export function IntegrationsDemo() {
  return <IntegrationCardsGrid integrations={sampleIntegrations} onConfigure={() => undefined} />;
}

const gallery = {
  title: 'Product / Records',
  stories: {
    'Audit trail — intact chain': AuditTrailIntactDemo,
    'Audit trail — broken chain': AuditTrailBrokenChainDemo,
    'Post-implementation review': PostImplementationReviewDemo,
    'Integration cards grid': IntegrationsDemo,
  },
};

export default gallery;
