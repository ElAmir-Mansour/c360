'use client';

import { AlertCircle, CheckCircle2, Loader2, ScanText } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';

export type PdfProcessingDisplayStatus =
  | 'inspecting'
  | 'text_extracted'
  | 'partial_ocr_pending'
  | 'manual_text_ocr_pending'
  | 'provided_text_ocr_unknown'
  | 'ocr_pending'
  | 'inspection_failed';

interface DocumentPdfProcessingStatusProps {
  status: PdfProcessingDisplayStatus;
  pageCount?: number;
  pagesWithText?: number;
  className?: string;
}

const COPY = {
  en: {
    inspecting: {
      title: 'Inspecting the PDF text layer…',
      description: 'This checks for embedded searchable text. It is not OCR.',
    },
    text_extracted: {
      title: 'Embedded PDF text extracted',
      description: 'The born-digital text will be indexed. Text-layer extraction is not OCR; OCR is not required.',
    },
    partial_ocr_pending: {
      title: 'PDF text partially extracted · OCR pending',
      description: 'Searchable text was found, but one or more low-text pages still need server OCR.',
    },
    manual_text_ocr_pending: {
      title: 'Manual text available · OCR pending',
      description: 'The pasted text will be indexed, but the scanned PDF still needs server OCR.',
    },
    provided_text_ocr_unknown: {
      title: 'Searchable text available · OCR state unverified',
      description: 'Text was supplied without page-level extraction proof. It will be indexed, while scan coverage remains pending verification.',
    },
    ocr_pending: {
      title: 'OCR needed for scanned PDF · pending',
      description: 'No embedded text was found. The PDF can still be uploaded and previewed; real OCR must run on the server.',
    },
    inspection_failed: {
      title: 'PDF text-layer inspection unavailable · OCR pending',
      description: 'The PDF can still be uploaded and previewed. It remains marked for server OCR.',
    },
    pageProof: (withText: number, total: number) => `${withText} of ${total} pages contain embedded text.`,
  },
  ar: {
    inspecting: {
      title: 'جارٍ فحص طبقة النص في ملف PDF…',
      description: 'يتحقق هذا الفحص من النص المضمّن القابل للبحث، وليس تعرّفًا ضوئيًا OCR.',
    },
    text_extracted: {
      title: 'تم استخراج النص المضمّن في PDF',
      description: 'ستتم فهرسة النص الرقمي. استخراج طبقة النص ليس OCR، ولا يلزم تشغيل OCR.',
    },
    partial_ocr_pending: {
      title: 'تم استخراج جزء من نص PDF · OCR معلّق',
      description: 'عُثر على نص قابل للبحث، لكن صفحة واحدة أو أكثر ما زالت تحتاج إلى OCR من الخادم.',
    },
    manual_text_ocr_pending: {
      title: 'يتوفر نص يدوي · OCR معلّق',
      description: 'ستتم فهرسة النص الملصق، لكن ملف PDF الممسوح ما زال يحتاج إلى OCR من الخادم.',
    },
    provided_text_ocr_unknown: {
      title: 'يتوفر نص قابل للبحث · حالة OCR غير موثقة',
      description: 'تم توفير النص دون إثبات استخراج على مستوى الصفحات. ستتم فهرسته، بينما تظل تغطية المسح بانتظار التحقق.',
    },
    ocr_pending: {
      title: 'ملف PDF ممسوح يحتاج إلى OCR · معلّق',
      description: 'لم يُعثر على نص مضمّن. يمكن رفع الملف ومعاينته، لكن يجب تشغيل OCR فعلي على الخادم.',
    },
    inspection_failed: {
      title: 'تعذّر فحص طبقة نص PDF · OCR معلّق',
      description: 'يمكن رفع ملف PDF ومعاينته، وسيظل معلّمًا للمعالجة الفعلية عبر OCR على الخادم.',
    },
    pageProof: (withText: number, total: number) => `${withText} من ${total} صفحات تحتوي على نص مضمّن.`,
  },
} as const;

export function DocumentPdfProcessingStatus({
  status,
  pageCount,
  pagesWithText,
  className,
}: DocumentPdfProcessingStatusProps) {
  const { locale } = useLocaleOrDefault();
  const copy = locale === 'ar' ? COPY.ar : COPY.en;
  const item = copy[status];
  const success = status === 'text_extracted';
  const loading = status === 'inspecting';
  const warning = !success && !loading;
  const Icon = loading
    ? Loader2
    : success
      ? CheckCircle2
      : status === 'inspection_failed'
        ? AlertCircle
        : ScanText;

  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-lg border px-3 py-2.5 text-start',
        success && 'border-emerald-500/30 bg-emerald-500/5',
        loading && 'border-sky-500/30 bg-sky-500/5',
        warning && 'border-amber-500/35 bg-amber-500/5',
        className,
      )}
      data-pdf-processing-status={status}
      role="status"
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          success && 'text-emerald-600',
          loading && 'animate-spin text-sky-600',
          warning && 'text-amber-600',
        )}
        aria-hidden
      />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{item.title}</p>
        <p className="text-xs leading-5 text-muted-foreground">{item.description}</p>
        {typeof pageCount === 'number' && pageCount > 0 && typeof pagesWithText === 'number' ? (
          <p className="text-xs font-medium text-muted-foreground">
            {copy.pageProof(pagesWithText, pageCount)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
