'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import { useUpdatePlan } from '../../../_lib/use-license-plans';

interface EditPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planKey: string;
  currentName: string;
  currentDescription: string;
}

export function EditPlanDialog({
  open,
  onOpenChange,
  planKey,
  currentName,
  currentDescription,
}: EditPlanDialogProps) {
  const t = useT();
  const update = useUpdatePlan();
  const [name, setName] = useState(currentName);
  const [description, setDescription] = useState(currentDescription);

  useEffect(() => {
    if (open) {
      setName(currentName);
      setDescription(currentDescription);
    }
  }, [open, currentName, currentDescription]);

  const canSubmit = name.trim() !== '' && !update.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await update.mutateAsync({
        key: planKey,
        name: name.trim(),
        description: description.trim(),
      });
      toast.success(t('platformConsole.licensing.planUpdatedToast'));
      onOpenChange(false);
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('platformConsole.licensing.editPlan')}</DialogTitle>
          <DialogDescription>
            {t('platformConsole.licensing.editPlanDescPrefix')}{' '}
            <span className="font-mono text-foreground">{planKey}</span>{' '}
            {t('platformConsole.licensing.editPlanDescSuffix')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-plan-name">{t('platformConsole.licensing.name')}</Label>
            <Input
              id="edit-plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-plan-desc">{t('platformConsole.licensing.descriptionLabel')}</Label>
            <Input
              id="edit-plan-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('platformConsole.licensing.optional')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            {t('platformConsole.licensing.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {update.isPending
              ? t('platformConsole.licensing.saving')
              : t('platformConsole.licensing.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
