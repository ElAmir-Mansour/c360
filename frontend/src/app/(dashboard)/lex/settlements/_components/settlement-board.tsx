/**
 * FEATURE 2 — Settlement pipeline kanban board (list page).
 *
 * A drag-to-advance kanban over the settlement FSM. Columns are the lifecycle
 * statuses in pipeline order; cards summarise each settlement and link to the
 * detail page. Dragging a card onto another column attempts the corresponding
 * FSM transition — but ONLY the non-approval-gated, non-destructive transitions
 * are drag-eligible. Approval-gated transitions (→ approved / → executed) and
 * the destructive → abandoned transition are click-only on the detail page and
 * are rendered as non-droppable here. Any disallowed drop is rejected locally
 * with a toast before `onAdvance` is ever called.
 *
 * Self-contained bilingual labels (EN + professional MSA) per the lex contract.
 * Drag mechanics are delegated to the shared {@link BoardView} primitive
 * (dnd-kit), mirroring the matters board.
 */

'use client';

import { useMemo } from 'react';
import { Building2, Hash } from 'lucide-react';
import Link from 'next/link';
import { BoardView, type BoardColumn } from '@/components/shared/board-view';
import { RelativeTime } from '@/components/shared/relative-time';
import { Badge } from '@/components/ui/badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { showWarning } from '@/lib/toast';
import {
  formatSettlementValue,
  SETTLEMENT_STATUS_TRANSITIONS,
  settlementStatusAccent,
  type Settlement,
  type SettlementStatus,
} from '@/lib/lex/settlements';
import {
  settlementMethodLabel,
  settlementStatusLabel,
  useSettlementLabels,
} from '../_components/labels';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

// ---------------------------------------------------------------------------
// FSM presentation: column order + drag-eligibility
// ---------------------------------------------------------------------------

/**
 * Pipeline order of the settlement lifecycle. The first five are the happy-path
 * progression; `rejected` and `abandoned` are exception/terminal lanes kept at
 * the end so the forward flow reads left-to-right (logical order; RTL flips it).
 */
const BOARD_COLUMN_ORDER: SettlementStatus[] = [
  'proposed',
  'negotiating',
  'pending_approval',
  'approved',
  'executed',
  'rejected',
  'abandoned',
];

/**
 * Transitions a user may perform by dragging a card. This is a STRICT SUBSET of
 * the backend FSM (`SETTLEMENT_STATUS_TRANSITIONS`): it excludes
 *   - approval-gated transitions (`pending_approval → approved | rejected`,
 *     which require a workflow decision task), and
 *   - the execute transition (`approved → executed`, performed via close), and
 *   - the destructive `* → abandoned` transition,
 * because those carry confirmation / workflow semantics that a drag gesture must
 * not silently trigger. The remaining drag-eligible transitions are simple
 * forward/return moves the list integrator maps onto API calls:
 *   - `proposed → negotiating`        (record-terms / stay open; integrator no-ops if N/A)
 *   - `proposed → pending_approval`   (→ submitForApproval)
 *   - `negotiating → pending_approval`(→ submitForApproval)
 *   - `rejected → negotiating`        (re-open negotiation after a rejection)
 */
const DRAG_ELIGIBLE_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  proposed: ['negotiating', 'pending_approval'],
  negotiating: ['pending_approval'],
  pending_approval: [],
  approved: [],
  executed: [],
  rejected: ['negotiating'],
  abandoned: [],
};

