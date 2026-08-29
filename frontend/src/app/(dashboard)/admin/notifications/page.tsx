'use client';

import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Webhook } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { useT } from '@/components/providers/locale-provider';
import { DeliveryDashboard } from './components/delivery-dashboard';
import { TestNotificationForm } from './components/test-notification-form';

export default function AdminNotificationsPage() {
  const t = useT('admin');
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = pathname ?? '/admin/notifications';
  const searchParams = useSearchParams();
  const activeTab = searchParams?.get('tab') ?? 'dashboard';

  const handleTabChange = (tab: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (tab === 'dashboard') {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    router.push(next.toString() ? `${currentPath}?${next.toString()}` : currentPath);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('np.title')}
        description={t('np.desc')}
        actions={
          <Button asChild size="sm">
            <Link href="/admin/notifications/webhooks">
              <Webhook className="me-2 h-4 w-4" />
              {t('np.manageWebhooks')}
            </Link>
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="dashboard">{t('np.tabDashboard')}</TabsTrigger>
          <TabsTrigger value="test">{t('np.tabTest')}</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <DeliveryDashboard />
        </TabsContent>

        <TabsContent value="test" className="mt-6">
          <TestNotificationForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
