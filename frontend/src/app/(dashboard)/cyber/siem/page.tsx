'use client';

import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Cpu,
  Database,
  FileCode2,
  Gauge,
  Loader2,
  Plus,
  RotateCw,
  Settings2,
} from 'lucide-react';
import { toast } from 'sonner';

import api, { apiGet, apiPost, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { parseApiError } from '@/lib/format';
import { parseJsonObjectInput, readString, unwrapList } from '@/lib/response-shape';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { StatTile } from '@/components/shared/stat-tile';
import { StatusBadge, genericStatusMap } from '@/components/shared/status-badge';
import { FormField } from '@/components/shared/forms/form-field';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

import { JsonField, KeyValueEditor, SiemToggleField } from './_components/siem-fields';
import { useSiemLabels, type SiemLabels } from './_lib/siem-i18n';

type SIEMSource = {
  id: string;
  name: string;
  type: string;
  transport: string;
  address: string;
  expected_eps: number;
  baseline_eps?: number;
  tz: string;
  status: string;
  version: number;
  last_seen_at?: string;
  cert_expires_at?: string;
  tags?: unknown;
};

type SIEMParser = {
  id: string;
  name: string;
  source_type: string;
  version: string;
  status: string;
  ecs_version: string;
  created_at: string;
  updated_at: string;
};

type SIEMSettings = {
  retention_days: number;
  parser_ci_required: boolean;
  hsm_required: boolean;
  warm_tier_days: number;
  cold_tier_enabled: boolean;
};

type SIEMHealth = {
  id: string;
  name: string;
  status: string;
  eps_1min: number;
  eps_5min: number;
  baseline_eps: number;
  drift_pct: number;
  parser_errors_1h: number;
  dropped_1h: number;
  days_until_cert_expiry: number;
  last_seen_at?: string;
};

type EnrollmentToken = {
  jwt: string;
  purpose: string;
  expires_at: string;
};

const SOURCE_TRANSPORTS = [
  'syslog_udp',
  'syslog_tcp_tls',
  'cef_syslog',
  'leef_syslog',
  'json_https',
  'kafka',
  'cloudtrail_sqs',
  'gcp_pubsub',
  'azure_eventhub',
  'm365_graph',
  'okta_system_log',
  'zeek_json',
  'suricata_json',
] as const;

/* ---- validation ---------------------------------------------------------- */

type SiemValidation = SiemLabels['validation'];

/** A string that must parse to a JSON object (not an array / primitive). */
function jsonObjectString(v: SiemValidation) {
  return z.string().superRefine((raw, ctx) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.jsonObject });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.invalidJson });
    }
  });
}

function buildSourceSchema(v: SiemValidation) {
  return z.object({
    name: z.string().trim().min(1, v.nameRequired).max(255),
    type: z.string().trim().min(1, v.typeRequired),
    transport: z.enum(SOURCE_TRANSPORTS),
    address: z.string().trim().min(1, v.addressRequired),
    expected_eps: z.coerce.number({ invalid_type_error: v.enterNumber }).int(v.wholeNumber).min(0, v.minZero),
    tz: z.string().trim().min(1, v.timezoneRequired),
    tags: z.record(z.string()),
  });
}
type SourceFormValues = z.infer<ReturnType<typeof buildSourceSchema>>;

function buildParserSchema(v: SiemValidation) {
  return z.object({
    name: z.string().trim().min(1, v.nameRequired),
    source_type: z.string().trim().min(1, v.sourceTypeRequired),
    version: z.string().trim().min(1, v.versionRequired),
    ecs_version: z.string().trim().min(1, v.ecsVersionRequired),
    config: jsonObjectString(v),
    fixtures: jsonObjectString(v),
  });
}
type ParserFormValues = z.infer<ReturnType<typeof buildParserSchema>>;

