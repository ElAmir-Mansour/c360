'use client';

/**
 * Integration reliability page — `/lex/admin/integrations/{id}/dlq`.
 *
 * Pairs the per-endpoint {@link DlqConsole} (#11 — dead-letter queue + replay /
 * replay-all) with the {@link BreakerPanel} (#12 — circuit-breaker state + reset).
 * Reads are gated on `lex:integration:read`; the replay / reset actions require
 * `lex:integration:manage` (coarse `lex:write` also satisfies manage, matching
 * the sibling logs page). The endpoint header lookup degrades gracefully to the
 * raw id.
 *
 * Mirrors the sibling `[id]/logs` page: PermissionRedirect wrapper, back link,
 * PageHeader, SectionCard sections, bilingual labels via resolveLocalized, RTL.
 */
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
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
import { useReliabilityLabels } from '../../_lib/reliability-labels';
import { DlqConsole } from '../../_components/dlq-console';
import { BreakerPanel } from '../../_components/breaker-panel';

export default function IntegrationReliabilityPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const shared = locale === 'ar' ? integrationLabels.ar : integrationLabels.en;
  const t = useReliabilityLabels();

  // `lex:integration:manage` is the canonical gate; coarse `lex:write` also
  // satisfies it (matches the sibling logs page).
  const canManage = hasPermission('lex:integration:manage') || hasPermission('lex:write');
  const BackIcon = direction === 'rtl' ? ArrowRight : ArrowLeft;

  const endpointQuery = useQuery({
    queryKey: ['lex-integration', id],
    queryFn: () => lexIntegrationsApi.getIntegration(id),
    enabled: Boolean(id),
    retry: false,
    staleTime: 60_000,
  });

  const endpoint = endpointQuery.data;
  const meta = endpoint ? kindMeta(endpoint.kind) : null;
  const headerTitle = endpoint
    ? endpoint.name || resolveLocalized(meta!.name, locale)
    : id || t.dlqTitle;

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
            <Link href={`/lex/admin/integrations/${id}`}>
              <BackIcon className="me-1.5 h-4 w-4" aria-hidden />
              {shared.backToList}
            </Link>
          </Button>

          <PageHeader eyebrow={t.dlqTab} title={headerTitle} description={t.dlqSubtitle} />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <SectionCard title={t.dlqTitle} description={t.dlqSubtitle}>
            <DlqConsole endpointId={id} canManage={canManage} />
          </SectionCard>

          <SectionCard title={t.breakerTitle} description={t.breakerSubtitle}>
            <BreakerPanel endpointId={id} canManage={canManage} variant="embedded" />
          </SectionCard>
        </div>
      </div>
    </PermissionRedirect>
  );
}
