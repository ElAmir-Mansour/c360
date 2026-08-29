import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { getMarketingLocale } from '@/lib/marketing/locale.server';
import { CompareSite } from '@/components/marketing/clario360/site/compare';
import { createMarketingMetadata } from '@/lib/marketing/metadata';

export const metadata = createMarketingMetadata({
  title: 'Why Clario360 — Platform vs Point Tools',
  description:
    'A category-level comparison of the Clario360 sovereign platform against stitched point-tool portfolios.',
  path: '/compare',
});

export default async function ComparePage() {
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <CompareSite />
    </Clario360MarketingShell>
  );
}
