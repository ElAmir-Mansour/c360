'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { getAvatarColor, getInitials } from '@/lib/format';
import { timeAgo } from '@/lib/utils';
import type { AlertComment } from '@/types/cyber';

import { useAlertLabels } from '../../_lib/alerts-i18n';

interface AlertCommentsProps {
  alertId: string;
}

export function AlertComments({ alertId }: AlertCommentsProps) {
  const t = useAlertLabels();
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const commentsQuery = useQuery({
    queryKey: ['alert-comments', alertId],
    queryFn: () => apiGet<{ data: AlertComment[] }>(API_ENDPOINTS.CYBER_ALERT_COMMENTS(alertId)),
  });

  async function handleSubmit() {
    if (!draft.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await apiPost(API_ENDPOINTS.CYBER_ALERT_COMMENTS(alertId), {
        content: draft.trim(),
      });
      setDraft('');
      toast.success(t.comments.added);
      await commentsQuery.refetch();
    } catch {
      toast.error(t.comments.addFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const comments = commentsQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-softer border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/15 bg-secondary text-foreground">
            <MessageSquareText className="h-4 w-4" />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                {t.comments.eyebrow}
              </p>
              <h2 className="text-h4 font-semibold text-foreground">
                {t.comments.heading}
              </h2>
            </div>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={5}
              placeholder={t.comments.placeholder}
            />
            <div className="flex justify-end">
              <Button onClick={() => void handleSubmit()} disabled={submitting || !draft.trim()}>
                <Send className="me-2 h-4 w-4" />
                {submitting ? t.comments.addBusy : t.comments.addIdle}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        {commentsQuery.isLoading ? (
          <LoadingSkeleton variant="list-item" count={4} />
        ) : commentsQuery.error ? (
          <ErrorState message={t.comments.loadError} onRetry={() => void commentsQuery.refetch()} />
        ) : comments.length === 0 ? (
          <div className="rounded-softer border border-dashed bg-card p-8 text-center text-muted-foreground">
            <Sparkles className="mx-auto mb-3 h-6 w-6 opacity-60" />
            {t.comments.empty}
          </div>
        ) : (
          comments.map((comment) => <CommentCard key={comment.id} comment={comment} />)
        )}
      </section>
    </div>
  );
}

function CommentCard({ comment }: { comment: AlertComment }) {
  const t = useAlertLabels();
  const [firstName, ...rest] = comment.user_name.split(' ');
  const lastName = rest.join(' ');
  const initials = getInitials(firstName || '?', lastName || '');
  const tone = getAvatarColor(comment.user_name || comment.user_email || 'system');
  const mentions = Array.isArray(comment.metadata?.['mentions'])
    ? (comment.metadata?.['mentions'] as string[])
    : [];

  return (
    <article className="rounded-softer border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <Avatar className="h-11 w-11">
          <AvatarFallback className={`${tone} text-sm font-semibold text-white`}>
            {comment.is_system ? 'AI' : initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {comment.is_system ? t.comments.system : comment.user_name}
            </p>
            <span className="text-xs text-muted-foreground">{timeAgo(comment.created_at)}</span>
            {comment.user_email && !comment.is_system && (
              <span className="text-xs text-muted-foreground">{comment.user_email}</span>
            )}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground">{comment.content}</p>
          {mentions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {mentions.map((mention) => (
                <span
                  key={mention}
                  className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                >
                  @{mention}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
