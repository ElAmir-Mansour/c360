'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { apiPut } from '@/lib/api';
import { isApiError } from '@/types/api';
import type { User } from '@/types/models';
import { useAdminT } from '../../_lib/admin-i18n';

interface UserStatusDialogProps {
  user: User;
  targetStatus: 'active' | 'suspended';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function UserStatusDialog({
  user,
  targetStatus,
  open,
  onOpenChange,
  onSuccess,
}: UserStatusDialogProps) {
  const labels = useAdminT();
  const [loading, setLoading] = useState(false);
  const name = `${user.first_name} ${user.last_name}`.trim();
  const isSuspending = targetStatus === 'suspended';

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await apiPut(`/api/v1/users/${user.id}/status`, { status: targetStatus });
      toast.success(
        isSuspending
          ? labels.users.userSuspendedFull(name)
          : labels.users.userActivatedFull(name)
      );
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      const msg = isApiError(err) ? err.message : labels.users.statusUpdateFailed;
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isSuspending ? labels.users.suspendUser : labels.users.activateUser}
      description={
        isSuspending
          ? labels.users.suspendUserDescription(name)
          : labels.users.activateUserDescription(name)
      }
      confirmLabel={isSuspending ? labels.users.suspendUser : labels.users.activateUser}
      variant={isSuspending ? 'destructive' : 'default'}
      onConfirm={handleConfirm}
      loading={loading}
    />
  );
}
