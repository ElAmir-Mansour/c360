import { describe, it, expect } from 'vitest';
import type {
  DRAttestation,
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
  DRFailoverRun,
  DRFailoverStep,
} from '@/types/clario-dr';
import {
  EVIDENCE_GATE_KEYS,
  EVIDENCE_PACK_SCHEMA_VERSION,
  assembleEvidencePack,
  deriveEvidenceGates,
  evidencePackFilename,
  selectRunLedgerEntries,
  serializeEvidencePack,
} from './evidence-export';

// ---------------------------------------------------------------------------
// Real-shaped fixtures (mirroring @/types/clario-dr exactly — no invented fields).
// ---------------------------------------------------------------------------

const RUN_ID = 'run-aaaa-1111';
const GENERATED_AT = '2026-06-15T10:15:00.000Z';

function makeRun(overrides: Partial<DRFailoverRun> = {}): DRFailoverRun {
  return {
    id: RUN_ID,
    tenant_id: 'tenant-1',
    group_id: 'grp-payments',
    mode: 'live',
    status: 'COMPLETED',
    recovery_point_id: 'rp-9',
    rto_objective_seconds: 900,
    initiated_by: 'operator@clario.dev',
    approved_by: 'approver@clario.dev',
    initiated_at: '2026-06-15T09:00:00.000Z',
    completed_at: '2026-06-15T09:12:00.000Z',
    rto_actual_seconds: 720,
    last_error: null,
    claimed_at: '2026-06-15T09:00:05.000Z',
    updated_at: '2026-06-15T09:12:00.000Z',
    ...overrides,
  };
}

function makeSteps(): DRFailoverStep[] {
  return [
    {
      id: 'step-1',
      run_id: RUN_ID,
      step: 'gate1.validate',
      status: 'passed',
      started_at: '2026-06-15T09:01:00.000Z',
      finished_at: '2026-06-15T09:02:00.000Z',
    },
    {
      id: 'step-2',
      run_id: RUN_ID,
      step: 'gate2.approved',
      status: 'passed',
      started_at: '2026-06-15T09:02:00.000Z',
      finished_at: '2026-06-15T09:03:00.000Z',
    },
    {
      id: 'step-3',
      run_id: RUN_ID,
      step: 'gate3.execute',
      status: 'passed',
      started_at: '2026-06-15T09:03:00.000Z',
      finished_at: '2026-06-15T09:09:00.000Z',
    },
    {
      id: 'step-4',
      run_id: RUN_ID,
      step: 'gate4.attest',
      status: 'passed',
      started_at: '2026-06-15T09:09:00.000Z',
      finished_at: '2026-06-15T09:12:00.000Z',
    },
    {
      id: 'step-5',
      run_id: RUN_ID,
      step: 'teardown',
      status: 'passed',
      started_at: '2026-06-15T09:12:00.000Z',
      finished_at: '2026-06-15T09:12:30.000Z',
    },
  ];
}

function makeAttestation(): DRAttestation {
  return {
    id: 'att-1',
    tenant_id: 'tenant-1',
    run_id: RUN_ID,
    rto_objective_seconds: 900,
    rto_actual_seconds: 720,
    rpo_seconds: 30,
    validation_ratio: 1,
    report_object_key: 'worm/tenant-1/att-1.json',
    content_hash: 'sha256:abcdef0123456789',
    created_at: '2026-06-15T09:12:05.000Z',
  };
}

function makeLedger(): DRAttestationLedgerEntry[] {
  return [
    {
      id: 'entry-0',
      tenant_id: 'tenant-1',
      seq: 1,
      entry_type: 'recovery_point_sealed',
      subject_id: 'rp-9',
      payload: { rp_id: 'rp-9' },
      payload_hash: 'ph-1',
      prev_hash: '',
      entry_hash: 'eh-1',
      anchored_root: 'merkle-root-aaa',
      created_at: '2026-06-15T08:00:00.000Z',
    },
    {
      id: 'entry-1',
      tenant_id: 'tenant-1',
      seq: 2,
      entry_type: 'failover_attestation',
      subject_id: RUN_ID,
      payload: { run_id: RUN_ID, result: 'healthy' },
      payload_hash: 'ph-2',
      prev_hash: 'eh-1',
      entry_hash: 'eh-2',
      anchored_root: 'merkle-root-aaa',
      created_at: '2026-06-15T09:12:10.000Z',
    },
    {
      id: 'entry-2',
      tenant_id: 'tenant-1',
      seq: 3,
      entry_type: 'gate_outcome',
      subject_id: 'other-subject',
      payload: { runID: RUN_ID, gate: 'attest' },
      payload_hash: 'ph-3',
      prev_hash: 'eh-2',
      entry_hash: 'eh-3',
      anchored_root: null,
      created_at: '2026-06-15T09:12:15.000Z',
    },
    {
      id: 'entry-3',
      tenant_id: 'tenant-1',
      seq: 4,
      entry_type: 'failover_attestation',
      subject_id: 'run-unrelated-9999',
      payload: { run_id: 'run-unrelated-9999' },
      payload_hash: 'ph-4',
      prev_hash: 'eh-3',
      entry_hash: 'eh-4',
      anchored_root: null,
      created_at: '2026-06-15T09:30:00.000Z',
    },
  ];
}

