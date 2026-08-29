'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexAdminApi, type OrgRoleKey } from '@/lib/lex/admin';
import type { CoverageLabels } from '../../_lib/escalation-coverage-i18n';
import { OrgUserPicker } from '../org-user-picker';

export interface CoverageAssignTarget {
  entityId: string;
  entityCode: string;
  roleKey: OrgRoleKey;
}

interface CoverageAssignDialogProps {
  /** The prefilled (entity, role) gap to close, or `null` when closed. */
  target: CoverageAssignTarget | null;
  labels: CoverageLabels;
  onOpenChange: (open: boolean) => void;
}

/**
 * Self-contained mini role-assign dialog for the coverage heatmap. It reuses
 * `lexAdminApi.assignOrgRole` directly (NOT the shared org-role dialog) and is
 * prefilled with the clicked cell's entity + role key. On success it shows a
 * toast and invalidates the org-entities query family so the matrix recomputes.
 */
export function CoverageAssignDialog({
  target,
  labels,
  onOpenChange,
}: CoverageAssignDialogProps) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time a new gap is opened.
  useEffect(() => {
    if (target) {
      setUserId('');
      setLabelEn('');
      setLabelAr('');
      setError(null);
    }
  }, [target]);

  const roleLabel = target ? labels.roleKeys[target.roleKey] : '';

  const assign = useMutation({
    mutationFn: () => {
      if (!target) {
        return Promise.reject(new Error('no target'));
      }
      return lexAdminApi.assignOrgRole(target.entityId, {
        role_key: target.roleKey,
        user_id: userId.trim(),
        label: { en: labelEn.trim(), ar: labelAr.trim() },
      });
    },
    onSuccess: async () => {
      showSuccess(labels.dialogToastAssigned);
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-entities'] });
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) {
      setError(labels.dialogUserRequired);
      return;
    }
    setError(null);
    assign.mutate();
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.dialogTitle}</DialogTitle>
          <DialogDescription>
            {target ? labels.dialogDescription(target.entityCode, roleLabel) : ''}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <LexCreationGuidance workflow="organization" />
          <div className="space-y-1.5">
            <label htmlFor="coverage-user-id" className="text-sm font-medium">
              {labels.dialogUser}
              <span className="ms-1 text-rose-600">*</span>
            </label>
            <OrgUserPicker
              id="coverage-user-id"
              enabled={target !== null}
              value={userId}
              onChange={(nextUserId) => {
                setUserId(nextUserId);
                if (nextUserId) setError(null);
              }}
              labels={{
                user: labels.dialogUser,
                selectUser: labels.dialogSelectUser,
                searchUsers: labels.dialogSearchUsers,
                loadingUsers: labels.dialogLoadingUsers,
                noUsers: labels.dialogNoUsers,
                usersLoadError: labels.dialogUsersLoadError,
                retry: labels.dialogRetry,
              }}
              disabled={assign.isPending}
            />
            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="coverage-label-en" className="text-sm font-medium">
                {labels.dialogLabelEn}
              </label>
              <Input
                id="coverage-label-en"
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="coverage-label-ar" className="text-sm font-medium">
                {labels.dialogLabelAr}
              </label>
              <Input
                id="coverage-label-ar"
                dir="rtl"
                value={labelAr}
                onChange={(e) => setLabelAr(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.dialogCancel}
            </Button>
            <Button type="submit" disabled={assign.isPending}>
              {assign.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {labels.dialogSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
