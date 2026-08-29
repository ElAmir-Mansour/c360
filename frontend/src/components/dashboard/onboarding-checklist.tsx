'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, CreditCard, Plug, Rocket, Shield, UserCog, UserPlus, X, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatNumber } from '@/lib/format/numerals';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { IconBadge } from '@/components/shared/icon-badge';
import { cn } from '@/lib/utils';
import { useDashboardText } from './dashboard-i18n';

interface Step {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: 'primary' | 'info' | 'success' | 'warning';
  /** Hidden when the user lacks this permission. */
  permission?: string;
}

const STEPS: Step[] = [
  { id: 'profile', title: 'Complete your profile', description: 'Add your details and secure your account with MFA.', href: '/settings', icon: UserCog, tone: 'primary' },
  { id: 'team', title: 'Invite your team', description: 'Bring colleagues into your workspace.', href: '/admin/invitations', icon: UserPlus, tone: 'info', permission: 'users:write' },
  { id: 'roles', title: 'Set up roles & access', description: 'Define who can see and do what.', href: '/admin/roles', icon: Shield, tone: 'warning', permission: 'users:read' },
  { id: 'integrations', title: 'Connect integrations', description: 'Wire in your data sources and tools.', href: '/admin/integrations', icon: Plug, tone: 'success', permission: 'tenant:write' },
  { id: 'billing', title: 'Review your plan & usage', description: 'Check quotas and choose the right plan.', href: '/admin/billing', icon: CreditCard, tone: 'primary', permission: 'tenant:read' },
];

interface ChecklistState {
  done: string[];
  dismissed: boolean;
}

/**
 * First-run "getting started" guide on the dashboard hub. Permission-gated steps,
 * progress persisted to localStorage, dismissible. Self-hides once dismissed.
 */
export function OnboardingChecklist() {
  const { hasPermission } = useAuth();
  const { locale } = useLocaleOrDefault();
  const t = useDashboardText();
  const [state, setState] = useLocalStorage<ChecklistState>('clario360:onboarding', { done: [], dismissed: false });

  const steps = STEPS.filter((step) => !step.permission || hasPermission(step.permission));
  if (state.dismissed || steps.length === 0) return null;

  const doneCount = steps.filter((step) => state.done.includes(step.id)).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const allDone = doneCount === steps.length;

  const toggle = (id: string, checked: boolean) =>
    setState((prev) => ({
      ...prev,
      done: checked ? Array.from(new Set([...prev.done, id])) : prev.done.filter((x) => x !== id),
    }));

  return (
    <section className="rounded-3xl border border-[color:var(--panel-border)] bg-card p-5 shadow-[var(--card-shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <IconBadge icon={allDone ? CheckCircle2 : Rocket} tone={allDone ? 'success' : 'primary'} size="lg" />
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {allDone ? t.onboarding.allSetTitle : t.onboarding.getStartedTitle}
            </h2>
            <p className="text-sm text-muted-foreground">
              {allDone ? t.onboarding.allSetHint : t.onboarding.getStartedHint}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.onboarding.dismiss}
          onClick={() => setState((prev) => ({ ...prev, dismissed: true }))}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Progress
          value={pct}
          className="h-2"
          aria-label={t.onboarding.progressLabel}
        />
        <bdi dir="ltr" className="shrink-0 text-xs font-medium text-muted-foreground">
          {formatNumber(doneCount, locale)}/{formatNumber(steps.length, locale)}
        </bdi>
      </div>

      <ul className="mt-4 space-y-2">
        {steps.map((step) => {
          const done = state.done.includes(step.id);
          const copy = t.onboarding.steps[step.id];
          const title = copy?.title ?? step.title;
          const description = copy?.description ?? step.description;
          return (
            <li
              key={step.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border border-border bg-card/50 p-3 transition-colors hover:border-primary/30',
                done && 'opacity-70',
              )}
            >
              <Checkbox
                checked={done}
                onCheckedChange={(checked) => toggle(step.id, checked === true)}
                aria-label={`${t.onboarding.markDone}: ${title}`}
              />
              <IconBadge icon={step.icon} tone={step.tone} size="sm" />
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium text-foreground', done && 'line-through')}>{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href={step.href}>
                  {t.onboarding.go}
                  <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
