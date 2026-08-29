import { Clario360MarketingShell } from '@/components/marketing/clario360/clario360-shell';
import { NotFoundSite } from '@/components/marketing/clario360/site/not-found';
import { getMarketingLocale } from '@/lib/marketing/locale.server';

export default async function NotFound() {
  // Resolve the persisted marketing locale server-side so the 404 shell + body
  // SSR the correct dir/lang with no hydration flash (matches every page.tsx).
  const initialLocale = await getMarketingLocale();
  return (
    <Clario360MarketingShell initialLocale={initialLocale}>
      <NotFoundSite />
    </Clario360MarketingShell>
  );
}
