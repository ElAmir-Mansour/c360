'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Search, ShieldAlert, Timer } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LexRecordPicker } from '@/components/lex/lex-record-picker';
import { apiGet, apiPost } from '@/lib/api';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLexFormat } from '@/lib/lex/ksa';
import { useLocale } from '@/components/providers/locale-provider';
import { useSLALabels, type SLALabels } from '../../_lib/admin-labels';

type ClockLabels = SLALabels['clockMonitor'];

/**
 * Locale-bound datetime formatter for the SLA clock monitor. `format` is the
 * Lex `formatDate` (Arabic-Indic digits + locale-aware month names in ar mode)
 * and `notSet` is the localized empty-value label.
 */
interface ClockDateFormatter {
  format: (value?: string | null) => string;
  notSet: string;
}

interface SLAClockMonitorRecord {
  id?: string | null;
  legal_request_id?: string | null;
  request_id?: string | null;
  service_code?: string | null;
  priority?: string | null;
  clock_started_at?: string | null;
  started_at?: string | null;
  ack_due_at?: string | null;
  acknowledgement_due_at?: string | null;
  ack_done?: boolean | null;
  acknowledged?: boolean | null;
  ack_done_at?: string | null;
  acknowledged_at?: string | null;
  turnaround_due_at?: string | null;
  due_at?: string | null;
  escalation_l1_due_at?: string | null;
  escalation_l2_due_at?: string | null;
  escalation_l3_due_at?: string | null;
  l1_due_at?: string | null;
  l2_due_at?: string | null;
  l3_due_at?: string | null;
  escalation_level?: number | null;
  escalation_state?: string | null;
  escalated?: boolean | null;
  escalated_at?: string | null;
  breached?: boolean | null;
  breach_state?: string | null;
  breached_at?: string | null;
  outcome?: string | null;
  status?: string | null;
  resolved_at?: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface ApiEnvelope<T> {
  data?: T | null;
}

interface SLAClockMonitorProps {
  canWrite: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapClock(payload: SLAClockMonitorRecord | ApiEnvelope<SLAClockMonitorRecord> | null): SLAClockMonitorRecord | null {
  if (!isRecord(payload)) {
    return null;
  }
  if ('data' in payload) {
    if (!isRecord(payload.data)) {
      return null;
    }
    return payload.data as SLAClockMonitorRecord;
  }
  return payload as SLAClockMonitorRecord;
}

function getText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function getBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
}

function formatClockDate(fmt: ClockDateFormatter, value?: string | null): string {
  if (!value) return fmt.notSet;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return fmt.format(value);
}

function clockIdFrom(clock: SLAClockMonitorRecord | null, fallback: string): string {
  return getText(clock?.id) ?? fallback.trim();
}

function dueRows(clock: SLAClockMonitorRecord, l: ClockLabels): Array<{ label: string; value?: string | null }> {
  return [
    { label: l.started, value: clock.clock_started_at ?? clock.started_at },
    { label: l.ackDue, value: clock.ack_due_at ?? clock.acknowledgement_due_at },
    { label: l.turnaround, value: clock.turnaround_due_at ?? clock.due_at },
    { label: l.l1, value: clock.escalation_l1_due_at ?? clock.l1_due_at },
    { label: l.l2, value: clock.escalation_l2_due_at ?? clock.l2_due_at },
    { label: l.l3, value: clock.escalation_l3_due_at ?? clock.l3_due_at },
  ];
}

function ackLabel(clock: SLAClockMonitorRecord, fmt: ClockDateFormatter, l: ClockLabels): { label: string; done: boolean } {
  const done =
    getBool(clock.ack_done) ??
    getBool(clock.acknowledged) ??
    Boolean(clock.ack_done_at ?? clock.acknowledged_at);
  const ackDate = clock.ack_done_at ?? clock.acknowledged_at;
  return {
    done,
    label: done
      ? ackDate
        ? l.acknowledgedAt(formatClockDate(fmt, ackDate))
        : l.acknowledged
      : l.pendingAck,
  };
}

function breachLabel(clock: SLAClockMonitorRecord, fmt: ClockDateFormatter, l: ClockLabels): { label: string; breached: boolean } {
  const outcome = getText(clock.outcome ?? clock.status ?? clock.breach_state)?.toLowerCase();
  const breached = getBool(clock.breached) ?? outcome?.includes('breach') ?? false;
  return {
    breached,
    label: breached
      ? clock.breached_at
        ? l.breachedAt(formatClockDate(fmt, clock.breached_at))
        : l.breached
      : outcome ?? l.onTrack,
  };
}

function escalationLabel(clock: SLAClockMonitorRecord, l: ClockLabels): { label: string; active: boolean } {
  const level = typeof clock.escalation_level === 'number' ? clock.escalation_level : null;
  const state = getText(clock.escalation_state ?? clock.status);
  const escalated = getBool(clock.escalated) ?? Boolean(clock.escalated_at) ?? Boolean(level && level > 0);
  if (level && level > 0) return { label: l.level(level), active: true };
  if (state) return { label: state, active: escalated };
  return { label: escalated ? l.escalated : l.noEscalation, active: escalated };
}

export function SLAClockMonitor({ canWrite }: SLAClockMonitorProps) {
  useLocale();
  const sla = useSLALabels();
  const cl = sla.clockMonitor;
  const f = useLexFormat();
  const dateFmt = useMemo<ClockDateFormatter>(
    () => ({
      format: (value) => f.formatDate(value, { dateStyle: 'medium', timeStyle: 'short' }),
      notSet: cl.notSet,
    }),
    [f, cl.notSet],
  );

  const [requestId, setRequestId] = useState('');
  const [clockId, setClockId] = useState('');
  const [clock, setClock] = useState<SLAClockMonitorRecord | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const activeClockId = useMemo(() => clockIdFrom(clock, clockId), [clock, clockId]);
  const ack = useMemo(() => (clock ? ackLabel(clock, dateFmt, cl) : null), [clock, dateFmt, cl]);
  const breach = useMemo(() => (clock ? breachLabel(clock, dateFmt, cl) : null), [clock, dateFmt, cl]);
  const escalation = useMemo(() => (clock ? escalationLabel(clock, cl) : null), [clock, cl]);

  const lookupClock = useMutation({
    mutationFn: async (mode: 'request' | 'clock') => {
      const id = mode === 'request' ? requestId.trim() : clockId.trim();
      const encodedId = encodeURIComponent(id);
      const url =
        mode === 'request'
          ? `/api/v1/lex/sla/requests/${encodedId}/clock`
          : `/api/v1/lex/sla/clocks/${encodedId}`;
      return unwrapClock(await apiGet<SLAClockMonitorRecord | ApiEnvelope<SLAClockMonitorRecord> | null>(url));
    },
    onSuccess: (result, mode) => {
      setClock(result);
      setSource(result ? (mode === 'request' ? cl.requestLookup : cl.clockLookup) : null);
      if (result?.id && !clockId.trim()) setClockId(String(result.id));
      if (result) showSuccess(cl.toastLoaded);
    },
    onError: showApiError,
  });

  const acknowledgeClock = useMutation({
    mutationFn: async (id: string) =>
      unwrapClock(
        await apiPost<SLAClockMonitorRecord | ApiEnvelope<SLAClockMonitorRecord>>(
          `/api/v1/lex/sla/clocks/${encodeURIComponent(id)}/acknowledge`,
          {},
        ),
      ),
    onSuccess: (result) => {
      if (result) setClock(result);
      showSuccess(cl.toastAcknowledged);
    },
    onError: showApiError,
  });

  const escalateClock = useMutation({
    mutationFn: async (id: string) =>
      unwrapClock(
        await apiPost<SLAClockMonitorRecord | ApiEnvelope<SLAClockMonitorRecord>>(
          `/api/v1/lex/sla/clocks/${encodeURIComponent(id)}/escalate`,
          {},
        ),
      ),
    onSuccess: (result) => {
      if (result) setClock(result);
      showSuccess(cl.toastEscalated);
    },
    onError: showApiError,
  });

  const loading = lookupClock.isPending || acknowledgeClock.isPending || escalateClock.isPending;

  return (
    <SectionCard
      title={cl.title}
      description={cl.description}
      className="scroll-mt-6"
    >
      <div id="sla-clock-monitor" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <LexRecordPicker
            kind="legal_request"
            ariaLabel={cl.requestIdPlaceholder}
            value={requestId}
            onChange={setRequestId}
            allowClear
            labels={{ select: cl.requestIdPlaceholder, search: cl.requestIdPlaceholder }}
          />
          <LexRecordPicker
            kind="sla_clock"
            ariaLabel={cl.clockIdPlaceholder}
            value={clockId}
            onChange={setClockId}
            allowClear
            labels={{ select: cl.clockIdPlaceholder, search: cl.clockIdPlaceholder }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => lookupClock.mutate('request')}
            disabled={!requestId.trim() || lookupClock.isPending}
          >
            {lookupClock.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Search className="me-1.5 h-4 w-4" />
            )}
            {cl.byRequest}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => lookupClock.mutate('clock')}
            disabled={!clockId.trim() || lookupClock.isPending}
          >
            {lookupClock.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Timer className="me-1.5 h-4 w-4" />
            )}
            {cl.byClock}
          </Button>
        </div>

        {clock ? (
          <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{getText(clock.service_code) ?? cl.fallbackClock}</p>
                  {clock.priority ? <Badge variant="secondary">{clock.priority}</Badge> : null}
                  {source ? <Badge variant="outline">{source}</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {cl.clockMeta(
                    getText(clock.id) ?? cl.unknown,
                    getText(clock.legal_request_id ?? clock.request_id) ?? cl.unknown,
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {ack ? (
                  <Badge variant={ack.done ? 'success' : 'warning'}>
                    <CheckCircle2 className="me-1 h-3 w-3" />
                    {ack.label}
                  </Badge>
                ) : null}
                {breach ? (
                  <Badge variant={breach.breached ? 'destructive' : 'success'}>
                    <AlertTriangle className="me-1 h-3 w-3" />
                    {breach.label}
                  </Badge>
                ) : null}
                {escalation ? (
                  <Badge variant={escalation.active ? 'destructive' : 'outline'}>
                    <ShieldAlert className="me-1 h-3 w-3" />
                    {escalation.label}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {dueRows(clock, cl).map((row) => (
                <div key={row.label} className="rounded-md border bg-background px-3 py-2">
                  <p className="text-overline font-semibold uppercase tracking-label text-muted-foreground">{row.label}</p>
                  <p className="mt-1 text-sm font-medium">{formatClockDate(dateFmt, row.value)}</p>
                </div>
              ))}
            </div>

            {canWrite && activeClockId ? (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => acknowledgeClock.mutate(activeClockId)}
                  disabled={loading || ack?.done}
                >
                  {acknowledgeClock.isPending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {cl.acknowledge}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => escalateClock.mutate(activeClockId)}
                  disabled={loading}
                >
                  {escalateClock.isPending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldAlert className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {cl.escalate}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {cl.emptyPrompt}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
