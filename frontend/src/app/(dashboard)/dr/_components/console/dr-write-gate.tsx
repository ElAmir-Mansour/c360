'use client';

import { useMemo, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';

/**
 * Feature-local bilingual copy for the write gate's own chrome. The `description`
 * is supplied by the calling route (already locale-resolved by that route), so
 * only the gate's static title + tooltip live here.
 */
interface WriteGateLabels {
  /** Tooltip + assistive-tech reason shown on the read-only notice. */
  noWriteTooltip: string;
  /** Title of the read-only notice alert. */
  readOnlyTitle: string;
}

const writeGateLabels: DRBilingual<WriteGateLabels> = {
  en: {
    noWriteTooltip: 'Requires the dr:write permission',
    readOnlyTitle: 'Read-only access',
  },
  ar: {
    noWriteTooltip: 'يتطلّب صلاحية الكتابة (dr:write)',
    readOnlyTitle: 'وصول للقراءة فقط',
  },
};

/** Resolve the write-gate chrome copy against the active locale (en in tests). */
function useWriteGateLabels(): WriteGateLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(writeGateLabels, locale), [locale]);
}

/**
 * Wraps an interactive DR panel so every write control inside it is honestly
 * disabled when the operator lacks `dr:write`.
 *
 * When `canWrite` is false the children are rendered inside a `disabled`
 * `<fieldset>` — which natively disables every descendant button/input and is
 * removed from the tab order — and an explanatory, focusable notice is shown
 * above. The notice carries the same tooltip copy as the command bar so the
 * reason is reachable by keyboard and assistive tech (WCAG 2.1 AA). Logical
 * spacing keeps the layout RTL-safe.
 *
 * Shared across DR console routes (prove, rehearse, …) so the gating primitive
 * stays consistent.
 */
export function DRWriteGate({
  canWrite,
  description,
  children,
}: {
  canWrite: boolean;
  description: string;
  children: ReactNode;
}) {
  const labels = useWriteGateLabels();

  if (canWrite) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="block focus-visible:outline-none">
              <Alert variant="warning">
                <ShieldAlert className="h-4 w-4" aria-hidden />
                <AlertTitle>{labels.readOnlyTitle}</AlertTitle>
                <AlertDescription>{description}</AlertDescription>
              </Alert>
            </span>
          </TooltipTrigger>
          <TooltipContent>{labels.noWriteTooltip}</TooltipContent>
        </Tooltip>
        <fieldset disabled className={cn('m-0 min-w-0 border-0 p-0', 'opacity-90')}>
          {children}
        </fieldset>
      </div>
    </TooltipProvider>
  );
}
