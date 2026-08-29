/**
 * Read-only swimlane / BPMN data models for the two Al Othaim PRD workflows.
 *
 * These are PURE, framework-free descriptions of the two PRD diagrams plus the
 * logic that projects a LIVE legal request (and — for Diagram B — its running
 * approval-chain tasks) onto them. No React, no xyflow: this file is unit-tested
 * on its own (`diagram-models.test.ts`) and consumed by `build-flow.ts` to emit
 * xyflow nodes/edges.
 *
 * Diagram A — Service-Request SLA flow (PRD "Diagram A"): a two-lane
 * Requester / Provider swimlane driven by the legal-request FSM `RequestStatus`.
 * The active stage is derived by REUSING the exact `statusToStepIndex` collapse
 * the compact lifecycle stepper already uses (the two `pending_*_approval`
 * sub-states fold onto a single approval stage), so the graphical swimlane and
 * the linear stepper never disagree.
 *
 * Diagram B — Lawsuit-filing chain (PRD "Diagram B"): a four-lane swimlane
 * (Requester → Department Manager → Executive Manager for the Group → Legal
 * Department Manager) mirroring the LIVE sequential approval policy seeded by
 * `ensureLitigationApprovalPolicy` (roles `legal-dept-manager` → `legal-bu-ceo`
 * → `legal-director`). The active lane is derived from the running
 * `ApprovalTask[]` (assignee_role + status); when no tasks are available yet
 * (no workflow instance, or a soft read error) it falls back to the request
 * status exactly like the approval surfaces do.
 */

import type { LegalRequest, RequestStatus, ApprovalTask } from '@/lib/lex/requests';

/** i18n key for a lane title (resolved by `use-swimlane-labels`). */
export type LaneLabelKey =
  | 'requester'
  | 'provider'
  | 'deptManager'
  | 'execManager'
  | 'legalManager';

/** i18n key for a stage caption (resolved by `use-swimlane-labels`). */
export type StageLabelKey =
  // Diagram A stages
  | 'draft'
  | 'submitted'
  | 'providerApproval'
  | 'approved'
  | 'routed'
  | 'inExecution'
  | 'delivered'
  | 'closed'
  // Diagram B stages
  | 'fileRequest'
  | 'deptReview'
  | 'execReview'
  | 'legalReview'
  | 'filed';

/** A horizontal band owned by one actor/role. */
export interface SwimlaneLane {
  readonly id: string;
  readonly labelKey: LaneLabelKey;
  /** 14-role-matrix slug this lane maps to (Diagram B). Undefined for the
   * FSM-driven Diagram A lanes, which are not role-scoped. */
  readonly roleKey?: string;
}

/** A single step box that sits inside one lane. */
export interface SwimlaneStage {
  readonly id: string;
  readonly laneId: string;
  readonly labelKey: StageLabelKey;
  /** FSM statuses that light this stage as CURRENT (Diagram A). Diagram B
   * approval-tier stages are driven by approval tasks and carry no tokens. */
  readonly statusTokens: readonly RequestStatus[];
}

/** A directed connector between two stages (happy-path order). */
export interface SwimlaneEdge {
  readonly from: string;
  readonly to: string;
}

/** A complete PRD diagram description. */
export interface SwimlaneModel {
  readonly id: 'A' | 'B';
  readonly lanes: readonly SwimlaneLane[];
  readonly stages: readonly SwimlaneStage[];
  readonly edges: readonly SwimlaneEdge[];
}

/** Per-stage projection state used by the renderer. */
export type StageState = 'done' | 'current' | 'future' | 'offpath';

/** The resolved projection of a live request onto a diagram. */
export interface ActiveProjection {
  /** stage id → state */
  readonly stageStates: ReadonlyMap<string, StageState>;
  /** The single current stage id (null when off-path / terminal). */
  readonly currentStageId: string | null;
  /** True when the request left the happy path (returned / cancelled). */
  readonly offPath: boolean;
  /** Terminal token when off-path, else null. */
  readonly terminal: 'returned' | 'cancelled' | null;
}

