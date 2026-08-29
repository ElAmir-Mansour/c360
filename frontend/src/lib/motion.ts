/**
 * Motion system — framer-motion presets bound to the design-token motion scale.
 *
 * The numeric values are derived at module load from the canonical token source
 * (`src/styles/tokens/index.ts`, the same source that materializes
 * `--ds-duration-*` / `--ds-ease-*` in tokens.css and the Tailwind
 * `duration-*` / `ease-*` utilities), so JS-driven motion and CSS-driven motion
 * always share one scale. Never hardcode seconds or bezier curves in feature
 * code — import from here.
 *
 * Register: calm. Entrances are short fades with a small rise on the
 * decelerate curve; exits are faster on the accelerate curve. No spring
 * physics by default — reserve `dsEase.spring` for rare, deliberate emphasis.
 *
 * Reduced motion: these presets do NOT self-disable. Either consume the
 * ready-made components in `@/components/shared/motion` (PageTransition,
 * StaggerList) or pair with framer-motion's `useReducedMotion()` and pass
 * `initial={false}` when it returns true. (CSS animations are already covered
 * by the global prefers-reduced-motion guard in globals.css.)
 */
import type { Transition, Variants } from 'framer-motion';
import { duration as durationTokens, easing as easingTokens } from '@/styles/tokens';

/* -------------------------------------------------------------------------- */
/* Token bridge                                                               */
/* -------------------------------------------------------------------------- */

/** '140ms' → 0.14 (framer-motion durations are seconds). */
function msToSeconds(ms: string): number {
  return parseFloat(ms) / 1000;
}

/** 'cubic-bezier(0.2, 0, 0, 1)' → [0.2, 0, 0, 1] (framer-motion ease array). */
function bezierToArray(cubicBezier: string): [number, number, number, number] {
  const parts = cubicBezier
    .slice(cubicBezier.indexOf('(') + 1, cubicBezier.indexOf(')'))
    .split(',')
    .map((n) => parseFloat(n));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/** Durations in seconds, mirroring `--ds-duration-*`. */
export const dsDuration = {
  instant: msToSeconds(durationTokens.instant), // 0.08 — hover/press feedback
  fast: msToSeconds(durationTokens.fast), // 0.14 — micro-interactions, menus
  normal: msToSeconds(durationTokens.normal), // 0.22 — default UI transition
  slow: msToSeconds(durationTokens.slow), // 0.32 — panels / drawers
  reveal: msToSeconds(durationTokens.reveal), // 0.48 — scroll-reveal
  status: msToSeconds(durationTokens.status), // 0.6 — live-status pulses
} as const;

/** Easing curves as bezier arrays, mirroring `--ds-ease-*`. */
export const dsEase = {
  standard: bezierToArray(easingTokens.standard),
  emphasized: bezierToArray(easingTokens.emphasized),
  decelerate: bezierToArray(easingTokens.decelerate), // entering
  accelerate: bezierToArray(easingTokens.accelerate), // exiting
  spring: bezierToArray(easingTokens.spring), // gentle overshoot — use sparingly
} as const;

/* -------------------------------------------------------------------------- */
/* Shared transitions                                                         */
/* -------------------------------------------------------------------------- */

/** Default entrance: normal duration on the decelerate curve. */
export const enterTransition: Transition = {
  duration: dsDuration.normal,
  ease: dsEase.decelerate,
};

/** Default exit: fast duration on the accelerate curve. */
export const exitTransition: Transition = {
  duration: dsDuration.fast,
  ease: dsEase.accelerate,
};

/* -------------------------------------------------------------------------- */
/* Variant presets                                                            */
/*                                                                            */
/* All presets share the `hidden` / `visible` / `exit` vocabulary so they can */
/* be swapped freely:                                                         */
/*   <motion.div variants={slideUp} initial="hidden" animate="visible" />     */
/* -------------------------------------------------------------------------- */

/** Plain opacity fade. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: enterTransition },
  exit: { opacity: 0, transition: exitTransition },
};

/** Fade + small rise (8px) — cards, sections, empty states. */
export const slideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: enterTransition },
  exit: { opacity: 0, y: 8, transition: exitTransition },
};

/** Fade + subtle scale (0.97 → 1) — popcards, spotlight tiles. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: { opacity: 1, scale: 1, transition: enterTransition },
  exit: { opacity: 0, scale: 0.97, transition: exitTransition },
};

/**
 * Container variants for staggered lists. Children should use `listItem`
 * (variants propagate — children need no `initial`/`animate` of their own).
 */
export const listStagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: dsDuration.instant,
    },
  },
};

/** Item variants for children of a `listStagger` container. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: enterTransition },
  exit: { opacity: 0, transition: exitTransition },
};

/**
 * Route-change entrance: subtle fade + 2px rise on the `fast` token step
 * (140ms ≈ the 150ms register). Used by <PageTransition>.
 */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 2 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: dsDuration.fast, ease: dsEase.standard },
  },
};
