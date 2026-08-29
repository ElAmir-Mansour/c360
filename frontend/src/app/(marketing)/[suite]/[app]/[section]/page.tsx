import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { WatheeqCapabilityPage } from '@/components/marketing/clario360/site/watheeq-capability';
import { createMarketingMetadata, getMarketingSuite } from '@/lib/marketing';
import {
  getWatheeqDomain,
  WATHEEQ_DOMAIN_SLUGS,
} from '@/lib/marketing/watheeq-capabilities';

interface SectionPageProps {
  params: Promise<{ suite: string; app: string; section: string }>;
}

/* Only the Watheeq capability domains have drill-down pages today. */
export function generateStaticParams() {
  return WATHEEQ_DOMAIN_SLUGS.map((section) => ({
    suite: 'business-plus',
    app: 'watheeq',
    section,
  }));
}

export async function generateMetadata({
  params,
}: SectionPageProps): Promise<Metadata> {
  const { suite, app, section } = await params;
  const domain = app === 'watheeq' ? getWatheeqDomain(section) : undefined;
  return createMarketingMetadata({
    title: domain
      ? `${domain.title.en} — WatheeqTech — Clario360`
      : 'Clario360',
    description: domain?.intro.en ?? 'Clario360 capability detail.',
    path: `/${suite}/${app}/${section}`,
  });
}

export default async function SectionPage({ params }: SectionPageProps) {
  const { suite, app, section } = await params;
  const suiteSummary = getMarketingSuite(suite);
  const appSummary = suiteSummary?.apps.find((item) => item.id === app);
  const domain = app === 'watheeq' ? getWatheeqDomain(section) : undefined;

  if (!suiteSummary || !appSummary || !domain) {
    notFound();
  }

  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <WatheeqCapabilityPage
        suite={suiteSummary}
        app={appSummary}
        domain={domain}
      />
    </Clario360MarketingShell>
  );
}
