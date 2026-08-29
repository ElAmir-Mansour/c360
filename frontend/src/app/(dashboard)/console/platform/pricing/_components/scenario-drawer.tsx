'use client';

// SCENARIOS DRAWER (Wave C #6) — the panel that lists captured what-if scenarios
// and lets a rep pick 2-4 to COMPARE, LOAD one back into the calculator, and
// RENAME / DELETE. Opens from the calculator's "Scenarios" button. The compare
// grid renders inline below the list when 2+ are selected.
//
// CLIENT-SAFE: scenarios are masked snapshots (SavedTier — no margin), so nothing
// on this surface can leak internal figures, even for an admin. The drawer only
// reads names, drivers and masked headline numbers via ScenarioCompare.

import { useEffect, useState } from 'react';
import { Check, GitCompareArrows, Pencil, Play, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocale, useT } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { makeMoney, TIER_LABEL_KEY } from '../_lib/quote-format';
import { MAX_COMPARE, type PricingScenario } from '../_lib/use-pricing-scenarios';
import { ScenarioCompare } from './scenario-compare';

interface ScenarioDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarios: PricingScenario[];
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  /** Restore a scenario's inputs into the calculator (and close the drawer). */
  onLoad: (scenario: PricingScenario) => void;
}

/** The selected-tier masked monthly total, for the compact list row. */
function listTotal(s: PricingScenario): number | null {
  const row = s.tiers.find((r) => r.tier === s.selectedTier) ?? s.tiers[0];
  return row ? row.total_monthly : null;
}

export function ScenarioDrawer({
  open,
  onOpenChange,
  scenarios,
  onRename,
  onRemove,
  onLoad,
}: ScenarioDrawerProps) {
  const t = useT();
  const { locale, direction } = useLocale();
  // Anchor the drawer to the trailing edge in a direction-aware way (Sheet takes
  // physical sides): right on LTR, left on RTL.
  const drawerSide = direction === 'rtl' ? 'left' : 'right';

  // Selection for the compare grid (ids). Capped at MAX_COMPARE.
  const [selected, setSelected] = useState<string[]>([]);
  // Inline rename editor state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  // Prune selection when scenarios change (e.g. a compared one is deleted).
  useEffect(() => {
    setSelected((prev) => prev.filter((id) => scenarios.some((s) => s.id === id)));
  }, [scenarios]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev; // at the column cap
      return [...prev, id];
    });
  };

  const startRename = (s: PricingScenario) => {
    setEditingId(s.id);
    setDraftName(s.name);
  };

  const commitRename = () => {
    if (editingId && draftName.trim()) onRename(editingId, draftName);
    setEditingId(null);
    setDraftName('');
  };

  const money = makeMoney(locale, scenarios[0]?.currency || 'SAR');

  const compared = scenarios.filter((s) => selected.includes(s.id));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={drawerSide}
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-3xl"
        data-testid="scenario-drawer"
      >
        <SheetHeader className="text-start">
          <SheetTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-primary" aria-hidden />
            {t('platformConsole.pricing.scenarios.title')}
          </SheetTitle>
          <SheetDescription>
            {t('platformConsole.pricing.scenarios.description')}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {scenarios.length === 0 ? (
            <div
              className="rounded-card border border-dashed border-border bg-card/50 p-8 text-center"
              data-testid="scenario-empty"
            >
              <GitCompareArrows
                className="mx-auto h-8 w-8 text-muted-foreground"
                aria-hidden
              />
              <p className="mt-2 text-sm font-medium text-foreground">
                {t('platformConsole.pricing.scenarios.emptyTitle')}
              </p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                {t('platformConsole.pricing.scenarios.emptyHint')}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {t('platformConsole.pricing.scenarios.selectHint').replace(
                    '{max}',
                    String(MAX_COMPARE),
                  )}
                </p>
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  {selected.length}/{MAX_COMPARE}
                </span>
              </div>

              <ul className="space-y-2" data-testid="scenario-list">
                {scenarios.map((s) => {
                  const isSelected = selected.includes(s.id);
                  const total = listTotal(s);
                  const atCap = !isSelected && selected.length >= MAX_COMPARE;
                  return (
                    <li
                      key={s.id}
                      data-testid={`scenario-item-${s.id}`}
                      className={cn(
                        'rounded-card border bg-card p-3 transition-colors',
                        isSelected
                          ? 'border-primary/50 ring-1 ring-primary/25'
                          : 'border-border',
                      )}
                    >
                      {editingId === s.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') {
                                setEditingId(null);
                                setDraftName('');
                              }
                            }}
                            aria-label={t('platformConsole.pricing.scenarios.renameLabel')}
                            data-testid={`scenario-rename-input-${s.id}`}
                          />
                          <Button
                            size="sm"
                            onClick={commitRename}
                            disabled={!draftName.trim()}
                            data-testid={`scenario-rename-save-${s.id}`}
                          >
                            {t('platformConsole.pricing.scenarios.renameSave')}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          {/* Select-for-compare checkbox + summary. */}
                          <button
                            type="button"
                            onClick={() => toggleSelect(s.id)}
                            disabled={atCap}
                            className={cn(
                              'flex min-w-0 flex-1 items-start gap-2.5 text-start disabled:cursor-not-allowed disabled:opacity-50',
                            )}
                            aria-pressed={isSelected}
                            data-testid={`scenario-select-${s.id}`}
                          >
                            <span
                              className={cn(
                                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                isSelected
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-input',
                              )}
                              aria-hidden
                            >
                              {isSelected ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-foreground">
                                {s.name}
                              </span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                <Badge variant="outline" className="font-normal">
                                  {t(TIER_LABEL_KEY[s.selectedTier])}
                                </Badge>
                                {total != null ? (
                                  <span className="tabular-nums">
                                    {money(total)}
                                    {t('platformConsole.pricing.summary.perMonth')}
                                  </span>
                                ) : null}
                                <span className="tabular-nums">
                                  {formatDateTime(new Date(s.savedAt))}
                                </span>
                              </span>
                            </span>
                          </button>

                          {/* Row actions. */}
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => onLoad(s)}
                              aria-label={`${t('platformConsole.pricing.scenarios.load')} — ${s.name}`}
                              data-testid={`scenario-load-${s.id}`}
                            >
                              <Play className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => startRename(s)}
                              aria-label={`${t('platformConsole.pricing.scenarios.rename')} — ${s.name}`}
                              data-testid={`scenario-rename-${s.id}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => onRemove(s.id)}
                              aria-label={`${t('platformConsole.pricing.scenarios.delete')} — ${s.name}`}
                              data-testid={`scenario-delete-${s.id}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Inline compare grid — shows when 2+ are selected. */}
              {compared.length >= 2 ? (
                <ScenarioCompare
                  scenarios={compared}
                  onLoad={onLoad}
                  onRemove={(id) =>
                    setSelected((prev) => prev.filter((x) => x !== id))
                  }
                />
              ) : (
                <p
                  className="rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs text-muted-foreground"
                  data-testid="scenario-compare-hint"
                >
                  {t('platformConsole.pricing.scenarios.compareHint')}
                </p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
