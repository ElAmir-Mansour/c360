'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, HeartPulse, KeyRound, Loader2, RotateCw, Settings2, Trash2, Waypoints } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import type { StatTone } from '@/components/shared/stat-card';
import { useAuth } from '@/hooks/use-auth';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { formatCompactNumber, formatCurrency, parseApiError } from '@/lib/format';
import { cn, formatDateTime } from '@/lib/utils';
import type {
  VCISOLLMConfigRequest,
  VCISOLLMConfigResponse,
  VCISOLLMHealth,
  VCISOLLMPromptVersion,
  VCISOLLMPromptVersionRequest,
  VCISOLLMUsage,
} from '@/types/cyber';
import { useVcisoLabels } from '../_lib/vciso-i18n';

const DEFAULT_TEMPERATURE = '0.1';

type LLMCredentialStatus = {
  configured: boolean;
  enabled: boolean;
  provider?: string;
  model?: string;
  version?: number;
  last_rotated_at?: string;
  updated_at?: string;
};

export function LLMOpsPanel() {
  const t = useVcisoLabels();
  const { hasPermission } = useAuth();
  const canAdmin = hasPermission('vciso:llm:admin') || hasPermission('admin:*') || hasPermission('*');

  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [promptVersion, setPromptVersion] = useState('');
  const [promptDescription, setPromptDescription] = useState('');
  const [promptText, setPromptText] = useState('');
  const [credentialKey, setCredentialKey] = useState('');

  const healthQuery = useQuery({
    queryKey: ['vciso-llm-health'],
    queryFn: () => apiGet<VCISOLLMHealth>(API_ENDPOINTS.CYBER_VCISO_LLM_HEALTH),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const usageQuery = useQuery({
    queryKey: ['vciso-llm-usage'],
    queryFn: () => apiGet<VCISOLLMUsage>(API_ENDPOINTS.CYBER_VCISO_LLM_USAGE),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const promptsQuery = useQuery({
    queryKey: ['vciso-llm-prompts'],
    queryFn: () => apiGet<VCISOLLMPromptVersion[]>(API_ENDPOINTS.CYBER_VCISO_LLM_PROMPTS),
    enabled: canAdmin,
    staleTime: 30_000,
  });

  const credentialQuery = useQuery({
    queryKey: ['vciso-llm-credential'],
    queryFn: () => apiGet<LLMCredentialStatus>(API_ENDPOINTS.CYBER_VCISO_LLM_CREDENTIAL),
    enabled: canAdmin,
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!healthQuery.data) {
      return;
    }
    if (!model) {
      setProvider(healthQuery.data.provider);
      setModel(healthQuery.data.model);
    }
  }, [healthQuery.data, model]);

  const configMutation = useMutation({
    mutationFn: (payload: VCISOLLMConfigRequest) =>
      apiPut<VCISOLLMConfigResponse>(API_ENDPOINTS.CYBER_VCISO_LLM_CONFIG, payload),
    onSuccess: (response) => {
      toast.success(t.llmOps.settingsUpdatedToast);
      setProvider(response.provider);
      setModel(response.model);
      setTemperature(String(response.temperature));
      void healthQuery.refetch();
    },
    onError: (error) => {
      toast.error(parseApiError(error));
    },
  });

  const createPromptMutation = useMutation({
    mutationFn: (payload: VCISOLLMPromptVersionRequest) =>
      apiPost<VCISOLLMPromptVersion>(API_ENDPOINTS.CYBER_VCISO_LLM_PROMPTS, payload),
    onSuccess: () => {
      toast.success(t.llmOps.promptCreatedToast);
      setPromptVersion('');
      setPromptDescription('');
      setPromptText('');
      void promptsQuery.refetch();
    },
    onError: (error) => {
      toast.error(parseApiError(error));
    },
  });

  const activatePromptMutation = useMutation({
    mutationFn: (version: string) =>
      apiPut<void>(`${API_ENDPOINTS.CYBER_VCISO_LLM_PROMPTS}/${encodeURIComponent(version)}/activate`),
    onSuccess: () => {
      toast.success(t.llmOps.promptActivatedToast);
      void promptsQuery.refetch();
    },
    onError: (error) => {
      toast.error(parseApiError(error));
    },
  });

  const setCredentialMutation = useMutation({
    mutationFn: () =>
      apiPut<LLMCredentialStatus>(API_ENDPOINTS.CYBER_VCISO_LLM_CREDENTIAL, {
        provider: provider.trim(),
        model: model.trim(),
        api_key: credentialKey,
      }),
    onSuccess: (status) => {
      toast.success('LLM credential saved');
      setCredentialKey('');
      if (status.provider) setProvider(status.provider);
      if (status.model) setModel(status.model);
      void credentialQuery.refetch();
      void healthQuery.refetch();
    },
    onError: (error) => {
      toast.error(parseApiError(error));
    },
  });

  const rotateCredentialMutation = useMutation({
    mutationFn: () =>
      apiPost<LLMCredentialStatus>(API_ENDPOINTS.CYBER_VCISO_LLM_CREDENTIAL_ROTATE, {
        api_key: credentialKey,
      }),
    onSuccess: () => {
      toast.success('LLM credential rotated');
      setCredentialKey('');
      void credentialQuery.refetch();
      void healthQuery.refetch();
    },
    onError: (error) => {
      toast.error(parseApiError(error));
    },
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: () => apiDelete<void>(API_ENDPOINTS.CYBER_VCISO_LLM_CREDENTIAL),
    onSuccess: () => {
      toast.success('LLM credential removed');
      void credentialQuery.refetch();
      void healthQuery.refetch();
    },
    onError: (error) => {
      toast.error(parseApiError(error));
    },
  });

  const health = healthQuery.data;
  const usage = usageQuery.data;
  const promptVersions = promptsQuery.data ?? [];
  const credential = credentialQuery.data;

  function handleSaveConfig() {
    const parsedTemperature = Number.parseFloat(temperature);
    if (!provider.trim() || !model.trim() || Number.isNaN(parsedTemperature)) {
      toast.error(t.llmOps.configValidationError);
      return;
    }
    configMutation.mutate({
      provider: provider.trim(),
      model: model.trim(),
      temperature: parsedTemperature,
    });
  }

  function handleCreatePrompt() {
    if (!promptVersion.trim() || !promptText.trim()) {
      toast.error(t.llmOps.promptValidationError);
      return;
    }
    createPromptMutation.mutate({
      version: promptVersion.trim(),
      description: promptDescription.trim(),
      prompt_text: promptText.trim(),
    });
  }

  function handleSetCredential() {
    if (!provider.trim() || !model.trim() || !credentialKey.trim()) {
      toast.error('Provider, model, and API key are required');
      return;
    }
    setCredentialMutation.mutate();
  }

  function handleRotateCredential() {
    if (!credentialKey.trim()) {
      toast.error('Enter the replacement API key');
      return;
    }
    rotateCredentialMutation.mutate();
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-h4 font-semibold">{t.llmOps.title}</h3>
          <p className="text-sm text-muted-foreground">
            {t.llmOps.subtitle}
          </p>
        </div>
        <Badge variant="outline" className="w-fit rounded-full">
          {t.llmOps.auditBadge}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={HeartPulse}
          title={t.llmOps.providerHealth}
          value={healthQuery.isLoading ? t.llmOps.loading : health?.status ?? t.llmOps.unavailable}
          detail={health ? `${health.provider} · ${health.model}` : t.llmOps.healthPending}
          badge={health ? { label: health.status, className: statusClass(health.status) } : undefined}
          tone={health ? healthTone(health.status) : 'neutral'}
        />
        <MetricCard
          icon={Bot}
          title={t.llmOps.latency}
          value={health ? `${health.latency_ms}ms` : '—'}
          detail={health ? t.llmOps.rateLimitRemaining(formatCompactNumber(Math.max(health.rate_limit_remaining, 0))) : t.llmOps.noTelemetry}
          tone="gold"
        />
        <MetricCard
          icon={Waypoints}
          title={t.llmOps.usageToday}
          value={usage ? formatCompactNumber(usage.tokens_today) : '—'}
          detail={usage ? t.llmOps.usageTodayDetail(formatCompactNumber(usage.calls_today), formatCurrency(usage.cost_today)) : t.llmOps.usagePending}
          tone="sky"
        />
        <MetricCard
          icon={Settings2}
          title={t.llmOps.usageThisMonth}
          value={usage ? formatCurrency(usage.cost_this_month) : '—'}
          detail={usage ? t.llmOps.usageThisMonthDetail(formatCompactNumber(usage.calls_this_month)) : t.llmOps.monthlyUnavailable}
          tone="emerald"
        />
      </div>

      {!canAdmin ? (
        <Card className="border-dashed">
          <CardContent className="p-4 text-sm text-muted-foreground sm:p-6">
            {t.llmOps.adminGate}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>{t.llmOps.providerConfigTitle}</CardTitle>
              <CardDescription>
                {t.llmOps.providerConfigDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="llm-provider">{t.llmOps.provider}</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger id="llm-provider">
                    <SelectValue placeholder={t.llmOps.selectProvider} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="azure">Azure OpenAI</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="llm-model">{t.llmOps.model}</Label>
                <Input
                  id="llm-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="gpt-4o"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="llm-temperature">{t.llmOps.temperature}</Label>
                <Input
                  id="llm-temperature"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={temperature}
                  onChange={(event) => setTemperature(event.target.value)}
                />
              </div>

              <div className="rounded-2xl border border-dashed bg-secondary/80 p-3 text-xs text-muted-foreground">
                {t.llmOps.currentHealthCheck(health ? `${health.provider} / ${health.model} at ${health.latency_ms}ms` : t.llmOps.waitingTelemetry)}
              </div>

              <Button
                type="button"
                onClick={handleSaveConfig}
                disabled={configMutation.isPending}
              >
                {configMutation.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
                {t.llmOps.saveOverride}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Tenant LLM Credential
              </CardTitle>
              <CardDescription>
                Store or rotate the write-only provider API key. The key is never returned after save.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border p-3">
                  <p className="text-xs text-muted-foreground">Configured</p>
                  <p className="mt-1 text-sm font-semibold">{credential?.configured ? 'Yes' : 'No'}</p>
                </div>
                <div className="rounded-2xl border p-3">
                  <p className="text-xs text-muted-foreground">Provider</p>
                  <p className="mt-1 text-sm font-semibold">{credential?.provider ?? provider}</p>
                </div>
                <div className="rounded-2xl border p-3">
                  <p className="text-xs text-muted-foreground">Version</p>
                  <p className="mt-1 text-sm font-semibold">{credential?.version ?? 0}</p>
                </div>
              </div>

              {credentialQuery.error && (
                <div className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                  No tenant credential is configured yet, or the credential service is unavailable.
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="llm-api-key">API key</Label>
                <Input
                  id="llm-api-key"
                  type="password"
                  value={credentialKey}
                  onChange={(event) => setCredentialKey(event.target.value)}
                  placeholder="sk-ant-..."
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleSetCredential} disabled={setCredentialMutation.isPending}>
                  {setCredentialMutation.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
                  Save credential
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRotateCredential}
                  disabled={rotateCredentialMutation.isPending || !credential?.configured}
                >
                  <RotateCw className="me-1.5 h-4 w-4" />
                  Rotate key
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => deleteCredentialMutation.mutate()}
                  disabled={deleteCredentialMutation.isPending || !credential?.configured}
                >
                  <Trash2 className="me-1.5 h-4 w-4" />
                  Remove
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle>{t.llmOps.promptVersionsTitle}</CardTitle>
              <CardDescription>
                {t.llmOps.promptVersionsDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                {promptsQuery.isLoading ? (
                  <div className="flex items-center gap-3 rounded-2xl border bg-secondary px-4 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t.llmOps.loadingPrompts}
                  </div>
                ) : promptVersions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
                    {t.llmOps.noPrompts}
                  </div>
                ) : (
                  promptVersions
                    .slice()
                    .sort((left, right) => right.created_at.localeCompare(left.created_at))
                    .map((prompt) => (
                      <div key={prompt.id} className="rounded-2xl border p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold">{prompt.version}</p>
                              {prompt.active && (
                                <Badge className="rounded-full bg-primary text-white hover:bg-primary">
                                  {t.llmOps.active}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {prompt.description?.trim() || t.llmOps.noDescription}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t.llmOps.createdByOn(prompt.created_by, formatDateTime(prompt.created_at))}
                            </p>
                          </div>
                          {!prompt.active && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => activatePromptMutation.mutate(prompt.version)}
                              disabled={activatePromptMutation.isPending}
                            >
                              {t.llmOps.activate}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>

              <Separator />

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold">{t.llmOps.createPromptTitle}</h4>
                  <p className="text-sm text-muted-foreground">
                    {t.llmOps.createPromptDescription}
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="prompt-version">{t.llmOps.version}</Label>
                    <Input
                      id="prompt-version"
                      value={promptVersion}
                      onChange={(event) => setPromptVersion(event.target.value)}
                      placeholder="v1.1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="prompt-description">{t.llmOps.description}</Label>
                    <Input
                      id="prompt-description"
                      value={promptDescription}
                      onChange={(event) => setPromptDescription(event.target.value)}
                      placeholder="Executive routing adjustments"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prompt-text">{t.llmOps.promptText}</Label>
                  <Textarea
                    id="prompt-text"
                    value={promptText}
                    onChange={(event) => setPromptText(event.target.value.slice(0, 100000))}
                    placeholder="You are the vCISO assistant..."
                    className="min-h-[220px]"
                  />
                  <p className="text-xs text-muted-foreground">{promptText.length}/100000</p>
                </div>
                <Button
                  type="button"
                  onClick={handleCreatePrompt}
                  disabled={createPromptMutation.isPending}
                >
                  {createPromptMutation.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
                  {t.llmOps.createPromptVersion}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  detail,
  badge,
  tone = 'neutral',
}: {
  icon: typeof Bot;
  title: string;
  value: string;
  detail: string;
  badge?: { label: string; className?: string };
  tone?: StatTone;
}) {
  // Neutral keeps the historic Card markup so untoned tiles are unchanged; toned
  // tiles delegate to the shared DetailStatCard (decorative accent, neutral value).
  if (tone === 'neutral') {
    return (
      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="h-4 w-4" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-3">
            <p className="text-2xl font-semibold tracking-tight">{value}</p>
            {badge && (
              <Badge variant="outline" className={cn('rounded-full', badge.className)}>
                {badge.label}
              </Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <DetailStatCard
      tone={tone}
      icon={Icon}
      label={title}
      value={value}
      helper={detail}
      badge={
        badge ? (
          <Badge variant="outline" className={cn('rounded-full', badge.className)}>
            {badge.label}
          </Badge>
        ) : undefined
      }
    />
  );
}

function healthTone(status: string): StatTone {
  switch (status.toLowerCase()) {
    case 'healthy':
    case 'ok':
      return 'emerald';
    case 'degraded':
      return 'gold';
    case 'unavailable':
    case 'down':
      return 'rose';
    default:
      return 'slate';
  }
}

function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'healthy':
    case 'ok':
      return 'border-primary/30 text-primary';
    case 'degraded':
      return 'border-warning-300 text-warning-700 dark:border-warning-800 dark:text-warning-300';
    case 'unavailable':
    case 'down':
      return 'border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300';
    default:
      return 'border-border text-foreground';
  }
}
