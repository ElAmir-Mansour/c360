'use client';

import { Info, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useT } from '@/components/providers/locale-provider';

/**
 * Roles & permissions catalog (read-only v1, §E.5).
 *
 * Source of truth for the runtime gate is the hard-coded
 * `auth.RolePermissions` map (backend/internal/auth/rbac.go) — the runtime
 * matcher resolves ONLY these four slugs; everything else collapses to zero
 * permissions. We render that catalog verbatim and surface the C-1 / G-0
 * divergence (the larger IAM-seeded DB catalog whose slugs the runtime gate does
 * not resolve) as a prominent info callout rather than hiding it.
 *
 * There is no read API for this catalog (it is a compiled slice), so v1 mirrors
 * the four runtime slugs client-side. When G-0 reconciliation lands and an
 * endpoint exists, swap this static array for a query.
 */

interface RoleCatalogEntry {
  slug: string;
  /** i18n key suffix for the human label + description. */
  labelKey: string;
  descKey: string;
  /** Permission strings exactly as granted by the runtime matcher. */
  permissions: string[];
  /** True when the slug carries a wildcard that short-circuits every check. */
  wildcard?: boolean;
}

// Mirrors auth.RolePermissions (rbac.go:99). Slugs and permission strings are
// stable identifiers (not localized); only the human label/description are i18n.
const RUNTIME_ROLES: RoleCatalogEntry[] = [
  {
    slug: 'super_admin',
    labelKey: 'roleSuperAdmin',
    descKey: 'roleSuperAdminDesc',
    wildcard: true,
    permissions: ['admin:*', 'siem:supervisory_view'],
  },
  {
    slug: 'tenant_admin',
    labelKey: 'roleTenantAdmin',
    descKey: 'roleTenantAdminDesc',
    permissions: [
      'user:read',
      'user:write',
      'user:delete',
      'role:read',
      'role:write',
      'tenant:read',
      'tenant:write',
      'audit:read',
      'cyber:*',
      'data:*',
      'acta:*',
      'lex:*',
      'lex:approval:*',
      'visus:*',
      'siem:*',
      'dr:*',
      'workflow:*',
      'automation:*',
    ],
  },
  {
    slug: 'analyst',
    labelKey: 'roleAnalyst',
    descKey: 'roleAnalystDesc',
    permissions: [
      'cyber:read',
      'data:read',
      'acta:read',
      'lex:read',
      'lex:approval:read',
      'visus:read',
      'audit:read',
      'siem:read',
      'siem:hunt',
      'dr:read',
      'workflow:read',
      'workflow:task',
      'automation:read',
      'automation:approve',
    ],
  },
  {
    slug: 'viewer',
    labelKey: 'roleViewer',
    descKey: 'roleViewerDesc',
    permissions: [
      'cyber:read',
      'data:read',
      'acta:read',
      'lex:read',
      'lex:approval:read',
      'visus:read',
      'siem:read',
      'dr:read',
      'workflow:read',
      'automation:read',
    ],
  },
];

function PermissionChip({ perm, wildcardTitle }: { perm: string; wildcardTitle: string }) {
  const wildcard = perm.endsWith(':*') || perm === '*';
  return (
    <span
      className="inline-flex items-center rounded-md border border-border/70 bg-secondary/50 px-2 py-0.5 font-mono text-xs text-foreground/80"
      title={wildcard ? wildcardTitle : undefined}
    >
      {perm}
      {wildcard ? (
        <span className="ms-1 text-primary" aria-hidden>
          ✶
        </span>
      ) : null}
    </span>
  );
}

export function RolesCatalogTab() {
  const t = useT();
  return (
    <div className="space-y-5">
      {/* C-1 / G-0 divergence callout — surface, do not hide. */}
      <div
        role="note"
        className="flex gap-3 rounded-xl border border-warning-300/60 bg-warning-50 p-4 text-warning-700 dark:border-warning-700/40 dark:bg-warning-700/15 dark:text-warning-300"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="space-y-1 text-sm leading-6">
          <p className="font-semibold">
            {t('platformConsole.identity.divergenceTitle')}
          </p>
          <p>{t('platformConsole.identity.divergenceBody')}</p>
        </div>
      </div>

      {/* Wildcard semantics legend. */}
      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/70 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="leading-6">{t('platformConsole.identity.wildcardLegend')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {RUNTIME_ROLES.map((role) => (
          <Card key={role.slug} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                  <h3 className="font-semibold text-foreground">
                    {t(`platformConsole.identity.${role.labelKey}` as never)}
                  </h3>
                  <code className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {role.slug}
                  </code>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {t(`platformConsole.identity.${role.descKey}` as never)}
                </p>
              </div>
              {role.wildcard ? (
                <Badge variant="warning" className="shrink-0">
                  {t('platformConsole.identity.wildcard')}
                </Badge>
              ) : (
                <Badge variant="outline" className="shrink-0">
                  {t('platformConsole.identity.scoped')}
                </Badge>
              )}
            </div>
            <div className="mt-4">
              <p className="mb-2 text-overline font-semibold uppercase tracking-wide text-muted-foreground">
                {t('platformConsole.identity.permissionsLabel')} (
                {role.permissions.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {role.permissions.map((perm) => (
                  <PermissionChip
                    key={perm}
                    perm={perm}
                    wildcardTitle={t('platformConsole.identity.wildcardChipTitle')}
                  />
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
