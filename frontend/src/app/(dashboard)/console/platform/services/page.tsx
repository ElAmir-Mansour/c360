'use client';

// Service & Infra Ops — Platform Console screen 7 (§E.5 #7).
//
// Tabbed: Health/metrics grid (G1 fuller detail) · Circuit breakers (G18) ·
// Kill switches (G19) · Rate limits (G20). The /platform layout already wraps the
// area in <PermissionRedirect permission="admin:console"> and mounts the
// impersonation banner, so this page omits its own gate. Each control tab is
// self-gated on platform:gateway:admin and confirms destructive actions.

import { Activity, Gauge, HeartPulse, Inbox, ShieldAlert } from 'lucide-react';
import { useT } from '@/components/providers/locale-provider';
import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HealthGrid } from './_components/health-grid';
import { CircuitBreakersTab } from './_components/circuit-breakers-tab';
import { KillSwitchesTab } from './_components/kill-switches-tab';
import { RateLimitsTab } from './_components/rate-limits-tab';
import { EventDLQTab } from './_components/event-dlq-tab';

export default function ServicesPage() {
  const t = useT();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('platformConsole.eyebrow')}
        title={t('platformConsole.services.title')}
        description={t('platformConsole.services.subtitle')}
      />

      <Tabs defaultValue="health">
        <TabsList aria-label={t('platformConsole.services.title')}>
          <TabsTrigger value="health">
            <HeartPulse className="me-1.5 h-4 w-4" aria-hidden />
            {t('platformConsole.services.health')}
          </TabsTrigger>
          <TabsTrigger value="circuit">
            <Activity className="me-1.5 h-4 w-4" aria-hidden />
            {t('platformConsole.services.circuitBreakers')}
          </TabsTrigger>
          <TabsTrigger value="killswitch">
            <ShieldAlert className="me-1.5 h-4 w-4" aria-hidden />
            {t('platformConsole.services.killSwitches')}
          </TabsTrigger>
          <TabsTrigger value="ratelimit">
            <Gauge className="me-1.5 h-4 w-4" aria-hidden />
            {t('platformConsole.services.rateLimits')}
          </TabsTrigger>
          <TabsTrigger value="dlq">
            <Inbox className="me-1.5 h-4 w-4" aria-hidden />
            {t('platformConsole.services.eventDlq')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="health">
          <HealthGrid />
        </TabsContent>
        <TabsContent value="circuit">
          <CircuitBreakersTab />
        </TabsContent>
        <TabsContent value="killswitch">
          <KillSwitchesTab />
        </TabsContent>
        <TabsContent value="ratelimit">
          <RateLimitsTab />
        </TabsContent>
        <TabsContent value="dlq">
          <EventDLQTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
