'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Mail, PencilLine, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTableRowActions } from '@/components/shared/data-table/data-table-row-actions';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import type { RowAction } from '@/types/table';
import {
  lexAdminApi,
  type IntakeMailbox,
  type OrgEntity,
  type ServiceCatalogEntry,
} from '@/lib/lex/admin';
import { useAdminCommonLabels, useServiceCatalogLabels } from '../../_lib/admin-labels';
import { MailboxFormDialog } from './mailbox-form-dialog';

interface Props {
  mailboxes: IntakeMailbox[];
  services: ServiceCatalogEntry[];
  orgEntities: OrgEntity[];
  requestTypeOptions: string[];
  canWrite: boolean;
  locale: AppLocale;
  loading?: boolean;
}

const MAILBOX_QUERY_KEY = ['lex-admin-intake-mailboxes'] as const;

export function MailboxAdminSection({
  mailboxes,
  services,
  orgEntities,
  requestTypeOptions,
  canWrite,
  locale,
  loading,
}: Props) {
  const t = useServiceCatalogLabels();
  const m = t.mailboxAdmin;
  const common = useAdminCommonLabels();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<IntakeMailbox | null>(null);
  const [deleting, setDeleting] = useState<IntakeMailbox | null>(null);

  const serviceById = useMemo(() => {
    const map = new Map<string, ServiceCatalogEntry>();
    for (const service of services) map.set(service.id, service);
    return map;
  }, [services]);

  const del = useMutation({
    mutationFn: (id: string) => lexAdminApi.deleteIntakeMailbox(id),
    onSuccess: async () => {
      showSuccess(m.toast.deleted);
      await qc.invalidateQueries({ queryKey: MAILBOX_QUERY_KEY });
      setDeleting(null);
    },
    onError: showApiError,
  });

  const rowActions: RowAction<IntakeMailbox>[] = canWrite
    ? [
        { label: common.edit, icon: PencilLine, onClick: (row) => setEditing(row) },
        { label: m.rowRotate, icon: KeyRound, onClick: (row) => setEditing(row) },
        {
          label: common.delete,
          icon: Trash2,
          variant: 'destructive' as const,
          onClick: (row) => setDeleting(row),
        },
      ]
    : [];

  const serviceCell = (mailbox: IntakeMailbox): string => {
    if (!mailbox.service_id) return m.noService;
    const service = serviceById.get(mailbox.service_id);
    return service ? resolveLocalized(service.name, locale) || service.code : m.noService;
  };

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <Mail className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">{m.title}</h3>
            <p className="text-xs text-muted-foreground">{m.description}</p>
          </div>
        </div>
        {canWrite ? (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="me-1.5 h-4 w-4" />
            {m.addButton}
          </Button>
        ) : null}
      </div>

      {mailboxes.length === 0 ? (
        <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
          {loading ? `${t.adminPanels.checking}…` : m.empty}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m.columns.address}</TableHead>
                <TableHead>{m.columns.requestType}</TableHead>
                <TableHead>{m.columns.service}</TableHead>
                <TableHead>{m.columns.status}</TableHead>
                {canWrite ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {mailboxes.map((mailbox) => (
                <TableRow key={mailbox.id}>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {mailbox.address}
                  </TableCell>
                  <TableCell className="text-sm">{mailbox.request_type}</TableCell>
                  <TableCell className="text-sm">{serviceCell(mailbox)}</TableCell>
                  <TableCell>
                    <Badge variant={mailbox.active ? 'default' : 'outline'}>
                      {mailbox.active ? common.active : common.inactive}
                    </Badge>
                  </TableCell>
                  {canWrite ? (
                    <TableCell className="text-end">
                      <DataTableRowActions row={mailbox} actions={rowActions} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canWrite ? (
        <>
          <MailboxFormDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            services={services}
            orgEntities={orgEntities}
            requestTypeOptions={requestTypeOptions}
          />
          <MailboxFormDialog
            mailbox={editing}
            mode="edit"
            open={editing !== null}
            onOpenChange={(o) => !o && setEditing(null)}
            services={services}
            orgEntities={orgEntities}
            requestTypeOptions={requestTypeOptions}
          />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(o) => !o && setDeleting(null)}
            title={m.deleteConfirm.title}
            description={m.deleteConfirm.description(deleting?.address ?? '')}
            confirmLabel={common.delete}
            variant="destructive"
            loading={del.isPending}
            onConfirm={async () => {
              if (deleting) await del.mutateAsync(deleting.id);
            }}
          />
        </>
      ) : null}
    </section>
  );
}
