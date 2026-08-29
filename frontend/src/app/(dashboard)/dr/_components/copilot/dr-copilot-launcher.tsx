'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useDRSelection, resolveDRGroupId } from '../../_lib/dr-selection';
import { useDRPosture, useDRGroupSummary } from '../../_hooks/use-dr-queries';
import { resolveDRBilingual, type DRBilingual } from '../../_lib/dr-i18n';
import { DRCopilotPanel } from './dr-copilot-panel';
import type { DRCopilotGrounding } from './dr-copilot-context';

const WRITE_PERMISSION = 'dr:write';

/** Launcher-chrome copy (one identically-shaped copy per locale). */
interface LauncherLabels {
  /** Visible label on the floating action button. */
  open: string;
  /** Accessible name for the floating action button. */
  openAria: string;
  /** Sheet title. */
  title: string;
  /** Sheet description. */
  description: string;
}

/**
 * Bilingual launcher-chrome copy. "ClarioDR" is the product name and stays
 * Latin in both locales; the `en` side is byte-identical to the prior English.
 */
const launcherLabels: DRBilingual<LauncherLabels> = {
  en: {
    open: 'Ask ClarioDR',
    openAria: 'Open the ClarioDR copilot',
    title: 'ClarioDR copilot',
    description:
      'A console-wide assistant grounded in your current protection group, stream, and run.',
  },
  ar: {
    open: 'اسأل ClarioDR',
    openAria: 'فتح مساعد ClarioDR',
    title: 'مساعد ClarioDR',
    description: 'مساعد على مستوى وحدة التحكّم مرتكز على مجموعة الحماية والتدفّق والعملية الحالية لديك.',
  },
};

/** Resolve the launcher-chrome copy for the active locale (en default in tests). */
function useLauncherLabels(): LauncherLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(launcherLabels, locale), [locale]);
}

/**
 * Resolve the live console selection into a copilot grounding context. Derives the
 * default group from posture (matching every other console surface) and the group
 * name from the group summary, so a copilot turn started from any route already
 * knows what the operator is looking at. The chat wire contract has no group/
 * stream field, so this context is folded into the prompt text by the panel.
 */
function useCopilotGrounding(runId?: string | null): DRCopilotGrounding {
  const pathname = usePathname();
  const postureQuery = useDRPosture();
  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);
  const { activeGroupId, activeStreamId } = useDRSelection({ groups });
  const groupSummaryQuery = useDRGroupSummary(activeGroupId);

  const groupName = useMemo(() => {
    if (groupSummaryQuery.data?.name) return groupSummaryQuery.data.name;
    const match = groups.find((group) => resolveDRGroupId(group) === activeGroupId);
    return match?.name ?? null;
  }, [groupSummaryQuery.data?.name, groups, activeGroupId]);

  return {
    groupId: activeGroupId,
    groupName,
    streamId: activeStreamId,
    runId: runId ?? null,
    route: pathname ?? null,
  };
}

export interface DRCopilotLauncherProps {
  /**
   * Optional custom trigger (e.g. an inline "Ask copilot" button embedded in the
   * war room). When omitted the default floating action button is rendered.
   */
  trigger?: ReactNode;
  /**
   * Active recovery-run id when the launcher is embedded in a war room, so the
   * copilot grounds answers in that run. Optional everywhere else.
   */
  runId?: string | null;
}

/**
 * Console-wide DR Copilot launcher.
 *
 * Renders a floating "Ask ClarioDR" action (or a caller-supplied trigger) that
 * opens a right-side slide-over panel running the REAL copilot chat + transcript
 * I/O via the shared `useCopilotActions()` hook. Mounted once in the DR layout so
 * it's reachable from every `/dr` route, and embeddable in the war room by
 * passing a custom `trigger` + `runId`.
 *
 * Accessibility: the Sheet is a Radix dialog — it traps focus, restores focus to
 * the trigger on close, closes on Esc, and is labelled by its title/description.
 * The composer is keyboard-driven (Enter to send, Shift+Enter for newline). It is
 * deliberately NOT registered into the command palette (that is Wave 5).
 */
export function DRCopilotLauncher({ trigger, runId }: DRCopilotLauncherProps = {}) {
  const labels = useLauncherLabels();
  const [open, setOpen] = useState(false);
  const { hasPermission } = useAuth();
  const canWrite = hasPermission(WRITE_PERMISSION);
  const grounding = useCopilotGrounding(runId);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={labels.openAria}
            className={cn(
              'fixed bottom-6 end-6 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg',
              'transition-colors hover:bg-primary/90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <Bot className="h-5 w-5" aria-hidden />
            <span className="hidden sm:inline">{labels.open}</span>
          </button>
        )}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-[calc(100vw-1rem)] flex-col gap-4 sm:max-w-md lg:max-w-lg"
      >
        <SheetHeader className="shrink-0 text-start">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" aria-hidden />
            {labels.title}
          </SheetTitle>
          <SheetDescription>{labels.description}</SheetDescription>
        </SheetHeader>
        {/* Mount the panel only while open so a closed launcher holds no copilot
            state and starts each session fresh on reopen. */}
        {open ? <DRCopilotPanel grounding={grounding} canWrite={canWrite} /> : null}
      </SheetContent>
    </Sheet>
  );
}
