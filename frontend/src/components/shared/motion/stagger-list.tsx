'use client';

import * as React from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { listItem, listStagger } from '@/lib/motion';

type ContainerTag = 'div' | 'ul' | 'ol' | 'section';
type ItemTag = 'div' | 'li' | 'article';

// Narrow lookup tables instead of `motion[as]` so the element set stays
// intentional. The cast unifies the per-tag prop types; we only ever pass
// shared props (className, variants, children, plain HTML attributes).
const CONTAINERS: Record<ContainerTag, React.ElementType> = {
  div: motion.div,
  ul: motion.ul,
  ol: motion.ol,
  section: motion.section,
};

const ITEMS: Record<ItemTag, React.ElementType> = {
  div: motion.div,
  li: motion.li,
  article: motion.article,
};

interface StaggerListProps extends Omit<HTMLMotionProps<'div'>, 'variants' | 'initial' | 'animate'> {
  /** Rendered element — defaults to `div`; use `ul`/`ol` for semantic lists. */
  as?: ContainerTag;
  children: React.ReactNode;
}

/**
 * Staggered-entrance container bound to the token motion scale: children
 * wrapped in <StaggerItem> fade + rise 6px, 40ms apart, on the decelerate
 * curve. Variants propagate, so items need no props of their own:
 *
 *   <StaggerList as="ul">
 *     {rows.map((r) => <StaggerItem as="li" key={r.id}>…</StaggerItem>)}
 *   </StaggerList>
 *
 * Under prefers-reduced-motion the list renders in its final state instantly
 * (`initial={false}` short-circuits the hidden pose for the whole subtree).
 */
export function StaggerList({ as = 'div', children, ...props }: StaggerListProps) {
  const reduceMotion = useReducedMotion();
  const Container = CONTAINERS[as];

  return (
    <Container
      variants={listStagger}
      initial={reduceMotion ? false : 'hidden'}
      animate="visible"
      {...props}
    >
      {children}
    </Container>
  );
}

interface StaggerItemProps extends Omit<HTMLMotionProps<'div'>, 'variants'> {
  /** Rendered element — defaults to `div`; use `li` inside `ul`/`ol` lists. */
  as?: ItemTag;
  children: React.ReactNode;
}

/** Child of <StaggerList>: inherits its timing via variant propagation. */
export function StaggerItem({ as = 'div', children, ...props }: StaggerItemProps) {
  const Item = ITEMS[as];

  return (
    <Item variants={listItem} {...props}>
      {children}
    </Item>
  );
}
