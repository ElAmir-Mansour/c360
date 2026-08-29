/**
 * Shared motion primitives — reduced-motion-aware components plus the
 * token-bound variant presets from `@/lib/motion`, re-exported so feature code
 * has a single import surface:
 *
 *   import { PageTransition, StaggerList, StaggerItem, slideUp } from '@/components/shared/motion';
 */
export { PageTransition } from './page-transition';
export { StaggerItem, StaggerList } from './stagger-list';
export {
  dsDuration,
  dsEase,
  enterTransition,
  exitTransition,
  fadeIn,
  slideUp,
  scaleIn,
  listStagger,
  listItem,
  pageEnter,
} from '@/lib/motion';
