/**
 * evidence-pack-html.ts — pure builder for a self-contained, print-optimised
 * HTML document of an assembled evidence pack.
 *
 * The on-screen preview is the React `EvidencePackPrintView`; for browser
 * print-to-PDF we render the SAME pack into a standalone HTML document (opened in
 * a new window) so the printed report is clean, branded, and independent of the
 * app's runtime DOM/Tailwind. This module is pure and deterministic (no
 * `Date.now()` / no `window` reads) so the markup is unit-testable; all dynamic
 * text is HTML-escaped to keep the output injection-safe.
 *
 * Styling uses the ClarioDR brand tokens as plain CSS custom properties so the
 * standalone document needs no external stylesheet. No data is invented — the
 * builder reads only fields present on the assembled `EvidencePack`.
 */

import type { AppLocale } from '@/lib/i18n';
import type {
  EvidenceGateOutcome,
  EvidencePack,
  EvidencePackGate,
} from '../../../_lib/evidence-export';
import {
  evidenceExportLabels,
  type EvidenceExportLabels,
  type EvidenceExportStringKey,
} from './labels';

const GATE_LABEL_KEYS: Record<EvidencePackGate['key'], EvidenceExportStringKey> = {
  validate: 'gateValidate',
  approve: 'gateApprove',
  execute: 'gateExecute',
  attest: 'gateAttest',
};

const OUTCOME_LABEL_KEYS: Record<EvidenceGateOutcome, EvidenceExportStringKey> = {
  passed: 'outcomePassed',
  failed: 'outcomeFailed',
  skipped: 'outcomeSkipped',
  pending: 'outcomePending',
};

