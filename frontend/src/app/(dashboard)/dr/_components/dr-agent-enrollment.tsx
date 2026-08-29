'use client';

import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  KeyRound,
  Loader2,
  PlusCircle,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import type { DRAgent, DRAgentEnrollmentToken } from '@/types/clario-dr';

type DRAgentEnrollmentPanelProps = {
  agents: DRAgent[];
  selectedAgentId?: string | null;
  enrollmentToken?: DRAgentEnrollmentToken | null;
  creatingAgent: boolean;
  mintingToken: boolean;
  error: unknown;
  onCreateAgent: () => void;
  onMintToken: (agentID: string) => void;
  onSelectAgent: (agentID: string) => void;
  onRetry: () => void;
};

type Tone = 'success' | 'warning' | 'critical' | 'info' | 'neutral';

const HEARTBEAT_STALE_MS = 15 * 60 * 1000;
const CERT_EXPIRING_SOON_MS = 14 * 24 * 60 * 60 * 1000;

export function DRAgentEnrollmentPanel({
  agents,
  selectedAgentId,
  enrollmentToken,
  creatingAgent,
  mintingToken,
  error,
  onCreateAgent,
  onMintToken,
  onSelectAgent,
  onRetry,
}: DRAgentEnrollmentPanelProps) {
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const activeAgents = agents.filter((agent) => normalizeStatus(agent.status) === 'active').length;
  const staleAgents = agents.filter((agent) => agentStaleness(agent).state !== 'fresh').length;
  const expiringCerts = agents.filter((agent) => {
    const state = certificateState(agent).state;
    return state === 'expired' || state === 'expiring' || state === 'revoked';
  }).length;
  const tokenAgentID = enrollmentToken?.agent_id ?? selectedAgent?.id ?? null;

  if (error && agents.length === 0 && !creatingAgent) {
    return <ErrorState message="Failed to load DR agent enrollment data." onRetry={onRetry} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Agent enrollment</CardTitle>
            <CardDescription>Issue DR agent identities, mint enrollment tokens, and monitor certificate posture.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" size="sm" variant="outline" disabled={creatingAgent} onClick={onCreateAgent}>
              {creatingAgent ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="me-1.5 h-3.5 w-3.5" />}
              Create agent
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!selectedAgent || mintingToken}
              onClick={() => selectedAgent && onMintToken(selectedAgent.id)}
            >
              {mintingToken ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="me-1.5 h-3.5 w-3.5" />}
              Mint token
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricDatum label="Agents" value={agents.length} icon={ServerCog} tone={agents.length > 0 ? 'info' : 'neutral'} />
            <MetricDatum label="Active" value={`${activeAgents}/${agents.length}`} icon={CheckCircle2} tone={activeAgents === agents.length && agents.length > 0 ? 'success' : 'warning'} />
            <MetricDatum label="Stale" value={staleAgents} icon={Clock3} tone={staleAgents > 0 ? 'warning' : 'success'} />
            <MetricDatum label="Certificates" value={expiringCerts > 0 ? `${expiringCerts} attention` : 'current'} icon={ShieldCheck} tone={expiringCerts > 0 ? 'critical' : 'success'} />
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-warning-700 dark:text-warning-300">Some DR agent data may be stale because the latest refresh failed.</div>
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="me-1.5 h-3.5 w-3.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Agent fleet</CardTitle>
              <CardDescription>Heartbeat staleness, certificate expiry, and enrollment readiness by agent.</CardDescription>
            </div>
            <Badge variant="outline">{agents.length} agents</Badge>
          </CardHeader>
          <CardContent>
            {creatingAgent && agents.length === 0 ? (
              <LoadingSkeleton variant="table-row" count={4} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last seen</TableHead>
                      <TableHead>Certificate</TableHead>
                      <TableHead className="w-12 text-end">Select</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-sm text-muted-foreground">
                          No DR agents returned.
                        </TableCell>
                      </TableRow>
                    ) : (
                      agents.map((agent) => {
                        const staleness = agentStaleness(agent);
                        const certificate = certificateState(agent);
                        const selected = agent.id === selectedAgent?.id;

                        return (
                          <TableRow key={agent.id} data-state={selected ? 'selected' : undefined} className={selected ? 'bg-muted/70' : undefined}>
                            <TableCell>
                              <div className="font-mono text-xs">{shortHash(agent.id, 8, 6)}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{shortHash(agent.mtls_thumbprint)}</div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{agent.site_id ?? 'unassigned'}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1.5">
                                <StatusBadge status={agent.status} />
                                <StateBadge label={staleness.label} tone={staleness.tone} />
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{formatDateTime(agent.last_seen_at)}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{staleness.detail}</div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-xs">{agent.cert_serial ? shortHash(agent.cert_serial) : 'pending'}</span>
                                <StateBadge label={certificate.label} tone={certificate.tone} />
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">expires {formatDate(agent.cert_expires_at)}</div>
                            </TableCell>
                            <TableCell className="text-end">
                              <Button
                                type="button"
                                size="icon"
                                variant={selected ? 'default' : 'ghost'}
                                className="h-8 w-8"
                                aria-label={`Select agent ${agent.id}`}
                                onClick={() => onSelectAgent(agent.id)}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Selected agent</CardTitle>
              <CardDescription>Certificate identity and enrollment controls for the current agent.</CardDescription>
            </div>
            <StatusBadge status={selectedAgent?.status ?? 'empty'} label={selectedAgent ? undefined : 'none'} />
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedAgent ? (
              <>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm">{selectedAgent.id}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{selectedAgent.mtls_thumbprint ?? 'No mTLS thumbprint yet'}</div>
                    </div>
                    <StateBadge label={certificateState(selectedAgent).label} tone={certificateState(selectedAgent).tone} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <MiniDatum label="Tenant" value={shortHash(selectedAgent.tenant_id, 8, 6)} />
                    <MiniDatum label="Site" value={selectedAgent.site_id ?? 'unassigned'} />
                    <MiniDatum label="Created" value={formatDateTime(selectedAgent.created_at)} />
                    <MiniDatum label="Last seen" value={formatDateTime(selectedAgent.last_seen_at)} />
                    <MiniDatum label="Serial" value={selectedAgent.cert_serial ? shortHash(selectedAgent.cert_serial) : 'pending'} />
                    <MiniDatum label="Expires" value={formatDateTime(selectedAgent.cert_expires_at)} />
                  </div>
                </div>

                <div className="rounded-lg border px-3 py-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">Certificate state</div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <StateBadge label={agentStaleness(selectedAgent).label} tone={agentStaleness(selectedAgent).tone} />
                      <StateBadge label={certificateState(selectedAgent).label} tone={certificateState(selectedAgent).tone} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <MiniDatum label="Issued" value={formatDateTime(selectedAgent.cert_issued_at)} />
                    <MiniDatum label="Revoked" value={formatDateTime(selectedAgent.cert_revoked_at)} />
                    <MiniDatum label="Reason" value={selectedAgent.cert_revoked_reason ?? 'n/a'} />
                    <MiniDatum label="Heartbeat" value={agentStaleness(selectedAgent).detail} />
                  </div>
                </div>

                <Button
                  type="button"
                  className="w-full"
                  variant="outline"
                  disabled={mintingToken}
                  onClick={() => onMintToken(selectedAgent.id)}
                >
                  {mintingToken ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="me-1.5 h-3.5 w-3.5" />}
                  Mint enrollment token
                </Button>
              </>
            ) : (
              <EmptyLine icon={ServerCog} text="Select an agent from the fleet table to inspect certificate state and mint an enrollment token." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Enrollment token</CardTitle>
            <CardDescription>Short-lived JWT material for bootstrap enrollment and certificate issuance.</CardDescription>
          </div>
          <StatusBadge status={enrollmentToken ? 'active' : 'empty'} label={enrollmentToken ? 'minted' : 'not minted'} />
        </CardHeader>
        <CardContent className="space-y-4">
          {enrollmentToken ? (
            <>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">JWT</div>
                  <Badge variant="outline" className="normal-case tracking-normal">
                    {shortHash(enrollmentToken.jti, 8, 6)}
                  </Badge>
                </div>
                <div className="break-all rounded-md bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                  {truncateJwt(enrollmentToken.jwt)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <MiniDatum label="Purpose" value={labelFor(enrollmentToken.purpose)} />
                <MiniDatum label="Expiry" value={formatDateTime(enrollmentToken.expires_at)} />
                <MiniDatum label="JTI" value={shortHash(enrollmentToken.jti, 8, 6)} />
                <MiniDatum label="Agent" value={shortHash(enrollmentToken.agent_id, 8, 6)} />
                <MiniDatum label="Site" value={enrollmentToken.site_id ?? 'unassigned'} />
              </div>
            </>
          ) : (
            <EmptyLine
              icon={KeyRound}
              text={
                tokenAgentID
                  ? 'Mint an enrollment token for the selected agent when the bootstrap host is ready.'
                  : 'Create or select an agent before minting an enrollment token.'
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Enrollment glance tile. Rides the materialized `.kpi-card-themed` accent
 * surface from globals.css so the tile is tonal (never flat white) — the local
 * `Tone` is bridged onto the shared `StatTone` vocabulary by meaning (count =
 * sky, success = emerald, watch = gold, risk = rose). The label and the icon
 * chip pick up `--kpi-accent`; the value text stays neutral. An empty/zero value
 * keeps its tone but renders a muted em-dash so the tile still reads
 * intentionally.
 */
function MetricDatum({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: Tone;
}) {
  const accent = toneToStatTone(tone);
  const empty = value === '' || value === 0 || value === '0' || value === 'n/a';
  return (
    <div className={cn('kpi-card-themed', TONE_THEME_CLASS[accent])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-overline font-semibold uppercase text-[color:var(--kpi-accent)]">
            {label}
          </div>
          <div
            className={cn(
              'mt-2 truncate text-xl font-semibold',
              empty ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {empty ? '—' : value}
          </div>
        </div>
        <div className="kpi-icon-badge shrink-0">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
      </div>
    </div>
  );
}

/**
 * Bridge the panel's local RAG-ish `Tone` onto the shared `StatTone` accent
 * vocabulary: success -> emerald (health), warning -> gold (watch/time),
 * critical -> rose (risk), info -> sky (count/quantity), neutral -> slate (type).
 */
function toneToStatTone(tone: Tone): StatTone {
  switch (tone) {
    case 'success':
      return 'emerald';
    case 'warning':
      return 'gold';
    case 'critical':
      return 'rose';
    case 'info':
      return 'sky';
    default:
      return 'slate';
  }
}

function MiniDatum({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' ||
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'revoked' ||
    normalized === 'expired'
      ? 'destructive'
      : normalized === 'warning' ||
          normalized === 'degraded' ||
          normalized === 'paused' ||
          normalized === 'stale' ||
          normalized === 'expiring'
        ? 'warning'
        : normalized === 'healthy' ||
            normalized === 'completed' ||
            normalized === 'passed' ||
            normalized === 'active' ||
            normalized === 'valid'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label ?? normalized.replace(/_/g, ' ')}</span>
    </Badge>
  );
}

function StateBadge({ label, tone }: { label: string; tone: Tone }) {
  const variant = tone === 'critical' ? 'destructive' : tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label}</span>
    </Badge>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function agentStaleness(agent: DRAgent): { state: 'fresh' | 'stale' | 'missing' | 'inactive'; label: string; detail: string; tone: Tone } {
  const status = normalizeStatus(agent.status);
  if (status !== 'active') {
    return { state: 'inactive', label: 'inactive', detail: labelFor(status), tone: 'neutral' };
  }

  const seenAt = timestampMs(agent.last_seen_at);
  if (!seenAt) {
    return { state: 'missing', label: 'missing heartbeat', detail: 'No heartbeat received', tone: 'warning' };
  }

  const ageMs = Date.now() - seenAt;
  if (ageMs > HEARTBEAT_STALE_MS) {
    return { state: 'stale', label: 'stale', detail: `${formatAge(ageMs)} ago`, tone: 'warning' };
  }

  return { state: 'fresh', label: 'fresh', detail: `${formatAge(Math.max(0, ageMs))} ago`, tone: 'success' };
}

function certificateState(agent: DRAgent): { state: 'valid' | 'expiring' | 'expired' | 'revoked' | 'pending'; label: string; tone: Tone } {
  if (agent.cert_revoked_at) {
    return { state: 'revoked', label: 'revoked', tone: 'critical' };
  }

  const expiresAt = timestampMs(agent.cert_expires_at);
  if (!expiresAt) {
    return { state: 'pending', label: 'cert pending', tone: 'neutral' };
  }

  const untilExpiry = expiresAt - Date.now();
  if (untilExpiry <= 0) {
    return { state: 'expired', label: 'expired', tone: 'critical' };
  }

  if (untilExpiry <= CERT_EXPIRING_SOON_MS) {
    return { state: 'expiring', label: `expires in ${formatAge(untilExpiry)}`, tone: 'warning' };
  }

  return { state: 'valid', label: 'valid cert', tone: 'success' };
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(value?: string | null) {
  if (!value) return 'n/a';
  return value.replace(/_/g, ' ');
}

function formatDate(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatAge(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;

  const days = Math.round(hours / 24);
  return `${days}d`;
}

function shortHash(value?: string | null, head = 6, tail = 4) {
  if (!value) return 'n/a';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function truncateJwt(value: string) {
  return shortHash(value, 28, 18);
}

function timestampMs(value?: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
