'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import { useEntitlementKeys } from '@/hooks/use-platform';
import { useSetPlanEntitlements } from '../../../_lib/use-license-plans';
import type { PlanEntitlement } from '../../../_lib/types';

/** Editable row: limit kept as a string so blank == unlimited is expressible. */
interface DraftRow {
  key: string;
  limit: string; // '' = unlimited, '0' = revoked, '>0' = quota
}

function toDraft(entitlements: PlanEntitlement[]): DraftRow[] {
  return entitlements.map((e) => ({
    key: e.key,
    limit: e.limit === null || e.limit === undefined ? '' : String(e.limit),
  }));
}

function rowsEqual(a: DraftRow[], b: DraftRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => r.key === b[i].key && r.limit === b[i].limit);
}

interface EntitlementsEditorProps {
  planKey: string;
  entitlements: PlanEntitlement[];
  /** Retired plans are read-only until reactivated. */
  readOnly?: boolean;
}

export function EntitlementsEditor({
  planKey,
  entitlements,
  readOnly = false,
}: EntitlementsEditorProps) {
  const t = useT();
  const { data: keys } = useEntitlementKeys();
  const save = useSetPlanEntitlements();

  const initial = useMemo(() => toDraft(entitlements), [entitlements]);
  const [rows, setRows] = useState<DraftRow[]>(initial);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Re-seed local draft when the upstream plan changes (e.g. after a save).
  useEffect(() => {
    setRows(initial);
  }, [initial]);

  const dirty = !rowsEqual(rows, initial);
  const duplicateKeys = rows
    .map((r) => r.key)
    .filter((k, i, arr) => k !== '' && arr.indexOf(k) !== i);
  const hasBlankKey = rows.some((r) => r.key.trim() === '');
  const hasBadLimit = rows.some(
    (r) => r.limit !== '' && (!Number.isInteger(Number(r.limit)) || Number(r.limit) < 0),
  );
  const valid = !hasBlankKey && !hasBadLimit && duplicateKeys.length === 0;

  const usedKeys = new Set(rows.map((r) => r.key));
  const availableKeys = (keys ?? []).filter((k) => !usedKeys.has(k.key));

  const addRow = () => setRows((prev) => [...prev, { key: '', limit: '' }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<DraftRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const buildPayload = (): PlanEntitlement[] =>
    rows.map((r) => ({
      key: r.key.trim(),
      limit: r.limit === '' ? null : Number(r.limit),
    }));

  // Warn if a save *lowers* any existing quota (a downgrade below current grant).
  const isDowngrade = useMemo(() => {
    return rows.some((r) => {
      const before = initial.find((b) => b.key === r.key);
      if (!before) return false;
      const beforeUnlimited = before.limit === '';
      const afterUnlimited = r.limit === '';
      if (beforeUnlimited && !afterUnlimited) return true; // unlimited -> bounded
      if (!beforeUnlimited && !afterUnlimited) return Number(r.limit) < Number(before.limit);
      return false;
    });
  }, [rows, initial]);

  const doSave = async () => {
    try {
      await save.mutateAsync({ key: planKey, entitlements: buildPayload() });
      toast.success(t('platformConsole.licensing.entitlementsSavedToast'));
      setConfirmOpen(false);
    } catch (e) {
      toast.error(parseApiError(e));
      throw e;
    }
  };

  const onSaveClick = () => {
    if (!valid) return;
    if (isDowngrade) {
      setConfirmOpen(true);
    } else {
      void doSave();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          {t('platformConsole.licensing.entitlements')}
        </h3>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              {t('platformConsole.licensing.addEntitlement')}
            </Button>
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows(initial)}
                disabled={save.isPending}
              >
                <RotateCcw className="me-1.5 h-4 w-4" aria-hidden />
                {t('platformConsole.licensing.reset')}
              </Button>
            )}
            <Button size="sm" onClick={onSaveClick} disabled={!dirty || !valid || save.isPending}>
              <Save className="me-1.5 h-4 w-4" aria-hidden />
              {save.isPending ? t('platformConsole.licensing.saving') : t('platformConsole.licensing.save')}
            </Button>
          </div>
        )}
      </div>

      {readOnly && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {t('platformConsole.licensing.retiredReadOnly')}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t('platformConsole.licensing.entitlementsEmptyTitle')}
          description={t('platformConsole.licensing.entitlementsEditorEmptyDesc')}
          size="compact"
          action={readOnly ? undefined : { label: t('platformConsole.licensing.addEntitlement'), onClick: addRow }}
        />
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_10rem_2.5rem] items-center gap-3 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>{t('platformConsole.licensing.key')}</span>
            <span className="text-end">{t('platformConsole.licensing.limit')}</span>
            <span />
          </div>
          {rows.map((row, i) => {
            const isDup = duplicateKeys.includes(row.key);
            const knownKey = (keys ?? []).some((k) => k.key === row.key);
            return (
              <div
                key={i}
                className="grid grid-cols-[1fr_10rem_2.5rem] items-start gap-3"
              >
                <div className="space-y-1">
                  {/* Prefer a Select among known keys; fall back to free text if the
                      key isn't in the registry (drift-tolerant). */}
                  {knownKey || row.key === '' ? (
                    <Select
                      value={row.key}
                      onValueChange={(v) => updateRow(i, { key: v })}
                      disabled={readOnly}
                    >
                      <SelectTrigger
                        className={isDup ? 'border-destructive' : ''}
                        aria-label={t('platformConsole.licensing.entitlementKey')}
                      >
                        <SelectValue placeholder={t('platformConsole.licensing.selectKey')} />
                      </SelectTrigger>
                      <SelectContent>
                        {row.key !== '' && (
                          <SelectItem value={row.key}>{row.key}</SelectItem>
                        )}
                        {availableKeys.map((k) => (
                          <SelectItem key={k.key} value={k.key}>
                            {k.label}
                            <span className="ms-2 font-mono text-xs text-muted-foreground">
                              {k.key}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={row.key}
                      onChange={(e) => updateRow(i, { key: e.target.value })}
                      className={`font-mono ${isDup ? 'border-destructive' : ''}`}
                      disabled={readOnly}
                    />
                  )}
                  {isDup && (
                    <p className="text-xs text-destructive">
                      {t('platformConsole.licensing.duplicateKey')}
                    </p>
                  )}
                </div>
                <Input
                  type="number"
                  min={0}
                  value={row.limit}
                  onChange={(e) => updateRow(i, { limit: e.target.value })}
                  placeholder="∞"
                  className="text-end"
                  disabled={readOnly}
                  aria-label={t('platformConsole.licensing.limitForAria').replace(
                    '{key}',
                    row.key || t('platformConsole.licensing.entitlement'),
                  )}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => removeRow(i)}
                  disabled={readOnly}
                  aria-label={t('platformConsole.licensing.removeRowAria').replace(
                    '{key}',
                    row.key || t('platformConsole.licensing.entitlement'),
                  )}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            );
          })}
          <p className="px-1 pt-1 text-xs text-muted-foreground">
            {t('platformConsole.licensing.limitLegend')}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('platformConsole.licensing.lowerLimitTitle')}
        description={t('platformConsole.licensing.lowerLimitDesc')}
        confirmLabel={t('platformConsole.licensing.saveAnyway')}
        variant="destructive"
        loading={save.isPending}
        onConfirm={doSave}
      />
    </div>
  );
}
