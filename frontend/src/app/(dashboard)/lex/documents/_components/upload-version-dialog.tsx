'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
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
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import {
  analyzeTextFromUpload,
  resolveUploadExtractedText,
  type UploadTextExtractionResult,
} from '@/lib/documents/word';
import {
  buildPdfProcessingPayload,
  isPdfFile,
  type PdfTextExtractionResult,
} from '@/lib/documents/pdf-text';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LexDocument } from '@/types/suites';
import { useDocumentsLabels } from '../_lib/documents-labels';
import {
  DocumentPdfProcessingStatus,
  type PdfProcessingDisplayStatus,
} from './document-pdf-processing-status';

interface UploadVersionDialogProps {
  document: LexDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadVersionDialog({ document, open, onOpenChange }: UploadVersionDialogProps) {
  const queryClient = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const labels = useDocumentsLabels();
  const t = labels.uploadVersion;
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pdfExtraction, setPdfExtraction] = useState<PdfTextExtractionResult | null>(null);
  const [pdfInspecting, setPdfInspecting] = useState(false);
  const [pdfInspectionFailed, setPdfInspectionFailed] = useState(false);
  const fileSelectionSequence = useRef(0);

  function reset() {
    fileSelectionSequence.current += 1;
    setSelectedFile(null);
    setExtractedText('');
    setChangeSummary('');
    setUploadProgress(0);
    setPdfExtraction(null);
    setPdfInspecting(false);
    setPdfInspectionFailed(false);
  }

  async function selectFile(file: File | null) {
    const sequence = fileSelectionSequence.current + 1;
    fileSelectionSequence.current = sequence;
    setSelectedFile(file);
    setExtractedText('');
    setPdfExtraction(null);
    setPdfInspecting(false);
    setPdfInspectionFailed(false);
    if (!file) return;

    const pdf = isPdfFile(file);
    if (pdf) setPdfInspecting(true);
    try {
      const result = await analyzeTextFromUpload(file);
      if (fileSelectionSequence.current !== sequence) return;
      if (result.text) setExtractedText(result.text);
      setPdfExtraction(result?.pdf ?? null);
    } catch {
      if (fileSelectionSequence.current !== sequence) return;
      if (pdf) setPdfInspectionFailed(true);
    } finally {
      if (fileSelectionSequence.current === sequence) setPdfInspecting(false);
    }
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!document || !selectedFile) {
        throw new Error(locale === 'ar' ? 'لم يُحدَّد ملف' : 'No file selected');
      }
      let uploadAnalysis: UploadTextExtractionResult | null = null;
      if (isPdfFile(selectedFile)) {
        uploadAnalysis = pdfExtraction
          ? { text: pdfExtraction.text, source: 'pdf_text_layer', pdf: pdfExtraction }
          : await analyzeTextFromUpload(selectedFile);
      }
      const resolvedExtractedText = await resolveUploadExtractedText(
        selectedFile,
        extractedText,
        uploadAnalysis,
      );
      if (resolvedExtractedText !== extractedText.trim()) {
        setExtractedText(resolvedExtractedText);
      }

      const uploaded = await enterpriseApi.files.upload(
        selectedFile,
        {
          suite: 'lex',
          entity_type: 'document_version',
          tags: ['document', document.type].join(','),
          lifecycle_policy: 'standard',
        },
        (progress) => setUploadProgress(progress),
      );

      return enterpriseApi.lex.uploadDocumentVersion(document.id, {
        file_id: uploaded.id,
        file_name: uploaded.original_name,
        file_size_bytes: uploaded.size_bytes,
        content_hash: uploaded.checksum_sha256,
        extracted_text: resolvedExtractedText,
        change_summary: changeSummary.trim(),
        processing: buildPdfProcessingPayload(
          selectedFile,
          uploadAnalysis?.pdf ?? pdfExtraction,
          resolvedExtractedText,
        ),
      });
    },
    onSuccess: async () => {
      showSuccess(labels.toasts.versionUploadedTitle, labels.toasts.versionUploadedDescription);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-documents'] }),
        document
          ? queryClient.invalidateQueries({ queryKey: ['lex-document', document.id] })
          : Promise.resolve(),
      ]);
      onOpenChange(false);
      reset();
    },
    onError: showApiError,
  });

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
          <DialogDescription>
            {document ? t.descriptionWith(document.title) : t.descriptionFallback}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <LexCreationGuidance workflow="document" />
          <div className="space-y-1.5">
            <Label htmlFor="version-file">
              {t.documentFile} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="version-file"
              type="file"
              accept=".pdf,.docx,.txt,.xlsx,.pptx"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                void selectFile(file);
              }}
            />
            {selectedFile ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t.selectedPrefix(selectedFile.name)}</p>
                {isPdfFile(selectedFile) ? (
                  <DocumentPdfProcessingStatus
                    status={resolvePdfDisplayStatus({
                      extraction: pdfExtraction,
                      extractedText,
                      failed: pdfInspectionFailed,
                      inspecting: pdfInspecting,
                    })}
                    pageCount={pdfExtraction?.pageCount}
                    pagesWithText={pdfExtraction?.pagesWithText}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="version-summary">{t.changeSummary}</Label>
            <Input
              id="version-summary"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              placeholder={t.changeSummaryPlaceholder}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="version-text">{t.extractedText}</Label>
            <Textarea
              id="version-text"
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              placeholder={t.extractedTextPlaceholder}
              rows={4}
            />
          </div>

          {uploadMutation.isPending && selectedFile ? (
            <p className="text-xs text-muted-foreground">{t.uploadProgress(Math.round(uploadProgress))}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={!selectedFile || uploadMutation.isPending}
            onClick={() => uploadMutation.mutate()}
          >
            {uploadMutation.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
            ) : null}
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function resolvePdfDisplayStatus(input: {
  extraction: PdfTextExtractionResult | null;
  extractedText: string;
  failed: boolean;
  inspecting: boolean;
}): PdfProcessingDisplayStatus {
  if (input.inspecting) return 'inspecting';
  if (input.failed) {
    return input.extractedText.trim() ? 'manual_text_ocr_pending' : 'inspection_failed';
  }
  if (!input.extraction?.text.trim()) {
    return input.extractedText.trim() ? 'manual_text_ocr_pending' : 'ocr_pending';
  }
  return input.extraction.pagesNeedingOcr > 0
    ? 'partial_ocr_pending'
    : 'text_extracted';
}
