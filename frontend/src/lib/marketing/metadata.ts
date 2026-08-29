import type { Metadata, Viewport } from 'next';

export const MARKETING_SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://clario360.sa';

export const MARKETING_OG_IMAGE_PATH = '/opengraph-image';

export const MARKETING_DEFAULT_DESCRIPTION =
  'Clario360 is a sovereign enterprise platform built Arabic-first. One login, one audit, four suites on a configurable platform core. Deploys SaaS, on-premise, or fully air-gapped.';

export const MARKETING_VIEWPORT: Viewport = {
  themeColor: '#005E5E',
  colorScheme: 'light dark',
};

const marketingKeywords = [
  'sovereign enterprise platform',
  'Arabic-first software',
  'KSA',
  'disaster recovery',
  'DSPM',
  'GRC',
  'contract lifecycle',
  'board governance',
  'data security posture',
  'NCA',
  'SAMA',
  'PDPL',
  'air-gapped',
  'on-premise enterprise software',
];

export function normalizeMarketingPath(path = '/'): `/${string}` {
  if (path === '') {
    return '/';
  }

  return path.startsWith('/') ? (path as `/${string}`) : `/${path}`;
}

export function createMarketingMetadata({
  title,
  description = MARKETING_DEFAULT_DESCRIPTION,
  path = '/',
}: {
  title: string;
  description?: string;
  path?: string;
}): Metadata {
  const canonical = normalizeMarketingPath(path);

  return {
    metadataBase: new URL(MARKETING_SITE_URL),
    title,
    description,
    applicationName: 'Clario360',
    authors: [{ name: 'Clario360' }],
    creator: 'Clario360',
    publisher: 'Clario360',
    keywords: marketingKeywords,
    alternates: {
      canonical,
      languages: {
        en: canonical,
        ar: canonical,
      },
    },
    openGraph: {
      type: 'website',
      siteName: 'Clario360',
      title,
      description,
      url: canonical,
      locale: 'en_US',
      alternateLocale: ['ar_SA'],
      images: [
        {
          url: MARKETING_OG_IMAGE_PATH,
          width: 1200,
          height: 630,
          alt: 'Clario360 — four suites on one sovereign platform core',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [MARKETING_OG_IMAGE_PATH],
    },
    robots: {
      index: true,
      follow: true,
    },
    // Icons come from the App Router convention files (app/icon.svg,
    // app/apple-icon.svg, app/favicon.ico) — the Clario360 brand mark.
  };
}

export const MARKETING_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${MARKETING_SITE_URL}/#org`,
      name: 'Clario360',
      url: `${MARKETING_SITE_URL}/`,
      description:
        'Sovereign enterprise platform built Arabic-first, deploying SaaS, on-premise, or fully air-gapped.',
      areaServed: ['SA', 'AE', 'QA', 'KW', 'BH', 'OM'],
      knowsLanguage: ['ar', 'en'],
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Clario360',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, On-premise, Air-gapped',
      offers: {
        '@type': 'Offer',
        priceCurrency: 'SAR',
        price: '0',
        description:
          'Enterprise licensing, priced per suite and deployment model.',
      },
      featureList: [
        'DataStream Suite — disaster recovery, migration, change data capture, sovereign lakehouse',
        'Business+ Suite — legal, project delivery, GRC, executive, board governance',
        'ClarioSec Suite — CTEM, DSPM, UEBA, virtual CISO',
        'ClarioInsight Suite — data intelligence and dashboards',
      ],
      publisher: { '@id': `${MARKETING_SITE_URL}/#org` },
    },
  ],
} as const;
