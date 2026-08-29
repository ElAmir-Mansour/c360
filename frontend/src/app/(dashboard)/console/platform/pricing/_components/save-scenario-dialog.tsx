'use client';

// SAVE-AS-SCENARIO dialog (Wave C #6). Prompts for a scenario NAME then captures
// the CURRENT calculator config (inputs + selected tier + the live computed
// MASKED tiers) as an ephemeral what-if scenario in localStorage. It never hits
// the backend — this is not a quote.
//
// The captured tiers are masked to SavedTier (no margin) inside the scenarios
// hook, so an admin capturing off an admin compute still persists a client-safe
// snapshot.

import { useEffect, useState } from 'react';
import { GitCompareArrows } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/components/providers/locale-provider';
import { TIER_LABEL_KEY } from '../_lib/quote-format';
import type { PricingTier, PricingTierRow, PricingModel } from '../_lib/types';
import type { PricingInputState } from './pricing-inputs';
import type { CaptureScenarioInput } from '../_lib/use-pricing-scenarios';

interface SaveScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inputs: PricingInputState;
  selectedTier: PricingTier;
  model: PricingModel;
  currency: string;
  pricingVersion: number;
  /** The live computed rows (masked out to SavedTier by the capture). */
  tiers: PricingTierRow[];
  /** Persist the captured scenario. */
  onSave: (input: CaptureScenarioInput) => void;
  /** A default name suggestion (e.g. "SaaS 12mo per-user"). */
  suggestedName?: string;
}

export function SaveScenarioDialog({
  open,
  onOpenChange,
  inputs,
  selectedTier,
  model,
  currency,
  pricingVersion,
  tiers,
  onSave,
  suggestedName,
}: SaveScenarioDialogProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  // Seed the suggested name each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(suggestedName ?? '');
      setTouched(false);
    }
  }, [open, suggestedName]);

  const nameMissing = name.trim().length === 0;

  const submit = () => {
    setTouched(true);
    if (nameMissing) return;
    onSave({
      name: name.trim(),
      inputs,
      selectedTier,
      model,
      currency,
      pricingVersion,
      tiers,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('platformConsole.pricing.scenarios.saveDialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('platformConsole.pricing.scenarios.saveDialogDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-input/80 bg-card/60 px-3.5 py-2.5">
            <span className="text-sm text-muted-foreground">
              {t('platformConsole.pricing.scenarios.capturingTier')}
            </span>
            <Badge variant="default">{t(TIER_LABEL_KEY[selectedTier])}</Badge>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="save-scenario-name">
              {t('platformConsole.pricing.scenarios.nameLabel')}
            </Label>
            <Input
              id="save-scenario-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder={t('platformConsole.pricing.scenarios.namePlaceholder')}
              aria-invalid={touched && nameMissing}
              aria-describedby={
                touched && nameMissing ? 'save-scenario-name-error' : undefined
              }
              data-testid="save-scenario-name"
            />
            {touched && nameMissing ? (
              <p id="save-scenario-name-error" className="text-xs text-destructive">
                {t('platformConsole.pricing.scenarios.nameRequired')}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('platformConsole.pricing.quotes.cancel')}
          </Button>
          <Button
            onClick={submit}
            disabled={nameMissing}
            data-testid="save-scenario-confirm"
          >
            <GitCompareArrows className="me-1.5 h-4 w-4" aria-hidden />
            {t('platformConsole.pricing.scenarios.saveConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
