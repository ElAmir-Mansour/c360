'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Loader2,
  Quote,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { enterpriseApi } from '@/lib/enterprise';
import { showSuccess, showError } from '@/lib/toast';
import { resolveHitTitles } from '../_lib/library-helpers';
import { useLibraryLabels, type LibraryLabels } from '../_lib/library-labels';
import { useAskConversation, type AskTurn } from '../_lib/ask-conversation';
import { formatAskTurnForExport, toExportFileStem } from '../_lib/ask-export';

/** How a citation asks its host to open the source document (with a deep-link). */
export interface OpenDocumentOptions {
  page?: number;
  snippet?: string;
}

interface AskLibraryPanelProps {
  onOpenDocument: (docId: string, opts?: OpenDocumentOptions) => void;
  /** Scope answers to specific documents (e.g. the detail page's single doc). */
  docIds?: string[];
  /** Test hook: 0 disables the typewriter delay. */
  chunkDelayMs?: number;
  className?: string;
}

/**
 * The reusable "Ask the Library" conversation surface: suggested starter
 * questions → a streamed, cited answer with a live typing effect, kept as a
 * scrollable multi-turn history, plus a follow-up composer. Answers come ONLY
 * from the corpus Q&A endpoint; when that endpoint is not enabled (503) each
 * turn degrades to a graceful "coming soon" state — it never fabricates. Shared
 * by the list-page {@link AskLibrarySheet} and the document detail page (scoped
 * via `docIds`).
 */
