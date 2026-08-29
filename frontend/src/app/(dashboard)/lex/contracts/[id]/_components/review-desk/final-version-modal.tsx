'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useLocale } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import {
  prefillExtractedTextFromFile,
  resolveUploadExtractedText,
} from '@/lib/documents/word';
import { showApiError, showSuccess } from '@/lib/toast';
import { RecommendationDialog } from './recommendation-dialog';
import {
  reviewDeskQueryKey,
  uploadFinalVersion,
  useReviewDeskRecommendation,
} from './use-final-version';

interface FinalVersionModalProps {
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Local bilingual copy keyed off the active locale, so the modal composes without
// editing the shared contracts-labels file.
function useFinalVersionLabels() {
  const { locale } = useLocale();
  const ar = locale === 'ar';
  return {
    title: ar ? 'رفع النسخة النهائية' : 'Upload final version',
    description: ar
      ? 'يرفع النسخة النهائية المعتمدة من العقد وينقله إلى الحالة "نشط".'
      : 'Uploads the approved final contract version and activates the contract.',
    lockedTitle: ar ? 'بانتظار توصية معتمدة' : 'Awaiting an approved recommendation',
    lockedBody: ar
      ? 'يُفتح رفع النسخة النهائية فقط بعد تسجيل توصية مكتب المراجعة بنتيجة "معتمد".'
      : 'The final-version upload unlocks only after the review desk records an "approved" recommendation.',
    recordRecommendation: ar ? 'تسجيل توصية' : 'Record recommendation',
    approvedBadge: ar ? 'التوصية: معتمدة' : 'Recommendation: approved',
    file: ar ? 'ملف النسخة النهائية' : 'Final version file',
    changeSummary: ar ? 'ملخص التغيير' : 'Change summary',
    changeSummaryPlaceholder: ar ? 'اختياري' : 'Optional',
    selectedPrefix: (name: string) => (ar ? `محدد: ${name}` : `Selected: ${name}`),
    cancel: ar ? 'إلغاء' : 'Cancel',
    submit: ar ? 'رفع وتفعيل' : 'Upload & activate',
    confirmTitle: ar ? 'تأكيد النسخة النهائية' : 'Confirm final version',
    confirmBody: ar
      ? 'سيتم تعيين هذه النسخة كالنسخة الحالية، وتجاوز النسخ السابقة، وتفعيل العقد. هل تريد المتابعة؟'
      : 'This becomes the current version, supersedes prior versions, and activates the contract. Continue?',
    confirmLabel: ar ? 'تأكيد' : 'Confirm',
    successTitle: ar ? 'تم رفع النسخة النهائية' : 'Final version uploaded',
    successBody: ar
      ? 'تم تعيين النسخة النهائية وتفعيل العقد.'
      : 'The final version was recorded and the contract is now active.',
    uploading: ar ? 'جارٍ الرفع…' : 'Uploading…',
  };
}

export function FinalVersionModal({ contractId, open, onOpenChange }: FinalVersionModalProps) {
  const queryClient = useQueryClient();
  const t = useFinalVersionLabels();
  const { hasAnyPermission } = useAuth();
  const { isApproved } = useReviewDeskRecommendation(contractId);
  // Mirrors the backend approval-write tier gating the recommendation route
  // (RequireAnyPermission(lex:approval:write, lex:write)).
  const canRecordRecommendation = hasAnyPermission(['lex:approval:write', 'lex:write']);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recommendationOpen, setRecommendationOpen] = useState(false);

  function reset() {
    setSelectedFile(null);
    setExtractedText('');
    setChangeSummary('');
    setConfirmOpen(false);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('No file selected');
      const resolvedText = await resolveUploadExtractedText(selectedFile, extractedText);
      const uploaded = await enterpriseApi.files.upload(selectedFile, {
        suite: 'lex',
        entity_type: 'contract_final_version',
        entity_id: contractId,
        tags: ['contract', 'final'].join(','),
        lifecycle_policy: 'standard',
      });
      return uploadFinalVersion(contractId, {
        file_id: uploaded.id,
        file_name: uploaded.original_name,
        file_size_bytes: uploaded.size_bytes,
        content_hash: uploaded.checksum_sha256,
        extracted_text: resolvedText,
        change_summary: changeSummary.trim(),
      });
    },
    onSuccess: async () => {
      showSuccess(t.successTitle, t.successBody);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewDeskQueryKey(contractId) }),
        queryClient.invalidateQueries({ queryKey: ['lex-contract', contractId] }),
        queryClient.invalidateQueries({ queryKey: ['lex-contract-versions', contractId] }),
        queryClient.invalidateQueries({ queryKey: ['lex-contract-timeline', contractId] }),
        queryClient.invalidateQueries({ queryKey: ['lex-contracts'] }),
      ]);
      reset();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  return (
    <>
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

          {!isApproved ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-muted-foreground/25 bg-muted/40 p-4 text-sm"
              role="status"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="space-y-2">
                <p className="font-medium">{t.lockedTitle}</p>
                <p className="text-muted-foreground">{t.lockedBody}</p>
                {canRecordRecommendation ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRecommendationOpen(true)}
                  >
                    {t.recordRecommendation}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                {t.approvedBadge}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="final-version-file">
                  {t.file} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="final-version-file"
                  type="file"
                  accept=".pdf,.docx,.txt,.xlsx,.pptx"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setSelectedFile(file);
                    void prefillExtractedTextFromFile(file, setExtractedText);
                  }}
                />
                {selectedFile ? (
                  <p className="text-xs text-muted-foreground">{t.selectedPrefix(selectedFile.name)}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="final-version-summary">{t.changeSummary}</Label>
                <Input
                  id="final-version-summary"
                  value={changeSummary}
                  onChange={(e) => setChangeSummary(e.target.value)}
                  placeholder={t.changeSummaryPlaceholder}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              disabled={!isApproved || !selectedFile || mutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {mutation.isPending ? t.uploading : t.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t.confirmTitle}
        description={t.confirmBody}
        confirmLabel={t.confirmLabel}
        cancelLabel={t.cancel}
        loading={mutation.isPending}
        onConfirm={async () => {
          await mutation.mutateAsync();
        }}
      />

      <RecommendationDialog
        contractId={contractId}
        open={recommendationOpen}
        onOpenChange={setRecommendationOpen}
      />
    </>
  );
}
