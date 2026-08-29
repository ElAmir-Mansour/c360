'use client';

import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { useLocale } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useRoleMatrixLabels } from './_lib/role-matrix-labels';
import { RoleMatrixLegend } from './_components/role-matrix-legend';
import { RoleMatrixGrid } from './_components/role-matrix-grid';
import { RoleMatrixPrinciples } from './_components/role-matrix-principles';
import { RoleMatrixImportDialog } from './_components/role-matrix-import-dialog';
import { RoleMatrixVersionsDialog } from './_components/role-matrix-versions-dialog';

/**
 * Legal Role Matrix — the legal roles × capability-domain grid, rendered from
 * the SAME role permission sets the server enforces (design v2 §6): the
 * canonical source in `_lib/legal-role-permissions.ts` reconciled against the
 * tenant's live `/api/v1/roles`, so doc↔runtime drift is visible.
 *
 * The grid itself grants nothing. The header hosts the tenant Role-Matrix
 * IMPORT (template-driven, validated, versioned; lex:role:manage) and the
 * version history/activation (four-eyes — the importer can never activate
 * their own version; the server enforces this). Viewers with lex:role:view
 * can inspect versions read-only.
 */
export default function LexRoleMatrixPage() {
  const { locale, direction } = useLocale();
  const { hasPermission } = useAuth();
  const t = useRoleMatrixLabels();
  const canManage = hasPermission('lex:role:manage');

  return (
    <LexAccessGuard routeKey="/lex/admin/role-matrix" resourceName={t.pageTitle}>
      <div dir={direction} lang={locale} className="space-y-6 motion-safe:animate-fade-up">
        <PageHeader
          title={t.pageTitle}
          description={t.pageDescription}
          eyebrow={t.eyebrow}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <RoleMatrixVersionsDialog canManage={canManage} />
              {canManage ? <RoleMatrixImportDialog /> : null}
            </div>
          }
        />
        <RoleMatrixLegend />
        <RoleMatrixGrid />
        <RoleMatrixPrinciples />
      </div>
    </LexAccessGuard>
  );
}
