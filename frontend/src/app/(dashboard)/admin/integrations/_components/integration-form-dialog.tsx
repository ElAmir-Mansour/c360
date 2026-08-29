"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ExternalLink, KeyRound, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { apiPost, apiPut } from "@/lib/api";
import type { ApiResponse } from "@/types/api";
import type { IntegrationProviderStatus, IntegrationRecord, IntegrationType } from "@/types/integration";
import {
  buildIntegrationPayload,
  emptyFilterState,
  EVENT_TYPE_OPTIONS,
  type EventFilterFormState,
  formStateFromIntegration,
  getDefaultFormState,
  InvalidIntegrationJsonError,
  prepareOAuthInstall,
  SEVERITY_OPTIONS,
  SUITE_OPTIONS,
  type IntegrationFormState,
} from "./integration-utils";
import {
  errorToastMessage,
  eventTypeLabel,
  integrationTypeLabel,
  providerPresentation,
  severityLabel,
  suiteLabel,
  useIntegrationsT,
  type IntegrationsLabels,
} from "../_lib/integrations-i18n";

interface IntegrationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (integration: IntegrationRecord) => void;
  providers: IntegrationProviderStatus[];
  integration?: IntegrationRecord | null;
  initialType?: IntegrationType | null;
}

export function IntegrationFormDialog({
  open,
  onOpenChange,
  onSaved,
  providers,
  integration,
  initialType,
}: IntegrationFormDialogProps) {
  const t = useIntegrationsT();
  const [state, setState] = useState<IntegrationFormState>(getDefaultFormState(initialType ?? "webhook"));
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOAuthLoading] = useState(false);
  const provider = useMemo(
    () => providers.find((item) => item.type === state.type) ?? null,
    [providers, state.type],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    if (integration) {
      setState(formStateFromIntegration(integration));
      return;
    }
    setState(getDefaultFormState(initialType ?? "webhook"));
  }, [open, integration, initialType]);

  const updateConfig = <K extends keyof IntegrationFormState["config"]>(
    key: K,
    value: IntegrationFormState["config"][K],
  ) => {
    setState((current) => ({
      ...current,
      config: {
        ...current.config,
        [key]: value,
      },
    }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload = buildIntegrationPayload(state, integration ?? undefined);
      if (integration) {
        const response = await apiPut<ApiResponse<IntegrationRecord>>(`/api/v1/integrations/${integration.id}`, payload);
        toast.success(t.integrationUpdated(integrationTypeLabel(t, integration.type)));
        onSaved(response.data);
      } else {
        const response = await apiPost<ApiResponse<IntegrationRecord>>("/api/v1/integrations", payload);
        toast.success(t.integrationCreated(integrationTypeLabel(t, state.type)));
        onSaved(response.data);
      }
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof InvalidIntegrationJsonError
          ? t.invalidJson(configFieldLabel(t, error.fieldKey))
          : errorToastMessage(t, error, t.unableToSaveIntegration);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOAuthStart = async () => {
    if (!provider || (provider.type !== "slack" && provider.type !== "jira")) {
      toast.error(t.oauthUnavailableProvider);
      return;
    }
    setOAuthLoading(true);
    try {
      const url = await prepareOAuthInstall(provider.type, {
        name: state.name,
        project_key: provider.type === "jira" ? state.config.project_key : undefined,
      });
      window.location.assign(url);
    } catch (error) {
      const message = errorToastMessage(t, error, t.unableToStartOAuth);
      toast.error(message);
    } finally {
      setOAuthLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{integration ? t.editName(integration.name) : t.configureIntegration}</DialogTitle>
          <DialogDescription>
            {integration ? t.editDescription : t.createDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {!integration ? (
            <section className="space-y-3">
              <Label>{t.provider}</Label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {providers.map((item) => {
                  const selected = item.type === state.type;
                  const presentation = providerPresentation(t, item);
                  return (
                    <button
                      key={item.type}
                      type="button"
                      className={`rounded-lg border p-4 text-start transition ${
                        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                      }`}
                      onClick={() => setState(getDefaultFormState(item.type))}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{presentation.name}</div>
                          <div className="mt-1 text-sm text-muted-foreground">{presentation.description}</div>
                        </div>
                        <span className="rounded-full border px-2 py-0.5 text-overline uppercase tracking-wide text-muted-foreground">
                          {item.setup_mode === "oauth" ? t.oauth : t.manualMode}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {provider && (provider.type === "slack" || provider.type === "jira") ? (
            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertTitle>{t.oauthAvailableTitle}</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  {provider.configured
                    ? t.oauthConfiguredHint(
                        providerPresentation(t, provider).name,
                        provider.type === "slack" ? t.channelWord : t.projectWord,
                      )
                    : t.oauthNotConfiguredHint(providerPresentation(t, provider).name)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!provider.configured || !provider.oauth_enabled || oauthLoading}
                    onClick={() => void handleOAuthStart()}
                  >
                    <ExternalLink className="me-2 h-4 w-4" />
                    {t.connectViaOAuth}
                  </Button>
                  {!provider.configured && provider.missing_config?.length ? (
                    <span className="text-xs text-muted-foreground">
                      {t.missingRuntimeConfig(provider.missing_config.join(", "))}
                    </span>
                  ) : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="integration-name">{t.name}</Label>
              <Input
                id="integration-name"
                value={state.name}
                onChange={(event) => setState((current) => ({ ...current, name: event.target.value }))}
                placeholder={t.namePlaceholder(integrationTypeLabel(t, state.type))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="integration-type">{t.type}</Label>
              <Select
                value={state.type}
                onValueChange={(value) => {
                  if (integration) {
                    return;
                  }
                  setState(getDefaultFormState(value as IntegrationType));
                }}
                disabled={Boolean(integration)}
              >
                <SelectTrigger id="integration-type">
                  <SelectValue placeholder={t.selectTypePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((item) => (
                    <SelectItem key={item.type} value={item.type}>
                      {providerPresentation(t, item).name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="integration-description">{t.description}</Label>
              <Textarea
                id="integration-description"
                value={state.description}
                onChange={(event) => setState((current) => ({ ...current, description: event.target.value }))}
                placeholder={t.descriptionPlaceholder}
              />
            </div>
          </section>

          <Separator />
          <ConnectionFields
            type={state.type}
            state={state}
            updateConfig={updateConfig}
            editing={Boolean(integration)}
            t={t}
          />

          <Separator />
          <EventFilterEditor state={state} onChange={setState} t={t} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t.cancel}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || !state.name.trim()}>
            {submitting ? t.saving : integration ? t.saveChanges : t.createIntegration}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionFields({
  type,
  state,
  updateConfig,
  editing,
  t,
}: {
  type: IntegrationType;
  state: IntegrationFormState;
  updateConfig: <K extends keyof IntegrationFormState["config"]>(
    key: K,
    value: IntegrationFormState["config"][K],
  ) => void;
  editing: boolean;
  t: IntegrationsLabels;
}) {
  const secretHint = editing ? t.secretHintEditing : t.secretHintNew;

  switch (type) {
    case "slack":
      return (
        <section className="space-y-4">
          <SectionTitle title={t.slackConnectionTitle} description={t.slackConnectionDesc} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t.botToken} hint={secretHint}>
              <Input value={state.config.bot_token} onChange={(event) => updateConfig("bot_token", event.target.value)} placeholder="xoxb-..." />
            </Field>
            <Field label={t.signingSecret} hint={secretHint}>
              <Input value={state.config.signing_secret} onChange={(event) => updateConfig("signing_secret", event.target.value)} type="password" placeholder={t.signingSecretPlaceholder} />
            </Field>
            <Field label={t.workspaceId}>
              <Input value={state.config.team_id} onChange={(event) => updateConfig("team_id", event.target.value)} placeholder="T12345678" />
            </Field>
            <Field label={t.workspaceName}>
              <Input value={state.config.team_name} onChange={(event) => updateConfig("team_name", event.target.value)} placeholder={t.workspaceNamePlaceholder} />
            </Field>
            <Field label={t.channelId}>
              <Input value={state.config.channel_id} onChange={(event) => updateConfig("channel_id", event.target.value)} placeholder="C12345678" />
            </Field>
            <Field label={t.incomingWebhookUrl} className="md:col-span-2">
              <Input
                value={state.config.incoming_webhook_url}
                onChange={(event) => updateConfig("incoming_webhook_url", event.target.value)}
                placeholder="https://hooks.slack.com/services/..."
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ToggleField
              label={t.threadPerAlert}
              hint={t.toggleFieldHint}
              checked={state.config.thread_per_alert}
              onCheckedChange={(checked) => updateConfig("thread_per_alert", checked)}
            />
            <ToggleField
              label={t.includeExplanation}
              hint={t.toggleFieldHint}
              checked={state.config.include_explanation}
              onCheckedChange={(checked) => updateConfig("include_explanation", checked)}
            />
          </div>
        </section>
      );
    case "teams":
      return (
        <section className="space-y-4">
          <SectionTitle title={t.teamsConnectionTitle} description={t.teamsConnectionDesc} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t.botAppId}>
              <Input value={state.config.bot_app_id} onChange={(event) => updateConfig("bot_app_id", event.target.value)} />
            </Field>
            <Field label={t.botPassword} hint={secretHint}>
              <Input value={state.config.bot_password} onChange={(event) => updateConfig("bot_password", event.target.value)} type="password" />
            </Field>
            <Field label={t.serviceUrl}>
              <Input value={state.config.service_url} onChange={(event) => updateConfig("service_url", event.target.value)} placeholder="https://smba.trafficmanager.net/emea/" />
            </Field>
            <Field label={t.conversationId}>
              <Input value={state.config.conversation_id} onChange={(event) => updateConfig("conversation_id", event.target.value)} />
            </Field>
            <Field label={t.tenantId} className="md:col-span-2">
              <Input value={state.config.tenant_id} onChange={(event) => updateConfig("tenant_id", event.target.value)} />
            </Field>
          </div>
        </section>
      );
    case "jira":
      return (
        <section className="space-y-4">
          <SectionTitle title={t.jiraConnectionTitle} description={t.jiraConnectionDesc} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t.baseUrl}>
              <Input value={state.config.base_url} onChange={(event) => updateConfig("base_url", event.target.value)} placeholder="https://company.atlassian.net" />
            </Field>
            <Field label={t.cloudId}>
              <Input value={state.config.cloud_id} onChange={(event) => updateConfig("cloud_id", event.target.value)} />
            </Field>
            <Field label={t.projectKey}>
              <Input value={state.config.project_key} onChange={(event) => updateConfig("project_key", event.target.value)} placeholder="SEC" />
            </Field>
            <Field label={t.issueTypeId}>
              <Input value={state.config.issue_type_id} onChange={(event) => updateConfig("issue_type_id", event.target.value)} />
            </Field>
            <Field label={t.authToken} hint={secretHint}>
              <Input value={state.config.auth_token} onChange={(event) => updateConfig("auth_token", event.target.value)} type="password" />
            </Field>
            <Field label={t.refreshToken} hint={secretHint}>
              <Input value={state.config.refresh_token} onChange={(event) => updateConfig("refresh_token", event.target.value)} type="password" />
            </Field>
            <Field label={t.webhookSecret} hint={t.webhookSecretJiraHint} className="md:col-span-2">
              <Input value={state.config.webhook_secret} onChange={(event) => updateConfig("webhook_secret", event.target.value)} type="password" />
            </Field>
            <Field label={t.priorityMappingJson}>
              <Textarea value={state.config.priority_mapping} onChange={(event) => updateConfig("priority_mapping", event.target.value)} className="min-h-[140px] font-mono text-xs" />
            </Field>
            <Field label={t.statusMappingJson}>
              <Textarea value={state.config.status_mapping} onChange={(event) => updateConfig("status_mapping", event.target.value)} className="min-h-[140px] font-mono text-xs" />
            </Field>
            <Field label={t.customFieldsJson} className="md:col-span-2">
              <Textarea value={state.config.custom_fields} onChange={(event) => updateConfig("custom_fields", event.target.value)} className="min-h-[160px] font-mono text-xs" />
            </Field>
          </div>
        </section>
      );
    case "servicenow":
      return (
        <section className="space-y-4">
          <SectionTitle title={t.servicenowConnectionTitle} description={t.servicenowConnectionDesc} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t.instanceUrl}>
              <Input value={state.config.instance_url} onChange={(event) => updateConfig("instance_url", event.target.value)} placeholder="https://company.service-now.com" />
            </Field>
            <Field label={t.authType}>
              <Select value={state.config.auth_type} onValueChange={(value) => updateConfig("auth_type", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">{t.basic}</SelectItem>
                  <SelectItem value="oauth">{t.oauth}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {state.config.auth_type === "basic" ? (
              <>
                <Field label={t.username}>
                  <Input value={state.config.username} onChange={(event) => updateConfig("username", event.target.value)} />
                </Field>
                <Field label={t.password} hint={secretHint}>
                  <Input value={state.config.password} onChange={(event) => updateConfig("password", event.target.value)} type="password" />
                </Field>
              </>
            ) : (
              <Field label={t.oauthTokenLabel} hint={secretHint} className="md:col-span-2">
                <Input value={state.config.oauth_token} onChange={(event) => updateConfig("oauth_token", event.target.value)} type="password" />
              </Field>
            )}
            <Field label={t.assignmentGroup}>
              <Input value={state.config.assignment_group} onChange={(event) => updateConfig("assignment_group", event.target.value)} />
            </Field>
            <Field label={t.callerId}>
              <Input value={state.config.caller_id} onChange={(event) => updateConfig("caller_id", event.target.value)} />
            </Field>
            <Field label={t.category}>
              <Input value={state.config.category} onChange={(event) => updateConfig("category", event.target.value)} placeholder={t.categoryPlaceholder} />
            </Field>
            <Field label={t.subcategory}>
              <Input value={state.config.subcategory} onChange={(event) => updateConfig("subcategory", event.target.value)} placeholder={t.subcategoryPlaceholder} />
            </Field>
            <Field label={t.webhookSecret} hint={t.webhookSecretServiceNowHint} className="md:col-span-2">
              <Input value={state.config.webhook_secret} onChange={(event) => updateConfig("webhook_secret", event.target.value)} type="password" />
            </Field>
            <Field label={t.statusMappingJson}>
              <Textarea value={state.config.status_mapping} onChange={(event) => updateConfig("status_mapping", event.target.value)} className="min-h-[140px] font-mono text-xs" />
            </Field>
            <Field label={t.customFieldsJson}>
              <Textarea value={state.config.custom_fields} onChange={(event) => updateConfig("custom_fields", event.target.value)} className="min-h-[140px] font-mono text-xs" />
            </Field>
          </div>
        </section>
      );
    case "webhook":
      return (
        <section className="space-y-4">
          <SectionTitle title={t.webhookConnectionTitle} description={t.webhookConnectionDesc} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t.url} className="md:col-span-2">
              <Input value={state.config.url} onChange={(event) => updateConfig("url", event.target.value)} placeholder="https://ops.example.com/hooks/clario" />
            </Field>
            <Field label={t.method}>
              <Select value={state.config.method} onValueChange={(value) => updateConfig("method", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t.contentType}>
              <Input value={state.config.content_type} onChange={(event) => updateConfig("content_type", event.target.value)} placeholder="application/json" />
            </Field>
            <Field label={t.sharedSecret} hint={secretHint}>
              <Input value={state.config.secret} onChange={(event) => updateConfig("secret", event.target.value)} type="password" />
            </Field>
            <Field label={t.headersJson} className="md:col-span-2">
              <Textarea value={state.config.headers} onChange={(event) => updateConfig("headers", event.target.value)} className="min-h-[160px] font-mono text-xs" />
            </Field>
          </div>
        </section>
      );
  }
}

function EventFilterEditor({
  state,
  onChange,
  t,
}: {
  state: IntegrationFormState;
  onChange: React.Dispatch<React.SetStateAction<IntegrationFormState>>;
  t: IntegrationsLabels;
}) {
  const updateFilter = (index: number, patch: Partial<EventFilterFormState>) => {
    onChange((current) => ({
      ...current,
      filters: current.filters.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));
  };

  const addFilter = () => {
    onChange((current) => ({ ...current, filters: [...current.filters, emptyFilterState()] }));
  };

  const removeFilter = (index: number) => {
    onChange((current) => ({
      ...current,
      filters: current.filters.length > 1 ? current.filters.filter((_, i) => i !== index) : [emptyFilterState()],
    }));
  };

  return (
    <section className="space-y-4">
      <SectionTitle title={t.eventFiltersTitle} description={t.eventFiltersDescription} />

      {state.filters.map((filter, index) => (
        <div key={index} className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">
              {state.filters.length > 1 ? t.filterRuleNumbered(index + 1) : t.filterRule}
            </div>
            {state.filters.length > 1 ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => removeFilter(index)}>
                <Trash2 className="me-1 h-3.5 w-3.5" />
                {t.remove}
              </Button>
            ) : null}
          </div>

          <FilterGroup
            title={t.eventTypes}
            options={EVENT_TYPE_OPTIONS}
            getLabel={(option) => eventTypeLabel(t, option)}
            selected={filter.eventTypes}
            onToggle={(value) =>
              updateFilter(index, { eventTypes: toggleArrayValue(filter.eventTypes, value) })
            }
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FilterGroup
              title={t.severities}
              options={SEVERITY_OPTIONS}
              getLabel={(option) => severityLabel(t, option)}
              selected={filter.severities}
              onToggle={(value) =>
                updateFilter(index, { severities: toggleArrayValue(filter.severities, value) })
              }
            />
            <FilterGroup
              title={t.suites}
              options={SUITE_OPTIONS}
              getLabel={(option) => suiteLabel(t, option)}
              selected={filter.suites}
              onToggle={(value) =>
                updateFilter(index, { suites: toggleArrayValue(filter.suites, value) })
              }
            />
          </div>

          <Field label={t.minimumConfidence}>
            <Input
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={filter.minConfidence}
              onChange={(event) => updateFilter(index, { minConfidence: event.target.value })}
              placeholder="0.70"
            />
          </Field>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addFilter}>
        <Plus className="me-1 h-3.5 w-3.5" />
        {t.addFilterRule}
      </Button>
    </section>
  );
}

function FilterGroup({
  title,
  options,
  getLabel,
  selected,
  onToggle,
}: {
  title: string;
  options: readonly string[];
  getLabel: (value: string) => string;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="font-medium">{title}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(option)} onCheckedChange={() => onToggle(option)} />
            <span>{getLabel(option)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function configFieldLabel(t: IntegrationsLabels, key: keyof IntegrationFormState["config"]): string {
  switch (key) {
    case "priority_mapping":
      return t.priorityMappingJson;
    case "status_mapping":
      return t.statusMappingJson;
    case "custom_fields":
      return t.customFieldsJson;
    case "headers":
      return t.headersJson;
    default:
      return String(key);
  }
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ToggleField({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="space-y-1">
        <div className="font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function toggleArrayValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
