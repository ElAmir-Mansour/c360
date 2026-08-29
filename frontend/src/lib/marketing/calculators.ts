import { getMarketingSuite, type MarketingSuiteId } from './suites';
import type { MarketingLocale } from './messages';

export type MarketingDeploymentModel = 'SaaS' | 'On-premise' | 'Air-gapped';

export interface MarketingRoiResult {
  readonly stack: number;
  readonly platform: number;
  readonly save: number;
}

export function roiCompute(
  tools: number,
  usersHundreds: number,
  integrations: number,
): MarketingRoiResult {
  const users = usersHundreds * 100;
  const perToolBase = 42_000;
  const perUserStack = tools * 48;
  const integrationUpkeep = integrations * 16_000;
  const stack = tools * perToolBase + users * perUserStack + integrationUpkeep;
  const platform = 4 * 78_000 + users * 70 + 90_000;

  return { stack, platform, save: Math.max(0, stack - platform) };
}

const ARABIC_INDIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

function localizeMarketingDigits(value: string, locale: MarketingLocale): string {
  if (locale !== 'ar') return value;

  return value.replace(/[0-9.,]/g, (char) => {
    if (char === '.') return '٫';
    if (char === ',') return '٬';
    return ARABIC_INDIC_DIGITS[Number(char)];
  });
}

export function formatMarketingMoney(value: number, locale: MarketingLocale = 'en'): string {
  let formatted: string;

  if (value >= 1_000_000) {
    formatted = `$${(value / 1_000_000).toFixed(2)}M`;
  } else if (value >= 1_000) {
    formatted = `$${Math.round(value / 1_000)}K`;
  } else {
    formatted = `$${Math.round(value)}`;
  }

  return localizeMarketingDigits(formatted, locale);
}

export function getSuiteConfigurationSummary(
  suiteIds: readonly MarketingSuiteId[],
  deployment: MarketingDeploymentModel,
) {
  const suites = suiteIds
    .map((suiteId) => getMarketingSuite(suiteId))
    .filter((suite): suite is NonNullable<typeof suite> => Boolean(suite));
  const appCount = suites.reduce((total, suite) => total + suite.apps.length, 0);
  let tier = '—';

  if (deployment === 'Air-gapped') {
    tier = 'Sovereign';
  } else if (suites.length >= 3) {
    tier = 'Platform';
  } else if (suites.length >= 1) {
    tier = 'Suite';
  }

  return {
    suites,
    appCount,
    tier,
    selectedLabel: suites.length
      ? suites.map((suite) => suite.name.replace(' Suite', '')).join(', ')
      : 'No suites yet',
  };
}
