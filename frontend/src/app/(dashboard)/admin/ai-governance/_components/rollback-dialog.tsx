'use client';

import { useState } from 'react';
import { showApiError, showSuccess } from '@/lib/toast';
import { enterpriseApi } from '@/lib/enterprise';
import type { AIRegisteredModel } from '@/types/ai-governance';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/components/providers/locale-provider';

interface RollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: AIRegisteredModel | null;
  onSaved: () => void;
}

export function RollbackDialog({ open, onOpenChange, model, onSaved }: RollbackDialogProps) {
  const t = useT('admin');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!model || !reason.trim()) {
      return;
    }
    try {
      setSaving(true);
      await enterpriseApi.ai.rollback(model.id, { reason });
      showSuccess(t('rbd.toastRolledBack'), t('rbd.toastRolledBackDetail', { slug: model.slug }));
      setReason('');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('rbd.title')}</DialogTitle>
          <DialogDescription>
            {t('rbd.desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rollback-reason">{t('rbd.reason')}</Label>
          <Textarea
            id="rollback-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('rbd.reasonPlaceholder')}
            className="min-h-28"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('rbd.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={saving || !reason.trim()}>
            {saving ? t('rbd.rollingBack') : t('rbd.rollback')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
