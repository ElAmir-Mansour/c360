/**
 * M18 — Documents repository kanban board (list page).
 *
 * A read-only kanban over the document lifecycle. Columns are the lifecycle
 * statuses (draft → active → archived → superseded); when a document has no
 * status the card falls into a "confidentiality" lane keyed off its
 * confidentiality level so nothing silently disappears. Cards summarise each
 * document — title, confidentiality chip, KSA-formatted updated date — and link
 * to the document preview via the shared row click handler upstream.
 *
 * Drag mechanics are delegated to the shared {@link BoardView} primitive
 * (dnd-kit). There is no drag-to-advance here: document status changes route
 * through edit / bulk actions on the table, so the board stays read-only and
 * mirrors the settlements/cases board surfaces.
 *
 * Bilingual + RTL safe. Status / confidentiality labels are resolved from the
 * documents label bundle passed in; the only board-local copy (empty column,
 * the confidentiality-fallback lane heading) lives in a small self-contained
 * EN/MSA bundle per the lex i18n contract.
 */

'use client';

import { useMemo } from 'react';
import { BoardView, type BoardColumn } from '@/components/shared/board-view';
import { LexStatusChip } from '@/components/lex/status-chip';
import { useLexFormat } from '@/lib/lex/ksa';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type {
  LexDocument,
  LexDocumentConfidentiality,
  LexDocumentStatus,
} from '@/types/suites';
import { DocumentThumb, DocumentConfidentialityChip } from './document-row-treatment';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import type { DocumentsLabels } from '../_lib/documents-labels';

// ---------------------------------------------------------------------------
// Column model: status lanes (+ a confidentiality fallback lane)
// ---------------------------------------------------------------------------

/** Lifecycle order of the document status FSM (mirrors the filter order). */
const STATUS_COLUMN_ORDER: LexDocumentStatus[] = [
  'draft',
  'active',
  'archived',
  'superseded',
];

/**
 * Thin accent bar per status lane. Tones follow the shared status taxonomy:
 * draft = inert, active = good, archived/superseded = muted.
 */
const STATUS_ACCENT: Record<LexDocumentStatus, string> = {
  draft: 'bg-muted-foreground/40',
  active: 'bg-success-500/70',
  archived: 'bg-neutral-400/60',
  superseded: 'bg-warning-500/60',
};

/** Confidentiality fallback lanes (used only when a document has no status). */
const CONFIDENTIALITY_COLUMN_ORDER: LexDocumentConfidentiality[] = [
  'public',
  'internal',
  'confidential',
  'privileged',
];

const CONFIDENTIALITY_ACCENT: Record<LexDocumentConfidentiality, string> = {
  public: 'bg-muted-foreground/40',
  internal: 'bg-sky-400/70',
  confidential: 'bg-warning-500/70',
  privileged: 'bg-rose-500/70',
};

/** Prefix marking a confidentiality-derived (fallback) column id, kept distinct
 * from status ids so the two key spaces never collide. */
const CONFIDENTIALITY_COLUMN_PREFIX = 'conf:';

