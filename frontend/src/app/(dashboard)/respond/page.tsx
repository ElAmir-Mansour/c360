'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, RadioTower, ShieldCheck } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { fetchRespondProduct } from '@/lib/respond';
import { DeclareIncidentDialog } from './_components/declare-incident-dialog';
import { useRespondCommonLabels, useRespondOverviewLabels } from './_lib/respond-i18n';

export default function RespondOverviewPage() {
  const common = useRespondCommonLabels();
  const t = useRespondOverviewLabels();
  const [declareOpen, setDeclareOpen] = useState(false);
  const productQuery = useQuery({
    queryKey: ['respond-product'],
    queryFn: fetchRespondProduct,
  });

  if (productQuery.isLoading) {
    return <LoadingSkeleton variant="detail" label={t.loadingProduct} />;
  }

  if (productQuery.error) {
    return (
      <ErrorState
        error={productQuery.error}
        title={t.productUnavailableTitle}
        message={t.productUnavailableMessage}
        onRetry={() => void productQuery.refetch()}
      />
    );
  }

  const product = productQuery.data;
  const enabledCapabilities = product?.capabilities.filter((capability) => capability.enabled) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={common.eyebrow}
        title={t.title}
        description={t.description}
        tags={[
          {
            label: product?.licensed ? t.licensed : t.notLicensed,
            icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
            tone: product?.licensed ? 'success' : 'warning',
          },
          { label: product?.entitlement_key ?? 'respond.major_incident', tone: 'neutral' },
        ]}
        actions={
          <>
            <DeclareIncidentDialog open={declareOpen} onOpenChange={setDeclareOpen} />
            <Button asChild variant="outline">
              <Link href="/respond/incidents">
                <RadioTower className="me-2 h-4 w-4" aria-hidden />
                {common.incidents}
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <DetailStatCard
          label={t.entitlement}
          value={product?.entitlement_state ?? t.unknown}
          tone={product?.licensed ? 'emerald' : 'gold'}
          icon={ShieldCheck}
        />
        <DetailStatCard
          label={t.capabilities}
          value={product?.capabilities.length ?? 0}
          tone="sky"
          icon={Activity}
        />
        <DetailStatCard
          label={t.enabled}
          value={enabledCapabilities.length}
          tone={enabledCapabilities.length > 0 ? 'emerald' : 'neutral'}
          icon={RadioTower}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.capabilitiesCardTitle}</CardTitle>
          <CardDescription>{t.capabilitiesCardDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {product?.capabilities.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {product.capabilities.map((capability) => (
                <div
                  key={capability.id}
                  className="rounded-lg border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{capability.label}</p>
                      {capability.description ? (
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {capability.description}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant={capability.enabled ? 'default' : 'outline'}>
                      {capability.enabled ? t.enabledState : t.disabledState}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title={t.noCapabilitiesTitle}
              description={t.noCapabilitiesDescription}
              size="compact"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
