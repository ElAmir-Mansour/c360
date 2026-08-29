'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { apiPost } from '@/lib/api';
import { showSuccess, showError } from '@/lib/toast';
import { useWorkflowPageLabels } from '@/app/(dashboard)/workflows/_lib/workflow-page-i18n';

interface WorkflowCancelDialogProps {
  instanceId: string;
  definitionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function WorkflowCancelDialog({
  instanceId,
  definitionName,
  open,
  onOpenChange,
  onSuccess,
}: WorkflowCancelDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const labels = useWorkflowPageLabels();

  const handleConfirm = async () => {
    setIsLoading(true);
    try {
      await apiPost(`/api/v1/workflows/instances/${instanceId}/cancel`);
      showSuccess(labels.instance.cancelled);
      onSuccess();
    } catch {
      showError(labels.instance.failedToCancel);
      throw new Error('cancel failed'); // prevent dialog close
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={labels.instance.cancelWorkflow}
      description={labels.instance.cancelDescription(definitionName)}
      confirmLabel={labels.instance.cancelWorkflow}
      variant="destructive"
      typeToConfirm={labels.instance.cancelConfirmToken}
      onConfirm={handleConfirm}
      loading={isLoading}
    />
  );
}
