'use client';

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useT } from '@/components/providers/locale-provider';
import type { SubscriptionTier } from '@/types/tenant';
import { planRelation } from './billing-helpers';

interface PlanSpec {
  tier: SubscriptionTier;
  nameKey: string;
  priceKey: string;
  taglineKey: string;
  featureKeys: string[];
}

const PLANS: PlanSpec[] = [
  { tier: 'free', nameKey: 'plc.plans.free.name', priceKey: 'plc.plans.free.price', taglineKey: 'plc.plans.free.tagline', featureKeys: ['plc.plans.free.f1', 'plc.plans.free.f2', 'plc.plans.free.f3', 'plc.plans.free.f4'] },
  { tier: 'starter', nameKey: 'plc.plans.starter.name', priceKey: 'plc.plans.starter.price', taglineKey: 'plc.plans.starter.tagline', featureKeys: ['plc.plans.starter.f1', 'plc.plans.starter.f2', 'plc.plans.starter.f3', 'plc.plans.starter.f4'] },
  { tier: 'professional', nameKey: 'plc.plans.professional.name', priceKey: 'plc.plans.professional.price', taglineKey: 'plc.plans.professional.tagline', featureKeys: ['plc.plans.professional.f1', 'plc.plans.professional.f2', 'plc.plans.professional.f3', 'plc.plans.professional.f4', 'plc.plans.professional.f5'] },
  { tier: 'enterprise', nameKey: 'plc.plans.enterprise.name', priceKey: 'plc.plans.enterprise.price', taglineKey: 'plc.plans.enterprise.tagline', featureKeys: ['plc.plans.enterprise.f1', 'plc.plans.enterprise.f2', 'plc.plans.enterprise.f3', 'plc.plans.enterprise.f4', 'plc.plans.enterprise.f5', 'plc.plans.enterprise.f6', 'plc.plans.enterprise.f7'] },
];

interface PlanCardsProps {
  current: SubscriptionTier;
  onSelect: (tier: SubscriptionTier) => void;
}

export function PlanCards({ current, onSelect }: PlanCardsProps) {
  const t = useT('admin');
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {PLANS.map((plan) => {
        const relation = planRelation(current, plan.tier);
        const isCurrent = relation === 'current';
        return (
          <div
            key={plan.tier}
            className={cn(
              'flex flex-col rounded-2xl border bg-card p-5 transition-colors',
              isCurrent ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/40',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-foreground">{t(plan.nameKey)}</h3>
              {isCurrent ? <Badge>{t('plc.current')}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t(plan.taglineKey)}</p>
            <p className="mt-3 text-xl font-bold text-foreground">{t(plan.priceKey)}</p>
            <ul className="mt-4 flex-1 space-y-2">
              {plan.featureKeys.map((featureKey) => (
                <li key={featureKey} className="flex items-start gap-2 text-sm text-foreground/80">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span>{t(featureKey)}</span>
                </li>
              ))}
            </ul>
            <Button
              className="mt-5 w-full"
              variant={isCurrent ? 'outline' : relation === 'upgrade' ? 'default' : 'secondary'}
              disabled={isCurrent}
              onClick={() => onSelect(plan.tier)}
            >
              {isCurrent ? t('plc.currentPlan') : relation === 'upgrade' ? t('plc.upgrade') : t('plc.switch')}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
