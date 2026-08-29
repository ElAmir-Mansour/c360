'use client';

/**
 * FieldMapper (Feature 4) — point-and-click HR field mapping.
 *
 * The HR connector accepts a `field_mapping` config object mapping a SOURCE
 * field name (e.g. `employeeNumber`, `mgr`) onto a canonical lex identity
 * attribute (externalId / displayName / email / manager / department / orgUnit).
 * Operators should not have to hand-author this JSON, so the DynamicConnectorForm
 * swaps the raw textarea for THIS guided editor when
 * `usesFieldMapper(kind, field.key)` is true.
 *
 * Wire shape (what we read/write): `{ [lexTarget]: sourceFieldName }`. We model
 * each lex target as a row whose value is the source field a tenant types in;
 * `externalId` is required for matching and is always shown. An escape hatch lets
 * power users edit the object as raw JSON (kept in sync with the guided rows).
 *
 * Controlled component: `value` is the current config object (or a JSON string /
 * undefined on a fresh form), and every edit emits the normalized mapping object
 * via `onChange` so the parent form persists it verbatim into the config payload.
 */
import { useMemo, useState } from 'react';
import { Braces, Plus, Trash2, Wand2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { LEX_MAP_TARGETS, type LexMapTarget } from '../_lib/integration-kinds';
import { useIntegrationLabels } from '../_lib/use-integration-labels';
import { useExtensibilityLabels } from '../_lib/extensibility-labels';

type Labels = ReturnType<typeof useIntegrationLabels>;

interface FieldMapperProps {
  /** Current `field_mapping` value: an object, a JSON string, or undefined. */
  value: unknown;
  disabled?: boolean;
  /** Emit the normalized `{ lexTarget: sourceField }` mapping object. */
  onChange: (mapping: Record<string, string>) => void;
}

/** Bilingual label for a lex target. */
function lexTargetLabel(target: LexMapTarget, t: Labels): string {
  switch (target) {
    case 'externalId':
      return t.mapperLexExternalId;
    case 'displayName':
      return t.mapperLexDisplayName;
    case 'email':
      return t.mapperLexEmail;
    case 'manager':
      return t.mapperLexManager;
    case 'department':
      return t.mapperLexDepartment;
    case 'orgUnit':
      return t.mapperLexOrgUnit;
  }
}

/** Coerce the incoming value (object | JSON string | undefined) to a flat map. */
function toMapping(value: unknown): Record<string, string> {
  let obj: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return {};
    }
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
      else if (v !== null && v !== undefined) out[k] = String(v);
    }
    return out;
  }
  return {};
}

/** Drop empty source values so we never persist `{ manager: "" }`. */
function prune(mapping: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (v && v.trim()) out[k] = v.trim();
  }
  return out;
}

