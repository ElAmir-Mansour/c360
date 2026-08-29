'use client';

/**
 * EntityToolbarNav — Entity-360 detail *navigation & shareability* toolbar (#2):
 * copy the organization name (an entity has no reference/code — the name is its
 * identifier), copy a shareable link, and prev/next sibling navigation (click +
 * `j`/`k` keyboard shortcuts) across the aggregated register.
 *
 * A compact, self-contained button group meant to sit in the detail hero's
 * actions slot. Bilingual (English + MSA) via {@link useEntityDetailLabels};
 * RTL-correct (chevrons flip via `rtl:rotate-180`, layout follows the ambient
 * `dir` — no directional assumptions baked in here). Mirrors the service-desk
 * `RequestToolbarNav` (which we do NOT edit).
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
import { useEntitySiblings } from './use-entity-siblings';
import { useEntityDetailLabels } from './entity-detail-labels';

export interface EntityToolbarNavProps {
  entityId: string;
  entityName: string;
  className?: string;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when `target` is a place the user is plausibly typing text into. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

export function EntityToolbarNav({ entityId, entityName, className }: EntityToolbarNavProps) {
  const router = useRouter();
  const labels = useEntityDetailLabels().toolbar;
  const { prevId, nextId, isLoading } = useEntitySiblings(entityId);
  const nameClipboard = useClipboard();
  const linkClipboard = useClipboard();

  const navigateTo = useCallback(
    (id: string | null) => {
      if (id) router.push(`/lex/entities/${id}`);
    },
    [router],
  );

  // `j` → next, `k` → prev — logical mapping regardless of RTL/LTR direction.
  // Ignored while typing or holding a modifier so palette shortcuts still work.
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

  const handleCopyName = async () => {
    const ok = await nameClipboard.copy(entityName);
    if (ok) showSuccess(labels.copied);
  };

  // window.location.href read only inside the click handler — stays SSR-safe.
  const handleCopyLink = async () => {
    const ok = await linkClipboard.copy(window.location.href);
    if (ok) showSuccess(labels.copied);
  };

  const prevTitle = prevId ? labels.prev : labels.prevDisabled;
  const nextTitle = nextId ? labels.next : labels.nextDisabled;

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
              onClick={handleCopyName}
              aria-label={nameClipboard.copied ? labels.copied : labels.copyNameAria(entityName)}
              title={nameClipboard.copied ? labels.copied : labels.copyNameAria(entityName)}
            >
              {nameClipboard.copied ? (
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{nameClipboard.copied ? labels.copied : labels.copyName}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCopyLink}
              aria-label={linkClipboard.copied ? labels.copied : labels.copyLinkAria}
              title={linkClipboard.copied ? labels.copied : labels.copyLinkAria}
            >
              {linkClipboard.copied ? (
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : (
                <Link2 className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{linkClipboard.copied ? labels.copied : labels.copyLink}</TooltipContent>
        </Tooltip>

        <div className="mx-0.5 h-5 w-px shrink-0 bg-border/70" aria-hidden />

        <Tooltip>
          <TooltipTrigger asChild>
            {/* span wrapper: Radix tooltips don't fire on a disabled button. */}
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
          <TooltipContent>{prevTitle}</TooltipContent>
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
          <TooltipContent>{nextTitle}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
