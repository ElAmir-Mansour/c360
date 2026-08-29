import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { SovereigntySite } from '@/components/marketing/clario360/site/sovereignty';
import { createMarketingMetadata } from '@/lib/marketing/metadata';

export const metadata = createMarketingMetadata({
  title: 'Sovereignty & Security — Clario360',
  description:
    'Clario360 sovereign deployment, security architecture and framework alignment for Saudi institutions.',
  path: '/sovereignty',
});

export default async function SovereigntyPage() {
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <SovereigntySite />
    </Clario360MarketingShell>
  );
}
