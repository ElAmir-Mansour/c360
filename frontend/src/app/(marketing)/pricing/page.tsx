import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { PricingSite } from '@/components/marketing/clario360/site/pricing';
import { createMarketingMetadata } from '@/lib/marketing/metadata';

export const metadata = createMarketingMetadata({
  title: 'Pricing — Clario360',
  description:
    'Clario360 suite, platform and sovereign pricing packaging with a public suite configurator.',
  path: '/pricing',
});

export default async function PricingPage() {
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <PricingSite />
    </Clario360MarketingShell>
  );
}
