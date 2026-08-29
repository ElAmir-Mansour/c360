import { describe, expect, it } from 'vitest';
import type { DRRehearsalProof } from '@/lib/clario-dr';
import { buildRehearsalProofPrintHtml } from './proof-envelope-export';

const proof: DRRehearsalProof = {
  schema_version: '1.0',
  id: 'proof-1',
  tenant_id: 'tenant-1',
  run: { type: 'gameday', id: 'run-1' },
  scope: { name: 'Payments' },
  systems: [],
  runbook: {},
  targets: {},
  approval_refs: [],
  started_at: '2026-07-22T10:00:00.000Z',
  completed_at: '2026-07-22T10:05:00.000Z',
  health_checks: [],
  integrity_verdicts: [],
  failback_teardown: { status: 'complete' },
  overall_verdict: 'passed',
  provenance: {
    source: 'test',
    live: true,
    seeded: false,
    demo: false,
    captured_at: '2026-07-22T10:05:00.000Z',
  },
  envelope_hash: 'sha256:test',
  generated_at: '2026-07-22T10:06:00.000Z',
};

describe('buildRehearsalProofPrintHtml', () => {
  it('embeds the canonical palette while retaining status and white print surfaces', () => {
    const html = buildRehearsalProofPrintHtml(proof, 'gameday');

    expect(html).toContain('--brand:#005E5E');
    expect(html).toContain('--gold:#ABB705');
    expect(html).toContain('--teal:#0DA7A8');
    expect(html).toContain('--fg:#06352F');
    expect(html).toContain('--muted:#6C7874');
    expect(html).toContain('--line:#D1D8D5');
    expect(html).toContain('--bg:#ffffff');
    expect(html).toContain('--ok:#1B5E20');
  });
});