/* ------------------------------------------------------------------------- *
 * Shared FSM → happy-path index mapping.
 *
 * This is the SAME collapse used by `request-lifecycle-stepper`
 * (`statusToStepIndex`): the two approval sub-states fold onto index 2 and the
 * off-path terminals return -1. Replicated here (rather than imported) to keep
 * this pure model layer free of the client `'use client'` stepper module, but
 * the ordering is identical so the swimlane never disagrees with the stepper.
 * ------------------------------------------------------------------------- */

const HAPPY_PATH_INDEX: Readonly<Record<RequestStatus, number>> = {
  draft: 0,
  submitted: 1,
  pending_requester_approval: 2,
  pending_provider_approval: 2,
  approved: 3,
  routed: 4,
  in_execution: 5,
  delivered: 6,
  closed: 7,
  returned: -1,
  cancelled: -1,
};

/** Happy-path index of a status (approval sub-states collapse; terminals = -1). */
export function statusToHappyIndex(status: RequestStatus): number {
  const idx = HAPPY_PATH_INDEX[status];
  return idx === undefined ? -1 : idx;
}

/* ------------------------------------------------------------------------- *
 * Diagram A — Service-Request SLA (Requester / Provider).
 * ------------------------------------------------------------------------- */

const LANE_A_REQUESTER = 'a-requester';
const LANE_A_PROVIDER = 'a-provider';

/**
 * Diagram A stages, in happy-path order. Each stage declares the FSM statuses
 * that make it the current stage; the projector picks the current stage by the
 * request's happy-path index and marks everything before it done, after it
 * future.
 */
export const DIAGRAM_A: SwimlaneModel = {
  id: 'A',
  lanes: [
    { id: LANE_A_REQUESTER, labelKey: 'requester' },
    { id: LANE_A_PROVIDER, labelKey: 'provider' },
  ],
  stages: [
    { id: 'a-draft', laneId: LANE_A_REQUESTER, labelKey: 'draft', statusTokens: ['draft'] },
    { id: 'a-submitted', laneId: LANE_A_REQUESTER, labelKey: 'submitted', statusTokens: ['submitted'] },
    {
      id: 'a-provider-approval',
      laneId: LANE_A_PROVIDER,
      labelKey: 'providerApproval',
      statusTokens: ['pending_requester_approval', 'pending_provider_approval'],
    },
    { id: 'a-approved', laneId: LANE_A_PROVIDER, labelKey: 'approved', statusTokens: ['approved'] },
    { id: 'a-routed', laneId: LANE_A_PROVIDER, labelKey: 'routed', statusTokens: ['routed'] },
    { id: 'a-execution', laneId: LANE_A_PROVIDER, labelKey: 'inExecution', statusTokens: ['in_execution'] },
    { id: 'a-delivered', laneId: LANE_A_PROVIDER, labelKey: 'delivered', statusTokens: ['delivered'] },
    { id: 'a-closed', laneId: LANE_A_REQUESTER, labelKey: 'closed', statusTokens: ['closed'] },
  ],
  edges: [
    { from: 'a-draft', to: 'a-submitted' },
    { from: 'a-submitted', to: 'a-provider-approval' },
    { from: 'a-provider-approval', to: 'a-approved' },
    { from: 'a-approved', to: 'a-routed' },
    { from: 'a-routed', to: 'a-execution' },
    { from: 'a-execution', to: 'a-delivered' },
    { from: 'a-delivered', to: 'a-closed' },
  ],
};

/** Ordered Diagram-A stage ids aligned to the happy-path index (0..7). */
const DIAGRAM_A_ORDER: readonly string[] = [
  'a-draft',
  'a-submitted',
  'a-provider-approval',
  'a-approved',
  'a-routed',
  'a-execution',
  'a-delivered',
  'a-closed',
];

/* ------------------------------------------------------------------------- *
 * Diagram B — Lawsuit-filing chain.
 * ------------------------------------------------------------------------- */

const LANE_B_REQUESTER = 'b-requester';
const LANE_B_DEPT = 'b-dept-manager';
const LANE_B_EXEC = 'b-exec-manager';
const LANE_B_LEGAL = 'b-legal-manager';

/** Litigation approval-chain role slugs, in DoA order (mirrors the seed). */
export const LITIGATION_ROLE_ORDER: readonly string[] = [
  'legal-dept-manager',
  'legal-bu-ceo',
  'legal-director',
];

