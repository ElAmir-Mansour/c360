import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { PlatformSite } from '@/components/marketing/clario360/site/platform';
import { createMarketingMetadata } from '@/lib/marketing/metadata';

export const metadata = createMarketingMetadata({
  title: 'Platform Architecture — Clario360',
  description:
    'The shared Clario360 platform-core engines that power every public suite and application.',
  path: '/platform',
});

export default async function PublicPlatformPage() {
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <PlatformSite />
    </Clario360MarketingShell>
  );
}
