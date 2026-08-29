'use client';

/**
 * EgressPolicyEditor (#15) — data-residency / DLP guardrail for one endpoint.
 *
 * Edits the {@link EgressPolicy}: a whitelist of destination REGIONS data may
 * leave to (in-Kingdom by default) + a whitelist of lex FIELDS that may be sent
 * outbound, alongside a read-only running `blocked_count` of egress attempts the
 * policy has blocked. Saves via PUT /integrations/{id}/egress-policy (manage).
 *
 * Defaults to IN-KINGDOM: with no external region allowed the editor surfaces an
 * in-Kingdom note (PDPL data-residency). An empty regions list is a HARD block
 * (nothing may leave) and is flagged as such.
 *
 * Reads are graceful ({@link getEgressPolicy} returns `null`); manage actions are
 * gated on `canManage` (`lex:integration:manage`). Mirrors the connection-panel /
 * org-entities admin patterns: react-query, bilingual via governance labels,
 * shared MultiSelect + chip input, RTL. Intended to live on the [id] detail page.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Loader2, MapPin, Plus, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showSuccess, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  getEgressPolicy,
  putEgressPolicy,
  type EgressPolicy,
} from '@/lib/lex/integrations';
import {
  useGovernanceLabels,
  fillGovernanceToken,
} from '../_lib/governance-labels';

const EGRESS_POLICY_KEY = (id: string) =>
  ['lex-integrations', 'egress-policy', id] as const;

/**
 * KSA-first destination regions. In-Kingdom regions carry `inKingdom:true`;
 * external regions (kept short) make the residency boundary explicit so an
 * operator who whitelists one knows data is leaving the Kingdom. Region labels
 * are bilingual; the stored VALUE is a stable slug.
 */
const REGION_OPTIONS: { value: string; ar: string; en: string; inKingdom: boolean }[] = [
  { value: 'sa-central', ar: 'الرياض (وسط)', en: 'Riyadh (central)', inKingdom: true },
  { value: 'sa-west', ar: 'جدة (غرب)', en: 'Jeddah (west)', inKingdom: true },
  { value: 'sa-east', ar: 'الدمام (شرق)', en: 'Dammam (east)', inKingdom: true },
  { value: 'gcc', ar: 'دول الخليج', en: 'GCC', inKingdom: false },
  { value: 'eu', ar: 'الاتحاد الأوروبي', en: 'European Union', inKingdom: false },
  { value: 'global', ar: 'عالمي', en: 'Global', inKingdom: false },
];

interface EgressPolicyEditorProps {
  endpointId: string;
  /** Manage gate (`lex:integration:manage`); read-only users see disabled inputs. */
  canManage: boolean;
}

/**
 * An allowed-egress field is a lex CONFIG/FIELD KEY (e.g. `case_number`,
 * `party.email`), never a free-form host or URL. A malformed key (whitespace,
 * a scheme/host, control or wildcard characters) is rejected so the allow-list
 * stays a precise field whitelist that the DLP layer can match exactly.
 */
const EGRESS_FIELD_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

export function isValidEgressField(raw: string): boolean {
  const v = raw.trim();
  return v.length > 0 && EGRESS_FIELD_RE.test(v);
}

