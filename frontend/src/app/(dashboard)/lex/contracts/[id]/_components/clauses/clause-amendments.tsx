'use client';

/**
 * CAP-111 — Propose clause amendments.
 *
 * Mounted by the CAP-107 clause review panel beside the clause-comments thread.
 * Two surfaces over the clause-amendments backend:
 *   1. A PROPOSE form: the reviewer types a revised clause text (+ optional
 *      reason); a live REDLINE (current clause text → proposed text) renders via
 *      the shared <RedlineView/> (lib/lex/redline) so the change reads as
 *      track-changes before it is submitted.
 *   2. A DECISION list: each proposed amendment shows its redline + reason with
 *      Accept / Reject actions; decided amendments show a status chip. Accepted
 *      amendments are what the review-desk recommendation (CAP-118) reads back.
 *
 * `proposed_by` / decision stamps are derived server-side from the JWT — the
 * client sends only `{ proposed_text, original_text, reason }` /
 * `{ status }`. Bilingual (EN/MSA) + RTL-safe via the lex i18n contract; reads
 * the clause's current text from the clause-list cache to baseline the redline.
 */

import { useMemo, useState } from 'react';
import { Check, FileDiff, GitPullRequestArrow, X } from 'lucide-react';
import { RedlineView } from '@/components/shared/redline-view';
import { EmptyState } from '@/components/common/empty-state';
import { RelativeTime } from '@/components/shared/relative-time';
import { LexStatusChip } from '@/components/lex/status-chip';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LexClause } from '@/types/suites';
import { resolveLexBilingual, type LexBilingual } from '../../../../_lib/lex-i18n';
import { clausesQueryKey } from './use-clauses';
import {
  useClauseAmendments,
  useDecideClauseAmendment,
  useProposeClauseAmendment,
  type LexClauseAmendment,
} from './use-clause-amendments';
import { useQueryClient } from '@tanstack/react-query';

interface ClauseAmendmentsProps {
  contractId: string;
  clauseId: string;
}

