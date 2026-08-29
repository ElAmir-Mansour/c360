'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Bot,
  FileSearch,
  History,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { isApiError } from '@/types/api';
import type {
  DRCopilotChatResult,
  DRCopilotMessage,
  DRCopilotProposedAction,
  DRCopilotSessionTranscript,
} from '@/types/clario-dr';
import { useCopilotActions } from '../../_hooks/use-dr-actions';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';
import { buildGroundedDRCopilotMessage, formatDRCopilotGrounding, type DRCopilotGrounding } from './dr-copilot-context';

/** Full DR Copilot panel copy (one identically-shaped copy per locale). */
interface CopilotLabels {
  composer: {
    placeholder: string;
    send: string;
    sending: string;
    fieldLabel: string;
    hint: string;
  };
  quickPrompts: {
    heading: string;
    failoverRisk: string;
    cleanPoint: string;
    runbookDrift: string;
    regulator: string;
  };
  context: {
    heading: string;
    empty: string;
  };
  conversation: {
    empty: string;
    you: string;
    assistant: string;
    citations: string;
    guardrails: string;
    proposedAction: string;
    requiresApproval: string;
    apiCall: string;
  };
  transcript: {
    heading: string;
    placeholder: string;
    load: string;
    loading: string;
    description: string;
  };
  errors: {
    ask: string;
    transcript: string;
    /** Intentional, non-error notice shown when no LLM provider is configured. */
    unavailableTitle: string;
    unavailableBody: string;
  };
}

/**
 * Bilingual DR Copilot panel copy. "ClarioDR" is the product name and "API call"
 * keeps its established technical sense. The `en` side is byte-identical to the
 * prior English so the `renderWithQuery` `en` default keeps every assertion green.
 */
const copilotLabels: DRBilingual<CopilotLabels> = {
  en: {
    composer: {
      placeholder: 'Ask ClarioDR about failover risk, recovery points, drift, evidence…',
      send: 'Ask ClarioDR',
      sending: 'Asking…',
      fieldLabel: 'Message to the DR copilot',
      hint: 'Enter to send / Shift+Enter for a new line',
    },
    quickPrompts: {
      heading: 'Suggested',
      failoverRisk: 'Explain failover risk',
      cleanPoint: 'Validate a clean recovery point',
      runbookDrift: 'Summarise runbook drift',
      regulator: 'Draft a regulator summary',
    },
    context: {
      heading: 'Grounded in',
      empty: 'No protection group selected — answers will be general.',
    },
    conversation: {
      empty:
        'Start a conversation. The copilot grounds every answer in your current console selection.',
      you: 'You',
      assistant: 'ClarioDR copilot',
      citations: 'Citations',
      guardrails: 'Guardrails',
      proposedAction: 'Proposed action',
      requiresApproval: 'Requires operator approval',
      apiCall: 'API call',
    },
    transcript: {
      heading: 'Resume a session',
      placeholder: 'Session id',
      load: 'Load',
      loading: 'Loading…',
      description: 'Paste a copilot session id to reload its full transcript.',
    },
    errors: {
      ask: 'Failed to query the DR copilot. Retry your message.',
      transcript: 'Failed to load that copilot transcript.',
      unavailableTitle: 'AI copilot isn’t configured in this environment',
      unavailableBody:
        'The DR copilot needs an LLM provider key to answer questions. Recovery data, runbooks, and evidence remain fully available — only the conversational assistant is offline here.',
    },
  },
  ar: {
    composer: {
      placeholder: 'اسأل ClarioDR عن مخاطر تجاوز الفشل ونقاط الاسترداد والانحراف والأدلة…',
      send: 'اسأل ClarioDR',
      sending: 'جارٍ السؤال…',
      fieldLabel: 'رسالة إلى مساعد الاسترداد',
      hint: 'اضغط Enter للإرسال / Shift+Enter لسطر جديد',
    },
    quickPrompts: {
      heading: 'مقترحة',
      failoverRisk: 'اشرح مخاطر تجاوز الفشل',
      cleanPoint: 'تحقّق من نقطة استرداد نظيفة',
      runbookDrift: 'لخّص انحراف دليل التشغيل',
      regulator: 'صُغ ملخّصًا للجهة التنظيمية',
    },
    context: {
      heading: 'مرتكز على',
      empty: 'لم تُحدَّد مجموعة حماية — ستكون الإجابات عامة.',
    },
    conversation: {
      empty: 'ابدأ محادثة. يرتكز المساعد في كل إجابة على تحديدك الحالي في وحدة التحكّم.',
      you: 'أنت',
      assistant: 'مساعد ClarioDR',
      citations: 'الاستشهادات',
      guardrails: 'الضوابط الوقائية',
      proposedAction: 'إجراء مقترح',
      requiresApproval: 'يتطلّب موافقة المشغّل',
      apiCall: 'استدعاء API',
    },
    transcript: {
      heading: 'استئناف جلسة',
      placeholder: 'معرّف الجلسة',
      load: 'تحميل',
      loading: 'جارٍ التحميل…',
      description: 'الصق معرّف جلسة المساعد لإعادة تحميل سجلّها الكامل.',
    },
    errors: {
      ask: 'تعذّر الاستعلام من مساعد الاسترداد. أعِد إرسال رسالتك.',
      transcript: 'تعذّر تحميل سجلّ المساعد ذلك.',
      unavailableTitle: 'مساعد الاسترداد الذكي غير مُهيّأ في هذه البيئة',
      unavailableBody:
        'يحتاج مساعد الاسترداد إلى مفتاح مزوّد نموذج لغوي للإجابة عن الأسئلة. تبقى بيانات الاسترداد وأدلّة التشغيل والأدلّة متاحة بالكامل — المساعد المحادثي وحده غير متاح هنا.',
    },
  },
};

