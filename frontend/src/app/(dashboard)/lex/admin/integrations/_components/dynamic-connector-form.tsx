'use client';

/**
 * DynamicConnectorForm — the schema-driven connector editor.
 *
 * Fetches GET /integrations/schema/{kind} and renders one control per
 * {@link FieldSpec} (string/text/url/number/bool/enum/secret) with bilingual
 * labels + inline help. The schema is the single source of truth for which
 * fields exist, their types, enum choices, required-ness, defaults, and which
 * are secret.
 *
 * SECRET FIELDS are write-only. On EDIT the registry returns the
 * {@link REDACTED_SENTINEL} (`__redacted__`) for any set secret; the form shows
 * "•••••• (set)" with a Replace toggle and keeps the sentinel as the field value
 * until the operator chooses to rotate it. On submit, an untouched sentinel is
 * sent through UNCHANGED so the backend merge keeps the stored secret. A secret
 * that was never set renders an empty password input.
 *
 * Identity fields (name / code / status) are rendered by the form too: `code`
 * is immutable on edit (mirrors org-entities). `kind` is fixed by the route
 * (?kind= on /new, or the loaded endpoint on /[id]) and is shown read-only.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import {
  INTEGRATION_STATUSES,
  SECRET_REF_PROVIDER_KEY,
  SECRET_ROTATE_EVERY_DAYS_KEY,
  getSchema,
  secretRefProvider,
  type CreateIntegrationPayload,
  type FieldSpec,
  type IntegrationEndpoint,
  type IntegrationKind,
  type IntegrationStatus,
  type SecretRefProvider,
  type UpdateIntegrationPayload,
} from '@/lib/lex/integrations';
import { useIntegrationLabels } from '../_lib/use-integration-labels';
import { kindMeta, usesFieldMapper, usesRulesEditor } from '../_lib/integration-kinds';
import { FieldMapper } from './field-mapper';
import { RulesEditor } from './rules-editor';
import { SecretRefToggle, type SecretRefValue } from './secret-ref-toggle';

/** Payload emitted by the form: a create OR an update, tagged by `mode`. */
export type ConnectorSubmit =
  | { mode: 'create'; payload: CreateIntegrationPayload }
  | { mode: 'update'; payload: UpdateIntegrationPayload };

interface DynamicConnectorFormProps {
  kind: IntegrationKind;
  /** Existing endpoint when editing; omit/`null` for the create flow. */
  endpoint?: IntegrationEndpoint | null;
  submitting?: boolean;
  /** Disable all controls (read-only access). */
  readOnly?: boolean;
  /**
   * Governance notice (#13) rendered above the action row — e.g. "this connector
   * is protected; Save creates a pending change". Pass an already-resolved node
   * (the detail page decides whether the endpoint is protected).
   */
  protectedNotice?: React.ReactNode;
  /** Override the primary submit label (e.g. "Propose change" on protected). */
  submitLabel?: string;
  onSubmit: (submit: ConnectorSubmit) => void;
  onCancel: () => void;
}

type ConfigState = Record<string, unknown>;

/** Seed config values from the schema defaults + (on edit) the masked config. */
function seedConfig(fields: FieldSpec[], endpoint?: IntegrationEndpoint | null): ConfigState {
  const seed: ConfigState = {};
  for (const f of fields) {
    const existing = endpoint?.config?.[f.key];
    if (existing !== undefined && existing !== null) {
      seed[f.key] = existing;
    } else if (f.default !== undefined) {
      seed[f.key] = f.type === 'bool' ? f.default === 'true' : f.default;
    } else {
      seed[f.key] = f.type === 'bool' ? false : '';
    }
  }
  return seed;
}

