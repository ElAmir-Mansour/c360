'use client';

import { useId, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useDetailsStrings } from '../_lib/details-i18n';
import { TITLE_MAX } from '../_lib/wizard-validation';
import { shapeDigits } from '@/lib/format/numerals';
import { cn } from '@/lib/utils';

export interface BilingualTitleFieldsProps {
  /** Current English title held by the parent wizard. */
  titleEn: string;
  /** Current Arabic title held by the parent wizard. */
  titleAr: string;
  /** Commit the English title to the parent. */
  onChangeEn: (v: string) => void;
  /** Commit the Arabic title to the parent. */
  onChangeAr: (v: string) => void;
  /** Validation message (shown once beneath both fields): at least one title required. */
  error?: string;
  /** Disables both inputs while submitting / when the user lacks write permission. */
  disabled?: boolean;
}

/**
 * Step-local copy. English is the default/fallback branch; Arabic is professional
 * MSA (flag for the localization gate). The `langName` helper yields the OTHER
 * language's display name in the active UI locale; the Arabic `أضف العنوان ب…`
 * phrasing concatenates the "بـ" preposition directly onto the language name.
 */
const LOCAL = {
  en: {
    mainLabel: 'Request Title',
    helper: 'Appears in request lists and search — keep it short.',
    langName: (l: 'ar' | 'en') => (l === 'ar' ? 'Arabic' : 'English'),
    addOther: (lang: string) => `Add ${lang} title`,
    otherLabel: (lang: string) => `${lang} title`,
    optionalTag: 'optional',
    bilingualDone: 'Title added in both languages',
  },
  ar: {
    mainLabel: 'عنوان الطلب',
    helper: 'يظهر في قوائم الطلبات والبحث — اجعله موجزًا.',
    langName: (l: 'ar' | 'en') => (l === 'ar' ? 'العربية' : 'الإنجليزية'),
    addOther: (lang: string) => `أضف العنوان ب${lang}`,
    otherLabel: (lang: string) => `العنوان ب${lang}`,
    optionalTag: 'اختياري',
    bilingualDone: 'تمت إضافة العنوان باللغتين',
  },
} as const;

/**
 * Live character-counter color: amber within 10 of the max, destructive at/over
 * the max, muted otherwise.
 */
function counterTone(used: number): string {
  if (used >= TITLE_MAX) return 'text-destructive';
  if (used >= TITLE_MAX - 10) return 'text-warning-700 dark:text-warning-300';
  return 'text-muted-foreground';
}

/**
 * BilingualTitleFields — "Request Title" for step 2, restyled to the mockup:
 * one PROMINENT input in the active UI locale plus a COLLAPSIBLE secondary field
 * for the other language, so the control fits a single column of the 2-column
 * row. The backend requires `title.{en,ar}` with at least one language present;
 * neither language is dropped. A pure "copy to the other language" helper mirrors
 * the filled side into the empty side (no translation). A single error line wires
 * `aria-invalid` / `aria-describedby` on both inputs.
 */
