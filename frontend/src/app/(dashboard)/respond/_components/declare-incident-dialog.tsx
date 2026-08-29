'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { IncidentDeclarationPanel } from './incident-declaration-panel';
import { useRespondDeclareLabels } from '../_lib/respond-i18n';

interface DeclareIncidentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Header CTA that opens the shared incident-declaration flow inline. Reuses the
 * same `IncidentDeclarationPanel` rendered on /respond/incidents, so declaration
 * still runs its own mutation, cache invalidation, and routes to the new
 * incident on success (which unmounts this dialog as the landing navigates away).
 */
export function DeclareIncidentDialog({ open, onOpenChange }: DeclareIncidentDialogProps) {
  const t = useRespondDeclareLabels();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <AlertTriangle className="me-2 h-4 w-4" aria-hidden />
          {t.dialogTrigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.dialogDescription}</DialogDescription>
        </DialogHeader>
        <IncidentDeclarationPanel />
      </DialogContent>
    </Dialog>
  );
}
