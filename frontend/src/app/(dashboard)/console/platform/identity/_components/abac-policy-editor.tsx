'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCreateAbacPolicy,
  useUpdateAbacPolicy,
} from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import type { AbacCondition, AbacEffect, AbacPolicy } from '@/types/platform';

const OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'starts_with',
];

interface AbacPolicyEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the panel edits this policy; when null it creates a new one. */
  policy: AbacPolicy | null;
}

interface EditorState {
  name: string;
  description: string;
  effect: AbacEffect;
  action: string;
  resource_type: string;
  priority: number;
  enabled: boolean;
  conditions: AbacCondition[];
}

function blankState(): EditorState {
  return {
    name: '',
    description: '',
    effect: 'deny',
    action: '',
    resource_type: '',
    priority: 100,
    enabled: true,
    conditions: [{ attribute: '', operator: 'eq', value: '' }],
  };
}

function fromPolicy(p: AbacPolicy): EditorState {
  return {
    name: p.name,
    description: p.description ?? '',
    effect: p.effect,
    action: p.action,
    resource_type: p.resource_type,
    priority: p.priority,
    enabled: p.enabled,
    conditions:
      p.conditions.length > 0
        ? p.conditions.map((c) => ({
            ...c,
            // Render scalar values as strings for the inputs; arrays JSON-encoded.
            value:
              typeof c.value === 'object' && c.value !== null
                ? JSON.stringify(c.value)
                : String(c.value ?? ''),
          }))
        : [{ attribute: '', operator: 'eq', value: '' }],
  };
}

/** Best-effort coerce a string input back to a JSON value (array/number/bool). */
function coerceValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

export function AbacPolicyEditor({
  open,
  onOpenChange,
  policy,
}: AbacPolicyEditorProps) {
  const t = useT();
  const isEdit = Boolean(policy);
  const [state, setState] = useState<EditorState>(blankState);

  const create = useCreateAbacPolicy();
  const update = useUpdateAbacPolicy();
  const saving = create.isPending || update.isPending;

  // Re-seed the form whenever the panel opens or the target policy changes.
  useEffect(() => {
    if (open) setState(policy ? fromPolicy(policy) : blankState());
  }, [open, policy]);

  const setField = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const setCondition = (i: number, patch: Partial<AbacCondition>) =>
    setState((s) => ({
      ...s,
      conditions: s.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));

  const addCondition = () =>
    setState((s) => ({
      ...s,
      conditions: [...s.conditions, { attribute: '', operator: 'eq', value: '' }],
    }));

  const removeCondition = (i: number) =>
    setState((s) => ({
      ...s,
      conditions: s.conditions.filter((_, idx) => idx !== i),
    }));

  const canSave =
    state.name.trim() !== '' &&
    state.action.trim() !== '' &&
    state.resource_type.trim() !== '';

  const handleSave = async () => {
    const payload: Partial<AbacPolicy> = {
      name: state.name.trim(),
      description: state.description.trim() || undefined,
      effect: state.effect,
      action: state.action.trim(),
      resource_type: state.resource_type.trim(),
      priority: Number(state.priority) || 0,
      enabled: state.enabled,
      conditions: state.conditions
        .filter((c) => c.attribute.trim() !== '')
        .map((c) => ({
          attribute: c.attribute.trim(),
          operator: c.operator,
          value: coerceValue(c.value),
        })),
    };

    try {
      if (isEdit && policy) {
        await update.mutateAsync({ id: policy.id, data: payload });
        showSuccess(t('platformConsole.identity.policyUpdated'));
      } else {
        await create.mutateAsync(payload);
        showSuccess(t('platformConsole.identity.policyCreated'));
      }
      onOpenChange(false);
    } catch (err) {
      showApiError(err);
    }
  };

  return (
    <DetailPanel
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEdit
          ? t('platformConsole.identity.editPolicyTitle')
          : t('platformConsole.identity.newPolicyTitle')
      }
      description={t('platformConsole.identity.policyEditorHint')}
      width="xl"
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="abac-name">{t('platformConsole.identity.colName')}</Label>
          <Input
            id="abac-name"
            value={state.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="restrict-impersonation-to-vpn"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="abac-desc">
            {t('platformConsole.identity.description')}
          </Label>
          <Textarea
            id="abac-desc"
            value={state.description}
            onChange={(e) => setField('description', e.target.value)}
            placeholder={t('platformConsole.identity.descriptionPlaceholder')}
            rows={2}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t('platformConsole.identity.effect')}</Label>
            <Select
              value={state.effect}
              onValueChange={(v) => setField('effect', v as AbacEffect)}
            >
              <SelectTrigger aria-label={t('platformConsole.identity.effect')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">
                  {t('platformConsole.identity.effectAllow')}
                </SelectItem>
                <SelectItem value="deny">
                  {t('platformConsole.identity.effectDeny')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="abac-priority">
              {t('platformConsole.identity.priority')}
            </Label>
            <Input
              id="abac-priority"
              type="number"
              value={state.priority}
              onChange={(e) => setField('priority', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="abac-action">
              {t('platformConsole.identity.action')}
            </Label>
            <Input
              id="abac-action"
              value={state.action}
              onChange={(e) => setField('action', e.target.value)}
              placeholder="impersonate"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="abac-resource">
              {t('platformConsole.identity.resourceType')}
            </Label>
            <Input
              id="abac-resource"
              value={state.resource_type}
              onChange={(e) => setField('resource_type', e.target.value)}
              placeholder="platform.tenant"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-card/70 p-3">
          <div>
            <p className="text-sm font-medium">
              {t('platformConsole.identity.enabled')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('platformConsole.identity.enabledHint')}
            </p>
          </div>
          <Switch
            checked={state.enabled}
            onCheckedChange={(v) => setField('enabled', v)}
            aria-label={t('platformConsole.identity.enabled')}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>{t('platformConsole.identity.conditions')}</Label>
            <Button variant="ghost" size="sm" onClick={addCondition} type="button">
              <Plus className="me-1 h-3.5 w-3.5" aria-hidden />
              {t('platformConsole.identity.add')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('platformConsole.identity.conditionsHint')}
          </p>
          {state.conditions.map((cond, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_7rem_1fr_auto] items-center gap-2"
            >
              <Input
                value={cond.attribute}
                onChange={(e) => setCondition(i, { attribute: e.target.value })}
                placeholder="env.ip"
                aria-label={t('platformConsole.identity.attribute')}
              />
              <Select
                value={cond.operator}
                onValueChange={(v) => setCondition(i, { operator: v })}
              >
                <SelectTrigger aria-label={t('platformConsole.identity.operator')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op} value={op}>
                      {op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={String(cond.value ?? '')}
                onChange={(e) => setCondition(i, { value: e.target.value })}
                placeholder={t('platformConsole.identity.valuePlaceholder')}
                aria-label={t('platformConsole.identity.value')}
              />
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => removeCondition(i)}
                disabled={state.conditions.length === 1}
                aria-label={t('platformConsole.identity.removeCondition')}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            type="button"
          >
            {t('platformConsole.identity.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving} type="button">
            {saving
              ? t('platformConsole.identity.saving')
              : isEdit
                ? t('platformConsole.identity.saveChanges')
                : t('platformConsole.identity.createPolicy')}
          </Button>
        </div>
      </div>
    </DetailPanel>
  );
}
