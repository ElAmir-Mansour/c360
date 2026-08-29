'use client';

/**
 * DRSetupEmptyState — the shared cold-start on-ramp for ClarioDR's operational
 * child routes (recover / rehearse / readiness / runbooks).
 *
 * ClarioDR is a *configure-then-operate* console: every operational action is
 * gated on `dr:write` AND a selected protection group. On a tenant with ZERO
 * protection groups those preconditions can never be met, so the operational
 * pages would otherwise render a wall of disabled buttons with no on-ramp. This
 * component replaces (or precedes) that wall with a single, prominent card that
 * names the missing step — *create your first protection group* — and routes the
 * operator straight to `/dr/protect`, whose Inventory tab auto-opens the
 * `CreateGroupDialog` when `groups.length === 0`.
 *
 * It is intentionally self-contained: it owns its bilingual (English + Modern
 * Standard Arabic) copy via the shared DR bilingual contract (`resolveDRBilingual`,
 * English fallback) and is RTL-safe through logical spacing + an `rtl:`-flipped
 * trailing chevron, so the same component drops into any DR child route.
 */

import Link from 'next/link';
import { ArrowRight, ShieldPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';

/** Where the on-ramp routes — protect auto-opens its create-group dialog. */
const PROTECT_HREF = '/dr/protect';

interface DRSetupEmptyStateCopy {
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
}

const setupEmptyStateLabels: DRBilingual<DRSetupEmptyStateCopy> = {
  en: {
    eyebrow: 'Set up disaster recovery',
    title: 'Create your first protection group',
    description:
      'ClarioDR operates on protection groups — replicated sites and data with RPO/RTO objectives. Create one to unlock failover, drills, runbooks and readiness on this page.',
    cta: 'Set up protection',
  },
  ar: {
    eyebrow: 'إعداد التعافي من الكوارث',
    title: 'أنشئ أول مجموعة حماية لك',
    description:
      'يعمل ClarioDR على مجموعات الحماية — مواقع وبيانات منسوخة بأهداف نقطة الاسترداد (RPO) وزمن الاسترداد (RTO). أنشئ واحدة لتفعيل تجاوز الفشل والتمارين وكتيّبات التشغيل والجاهزية في هذه الصفحة.',
    cta: 'إعداد الحماية',
  },
};

/** Resolve the setup empty-state copy against the active locale (English fallback). */
function useDRSetupEmptyStateLabels(): DRSetupEmptyStateCopy {
  const { locale } = useLocaleOrDefault();
  return resolveDRBilingual(setupEmptyStateLabels, locale);
}

export interface DRSetupEmptyStateProps {
  /** Optional override for the body copy (e.g. a route-specific framing). */
  description?: string;
  className?: string;
}

/**
 * A prominent setup card: icon + title + one-line description + a primary CTA
 * routing to `/dr/protect`. Render this when `useDRPosture()` has loaded and the
 * tenant has no protection groups, so the first thing a new operator sees is the
 * create-a-group path — not a wall of disabled controls.
 */
export function DRSetupEmptyState({ description, className }: DRSetupEmptyStateProps) {
  const labels = useDRSetupEmptyStateLabels();

  return (
    <Card className={cn('border-primary/30 bg-primary/[0.03]', className)}>
      <CardContent className="flex flex-col items-center gap-5 px-6 py-12 text-center">
        <span
          className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20"
          aria-hidden
        >
          <ShieldPlus className="h-8 w-8" />
        </span>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-caps-wide text-primary rtl:tracking-normal">
            {labels.eyebrow}
          </p>
          <h2 className="text-h3 font-semibold">{labels.title}</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {description ?? labels.description}
          </p>
        </div>
        <Button asChild size="lg">
          <Link href={PROTECT_HREF}>
            {labels.cta}
            <ArrowRight className="ms-2 h-4 w-4 rtl:rotate-180" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default DRSetupEmptyState;
