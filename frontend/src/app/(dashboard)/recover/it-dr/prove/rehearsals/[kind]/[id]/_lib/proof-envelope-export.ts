/**
 * proof-envelope-export.ts — client-side export of an already-loaded rehearsal
 * PROOF ENVELOPE.
 *
 * A rehearsal proof envelope is a signed, sealed artefact assembled by the
 * backend; its whole purpose is to be handed to an auditor. This page has
 * already fetched the full {@link DRRehearsalProof} (via `useDRRehearsalProof`),
 * so both exports here are pure, client-side renderings of that exact payload —
 * no server export endpoint and no proof-generation / signing / WORM machinery
 * is invoked (DR irreversible operations are on hold).
 *
 *   - JSON: the exact envelope bytes as fetched, pretty-printed. This is the
 *     canonical artefact — its `envelope_hash` verifies against these bytes.
 *   - PDF:  a self-contained, print-optimised HTML document (opened in a new
 *     window for browser print-to-PDF), mirroring the Prove evidence-pack
 *     print path. Pure and deterministic; all dynamic text is HTML-escaped.
 *
 * Styling reuses the ClarioDR brand tokens as plain CSS custom properties so the
 * standalone document needs no external stylesheet, matching `evidence-pack-html.ts`.
 */

import type { DRRehearsalProof, DRRehearsalProofKind } from '@/lib/clario-dr';

const KIND_LABELS: Record<DRRehearsalProofKind, string> = {
  gameday: 'Game-day run',
  'runbook-runs': 'Runbook run',
  'failover-runs': 'Failover drill',
};

/** Serialise the proof envelope to a stable, pretty-printed JSON string. */
export function serializeRehearsalProof(proof: DRRehearsalProof): string {
  return JSON.stringify(proof, null, 2);
}

/**
 * Deterministic, filesystem-safe download filename for a proof envelope, e.g.
 * `clario-dr-proof-runbook-runs-abc123-20260615T101500Z.json`. The timestamp is
 * taken from `generated_at` so the name matches the envelope contents.
 */
