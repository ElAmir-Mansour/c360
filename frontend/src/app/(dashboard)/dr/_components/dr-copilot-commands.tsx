'use client';

import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Clock3,
  FileSearch,
  GitCommitHorizontal,
  ListChecks,
  Loader2,
  Radar,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type {
  DRCopilotChatResult,
  DRCopilotMessage,
  DRCopilotProposedAction,
  DRCopilotSessionTranscript,
  DRJsonValue,
  DRRegistryRunbookVersion,
} from '@/types/clario-dr';
import {
  type CopilotCommandsLabels,
  useCopilotCommandsLabels,
} from './dr-copilot-commands-labels';

export type DRCopilotCommandPanelProps = {
  activeStreamId?: string | null;
  selectedGroupId?: string | null;
  selectedGroupName?: string | null;
  latestRecoveryPointId?: string | null;
  registryRunbook?: DRRegistryRunbookVersion | null;
  registryVersions: DRRegistryRunbookVersion[];
  copilotResult?: DRCopilotChatResult | null;
  transcript?: DRCopilotSessionTranscript | null;
  regeneratingRunbook: boolean;
  askingCopilot: boolean;
  transcriptLoading: boolean;
  error: unknown;
  onAskCopilot: (prompt: string) => void;
  onRegenerateRunbook: () => void;
  onLoadTranscript: (sessionID: string) => void;
  onRetry: () => void;
};

type Tone = 'success' | 'warning' | 'critical' | 'info' | 'neutral';
type UnknownRecord = Record<string, unknown>;

