import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { ContactSite } from '@/components/marketing/clario360/site/contact';
import { createMarketingMetadata } from '@/lib/marketing/metadata';

export const metadata = createMarketingMetadata({
  title: 'Request a Demo — Clario360',
  description:
    'Request a Clario360 demo mapped to your suites, deployment model, frameworks and workflows.',
  path: '/contact',
});

export default async function ContactPage() {
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <ContactSite />
    </Clario360MarketingShell>
  );
}
