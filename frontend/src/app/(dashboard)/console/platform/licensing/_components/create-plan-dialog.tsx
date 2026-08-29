'use client';

import { useState } from 'react';
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
import { parseApiError } from '@/lib/format';
import { toast } from 'sonner';
import { useT } from '@/components/providers/locale-provider';
import type { CreatePlanInput } from '../_lib/types';

interface CreatePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreatePlanInput) => Promise<void>;
}

const KEY_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function CreatePlanDialog({ open, onOpenChange, onCreate }: CreatePlanDialogProps) {
  const t = useT();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const keyValid = key === '' || KEY_RE.test(key);
  const canSubmit = key.trim() !== '' && name.trim() !== '' && keyValid && !submitting;

  const reset = () => {
    setKey('');
    setName('');
    setDescription('');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onCreate({ key: key.trim(), name: name.trim(), description: description.trim() });
      toast.success(t('platformConsole.licensing.planCreatedToast'));
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(parseApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('platformConsole.licensing.newPlan')}</DialogTitle>
          <DialogDescription>
            {t('platformConsole.licensing.createPlanDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="plan-key">{t('platformConsole.licensing.key')}</Label>
            <Input
              id="plan-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t('platformConsole.licensing.keyPlaceholder')}
              className="font-mono"
            />
            {!keyValid && (
              <p className="text-xs text-destructive">
                {t('platformConsole.licensing.keyHint')}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">{t('platformConsole.licensing.name')}</Label>
            <Input
              id="plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('platformConsole.licensing.namePlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-desc">{t('platformConsole.licensing.descriptionLabel')}</Label>
            <Input
              id="plan-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('platformConsole.licensing.optional')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('platformConsole.licensing.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? t('platformConsole.licensing.creating') : t('platformConsole.licensing.createPlan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
