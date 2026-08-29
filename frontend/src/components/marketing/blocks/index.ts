/**
 * ClarioDR marketing content blocks (Phase 2).
 *
 * Composable, token-driven, accessible, RTL-first hero + feature-block grammar.
 * No page assembly here — proof pages are assembled in Phase 4.
 */
export { Hero } from './hero';
export type { HeroProps, HeroAction } from './hero';

export {
  AlternatingFeatureBlock,
  FeatureBlockList,
} from './alternating-feature-block';
export type {
  AlternatingFeatureBlockProps,
  FeatureBlockAction,
  FeatureBlockItem,
  FeatureBlockListProps,
} from './alternating-feature-block';

export { BenefitStrip } from './benefit-strip';
export type { BenefitStripProps, BenefitItem } from './benefit-strip';

export { CardGridFeatureRow } from './card-grid-feature-row';
export type {
  CardGridFeatureRowProps,
  FeatureCard,
} from './card-grid-feature-row';

export { AbstractVisual } from './abstract-visual';
export type { AbstractVisualProps, AbstractVisualTone } from './abstract-visual';
