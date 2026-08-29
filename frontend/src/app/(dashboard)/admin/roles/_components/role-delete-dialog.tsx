'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { apiDelete } from '@/lib/api';
import { isApiError } from '@/types/api';
import type { Role } from '@/types/models';
import { useAdminT } from '../../_lib/admin-i18n';

interface RoleDeleteDialogProps {
  role: Role;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RoleDeleteDialog({
  role,
  open,
  onOpenChange,
  onSuccess,
}: RoleDeleteDialogProps) {
  const labels = useAdminT();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await apiDelete(`/api/v1/roles/${role.id}`);
      toast.success(labels.roles.roleDeletedFull(role.name));
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      const msg = isApiError(err) ? err.message : labels.roles.roleDeleteFailed;
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={labels.roles.deleteRoleLong}
      description={labels.roles.deleteRoleLongDescription(role.name)}
      confirmLabel={labels.roles.deleteRoleLong}
      variant="destructive"
      typeToConfirm={role.name}
      onConfirm={handleConfirm}
      loading={loading}
    />
  );
}
