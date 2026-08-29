/**
 * FEATURE 6 — Investigation lifecycle kanban board (list page).
 *
 * A drag-to-advance kanban over the investigation status FSM. Columns are the
 * lifecycle statuses in pipeline order; cards summarise each investigation and
 * link to the detail page. Dragging a card onto another column attempts the
 * corresponding status transition — but ONLY the non-approval-gated,
 * non-destructive transitions are drag-eligible. Approval routing (results →
 * pending_approval → approved) and the destructive → cancelled transition are
 * click-only on the detail page and are rejected locally with a toast here.
 *
 * Self-contained bilingual labels (EN + professional MSA) per the lex contract.
 * Drag mechanics are delegated to the shared {@link BoardView} primitive
 * (dnd-kit), mirroring the settlements board. KSA-aware: dates/numbers route
 * through `useLexFormat` so Arabic mode renders Hijri + Arabic-Indic digits.
 */

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Bot, Building2, Hash, Link2, UsersRound } from 'lucide-react';
import { BoardView, type BoardColumn } from '@/components/shared/board-view';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { AppLocale } from '@/lib/i18n';
import { showWarning } from '@/lib/toast';
import { LexPriorityChip } from '@/components/lex/status-chip';
import {
  INVESTIGATION_STATUS_TRANSITIONS,
  type Investigation,
  type InvestigationStatus,
} from '@/lib/lex/investigations';
import {
  formatInvestigationToken,
  type InvestigationLabels,
  useInvestigationLabels,
} from './labels';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

// ---------------------------------------------------------------------------
// FSM presentation: column order + drag-eligibility
// ---------------------------------------------------------------------------

/**
 * Pipeline order of the investigation lifecycle. The happy path runs
 * left-to-right (registered → in progress → results → pending → approved →
 * closed); `rejected` and `cancelled` are exception/terminal lanes kept at the
 * end so the forward flow reads logically (RTL flips it).
 */
const BOARD_COLUMN_ORDER: InvestigationStatus[] = [
  'registered',
  'in_progress',
  'results_recorded',
  'pending_approval',
  'approved',
  'closed',
  'rejected',
  'cancelled',
];

/**
 * Transitions a user may perform by dragging a card. This is a STRICT SUBSET of
 * the backend FSM (`INVESTIGATION_STATUS_TRANSITIONS`): it excludes
 *   - approval routing (`results_recorded → pending_approval → approved`, which
 *     flows through the approval-chain endpoints, not the status endpoint),
 *   - the `approved → closed` close (a deliberate, often-permissioned act), and
 *   - every `* → cancelled` destructive transition,
 * because those carry confirmation / workflow semantics a drag gesture must not
 * silently trigger. The remaining drag-eligible moves are simple forward/return
 * status transitions the integrator maps onto the status endpoint:
 *   - `registered → in_progress`       (begin fact gathering)
 *   - `results_recorded → in_progress` (re-open to revise findings)
 *   - `rejected → in_progress`         (re-open after a rejection)
 */
const DRAG_ELIGIBLE_TRANSITIONS: Record<InvestigationStatus, InvestigationStatus[]> = {
  registered: ['in_progress'],
  in_progress: [],
  results_recorded: ['in_progress'],
  pending_approval: [],
  approved: [],
  rejected: ['in_progress'],
  closed: [],
  cancelled: [],
};

/** Whether `from → to` is a transition a drag gesture is permitted to perform. */
function isDragEligible(from: InvestigationStatus, to: InvestigationStatus): boolean {
  return DRAG_ELIGIBLE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Whether `from → to` is a valid FSM transition at all (backend-authoritative mirror). */
function isFsmTransition(from: InvestigationStatus, to: InvestigationStatus): boolean {
  return INVESTIGATION_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Tonal accent class for the thin bar atop each board column. */
function investigationStatusAccent(status: InvestigationStatus): string {
  switch (status) {
    case 'approved':
    case 'closed':
      return 'bg-success-300/70';
    case 'rejected':
    case 'cancelled':
      return 'bg-destructive/60';
    case 'pending_approval':
      return 'bg-warning-300/70';
    case 'registered':
      return 'bg-neutral-400/70';
    default:
      return 'bg-sky-400/70';
  }
}

// ---------------------------------------------------------------------------
// Feature-local bilingual labels
// ---------------------------------------------------------------------------

interface InvestigationBoardLabels {
  emptyColumn: string;
  noDepartment: string;
  parties: (n: string) => string;
  /** Rejected because the gesture can't perform an approval-gated/destructive move. */
  blockedApproval: (status: string) => string;
  /** Rejected because the FSM has no such transition at all. */
  blockedInvalid: (from: string, to: string) => string;
  blockedTitle: string;
}

const boardLabels: LexBilingual<InvestigationBoardLabels> = {
  en: {
    emptyColumn: 'No investigations',
    noDepartment: 'No department',
    parties: (n) => `${n} parties`,
    blockedApproval: (status) =>
      `Moving to "${status}" needs an approval decision — use the investigation’s actions instead of dragging.`,
    blockedInvalid: (from, to) => `Can’t move an investigation from "${from}" to "${to}".`,
    blockedTitle: 'Move not allowed',
  },
  ar: {
    emptyColumn: 'لا توجد تحقيقات',
    noDepartment: 'بلا إدارة',
    parties: (n) => `${n} أطراف`,
    blockedApproval: (status) =>
      `النقل إلى "${status}" يتطلّب قرار اعتماد — استخدم إجراءات التحقيق بدلًا من السحب.`,
    blockedInvalid: (from, to) => `لا يمكن نقل التحقيق من "${from}" إلى "${to}".`,
    blockedTitle: 'النقل غير مسموح',
  },
};

function resolveInvestigationBoardLabels(locale: AppLocale = 'en'): InvestigationBoardLabels {
  return resolveLexBilingual(boardLabels, locale);
}

function useInvestigationBoardLabels(): InvestigationBoardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveInvestigationBoardLabels(locale), [locale]);
}

