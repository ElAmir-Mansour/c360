'use client';

/**
 * RulesEditor (#19) — a transform/filter pipeline editor for an integration's
 * `sync_rules` config field.
 *
 * The backend applies an ordered {@link RuleSpec}[] to every record during sync
 * (and surfaces the effect in the #5 dry-run preview): TRANSFORM rules reshape a
 * field (concat | lookup | default | regex | date_format) and FILTER rules drop
 * records that fail a predicate (eq | ne | in | exists | gt | lt) on a field.
 * Operators should not hand-author this JSON, so this guided editor lets them
 * add, reorder, and remove rules; it writes the normalized array back via
 * `onChange` so the parent connector form persists it into `config.sync_rules`.
 *
 * A small "preview effect" affordance runs the existing dry-run
 * (`previewSync(id)`) and reports how many records the current pipeline would
 * keep — only available once the endpoint exists (an id is passed). Controlled
 * component: `value` is the current rules array (object[] / JSON string /
 * undefined); every edit emits the pruned, normalized {@link RuleSpec}[].
 *
 * Every string flows through the bilingual extensibility label module.
 * RTL-safe (logical properties; `dir="ltr"` only on machine-ish inputs).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Filter,
  Loader2,
  PlayCircle,
  Plus,
  Trash2,
  Wand2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
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
import { cn } from '@/lib/utils';
import { showApiError } from '@/lib/toast';
import {
  FILTER_OPS,
  TRANSFORM_OPS,
  lexIntegrationsApi,
  parseSyncRules,
  type FilterOp,
  type RuleOp,
  type RuleSpec,
  type TransformOp,
} from '@/lib/lex/integrations';
import {
  fillExtToken,
  filterOpLabel,
  transformOpLabel,
  useExtensibilityLabels,
  type ExtensibilityLabels,
} from '../_lib/extensibility-labels';

interface RulesEditorProps {
  /** Current `sync_rules` value: an array, a JSON string, or undefined. */
  value: unknown;
  disabled?: boolean;
  /** Endpoint id; when present the "preview effect" dry-run is enabled. */
  endpointId?: string;
  /** Emit the normalized {@link RuleSpec}[] pipeline. */
  onChange: (rules: RuleSpec[]) => void;
}

/** Drop rules with no field (a filter `exists` is allowed an empty arg list). */
function prune(rules: RuleSpec[]): RuleSpec[] {
  return rules.filter((r) => r.field.trim().length > 0);
}

