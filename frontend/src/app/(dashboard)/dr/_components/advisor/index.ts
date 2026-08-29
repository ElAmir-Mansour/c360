/**
 * Recovery-tier & objective-fit advisor — barrel.
 *
 * Surfaces the per-site objective-fit advisory (protect route) and the
 * recovery-tier catalog (readiness route). Both are pure, prop-driven panels:
 * the routes own the query/action hooks and the dr:write guard, mirroring the
 * existing DR `_components` panel convention.
 */
export { ObjectiveFitAdvisor } from './objective-fit-advisor';
export type { ObjectiveFitAdvisorProps } from './objective-fit-advisor';

export { RecoveryTierCatalog } from './recovery-tier-catalog';
export type { RecoveryTierCatalogProps } from './recovery-tier-catalog';

export {
  advisorLabels,
  catalogLabels,
  useAdvisorLabels,
  useCatalogLabels,
  type AdvisorLabels,
  type CatalogLabels,
} from './advisor-labels';

export * from './advisor-format';
