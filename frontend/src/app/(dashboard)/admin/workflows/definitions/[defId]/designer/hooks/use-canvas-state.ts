'use client';

import { useCallback, useMemo, useReducer, useRef, useEffect } from 'react';
import dagre from 'dagre';
import { formatStepTypeLabel } from '../../../definition-i18n';
import type { WorkflowStep, WorkflowTransition, WorkflowStepType, WorkflowStepConfig, AssigneeStrategy } from '@/types/models';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 84;

// ── State ──

interface CanvasState {
  steps: WorkflowStep[];
  selectedStepId: string | null;
  selectedTransitionId: string | null;
  pan: { x: number; y: number };
  zoom: number;
  connecting: { fromStepId: string; mouseX: number; mouseY: number } | null;
}

// ── Actions ──

type CanvasAction =
  | { type: 'SET_STEPS'; steps: WorkflowStep[] }
  | { type: 'ADD_STEP'; step: WorkflowStep }
  | { type: 'UPDATE_STEP'; stepId: string; updates: Partial<WorkflowStep> }
  | { type: 'REMOVE_STEP'; stepId: string }
  | { type: 'MOVE_STEP'; stepId: string; position: { x: number; y: number } }
  | { type: 'ADD_TRANSITION'; fromStepId: string; transition: WorkflowTransition }
  | { type: 'REMOVE_TRANSITION'; stepId: string; transitionId: string }
  | { type: 'SELECT_STEP'; stepId: string | null }
  | { type: 'SELECT_TRANSITION'; transitionId: string | null }
  | { type: 'SET_PAN'; pan: { x: number; y: number } }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'SET_CONNECTING'; connecting: CanvasState['connecting'] }
  | { type: 'UNDO' }
  | { type: 'REDO' };

function samePoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return a.x === b.x && a.y === b.y;
}

function sameConnecting(
  a: CanvasState['connecting'],
  b: CanvasState['connecting'],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.fromStepId === b.fromStepId &&
    a.mouseX === b.mouseX &&
    a.mouseY === b.mouseY
  );
}

function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'SET_STEPS':
      if (state.steps === action.steps) return state;
      return { ...state, steps: action.steps };
    case 'ADD_STEP':
      return { ...state, steps: [...state.steps, action.step] };
    case 'UPDATE_STEP':
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.id === action.stepId ? { ...s, ...action.updates } : s,
        ),
      };
    case 'REMOVE_STEP': {
      const filtered = state.steps
        .filter((s) => s.id !== action.stepId)
        .map((s) => ({
          ...s,
          transitions: transitionsFor(s).filter(
            (t) => t.target_step_id !== action.stepId,
          ),
        }));
      return {
        ...state,
        steps: filtered,
        selectedStepId:
          state.selectedStepId === action.stepId ? null : state.selectedStepId,
      };
    }
    case 'MOVE_STEP': {
      const step = state.steps.find((s) => s.id === action.stepId);
      if (!step || samePoint(step.position, action.position)) return state;
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.id === action.stepId ? { ...s, position: action.position } : s,
        ),
      };
    }
    case 'ADD_TRANSITION':
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.id === action.fromStepId
            ? { ...s, transitions: [...transitionsFor(s), action.transition] }
            : s,
        ),
      };
    case 'REMOVE_TRANSITION':
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.id === action.stepId
            ? {
                ...s,
                transitions: transitionsFor(s).filter(
                  (t) => t.id !== action.transitionId,
                ),
              }
            : s,
        ),
      };
    case 'SELECT_STEP':
      if (
        state.selectedStepId === action.stepId &&
        state.selectedTransitionId === null
      ) {
        return state;
      }
      return {
        ...state,
        selectedStepId: action.stepId,
        selectedTransitionId: null,
      };
    case 'SELECT_TRANSITION':
      if (
        state.selectedTransitionId === action.transitionId &&
        state.selectedStepId === null
      ) {
        return state;
      }
      return {
        ...state,
        selectedTransitionId: action.transitionId,
        selectedStepId: null,
      };
    case 'SET_PAN':
      if (samePoint(state.pan, action.pan)) return state;
      return { ...state, pan: action.pan };
    case 'SET_ZOOM': {
      const zoom = Math.max(0.25, Math.min(2, action.zoom));
      if (state.zoom === zoom) return state;
      return { ...state, zoom };
    }
    case 'SET_CONNECTING':
      if (sameConnecting(state.connecting, action.connecting)) return state;
      return { ...state, connecting: action.connecting };
    default:
      return state;
  }
}

