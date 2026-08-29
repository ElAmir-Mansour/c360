'use client';

/**
 * CustomConnectorBuilder (#18) — a no-code REST connector builder.
 *
 * Produces a connector of kind `custom` whose `config` carries a declarative
 * {@link CustomConnectorSpec} (base URL, auth, request template, response mapping,
 * pagination) that the backend's CustomConnector adapter executes. The builder is
 * surfaced from the catalog gallery's "Build a custom connector" card and from the
 * setup wizard; picking either lands on `/lex/admin/integrations/new?kind=custom`,
 * which renders this builder instead of the schema-driven dynamic form.
 *
 * Flow: fill the spec → Save (POST /integrations, kind=custom) → Test (the
 * existing POST /integrations/{id}/test runs the spec) → finish to the detail
 * page. The spec is serialized into a single config key
 * ({@link CUSTOM_SPEC_CONFIG_KEY}) so the existing schema/test/registry machinery
 * treats it as one field. Response field mapping reuses the shared
 * {@link FieldMapper}.
 *
 * SECRETS (password / token / client_secret / hmac secret) are write-only: on a
 * loaded endpoint they arrive as {@link REDACTED_SENTINEL} and render "•••••• (set)"
 * with a Replace toggle; an untouched sentinel is sent through unchanged so the
 * backend keeps the stored value. Every string flows through the bilingual
 * extensibility labels. RTL-safe (logical properties; `dir="ltr"` on URL/JSON
 * inputs).
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Blocks,
  CheckCircle2,
  KeyRound,
  Loader2,
  Plus,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SectionCard } from '@/components/suites/section-card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  CUSTOM_AUTH_TYPES,
  CUSTOM_HTTP_METHODS,
  CUSTOM_PAGINATION_TYPES,
  CUSTOM_SPEC_CONFIG_KEY,
  REDACTED_SENTINEL,
  createIntegration,
  emptyCustomSpec,
  isRedacted,
  lexIntegrationsApi,
  parseCustomSpec,
  type CustomAuthSpec,
  type CustomAuthType,
  type CustomConnectorSpec,
  type CustomHttpMethod,
  type CustomPaginationType,
  type IntegrationEndpoint,
  type IntegrationStatus,
  type TestResult,
} from '@/lib/lex/integrations';
import { useIntegrationLabels } from '../_lib/use-integration-labels';
import {
  authTypeLabel,
  paginationTypeLabel,
  useExtensibilityLabels,
  type ExtensibilityLabels,
} from '../_lib/extensibility-labels';
import { FieldMapper } from './field-mapper';

const LIST_ROUTE = '/lex/admin/integrations';

interface CustomConnectorBuilderProps {
  /** Existing custom endpoint when editing; omit for the create flow. */
  endpoint?: IntegrationEndpoint | null;
  readOnly?: boolean;
  /** Called with the created/edited endpoint id when the operator finishes. */
  onFinish?: (id: string) => void;
}

/** Which auth fields render for the selected auth type. */
function authFields(type: CustomAuthType): Array<keyof CustomAuthSpec> {
  switch (type) {
    case 'basic':
      return ['username', 'password'];
    case 'bearer':
      return ['token'];
    case 'oauth2_cc':
      return ['token_url', 'client_id', 'client_secret', 'scope'];
    case 'hmac':
      return ['header', 'secret'];
    case 'none':
    default:
      return [];
  }
}

const SECRET_AUTH_FIELDS = new Set<keyof CustomAuthSpec>([
  'password',
  'token',
  'client_secret',
  'secret',
]);

/**
 * Client-side SSRF/URL guard for the connector base URL. This MIRRORS (does not
 * replace) the authoritative server-side SSRF allow-listing — it is a fast,
 * honest pre-flight so an operator can't save a connector that points at a
 * non-HTTP(S) scheme, a credentialed URL, a bare host, or an obviously
 * internal/loopback/link-local/metadata target. Returns a classification the UI
 * uses to block Save and flag the field; the explanatory copy is bilingual.
 */
export type BaseUrlVerdict = 'ok' | 'empty' | 'invalid' | 'insecure' | 'private';

const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|::1$|\[::1\]$|metadata\.|.*\.local$|.*\.internal$)/i;

