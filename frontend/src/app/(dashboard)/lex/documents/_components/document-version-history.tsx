'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye, History, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { enterpriseApi } from '@/lib/enterprise';
import { useLexFormat } from '@/lib/lex/ksa';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LexDocumentVersion } from '@/types/suites';
import { usePreviewLabels } from './preview-labels';

interface DocumentVersionHistoryProps {
  /** Document whose versions to list; null/undefined renders nothing. */
  documentId?: string;
  /** The document's `current_version`, used to mark the active revision. */
  currentVersion?: number;
  /** Only fetch when the host sheet is open. */
  enabled: boolean;
  /**
   * The version currently shown in the viewer (its `version` number). When a row
   * matches, it is highlighted as the active preview.
   */
  selectedVersion?: number | null;
  /** Loads the given version's file into the viewer (resolves a presigned URL). */
  onPreviewVersion: (version: LexDocumentVersion) => void;
  /** True while the parent is resolving a version's presigned URL. */
  previewingVersion?: number | null;
  /** Resolves and triggers a download of the given version's file. */
  onDownloadVersion: (version: LexDocumentVersion) => void;
  downloadingVersion?: number | null;
  className?: string;
}

/**
 * Version-history timeline for a {@link LexDocument}. Lists every recorded
 * revision newest-first with a `vN` badge, change summary, uploader, relative
 * upload time, and formatted file size. The current version (matching the
 * document's `current_version`) is marked. Each row offers a Preview action
 * (loads that version's file into the viewer via a presigned URL) and a Download
 * action. Shows a skeleton while loading and a clean empty/error state.
 */
export function DocumentVersionHistory({
  documentId,
  currentVersion,
  enabled,
  selectedVersion,
  onPreviewVersion,
  previewingVersion,
  onDownloadVersion,
  downloadingVersion,
  className,
}: DocumentVersionHistoryProps) {
  const labels = usePreviewLabels();
  const t = labels.versions;
  const f = useLexFormat();

  const versionsQuery = useQuery({
    queryKey: ['lex-document-versions', documentId],
    queryFn: () => enterpriseApi.lex.listDocumentVersions(documentId ?? ''),
    enabled: enabled && !!documentId,
  });

  const versions = useMemo(() => {
    const list = versionsQuery.data ?? [];
    return [...list].sort((a, b) => b.version - a.version);
  }, [versionsQuery.data]);

  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label={t.title}>
      <header className="flex items-start gap-2">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight text-foreground">{t.title}</h3>
          <p className="text-xs text-muted-foreground">{t.description}</p>
        </div>
      </header>

      {versionsQuery.isLoading ? (
        <VersionSkeleton />
      ) : versionsQuery.isError ? (
        <EmptyState icon={History} title={t.loadError} size="compact" className="border bg-card" />
      ) : versions.length === 0 ? (
        <EmptyState
          icon={History}
          title={t.emptyTitle}
          description={t.emptyDescription}
          size="compact"
          className="border bg-card"
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {versions.map((version) => {
            const isCurrent = version.version === currentVersion;
            const isSelected = version.version === selectedVersion;
            const isPreviewing = version.version === previewingVersion;
            const isDownloading = version.version === downloadingVersion;
            return (
              <li
                key={version.id}
                className={cn(
                  'rounded-lg border bg-card p-3 transition-colors',
                  isSelected && 'border-primary/50 ring-1 ring-primary/30',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={isCurrent ? 'success' : 'outline'}>
                        {labels.versionLabel(version.version)}
                      </Badge>
                      {isCurrent && (
                        <span className="text-[11px] font-medium uppercase tracking-wide text-primary">
                          {t.current}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(version.file_size_bytes)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">
                      {version.change_summary?.trim() || (
                        <span className="text-muted-foreground">{t.noSummary}</span>
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="truncate">{t.uploadedBy(version.uploaded_by)}</span>
                      <span aria-hidden>·</span>
                      <time
                        dateTime={version.uploaded_at}
                        title={f.formatDual(version.uploaded_at)}
                        className="text-xs text-muted-foreground"
                      >
                        {f.formatRelative(version.uploaded_at)}
                      </time>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={t.previewAria(version.version)}
                      title={t.preview}
                      disabled={isPreviewing}
                      onClick={() => onPreviewVersion(version)}
                    >
                      {isPreviewing ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={t.downloadAria(version.version)}
                      title={t.download}
                      disabled={isDownloading}
                      onClick={() => onDownloadVersion(version)}
                    >
                      {isDownloading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Download className="h-4 w-4" aria-hidden />
                      )}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function VersionSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-12 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
