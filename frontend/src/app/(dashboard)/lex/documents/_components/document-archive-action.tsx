'use client';

/**
 * "Archive to e-archive" action + reference display for a Watheeq legal document
 * (Othaim PRD 14.1). A single button that pushes the document's latest version to
 * the tenant's ACTIVE e-archive connector (routed server-side through the
 * integration registry Invoke) and, on success, reveals the stamped archive
 * reference panel (reference, WORM mode, archived-at, manifest hash, retain-until).
 *
 * The demo target is the REVERSIBLE, non-WORM local backend (worm_mode=none). The
 * 409 NO_ARCHIVE_CONNECTOR case is surfaced with a clear message. Bilingual + RTL
 * via {@link usePreviewLabels}.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, Loader2, ShieldCheck } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLocale } from '@/components/providers/locale-provider';
import { showSuccess, showError } from '@/lib/toast';
import type { ApiError } from '@/types/api';
import {
  archiveDocument,
  type DocumentArchiveInfo,
} from '../_lib/document-archive-api';
import { usePreviewLabels } from './preview-labels';

interface DocumentArchiveActionProps {
  documentId: string;
  /** Archive facts already stamped on the document (metadata.archive), if any. */
  initialArchive?: DocumentArchiveInfo | null;
  /** Whether the current user may archive (document write tier). */
  canWrite?: boolean;
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'status' in error
  );
}

export function DocumentArchiveAction({
  documentId,
  initialArchive = null,
  canWrite = false,
}: DocumentArchiveActionProps) {
  const labels = usePreviewLabels();
  const { direction } = useLocale();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [archive, setArchive] = useState<DocumentArchiveInfo | null>(initialArchive);

  const mutation = useMutation({
    mutationFn: () => archiveDocument(documentId),
    onSuccess: (result) => {
      setArchive(result.archive);
      showSuccess(labels.archive.successTitle, labels.archive.successDescription(result.connector));
      // Refresh document surfaces so the stamped metadata is picked up elsewhere.
      void queryClient.invalidateQueries({ queryKey: ['lex', 'documents'] });
    },
    onError: (error) => {
      if (isApiError(error) && error.code === 'NO_ARCHIVE_CONNECTOR') {
        showError(labels.archive.noConnectorTitle, labels.archive.noConnectorDescription);
        return;
      }
      const message = isApiError(error) ? error.message : labels.archive.failedTitle;
      showError(labels.archive.failedTitle, message);
    },
  });

  const wormLabel = useMemo(() => resolveWormLabel(archive?.worm_mode, labels), [archive?.worm_mode, labels]);
  const isReversible = (archive?.worm_mode ?? 'none') === 'none';

  const handleCopyReference = async () => {
    if (!archive?.archive_ref) return;
    try {
      await navigator.clipboard.writeText(archive.archive_ref);
      showSuccess(labels.archive.referenceCopiedTitle);
    } catch {
      showError(labels.toolbar.copyUnavailableTitle, labels.toolbar.copyUnavailableDescription);
    }
  };

  return (
    <div className="mt-3 rounded-lg border bg-card/70 px-3 py-3" dir={direction}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Archive className="h-3.5 w-3.5" aria-hidden />
        {labels.archive.title}
      </div>

      {canWrite ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {mutation.isPending ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Archive className="me-1.5 h-4 w-4" aria-hidden />
          )}
          {mutation.isPending ? labels.archive.actionPending : labels.archive.action}
        </Button>
      ) : null}

      {archive?.archive_ref ? (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr]">
          <dt className="font-medium text-muted-foreground">{labels.archive.reference}</dt>
          <dd className="flex min-w-0 items-center gap-1.5 text-foreground">
            <code className="truncate font-mono text-[11px]">{archive.archive_ref}</code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopyReference}
              aria-label={labels.archive.copyReferenceAria}
              className="h-6 w-6 shrink-0 rounded text-muted-foreground hover:text-foreground"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </dd>

          <dt className="font-medium text-muted-foreground">{labels.archive.wormMode}</dt>
          <dd className="text-foreground">
            <Badge variant={isReversible ? 'secondary' : 'default'} className="gap-1">
              <ShieldCheck className="h-3 w-3" aria-hidden />
              {wormLabel}
            </Badge>
          </dd>

          {archive.archived_at ? (
            <>
              <dt className="font-medium text-muted-foreground">{labels.archive.archivedAt}</dt>
              <dd className="text-foreground">{formatTimestamp(archive.archived_at, direction)}</dd>
            </>
          ) : null}

          {archive.manifest_hash ? (
            <>
              <dt className="font-medium text-muted-foreground">{labels.archive.manifestHash}</dt>
              <dd className="min-w-0 text-foreground">
                <code className="block truncate font-mono text-[11px]">{archive.manifest_hash}</code>
              </dd>
            </>
          ) : null}

          {archive.retain_until ? (
            <>
              <dt className="font-medium text-muted-foreground">{labels.archive.retainUntil}</dt>
              <dd className="text-foreground">{formatTimestamp(archive.retain_until, direction)}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{labels.archive.notArchived}</p>
      )}

      {archive?.archive_ref && isReversible ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{labels.archive.reversibleNote}</p>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir={direction}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-start">{labels.archive.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-start">
              {labels.archive.confirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{labels.archive.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                mutation.mutate();
              }}
            >
              {labels.archive.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function resolveWormLabel(
  mode: string | undefined,
  labels: ReturnType<typeof usePreviewLabels>,
): string {
  switch ((mode ?? 'none').toLowerCase()) {
    case 'governance':
      return labels.archive.wormGovernance;
    case 'compliance':
      return labels.archive.wormCompliance;
    default:
      return labels.archive.wormNone;
  }
}

function formatTimestamp(value: string, direction: 'ltr' | 'rtl'): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(direction === 'rtl' ? 'ar-SA' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  } catch {
    return parsed.toISOString();
  }
}