/** 172.16.0.0 – 172.31.255.255 private range. */
function isPrivate172(host: string): boolean {
  const m = /^172\.(\d{1,3})\./.exec(host);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 16 && second <= 31;
}

export function classifyBaseUrl(raw: string): BaseUrlVerdict {
  const value = raw.trim();
  if (!value) return 'empty';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'invalid';
  // Embedded credentials in the URL are never acceptable for a stored connector.
  if (url.username || url.password) return 'invalid';
  // Plain HTTP is an insecure transport for an outbound connector.
  if (url.protocol === 'http:') return 'insecure';
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host) || isPrivate172(host)) return 'private';
  return 'ok';
}

export function CustomConnectorBuilder({
  endpoint,
  readOnly = false,
  onFinish,
}: CustomConnectorBuilderProps) {
  const router = useRouter();
  const t = useExtensibilityLabels();
  const shared = useIntegrationLabels();
  const { locale, direction } = useLocaleOrDefault();
  const isEdit = Boolean(endpoint);

  /* Identity. */
  const [name, setName] = useState(endpoint?.name ?? '');
  const [code, setCode] = useState(endpoint?.code ?? '');
  const [description, setDescription] = useState(endpoint?.description ?? '');
  const [status, setStatus] = useState<IntegrationStatus>(endpoint?.status ?? 'planned');

  /* Spec. */
  const [spec, setSpec] = useState<CustomConnectorSpec>(() =>
    endpoint ? parseCustomSpec(endpoint.config?.[CUSTOM_SPEC_CONFIG_KEY]) : emptyCustomSpec(),
  );
  const [touched, setTouched] = useState(false);

  /* Created endpoint (after Save) → enables the Test step. */
  const [savedId, setSavedId] = useState<string | null>(endpoint?.id ?? null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const headerEntries = useMemo(
    () => Object.entries(spec.request.headers),
    [spec.request.headers],
  );

  function patchSpec(patch: Partial<CustomConnectorSpec>) {
    setSpec((prev) => ({ ...prev, ...patch }));
  }
  function patchRequest(patch: Partial<CustomConnectorSpec['request']>) {
    setSpec((prev) => ({ ...prev, request: { ...prev.request, ...patch } }));
  }
  function patchAuth(patch: Partial<CustomAuthSpec>) {
    setSpec((prev) => ({ ...prev, auth: { ...prev.auth, ...patch } }));
  }
  function patchPagination(patch: Partial<CustomConnectorSpec['pagination']>) {
    setSpec((prev) => ({ ...prev, pagination: { ...prev.pagination, ...patch } }));
  }

  /* Headers: keyed by an editable name column. */
  function setHeaderName(oldName: string, newName: string) {
    setSpec((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev.request.headers)) {
        next[k === oldName ? newName : k] = v;
      }
      return { ...prev, request: { ...prev.request, headers: next } };
    });
  }
  function setHeaderValue(name: string, value: string) {
    setSpec((prev) => ({
      ...prev,
      request: { ...prev.request, headers: { ...prev.request.headers, [name]: value } },
    }));
  }
  function addHeader() {
    setSpec((prev) => ({
      ...prev,
      request: { ...prev.request, headers: { ...prev.request.headers, '': '' } },
    }));
  }
  function removeHeader(name: string) {
    setSpec((prev) => {
      const next = { ...prev.request.headers };
      delete next[name];
      return { ...prev, request: { ...prev.request, headers: next } };
    });
  }

  /* Serialize: drop empty header keys. Secret sentinels pass through unchanged. */
  function buildConfig(): Record<string, unknown> {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(spec.request.headers)) {
      if (k.trim()) headers[k.trim()] = v;
    }
    const clean: CustomConnectorSpec = {
      ...spec,
      base_url: spec.base_url.trim(),
      request: { ...spec.request, path: spec.request.path.trim(), headers },
    };
    return { [CUSTOM_SPEC_CONFIG_KEY]: clean };
  }

  const save = useMutation({
    mutationFn: () =>
      createIntegration({
        kind: 'custom',
        code: code.trim(),
        name: name.trim(),
        description: description.trim(),
        status,
        config: buildConfig(),
      }),
    onSuccess: (created) => {
      setSavedId(created.id);
      showSuccess(shared.toastCreated);
    },
    onError: showApiError,
  });

  const test = useMutation({
    mutationFn: () => {
      if (!savedId) throw new Error('not saved');
      return lexIntegrationsApi.testConnection(savedId);
    },
    onSuccess: (result) => {
      setTestResult(result);
      showSuccess(shared.toastTestDone);
    },
    onError: showApiError,
  });

  const baseUrlVerdict = classifyBaseUrl(spec.base_url);
  const nameMissing = touched && !name.trim();
  const codeMissing = touched && !isEdit && !code.trim();
  const baseUrlMissing = touched && baseUrlVerdict === 'empty';
  const baseUrlUnsafe = touched && baseUrlVerdict !== 'ok' && baseUrlVerdict !== 'empty';

  /** The guard message — distinct bilingual copy per base-URL verdict. */
  const baseUrlGuardMessage =
    baseUrlVerdict === 'invalid'
      ? t.builderBaseUrlInvalid
      : baseUrlVerdict === 'insecure'
        ? t.builderBaseUrlInsecure
        : baseUrlVerdict === 'private'
          ? t.builderBaseUrlPrivate
          : t.builderBaseUrlRequired;

  function handleSave() {
    setTouched(true);
    if (!name.trim()) return;
    if (!isEdit && !code.trim()) return;
    // Block any structurally invalid or SSRF-prone base URL before persisting.
    if (baseUrlVerdict !== 'ok') return;
    save.mutate();
  }

  const disabled = readOnly || save.isPending;

  return (
    <div className="space-y-6" dir={direction} lang={locale}>
      {/* Identity. */}
      <SectionCard title={t.builderTitle} description={t.builderSubtitle}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="custom-name">
              {shared.formName} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="custom-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
              aria-invalid={nameMissing}
              className={cn(nameMissing && 'border-destructive/70')}
            />
            {nameMissing ? (
              <p className="text-xs text-destructive">{shared.formRequired}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-code">
              {shared.formCode} {!isEdit ? <span className="text-destructive">*</span> : null}
            </Label>
            <Input
              id="custom-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={isEdit || disabled}
              placeholder="custom"
              dir="ltr"
              aria-invalid={codeMissing}
              className={cn(codeMissing && 'border-destructive/70')}
            />
            <p className="text-xs text-muted-foreground">{shared.formCodeHint}</p>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="custom-description">{shared.formDescription}</Label>
            <Textarea
              id="custom-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={disabled}
              rows={2}
            />
          </div>
        </div>
      </SectionCard>

      {/* Request. */}
      <SectionCard title={t.builderSectionRequest}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="custom-base-url">
              {t.builderBaseUrl} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="custom-base-url"
              value={spec.base_url}
              onChange={(e) => patchSpec({ base_url: e.target.value })}
              placeholder={t.builderBaseUrlPlaceholder}
              disabled={disabled}
              dir="ltr"
              aria-invalid={baseUrlMissing || baseUrlUnsafe}
              aria-describedby="custom-base-url-hint"
              className={cn((baseUrlMissing || baseUrlUnsafe) && 'border-destructive/70')}
            />
            <p id="custom-base-url-hint" className="text-xs text-muted-foreground">
              {t.builderBaseUrlHint}
            </p>
            {baseUrlMissing || baseUrlUnsafe ? (
              <p className="text-xs text-destructive" role="alert">
                {baseUrlMissing ? t.builderBaseUrlRequired : baseUrlGuardMessage}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="custom-method">{t.builderMethod}</Label>
            <Select
              value={spec.request.method}
              onValueChange={(v) => patchRequest({ method: v as CustomHttpMethod })}
              disabled={disabled}
            >
              <SelectTrigger id="custom-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_HTTP_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="custom-path">{t.builderPath}</Label>
            <Input
              id="custom-path"
              value={spec.request.path}
              onChange={(e) => patchRequest({ path: e.target.value })}
              placeholder="/v1/records"
              disabled={disabled}
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">{t.builderPathHint}</p>
          </div>
        </div>

        {/* Headers. */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t.builderHeaders}</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addHeader}
              disabled={disabled}
            >
              <Plus className="me-1 h-3.5 w-3.5" aria-hidden />
              {t.builderAddHeader}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.builderHeadersHint}</p>
          {headerEntries.length > 0 ? (
            <div className="space-y-1.5">
              {headerEntries.map(([hName, hValue], i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_2rem] items-center gap-2"
                >
                  <Input
                    value={hName}
                    onChange={(e) => setHeaderName(hName, e.target.value)}
                    placeholder={t.builderHeaderName}
                    disabled={disabled}
                    dir="ltr"
                    className="h-9"
                  />
                  <Input
                    value={hValue}
                    onChange={(e) => setHeaderValue(hName, e.target.value)}
                    placeholder={t.builderHeaderValue}
                    disabled={disabled}
                    dir="ltr"
                    className="h-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-8 text-muted-foreground"
                    onClick={() => removeHeader(hName)}
                    disabled={disabled}
                    aria-label={t.builderRemoveHeader}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Body template (non-GET). */}
        {spec.request.method !== 'GET' && spec.request.method !== 'DELETE' ? (
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="custom-body">{t.builderBody}</Label>
            <Textarea
              id="custom-body"
              value={spec.request.body_template}
              onChange={(e) => patchRequest({ body_template: e.target.value })}
              disabled={disabled}
              rows={4}
              dir="ltr"
              className="font-mono text-xs"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">{t.builderBodyHint}</p>
          </div>
        ) : null}
      </SectionCard>

      {/* Authentication. */}
      <SectionCard title={t.builderSectionAuth}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="custom-auth-type">{t.builderAuthType}</Label>
            <Select
              value={spec.auth.type}
              onValueChange={(v) => patchAuth({ type: v as CustomAuthType })}
              disabled={disabled}
            >
              <SelectTrigger id="custom-auth-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_AUTH_TYPES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {authTypeLabel(t, a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {authFields(spec.auth.type).map((field) => (
            <AuthFieldInput
              key={field}
              field={field}
              value={spec.auth[field]}
              disabled={disabled}
              t={t}
              onChange={(v) => patchAuth({ [field]: v } as Partial<CustomAuthSpec>)}
            />
          ))}
        </div>
      </SectionCard>

      {/* Response mapping (reuses the shared FieldMapper for field_map). */}
      <SectionCard title={t.builderSectionResponse}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="custom-records-path">{t.builderRecordsPath}</Label>
            <Input
              id="custom-records-path"
              value={spec.response_mapping.records_path}
              onChange={(e) =>
                patchSpec({
                  response_mapping: {
                    ...spec.response_mapping,
                    records_path: e.target.value,
                  },
                })
              }
              placeholder="data.items"
              disabled={disabled}
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">{t.builderRecordsPathHint}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t.builderFieldMap}</Label>
            <p className="text-xs text-muted-foreground">{t.builderFieldMapHint}</p>
            <FieldMapper
              value={spec.response_mapping.field_map}
              disabled={disabled}
              onChange={(field_map) =>
                patchSpec({
                  response_mapping: { ...spec.response_mapping, field_map },
                })
              }
            />
          </div>
        </div>
      </SectionCard>

      {/* Pagination. */}
      <SectionCard title={t.builderSectionPagination}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="custom-pagination-type">{t.builderPaginationType}</Label>
            <Select
              value={spec.pagination.type}
              onValueChange={(v) => patchPagination({ type: v as CustomPaginationType })}
              disabled={disabled}
            >
              <SelectTrigger id="custom-pagination-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_PAGINATION_TYPES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {paginationTypeLabel(t, p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {spec.pagination.type !== 'none' ? (
            <div className="space-y-1.5">
              <Label htmlFor="custom-pagination-param">{t.builderPaginationParam}</Label>
              <Input
                id="custom-pagination-param"
                value={spec.pagination.param}
                onChange={(e) => patchPagination({ param: e.target.value })}
                placeholder={spec.pagination.type === 'cursor' ? 'cursor' : 'page'}
                disabled={disabled}
                dir="ltr"
              />
              <p className="text-xs text-muted-foreground">{t.builderPaginationParamHint}</p>
            </div>
          ) : null}
        </div>
      </SectionCard>

      {/* Save + Test. */}
      <SectionCard title={t.builderSectionTest} description={t.builderTestIntro}>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={disabled || save.isPending}>
            {save.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Blocks className="me-1.5 h-4 w-4" aria-hidden />
            )}
            {save.isPending ? shared.creating : isEdit ? shared.save : shared.create}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => test.mutate()}
            disabled={!savedId || readOnly || test.isPending}
          >
            {test.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="me-1.5 h-4 w-4" aria-hidden />
            )}
            {test.isPending ? t.builderTestRunning : t.builderTestRun}
          </Button>

          {savedId && onFinish ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onFinish(savedId)}
            >
              {shared.wizardGoToDetail}
            </Button>
          ) : null}
        </div>

        {!savedId ? (
          <p className="mt-2 text-xs text-muted-foreground">{t.builderTestCreateFirst}</p>
        ) : null}

        {testResult ? (
          <div
            className={cn(
              'mt-3 flex items-start gap-2 rounded-md border p-3 text-sm',
              testResult.reachable
                ? 'border-success-300/60 bg-success-50 text-success-700 dark:bg-success-700/15 dark:text-success-300'
                : 'border-destructive/40 bg-destructive/5 text-destructive',
            )}
          >
            {testResult.reachable ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="font-medium">
                {testResult.reachable ? t.builderTestReachable : t.builderTestUnreachable}
              </p>
              {testResult.detail ? (
                <p className="text-xs opacity-80">{testResult.detail}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </SectionCard>

      {/* Cancel back to list. */}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(LIST_ROUTE)}
          disabled={save.isPending}
        >
          {shared.backToList}
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * One auth field input (secret fields render write-only with a Replace toggle).
 * --------------------------------------------------------------------------- */

interface AuthFieldInputProps {
  field: keyof CustomAuthSpec;
  value: string | undefined;
  disabled: boolean;
  t: ExtensibilityLabels;
  onChange: (value: string) => void;
}

function AUTH_FIELD_LABEL(t: ExtensibilityLabels, field: keyof CustomAuthSpec): string {
  switch (field) {
    case 'username':
      return t.builderAuthUsername;
    case 'password':
      return t.builderAuthPassword;
    case 'token':
      return t.builderAuthToken;
    case 'token_url':
      return t.builderAuthTokenUrl;
    case 'client_id':
      return t.builderAuthClientId;
    case 'client_secret':
      return t.builderAuthClientSecret;
    case 'scope':
      return t.builderAuthScope;
    case 'header':
      return t.builderAuthHmacHeader;
    case 'secret':
      return t.builderAuthHmacSecret;
    default:
      return field;
  }
}

function AuthFieldInput({ field, value, disabled, t, onChange }: AuthFieldInputProps) {
  const isSecret = SECRET_AUTH_FIELDS.has(field);
  const stored = typeof value === 'string' ? value : '';
  const [replacing, setReplacing] = useState(false);
  const id = `custom-auth-${field}`;
  const label = AUTH_FIELD_LABEL(t, field);

  // A secret that is set (sentinel) renders write-only until the operator chooses
  // to replace it; an untouched sentinel is sent through unchanged on save.
  if (isSecret && isRedacted(stored) && !replacing) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-10 flex-1 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
            {t.builderSecretSet}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setReplacing(true);
              onChange('');
            }}
            disabled={disabled}
          >
            <KeyRound className="me-1 h-3.5 w-3.5" aria-hidden />
            {t.builderSecretReplace}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t.builderSecretKeepHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {label}
        {isSecret ? (
          <Badge variant="outline" className="gap-1 normal-case tracking-normal">
            <KeyRound className="h-3 w-3" aria-hidden />
          </Badge>
        ) : null}
      </Label>
      <Input
        id={id}
        type={isSecret ? 'password' : 'text'}
        value={isRedacted(stored) ? '' : stored}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        dir="ltr"
        autoComplete={isSecret ? 'new-password' : undefined}
      />
      {isSecret && replacing ? (
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => {
            setReplacing(false);
            onChange(REDACTED_SENTINEL);
          }}
        >
          {t.builderSecretKeepHint}
        </button>
      ) : null}
    </div>
  );
}

export default CustomConnectorBuilder;
