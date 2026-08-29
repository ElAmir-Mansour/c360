'use client';

import type { ReactNode } from 'react';
import { FileJson, Globe, Shield, TerminalSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';
import type { AlertEvidence as AlertEvidenceItem, CyberAlert } from '@/types/cyber';

import { useAlertLabels } from '../../_lib/alerts-i18n';

interface AlertEvidenceProps {
  alert: CyberAlert;
}

export function AlertEvidence({ alert }: AlertEvidenceProps) {
  const t = useAlertLabels();
  const explanation = alert.explanation;
  const details = explanation.details ?? {};
  const metadata = alert.metadata ?? {};
  const evidence = explanation.evidence ?? [];
  const networkEvidence = evidence.filter((item) => (
    item.field === 'source_ip' || item.field === 'dest_ip' || item.field === 'dest_port'
  ));

  return (
    <div className="space-y-6">
      <Section icon={Shield} eyebrow={t.evidence.eyebrow} title={t.evidence.structuredEvidence}>
        {evidence.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-start text-xs uppercase tracking-caps-xwide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">{t.evidence.colLabel}</th>
                  <th className="px-4 py-3">{t.evidence.colValue}</th>
                  <th className="px-4 py-3">{t.evidence.colDescription}</th>
                </tr>
              </thead>
              <tbody>
                {evidence.map((item, index) => (
                  <tr key={`${item.field}-${index}`} className="border-t">
                    <td className="px-4 py-3 font-medium">{item.label}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{formatEvidenceValue(item)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyMessage message={t.evidence.noStructuredEvidence} />
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section icon={Globe} eyebrow={t.evidence.eyebrow} title={t.evidence.networkContext}>
          {networkEvidence.length > 0 ? (
            <div className="space-y-3">
              {networkEvidence.map((item, index) => (
                <div key={`${item.field}-${index}`} className="rounded-2xl border bg-background px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <Badge variant="outline">{item.field}</Badge>
                  </div>
                  <p className="mt-2 font-mono text-xs text-foreground">{formatEvidenceValue(item)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyMessage message={t.evidence.noNetworkPivots} />
          )}
        </Section>

        <Section icon={TerminalSquare} eyebrow={t.evidence.eyebrow} title={t.evidence.assetContext}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <ContextItem label={t.evidence.asset} value={alert.asset_name ?? t.evidence.unknown} />
            <ContextItem label={t.evidence.hostname} value={alert.asset_hostname ?? t.evidence.unknown} />
            <ContextItem label={t.evidence.ipAddress} value={alert.asset_ip_address ?? t.evidence.unknown} />
            <ContextItem label={t.evidence.operatingSystem} value={alert.asset_os ?? t.evidence.unknown} />
            <ContextItem label={t.evidence.owner} value={alert.asset_owner ?? t.evidence.unknown} />
            <ContextItem label={t.evidence.criticality} value={alert.asset_criticality ?? t.evidence.unknown} />
            <ContextItem label={t.evidence.firstEvent} value={formatDateTime(alert.first_event_at)} />
            <ContextItem label={t.evidence.lastEvent} value={formatDateTime(alert.last_event_at)} />
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section icon={Shield} eyebrow={t.evidence.eyebrow} title={t.evidence.indicatorMatches}>
          {(explanation.indicator_matches?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              {explanation.indicator_matches?.map((match, index) => (
                <div key={`${match.value}-${index}`} className="rounded-2xl border bg-background px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{match.type}</Badge>
                    <Badge variant="secondary">{match.source}</Badge>
                    <Badge variant="secondary">{Math.round(match.confidence * 100)}%</Badge>
                  </div>
                  <p className="mt-3 break-all font-mono text-xs text-foreground">{match.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyMessage message={t.evidence.noThreatIntelMatches} />
          )}
        </Section>

        <Section icon={FileJson} eyebrow={t.evidence.eyebrow} title={t.evidence.detectionPayload}>
          <div className="space-y-4">
            <JsonBlock title={t.evidence.explanationDetails} value={details} />
            <JsonBlock title={t.evidence.alertMetadata} value={metadata} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  eyebrow,
  title,
  children,
}: {
  icon: typeof Shield;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-softer border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/15 bg-secondary text-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {eyebrow}
          </p>
          <h2 className="text-h4 font-semibold text-foreground">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-background px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm text-foreground">{value}</p>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-2xl border bg-auth-dark p-4 text-emerald-100">
      <p className="mb-3 text-xs font-semibold uppercase tracking-caps-xwide text-emerald-100/60">{title}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </div>
  );
}

function formatEvidenceValue(item: AlertEvidenceItem): string {
  if (typeof item.value === 'string') {
    return item.value;
  }
  return JSON.stringify(item.value) ?? 'null';
}

function EmptyMessage({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}
