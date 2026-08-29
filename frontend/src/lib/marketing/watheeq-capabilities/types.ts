/**
 * Watheeq capability drill-down — data model for the per-domain detail pages
 * reached from the "Inside Watheeq" module cards (/{suite}/watheeq/{slug}).
 *
 * Content is sourced from the Watheeq legal capability catalog and framed for
 * a marketing audience. Bilingual (EN + AR). Generic only — NO client names.
 */

/** Delivery maturity of a capability (drives the status pill). */
export type WatheeqCapStatus = 'production' | 'configurable' | 'roadmap';

/** A bilingual string. */
export interface Bilingual {
  readonly en: string;
  readonly ar: string;
}

/** One capability within a domain. */
export interface WatheeqCapability {
  /** Short capability name. */
  readonly title: Bilingual;
  /** One-line, benefit-clear description of what it does. */
  readonly what: Bilingual;
  readonly status: WatheeqCapStatus;
}

/** A capability domain (one drill-down page). */
export interface WatheeqDomain {
  /** URL slug — matches the module `slug` on the Watheeq app page. */
  readonly slug: string;
  /** MarketingIcon name (matches the module card's icon). */
  readonly icon: string;
  /** Domain name. */
  readonly title: Bilingual;
  /** A short marketing intro sentence for the domain hero. */
  readonly intro: Bilingual;
  readonly capabilities: readonly WatheeqCapability[];
}