function statusLabelFor(labels: InvestigationLabels, status: InvestigationStatus): string {
  return labels.filters.statusOptions[status] ?? formatInvestigationToken(status);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface InvestigationBoardProps {
  investigations: Investigation[];
  /** Gates whether drag-to-advance is wired up at all. */
  canWrite: boolean;
  dir: string;
  /**
   * Invoked with an investigation and a drag-eligible target status. The list
   * integrator maps each eligible transition onto the status endpoint. When
   * omitted, the board is read-only.
   */
  onAdvance?: (investigation: Investigation, toStatus: InvestigationStatus) => void;
  isMoving?: boolean;
}

export function InvestigationBoard({
  investigations,
  canWrite,
  dir,
  onAdvance,
  isMoving,
}: InvestigationBoardProps) {
  const labels = useInvestigationLabels();
  const boardL = useInvestigationBoardLabels();
  const direction: 'ltr' | 'rtl' = dir === 'rtl' ? 'rtl' : 'ltr';

  const columns: BoardColumn[] = useMemo(
    () =>
      BOARD_COLUMN_ORDER.map((status) => ({
        id: status,
        label: statusLabelFor(labels, status),
        colorClass: investigationStatusAccent(status),
      })),
    [labels],
  );

  // Index by id so the drop handler can resolve the dragged investigation and
  // its source status without re-scanning on every render.
  const byId = useMemo(() => {
    const map = new Map<string, Investigation>();
    for (const investigation of investigations) {
      map.set(investigation.id, investigation);
    }
    return map;
  }, [investigations]);

  const interactive = canWrite && Boolean(onAdvance);

  // BoardView only knows column identities; FSM gating lives here. We validate
  // the drop against the drag-eligible subset and reject anything else with a
  // toast BEFORE calling onAdvance.
  const handleMove = (investigationId: string, toColumnId: string) => {
    if (!onAdvance) {
      return;
    }
    const investigation = byId.get(investigationId);
    if (!investigation) {
      return;
    }
    const from = investigation.status;
    const to = toColumnId as InvestigationStatus;

    if (isDragEligible(from, to)) {
      onAdvance(investigation, to);
      return;
    }

    // Distinguish "valid FSM move but not drag-safe" (approval-gated /
    // destructive) from "not a valid move at all" for a clearer message.
    if (isFsmTransition(from, to)) {
      showWarning(boardL.blockedTitle, boardL.blockedApproval(statusLabelFor(labels, to)));
      return;
    }
    showWarning(
      boardL.blockedTitle,
      boardL.blockedInvalid(statusLabelFor(labels, from), statusLabelFor(labels, to)),
    );
  };

  return (
    <BoardView<Investigation>
      columns={columns}
      items={investigations}
      getItemId={(investigation) => investigation.id}
      getItemColumnId={(investigation) => investigation.status}
      onMove={interactive ? handleMove : undefined}
      isMoving={isMoving}
      dir={direction}
      emptyColumnLabel={boardL.emptyColumn}
      renderCard={(investigation) => (
        <InvestigationBoardCard investigation={investigation} labels={labels} boardL={boardL} />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function InvestigationBoardCard({
  investigation,
  labels,
  boardL,
}: {
  investigation: Investigation;
  labels: InvestigationLabels;
  boardL: InvestigationBoardLabels;
}) {
  const f = useLexFormat();
  const partyCount = Array.isArray(investigation.parties) ? investigation.parties.length : null;

  return (
    <div className="space-y-2.5 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/lex/investigations/${investigation.id}`}
          className="min-w-0 text-sm font-medium leading-snug hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="line-clamp-2">{investigation.subject}</span>
        </Link>
        <LexPriorityChip
          value={investigation.priority}
          labels={labels.filters.priorityOptions}
          size="sm"
          className="shrink-0"
        />
      </div>

      <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
        <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{investigation.investigation_number}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1">
          <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{investigation.department || boardL.noDepartment}</span>
        </span>
        {partyCount !== null && partyCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <UsersRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="tabular-nums">{boardL.parties(f.formatNumber(partyCount))}</span>
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {investigation.case_id ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card/60 px-2 py-0.5 text-[11px] text-muted-foreground">
            <Link2 className="h-3 w-3" aria-hidden />
            {labels.detail.metadata.linkedCase}
          </span>
        ) : null}
        {investigation.ai_drafted ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card/60 px-2 py-0.5 text-[11px] text-muted-foreground">
            <Bot className="h-3 w-3" aria-hidden />
            {labels.detail.aiBadge}
          </span>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground" dir="auto">
        {f.formatRelative(investigation.updated_at)}
      </p>
    </div>
  );
}
