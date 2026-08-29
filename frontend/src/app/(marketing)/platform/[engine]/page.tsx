import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { EngineSite } from '@/components/marketing/clario360/site/engine';
import {
  PLATFORM_ENGINE_ROUTE_PARAMS,
  createMarketingMetadata,
  getPlatformEngine,
  getPlatformEngineDetail,
} from '@/lib/marketing';

interface PlatformEnginePageProps {
  params: Promise<{ engine: string }>;
}

export function generateStaticParams() {
  return [...PLATFORM_ENGINE_ROUTE_PARAMS];
}

export async function generateMetadata({
  params,
}: PlatformEnginePageProps): Promise<Metadata> {
  const { engine } = await params;
  const engineSummary = getPlatformEngine(engine);

  return createMarketingMetadata({
    title: `${engineSummary?.name ?? engine} — Platform Core — Clario360`,
    description:
      engineSummary?.description ??
      'Clario360 platform-core engine detail page.',
    path: `/platform/${engine}`,
  });
}

export default async function PublicPlatformEnginePage({
  params,
}: PlatformEnginePageProps) {
  const { engine } = await params;
  const engineSummary = getPlatformEngine(engine);
  const detail = getPlatformEngineDetail(engine);

  if (!engineSummary || !detail) {
    notFound();
  }

  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <EngineSite engine={engineSummary} detail={detail} />
    </Clario360MarketingShell>
  );
}
