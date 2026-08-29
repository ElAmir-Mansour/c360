'use client';

/**
 * SettlementToolbarNav — the Settlements / ADR detail-page *navigation &
 * shareability* toolbar: copy the settlement reference, copy a shareable link,
 * and prev/next sibling navigation (click + `j`/`k` keyboard shortcuts).
 *
 * A compact, self-contained button group meant to sit in the detail hero's
 * header actions row. Available to ALL users (read-only). Bilingual (EN + MSA)
 * via {@link useSettlementDetailExtraLabels}; RTL-correct — chevrons flip via
 * `rtl:rotate-180` and layout follows the ambient `dir`.
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
import { useSettlementSiblings } from './use-settlement-siblings';
import { useSettlementDetailExtraLabels } from './detail-extra-labels';

export interface SettlementToolbarNavProps {
  settlementId: string;
  /** The human reference (falls back to the id when a settlement has none). */
  reference: string;
  className?: string;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

export function SettlementToolbarNav({
  settlementId,
  reference,
  className,
}: SettlementToolbarNavProps) {
  const router = useRouter();
  const t = useSettlementDetailExtraLabels().toolbar;
  const { prevId, nextId, isLoading } = useSettlementSiblings(settlementId);
  const refClipboard = useClipboard();
  const linkClipboard = useClipboard();

  const navigateTo = useCallback(
    (id: string | null) => {
      if (id) router.push(`/lex/settlements/${id}`);
    },
    [router],
  );

  // `j` → next, `k` → prev — logical mapping regardless of RTL/LTR. Ignored
  // while typing or holding a modifier key (so palette shortcuts keep working).
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

  const handleCopyReference = async () => {
    const ok = await refClipboard.copy(reference);
    if (ok) showSuccess(t.copyReferenceCopied);
  };

  // window.location.href is only read inside this click handler (never at
  // render time), so this stays SSR-safe.
  const handleCopyLink = async () => {
    const ok = await linkClipboard.copy(window.location.href);
    if (ok) showSuccess(t.copyLinkCopied);
  };

  const prevTitle = prevId ? t.prevAria : t.prevDisabled;
  const nextTitle = nextId ? t.nextAria : t.nextDisabled;

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
              onClick={handleCopyReference}
              aria-label={
                refClipboard.copied ? t.copyReferenceCopied : t.copyReferenceAria(reference)
              }
              title={refClipboard.copied ? t.copyReferenceCopied : t.copyReferenceAria(reference)}
            >
              {refClipboard.copied ? (
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{refClipboard.copied ? t.copied : t.copyReference}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCopyLink}
              aria-label={linkClipboard.copied ? t.copyLinkCopied : t.copyLinkAria}
              title={linkClipboard.copied ? t.copyLinkCopied : t.copyLinkAria}
            >
              {linkClipboard.copied ? (
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
              ) : (
                <Link2 className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{linkClipboard.copied ? t.copied : t.copyLink}</TooltipContent>
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
          <TooltipContent>{prevId ? t.prev : t.prevDisabled}</TooltipContent>
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
          <TooltipContent>{nextId ? t.next : t.nextDisabled}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
