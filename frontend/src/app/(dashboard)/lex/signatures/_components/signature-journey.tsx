'use client';

import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Eye,
  Send,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Timeline } from '@/components/shared/timeline';
import { formatDateTime } from '@/lib/format';
import type { LexSignatureEnvelope, LexSignatureRecipient } from '@/types/suites';
import { useSignatureLabels } from './labels';

type NodeStage = 'pending' | 'sent' | 'viewed' | 'signed' | 'declined';

interface StageVisual {
  icon: LucideIcon;
  node: string;
  iconColor: string;
}

const STAGE_VISUALS: Record<NodeStage, StageVisual> = {
  pending: {
    icon: Clock,
    node: 'border-border bg-muted text-muted-foreground',
    iconColor: '',
  },
  sent: {
    icon: Send,
    node: 'border-brand-teal-300 bg-brand-teal-50 text-brand-teal-700 dark:border-brand-teal-800 dark:bg-brand-teal-950/40 dark:text-brand-teal-300',
    iconColor: '',
  },
  viewed: {
    icon: Eye,
    node: 'border-warning-300 bg-warning-50 text-warning-700 dark:border-warning-800 dark:bg-warning-800/40 dark:text-warning-300',
    iconColor: '',
  },
  signed: {
    icon: CheckCircle2,
    node: 'border-primary/40 bg-primary/10 text-primary',
    iconColor: '',
  },
  declined: {
    icon: XCircle,
    node: 'border-error-300 bg-error-50 text-error-500 dark:border-error-700 dark:bg-error-700/40 dark:text-error-300',
    iconColor: '',
  },
};

function stageFor(status: string): NodeStage {
  switch (status) {
    case 'signed':
      return 'signed';
    case 'declined':
      return 'declined';
    case 'viewed':
      return 'viewed';
    case 'sent':
      return 'sent';
    case 'expired':
    case 'cancelled':
      return 'declined';
    default:
      return 'pending';
  }
}

/**
 * Determine whether the envelope routes recipients serially (each waits for the
 * previous signing_order) or in parallel (all share the same order). When every
 * recipient sits on a distinct, increasing order we treat it as serial.
 */
function isSerialFlow(recipients: LexSignatureRecipient[]): boolean {
  if (recipients.length <= 1) {
    return true;
  }
  const orders = recipients.map((r) => r.signing_order);
  return new Set(orders).size === orders.length;
}

interface SignatureJourneyProps {
  envelope: LexSignatureEnvelope;
}

/**
 * Horizontal signer journey: one node per recipient in signing order with a
 * stage icon + color, plus a unified audit timeline merging provider events and
 * custody evidence into a single chronological feed. Nafath envelopes get
 * Nafath-aware status labeling.
 */
export function SignatureJourney({ envelope }: SignatureJourneyProps) {
  const allLabels = useSignatureLabels();
  const labels = allLabels.detail.journey;
  const { direction } = useLocaleOrDefault();
  const isNafath = envelope.provider === 'nafath';

  const recipients = [...(envelope.recipients ?? [])].sort(
    (left, right) => left.signing_order - right.signing_order,
  );
  const serial = isSerialFlow(recipients);

  const statusLabel = (status: string): string => {
    const map = isNafath ? labels.nafathStatuses : labels.statuses;
    return map[status] ?? labels.statuses[status] ?? status;
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{labels.heading}</h3>
          <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
            {labels.flowLabel}: {serial ? labels.serial : labels.parallel}
          </span>
        </div>
        {recipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">{allLabels.detail.recipients.empty}</p>
        ) : (
          <ol className="flex flex-wrap items-stretch gap-1" aria-label={labels.heading}>
            {recipients.map((recipient, index) => {
              const stage = stageFor(String(recipient.status));
              const visual = STAGE_VISUALS[stage];
              const Icon = visual.icon;
              const isLast = index === recipients.length - 1;
              return (
                <li key={recipient.id} className="flex items-stretch gap-1">
                  <div className="flex w-32 flex-col items-center gap-1.5 text-center">
                    <div
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-full border',
                        visual.node,
                      )}
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                    </div>
                    <span className="line-clamp-2 text-xs font-medium leading-tight">
                      {recipient.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {statusLabel(String(recipient.status))}
                    </span>
                    {serial ? (
                      <span className="text-[11px] text-muted-foreground">
                        {allLabels.detail.recipients.order(recipient.signing_order)}
                      </span>
                    ) : null}
                  </div>
                  {serial && !isLast ? (
                    <div className="flex items-center pb-8 text-muted-foreground">
                      <ArrowRight
                        className={cn('h-4 w-4', direction === 'rtl' && 'rotate-180')}
                        aria-hidden
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <SignatureAuditTimeline envelope={envelope} />
    </div>
  );
}

interface AuditEntry {
  id: string;
  at: string;
  title: string;
  description?: string;
  variant: 'default' | 'success' | 'warning' | 'error';
  icon: LucideIcon;
}

function eventVariant(status: string): AuditEntry['variant'] {
  const value = status.toLowerCase();
  if (value.includes('declin') || value.includes('reject') || value.includes('fail') || value.includes('expire')) {
    return 'error';
  }
  if (value.includes('complete') || value.includes('sign') || value.includes('seal')) {
    return 'success';
  }
  if (value.includes('view') || value.includes('open') || value.includes('deliver')) {
    return 'warning';
  }
  return 'default';
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function SignatureAuditTimeline({ envelope }: { envelope: LexSignatureEnvelope }) {
  const allLabels = useSignatureLabels();
  const labels = allLabels.detail.auditTimeline;

  const eventEntries: AuditEntry[] = (envelope.events ?? []).map((event) => {
    const providerName = event.provider
      ? allLabels.enums.provider[event.provider] ?? titleCase(event.provider)
      : null;
    const statusPart = event.provider_status ? ` · ${event.provider_status}` : '';
    const descriptionParts = [
      providerName ? labels.providerVia(providerName) : null,
      event.provider_status ?? null,
    ].filter((part): part is string => Boolean(part));
    return {
      id: `event-${event.id}`,
      at: event.occurred_at,
      title: `${allLabels.enums.eventType[event.event_type] ?? titleCase(event.event_type)}${statusPart}`,
      description: descriptionParts.length > 0 ? descriptionParts.join(' · ') : undefined,
      variant: eventVariant(`${event.event_type} ${event.provider_status ?? ''}`),
      icon: Send,
    };
  });

  const custodyEntries: AuditEntry[] = (envelope.custody_evidence ?? []).map((entry) => {
    const providerName = allLabels.enums.provider[entry.provider] ?? titleCase(entry.provider);
    return {
      id: `custody-${entry.id}`,
      at: entry.signed_at,
      title: labels.custodySealed(entry.file_name),
      description: `${labels.custodyDetail} ${labels.providerVia(providerName)}`,
      variant: 'success',
      icon: CheckCircle2,
    };
  });

  const merged = [...eventEntries, ...custodyEntries].sort(
    (left, right) => new Date(right.at).valueOf() - new Date(left.at).valueOf(),
  );

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{labels.heading}</h3>
      {merged.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.empty}</p>
      ) : (
        <Timeline
          items={merged.map((entry) => ({
            id: entry.id,
            icon: entry.icon,
            title: entry.title,
            description: entry.description,
            timestamp: formatDateTime(entry.at),
            variant: entry.variant,
          }))}
        />
      )}
    </section>
  );
}
