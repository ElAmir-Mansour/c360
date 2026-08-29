import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { ResourcesSite } from '@/components/marketing/clario360/site/resources';
import { createMarketingMetadata } from '@/lib/marketing/metadata';

export const metadata = createMarketingMetadata({
  title: 'Resources & Documentation — Clario360',
  description:
    'Clario360 datasheets, deployment guides, security documentation, compliance mappings and developer references.',
  path: '/resources',
});

export default async function ResourcesPage() {
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <ResourcesSite />
    </Clario360MarketingShell>
  );
}
