'use client';

/**
 * Edit dialog for an existing classified delay event (timeline feature #13).
 *
 * Mirrors the style of `delay-event-dialog.tsx` (the record dialog): a category
 * `Select` + a reason `Textarea`, but PREFILLED from the event being edited.
 * Submitting reports `{ category, reason }` upward; the parent
 * (`delay-event-list.tsx`, which owns the query) runs the PATCH mutation and
 * invalidates. The dialog is intentionally presentational — no data fetching.
 */

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
import { DELAY_CATEGORY_OPTIONS, useSettlementLabels } from './labels';
import type { DelayCategory, EditDelayEventPayload, LegalCaseDelayEvent } from '@/lib/lex/settlements';

export interface DelayEventEditDialogProps {
  open: boolean;
  loading: boolean;
  /** The event being edited; `null` while closed. */
  event: LegalCaseDelayEvent | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: EditDelayEventPayload) => void;
}

export function DelayEventEditDialog({
  open,
  loading,
  event,
  onOpenChange,
  onSubmit,
}: DelayEventEditDialogProps) {
  const L = useSettlementLabels();
  const labels = L.timeline.delayDialog;
  const editLabels = L.timeline.editEvent;

  const [category, setCategory] = useState<DelayCategory>('court');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form from the target event each time the dialog opens.
  useEffect(() => {
    if (open && event) {
      setCategory(event.category);
      setReason(event.reason ?? '');
      setError(null);
    }
  }, [open, event]);

  const handleSubmit = () => {
    if (!reason.trim()) {
      setError(labels.reasonRequired);
      return;
    }
    onSubmit({ category, reason: reason.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editLabels.edit}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-delay-category">{labels.category}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as DelayCategory)}>
              <SelectTrigger id="edit-delay-category">
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
            <Label htmlFor="edit-delay-reason">{labels.reason}</Label>
            <Textarea
              id="edit-delay-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={labels.reasonPlaceholder}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" disabled={loading} onClick={handleSubmit}>
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {editLabels.saveChanges}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