export function DRCopilotCommandPanel({
  activeStreamId,
  selectedGroupId,
  selectedGroupName,
  latestRecoveryPointId,
  registryRunbook,
  registryVersions,
  copilotResult,
  transcript,
  regeneratingRunbook,
  askingCopilot,
  transcriptLoading,
  error,
  onAskCopilot,
  onRegenerateRunbook,
  onLoadTranscript,
  onRetry,
}: DRCopilotCommandPanelProps) {
  const L = useCopilotCommandsLabels();
  if (error && !copilotResult && !transcript && !registryRunbook && registryVersions.length === 0) {
    return <ErrorState message={L.loadError} onRetry={onRetry} />;
  }

  const sortedVersions = [...registryVersions].sort((left, right) => right.version - left.version);
  const versionList = sortedVersions.length > 0 ? sortedVersions : registryRunbook ? [registryRunbook] : [];
  const latestVersion = sortedVersions[0] ?? registryRunbook ?? null;
  const groupName = selectedGroupName ?? registryRunbook?.asset_snapshot.group_name ?? L.selectedGroupFallback;
  const runbookDiff = registryRunbook?.diff;
  const sessionID = sessionIdFrom(copilotResult) ?? transcriptSessionIdFrom(transcript);
  const answer = answerFrom(copilotResult, transcript);
  const citations = citationLabelsFrom(copilotResult, transcript);
  const guardrails = guardrailLabelsFrom(copilotResult, transcript, L);
  const toolCalls = toolCallsFrom(copilotResult, transcript);
  const proposedAction = proposedActionFrom(copilotResult, transcript);
  const transcriptMessages = transcriptMessagesFrom(transcript);
  const commandContext = {
    activeStreamId,
    groupName,
    latestRecoveryPointId,
    registryRunbook,
    selectedGroupId,
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{formatError(error, L)}</span>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            {L.retry}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CopilotMetric
          title={L.metricRunbookVersion}
          value={registryRunbook ? `v${registryRunbook.version}` : L.na}
          detail={registryRunbook ? L.stepsAndTrigger(registryRunbook.steps.length, labelFor(registryRunbook.trigger)) : L.noActiveRunbook}
          icon={ListChecks}
          tone={registryRunbook ? 'info' : 'neutral'}
        />
        <CopilotMetric
          title={L.metricAvailableVersions}
          value={versionList.length}
          detail={latestVersion ? L.latestVersionDetail(latestVersion.version, formatDateTime(latestVersion.created_at)) : L.noVersionsReturned}
          icon={GitCommitHorizontal}
          tone={versionList.length > 0 ? 'success' : 'neutral'}
        />
        <CopilotMetric
          title={L.metricSelectedGroup}
          value={selectedGroupId ? shortHash(selectedGroupId, 8, 6) : L.none}
          detail={groupName}
          icon={ShieldCheck}
          tone={selectedGroupId ? 'success' : 'warning'}
        />
        <CopilotMetric
          title={L.metricStreamPoint}
          value={activeStreamId ? shortHash(activeStreamId, 8, 6) : L.na}
          detail={latestRecoveryPointId ? L.pointDetail(shortHash(latestRecoveryPointId, 8, 6)) : L.noRecoveryPointSelected}
          icon={Radar}
          tone={activeStreamId || latestRecoveryPointId ? 'info' : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.92fr_1.08fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.commandsTitle}</CardTitle>
              <CardDescription>{L.commandsDescription}</CardDescription>
            </div>
            <StatusBadge status={askingCopilot ? 'pending' : sessionID ? 'ready' : 'empty'} label={askingCopilot ? L.badgeAsking : sessionID ? L.badgeSession : L.badgeIdle} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <CommandButton
                icon={BrainCircuit}
                label={L.cmdExplainFailover}
                disabled={askingCopilot}
                onClick={() => onAskCopilot(buildPrompt('failover-risk', commandContext))}
              />
              <CommandButton
                icon={FileSearch}
                label={L.cmdDraftRegulator}
                disabled={askingCopilot}
                onClick={() => onAskCopilot(buildPrompt('regulator-summary', commandContext))}
              />
              <CommandButton
                icon={ShieldCheck}
                label={L.cmdValidateClean}
                disabled={askingCopilot}
                onClick={() => onAskCopilot(buildPrompt('clean-point', commandContext))}
              />
              <CommandButton
                icon={ListChecks}
                label={L.cmdReviewDrift}
                disabled={askingCopilot}
                onClick={() => onAskCopilot(buildPrompt('runbook-drift', commandContext))}
              />
            </div>

            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{L.regenTitle}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selectedGroupId ? L.regenGroupCurrent(shortHash(selectedGroupId, 8, 6), registryRunbook ? `v${registryRunbook.version}` : L.none) : L.selectGroupFirst}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0"
                  disabled={!selectedGroupId || regeneratingRunbook}
                  onClick={onRegenerateRunbook}
                >
                  {regeneratingRunbook ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {regeneratingRunbook ? L.regenerating : L.regenerate}
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <MiniDatum label={L.diffAdded} value={runbookDiff?.added.length ?? 0} />
                <MiniDatum label={L.diffChanged} value={runbookDiff?.changed.length ?? 0} />
                <MiniDatum label={L.diffRemoved} value={runbookDiff?.removed.length ?? 0} />
                <MiniDatum label={L.diffReordered} value={runbookDiff?.reordered.length ?? 0} />
              </div>
            </div>

            <div className="space-y-2">
              {versionList.slice(0, 4).map((version) => (
                <RunbookVersionRow key={version.id} version={version} active={version.id === registryRunbook?.id} L={L} />
              ))}
              {versionList.length === 0 ? <EmptyLine icon={ListChecks} text={L.noRunbookVersions} /> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.answerTitle}</CardTitle>
              <CardDescription>{L.answerDescription}</CardDescription>
            </div>
            <StatusBadge status={proposedAction?.requires_approval ? 'approval_required' : answer ? 'ready' : 'empty'} />
          </CardHeader>
          <CardContent className="space-y-4">
            {askingCopilot && !answer ? (
              <LoadingSkeleton variant="text" count={2} />
            ) : answer ? (
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap text-sm leading-6">{answer}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{copilotResult?.provider ?? transcript?.session.provider ?? L.providerNa}</span>
                      <span>/</span>
                      <span>{copilotResult?.model ?? transcript?.session.model ?? L.modelNa}</span>
                      {copilotResult?.latency_ms ? (
                        <>
                          <span>/</span>
                          <span>{L.msSuffix(copilotResult.latency_ms)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyLine icon={Bot} text={L.noAnswer} />
            )}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <EvidencePanel title={L.citations} icon={FileSearch} items={citations} emptyText={L.noCitations} />
              <EvidencePanel title={L.guardrails} icon={ShieldCheck} items={guardrails} emptyText={L.noGuardrails} />
            </div>

            {proposedAction ? (
              <div className="rounded-lg border px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{proposedAction.summary || labelFor(proposedAction.kind)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{labelFor(proposedAction.kind)}</div>
                  </div>
                  <StatusBadge status={proposedAction.requires_approval ? 'approval_required' : 'ready'} />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <HashBox label={L.apiCall} value={formatApiCall(proposedAction.api_call)} />
                  <HashBox label={L.approvalCall} value={formatApiCall(proposedAction.approval_call)} />
                </div>
                {(proposedAction.warnings ?? []).length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {proposedAction.warnings?.slice(0, 4).map((warning, index) => (
                      <div key={`${warning}-${index}`} className="text-xs text-warning-700 dark:text-warning-300">
                        {warning}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {toolCalls.length > 0 ? (
              <div className="space-y-2">
                {toolCalls.slice(0, 4).map((toolCall, index) => (
                  <ToolCallRow key={toolCall.id ?? `${toolCall.name}-${index}`} toolCall={toolCall} L={L} />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">{L.transcriptTitle}</CardTitle>
            <CardDescription>{L.transcriptDescription}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusBadge status={transcriptLoading ? 'pending' : transcript ? 'ready' : sessionID ? 'available' : 'empty'} />
            {sessionID ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={transcriptLoading}
                onClick={() => onLoadTranscript(sessionID)}
              >
                {transcriptLoading ? (
                  <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                )}
                {transcript ? L.refreshTranscript : L.loadTranscript}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MiniDatum label={L.session} value={shortHash(sessionID, 8, 6)} />
            <MiniDatum label={L.messages} value={transcript?.session.message_count ?? transcriptMessages.length} />
            <MiniDatum label={L.provider} value={transcript?.session.provider ?? copilotResult?.provider ?? L.na} />
            <MiniDatum label={L.updated} value={formatDateTime(transcript?.session.updated_at)} />
          </div>

          {transcriptLoading && transcriptMessages.length === 0 ? (
            <LoadingSkeleton variant="table-row" count={3} />
          ) : transcriptMessages.length > 0 ? (
            <div className="space-y-3">
              {transcriptMessages.slice(-6).map((message, index) => (
                <TranscriptMessageRow key={message.id ?? `${message.role}-${index}`} message={message} L={L} />
              ))}
            </div>
          ) : sessionID ? (
            <EmptyLine icon={Clock3} text={L.transcriptAvailable} />
          ) : (
            <EmptyLine icon={Bot} text={L.noSessionId} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CopilotMetric({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-overline font-semibold uppercase text-muted-foreground">{title}</div>
            <div className="mt-3 truncate text-3xl font-semibold tracking-tight">{value}</div>
          </div>
          <div className={cn('rounded-lg p-2.5', toneClass(tone, 'soft'))}>
            <Icon className={cn('h-5 w-5', toneClass(tone, 'text'))} />
          </div>
        </div>
        <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

function CommandButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="outline" className="h-auto justify-start px-3 py-3 text-start" disabled={disabled} onClick={onClick}>
      <Icon className="me-2 h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  );
}

function RunbookVersionRow({ version, active, L }: { version: DRRegistryRunbookVersion; active: boolean; L: CopilotCommandsLabels }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2', active && 'bg-muted/60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs">{L.runbookVersionLabel(version.version)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(version.created_at)} / {shortHash(version.content_hash)}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {active ? <StatusBadge status="active" /> : null}
          <StatusBadge status={version.trigger} />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <MiniDatum label={L.rvSteps} value={version.steps.length} />
        <MiniDatum label={L.rvMembers} value={version.asset_snapshot.members.length} />
        <MiniDatum label={L.rvRto} value={formatDuration(version.asset_snapshot.rto_objective_seconds)} />
        <MiniDatum label={L.rvRpo} value={formatDuration(version.asset_snapshot.rpo_objective_seconds)} />
      </div>
    </div>
  );
}

function EvidencePanel({
  title,
  icon: Icon,
  items,
  emptyText,
}: {
  title: string;
  icon: LucideIcon;
  items: string[];
  emptyText: string;
}) {
  return (
    <div className="rounded-lg border px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="truncate text-sm font-medium">{title}</div>
        </div>
        <Badge variant="outline" className="shrink-0 normal-case tracking-normal">
          {items.length}
        </Badge>
      </div>
      {items.length > 0 ? (
        <div className="space-y-1.5">
          {items.slice(0, 5).map((item, index) => (
            <div key={`${item}-${index}`} className="rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
              {item}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">{emptyText}</div>
      )}
    </div>
  );
}

function ToolCallRow({ toolCall, L }: { toolCall: ReturnType<typeof toolCallsFrom>[number]; L: CopilotCommandsLabels }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{toolCall.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">{toolCall.resultSummary || L.toolNoResult}</div>
        </div>
        <StatusBadge status={toolCall.success ? 'success' : 'warning'} label={toolCall.success ? L.toolSuccess : L.toolAttention} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <MiniDatum label={L.toolLatency} value={toolCall.latencyMs !== null ? L.msSuffix(toolCall.latencyMs) : L.na} />
        <MiniDatum label={L.toolArgs} value={summarizeRecord(toolCall.arguments)} />
      </div>
    </div>
  );
}

function TranscriptMessageRow({ message, L }: { message: TranscriptMessage; L: CopilotCommandsLabels }) {
  const tone = message.role === 'assistant' ? 'info' : message.role === 'tool' ? 'warning' : 'neutral';

  return (
    <div className="rounded-lg border px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge status={message.role} />
          <span className={cn('truncate text-xs text-muted-foreground', toneClass(tone, 'text'))}>
            {L.msgMeta(message.seq !== null ? String(message.seq) : L.na, formatDateTime(message.createdAt))}
          </span>
        </div>
        {message.latencyMs !== null ? <span className="text-xs text-muted-foreground">{L.msSuffix(message.latencyMs)}</span> : null}
      </div>
      <div className="whitespace-pre-wrap text-sm leading-6">{message.content || L.noContent}</div>
      {message.toolCalls.length > 0 || message.proposedAction ? (
        <>
          <Separator className="my-3" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <MiniDatum label={L.toolCallsLabel} value={message.toolCalls.length} />
            <MiniDatum label={L.actionLabel} value={message.proposedAction ? labelFor(message.proposedAction.kind) : L.actionNone} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function MiniDatum({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function HashBox({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value || 'n/a'}</div>
    </div>
  );
}

function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error'
      ? 'destructive'
      : normalized === 'warning' || normalized === 'pending' || normalized === 'approval_required'
        ? 'warning'
        : normalized === 'healthy' || normalized === 'ready' || normalized === 'success' || normalized === 'active' || normalized === 'assistant'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case tracking-normal">
      <span className="truncate">{label ?? labelFor(normalized)}</span>
    </Badge>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function buildPrompt(
  kind: 'failover-risk' | 'regulator-summary' | 'clean-point' | 'runbook-drift',
  context: {
    activeStreamId?: string | null;
    groupName: string;
    latestRecoveryPointId?: string | null;
    registryRunbook?: DRRegistryRunbookVersion | null;
    selectedGroupId?: string | null;
  },
) {
  const contextLines = [
    `Group: ${context.groupName}${context.selectedGroupId ? ` (${context.selectedGroupId})` : ''}`,
    `Stream: ${context.activeStreamId ?? 'not selected'}`,
    `Recovery point: ${context.latestRecoveryPointId ?? 'not selected'}`,
    `Runbook: ${context.registryRunbook ? `v${context.registryRunbook.version} (${context.registryRunbook.id})` : 'not generated'}`,
    `Runbook hash: ${context.registryRunbook?.content_hash ?? 'n/a'}`,
  ].join('\n');

  switch (kind) {
    case 'failover-risk':
      return `Explain failover risk for the current DR selection.\n${contextLines}\nReturn the top operational risks, missing evidence, and approval gates.`;
    case 'regulator-summary':
      return `Draft a regulator-ready DR summary for this selection.\n${contextLines}\nInclude current runbook version, recovery point posture, known caveats, and evidence citations when available.`;
    case 'clean-point':
      return `Validate whether the current recovery point is clean enough for failover planning.\n${contextLines}\nCall out malware, integrity, immutability, and attestation concerns before any operator approval.`;
    case 'runbook-drift':
      return `Review runbook drift for the selected consistency group.\n${contextLines}\nCompare current registry state against prior versions and summarize added, changed, removed, or reordered steps.`;
  }
}

function answerFrom(result?: DRCopilotChatResult | null, transcript?: DRCopilotSessionTranscript | null) {
  if (result?.answer) return result.answer;

  const resultRecord = asRecord(result);
  const resultAnswer = firstString(resultRecord, ['answer', 'message', 'content', 'output', 'response', 'text']);
  if (resultAnswer) return resultAnswer;

  return latestAssistantMessage(transcript)?.content ?? null;
}

function sessionIdFrom(result?: DRCopilotChatResult | null) {
  if (result?.session_id) return result.session_id;

  const record = asRecord(result);
  return (
    firstString(record, ['session_id', 'sessionID', 'sessionId']) ??
    nestedString(record, ['session', 'id']) ??
    nestedString(record, ['session', 'session_id'])
  );
}

function transcriptSessionIdFrom(transcript?: DRCopilotSessionTranscript | null) {
  if (transcript?.session.id) return transcript.session.id;

  const record = asRecord(transcript);
  return (
    nestedString(record, ['session', 'id']) ??
    nestedString(record, ['session', 'session_id']) ??
    firstString(record, ['session_id', 'sessionID', 'sessionId'])
  );
}

function citationLabelsFrom(result?: DRCopilotChatResult | null, transcript?: DRCopilotSessionTranscript | null) {
  const latestMessage = latestAssistantMessage(transcript);
  return uniqueStrings([
    ...stringsFromUnknownFields(result, ['citations', 'citation_refs', 'sources', 'references', 'evidence_refs', 'evidence']),
    ...stringsFromUnknownFields(latestMessage, ['citations', 'citation_refs', 'sources', 'references', 'evidence_refs', 'evidence']),
  ]);
}

function guardrailLabelsFrom(
  result: DRCopilotChatResult | null | undefined,
  transcript: DRCopilotSessionTranscript | null | undefined,
  L: CopilotCommandsLabels,
) {
  const proposedAction = proposedActionFrom(result, transcript);
  const latestMessage = latestAssistantMessage(transcript);
  const labels = [
    ...stringsFromUnknownFields(result, ['guardrails', 'warnings', 'constraints', 'safety', 'policy']),
    ...stringsFromUnknownFields(latestMessage, ['guardrails', 'warnings', 'constraints', 'safety', 'policy']),
    ...(proposedAction?.warnings ?? []),
  ];

  if (proposedAction?.requires_approval) {
    labels.unshift(L.approvalRequiredGuardrail);
  }

  return uniqueStrings(labels);
}

function proposedActionFrom(result?: DRCopilotChatResult | null, transcript?: DRCopilotSessionTranscript | null): DRCopilotProposedAction | null {
  if (result?.proposed_action) return result.proposed_action;

  const latestMessage = latestAssistantMessage(transcript);
  if (latestMessage?.proposed_action) return latestMessage.proposed_action;

  const resultAction = asRecord(asRecord(result)?.proposed_action);
  return proposedActionFromRecord(resultAction);
}

function toolCallsFrom(result?: DRCopilotChatResult | null, transcript?: DRCopilotSessionTranscript | null) {
  const latestMessage = latestAssistantMessage(transcript);
  const toolCalls = result?.tool_calls ?? latestMessage?.tool_calls ?? [];
  const records = Array.isArray(toolCalls) ? toolCalls : [];
  const fallbackRecords = records.length > 0 ? [] : arrayFromFields(result, ['tool_calls', 'tools', 'api_calls']);

  return [...records, ...fallbackRecords].map((toolCall) => {
    const record = asRecord(toolCall);
    return {
      id: firstString(record, ['id', 'tool_call_id', 'call_id']) ?? null,
      name: firstString(record, ['name', 'tool_name', 'function', 'action']) ?? 'tool call',
      arguments: asRecord(record?.arguments ?? record?.args ?? record?.input),
      success: firstBoolean(record, ['success', 'ok', 'completed']) ?? true,
      resultSummary: firstString(record, ['result_summary', 'summary', 'result', 'output']) ?? '',
      latencyMs: firstNumber(record, ['latency_ms', 'latencyMs', 'duration_ms']),
    };
  });
}

type TranscriptMessage = {
  id: string | null;
  seq: number | null;
  role: string;
  content: string;
  toolCalls: NonNullable<DRCopilotMessage['tool_calls']>;
  proposedAction: DRCopilotProposedAction | null;
  latencyMs: number | null;
  createdAt: string | null;
};

function transcriptMessagesFrom(transcript?: DRCopilotSessionTranscript | null): TranscriptMessage[] {
  const typedMessages = transcript?.messages ?? [];
  const records = typedMessages.length > 0 ? typedMessages : arrayFromFields(transcript, ['messages', 'turns', 'items']);

  return records.map((message) => {
    const record = asRecord(message);
    const proposedAction = asRecord(record?.proposed_action ?? record?.proposedAction);
    const toolCalls = Array.isArray(record?.tool_calls)
      ? record.tool_calls
      : Array.isArray(record?.toolCalls)
        ? record.toolCalls
        : [];

    return {
      id: firstString(record, ['id', 'message_id', 'messageId']),
      seq: firstNumber(record, ['seq', 'sequence', 'index']),
      role: normalizeStatus(firstString(record, ['role', 'speaker', 'type'])),
      content: firstString(record, ['content', 'message', 'answer', 'text', 'output']) ?? '',
      toolCalls: toolCalls as NonNullable<DRCopilotMessage['tool_calls']>,
      proposedAction: proposedActionFromRecord(proposedAction),
      latencyMs: firstNumber(record, ['latency_ms', 'latencyMs', 'duration_ms']),
      createdAt: firstString(record, ['created_at', 'createdAt', 'timestamp', 'updated_at']),
    };
  });
}

function latestAssistantMessage(transcript?: DRCopilotSessionTranscript | null) {
  const messages = transcriptMessagesFrom(transcript);
  const latest = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!latest) return null;

  return {
    content: latest.content,
    proposed_action: latest.proposedAction,
    tool_calls: latest.toolCalls,
  };
}

function proposedActionFromRecord(record: UnknownRecord | null): DRCopilotProposedAction | null {
  if (!record) return null;
  const apiCall = apiCallFromRecord(asRecord(record.api_call ?? record.apiCall));
  if (!apiCall) return null;

  return {
    kind: firstString(record, ['kind', 'type', 'action']) ?? 'proposed_action',
    summary: firstString(record, ['summary', 'description', 'title']) ?? 'Proposed copilot action',
    requires_approval: firstBoolean(record, ['requires_approval', 'requiresApproval', 'approval_required']) ?? true,
    api_call: apiCall,
    approval_call: apiCallFromRecord(asRecord(record.approval_call ?? record.approvalCall)),
    plan: asJsonRecord(record.plan),
    warnings: stringsFromUnknown(record.warnings),
  };
}

function apiCallFromRecord(record: UnknownRecord | null) {
  if (!record) return null;
  const method = firstString(record, ['method', 'verb']);
  const path = firstString(record, ['path', 'url', 'endpoint']);
  if (!method || !path) return null;

  return {
    method,
    path,
    body: asJsonRecord(record.body ?? record.payload),
  };
}

function stringsFromUnknownFields(value: unknown, keys: string[]) {
  const record = asRecord(value);
  if (!record) return [];
  return keys.flatMap((key) => stringsFromUnknown(record[key]));
}

function stringsFromUnknown(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => stringsFromUnknown(item));

  const record = asRecord(value);
  if (!record) return [];

  const label = firstString(record, ['label', 'title', 'name', 'summary', 'message', 'detail', 'id', 'url', 'href']);
  if (label) return [label];

  return Object.entries(record)
    .slice(0, 3)
    .map(([key, item]) => `${labelFor(key)}: ${stringFromUnknown(item)}`)
    .filter(Boolean);
}

function arrayFromFields(value: unknown, keys: string[]) {
  const record = asRecord(value);
  if (!record) return [];

  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key];
  }

  return [];
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function asJsonRecord(value: unknown): Record<string, DRJsonValue> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return Object.entries(record).reduce<Record<string, DRJsonValue>>((accumulator, [key, item]) => {
    if (isJsonValue(item)) accumulator[key] = item;
    return accumulator;
  }, {});
}

function isJsonValue(value: unknown): value is DRJsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  const record = asRecord(value);
  return record ? Object.values(record).every(isJsonValue) : false;
}

function firstString(record: UnknownRecord | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return null;
}

function firstNumber(record: UnknownRecord | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstBoolean(record: UnknownRecord | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
  }
  return null;
}

function nestedString(record: UnknownRecord | null, path: string[]) {
  let current: unknown = record;
  for (const key of path) {
    const currentRecord = asRecord(current);
    if (!currentRecord) return null;
    current = currentRecord[key];
  }
  return typeof current === 'string' && current.trim().length > 0 ? current : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function summarizeRecord(record: UnknownRecord | null) {
  if (!record) return 'none';
  const keys = Object.keys(record);
  if (keys.length === 0) return 'none';
  return keys.length > 2 ? `${keys.slice(0, 2).join(', ')} +${keys.length - 2}` : keys.join(', ');
}

function formatApiCall(apiCall?: { method: string; path: string } | null) {
  if (!apiCall) return 'n/a';
  return `${apiCall.method.toUpperCase()} ${apiCall.path}`;
}

function stringFromUnknown(value: unknown) {
  if (value === null || value === undefined) return 'n/a';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  const record = asRecord(value);
  if (!record) return 'n/a';
  return summarizeRecord(record);
}

function toneClass(tone: Tone, part: 'soft' | 'text') {
  const styles = {
    success: { soft: 'bg-primary/10', text: 'text-primary' },
    warning: { soft: 'bg-amber-50 dark:bg-amber-950/25', text: 'text-warning-700 dark:text-warning-300' },
    critical: { soft: 'bg-error-50 dark:bg-error-700/25', text: 'text-error-700 dark:text-error-300' },
    info: { soft: 'bg-sky-50 dark:bg-sky-950/25', text: 'text-sky-700 dark:text-sky-300' },
    neutral: { soft: 'bg-muted', text: 'text-muted-foreground' },
  } as const;
  return styles[tone][part];
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(value?: string | null) {
  return (value ?? 'n/a').replace(/_/g, ' ');
}

function formatDuration(seconds?: number | null) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${hours}h ${minRem}m` : `${hours}h`;
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

function shortHash(value?: string | null, prefix = 7, suffix = 5) {
  if (!value) return 'n/a';
  if (value.length <= prefix + suffix + 3) return value;
  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

function formatError(error: unknown, L: CopilotCommandsLabels) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return L.refreshError;
}
