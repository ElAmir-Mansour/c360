/**
 * Verb → colour mapping for the Legal Role Matrix cells. Colour follows the
 * HIGHEST authority present in a cell (design §1 / xlsx legend): M > P > C > E >
 * A > V. Every class string is a literal so Tailwind's JIT keeps them.
 *
 * The palette is drawn from the Watheeq brand ramp: Manage (Dark Teal, config
 * power) reads strongest, Approve (La Rioja accent, the decisive control point)
 * pops; Close keeps the amber warning signal; Edit (Spring Teal) and Add (Deep
 * Teal) sit on the write tier; View keeps the neutral read-only grey. All pairs
 * meet WCAG AA contrast against their tinted background in both light and dark.
 */
import type { MatrixVerb } from '../_lib/legal-role-matrix';

interface VerbStyle {
  /** Filled cell chip classes (bg + text + border). */
  chip: string;
  /** Legend swatch classes. */
  swatch: string;
}

const STYLES: Record<MatrixVerb, VerbStyle> = {
  M: {
    chip: 'bg-brand-primary-100 text-brand-primary-900 border-brand-primary-400 dark:bg-brand-primary-500/25 dark:text-brand-primary-100 dark:border-brand-primary-500/50',
    swatch: 'bg-brand-primary-800',
  },
  P: {
    chip: 'bg-brand-accent-100 text-brand-accent-800 border-brand-accent-300 dark:bg-brand-accent-500/20 dark:text-brand-accent-200 dark:border-brand-accent-500/40',
    swatch: 'bg-brand-accent-500',
  },
  C: {
    chip: 'bg-warning-100 text-warning-700 border-warning-300 dark:bg-warning-500/20 dark:text-warning-300 dark:border-warning-500/40',
    swatch: 'bg-warning-500',
  },
  E: {
    chip: 'bg-brand-teal-100 text-brand-teal-800 border-brand-teal-300 dark:bg-brand-teal-500/20 dark:text-brand-teal-200 dark:border-brand-teal-500/40',
    swatch: 'bg-brand-teal-500',
  },
  A: {
    chip: 'bg-brand-primary-100 text-brand-primary-700 border-brand-primary-300 dark:bg-brand-primary-400/20 dark:text-brand-primary-200 dark:border-brand-primary-400/40',
    swatch: 'bg-brand-primary-600',
  },
  V: {
    chip: 'bg-neutral-100 text-neutral-700 border-neutral-300 dark:bg-neutral-500/20 dark:text-neutral-200 dark:border-neutral-500/40',
    swatch: 'bg-neutral-400',
  },
};

export function verbChipClass(verb: MatrixVerb): string {
  return STYLES[verb].chip;
}

export function verbSwatchClass(verb: MatrixVerb): string {
  return STYLES[verb].swatch;
}
