/**
 * M19 — Regulation library governance board (list page).
 *
 * A read-only kanban over the regulation-library governance lifecycle. Columns
 * are the Watheeq governance states (pending review → in review → approved →
 * rejected); records carry a lifecycle status (draft / active / superseded /
 * deprecated / archived) too, so each card also surfaces a lifecycle chip. When
 * a regulation's governance status is unknown it falls into a lifecycle-keyed
 * fallback lane so nothing silently disappears.
 *
 * Cards summarise each regulation — bilingual title, governance badge, lifecycle
 * chip, and the KSA-formatted updated date — and reuse the page's edit handler
 * via {@link onSelect} (when the caller can write).
 *
 * Drag mechanics are delegated to the shared {@link BoardView} primitive
 * (dnd-kit). There is no drag-to-advance here: governance decisions route
 * through the governance dialogs on the table, so the board stays read-only and
 * mirrors the documents / settlements / cases board surfaces.
 *
 * Bilingual + RTL safe. Governance / lifecycle labels are resolved from the
 * regulation label bundle passed in; the only board-local copy (empty column,
 * the lifecycle-fallback lane heading) lives in a small self-contained EN/MSA
 * bundle per the lex i18n contract.
 */

'use client';

import { useMemo } from 'react';
import { BoardView, type BoardColumn } from '@/components/shared/board-view';
import { LexStatusChip } from '@/components/lex/status-chip';
import { useLexFormat } from '@/lib/lex/ksa';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { LexRegulation } from '@/types/suites';
import {
  GovernanceStatusBadge,
  normalizeGovernanceStatus,
} from '../../_components/governance-badge';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import type { RegulationLabels } from './regulation-content-labels';

type GovernanceAwareRegulation = LexRegulation & { governance_status?: string | null };

// ---------------------------------------------------------------------------
// Column model: governance lanes (+ a lifecycle fallback lane)
// ---------------------------------------------------------------------------

/** Governance states keyed exactly as the page's governance filter / KPI strip. */
type GovernanceStatus = 'pending_review' | 'in_review' | 'approved' | 'rejected';

/** Governance review order (mirrors the governance filter order). */
const GOVERNANCE_COLUMN_ORDER: GovernanceStatus[] = [
  'pending_review',
  'in_review',
  'approved',
  'rejected',
];

/**
 * Thin accent bar per governance lane. Tones follow the page's RAG vocabulary:
 * pending = queued (sky), in_review = in-flight (amber), approved = cleared
 * (emerald), rejected = blocked (rose).
 */
const GOVERNANCE_ACCENT: Record<GovernanceStatus, string> = {
  pending_review: 'bg-sky-400/70',
  in_review: 'bg-warning-500/70',
  approved: 'bg-success-500/70',
  rejected: 'bg-rose-500/70',
};

/** Lifecycle fallback lanes (used only when governance status is unknown). */
type LifecycleStatus = 'draft' | 'active' | 'superseded' | 'deprecated' | 'archived';

const LIFECYCLE_COLUMN_ORDER: LifecycleStatus[] = [
  'draft',
  'active',
  'superseded',
  'deprecated',
  'archived',
];

const LIFECYCLE_ACCENT: Record<LifecycleStatus, string> = {
  draft: 'bg-muted-foreground/40',
  active: 'bg-success-500/70',
  superseded: 'bg-neutral-400/60',
  deprecated: 'bg-warning-500/60',
  archived: 'bg-neutral-400/60',
};

/** Prefix marking a lifecycle-derived (fallback) column id, kept distinct from
 * governance ids so the two key spaces never collide. */
const LIFECYCLE_COLUMN_PREFIX = 'lifecycle:';

function isGovernanceStatus(value: string): value is GovernanceStatus {
  return (GOVERNANCE_COLUMN_ORDER as string[]).includes(value);
}

function isLifecycleStatus(value: string): value is LifecycleStatus {
  return (LIFECYCLE_COLUMN_ORDER as string[]).includes(value);
}

/** Resolve a regulation's governance status the same way the page does. */
function getGovernanceStatus(regulation: GovernanceAwareRegulation): string {
  const metadataStatus = regulation.metadata?.governance_status;
  return (
    regulation.governance_status ??
    (typeof metadataStatus === 'string' ? metadataStatus : 'pending_review')
  );
}

/** Localized governance label from the regulation bundle, with safe fallback. */
function governanceLabel(normalized: string, labels: RegulationLabels): string {
  const options = labels.filters.governanceOptions as Record<string, string>;
  return options[normalized] ?? labels.filters.statusOptions.active ?? normalized;
}