export function ClauseAmendments({ contractId, clauseId }: ClauseAmendmentsProps) {
  const { locale, direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  // §9 — clause amendments are contract edits.
  const canWrite = hasPermission('lex:contract:edit');
  const t = useMemo(() => resolveLexBilingual(amendmentLabels, locale), [locale]);
  const queryClient = useQueryClient();

  // Baseline the redline against the clause's current text from the list cache
  // (CAP-107 populates it). Falls back to empty so the diff still renders.
  const currentText = useMemo(() => {
    const clauses = queryClient.getQueryData<LexClause[]>(clausesQueryKey(contractId));
    return clauses?.find((c) => c.id === clauseId)?.content ?? '';
  }, [queryClient, contractId, clauseId]);

  const [proposedText, setProposedText] = useState('');
  const [reason, setReason] = useState('');

  const amendmentsQuery = useClauseAmendments(contractId, clauseId);
  const proposeMutation = useProposeClauseAmendment(contractId, clauseId);
  const decideMutation = useDecideClauseAmendment(contractId, clauseId);

  const trimmedProposed = proposedText.trim();
  const canSubmit = canWrite && trimmedProposed.length > 0 && !proposeMutation.isPending;

  const submit = () => {
    if (!canSubmit) return;
    proposeMutation.mutate(
      {
        proposed_text: trimmedProposed,
        original_text: currentText,
        reason: reason.trim() || undefined,
      },
      {
        onSuccess: () => {
          setProposedText('');
          setReason('');
          showSuccess(t.toastProposed);
        },
        onError: showApiError,
      },
    );
  };

  const decide = (
    amendmentId: string,
    status: 'accepted' | 'rejected',
  ) => {
    if (!canWrite || decideMutation.isPending) return;
    decideMutation.mutate(
      { amendmentId, status },
      {
        onSuccess: () =>
          showSuccess(status === 'accepted' ? t.toastAccepted : t.toastRejected),
        onError: showApiError,
      },
    );
  };

  const amendments = amendmentsQuery.data ?? [];

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <GitPullRequestArrow className="h-4 w-4 shrink-0" aria-hidden />
          {t.title}
        </span>
      }
      description={t.subtitle}
    >
      <div className="space-y-5" dir={direction} lang={locale}>
        {/* Propose form. */}
        {canWrite ? (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="amendment-proposed-text">
                {t.proposedTextLabel}
              </label>
              <Textarea
                id="amendment-proposed-text"
                value={proposedText}
                rows={4}
                placeholder={t.proposedTextPlaceholder}
                aria-label={t.proposedTextLabel}
                onChange={(event) => setProposedText(event.target.value)}
              />
            </div>

            {/* Live redline preview of current vs proposed text. */}
            {trimmedProposed.length > 0 ? (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <FileDiff className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t.redlinePreview}
                </p>
                <div className="rounded-md border bg-background p-3 text-sm">
                  <RedlineView
                    original={currentText}
                    revised={trimmedProposed}
                    mode="inline"
                    originalLabel={t.currentLabel}
                    revisedLabel={t.proposedLabel}
                    dir={direction}
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="amendment-reason">
                {t.reasonLabel}
              </label>
              <Textarea
                id="amendment-reason"
                value={reason}
                rows={2}
                placeholder={t.reasonPlaceholder}
                aria-label={t.reasonLabel}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            <div className="flex items-center justify-end">
              <Button size="sm" onClick={submit} disabled={!canSubmit}>
                {proposeMutation.isPending ? t.proposing : t.propose}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Decision list. */}
        {amendmentsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t.loading}</p>
        ) : amendments.length === 0 ? (
          <EmptyState
            icon={GitPullRequestArrow}
            title={t.emptyTitle}
            description={t.emptyDescription}
          />
        ) : (
          <ul className="space-y-3">
            {amendments.map((amendment) => (
              <AmendmentRow
                key={amendment.id}
                amendment={amendment}
                labels={t}
                canWrite={canWrite}
                pending={decideMutation.isPending}
                onDecide={decide}
              />
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

interface AmendmentRowProps {
  amendment: LexClauseAmendment;
  labels: AmendmentLabels;
  canWrite: boolean;
  pending: boolean;
  onDecide: (amendmentId: string, status: 'accepted' | 'rejected') => void;
}

function AmendmentRow({ amendment, labels: t, canWrite, pending, onDecide }: AmendmentRowProps) {
  const { direction } = useLocaleOrDefault();
  const isProposed = amendment.status === 'proposed';

  return (
    <li className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LexStatusChip domain="generic" value={amendment.status} size="sm" />
        <span className="text-xs text-muted-foreground">
          <RelativeTime date={amendment.created_at} />
        </span>
      </div>

      <div className="rounded-md border bg-background p-3 text-sm">
        <RedlineView
          original={amendment.original_text}
          revised={amendment.proposed_text}
          mode="inline"
          originalLabel={t.currentLabel}
          revisedLabel={t.proposedLabel}
          dir={direction}
        />
      </div>

      {amendment.reason ? (
        <p className="text-sm">
          <span className="font-medium">{t.reasonLabel}: </span>
          <span className="text-muted-foreground">{amendment.reason}</span>
        </p>
      ) : null}

      {isProposed && canWrite ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onDecide(amendment.id, 'rejected')}
          >
            <X className="me-1 h-3.5 w-3.5" aria-hidden />
            {t.reject}
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => onDecide(amendment.id, 'accepted')}
          >
            <Check className="me-1 h-3.5 w-3.5" aria-hidden />
            {t.accept}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------------- *
 * Self-contained bilingual labels (English + Modern Standard Arabic).
 * ------------------------------------------------------------------------- */

interface AmendmentLabels {
  title: string;
  subtitle: string;
  proposedTextLabel: string;
  proposedTextPlaceholder: string;
  redlinePreview: string;
  currentLabel: string;
  proposedLabel: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  propose: string;
  proposing: string;
  loading: string;
  emptyTitle: string;
  emptyDescription: string;
  accept: string;
  reject: string;
  toastProposed: string;
  toastAccepted: string;
  toastRejected: string;
}

const amendmentLabels: LexBilingual<AmendmentLabels> = {
  en: {
    title: 'Proposed amendments',
    subtitle: 'Propose a redlined revision of this clause for review.',
    proposedTextLabel: 'Proposed clause text',
    proposedTextPlaceholder: 'Type the revised clause text…',
    redlinePreview: 'Redline preview (current → proposed)',
    currentLabel: 'Current',
    proposedLabel: 'Proposed',
    reasonLabel: 'Reason',
    reasonPlaceholder: 'Why is this change needed? (optional)',
    propose: 'Propose amendment',
    proposing: 'Proposing…',
    loading: 'Loading amendments…',
    emptyTitle: 'No amendments proposed',
    emptyDescription: 'Proposed redlines for this clause will appear here.',
    accept: 'Accept',
    reject: 'Reject',
    toastProposed: 'Amendment proposed.',
    toastAccepted: 'Amendment accepted.',
    toastRejected: 'Amendment rejected.',
  },
  ar: {
    title: 'التعديلات المقترحة',
    subtitle: 'اقترح مراجعة مُعلَّمة (تتبع التغييرات) لهذا البند.',
    proposedTextLabel: 'نص البند المقترح',
    proposedTextPlaceholder: 'اكتب نص البند المُنقَّح…',
    redlinePreview: 'معاينة التغييرات (الحالي ← المقترح)',
    currentLabel: 'الحالي',
    proposedLabel: 'المقترح',
    reasonLabel: 'السبب',
    reasonPlaceholder: 'لماذا هذا التغيير مطلوب؟ (اختياري)',
    propose: 'اقتراح تعديل',
    proposing: 'جارٍ الاقتراح…',
    loading: 'جارٍ تحميل التعديلات…',
    emptyTitle: 'لا توجد تعديلات مقترحة',
    emptyDescription: 'ستظهر هنا التعديلات المُعلَّمة المقترحة لهذا البند.',
    accept: 'قبول',
    reject: 'رفض',
    toastProposed: 'تم اقتراح التعديل.',
    toastAccepted: 'تم قبول التعديل.',
    toastRejected: 'تم رفض التعديل.',
  },
};
