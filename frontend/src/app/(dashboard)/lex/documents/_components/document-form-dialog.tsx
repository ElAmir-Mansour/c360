'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import {
  enterpriseApi,
  lexDocumentSchema,
  type LexDocumentFormValues,
} from '@/lib/enterprise';
import {
  analyzeTextFromUpload,
  resolveUploadExtractedText,
  type UploadTextExtractionResult,
} from '@/lib/documents/word';
import {
  buildPdfProcessingPayload,
  isPdfFile,
  type DocumentTextProcessingPayload,
  type PdfTextExtractionResult,
} from '@/lib/documents/pdf-text';
import { showApiError, showSuccess } from '@/lib/toast';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import type { FileRecord } from '@/types/models';
import type { LexDocument } from '@/types/suites';
import { useDocumentsLabels } from '../_lib/documents-labels';
import {
  DocumentPdfProcessingStatus,
  type PdfProcessingDisplayStatus,
} from './document-pdf-processing-status';

interface DocumentFormDialogProps {
  document?: LexDocument | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (doc: LexDocument) => void;
  open: boolean;
  /** Pre-seed the upload field on create (e.g. a drag-and-dropped file). */
  initialFile?: File | null;
}

const DOCUMENT_TYPES = [
  'policy',
  'regulation',
  'template',
  'memo',
  'opinion',
  'filing',
  'correspondence',
  'resolution',
  'power_of_attorney',
  'other',
] as const;

const CONFIDENTIALITY_LEVELS = [
  'public',
  'internal',
  'confidential',
  'privileged',
] as const;

const DOCUMENT_STATUS_VALUES = ['draft', 'active', 'archived', 'superseded'] as const;

