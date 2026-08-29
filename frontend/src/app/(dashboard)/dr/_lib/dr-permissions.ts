/**
 * Canonical ClarioDR permission strings, mirroring the backend RBAC catalogue
 * (`backend/internal/auth/rbac.go` → `PermDRRead`/`PermDRWrite`/`PermDRAdmin`/
 * `PermDRFailover`). Keeping them in one place means every console surface gates
 * on the exact same string the server enforces, so a UI/server drift becomes a
 * single-line fix rather than a scattered hunt for `'dr:write'` literals.
 *
 * `dr:failover` is the gated, step-up action: it is required to *initiate* or
 * *approve* a failover / drill, over and above the `dr:write` needed to open and
 * pre-flight the guided wizard. The wizard therefore opens on `dr:write` but the
 * final declare/approve confirm is gated on `dr:failover`.
 *
 * Pure constants only — no React, importable from anywhere (components, hooks,
 * tests). Use with `useAuth().hasPermission(...)`.
 */

export const DR_PERMISSIONS = {
  /** View DR console surfaces and read posture/runs/evidence. */
  read: 'dr:read',
  /** Create/configure DR objects and open + pre-flight the failover wizard. */
  write: 'dr:write',
  /** Administer DR (topology, policy); superset of write. */
  admin: 'dr:admin',
  /** Step-up: initiate / approve / cancel a failover or drill run. */
  failover: 'dr:failover',
} as const;

/** Union of the canonical ClarioDR permission strings. */
export type DRPermission = (typeof DR_PERMISSIONS)[keyof typeof DR_PERMISSIONS];
