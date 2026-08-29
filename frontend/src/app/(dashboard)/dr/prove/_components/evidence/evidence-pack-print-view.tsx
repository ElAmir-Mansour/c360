'use client';

import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type {
  EvidencePack,
  EvidenceGateOutcome,
  EvidencePackGate,
} from '../../../_lib/evidence-export';
import {
  evidenceExportLabels,
  type EvidenceExportLabels,
  type EvidenceExportStringKey,
} from './labels';

/**
 * EvidencePackPrintView
 * =====================
 * A clean, branded, accessibility-conscious render of an assembled
 * {@link EvidencePack}, optimised for browser print-to-PDF. It uses only
 * design-system Tailwind tokens (no arbitrary values / hex), logical spacing for
 * RTL safety, and pairs every status colour with a text label so meaning never
 * depends on colour alone (WCAG 2.1 AA). The same view renders both on screen
 * (inside the export dialog) and on the printed page.
 *
 * It is purely presentational: it renders the already-assembled pack and invents
 * no data.
 */

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

type BadgeVariant = 'success' | 'destructive' | 'warning' | 'outline';

function outcomeVariant(outcome: EvidenceGateOutcome): BadgeVariant {
  switch (outcome) {
    case 'passed':
      return 'success';
    case 'failed':
      return 'destructive';
    case 'skipped':
      return 'outline';
    default:
      return 'warning';
  }
}