export function DocumentFormDialog({
  document,
  onOpenChange,
  onSaved,
  open,
  initialFile,
}: DocumentFormDialogProps) {
  const isEdit = Boolean(document);
  const queryClient = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const labels = useDocumentsLabels();
  const t = labels.form;
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [tagInputValue, setTagInputValue] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pdfExtraction, setPdfExtraction] = useState<PdfTextExtractionResult | null>(null);
  const [pdfInspecting, setPdfInspecting] = useState(false);
  const [pdfInspectionFailed, setPdfInspectionFailed] = useState(false);
  const fileSelectionSequence = useRef(0);

  const form = useForm<LexDocumentFormValues>({
    resolver: zodResolver(lexDocumentSchema),
    defaultValues: buildFormDefaults(document),
  });

  const selectFile = useCallback(async (file: File | null) => {
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
  }, []);

  useEffect(() => {
    if (!open) return;
    form.reset(buildFormDefaults(document));
    // On create, seed the upload field from a drag-and-dropped file (and prefill
    // its extracted text); otherwise start empty. Never pre-seed in edit mode.
    if (!document && initialFile) {
      void selectFile(initialFile);
    } else {
      void selectFile(null);
    }
    setChangeSummary('');
    setTagInputValue(document?.tags.join(', ') ?? '');
    setUploadProgress(0);
  }, [document, form, open, initialFile, selectFile]);

  const saveMutation = useMutation({
    mutationFn: async (values: LexDocumentFormValues) => {
      let documentPayload: Record<string, unknown> | undefined;
      let processingPayload: DocumentTextProcessingPayload | undefined;

      if (!isEdit && selectedFile) {
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
        processingPayload = buildPdfProcessingPayload(
          selectedFile,
          uploadAnalysis?.pdf ?? pdfExtraction,
          resolvedExtractedText,
        );
        const uploaded = await uploadDocumentFile(selectedFile, values, setUploadProgress);
        documentPayload = {
          file_id: uploaded.id,
          file_name: uploaded.original_name,
          file_size_bytes: uploaded.size_bytes,
          content_hash: uploaded.checksum_sha256,
          extracted_text: resolvedExtractedText,
          change_summary: changeSummary.trim(),
        };
      }

      const payload = buildPayload(values, isEdit, documentPayload, processingPayload);
      if (isEdit && document) {
        return enterpriseApi.lex.updateDocument(document.id, payload);
      }
      return enterpriseApi.lex.createDocument(payload);
    },
    onSuccess: async (savedDoc) => {
      showSuccess(
        isEdit ? labels.toasts.updatedTitle : labels.toasts.createdTitle,
        isEdit ? labels.toasts.updatedDescription : labels.toasts.createdDescription,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-documents'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        document
          ? queryClient.invalidateQueries({ queryKey: ['lex-document', document.id] })
          : Promise.resolve(),
      ]);
      onOpenChange(false);
      onSaved?.(savedDoc);
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? t.editDescription : t.createDescription}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form
            className="space-y-5"
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
          >
            {!isEdit ? <LexCreationGuidance workflow="document" /> : null}
            <FormField name="title" label={t.title} required>
              <Input id="title" {...form.register('title')} placeholder={t.titlePlaceholder} />
            </FormField>

            {isEdit ? (
              <FormField name="status" label={t.status} required>
                <Select
                  value={form.watch('status') ?? 'active'}
                  onValueChange={(value) =>
                    form.setValue('status', value as NonNullable<LexDocumentFormValues['status']>, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_STATUS_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {labels.enums.statuses[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="type" label={t.documentType} required>
                <Select
                  value={form.watch('type')}
                  onValueChange={(value) =>
                    form.setValue('type', value as LexDocumentFormValues['type'], { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {labels.enums.types[type] ?? (locale === 'ar' ? 'نوع غير معروف' : type.replace(/_/g, ' '))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="confidentiality" label={t.confidentiality} required>
                <Select
                  value={form.watch('confidentiality')}
                  onValueChange={(value) =>
                    form.setValue('confidentiality', value as LexDocumentFormValues['confidentiality'], { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="confidentiality">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONFIDENTIALITY_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {labels.enums.confidentiality[level] ?? level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField name="description" label={t.description} required>
              <Textarea
                id="description"
                {...form.register('description')}
                placeholder={t.descriptionPlaceholder}
                rows={3}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="category" label={t.category}>
                <Input id="category" {...form.register('category')} placeholder={t.categoryPlaceholder} />
              </FormField>

              <FormField name="tags" label={t.tags}>
                <Input
                  id="tags"
                  value={tagInputValue}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setTagInputValue(nextValue);
                    form.setValue('tags', parseTagInput(nextValue), { shouldValidate: true });
                  }}
                  placeholder={t.tagsPlaceholder}
                />
              </FormField>
            </div>

            {!isEdit ? (
              <div className="space-y-4 rounded-lg border px-4 py-4">
                <div>
                  <p className="text-sm font-medium">{t.initialFileTitle}</p>
                  <p className="text-xs text-muted-foreground">{t.initialFileHint}</p>
                </div>

                <FormField name="initial_file" label={t.documentFile}>
                  <Input
                    id="initial_file"
                    type="file"
                    accept=".pdf,.docx,.txt,.xlsx,.pptx"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      void selectFile(file);
                    }}
                  />
                </FormField>

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

                <FormField name="document_extracted_text" label={t.extractedText}>
                  <Textarea
                    id="document_extracted_text"
                    value={extractedText}
                    onChange={(event) => setExtractedText(event.target.value)}
                    placeholder={t.extractedTextPlaceholder}
                    rows={4}
                  />
                </FormField>

                <FormField name="document_change_summary" label={t.changeSummary}>
                  <Input
                    id="document_change_summary"
                    value={changeSummary}
                    onChange={(event) => setChangeSummary(event.target.value)}
                    placeholder={t.changeSummaryPlaceholder}
                  />
                </FormField>

                {saveMutation.isPending && selectedFile ? (
                  <p className="text-xs text-muted-foreground">{t.uploadProgress(Math.round(uploadProgress))}</p>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : null}
                {isEdit ? t.save : t.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function buildFormDefaults(doc?: LexDocument | null): LexDocumentFormValues {
  return {
    title: doc?.title ?? '',
    type: doc?.type ?? 'policy',
    description: doc?.description ?? '',
    category: doc?.category ?? null,
    confidentiality: doc?.confidentiality ?? 'internal',
    status: doc?.status ?? 'active',
    contract_id: doc?.contract_id ?? null,
    tags: doc?.tags ?? [],
    metadata: doc?.metadata ?? {},
    document: null,
  };
}

function buildPayload(
  values: LexDocumentFormValues,
  isEdit: boolean,
  documentPayload?: Record<string, unknown>,
  processingPayload?: DocumentTextProcessingPayload,
): Record<string, unknown> {
  if (isEdit) {
    return {
      title: values.title.trim(),
      type: values.type,
      description: values.description.trim(),
      category: values.category?.trim() ?? '',
      confidentiality: values.confidentiality,
      status: values.status ?? 'active',
      contract_id: values.contract_id ?? null,
      tags: values.tags,
      metadata: values.metadata ?? {},
    };
  }
  return {
    title: values.title.trim(),
    type: values.type,
    description: values.description.trim(),
    category: values.category?.trim() || null,
    confidentiality: values.confidentiality,
    contract_id: values.contract_id ?? null,
    tags: values.tags,
    metadata: values.metadata ?? {},
    ...(documentPayload ? { document: documentPayload } : {}),
    ...(processingPayload ? { processing: processingPayload } : {}),
  };
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

async function uploadDocumentFile(
  file: File,
  values: LexDocumentFormValues,
  onProgress: (progress: number) => void,
): Promise<FileRecord> {
  return enterpriseApi.files.upload(
    file,
    {
      suite: 'lex',
      entity_type: 'document',
      tags: Array.from(new Set(['document', values.type, ...values.tags])).join(','),
      lifecycle_policy: 'standard',
    },
    onProgress,
  );
}

function parseTagInput(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}
