'use client';

// The calculator INPUT panel (Wave B #3 — GUIDED CONTROLS). Owns nothing
// durable — it lifts every change up to the page via onChange so the page can
// debounce + recompute. The PricingInputState SHAPE and the onChange contract
// are UNCHANGED from the raw version; only the controls that produce those
// values were upgraded:
//
//   • Volume drivers (users / cores / vms / hot & cold storage) are now
//     SLIDER + numeric-stepper pairs kept in sync (sane min/max/step).
//   • Deployment is an icon SEGMENTED card group (SaaS / On-Prem / Air-Gapped),
//     each with a lucide icon + a short descriptor — same 1/2/3 codes.
//   • Contract term is a SLIDER (1-36 months, marks at 12/24/36).
//   • Every driver carries a shadcn Tooltip explaining what it does.
//
// The sales-discount lever stays gated on pricing:write+ (canDiscount). Volume
// drivers are model-conditional: per_user shows Users; per_core shows Cores +
// VMs. Keyboard a11y + labels are preserved (native inputs + Radix Slider).

import { useId, type ComponentType } from 'react';
import {
  Boxes,
  Cloud,
  HelpCircle,
  Minus,
  Plus,
  Server,
  ShieldCheck,
  type LucideProps,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useT } from '@/components/providers/locale-provider';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import type { PricingModel, Deployment } from '../_lib/types';

export interface PricingInputState {
  model: PricingModel;
  deployment: Deployment;
  termMonths: number;
  users: number;
  cores: number;
  vms: number;
  hotStorageGb: number;
  coldStorageGb: number;
  salesDiscountPct: number; // 0-100 in the UI; converted to a 0-1 fraction on send
}

interface PricingInputsProps {
  value: PricingInputState;
  onChange: (next: PricingInputState) => void;
  /** Whether the sales-discount lever is shown (gated on pricing:write+). */
  canDiscount: boolean;
}

const DEPLOYMENTS: {
  value: Deployment;
  labelKey: MessageKey;
  descKey: MessageKey;
  icon: ComponentType<LucideProps>;
}[] = [
  {
    value: 1,
    labelKey: 'platformConsole.pricing.deploySaas',
    descKey: 'platformConsole.pricing.inputs.deploySaasDesc',
    icon: Cloud,
  },
  {
    value: 2,
    labelKey: 'platformConsole.pricing.deployOnPrem',
    descKey: 'platformConsole.pricing.inputs.deployOnPremDesc',
    icon: Server,
  },
  {
    value: 3,
    labelKey: 'platformConsole.pricing.deployAirGapped',
    descKey: 'platformConsole.pricing.inputs.deployAirGappedDesc',
    icon: ShieldCheck,
  },
];

const TERM_MIN = 1;
const TERM_MAX = 36;
const TERM_MARKS = [12, 24, 36];

/** Sane slider bounds per driver. The stepper accepts the same [min,max]. */
const DRIVER_BOUNDS: Record<
  'users' | 'cores' | 'vms' | 'hotStorageGb' | 'coldStorageGb',
  { min: number; max: number; step: number }
> = {
  users: { min: 0, max: 1000, step: 5 },
  cores: { min: 0, max: 512, step: 4 },
  vms: { min: 0, max: 256, step: 1 },
  hotStorageGb: { min: 0, max: 10000, step: 50 },
  coldStorageGb: { min: 0, max: 50000, step: 100 },
};

