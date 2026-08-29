'use client';

/**
 * FEATURE 10 UI — Matter comments thread.
 *
 * A @mention-aware collaboration thread for a legal matter. Mirrors the
 * legal-case `CollaborationPanel` pattern but against the matter-comment
 * backend (`GET/POST/PUT/DELETE /matters/{id}/comments`).
 *
 * Self-contained bilingual (English + MSA) labels resolved against the active
 * locale via the lex `LexBilingual` contract, so the thread renders the right
 * surface + RTL without depending on the shared lex label hooks. RTL is handled
 * with logical CSS props (`ms-/me-/ps-/start-`) — no physical left/right.
 *
 * fe-client contract consumed (added separately to api.ts / suites.ts):
 *   enterpriseApi.lex.listMatterComments(matterId)            -> LexMatterComment[]
 *   enterpriseApi.lex.addMatterComment(matterId, payload)     -> LexMatterComment
 *   enterpriseApi.lex.updateMatterComment(matterId, id, body) -> LexMatterComment
 *   enterpriseApi.lex.deleteMatterComment(matterId, id)       -> void
 *
 * `author_name` is derived server-side from the JWT — the client NEVER sends it.
 * Add/update payloads carry only `{ body, mentions }` (mentions parsed from the
 * body's `@handle` tokens).
 */

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Check, MessageSquareText, PencilLine, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { RelativeTime } from '@/components/shared/relative-time';
import { UserAvatar } from '@/components/shared/user-avatar';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { JsonObject, LexMatterComment } from '@/types/suites';
import { resolveLexBilingual, type LexBilingual } from '../../_lib/lex-i18n';

/** Local alias for the persisted matter comment (fe-client type, suites.ts). */
type MatterComment = LexMatterComment;

interface MatterCommentsThreadProps {
  matterId: string;
  canWrite: boolean;
}

/** Matches @Name / @user.handle / @وثيق tokens (Unicode letters, digits, _.-). */
const MENTION_PATTERN = /(@[\p{L}\p{N}_.-]+)/gu;

