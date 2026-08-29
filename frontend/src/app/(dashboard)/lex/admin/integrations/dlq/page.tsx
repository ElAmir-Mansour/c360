'use client';

/**
 * Tenant-wide dead-letter queue — `/lex/admin/integrations/dlq`.
 *
 * A cross-endpoint view of every failed operation for this tenant
 * (GET /integrations/dlq), rendered through the shared {@link DlqConsole} in its
 * global mode (adds an Integration column, drops the per-endpoint batch action —
 * batch replay stays per-endpoint). The integrations registry is loaded
 * alongside purely to label the Integration column with human-readable names
 * instead of raw ids; if that lookup is unavailable, rows stay visible by raw id
 * with a warning.
 *
 * Reads gated on `lex:integration:read`; per-row replay requires
 * `lex:integration:manage` (coarse `lex:write` also satisfies manage). Mirrors
 * the org-entities admin module: PermissionRedirect, PageHeader, SectionCard,
 * bilingual labels via resolveLocalized, react-query, RTL.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { lexIntegrationsApi } from '@/lib/lex/integrations';
import { integrationLabels } from '../_labels';
import { kindMeta } from '../_lib/integration-kinds';
import { useReliabilityLabels } from '../_lib/reliability-labels';
import { DlqConsole } from '../_components/dlq-console';

const LIST_ROUTE = '/lex/admin/integrations';

export default function GlobalDlqPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const shared = locale === 'ar' ? integrationLabels.ar : integrationLabels.en;
  const t = useReliabilityLabels();

  const canManage = hasPermission('lex:integration:manage') || hasPermission('lex:write');
  const BackIcon = direction === 'rtl' ? ArrowRight : ArrowLeft;

  // Registry → endpoint id → display name for the Integration col.
  const listQuery = useQuery({
    queryKey: ['lex-integrations'],
    queryFn: () => lexIntegrationsApi.listIntegrationsResult(),
    staleTime: 60_000,
  });
  const registryDegraded = listQuery.isError || (listQuery.data?.degraded ?? false);

  const endpointNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ep of listQuery.data?.endpoints ?? []) {
      map[ep.id] = ep.name || ep.code || resolveLocalized(kindMeta(ep.kind).name, locale);
    }
    return map;
  }, [listQuery.data, locale]);

  return (
    <PermissionRedirect permission="lex:integration:read">
      <div dir={direction} lang={locale} className="space-y-6">
        <div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="mb-2 h-8 px-2 text-muted-foreground"
          >
            <Link href={LIST_ROUTE}>
              <BackIcon className="me-1.5 h-4 w-4" aria-hidden />
              {shared.backToList}
            </Link>
          </Button>

          <PageHeader
            eyebrow={t.dlqTab}
            title={t.dlqGlobalTitle}
            description={t.dlqGlobalSubtitle}
          />
        </div>

        <SectionCard title={t.dlqGlobalTitle} description={t.dlqGlobalSubtitle}>
          {registryDegraded ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning-300/60 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-800/15 dark:text-warning-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="space-y-0.5">
                <p className="font-medium">{shared.loadErrorTitle}</p>
                <p className="text-xs">{shared.loadErrorBody}</p>
              </div>
            </div>
          ) : null}
          <DlqConsole canManage={canManage} endpointNames={endpointNames} />
        </SectionCard>
      </div>
    </PermissionRedirect>
  );
}
