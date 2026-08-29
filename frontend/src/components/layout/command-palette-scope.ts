import { SUITE_ROUTE_SEGMENTS, familyOf } from '@/config/navigation';

export type PaletteProductScope = string | null;
export type PaletteSearchSourceScope = string | 'platform';

const SUITE_SEGMENTS = new Set<string>(SUITE_ROUTE_SEGMENTS);

function firstPathSegment(value: string): string {
  const path = value.split(/[?#]/, 1)[0] ?? '';
  return path.split('/').filter(Boolean)[0] ?? '';
}

/** Resolve a route or destination to its product family (`/dr` => Recover). */
export function productFamilyFromPath(value: string | null | undefined): string | null {
  const segment = firstPathSegment(value ?? '');
  return SUITE_SEGMENTS.has(segment) ? familyOf(segment) : null;
}

/**
 * Resolve the product whose catalogue the global palette may expose.
 *
 * A route-owned product wins, followed by the sticky product context used on
 * shared shell routes. A tenant with exactly one subscribed/accessible product
 * remains scoped to it even on the all-suites landing route.
 */
export function resolvePaletteProductScope(
  pathname: string | null,
  stickySegment: string,
  accessibleProductFamilies: readonly string[],
): PaletteProductScope {
  const routeProduct = productFamilyFromPath(pathname);
  if (routeProduct) return routeProduct;

  const stickyProduct = productFamilyFromPath(`/${stickySegment}`);
  if (stickyProduct) return stickyProduct;

  const uniqueProducts = new Set(accessibleProductFamilies.map(familyOf));
  return uniqueProducts.size === 1 ? [...uniqueProducts][0] : null;
}

/**
 * Navigation destinations, recents, favorites and deep-link commands all pass
 * through this predicate. While a product is active, fail closed: only routes
 * in that product family are searchable. On the all-suites hub, expose only
 * products represented by the caller's current subscription/permission set;
 * platform-global destinations remain available there.
 */
export function isPaletteHrefInScope(
  href: string,
  activeProduct: PaletteProductScope,
  accessibleProductFamilies: readonly string[],
): boolean {
  const targetProduct = productFamilyFromPath(href);
  if (activeProduct) return targetProduct === activeProduct;
  if (!targetProduct) return true;
  return new Set(accessibleProductFamilies.map(familyOf)).has(targetProduct);
}

/** Applied before React Query is configured, so other products are not queried. */
export function isPaletteSearchSourceInScope(
  sourceProduct: PaletteSearchSourceScope,
  activeProduct: PaletteProductScope,
  accessibleProductFamilies: readonly string[],
): boolean {
  if (activeProduct) return sourceProduct === activeProduct;
  if (sourceProduct === 'platform') return true;
  return new Set(accessibleProductFamilies.map(familyOf)).has(familyOf(sourceProduct));
}
