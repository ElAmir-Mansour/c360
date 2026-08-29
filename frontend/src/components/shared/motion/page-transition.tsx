'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { pageEnter } from '@/lib/motion';

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Route-transition wrapper for main content: a subtle 140ms (token `fast`,
 * ≈150ms register) fade + 2px rise each time the pathname changes.
 *
 * - Keys its wrapper on the pathname, so page content remounts per route
 *   (mirrors the previous keyed `animate-fade-in` div in the dashboard shell).
 * - Fully static under prefers-reduced-motion (`useReducedMotion`): the same
 *   keyed remount happens, but nothing animates (WCAG 2.3.3).
 * - Entrance only — App Router unmounts the old route immediately, so exit
 *   animations would only add perceived latency. Calm register: no
 *   AnimatePresence, no springs.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div key={pathname} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      key={pathname}
      variants={pageEnter}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  );
}
