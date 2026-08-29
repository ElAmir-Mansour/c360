'use client';

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { VisusExecutiveAlert } from '@/types/suites';
import { useVisusAlertDismissLabels } from '../../_lib/visus-i18n';

interface DismissAlertDialogProps {
  alert: VisusExecutiveAlert | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string, dismissReason?: string) => void;
}

export function DismissAlertDialog({ alert, open, onOpenChange, onConfirm }: DismissAlertDialogProps) {
  const t = useVisusAlertDismissLabels();
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    if (!alert) return;
    onConfirm(alert.id, reason.trim() || undefined);
    setReason('');
  };

  const handleOpenChange = (value: boolean) => {
    if (!value) setReason('');
    onOpenChange(value);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {alert ? t.description(alert.title) : t.descriptionFallback}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="dismiss-reason">{t.reasonLabel}</Label>
          <Textarea
            id="dismiss-reason"
            placeholder={t.reasonPlaceholder}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>{t.dismiss}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
