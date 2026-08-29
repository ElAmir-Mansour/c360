'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, PlayCircle, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import {
  useWorkflowDefinition,
  useUpdateWorkflowDefinition,
  usePublishWorkflowDefinition,
} from '@/hooks/use-workflow-definitions';
import { useAuthStore } from '@/stores/auth-store';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { serializeField } from '@/lib/forms-api';
import { toBackendSteps } from './workflow-step-adapter';
import { useSimulateWorkflowDefinition, type SimulateRequestBody } from './use-workflow-lifecycle';
import { SimulateResultModal } from './components/simulate-result-modal';
import { SimulateConfigDialog } from './components/simulate-config-dialog';
import { VersionBrowserModal } from './components/version-browser-modal';
import { getDefinitionLabels } from '../../definition-i18n';
import type {
  WorkflowStep,
  FormField,
} from '@/types/models';

// Heavy, fully client-side editor (dagre layout + large interactive tree).
// Code-split so the designer route shell paints before the canvas JS loads.
import type { DefinitionSettingsPatch } from './components/workflow-canvas';

const WorkflowCanvas = dynamic(
  () => import('./components/workflow-canvas').then((m) => m.WorkflowCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <LoadingSkeleton variant="card" count={1} className="w-80" />
      </div>
    ),
  },
);

export function DesignerPageClient() {
  const params = useParams();
  const router = useRouter();
  const defId = (params?.defId as string | undefined) ?? '';

  const { data: definition, isLoading, isError, refetch } = useWorkflowDefinition(defId);
  const updateMutation = useUpdateWorkflowDefinition();
  const publishMutation = usePublishWorkflowDefinition();
  const simulateMutation = useSimulateWorkflowDefinition(defId);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { locale } = useLocaleOrDefault();
  const localLabels = getDefinitionLabels(locale);

  const [simulateOpen, setSimulateOpen] = useState(false);
  const [simulateConfigOpen, setSimulateConfigOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-4rem)]">
        <LoadingSkeleton variant="card" count={1} />
      </div>
    );
  }

  if (isError || !definition) {
    return (
      <ErrorState
        message={localLabels.designer.loadDefinitionFailed}
        onRetry={() => refetch()}
      />
    );
  }

  const readOnly = definition.status !== 'draft';

  function handleSave(steps: WorkflowStep[], settings?: DefinitionSettingsPatch) {
    // Human-step form schemas are authored in the canvas as canonical FormField[]
    // with possibly bare-string (legacy) bilingual labels. The forms backend
    // decodes with DisallowUnknownFields and the bilingual gate requires every
    // author-facing label/placeholder/description/option to serialize as the
    // canonical {ar,en} object. Route each embedded schema through the same
    // forms-api serializer the standalone form library uses so the persisted
    // workflow definition carries normalized form schemas.
    const normalizedSteps = steps.map((step) => {
      const schema = step.config.form_schema;
      if (!schema || schema.length === 0) {
        return step;
      }
      return {
        ...step,
        config: {
          ...step.config,
          form_schema: schema.map(serializeField) as unknown as FormField[],
        },
      };
    });

    updateMutation.mutate({
      defId: definition!.id,
      data: { steps: toBackendSteps(normalizedSteps), ...(settings ?? {}) },
    });
  }

  function handlePublish() {
    publishMutation.mutate(definition!.id);
  }

  function handleSimulate() {
    // Open the decision picker first. Auto-approving with only generic outputs
    // makes any workflow that branches on domain fields (e.g. legal_approved,
    // compliant) loop until the max-steps guard trips; the picker lets the run
    // satisfy those guards and follow a real branch to the end.
    setSimulateConfigOpen(true);
  }

  function handleRunSimulation(body: SimulateRequestBody) {
    setSimulateConfigOpen(false);
    setSimulateOpen(true);
    // The result modal renders the executed path / decisions / SLA projection.
    simulateMutation.mutate(body);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background">
        <button
          onClick={() => router.push(`/admin/workflows/definitions/${defId}`)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          type="button"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold truncate">{definition.name}</h1>
          <p className="text-xs text-muted-foreground">
            v{definition.version} &middot;{' '}
            {readOnly ? localLabels.designer.readOnly : localLabels.designer.editing}
          </p>
        </div>

        <div className="ms-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleSimulate}
            disabled={simulateMutation.isPending}
          >
            <PlayCircle className="me-1 h-3.5 w-3.5" aria-hidden />
            {localLabels.designer.simulate}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setVersionsOpen(true)}
          >
            <Layers className="me-1 h-3.5 w-3.5" aria-hidden />
            {localLabels.designer.versions}
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0">
        <WorkflowCanvas
          definition={definition}
          readOnly={readOnly}
          isSaving={updateMutation.isPending}
          isPublishing={publishMutation.isPending}
          onSave={handleSave}
          onPublish={handlePublish}
        />
      </div>

      <SimulateConfigDialog
        open={simulateConfigOpen}
        onOpenChange={setSimulateConfigOpen}
        steps={definition.steps ?? []}
        isPending={simulateMutation.isPending}
        onRun={handleRunSimulation}
      />

      <SimulateResultModal
        open={simulateOpen}
        onOpenChange={setSimulateOpen}
        result={simulateMutation.data}
        isLoading={simulateMutation.isPending}
        error={simulateMutation.error}
        definitionName={definition.name}
      />

      <VersionBrowserModal
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        defId={defId}
        currentDefId={definition.id}
        canPromote={hasPermission('workflow:admin')}
      />
    </div>
  );
}
