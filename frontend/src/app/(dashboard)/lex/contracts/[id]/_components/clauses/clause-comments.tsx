'use client';

/**
 * CAP-110 — Legal comments on a contract clause.
 *
 * Thin binding layer: resolves bilingual (English + MSA) labels against the
 * active locale, builds a `CommentsAdapter` over the clause-comment fe-client
 * (`clauseCommentsApi`), and renders the generic, suite-agnostic
 * `CommentsThread` (`components/lex/comments-thread.tsx`). Mounted inside the
 * CAP-107 clause review panel.
 *
 * Cross-cap FE contract: exports `ClauseComments({ contractId, clauseId })`.
 */

import { useMemo } from 'react';
import {
  CommentsThread,
  type CommentsAdapter,
  type CommentsThreadLabels,
} from '@/components/lex/comments-thread';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import {
  clauseCommentsApi,
  type ClauseComment,
} from './clause-comments-api';
import { resolveLexBilingual, type LexBilingual } from '../../../../_lib/lex-i18n';

interface ClauseCommentsProps {
  contractId: string;
  clauseId: string;
}

export function ClauseComments({ contractId, clauseId }: ClauseCommentsProps) {
  const { locale, direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  // §9 — clause comments are contract edits.
  const canWrite = hasPermission('lex:contract:edit');

  const t = useMemo(() => resolveLexBilingual(clauseCommentsLabels, locale), [locale]);

  const enabled = Boolean(contractId) && Boolean(clauseId);

  const adapter = useMemo<CommentsAdapter<ClauseComment>>(
    () => ({
      list: () => clauseCommentsApi.list(contractId, clauseId),
      add: (payload) => clauseCommentsApi.add(contractId, clauseId, payload),
      update: (id, payload) => clauseCommentsApi.update(contractId, clauseId, id, payload),
      remove: (id) => clauseCommentsApi.remove(contractId, clauseId, id),
    }),
    [contractId, clauseId],
  );

  return (
    <CommentsThread
      queryKey={['lex-clause-comments', contractId, clauseId]}
      adapter={adapter}
      labels={t}
      canWrite={canWrite}
      direction={direction}
      locale={locale}
      enabled={enabled}
    />
  );
}

/* ------------------------------------------------------------------------- *
 * Self-contained bilingual labels (English + Modern Standard Arabic).
 * ------------------------------------------------------------------------- */

const clauseCommentsLabels: LexBilingual<CommentsThreadLabels> = {
  en: {
    title: 'Clause comments',
    description: 'Internal @mention-aware notes on this clause. Visible to the legal review team.',
    placeholder: 'Add a comment… use @name to mention a colleague.',
    composerAria: 'New clause comment',
    mentionHint: 'Type @ to mention',
    add: 'Add comment',
    adding: 'Adding…',
    edit: 'Edit comment',
    editAria: 'Edit clause comment',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete comment',
    loading: 'Loading comments…',
    loadError: 'Failed to load clause comments.',
    emptyTitle: 'No comments yet',
    emptyDescription: 'Start the conversation — comments and @mentions appear here.',
    mentionsLabel: 'Mentions',
    watchersLabel: 'Watchers',
    editedSuffix: '(edited)',
    unknownAuthor: 'Unknown author',
    deleteTitle: 'Delete comment',
    deleteDescription: 'This comment will be removed for everyone. This action cannot be undone.',
    toastAdded: 'Comment added.',
    toastUpdated: 'Comment updated.',
    toastDeleted: 'Comment deleted.',
  },
  ar: {
    title: 'تعليقات البند',
    description: 'ملاحظات داخلية تدعم الإشارة عبر @ على هذا البند. مرئية لفريق المراجعة القانونية.',
    placeholder: 'أضف تعليقًا… استخدم @الاسم للإشارة إلى زميل.',
    composerAria: 'تعليق جديد على البند',
    mentionHint: 'اكتب @ للإشارة',
    add: 'إضافة تعليق',
    adding: 'جارٍ الإضافة…',
    edit: 'تعديل التعليق',
    editAria: 'تعديل تعليق البند',
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف التعليق',
    loading: 'جارٍ تحميل التعليقات…',
    loadError: 'تعذّر تحميل تعليقات البند.',
    emptyTitle: 'لا توجد تعليقات بعد',
    emptyDescription: 'ابدأ النقاش — تظهر التعليقات والإشارات عبر @ هنا.',
    mentionsLabel: 'الإشارات',
    watchersLabel: 'المتابعون',
    editedSuffix: '(مُعدّل)',
    unknownAuthor: 'كاتب غير معروف',
    deleteTitle: 'حذف التعليق',
    deleteDescription: 'سيُحذف هذا التعليق للجميع. لا يمكن التراجع عن هذا الإجراء.',
    toastAdded: 'تمت إضافة التعليق.',
    toastUpdated: 'تم تحديث التعليق.',
    toastDeleted: 'تم حذف التعليق.',
  },
};