export function AskLibraryPanel({
  onOpenDocument,
  docIds,
  chunkDelayMs,
  className,
}: AskLibraryPanelProps) {
  const labels = useLibraryLabels();
  const { locale } = useLocale();
  const { state, submit, stop, reset, isPending } = useAskConversation({
    topK: 6,
    docIds,
    chunkDelayMs,
  });
  const [question, setQuestion] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest tokens in view as the answer streams in.
  const lastAnswerLen = state.turns[state.turns.length - 1]?.answer.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.turns.length, lastAnswerLen]);

  function handleSubmit() {
    const trimmed = question.trim();
    if (!trimmed || isPending) return;
    void submit(trimmed);
    setQuestion('');
  }

  function askStarter(q: string) {
    if (isPending) return;
    setQuestion('');
    void submit(q);
  }

  const hasTurns = state.turns.length > 0;

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {/* Persistent trust affordance — AI-generated, verify the official source. */}
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <p className="text-[11px] leading-5 text-muted-foreground">
          {labels.ask.trustDisclaimer}
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto">
        {!hasTurns ? (
          <div className="space-y-4">
            <StatePanel
              tone="muted"
              icon={Sparkles}
              title={labels.ask.emptyTitle}
              description={labels.ask.emptyDescription}
            />
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {labels.ask.suggestedTitle}
              </h3>
              <div className="flex flex-col gap-2">
                {labels.ask.starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    dir="auto"
                    onClick={() => askStarter(starter)}
                    disabled={isPending}
                    className="group flex items-start gap-2 rounded-lg border bg-card/50 px-3 py-2 text-start text-sm text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1">{starter}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          state.turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              locale={locale}
              onOpenDocument={onOpenDocument}
            />
          ))
        )}
      </div>

      {/* Composer */}
      <div className="mt-3 space-y-2 border-t pt-3">
        <div className="flex items-end gap-2">
          <Textarea
            dir="auto"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={hasTurns ? labels.ask.followUpPlaceholder : labels.ask.inputPlaceholder}
            className="min-h-0 flex-1 resize-none"
            aria-label={labels.ask.inputLabel}
          />
          {isPending ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              onClick={stop}
              aria-label={labels.ask.stop}
              title={labels.ask.stop}
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={handleSubmit}
              disabled={!question.trim()}
              aria-label={labels.ask.submit}
              title={labels.ask.submit}
            >
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">{labels.ask.disclaimer}</p>
          {hasTurns ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={reset}
              disabled={isPending}
            >
              <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {labels.ask.newConversation}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TurnView({
  turn,
  locale,
  onOpenDocument,
}: {
  turn: AskTurn;
  locale: ReturnType<typeof useLocale>['locale'];
  onOpenDocument: (docId: string, opts?: OpenDocumentOptions) => void;
}) {
  const labels = useLibraryLabels();
  const streaming = turn.status === 'streaming';

  return (
    <div className="space-y-3">
      {/* Question */}
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {labels.ask.youLabel}
        </span>
        <p
          dir="auto"
          className="max-w-[85%] rounded-2xl rounded-ee-sm bg-primary/10 px-3 py-2 text-sm text-foreground"
        >
          {turn.question}
        </p>
      </div>

      {/* Answer */}
      {turn.status === 'not-configured' ? (
        <StatePanel
          tone="muted"
          icon={Sparkles}
          title={labels.ask.notConfiguredTitle}
          description={labels.ask.notConfiguredDescription}
        />
      ) : turn.status === 'error' ? (
        <StatePanel
          tone="error"
          icon={TriangleAlert}
          title={labels.ask.errorTitle}
          description={labels.ask.errorDescription}
        />
      ) : (
        <div className="rounded-xl border bg-card/60 p-4">
          {streaming && turn.answer.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {labels.ask.thinking}
            </div>
          ) : (
            <p dir="auto" className="whitespace-pre-wrap text-sm leading-7 text-foreground">
              {turn.answer}
              {streaming ? (
                <span
                  className="ms-0.5 inline-block h-4 w-1.5 animate-pulse bg-primary/70 align-middle"
                  aria-hidden
                />
              ) : null}
            </p>
          )}

          {turn.status === 'done' && turn.model ? (
            <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">
              {labels.ask.modelLine(turn.model, turn.latencyMs ?? 0)}
            </p>
          ) : null}

          {turn.citations.length > 0 ? (
            <div className="mt-3 space-y-2 border-t pt-3">
              <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {labels.ask.sourcesCount(turn.citations.length)}
              </h4>
              <ul className="space-y-2">
                {turn.citations.map((citation, index) => {
                  const titles = resolveHitTitles(citation, locale);
                  const page = typeof citation.page === 'number' ? citation.page : undefined;
                  return (
                    <li key={`${citation.doc_id}-${index}`}>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenDocument(citation.doc_id, {
                            page,
                            snippet: citation.snippet,
                          })
                        }
                        aria-label={labels.ask.openCitation(titles.primary)}
                        className="group flex w-full items-start gap-2 rounded-lg border bg-card/50 px-3 py-2 text-start transition-colors hover:border-primary/30 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span
                            dir="auto"
                            className="flex items-center gap-1 font-medium text-foreground"
                          >
                            <span className="truncate">{titles.primary}</span>
                            {page ? (
                              <span className="shrink-0 rounded-full border border-border/60 bg-muted/50 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                                {labels.ask.onThisPage(String(page))}
                              </span>
                            ) : null}
                            <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                          </span>
                          {citation.snippet ? (
                            <span
                              dir="auto"
                              className="mt-0.5 block text-xs leading-5 text-muted-foreground line-clamp-3"
                            >
                              {citation.snippet}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {/* Verifiability warning: a done answer with zero sources is unverified. */}
          {turn.status === 'done' && turn.answer.trim().length > 0 && turn.citations.length === 0 ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <p className="text-[11px] leading-5 text-foreground">
                {labels.ask.unverifiedWarning}
              </p>
            </div>
          ) : null}

          {/* Copy / export + feedback — only once the answer has finalised. */}
          {turn.status === 'done' && turn.answer.trim().length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              <AnswerActions turn={turn} locale={locale} labels={labels} />
              <FeedbackControls turn={turn} labels={labels} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Copy the answer + citations to the clipboard, or download them as a `.md`. */
function AnswerActions({
  turn,
  locale,
  labels,
}: {
  turn: AskTurn;
  locale: ReturnType<typeof useLocale>['locale'];
  labels: LibraryLabels;
}) {
  const [copied, setCopied] = useState(false);

  const buildText = () =>
    formatAskTurnForExport(
      {
        question: turn.question,
        answer: turn.answer,
        citations: turn.citations,
        model: turn.model,
      },
      locale,
      labels.ask,
    );

  async function handleCopy() {
    const text = buildText();
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
        showSuccess(labels.ask.copied);
      } else {
        throw new Error('clipboard unavailable');
      }
    } catch {
      showError(labels.ask.copyFailed);
    }
  }

  function handleExport() {
    if (typeof window === 'undefined' || typeof URL === 'undefined') return;
    const text = buildText();
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${toExportFileStem(labels.ask.exportFileName, turn.question)}.md`;
    window.document.body.appendChild(anchor);
    anchor.click();
    window.document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={handleCopy}>
        {copied ? (
          <Check className="me-1.5 h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <Copy className="me-1.5 h-3.5 w-3.5" aria-hidden />
        )}
        {labels.ask.copy}
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={handleExport}>
        <Download className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {labels.ask.export}
      </Button>
    </>
  );
}

/** 👍/👎 feedback with an optional comment box on 👎. Never blocks — best effort. */
function FeedbackControls({
  turn,
  labels,
}: {
  turn: AskTurn;
  labels: LibraryLabels;
}) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);

  function send(next: 'up' | 'down', withComment?: string) {
    setRating(next);
    // Fire-and-forget: a failure must never block the reader — swallow it.
    void enterpriseApi.lex.referenceLibrary
      .askFeedback({
        question: turn.question,
        rating: next,
        comment: withComment?.trim() || undefined,
        citations: turn.citations,
      })
      .catch(() => undefined);
  }

  function handleUp() {
    if (done) return;
    send('up');
    setShowComment(false);
    setDone(true);
  }

  function handleDown() {
    if (done && rating === 'down') return;
    send('down');
    setShowComment(true);
  }

  function submitComment() {
    send('down', comment);
    setShowComment(false);
    setDone(true);
  }

  if (done) {
    return (
      <span className="ms-auto text-[11px] text-muted-foreground">
        {labels.ask.feedbackThanks}
      </span>
    );
  }

  return (
    <div className="ms-auto flex flex-col items-end gap-2">
      <div className="flex items-center gap-1">
        <span className="me-1 text-[11px] text-muted-foreground">
          {labels.ask.feedbackPrompt}
        </span>
        <Button
          type="button"
          size="icon"
          variant={rating === 'up' ? 'secondary' : 'ghost'}
          className="h-7 w-7"
          onClick={handleUp}
          aria-label={labels.ask.feedbackHelpful}
          title={labels.ask.feedbackHelpful}
        >
          <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={rating === 'down' ? 'secondary' : 'ghost'}
          className="h-7 w-7"
          onClick={handleDown}
          aria-label={labels.ask.feedbackNotHelpful}
          title={labels.ask.feedbackNotHelpful}
        >
          <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      {showComment ? (
        <div className="w-full max-w-xs space-y-2">
          <Textarea
            dir="auto"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={labels.ask.feedbackCommentPlaceholder}
            className="min-h-0 resize-none text-xs"
            aria-label={labels.ask.feedbackCommentPlaceholder}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => {
                setShowComment(false);
                setDone(true);
              }}
            >
              {labels.ask.feedbackCommentSkip}
            </Button>
            <Button type="button" size="sm" className="h-7 px-2" onClick={submitComment}>
              {labels.ask.feedbackCommentSubmit}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatePanel({
  tone,
  icon: Icon,
  title,
  description,
}: {
  tone: 'muted' | 'error';
  icon: typeof Sparkles;
  title: string;
  description: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-border bg-card/40',
      )}
    >
      <Icon
        className={cn(
          'h-6 w-6',
          tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