/** The request_type that selects Diagram B. */
export const DIAGRAM_B_REQUEST_TYPE = 'litigation';

/**
 * Diagram B stages: a requester head, one tier per approval role, and a filed
 * tail. The three approval-tier stages carry no FSM `statusTokens` — they are
 * lit from the live `ApprovalTask[]` by role.
 */
export const DIAGRAM_B: SwimlaneModel = {
  id: 'B',
  lanes: [
    { id: LANE_B_REQUESTER, labelKey: 'requester' },
    { id: LANE_B_DEPT, labelKey: 'deptManager', roleKey: 'legal-dept-manager' },
    { id: LANE_B_EXEC, labelKey: 'execManager', roleKey: 'legal-bu-ceo' },
    { id: LANE_B_LEGAL, labelKey: 'legalManager', roleKey: 'legal-director' },
  ],
  stages: [
    {
      id: 'b-file',
      laneId: LANE_B_REQUESTER,
      labelKey: 'fileRequest',
      statusTokens: ['draft', 'submitted'],
    },
    { id: 'b-dept', laneId: LANE_B_DEPT, labelKey: 'deptReview', statusTokens: [] },
    { id: 'b-exec', laneId: LANE_B_EXEC, labelKey: 'execReview', statusTokens: [] },
    { id: 'b-legal', laneId: LANE_B_LEGAL, labelKey: 'legalReview', statusTokens: [] },
    {
      id: 'b-filed',
      laneId: LANE_B_REQUESTER,
      labelKey: 'filed',
      statusTokens: ['approved', 'routed', 'in_execution', 'delivered', 'closed'],
    },
  ],
  edges: [
    { from: 'b-file', to: 'b-dept' },
    { from: 'b-dept', to: 'b-exec' },
    { from: 'b-exec', to: 'b-legal' },
    { from: 'b-legal', to: 'b-filed' },
  ],
};

/** Diagram-B approval-tier stage id per role slug, in chain order. */
const DIAGRAM_B_ROLE_STAGE: Readonly<Record<string, string>> = {
  'legal-dept-manager': 'b-dept',
  'legal-bu-ceo': 'b-exec',
  'legal-director': 'b-legal',
};

/** Ordered Diagram-B stage ids along the happy path. */
const DIAGRAM_B_ORDER: readonly string[] = ['b-file', 'b-dept', 'b-exec', 'b-legal', 'b-filed'];

/* ------------------------------------------------------------------------- *
 * Diagram selection + projection.
 * ------------------------------------------------------------------------- */

/** Pick the diagram for a request: litigation → B, everything else → A. */
export function selectDiagram(request: Pick<LegalRequest, 'request_type'>): SwimlaneModel {
  return request.request_type === DIAGRAM_B_REQUEST_TYPE ? DIAGRAM_B : DIAGRAM_A;
}

/** True when an approval-task status counts as "still open" (lane is current). */
function isOpenTaskStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'pending' || s === 'in_progress' || s === 'open' || s === 'assigned' || s === 'active';
}

/** True when an approval-task status counts as approved/completed. */
function isDoneTaskStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'completed' || s === 'approved' || s === 'done' || s === 'complete';
}

function allFuture(order: readonly string[]): Map<string, StageState> {
  const m = new Map<string, StageState>();
  for (const id of order) m.set(id, 'future');
  return m;
}

/** Project a request onto Diagram A using the shared happy-path collapse. */
function projectDiagramA(status: RequestStatus): ActiveProjection {
  const idx = statusToHappyIndex(status);
  const offPath = idx === -1;
  const terminal: ActiveProjection['terminal'] =
    status === 'returned' ? 'returned' : status === 'cancelled' ? 'cancelled' : null;

  const stageStates = new Map<string, StageState>();
  if (offPath) {
    // Off-path: every stage is dashed/off-path, no current highlight.
    for (const id of DIAGRAM_A_ORDER) stageStates.set(id, 'offpath');
    return { stageStates, currentStageId: null, offPath: true, terminal };
  }

  let currentStageId: string | null = null;
  DIAGRAM_A_ORDER.forEach((id, i) => {
    if (i < idx) {
      stageStates.set(id, 'done');
    } else if (i === idx) {
      stageStates.set(id, 'current');
      currentStageId = id;
    } else {
      stageStates.set(id, 'future');
    }
  });

  return { stageStates, currentStageId, offPath: false, terminal };
}

