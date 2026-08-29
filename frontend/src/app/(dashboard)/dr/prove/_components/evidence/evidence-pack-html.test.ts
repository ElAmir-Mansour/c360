import { describe, it, expect } from 'vitest';
import type {
  DRAttestation,
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
  DRFailoverRun,
  DRFailoverStep,
} from '@/types/clario-dr';
import { assembleEvidencePack } from '../../../_lib/evidence-export';
import { buildEvidencePackPrintHtml } from './evidence-pack-html';

const RUN_ID = 'run-print-1';
const GENERATED_AT = '2026-06-15T10:15:00.000Z';

function run(): DRFailoverRun {
  return {
    id: RUN_ID,
    tenant_id: 'tenant-1',
    group_id: 'grp-1',
    mode: 'live',
    status: 'COMPLETED',
    recovery_point_id: 'rp-1',
    rto_objective_seconds: 900,
    initiated_by: 'op@clario.dev',
    approved_by: 'boss@clario.dev',
    initiated_at: '2026-06-15T09:00:00.000Z',
    completed_at: '2026-06-15T09:12:00.000Z',
    rto_actual_seconds: 720,
    last_error: null,
    claimed_at: null,
    updated_at: '2026-06-15T09:12:00.000Z',
  };
}

function steps(): DRFailoverStep[] {
  return [
    {
      id: 's1',
      run_id: RUN_ID,
      step: 'gate1.validate',
      status: 'passed',
      started_at: '2026-06-15T09:01:00.000Z',
      finished_at: '2026-06-15T09:02:00.000Z',
    },
  ];
}

function attestation(): DRAttestation {
  return {
    id: 'att-1',
    tenant_id: 'tenant-1',
    run_id: RUN_ID,
    rto_objective_seconds: 900,
    rto_actual_seconds: 720,
    rpo_seconds: 30,
    validation_ratio: 1,
    report_object_key: 'worm/att-1.json',
    content_hash: 'sha256:deadbeefcafef00d1234',
    created_at: '2026-06-15T09:12:05.000Z',
  };
}

function ledger(): DRAttestationLedgerEntry[] {
  return [
    {
      id: 'e1',
      tenant_id: 'tenant-1',
      seq: 5,
      entry_type: 'failover_attestation',
      subject_id: RUN_ID,
      payload: { run_id: RUN_ID },
      payload_hash: 'ph-5',
      prev_hash: 'eh-4',
      entry_hash: 'eh-5-0123456789abcdef',
      anchored_root: 'merkle-root',
      created_at: '2026-06-15T09:12:10.000Z',
    },
  ];
}

const verify: DRAttestationLedgerVerifyResult = {
  intact: true,
  entries_checked: 5,
  head_hash: 'eh-5-0123456789abcdef',
  reason: 'chain intact',
};

function packFor(overrides: Partial<Parameters<typeof assembleEvidencePack>[0]> = {}) {
  return assembleEvidencePack({
    run: run(),
    steps: steps(),
    attestation: attestation(),
    ledgerEntries: ledger(),
    verification: verify,
    groupName: 'Payments core',
    generatedBy: 'op@clario.dev',
    generatedAt: GENERATED_AT,
    ...overrides,
  });
}

describe('buildEvidencePackPrintHtml', () => {
  it('produces a self-contained HTML document with brand styles and the run id title', () => {
    const html = buildEvidencePackPrintHtml(packFor());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).toContain('ClarioDR');
    expect(html).toContain(RUN_ID);
    // Canonical brand tokens and semantic status colors surface in the inline stylesheet.
    expect(html).toContain('--brand:#005E5E');
    expect(html).toContain('--gold:#ABB705');
    expect(html).toContain('--teal:#0DA7A8');
    expect(html).toContain('--fg:#06352F');
    expect(html).toContain('--muted:#6C7874');
    expect(html).toContain('--line:#D1D8D5');
    expect(html).toContain('--bg:#ffffff');
    expect(html).toContain('#1B5E20');
  });

  it('renders the run summary, RTO verdict and four gate labels', () => {
    const html = buildEvidencePackPrintHtml(packFor());
    expect(html).toContain('Recovery run');
    expect(html).toContain('RTO met');
    expect(html).toContain('Validate');
    expect(html).toContain('Approve');
    expect(html).toContain('Execute');
    expect(html).toContain('Attest');
  });

  it('shows the no-attestation note when none was sealed', () => {
    const html = buildEvidencePackPrintHtml(packFor({ attestation: null }));
    expect(html).toContain('No attestation was sealed for this run.');
  });

  it('escapes dynamic text to keep the document injection-safe', () => {
    const malicious = run();
    malicious.initiated_by = '<script>alert(1)</script>';
    const html = buildEvidencePackPrintHtml(
      packFor({ run: malicious, attestation: null }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('is deterministic — identical packs yield identical markup', () => {
    expect(buildEvidencePackPrintHtml(packFor())).toBe(buildEvidencePackPrintHtml(packFor()));
  });
});
