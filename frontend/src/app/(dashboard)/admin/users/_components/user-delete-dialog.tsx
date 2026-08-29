'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { apiDelete } from '@/lib/api';
import { isApiError } from '@/types/api';
import { useT } from '@/components/providers/locale-provider';
import type { User } from '@/types/models';

interface UserDeleteDialogProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function UserDeleteDialog({
  user,
  open,
  onOpenChange,
  onSuccess,
}: UserDeleteDialogProps) {
  const t = useT('admin');
  const [loading, setLoading] = useState(false);
  const name = `${user.first_name} ${user.last_name}`.trim();

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await apiDelete(`/api/v1/users/${user.id}`);
      toast.success(t('udl.toastDeleted', { name }));
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      const msg = isApiError(err) ? err.message : t('udl.failedDelete');
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('udl.title')}
      description={t('udl.desc', { name })}
      confirmLabel={t('udl.confirm')}
      variant="destructive"
      typeToConfirm={user.email}
      onConfirm={handleConfirm}
      loading={loading}
    />
  );
}
