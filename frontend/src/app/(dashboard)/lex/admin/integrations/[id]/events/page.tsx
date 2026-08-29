'use client';

/**
 * Per-endpoint event inspector — `/lex/admin/integrations/{id}/events`.
 *
 * The inbound/outbound event stream for one connector (#17): a filterable table
 * (direction / kind / status + free-text), signature-valid badge, result action,
 * expandable REDACTED payload, relative time, and a Replay button per INBOUND
 * event. Reads gated on `lex:integration:read`; per-event replay requires
 * `lex:integration:manage` (coarse `lex:write` also satisfies manage).
 *
 * Mirrors the sibling `[id]/logs` and `[id]/dlq` pages: PermissionRedirect, back
 * link, PageHeader, SectionCard, the shared {@link EventInspector}, bilingual
 * labels (Arabic-first), react-query, RTL via `dir`/`lang`.
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
import { kindMeta } from '../../_lib/integration-kinds';
import { useObservabilityLabels } from '../../_lib/observability-labels';
import { EventInspector } from '../../_components/event-inspector';

export default function IntegrationEventsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const t = useObservabilityLabels();

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
  const meta = endpoint ? kindMeta(endpoint.kind) : null;
  const headerTitle = endpoint
    ? endpoint.name || resolveLocalized(meta!.name, locale)
    : id || t.eventsTitle;

  return (
    <PermissionRedirect permission="lex:integration:read">
      <div dir={direction} lang={locale} className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 h-8 px-2 text-muted-foreground">
            <Link href={`/lex/admin/integrations/${id}`}>
              <BackIcon className="me-1.5 h-4 w-4" aria-hidden />
              {t.backToList}
            </Link>
          </Button>

          <PageHeader eyebrow={t.eventsTab} title={headerTitle} description={t.eventsSubtitle} />
        </div>

        <SectionCard title={t.eventsTitle} description={t.eventsSubtitle}>
          <EventInspector endpointId={id} canManage={canManage} />
        </SectionCard>
      </div>
    </PermissionRedirect>
  );
}
