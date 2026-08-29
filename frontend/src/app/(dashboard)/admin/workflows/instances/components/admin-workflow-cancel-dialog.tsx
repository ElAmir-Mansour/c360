'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { showError, showSuccess } from '@/lib/toast';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  fillAdminWorkflowLabel,
  getAdminWorkflowLabels,
} from '../../tasks/_lib/admin-workflow-i18n';

interface AdminWorkflowCancelDialogProps {
  instanceId: string;
  definitionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AdminWorkflowCancelDialog({
  instanceId,
  definitionName,
  open,
  onOpenChange,
  onSuccess,
}: AdminWorkflowCancelDialogProps) {
  const { locale } = useLocaleOrDefault();
  const labels = getAdminWorkflowLabels(locale);
  const token = labels.cancelInstance.token;
  const [typedValue, setTypedValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const canConfirm = typedValue === token;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setTypedValue('');
    onOpenChange(nextOpen);
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setIsLoading(true);
    try {
      await apiPost(`/api/v1/workflows/instances/${instanceId}/cancel`);
      showSuccess(labels.cancelInstance.success);
      onSuccess();
      handleOpenChange(false);
    } catch {
      showError(labels.cancelInstance.failed);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
            </div>
            <div>
              <AlertDialogTitle>{labels.cancelInstance.title}</AlertDialogTitle>
              <AlertDialogDescription className="mt-1">
                {fillAdminWorkflowLabel(labels.cancelInstance.description, {
                  name: definitionName,
                })}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="admin-workflow-cancel-confirm" className="text-sm">
            {fillAdminWorkflowLabel(labels.cancelInstance.typeToConfirm, {
              token,
            })}
          </Label>
          <Input
            id="admin-workflow-cancel-confirm"
            value={typedValue}
            onChange={(event) => setTypedValue(event.target.value)}
            placeholder={token}
            className={cn(typedValue && typedValue !== token && 'border-destructive')}
          />
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            {labels.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm || isLoading}
          >
            {isLoading ? labels.common.processing : labels.cancelInstance.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