/** Resolve the copilot panel copy for the active locale (en default in tests). */
function useCopilotLabels(): CopilotLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(copilotLabels, locale), [locale]);
}

/** A turn rendered in the conversation thread, normalised from result/transcript. */
interface CopilotTurn {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  citations: string[];
  guardrails: string[];
  proposedAction: DRCopilotProposedAction | null;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
}

export interface DRCopilotPanelProps {
  /** Live console selection used to ground each turn (no payload field exists). */
  grounding: DRCopilotGrounding;
  /** Whether the operator may run copilot turns (write-gated via `dr:write`). */
  canWrite: boolean;
}

/**
 * The conversational body of the console-wide DR Copilot. Mounts the shared
 * `useCopilotActions()` hook (single source of truth for chat + transcript +
 * threaded `session_id`), so it composes the SAME real `chatDRCopilot` /
 * `fetchDRCopilotSessionTranscript` I/O the readiness panel uses — without
 * forking that route-specific dashboard. Grounds every prompt in the current
 * group/stream/run selection by prefixing the message (the wire contract has no
 * group/stream field). Write actions are gated by `canWrite`.
 */
export function DRCopilotPanel({ grounding, canWrite }: DRCopilotPanelProps) {
  const labels = useCopilotLabels();
  const {
    askCopilot,
    askingCopilot,
    askCopilotError,
    copilotResult,
    loadTranscript,
    transcriptLoading,
    loadTranscriptError,
    copilotTranscript,
  } = useCopilotActions();

  const [draft, setDraft] = useState('');
  const [sessionInput, setSessionInput] = useState('');
  const composerId = useId();
  const sessionFieldId = useId();
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const turns = useMemo(
    () => buildTurns(copilotResult, copilotTranscript, labels.conversation.requiresApproval),
    [copilotResult, copilotTranscript, labels.conversation.requiresApproval],
  );
  const contextSummary = formatDRCopilotGrounding(grounding);

  // Keep the latest answer in view as the conversation grows.
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, askingCopilot]);

  const submit = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || !canWrite || askingCopilot) return;
    askCopilot(buildGroundedDRCopilotMessage(trimmed, grounding));
    setDraft('');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit(draft);
  };

  const handleLoadTranscript = () => {
    const id = sessionInput.trim();
    if (!id || transcriptLoading) return;
    loadTranscript(id);
  };

  const quickPrompts = [
    labels.quickPrompts.failoverRisk,
    labels.quickPrompts.cleanPoint,
    labels.quickPrompts.runbookDrift,
    labels.quickPrompts.regulator,
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Grounding summary ------------------------------------------------- */}
      <div className="shrink-0 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {labels.context.heading}
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">
          {contextSummary || labels.context.empty}
        </p>
      </div>

      {/* Conversation thread ---------------------------------------------- */}
      <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border">
        <div className="space-y-3 p-3">
          {turns.length === 0 && !askingCopilot ? (
            <EmptyConversation />
          ) : (
            turns.map((turn) => <CopilotTurnRow key={turn.key} turn={turn} />)
          )}

          {askingCopilot ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              <Spinner size="sm" />
              {labels.composer.sending}
            </div>
          ) : null}

          {askCopilotError ? (
            isCopilotUnavailable(askCopilotError) ? (
              <CopilotUnavailableNotice
                title={labels.errors.unavailableTitle}
                body={labels.errors.unavailableBody}
              />
            ) : (
              <InlineError message={labels.errors.ask} />
            )
          ) : null}
          <div ref={threadEndRef} />
        </div>
      </ScrollArea>

      {/* Quick prompts ----------------------------------------------------- */}
      <div className="shrink-0 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {labels.quickPrompts.heading}
        </div>
        <div className="flex flex-wrap gap-2">
          {quickPrompts.map((prompt) => (
            <Button
              key={prompt}
              type="button"
              size="sm"
              variant="outline"
              disabled={!canWrite || askingCopilot}
              onClick={() => submit(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      </div>

      {/* Composer ---------------------------------------------------------- */}
      <form onSubmit={handleSubmit} className="shrink-0 space-y-2">
        <label htmlFor={composerId} className="sr-only">
          {labels.composer.fieldLabel}
        </label>
        <Textarea
          id={composerId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
          disabled={!canWrite || askingCopilot}
          placeholder={labels.composer.placeholder}
          rows={3}
          aria-describedby={`${composerId}-hint`}
        />
        <div className="flex items-center justify-between gap-3">
          <p id={`${composerId}-hint`} className="text-xs text-muted-foreground">
            {labels.composer.hint}
          </p>
          <Button type="submit" size="sm" disabled={!canWrite || askingCopilot || draft.trim().length === 0}>
            {askingCopilot ? (
              <Spinner size="sm" className="me-1.5" />
            ) : (
              <SendHorizontal className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
            )}
            {askingCopilot ? labels.composer.sending : labels.composer.send}
          </Button>
        </div>
      </form>

      {/* Resume-by-session-id --------------------------------------------- */}
      <div className="shrink-0 space-y-2 rounded-lg border border-border bg-muted/20 px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <History className="h-3.5 w-3.5" aria-hidden />
          {labels.transcript.heading}
        </div>
        <p className="text-xs text-muted-foreground">{labels.transcript.description}</p>
        <div className="flex items-center gap-2">
          <label htmlFor={sessionFieldId} className="sr-only">
            {labels.transcript.placeholder}
          </label>
          <input
            id={sessionFieldId}
            value={sessionInput}
            onChange={(event) => setSessionInput(event.target.value)}
            placeholder={labels.transcript.placeholder}
            className="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={transcriptLoading}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={transcriptLoading || sessionInput.trim().length === 0}
            onClick={handleLoadTranscript}
          >
            {transcriptLoading ? <Spinner size="sm" className="me-1.5" /> : null}
            {transcriptLoading ? labels.transcript.loading : labels.transcript.load}
          </Button>
        </div>
        {loadTranscriptError ? <InlineError message={labels.errors.transcript} /> : null}
      </div>
    </div>
  );
}

function EmptyConversation() {
  const labels = useCopilotLabels();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
      <Bot className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0">{labels.conversation.empty}</span>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-warning-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0">{message}</span>
    </div>
  );
}

/**
 * A 503 `llm_unavailable` is not a failure — it means the environment has no LLM
 * provider key wired. Render it as a calm, informational notice so an unkeyed
 * environment reads as intentional rather than broken.
 */
function isCopilotUnavailable(error: unknown): boolean {
  return isApiError(error) && (error.status === 503 || error.code === 'llm_unavailable');
}

function CopilotUnavailableNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-1">
        <div className="font-medium text-foreground">{title}</div>
        <p className="text-xs leading-5">{body}</p>
      </div>
    </div>
  );
}

function CopilotTurnRow({ turn }: { turn: CopilotTurn }) {
  const labels = useCopilotLabels();
  const isUser = turn.role === 'user';
  const Icon = isUser ? User2 : Bot;

  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          isUser ? 'bg-secondary text-secondary-foreground' : 'bg-primary/10 text-primary',
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-xs font-semibold text-muted-foreground">
          {isUser ? labels.conversation.you : labels.conversation.assistant}
        </div>
        <div className="whitespace-pre-wrap rounded-lg border border-border bg-card px-3 py-2.5 text-sm leading-6 text-foreground">
          {turn.content}
        </div>

        {turn.citations.length > 0 ? (
          <EvidenceList icon={FileSearch} heading={labels.conversation.citations} items={turn.citations} />
        ) : null}
        {turn.guardrails.length > 0 ? (
          <EvidenceList icon={ShieldCheck} heading={labels.conversation.guardrails} items={turn.guardrails} />
        ) : null}
        {turn.proposedAction ? <ProposedActionRow action={turn.proposedAction} /> : null}

        {!isUser && (turn.provider || turn.model || turn.latencyMs !== null) ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {turn.provider ? <span>{turn.provider}</span> : null}
            {turn.model ? (
              <>
                <span aria-hidden>/</span>
                <span>{turn.model}</span>
              </>
            ) : null}
            {turn.latencyMs !== null ? (
              <>
                <span aria-hidden>/</span>
                <span>{turn.latencyMs} ms</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EvidenceList({
  icon: Icon,
  heading,
  items,
}: {
  icon: typeof FileSearch;
  heading: string;
  items: string[];
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {heading}
        </div>
        <Badge variant="outline" className="shrink-0 normal-case tracking-normal">
          {items.length}
        </Badge>
      </div>
      <ul className="space-y-1">
        {items.slice(0, 6).map((item, index) => (
          <li key={`${item}-${index}`} className="rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProposedActionRow({ action }: { action: DRCopilotProposedAction }) {
  const labels = useCopilotLabels();
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {action.summary || labels.conversation.proposedAction}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{action.kind.replace(/_/g, ' ')}</div>
          </div>
        </div>
        {action.requires_approval ? (
          <Badge variant="warning" className="shrink-0 normal-case tracking-normal">
            {labels.conversation.requiresApproval}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 truncate font-mono text-xs text-muted-foreground">
        <span className="font-semibold uppercase">{labels.conversation.apiCall}: </span>
        {action.api_call.method.toUpperCase()} {action.api_call.path}
      </div>
      {(action.warnings ?? []).length > 0 ? (
        <ul className="mt-2 space-y-1">
          {action.warnings?.slice(0, 4).map((warning, index) => (
            <li key={`${warning}-${index}`} className="text-xs text-warning-700 dark:text-warning-300">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turn normalisation: fold the latest chat result + any loaded transcript into a
// single ordered thread. The transcript (when loaded) is the canonical history;
// the latest in-flight `copilotResult` is appended only if it isn't already the
// transcript's tail (avoids a duplicate when the transcript was refreshed after
// a turn).
// ---------------------------------------------------------------------------

function buildTurns(
  result: DRCopilotChatResult | null,
  transcript: DRCopilotSessionTranscript | null,
  requiresApprovalLabel: string,
): CopilotTurn[] {
  const turns: CopilotTurn[] = [];

  if (transcript) {
    const ordered = [...transcript.messages].sort((left, right) => left.seq - right.seq);
    for (const message of ordered) {
      const turn = turnFromMessage(message, requiresApprovalLabel);
      if (turn) turns.push(turn);
    }
  }

  if (result) {
    const alreadyPresent = turns.some(
      (turn) => turn.role === 'assistant' && turn.content === result.answer,
    );
    if (!alreadyPresent && result.answer) {
      turns.push({
        key: `result-${result.message_id}`,
        role: 'assistant',
        content: result.answer,
        citations: citationsFromAction(result.proposed_action),
        guardrails: guardrailsFrom(result.proposed_action, requiresApprovalLabel),
        proposedAction: result.proposed_action ?? null,
        provider: result.provider,
        model: result.model,
        latencyMs: Number.isFinite(result.latency_ms) ? result.latency_ms : null,
      });
    }
  }

  return turns;
}

function turnFromMessage(
  message: DRCopilotMessage,
  requiresApprovalLabel: string,
): CopilotTurn | null {
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : null;
  // Tool rows carry no operator-facing prose; their effect is surfaced via the
  // assistant turn's proposed action, so they are not rendered as their own turn.
  if (!role) return null;
  if (!message.content.trim() && !message.proposed_action) return null;

  return {
    key: `msg-${message.id}`,
    role,
    content: message.content,
    citations: citationsFromAction(message.proposed_action),
    guardrails: guardrailsFrom(message.proposed_action, requiresApprovalLabel),
    proposedAction: message.proposed_action ?? null,
    provider: null,
    model: null,
    latencyMs: Number.isFinite(message.latency_ms) ? message.latency_ms : null,
  };
}

/** Evidence paths the copilot cites live on the proposed action's plan/body. */
function citationsFromAction(action: DRCopilotProposedAction | null | undefined): string[] {
  if (!action) return [];
  return [`${action.api_call.method.toUpperCase()} ${action.api_call.path}`];
}

function guardrailsFrom(
  action: DRCopilotProposedAction | null | undefined,
  requiresApprovalLabel: string,
): string[] {
  if (!action) return [];
  const guardrails = [...(action.warnings ?? [])];
  if (action.requires_approval) {
    guardrails.unshift(requiresApprovalLabel);
  }
  return guardrails;
}
