'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { apiPost } from '@/lib/api';
import { showSuccess, showApiError } from '@/lib/toast';
import { useAuth } from '@/hooks/use-auth';
import { canClaimTask } from '@/lib/workflow-utils';
import { useWorkflowPageLabels } from '@/app/(dashboard)/workflows/_lib/workflow-page-i18n';
import type { HumanTask } from '@/types/models';

interface TaskClaimButtonProps {
  task: HumanTask;
  onSuccess: () => void;
}

export function TaskClaimButton({ task, onSuccess }: TaskClaimButtonProps) {
  const [isClaiming, setIsClaiming] = useState(false);
  const { user } = useAuth();
  const labels = useWorkflowPageLabels();

  if (!canClaimTask(task, user)) {
    return null;
  }

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      await apiPost(`/api/v1/workflows/tasks/${task.id}/claim`);
      showSuccess(labels.tasks.list.claimedSuccess);
      onSuccess();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 409) {
        showApiError(new Error(labels.tasks.list.claimedBySomeoneElse));
        onSuccess(); // refetch to get updated state
      } else if (status === 403) {
        showApiError(new Error(labels.tasks.list.missingClaimRole));
      } else {
        showApiError(err);
      }
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{labels.tasks.detail.claimPanelTitle}</p>
      {task.assignee_role && (
        <p className="text-xs text-muted-foreground">
          {labels.tasks.detail.claimPanelRole(task.assignee_role)}
        </p>
      )}
      <Button onClick={handleClaim} disabled={isClaiming} size="lg">
        {isClaiming ? (
          <>
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
            {labels.tasks.detail.claiming}
          </>
        ) : (
          labels.tasks.detail.claimThisTask
        )}
      </Button>
    </div>
  );
}
