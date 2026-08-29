'use client';

import { Languages } from 'lucide-react';

import { useLocale, useT } from '@/components/providers/locale-provider';
import { useSetLocale } from '@/hooks/use-set-locale';
import { cn } from '@/lib/utils';

/**
 * One-tap language switch for surfaces where discoverability matters (login,
 * register): shows the OTHER language's name in its own script — the i18n
 * convention that stays legible to a user stranded in the wrong language —
 * instead of burying the switch inside the theme dropdown.
 */
export function LocaleQuickToggle({ className }: { className?: string }) {
  const t = useT();
  const { locale } = useLocale();
  const { setLocale } = useSetLocale();

  const target = locale === 'ar' ? 'en' : 'ar';
  // Language names are intentionally NOT translated: each is rendered in the
  // language it names, so it is readable exactly when it is needed.
  const targetLabel = target === 'ar' ? 'العربية' : 'English';

  return (
    <button
      type="button"
      lang={target}
      dir={target === 'ar' ? 'rtl' : 'ltr'}
      onClick={() => setLocale(target)}
      aria-label={t('preferences.language')}
      data-testid="locale-quick-toggle"
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-button border border-primary/15 bg-card px-3 text-[12px] font-semibold text-foreground/70 shadow-elevation-1',
        'transition-colors duration-fast ease-standard',
        'hover:border-primary/30 hover:bg-secondary hover:text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        className,
      )}
    >
      <Languages className="h-3.5 w-3.5" aria-hidden />
      {targetLabel}
    </button>
  );
}
