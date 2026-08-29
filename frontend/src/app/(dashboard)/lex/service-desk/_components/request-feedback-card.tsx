'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageSquareText, Star } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { lexRequestsApi, type RequestStatus } from '@/lib/lex/requests';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

const copy = {
  en: {
    title: 'Requester satisfaction',
    description: 'A verified response submitted after service delivery.',
    prompt: 'How satisfied are you with the legal service?',
    comment: 'Optional comment',
    placeholder: 'Share concise feedback about the outcome or service experience…',
    submit: 'Submit feedback',
    submitting: 'Submitting…',
    success: 'Your feedback was recorded.',
    submitted: 'Feedback submitted',
    responsesLocked: 'Submitted feedback is retained as an audit-grade response and cannot be edited.',
    awaiting: 'Awaiting feedback from the request owner.',
    afterDelivery: 'Feedback becomes available to the request owner after delivery.',
    retry: 'Retry',
    loadError: 'Feedback could not be loaded.',
    ratingLabel: (value: number) => `${value} of 5 stars`,
  },
  ar: {
    title: 'رضا مقدم الطلب',
    description: 'استجابة موثقة تُقدّم بعد تسليم الخدمة.',
    prompt: 'ما مدى رضاك عن الخدمة القانونية؟',
    comment: 'تعليق اختياري',
    placeholder: 'شارك ملاحظات موجزة حول النتيجة أو تجربة الخدمة…',
    submit: 'إرسال التقييم',
    submitting: 'جارٍ الإرسال…',
    success: 'تم تسجيل تقييمك.',
    submitted: 'تم إرسال التقييم',
    responsesLocked: 'يُحفظ التقييم كسجل تدقيق ولا يمكن تعديله بعد الإرسال.',
    awaiting: 'بانتظار تقييم مالك الطلب.',
    afterDelivery: 'يتاح التقييم لمالك الطلب بعد التسليم.',
    retry: 'إعادة المحاولة',
    loadError: 'تعذر تحميل التقييم.',
    ratingLabel: (value: number) => `${value} من 5 نجوم`,
  },
};

export function RequestFeedbackCard({
  requestId,
  requesterUserId,
  status,
}: {
  requestId: string;
  requesterUserId: string;
  status: RequestStatus;
}) {
  const { locale } = useLocale();
  const { user } = useAuth();
  const f = useLexFormat();
  const qc = useQueryClient();
  const t = locale === 'ar' ? copy.ar : copy.en;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const feedbackQuery = useQuery({
    queryKey: ['lex-request-feedback', requestId],
    queryFn: () => lexRequestsApi.getRequestFeedback(requestId),
    enabled: Boolean(requestId),
    retry: false,
  });
  const canSubmit = useMemo(
    () =>
      user?.id === requesterUserId &&
      (status === 'delivered' || status === 'closed') &&
      !feedbackQuery.data,
    [feedbackQuery.data, requesterUserId, status, user?.id],
  );
  const mutation = useMutation({
    mutationFn: () => lexRequestsApi.submitRequestFeedback(requestId, { rating, comment }),
    onSuccess: async () => {
      showSuccess(t.success);
      await qc.invalidateQueries({ queryKey: ['lex-request-feedback', requestId] });
      await qc.invalidateQueries({ queryKey: ['lex-detailed-analytics'] });
    },
    onError: showApiError,
  });

  return (
    <SectionCard title={t.title} description={t.description}>
      {feedbackQuery.isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" aria-hidden />
      ) : feedbackQuery.isError ? (
        <div className="space-y-3 text-sm text-destructive">
          <p>{t.loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void feedbackQuery.refetch()}>
            {t.retry}
          </Button>
        </div>
      ) : feedbackQuery.data ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1" aria-label={t.ratingLabel(feedbackQuery.data.rating)}>
              {Array.from({ length: 5 }, (_, index) => (
                <Star
                  key={index}
                  className={cn(
                    'h-4 w-4',
                    index < feedbackQuery.data!.rating
                      ? 'fill-warning-500 text-warning-500'
                      : 'text-muted-foreground/40',
                  )}
                  aria-hidden
                />
              ))}
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success-700 dark:text-success-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t.submitted}
            </span>
          </div>
          {feedbackQuery.data.comment ? (
            <p className="whitespace-pre-wrap rounded-xl bg-muted/60 p-3 text-sm text-foreground" dir="auto">
              {feedbackQuery.data.comment}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {f.formatDate(feedbackQuery.data.submitted_at, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t.responsesLocked}</p>
        </div>
      ) : canSubmit ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (rating > 0) mutation.mutate();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{t.prompt}</legend>
            <div className="flex gap-1" role="radiogroup">
              {Array.from({ length: 5 }, (_, index) => {
                const value = index + 1;
                return (
                  <Button
                    key={value}
                    type="button"
                    variant="ghost"
                    size="icon"
                    role="radio"
                    aria-checked={rating === value}
                    aria-label={t.ratingLabel(value)}
                    onClick={() => setRating(value)}
                    className="h-auto w-auto rounded-lg p-1.5"
                  >
                    <Star
                      className={cn(
                        'h-6 w-6 transition-colors',
                        value <= rating
                          ? 'fill-warning-500 text-warning-500'
                          : 'text-muted-foreground/40 hover:text-warning-500',
                      )}
                    />
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <label htmlFor="request-feedback-comment" className="text-sm font-medium text-foreground">
              {t.comment}
            </label>
            <Textarea
              id="request-feedback-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value.slice(0, 2000))}
              placeholder={t.placeholder}
              rows={3}
            />
            <p className="text-end text-[11px] text-muted-foreground tabular-nums">{comment.length}/2000</p>
          </div>
          <Button type="submit" size="sm" disabled={rating === 0 || mutation.isPending}>
            <MessageSquareText className="me-1.5 h-3.5 w-3.5" />
            {mutation.isPending ? t.submitting : t.submit}
          </Button>
        </form>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {status === 'delivered' || status === 'closed' ? t.awaiting : t.afterDelivery}
        </p>
      )}
    </SectionCard>
  );
}
