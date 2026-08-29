import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { SuiteSite } from '@/components/marketing/clario360/site/suite';
import {
  MARKETING_SUITE_ROUTE_PARAMS,
  createMarketingMetadata,
  getMarketingSuite,
} from '@/lib/marketing';

interface SuitePageProps {
  params: Promise<{ suite: string }>;
}

export function generateStaticParams() {
  return [...MARKETING_SUITE_ROUTE_PARAMS];
}

export async function generateMetadata({
  params,
}: SuitePageProps): Promise<Metadata> {
  const { suite } = await params;
  const suiteSummary = getMarketingSuite(suite);

  return createMarketingMetadata({
    title: `${suiteSummary?.name ?? suite} — Clario360`,
    description:
      suiteSummary?.tagline ??
      'Clario360 public suite detail page.',
    path: `/${suite}`,
  });
}

export default async function SuitePage({ params }: SuitePageProps) {
  const { suite } = await params;
  const suiteSummary = getMarketingSuite(suite);

  if (!suiteSummary) {
    notFound();
  }

  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <SuiteSite suite={suiteSummary} />
    </Clario360MarketingShell>
  );
}