function formatSeconds(seconds?: number | null, naLabel = 'n/a'): string {
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

function formatDateTime(value?: string | null, naLabel = 'n/a'): string {
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

function shortHash(value?: string | null, naLabel = 'n/a'): string {
  if (!value) return naLabel;
  if (value.length <= 20) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-overline font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

export interface EvidencePackPrintViewProps {
  pack: EvidencePack;
  labels?: EvidenceExportLabels;
  /** Extra classes for the print-target container (e.g. an id for print scoping). */
  className?: string;
  /** id attribute applied to the print-target root. */
  id?: string;
}

export function EvidencePackPrintView({
  pack,
  labels = evidenceExportLabels,
  className,
  id,
}: EvidencePackPrintViewProps) {
  const { meta, run, rto, gates, attestation, ledger_entries: ledger, hash_chain: chain } = pack;
  const na = labels.notAvailable;

  const rtoVerdict = rto.met
    ? labels.rtoVerdictMet
    : rto.breached
      ? labels.rtoVerdictBreached
      : labels.rtoVerdictPending;
  const rtoVariant: BadgeVariant = rto.met ? 'success' : rto.breached ? 'destructive' : 'outline';

  return (
    <article
      id={id}
      className={['space-y-6 bg-card p-6 text-foreground', className].filter(Boolean).join(' ')}
      aria-label={labels.printHeading}
    >
      {/* Branded header */}
      <header className="space-y-2 border-b pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-overline font-semibold uppercase tracking-wide text-primary">
              ClarioDR
            </p>
            <h2 className="text-h4 font-semibold text-foreground">{labels.printHeading}</h2>
            <p className="text-caption text-muted-foreground">{labels.printSubheading}</p>
          </div>
          <Badge variant={chain.verified_intact ? 'success' : 'destructive'} className="shrink-0">
            {chain.verified_intact ? (
              <ShieldCheck className="me-1 h-3.5 w-3.5" aria-hidden />
            ) : (
              <ShieldAlert className="me-1 h-3.5 w-3.5" aria-hidden />
            )}
            <span>{chain.verified_intact ? labels.hashChainVerified : labels.hashChainBroken}</span>
          </Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 pt-2 sm:grid-cols-4">
          <Field label={labels.generatedAt} value={formatDateTime(meta.generated_at, na)} />
          <Field label={labels.generatedBy} value={meta.generated_by ?? na} />
          <Field label={labels.tenant} value={<span className="font-mono">{meta.tenant_id}</span>} />
          <Field
            label={labels.group}
            value={meta.group_name ?? <span className="font-mono">{meta.group_id}</span>}
          />
        </dl>
      </header>

      {/* Run summary */}
      <section className="space-y-3" aria-labelledby="evidence-run-heading">
        <SectionHeading>
          <span id="evidence-run-heading">{labels.runHeading}</span>
        </SectionHeading>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label={labels.runId} value={<span className="font-mono text-xs">{run.id}</span>} />
          <Field label={labels.runMode} value={<span className="capitalize">{run.mode}</span>} />
          <Field
            label={labels.runStatus}
            value={
              <Badge variant={run.terminal_failure ? 'destructive' : 'success'}>{run.status}</Badge>
            }
          />
          <Field
            label={labels.recoveryPoint}
            value={
              run.recovery_point_id ? (
                <span className="font-mono text-xs">{run.recovery_point_id}</span>
              ) : (
                na
              )
            }
          />
          <Field label={labels.initiatedBy} value={run.initiated_by} />
          <Field label={labels.approvedBy} value={run.approved_by ?? na} />
          <Field label={labels.initiatedAt} value={formatDateTime(run.initiated_at, na)} />
          <Field label={labels.completedAt} value={formatDateTime(run.completed_at, na)} />
          {run.last_error ? (
            <Field
              label={labels.lastError}
              value={<span className="text-destructive">{run.last_error}</span>}
            />
          ) : null}
        </dl>
      </section>

      <Separator />

      {/* RTO vs RTA */}
      <section className="space-y-3" aria-labelledby="evidence-rto-heading">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading>
            <span id="evidence-rto-heading">{labels.rtoHeading}</span>
          </SectionHeading>
          <Badge variant={rtoVariant}>{rtoVerdict}</Badge>
        </div>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-3">
          <Field label={labels.rtoObjective} value={formatSeconds(rto.objective_seconds, na)} />
          <Field label={labels.rtoActual} value={formatSeconds(rto.actual_seconds, na)} />
          <Field
            label={labels.rtoRemaining}
            value={
              rto.remaining_seconds === null ? (
                na
              ) : (
                <span className={rto.remaining_seconds < 0 ? 'text-destructive' : undefined}>
                  {formatSeconds(rto.remaining_seconds, na)}
                </span>
              )
            }
          />
        </dl>
      </section>

      <Separator />

      {/* Four-gate outcome */}
      <section className="space-y-3" aria-labelledby="evidence-gates-heading">
        <SectionHeading>
          <span id="evidence-gates-heading">{labels.gatesHeading}</span>
        </SectionHeading>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {gates.map((gate) => (
            <li key={gate.key} className="rounded-lg border bg-muted/20 px-3 py-2">
              <div className="text-overline font-semibold uppercase text-muted-foreground">
                {labels[GATE_LABEL_KEYS[gate.key]]}
              </div>
              <div className="mt-1.5">
                <Badge variant={outcomeVariant(gate.outcome)}>
                  {labels[OUTCOME_LABEL_KEYS[gate.outcome]]}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      {/* Sealed attestation */}
      <section className="space-y-3" aria-labelledby="evidence-attestation-heading">
        <SectionHeading>
          <span id="evidence-attestation-heading">{labels.attestationHeading}</span>
        </SectionHeading>
        {attestation ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Field
              label={labels.attestationId}
              value={<span className="font-mono text-xs">{attestation.id}</span>}
            />
            <Field label={labels.attestationRpo} value={formatSeconds(attestation.rpo_seconds, na)} />
            <Field
              label={labels.attestationValidationRatio}
              value={`${Math.round(attestation.validation_ratio * 100)}%`}
            />
            <Field
              label={labels.attestationHash}
              value={<span className="font-mono text-xs">{shortHash(attestation.content_hash, na)}</span>}
            />
            <Field
              label={labels.attestationObjectKey}
              value={<span className="font-mono text-xs">{attestation.report_object_key || na}</span>}
            />
          </dl>
        ) : (
          <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            {labels.noAttestation}
          </p>
        )}
      </section>

      <Separator />

      {/* Ledger entries */}
      <section className="space-y-3" aria-labelledby="evidence-ledger-heading">
        <SectionHeading>
          <span id="evidence-ledger-heading">{labels.ledgerHeading}</span>
        </SectionHeading>
        {ledger.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
            {labels.noLedgerEntries}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{labels.ledgerHeading}</caption>
              <thead>
                <tr className="border-b text-start text-overline font-semibold uppercase text-muted-foreground">
                  <th scope="col" className="py-2 pe-3 text-start">
                    {labels.ledgerSeq}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-start">
                    {labels.ledgerType}
                  </th>
                  <th scope="col" className="py-2 pe-3 text-start">
                    {labels.ledgerEntryHash}
                  </th>
                  <th scope="col" className="py-2 text-start">
                    {labels.ledgerAnchored}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.seq} className="border-b last:border-b-0">
                    <td className="py-2 pe-3 font-mono">{entry.seq}</td>
                    <td className="py-2 pe-3 capitalize">{entry.entry_type.replace(/_/g, ' ')}</td>
                    <td className="py-2 pe-3 font-mono text-xs">{shortHash(entry.entry_hash, na)}</td>
                    <td className="py-2">
                      <Badge variant={entry.anchored_root ? 'success' : 'outline'}>
                        {entry.anchored_root ? labels.ledgerAnchored : labels.ledgerNotAnchored}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Separator />

      {/* Hash-chain integrity */}
      <section className="space-y-3" aria-labelledby="evidence-chain-heading">
        <SectionHeading>
          <span id="evidence-chain-heading">{labels.hashChainHeading}</span>
        </SectionHeading>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field
            label={chain.verified_intact ? labels.hashChainVerified : labels.hashChainBroken}
            value={
              <Badge variant={chain.verified_intact ? 'success' : 'destructive'}>
                {chain.verified_intact ? labels.hashChainVerified : labels.hashChainBroken}
              </Badge>
            }
          />
          <Field label={labels.hashChainEntriesChecked} value={chain.entries_checked} />
          <Field
            label={labels.hashChainHeadHash}
            value={<span className="font-mono text-xs">{shortHash(chain.head_hash, na)}</span>}
          />
          <Field label={labels.hashChainIncluded} value={chain.included_entry_count} />
          <Field
            label={
              chain.included_links_contiguous
                ? labels.hashChainContiguous
                : labels.hashChainNotContiguous
            }
            value={
              <Badge variant={chain.included_links_contiguous ? 'success' : 'warning'}>
                {chain.included_links_contiguous
                  ? labels.hashChainContiguous
                  : labels.hashChainNotContiguous}
              </Badge>
            }
          />
          <Field label={labels.hashChainAnchored} value={chain.anchored_entry_count} />
        </dl>
      </section>
    </article>
  );
}
