'use client';

/**
 * Role-matrix version history + four-eyes activation (mirrors the
 * approval-policy versions dialog). Listing needs lex:role:view; the
 * activate/rollback buttons render only for lex:role:manage holders — and the
 * SERVER additionally enforces that the importer cannot activate their own
 * version (RequireDistinctActor + a service-level re-check), so a 403 here is
 * the four-eyes control working, not a bug.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexAdminApi, type RoleMatrixVersion } from '@/lib/lex/admin';
import { useRoleMatrixImportLabels } from '../_lib/role-matrix-import-i18n';

export function RoleMatrixVersionsDialog({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const t = useRoleMatrixImportLabels();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<RoleMatrixVersion | null>(null);

  const versions = useQuery({
    queryKey: ['lex-role-matrix-versions'],
    queryFn: lexAdminApi.listRoleMatrixVersions,
    enabled: open,
  });

  const activateMutation = useMutation({
    mutationFn: (version: RoleMatrixVersion) =>
      version.status === 'superseded'
        ? lexAdminApi.rollbackRoleMatrixVersion(version.id)
        : lexAdminApi.activateRoleMatrixVersion(version.id),
    onSuccess: async () => {
      showSuccess(t.activated);
      setTarget(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['lex-role-matrix-versions'] }),
        // The live grid reconciles against /api/v1/roles — refresh it too.
        qc.invalidateQueries({ queryKey: ['roles'] }),
      ]);
    },
    onError: showApiError,
  });

  const badgeVariant = (status: RoleMatrixVersion['status']) =>
    status === 'active' ? 'success' : status === 'draft' ? 'secondary' : 'outline';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <History className="me-1.5 h-3.5 w-3.5" />
          {t.versionsCta}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.versionsTitle}</DialogTitle>
          <DialogDescription>{t.versionsDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          {t.fourEyesNote}
        </div>

        {versions.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}

        <div className="space-y-2">
          {(versions.data ?? []).map((version) => (
            <div key={version.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{t.versionLine(version.version)}</p>
                  <Badge variant={badgeVariant(version.status)}>{t.versionStatus[version.status]}</Badge>
                  <Badge variant="outline">{t.rolesCount(version.snapshot.length)}</Badge>
                </div>
                {canManage && version.status !== 'active' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={version.status === 'draft' ? 'default' : 'outline'}
                    onClick={() => setTarget(version)}
                  >
                    {version.status === 'draft' ? t.activate : t.rollback}
                  </Button>
                ) : null}
              </div>
              {version.change_reason ? (
                <p className="mt-1 text-sm text-muted-foreground" dir="auto">{version.change_reason}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {version.source_filename ? `${version.source_filename} · ` : ''}
                {new Date(version.created_at).toLocaleString()}
                {version.activated_at ? ` · ${t.versionStatus.active}: ${new Date(version.activated_at).toLocaleString()}` : ''}
              </p>
            </div>
          ))}
          {!versions.isLoading && !versions.data?.length ? (
            <p className="text-sm text-muted-foreground">{t.noVersions}</p>
          ) : null}
        </div>

        <ConfirmDialog
          open={Boolean(target)}
          onOpenChange={(next) => {
            if (!next) setTarget(null);
          }}
          title={t.confirmActivateTitle}
          description={t.confirmActivateDescription}
          confirmLabel={target?.status === 'superseded' ? t.rollback : t.activate}
          loading={activateMutation.isPending}
          onConfirm={async () => {
            if (target) await activateMutation.mutateAsync(target);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
