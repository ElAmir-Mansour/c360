'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
import { showApiError, showSuccess } from '@/lib/toast';
import { lexRequestsApi } from '@/lib/lex/requests';
import { useServiceDeskLabels } from './labels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  onSaved?: () => void;
}

export function CompletenessDialog({ open, onOpenChange, requestId, onSaved }: Props) {
  const labels = useServiceDeskLabels();
  const t = labels.completenessDialog;
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) setNotes('');
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: () =>
      lexRequestsApi.confirmCompleteness(requestId, { notes: notes.trim() || undefined }),
    onSuccess: () => {
      showSuccess(labels.execution.toast.completenessConfirmed);
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="completeness-notes">{t.notes}</Label>
          <Textarea
            id="completeness-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t.notesPlaceholder}
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
