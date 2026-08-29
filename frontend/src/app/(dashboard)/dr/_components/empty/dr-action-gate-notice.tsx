'use client';

/**
 * DRActionGateNotice — a small, always-visible INLINE reason banner explaining
 * why a route's write actions are currently disabled, so the operational command
 * bars don't read as "dead" toolbars whose only explanation is a hover tooltip.
 *
 * ClarioDR's operational pages gate every write action on `dr:write` AND a
 * selected protection group. When a precondition is missing this notice states
 * the reason in-line (a badge + helper text), keeping the on-ramp CTAs visible
 * (disabled) rather than vanishing them. It owns its bilingual (English + Modern
 * Standard Arabic) chrome via the shared DR bilingual contract and is RTL-safe
 * through logical spacing.
 *
 * Pass the already-resolved, route-specific `reason` string (e.g. "Select a
 * protection group first"); this component supplies the surrounding "Action
 * unavailable" label and icon.
 */

import { Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';

interface DRActionGateNoticeCopy {
  title: string;
  badge: string;
}

const gateNoticeLabels: DRBilingual<DRActionGateNoticeCopy> = {
  en: {
    title: 'Action unavailable',
    badge: 'Disabled',
  },
  ar: {
    title: 'الإجراء غير متاح',
    badge: 'مُعطّل',
  },
};

function useDRActionGateNoticeLabels(): DRActionGateNoticeCopy {
  const { locale } = useLocaleOrDefault();
  return resolveDRBilingual(gateNoticeLabels, locale);
}

export interface DRActionGateNoticeProps {
  /** The route-specific, already locale-resolved reason (e.g. "Select a protection group first"). */
  reason: string;
}

/**
 * Renders an inline, focusable reason notice. Render this above an operational
 * page's gated controls when an action precondition is missing but the controls
 * remain visible (disabled), so the reason is on-view — not tooltip-only.
 */
export function DRActionGateNotice({ reason }: DRActionGateNoticeProps) {
  const labels = useDRActionGateNoticeLabels();

  return (
    <Alert>
      <Info className="h-4 w-4" aria-hidden />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {labels.title}
        <Badge variant="outline">{labels.badge}</Badge>
      </AlertTitle>
      <AlertDescription>{reason}</AlertDescription>
    </Alert>
  );
}

export default DRActionGateNotice;
