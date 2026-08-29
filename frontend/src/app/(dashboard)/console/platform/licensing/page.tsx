'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Boxes } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useT } from '@/components/providers/locale-provider';
import { PlansTab } from './_components/plans-tab';
import { TenantLicensesTab } from './_components/tenant-licenses-tab';
import { OverridesTab } from './_components/overrides-tab';
import { UsageSeatsTab } from './_components/usage-seats-tab';
import { ExpiriesTab } from './_components/expiries-tab';

const TABS = ['plans', 'licenses', 'overrides', 'usage', 'expiries'] as const;
type TabValue = (typeof TABS)[number];

function LicensingTabs() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams?.get('tab') ?? null;
  const active: TabValue = (TABS as readonly string[]).includes(raw ?? '')
    ? (raw as TabValue)
    : 'plans';

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', value);
    router.replace(`/platform/licensing?${params.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={active} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="plans">{t('platformConsole.licensing.plans')}</TabsTrigger>
        <TabsTrigger value="licenses">
          {t('platformConsole.licensing.tenantLicenses')}
        </TabsTrigger>
        <TabsTrigger value="overrides">
          {t('platformConsole.licensing.overrides')}
        </TabsTrigger>
        <TabsTrigger value="usage">
          {t('platformConsole.licensing.usageSeats')}
        </TabsTrigger>
        <TabsTrigger value="expiries">
          {t('platformConsole.licensing.expiries')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="plans">
        <PlansTab />
      </TabsContent>
      <TabsContent value="licenses">
        <TenantLicensesTab />
      </TabsContent>
      <TabsContent value="overrides">
        <OverridesTab />
      </TabsContent>
      <TabsContent value="usage">
        <UsageSeatsTab />
      </TabsContent>
      <TabsContent value="expiries">
        <ExpiriesTab />
      </TabsContent>
    </Tabs>
  );
}

export default function LicensingPage() {
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('platformConsole.eyebrow')}
        title={t('platformConsole.licensing.title')}
        description={t('platformConsole.licensing.description')}
        tags={[{ label: t('platformConsole.licensing.tag'), icon: <Boxes className="h-3.5 w-3.5" aria-hidden />, tone: 'primary' }]}
      />
      <Suspense fallback={<LoadingSkeleton variant="table" count={6} />}>
        <LicensingTabs />
      </Suspense>
    </div>
  );
}
