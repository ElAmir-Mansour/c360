'use client';

import { List, Download, ShieldCheck, HardDrive, ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { useT } from '@/components/providers/locale-provider';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import { AuditLogsTab } from './_components/audit-logs-tab';
import { AuditIntegrityTab } from './_components/audit-integrity-tab';
import { AuditExportTab } from './_components/audit-export-tab';
import { AuditPartitionsTab } from './_components/audit-partitions-tab';

/**
 * Platform Audit & Compliance (§E.5 #6) — fleet-wide audit console.
 *
 * Tabs:
 *  - Logs        — all-tenants query (G14) with a tenant column + service/
 *                  severity/actor/date filters.
 *  - Integrity   — global chain-of-custody verify + persisted status (G15).
 *  - Export      — async export job: start, poll, download (G16).
 *  - Partitions  — partition listing + maintenance/archive/delete, now gated to
 *                  audit:partition:admin (G17 hardening).
 *
 * The whole area is already gated on admin:console by platform/layout.tsx; the
 * explicit PermissionRedirect here keeps the screen self-sufficient.
 */
export default function PlatformAuditPage() {
  const t = useT();

  return (
    <PermissionRedirect permission="admin:console">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t('platformConsole.eyebrow')}
          title={t('platformConsole.audit.title')}
          description={t('platformConsole.audit.subtitle')}
          tags={[
            {
              label: t('platformConsole.audit.platformWide'),
              icon: <ScrollText className="h-3.5 w-3.5" aria-hidden />,
              tone: 'info',
            },
            {
              label: t('platformConsole.audit.tamperEvident'),
              icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
              tone: 'success',
            },
          ]}
        />

        <Tabs defaultValue="logs">
          <TabsList>
            <TabsTrigger value="logs" className="gap-1.5">
              <List className="h-4 w-4" aria-hidden />
              {t('platformConsole.audit.tabLogs')}
            </TabsTrigger>
            <TabsTrigger value="integrity" className="gap-1.5">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              {t('platformConsole.audit.tabIntegrity')}
            </TabsTrigger>
            <TabsTrigger value="export" className="gap-1.5">
              <Download className="h-4 w-4" aria-hidden />
              {t('platformConsole.audit.tabExport')}
            </TabsTrigger>
            <TabsTrigger value="partitions" className="gap-1.5">
              <HardDrive className="h-4 w-4" aria-hidden />
              {t('platformConsole.audit.tabPartitions')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="logs" className="mt-4">
            <AuditLogsTab />
          </TabsContent>
          <TabsContent value="integrity" className="mt-4">
            <AuditIntegrityTab />
          </TabsContent>
          <TabsContent value="export" className="mt-4">
            <AuditExportTab />
          </TabsContent>
          <TabsContent value="partitions" className="mt-4">
            <AuditPartitionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </PermissionRedirect>
  );
}
