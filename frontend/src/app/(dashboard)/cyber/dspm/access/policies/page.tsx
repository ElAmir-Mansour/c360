'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import type {
  AccessPolicy,
  AccessPolicyType,
  CyberSeverity,
  PolicyEnforcement,
  PolicyViolation,
} from '@/types/cyber';
import { useDspmLabels } from '../../_lib/dspm-i18n';

function severityBadgeVariant(severity: CyberSeverity) {
  switch (severity) {
    case 'critical':
      return 'destructive' as const;
    case 'high':
      return 'destructive' as const;
    case 'medium':
      return 'warning' as const;
    case 'low':
      return 'secondary' as const;
    default:
      return 'outline' as const;
  }
}

function enforcementBadgeVariant(enforcement: PolicyEnforcement) {
  switch (enforcement) {
    case 'block':
      return 'destructive' as const;
    case 'auto_remediate':
      return 'warning' as const;
    default:
      return 'outline' as const;
  }
}

function formatLabel(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface CreatePolicyPayload {
  name: string;
  description: string;
  policy_type: AccessPolicyType;
  rule_config: Record<string, unknown>;
  enforcement: PolicyEnforcement;
  severity: CyberSeverity;
  enabled: boolean;
}

export default function AccessPoliciesPage() {
  const router = useRouter();
  const t = useDspmLabels().policies;
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = useState('policies');

  const POLICY_TYPES: { label: string; value: AccessPolicyType }[] = [
    { label: t.typeMaxIdleDays, value: 'max_idle_days' },
    { label: t.typeClassificationRestrict, value: 'classification_restrict' },
    { label: t.typeSeparationOfDuties, value: 'separation_of_duties' },
    { label: t.typeTimeBoundAccess, value: 'time_bound_access' },
    { label: t.typeBlastRadiusLimit, value: 'blast_radius_limit' },
    { label: t.typePeriodicReview, value: 'periodic_review' },
  ];

  const ENFORCEMENT_OPTIONS: { label: string; value: PolicyEnforcement }[] = [
    { label: t.enforcementAlert, value: 'alert' },
    { label: t.enforcementBlock, value: 'block' },
    { label: t.enforcementAutoRemediate, value: 'auto_remediate' },
  ];

  const SEVERITY_OPTIONS: { label: string; value: CyberSeverity }[] = [
    { label: t.severityCritical, value: 'critical' },
    { label: t.severityHigh, value: 'high' },
    { label: t.severityMedium, value: 'medium' },
    { label: t.severityLow, value: 'low' },
  ];

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [policyType, setPolicyType] = useState<AccessPolicyType>('max_idle_days');
  const [ruleConfigJson, setRuleConfigJson] = useState('{}');
  const [enforcement, setEnforcement] = useState<PolicyEnforcement>('alert');
  const [severity, setSeverity] = useState<CyberSeverity>('medium');
  const [enabled, setEnabled] = useState(true);

  const {
    data: policiesEnvelope,
    isLoading: policiesLoading,
    error: policiesError,
    mutate: refetchPolicies,
  } = useRealtimeData<{ data: AccessPolicy[] }>(API_ENDPOINTS.CYBER_DSPM_ACCESS_POLICIES, {
    pollInterval: 60000,
  });

  const {
    data: violationsEnvelope,
    isLoading: violationsLoading,
    error: violationsError,
    mutate: refetchViolations,
  } = useRealtimeData<{ data: PolicyViolation[]; total: number }>(
    API_ENDPOINTS.CYBER_DSPM_ACCESS_VIOLATIONS,
    { pollInterval: 60000 },
  );

  const createMutation = useApiMutation<AccessPolicy, CreatePolicyPayload>(
    'post',
    API_ENDPOINTS.CYBER_DSPM_ACCESS_POLICIES,
    {
      successMessage: t.policyCreated,
      invalidateKeys: ['dspm-access-policies'],
      onSuccess: () => {
        setCreateOpen(false);
        resetForm();
        void refetchPolicies();
      },
    },
  );

  const policies = policiesEnvelope?.data ?? [];
  const violations = violationsEnvelope?.data ?? [];
  const violationTotal = violationsEnvelope?.total ?? 0;

  function resetForm() {
    setName('');
    setDescription('');
    setPolicyType('max_idle_days');
    setRuleConfigJson('{}');
    setEnforcement('alert');
    setSeverity('medium');
    setEnabled(true);
  }

  function handleCreate() {
    let ruleConfig: Record<string, unknown>;
    try {
      ruleConfig = JSON.parse(ruleConfigJson) as Record<string, unknown>;
    } catch {
      return;
    }

    createMutation.mutate({
      name,
      description,
      policy_type: policyType,
      rule_config: ruleConfig,
      enforcement,
      severity,
      enabled,
    });
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/cyber/dspm/access')}
              >
                <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
                {t.back}
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="me-1.5 h-3.5 w-3.5" />
                {t.createPolicy}
              </Button>
            </div>
          }
        />

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="policies">
              {t.tabPolicies}
              {policies.length > 0 && (
                <Badge variant="secondary" className="ms-2">
                  {policies.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="violations">
              {t.tabViolations}
              {violationTotal > 0 && (
                <Badge variant="destructive" className="ms-2">
                  {violationTotal}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="policies" className="mt-4">
            {policiesLoading ? (
              <LoadingSkeleton variant="card" />
            ) : policiesError ? (
              <ErrorState
                message={t.loadPoliciesError}
                onRetry={() => void refetchPolicies()}
              />
            ) : policies.length === 0 ? (
              <div className="card">
                <EmptyState
                  size="compact"
                  icon={ShieldCheck}
                  title={t.noPoliciesTitle}
                  description={t.noPoliciesDescription}
                  action={{ label: t.createPolicy, onClick: () => setCreateOpen(true) }}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {policies.map((policy) => (
                  <div
                    key={policy.id}
                    className="rounded-xl border bg-card p-5 transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-semibold">{policy.name}</h4>
                        {policy.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {policy.description}
                          </p>
                        )}
                      </div>
                      <Switch checked={policy.enabled} disabled aria-label={t.policyEnabledAria} />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{formatLabel(policy.policy_type)}</Badge>
                      <Badge variant={enforcementBadgeVariant(policy.enforcement)}>
                        {formatLabel(policy.enforcement)}
                      </Badge>
                      <Badge variant={severityBadgeVariant(policy.severity)}>
                        {policy.severity}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="violations" className="mt-4">
            {violationsLoading ? (
              <LoadingSkeleton variant="table-row" />
            ) : violationsError ? (
              <ErrorState
                message={t.loadViolationsError}
                onRetry={() => void refetchViolations()}
              />
            ) : violations.length === 0 ? (
              <div className="card">
                <EmptyState
                  size="compact"
                  icon={ShieldCheck}
                  title={t.noViolationsTitle}
                  description={t.noViolationsDescription}
                />
              </div>
            ) : (
              <div className="rounded-xl border bg-card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start">
                        <th className="px-4 py-3 font-medium text-muted-foreground">{t.colPolicy}</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">{t.colIdentity}</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">
                          {t.colViolationType}
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">{t.colSeverity}</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">
                          {t.colActionTaken}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {violations.map((v, idx) => (
                        <tr
                          key={`${v.policy_id}-${v.identity_id}-${idx}`}
                          className="border-b last:border-0 hover:bg-muted/50"
                        >
                          <td className="px-4 py-3 font-medium">{v.policy_name}</td>
                          <td className="px-4 py-3">{v.identity_name}</td>
                          <td className="px-4 py-3">{formatLabel(v.violation_type)}</td>
                          <td className="px-4 py-3">
                            <Badge variant={severityBadgeVariant(v.severity)}>
                              {v.severity}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatLabel(v.action_taken)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Create Policy Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t.dialogTitle}</DialogTitle>
              <DialogDescription>
                {t.dialogDescription}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="policy-name">{t.name}</Label>
                <Input
                  id="policy-name"
                  placeholder={t.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="policy-description">{t.descriptionLabel}</Label>
                <Textarea
                  id="policy-description"
                  placeholder={t.descriptionPlaceholder}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="policy-type">{t.policyType}</Label>
                <Select
                  value={policyType}
                  onValueChange={(v) => setPolicyType(v as AccessPolicyType)}
                >
                  <SelectTrigger id="policy-type">
                    <SelectValue placeholder={t.selectType} />
                  </SelectTrigger>
                  <SelectContent>
                    {POLICY_TYPES.map((pt) => (
                      <SelectItem key={pt.value} value={pt.value}>
                        {pt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rule-config">{t.ruleConfig}</Label>
                <Textarea
                  id="rule-config"
                  placeholder='{"max_idle_days": 90}'
                  value={ruleConfigJson}
                  onChange={(e) => setRuleConfigJson(e.target.value)}
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="enforcement">{t.enforcement}</Label>
                  <Select
                    value={enforcement}
                    onValueChange={(v) => setEnforcement(v as PolicyEnforcement)}
                  >
                    <SelectTrigger id="enforcement">
                      <SelectValue placeholder={t.selectEnforcement} />
                    </SelectTrigger>
                    <SelectContent>
                      {ENFORCEMENT_OPTIONS.map((eo) => (
                        <SelectItem key={eo.value} value={eo.value}>
                          {eo.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="severity">{t.severity}</Label>
                  <Select
                    value={severity}
                    onValueChange={(v) => setSeverity(v as CyberSeverity)}
                  >
                    <SelectTrigger id="severity">
                      <SelectValue placeholder={t.selectSeverity} />
                    </SelectTrigger>
                    <SelectContent>
                      {SEVERITY_OPTIONS.map((so) => (
                        <SelectItem key={so.value} value={so.value}>
                          {so.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="policy-enabled"
                  checked={enabled}
                  onCheckedChange={(checked) => setEnabled(checked === true)}
                />
                <Label htmlFor="policy-enabled" className="cursor-pointer">
                  {t.enableImmediately}
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                {t.cancel}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? t.creating : t.createPolicy}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionRedirect>
  );
}
