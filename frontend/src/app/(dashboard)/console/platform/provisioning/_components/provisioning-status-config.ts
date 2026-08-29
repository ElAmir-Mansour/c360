// Status-badge config factories + the per-tenant provision-status server shape for
// the Provisioning Oversight screen (docs/platform-admin-console.md §E.5(9), G24).
//
// The screen reads two contracts:
//   • the in-flight queue (G24, list)         → ProvisioningItem (src/types/platform.ts)
//   • the existing per-tenant detail endpoint → ProvisioningStatusDetail (below)
//
// The per-tenant endpoint (GET /api/v1/admin/tenants/{id}/provision-status,
// EXISTS — admin_handler.go:39) returns the Go model
// `onboarding/model.ProvisioningStatus`, whose step fields use snake_case
// `step_name`/`error_message`/`completed_at` rather than the trimmer
// `ProvisioningStep` shape in platform.ts. We type the raw server shape here so
// the expansion binds directly with no transform layer (§F resilience contract).
//
// Badge labels are localized: the configs are built by factory functions that
// take the translator (useT) so StatusBadge renders Arabic/English labels in the
// active locale rather than hard-coded English.

import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Loader,
  MinusCircle,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';
import type { MessageKey } from '@/lib/i18n/messages';

type Translator = (key: MessageKey) => string;

// ── Per-tenant provision-status server shape (onboarding/model) ────────────────

export type ProvisioningStepServerStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

/** Mirrors onboarding/model.ProvisioningStep (provisioning.go:19). */
export interface ProvisioningStepDetail {
  id?: string;
  tenant_id?: string;
  onboarding_id?: string;
  step_number: number;
  step_name: string;
  status: ProvisioningStepServerStatus;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  error_message?: string | null;
  retry_count?: number;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
}

/** Mirrors onboarding/model.ProvisioningStatus. */
export interface ProvisioningStatusDetail {
  tenant_id: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  steps: ProvisioningStepDetail[];
  current_step?: ProvisioningStepDetail | null;
  progress_pct: number;
  completed_steps: number;
  total_steps: number;
}

// ── Badge config factories (localized labels) ─────────────────────────────────

/** Tenant-level provisioning lifecycle (G24 ProvisioningItem.status). */
export function buildProvisioningStatusConfig(t: Translator): StatusConfig {
  return {
    pending: { label: t('platformConsole.provisioning.statusPending'), color: 'gray', icon: Clock },
    provisioning: {
      label: t('platformConsole.provisioning.statusProvisioning'),
      color: 'blue',
      icon: Loader,
    },
    failed: { label: t('platformConsole.provisioning.statusFailed'), color: 'red', icon: CircleX },
    completed: {
      label: t('platformConsole.provisioning.statusCompleted'),
      color: 'green',
      icon: CircleCheck,
    },
  };
}

/** Per-step status. */
export function buildProvisioningStepStatusConfig(t: Translator): StatusConfig {
  return {
    pending: {
      label: t('platformConsole.provisioning.stepPending'),
      color: 'gray',
      icon: CircleDashed,
    },
    running: {
      label: t('platformConsole.provisioning.stepRunning'),
      color: 'blue',
      icon: Loader,
    },
    completed: {
      label: t('platformConsole.provisioning.stepCompleted'),
      color: 'green',
      icon: CircleCheck,
    },
    failed: {
      label: t('platformConsole.provisioning.stepFailed'),
      color: 'red',
      icon: CircleX,
    },
    skipped: {
      label: t('platformConsole.provisioning.stepSkipped'),
      color: 'gray',
      icon: MinusCircle,
    },
  };
}

/** Maps a step status to the icon rendered in the step rail. */
export const stepStatusIcon: Record<ProvisioningStepServerStatus, LucideIcon> = {
  pending: CircleDashed,
  running: Loader,
  completed: CircleCheck,
  failed: CircleX,
  skipped: MinusCircle,
};

/** Human-readable per-step duration. `duration_ms` is authoritative; otherwise
 *  derive from started/completed timestamps. Returns "—" when unknown. */
export function formatStepDuration(step: ProvisioningStepDetail): string {
  let ms = step.duration_ms ?? undefined;
  if ((ms === undefined || ms === null) && step.started_at && step.completed_at) {
    const start = Date.parse(step.started_at);
    const end = Date.parse(step.completed_at);
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      ms = end - start;
    }
  }
  if (ms === undefined || ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s % 1 === 0 ? s : s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
