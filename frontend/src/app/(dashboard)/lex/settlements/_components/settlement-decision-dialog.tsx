'use client';

import { useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettlementLabels } from './labels';
import type { SettlementDecisionPayload } from '@/lib/lex/settlements';

interface SettlementDecisionDialogProps {
  open: boolean;
  loading: boolean;
  /** Whether the settlement carries an approval workflow + open task. */
  ready: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: SettlementDecisionPayload) => void;
}

export function SettlementDecisionDialog({
  open,
  loading,
  ready,
  onOpenChange,
  onSubmit,
}: SettlementDecisionDialogProps) {
  const L = useSettlementLabels();
  const labels = L.decision;
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setDecision('approve');
      setNotes('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        {ready ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="settlement-decision">{labels.decision}</Label>
              <Select value={decision} onValueChange={(v) => setDecision(v as 'approve' | 'reject')}>
                <SelectTrigger id="settlement-decision">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approve">{labels.approve}</SelectItem>
                  <SelectItem value="reject">{labels.reject}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settlement-decision-notes">{labels.notes}</Label>
              <Textarea
                id="settlement-decision-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={labels.notesPlaceholder}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{labels.workflowMissing}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={!ready || loading}
            onClick={() => onSubmit({ decision, notes: notes.trim() || undefined })}
          >
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {labels.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