export function FieldMapper({ value, disabled = false, onChange }: FieldMapperProps) {
  const t = useIntegrationLabels();
  const ext = useExtensibilityLabels();
  const mapping = useMemo(() => toMapping(value), [value]);
  const [rawMode, setRawMode] = useState(false);
  const [rawDraft, setRawDraft] = useState<string>('');
  const [rawError, setRawError] = useState(false);

  function emit(next: Record<string, string>) {
    onChange(prune(next));
  }

  function setTarget(target: LexMapTarget, source: string) {
    emit({ ...mapping, [target]: source });
  }

  function clearTarget(target: LexMapTarget) {
    const next = { ...mapping };
    delete next[target];
    emit(next);
  }

  // Extra (custom) targets present in the data but not in the canonical list.
  const canonical = new Set(LEX_MAP_TARGETS.map((m) => m.target as string));
  const extraTargets = Object.keys(mapping).filter((k) => !canonical.has(k));

  function enterRawMode() {
    setRawDraft(JSON.stringify(mapping, null, 2));
    setRawError(false);
    setRawMode(true);
  }

  function commitRaw(text: string) {
    setRawDraft(text);
    const trimmed = text.trim();
    if (!trimmed) {
      setRawError(false);
      emit({});
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        setRawError(false);
        emit(toMapping(parsed));
        return;
      }
      setRawError(true);
    } catch {
      setRawError(true);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-5 text-muted-foreground">{t.mapperIntro}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => (rawMode ? setRawMode(false) : enterRawMode())}
          disabled={disabled}
        >
          {rawMode ? (
            <>
              <Wand2 className="me-1 h-3.5 w-3.5" aria-hidden />
              {t.mapperGuidedToggle}
            </>
          ) : (
            <>
              <Braces className="me-1 h-3.5 w-3.5" aria-hidden />
              {t.mapperRawToggle}
            </>
          )}
        </Button>
      </div>

      {rawMode ? (
        <div className="space-y-1.5">
          <Textarea
            value={rawDraft}
            onChange={(e) => commitRaw(e.target.value)}
            disabled={disabled}
            rows={8}
            dir="ltr"
            className={cn('font-mono text-xs', rawError && 'border-destructive/70')}
            spellCheck={false}
          />
          {rawError ? (
            <p className="text-xs text-destructive">{ext.mapperInvalidJson}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Column headers. */}
          <div className="grid grid-cols-[1fr_auto_1fr_2rem] items-center gap-2 px-1 text-overline font-medium uppercase text-muted-foreground">
            <span>{t.mapperLexField}</span>
            <span aria-hidden>→</span>
            <span>{t.mapperSourceField}</span>
            <span />
          </div>

          {LEX_MAP_TARGETS.map(({ target, required }) => {
            const id = `map-${target}`;
            const source = mapping[target] ?? '';
            return (
              <div
                key={target}
                className="grid grid-cols-[1fr_auto_1fr_2rem] items-center gap-2"
              >
                <Label
                  htmlFor={id}
                  className="flex items-center gap-1 text-sm font-normal"
                >
                  {lexTargetLabel(target, t)}
                  {required ? (
                    <span className="text-caption font-medium text-destructive">
                      ({t.mapperRequiredLex})
                    </span>
                  ) : null}
                </Label>
                <span className="text-muted-foreground rtl:rotate-180" aria-hidden>
                  →
                </span>
                <Input
                  id={id}
                  value={source}
                  onChange={(e) => setTarget(target, e.target.value)}
                  placeholder={t.mapperSourcePlaceholder}
                  disabled={disabled}
                  dir="ltr"
                  aria-invalid={required && !source.trim()}
                  className={cn(
                    'h-9',
                    required && !source.trim() && 'border-destructive/60',
                  )}
                />
                {!required && source ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-8 text-muted-foreground"
                    onClick={() => clearTarget(target)}
                    disabled={disabled}
                    aria-label={t.mapperRemoveRow}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}

          {/* Custom (non-canonical) targets present in the stored object. */}
          {extraTargets.length > 0 ? (
            <div className="space-y-2 border-t pt-2">
              {extraTargets.map((target) => {
                const id = `map-extra-${target}`;
                return (
                  <div
                    key={target}
                    className="grid grid-cols-[1fr_auto_1fr_2rem] items-center gap-2"
                  >
                    <Input
                      value={target}
                      readOnly
                      dir="ltr"
                      className="h-9 bg-muted/40 text-xs"
                    />
                    <span className="text-muted-foreground rtl:rotate-180" aria-hidden>
                      →
                    </span>
                    <Input
                      id={id}
                      value={mapping[target] ?? ''}
                      onChange={(e) => setTarget(target as LexMapTarget, e.target.value)}
                      placeholder={t.mapperSourcePlaceholder}
                      disabled={disabled}
                      dir="ltr"
                      className="h-9"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-8 text-muted-foreground"
                      onClick={() => clearTarget(target as LexMapTarget)}
                      disabled={disabled}
                      aria-label={t.mapperRemoveRow}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}

          {Object.keys(prune(mapping)).length === 0 ? (
            <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t.mapperEmpty}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default FieldMapper;
