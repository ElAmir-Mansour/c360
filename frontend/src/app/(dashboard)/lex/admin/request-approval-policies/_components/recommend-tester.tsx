'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Wand2 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError } from '@/lib/toast';
import {
  type RecommendRequestApprovalPolicyParams,
  type RequestApprovalPolicyRecommendation,
  type RequestApprovalStage,
  lexRequestApprovalPoliciesApi,
} from '@/lib/lex/request-approval-policies';
import type { ServiceCatalogEntry } from '@/lib/lex/requests';
import type { RequestApprovalPolicyLabels } from '../_labels';

const STAGES = ['requester', 'provider'] as const satisfies readonly RequestApprovalStage[];
const ANY = '__any__';

export function RecommendTester({
  labels,
  services,
}: {
  labels: RequestApprovalPolicyLabels;
  services: ServiceCatalogEntry[];
}) {
  const { locale } = useLocaleOrDefault();
  const [requestType, setRequestType] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [stage, setStage] = useState<RequestApprovalStage | typeof ANY>(ANY);
  const [department, setDepartment] = useState('');
  const [priorityTier, setPriorityTier] = useState('');

  const recommendMutation = useMutation({
    mutationFn: (params: RecommendRequestApprovalPolicyParams) =>
      lexRequestApprovalPoliciesApi.recommendPolicy(params),
    onError: showApiError,
  });

  const run = () => {
    const params: RecommendRequestApprovalPolicyParams = {};
    if (requestType.trim()) params.request_type = requestType.trim();
    if (serviceId) params.service_id = serviceId;
    if (stage !== ANY) params.stage = stage;
    if (department.trim()) params.department = department.trim();
    if (priorityTier.trim()) params.priority_tier = priorityTier.trim();
    recommendMutation.mutate(params);
  };

  return (
    <SectionCard title={labels.recommend.title} description={labels.recommend.description}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rec-request-type">{labels.recommend.requestType}</Label>
            <Input
              id="rec-request-type"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
              placeholder={labels.recommend.requestTypePlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label>{labels.recommend.service}</Label>
            <Select
              value={serviceId || ANY}
              onValueChange={(v) => setServiceId(v === ANY ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={labels.recommend.selectService} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{labels.recommend.serviceAny}</SelectItem>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {resolveLocalized(service.name, locale) || service.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{labels.recommend.stage}</Label>
            <Select value={stage} onValueChange={(v) => setStage(v as RequestApprovalStage | typeof ANY)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{labels.recommend.stageAny}</SelectItem>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {labels.stageLabels[s] ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rec-department">{labels.recommend.department}</Label>
            <Input
              id="rec-department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder={labels.recommend.departmentPlaceholder}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="rec-tier">{labels.recommend.priorityTier}</Label>
            <Input
              id="rec-tier"
              value={priorityTier}
              onChange={(e) => setPriorityTier(e.target.value)}
              placeholder={labels.recommend.priorityTierPlaceholder}
            />
          </div>
        </div>

        <Button className="w-full" onClick={run} disabled={recommendMutation.isPending}>
          {recommendMutation.isPending ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="me-1.5 h-4 w-4" />
          )}
          {recommendMutation.isPending ? labels.recommend.running : labels.recommend.run}
        </Button>

        {recommendMutation.data ? (
          <RecommendResult labels={labels} result={recommendMutation.data} />
        ) : null}
      </div>
    </SectionCard>
  );
}

function RecommendResult({
  labels,
  result,
}: {
  labels: RequestApprovalPolicyLabels;
  result: RequestApprovalPolicyRecommendation;
}) {
  return (
    <div className="rounded-lg border px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {result.matched ? labels.recommend.matchedTitle : labels.recommend.noMatchTitle}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{result.reason}</p>
        </div>
        <Badge variant={result.matched ? 'success' : 'warning'}>
          {result.matched ? labels.recommend.matchedBadge : labels.recommend.reviewBadge}
        </Badge>
      </div>
      {result.policy ? (
        <div className="mt-4 space-y-2">
          <p className="font-medium">{result.policy.name}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline">
              {labels.modeLabels[result.policy.mode] ?? result.policy.mode}
            </Badge>
            <Badge variant="outline">
              {labels.quorumLabels[result.policy.quorum] ?? result.policy.quorum}
            </Badge>
            {result.policy.approvers.map((approver) => (
              <Badge key={`${approver.type}-${approver.ref}`} variant="secondary">
                {approver.label || approver.ref}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
