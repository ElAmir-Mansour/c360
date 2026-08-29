'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { Checkbox } from '@/components/ui/checkbox';
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
import type { DelayCategory, RecordDelayEventPayload } from '@/lib/lex/settlements';

interface DelayEventDialogProps {
  open: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: RecordDelayEventPayload) => void;
}

export function DelayEventDialog({ open, loading, onOpenChange, onSubmit }: DelayEventDialogProps) {
  const L = useSettlementLabels();
  const labels = L.timeline.delayDialog;
  const [category, setCategory] = useState<DelayCategory>('court');
  const [reason, setReason] = useState('');
  const [alsoHold, setAlsoHold] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCategory('court');
      setReason('');
      setAlsoHold(true);
      setError(null);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!reason.trim()) {
      setError(labels.reasonRequired);
      return;
    }
    onSubmit({
      category,
      reason: reason.trim(),
      also_mark_external_hold: alsoHold,
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
            <Label htmlFor="delay-category">{labels.category}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as DelayCategory)}>
              <SelectTrigger id="delay-category">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="delay-reason">{labels.reason}</Label>
            <Textarea
              id="delay-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={labels.reasonPlaceholder}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="delay-also-hold"
              checked={alsoHold}
              onCheckedChange={(checked) => setAlsoHold(checked === true)}
            />
            <Label htmlFor="delay-also-hold" className="text-sm font-normal">
              {labels.alsoHold}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" disabled={loading} onClick={handleSubmit}>
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {labels.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
