'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/components/providers/locale-provider';
import { RolesCatalogTab } from './_components/roles-catalog-tab';
import { AbacPoliciesTab } from './_components/abac-policies-tab';
import { UserSearchTab } from './_components/user-search-tab';

/**
 * Identity & Access — Screen 5 of the Platform Admin Console (§E.5).
 *
 * Three tabs:
 *  - Roles & permissions catalog (read-only v1; surfaces the C-1/G-0 two-catalog
 *    divergence as an info callout).
 *  - ABAC policies (G22 CRUD + DetailPanel editor + Simulate form).
 *  - Cross-tenant user search (G6).
 *
 * The /platform layout already gates the area on `admin:console`; the redundant
 * PermissionRedirect here keeps the screen self-sufficient if reused outside the
 * layout (matching the Overview convention).
 */
export default function IdentityAccessPage() {
  const t = useT();
  const [tab, setTab] = useState('roles');

  return (
    <PermissionRedirect permission="admin:console">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t('platformConsole.eyebrow')}
          title={t('platformConsole.identity.title')}
          description={t('platformConsole.identity.subtitle')}
        />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="roles">
              {t('platformConsole.identity.roles')}
            </TabsTrigger>
            <TabsTrigger value="abac">
              {t('platformConsole.identity.abacPolicies')}
            </TabsTrigger>
            <TabsTrigger value="users">
              {t('platformConsole.identity.userSearch')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="roles">
            <RolesCatalogTab />
          </TabsContent>
          <TabsContent value="abac">
            <AbacPoliciesTab />
          </TabsContent>
          <TabsContent value="users">
            <UserSearchTab />
          </TabsContent>
        </Tabs>
      </div>
    </PermissionRedirect>
  );
}