export function DynamicConnectorForm({
  kind,
  endpoint,
  submitting = false,
  readOnly = false,
  protectedNotice,
  submitLabel,
  onSubmit,
  onCancel,
}: DynamicConnectorFormProps) {
  const t = useIntegrationLabels();
  const { locale, direction } = useLocaleOrDefault();
  const isEdit = Boolean(endpoint);
  const meta = kindMeta(kind);

  const schemaQuery = useQuery({
    queryKey: ['lex-integration-schema', kind],
    queryFn: () => getSchema(kind),
    staleTime: 5 * 60_000,
  });
  const fields = useMemo(() => schemaQuery.data ?? [], [schemaQuery.data]);
  const hasSecretField = useMemo(() => fields.some((f) => f.secret), [fields]);

  /* Identity fields. */
  const [name, setName] = useState(endpoint?.name ?? '');
  const [code, setCode] = useState(endpoint?.code ?? '');
  const [description, setDescription] = useState(endpoint?.description ?? '');
  const [status, setStatus] = useState<IntegrationStatus>(endpoint?.status ?? 'planned');

  /* Dynamic config map. Secret replace/reference mode is owned per-field by the
   * SecretRefToggle (#14); the parent only holds the resolved values. */
  const [config, setConfig] = useState<ConfigState>({});
  const [touched, setTouched] = useState(false);

  // Reseed config once the schema (and any endpoint) is available.
  useEffect(() => {
    if (fields.length > 0 || schemaQuery.isSuccess) {
      setConfig(seedConfig(fields, endpoint));
    }
  }, [fields, endpoint, schemaQuery.isSuccess]);

  function setField(key: string, value: unknown) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * Apply a {@link SecretRefValue} from the {@link SecretRefToggle}: write the
   * secret field itself plus the two NON-SECRET companion config keys
   * (`secret_ref_provider`, `rotate_every_days`) the backend reads to drive
   * external-reference resolution + rotation. Companions live at the top of the
   * config map (not per-field) — the connector has a single primary secret.
   */
  function applySecretRef(key: string, next: SecretRefValue) {
    setConfig((prev) => ({
      ...prev,
      [key]: next.value,
      [SECRET_REF_PROVIDER_KEY]: next.provider,
      [SECRET_ROTATE_EVERY_DAYS_KEY]: next.rotateEveryDays,
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!name.trim()) return;
    if (!isEdit && !code.trim()) return;

    // Build the config payload. Secret sentinels are passed through unchanged
    // (merge-on-update keeps the stored secret); numbers are coerced.
    const outConfig: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = config[f.key];
      if (f.type === 'number') {
        outConfig[f.key] = raw === '' || raw === undefined ? undefined : Number(raw);
      } else if (f.type === 'bool') {
        outConfig[f.key] = Boolean(raw);
      } else {
        outConfig[f.key] = raw ?? '';
      }
    }

    // Carry the non-secret secret-reference companions (#14). These are not part
    // of the kind schema's `fields` but the SecretRefToggle writes them so the
    // backend can resolve an external reference + drive rotation.
    if (hasSecretField) {
      outConfig[SECRET_REF_PROVIDER_KEY] = resolveCompanionProvider(config, fields);
      outConfig[SECRET_ROTATE_EVERY_DAYS_KEY] = readRotateDays(
        config[SECRET_ROTATE_EVERY_DAYS_KEY],
      );
    }

    if (isEdit) {
      onSubmit({
        mode: 'update',
        payload: {
          name: name.trim(),
          description: description.trim(),
          status,
          config: outConfig,
        },
      });
    } else {
      onSubmit({
        mode: 'create',
        payload: {
          kind,
          code: code.trim(),
          name: name.trim(),
          description: description.trim(),
          status,
          config: outConfig,
        },
      });
    }
  }

  if (schemaQuery.isLoading) {
    return <LoadingSkeleton variant="form" count={5} />;
  }
  // The schema endpoint is graceful (returns []); distinguish a genuinely empty
  // schema (kind has no config fields) from a never-loaded one only matters for
  // copy — either way we can still render identity fields, but if the fetch
  // itself errored we surface the explanatory state.
  if (schemaQuery.isError) {
    return (
      <ErrorState
        variant="generic"
        title={t.schemaMissingTitle}
        message={t.schemaMissingBody}
        onRetry={() => void schemaQuery.refetch()}
      />
    );
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit} dir={direction} lang={locale}>
      {/* Identity block. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="integration-name">
            {t.formName} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="integration-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={readOnly || submitting}
            aria-invalid={touched && !name.trim()}
            className={cn(touched && !name.trim() && 'border-destructive/70')}
          />
          {touched && !name.trim() ? (
            <p className="text-xs text-destructive">{t.formRequired}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="integration-code">
            {t.formCode} {!isEdit ? <span className="text-destructive">*</span> : null}
          </Label>
          <Input
            id="integration-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isEdit || readOnly || submitting}
            placeholder={meta.kind}
            dir="ltr"
            aria-invalid={touched && !isEdit && !code.trim()}
            className={cn(touched && !isEdit && !code.trim() && 'border-destructive/70')}
          />
          <p className="text-xs text-muted-foreground">{t.formCodeHint}</p>
        </div>

        <div className="space-y-1.5">
          <Label>{t.formKind}</Label>
          <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/30 px-3">
            <meta.icon className={cn('h-4 w-4 shrink-0', meta.accent)} aria-hidden />
            <span className="text-sm">{resolveLocalized(meta.name, locale)}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="integration-status">{t.formStatus}</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as IntegrationStatus)}
            disabled={readOnly || submitting}
          >
            <SelectTrigger id="integration-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTEGRATION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabel(s, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="integration-description">{t.formDescription}</Label>
          <Textarea
            id="integration-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readOnly || submitting}
            rows={2}
          />
        </div>
      </div>

      {/* Dynamic config block. */}
      {fields.length > 0 ? (
        <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t.formConfigSection}</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <ConnectorField
                key={field.key}
                kind={kind}
                field={field}
                value={config[field.key]}
                endpointId={endpoint?.id}
                rotateEveryDays={readRotateDays(config[SECRET_ROTATE_EVERY_DAYS_KEY])}
                disabled={readOnly || submitting}
                locale={locale}
                t={t}
                onChange={(v) => setField(field.key, v)}
                onSecretRefChange={(next) => applySecretRef(field.key, next)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {protectedNotice ? <div className="pt-1">{protectedNotice}</div> : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          {t.cancel}
        </Button>
        <Button type="submit" disabled={readOnly || submitting}>
          {submitting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
          {submitLabel && !submitting
            ? submitLabel
            : isEdit
              ? submitting
                ? t.saving
                : t.save
              : submitting
                ? t.creating
                : t.create}
        </Button>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------------------- *
 * One schema-driven field control.
 * --------------------------------------------------------------------------- */

interface ConnectorFieldProps {
  kind: IntegrationKind;
  field: FieldSpec;
  value: unknown;
  /** Endpoint id when editing; enables the rules-editor "preview effect" (#19). */
  endpointId?: string;
  /** Current rotation cadence (days) for the secret-ref control (#14). */
  rotateEveryDays: number;
  disabled: boolean;
  locale: ReturnType<typeof useLocaleOrDefault>['locale'];
  t: ReturnType<typeof useIntegrationLabels>;
  onChange: (value: unknown) => void;
  /** Emits the secret value + non-secret companions for a secret field (#14). */
  onSecretRefChange: (next: SecretRefValue) => void;
}

function ConnectorField({
  kind,
  field,
  value,
  endpointId,
  rotateEveryDays,
  disabled,
  locale,
  t,
  onChange,
  onSecretRefChange,
}: ConnectorFieldProps) {
  const id = `cfg-${field.key}`;
  const label = resolveLocalized(field.label, locale) || field.key;
  const help = field.help ? resolveLocalized(field.help, locale) : '';
  const mapper = usesFieldMapper(kind, field.key);
  const rules = usesRulesEditor(field.key);
  const wide = field.type === 'text' || mapper || rules;

  return (
    <div className={cn('space-y-1.5', wide && 'md:col-span-2')}>
      <Label htmlFor={id} className="flex items-center gap-1">
        <span dir={locale === 'ar' ? 'rtl' : undefined}>{label}</span>
        {field.required ? <span className="text-destructive">*</span> : null}
      </Label>

      {mapper ? (
        <FieldMapper value={value} disabled={disabled} onChange={onChange} />
      ) : rules ? (
        <RulesEditor
          value={value}
          disabled={disabled}
          endpointId={endpointId}
          onChange={onChange}
        />
      ) : field.secret ? (
        <SecretRefToggle
          id={id}
          value={value}
          rotateEveryDays={rotateEveryDays}
          disabled={disabled}
          onChange={onSecretRefChange}
        />
      ) : field.type === 'bool' ? (
        <div className="flex h-10 items-center gap-2">
          <Switch
            id={id}
            checked={Boolean(value)}
            onCheckedChange={(c) => onChange(c)}
            disabled={disabled}
          />
        </div>
      ) : field.type === 'enum' ? (
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder={t.formSelectPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {(field.enum ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === 'text' ? (
        <Textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
          dir="ltr"
        />
      ) : (
        <Input
          id={id}
          type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          dir="ltr"
        />
      )}

      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * Helpers.
 * --------------------------------------------------------------------------- */

/** Coerce the stored `rotate_every_days` companion to a safe non-negative int. */
function readRotateDays(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/**
 * Resolve the `secret_ref_provider` companion (#14) for submit: prefer the
 * value the SecretRefToggle wrote into config; else infer from the primary
 * secret field's value (a kms://|vault:// reference), defaulting to `none`.
 */
function resolveCompanionProvider(
  config: ConfigState,
  fields: FieldSpec[],
): SecretRefProvider {
  const stored = config[SECRET_REF_PROVIDER_KEY];
  if (stored === 'kms' || stored === 'vault' || stored === 'none') {
    return stored;
  }
  const secretField = fields.find((f) => f.secret);
  return secretField ? secretRefProvider(config[secretField.key]) : 'none';
}

function statusLabel(s: IntegrationStatus, t: ReturnType<typeof useIntegrationLabels>): string {
  switch (s) {
    case 'planned':
      return t.statusPlanned;
    case 'active':
      return t.statusActive;
    case 'disabled':
      return t.statusDisabled;
    case 'error':
      return t.statusError;
  }
}