export function MatterCommentsThread({ matterId, canWrite }: MatterCommentsThreadProps) {
  const { locale, direction } = useLocaleOrDefault();
  const { user } = useAuth();
  const t = useMemo(() => resolveLexBilingual(matterCommentsLabels, locale), [locale]);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['lex-matter-comments', matterId], [matterId]);

  const [draft, setDraft] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MatterComment | null>(null);

  const commentsQuery = useQuery({
    queryKey,
    queryFn: () => enterpriseApi.lex.listMatterComments(matterId),
    enabled: Boolean(matterId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const addMutation = useMutation({
    mutationFn: (body: string) =>
      enterpriseApi.lex.addMatterComment(matterId, {
        body,
        mentions: extractMentions(body),
      }),
    onSuccess: async () => {
      setDraft('');
      showSuccess(t.toastAdded);
      await invalidate();
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      enterpriseApi.lex.updateMatterComment(matterId, id, {
        body,
        mentions: extractMentions(body),
      }),
    onSuccess: async () => {
      setEditId(null);
      setEditDraft('');
      showSuccess(t.toastUpdated);
      await invalidate();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.deleteMatterComment(matterId, id),
    onSuccess: async () => {
      setDeleteTarget(null);
      showSuccess(t.toastDeleted);
      await invalidate();
    },
    onError: showApiError,
  });

  const comments = commentsQuery.data ?? [];

  const submitAdd = () => {
    const body = draft.trim();
    if (!body || addMutation.isPending) return;
    addMutation.mutate(body);
  };

  const beginEdit = (comment: MatterComment) => {
    setEditId(comment.id);
    setEditDraft(comment.body);
  };

  const submitEdit = () => {
    const body = editDraft.trim();
    if (!editId || !body || updateMutation.isPending) return;
    updateMutation.mutate({ id: editId, body });
  };

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-primary" aria-hidden />
          {t.title}
        </span>
      }
      description={t.description}
    >
      <div className="space-y-4" dir={direction} lang={locale}>
        {canWrite ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              rows={3}
              placeholder={t.placeholder}
              aria-label={t.composerAria}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  submitAdd();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <AtSign className="h-3.5 w-3.5" aria-hidden />
                {t.mentionHint}
              </span>
              <Button size="sm" onClick={submitAdd} disabled={!draft.trim() || addMutation.isPending}>
                {addMutation.isPending ? t.adding : t.add}
              </Button>
            </div>
          </div>
        ) : null}

        {commentsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t.loading}</p>
        ) : commentsQuery.isError ? (
          <p className="text-sm text-destructive">{t.loadError}</p>
        ) : comments.length === 0 ? (
          <EmptyState icon={MessageSquareText} title={t.emptyTitle} description={t.emptyDescription} />
        ) : (
          <ul className="space-y-3">
            {comments.map((comment) => {
              const watchers = extractWatchers(comment.metadata);
              const isEditing = editId === comment.id;
              return (
                <li key={comment.id} className="rounded-lg border bg-card px-4 py-3">
                  <div className="flex items-start gap-3">
                    <UserAvatar user={nameToAvatarUser(comment.author_name)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {comment.author_name || t.unknownAuthor}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            <RelativeTime date={comment.created_at} />
                            {comment.updated_at !== comment.created_at ? (
                              <span className="ms-1">{t.editedSuffix}</span>
                            ) : null}
                          </p>
                        </div>
                        {canWrite && !isEditing ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => beginEdit(comment)}
                            >
                              <PencilLine className="h-3.5 w-3.5" aria-hidden />
                              <span className="sr-only">{t.edit}</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-destructive"
                              onClick={() => setDeleteTarget(comment)}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              <span className="sr-only">{t.delete}</span>
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          <Textarea
                            value={editDraft}
                            rows={3}
                            aria-label={t.editAria}
                            onChange={(event) => setEditDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                event.preventDefault();
                                submitEdit();
                              }
                              if (event.key === 'Escape') {
                                setEditId(null);
                                setEditDraft('');
                              }
                            }}
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              onClick={submitEdit}
                              disabled={!editDraft.trim() || updateMutation.isPending}
                            >
                              <Check className="me-1.5 h-3.5 w-3.5" aria-hidden />
                              {t.save}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditId(null);
                                setEditDraft('');
                              }}
                            >
                              <X className="me-1.5 h-3.5 w-3.5" aria-hidden />
                              {t.cancel}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 whitespace-pre-line break-words text-sm text-muted-foreground">
                          {renderMentionText(comment.body)}
                        </p>
                      )}

                      {!isEditing && comment.mentions.length > 0 ? (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{t.mentionsLabel}</span>
                          {comment.mentions.map((mention) => (
                            <Badge key={mention} variant="outline">
                              {formatMention(mention)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}

                      {!isEditing && watchers.length > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{t.watchersLabel}</span>
                          {watchers.map((watcher) => (
                            <Badge key={watcher} variant="secondary">
                              {formatMention(watcher)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canWrite ? (
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={t.deleteTitle}
          description={t.deleteDescription}
          confirmLabel={t.delete}
          variant="destructive"
          loading={deleteMutation.isPending}
          onConfirm={() => {
            if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
          }}
        />
      ) : null}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

function extractMentions(value: string): string[] {
  const matches = value.match(MENTION_PATTERN) ?? [];
  return Array.from(new Set(matches.map((mention) => mention.slice(1))));
}

/** Render the body with `@handle` tokens highlighted as primary-colored spans. */
function renderMentionText(value: string): ReactNode[] {
  return value.split(MENTION_PATTERN).map((part, index) => {
    if (MENTION_PATTERN.test(part)) {
      // Reset lastIndex — MENTION_PATTERN is a global regex reused via .test().
      MENTION_PATTERN.lastIndex = 0;
      return (
        <span key={`${part}-${index}`} className="font-medium text-primary">
          {part}
        </span>
      );
    }
    MENTION_PATTERN.lastIndex = 0;
    return part;
  });
}

/** Ensure a single leading @ for chip display regardless of stored form. */
function formatMention(value: string): string {
  return value.startsWith('@') ? value : `@${value}`;
}

/**
 * Pull a watcher handle list from comment metadata if the contract exposes one.
 * Accepts `metadata.watchers` (preferred) or `metadata.watcher_handles` as an
 * array of strings; otherwise returns []. The chip-list is omitted when empty.
 */
function extractWatchers(metadata: JsonObject | null | undefined): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const raw = (metadata as Record<string, unknown>).watchers ?? (metadata as Record<string, unknown>).watcher_handles;
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')),
  );
}

/**
 * Build a UserAvatar-shaped object from a server-derived author name (which is a
 * JWT email or display name). Splits on whitespace for initials; falls back to
 * the local part of an email.
 */
function nameToAvatarUser(authorName: string): { first_name: string; last_name: string; email?: string } | null {
  const name = (authorName ?? '').trim();
  if (!name) return null;
  if (name.includes('@')) {
    const local = name.split('@')[0] ?? name;
    const parts = local.split(/[._-]+/).filter(Boolean);
    return {
      first_name: parts[0] ?? local,
      last_name: parts[1] ?? '',
      email: name,
    };
  }
  const parts = name.split(/\s+/).filter(Boolean);
  return { first_name: parts[0] ?? name, last_name: parts.slice(1).join(' ') };
}

/* ------------------------------------------------------------------------- *
 * Self-contained bilingual labels (English + Modern Standard Arabic).
 * ------------------------------------------------------------------------- */

interface MatterCommentsLabels {
  title: string;
  description: string;
  placeholder: string;
  composerAria: string;
  mentionHint: string;
  add: string;
  adding: string;
  edit: string;
  editAria: string;
  save: string;
  cancel: string;
  delete: string;
  loading: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  mentionsLabel: string;
  watchersLabel: string;
  editedSuffix: string;
  unknownAuthor: string;
  deleteTitle: string;
  deleteDescription: string;
  toastAdded: string;
  toastUpdated: string;
  toastDeleted: string;
}

const matterCommentsLabels: LexBilingual<MatterCommentsLabels> = {
  en: {
    title: 'Collaboration notes',
    description: 'Internal @mention-aware notes on this matter. Visible to the legal team.',
    placeholder: 'Add a note… use @name to mention a colleague.',
    composerAria: 'New matter note',
    mentionHint: 'Type @ to mention',
    add: 'Add note',
    adding: 'Adding…',
    edit: 'Edit note',
    editAria: 'Edit matter note',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete note',
    loading: 'Loading notes…',
    loadError: 'Failed to load collaboration notes.',
    emptyTitle: 'No notes yet',
    emptyDescription: 'Start the conversation — notes and @mentions appear here.',
    mentionsLabel: 'Mentions',
    watchersLabel: 'Watchers',
    editedSuffix: '(edited)',
    unknownAuthor: 'Unknown author',
    deleteTitle: 'Delete note',
    deleteDescription: 'This note will be removed for everyone. This action cannot be undone.',
    toastAdded: 'Note added.',
    toastUpdated: 'Note updated.',
    toastDeleted: 'Note deleted.',
  },
  ar: {
    title: 'ملاحظات التعاون',
    description: 'ملاحظات داخلية تدعم الإشارة عبر @ على هذه القضية. مرئية لفريق الشؤون القانونية.',
    placeholder: 'أضف ملاحظة… استخدم @الاسم للإشارة إلى زميل.',
    composerAria: 'ملاحظة جديدة على القضية',
    mentionHint: 'اكتب @ للإشارة',
    add: 'إضافة ملاحظة',
    adding: 'جارٍ الإضافة…',
    edit: 'تعديل الملاحظة',
    editAria: 'تعديل ملاحظة القضية',
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف الملاحظة',
    loading: 'جارٍ تحميل الملاحظات…',
    loadError: 'تعذّر تحميل ملاحظات التعاون.',
    emptyTitle: 'لا توجد ملاحظات بعد',
    emptyDescription: 'ابدأ النقاش — تظهر الملاحظات والإشارات عبر @ هنا.',
    mentionsLabel: 'الإشارات',
    watchersLabel: 'المتابعون',
    editedSuffix: '(مُعدّلة)',
    unknownAuthor: 'كاتب غير معروف',
    deleteTitle: 'حذف الملاحظة',
    deleteDescription: 'ستُحذف هذه الملاحظة للجميع. لا يمكن التراجع عن هذا الإجراء.',
    toastAdded: 'تمت إضافة الملاحظة.',
    toastUpdated: 'تم تحديث الملاحظة.',
    toastDeleted: 'تم حذف الملاحظة.',
  },
};