export function rehearsalProofFilename(
  proof: DRRehearsalProof,
  kind: DRRehearsalProofKind,
  extension: 'json' | 'pdf',
): string {
  const safeRun = String(proof.run?.id ?? proof.id).replace(/[^a-zA-Z0-9_-]+/g, '-');
  const stamp = String(proof.generated_at)
    .replace(/[:-]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `clario-dr-proof-${kind}-${safeRun}-${stamp}.${extension}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value: string | null | undefined, naLabel: string): string {
  if (!value) return naLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return naLabel;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function formatSeconds(seconds: number | null | undefined, naLabel: string): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return naLabel;
  const total = Math.abs(Math.round(seconds));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function verdictPillClass(verdict: string): string {
  switch (verdict.toLowerCase()) {
    case 'passed':
      return 'pill pill-ok';
    case 'failed':
      return 'pill pill-bad';
    case 'warning':
      return 'pill pill-warn';
    default:
      return 'pill pill-muted';
  }
}

function field(label: string, value: string): string {
  return `<div class="field"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
}

const DOC_STYLES = `
:root{
  --brand:#005E5E; --gold:#ABB705; --teal:#0DA7A8;
  --fg:#06352F; --muted:#6C7874; --line:#D1D8D5; --bg:#ffffff; --soft:#D1D8D5;
  --ok:#1B5E20; --bad:#b00020; --warn:#8a6d00;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font-family:Inter,"Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;
  font-size:13px;line-height:1.45}
.page{max-width:880px;margin:0 auto;padding:32px}
header.brand{border-bottom:2px solid var(--line);padding-bottom:16px;margin-bottom:24px;
  display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.kicker{color:var(--brand);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px}
h1{font-size:19px;margin:6px 0 2px}
.sub{color:var(--muted);font-size:12px;margin:0}
h2{font-size:14px;margin:0 0 10px;color:var(--fg)}
section{margin:0 0 22px}
hr{border:0;border-top:1px solid var(--line);margin:22px 0}
dl.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 24px;margin:0}
dl.grid.cols-4{grid-template-columns:repeat(4,1fr)}
.field dt{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;margin:0 0 3px}
.field dd{margin:0;font-weight:600;word-break:break-word}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid var(--line)}
.pill-ok{background:rgba(27,94,32,.10);color:var(--ok);border-color:rgba(27,94,32,.30)}
.pill-bad{background:rgba(176,0,32,.10);color:var(--bad);border-color:rgba(176,0,32,.30)}
.pill-warn{background:rgba(138,109,0,.10);color:var(--warn);border-color:rgba(138,109,0,.30)}
.pill-muted{background:var(--soft);color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:start;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  border-bottom:1px solid var(--line);padding-block:6px;padding-inline:0 8px}
td{padding-block:7px;padding-inline:0 8px;border-bottom:1px solid var(--line)}
.note{border:1px dashed var(--line);border-radius:8px;padding:10px 12px;color:var(--muted)}
@media print{body{font-size:12px}.page{padding:0}header.brand{margin-top:8px}}
`;

/**
 * Build a complete, standalone HTML document (string) for printing the proof
 * envelope. Pure: identical proofs produce identical markup.
 */
export function buildRehearsalProofPrintHtml(
  proof: DRRehearsalProof,
  kind: DRRehearsalProofKind,
): string {
  const na = 'n/a';
  const kindLabel = KIND_LABELS[kind];

  const rtoTarget = proof.targets?.rto_target_seconds;
  const rtoActual = proof.targets?.rto_actual_seconds;
  const rtoValue =
    rtoTarget && rtoActual !== undefined && rtoActual !== null
      ? `${formatSeconds(rtoActual, na)} / ${formatSeconds(rtoTarget, na)}`
      : rtoTarget
        ? formatSeconds(rtoTarget, na)
        : 'No target';
  const rtoVerdict =
    proof.targets?.rto_met === undefined
      ? `<span class="pill pill-muted">Not evaluated</span>`
      : proof.targets.rto_met
        ? `<span class="pill pill-ok">Objective met</span>`
        : `<span class="pill pill-bad">Objective missed</span>`;

  const provenancePill = proof.provenance?.live
    ? `<span class="pill pill-ok">Live evidence</span>`
    : `<span class="pill pill-warn">Non-live evidence</span>`;

  const healthRows =
    proof.health_checks.length > 0
      ? proof.health_checks
          .map(
            (check) => `<tr>
        <td>${escapeHtml(check.name)}</td>
        <td><span class="${check.passed ? 'pill pill-ok' : check.status === 'unknown' ? 'pill pill-warn' : 'pill pill-bad'}">${escapeHtml(check.status)}</span></td>
        <td>${escapeHtml(formatDateTime(check.finished_at ?? check.checked_at, na))}</td>
        <td class="mono">${escapeHtml(check.evidence_id ?? na)}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="4" class="note">No health checks were attached to this proof envelope.</td></tr>`;

  const integrityRows =
    proof.integrity_verdicts.length > 0
      ? proof.integrity_verdicts
          .map(
            (item) => `<tr>
        <td>${escapeHtml(item.source)}</td>
        <td><span class="${item.passed ? 'pill pill-ok' : 'pill pill-bad'}">${escapeHtml(item.verdict)}</span></td>
        <td>${escapeHtml(formatDateTime(item.checked_at, na))}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="3" class="note">No separate integrity verdicts were attached.</td></tr>`;

  const approvalRows =
    proof.approval_refs.length > 0
      ? proof.approval_refs
          .map(
            (approval) => `<tr>
        <td>${escapeHtml(approval.action ?? 'approval')}</td>
        <td class="mono">${escapeHtml(approval.approver ?? approval.id ?? 'unknown approver')}</td>
        <td>${escapeHtml(approval.approved_at ? formatDateTime(approval.approved_at, na) : na)}</td>
      </tr>`,
          )
          .join('')
      : `<tr><td colspan="3" class="note">No approval references were attached to this proof envelope.</td></tr>`;

  const evidenceReportFields = proof.evidence_report
    ? field('Evidence report', `<span class="mono">${escapeHtml(proof.evidence_report.id)}</span>`) +
      field('Evidence hash', `<span class="mono">${escapeHtml(proof.evidence_report.hash)}</span>`)
    : '';

  return `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(`Rehearsal proof · ${proof.run?.id ?? proof.id}`)}</title>
<style>${DOC_STYLES}</style>
</head>
<body>
<div class="page">
  <header class="brand">
    <div>
      <div class="kicker">ClarioDR · Prove · Rehearsal proof envelope</div>
      <h1>${escapeHtml(kindLabel)} ${escapeHtml(proof.run?.id ?? proof.id)}</h1>
      <p class="sub">Generated ${escapeHtml(formatDateTime(proof.generated_at, na))} · schema ${escapeHtml(proof.schema_version)}</p>
    </div>
    <div>
      <span class="${verdictPillClass(proof.overall_verdict)}">${escapeHtml(proof.overall_verdict)}</span>
      ${provenancePill}
    </div>
  </header>

  <section>
    <h2>Envelope</h2>
    <dl class="grid cols-4">
      ${field('Verdict', `<span class="${verdictPillClass(proof.overall_verdict)}">${escapeHtml(proof.overall_verdict)}</span>`)}
      ${field('RTO', `${escapeHtml(rtoValue)} ${rtoVerdict}`)}
      ${field('Provenance', `${escapeHtml(proof.provenance?.source ?? na)}${proof.provenance?.captured_from ? ` · ${escapeHtml(proof.provenance.captured_from)}` : ''}`)}
      ${field('Envelope hash', `<span class="mono">${escapeHtml(proof.envelope_hash)}</span>`)}
    </dl>
  </section>

  <section>
    <h2>Evidence chain</h2>
    <dl class="grid">
      ${field('Proof ID', `<span class="mono">${escapeHtml(proof.id)}</span>`)}
      ${field('Tenant', `<span class="mono">${escapeHtml(proof.tenant_id)}</span>`)}
      ${field('Started', escapeHtml(formatDateTime(proof.started_at, na)))}
      ${field('Completed', escapeHtml(proof.completed_at ? formatDateTime(proof.completed_at, na) : 'Not completed'))}
      ${field('Generated', escapeHtml(formatDateTime(proof.generated_at, na)))}
      ${evidenceReportFields}
    </dl>
  </section>

  <section>
    <h2>Health checks</h2>
    <table>
      <thead><tr><th>Check</th><th>Status</th><th>When</th><th>Evidence</th></tr></thead>
      <tbody>${healthRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Integrity verdicts</h2>
    <table>
      <thead><tr><th>Source</th><th>Verdict</th><th>When</th></tr></thead>
      <tbody>${integrityRows}</tbody>
    </table>
  </section>

  <section>
    <h2>Approvals</h2>
    <table>
      <thead><tr><th>Action</th><th>Approver</th><th>Approved</th></tr></thead>
      <tbody>${approvalRows}</tbody>
    </table>
  </section>
</div>
</body>
</html>`;
}
