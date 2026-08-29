'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Wifi, WifiOff, RefreshCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { formatDateTime } from '@/lib/utils';
import type { VCISOSuggestedAction } from '@/types/cyber';
import { ConversationList } from './conversation-list';
import { MessageBubble } from './message-bubble';
import { MessageInput } from './message-input';
import { SuggestionChips } from './suggestion-chips';
import { useVCISOChat } from './use-vciso-chat';
import { useVcisoLabels } from '../_lib/vciso-i18n';

export function ChatPanel() {
  const router = useRouter();
  const t = useVcisoLabels();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [input, setInput] = useState('');
  const [confirmAction, setConfirmAction] = useState<VCISOSuggestedAction | null>(null);

  const {
    conversationId,
    messages,
    suggestions,
    connectionState,
    statusText,
    isSending,
    conversations,
    preferredEngine,
    sendMessage,
    loadConversation,
    startNewChat,
    setPreferredEngine,
  } = useVCISOChat();

  // Auto-scroll on new messages or status changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusText]);

  function handleAction(action: VCISOSuggestedAction) {
    switch (action.type) {
      case 'navigate':
        if (action.params.url) {
          router.push(action.params.url);
        }
        return;
      case 'confirm':
        setConfirmAction(action);
        return;
      case 'execute_tool':
      default:
        void sendMessage(action.params.message ?? action.label);
    }
  }

  function handleConfirmAction() {
    if (confirmAction) {
      void sendMessage(confirmAction.params.message ?? confirmAction.label);
    }
  }

  const connectionBadge = (() => {
    switch (connectionState) {
      case 'connected':
        return (
          <Badge variant="outline" className="rounded-full">
            <Wifi className="me-1 h-3 w-3" />
            {t.chat.live}
          </Badge>
        );
      case 'reconnecting':
        return (
          <Badge variant="outline" className="rounded-full text-warning-700 dark:text-warning-300 border-warning-300/60 dark:border-warning-700/60">
            <RefreshCcw className="me-1 h-3 w-3 animate-spin" />
            {t.chat.reconnecting}
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="rounded-full">
            <WifiOff className="me-1 h-3 w-3" />
            {t.chat.fallback}
          </Badge>
        );
    }
  })();

  return (
    <>
      <div className="flex h-[calc(100vh-12rem)] min-h-[720px] flex-col overflow-hidden rounded-softest border bg-card shadow-xl">
        {/* Header */}
        <div className="border-b bg-card px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="rounded-full bg-auth-dark-raised text-white">
                  {t.chat.vciso}
                </Badge>
                {connectionBadge}
                <Badge variant="outline" className="rounded-full text-overline uppercase tracking-caps">
                  {preferredEngine === 'auto'
                    ? t.chat.autoRoute
                    : preferredEngine === 'llm'
                      ? t.chat.llmForced
                      : t.chat.deterministicForced}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t.chat.assistantTagline}
              </p>
            </div>
            <ConversationList
              conversations={conversations}
              currentConversationId={conversationId}
              onNewChat={startNewChat}
              onSelect={(id) => void loadConversation(id)}
            />
          </div>
        </div>

        {/* Suggestion chips */}
        <SuggestionChips suggestions={suggestions} disabled={isSending} onSelect={(message) => void sendMessage(message)} />

        {/* Messages */}
        <ScrollArea className="flex-1 px-4 py-3">
          <div className="space-y-4">
            {messages.length === 0 ? (
              <div className="rounded-soft-lg border border-dashed bg-card/80 p-6">
                <p className="text-sm font-medium">{t.chat.emptyTitle}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t.chat.emptyHint}
                </p>
                <p className="mt-4 text-xs text-muted-foreground">{t.chat.connectedPrefix}{formatDateTime(new Date().toISOString())}</p>
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble key={message.id} message={message} onAction={handleAction} />
              ))
            )}
            {(isSending || statusText) && (
              <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{statusText ?? t.chat.thinking}</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Footer status */}
        <div className="border-t bg-secondary/70 px-4 py-2 text-xs text-muted-foreground">
          {conversationId ? t.chat.conversationActive(conversationId.slice(0, 8)) : t.chat.newConversation}
          {' · '}
          {preferredEngine === 'auto'
            ? t.chat.routerDecides
            : preferredEngine === 'llm'
              ? t.chat.llmOverride
              : t.chat.deterministicOverride}
        </div>

        {/* Input */}
        <MessageInput
          value={input}
          preferredEngine={preferredEngine}
          onChange={setInput}
          onPreferredEngineChange={setPreferredEngine}
          onSend={() => void sendMessage(input)}
          disabled={isSending}
        />
      </div>

      {/* Confirm dialog for dangerous actions (replaces window.confirm) */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={t.chat.confirmActionTitle}
        description={confirmAction?.params.warning ?? t.chat.confirmActionDefault}
        confirmLabel={t.chat.proceed}
        variant="default"
        onConfirm={handleConfirmAction}
      />
    </>
  );
}
