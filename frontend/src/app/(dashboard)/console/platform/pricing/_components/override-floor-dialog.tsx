'use client';

// OVERRIDE-FLOOR dialog (pricing:admin only). A below-floor quote can't be
// sent/accepted until an override is recorded; this dialog captures the required
// justification and POSTs /quotes/{id}/override-floor. On success the quote is
// invalidated so the detail view re-hydrates with the override in place and the
// Send/Accept actions unblock.

import { useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/components/providers/locale-provider';
import { showSuccess, showBackendError } from '@/lib/toast';
import { useOverrideFloor } from '../_lib/use-pricing-quotes';

interface OverrideFloorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
}

export function OverrideFloorDialog({
  open,
  onOpenChange,
  quoteId,
}: OverrideFloorDialogProps) {
  const t = useT();
  const override = useOverrideFloor();
  const [reason, setReason] = useState('');

  const reasonMissing = reason.trim().length === 0;

  const handleOpenChange = (next: boolean) => {
    if (!next) setReason('');
    onOpenChange(next);
  };

  const submit = async () => {
    if (reasonMissing) return;
    try {
      await override.mutateAsync({ id: quoteId, reason: reason.trim() });
      showSuccess(t('platformConsole.pricing.quotes.overrideRecorded'));
      handleOpenChange(false);
    } catch (err) {
      showBackendError(err, t('platformConsole.pricing.quotes.overrideFloor'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden />
            {t('platformConsole.pricing.quotes.overrideDialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('platformConsole.pricing.quotes.overrideDialogDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="override-reason">
            {t('platformConsole.pricing.quotes.overrideReasonLabel')}
          </Label>
          <Textarea
            id="override-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('platformConsole.pricing.quotes.overrideReasonPlaceholder')}
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={override.isPending}
          >
            {t('platformConsole.pricing.quotes.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={override.isPending || reasonMissing}
          >
            {override.isPending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            {t('platformConsole.pricing.quotes.overrideConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
