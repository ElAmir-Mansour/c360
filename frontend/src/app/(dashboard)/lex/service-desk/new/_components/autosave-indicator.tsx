'use client';

import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ar as arLocale } from 'date-fns/locale';
import { Check, Loader2 } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { useDraftStrings } from '../_lib/draft-i18n';

export interface AutosaveIndicatorProps {
  /** ISO timestamp of the last successful save, or null if never saved. */
  savedAt: string | null;
  /** True while a debounced write is pending/flushing. */
  saving: boolean;
}

/**
 * Tiny inline status for the wizard header: a spinner + "Saving…" while a write
 * is in flight, otherwise a check + "Autosaved {relative time}". Renders nothing
 * until the first save has occurred. Bilingual EN/AR.
 */
export default function AutosaveIndicator({ savedAt, saving }: AutosaveIndicatorProps) {
  const { locale } = useLocaleOrDefault();
  const strings = useDraftStrings();

  const relative = useMemo(() => {
    if (!savedAt) return '';
    try {
      const parsed = new Date(savedAt);
      if (Number.isNaN(parsed.getTime())) return '';
      return formatDistanceToNow(parsed, {
        addSuffix: true,
        locale: locale === 'ar' ? arLocale : undefined,
      });
    } catch {
      return '';
    }
  }, [savedAt, locale]);

  // Nothing to show until either a save is in progress or one has completed.
  if (!saving && !savedAt) {
    return null;
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
      )}
    >
      {saving ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {strings.saving}
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5 text-success-600 dark:text-success-300" aria-hidden />
          {strings.autosavedPrefix} {relative}
        </>
      )}
    </span>
  );
}
