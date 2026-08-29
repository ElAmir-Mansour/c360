'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Bell, CheckCheck, ClipboardList, Loader2, MessageSquareText, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { formatDateTime } from '@/lib/format';
import { casesApi, type CaseComment } from '@/lib/lex/cases';
import { showApiError, showSuccess } from '@/lib/toast';
import { useDetailWorkspaceLabels } from './workspace-labels';

interface CollaborationPanelProps {
  caseId: string;
}

interface CaseNote {
  id: string;
  body: string;
  mentions: string[];
  author: string;
  createdAt: string;
}

interface StoredIds {
  key: string;
  ids: string[];
}

type CollaborationScope = 'unread' | 'mentions' | 'mentionedYou';

const MENTION_PATTERN = /(@[\p{L}\p{N}_.-]+)/gu;

export function CollaborationPanel({ caseId }: CollaborationPanelProps) {
  const labels = useDetailWorkspaceLabels();
  const t = labels.collaboration;
  const { user, hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // §9 — case collaboration tasks are case mutations.
  const canCreateTasks = hasPermission('lex:case:edit');
  const storageKey = useMemo(() => `lex-case-collaboration:${caseId}`, [caseId]);
  const markerIdentity = user?.id ?? user?.email ?? 'anonymous';
  const readStorageKey = useMemo(
    () => `lex-case-collaboration-read:${caseId}:${markerIdentity}`,
    [caseId, markerIdentity],
  );
  const convertedStorageKey = useMemo(
    () => `lex-case-collaboration-converted:${caseId}:${markerIdentity}`,
    [caseId, markerIdentity],
  );
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [readMarkers, setReadMarkers] = useState<StoredIds>({ key: '', ids: [] });
  const [convertedMarkers, setConvertedMarkers] = useState<StoredIds>({ key: '', ids: [] });
  const [metricScope, setMetricScope] = useState<CollaborationScope | null>(null);

  const commentsQuery = useQuery({
    queryKey: ['lex-case-comments', caseId],
    queryFn: () => casesApi.listComments(caseId),
    enabled: Boolean(caseId),
    retry: false,
  });

  const persistedNotes = useMemo(
    () => (commentsQuery.data ?? []).map(caseCommentToNote),
    [commentsQuery.data],
  );
  const usingLocalFallback = commentsQuery.isError;

  useEffect(() => {
    setReadMarkers({ key: readStorageKey, ids: readStoredIds(readStorageKey) });
  }, [readStorageKey]);

  useEffect(() => {
    if (readMarkers.key !== readStorageKey) return;
    window.localStorage.setItem(readStorageKey, JSON.stringify(readMarkers.ids));
  }, [readMarkers, readStorageKey]);

  useEffect(() => {
    setConvertedMarkers({ key: convertedStorageKey, ids: readStoredIds(convertedStorageKey) });
  }, [convertedStorageKey]);

  useEffect(() => {
    if (convertedMarkers.key !== convertedStorageKey) return;
    window.localStorage.setItem(convertedStorageKey, JSON.stringify(convertedMarkers.ids));
  }, [convertedMarkers, convertedStorageKey]);

  useEffect(() => {
    if (!usingLocalFallback) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setNotes(Array.isArray(parsed) ? parsed.filter(isCaseNote) : []);
    } catch {
      setNotes([]);
    } finally {
      setLoaded(true);
    }
  }, [storageKey, usingLocalFallback]);

  useEffect(() => {
    if (!loaded || !usingLocalFallback) return;
    window.localStorage.setItem(storageKey, JSON.stringify(notes));
  }, [loaded, notes, storageKey, usingLocalFallback]);

  const visibleNotes = usingLocalFallback ? notes : persistedNotes;
  const readIdSet = useMemo(
    () => new Set(readMarkers.key === readStorageKey ? readMarkers.ids : []),
    [readMarkers, readStorageKey],
  );
  const convertedIdSet = useMemo(
    () => new Set(convertedMarkers.key === convertedStorageKey ? convertedMarkers.ids : []),
    [convertedMarkers, convertedStorageKey],
  );
  const currentMentionHandles = useMemo(() => userMentionHandles(user), [user]);
  const currentAuthorKeys = useMemo(() => userAuthorKeys(user, t.you), [user, t.you]);
  const mentionSummary = useMemo(
    () => buildMentionSummary(visibleNotes, currentMentionHandles),
    [currentMentionHandles, visibleNotes],
  );
  const unreadNotes = useMemo(
    () =>
      visibleNotes.filter(
        (note) => !isOwnNote(note, currentAuthorKeys) && !readIdSet.has(note.id),
      ),
    [currentAuthorKeys, readIdSet, visibleNotes],
  );
  const scopedNotes = useMemo(() => {
    if (metricScope === 'unread') {
      const unreadIds = new Set(unreadNotes.map((note) => note.id));
      return visibleNotes.filter((note) => unreadIds.has(note.id));
    }
    if (metricScope === 'mentions') {
      return visibleNotes.filter((note) => note.mentions.length > 0);
    }
    if (metricScope === 'mentionedYou') {
      return visibleNotes.filter((note) =>
        note.mentions.some((mention) =>
          currentMentionHandles.has(normalizeMentionHandle(mention)),
        ),
      );
    }
    return visibleNotes;
  }, [currentMentionHandles, metricScope, unreadNotes, visibleNotes]);
  const toggleMetricScope = (scope: CollaborationScope) => {
    setMetricScope((current) => (current === scope ? null : scope));
  };

  const markNotesRead = (noteIds: string[]) => {
    if (noteIds.length === 0) return;
    setReadMarkers((current) => {
      const base = current.key === readStorageKey ? current.ids : [];
      return { key: readStorageKey, ids: Array.from(new Set([...base, ...noteIds])) };
    });
  };

  const markNoteConverted = (noteId: string) => {
    setConvertedMarkers((current) => {
      const base = current.key === convertedStorageKey ? current.ids : [];
      return { key: convertedStorageKey, ids: Array.from(new Set([...base, noteId])) };
    });
  };

  const addMutation = useMutation({
    mutationFn: (body: string) => {
      const mentions = extractMentions(body);
      return casesApi.addComment(caseId, {
        body,
        mentions,
        metadata: {
          mention_handles: mentions,
          author_name: user?.full_name ?? user?.email ?? t.you,
        },
      });
    },
    onSuccess: async (comment) => {
      setDraft('');
      markNotesRead([comment.id]);
      await queryClient.invalidateQueries({ queryKey: ['lex-case-comments', caseId] });
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => casesApi.deleteComment(caseId, commentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lex-case-comments', caseId] });
    },
    onError: showApiError,
  });

  const taskMutation = useMutation({
    mutationFn: (note: CaseNote) =>
      casesApi.defineTask(caseId, {
        title: noteTaskTitle(note, t),
        assignee_id: null,
        priority: note.mentions.some((mention) => currentMentionHandles.has(normalizeMentionHandle(mention)))
          ? 'high'
          : 'medium',
        status: 'open',
        due_date: null,
        metadata: {
          source: 'collaboration_note',
          note_id: note.id,
          comment_id: usingLocalFallback ? null : note.id,
          local_fallback: usingLocalFallback,
          mention_handles: note.mentions,
          note_author: note.author,
          note_created_at: note.createdAt,
          body_excerpt: note.body.slice(0, 500),
        },
      }),
    onSuccess: async (_task, note) => {
      markNoteConverted(note.id);
      markNotesRead([note.id]);
      showSuccess(t.taskCreatedToast);
      await queryClient.invalidateQueries({ queryKey: ['lex-case', caseId] });
    },
    onError: showApiError,
  });

  const addNote = () => {
    const body = draft.trim();
    if (!body) return;
    if (!usingLocalFallback) {
      addMutation.mutate(body);
      return;
    }
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
    setNotes((current) => [
      {
        id,
        body,
        mentions: extractMentions(body),
        author: t.you,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    markNotesRead([id]);
    setDraft('');
  };

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-primary" />
          {t.title}
        </span>
      }
      description={t.description}
    >
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <CollaborationMetric
              label={t.unread}
              value={unreadNotes.length}
              onAction={() => toggleMetricScope('unread')}
              pressed={metricScope === 'unread'}
            />
            <CollaborationMetric
              label={t.mentionsMetric}
              value={mentionSummary.totalMentions}
              onAction={() => toggleMetricScope('mentions')}
              pressed={metricScope === 'mentions'}
            />
            <CollaborationMetric
              label={t.mentionedYou}
              value={mentionSummary.mentionedYou}
              onAction={() => toggleMetricScope('mentionedYou')}
              pressed={metricScope === 'mentionedYou'}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={usingLocalFallback ? 'warning' : 'secondary'}>
                {usingLocalFallback ? t.localFallback : t.serverNotes}
              </Badge>
              {mentionSummary.topMentions.slice(0, 3).map((mention) => (
                <Badge key={mention.handle} variant="outline">
                  @{mention.handle} x{mention.count}
                </Badge>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={unreadNotes.length === 0}
              onClick={() => markNotesRead(unreadNotes.map((note) => note.id))}
            >
              <CheckCheck className="me-1.5 h-3.5 w-3.5" />
              {t.markAllRead}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Textarea
            value={draft}
            rows={4}
            placeholder={t.placeholder}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={addNote} disabled={!draft.trim() || addMutation.isPending}>
              <AtSign className="me-1.5 h-3.5 w-3.5" />
              {t.add}
            </Button>
          </div>
        </div>

        {commentsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t.description}</p>
        ) : scopedNotes.length === 0 ? (
          <EmptyState icon={MessageSquareText} title={t.emptyTitle} description={t.emptyDescription} />
        ) : (
          <div className="space-y-3">
            {scopedNotes.map((note) => {
              const ownNote = isOwnNote(note, currentAuthorKeys);
              const unread = !ownNote && !readIdSet.has(note.id);
              const converted = convertedIdSet.has(note.id);
              const converting = taskMutation.isPending && taskMutation.variables?.id === note.id;
              const mentionedCurrentUser = note.mentions.some((mention) =>
                currentMentionHandles.has(normalizeMentionHandle(mention)),
              );

              return (
                <article
                  key={note.id}
                  className={`rounded-lg border bg-card px-4 py-3 ${unread ? 'border-primary/40 bg-primary/5' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{note.author}</p>
                        {ownNote ? (
                          <Badge variant="secondary">{t.ownNote}</Badge>
                        ) : unread ? (
                          <Badge variant="default">{t.unreadBadge}</Badge>
                        ) : (
                          <Badge variant="outline">{t.readLocally}</Badge>
                        )}
                        {mentionedCurrentUser ? <Badge variant="warning">{t.mentionsYou}</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(note.createdAt)}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {canCreateTasks ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={converted || converting}
                          onClick={() => taskMutation.mutate(note)}
                        >
                          {converting ? (
                            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ClipboardList className="me-1.5 h-3.5 w-3.5" />
                          )}
                          {converted ? t.taskCreated : t.convertToTask}
                        </Button>
                      ) : null}
                      {unread ? (
                        <Button size="sm" variant="ghost" onClick={() => markNotesRead([note.id])}>
                          <CheckCheck className="me-1.5 h-3.5 w-3.5" />
                          {t.markRead}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (usingLocalFallback) {
                            setNotes((current) => current.filter((item) => item.id !== note.id));
                            return;
                          }
                          deleteMutation.mutate(note.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="sr-only">{t.clear}</span>
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
                    {renderMentionText(note.body)}
                  </p>
                  {note.mentions.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t.mentions}</span>
                      {note.mentions.map((mention) => (
                        <Badge
                          key={mention}
                          variant={currentMentionHandles.has(normalizeMentionHandle(mention)) ? 'default' : 'outline'}
                        >
                          @{mention}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function CollaborationMetric({
  label,
  value,
  onAction,
  pressed,
}: {
  label: string;
  value: ReactNode;
  onAction: () => void;
  pressed: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      title={statisticHint(label)}
      aria-pressed={pressed}
      data-pressed={pressed}
      className="h-auto flex-col items-stretch rounded-md border bg-card/70 px-3 py-2 text-start font-normal transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[pressed=true]:border-primary data-[pressed=true]:bg-primary/10"
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Bell className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </Button>
  );
}

function extractMentions(value: string): string[] {
  const matches = value.match(MENTION_PATTERN) ?? [];
  return Array.from(new Set(matches.map((mention) => mention.slice(1))));
}

function normalizeMentionHandle(value: string): string {
  return value.replace(/^@/, '').trim().toLowerCase();
}

function mentionHandleVariants(value: string | null | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  return Array.from(
    new Set([
      lower,
      lower.replace(/\s+/g, '.'),
      lower.replace(/\s+/g, '_'),
      lower.replace(/\s+/g, ''),
    ].map(normalizeMentionHandle).filter(Boolean)),
  );
}

function userMentionHandles(
  user: { email?: string; first_name?: string; last_name?: string; full_name?: string } | null,
): Set<string> {
  const handles = new Set<string>();
  mentionHandleVariants(user?.email?.split('@')[0]).forEach((handle) => handles.add(handle));
  mentionHandleVariants(user?.first_name).forEach((handle) => handles.add(handle));
  mentionHandleVariants(user?.last_name).forEach((handle) => handles.add(handle));
  mentionHandleVariants(user?.full_name).forEach((handle) => handles.add(handle));
  mentionHandleVariants([user?.first_name, user?.last_name].filter(Boolean).join(' ')).forEach((handle) =>
    handles.add(handle),
  );
  return handles;
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function userAuthorKeys(
  user: { id?: string; email?: string; first_name?: string; last_name?: string; full_name?: string } | null,
  youLabel: string,
): Set<string> {
  return new Set(
    [youLabel, user?.id, user?.email, user?.full_name, [user?.first_name, user?.last_name].filter(Boolean).join(' ')]
      .map(normalizeIdentity)
      .filter(Boolean),
  );
}

function isOwnNote(note: CaseNote, authorKeys: Set<string>): boolean {
  return authorKeys.has(normalizeIdentity(note.author));
}

function buildMentionSummary(notes: CaseNote[], currentHandles: Set<string>) {
  const counts = new Map<string, number>();
  let mentionedYou = 0;

  notes.forEach((note) => {
    let noteMentionsCurrentUser = false;
    note.mentions.forEach((mention) => {
      const handle = normalizeMentionHandle(mention);
      if (!handle) return;
      counts.set(handle, (counts.get(handle) ?? 0) + 1);
      if (currentHandles.has(handle)) noteMentionsCurrentUser = true;
    });
    if (noteMentionsCurrentUser) mentionedYou += 1;
  });

  return {
    totalMentions: Array.from(counts.values()).reduce((sum, count) => sum + count, 0),
    mentionedYou,
    topMentions: Array.from(counts.entries())
      .map(([handle, count]) => ({ handle, count }))
      .sort((a, b) => b.count - a.count || a.handle.localeCompare(b.handle)),
  };
}

function noteTaskTitle(note: CaseNote, labels: { collaborationNote: string; followUp: (text: string) => string }): string {
  const firstLine = note.body.trim().split('\n')[0]?.replace(/\s+/g, ' ') || labels.collaborationNote;
  const clipped = firstLine.length > 82 ? `${firstLine.slice(0, 79)}...` : firstLine;
  return labels.followUp(clipped);
}

function readStoredIds(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function renderMentionText(value: string): ReactNode[] {
  return value.split(MENTION_PATTERN).map((part, index) => {
    if (part.match(MENTION_PATTERN)) {
      return (
        <span key={`${part}-${index}`} className="font-medium text-primary">
          {part}
        </span>
      );
    }
    return part;
  });
}

function caseCommentToNote(comment: CaseComment): CaseNote {
  const metadata = comment.metadata ?? {};
  const mentionHandles = Array.isArray(metadata.mention_handles)
    ? metadata.mention_handles.filter((mention): mention is string => typeof mention === 'string')
    : extractMentions(comment.body);
  return {
    id: comment.id,
    body: comment.body,
    mentions: mentionHandles,
    author:
      typeof metadata.author_name === 'string' && metadata.author_name.trim()
        ? metadata.author_name
        : comment.created_by,
    createdAt: comment.created_at,
  };
}

function isCaseNote(value: unknown): value is CaseNote {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CaseNote>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.body === 'string' &&
    Array.isArray(candidate.mentions) &&
    candidate.mentions.every((mention) => typeof mention === 'string') &&
    typeof candidate.author === 'string' &&
    typeof candidate.createdAt === 'string'
  );
}
