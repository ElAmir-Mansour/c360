'use client';

// Platform Audit — local hooks for the gap endpoints that the shared foundation
// (hooks/use-platform.ts) does not yet expose: G15 (global integrity verify +
// status) and G16 (async export jobs). G14 (cross-tenant log query) is consumed
// directly from the foundation's usePlatformAuditLogs. These live here (not in
// the shared hook file) per the task constraint that only this route folder may
// be created/edited; if/when they graduate into use-platform.ts the screen can
// switch imports without UI changes.

import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { platformKeys } from '@/hooks/use-platform';
import type { AuditExportJobStatus } from '@/types/audit';

// ── G15 — Global integrity (verify across tenants + persisted status) ──────────

export interface PlatformVerifyRequest {
  date_from: string;
  date_to: string;
  /** Optional explicit tenant scope; omit for all-tenants verify. */
  tenant_ids?: string[];
}

/** Per-tenant integrity result returned by the global verify runner. */
export interface PlatformTenantIntegrity {
  tenant_id: string;
  tenant_name: string;
  verified: boolean;
  total_records: number;
  verified_records: number;
  broken_chain_at?: string | null;
}

export interface PlatformVerifyResult {
  verified: boolean;
  total_records: number;
  verified_records: number;
  tenants_checked: number;
  tenants_failed: number;
  verified_at: string;
  tenants: PlatformTenantIntegrity[];
}

export interface PlatformIntegrityStatus {
  last_run_at?: string | null;
  last_run_status?: 'verified' | 'violation' | 'never';
  verified: boolean;
  tenants_checked: number;
  tenants_failed: number;
  total_records: number;
  verified_records: number;
  tenants?: PlatformTenantIntegrity[];
}

/** G15 — read the most recent persisted global-integrity status. Refetch 60s. */
export function usePlatformIntegrityStatus() {
  return useApiQuery<PlatformIntegrityStatus>(
    [...platformKeys.audit, 'integrity', 'status'],
    '/api/v1/audit/admin/integrity/status',
    { refetchInterval: 60_000 },
  );
}

/** G15 — run a fleet-wide chain-of-custody verification. */
export function usePlatformVerify() {
  const qc = useQueryClient();
  return useApiMutation<PlatformVerifyResult, PlatformVerifyRequest>(
    '/api/v1/audit/admin/verify',
    'post',
    {
      onSuccess: () =>
        qc.invalidateQueries({
          queryKey: [...platformKeys.audit, 'integrity', 'status'],
        }),
    },
  );
}

// ── G16 — Async export jobs (start, poll, download) ───────────────────────────

export interface PlatformExportRequest {
  format: 'csv' | 'ndjson';
  date_from: string;
  date_to: string;
  all_tenants?: boolean;
  tenant_id?: string;
  service?: string;
  severity?: string;
  action?: string;
  columns?: string[];
}

/** G16 — start an async export job. Returns the job descriptor (queued). */
export function useStartAuditExport() {
  const qc = useQueryClient();
  return useApiMutation<AuditExportJobStatus, PlatformExportRequest>(
    '/api/v1/audit/exports',
    'post',
    {
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: [...platformKeys.audit, 'exports'] }),
    },
  );
}

/**
 * G16 — poll a single export job. Polls every 2s while the job is queued or
 * processing, then stops once it completes or fails. Disabled until a jobId is
 * provided (i.e. after a job has been started).
 */
export function useAuditExportJob(jobId: string | null) {
  return useApiQuery<AuditExportJobStatus>(
    [...platformKeys.audit, 'exports', jobId ?? 'none'],
    `/api/v1/audit/exports/${jobId ?? ''}`,
    {
      enabled: Boolean(jobId),
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return s === 'completed' || s === 'failed' ? false : 2_000;
      },
    },
  );
}
