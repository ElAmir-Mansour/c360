'use client';

/**
 * #6 Route dialog — a confirm dialog that calls `routeRequest(id)` to route an
 * approved request (spawns the legal matter + moves to execution). Mounts only
 * when `status === 'approved'`. Reuses the shared {@link ConfirmDialog}.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexRequestsApi } from '@/lib/lex/requests';
import { useDetailExtraLabels } from './detail-extra-labels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  onChanged?: () => void;
}

export function RouteRequestDialog({ open, onOpenChange, requestId, onChanged }: Props) {
  const labels = useDetailExtraLabels();
  const t = labels.route;
  const qc = useQueryClient();

  const routeMutation = useMutation({
    mutationFn: () => lexRequestsApi.routeRequest(requestId),
    onSuccess: async () => {
      showSuccess(t.toast);
      await qc.invalidateQueries({ queryKey: ['lex-legal-request', requestId] });
      await qc.invalidateQueries({ queryKey: ['lex-legal-requests'] });
      onChanged?.();
    },
    onError: showApiError,
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.dialogTitle}
      description={t.dialogDescription}
      confirmLabel={t.confirm}
      loading={routeMutation.isPending}
      onConfirm={async () => {
        await routeMutation.mutateAsync();
      }}
    />
  );
}