/** Brand tone -> the standalone doc's CSS class for a status pill. */
function outcomePillClass(outcome: EvidenceGateOutcome): string {
  switch (outcome) {
    case 'passed':
      return 'pill pill-ok';
    case 'failed':
      return 'pill pill-bad';
    case 'skipped':
      return 'pill pill-muted';
    default:
      return 'pill pill-warn';
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSeconds(seconds: number | null | undefined, naLabel: string): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return naLabel;
  const sign = seconds < 0 ? '-' : '';
  const total = Math.abs(Math.round(seconds));
  if (total < 60) return `${sign}${total}s`;
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  if (mins < 60) return rem > 0 ? `${sign}${mins}m ${rem}s` : `${sign}${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${sign}${hours}h ${minRem}m` : `${sign}${hours}h`;
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

function shortHash(value: string | null | undefined, naLabel: string): string {
  if (!value) return naLabel;
  if (value.length <= 20) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
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
ul.gates{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:0;margin:0}
ul.gates li{border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--soft)}
ul.gates .glabel{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;margin-bottom:6px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:start;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
  border-bottom:1px solid var(--line);padding-block:6px;padding-inline:0 8px}
td{padding-block:7px;padding-inline:0 8px;border-bottom:1px solid var(--line)}
.note{border:1px dashed var(--line);border-radius:8px;padding:10px 12px;color:var(--muted)}
.bad{color:var(--bad)}
@media print{body{font-size:12px}.page{padding:0}header.brand{margin-top:8px}}
`;

/**
 * Build a complete, standalone HTML document (string) for printing the pack.
 * Pure: identical packs produce identical markup.
 */
export function buildEvidencePackPrintHtml(
  pack: EvidencePack,
  labels: EvidenceExportLabels = evidenceExportLabels,
  locale: AppLocale = 'en',
): string {
  const { meta, run, rto, gates, attestation, ledger_entries: ledger, hash_chain: chain } = pack;
  const na = labels.notAvailable;
  const isRtl = locale === 'ar';
  const docLang = isRtl ? 'ar' : 'en';
  const docDir = isRtl ? 'rtl' : 'ltr';

  const chainPill = chain.verified_intact
    ? `<span class="pill pill-ok">${escapeHtml(labels.hashChainVerified)}</span>`
    : `<span class="pill pill-bad">${escapeHtml(labels.hashChainBroken)}</span>`;

  const rtoVerdict = rto.met
    ? `<span class="pill pill-ok">${escapeHtml(labels.rtoVerdictMet)}</span>`
    : rto.breached
      ? `<span class="pill pill-bad">${escapeHtml(labels.rtoVerdictBreached)}</span>`
      : `<span class="pill pill-muted">${escapeHtml(labels.rtoVerdictPending)}</span>`;

  const runStatusPill = run.terminal_failure
    ? `<span class="pill pill-bad">${escapeHtml(run.status)}</span>`
    : `<span class="pill pill-ok">${escapeHtml(run.status)}</span>`;

  const gatesHtml = gates
    .map(
      (gate) => `<li>
        <div class="glabel">${escapeHtml(labels[GATE_LABEL_KEYS[gate.key]])}</div>
        <span class="${outcomePillClass(gate.outcome)}">${escapeHtml(
          labels[OUTCOME_LABEL_KEYS[gate.outcome]],
        )}</span>
      </li>`,
    )
    .join('');

  const attestationHtml = attestation
    ? `<dl class="grid">
        ${field(labels.attestationId, `<span class="mono">${escapeHtml(attestation.id)}</span>`)}
        ${field(labels.attestationRpo, escapeHtml(formatSeconds(attestation.rpo_seconds, na)))}
        ${field(
          labels.attestationValidationRatio,
          `${Math.round(attestation.validation_ratio * 100)}%`,
        )}
        ${field(
          labels.attestationHash,
          `<span class="mono">${escapeHtml(shortHash(attestation.content_hash, na))}</span>`,
        )}
        ${field(
          labels.attestationObjectKey,
          `<span class="mono">${escapeHtml(attestation.report_object_key || na)}</span>`,
        )}
      </dl>`
    : `<p class="note">${escapeHtml(labels.noAttestation)}</p>`;

  const ledgerHtml =
    ledger.length === 0
      ? `<p class="note">${escapeHtml(labels.noLedgerEntries)}</p>`
      : `<table>
          <caption class="mono" style="position:absolute;left:-9999px">${escapeHtml(
            labels.ledgerHeading,
          )}</caption>
          <thead><tr>
            <th>${escapeHtml(labels.ledgerSeq)}</th>
            <th>${escapeHtml(labels.ledgerType)}</th>
            <th>${escapeHtml(labels.ledgerEntryHash)}</th>
            <th>${escapeHtml(labels.ledgerAnchored)}</th>
          </tr></thead>
          <tbody>
            ${ledger
              .map(
                (entry) => `<tr>
                  <td class="mono">${escapeHtml(entry.seq)}</td>
                  <td>${escapeHtml(entry.entry_type.replace(/_/g, ' '))}</td>
                  <td class="mono">${escapeHtml(shortHash(entry.entry_hash, na))}</td>
                  <td>${
                    entry.anchored_root
                      ? `<span class="pill pill-ok">${escapeHtml(labels.ledgerAnchored)}</span>`
                      : `<span class="pill pill-muted">${escapeHtml(labels.ledgerNotAnchored)}</span>`
                  }</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>`;

  const remainingValue =
    rto.remaining_seconds === null
      ? na
      : rto.remaining_seconds < 0
        ? `<span class="bad">${escapeHtml(formatSeconds(rto.remaining_seconds, na))}</span>`
        : escapeHtml(formatSeconds(rto.remaining_seconds, na));

  const lastErrorField = run.last_error
    ? field(labels.lastError, `<span class="bad">${escapeHtml(run.last_error)}</span>`)
    : '';

  return `<!DOCTYPE html>
<html lang="${docLang}" dir="${docDir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(labels.printHeading)} — ${escapeHtml(run.id)}</title>
<style>${DOC_STYLES}</style>
</head>
<body>
<main class="page">
  <header class="brand">
    <div>
      <div class="kicker">ClarioDR</div>
      <h1>${escapeHtml(labels.printHeading)}</h1>
      <p class="sub">${escapeHtml(labels.printSubheading)}</p>
    </div>
    <div>${chainPill}</div>
  </header>

  <section>
    <dl class="grid cols-4">
      ${field(labels.generatedAt, escapeHtml(formatDateTime(meta.generated_at, na)))}
      ${field(labels.generatedBy, escapeHtml(meta.generated_by ?? na))}
      ${field(labels.tenant, `<span class="mono">${escapeHtml(meta.tenant_id)}</span>`)}
      ${field(
        labels.group,
        meta.group_name
          ? escapeHtml(meta.group_name)
          : `<span class="mono">${escapeHtml(meta.group_id)}</span>`,
      )}
    </dl>
  </section>

  <hr />

  <section>
    <h2>${escapeHtml(labels.runHeading)}</h2>
    <dl class="grid">
      ${field(labels.runId, `<span class="mono">${escapeHtml(run.id)}</span>`)}
      ${field(labels.runMode, escapeHtml(run.mode))}
      ${field(labels.runStatus, runStatusPill)}
      ${field(
        labels.recoveryPoint,
        run.recovery_point_id
          ? `<span class="mono">${escapeHtml(run.recovery_point_id)}</span>`
          : na,
      )}
      ${field(labels.initiatedBy, escapeHtml(run.initiated_by))}
      ${field(labels.approvedBy, escapeHtml(run.approved_by ?? na))}
      ${field(labels.initiatedAt, escapeHtml(formatDateTime(run.initiated_at, na)))}
      ${field(labels.completedAt, escapeHtml(formatDateTime(run.completed_at, na)))}
      ${lastErrorField}
    </dl>
  </section>

  <hr />

  <section>
    <h2>${escapeHtml(labels.rtoHeading)} ${rtoVerdict}</h2>
    <dl class="grid">
      ${field(labels.rtoObjective, escapeHtml(formatSeconds(rto.objective_seconds, na)))}
      ${field(labels.rtoActual, escapeHtml(formatSeconds(rto.actual_seconds, na)))}
      ${field(labels.rtoRemaining, remainingValue)}
    </dl>
  </section>

  <hr />

  <section>
    <h2>${escapeHtml(labels.gatesHeading)}</h2>
    <ul class="gates">${gatesHtml}</ul>
  </section>

  <hr />

  <section>
    <h2>${escapeHtml(labels.attestationHeading)}</h2>
    ${attestationHtml}
  </section>

  <hr />

  <section>
    <h2>${escapeHtml(labels.ledgerHeading)}</h2>
    ${ledgerHtml}
  </section>

  <hr />

  <section>
    <h2>${escapeHtml(labels.hashChainHeading)}</h2>
    <dl class="grid">
      ${field(
        chain.verified_intact ? labels.hashChainVerified : labels.hashChainBroken,
        chainPill,
      )}
      ${field(labels.hashChainEntriesChecked, escapeHtml(chain.entries_checked))}
      ${field(
        labels.hashChainHeadHash,
        `<span class="mono">${escapeHtml(shortHash(chain.head_hash, na))}</span>`,
      )}
      ${field(labels.hashChainIncluded, escapeHtml(chain.included_entry_count))}
      ${field(
        chain.included_links_contiguous
          ? labels.hashChainContiguous
          : labels.hashChainNotContiguous,
        chain.included_links_contiguous
          ? `<span class="pill pill-ok">${escapeHtml(labels.hashChainContiguous)}</span>`
          : `<span class="pill pill-warn">${escapeHtml(labels.hashChainNotContiguous)}</span>`,
      )}
      ${field(labels.hashChainAnchored, escapeHtml(chain.anchored_entry_count))}
    </dl>
  </section>
</main>
</body>
</html>`;
}
