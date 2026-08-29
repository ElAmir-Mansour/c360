'use client';

import { History, MessageSquarePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn, timeAgo } from '@/lib/utils';
import type { VCISOConversationListItem } from '@/types/cyber';
import { useVcisoLabels } from '../_lib/vciso-i18n';

interface ConversationListProps {
  conversations: VCISOConversationListItem[];
  currentConversationId: string | null;
  onNewChat: () => void;
  onSelect: (conversationId: string) => void;
}

export function ConversationList({
  conversations,
  currentConversationId,
  onNewChat,
  onSelect,
}: ConversationListProps) {
  const t = useVcisoLabels();
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onNewChat}>
        <MessageSquarePlus className="me-1.5 h-4 w-4" />
        {t.conversations.newChat}
      </Button>
      <Sheet>
        <SheetTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <History className="me-1.5 h-4 w-4" />
            {t.conversations.history}
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t.conversations.historyTitle}</SheetTitle>
            <SheetDescription>{t.conversations.historyDescription}</SheetDescription>
          </SheetHeader>
          <ScrollArea className="mt-6 h-[calc(100vh-8rem)] pe-4">
            <div className="space-y-2">
              {conversations.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  {t.conversations.empty}
                </p>
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    className={cn(
                      'w-full rounded-2xl border bg-card p-4 text-start transition-colors hover:border-primary/40 hover:bg-primary/5',
                      currentConversationId === conversation.id && 'border-primary bg-primary/5',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{conversation.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.conversations.messageCount(conversation.message_count)}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(conversation.last_message_at ?? conversation.created_at)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