// ── Undo/Redo wrapper ──

interface UndoableState {
  current: CanvasState;
  past: CanvasState[];
  future: CanvasState[];
}

const STEP_MODIFYING_ACTIONS = new Set([
  'ADD_STEP',
  'UPDATE_STEP',
  'REMOVE_STEP',
  'MOVE_STEP',
  'ADD_TRANSITION',
  'REMOVE_TRANSITION',
  'SET_STEPS',
]);

function undoableReducer(
  state: UndoableState,
  action: CanvasAction,
): UndoableState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      current: previous,
      future: [state.current, ...state.future],
    };
  }

  if (action.type === 'REDO') {
    if (state.future.length === 0) return state;
    const next = state.future[0];
    return {
      past: [...state.past, state.current],
      current: next,
      future: state.future.slice(1),
    };
  }

  const newCurrent = canvasReducer(state.current, action);
  if (newCurrent === state.current) return state;

  if (STEP_MODIFYING_ACTIONS.has(action.type)) {
    return {
      past: [...state.past.slice(-49), state.current],
      current: newCurrent,
      future: [],
    };
  }

  return { ...state, current: newCurrent };
}

// ── Hook ──

const initialState: CanvasState = {
  steps: [],
  selectedStepId: null,
  selectedTransitionId: null,
  pan: { x: 0, y: 0 },
  zoom: 1,
  connecting: null,
};

let stepCounter = 0;

function generateStepId(): string {
  stepCounter += 1;
  return `step_${Date.now()}_${stepCounter}`;
}