export default function BilingualTitleFields({
  titleEn,
  titleAr,
  onChangeEn,
  onChangeAr,
  error,
  disabled,
}: BilingualTitleFieldsProps) {
  const { locale } = useLocaleOrDefault();
  const d = useDetailsStrings();
  const s = locale === 'ar' ? LOCAL.ar : LOCAL.en;

  const isArActive = locale === 'ar';
  const primaryLang: 'ar' | 'en' = isArActive ? 'ar' : 'en';
  const secondaryLang: 'ar' | 'en' = isArActive ? 'en' : 'ar';

  const primaryValue = isArActive ? titleAr : titleEn;
  const secondaryValue = isArActive ? titleEn : titleAr;
  const onPrimaryChange = isArActive ? onChangeAr : onChangeEn;
  const onSecondaryChange = isArActive ? onChangeEn : onChangeAr;

  const primaryPlaceholder = primaryLang === 'ar' ? d.titleArPlaceholder : d.titleEnPlaceholder;
  const secondaryPlaceholder = secondaryLang === 'ar' ? d.titleArPlaceholder : d.titleEnPlaceholder;

  const baseId = useId();
  const primaryId = `${baseId}-primary`;
  const secondaryId = `${baseId}-secondary`;
  const primaryCounterId = `${baseId}-primary-counter`;
  const secondaryCounterId = `${baseId}-secondary-counter`;
  const errorId = `${baseId}-error`;

  const hasError = Boolean(error);
  const primaryFilled = primaryValue.trim().length > 0;
  const secondaryFilled = secondaryValue.trim().length > 0;
  const bothFilled = primaryFilled && secondaryFilled;

  // Reveal the secondary field on demand, or automatically when it already holds
  // content (e.g. a restored draft) so it is never hidden with data inside.
  const [expanded, setExpanded] = useState(false);
  const showSecondary = expanded || secondaryFilled;

  // Copy helper: offered only when the primary has content and the secondary is
  // still empty — mirror the filled language into the empty one (no translation).
  const canCopyToSecondary = primaryFilled && !secondaryFilled;
  const copyLabel = primaryLang === 'en' ? d.copyEnglishToArabic : d.copyArabicToEnglish;

  const primaryDescribedBy = cn(primaryCounterId, hasError && errorId) || undefined;
  const secondaryDescribedBy = cn(secondaryCounterId, hasError && errorId) || undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={primaryId}>
          {s.mainLabel}
          <span className="ms-0.5 text-destructive" aria-label={d.requiredA11y}>
            {d.requiredMark}
          </span>
        </Label>
        {bothFilled ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success-700 dark:text-success-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {s.bilingualDone}
          </span>
        ) : null}
      </div>

      {/* Helper — mirrors the beneficiary field's helper line so the two controls
          in the 2-column row line up (label → helper → input). */}
      <p className="text-xs text-muted-foreground">{s.helper}</p>

      {/* Primary (active-locale) title — prominent. */}
      <Input
        id={primaryId}
        value={primaryValue}
        onChange={(e) => onPrimaryChange(e.target.value)}
        placeholder={primaryPlaceholder}
        dir={primaryLang === 'ar' ? 'rtl' : 'ltr'}
        maxLength={TITLE_MAX}
        disabled={disabled}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={primaryDescribedBy}
      />
      <div className="flex justify-end">
        <span
          id={primaryCounterId}
          className={cn('text-xs tabular-nums', counterTone(primaryValue.length))}
          aria-label={d.counterA11y(primaryValue.length, TITLE_MAX)}
        >
          {shapeDigits(primaryValue.length, locale)}/{shapeDigits(TITLE_MAX, locale)}
        </span>
      </div>

      {/* Secondary language — collapsible / secondary emphasis. */}
      {showSecondary ? (
        <div className="space-y-1.5 rounded-lg border border-dashed border-border/70 bg-muted/20 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={secondaryId} className="text-xs text-muted-foreground">
              {s.otherLabel(s.langName(secondaryLang))}
              <span className="ms-1 font-normal">({s.optionalTag})</span>
            </Label>
            {canCopyToSecondary ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSecondaryChange(primaryValue)}
                disabled={disabled}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
                {copyLabel}
              </Button>
            ) : null}
          </div>
          <Input
            id={secondaryId}
            value={secondaryValue}
            onChange={(e) => onSecondaryChange(e.target.value)}
            placeholder={secondaryPlaceholder}
            dir={secondaryLang === 'ar' ? 'rtl' : 'ltr'}
            maxLength={TITLE_MAX}
            disabled={disabled}
            aria-invalid={hasError ? true : undefined}
            aria-describedby={secondaryDescribedBy}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canCopyToSecondary ? (
              <span className="text-xs text-muted-foreground">{d.copyNotTranslation}</span>
            ) : (
              <span aria-hidden />
            )}
            <span
              id={secondaryCounterId}
              className={cn('text-xs tabular-nums', counterTone(secondaryValue.length))}
              aria-label={d.counterA11y(secondaryValue.length, TITLE_MAX)}
            >
              {shapeDigits(secondaryValue.length, locale)}/{shapeDigits(TITLE_MAX, locale)}
            </span>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(true)}
          disabled={disabled}
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {s.addOther(s.langName(secondaryLang))}
        </Button>
      )}

      {hasError ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
