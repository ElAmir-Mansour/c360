'use client';

import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ImpersonationBanner } from '@/components/platform/impersonation-banner';

/**
 * Shared shell for the Platform Admin Console (§B.3). It now lives at the
 * internal /console/platform route so public /platform can serve marketing.
 * Middleware rewrites authenticated /platform/* requests here while preserving
 * the browser URL. This layout gates the console on `admin:console` (matched by
 * `admin:*` and `*`, never tenant_admin) and mounts the impersonation banner
 * above every console screen.
 *
 * Mount choice (task step 6): the banner lives HERE rather than the global
 * dashboard layout to keep blast radius small for v1. An impersonation grant set
 * from a platform console screen is visible across all console routes; if/when an
 * operator should retain the "viewing as" context while navigating into a suite
 * (e.g. /lex) to inspect it, lift <ImpersonationBanner/> into
 * src/app/(dashboard)/layout.tsx instead — the store + interceptor already work
 * app-wide, only the visual banner is scoped here.
 */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <PermissionRedirect permission="admin:console">
      <ImpersonationBanner />
      {children}
    </PermissionRedirect>
  );
}
