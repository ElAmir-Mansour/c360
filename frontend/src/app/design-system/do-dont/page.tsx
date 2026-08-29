'use client';

/**
 * /design-system/do-dont — the platform UI rules, encoded as side-by-side
 * Do / Don’t pairs with live specimens and real code. Internal, English-only,
 * but built with logical utilities so the RTL preview toggle stays honest.
 */

import * as React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, slaMap } from '@/components/shared/status-badge';
import { EmptyState } from '@/components/common/empty-state';

import { DsShell } from '../_components/ds-shell';
import { CodeBlock, TokenChip } from '../_components/specimen';

/* -------------------------------------------------------------------------- */
/* Scaffolding                                                                 */
/* -------------------------------------------------------------------------- */

function DoPanel({ children, code }: { children?: React.ReactNode; code?: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-success-300/60 bg-success-50/60 dark:border-success-700/50 dark:bg-success-700/10">
      <p className="flex items-center gap-1.5 border-b border-success-300/50 px-3 py-2 text-xs font-semibold text-success-700 dark:border-success-700/40 dark:text-success-300">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Do
      </p>
      <div className="flex flex-1 flex-col gap-3 p-3">
        {children}
        {code && <CodeBlock code={code} className="bg-card/70" />}
      </div>
    </div>
  );
}

function DontPanel({ children, code }: { children?: React.ReactNode; code?: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-error-300/60 bg-error-50/60 dark:border-error-700/50 dark:bg-error-700/10">
      <p className="flex items-center gap-1.5 border-b border-error-300/50 px-3 py-2 text-xs font-semibold text-error-700 dark:border-error-700/40 dark:text-error-300">
        <XCircle className="h-3.5 w-3.5" aria-hidden />
        Don’t
      </p>
      <div className="flex flex-1 flex-col gap-3 p-3">
        {children}
        {code && <CodeBlock code={code} className="bg-card/70" />}
      </div>
    </div>
  );
}

