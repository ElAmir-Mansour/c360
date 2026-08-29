'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * AbstractVisual
 * ==============
 * A tasteful, fully original abstract product visual used as the default
 * `visual` slot for marketing blocks (Hero / AlternatingFeatureBlock) when the
 * caller does not supply their own ReactNode.
 *
 * It evokes the ClarioDR domain — disaster-recovery runbook orchestration: a
 * sequence of recovery "steps" advancing along an orchestration spine, an
 * RTO/RTA progress ring, and replication "wave" arcs — WITHOUT depicting any
 * real product screenshot, customer mark, or third-party (e.g. Cutover) asset.
 *
 * Token-driven only: every colour/spacing/radius/shadow/motion value resolves
 * through Tailwind keys backed by the Phase-1 design tokens (brand-*, surface-*,
 * outline-*, content-*, rounded-card, shadow-elevation-*, duration + ease).
 * It re-themes automatically in dark mode and is direction-agnostic.
 *
 * Decorative by default (aria-hidden) — give it an accessible label via the
 * `label` prop to expose it as an `img` to assistive technology.
 */

export type AbstractVisualTone = 'primary' | 'teal' | 'gold';

export interface AbstractVisualProps {
  /**
   * Accessible label. When provided the visual is exposed as role="img" with
   * this name; otherwise it is treated as decorative (aria-hidden).
   */
  label?: string;
  /** Brand tone for the gradient field. Defaults to `primary`. */
  tone?: AbstractVisualTone;
  className?: string;
}

const toneFieldClass: Record<AbstractVisualTone, string> = {
  primary: 'from-brand-primary-600/15 via-brand-teal-500/10 to-brand-gold-400/15',
  teal: 'from-brand-teal-600/18 via-brand-teal-400/10 to-brand-primary-500/12',
  gold: 'from-brand-gold-400/18 via-brand-gold-300/8 to-brand-primary-500/12',
};

const toneStroke: Record<AbstractVisualTone, string> = {
  primary: 'text-brand-primary-600',
  teal: 'text-brand-teal-600',
  gold: 'text-brand-gold-500',
};

export function AbstractVisual({
  label,
  tone = 'primary',
  className,
}: AbstractVisualProps) {
  const decorative = label === undefined;

  return (
    <div
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      className={cn(
        'relative isolate aspect-[4/3] w-full overflow-hidden rounded-card border border-outline-subtle',
        'bg-gradient-to-br shadow-elevation-3',
        toneFieldClass[tone],
        className,
      )}
    >
      {/* Soft surface wash so content reads in light + dark. */}
      <div className="absolute inset-0 bg-surface-card/40" />

      {/* Orchestration spine + recovery-step motif. */}
      <svg
        viewBox="0 0 320 240"
        fill="none"
        preserveAspectRatio="xMidYMid meet"
        className={cn('absolute inset-0 h-full w-full', toneStroke[tone])}
      >
        {/* Replication wave arcs (decelerating concentric sweeps). */}
        {[0, 1, 2].map((i) => (
          <circle
            key={`wave-${i}`}
            cx="248"
            cy="64"
            r={26 + i * 22}
            className="stroke-current opacity-20"
            strokeWidth="1.5"
            strokeDasharray="3 7"
          />
        ))}

        {/* Orchestration spine. */}
        <path
          d="M48 200 L48 96 Q48 80 64 80 L208 80"
          className="stroke-current opacity-40"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Recovery-step nodes advancing along the spine. */}
        {[
          { x: 48, y: 200 },
          { x: 48, y: 152 },
          { x: 48, y: 104 },
          { x: 104, y: 80 },
          { x: 160, y: 80 },
          { x: 208, y: 80 },
        ].map((node, i) => (
          <g key={`node-${i}`}>
            <circle
              cx={node.x}
              cy={node.y}
              r="9"
              className="fill-surface-card stroke-current"
              strokeWidth="2"
            />
            <circle
              cx={node.x}
              cy={node.y}
              r="3.5"
              className="fill-current"
              opacity={i <= 3 ? 1 : 0.35}
            />
          </g>
        ))}

        {/* RTO/RTA progress ring. */}
        <circle
          cx="248"
          cy="172"
          r="34"
          className="stroke-outline-subtle"
          strokeWidth="6"
        />
        <circle
          cx="248"
          cy="172"
          r="34"
          className="stroke-current transition-all duration-reveal ease-decelerate"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray="214"
          strokeDashoffset="64"
          transform="rotate(-90 248 172)"
        />
        <circle cx="248" cy="172" r="6" className="fill-current" />
      </svg>

      {/* Floating "elevation" card chip — purely decorative depth cue. */}
      <div className="absolute bottom-card-padding start-card-padding rounded-button bg-surface-raised/90 px-3 py-2 shadow-elevation-2 backdrop-blur-sm">
        <span className="block h-1.5 w-12 rounded-pill bg-brand-primary-500/70" />
        <span className="mt-1.5 block h-1.5 w-8 rounded-pill bg-content-muted/40" />
      </div>
    </div>
  );
}

export default AbstractVisual;
