'use client';

/**
 * use-workflow-lifecycle — React Query hooks for the workflow definition
 * "lifecycle" actions exposed by the Go FSM engine but not yet surfaced in the
 * designer toolbar: dry-run simulation (WP-6), dev→staging→prod promotion (WP-4)
 * and the definition_key version lineage browser.
 *
 * These are colocated with the designer (Stream B ownership) rather than added
 * to src/hooks/use-workflow-definitions.ts so the new toolbar work stays
 * self-contained. They are written as REUSABLE standalone hooks — Phase C (the
 * @xyflow/react migration) reuses both the hooks and the modal components that
 * consume them.
 *
 * Endpoints (backend/internal/workflow/handler/definition_handler.go):
 *   POST /api/v1/workflows/definitions/{id}/simulate  -> SimulationResult
 *   POST /api/v1/workflows/definitions/{id}/promote   -> PromotionRecord  (body: {to_stage})
 *   GET  /api/v1/workflows/definitions/{id}/versions  -> { versions: [...] }
 *   GET  /api/v1/workflows/definitions/{id}/lineage   -> { lineage: [...] } (definition_key siblings)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { showSuccess, showApiError } from '@/lib/toast';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useWorkflowDefinitionVersions } from '@/hooks/use-workflow-definitions';
import {
  formatPromotionStageLabel,
  getDefinitionLabels,
} from '../../definition-i18n';

const DEFINITIONS_KEY = 'workflow-definitions';

function defUrl(defId: string, suffix: string): string {
  return `${API_ENDPOINTS.WORKFLOWS_DEFINITIONS}/${defId}${suffix}`;
}

// ---------------------------------------------------------------------------
// Simulation (WP-6 dry run) — mirrors engine.SimulationResult
// ---------------------------------------------------------------------------

export type SimulationStatus =
  | 'completed'
  | 'max_steps_exceeded'
  | 'no_transition'
  | 'error';

export interface SimulationStepResult {
  step_id: string;
  step_type: string;
  step_name: string;
  order: number;
  outcome: string;
  output?: Record<string, unknown>;
  would_have_paused?: boolean;
  side_effect_note?: string;
}

export interface SimulationConditionEvaluation {
  step_id: string;
  kind: string;
  expression: string;
  target?: string;
  result: boolean;
  error?: string;
}

export interface SimulationSLAEscalation {
  after_seconds: number;
  fire_at: string;
  notify?: string;
  action?: string;
}

export interface SimulationSLAEntry {
  step_id: string;
  step_type: string;
  kind: string;
  entered_at: string;
  due_at: string;
  duration_seconds: number;
  escalations?: SimulationSLAEscalation[];
}

export interface SimulationResult {
  definition_id: string;
  definition_version: number;
  status: SimulationStatus;
  path: SimulationStepResult[];
  evaluations: SimulationConditionEvaluation[];
  final_variables: Record<string, unknown>;
  step_outputs: Record<string, unknown>;
  sla_timeline: SimulationSLAEntry[];
  steps_executed: number;
  started_at: string;
  projected_end_at: string;
  message?: string;
}

export interface SimulateRequestBody {
  trigger_data?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  mock_decisions?: Record<string, { approved: boolean; output?: Record<string, unknown> }>;
  max_steps?: number;
  advance_clock_on_sla?: boolean;
}

/**
 * useSimulateWorkflowDefinition — POSTs a side-effect-free dry run. The mutation
 * variables carry the (optional) body; an empty body simulates with engine
 * defaults (auto-approve every gate, virtual clock = now).
 */
export function useSimulateWorkflowDefinition(defId: string) {
  return useMutation<SimulationResult, unknown, SimulateRequestBody | undefined>({
    mutationFn: (body) =>
      apiPost<SimulationResult>(defUrl(defId, '/simulate'), body ?? {}),
    onError: (error) => showApiError(error),
  });
}

// ---------------------------------------------------------------------------
// Promotion (WP-4 dev -> staging -> prod) — mirrors repository.PromotionRecord
// ---------------------------------------------------------------------------

export type PromotionStage = 'dev' | 'staging' | 'prod';

export interface PromotionRecord {
  id: string;
  tenant_id?: string;
  name: string;
  version: number;
  status: string;
  definition_key: string;
  stage: PromotionStage | string;
  immutable: boolean;
  promoted_at?: string | null;
  promoted_by?: string;
}

/** nextPromotionStage returns the single legal successor in the linear FSM. */
export function nextPromotionStage(
  current: string | undefined,
): PromotionStage | null {
  switch (current) {
    case 'dev':
      return 'staging';
    case 'staging':
      return 'prod';
    default:
      return null;
  }
}

/**
 * usePromoteWorkflowDefinition — advances a definition one stage along the
 * dev→staging→prod promotion FSM. An illegal/immutable promotion surfaces as a
 * 409 from the backend and is shown via showApiError.
 */
export function usePromoteWorkflowDefinition(defId: string) {
  const queryClient = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const labels = getDefinitionLabels(locale);
  return useMutation<PromotionRecord, unknown, { toStage: PromotionStage | string }>({
    mutationFn: ({ toStage }) =>
      apiPost<PromotionRecord>(defUrl(defId, '/promote'), { to_stage: toStage }),
    onSuccess: (rec) => {
      showSuccess(labels.promotion.promotedTo(formatPromotionStageLabel(rec.stage, locale)));
      queryClient.invalidateQueries({ queryKey: [DEFINITIONS_KEY] });
      queryClient.invalidateQueries({ queryKey: [DEFINITIONS_KEY, defId, 'lineage'] });
    },
    onError: (error) => showApiError(error),
  });
}

// ---------------------------------------------------------------------------
// Lineage / version browser — definition_key siblings + plain version list
// ---------------------------------------------------------------------------

/**
 * useWorkflowDefinitionLineage — lists every live version sharing the
 * definition's lineage (definition_key), each carrying its promotion stage +
 * immutability. Returns [] gracefully if the promotion service is not wired
 * (the endpoint then 501s) so the version browser can fall back to /versions.
 */
export function useWorkflowDefinitionLineage(
  defId: string,
  enabled = true,
) {
  return useQuery<PromotionRecord[]>({
    queryKey: [DEFINITIONS_KEY, defId, 'lineage'],
    queryFn: async () => {
      const res = await apiGet<{ lineage: PromotionRecord[] }>(
        defUrl(defId, '/lineage'),
      );
      return res?.lineage ?? [];
    },
    enabled: enabled && !!defId,
    retry: false,
  });
}

/**
 * useWorkflowDefinitionVersionList — plain version list (GET /versions). Used as
 * the always-available fallback when lineage/promotion data is absent.
 */
export function useWorkflowDefinitionVersionList(
  defId: string,
  enabled = true,
) {
  return useWorkflowDefinitionVersions(defId, enabled);
}
