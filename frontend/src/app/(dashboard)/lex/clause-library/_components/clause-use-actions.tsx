'use client';

import { useRouter } from 'next/navigation';
import { Clipboard, Copy, Languages, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/lib/toast';
import { copyToClipboard } from '@/lib/utils';
import type { LexClauseLibraryEntry } from '@/types/suites';
import {
  buildClauseCopyText,
  CLAUSE_DRAFTING_PATH,
  type ClauseCopyFormat,
  tryQueueClauseForDrafting,
} from './clause-library-utils';
import { type ClauseLibraryLabels, useClauseLibraryLabels } from './clause-content-labels';

export interface ClauseUseActionsProps {
  entry: LexClauseLibraryEntry;
  onSentToDrafting?: (entry: LexClauseLibraryEntry) => void;
}

export function ClauseUseActions({ entry, onSentToDrafting }: ClauseUseActionsProps) {
  const router = useRouter();
  const t = useClauseLibraryLabels().useActions;

  const copyActions: Array<{ format: ClauseCopyFormat; label: string; icon: typeof Copy }> = [
    { format: 'en', label: t.copyEn, icon: Copy },
    { format: 'ar', label: t.copyAr, icon: Languages },
    { format: 'bilingual', label: t.copyBilingual, icon: Clipboard },
  ];

  const copyClause = async (format: ClauseCopyFormat) => {
    const value = buildClauseCopyText(entry, format);
    if (!value) {
      showError(t.nothingToCopyTitle, t.nothingToCopyBody);
      return;
    }

    const copied = await copyToClipboard(value);
    if (copied) {
      showSuccess(t.copiedTitle, copyDescription(format, t));
    } else {
      showError(t.copyFailedTitle, t.copyFailedBody);
    }
  };

  const sendToDrafting = async () => {
    const queued = tryQueueClauseForDrafting(entry);
    const copied = await copyToClipboard(buildClauseCopyText(entry, 'bilingual'));

    if (!queued && !copied) {
      showError(t.draftingFailedTitle, t.draftingFailedBody);
      return;
    }

    showSuccess(
      t.draftingReadyTitle,
      queued ? t.draftingReadyQueued : t.draftingReadyCopied,
    );
    onSentToDrafting?.(entry);
    router.push(CLAUSE_DRAFTING_PATH);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {copyActions.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.format}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void copyClause(action.format);
            }}
          >
            <Icon className="me-1.5 h-4 w-4" aria-hidden="true" />
            {action.label}
          </Button>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void sendToDrafting();
        }}
      >
        <Send className="me-1.5 h-4 w-4" aria-hidden="true" />
        {t.useInDrafting}
      </Button>
    </div>
  );
}

function copyDescription(
  format: ClauseCopyFormat,
  t: ClauseLibraryLabels['useActions'],
): string {
  switch (format) {
    case 'en':
      return t.copiedEn;
    case 'ar':
      return t.copiedAr;
    case 'bilingual':
      return t.copiedBilingual;
  }
}
