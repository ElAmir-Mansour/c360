'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
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
import { DELAY_CATEGORY_OPTIONS, useSettlementLabels } from './labels';
import type { DelayCategory, MatterTimeline, SetExternalHoldPayload } from '@/lib/lex/settlements';

interface TimelineHoldDialogProps {
  open: boolean;
  loading: boolean;
  timeline: MatterTimeline;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: SetExternalHoldPayload) => void;
}

export function TimelineHoldDialog({
  open,
  loading,
  timeline,
  onOpenChange,
  onSubmit,
}: TimelineHoldDialogProps) {
  const L = useSettlementLabels();
  const labels = L.timeline.holdDialog;
  const [held, setHeld] = useState<boolean>(!timeline.external_hold);
  const [category, setCategory] = useState<DelayCategory>(
    timeline.external_hold_category ?? 'court',
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // Default action toggles the current state: if currently held, default to clearing.
      setHeld(!timeline.external_hold);
      setCategory(timeline.external_hold_category ?? 'court');
      setReason('');
      setError(null);
    }
  }, [open, timeline]);

  const handleSubmit = () => {
    if (held && !category) {
      setError(labels.categoryRequired);
      return;
    }
    onSubmit({
      held,
      category: held ? category : undefined,
      reason: reason.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <LexCreationGuidance workflow="settlement" />
          <div className="space-y-2">
            <Label htmlFor="hold-state">{labels.held}</Label>
            <Select value={held ? 'on' : 'off'} onValueChange={(v) => setHeld(v === 'on')}>
              <SelectTrigger id="hold-state">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on">{labels.heldOn}</SelectItem>
                <SelectItem value="off">{labels.heldOff}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {held ? (
            <div className="space-y-2">
              <Label htmlFor="hold-category">{labels.category}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as DelayCategory)}>
                <SelectTrigger id="hold-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELAY_CATEGORY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {L.timeline.categoryOptions[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="hold-reason">{labels.reason}</Label>
            <Textarea
              id="hold-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={labels.reasonPlaceholder}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" disabled={loading} onClick={handleSubmit}>
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {labels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
