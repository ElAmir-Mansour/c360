'use client';

import { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ar as arLocale } from 'date-fns/locale';
import { History, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { useDraftStrings } from '../_lib/draft-i18n';

export interface DraftResumeBannerProps {
  /** ISO timestamp of the saved draft. */
  savedAt: string;
  /** Rehydrate the wizard from the persisted draft. */
  onResume: () => void;
  /** Drop the persisted draft and start fresh. */
  onDiscard: () => void;
}

/**
 * Dismissible banner shown on wizard mount when a persisted draft exists,
 * offering the user a chance to resume or discard it. Bilingual EN/AR with
 * logical-direction layout.
 */
export default function DraftResumeBanner({
  savedAt,
  onResume,
  onDiscard,
}: DraftResumeBannerProps) {
  const { locale } = useLocaleOrDefault();
  const strings = useDraftStrings();
  const [dismissed, setDismissed] = useState(false);

  const relative = useMemo(() => {
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

  if (dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-warning-300 bg-warning-50 px-4 py-3',
        'text-warning-700 dark:border-warning-800/40 dark:bg-warning-800/20 dark:text-warning-300',
        'sm:flex-row sm:items-center sm:justify-between',
      )}
    >
      <div className="flex items-start gap-2">
        <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="text-sm font-medium">
          {strings.resumePrefix} {relative}
          {strings.resumeSuffix}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" size="sm" onClick={onResume}>
          {strings.resume}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDiscard}>
          {strings.discard}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={strings.dismiss}
          onClick={() => setDismissed(true)}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
