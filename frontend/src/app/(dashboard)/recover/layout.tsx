'use client';

import type { ReactNode } from 'react';
import { PermissionRedirect } from '@/components/common/permission-redirect';

/**
 * Clario Recover product layout.
 *
 * The whole `/recover` surface reuses the DR permission model: a user must hold
 * `dr:read` to reach any Recover route. This is the coarse, product-level gate.
 *
 * Per-sub-solution access is enforced one level deeper by each sub-solution's
 * own SERVER-SIDE guard (`recover/{slug}/layout.tsx`), which resolves the
 * tenant's LIVE licensing entitlement from `GET /api/recover/products` and
 * rejects unentitled access — the nav merely hiding a link is never the control.
 */
export default function RecoverProductLayout({ children }: { children: ReactNode }) {
  return <PermissionRedirect permission="dr:read">{children}</PermissionRedirect>;
}
