'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLibraryLabels } from '../_lib/library-labels';

/** Palette per corpus bucket — keeps the classification chips visually distinct. */
const CATEGORY_TONE: Record<string, string> = {
  'systems-regulations':
    'border-brand-primary-500/30 bg-brand-primary-500/10 text-brand-primary-700 dark:text-brand-primary-300',
  'judicial-journal':
    'border-brand-teal-500/30 bg-brand-teal-500/10 text-brand-teal-700 dark:text-brand-teal-300',
  research:
    'border-brand-accent-500/30 bg-brand-accent-500/10 text-brand-accent-700 dark:text-brand-accent-300',
};

/**
 * Localized bilingual classification chips for a reference document: the corpus
 * `category` (toned) plus the finer `doc_type`. Every token is resolved through
 * the enum-i18n map so no raw English leaks into the Arabic surface.
 */
export function ClassificationChips({
  category,
  docType,
  className,
}: {
  category: string;
  docType: string;
  className?: string;
}) {
  const labels = useLibraryLabels();
  const categoryLabel = labels.category[category] ?? category;
  const docTypeLabel = labels.docType[docType] ?? docType;
  const showDocType = docType && docType !== category;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <Badge
        variant="outline"
        dir="auto"
        className={cn(
          'font-medium normal-case tracking-normal',
          CATEGORY_TONE[category] ?? 'border-border bg-muted/50 text-foreground',
        )}
      >
        {categoryLabel}
      </Badge>
      {showDocType ? (
        <Badge
          variant="secondary"
          dir="auto"
          className="font-medium normal-case tracking-normal"
        >
          {docTypeLabel}
        </Badge>
      ) : null}
    </div>
  );
}
