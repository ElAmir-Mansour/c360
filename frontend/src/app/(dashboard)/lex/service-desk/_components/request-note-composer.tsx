'use client';

/**
 * #9 Request detail right rail — "Internal notes" thread + composer.
 *
 * REAL and fully functional: reads the persisted note thread via
 * `GET /legal-requests/{id}/notes` (`lexRequestsApi.listRequestNotes`) and posts
 * new notes via `POST /legal-requests/{id}/notes`
 * (`lexRequestsApi.createRequestNote`). @-mentions are captured from the note
 * text — any `@handle` token in the body is parsed out and sent in the
 * `mentions` array, which the backend persists on the note — so the mention hint
 * is truthful rather than aspirational.
 *
 * On a successful post the composer clears the textarea, shows a success toast,
 * and invalidates the thread query so the new note appears at the bottom.
 */

import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexRequestsApi, type RequestNote } from '@/lib/lex/requests';
import { useRequestActivityMiniLabels } from './request-activity-mini-labels';
import { ReviewRoundSeparator } from './review-round-separator';
import { groupByReviewRound, hasMultipleRounds } from './review-rounds';

export interface RequestNoteComposerProps {
  requestId: string;
  className?: string;
}

// Capture @handle tokens from the note body so they can be persisted as
// mentions. Unicode-aware so Arabic handles are captured too; the leading `@`
// is stripped and duplicates are de-duplicated.
const MENTION_PATTERN = /@([\p{L}\p{N}._-]+)/gu;

function extractMentions(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const handle = match[1]?.trim();
    if (handle) {
      seen.add(handle);
    }
  }
  return Array.from(seen);
}

export function RequestNoteComposer({ requestId, className }: RequestNoteComposerProps) {
  const { direction } = useLocale();
  const f = useLexFormat();
  const t = useRequestActivityMiniLabels().composer;
  const qc = useQueryClient();

  const [draft, setDraft] = useState('');

  const notesQuery = useQuery({
    queryKey: ['lex-request-notes', requestId],
    queryFn: () => lexRequestsApi.listRequestNotes(requestId),
    enabled: Boolean(requestId),
    retry: false,
  });

  const notes = useMemo(
    () =>
      [...(notesQuery.data ?? [])].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      ),
    [notesQuery.data],
  );

  const postMutation = useMutation({
    mutationFn: () =>
      lexRequestsApi.createRequestNote(requestId, {
        body: draft.trim(),
        mentions: extractMentions(draft),
      }),
    onSuccess: async () => {
      showSuccess(t.postSuccess);
      setDraft('');
      await qc.invalidateQueries({ queryKey: ['lex-request-notes', requestId] });
    },
    onError: showApiError,
  });

  const submit = () => {
    if (!draft.trim()) {
      return;
    }
    postMutation.mutate();
  };

  const isLoading = notesQuery.isLoading;
  const isError = notesQuery.isError;
  const isEmpty = !isLoading && !isError && notes.length === 0;
  const canPost = draft.trim().length > 0 && !postMutation.isPending;

  // The thread is grouped into the review rounds the request has been through.
  // Separators only appear once a request has actually been returned at least
  // once — labelling a single round adds chrome without information.
  const rounds = useMemo(() => groupByReviewRound(notes), [notes]);
  const showRounds = hasMultipleRounds(rounds);
  const currentRound = rounds.length > 0 ? rounds[rounds.length - 1].cycle : 1;

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t.title}
        </span>
      }
      actions={
        notes.length > 0 ? (
          <Badge variant="neutral" size="sm">
            {notes.length}
          </Badge>
        ) : undefined
      }
      className={className}
      contentClassName="space-y-3"
    >
      <div dir={direction} className="space-y-3">
        {isLoading ? (
          <Skeleton variant="list" rows={2} />
        ) : isError ? (
          <EmptyState size="compact" title={t.loadError} description="" />
        ) : isEmpty ? (
          <EmptyState size="compact" title={t.empty} description="" />
        ) : (
          <ul className="space-y-2.5">
            {rounds.map((round) => (
              <Fragment key={round.cycle}>
                {showRounds ? (
                  <ReviewRoundSeparator
                    cycle={round.cycle}
                    isCurrent={round.cycle === currentRound}
                  />
                ) : null}
                {round.items.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    mentionsLabel={t.mentionsLabel}
                    formatRelative={f.formatRelative}
                  />
                ))}
              </Fragment>
            ))}
          </ul>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t.placeholder}
            rows={3}
            aria-label={t.title}
            data-request-id={requestId}
          />
          <p className="text-[11px] text-muted-foreground">{t.mentionHint}</p>
          <Button
            type="button"
            size="sm"
            className="w-full justify-center gap-2"
            onClick={submit}
            disabled={!canPost}
            aria-disabled={!canPost}
          >
            <Send className="h-3.5 w-3.5" aria-hidden />
            {postMutation.isPending ? t.posting : t.postButton}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

interface NoteRowProps {
  note: RequestNote;
  mentionsLabel: string;
  formatRelative: (value: string | Date | number | null | undefined) => string;
}

function NoteRow({ note, mentionsLabel, formatRelative }: NoteRowProps) {
  return (
    <li className="rounded-md border border-border bg-muted/30 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-foreground">
          {note.author_name || note.author_id}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatRelative(note.created_at)}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-snug text-foreground">
        {note.body}
      </p>
      {note.mentions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-muted-foreground">{mentionsLabel}:</span>
          {note.mentions.map((mention) => (
            <Badge key={mention} variant="neutral" size="sm">
              @{mention}
            </Badge>
          ))}
        </div>
      )}
    </li>
  );
}
