'use client';

/**
 * Tokens section — every swatch renders straight from the live CSS variables
 * (`hsl(var(--ds-*))` / `var(--ds-*)`), so the catalog can never drift from
 * `src/styles/tokens/tokens.css`. Resolved values are read from
 * `getComputedStyle` and re-read whenever the theme/dir toggles mutate the
 * <html> element, so flipping light/dark updates the readouts live.
 */

import * as React from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DsSection, Specimen, TokenChip } from './specimen';

/* -------------------------------------------------------------------------- */
/* Live token resolution                                                       */
/* -------------------------------------------------------------------------- */

/** Bumps whenever <html class|dir|style> mutates (theme / dir toggles). */
function useRootVersion(): number {
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    setVersion((v) => v + 1); // initial client read
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'dir', 'style', 'data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  return version;
}

const RootVersionContext = React.createContext(0);

/** Live readout of a CSS custom property's computed value. */
function TokenValue({ name, className }: { name: string; className?: string }) {
  const version = React.useContext(RootVersionContext);
  const [value, setValue] = React.useState('');
  React.useEffect(() => {
    setValue(
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    );
  }, [name, version]);
  return (
    <span
      dir="ltr"
      className={cn('truncate font-mono text-caption text-muted-foreground', className)}
    >
      {value || '…'}
    </span>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

/* -------------------------------------------------------------------------- */
/* Color ramps                                                                 */
/* -------------------------------------------------------------------------- */

const RAMP_STEPS_FULL = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const RAMP_STEPS_NEUTRAL = [0, 50, 100, 150, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950];
const RAMP_STEPS_STATE = [50, 100, 300, 500, 600, 700];

const COLOR_RAMPS: ReadonlyArray<{ name: string; steps: number[] }> = [
  { name: 'primary', steps: RAMP_STEPS_FULL },
  { name: 'gold', steps: RAMP_STEPS_FULL },
  { name: 'teal', steps: RAMP_STEPS_FULL },
  { name: 'neutral', steps: RAMP_STEPS_NEUTRAL },
  { name: 'success', steps: RAMP_STEPS_STATE },
  { name: 'warning', steps: RAMP_STEPS_STATE },
  { name: 'error', steps: RAMP_STEPS_STATE },
  { name: 'info', steps: RAMP_STEPS_STATE },
];

function ColorRamp({ name, steps }: { name: string; steps: number[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{name}</span>
        <TokenChip>{`--ds-${name}-*`}</TokenChip>
      </div>
      <div
        role="img"
        aria-label={`${name} color ramp, ${steps.length} steps`}
        className="flex overflow-hidden rounded-lg border border-border/60 shadow-elevation-1"
      >
        {steps.map((step) => (
          <div
            key={step}
            title={`--ds-${name}-${step}`}
            className="h-12 min-w-0 flex-1"
            style={{ background: `hsl(var(--ds-${name}-${step}))` }}
          />
        ))}
      </div>
      <div className="flex" aria-hidden>
        {steps.map((step) => (
          <span
            key={step}
            className="min-w-0 flex-1 text-center font-mono text-caption text-muted-foreground"
          >
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Semantic colors                                                             */
/* -------------------------------------------------------------------------- */

const SEMANTIC_GROUPS: ReadonlyArray<{
  title: string;
  tokens: ReadonlyArray<{ name: string; note?: string }>;
}> = [
  {
    title: 'Backgrounds & surfaces',
    tokens: [
      { name: '--ds-bg-page', note: 'app canvas' },
      { name: '--ds-bg-subtle' },
      { name: '--ds-bg-inset' },
      { name: '--ds-surface-card', note: 'cards, tables' },
      { name: '--ds-surface-raised' },
      { name: '--ds-surface-sunken' },
      { name: '--ds-surface-overlay', note: 'toasts, popovers' },
    ],
  },
  {
    title: 'Text',
    tokens: [
      { name: '--ds-text-primary' },
      { name: '--ds-text-secondary' },
      { name: '--ds-text-muted', note: 'WCAG AA on card/subtle' },
      { name: '--ds-text-inverted' },
      { name: '--ds-text-on-primary' },
      { name: '--ds-text-on-accent' },
    ],
  },
  {
    title: 'Borders',
    tokens: [
      { name: '--ds-border-subtle' },
      { name: '--ds-border-default' },
      { name: '--ds-border-strong' },
      { name: '--ds-border-focus', note: 'focus ring' },
    ],
  },
  {
    title: 'Brand',
    tokens: [
      { name: '--ds-brand-primary' },
      { name: '--ds-brand-primary-hover' },
      { name: '--ds-brand-primary-active' },
      { name: '--ds-brand-gold' },
      { name: '--ds-brand-teal' },
    ],
  },
  {
    title: 'State',
    tokens: [
      { name: '--ds-state-success' },
      { name: '--ds-state-warning' },
      { name: '--ds-state-error' },
      { name: '--ds-state-info' },
    ],
  },
];

function SemanticSwatchRow({ name, note }: { name: string; note?: string }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span
        aria-hidden
        className="h-8 w-8 shrink-0 rounded-lg border border-border/60 shadow-elevation-1"
        style={{ background: `hsl(var(${name}))` }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TokenChip>{name}</TokenChip>
        {note && <span className="mt-0.5 text-caption text-muted-foreground">{note}</span>}
      </div>
      <TokenValue name={name} className="hidden max-w-40 sm:inline" />
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Spacing / radii / elevation / motion                                        */
/* -------------------------------------------------------------------------- */

const SPACE_TOKENS = [
  '--ds-space-1',
  '--ds-space-2',
  '--ds-space-3',
  '--ds-space-4',
  '--ds-space-5',
  '--ds-space-6',
  '--ds-space-8',
  '--ds-space-10',
  '--ds-space-12',
  '--ds-space-16',
  '--ds-space-20',
  '--ds-space-24',
];

const NAMED_SPACE_TOKENS = [
  '--ds-space-gutter',
  '--ds-space-section-x',
  '--ds-space-section-y',
  '--ds-space-card-padding',
];

const RADIUS_TOKENS = [
  '--ds-radius-xs',
  '--ds-radius-sm',
  '--ds-radius-md',
  '--ds-radius-lg',
  '--ds-radius-xl',
  '--ds-radius-2xl',
  '--ds-radius-3xl',
  '--ds-radius-input',
  '--ds-radius-button',
  '--ds-radius-card',
  '--ds-radius-panel',
  '--ds-radius-pill',
];

const ELEVATION_TOKENS = [
  '--ds-elevation-0',
  '--ds-elevation-1',
  '--ds-elevation-2',
  '--ds-elevation-3',
  '--ds-elevation-4',
  '--ds-elevation-5',
  '--ds-elevation-focus',
];

const DURATION_TOKENS = [
  '--ds-duration-instant',
  '--ds-duration-fast',
  '--ds-duration-normal',
  '--ds-duration-slow',
  '--ds-duration-reveal',
  '--ds-duration-status',
];

const EASE_TOKENS = [
  '--ds-ease-standard',
  '--ds-ease-emphasized',
  '--ds-ease-decelerate',
  '--ds-ease-accelerate',
  '--ds-ease-spring',
];

function SpacingBar({ name }: { name: string }) {
  return (
    <li className="flex items-center gap-3 py-1">
      <TokenChip>{name}</TokenChip>
      <span
        aria-hidden
        className="h-3 rounded-sm bg-primary/70"
        style={{ inlineSize: `var(${name})` }}
      />
      <TokenValue name={name} />
    </li>
  );
}

function RadiusTile({ name }: { name: string }) {
  return (
    <li className="flex flex-col items-center gap-1.5">
      <span
        aria-hidden
        className="h-14 w-14 border-2 border-primary/60 bg-primary/10"
        style={{ borderRadius: `var(${name})` }}
      />
      <TokenChip>{name.replace('--ds-radius-', '')}</TokenChip>
      <TokenValue name={name} />
    </li>
  );
}

function ElevationTile({ name }: { name: string }) {
  return (
    <li className="flex flex-col items-center gap-2">
      <span
        aria-hidden
        className="h-16 w-24 rounded-xl border border-border/40 bg-card"
        style={{ boxShadow: `var(${name})` }}
      />
      <TokenChip>{name.replace('--ds-', '')}</TokenChip>
    </li>
  );
}

/** Click-to-replay motion specimen: one dot per duration, all token-driven. */
function MotionDurations() {
  const reduced = usePrefersReducedMotion();
  const [run, setRun] = React.useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRun((r) => !r)}
        >
          <Play className="me-2 h-3.5 w-3.5" aria-hidden />
          {run ? 'Reset' : 'Play durations'}
        </Button>
        {reduced && (
          <p className="mt-1.5 text-caption text-muted-foreground">
            prefers-reduced-motion is on — transitions are disabled, exactly as
            they would be in the product.
          </p>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {DURATION_TOKENS.map((name) => (
          <li key={name} className="flex items-center gap-3">
            <TokenChip>{name.replace('--ds-duration-', '')}</TokenChip>
            <span className="relative h-4 flex-1 overflow-hidden rounded-full bg-muted/70">
              <span
                aria-hidden
                className="absolute top-0.5 h-3 w-3 rounded-full bg-primary"
                style={{
                  insetInlineStart: run ? 'calc(100% - 1rem)' : '0.125rem',
                  transitionProperty: 'inset-inline-start',
                  transitionDuration: reduced ? '0ms' : `var(${name})`,
                  transitionTimingFunction: 'var(--ds-ease-standard)',
                }}
              />
            </span>
            <TokenValue name={name} className="w-14 text-end" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EasingList() {
  return (
    <ul className="flex flex-col gap-1.5">
      {EASE_TOKENS.map((name) => (
        <li key={name} className="flex items-center justify-between gap-3">
          <TokenChip>{name}</TokenChip>
          <TokenValue name={name} className="max-w-56" />
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

export function TokensSection() {
  const version = useRootVersion();

  return (
    <RootVersionContext.Provider value={version}>
      <DsSection
        id="tokens"
        title="Tokens"
        description="The single source of truth in src/styles/tokens/tokens.css. Every swatch below is painted from the live CSS variable — flip the theme toggle above and watch the resolved values change; nothing here is a copied hex."
      >
        <Specimen
          title="Color ramps"
          description="brand + neutral + state ramps, consumed as hsl(var(--ds-…))"
          code={`/* Tailwind (preferred) */\n<span className="bg-primary-600 text-primary-50" />\n/* Raw variable (charts, inline art) */\nstyle={{ background: 'hsl(var(--ds-primary-600))' }}`}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            {COLOR_RAMPS.map((ramp) => (
              <ColorRamp key={ramp.name} name={ramp.name} steps={ramp.steps} />
            ))}
          </div>
        </Specimen>

        <Specimen
          title="Semantic colors"
          description="theme-aware roles — these flip automatically in dark mode"
        >
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
            {SEMANTIC_GROUPS.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </h3>
                <ul className="mt-2 divide-y divide-border/50">
                  {group.tokens.map((token) => (
                    <SemanticSwatchRow key={token.name} {...token} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Specimen>

        <div className="grid gap-8 lg:grid-cols-2">
          <Specimen
            title="Spacing"
            description="8pt scale + named layout rhythm"
            code={`<div className="gap-gutter px-section-x py-section-y p-card-padding" />`}
          >
            <ul className="flex flex-col">
              {SPACE_TOKENS.map((name) => (
                <SpacingBar key={name} name={name} />
              ))}
            </ul>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Named rhythm
            </h3>
            <ul className="mt-1 flex flex-col">
              {NAMED_SPACE_TOKENS.map((name) => (
                <SpacingBar key={name} name={name} />
              ))}
            </ul>
          </Specimen>

          <Specimen
            title="Radii"
            description="size scale + named component radii"
            code={`<button className="rounded-button" /> <div className="rounded-card" />`}
          >
            <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4">
              {RADIUS_TOKENS.map((name) => (
                <RadiusTile key={name} name={name} />
              ))}
            </ul>
          </Specimen>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <Specimen
            title="Elevation"
            description="layered soft shadows, re-tuned per theme"
            code={`<div className="shadow-elevation-2" />  /* or shadow-elevation-2 */`}
          >
            <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4">
              {ELEVATION_TOKENS.map((name) => (
                <ElevationTile key={name} name={name} />
              ))}
            </ul>
          </Specimen>

          <Specimen
            title="Motion"
            description="duration + easing tokens; always pair with motion-safe"
            code={`<div className="transition-colors duration-fast ease-standard motion-safe:animate-fade-up" />`}
          >
            <MotionDurations />
            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Easing curves
            </h3>
            <div className="mt-2">
              <EasingList />
            </div>
          </Specimen>
        </div>
      </DsSection>
    </RootVersionContext.Provider>
  );
}
