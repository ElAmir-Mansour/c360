'use client';

import { useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type MatterLabels, useMatterLabels } from './labels';

interface MatterStatusDialogProps {
  open: boolean;
  loading: boolean;
  options: readonly string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (status: string) => void;
}

export function MatterStatusDialog({
  open,
  loading,
  options,
  onOpenChange,
  onSubmit,
}: MatterStatusDialogProps) {
  const matterLabels = useMatterLabels();
  const labels = matterLabels.statusDialog;
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) {
      setStatus('');
      return;
    }
    setStatus(options[0] ?? '');
  }, [open, options]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        {options.length > 0 ? (
          <div className="space-y-2">
            <Label htmlFor="matter-next-status">{labels.nextStatus}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="matter-next-status">
                <SelectValue placeholder={labels.selectStatus} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {statusOptionLabel(matterLabels, option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{matterLabels.detail.notSet}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={!status || loading || options.length === 0}
            onClick={() => status && onSubmit(status)}
          >
            {labels.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function statusOptionLabel(labels: MatterLabels, status: string): string {
  return labels.filters.statusOptions[status] ?? status.replace(/_/g, ' ');
}