/**
 * Project a litigation request onto Diagram B. The requester head + filed tail
 * come from the FSM status; the three approval tiers come from the live tasks.
 * When `tasks` is empty (no workflow instance yet, or a soft read failure) the
 * projection falls back to status alone — the requester head is current while
 * the request is draft/submitted, otherwise the whole chain is treated as done
 * up to whatever the status implies.
 */
function projectDiagramB(status: RequestStatus, tasks: readonly ApprovalTask[]): ActiveProjection {
  const offPath = status === 'returned' || status === 'cancelled';
  const terminal: ActiveProjection['terminal'] =
    status === 'returned' ? 'returned' : status === 'cancelled' ? 'cancelled' : null;

  if (offPath) {
    const stageStates = new Map<string, StageState>();
    for (const id of DIAGRAM_B_ORDER) stageStates.set(id, 'offpath');
    return { stageStates, currentStageId: null, offPath: true, terminal };
  }

  const stageStates = allFuture(DIAGRAM_B_ORDER);
  let currentStageId: string | null = null;

  const filedTail = new Set<RequestStatus>([
    'approved',
    'routed',
    'in_execution',
    'delivered',
    'closed',
  ]);
  const pastFiling = filedTail.has(status);

  // --- Requester head ---
  // Filing is complete once the chain has started (submitted) or we are past it.
  const filingDone = status !== 'draft';
  stageStates.set('b-file', filingDone ? 'done' : 'current');
  if (!filingDone) currentStageId = 'b-file';

  // --- Past the filing gate: the whole approval chain is settled ---
  if (pastFiling) {
    for (const role of LITIGATION_ROLE_ORDER) {
      stageStates.set(DIAGRAM_B_ROLE_STAGE[role], 'done');
    }
    if (status === 'approved') {
      stageStates.set('b-filed', 'current');
      currentStageId = 'b-filed';
    } else {
      // routed / in_execution / delivered / closed: filing itself is done and
      // the request has moved on to the downstream matter — no single current.
      stageStates.set('b-filed', 'done');
      currentStageId = null;
    }
    return { stageStates, currentStageId, offPath: false, terminal };
  }

  // --- Approval tiers from live tasks (role → stage) ---
  // For each tier, find the tasks addressed to that role and grade them.
  let anyTierCurrent = false;
  for (const role of LITIGATION_ROLE_ORDER) {
    const stageId = DIAGRAM_B_ROLE_STAGE[role];
    const roleTasks = tasks.filter((t) => (t.assignee_role ?? '') === role);
    const hasOpen = roleTasks.some((t) => isOpenTaskStatus(t.status));
    const hasDone = roleTasks.some((t) => isDoneTaskStatus(t.status));

    if (hasOpen) {
      stageStates.set(stageId, 'current');
      if (currentStageId === null) currentStageId = stageId;
      anyTierCurrent = true;
    } else if (hasDone) {
      stageStates.set(stageId, 'done');
    }
    // else: leave as future (not yet reached).
  }

  // Submitted but no open/known tier task yet: the first tier is awaiting pickup.
  if (status === 'submitted' && !anyTierCurrent && currentStageId === null) {
    const firstTier = DIAGRAM_B_ROLE_STAGE[LITIGATION_ROLE_ORDER[0]];
    stageStates.set(firstTier, 'current');
    currentStageId = firstTier;
  }

  return { stageStates, currentStageId, offPath: false, terminal };
}

/**
 * Resolve the live projection of a request onto a diagram. Diagram A is derived
 * purely from status; Diagram B additionally consumes the running approval
 * tasks (falling back to status when they are unavailable).
 */
export function resolveActiveStage(
  model: SwimlaneModel,
  request: Pick<LegalRequest, 'status'>,
  tasks: readonly ApprovalTask[] = [],
): ActiveProjection {
  return model.id === 'B'
    ? projectDiagramB(request.status, tasks)
    : projectDiagramA(request.status);
}
