'use client';

import { Sparkles } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useLocale } from '@/components/providers/locale-provider';
import { useLibraryLabels } from '../_lib/library-labels';
import {
  AskLibraryPanel,
  type OpenDocumentOptions,
} from './ask-library-panel';

interface AskLibrarySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open a cited document in the read-only preview, with an optional deep-link. */
  onOpenDocument: (docId: string, opts?: OpenDocumentOptions) => void;
}

/**
 * Ask-the-Library ("Second Brain") side sheet for the list page. A thin chrome
 * wrapper around the shared {@link AskLibraryPanel} (streamed cited answers +
 * conversation history + suggested questions). Citations deep-link into the
 * preview viewer at the cited page/snippet.
 */
export function AskLibrarySheet({
  open,
  onOpenChange,
  onOpenDocument,
}: AskLibrarySheetProps) {
  const labels = useLibraryLabels();
  const { direction } = useLocale();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={direction === 'rtl' ? 'left' : 'right'}
        dir={direction}
        className="flex w-full max-w-xl flex-col sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-start">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {labels.ask.title}
          </SheetTitle>
          <SheetDescription className="text-start">
            {labels.ask.description}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <AskLibraryPanel onOpenDocument={onOpenDocument} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
