'use client';

import { type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useRunbookStudioLabels } from '../../_components/runbook-studio/runbook-studio-labels';

/**
 * Shared chrome for every Runbook Studio dialog (create / edit / add-task /
 * start-run). Wraps the shadcn `Dialog` with the studio header, a `<form>` body,
 * and a Cancel / submit footer whose copy is resolved from the foundation
 * bilingual studio bundle (`useRunbookStudioLabels()`). The submit button
 * reflects the mutation's pending state and is disabled while submitting.
 * Logical-direction spacing keeps the footer RTL-safe.
 *
 * The caller owns the form fields and the RHF submit handler; this shell only
 * standardises the surrounding affordances.
 */
export function RunbookDialogShell({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitting,
  submitLabel,
  submitDisabled,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** RHF `handleSubmit`-wrapped submit handler for the dialog `<form>`. */
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  /** Optional explicit submit label (defaults to the studio "Save"). */
  submitLabel?: string;
  /** Extra disable condition. */
  submitDisabled?: boolean;
  children: ReactNode;
}) {
  const labels = useRunbookStudioLabels();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">{children}</div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={submitting || Boolean(submitDisabled)}>
              {submitting ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {submitLabel ?? labels.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
