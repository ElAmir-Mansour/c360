'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  LayoutGrid,
  Maximize,
  Redo2,
  Save,
  Settings2,
  Undo2,
  Upload,
  X,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RfStepNode, STEP_TYPE_KEYS, type RfStepNodeData } from './rf-step-node';
import { StepPalette } from './step-palette';
import { PropertiesPanel } from './properties-panel';
import { useCanvasState } from '../hooks/use-canvas-state';
import { toDesignerSteps } from '../workflow-step-adapter';
import { lintWorkflow } from './workflow-lint';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { getDefinitionLabels } from '../../../definition-i18n';
import type {
  WorkflowStep,
  WorkflowStepType,
  WorkflowTransition,
  WorkflowDefinition,
  BackendTriggerConfig,
  BackendVariableDef,
} from '@/types/models';

/**
 * Extra definition-level config the canvas authors alongside the steps. Passed
 * as the second `onSave` argument so the entry/toolbar owner
 * (designer-page-client) can persist `trigger_config` + `variables` on the
 * definition. Existing positional `onSave(steps)` callers keep working — the
 * second arg is ignored until wired.
 */
export interface DefinitionSettingsPatch {
  trigger_config: BackendTriggerConfig;
  variables: Record<string, BackendVariableDef>;
}

function transitionsFor(step: WorkflowStep): WorkflowTransition[] {
  return Array.isArray(step.transitions) ? step.transitions : [];
}

interface WorkflowCanvasProps {
  definition: WorkflowDefinition;
  readOnly: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  stepStatuses?: Record<string, string>;
  onSave: (steps: WorkflowStep[], settings?: DefinitionSettingsPatch) => void;
  onPublish: () => void;
}

