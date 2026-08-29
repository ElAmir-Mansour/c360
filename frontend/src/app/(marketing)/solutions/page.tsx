import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { SolutionsSite } from '@/components/marketing/clario360/site/solutions';
import { createMarketingMetadata } from '@/lib/marketing/metadata';

export const metadata = createMarketingMetadata({
  title: 'Solutions by Role — Clario360',
  description:
    'Clario360 public solutions by role for IT, data, legal, risk, compliance, delivery, security, executives and board teams.',
  path: '/solutions',
});

export default async function SolutionsPage() {
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <SolutionsSite />
    </Clario360MarketingShell>
  );
}
