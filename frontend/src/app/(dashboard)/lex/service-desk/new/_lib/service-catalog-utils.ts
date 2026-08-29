/**
 * Pure helpers for the Step-1 service-catalog selector: grouping by request type,
 * a locale-aware search filter, and a request-type humanizer. No React, no I/O —
 * everything here is referentially transparent and unit-testable in isolation.
 */
import type { ServiceCatalogEntry } from '@/lib/lex/requests';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';

/** One request-type bucket: the raw token plus its members (input order kept). */
export interface RequestTypeGroup {
  requestType: string;
  items: ServiceCatalogEntry[];
}

/**
 * groupByRequestType buckets services by their `request_type`, preserving the
 * order in which each request type is first encountered and the order of items
 * within each bucket. Stable and deterministic.
 */
export function groupByRequestType(
  services: ServiceCatalogEntry[],
): RequestTypeGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, ServiceCatalogEntry[]>();

  for (const service of services) {
    const key = service.request_type;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(service);
    } else {
      buckets.set(key, [service]);
      order.push(key);
    }
  }

  return order.map((requestType) => ({
    requestType,
    items: buckets.get(requestType) ?? [],
  }));
}

/**
 * filterServices returns the services whose name (active locale + the other
 * locale), description (active locale + the other locale), `code`, or
 * `request_type` contains `query` (case-insensitive, trimmed). An empty query
 * returns the list unchanged.
 */
export function filterServices(
  services: ServiceCatalogEntry[],
  query: string,
  locale: AppLocale,
): ServiceCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return services;
  }

  return services.filter((service) => {
    const haystacks = [
      resolveLocalized(service.name, locale),
      service.name.en,
      service.name.ar,
      resolveLocalized(service.description, locale),
      service.description.en,
      service.description.ar,
      service.code,
      service.request_type,
      humanizeRequestType(service.request_type),
    ];
    return haystacks.some((value) => value.toLowerCase().includes(needle));
  });
}

/**
 * humanizeRequestType turns a raw token like `contract_review` or
 * `contract-review` into a sentence-cased label `Contract review`. Word
 * separators (`_`, `-`, whitespace) collapse to single spaces; only the first
 * character is capitalized so multi-word types read as a phrase, not Title Case.
 */
export function humanizeRequestType(requestType: string): string {
  const cleaned = requestType.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) {
    return '';
  }
  const lower = cleaned.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * orderByRecentlyUsed resolves `recentlyUsedIds` against `services`, preserving
 * the id order and dropping ids with no (active) match. Used to surface the
 * "Recently used" group above the grouped catalog.
 */
export function orderByRecentlyUsed(
  services: ServiceCatalogEntry[],
  recentlyUsedIds: readonly string[],
): ServiceCatalogEntry[] {
  const byId = new Map(services.map((service) => [service.id, service]));
  const result: ServiceCatalogEntry[] = [];
  for (const id of recentlyUsedIds) {
    const match = byId.get(id);
    if (match) {
      result.push(match);
    }
  }
  return result;
}
