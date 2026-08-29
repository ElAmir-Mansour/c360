'use client';

import * as React from 'react';
import { Cloud, CloudOff, RotateCcw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { BOARD_TEXT, pickText } from './board-i18n';
import type { WidgetDefinition } from './registry';
import type {
  DashboardAlertThreshold,
  DashboardHorizon,
  DashboardPreset,
  DashboardScope,
} from './layout-utils';

interface WidgetPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Permission-visible widget definitions (gated ones never appear here). */
  defs: readonly WidgetDefinition[];
  hiddenIds: readonly string[];
  onToggle: (id: string, enabled: boolean) => void;
  onReset: () => void;
  preset: DashboardPreset;
  scope: DashboardScope;
  horizonDays: DashboardHorizon;
  alertThreshold: DashboardAlertThreshold;
  onPresetChange: (value: DashboardPreset) => void;
  onScopeChange: (value: DashboardScope) => void;
  onHorizonChange: (value: DashboardHorizon) => void;
  onAlertThresholdChange: (value: DashboardAlertThreshold) => void;
  syncState: 'idle' | 'saving' | 'saved' | 'local';
  canSaveTeamDefault: boolean;
  onSaveTeamDefault: () => void;
  teamDefaultSaving: boolean;
}

/**
 * Edit-mode widget picker: toggle each registry widget on/off the board and
 * reset the whole board to the default composition. Anchored to the logical
 * end edge (right in LTR, left in RTL).
 */
export function WidgetPickerSheet({
  open,
  onOpenChange,
  defs,
  hiddenIds,
  onToggle,
  onReset,
  preset,
  scope,
  horizonDays,
  alertThreshold,
  onPresetChange,
  onScopeChange,
  onHorizonChange,
  onAlertThresholdChange,
  syncState,
  canSaveTeamDefault,
  onSaveTeamDefault,
  teamDefaultSaving,
}: WidgetPickerSheetProps) {
  const { locale, direction } = useLocaleOrDefault();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === 'rtl' ? 'left' : 'right'}
        className="flex h-full flex-col overflow-y-auto"
      >
        <SheetHeader className="text-start sm:text-start">
          <SheetTitle>{pickText(BOARD_TEXT.pickerTitle, locale)}</SheetTitle>
          <SheetDescription>{pickText(BOARD_TEXT.pickerDescription, locale)}</SheetDescription>
        </SheetHeader>

        <div className="mt-5 grid gap-4 rounded-2xl border border-border bg-muted/25 p-4">
          <PreferenceSelect
            id="dashboard-preset"
            label={pickText(BOARD_TEXT.preset, locale)}
            value={preset}
            onValueChange={(value) => onPresetChange(value as DashboardPreset)}
            options={[
              ['recommended', pickText(BOARD_TEXT.presetsRecommended, locale)],
              ['my-work', pickText(BOARD_TEXT.presetsMyWork, locale)],
              ['operations', pickText(BOARD_TEXT.presetsOperations, locale)],
              ['executive-risk', pickText(BOARD_TEXT.presetsExecutive, locale)],
              ['admin', pickText(BOARD_TEXT.presetsAdmin, locale)],
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <PreferenceSelect
              id="dashboard-scope"
              label={pickText(BOARD_TEXT.scope, locale)}
              value={scope}
              onValueChange={(value) => onScopeChange(value as DashboardScope)}
              options={[
                ['all', pickText(BOARD_TEXT.scopeAll, locale)],
                ['watheeq', pickText(BOARD_TEXT.scopeWatheeq, locale)],
                ['cyber', pickText(BOARD_TEXT.scopeCyber, locale)],
                ['data', pickText(BOARD_TEXT.scopeData, locale)],
              ]}
            />
            <PreferenceSelect
              id="dashboard-horizon"
              label={pickText(BOARD_TEXT.horizon, locale)}
              value={String(horizonDays)}
              onValueChange={(value) => onHorizonChange(Number(value) as DashboardHorizon)}
              options={([7, 30, 90] as const).map((days) => [
                String(days),
                `${days} ${pickText(BOARD_TEXT.horizonDays, locale)}`,
              ])}
            />
          </div>
          <PreferenceSelect
            id="dashboard-alert-threshold"
            label={pickText(BOARD_TEXT.alertThreshold, locale)}
            value={alertThreshold}
            onValueChange={(value) =>
              onAlertThresholdChange(value as DashboardAlertThreshold)
            }
            options={[
              ['critical', pickText(BOARD_TEXT.thresholdCritical, locale)],
              ['high', pickText(BOARD_TEXT.thresholdHigh, locale)],
              ['medium', pickText(BOARD_TEXT.thresholdMedium, locale)],
            ]}
          />
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">
          {syncState === 'local' ? (
            <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <Cloud className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span aria-live="polite">
            {pickText(
              syncState === 'saving'
                ? BOARD_TEXT.syncSaving
                : syncState === 'local'
                  ? BOARD_TEXT.syncLocal
                  : BOARD_TEXT.syncSaved,
              locale,
            )}
          </span>
        </div>

        <ul className="mt-5 flex-1 space-y-2">
          {defs.map((def) => {
            const enabled = !hiddenIds.includes(def.id);
            const Icon = def.icon;
            const switchId = `wb-widget-${def.id}`;
            return (
              <li
                key={def.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-card/50 p-3 transition-colors hover:border-primary/30"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={switchId}
                    className="block cursor-pointer text-sm font-medium text-foreground"
                  >
                    {pickText(def.title, locale)}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {pickText(def.description, locale)}
                  </p>
                </div>
                <Switch
                  id={switchId}
                  checked={enabled}
                  onCheckedChange={(checked) => onToggle(def.id, checked)}
                />
              </li>
            );
          })}
        </ul>

        <div className="mt-4 shrink-0 border-t border-border pt-4">
          {canSaveTeamDefault && (
            <Button
              variant="outline"
              size="sm"
              className="mb-2 w-full"
              onClick={onSaveTeamDefault}
              disabled={teamDefaultSaving}
            >
              <Users className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {pickText(BOARD_TEXT.saveTeamDefault, locale)}
            </Button>
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={onReset}>
            <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {pickText(BOARD_TEXT.resetDefault, locale)}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PreferenceSelect({
  id,
  label,
  value,
  onValueChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className="w-full bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
