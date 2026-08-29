'use client';

import { useRef, type KeyboardEvent } from 'react';
import { CalendarDays } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

import { useLegalDirectorDashboardLabels } from '../../../_lib/role-dashboards/legal-director-i18n';
import styles from './time-window-selector.module.css';

/**
 * Watheeq chip treatment for the shared Button.
 *
 * Expressed as utilities rather than a CSS-module class on purpose: the module
 * class and the Button's own variant utilities carry equal specificity, so the
 * winner would depend on stylesheet order. Passing utilities lets `cn`'s
 * tailwind-merge DROP the conflicting platform classes (rounded-xl, bg-action,
 * the 44px floor, elevation, the ring-action focus ring) outright, which is
 * deterministic. Same approach as `workforce-team-panel`, which styles its own
 * shared Buttons this way for the same reason.
 */
const CHIP_CLASS = cn(
  'inline-flex h-auto min-h-0 max-w-full items-center gap-[var(--wt-space-base)]',
  'px-[calc(var(--wt-space-base)*2)] py-[var(--wt-space-base)]',
  'rounded-[var(--wt-radius-pill)] shadow-none',
  'border-[length:var(--wt-card-border-width)] border-solid border-[color:var(--wt-teal-300)]',
  'bg-[var(--wt-surface)] text-[color:var(--wt-teal-900)]',
  'text-[length:var(--wt-font-size-caption)] font-bold leading-[var(--wt-line-height-caption)]',
  'text-start [overflow-wrap:anywhere]',
  'transition-colors duration-fast motion-reduce:transition-none',
  'hover:border-[color:var(--wt-teal-700)] hover:bg-[var(--wt-surface)] hover:text-[color:var(--wt-teal-900)]',
  // Selection is a filled chip, not a hue swap: the change in fill and text
  // contrast reads without relying on colour perception, and aria-checked
  // carries the same state to assistive tech.
  'aria-checked:border-[color:var(--wt-teal-700)] aria-checked:bg-[var(--wt-teal-700)]',
  'aria-checked:text-[color:var(--wt-surface)]',
  'focus-visible:ring-2 focus-visible:ring-[color:var(--wt-teal-700)]',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--wt-canvas)]',
);

/** Exact WLS-UI-SPEC-LD-001 time-window vocabulary. */
export type DashboardWindow = 'today' | '7d' | '30d';

export interface TimeWindowSelectorProps {
  value: DashboardWindow;
  onChange: (next: DashboardWindow) => void;
}

/** Ordered options so arrow-key navigation has a stable sequence. */
const WINDOW_ORDER: readonly DashboardWindow[] = ['today', '7d', '30d'] as const;

/**
 * Day counts the catalogue interpolates. They are numbers rather than baked
 * strings because `window.sevenDays` / `window.thirtyDays` take a formatted
 * count, so Arabic reads `٧ أيام` instead of a Latin-digit `7`.
 */
const SEVEN_DAYS = 7;
const THIRTY_DAYS = 30;

/**
 * Controlled time-window control for the Legal Director dashboard hero.
 *
 * Radio-group semantics, not buttons: this is single-select state, not an
 * action. Keyboard behaviour follows the WAI-ARIA APG radiogroup pattern —
 * roving tabindex, arrow keys both move focus and select, Space/Enter select
 * the focused chip through the native button activation path.
 *
 * The component owns nothing: it never holds the window, never resolves a date
 * range, and never fetches. The container that renders it owns the value and
 * decides which sources the window is honestly allowed to filter.
 */
export function TimeWindowSelector({ value, onChange }: TimeWindowSelectorProps) {
  const labels = useLegalDirectorDashboardLabels();
  const format = useLexFormat();
  const isRtl = format.direction === 'rtl';
  const chipRefs = useRef<Record<DashboardWindow, HTMLButtonElement | null>>({
    today: null,
    '7d': null,
    '30d': null,
  });

  const optionLabels: Record<DashboardWindow, string> = {
    today: labels.window.today,
    '7d': labels.window.sevenDays(format.formatNumber(SEVEN_DAYS)),
    '30d': labels.window.thirtyDays(format.formatNumber(THIRTY_DAYS)),
  };

  const moveSelection = (delta: number) => {
    const index = WINDOW_ORDER.indexOf(value);
    const nextIndex = (index + delta + WINDOW_ORDER.length) % WINDOW_ORDER.length;
    const next = WINDOW_ORDER[nextIndex];
    onChange(next);
    chipRefs.current[next]?.focus();
  };

  const onChipKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      // ArrowDown/ArrowUp advance/retreat in logical order regardless of layout
      // direction. ArrowRight/ArrowLeft report the PHYSICAL key, so under RTL they
      // are swapped to follow visual order (WAI-ARIA APG radiogroup pattern).
      case 'ArrowDown':
        event.preventDefault();
        moveSelection(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveSelection(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveSelection(isRtl ? -1 : 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveSelection(isRtl ? 1 : -1);
        break;
      default:
        break;
    }
  };

  return (
    <div className={styles.selector} data-time-window-selector="">
      <span className={styles.label} dir="auto">
        {labels.window.label}
      </span>

      <div
        role="radiogroup"
        aria-label={labels.accessibility.timeWindowSelector}
        className={styles.group}
      >
        {WINDOW_ORDER.map((option) => {
          const optionLabel = optionLabels[option];
          const checked = option === value;

          return (
            <Button
              key={option}
              ref={(node) => {
                chipRefs.current[option] = node;
              }}
              type="button"
              variant="ghost"
              size="sm"
              role="radio"
              aria-checked={checked}
              // Selection is already carried by aria-checked; the catalogue's
              // suffix keeps the spoken name explicit and still contains the
              // visible chip text (WCAG 2.5.3) in both locales.
              aria-label={checked ? labels.accessibility.selectedWindow(optionLabel) : undefined}
              tabIndex={checked ? 0 : -1}
              data-window={option}
              className={CHIP_CLASS}
              onClick={() => onChange(option)}
              onKeyDown={onChipKeyDown}
            >
              <CalendarDays className={styles.icon} aria-hidden="true" />
              <span dir="auto">{optionLabel}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
