import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { AppSite } from '@/components/marketing/clario360/site/app';
import {
  MARKETING_APP_ROUTE_PARAMS,
  createMarketingMetadata,
  getMarketingSuite,
} from '@/lib/marketing';

interface AppPageProps {
  params: Promise<{ suite: string; app: string }>;
}

export function generateStaticParams() {
  return [...MARKETING_APP_ROUTE_PARAMS];
}

export async function generateMetadata({
  params,
}: AppPageProps): Promise<Metadata> {
  const { suite, app } = await params;
  const suiteSummary = getMarketingSuite(suite);
  const appSummary = suiteSummary?.apps.find((item) => item.id === app);

  return createMarketingMetadata({
    title: suiteSummary && appSummary
      ? `${appSummary.name} — ${suiteSummary.name} — Clario360`
      : 'Clario360',
    description:
      appSummary?.short ??
      'Clario360 public application detail page.',
    path: `/${suite}/${app}`,
  });
}

export default async function AppPage({ params }: AppPageProps) {
  const { suite, app } = await params;
  const suiteSummary = getMarketingSuite(suite);
  const appSummary = suiteSummary?.apps.find((item) => item.id === app);

  if (!suiteSummary || !appSummary) {
    notFound();
  }

  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <AppSite suite={suiteSummary} app={appSummary} />
    </Clario360MarketingShell>
  );
}