function Rule({
  id,
  number,
  title,
  rationale,
  children,
}: {
  id: string;
  number: number;
  title: string;
  rationale: string;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="scroll-mt-28 rounded-2xl border border-border/70 bg-card p-5 shadow-elevation-1"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
        >
          {number}
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{rationale}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function DoDontPage() {
  return (
    <DsShell active="do-dont">
      <div className="flex flex-col gap-8">
        <div>
          <p className="text-overline font-semibold uppercase tracking-wide text-primary">
            The rules, encoded
          </p>
          <h1 className="mt-1 text-h1 font-semibold tracking-tight text-foreground">
            Do &amp; Don’t
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            These are the review criteria for every UI change. Each “Do” panel
            is live code from the design system; each “Don’t” is a real
            anti-pattern found (and removed) in this codebase.
          </p>
        </div>

        <Rule
          id="rule-tokens"
          number={1}
          title="No raw hex, no arbitrary color values — consume tokens"
          rationale="Hardcoded colors don’t re-theme in dark mode, fail contrast audits silently, and drift from the brand. Every color must resolve through a --ds-* variable (via the Tailwind semantic classes or hsl(var(--ds-…)))."
        >
          <DoPanel
            code={`<p className="text-muted-foreground">…</p>\n<div className="bg-primary/10 border-border" />\n/* charts / inline art */\nstroke="hsl(var(--ds-state-error))"`}
          >
            <p className="text-sm text-muted-foreground">
              Semantic classes re-theme automatically — this text is{' '}
              <TokenChip>text-muted-foreground</TokenChip>, readable in both themes.
            </p>
          </DoPanel>
          <DontPanel
            code={`<p style={{ color: '#6b7280' }}>…</p>\n<div className="bg-[#ff00aa] text-[13px]" />\nstroke="#ef4444"`}
          >
            <p className="text-sm text-muted-foreground">
              Raw hex and arbitrary Tailwind values (<TokenChip>bg-[#…]</TokenChip>,{' '}
              <TokenChip>text-[13px]</TokenChip>) bypass the theme and the type
              scale. They fail review.
            </p>
          </DontPanel>
        </Rule>

        <Rule
          id="rule-logical"
          number={2}
          title="Logical properties only — the app is RTL-first"
          rationale="Arabic is the default locale. Physical utilities (ml-, pr-, text-left) render mirrored layouts wrong. Use ms-/me-/ps-/pe-/text-start/text-end and start/end positioning; flip the header toggle to verify."
        >
          <DoPanel code={`<Icon className="me-2" />\n<div className="ps-4 text-start" />\n<span className="absolute start-3 top-2" />`}>
            <div className="rounded-lg border border-border/60 bg-card p-3">
              <span className="flex items-center text-sm text-foreground">
                <CheckCircle2 className="me-2 h-4 w-4 text-status-success" aria-hidden />
                Icon margin uses <TokenChip>me-2</TokenChip> — flip to RTL above and
                it stays on the correct side.
              </span>
            </div>
          </DoPanel>
          <DontPanel code={`<Icon className="mr-2" />\n<div className="pl-4 text-left" />\n<span className="absolute left-3 top-2" />`}>
            <p className="text-sm text-muted-foreground">
              Physical utilities keep the icon glued to the physical left, so in
              Arabic the icon lands on the wrong side of the label and paddings
              collapse against the reading direction.
            </p>
          </DontPanel>
        </Rule>

        <Rule
          id="rule-badges"
          number={3}
          title="One badge system — StatusBadge + a domain map"
          rationale="Status visuals must mean the same thing in every suite. StatusBadge resolves tone, label and icon from shared domain maps (severityMap, caseStatusMap, slaMap, genericStatusMap); hand-rolled pill spans fork the language and skip dark-mode/WCAG handling."
        >
          <DoPanel
            code={`import { StatusBadge, slaMap } from '@/components/shared/status-badge';\n\n<StatusBadge status="breached" map={slaMap} />`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status="on_track" map={slaMap} />
              <StatusBadge status="at_risk" map={slaMap} />
              <StatusBadge status="breached" map={slaMap} />
            </div>
          </DoPanel>
          <DontPanel
            code={`const STATUS_COLORS = {\n  breached: 'bg-red-100 text-red-700 dark:bg-red-950/40 …',\n};\n<span className={\`inline-flex rounded-full px-2.5 …\n  \${STATUS_COLORS[status]}\`}>{status}</span>`}
          >
            <p className="text-sm text-muted-foreground">
              Per-page color maps drift (this exact shape existed in several
              cyber pages): no icon, no WCAG 1.4.1 non-color signal, and each
              copy hardcodes its own dark-mode ramp.
            </p>
          </DontPanel>
        </Rule>

        <Rule
          id="rule-primitives"
          number={4}
          title="Consume the canonical primitives — don’t re-implement them"
          rationale="EmptyState, Skeleton, StatTile, DataTable, PageHeader and ConfirmDialog already handle loading, error, a11y, density, RTL and dark mode. A bespoke ‘No data’ div or a hand-rolled KPI card silently loses all of that."
        >
          <DoPanel
            code={`<EmptyState illustration="search" size="compact"\n  title="No results" action={{ label: 'Clear', onClick }} />`}
          >
            <div className="rounded-lg border border-border/60">
              <EmptyState
                illustration="search"
                size="compact"
                title="No results"
                description="Actionable, illustrated, token-driven."
              />
            </div>
          </DoPanel>
          <DontPanel code={`{items.length === 0 && (\n  <div className="p-8 text-center text-gray-400">\n    No data\n  </div>\n)}`}>
            <p className="text-sm text-muted-foreground">
              A dead-end string: no next action for the user, a hardcoded gray
              that fails contrast in dark mode, and a layout that differs from
              every other empty view.
            </p>
          </DontPanel>
        </Rule>

        <Rule
          id="rule-motion"
          number={5}
          title="Token motion, always guarded by motion-safe"
          rationale="Animation uses the --ds-duration-*/--ds-ease-* tokens and must be inert under prefers-reduced-motion. Skeleton shimmer, fade-ups and hover lifts in the system are already gated — custom animation must be too."
        >
          <DoPanel
            code={`<div className="transition-colors duration-fast ease-standard\n  motion-safe:animate-fade-up" />`}
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
            <p className="text-xs text-muted-foreground">
              The shimmer above pauses automatically when reduced motion is on.
            </p>
          </DoPanel>
          <DontPanel code={`<div className="animate-bounce duration-1000" />\n<div style={{ transition: 'all 0.3s ease-in-out' }} />`}>
            <p className="text-sm text-muted-foreground">
              Unguarded, arbitrary-duration animation ignores vestibular
              preferences and drifts from the shared motion feel
              (<TokenChip>transition: all</TokenChip> also causes layout jank).
            </p>
          </DontPanel>
        </Rule>

        <Rule
          id="rule-focus"
          number={6}
          title="Keep the focus ring — never outline-none without a replacement"
          rationale="Every interactive element needs a visible :focus-visible treatment. The system standardizes on the token focus ring; removing it breaks keyboard navigation for auditors and operators."
        >
          <DoPanel
            code={`className="outline-none focus-visible:ring-2\n  focus-visible:ring-ring focus-visible:ring-offset-2"`}
          >
            <Button variant="outline" size="sm">
              Tab to me — the ring is tokens
            </Button>
          </DoPanel>
          <DontPanel code={`className="outline-none"  /* and nothing else */`}>
            <p className="text-sm text-muted-foreground">
              Suppressing the outline without a <TokenChip>focus-visible</TokenChip>{' '}
              replacement makes the control invisible to keyboard users — an
              automatic accessibility failure.
            </p>
          </DontPanel>
        </Rule>

        <Rule
          id="rule-surfaces"
          number={7}
          title="Surfaces and elevation come from the system"
          rationale="Cards, panels and overlays use the component classes (.card, .surface-card, .toast-surface) or token elevation (shadow-[var(--ds-elevation-1)] … 5) — ad-hoc shadows and borders don’t re-tune for dark mode."
        >
          <DoPanel
            code={`<div className="rounded-2xl border border-border/70 bg-card\n  shadow-elevation-2" />`}
          >
            <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-elevation-2">
              <p className="text-sm text-foreground">
                Token elevation — deeper, softer shadows in dark mode
                automatically.
              </p>
            </div>
          </DoPanel>
          <DontPanel code={`<div className="shadow-lg border border-gray-200 bg-white" />`}>
            <p className="text-sm text-muted-foreground">
              <TokenChip>bg-white</TokenChip> and <TokenChip>border-gray-200</TokenChip>{' '}
              glow like a lightbox in dark mode; <TokenChip>shadow-lg</TokenChip>{' '}
              ignores the theme-tuned elevation set.
            </p>
          </DontPanel>
        </Rule>

        <Rule
          id="rule-verify"
          number={8}
          title="Verify in all four renderings before review"
          rationale="A change isn’t done until it looks right in light + dark AND LTR + RTL. The header toggles on every /design-system page exist precisely so this check costs seconds, not a deploy."
        >
          <DoPanel>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {[
                'Flip Light / Dark — no white flashes, no unreadable text.',
                'Flip LTR / RTL — icons, paddings and arrows mirror correctly.',
                'Tab through — every control shows the focus ring.',
                'Check loading, empty and error states, not just the happy path.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-status-success"
                    aria-hidden
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </DoPanel>
          <DontPanel>
            <p className="text-sm text-muted-foreground">
              “It looked fine on my machine” — in light mode, in English, with a
              mouse. That is one of eight renderings the platform actually
              ships.
            </p>
          </DontPanel>
        </Rule>
      </div>
    </DsShell>
  );
}