function buildSettingsSchema(v: SiemValidation) {
  return z.object({
    retention_days: z.coerce.number().int().min(1, v.minOne),
    warm_tier_days: z.coerce.number().int().min(0, v.minZero),
    parser_ci_required: z.boolean(),
    hsm_required: z.boolean(),
    cold_tier_enabled: z.boolean(),
  });
}
type SettingsFormValues = z.infer<ReturnType<typeof buildSettingsSchema>>;

const DEFAULT_SETTINGS: SettingsFormValues = {
  retention_days: 365,
  warm_tier_days: 30,
  parser_ci_required: true,
  hsm_required: false,
  cold_tier_enabled: true,
};

export default function SIEMOperationsPage() {
  const t = useSiemLabels();
  const queryClient = useQueryClient();
  const [selectedHealthId, setSelectedHealthId] = useState<string | null>(null);
  const [token, setToken] = useState<EnrollmentToken | null>(null);

  const sourceSchema = useMemo(() => buildSourceSchema(t.validation), [t.validation]);
  const parserSchema = useMemo(() => buildParserSchema(t.validation), [t.validation]);
  const settingsSchema = useMemo(() => buildSettingsSchema(t.validation), [t.validation]);

  const sourceForm = useForm<SourceFormValues>({
    resolver: zodResolver(sourceSchema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
      type: 'generic',
      transport: 'json_https',
      address: '',
      expected_eps: 100,
      tz: 'UTC',
      tags: { environment: 'production' },
    },
  });

  const parserForm = useForm<ParserFormValues>({
    resolver: zodResolver(parserSchema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
      source_type: 'generic',
      version: '1.0.0',
      ecs_version: '8.11',
      config: '{\n  "format": "json"\n}',
      fixtures: '{}',
    },
  });

  const settingsForm = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    mode: 'onBlur',
    defaultValues: DEFAULT_SETTINGS,
  });

  const sourcesQuery = useQuery({
    queryKey: ['siem-sources'],
    queryFn: async () => unwrapList<SIEMSource>(await apiGet(API_ENDPOINTS.SIEM_SOURCES, { limit: 100 }), ['items']),
  });

  const parsersQuery = useQuery({
    queryKey: ['siem-parsers'],
    queryFn: async () => unwrapList<SIEMParser>(await apiGet(API_ENDPOINTS.SIEM_PARSERS, { limit: 100 }), ['items']),
  });

  const settingsQuery = useQuery({
    queryKey: ['siem-settings'],
    queryFn: () => apiGet<SIEMSettings>(API_ENDPOINTS.SIEM_SETTINGS),
  });

  const metaQuery = useQuery({
    queryKey: ['siem-meta'],
    queryFn: () => apiGet<Record<string, unknown>>(API_ENDPOINTS.SIEM_META),
    staleTime: 5 * 60_000,
  });

  const healthQuery = useQuery({
    queryKey: ['siem-source-health', selectedHealthId],
    queryFn: () => apiGet<SIEMHealth>(API_ENDPOINTS.SIEM_SOURCE_HEALTH(selectedHealthId!)),
    enabled: Boolean(selectedHealthId),
  });

  const { reset: resetSettings } = settingsForm;
  useEffect(() => {
    if (settingsQuery.data) {
      resetSettings({
        retention_days: settingsQuery.data.retention_days,
        warm_tier_days: settingsQuery.data.warm_tier_days,
        parser_ci_required: settingsQuery.data.parser_ci_required,
        hsm_required: settingsQuery.data.hsm_required,
        cold_tier_enabled: settingsQuery.data.cold_tier_enabled,
      });
    }
  }, [settingsQuery.data, resetSettings]);

  const createSourceMutation = useMutation({
    mutationFn: (values: SourceFormValues) => {
      const payload = {
        name: values.name.trim(),
        type: values.type.trim(),
        transport: values.transport,
        address: values.address.trim(),
        expected_eps: values.expected_eps,
        tz: values.tz.trim() || 'UTC',
        tags: values.tags,
      };
      return apiPost<{ source: SIEMSource; enrollment_token: EnrollmentToken }>(API_ENDPOINTS.SIEM_SOURCES, payload);
    },
    onSuccess: (response, values) => {
      toast.success(t.source.onboardedToast);
      setToken(response.enrollment_token);
      // Keep type/transport/tz/tags for rapid multi-source onboarding.
      sourceForm.reset({ ...values, name: '', address: '' });
      void queryClient.invalidateQueries({ queryKey: ['siem-sources'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const sourceActionMutation = useMutation({
    mutationFn: async ({ source, action }: { source: SIEMSource; action: 'enable' | 'disable' | 'rotate' }) => {
      const headers = { 'If-Match': String(source.version) };
      if (action === 'enable') {
        return api.post(API_ENDPOINTS.SIEM_SOURCE_ENABLE(source.id), {}, { headers }).then((res) => res.data);
      }
      if (action === 'disable') {
        return api.post(API_ENDPOINTS.SIEM_SOURCE_DISABLE(source.id), { reason: t.source.disableReason }, { headers }).then((res) => res.data);
      }
      return api.post<EnrollmentToken>(API_ENDPOINTS.SIEM_SOURCE_ROTATE_CERT(source.id), { force: false }, { headers }).then((res) => res.data);
    },
    onSuccess: (response, variables) => {
      if (variables.action === 'rotate') {
        setToken(response as EnrollmentToken);
      }
      toast.success(variables.action === 'rotate' ? t.source.tokenRotatedToast : t.source.updatedToast);
      void queryClient.invalidateQueries({ queryKey: ['siem-sources'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const createParserMutation = useMutation({
    mutationFn: (values: ParserFormValues) => apiPost<SIEMParser>(API_ENDPOINTS.SIEM_PARSERS, {
      name: values.name.trim(),
      source_type: values.source_type.trim(),
      version: values.version.trim(),
      ecs_version: values.ecs_version.trim(),
      config: parseJsonObjectInput(values.config, 'Parser config'),
      fixtures: parseJsonObjectInput(values.fixtures, 'Fixtures'),
    }),
    onSuccess: (_response, values) => {
      toast.success(t.parser.createdToast);
      parserForm.reset({ ...values, name: '' });
      void queryClient.invalidateQueries({ queryKey: ['siem-parsers'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const parserActionMutation = useMutation({
    mutationFn: ({ parser, action }: { parser: SIEMParser; action: 'promote' | 'retire' }) =>
      apiPost<SIEMParser>(action === 'promote' ? API_ENDPOINTS.SIEM_PARSER_PROMOTE(parser.id) : API_ENDPOINTS.SIEM_PARSER_RETIRE(parser.id), {}),
    onSuccess: () => {
      toast.success(t.parser.lifecycleToast);
      void queryClient.invalidateQueries({ queryKey: ['siem-parsers'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const settingsMutation = useMutation({
    mutationFn: (values: SettingsFormValues) => apiPut<SIEMSettings>(API_ENDPOINTS.SIEM_SETTINGS, values),
    onSuccess: (response) => {
      toast.success(t.settings.savedToast);
      resetSettings(response);
      void queryClient.invalidateQueries({ queryKey: ['siem-settings'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const sources = sourcesQuery.data ?? [];
  const parsers = parsersQuery.data ?? [];
  const activeSources = sources.filter((source) => source.status === 'active').length;
  const activeParsers = parsers.filter((p) => p.status === 'active').length;
  const totalEps = sources.reduce((sum, source) => sum + (source.expected_eps || 0), 0);
  const metaSummary = useMemo(() => {
    if (!metaQuery.data) return t.stats.metaLoading;
    const version = readString(metaQuery.data.version, t.stats.metaUnknown);
    const service = readString(metaQuery.data.service, 'siem-service');
    return `${service} · ${version}`;
  }, [metaQuery.data, t.stats.metaLoading, t.stats.metaUnknown]);

  const onCreateSource = sourceForm.handleSubmit((values) => createSourceMutation.mutate(values));
  const onCreateParser = parserForm.handleSubmit((values) => createParserMutation.mutate(values));
  const onSaveSettings = settingsForm.handleSubmit((values) => settingsMutation.mutate(values));

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.page.eyebrow}
          title={t.page.title}
          description={t.page.description}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={t.stats.sources}
            value={sources.length}
            icon={Database}
            tone="primary"
            loading={sourcesQuery.isLoading}
            error={Boolean(sourcesQuery.error)}
            helper={t.stats.sourcesHelper(activeSources)}
          />
          <StatTile
            label={t.stats.expectedEps}
            value={totalEps.toLocaleString()}
            icon={Gauge}
            tone="info"
            loading={sourcesQuery.isLoading}
            error={Boolean(sourcesQuery.error)}
            helper={t.stats.expectedEpsHelper}
          />
          <StatTile
            label={t.stats.parsers}
            value={parsers.length}
            icon={FileCode2}
            tone="success"
            loading={parsersQuery.isLoading}
            error={Boolean(parsersQuery.error)}
            helper={t.stats.parsersHelper(activeParsers)}
          />
          <StatTile
            label={t.stats.runtime}
            value={metaQuery.isLoading ? t.stats.runtimeLoading : t.stats.runtimeOnline}
            icon={Cpu}
            tone="neutral"
            helper={metaSummary}
          />
        </div>

        <Tabs defaultValue="sources">
          <TabsList>
            <TabsTrigger value="sources"><Activity className="me-1.5 h-4 w-4" />{t.tabs.sources}</TabsTrigger>
            <TabsTrigger value="parsers"><FileCode2 className="me-1.5 h-4 w-4" />{t.tabs.parsers}</TabsTrigger>
            <TabsTrigger value="settings"><Settings2 className="me-1.5 h-4 w-4" />{t.tabs.settings}</TabsTrigger>
          </TabsList>

          <TabsContent value="sources" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
              <Card>
                <CardHeader>
                  <CardTitle>{t.source.onboardTitle}</CardTitle>
                  <CardDescription>{t.source.onboardDescription}</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormProvider {...sourceForm}>
                    <form onSubmit={onCreateSource} className="space-y-4" noValidate>
                      <FormErrorSummary />
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField name="name" label={t.source.name} required>
                          <Input id="name" {...sourceForm.register('name')} />
                        </FormField>
                        <FormField name="type" label={t.source.type} required>
                          <Input id="type" {...sourceForm.register('type')} />
                        </FormField>
                        <FormField name="transport" label={t.source.transport} required>
                          <Select
                            value={sourceForm.watch('transport')}
                            onValueChange={(value) => sourceForm.setValue('transport', value as SourceFormValues['transport'], { shouldValidate: true })}
                          >
                            <SelectTrigger id="transport"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SOURCE_TRANSPORTS.map((transport) => (
                                <SelectItem key={transport} value={transport}>{transport.replace(/_/g, ' ')}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormField>
                        <FormField name="expected_eps" label={t.source.expectedEps} required>
                          <Input id="expected_eps" type="number" min={0} {...sourceForm.register('expected_eps')} />
                        </FormField>
                      </div>
                      <FormField name="address" label={t.source.address} required>
                        <Input id="address" {...sourceForm.register('address')} />
                      </FormField>
                      <FormField name="tz" label={t.source.timezone} required>
                        <Input id="tz" {...sourceForm.register('tz')} />
                      </FormField>
                      <FormField name="tags" label={t.source.tags} description={t.source.tagsDescription}>
                        <KeyValueEditor
                          name="tags"
                          control={sourceForm.control}
                          addLabel={t.source.addTag}
                          keyPlaceholder={t.fields.keyPlaceholder}
                          valuePlaceholder={t.fields.valuePlaceholder}
                          removeLabel={t.fields.removeEntry}
                        />
                      </FormField>
                      <Button type="submit" disabled={createSourceMutation.isPending}>
                        {createSourceMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Plus className="me-1.5 h-4 w-4" />}
                        {t.source.submitIdle}
                      </Button>
                    </form>
                  </FormProvider>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t.source.fleetTitle}</CardTitle>
                  <CardDescription>{t.source.fleetDescription}</CardDescription>
                </CardHeader>
                <CardContent>
                  {sourcesQuery.error ? (
                    <ErrorState error={sourcesQuery.error} onRetry={() => void sourcesQuery.refetch()} />
                  ) : sourcesQuery.isLoading ? (
                    <ListSkeleton rows={3} />
                  ) : sources.length === 0 ? (
                    <EmptyState
                      illustration="inbox"
                      size="compact"
                      title={t.source.emptyTitle}
                      description={t.source.emptyDescription}
                    />
                  ) : (
                    <div className="space-y-3">
                      {sources.map((source) => (
                        <div key={source.id} className="rounded-lg border p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium">{source.name}</p>
                                <StatusBadge status={source.status} map={genericStatusMap} size="sm" />
                                <Badge variant="secondary">{source.transport.replace(/_/g, ' ')}</Badge>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{source.address || t.source.noAddress} · v{source.version}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" onClick={() => setSelectedHealthId(source.id)}>{t.source.health}</Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => sourceActionMutation.mutate({ source, action: source.status === 'disabled' ? 'enable' : 'disable' })}
                                disabled={sourceActionMutation.isPending}
                              >
                                {source.status === 'disabled' ? t.source.enable : t.source.disable}
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => sourceActionMutation.mutate({ source, action: 'rotate' })} disabled={sourceActionMutation.isPending}>
                                <RotateCw className="me-1.5 h-3.5 w-3.5" />{t.source.rotateCert}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {(token || selectedHealthId) && (
              <div className="grid gap-4 lg:grid-cols-2">
                {token && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t.source.tokenTitle}</CardTitle>
                      <CardDescription>{t.source.tokenDescription}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Badge variant="outline">{token.purpose} · {t.source.tokenExpires(new Date(token.expires_at).toLocaleString())}</Badge>
                      <Textarea value={token.jwt} readOnly className="min-h-[140px] font-mono text-xs" />
                    </CardContent>
                  </Card>
                )}

                {selectedHealthId && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t.source.healthTitle}</CardTitle>
                      <CardDescription>{t.source.healthDescription}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {healthQuery.error ? (
                        <ErrorState error={healthQuery.error} onRetry={() => void healthQuery.refetch()} />
                      ) : healthQuery.isLoading ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {Array.from({ length: 4 }).map((_, i) => (
                            <StatTile key={i} label="" loading size="sm" />
                          ))}
                        </div>
                      ) : healthQuery.data ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <StatTile size="sm" label={t.source.healthStatus} value={healthQuery.data.status} helper={healthQuery.data.name} />
                          <StatTile size="sm" label={t.source.healthEps} value={`${healthQuery.data.eps_1min} / ${healthQuery.data.eps_5min}`} helper={t.source.healthBaseline(healthQuery.data.baseline_eps)} />
                          <StatTile size="sm" label={t.source.healthParserErrors} value={healthQuery.data.parser_errors_1h} helper={t.source.healthLastHour} />
                          <StatTile size="sm" label={t.source.healthCertExpiry} value={t.source.healthCertExpiryValue(healthQuery.data.days_until_cert_expiry)} helper={t.source.healthDaysRemaining} />
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="parsers" className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <Card>
              <CardHeader>
                <CardTitle>{t.parser.createTitle}</CardTitle>
                <CardDescription>{t.parser.createDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                <FormProvider {...parserForm}>
                  <form onSubmit={onCreateParser} className="space-y-4" noValidate>
                    <FormErrorSummary />
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField name="name" label={t.parser.name} required>
                        <Input id="name" {...parserForm.register('name')} />
                      </FormField>
                      <FormField name="source_type" label={t.parser.sourceType} required>
                        <Input id="source_type" {...parserForm.register('source_type')} />
                      </FormField>
                      <FormField name="version" label={t.parser.version} required>
                        <Input id="version" {...parserForm.register('version')} />
                      </FormField>
                      <FormField name="ecs_version" label={t.parser.ecsVersion} required>
                        <Input id="ecs_version" {...parserForm.register('ecs_version')} />
                      </FormField>
                    </div>
                    <FormField name="config" label={t.parser.config} description={t.parser.configDescription}>
                      <JsonField name="config" control={parserForm.control} formatLabel={t.fields.format} />
                    </FormField>
                    <FormField name="fixtures" label={t.parser.fixtures} description={t.parser.fixturesDescription}>
                      <JsonField name="fixtures" control={parserForm.control} formatLabel={t.fields.format} />
                    </FormField>
                    <Button type="submit" disabled={createParserMutation.isPending}>
                      {createParserMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Plus className="me-1.5 h-4 w-4" />}
                      {t.parser.submitIdle}
                    </Button>
                  </form>
                </FormProvider>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t.parser.registryTitle}</CardTitle>
                <CardDescription>{t.parser.registryDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {parsersQuery.error ? (
                  <ErrorState error={parsersQuery.error} onRetry={() => void parsersQuery.refetch()} />
                ) : parsersQuery.isLoading ? (
                  <ListSkeleton rows={3} />
                ) : parsers.length === 0 ? (
                  <EmptyState
                    illustration="inbox"
                    size="compact"
                    title={t.parser.emptyTitle}
                    description={t.parser.emptyDescription}
                  />
                ) : (
                  parsers.map((parser) => (
                    <div key={parser.id} className="rounded-lg border p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{parser.name}</p>
                            <StatusBadge status={parser.status} map={genericStatusMap} size="sm" />
                            <Badge variant="secondary">{parser.source_type}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{t.parser.versionLine(parser.version, parser.ecs_version)}</p>
                        </div>
                        <div className="flex gap-2">
                          {parser.status !== 'active' && (
                            <Button variant="outline" size="sm" onClick={() => parserActionMutation.mutate({ parser, action: 'promote' })}>{t.parser.promote}</Button>
                          )}
                          {parser.status !== 'retired' && (
                            <Button variant="outline" size="sm" onClick={() => parserActionMutation.mutate({ parser, action: 'retire' })}>{t.parser.retire}</Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>{t.settings.title}</CardTitle>
                <CardDescription>{t.settings.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {settingsQuery.error ? (
                  <ErrorState error={settingsQuery.error} onRetry={() => void settingsQuery.refetch()} />
                ) : settingsQuery.isLoading ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-3">
                      <Skeleton className="h-16" />
                      <Skeleton className="h-16" />
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Skeleton className="h-14" />
                      <Skeleton className="h-14" />
                      <Skeleton className="h-14" />
                    </div>
                  </div>
                ) : (
                  <FormProvider {...settingsForm}>
                    <form onSubmit={onSaveSettings} className="space-y-5" noValidate>
                      <FormErrorSummary />
                      <div className="grid gap-4 md:grid-cols-3">
                        <FormField name="retention_days" label={t.settings.retentionDays} required>
                          <Input id="retention_days" type="number" min={1} {...settingsForm.register('retention_days')} />
                        </FormField>
                        <FormField name="warm_tier_days" label={t.settings.warmTierDays} required>
                          <Input id="warm_tier_days" type="number" min={0} {...settingsForm.register('warm_tier_days')} />
                        </FormField>
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <SiemToggleField name="parser_ci_required" control={settingsForm.control} label={t.settings.parserCiRequired} />
                        <SiemToggleField name="hsm_required" control={settingsForm.control} label={t.settings.hsmRequired} />
                        <SiemToggleField name="cold_tier_enabled" control={settingsForm.control} label={t.settings.coldTierEnabled} />
                      </div>
                      <Button type="submit" disabled={settingsMutation.isPending}>
                        {settingsMutation.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
                        {t.settings.submitIdle}
                      </Button>
                    </form>
                  </FormProvider>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PermissionRedirect>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
