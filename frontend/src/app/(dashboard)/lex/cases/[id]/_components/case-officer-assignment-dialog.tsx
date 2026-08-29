'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { OrgEntityUserPicker } from '@/components/shared/forms/org-entity-user-picker';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
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
import { casesApi, type LegalCase } from '@/lib/lex/cases';
import { showApiError, showSuccess } from '@/lib/toast';

const COPY = {
  en: {
    title: 'Assign responsible lawyer',
    description: 'Choose an active employee from the case’s organisational unit.',
    legacyDescription: 'This older case has no organisational unit. Choose an active user from the tenant directory.',
    lawyer: 'Responsible lawyer',
    select: 'Select a lawyer',
    search: 'Search by name or email…',
    loading: 'Loading eligible lawyers…',
    empty: 'No active employees match this organisational unit.',
    loadError: 'Eligible employees could not be loaded.',
    retry: 'Retry',
    reason: 'Assignment note (optional)',
    reasonPlaceholder: 'Why is this lawyer being assigned?',
    cancel: 'Cancel',
    submit: 'Assign lawyer',
    success: 'Responsible lawyer assigned',
  },
  ar: {
    title: 'تعيين المحامي المسؤول',
    description: 'اختر موظفاً نشطاً من الوحدة التنظيمية المرتبطة بالقضية.',
    legacyDescription: 'لا ترتبط هذه القضية القديمة بوحدة تنظيمية. اختر مستخدماً نشطاً من دليل المنشأة.',
    lawyer: 'المحامي المسؤول',
    select: 'اختر محامياً',
    search: 'ابحث بالاسم أو البريد الإلكتروني…',
    loading: 'جارٍ تحميل المحامين المؤهلين…',
    empty: 'لا يوجد موظفون نشطون مطابقون في هذه الوحدة التنظيمية.',
    loadError: 'تعذّر تحميل الموظفين المؤهلين.',
    retry: 'إعادة المحاولة',
    reason: 'ملاحظة التعيين (اختياري)',
    reasonPlaceholder: 'لماذا يتم تعيين هذا المحامي؟',
    cancel: 'إلغاء',
    submit: 'تعيين المحامي',
    success: 'تم تعيين المحامي المسؤول',
  },
} as const;

function beneficiaryEntityId(legalCase: LegalCase): string | undefined {
  const value = legalCase.metadata?.beneficiary_entity_id;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function CaseOfficerAssignmentDialog({
  legalCase,
  open,
  onOpenChange,
  onSaved,
}: {
  legalCase: LegalCase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { locale } = useLocaleOrDefault();
  const t = COPY[locale === 'ar' ? 'ar' : 'en'];
  const entityId = useMemo(() => beneficiaryEntityId(legalCase), [legalCase]);
  const [officerId, setOfficerId] = useState(legalCase.handling_officer_id ?? '');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setOfficerId(legalCase.handling_officer_id ?? '');
    setReason('');
  }, [legalCase.handling_officer_id, open]);

  const mutation = useMutation({
    mutationFn: () =>
      casesApi.assignOfficer(legalCase.id, {
        handling_officer_id: officerId,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      showSuccess(t.success);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{entityId ? t.description : t.legacyDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="case-handling-officer">{t.lawyer}</Label>
            <OrgEntityUserPicker
              id="case-handling-officer"
              ariaLabel={t.lawyer}
              entityId={entityId}
              value={officerId}
              onChange={setOfficerId}
              selectedLabel={legalCase.responsible_lawyer ?? undefined}
              required
              disabled={mutation.isPending}
              labels={{
                select: t.select,
                search: t.search,
                loading: t.loading,
                empty: t.empty,
                loadError: t.loadError,
                retry: t.retry,
              }}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="case-officer-reason">{t.reason}</Label>
            <Textarea
              id="case-officer-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t.reasonPlaceholder}
              disabled={mutation.isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={!officerId || officerId === legalCase.handling_officer_id}
            onClick={() => mutation.mutate()}
          >
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
