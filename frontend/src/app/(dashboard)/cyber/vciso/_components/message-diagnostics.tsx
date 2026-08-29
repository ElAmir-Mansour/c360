'use client';

import { useState } from 'react';
import { Loader2, Route, ScanSearch } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { apiGet } from '@/lib/api';
import { formatCompactNumber, parseApiError } from '@/lib/format';
import { API_ENDPOINTS } from '@/lib/constants';
import { cn, formatDateTime } from '@/lib/utils';
import type { VCISOConversationMessage, VCISOLLMAuditResponse } from '@/types/cyber';
import { useVcisoChatLabels, type VcisoChatLabels } from '../_lib/vciso-i18n';

interface MessageDiagnosticsProps {
  message: VCISOConversationMessage;
}

export function MessageDiagnostics({ message }: MessageDiagnosticsProps) {
  const t = useVcisoChatLabels().diagnostics;
  const [open, setOpen] = useState(false);
  const [audit, setAudit] = useState<VCISOLLMAuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const meta = message.meta;
  const engine = meta?.engine ?? message.engine ?? null;
  const canViewTrace = message.role === 'assistant' && (engine === 'llm' || engine === 'fallback');
  const hasVisibleMeta =
    Boolean(engine) ||
    Boolean(meta?.grounding) ||
    Boolean(meta?.tokens_used) ||
    Boolean(meta?.routing_reason) ||
    Boolean(meta?.reasoning_steps);

  if (!hasVisibleMeta && !canViewTrace) {
    return null;
  }

  async function handleOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen || !canViewTrace || audit || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await apiGet<VCISOLLMAuditResponse>(
        `${API_ENDPOINTS.CYBER_VCISO_LLM_AUDIT}/${message.id}`,
      );
      setAudit(response);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {engine && (
          <Badge
            variant="outline"
            className={cn('rounded-full text-overline uppercase tracking-caps', engineColor(engine))}
          >
            {engineLabel(engine, t)}
          </Badge>
        )}
        {meta?.grounding && (
          <Badge variant="outline" className="rounded-full text-overline">
            {t.groundingPrefix} {meta.grounding}
          </Badge>
        )}
        {meta?.tokens_used ? (
          <Badge variant="outline" className="rounded-full text-overline">
            {formatCompactNumber(meta.tokens_used)} {t.tokensSuffix}
          </Badge>
        ) : null}
        {meta?.reasoning_steps ? (
          <Badge variant="outline" className="rounded-full text-overline">
            {meta.reasoning_steps} {t.reasoningStepsSuffix}
          </Badge>
        ) : null}
        {canViewTrace && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 rounded-full px-2 text-[10px]"
            onClick={() => void handleOpen(true)}
          >
            <ScanSearch className="me-1 h-3 w-3" />
            {t.viewTrace}
          </Button>
        )}
      </div>
      {meta?.routing_reason && (
        <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
          <Route className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{t.routePrefix} {humanize(meta.routing_reason)}</span>
        </div>
      )}

      <Sheet open={open} onOpenChange={(nextOpen) => void handleOpen(nextOpen)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t.llmTrace}</SheetTitle>
            <SheetDescription>{t.traceDescription}</SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <SummaryCard title={t.engine} value={engineLabel(engine ?? 'rule_based', t)} detail={meta?.routing_reason ? humanize(meta.routing_reason) : t.noRoutingReason} />
              <SummaryCard title={t.grounding} value={meta?.grounding ?? audit?.grounding_result ?? '—'} detail={t.createdPrefix(formatDateTime(audit?.created_at ?? message.created_at))} />
              <SummaryCard title={t.tokens} value={audit ? formatCompactNumber(audit.total_tokens) : meta?.tokens_used ? formatCompactNumber(meta.tokens_used) : '—'} detail={audit ? t.promptCompletion(formatCompactNumber(audit.prompt_tokens), formatCompactNumber(audit.completion_tokens)) : t.tokenEstimate} />
              <SummaryCard title={t.reasoning} value={audit ? String(audit.reasoning_trace.length) : meta?.reasoning_steps ? String(meta.reasoning_steps) : '—'} detail={audit ? t.toolCallsRecorded(audit.tool_calls.length) : t.reasoningFromMeta} />
            </div>

            {isLoading && (
              <div className="flex items-center gap-3 rounded-2xl border bg-secondary px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.loadingTrace}
              </div>
            )}

            {!isLoading && error && (
              <div className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                {error}
              </div>
            )}

            {!isLoading && audit && (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <SummaryCard title={t.provider} value={audit.provider} detail={audit.model} />
                  <SummaryCard title={t.routing} value={humanize(audit.engine_used)} detail={audit.routing_reason ? humanize(audit.routing_reason) : t.noRoutingReason} />
                  <SummaryCard title={t.logged} value={formatDateTime(audit.created_at)} detail={t.messagePrefix(message.id.slice(0, 8))} />
                </div>

                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t.reasoningTrace}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {audit.reasoning_trace.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t.noReasoningTrace}</p>
                    ) : (
                      audit.reasoning_trace.map((step) => (
                        <div key={`${step.step}-${step.action}`} className="rounded-2xl border bg-secondary/80 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold">
                              {t.stepPrefix(step.step, humanize(step.action))}
                            </p>
                            {step.tool_names && step.tool_names.length > 0 && (
                              <Badge variant="outline" className="rounded-full text-overline">
                                {t.toolsSuffix(step.tool_names.length)}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{step.detail}</p>
                          {step.tool_names && step.tool_names.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {step.tool_names.map((toolName) => (
                                <Badge key={toolName} variant="outline" className="rounded-full text-overline">
                                  {toolName}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t.toolCalls}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {audit.tool_calls.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t.noToolCalls}</p>
                    ) : (
                      audit.tool_calls.map((toolCall, index) => (
                        <div key={`${toolCall.name}-${index}`} className="rounded-2xl border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">{toolCall.name}</p>
                            <Badge
                              variant="outline"
                              className={cn(
                                'rounded-full text-overline',
                                toolCall.success ? 'border-primary/30 text-primary' : 'border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300',
                              )}
                            >
                              {toolCall.success ? t.success : t.failed}
                            </Badge>
                            <Badge variant="outline" className="rounded-full text-overline">
                              {t.msSuffix(toolCall.latency_ms)}
                            </Badge>
                          </div>
                          {Object.keys(toolCall.arguments ?? {}).length > 0 && (
                            <div className="mt-3 rounded-xl bg-secondary p-3">
                              <p className="mb-2 text-[11px] font-medium uppercase tracking-caps text-muted-foreground">
                                {t.arguments}
                              </p>
                              <pre className="overflow-x-auto text-xs">
                                {JSON.stringify(toolCall.arguments, null, 2)}
                              </pre>
                            </div>
                          )}
                          {toolCall.result_summary && (
                            <>
                              <Separator className="my-3" />
                              <p className="text-sm text-muted-foreground">{toolCall.result_summary}</p>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function SummaryCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="border-border/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function engineLabel(engine: string, t: VcisoChatLabels['diagnostics']): string {
  switch (engine) {
    case 'llm':
      return 'LLM';
    case 'rule_based':
      return t.deterministic;
    case 'fallback':
      return t.fallback;
    default:
      return humanize(engine);
  }
}

function engineColor(engine: string): string {
  switch (engine) {
    case 'llm':
      return 'border-sky-200 text-sky-700 dark:border-sky-900 dark:text-sky-300';
    case 'fallback':
      return 'border-warning-300 text-warning-700 dark:border-warning-800 dark:text-warning-300';
    case 'rule_based':
      return 'border-primary/15 text-foreground';
    default:
      return 'border-border text-foreground';
  }
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