export function EgressPolicyEditor({ endpointId, canManage }: EgressPolicyEditorProps) {
  const g = useGovernanceLabels();
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: EGRESS_POLICY_KEY(endpointId),
    // getEgressPolicy never throws — returns null when unavailable or unset.
    queryFn: () => getEgressPolicy(endpointId),
    enabled: Boolean(endpointId),
  });

  const [regions, setRegions] = useState<string[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [fieldDraft, setFieldDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Seed local edit state from the loaded policy.
  useEffect(() => {
    const p = q.data;
    setRegions(p?.allowed_regions ?? []);
    setFields(p?.allowed_egress_fields ?? []);
  }, [q.data]);

  const regionOpts = useMemo(
    () =>
      REGION_OPTIONS.map((r) => ({
        value: r.value,
        label: locale === 'ar' ? r.ar : r.en,
      })),
    [locale],
  );

  // In-Kingdom when no external (non-in-Kingdom) region is whitelisted.
  const anyExternal = useMemo(
    () =>
      regions.some(
        (v) => !REGION_OPTIONS.find((r) => r.value === v)?.inKingdom,
      ),
    [regions],
  );
  const noRegions = regions.length === 0;

  const dirty = useMemo(() => {
    const p = q.data;
    const baseRegions = p?.allowed_regions ?? [];
    const baseFields = p?.allowed_egress_fields ?? [];
    return (
      JSON.stringify([...regions].sort()) !== JSON.stringify([...baseRegions].sort()) ||
      JSON.stringify([...fields].sort()) !== JSON.stringify([...baseFields].sort())
    );
  }, [q.data, regions, fields]);

  const save = useMutation({
    mutationFn: () =>
      putEgressPolicy(endpointId, {
        allowed_regions: regions,
        allowed_egress_fields: fields,
      }),
    onSuccess: (policy: EgressPolicy) => {
      showSuccess(g.egressToastSaved);
      qc.setQueryData(EGRESS_POLICY_KEY(endpointId), policy);
    },
    onError: (e) => showBackendError(e, g.toastError),
  });

  function addField() {
    const next = fieldDraft.trim();
    if (!next) return;
    if (!isValidEgressField(next)) {
      // Reject malformed keys (hosts/URLs/whitespace/wildcards) without adding.
      setFieldError(g.egressFieldInvalid);
      return;
    }
    if (fields.includes(next)) {
      setFieldDraft('');
      setFieldError(null);
      return;
    }
    setFields((prev) => [...prev, next]);
    setFieldDraft('');
    setFieldError(null);
  }

  function removeField(f: string) {
    setFields((prev) => prev.filter((x) => x !== f));
  }

  function reset() {
    setRegions(q.data?.allowed_regions ?? []);
    setFields(q.data?.allowed_egress_fields ?? []);
    setFieldDraft('');
    setFieldError(null);
  }

  if (q.isLoading) {
    return <LoadingSkeleton variant="form" count={3} />;
  }

  const blockedCount = q.data?.blocked_count ?? 0;

  return (
    <div className="space-y-5" dir={direction} lang={locale}>
      {/* Unconfigured / in-Kingdom note. */}
      {q.data === null ? (
        <p className="text-sm text-muted-foreground">{g.egressUnconfigured}</p>
      ) : null}

      {!anyExternal ? (
        <div className="flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="font-medium text-primary">{g.egressInKingdomTitle}</p>
            <p className="text-muted-foreground">{g.egressInKingdomBody}</p>
          </div>
        </div>
      ) : null}

      {/* Blocked count. */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5">
          <Globe className="h-3.5 w-3.5" aria-hidden />
          {fillGovernanceToken(g.egressBlockedCount, 'n', blockedCount)}
        </Badge>
        {q.data?.updated_at ? (
          <span className="text-xs text-muted-foreground">
            {g.egressUpdatedAt}: {new Date(q.data.updated_at).toLocaleString(locale)}
          </span>
        ) : null}
      </div>

      {/* Allowed regions. */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          {g.egressRegions}
        </label>
        <MultiSelect
          options={regionOpts}
          selected={regions}
          onChange={setRegions}
          placeholder={g.egressRegionsPlaceholder}
          disabled={!canManage || save.isPending}
        />
        <p className="text-xs text-muted-foreground">{g.egressRegionsHint}</p>
        {noRegions ? (
          <p className="text-xs font-medium text-warning-700">{g.egressEmptyRegionsWarn}</p>
        ) : null}
      </div>

      {/* Allowed egress fields (chips). */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">{g.egressFields}</label>
        <div className="flex flex-wrap gap-2">
          {fields.map((f) => (
            <span
              key={f}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-1 font-mono text-xs"
              dir="ltr"
            >
              {f}
              {canManage ? (
                <button
                  type="button"
                  onClick={() => removeField(f)}
                  aria-label={`${g.egressFields}: ${f}`}
                  className="text-muted-foreground hover:text-destructive focus:outline-none"
                  disabled={save.isPending}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </span>
          ))}
          {fields.length === 0 ? (
            <span className="text-xs italic text-muted-foreground">{g.egressFieldsHint}</span>
          ) : null}
        </div>
        {canManage ? (
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={fieldDraft}
              onChange={(e) => {
                setFieldDraft(e.target.value);
                if (fieldError) setFieldError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addField();
                }
              }}
              placeholder={g.egressFieldsPlaceholder}
              disabled={save.isPending}
              dir="ltr"
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? 'egress-field-error' : undefined}
              className={cn('h-9 max-w-xs', fieldError && 'border-destructive/70')}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addField}
              disabled={save.isPending || !fieldDraft.trim()}
            >
              <Plus className="me-1 h-3.5 w-3.5" aria-hidden />
              {g.egressFieldsAdd}
            </Button>
          </div>
        ) : null}
        {fieldError ? (
          <p id="egress-field-error" role="alert" className="text-xs font-medium text-destructive">
            {fieldError}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{g.egressFieldsHint}</p>
      </div>

      {/* Actions. */}
      {canManage ? (
        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            disabled={!dirty || save.isPending}
          >
            {g.egressReset}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className={cn(save.isPending && 'opacity-90')}
          >
            {save.isPending ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : null}
            {save.isPending ? g.egressSaving : g.egressSave}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