/** Whether `from → to` is a transition a drag gesture is permitted to perform. */
function isDragEligible(from: SettlementStatus, to: SettlementStatus): boolean {
  return DRAG_ELIGIBLE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Whether `from → to` is a valid FSM transition at all (backend-authoritative mirror). */
function isFsmTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return SETTLEMENT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Feature-local bilingual labels
// ---------------------------------------------------------------------------

interface SettlementBoardLabels {
  emptyColumn: string;
  noReference: string;
  noCounterparty: string;
  /** Rejected because the gesture can't perform an approval-gated/destructive move. */
  blockedApproval: (status: string) => string;
  /** Rejected because the FSM has no such transition at all. */
  blockedInvalid: (from: string, to: string) => string;
  blockedTitle: string;
}

const boardLabels: LexBilingual<SettlementBoardLabels> = {
  en: {
    emptyColumn: 'No settlements',
    noReference: 'No reference',
    noCounterparty: 'No counterparty',
    blockedApproval: (status) =>
      `Moving to "${status}" needs an approval decision — use the settlement’s actions instead of dragging.`,
    blockedInvalid: (from, to) => `Can’t move a settlement from "${from}" to "${to}".`,
    blockedTitle: 'Move not allowed',
  },
  ar: {
    emptyColumn: 'لا توجد تسويات',
    noReference: 'بلا مرجع',
    noCounterparty: 'بلا طرف مقابل',
    blockedApproval: (status) =>
      `النقل إلى "${status}" يتطلّب قرار اعتماد — استخدم إجراءات التسوية بدلًا من السحب.`,
    blockedInvalid: (from, to) => `لا يمكن نقل التسوية من "${from}" إلى "${to}".`,
    blockedTitle: 'النقل غير مسموح',
  },
};

function resolveSettlementBoardLabels(locale: AppLocale = 'en'): SettlementBoardLabels {
  return resolveLexBilingual(boardLabels, locale);
}

function useSettlementBoardLabels(): SettlementBoardLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSettlementBoardLabels(locale), [locale]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SettlementBoardProps {
  settlements: Settlement[];
  /** Gates whether drag-to-advance is wired up at all. */
  canWrite: boolean;
  dir: string;
  /**
   * Invoked with a settlement and a drag-eligible target status. The list
   * integrator maps `proposed → pending_approval` and `negotiating →
   * pending_approval` onto `submitForApproval`; other eligible transitions
   * (e.g. `proposed → negotiating`, `rejected → negotiating`) it may map onto
   * record/no-op as appropriate. When omitted, the board is read-only.
   */
  onAdvance?: (settlement: Settlement, toStatus: SettlementStatus) => void;
  isMoving?: boolean;
}

export function SettlementBoard({
  settlements,
  canWrite,
  dir,
  onAdvance,
  isMoving,
}: SettlementBoardProps) {
  const labels = useSettlementLabels();
  const boardL = useSettlementBoardLabels();
  const direction: 'ltr' | 'rtl' = dir === 'rtl' ? 'rtl' : 'ltr';

  const columns: BoardColumn[] = useMemo(
    () =>
      BOARD_COLUMN_ORDER.map((status) => ({
        id: status,
        label: settlementStatusLabel(labels, status),
        colorClass: settlementStatusAccent(status),
      })),
    [labels],
  );

  // Index by id so the drop handler can resolve the dragged settlement and its
  // source status without re-scanning on every render.
  const byId = useMemo(() => {
    const map = new Map<string, Settlement>();
    for (const settlement of settlements) {
      map.set(settlement.id, settlement);
    }
    return map;
  }, [settlements]);

  const interactive = canWrite && Boolean(onAdvance);

  // BoardView only knows column identities; FSM gating lives here. We validate
  // the drop against the drag-eligible subset and reject anything else with a
  // toast BEFORE calling onAdvance.
  const handleMove = (settlementId: string, toColumnId: string) => {
    if (!onAdvance) {
      return;
    }
    const settlement = byId.get(settlementId);
    if (!settlement) {
      return;
    }
    const from = settlement.status;
    const to = toColumnId as SettlementStatus;

    if (isDragEligible(from, to)) {
      onAdvance(settlement, to);
      return;
    }

    // Distinguish "valid FSM move but not drag-safe" (approval-gated /
    // destructive) from "not a valid move at all" for a clearer message.
    if (isFsmTransition(from, to)) {
      showWarning(
        boardL.blockedTitle,
        boardL.blockedApproval(settlementStatusLabel(labels, to)),
      );
      return;
    }
    showWarning(
      boardL.blockedTitle,
      boardL.blockedInvalid(
        settlementStatusLabel(labels, from),
        settlementStatusLabel(labels, to),
      ),
    );
  };

  return (
    <BoardView<Settlement>
      columns={columns}
      items={settlements}
      getItemId={(settlement) => settlement.id}
      getItemColumnId={(settlement) => settlement.status}
      onMove={interactive ? handleMove : undefined}
      isMoving={isMoving}
      dir={direction}
      emptyColumnLabel={boardL.emptyColumn}
      renderCard={(settlement) => (
        <SettlementBoardCard settlement={settlement} boardL={boardL} />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function SettlementBoardCard({
  settlement,
  boardL,
}: {
  settlement: Settlement;
  boardL: SettlementBoardLabels;
}) {
  const labels = useSettlementLabels();
  const value = formatSettlementValue(settlement.value, settlement.currency);
  const hasValue = settlement.value !== null && settlement.value !== undefined;

  return (
    <div className="space-y-2.5 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/lex/settlements/${settlement.id}`}
          className="min-w-0 text-sm font-medium leading-snug hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="line-clamp-2">{settlement.title}</span>
        </Link>
        <Badge variant="outline" className="shrink-0">
          {settlementMethodLabel(labels, settlement.method)}
        </Badge>
      </div>

      <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
        <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{settlement.reference || boardL.noReference}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {hasValue ? (
          <span className="font-medium tabular-nums text-foreground">{value}</span>
        ) : null}
        <span className="inline-flex min-w-0 items-center gap-1">
          <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {settlement.counterparty_name || boardL.noCounterparty}
          </span>
        </span>
      </div>

      <RelativeTime
        date={settlement.updated_at}
        className="text-xs text-muted-foreground"
      />
    </div>
  );
}
