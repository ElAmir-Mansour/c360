'use client';

import { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { BookOpenCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { LexStatusChip } from '@/components/lex/status-chip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { enterpriseApi } from '@/lib/enterprise';
import { useLexFormat } from '@/lib/lex/ksa';
import type { FilterConfig } from '@/types/table';
import type { LexClausePlaybook } from '@/types/suites';
import { usePlaybookLabels } from './labels';
import {
  CONTRACT_TYPES,
  PLAYBOOK_STATUSES,
  formatToken,
} from './playbook-form';

interface PlaybookCatalogProps {
  /** Whether the current user may mutate playbooks (lex:write). Gates actions. */
  canWrite: boolean;
  /** Open the edit dialog for the given playbook (page owns the dialog). */
  onEdit: (playbook: LexClausePlaybook) => void;
  /** Open the delete confirm for the given playbook (page owns the confirm). */
  onDelete: (playbook: LexClausePlaybook) => void;
  /** Open the blank create dialog — wired to the empty-state CTA (page owns it). */
  onCreate?: () => void;
}

/**
 * The playbook catalog rendered via the shared {@link DataTable}. Search,
 * contract-type / status filters, sortable columns, and real pagination are all
 * URL-driven through {@link useDataTable}. Contract-type and status ride
 * `FetchParams.filters` as `contract_type` / `status`; `search` / `sort` /
 * `order` are top-level. The page keeps ownership of the create/edit dialog,
 * delete confirm, and the mutations + cache invalidations.
 */
export function PlaybookCatalog({
  canWrite,
  onEdit,
  onDelete,
  onCreate,
}: PlaybookCatalogProps) {
  const labels = usePlaybookLabels();
  const f = useLexFormat();

  const { tableProps, searchValue, setSearch } =
    useDataTable<LexClausePlaybook>({
      queryKey: 'lex-playbooks',
      fetchFn: (params) => enterpriseApi.lex.listPlaybooks(params),
      defaultPageSize: 25,
      defaultSort: { column: 'updated_at', direction: 'desc' },
    });

  const filters: FilterConfig[] = useMemo(
    () => [
      {
        key: 'contract_type',
        label: labels.catalog.filterContractType,
        type: 'select',
        placeholder: labels.catalog.allTypes,
        options: CONTRACT_TYPES.map((value) => ({
          label: labels.contractTypeLabels[value] ?? formatToken(value),
          value,
        })),
      },
      {
        key: 'status',
        label: labels.catalog.filterStatus,
        type: 'select',
        placeholder: labels.catalog.allStatuses,
        options: PLAYBOOK_STATUSES.map((value) => ({
          label: labels.statusLabels[value] ?? formatToken(value),
          value,
        })),
      },
    ],
    [labels.catalog, labels.contractTypeLabels, labels.statusLabels],
  );

  const columns = useMemo<ColumnDef<LexClausePlaybook>[]>(
    () => [
      {
        id: 'name',
        header: labels.catalog.columns.playbook,
        enableSorting: true,
        cell: ({ row }) => {
          const playbook = row.original;
          return (
            <div className="min-w-[240px] space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">
                  {playbook.name}
                </span>
                <LexStatusChip
                  value={playbook.status}
                  kind="generic"
                  size="sm"
                />
              </div>
              {playbook.description ? (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {playbook.description}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'contract_type',
        header: labels.catalog.columns.scope,
        enableSorting: true,
        cell: ({ row }) => {
          const playbook = row.original;
          return (
            <Badge variant="outline">
              {playbook.contract_type
                ? labels.contractTypeLabels[String(playbook.contract_type)] ??
                  formatToken(String(playbook.contract_type))
                : labels.anyType}
            </Badge>
          );
        },
      },
      {
        id: 'clauses',
        header: labels.catalog.columns.clauses,
        enableSorting: false,
        cell: ({ row }) => {
          const playbook = row.original;
          const requiredCount = playbook.clauses.filter(
            (clause) => clause.required,
          ).length;
          return (
            <div className="space-y-1.5">
              <p className="text-sm tabular-nums">
                {labels.catalog.clauseCount(
                  playbook.clauses.length,
                  requiredCount,
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {playbook.clauses.slice(0, 3).map((clause) => (
                  <Badge
                    key={`${playbook.id}-${clause.clause_type}-${clause.title}`}
                    variant="secondary"
                  >
                    {labels.clauseTypeLabels[String(clause.clause_type)] ??
                      formatToken(String(clause.clause_type))}
                  </Badge>
                ))}
                {playbook.clauses.length > 3 ? (
                  <Badge variant="outline">
                    +{playbook.clauses.length - 3}
                  </Badge>
                ) : null}
              </div>
            </div>
          );
        },
      },
      {
        id: 'updated_at',
        header: labels.catalog.columns.updated,
        enableSorting: true,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <span className="text-sm text-foreground">
              {f.formatRelative(row.original.updated_at)}
            </span>
            <p className="text-xs text-muted-foreground" dir="auto">
              {f.formatDual(row.original.updated_at)}
            </p>
          </div>
        ),
      },
      ...(canWrite
        ? [
            {
              id: 'actions',
              header: labels.catalog.columns.actions,
              enableSorting: false,
              cell: ({ row }) => {
                const playbook = row.original;
                return (
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(playbook)}
                      aria-label={labels.catalog.editAction(playbook.name)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(playbook)}
                      aria-label={labels.catalog.deleteAction(playbook.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              },
            } satisfies ColumnDef<LexClausePlaybook>,
          ]
        : []),
    ],
    [canWrite, labels, onDelete, onEdit, f],
  );

  return (
    <DataTable
      {...tableProps}
      columns={columns}
      filters={filters}
      getRowId={(row) => row.id}
      searchSlot={
        <SearchInput
          value={searchValue}
          onChange={setSearch}
          placeholder={labels.catalog.search}
          loading={tableProps.isLoading}
        />
      }
      emptyState={{
        icon: BookOpenCheck,
        title: labels.catalog.emptyTitle,
        description: labels.catalog.emptyDescription,
        action:
          canWrite && onCreate
            ? {
                label: labels.catalog.emptyCta,
                onClick: onCreate,
                icon: Plus,
              }
            : undefined,
      }}
    />
  );
}
