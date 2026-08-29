'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RadioTower, Send, ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { declareRespondIncident, fetchRespondProduct } from '@/lib/respond';
import { showApiError, showSuccess } from '@/lib/toast';
import type { DeclareRespondIncidentInput, RespondSeverity } from '@/types/respond';
import {
  isRespondCapabilityEnabled,
  respondCapabilityDisabledReason,
} from './respond-capabilities';
import {
  useRespondCapabilityReasonLabels,
  useRespondDeclareLabels,
} from '../_lib/respond-i18n';

const severityOptions: RespondSeverity[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

function parseImpactedServices(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function toISODateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function IncidentDeclarationPanel() {
  const t = useRespondDeclareLabels();
  const capReasons = useRespondCapabilityReasonLabels();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [detectedAt, setDetectedAt] = useState('');
  const [severity, setSeverity] = useState<RespondSeverity>('SEV3');
  const [impactedServicesText, setImpactedServicesText] = useState('');

  const productQuery = useQuery({
    queryKey: ['respond-product'],
    queryFn: fetchRespondProduct,
  });

  const declarationEnabled = isRespondCapabilityEnabled(productQuery.data, 'declaration');
  const disabledReason = respondCapabilityDisabledReason(
    productQuery.data,
    'declaration',
    t.capabilityLabel,
    capReasons,
  );

  const impactedServices = useMemo(
    () => parseImpactedServices(impactedServicesText),
    [impactedServicesText],
  );

  const declareMutation = useMutation({
    mutationFn: (input: DeclareRespondIncidentInput) => declareRespondIncident(input),
    onSuccess: async (incident) => {
      showSuccess(t.toastDeclaredTitle, t.toastDeclaredBody(incident.reference));
      await queryClient.invalidateQueries({ queryKey: ['respond-incidents'] });
      router.push(`/respond/incidents/${encodeURIComponent(incident.id)}`);
    },
    onError: showApiError,
  });

  const canSubmit = declarationEnabled && title.trim().length > 0 && !declareMutation.isPending;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    declareMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      severity,
      detected_at: toISODateTime(detectedAt),
      impacted_services: impactedServices,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>{t.panelTitle}</CardTitle>
            <CardDescription>{t.panelDescription}</CardDescription>
          </div>
          <Badge variant={declarationEnabled ? 'default' : 'outline'}>
            {declarationEnabled ? t.badgeEnabled : t.badgeDisabled}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
            <div className="space-y-2">
              <Label htmlFor="respond-declare-title">{t.titleLabel}</Label>
              <Input
                id="respond-declare-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={!declarationEnabled || declareMutation.isPending}
                maxLength={180}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="respond-declare-severity">{t.severityLabel}</Label>
              <Select
                value={severity}
                onValueChange={(value) => setSeverity(value as RespondSeverity)}
                disabled={!declarationEnabled || declareMutation.isPending}
              >
                <SelectTrigger id="respond-declare-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {severityOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="respond-declare-description">{t.descriptionLabel}</Label>
            <Textarea
              id="respond-declare-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={!declarationEnabled || declareMutation.isPending}
              rows={3}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label htmlFor="respond-declare-detected">{t.detectedLabel}</Label>
              <Input
                id="respond-declare-detected"
                type="datetime-local"
                value={detectedAt}
                onChange={(event) => setDetectedAt(event.target.value)}
                disabled={!declarationEnabled || declareMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="respond-declare-services">{t.servicesLabel}</Label>
              <Input
                id="respond-declare-services"
                value={impactedServicesText}
                onChange={(event) => setImpactedServicesText(event.target.value)}
                disabled={!declarationEnabled || declareMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                {impactedServices.length
                  ? t.servicesLinked(impactedServices.length)
                  : t.noServicesLinked}
              </p>
            </div>
          </div>

          {disabledReason ? (
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{disabledReason}</span>
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={!canSubmit} title={disabledReason}>
              <Send className="me-2 h-4 w-4" aria-hidden />
              {t.submit}
            </Button>
          </div>
        </form>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              {t.criteriaTitle}
            </div>
            <div className="mt-3 space-y-2">
              {severityOptions.map((severity) => (
                <div key={severity} className="grid grid-cols-[54px_1fr] gap-2 text-xs">
                  <Badge variant="outline">{severity}</Badge>
                  <span className="leading-5 text-muted-foreground">{t.criteria[severity]}</span>
                </div>
              ))}
            </div>
          </div>

          <EmptyState
            icon={RadioTower}
            title={t.recommendationGatedTitle}
            description={t.recommendationGatedDescription}
            className="border bg-muted/20"
            size="compact"
          />
        </div>
      </CardContent>
    </Card>
  );
}
