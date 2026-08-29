'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GitBranch, PencilLine, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { SectionCard } from '@/components/suites/section-card';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { showApiError, showSuccess } from '@/lib/toast';
import { casesApi, type CaseClassification } from '@/lib/lex/cases';
import { ClassificationFormDialog } from './_components/classification-form-dialog';
import { useCaseLabels } from '../_components/labels';

const CLASSIFICATIONS_ENDPOINT = '/api/v1/lex/case-classifications';

export default function CaseClassificationsPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const labels = useCaseLabels();
  const t = labels.classification;
  // §13 — case-classification authoring is catalog configuration; gate the
  // create/edit/delete controls on lex:catalog:manage (viewing remains case:view
  // via the page guard). `lex:*` wildcard satisfies this for super-admins.
  const canWrite = hasPermission('lex:catalog:manage');
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CaseClassification | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CaseClassification | null>(null);
  const [cascadeId, setCascadeId] = useState<string | null>(null);

  const { tableProps, searchValue, setSearch, refetch } = useDataTable<CaseClassification>({
    queryKey: 'lex-case-classifications',
    fetchFn: (params) => fetchSuitePaginated<CaseClassification>(CLASSIFICATIONS_ENDPOINT, params),
    defaultPageSize: 50,
    defaultSort: { column: 'sort', direction: 'asc' },
    wsTopics: ['lex.case-classifications'],
  });

  const cascadeQuery = useQuery({
    queryKey: ['lex-case-classification-cascade', cascadeId],
    queryFn: () => casesApi.getClassificationCascade(cascadeId as string),
    enabled: Boolean(cascadeId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => casesApi.deleteClassification(id),
    onSuccess: async () => {
      showSuccess(labels.toast.classificationDeleted);
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['lex-case-classifications'] });
      refetch();
    },
    onError: showApiError,
  });

  const columns: ColumnDef<CaseClassification>[] = useMemo(
    () => [
      {
        id: 'code',
        accessorKey: 'code',
        header: t.columns.code,
        enableSorting: true,
        cell: ({ row }) => (
          <button
            type="button"
            className="font-medium hover:underline"
            onClick={() => setCascadeId(row.original.id)}
          >
            {row.original.code}
          </button>
        ),
      },
      {
        id: 'name',
        header: t.columns.name,
        cell: ({ row }) => <span className="text-sm">{resolveLocalized(row.original.name, locale)}</span>,
      },
      {
        id: 'path',
        header: t.columns.path,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.path.length > 1 ? row.original.path.join(' / ') : t.rootLevel}
          </span>
        ),
      },
      {
        id: 'active',
        accessorKey: 'active',
        header: t.columns.active,
        cell: ({ row }) => (
          <Badge variant={row.original.active ? 'success' : 'secondary'}>
            {row.original.active ? t.activeBadge : t.inactiveBadge}
          </Badge>
        ),
      },
      {
        id: 'system',
        accessorKey: 'is_system',
        header: t.columns.system,
        cell: ({ row }) => (row.original.is_system ? <Badge variant="outline">{t.systemBadge}</Badge> : null),
      },
      ...(canWrite
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: CaseClassification } }) => (
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditTarget(row.original)}>
                    <PencilLine className="h-3.5 w-3.5" />
                  </Button>
                  {!row.original.is_system ? (
                    <Button size="sm" variant="outline" onClick={() => setDeleteTarget(row.original)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              ),
            } as ColumnDef<CaseClassification>,
          ]
        : []),
    ],
    [t, locale, canWrite],
  );

  const cascade = cascadeQuery.data;

  return (
    <LexRouteGuard requirement="lex:case:view">
      <div dir={direction} lang={locale} className="space-y-6">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link href="/lex/cases">
              <ArrowRight className="me-1.5 h-3.5 w-3.5 rtl:-scale-x-100" />
              {labels.detail.back}
            </Link>
          </Button>
          <PageHeader
            title={t.pageTitle}
            description={t.pageDescription}
            actions={
              canWrite ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="me-1.5 h-4 w-4" />
                  {t.add}
                </Button>
              ) : undefined
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.6fr]">
          <DataTable
            {...tableProps}
            columns={columns}
            getRowId={(row) => row.id}
            searchSlot={
              <SearchInput
                value={searchValue}
                onChange={setSearch}
                placeholder={t.searchPlaceholder}
                loading={tableProps.isLoading}
              />
            }
            emptyState={{
              icon: GitBranch,
              title: t.emptyTitle,
              description: t.emptyDescription,
            }}
          />

          <SectionCard title={t.cascadeTitle} description={t.cascadeDescription}>
            {!cascadeId ? (
              <p className="text-sm text-muted-foreground">{t.cascadeEmpty}</p>
            ) : cascadeQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t.cascadeTitle}…</p>
            ) : cascade ? (
              <ol className="relative space-y-3 border-s ps-5">
                {cascade.chain.map((node, index) => (
                  <li key={node.id} className="relative">
                    <span
                      className="absolute -start-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary"
                      aria-hidden
                    />
                    <p className="text-sm font-medium">
                      {node.code} — {resolveLocalized(node.name, locale)}
                    </p>
                    {index < cascade.chain.length - 1 ? (
                      <span className="text-xs text-muted-foreground">↓</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">{t.cascadeEmpty}</p>
            )}
          </SectionCard>
        </div>

        {canWrite ? (
          <>
            <ClassificationFormDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              onSaved={() => refetch()}
            />
            <ClassificationFormDialog
              classification={editTarget}
              open={Boolean(editTarget)}
              onOpenChange={(open) => {
                if (!open) setEditTarget(null);
              }}
              onSaved={() => refetch()}
            />
            <ConfirmDialog
              open={Boolean(deleteTarget)}
              onOpenChange={(open) => {
                if (!open) setDeleteTarget(null);
              }}
              title={t.confirm.deleteTitle}
              description={t.confirm.deleteDescription(deleteTarget?.code ?? '')}
              confirmLabel={t.delete}
              variant="destructive"
              loading={deleteMutation.isPending}
              onConfirm={async () => {
                if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id);
              }}
            />
          </>
        ) : null}
      </div>
    </LexRouteGuard>
  );
}