export function PricingInputs({ value, onChange, canDiscount }: PricingInputsProps) {
  const t = useT();

  const set = <K extends keyof PricingInputState>(key: K, v: PricingInputState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-4 w-4 text-primary" aria-hidden />
          {t('platformConsole.pricing.inputsTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Model toggle */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">
            {t('platformConsole.pricing.modelLabel')}
          </legend>
          <RadioGroup
            className="grid grid-cols-2 gap-2"
            value={value.model}
            onValueChange={(v) => set('model', v as PricingModel)}
            aria-label={t('platformConsole.pricing.modelLabel')}
          >
            <label
              htmlFor="pricing-model-per-user"
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-input/80 bg-card/60 px-3 py-2.5 text-sm has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
            >
              <RadioGroupItem id="pricing-model-per-user" value="per_user" />
              {t('platformConsole.pricing.modelPerUser')}
            </label>
            <label
              htmlFor="pricing-model-per-core"
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-input/80 bg-card/60 px-3 py-2.5 text-sm has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
            >
              <RadioGroupItem id="pricing-model-per-core" value="per_core" />
              {t('platformConsole.pricing.modelPerCore')}
            </label>
          </RadioGroup>
        </fieldset>

        {/* Deployment — icon SEGMENTED cards. Still a RadioGroup for a11y. */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">
            {t('platformConsole.pricing.deploymentLabel')}
          </legend>
          <RadioGroup
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            value={String(value.deployment)}
            onValueChange={(v) => set('deployment', Number(v) as Deployment)}
            aria-label={t('platformConsole.pricing.deploymentLabel')}
          >
            {DEPLOYMENTS.map(({ value: dv, labelKey, descKey, icon: Icon }) => {
              const id = `pricing-deploy-${dv}`;
              const selected = value.deployment === dv;
              return (
                <label
                  key={dv}
                  htmlFor={id}
                  data-testid={`pricing-deploy-card-${dv}`}
                  data-selected={selected}
                  className={cn(
                    'flex cursor-pointer flex-col gap-1.5 rounded-xl border bg-card/60 p-3 text-sm transition-colors',
                    selected
                      ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/25'
                      : 'border-input/80 hover:border-primary/30',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <RadioGroupItem id={id} value={String(dv)} />
                    <Icon className="h-4 w-4 text-primary" aria-hidden />
                    <span className="font-medium text-foreground">
                      {t(labelKey)}
                    </span>
                  </span>
                  <span className="ps-6 text-xs leading-4 text-muted-foreground">
                    {t(descKey)}
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        </fieldset>

        {/* Contract term — SLIDER (1-36 months, marks at 12/24/36). */}
        <TermSlider
          value={value.termMonths}
          onChange={(v) => set('termMonths', v)}
          label={t('platformConsole.pricing.termMonths')}
          hint={t('platformConsole.pricing.inputs.termHint')}
          monthsUnit={t('platformConsole.pricing.inputs.monthsUnit')}
        />

        {/* Volume drivers — slider + stepper pairs. Model-conditional. */}
        <div className="space-y-5">
          <p className="text-sm font-medium text-foreground">
            {t('platformConsole.pricing.inputs.driversTitle')}
          </p>

          {value.model === 'per_user' ? (
            <DriverControl
              id="pricing-users"
              label={t('platformConsole.pricing.users')}
              hint={t('platformConsole.pricing.inputs.usersHint')}
              value={value.users}
              onChange={(v) => set('users', v)}
              bounds={DRIVER_BOUNDS.users}
            />
          ) : (
            <>
              <DriverControl
                id="pricing-cores"
                label={t('platformConsole.pricing.cores')}
                hint={t('platformConsole.pricing.inputs.coresHint')}
                value={value.cores}
                onChange={(v) => set('cores', v)}
                bounds={DRIVER_BOUNDS.cores}
              />
              <DriverControl
                id="pricing-vms"
                label={t('platformConsole.pricing.vms')}
                hint={t('platformConsole.pricing.inputs.vmsHint')}
                value={value.vms}
                onChange={(v) => set('vms', v)}
                bounds={DRIVER_BOUNDS.vms}
              />
            </>
          )}

          <DriverControl
            id="pricing-hot"
            label={t('platformConsole.pricing.hotStorageGb')}
            hint={t('platformConsole.pricing.inputs.hotStorageHint')}
            value={value.hotStorageGb}
            onChange={(v) => set('hotStorageGb', v)}
            bounds={DRIVER_BOUNDS.hotStorageGb}
          />
          <DriverControl
            id="pricing-cold"
            label={t('platformConsole.pricing.coldStorageGb')}
            hint={t('platformConsole.pricing.inputs.coldStorageHint')}
            value={value.coldStorageGb}
            onChange={(v) => set('coldStorageGb', v)}
            bounds={DRIVER_BOUNDS.coldStorageGb}
          />
        </div>

        {/* Sales discount — pricing:write+ only. */}
        {canDiscount ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="pricing-sales-discount">
                {t('platformConsole.pricing.salesDiscountPct')}
              </Label>
              <DriverTooltip text={t('platformConsole.pricing.inputs.salesDiscountTooltip')} />
            </div>
            <Input
              id="pricing-sales-discount"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              value={value.salesDiscountPct}
              onChange={(e) =>
                set('salesDiscountPct', clamp(numOf(e.target.value), 0, 100))
              }
            />
            <p className="text-xs text-muted-foreground">
              {t('platformConsole.pricing.salesDiscountHint')}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

/** Parse a numeric text value; empty / invalid → 0. */
function numOf(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** A small (?) tooltip trigger used beside a driver label. */
function DriverTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            aria-label={text}
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[220px] text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------------- *
 * DriverControl — a labelled slider + numeric-stepper pair kept in sync. The
 * slider and the number field write the SAME clamped, step-rounded value up.
 * ------------------------------------------------------------------------- */

interface DriverControlProps {
  id: string;
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
  bounds: { min: number; max: number; step: number };
}

function DriverControl({ id, label, hint, value, onChange, bounds }: DriverControlProps) {
  const t = useT();
  const { min, max, step } = bounds;
  // The slider clamps to [min,max]; the stepper mirrors that. The number field
  // itself allows free typing up to max (values above the slider max still
  // pin the thumb at max but keep the real number).
  const sliderValue = clamp(value, min, max);

  const commit = (n: number) => onChange(clamp(n, min, max));

  return (
    <div className="space-y-2" data-testid={`driver-${id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          <DriverTooltip text={hint} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => commit(value - step)}
            disabled={value <= min}
            aria-label={`${t('platformConsole.pricing.inputs.stepDown')} ${label}`}
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => commit(numOf(e.target.value))}
            className="h-8 w-20 text-center tabular-nums"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => commit(value + step)}
            disabled={value >= max}
            aria-label={`${t('platformConsole.pricing.inputs.stepUp')} ${label}`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      <Slider
        value={[sliderValue]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => commit(v)}
        aria-label={label}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * TermSlider — contract term (1-36 months) with marks at 12/24/36.
 * ------------------------------------------------------------------------- */

interface TermSliderProps {
  value: number;
  onChange: (next: number) => void;
  label: string;
  hint: string;
  monthsUnit: string;
}

function TermSlider({ value, onChange, label, hint, monthsUnit }: TermSliderProps) {
  const sliderId = useId();
  const term = clamp(value, TERM_MIN, TERM_MAX);
  return (
    <div className="space-y-2" data-testid="term-slider">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={sliderId}>{label}</Label>
          <DriverTooltip text={hint} />
        </div>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {term} {monthsUnit}
        </span>
      </div>
      <Slider
        id={sliderId}
        value={[term]}
        min={TERM_MIN}
        max={TERM_MAX}
        step={1}
        onValueChange={([v]) => onChange(clamp(v, TERM_MIN, TERM_MAX))}
        aria-label={label}
        aria-valuetext={`${term} ${monthsUnit}`}
      />
      {/* Marks at 12 / 24 / 36 months. */}
      <div className="flex justify-between px-0.5 text-overline text-muted-foreground" aria-hidden>
        {TERM_MARKS.map((m) => (
          <span key={m} className="tabular-nums">
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}
