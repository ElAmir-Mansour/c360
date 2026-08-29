'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { showApiError, showSuccess } from '@/lib/toast';
import { legalHoldsApi, type LegalHold } from '@/lib/lex/legal-holds';
import { useLegalHoldCopy } from './legal-hold-copy';

interface Props {
  hold: LegalHold | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReleased?: () => void;
}

export function LegalHoldReleaseDialog({ hold, open, onOpenChange, onReleased }: Props) {
  const qc = useQueryClient();
  const copy = useLegalHoldCopy();
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  const release = useMutation({
    mutationFn: () => {
      if (!hold) throw new Error('no hold selected');
      const trimmed = note.trim();
      return legalHoldsApi.release(hold.id, trimmed ? { release_note: trimmed } : {});
    },
    onSuccess: async () => {
      showSuccess(copy.toast.released);
      await qc.invalidateQueries({ queryKey: ['lex-admin-legal-holds'] });
      onOpenChange(false);
      onReleased?.();
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.release.title}</DialogTitle>
          <DialogDescription>
            {copy.release.description(hold?.reference ?? '')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="release_note">{copy.release.note}</Label>
          <Textarea
            id="release_note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={copy.release.notePlaceholder}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {copy.actions.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={release.isPending || !hold}
            onClick={() => release.mutate()}
          >
            {release.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {copy.release.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
