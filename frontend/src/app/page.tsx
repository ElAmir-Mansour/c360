import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { HomeSite } from '@/components/marketing/clario360/site/home';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { createMarketingMetadata } from '@/lib/marketing/metadata';

export const metadata = createMarketingMetadata({
  title: 'Clario360 — The Sovereign Enterprise Platform',
  description:
    'One platform. Four suites. A sovereign, Arabic-first enterprise core for data resilience, operations, security and analytics.',
  path: '/',
});

export default async function MarketingHomePage() {
  // Resolve the persisted marketing locale server-side so the home hero, nav and
  // footer render in the right language/direction with no hydration flash.
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <HomeSite />
    </Clario360MarketingShell>
  );
}
