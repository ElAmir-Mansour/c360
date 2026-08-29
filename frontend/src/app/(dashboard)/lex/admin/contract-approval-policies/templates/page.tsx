'use client';

/**
 * Contract Approval-Policy Templates administration surface (Watheeq legal
 * suite).
 *
 * Lists reusable named policy definitions a concrete contract approval policy
 * can be materialised from. Supports create / edit / delete and an
 * "instantiate → policy" action against the governance routes
 * (`/workflow-policies/approval/templates**`). Gated under the granular
 * `lex:approval:*` permissions; writes require `lex:approval:admin` or
 * `lex:approval:write`; delete additionally checks `lex:approval:admin`.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileStack, Layers, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import type { PermissionRequirement } from '@/lib/permissions';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { StatTile } from '@/components/shared/stat-tile';
import { RelativeTime } from '@/components/shared/relative-time';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import { enterpriseApi, type LexApprovalPolicyTemplate } from '@/lib/enterprise/api';
import { useContractApprovalPolicyLabels } from '../_labels';
import { InstantiateTemplateDialog } from './_components/instantiate-template-dialog';
import { TemplateFormDialog } from './_components/template-form-dialog';
import { TEMPLATES_QUERY_KEY } from './_components/query-keys';

const GOVERNANCE_REQUIREMENT: PermissionRequirement = {
  anyOf: ['lex:approval:read', 'lex:approval:admin'],
};
const GOVERNANCE_HREF = '/lex/admin/contract-approval-policies';
const EMPTY_TEMPLATES: LexApprovalPolicyTemplate[] = [];

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function ContractApprovalPolicyTemplatesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const labels = useContractApprovalPolicyLabels();
  const t = labels.templates;

  const canWrite = hasPermission('lex:approval:admin') || hasPermission('lex:approval:write');
  const canDelete = hasPermission('lex:approval:admin');

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LexApprovalPolicyTemplate | null>(null);
  const [deleting, setDeleting] = useState<LexApprovalPolicyTemplate | null>(null);
  const [instantiating, setInstantiating] = useState<LexApprovalPolicyTemplate | null>(null);

  const templatesQuery = useQuery({
    queryKey: TEMPLATES_QUERY_KEY,
    queryFn: () => enterpriseApi.lex.listApprovalPolicyTemplates(),
  });

  const templates = templatesQuery.data ?? EMPTY_TEMPLATES;
  const categoryCount = useMemo(
    () => new Set(templates.map((template) => template.category).filter(Boolean)).size,
    [templates],
  );
  const categorizedCount = useMemo(
    () => templates.filter((template) => Boolean(template.category)).length,
    [templates],
  );
  const categorizedShare = percent(categorizedCount, templates.length);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.deleteApprovalPolicyTemplate(id),
    onSuccess: async () => {
      showSuccess(t.toast.deleted);
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY });
    },
    onError: showApiError,
  });

  return (
    <LexAccessGuard requirement={GOVERNANCE_REQUIREMENT} resourceName={t.pageTitle}>
      <div className="space-y-6" dir={direction} lang={locale}>
        <Button variant="link" size="sm" className="h-auto p-0" asChild>
          <Link href={GOVERNANCE_HREF} className="inline-flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
            {t.backToPolicies}
          </Link>
        </Button>

        <PageHeader
          title={t.pageTitle}
          description={t.pageDescription}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link href={GOVERNANCE_HREF}>{t.policiesLink}</Link>
              </Button>
              {canWrite ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="me-1.5 h-4 w-4" />
                  {t.newTemplate}
                </Button>
              ) : null}
            </div>
          }
        />

        <div className="contract-approval-template-kpi-grid grid grid-cols-2 gap-3">
          <StatTile
            label={t.metrics.templates}
            value={templates.length}
            icon={FileStack}
            themeClass="kpi-theme-primary"
            detail={t.metricCopy.currentCatalog}
            detailValue={t.metricCopy.policyTemplates}
            size="md"
            appearance="operational"
            className="contract-approval-template-kpi-card"
            href="#contract-approval-template-catalog"
          />
          <StatTile
            label={t.metrics.categories}
            value={categoryCount}
            icon={Layers}
            themeClass="kpi-theme-emerald"
            progress={categorizedShare}
            progressLabel={t.metricCopy.categorizedShare}
            detail={t.metricCopy.currentCatalog}
            detailValue={`${categorizedShare}%`}
            size="md"
            appearance="operational"
            className="contract-approval-template-kpi-card"
            href="#contract-approval-template-catalog"
          />
        </div>

        <div id="contract-approval-template-catalog" className="scroll-mt-24">
          <SectionCard title={t.catalog.title} description={t.catalog.description}>
            {templatesQuery.isLoading ? (
              <LoadingSkeleton variant="table-row" count={5} />
            ) : templatesQuery.isError ? (
              <ErrorState message={t.catalog.loadError} onRetry={() => void templatesQuery.refetch()} />
            ) : templates.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                <p className="text-sm font-medium">{t.catalog.emptyTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t.catalog.emptyDescription}</p>
                {canWrite ? (
                  <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                    <Plus className="me-1.5 h-4 w-4" />
                    {t.newTemplate}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.catalog.columns.template}</TableHead>
                      <TableHead>{t.catalog.columns.category}</TableHead>
                      <TableHead>{t.catalog.columns.description}</TableHead>
                      <TableHead>{t.catalog.columns.updated}</TableHead>
                      {canWrite ? <TableHead className="text-end">{t.catalog.columns.actions}</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((template) => (
                      <TableRow key={template.id}>
                        <TableCell className="min-w-[200px] font-medium">{template.name}</TableCell>
                        <TableCell>
                          {template.category ? (
                            <Badge variant="outline">{template.category}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t.catalog.uncategorized}</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          {template.description ? (
                            <p className="line-clamp-2 text-sm text-muted-foreground">{template.description}</p>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t.catalog.noDescription}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <RelativeTime date={template.updated_at} />
                        </TableCell>
                        {canWrite ? (
                          <TableCell className="text-end">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setInstantiating(template)}
                                aria-label={t.catalog.instantiateAria(template.name)}
                              >
                                <Sparkles className="me-1 h-3.5 w-3.5" />
                                {t.catalog.instantiate}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditing(template)}
                                aria-label={t.catalog.editAria(template.name)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {canDelete ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setDeleting(template)}
                                  aria-label={t.catalog.deleteAria(template.name)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </div>

        <TemplateFormDialog labels={labels} open={createOpen} onOpenChange={setCreateOpen} />
        <TemplateFormDialog
          labels={labels}
          template={editing}
          open={editing != null}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
            }
          }}
        />
        <InstantiateTemplateDialog
          labels={labels}
          template={instantiating}
          open={instantiating != null}
          onOpenChange={(open) => {
            if (!open) {
              setInstantiating(null);
            }
          }}
        />
        <ConfirmDialog
          open={deleting != null}
          onOpenChange={(open) => {
            if (!open) {
              setDeleting(null);
            }
          }}
          title={t.deleteConfirm.title}
          description={deleting ? t.deleteConfirm.description(deleting.name) : t.deleteConfirm.fallbackDescription}
          confirmLabel={t.deleteConfirm.confirm}
          variant="destructive"
          loading={deleteMutation.isPending}
          onConfirm={() => {
            if (deleting) {
              deleteMutation.mutate(deleting.id);
            }
          }}
        />
      </div>
    </LexAccessGuard>
  );
}