function isDocumentStatus(value: string): value is LexDocumentStatus {
  return (STATUS_COLUMN_ORDER as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Feature-local bilingual labels (board-only copy)
// ---------------------------------------------------------------------------

interface DocumentsBoardLabels {
  emptyColumn: string;
  /** Heading for a confidentiality-fallback lane, e.g. "Privileged · no status". */
  confidentialityLane: (confidentiality: string) => string;
}

const boardLabels: LexBilingual<DocumentsBoardLabels> = {
  en: {
    emptyColumn: 'No documents',
    confidentialityLane: (confidentiality) => `${confidentiality} · no status`,
  },
  ar: {
    emptyColumn: 'لا توجد وثائق',
    confidentialityLane: (confidentiality) => `${confidentiality} · بلا حالة`,
  },
};

function useDocumentsBoardLabels(): DocumentsBoardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveLexBilingual(boardLabels, locale as AppLocale),
    [locale],
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DocumentsBoardProps {
  documents: LexDocument[];
  /** Resolved documents label bundle (status + confidentiality enums). */
  labels: DocumentsLabels;
  dir: 'ltr' | 'rtl';
  /** Opens the preview/guard sheet — same handler the table row click uses. */
  onSelect: (document: LexDocument) => void;
}

export function DocumentsBoard({ documents, labels, dir, onSelect }: DocumentsBoardProps) {
  const boardL = useDocumentsBoardLabels();
  const { locale } = useLocaleOrDefault();

  // The board groups by status. To avoid empty/irrelevant fallback lanes, only
  // surface the confidentiality lanes that actually receive a status-less
  // document. Map each document to its column id once.
  const columnIdFor = (document: LexDocument): string =>
    document.status
      ? document.status
      : `${CONFIDENTIALITY_COLUMN_PREFIX}${document.confidentiality}`;

  const usedConfidentialityLanes = useMemo(() => {
    const set = new Set<LexDocumentConfidentiality>();
    for (const document of documents) {
      if (!document.status) {
        set.add(document.confidentiality);
      }
    }
    return CONFIDENTIALITY_COLUMN_ORDER.filter((value) => set.has(value));
  }, [documents]);

  const columns: BoardColumn[] = useMemo(() => {
    const statusColumns: BoardColumn[] = STATUS_COLUMN_ORDER.map((status) => ({
      id: status,
      label: labels.enums.statuses[status] ?? unknownDocumentEnum('status', status, locale),
      colorClass: STATUS_ACCENT[status],
    }));
    const confidentialityColumns: BoardColumn[] = usedConfidentialityLanes.map(
      (confidentiality) => ({
        id: `${CONFIDENTIALITY_COLUMN_PREFIX}${confidentiality}`,
        label: boardL.confidentialityLane(
          labels.enums.confidentiality[confidentiality] ??
            unknownDocumentEnum('confidentiality', confidentiality, locale),
        ),
        colorClass: CONFIDENTIALITY_ACCENT[confidentiality],
      }),
    );
    return [...statusColumns, ...confidentialityColumns];
  }, [labels.enums.statuses, labels.enums.confidentiality, usedConfidentialityLanes, boardL, locale]);

  return (
    <BoardView<LexDocument>
      columns={columns}
      items={documents}
      getItemId={(document) => document.id}
      getItemColumnId={columnIdFor}
      dir={dir}
      emptyColumnLabel={boardL.emptyColumn}
      renderCard={(document) => (
        <DocumentBoardCard document={document} labels={labels} onSelect={onSelect} />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function DocumentBoardCard({
  document,
  labels,
  onSelect,
}: {
  document: LexDocument;
  labels: DocumentsLabels;
  onSelect: (document: LexDocument) => void;
}) {
  const f = useLexFormat();
  const { locale } = useLocaleOrDefault();
  const confidentialityLabel =
    labels.enums.confidentiality[document.confidentiality] ??
    unknownDocumentEnum('confidentiality', document.confidentiality, locale);

  return (
    <button
      type="button"
      onClick={() => onSelect(document)}
      className={cn(
        'flex w-full flex-col gap-2.5 p-3 text-start',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-xl',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <DocumentThumb confidentiality={document.confidentiality} className="mt-0.5" />
        <span className="line-clamp-2 min-w-0 text-sm font-medium leading-snug text-foreground">
          {document.title}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <DocumentConfidentialityChip
          confidentiality={document.confidentiality}
          label={confidentialityLabel}
        />
        {document.status ? (
          <LexStatusChip
            value={document.status}
            domain="generic"
            labels={labels.enums.statuses}
            size="sm"
          />
        ) : null}
      </div>

      <time
        dateTime={document.updated_at}
        title={f.formatDual(document.updated_at)}
        className="text-xs tabular-nums text-muted-foreground"
      >
        {f.formatDate(document.updated_at)}
      </time>
    </button>
  );
}

function unknownDocumentEnum(kind: 'status' | 'confidentiality', value: string, locale: string): string {
  if (locale !== 'ar') return value.replace(/_/g, ' ');
  return kind === 'status' ? 'حالة غير معروفة' : 'سرية غير معروفة';
}