const VERIFY_INTACT: DRAttestationLedgerVerifyResult = {
  intact: true,
  entries_checked: 4,
  head_hash: 'eh-4',
  reason: 'chain intact',
};

// ---------------------------------------------------------------------------
// selectRunLedgerEntries
// ---------------------------------------------------------------------------

describe('selectRunLedgerEntries', () => {
  it('selects entries by subject_id and by payload run_id/runID references, sorted by seq', () => {
    const selected = selectRunLedgerEntries(RUN_ID, makeLedger());
    expect(selected.map((entry) => entry.seq)).toEqual([2, 3]);
  });

  it('excludes entries that reference an unrelated run', () => {
    const selected = selectRunLedgerEntries(RUN_ID, makeLedger());
    expect(selected.some((entry) => entry.subject_id === 'run-unrelated-9999')).toBe(false);
  });

  it('returns an empty array when nothing references the run', () => {
    expect(selectRunLedgerEntries('run-missing', makeLedger())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deriveEvidenceGates
// ---------------------------------------------------------------------------

describe('deriveEvidenceGates', () => {
  it('passes all four gates when every gate step passed', () => {
    const gates = deriveEvidenceGates({ status: 'COMPLETED' }, makeSteps());
    expect(gates.map((gate) => gate.key)).toEqual([...EVIDENCE_GATE_KEYS]);
    expect(gates.every((gate) => gate.outcome === 'passed')).toBe(true);
    // Non-gate "teardown" step is not attributed to any gate.
    expect(gates.flatMap((gate) => gate.steps.map((step) => step.step))).not.toContain('teardown');
  });

  it('marks a gate failed when one of its steps failed', () => {
    const steps = makeSteps().map((step) =>
      step.step === 'gate3.execute' ? { ...step, status: 'failed' } : step,
    );
    const gates = deriveEvidenceGates({ status: 'FAILED' }, steps);
    const execute = gates.find((gate) => gate.key === 'execute');
    expect(execute?.outcome).toBe('failed');
  });

  it('skips later gates of a terminally-failed run that never reached them', () => {
    // FAILED run with only the validate gate recorded.
    const steps = makeSteps().filter((step) => step.step === 'gate1.validate');
    const gates = deriveEvidenceGates({ status: 'FAILED' }, steps);
    expect(gates.find((gate) => gate.key === 'validate')?.outcome).toBe('passed');
    expect(gates.find((gate) => gate.key === 'approve')?.outcome).toBe('skipped');
    expect(gates.find((gate) => gate.key === 'attest')?.outcome).toBe('skipped');
  });

  it('infers passed from run status progression even without a step record', () => {
    // ATTESTED clears validate+approve+execute (index 3) with no steps emitted.
    const gates = deriveEvidenceGates({ status: 'ATTESTED' }, []);
    expect(gates.find((gate) => gate.key === 'validate')?.outcome).toBe('passed');
    expect(gates.find((gate) => gate.key === 'execute')?.outcome).toBe('passed');
    // The attest gate itself is not yet "cleared" by status alone -> pending.
    expect(gates.find((gate) => gate.key === 'attest')?.outcome).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// assembleEvidencePack
// ---------------------------------------------------------------------------

describe('assembleEvidencePack', () => {
  it('assembles a complete pack from real-shaped inputs', () => {
    const pack = assembleEvidencePack({
      run: makeRun(),
      steps: makeSteps(),
      attestation: makeAttestation(),
      ledgerEntries: makeLedger(),
      verification: VERIFY_INTACT,
      groupName: 'Payments core',
      generatedBy: 'operator@clario.dev',
      generatedAt: GENERATED_AT,
    });

    // Envelope.
    expect(pack.meta.schema_version).toBe(EVIDENCE_PACK_SCHEMA_VERSION);
    expect(pack.meta.kind).toBe('clario-dr.evidence-pack');
    expect(pack.meta.generated_at).toBe(GENERATED_AT);
    expect(pack.meta.generated_by).toBe('operator@clario.dev');
    expect(pack.meta.group_name).toBe('Payments core');
    expect(pack.meta.run_id).toBe(RUN_ID);
    expect(pack.meta.tenant_id).toBe('tenant-1');

    // Run summary.
    expect(pack.run.terminal).toBe(true);
    expect(pack.run.terminal_success).toBe(true);
    expect(pack.run.terminal_failure).toBe(false);
    expect(pack.run.approved_by).toBe('approver@clario.dev');

    // RTO-vs-RTA: 720s actual against a 900s objective -> met, 180s to spare.
    expect(pack.rto.objective_seconds).toBe(900);
    expect(pack.rto.actual_seconds).toBe(720);
    expect(pack.rto.remaining_seconds).toBe(180);
    expect(pack.rto.breached).toBe(false);
    expect(pack.rto.met).toBe(true);

    // Four gate outcomes, all passed.
    expect(pack.gates).toHaveLength(4);
    expect(pack.gates.every((gate) => gate.outcome === 'passed')).toBe(true);

    // Attestation carried through.
    expect(pack.attestation?.id).toBe('att-1');
    expect(pack.attestation?.content_hash).toBe('sha256:abcdef0123456789');

    // Ledger entries scoped to this run (seq 2 + 3), unrelated run excluded.
    expect(pack.ledger_entries.map((entry) => entry.seq)).toEqual([2, 3]);
  });

  it('summarises the hash chain incl. contiguity, anchoring and verify verdict', () => {
    const pack = assembleEvidencePack({
      run: makeRun(),
      steps: makeSteps(),
      attestation: makeAttestation(),
      ledgerEntries: makeLedger(),
      verification: VERIFY_INTACT,
      generatedAt: GENERATED_AT,
    });

    const chain = pack.hash_chain;
    expect(chain.verified_intact).toBe(true);
    expect(chain.entries_checked).toBe(4);
    expect(chain.first_broken_seq).toBeNull();
    expect(chain.head_hash).toBe('eh-4');
    expect(chain.included_entry_count).toBe(2);
    expect(chain.included_seq_range).toEqual([2, 3]);
    // seq 2 (prev eh-1) -> seq 3 (prev eh-2 === seq2.entry_hash) is contiguous.
    expect(chain.included_links_contiguous).toBe(true);
    // Only seq 2 carries an anchored_root within the included set.
    expect(chain.anchored_entry_count).toBe(1);
  });

  it('reports a broken chain verdict and a non-contiguous link summary', () => {
    const broken: DRAttestationLedgerVerifyResult = {
      intact: false,
      entries_checked: 4,
      first_broken_seq: 3,
      head_hash: 'eh-4',
      reason: 'prev_hash mismatch at seq 3',
    };
    const tampered = makeLedger().map((entry) =>
      entry.seq === 3 ? { ...entry, prev_hash: 'TAMPERED' } : entry,
    );

    const pack = assembleEvidencePack({
      run: makeRun(),
      steps: makeSteps(),
      ledgerEntries: tampered,
      verification: broken,
      generatedAt: GENERATED_AT,
    });

    expect(pack.hash_chain.verified_intact).toBe(false);
    expect(pack.hash_chain.first_broken_seq).toBe(3);
    expect(pack.hash_chain.verify_reason).toBe('prev_hash mismatch at seq 3');
    expect(pack.hash_chain.included_links_contiguous).toBe(false);
  });

  it('handles a drill run with no sealed attestation and an RTO breach', () => {
    const pack = assembleEvidencePack({
      run: makeRun({
        mode: 'drill',
        status: 'COMPLETED',
        rto_actual_seconds: 1200, // over the 900s objective.
      }),
      steps: makeSteps(),
      attestation: null,
      ledgerEntries: makeLedger(),
      verification: VERIFY_INTACT,
      generatedAt: GENERATED_AT,
    });

    expect(pack.attestation).toBeNull();
    expect(pack.meta.run_mode).toBe('drill');
    expect(pack.rto.breached).toBe(true);
    expect(pack.rto.met).toBe(false);
    expect(pack.rto.remaining_seconds).toBe(-300);
  });

  it('omits optional envelope fields when not supplied', () => {
    const pack = assembleEvidencePack({
      run: makeRun(),
      steps: makeSteps(),
      ledgerEntries: makeLedger(),
      generatedAt: GENERATED_AT,
    });
    expect(pack.meta.generated_by).toBeUndefined();
    expect(pack.meta.group_name).toBeUndefined();
    expect(pack.hash_chain.verified_intact).toBe(false); // no verification supplied.
  });

  it('is deterministic — identical inputs yield byte-identical JSON', () => {
    const input = {
      run: makeRun(),
      steps: makeSteps(),
      attestation: makeAttestation(),
      ledgerEntries: makeLedger(),
      verification: VERIFY_INTACT,
      groupName: 'Payments core',
      generatedAt: GENERATED_AT,
    };
    expect(serializeEvidencePack(assembleEvidencePack(input))).toBe(
      serializeEvidencePack(assembleEvidencePack(input)),
    );
  });
});

// ---------------------------------------------------------------------------
// serializeEvidencePack + evidencePackFilename
// ---------------------------------------------------------------------------

describe('serializeEvidencePack', () => {
  it('round-trips back to the original pack via JSON.parse', () => {
    const pack = assembleEvidencePack({
      run: makeRun(),
      steps: makeSteps(),
      attestation: makeAttestation(),
      ledgerEntries: makeLedger(),
      verification: VERIFY_INTACT,
      generatedAt: GENERATED_AT,
    });
    expect(JSON.parse(serializeEvidencePack(pack))).toEqual(pack);
  });
});

describe('evidencePackFilename', () => {
  it('builds a filesystem-safe, timestamped filename from the pack meta', () => {
    const pack = assembleEvidencePack({
      run: makeRun(),
      steps: makeSteps(),
      ledgerEntries: makeLedger(),
      generatedAt: GENERATED_AT,
    });
    expect(evidencePackFilename(pack)).toBe(
      'clario-dr-evidence-run-aaaa-1111-20260615T101500Z.json',
    );
  });
});