/** Localized lifecycle label from the regulation bundle, with safe fallback. */
function lifecycleLabel(status: string, labels: RegulationLabels): string {
  const options = labels.filters.statusOptions as Record<string, string>;
  return options[status.toLowerCase()] ?? status.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Feature-local bilingual labels (board-only copy)
// ---------------------------------------------------------------------------

interface RegulationsBoardLabels {
  emptyColumn: string;
  /** Heading for a lifecycle-fallback lane, e.g. "Draft · no governance". */
  lifecycleLane: (lifecycle: string) => string;
}

const boardLabels: LexBilingual<RegulationsBoardLabels> = {
  en: {
    emptyColumn: 'No regulations',
    lifecycleLane: (lifecycle) => `${lifecycle} · no governance`,
  },
  ar: {
    emptyColumn: 'لا توجد لوائح',
    lifecycleLane: (lifecycle) => `${lifecycle} · بلا حوكمة`,
  },
};

function useRegulationsBoardLabels(): RegulationsBoardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveLexBilingual(boardLabels, locale as AppLocale),
    [locale],
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RegulationsBoardProps {
  regulations: GovernanceAwareRegulation[];
  /** Resolved regulation label bundle (governance + lifecycle enums). */
  labels: RegulationLabels;
  dir: 'ltr' | 'rtl';
  /** Opens the edit dialog — same handler the table row actions use. Optional:
   * when the caller cannot write, cards stay read-only (no click target). */
  onSelect?: (regulation: GovernanceAwareRegulation) => void;
}

export function RegulationsBoard({ regulations, labels, dir, onSelect }: RegulationsBoardProps) {
  const boardL = useRegulationsBoardLabels();

  // The board groups by governance status. Records whose governance status is
  // unrecognised drop into a lifecycle-keyed fallback lane so nothing vanishes.
  const columnIdFor = (regulation: GovernanceAwareRegulation): string => {
    const normalized = normalizeGovernanceStatus(getGovernanceStatus(regulation));
    if (isGovernanceStatus(normalized)) {
      return normalized;
    }
    // 'active' (normalizeGovernanceStatus maps an active lifecycle there) and any
    // other unknown governance value fall back to the record's lifecycle lane.
    const lifecycle = String(regulation.status ?? 'draft').toLowerCase();
    const lane = isLifecycleStatus(lifecycle) ? lifecycle : 'draft';
    return `${LIFECYCLE_COLUMN_PREFIX}${lane}`;
  };

  // Only surface fallback lifecycle lanes that actually receive a record, so the
  // board never trails empty/irrelevant lanes.
  const usedLifecycleLanes = useMemo(() => {
    const set = new Set<LifecycleStatus>();
    for (const regulation of regulations) {
      const normalized = normalizeGovernanceStatus(getGovernanceStatus(regulation));
      if (!isGovernanceStatus(normalized)) {
        const lifecycle = String(regulation.status ?? 'draft').toLowerCase();
        set.add(isLifecycleStatus(lifecycle) ? lifecycle : 'draft');
      }
    }
    return LIFECYCLE_COLUMN_ORDER.filter((value) => set.has(value));
  }, [regulations]);

  const columns: BoardColumn[] = useMemo(() => {
    const governanceColumns: BoardColumn[] = GOVERNANCE_COLUMN_ORDER.map((status) => ({
      id: status,
      label: governanceLabel(status, labels),
      colorClass: GOVERNANCE_ACCENT[status],
    }));
    const lifecycleColumns: BoardColumn[] = usedLifecycleLanes.map((lifecycle) => ({
      id: `${LIFECYCLE_COLUMN_PREFIX}${lifecycle}`,
      label: boardL.lifecycleLane(lifecycleLabel(lifecycle, labels)),
      colorClass: LIFECYCLE_ACCENT[lifecycle],
    }));
    return [...governanceColumns, ...lifecycleColumns];
  }, [labels, usedLifecycleLanes, boardL]);

  return (
    <BoardView<GovernanceAwareRegulation>
      columns={columns}
      items={regulations}
      getItemId={(regulation) => regulation.id}
      getItemColumnId={columnIdFor}
      dir={dir}
      emptyColumnLabel={boardL.emptyColumn}
      renderCard={(regulation) => (
        <RegulationBoardCard regulation={regulation} labels={labels} onSelect={onSelect} />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function RegulationBoardCard({
  regulation,
  labels,
  onSelect,
}: {
  regulation: GovernanceAwareRegulation;
  labels: RegulationLabels;
  onSelect?: (regulation: GovernanceAwareRegulation) => void;
}) {
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const isArabic = locale === 'ar';
  const governanceStatus = getGovernanceStatus(regulation);
  const normalizedGovernance = normalizeGovernanceStatus(governanceStatus);
  const lifecycle = String(regulation.status ?? '').toLowerCase();

  // Prefer the active-locale title, falling back to the other language so a card
  // is never blank when one title is missing.
  const primaryTitle = isArabic
    ? regulation.title_ar || regulation.title_en
    : regulation.title_en || regulation.title_ar;
  const secondaryTitle = isArabic
    ? regulation.title_en
    : regulation.title_ar;

  const body = (
    <div className="flex w-full flex-col gap-2.5 p-3 text-start">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 min-w-0 text-sm font-medium leading-snug text-foreground">
          {primaryTitle}
        </span>
        {secondaryTitle && secondaryTitle !== primaryTitle ? (
          <span
            className="line-clamp-1 text-xs text-muted-foreground"
            dir={isArabic ? 'ltr' : 'rtl'}
          >
            {secondaryTitle}
          </span>
        ) : null}
        {regulation.code ? (
          <span className="text-xs tabular-nums text-muted-foreground">{regulation.code}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <GovernanceStatusBadge
          status={governanceStatus}
          label={governanceLabel(normalizedGovernance, labels)}
        />
        {lifecycle ? (
          <LexStatusChip
            value={lifecycle}
            domain="generic"
            labels={labels.filters.statusOptions as Record<string, string>}
            size="sm"
          />
        ) : null}
      </div>

      <time
        dateTime={regulation.updated_at}
        title={f.formatDual(regulation.updated_at)}
        className="text-xs tabular-nums text-muted-foreground"
      >
        {f.formatDate(regulation.updated_at)}
      </time>
    </div>
  );

  if (!onSelect) {
    return body;
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(regulation)}
      className={cn(
        'w-full text-start',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-xl',
      )}
    >
      {body}
    </button>
  );
}
