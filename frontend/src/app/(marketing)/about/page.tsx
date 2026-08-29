import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { AboutSite } from '@/components/marketing/clario360/site/about';
import { createMarketingMetadata } from '@/lib/marketing/metadata';

export const metadata = createMarketingMetadata({
  title: 'About — Clario360',
  description:
    'About the Clario360 sovereign, Arabic-first, platform-first enterprise architecture.',
  path: '/about',
});

export default async function AboutPage() {
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <AboutSite />
    </Clario360MarketingShell>
  );
}