/** Stable JSON identity for two rule arrays (cheap deep-equality for sync). */
function rulesEqual(a: RuleSpec[], b: RuleSpec[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function RulesEditor({
  value,
  disabled = false,
  endpointId,
  onChange,
}: RulesEditorProps) {
  const t = useExtensibilityLabels();
  const parsed = useMemo(() => parseSyncRules(value), [value]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  /**
   * Internal working set. We keep in-progress (possibly empty-field) rows here so
   * a freshly added rule is not pruned out from under the operator before they
   * type its field; `onChange` still emits the PRUNED array so the parent never
   * persists a half-built rule. We re-seed from `value` only when the parent's
   * pruned rules genuinely diverge from ours (external reset), not on every echo.
   */
  const [working, setWorking] = useState<RuleSpec[]>(parsed);
  const lastEmitted = useRef<RuleSpec[]>(prune(parsed));
  useEffect(() => {
    if (!rulesEqual(parsed, lastEmitted.current)) {
      setWorking(parsed);
      lastEmitted.current = parsed;
    }
  }, [parsed]);
  const rules = working;

  const preview = useMutation({
    mutationFn: async () => {
      if (!endpointId) return null;
      const res = await lexIntegrationsApi.previewSync(endpointId);
      // The guard short-circuits the dry run; treat that as "no count".
      if (res.guarded) return null;
      // Records that pass the pipeline ≈ processed - skipped - failed.
      const r = res.report;
      return Math.max(0, r.processed - r.skipped - r.failed);
    },
    onSuccess: (count) => setPreviewCount(count),
    onError: showApiError,
  });

  function emit(next: RuleSpec[]) {
    // Keep every in-progress row locally; persist only well-formed rules upstream.
    setWorking(next);
    const pruned = prune(next);
    lastEmitted.current = pruned;
    onChange(pruned);
  }

  function addRule(type: RuleSpec['type']) {
    const op: RuleOp = type === 'filter' ? 'eq' : 'default';
    emit([...rules, { type, op, field: '', args: [] }]);
  }

  function updateRule(index: number, patch: Partial<RuleSpec>) {
    emit(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRule(index: number) {
    emit(rules.filter((_, i) => i !== index));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    emit(next);
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-5 text-muted-foreground">{t.rulesSubtitle}</p>
        <div className="flex shrink-0 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addRule('transform')}
            disabled={disabled}
          >
            <Wand2 className="me-1 h-3.5 w-3.5" aria-hidden />
            {t.rulesAddTransform}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addRule('filter')}
            disabled={disabled}
          >
            <Filter className="me-1 h-3.5 w-3.5" aria-hidden />
            {t.rulesAddFilter}
          </Button>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className="flex items-center gap-1.5 py-3 text-xs text-muted-foreground">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {t.rulesEmptyHint}
        </p>
      ) : (
        <ol className="space-y-2">
          {rules.map((rule, index) => (
            <RuleRow
              key={index}
              rule={rule}
              index={index}
              total={rules.length}
              disabled={disabled}
              t={t}
              onChange={(patch) => updateRule(index, patch)}
              onRemove={() => removeRule(index)}
              onMove={(dir) => move(index, dir)}
            />
          ))}
        </ol>
      )}

      {/* Preview effect (only once the endpoint exists). */}
      {endpointId ? (
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
          >
            {preview.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlayCircle className="me-1.5 h-4 w-4" aria-hidden />
            )}
            {preview.isPending ? t.rulesPreviewRunning : t.rulesPreview}
          </Button>
          {previewCount !== null ? (
            <Badge variant="outline" className="tabular-nums">
              {fillExtToken(t.rulesPreviewEffect, { n: previewCount })}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">{t.rulesPreviewHint}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------- *
 * One pipeline rule row.
 * --------------------------------------------------------------------------- */

interface RuleRowProps {
  rule: RuleSpec;
  index: number;
  total: number;
  disabled: boolean;
  t: ExtensibilityLabels;
  onChange: (patch: Partial<RuleSpec>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}

function RuleRow({
  rule,
  index,
  total,
  disabled,
  t,
  onChange,
  onRemove,
  onMove,
}: RuleRowProps) {
  const isFilter = rule.type === 'filter';
  const ops = isFilter ? FILTER_OPS : TRANSFORM_OPS;
  // `exists` takes no args; everything else takes at least one free-text arg.
  const showArgs = !(isFilter && rule.op === 'exists');

  function setArg(i: number, val: string) {
    const next = [...rule.args];
    next[i] = val;
    onChange({ args: next });
  }

  function addArg() {
    onChange({ args: [...rule.args, ''] });
  }

  function removeArg(i: number) {
    onChange({ args: rule.args.filter((_, idx) => idx !== i) });
  }

  const opLabel = (op: string) =>
    isFilter ? filterOpLabel(t, op as FilterOp) : transformOpLabel(t, op as TransformOp);

  return (
    <li className="rounded-lg border bg-background p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Badge variant={isFilter ? 'warning' : 'outline'} className="gap-1">
            {isFilter ? (
              <Filter className="h-3 w-3" aria-hidden />
            ) : (
              <Wand2 className="h-3 w-3" aria-hidden />
            )}
            {isFilter ? t.ruleTypeFilter : t.ruleTypeTransform}
          </Badge>
          {fillExtToken(t.rulesStepLabel, { n: index + 1 })}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
            aria-label={t.rulesMoveUp}
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => onMove(1)}
            disabled={disabled || index === total - 1}
            aria-label={t.rulesMoveDown}
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={onRemove}
            disabled={disabled}
            aria-label={t.rulesRemove}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">{t.rulesOp}</Label>
          <Select
            value={rule.op}
            onValueChange={(v) => onChange({ op: v as RuleOp })}
            disabled={disabled}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ops.map((op) => (
                <SelectItem key={op} value={op}>
                  {opLabel(op)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">{t.rulesField}</Label>
          <Input
            value={rule.field}
            onChange={(e) => onChange({ field: e.target.value })}
            placeholder={t.rulesFieldPlaceholder}
            disabled={disabled}
            dir="ltr"
            className="h-9"
          />
        </div>
      </div>

      {showArgs ? (
        <div className="mt-2 space-y-1">
          <Label className="text-xs">{t.rulesArgs}</Label>
          <p className="text-caption text-muted-foreground">{t.rulesArgsHint}</p>
          <div className="space-y-1.5">
            {rule.args.map((arg, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  value={arg}
                  onChange={(e) => setArg(i, e.target.value)}
                  placeholder={t.rulesArgPlaceholder}
                  disabled={disabled}
                  dir="ltr"
                  className="h-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-8 shrink-0 text-muted-foreground"
                  onClick={() => removeArg(i)}
                  disabled={disabled}
                  aria-label={t.rulesRemove}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addArg}
              disabled={disabled}
              className="h-8"
            >
              <Plus className="me-1 h-3.5 w-3.5" aria-hidden />
              {t.rulesArgs}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default RulesEditor;
