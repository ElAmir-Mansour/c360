'use client';

/**
 * Integration conflicts queue page — `/lex/admin/integrations/{id}/conflicts` (#20).
 *
 * Renders the reconciliation conflicts queue for one endpoint through
 * {@link ConflictResolutionPanel}: each field-level divergence (source vs lex
 * value, suggested resolution) with per-row merge / override / ignore + a bulk
 * bar. Reads gated on `lex:integration:read` (the panel read helper reports
 * degraded reads explicitly); resolving requires `lex:integration:manage`
 * (coarse `lex:write` also satisfies it). The endpoint header context is loaded
 * alongside (graceful: falls back to the raw id).
 *
 * Mirrors the org-entities admin module: PermissionRedirect wrapper, PageHeader,
 * SectionCard, bilingual labels via resolveLocalized + the extensibility module,
 * react-query, RTL via `dir`/`lang`.
 */
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, GitCompareArrows } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { lexIntegrationsApi } from '@/lib/lex/integrations';
import { integrationLabels } from '../../_labels';
import { kindMeta } from '../../_lib/integration-kinds';
import { useExtensibilityLabels } from '../../_lib/extensibility-labels';
import { ConflictResolutionPanel } from '../../_components/conflict-resolution-panel';

const LIST_ROUTE = '/lex/admin/integrations';

export default function IntegrationConflictsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const shared = locale === 'ar' ? integrationLabels.ar : integrationLabels.en;
  const t = useExtensibilityLabels();

  const canManage = hasPermission('lex:integration:manage') || hasPermission('lex:write');
  const BackIcon = direction === 'rtl' ? ArrowRight : ArrowLeft;

  // Endpoint header context (graceful: getIntegration throws → fall back to id).
  const endpointQuery = useQuery({
    queryKey: ['lex-integration', id],
    queryFn: () => lexIntegrationsApi.getIntegration(id),
    enabled: Boolean(id),
    retry: false,
    staleTime: 60_000,
  });

  const endpoint = endpointQuery.data;
  const headerTitle = endpoint
    ? endpoint.name || resolveLocalized(kindMeta(endpoint.kind).name, locale)
    : id || t.conflictsTitle;

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
            <Link href={`${LIST_ROUTE}/${id}`}>
              <BackIcon className="me-1.5 h-4 w-4" aria-hidden />
              {shared.backToList}
            </Link>
          </Button>

          <PageHeader
            eyebrow={headerTitle}
            title={t.conflictsTitle}
            description={t.conflictsSubtitle}
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={`${LIST_ROUTE}/${id}/logs`}>
                  <GitCompareArrows className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {shared.ledgerTitle}
                </Link>
              </Button>
            }
          />
        </div>

        <SectionCard title={t.conflictsTitle} description={t.conflictsSubtitle}>
          <ConflictResolutionPanel endpointId={id} canManage={canManage} />
        </SectionCard>
      </div>
    </PermissionRedirect>
  );
}
