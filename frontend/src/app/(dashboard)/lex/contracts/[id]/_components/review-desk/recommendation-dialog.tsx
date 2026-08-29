'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocale } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  type ContractRecommendationOutcome,
  recordRecommendation,
  reviewDeskQueryKey,
} from './use-final-version';

interface RecommendationDialogProps {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Local bilingual copy keyed off the active locale, so the dialog composes without
// editing the shared contracts-labels file.
function useRecommendationLabels() {
  const { locale } = useLocale();
  const ar = locale === 'ar';
  return {
    title: ar ? 'تسجيل توصية المراجعة' : 'Record review recommendation',
    description: ar
      ? 'يسجل توصية مكتب المراجعة النهائية على العقد. توصية "معتمد" تبدأ اعتماد مدير العقود وتفتح رفع النسخة النهائية.'
      : 'Records the review desk’s final recommendation on the contract. An "approved" outcome starts the Contracts-Manager approval and unlocks the final-version upload.',
    outcome: ar ? 'النتيجة' : 'Outcome',
    outcomeApproved: ar ? 'معتمد' : 'Approved',
    outcomeNeedsAmendment: ar ? 'يحتاج تعديلاً' : 'Needs amendment',
    outcomeRejected: ar ? 'مرفوض' : 'Rejected',
    summary: ar ? 'ملخص التوصية' : 'Recommendation summary',
    summaryPlaceholder: ar
      ? 'اذكر أساس التوصية…'
      : 'Explain the basis for the recommendation…',
    amendmentReason: ar ? 'سبب التعديل' : 'Amendment reason',
    amendmentPlaceholder: ar
      ? 'ما الذي يجب تعديله قبل الاعتماد؟'
      : 'What must be amended before approval?',
    rejectionReason: ar ? 'سبب الرفض' : 'Rejection reason',
    rejectionPlaceholder: ar ? 'سبب رفض العقد…' : 'Why the contract is rejected…',
    approvedNote: ar
      ? 'سيتم بدء سير اعتماد مدير العقود تلقائياً.'
      : 'The Contracts-Manager approval workflow will be started automatically.',
    cancel: ar ? 'إلغاء' : 'Cancel',
    submit: ar ? 'تسجيل التوصية' : 'Record recommendation',
    saving: ar ? 'جارٍ الحفظ…' : 'Saving…',
    successTitle: ar ? 'تم تسجيل التوصية' : 'Recommendation recorded',
    successBody: ar
      ? 'تم تسجيل توصية المراجعة النهائية.'
      : 'The final review recommendation was recorded.',
    required: ar ? 'مطلوب' : 'required',
  };
}

const OUTCOMES: ContractRecommendationOutcome[] = [
  'approved',
  'needs_amendment',
  'rejected',
];

export function RecommendationDialog({
  contractId,
  open,
  onOpenChange,
}: RecommendationDialogProps) {
  const queryClient = useQueryClient();
  const t = useRecommendationLabels();

  const [outcome, setOutcome] = useState<ContractRecommendationOutcome>('approved');
  const [summary, setSummary] = useState('');
  const [amendmentReason, setAmendmentReason] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  function reset() {
    setOutcome('approved');
    setSummary('');
    setAmendmentReason('');
    setRejectionReason('');
  }

  const outcomeLabel: Record<ContractRecommendationOutcome, string> = {
    approved: t.outcomeApproved,
    needs_amendment: t.outcomeNeedsAmendment,
    rejected: t.outcomeRejected,
  };

  const mutation = useMutation({
    mutationFn: () =>
      recordRecommendation(contractId, {
        outcome,
        summary: summary.trim(),
        // An approved recommendation MUST start the Contracts-Manager approval
        // workflow (backend rejects approved + start_approval=false).
        start_approval: outcome === 'approved',
        amendment_reason:
          outcome === 'needs_amendment' ? amendmentReason.trim() : undefined,
        rejection_reason:
          outcome === 'rejected' ? rejectionReason.trim() : undefined,
      }),
    onSuccess: async () => {
      showSuccess(t.successTitle, t.successBody);
      // Invalidate the review-desk overview so useReviewDeskRecommendation
      // refetches; an approved outcome flips isApproved true and unlocks the
      // final-version upload.
      await queryClient.invalidateQueries({
        queryKey: reviewDeskQueryKey(contractId),
      });
      reset();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const canSubmit =
    summary.trim().length > 0 &&
    (outcome !== 'needs_amendment' || amendmentReason.trim().length > 0) &&
    (outcome !== 'rejected' || rejectionReason.trim().length > 0) &&
    !mutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) reset();
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recommendation-outcome">{t.outcome}</Label>
            <Select
              value={outcome}
              onValueChange={(value) =>
                setOutcome(value as ContractRecommendationOutcome)
              }
            >
              <SelectTrigger id="recommendation-outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTCOMES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {outcomeLabel[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recommendation-summary">
              {t.summary} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="recommendation-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={t.summaryPlaceholder}
              rows={3}
            />
          </div>

          {outcome === 'needs_amendment' ? (
            <div className="space-y-1.5">
              <Label htmlFor="recommendation-amendment">
                {t.amendmentReason} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="recommendation-amendment"
                value={amendmentReason}
                onChange={(e) => setAmendmentReason(e.target.value)}
                placeholder={t.amendmentPlaceholder}
                rows={3}
              />
            </div>
          ) : null}

          {outcome === 'rejected' ? (
            <div className="space-y-1.5">
              <Label htmlFor="recommendation-rejection">
                {t.rejectionReason} <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="recommendation-rejection"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder={t.rejectionPlaceholder}
                rows={3}
              />
            </div>
          ) : null}

          {outcome === 'approved' ? (
            <p className="text-xs text-muted-foreground">{t.approvedNote}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
            ) : null}
            {mutation.isPending ? t.saving : t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
