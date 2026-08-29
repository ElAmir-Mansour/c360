'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-provider';
import { ServiceDetailView } from '../_components/service-detail-view';
import { useServiceCatalogLabels } from '../../_lib/admin-labels';

export default function ServiceCatalogDetailPage() {
  const params = useParams<{ id?: string | string[] }>();
  const router = useRouter();
  const { locale, direction } = useLocale();
  const t = useServiceCatalogLabels();
  const serviceId = useMemo(() => {
    const raw = params?.id;
    return Array.isArray(raw) ? raw[0] : raw ?? '';
  }, [params]);

  return (
    <LexAccessGuard routeKey="/lex/admin/service-catalog/*" resourceName={t.detailTitle}>
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          title={t.detailTitle}
          description={t.detailDescription}
          actions={
            <Button type="button" variant="outline" onClick={() => router.push('/lex/admin/service-catalog')}>
              <ArrowLeft className="me-1.5 h-4 w-4" />
              {t.back}
            </Button>
          }
        />
        <ServiceDetailView serviceId={serviceId} />
      </div>
    </LexAccessGuard>
  );
}
