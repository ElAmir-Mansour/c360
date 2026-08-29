'use client';

/**
 * InvestigationToolbarNav — Legal Investigations detail *navigation &
 * shareability* toolbar: copy investigation number, copy a shareable link, and
 * prev/next sibling navigation (click + `j`/`k` keyboard shortcuts).
 *
 * A compact, self-contained button group for the detail page's header actions
 * row. Available to EVERY viewer (read-only included) — it mutates nothing.
 * Bilingual via {@link useInvestigationToolbarNavLabels}; RTL-correct (chevrons
 * flip via `rtl:rotate-180`, layout follows the ambient `dir`).
 */

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, Copy, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useClipboard } from '@/hooks/use-clipboard';
import { showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useInvestigationSiblings } from './use-investigation-siblings';
import { useInvestigationToolbarNavLabels } from './investigation-toolbar-nav-labels';

export interface InvestigationToolbarNavProps {
  investigationId: string;
  investigationNumber: string;
  className?: string;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when `target` is a place the user is plausibly typing text into. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

export function InvestigationToolbarNav({
  investigationId,
  investigationNumber,
  className,
}: InvestigationToolbarNavProps) {
  const router = useRouter();
  const labels = useInvestigationToolbarNavLabels();
  const { prevId, nextId, isLoading } = useInvestigationSiblings(investigationId);
  const numberClipboard = useClipboard();
  const linkClipboard = useClipboard();

  const navigateTo = useCallback(
    (id: string | null) => {
      if (id) router.push(`/lex/investigations/${id}`);
    },
    [router],
  );

  // `j` → next, `k` → prev — logical mapping regardless of RTL/LTR. Ignored
  // while typing (input/textarea/select/contenteditable) or holding a modifier
  // (so Cmd+K-style palette shortcuts elsewhere keep working).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === 'j') {
        event.preventDefault();
        navigateTo(nextId);
      } else if (event.key === 'k') {
        event.preventDefault();
        navigateTo(prevId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigateTo, prevId, nextId]);

  const handleCopyNumber = async () => {
    const ok = await numberClipboard.copy(investigationNumber);
    if (ok) showSuccess(labels.copyNumberCopiedAria);
  };

  // window.location.href is only read inside this click handler (never at
  // render time), so this stays SSR-safe.
  const handleCopyLink = async () => {
    const ok = await linkClipboard.copy(window.location.href);
    if (ok) showSuccess(labels.copyLinkCopiedAria);
  };

  const prevTitle = prevId ? labels.prevAria : labels.prevDisabledAria;
  const nextTitle = nextId ? labels.nextAria : labels.nextDisabledAria;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          'inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card p-1 shadow-elevation-1',
          className,
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCopyNumber}
              aria-label={
                numberClipboard.copied
                  ? labels.copyNumberCopiedAria
                  : labels.copyNumberAria(investigationNumber)
              }
              title={
                numberClipboard.copied
                  ? labels.copyNumberCopiedAria
                  : labels.copyNumberAria(investigationNumber)
              }
            >
              {numberClipboard.copied ? (
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {numberClipboard.copied ? labels.copied : labels.copyNumber}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCopyLink}
              aria-label={linkClipboard.copied ? labels.copyLinkCopiedAria : labels.copyLinkAria}
              title={linkClipboard.copied ? labels.copyLinkCopiedAria : labels.copyLinkAria}
            >
              {linkClipboard.copied ? (
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : (
                <Link2 className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {linkClipboard.copied ? labels.copied : labels.copyLink}
          </TooltipContent>
        </Tooltip>

        <div className="mx-0.5 h-5 w-px shrink-0 bg-border/70" aria-hidden />

        <Tooltip>
          <TooltipTrigger asChild>
            {/* span wrapper: Radix tooltips don't fire on a disabled button
                (pointer-events removed), so wrap it. */}
            <span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigateTo(prevId)}
                disabled={isLoading || !prevId}
                aria-label={prevTitle}
                title={prevTitle}
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{prevId ? labels.prev : labels.prevDisabledAria}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => navigateTo(nextId)}
                disabled={isLoading || !nextId}
                aria-label={nextTitle}
                title={nextTitle}
              >
                <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{nextId ? labels.next : labels.nextDisabledAria}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