function generateTransitionId(): string {
  return `trans_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultStepConfig(type: WorkflowStepType): WorkflowStepConfig {
  switch (type) {
    case 'approval':
      return { approval_type: 'single', min_approvers: 1 };
    case 'approval_chain':
      // One role approver by default so ParseApprovalConfig accepts the step;
      // authors refine approvers/mode/quorum in the properties panel.
      return { approvers: [{ type: 'role', ref: '' }], mode: 'sequential', quorum: 'all' };
    case 'notification':
      return { notification_channels: ['in_app'] };
    case 'delay':
      return { delay_minutes: 60 };
    case 'webhook':
      return { webhook_method: 'POST' };
    default:
      return {};
  }
}

function defaultAssigneeStrategy(): AssigneeStrategy {
  return { type: 'role', role_id: '' };
}

function transitionsFor(step: WorkflowStep): WorkflowTransition[] {
  return Array.isArray(step.transitions) ? step.transitions : [];
}

export function useCanvasState(initialSteps?: WorkflowStep[], locale = 'en') {
  const [undoable, dispatch] = useReducer(undoableReducer, {
    past: [],
    current: { ...initialState, steps: initialSteps ?? [] },
    future: [],
  });

  const state = undoable.current;
  const canUndo = undoable.past.length > 0;
  const canRedo = undoable.future.length > 0;

  // Keyboard shortcuts
  const keydownRef = useRef<((e: KeyboardEvent) => void) | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          dispatch({ type: 'REDO' });
        } else {
          dispatch({ type: 'UNDO' });
        }
      }
      if (
        state.selectedStepId &&
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        dispatch({ type: 'REMOVE_STEP', stepId: state.selectedStepId });
      }
    };
    keydownRef.current = handler;
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.selectedStepId]);

  const setSteps = useCallback(
    (steps: WorkflowStep[]) => dispatch({ type: 'SET_STEPS', steps }),
    [],
  );

  const addStep = useCallback(
    (
      type: WorkflowStepType,
      position: { x: number; y: number },
      name?: string,
    ) => {
      const step: WorkflowStep = {
        id: generateStepId(),
        name: name ?? formatStepTypeLabel(type, locale),
        type,
        config: defaultStepConfig(type),
        position,
        transitions: [],
        timeout_minutes: null,
        on_timeout: 'fail',
        assignee_strategy: defaultAssigneeStrategy(),
      };
      dispatch({ type: 'ADD_STEP', step });
      return step.id;
    },
    [locale],
  );

  const updateStep = useCallback(
    (stepId: string, updates: Partial<WorkflowStep>) =>
      dispatch({ type: 'UPDATE_STEP', stepId, updates }),
    [],
  );

  const removeStep = useCallback(
    (stepId: string) => dispatch({ type: 'REMOVE_STEP', stepId }),
    [],
  );

  const moveStep = useCallback(
    (stepId: string, position: { x: number; y: number }) =>
      dispatch({ type: 'MOVE_STEP', stepId, position }),
    [],
  );

  const addTransition = useCallback(
    (fromStepId: string, targetStepId: string, label?: string) => {
      const transition: WorkflowTransition = {
        id: generateTransitionId(),
        target_step_id: targetStepId,
        label: label ?? '',
      };
      dispatch({ type: 'ADD_TRANSITION', fromStepId, transition });
    },
    [],
  );

  const removeTransition = useCallback(
    (stepId: string, transitionId: string) =>
      dispatch({ type: 'REMOVE_TRANSITION', stepId, transitionId }),
    [],
  );

  const selectStep = useCallback(
    (stepId: string | null) => dispatch({ type: 'SELECT_STEP', stepId }),
    [],
  );

  const selectTransition = useCallback(
    (transitionId: string | null) =>
      dispatch({ type: 'SELECT_TRANSITION', transitionId }),
    [],
  );

  const setPan = useCallback(
    (pan: { x: number; y: number }) => dispatch({ type: 'SET_PAN', pan }),
    [],
  );

  const setZoom = useCallback(
    (zoom: number) => dispatch({ type: 'SET_ZOOM', zoom }),
    [],
  );

  const setConnecting = useCallback(
    (connecting: CanvasState['connecting']) =>
      dispatch({ type: 'SET_CONNECTING', connecting }),
    [],
  );

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);

  const fitToScreen = useCallback(
    (containerWidth: number, containerHeight: number) => {
      if (state.steps.length === 0) return;
      const xs = state.steps.map((s) => s.position.x);
      const ys = state.steps.map((s) => s.position.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs) + 200; // node width
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys) + 80; // node height
      const graphW = maxX - minX + 100;
      const graphH = maxY - minY + 100;
      const z = Math.min(containerWidth / graphW, containerHeight / graphH, 1);
      const panX = (containerWidth - graphW * z) / 2 - minX * z + 50;
      const panY = (containerHeight - graphH * z) / 2 - minY * z + 50;
      setZoom(z);
      setPan({ x: panX, y: panY });
    },
    [state.steps, setPan, setZoom],
  );

  const autoLayout = useCallback(() => {
    if (state.steps.length === 0) return;

    // Proper hierarchical layout via dagre (handles fan-out/fan-in, multiple
    // roots, and disconnected components far better than a hand-rolled BFS).
    const g = new dagre.graphlib.Graph({ directed: true });
    g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 96, marginx: 40, marginy: 40 });
    g.setDefaultEdgeLabel(() => ({}));

    for (const step of state.steps) {
      g.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const step of state.steps) {
      for (const t of transitionsFor(step)) {
        // Guard against edges to nonexistent targets (dagre would throw).
        if (state.steps.some((s) => s.id === t.target_step_id)) {
          g.setEdge(step.id, t.target_step_id);
        }
      }
    }

    dagre.layout(g);

    const updates: WorkflowStep[] = state.steps.map((s) => {
      const node = g.node(s.id);
      if (!node) return { ...s };
      // dagre returns center coords; convert to top-left for absolute nodes.
      return {
        ...s,
        position: {
          x: Math.round(node.x - NODE_WIDTH / 2),
          y: Math.round(node.y - NODE_HEIGHT / 2),
        },
      };
    });
    dispatch({ type: 'SET_STEPS', steps: updates });
  }, [state.steps]);

  return useMemo(
    () => ({
      steps: state.steps,
      selectedStepId: state.selectedStepId,
      selectedTransitionId: state.selectedTransitionId,
      pan: state.pan,
      zoom: state.zoom,
      connecting: state.connecting,
      canUndo,
      canRedo,
      setSteps,
      addStep,
      updateStep,
      removeStep,
      moveStep,
      addTransition,
      removeTransition,
      selectStep,
      selectTransition,
      setPan,
      setZoom,
      setConnecting,
      undo,
      redo,
      fitToScreen,
      autoLayout,
    }),
    [
      state.steps,
      state.selectedStepId,
      state.selectedTransitionId,
      state.pan,
      state.zoom,
      state.connecting,
      canUndo,
      canRedo,
      setSteps,
      addStep,
      updateStep,
      removeStep,
      moveStep,
      addTransition,
      removeTransition,
      selectStep,
      selectTransition,
      setPan,
      setZoom,
      setConnecting,
      undo,
      redo,
      fitToScreen,
      autoLayout,
    ],
  );
}
