'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, GitBranch, Link2, RadioTower, ShieldAlert } from 'lucide-react';
import { ListRow } from '@/components/shared/list-row';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
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
import {
  changeRespondSeverity,
  confirmRespondTriage,
  requestRespondSeverityRecommendation,
  transitionRespondIncident,
  updateRespondIncident,
} from '@/lib/respond';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  RespondCockpit,
  RespondImpactLevel,
  RespondProduct,
  RespondSeverity,
  RespondSeverityAssessmentInput,
} from '@/types/respond';
import {
  isRespondCapabilityEnabled,
  respondCapabilityDisabledReason,
} from './respond-capabilities';
import {
  useRespondCapabilityReasonLabels,
  useRespondCommonLabels,
  useRespondTriageLabels,
} from '../_lib/respond-i18n';

const severityOptions: RespondSeverity[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

const impactLevelValues: RespondImpactLevel[] = ['none', 'limited', 'major', 'critical'];

const defaultImpactAssessment: RespondSeverityAssessmentInput = {
  user_base_scope: 'limited',
  business_process_criticality: 'limited',
  revenue_impact: 'none',
  regulatory_exposure: 'none',
};

function parseServiceIDs(value: string): string[] {
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

function formatServiceIDs(serviceIDs: string[]) {
  return serviceIDs.join(', ');
}

interface IncidentTriagePanelProps {
  cockpit: RespondCockpit;
  incidentID: string;
  product?: RespondProduct;
  onRefresh: () => Promise<void>;
}

export function IncidentTriagePanel({
  cockpit,
  incidentID,
  product,
  onRefresh,
}: IncidentTriagePanelProps) {
  const t = useRespondTriageLabels();
  const common = useRespondCommonLabels();
  const capReasons = useRespondCapabilityReasonLabels();
  const incident = cockpit.incident;
  const rowVersion = incident.row_version;
  const [selectedSeverity, setSelectedSeverity] = useState<RespondSeverity>(incident.severity);
  const [servicesText, setServicesText] = useState(formatServiceIDs(incident.impacted_services));
  const [impactAssessment, setImpactAssessment] =
    useState<RespondSeverityAssessmentInput>(defaultImpactAssessment);

  useEffect(() => {
    setSelectedSeverity(incident.severity);
    setServicesText(formatServiceIDs(incident.impacted_services));
  }, [incident.id, incident.severity, incident.impacted_services]);

  const triageCapabilityEnabled = isRespondCapabilityEnabled(product, 'triage');
  const triageDisabledReason = respondCapabilityDisabledReason(
    product,
    'triage',
    t.capabilityLabel,
    capReasons,
  );
  const rowVersionReason =
    typeof rowVersion === 'number' ? undefined : t.rowVersionReason;
  const serviceIDs = useMemo(() => parseServiceIDs(servicesText), [servicesText]);
  const serviceLinksByID = new Map(
    (cockpit.service_links ?? []).map((service) => [service.service_id, service]),
  );

  const severityMutation = useMutation({
    mutationFn: () =>
      changeRespondSeverity(incidentID, {
        severity: selectedSeverity,
        expected_version: rowVersion ?? 0,
      }),
    onSuccess: async () => {
      showSuccess(t.toastSeverityUpdatedTitle, t.toastSeverityUpdatedBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const transitionMutation = useMutation({
    mutationFn: () =>
      transitionRespondIncident(incidentID, {
        to: 'Triaged',
        expected_version: rowVersion ?? 0,
      }),
    onSuccess: async () => {
      showSuccess(t.toastTriagedTitle, t.toastTriagedBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const servicesMutation = useMutation({
    mutationFn: (nextServices: string[]) =>
      updateRespondIncident(incidentID, {
        title: incident.title,
        description: incident.description ?? '',
        impacted_services: nextServices,
        expected_version: rowVersion ?? 0,
      }),
    onSuccess: async () => {
      showSuccess(t.toastServicesUpdatedTitle, t.toastServicesUpdatedBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const recommendationMutation = useMutation({
    mutationFn: () => requestRespondSeverityRecommendation(incidentID, impactAssessment),
    onSuccess: async () => {
      showSuccess(t.toastRecommendationTitle, t.toastRecommendationBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const triageMutation = useMutation({
    mutationFn: () =>
      confirmRespondTriage(incidentID, {
        severity: selectedSeverity,
        impact_assessment: impactAssessment,
        expected_version: rowVersion ?? 0,
      }),
    onSuccess: async () => {
      showSuccess(t.toastTriageSavedTitle, t.toastTriageSavedBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const severityChanged = selectedSeverity !== incident.severity;
  const canChangeSeverity =
    severityChanged && typeof rowVersion === 'number' && !severityMutation.isPending;
  const canConfirmTriaged =
    incident.status === 'Declared' && typeof rowVersion === 'number' && !transitionMutation.isPending;
  const canSaveServices =
    typeof rowVersion === 'number' &&
    formatServiceIDs(serviceIDs) !== formatServiceIDs(incident.impacted_services) &&
    !servicesMutation.isPending;
  const canUseTriageEndpoint =
    triageCapabilityEnabled &&
    typeof rowVersion === 'number' &&
    !recommendationMutation.isPending &&
    !triageMutation.isPending;

  const saveServices = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSaveServices) {
      servicesMutation.mutate(serviceIDs);
    }
  };

  const removeService = (serviceID: string) => {
    if (typeof rowVersion !== 'number') return;
    servicesMutation.mutate(incident.impacted_services.filter((item) => item !== serviceID));
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t.severityTriageTitle}</CardTitle>
          <CardDescription>{t.severityTriageDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
            <div className="space-y-2">
              <Label htmlFor="respond-severity-select">{t.selectedSeverityLabel}</Label>
              <Select
                value={selectedSeverity}
                onValueChange={(value) => setSelectedSeverity(value as RespondSeverity)}
                disabled={severityMutation.isPending}
              >
                <SelectTrigger id="respond-severity-select">
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
            <div className="flex items-end">
              <Button
                type="button"
                className="w-full"
                variant="outline"
                disabled={!canChangeSeverity}
                title={rowVersionReason}
                onClick={() => severityMutation.mutate()}
              >
                <ShieldAlert className="me-2 h-4 w-4" aria-hidden />
                {t.changeButton}
              </Button>
            </div>
          </div>

          <div className="rounded-md border bg-muted/20 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{t.impactAssessmentTitle}</div>
              <Badge variant={triageCapabilityEnabled ? 'default' : 'outline'}>
                {triageCapabilityEnabled
                  ? t.badgeRecommendationEnabled
                  : t.badgeRecommendationGated}
              </Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['user_base_scope', t.impactUserBase],
                  ['business_process_criticality', t.impactBusinessProcess],
                  ['revenue_impact', t.impactRevenue],
                  ['regulatory_exposure', t.impactRegulatory],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`respond-impact-${key}`}>{label}</Label>
                  <Select
                    value={impactAssessment[key]}
                    onValueChange={(value) =>
                      setImpactAssessment((current) => ({
                        ...current,
                        [key]: value as RespondImpactLevel,
                      }))
                    }
                    disabled={!triageCapabilityEnabled}
                  >
                    <SelectTrigger id={`respond-impact-${key}`} title={triageDisabledReason}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {impactLevelValues.map((level) => (
                        <SelectItem key={level} value={level}>
                          {t.impactLevels[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {triageDisabledReason ? (
              <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{triageDisabledReason}</span>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!canUseTriageEndpoint}
                title={triageDisabledReason ?? rowVersionReason}
                onClick={() => recommendationMutation.mutate()}
              >
                <RadioTower className="me-2 h-4 w-4" aria-hidden />
                {t.recommendButton}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canUseTriageEndpoint}
                title={triageDisabledReason ?? rowVersionReason}
                onClick={() => triageMutation.mutate()}
              >
                {t.persistTriageButton}
              </Button>
              <Button
                type="button"
                disabled={!canConfirmTriaged}
                title={rowVersionReason}
                onClick={() => transitionMutation.mutate()}
              >
                <GitBranch className="me-2 h-4 w-4" aria-hidden />
                {t.markTriagedButton}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">{t.criteriaTitle}</div>
            <div className="space-y-2">
              {severityOptions.map((severity) => (
                <div key={severity} className="rounded-md border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <StatusBadge status={severity} size="sm" />
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>{t.criteria[severity].userBase}</span>
                    <span>{t.criteria[severity].process}</span>
                    <span>{t.criteria[severity].revenue}</span>
                    <span>{t.criteria[severity].regulatory}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.impactedServicesTitle}</CardTitle>
          <CardDescription>{t.impactedServicesDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-3" onSubmit={saveServices}>
            <div className="space-y-2">
              <Label htmlFor="respond-services-edit">{t.serviceIdentifiersLabel}</Label>
              <Input
                id="respond-services-edit"
                value={servicesText}
                onChange={(event) => setServicesText(event.target.value)}
                disabled={servicesMutation.isPending}
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="outline"
                disabled={!canSaveServices}
                title={rowVersionReason}
              >
                <Link2 className="me-2 h-4 w-4" aria-hidden />
                {t.saveLinksButton}
              </Button>
            </div>
          </form>

          {incident.impacted_services.length ? (
            <div className="space-y-2">
              {incident.impacted_services.map((serviceID) => {
                const service = serviceLinksByID.get(serviceID);
                return (
                  <ListRow
                    key={serviceID}
                    leading={<Link2 className="h-4 w-4" aria-hidden />}
                    title={service?.name ?? serviceID}
                    subtitle={
                      service
                        ? [
                            service.owner_name ? t.ownerPrefix(service.owner_name) : null,
                            service.tier ? t.tierPrefix(service.tier) : null,
                            service.metadata_state
                              ? t.metadataPrefix(service.metadata_state)
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : t.metadataNotReturned
                    }
                    trailing={
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={servicesMutation.isPending || typeof rowVersion !== 'number'}
                        title={rowVersionReason}
                        onClick={() => removeService(serviceID)}
                      >
                        {common.remove}
                      </Button>
                    }
                  >
                    {service?.dependencies?.length ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {t.dependenciesPrefix(service.dependencies.join(', '))}
                      </div>
                    ) : null}
                  </ListRow>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Link2}
              title={t.emptyServicesTitle}
              description={t.emptyServicesDescription}
              size="compact"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
