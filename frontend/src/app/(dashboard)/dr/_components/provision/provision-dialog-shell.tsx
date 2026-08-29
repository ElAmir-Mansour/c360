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
import { useProvisionLabels } from './provision-labels';

/**
 * Shared chrome for every ClarioDR provisioning dialog.
 *
 * Wraps the shadcn `Dialog` with the standard provisioning header, a `<form>`
 * body, and a Cancel / submit footer whose copy is resolved from the bilingual
 * {@link useProvisionLabels} bundle (English under the test `en` default, full
 * MSA Arabic for `ar`). The submit button reflects the mutation's pending state
 * and is disabled while submitting. Logical-direction spacing keeps the footer
 * RTL-safe (the suite renders right-to-left for Arabic operators).
 *
 * The caller owns the form fields and the RHF submit handler; this shell only
 * standardises the surrounding affordances so every create dialog looks and
 * behaves identically.
 */
export function ProvisionDialogShell({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitting,
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
  /** Extra disable condition (e.g. no eligible sites to pick). */
  submitDisabled?: boolean;
  children: ReactNode;
}) {
  const labels = useProvisionLabels();

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
              {labels.actions.cancel}
            </Button>
            <Button type="submit" disabled={submitting || Boolean(submitDisabled)}>
              {submitting ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                  {labels.actions.saving}
                </>
              ) : (
                labels.actions.submit
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
