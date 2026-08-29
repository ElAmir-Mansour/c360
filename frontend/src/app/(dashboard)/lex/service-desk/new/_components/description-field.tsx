'use client';

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useDetailsStrings } from '../_lib/details-i18n';
import { DESCRIPTION_MAX } from '../_lib/wizard-validation';
import { shapeDigits } from '@/lib/format/numerals';
import { cn } from '@/lib/utils';

export interface DescriptionFieldProps {
  /** Current description held by the parent wizard. */
  value: string;
  /** Commit the description to the parent. */
  onChange: (v: string) => void;
  /** Validation message surfaced beneath the textarea (destructive text). */
  error?: string;
  /**
   * Optional service code (kept in the contract for parent wiring; no longer
   * used for template scaffolding in the mockup layout).
   */
  serviceCode?: string;
  /** Optional AI-draft handler (kept in the contract; not surfaced in this layout). */
  onAiDraft?: () => void;
  /** Disables the textarea while submitting / when the user lacks write permission. */
  disabled?: boolean;
}

/**
 * Step-local copy for the description field. English is the default/fallback
 * branch; Arabic is professional MSA (flag for the localization gate). Kept local
 * to this file per the wizard contract (do not edit the shared labels module).
 */
const LOCAL = {
  en: {
    label: 'Description and Objective of Request',
    maxHelper: `Max ${DESCRIPTION_MAX} characters`,
    counterSuffix: 'characters',
  },
  ar: {
    label: 'وصف الطلب والهدف منه',
    maxHelper: `الحد الأقصى ${shapeDigits(DESCRIPTION_MAX, 'ar')} حرف`,
    counterSuffix: 'حرف',
  },
} as const;

/**
 * Live character-counter color: amber within 50 of the max, destructive at/over
 * the max, muted otherwise.
 */
function counterTone(used: number): string {
  if (used >= DESCRIPTION_MAX) return 'text-destructive';
  if (used >= DESCRIPTION_MAX - 50) return 'text-warning-700 dark:text-warning-300';
  return 'text-muted-foreground';
}

/**
 * DescriptionField — the "Description and Objective of Request" textarea for
 * step 2 of the wizard, restyled to the mockup: a labelled, required textarea
 * with a "Max 2000 characters" helper (start) and a live `N / 2000 characters`
 * counter (end). Fully controlled by `page.tsx`; RTL-correct via logical props.
 */
export default function DescriptionField({ value, onChange, error, disabled }: DescriptionFieldProps) {
  const { locale } = useLocaleOrDefault();
  const d = useDetailsStrings();
  const s = locale === 'ar' ? LOCAL.ar : LOCAL.en;

  const baseId = useId();
  const textareaId = `${baseId}-description`;
  const helperId = `${baseId}-helper`;
  const counterId = `${baseId}-counter`;
  const errorId = `${baseId}-error`;

  const hasError = Boolean(error);
  const used = value.length;
  const describedBy = cn(helperId, counterId, hasError && errorId) || undefined;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={textareaId}>
        {s.label}
        <span className="ms-0.5 text-destructive" aria-label={d.requiredA11y}>
          {d.requiredMark}
        </span>
      </Label>

      <Textarea
        id={textareaId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={d.descriptionPlaceholder}
        rows={5}
        maxLength={DESCRIPTION_MAX}
        disabled={disabled}
        aria-invalid={hasError ? true : undefined}
        aria-describedby={describedBy}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={helperId} className="text-xs text-muted-foreground">
          {s.maxHelper}
        </span>
        <span
          id={counterId}
          className={cn('shrink-0 text-xs tabular-nums', counterTone(used))}
          aria-label={d.counterA11y(used, DESCRIPTION_MAX)}
        >
          {shapeDigits(used, locale)} / {shapeDigits(DESCRIPTION_MAX, locale)} {s.counterSuffix}
        </span>
      </div>

      {hasError ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
