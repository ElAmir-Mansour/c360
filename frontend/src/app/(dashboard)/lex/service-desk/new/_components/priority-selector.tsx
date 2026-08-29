'use client';

/**
 * PrioritySelector — segmented Priority control for the "New Legal Request"
 * wizard (improvement #8). Replaces the bare Priority <Select> and the urgency
 * justification <Textarea> block in step 2.
 *
 * Two selectable cards (md:grid-cols-2) with radio semantics:
 *   - NORMAL (Gauge)   — neutral / emerald accent when selected.
 *   - URGENT (Zap)     — amber/red accent when selected; an AlertTriangle audit
 *                        note + a revealed justification area (suggested-reason
 *                        Select + free-text Textarea).
 *
 * Fully CONTROLLED and self-contained: priority is driven by `value`/`onChange`;
 * the urgency free text by `urgency`/`onUrgencyChange`. Keyboard accessible
 * (role="radiogroup"/role="radio", aria-checked, roving tabindex, arrow-key
 * navigation, Enter/Space to select). All directional styling uses logical CSS
 * (ps-/pe-/ms-/me-/start-/end-) so it is RTL-correct.
 */

import { useId, useRef, type KeyboardEvent } from 'react';
import {
  ClipboardCheck,
  GitBranch,
  TimerReset,
  type LucideIcon,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import type { RequestPriority } from '@/lib/lex/requests';
import {
  URGENCY_REASON_KEYS,
  usePriorityLabels,
  type PriorityLabels,
  type UrgencyReasonKey,
} from '../_lib/priority-i18n';

/** The non-"other" reason → seed-text map, sourced from the i18n contract. */
type ReasonSeeds = PriorityLabels['reasonSeed'];

export interface PrioritySelectorProps {
  value: RequestPriority;
  onChange: (priority: RequestPriority) => void;
  urgency: string;
  onUrgencyChange: (value: string) => void;
  urgencyError?: string;
  /** Optional short SLA blurbs shown on each card. */
  slaHint?: { normal?: string; urgent?: string; emergency?: string };
}

/** Ordered options so arrow-key navigation has a stable sequence. */
const PRIORITY_ORDER: readonly RequestPriority[] = ['normal', 'urgent', 'emergency'] as const;

export default function PrioritySelector({
  value,
  onChange,
  urgency,
  onUrgencyChange,
  urgencyError,
  slaHint,
}: PrioritySelectorProps) {
  const { locale, direction } = useLocaleOrDefault();
  const isRtl = direction === 'rtl';
  const t = usePriorityLabels();

  const baseId = useId();
  const errorId = `${baseId}-urgency-error`;
  const reasonId = `${baseId}-reason`;
  const justificationId = `${baseId}-justification`;
  const cardRefs = useRef<Record<RequestPriority, HTMLButtonElement | null>>({
    normal: null,
    urgent: null,
    emergency: null,
  });

  const focusPriority = (next: RequestPriority) => {
    cardRefs.current[next]?.focus();
  };

  const moveSelection = (delta: number) => {
    const index = PRIORITY_ORDER.indexOf(value);
    const nextIndex = (index + delta + PRIORITY_ORDER.length) % PRIORITY_ORDER.length;
    const next = PRIORITY_ORDER[nextIndex];
    onChange(next);
    focusPriority(next);
  };

  const onCardKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
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

  const reasonValue = deriveReasonKey(urgency, t.reasonSeed);

  const onReasonChange = (rawKey: string) => {
    const key = rawKey as UrgencyReasonKey;
    if (key === 'other') {
      // Drop a previously-seeded prefix so the field reads as free text again.
      onUrgencyChange(stripKnownSeeds(urgency, t.reasonSeed));
      return;
    }
    const seed = t.reasonSeed[key];
    const stripped = stripKnownSeeds(urgency, t.reasonSeed);
    // Seed the textarea but keep any text the user already typed.
    onUrgencyChange(`${seed}${stripped}`);
  };

  return (
    <div className="space-y-3">
      <span id={`${baseId}-legend`} className="text-sm font-medium leading-none">
        {t.legend}
      </span>

      <div
        role="radiogroup"
        aria-labelledby={`${baseId}-legend`}
        aria-label={t.groupAria}
        className="flex flex-wrap items-center gap-x-6 gap-y-3"
      >
        <PriorityCard
          ref={(node) => {
            cardRefs.current.normal = node;
          }}
          checked={value === 'normal'}
          title={t.normalTitle}
          blurb={t.normalBlurb}
          slaHint={slaHint?.normal}
          onSelect={() => onChange('normal')}
          onKeyDown={onCardKeyDown}
        />

        <PriorityCard
          ref={(node) => {
            cardRefs.current.urgent = node;
          }}
          checked={value === 'urgent'}
          title={t.urgentTitle}
          blurb={t.urgentBlurb}
          slaHint={slaHint?.urgent}
          onSelect={() => onChange('urgent')}
          onKeyDown={onCardKeyDown}
        />

        <PriorityCard
          ref={(node) => {
            cardRefs.current.emergency = node;
          }}
          checked={value === 'emergency'}
          title={t.emergencyTitle}
          blurb={t.emergencyBlurb}
          slaHint={slaHint?.emergency}
          onSelect={() => onChange('emergency')}
          onKeyDown={onCardKeyDown}
        />
      </div>

      {value === 'urgent' ? (
        <div
          className={cn(
            'space-y-3 rounded-xl border p-4 transition-colors',
            urgencyError
              ? 'border-destructive/40 bg-destructive/5'
              : 'border-warning-100 bg-warning-50/60 dark:border-warning-800/40 dark:bg-warning-800/20',
          )}
        >
          <p className="text-sm font-medium">{t.justificationLegend}</p>

          <div className="rounded-lg border border-warning-200/80 bg-background/70 p-3 shadow-sm dark:border-warning-800/50 dark:bg-background/30">
            <p className="text-xs font-semibold uppercase text-warning-800 dark:text-warning-200">
              {t.urgentConsequencesTitle}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <ConsequenceItem icon={ClipboardCheck} label={t.urgentConsequences.audit} />
              <ConsequenceItem icon={GitBranch} label={t.urgentConsequences.escalation} />
              <ConsequenceItem icon={TimerReset} label={t.urgentConsequences.slaApproval} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>{t.reasonLabel}</Label>
            <Select value={reasonValue} onValueChange={onReasonChange}>
              <SelectTrigger id={reasonId}>
                <SelectValue placeholder={t.reasonPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {URGENCY_REASON_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t.reasons[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={justificationId}>{t.justificationLabel}</Label>
            <p className="text-xs text-muted-foreground">{t.justificationHint}</p>
            <Textarea
              id={justificationId}
              value={urgency}
              onChange={(event) => onUrgencyChange(event.target.value)}
              placeholder={t.justificationPlaceholder}
              rows={3}
              dir={locale === 'ar' ? 'rtl' : 'ltr'}
              aria-invalid={urgencyError ? true : undefined}
              aria-describedby={urgencyError ? errorId : undefined}
              className={cn(urgencyError && 'border-destructive focus-visible:ring-destructive')}
            />
            {urgencyError ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {urgencyError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Urgent consequence note.
 * ------------------------------------------------------------------------- */

function ConsequenceItem({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-warning-50/70 px-2.5 py-2 text-xs text-warning-800 dark:bg-warning-800/20 dark:text-warning-200">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Card.
 * ------------------------------------------------------------------------- */

interface PriorityCardProps {
  checked: boolean;
  title: string;
  blurb: string;
  slaHint?: string;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  ref?: (node: HTMLButtonElement | null) => void;
}

function PriorityCard({
  checked,
  title,
  blurb,
  slaHint,
  onSelect,
  onKeyDown,
  ref,
}: PriorityCardProps) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex h-auto min-h-0 w-auto items-center justify-start gap-2 whitespace-normal rounded-md p-0 text-start text-sm font-normal transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'hover:bg-transparent hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border bg-card',
          checked ? 'border-primary' : 'border-border',
        )}
      >
        {checked ? <span className="h-2 w-2 rounded-full bg-primary" aria-hidden /> : null}
      </span>

      <span className="text-sm text-foreground">
        {title}
        <span className="ms-1 text-muted-foreground">({slaHint ?? blurb})</span>
      </span>
    </Button>
  );
}

/* ------------------------------------------------------------------------- *
 * Seed helpers — keep the suggested-reason Select and the free-text Textarea in
 * sync without clobbering whatever the user has typed.
 * ------------------------------------------------------------------------- */

/** All concrete reason seed strings (used to detect/strip a prior seed). */
function seedValues(seeds: ReasonSeeds): string[] {
  return Object.values(seeds);
}

/** Resolve the Select value from the current text (matched seed → its key, else 'other'). */
function deriveReasonKey(text: string, seeds: ReasonSeeds): UrgencyReasonKey {
  const trimmedStart = text.replace(/^\s+/, '');
  for (const key of Object.keys(seeds) as Array<Exclude<UrgencyReasonKey, 'other'>>) {
    if (trimmedStart.startsWith(seeds[key])) {
      return key;
    }
  }
  return 'other';
}

/** Remove any known leading seed prefix so we don't stack seeds on re-selection. */
function stripKnownSeeds(text: string, seeds: ReasonSeeds): string {
  const trimmedStart = text.replace(/^\s+/, '');
  for (const seed of seedValues(seeds)) {
    if (trimmedStart.startsWith(seed)) {
      return trimmedStart.slice(seed.length);
    }
  }
  return text;
}
