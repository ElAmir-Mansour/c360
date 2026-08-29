'use client';

/**
 * DocumentEmptyState — premium, actionable empty states for the Lex documents
 * repository. Replaces the weak "No documents found" table empty and the
 * "No metadata yet" folder / saved-view placeholders with a centered block that
 * surfaces an IconBadge, a bilingual title + helpful description, and
 * CONTEXTUAL calls-to-action.
 *
 * Self-contained bilingual copy (EN + Modern Standard Arabic) with full RTL
 * support via logical properties. Token-driven (no hardcoded colors).
 *
 * Variants:
 *  - 'no-documents' — the repository (or current scope) holds no documents yet.
 *      Primary "Create document" + outline "Bulk import" when `canWrite`.
 *  - 'no-results'   — filters/search excluded everything. "Clear filters" + hint.
 *  - 'no-folders'   — no folder / saved-view metadata yet. Subtle hint only.
 */

import { FileText, FolderOpen, Plus, Search, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { IconBadge } from '@/components/shared/icon-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type DocumentEmptyStateVariant = 'no-documents' | 'no-results' | 'no-folders';

export interface DocumentEmptyStateProps {
  /** Which empty scenario to render. */
  variant: DocumentEmptyStateVariant;
  /** Whether the current user may create/import documents (gates write CTAs). */
  canWrite: boolean;
  /** Opens the create-document dialog. Used by 'no-documents'. */
  onCreate?: () => void;
  /** Opens the bulk-import flow. Used by 'no-documents'. */
  onImport?: () => void;
  /** Resets active filters / search. Used by 'no-results'. */
  onClearFilters?: () => void;
  /** Optional extra classes on the outer wrapper. */
  className?: string;
}

interface VariantCopy {
  icon: LucideIcon;
  tone: 'primary' | 'info' | 'muted';
  title: string;
  description: string;
}

type Copy = Record<DocumentEmptyStateVariant, VariantCopy> & {
  createDocument: string;
  bulkImport: string;
  clearFilters: string;
  noResultsHint: string;
};

const COPY: Record<'en' | 'ar', Copy> = {
  en: {
    'no-documents': {
      icon: FileText,
      tone: 'primary',
      title: 'Your repository is empty',
      description:
        'No legal documents have been added to this view yet. Create your first document or import an existing batch to get started.',
    },
    'no-results': {
      icon: Search,
      tone: 'info',
      title: 'No matching documents',
      description:
        'No documents match the current search and filters. Try broadening your query or clearing the active filters.',
    },
    'no-folders': {
      icon: FolderOpen,
      tone: 'muted',
      title: 'No folders yet',
      description:
        'Folders and saved views appear here as documents are organized. They will populate automatically once content is added.',
    },
    createDocument: 'Create document',
    bulkImport: 'Bulk import',
    clearFilters: 'Clear filters',
    noResultsHint: 'Tip: switch the search mode between metadata and contents to widen results.',
  },
  ar: {
    'no-documents': {
      icon: FileText,
      tone: 'primary',
      title: 'مستودعك فارغ',
      description:
        'لم تُضَف أي وثائق قانونية إلى هذا العرض بعد. أنشئ أول وثيقة أو استورد دفعة موجودة للبدء.',
    },
    'no-results': {
      icon: Search,
      tone: 'info',
      title: 'لا توجد وثائق مطابقة',
      description:
        'لا توجد وثائق مطابقة للبحث والمرشّحات الحالية. جرّب توسيع عبارة البحث أو مسح المرشّحات النشطة.',
    },
    'no-folders': {
      icon: FolderOpen,
      tone: 'muted',
      title: 'لا توجد مجلدات بعد',
      description:
        'تظهر المجلدات والعروض المحفوظة هنا عند تنظيم الوثائق. ستُملأ تلقائيًا بمجرد إضافة محتوى.',
    },
    createDocument: 'إنشاء وثيقة',
    bulkImport: 'استيراد جماعي',
    clearFilters: 'مسح المرشّحات',
    noResultsHint: 'تلميح: بدّل وضع البحث بين البيانات الوصفية والمحتوى لتوسيع النتائج.',
  },
};

export function DocumentEmptyState({
  variant,
  canWrite,
  onCreate,
  onImport,
  onClearFilters,
  className,
}: DocumentEmptyStateProps) {
  const { locale, direction } = useLocale();
  const copy = COPY[locale === 'ar' ? 'ar' : 'en'];
  const variantCopy = copy[variant];

  return (
    <div
      dir={direction}
      className={cn(
        'flex w-full flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      <IconBadge icon={variantCopy.icon} tone={variantCopy.tone} size="lg" className="h-14 w-14" />

      <h3 className="mt-4 text-base font-semibold text-[var(--ds-text-primary)]">
        {variantCopy.title}
      </h3>

      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--ds-text-muted)]">
        {variantCopy.description}
      </p>

      {variant === 'no-documents' && canWrite ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {onCreate ? (
            <Button onClick={onCreate} className="gap-2">
              <Plus className="h-4 w-4" aria-hidden />
              {copy.createDocument}
            </Button>
          ) : null}
          {onImport ? (
            <Button variant="outline" onClick={onImport} className="gap-2">
              <Upload className="h-4 w-4" aria-hidden />
              {copy.bulkImport}
            </Button>
          ) : null}
        </div>
      ) : null}

      {variant === 'no-results' ? (
        <div className="mt-5 flex flex-col items-center gap-2.5">
          {onClearFilters ? (
            <Button variant="outline" onClick={onClearFilters} className="gap-2">
              <X className="h-4 w-4" aria-hidden />
              {copy.clearFilters}
            </Button>
          ) : null}
          <p className="text-xs text-[var(--ds-text-muted)]">{copy.noResultsHint}</p>
        </div>
      ) : null}
    </div>
  );
}

export default DocumentEmptyState;
