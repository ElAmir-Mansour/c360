'use client';

import { useEffect, useState } from 'react';
import { Check, Languages, Monitor, Moon, Settings2, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { useSetLocale } from '@/hooks/use-set-locale';
import type { AppLocale } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

type ThemeValue = 'light' | 'dark' | 'system';

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemeValue;
  labelKey: MessageKey;
  icon: typeof Sun;
}> = [
  { value: 'light', labelKey: 'preferences.themeLight', icon: Sun },
  { value: 'dark', labelKey: 'preferences.themeDark', icon: Moon },
  { value: 'system', labelKey: 'preferences.themeSystem', icon: Monitor },
];

const LOCALE_OPTIONS: ReadonlyArray<{
  value: AppLocale;
  labelKey: MessageKey;
}> = [
  { value: 'en', labelKey: 'preferences.languageEnglish' },
  { value: 'ar', labelKey: 'preferences.languageArabic' },
];

/**
 * Unified, accessible appearance + language control for the header.
 *
 * - Theme: Light / Dark / System via next-themes (persisted, `dark` class on
 *   <html>). The trigger icon reflects the resolved theme.
 * - Locale: English <-> Arabic. Selecting a locale writes the
 *   `clario360_locale` cookie, flips `<html dir>` live (RTL/LTR), and refreshes
 *   the server tree so labels re-render — no full page reload.
 *
 * All copy is token/i18n-driven; the menu is keyboard-navigable (Radix
 * DropdownMenu) and every item carries an explicit selected state for AT.
 * Renders a stable placeholder until mounted to avoid SSR theme hydration
 * mismatch (the server cannot know the resolved theme).
 */
export function ThemeLocaleSwitcher() {
  const t = useT();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { locale } = useLocale();
  const { setLocale } = useSetLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const TriggerIcon = !mounted ? Settings2 : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('preferences.appearanceAndLanguage')}
          data-testid="theme-locale-trigger"
          className={cn(
            'inline-flex h-9 w-9 items-center justify-center rounded-button border border-primary/15 bg-card text-foreground/65 shadow-elevation-1',
            'transition-colors duration-fast ease-standard',
            'hover:border-primary/30 hover:bg-secondary hover:text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          )}
        >
          <TriggerIcon className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        {/* Theme group */}
        <DropdownMenuLabel className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Sun className="h-3.5 w-3.5" aria-hidden />
          {t('preferences.theme')}
        </DropdownMenuLabel>
        <div role="radiogroup" aria-label={t('preferences.theme')}>
          {THEME_OPTIONS.map(({ value, labelKey, icon: OptIcon }) => {
            const selected = mounted && theme === value;
            return (
              <DropdownMenuItem
                key={value}
                role="menuitemradio"
                aria-checked={selected}
                data-testid={`theme-option-${value}`}
                onSelect={() => setTheme(value)}
                className="flex items-center gap-2"
              >
                <OptIcon className="h-4 w-4 text-foreground/70" aria-hidden />
                <span>{t(labelKey)}</span>
                {selected && <Check className="ms-auto h-4 w-4 text-primary" aria-hidden />}
              </DropdownMenuItem>
            );
          })}
        </div>

        <DropdownMenuSeparator />

        {/* Language group */}
        <DropdownMenuLabel className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Languages className="h-3.5 w-3.5" aria-hidden />
          {t('preferences.language')}
        </DropdownMenuLabel>
        <div role="radiogroup" aria-label={t('preferences.language')}>
          {LOCALE_OPTIONS.map(({ value, labelKey }) => {
            const selected = locale === value;
            return (
              <DropdownMenuItem
                key={value}
                role="menuitemradio"
                aria-checked={selected}
                lang={value}
                dir={value === 'ar' ? 'rtl' : 'ltr'}
                data-testid={`locale-option-${value}`}
                onSelect={() => setLocale(value)}
                className="flex items-center gap-2"
              >
                <span className="text-[11px] font-bold uppercase text-foreground/55">{value}</span>
                <span>{t(labelKey)}</span>
                {selected && <Check className="ms-auto h-4 w-4 text-primary" aria-hidden />}
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
