export type MarketingSuiteFamily = 'ds' | 'bp' | 'sec' | 'insight';

export type MarketingReleaseStatus = 'ga' | 'soon';

export interface MarketingSpec {
  readonly metric: string;
  readonly description: string;
}

export interface MarketingModule {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  /** Optional drill-down slug — when set, the module card links to
   *  /{suite}/{app}/{slug} (a capability-domain detail page). */
  readonly slug?: string;
}

export interface MarketingFlowStep {
  readonly step: string;
  readonly description: string;
}

export interface MarketingApp {
  readonly id: string;
  readonly name: string;
  readonly ar: string;
  readonly role: string;
  readonly icon: string;
  readonly status: MarketingReleaseStatus;
  readonly short: string;
  readonly hero: string;
  readonly desc: string;
  readonly specs: readonly MarketingSpec[];
  readonly modules: readonly MarketingModule[];
  readonly flow: readonly MarketingFlowStep[];
  readonly bench: string;
}

export interface MarketingSuite {
  readonly id: string;
  readonly name: string;
  /** Short Arabic descriptor shown beside the Latin suite name in bilingual chrome (footer). */
  readonly ar: string;
  readonly family: MarketingSuiteFamily;
  readonly tagline: string;
  readonly blurb: string;
  readonly core: string;
  readonly coreDesc: string;
  readonly apps: readonly MarketingApp[];
}

export interface MarketingAppWithSuite extends MarketingApp {
  readonly suiteId: string;
  readonly suiteName: string;
  readonly suiteFamily: MarketingSuiteFamily;
}

export interface MarketingPlatformEngine {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
}

export interface MarketingEnginePoint {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
}

export interface MarketingEngineDetail {
  readonly tag: string;
  readonly long: string;
  readonly points: readonly MarketingEnginePoint[];
  readonly consumers: readonly string[];
}

export interface MarketingPrinciple {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
}