// One node component registered under every designer step type so `node.type`
// is the FSM step type and round-trips losslessly. (React Flow keys its node
// renderer registry by `node.type`.)
const nodeTypes: NodeTypes = STEP_TYPE_KEYS.reduce((acc, t) => {
  acc[t] = RfStepNode;
  return acc;
}, {} as NodeTypes);

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  // ReactFlowProvider so `useReactFlow`/`screenToFlowPosition` are available to
  // the inner canvas (drop-to-create needs the viewport transform).
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowCanvasInner({
  definition,
  readOnly,
  isSaving,
  isPublishing,
  stepStatuses,
  onSave,
  onPublish,
}: WorkflowCanvasProps) {
  const { locale, direction } = useLocaleOrDefault();
  const localLabels = getDefinitionLabels(locale);
  const isAr = locale === 'ar';
  const isRtl = direction === 'rtl';

  const initialSteps = useMemo(() => toDesignerSteps(definition.steps), [definition.steps]);
  const canvas = useCanvasState(initialSteps, locale);
  const {
    steps,
    selectedStepId,
    selectedTransitionId,
    canUndo,
    canRedo,
    undo,
    redo,
    addStep,
    updateStep,
    removeStep,
    moveStep,
    addTransition,
    removeTransition,
    selectStep,
    selectTransition,
    autoLayout,
  } = canvas;
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // ── Definition-level settings (trigger + variables) ──
  const [triggerConfig, setTriggerConfig] = useState<BackendTriggerConfig>(
    () => definition.trigger_config ?? { type: 'manual' },
  );
  const [variables, setVariables] = useState<Record<string, BackendVariableDef>>(
    () => definition.variables ?? {},
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setTriggerConfig(definition.trigger_config ?? { type: 'manual' });
    setVariables(definition.variables ?? {});
  }, [definition.trigger_config, definition.variables]);

  const openSettings = useCallback(() => {
    if (selectedStepId !== null) selectStep(null);
    if (selectedTransitionId !== null) selectTransition(null);
    setSettingsOpen(true);
  }, [selectedStepId, selectedTransitionId, selectStep, selectTransition]);

  const handleSave = useCallback(() => {
    onSave(steps, { trigger_config: triggerConfig, variables });
  }, [onSave, steps, triggerConfig, variables]);

  // ── Static lint (orphans, unreachable, dangling targets, missing end, …) ──
  const lint = useMemo(() => lintWorkflow(steps, locale), [steps, locale]);
  const issueCount = lint.errors.length + lint.warnings.length;
  const [issuesOpen, setIssuesOpen] = useState(false);

  const handlePublishClick = useCallback(() => {
    if (!lint.valid) {
      setIssuesOpen(true);
      return;
    }
    onPublish();
  }, [lint.valid, onPublish]);

  // ── Derive React Flow nodes from the canonical designer steps ──
  const nodes = useMemo<Node<RfStepNodeData>[]>(() => {
    return steps.map((step) => ({
      id: step.id,
      type: step.type,
      position: step.position,
      selected: selectedStepId === step.id,
      // Allow free-form drag; we snap on change instead of pinning to a grid.
      data: {
        step,
        issues: lint.byStep.get(step.id),
        stepStatus: stepStatuses?.[step.id],
        readOnly,
        isAr,
      },
    }));
  }, [steps, selectedStepId, lint.byStep, stepStatuses, readOnly, isAr]);

  // ── Derive React Flow edges from per-step transitions ──
  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    for (const step of steps) {
      for (const t of transitionsFor(step)) {
        const dangling = !steps.some((s) => s.id === t.target_step_id);
        const label =
          t.label ||
          (typeof t.condition === 'string'
            ? t.condition
            : t.condition?.field
              ? `${t.condition.field} ${t.condition.operator} …`
              : '');
        out.push({
          id: t.id,
          source: step.id,
          target: t.target_step_id,
          label: label || undefined,
          selected: selectedTransitionId === t.id,
          markerEnd: { type: MarkerType.ArrowClosed },
          animated: stepStatuses?.[step.id] === 'running',
          data: { condition: t.condition },
          style: dangling
            ? { stroke: 'hsl(var(--destructive))', strokeDasharray: '5 4' }
            : undefined,
        });
      }
    }
    return out;
  }, [steps, selectedTransitionId, stepStatuses]);

  // ── React Flow change handlers (translate back into canonical steps) ──
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readOnly) return;
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          // Snap to the 20px dot grid (matches the legacy canvas + background).
          moveStep(change.id, {
            x: Math.round(change.position.x / 20) * 20,
            y: Math.round(change.position.y / 20) * 20,
          });
        } else if (change.type === 'remove') {
          removeStep(change.id);
        }
      }
    },
    [readOnly, moveStep, removeStep],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;
      for (const change of changes) {
        if (change.type === 'remove') {
          // Find the owning step and drop the transition.
          for (const step of steps) {
            if (transitionsFor(step).some((t) => t.id === change.id)) {
              removeTransition(step.id, change.id);
              break;
            }
          }
        }
      }
    },
    [readOnly, steps, removeTransition],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (readOnly || !conn.source || !conn.target) return;
      if (conn.source === conn.target) return;
      const fromStep = steps.find((s) => s.id === conn.source);
      if (
        fromStep &&
        transitionsFor(fromStep).some((t) => t.target_step_id === conn.target)
      ) {
        return; // no duplicate transitions
      }
      addTransition(conn.source, conn.target);
    },
    [readOnly, steps, addTransition],
  );

  // ── Selection → properties panel ──
  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
      if (selNodes.length > 0) {
        setSettingsOpen(false);
        selectStep(selNodes[0].id);
      } else if (selEdges.length > 0) {
        setSettingsOpen(false);
        selectTransition(selEdges[0].id);
      } else {
        selectStep(null);
        selectTransition(null);
      }
    },
    [selectStep, selectTransition],
  );

  // ── Palette: click-to-add ──
  const handleAddFromPalette = useCallback(
    (type: WorkflowStepType) => {
      const maxX =
        steps.length > 0 ? Math.max(...steps.map((s) => s.position.x)) : 0;
      addStep(type, { x: maxX + 280, y: 200 });
    },
    [steps, addStep],
  );

  // ── Palette: drag-and-drop onto the pane (screenToFlowPosition) ──
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (readOnly) return;
      const stepType = e.dataTransfer.getData('step-type') as WorkflowStepType;
      if (!stepType) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addStep(stepType, {
        x: Math.round(pos.x / 20) * 20,
        y: Math.round(pos.y / 20) * 20,
      });
    },
    [readOnly, screenToFlowPosition, addStep],
  );

  // Auto-layout (dagre) then re-fit the view.
  const handleAutoLayout = useCallback(() => {
    autoLayout();
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
  }, [autoLayout, fitView]);

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2, duration: 300 });
  }, [fitView]);

  const handlePaneClick = useCallback(() => {
    if (selectedStepId !== null) selectStep(null);
    if (selectedTransitionId !== null) selectTransition(null);
  }, [selectedStepId, selectedTransitionId, selectStep, selectTransition]);

  // ── Selection lookups for the properties panel ──
  const selectedStep = steps.find((s) => s.id === selectedStepId) ?? null;

  const selectedTransitionInfo = (() => {
    if (!selectedTransitionId) return null;
    for (const step of steps) {
      const transition = transitionsFor(step).find((t) => t.id === selectedTransitionId);
      if (transition) {
        const targetStep = steps.find((s) => s.id === transition.target_step_id);
        return { transition, fromStep: step, toStep: targetStep };
      }
    }
    return null;
  })();

  return (
    <div className="flex h-full" dir={direction}>
      {/* Left palette (drag source via @dnd-kit-style native DnD) */}
      {!readOnly && <StepPalette onAddStep={handleAddFromPalette} />}

      {/* Main canvas area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-1 border-b bg-background px-3 py-1.5">
          {!readOnly && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={undo}
                disabled={!canUndo}
                aria-label={localLabels.designer.undo}
                title={localLabels.designer.undoTitle}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={redo}
                disabled={!canRedo}
                aria-label={localLabels.designer.redo}
                title={localLabels.designer.redoTitle}
              >
                <Redo2 className="h-4 w-4" />
              </Button>
              <div className="mx-1 h-5 w-px bg-border" />
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleFitView}
            aria-label={localLabels.designer.fitToScreen}
            title={localLabels.designer.fitToScreen}
          >
            <Maximize className="h-4 w-4" />
          </Button>

          {!readOnly && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleAutoLayout}
                aria-label={localLabels.designer.autoLayout}
                title={localLabels.designer.autoLayout}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', settingsOpen && 'bg-primary/10 text-primary')}
                onClick={() => (settingsOpen ? setSettingsOpen(false) : openSettings())}
                aria-expanded={settingsOpen}
                aria-label={localLabels.designer.workflowSettings}
                title={localLabels.designer.workflowSettings}
              >
                <Settings2 className="h-4 w-4" />
              </Button>

              <div className="flex-1" />

              <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={isSaving}
                className="h-7 text-xs"
              >
                {isSaving ? (
                  <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="me-1 h-3.5 w-3.5" />
                )}
                {localLabels.designer.saveDraft}
              </Button>

              {definition.status === 'draft' && (
                <Button
                  size="sm"
                  onClick={handlePublishClick}
                  disabled={isPublishing}
                  className="h-7 text-xs"
                >
                  {isPublishing ? (
                    <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="me-1 h-3.5 w-3.5" />
                  )}
                  {localLabels.designer.publish}
                </Button>
              )}
            </>
          )}
        </div>

        {/* React Flow pane */}
        <div
          ref={wrapperRef}
          className="relative flex-1"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onPaneClick={handlePaneClick}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            edgesFocusable={!readOnly}
            deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
            snapToGrid
            snapGrid={[20, 20]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.25}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            // React Flow keeps LTR internal math; the wrapper dir is set above so
            // panels/controls flow correctly. Pan/zoom are direction-agnostic.
            dir="ltr"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls
              position={isRtl ? 'bottom-right' : 'bottom-left'}
              showInteractive={!readOnly}
            />
            <MiniMap
              position={isRtl ? 'top-left' : 'top-right'}
              pannable
              zoomable
              nodeColor={(n) => {
                const issues = (n.data as RfStepNodeData | undefined)?.issues;
                if (issues?.some((i) => i.level === 'error')) return 'hsl(var(--destructive))';
                if (issues?.some((i) => i.level === 'warning')) return 'hsl(var(--status-warning))';
                return 'hsl(var(--primary))';
              }}
            />

            {/* Empty state */}
            {steps.length === 0 && (
              <Panel position="top-center">
                <div className="pointer-events-none mt-24 text-center text-muted-foreground">
                  <p className="text-sm font-medium">{localLabels.designer.noSteps}</p>
                  <p className="mt-1 text-xs">
                    {readOnly
                      ? localLabels.designer.noStepsReadonly
                      : localLabels.designer.noStepsEditable}
                  </p>
                </div>
              </Panel>
            )}

            {/* Inline lint overlay */}
            {!readOnly && steps.length > 0 && (
              <Panel position={isRtl ? 'bottom-right' : 'bottom-left'}>
                <div className="w-72 max-w-[calc(100vw-2rem)]">
                  <button
                    type="button"
                    onClick={() => setIssuesOpen((v) => !v)}
                    aria-expanded={issuesOpen}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-sm backdrop-blur transition-colors',
                      lint.valid && issueCount === 0
                        ? 'border-status-success/40 bg-status-success/10 text-status-success'
                        : lint.errors.length > 0
                          ? 'border-destructive/40 bg-destructive/10 text-destructive'
                          : 'border-status-warning/40 bg-status-warning/10 text-status-warning',
                    )}
                  >
                    {lint.valid && issueCount === 0 ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : lint.errors.length > 0 ? (
                      <AlertCircle className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    <span className="flex-1 text-start">
                      {issueCount === 0
                        ? localLabels.designer.valid
                        : localLabels.designer.errorsWarnings(
                            lint.errors.length,
                            lint.warnings.length,
                          )}
                    </span>
                    {issueCount > 0 && (
                      <span className="text-overline opacity-70">
                        {issuesOpen ? localLabels.designer.hide : localLabels.designer.show}
                      </span>
                    )}
                  </button>

                  {issuesOpen && issueCount > 0 && (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border bg-popover p-3 text-xs shadow-lg">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-semibold text-foreground">
                          {localLabels.designer.validation}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIssuesOpen(false)}
                          aria-label={localLabels.designer.closeValidation}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <ul className="space-y-1.5">
                        {lint.issues.map((issue, i) => {
                          const name = issue.stepId
                            ? steps.find((s) => s.id === issue.stepId)?.name
                            : undefined;
                          return (
                            <li
                              key={`${issue.level}-${i}`}
                              className={cn(
                                'flex items-start gap-1.5',
                                issue.level === 'error' ? 'text-destructive' : 'text-status-warning',
                              )}
                            >
                              {issue.level === 'error' ? (
                                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                              ) : (
                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              )}
                              <button
                                type="button"
                                className="text-start hover:underline"
                                onClick={() => issue.stepId && selectStep(issue.stepId)}
                              >
                                {name ? <span className="font-medium">{name}: </span> : null}
                                {issue.message}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      </div>

      {/* Right properties panel — step */}
      {selectedStep && (
        <PropertiesPanel
          mode="step"
          step={selectedStep}
          onUpdate={(updates) => updateStep(selectedStep.id, updates)}
          onRemove={() => removeStep(selectedStep.id)}
          onClose={() => selectStep(null)}
          readOnly={readOnly}
        />
      )}

      {/* Right properties panel — transition / condition inspector */}
      {selectedTransitionInfo && (
        <PropertiesPanel
          mode="transition"
          transition={selectedTransitionInfo.transition}
          fromStepName={selectedTransitionInfo.fromStep.name}
          toStepName={selectedTransitionInfo.toStep?.name ?? localLabels.designer.unknownStep}
          onUpdateTransition={(updates) => {
            const fromStep = selectedTransitionInfo.fromStep;
            updateStep(fromStep.id, {
              transitions: fromStep.transitions.map((t) =>
                t.id === selectedTransitionInfo.transition.id ? { ...t, ...updates } : t,
              ),
            });
          }}
          onRemoveTransition={() => {
            removeTransition(
              selectedTransitionInfo.fromStep.id,
              selectedTransitionInfo.transition.id,
            );
          }}
          onClose={() => selectTransition(null)}
          readOnly={readOnly}
        />
      )}

      {/* Right properties panel — definition settings (trigger + variables) */}
      {settingsOpen && !selectedStep && !selectedTransitionInfo && (
        <PropertiesPanel
          mode="definition"
          triggerConfig={triggerConfig}
          variables={variables}
          onUpdateTrigger={setTriggerConfig}
          onUpdateVariables={setVariables}
          onClose={() => setSettingsOpen(false)}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
