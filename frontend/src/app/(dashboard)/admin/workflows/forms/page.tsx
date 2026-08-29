'use client';

/**
 * Forms admin page — the dedicated authoring surface for canonical
 * {@link FormDefinition}s. It lists the tenant's forms, and lets an author
 * create / edit / delete them through {@link FormDefinitionDialog}, which closes
 * the design -> save -> reload -> render loop (live preview via the runtime
 * TaskFormRenderer).
 *
 * Permission-gated like the other admin pages: `workflow:read` to view,
 * `workflow:write` to author (the New / Edit / Delete controls).
 */
import { useState } from 'react';
import { FilePlus2, FileText, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FormDefinitionDialog } from './_components/form-definition-dialog';
import { useFormsList, useDeleteForm } from '@/hooks/use-forms';
import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/components/providers/locale-provider';
import { useFormat } from '@/lib/format/index';
import { getFormVersionBadge, useFormsLocalLabels } from './forms-i18n';
import type { FormDefinition } from '@/types/forms';

function FormsAdmin() {
  const t = useT('admin');
  const labels = useFormsLocalLabels();
  const { formatNumber } = useFormat();
  const { hasPermission } = useAuth();
  const canAuthor = hasPermission('workflow:write');

  const { data: forms, isLoading, isError, refetch } = useFormsList();
  const deleteMutation = useDeleteForm();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FormDefinition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FormDefinition | null>(null);

  const openCreate = () => {
    setEditTarget(null);
    setEditorOpen(true);
  };

  const openEdit = (form: FormDefinition) => {
    setEditTarget(form);
    setEditorOpen(true);
  };

  const header = (
    <PageHeader
      title={t('fp.title')}
      description={t('fp.desc')}
      actions={
        canAuthor ? (
          <Button onClick={openCreate}>
            <FilePlus2 className="me-2 h-4 w-4" />
            {t('fp.newForm')}
          </Button>
        ) : undefined
      }
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingSkeleton variant="card" count={6} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title={t('fp.failedTitle')}
          message={t('fp.failedDesc')}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const items = forms ?? [];

  return (
    <div className="space-y-6">
      {header}

      {items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t('fp.emptyTitle')}
          description={t('fp.emptyDesc')}
          action={
            canAuthor
              ? { label: t('fp.newForm'), onClick: openCreate }
              : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((form) => (
            <Card key={form.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <CardTitle className="truncate font-mono text-base">
                      {form.name}
                    </CardTitle>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {getFormVersionBadge(labels, formatNumber(form.version))}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="mb-4 flex items-center gap-3 text-sm text-muted-foreground">
                  <span>
                    {formatNumber(form.fields?.length ?? 0)}{' '}
                    {(form.fields?.length ?? 0) === 1 ? t('fp.fieldSingular') : t('fp.fieldPlural')}
                  </span>
                  <span className="flex items-center gap-1">
                    {(form.locales ?? []).map((loc) => (
                      <Badge
                        key={loc}
                        variant="secondary"
                        className="text-overline uppercase"
                      >
                        {loc}
                      </Badge>
                    ))}
                  </span>
                </div>
                {canAuthor && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => openEdit(form)}
                    >
                      <Pencil className="me-2 h-3.5 w-3.5" />
                      {t('fp.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteTarget(form)}
                      aria-label={t('fp.deleteAria', { name: form.name })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {canAuthor && (
        <FormDefinitionDialog
          form={editTarget}
          open={editorOpen}
          onOpenChange={(o) => {
            setEditorOpen(o);
            if (!o) setEditTarget(null);
          }}
          onSaved={() => refetch()}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          title={t('fp.deleteTitle')}
          description={t('fp.deleteDesc', { name: deleteTarget.name })}
          confirmLabel={t('fp.deleteConfirm')}
          variant="destructive"
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

export default function FormsAdminPage() {
  return (
    <PermissionRedirect permission="workflow:read">
      <FormsAdmin />
    </PermissionRedirect>
  );
}
