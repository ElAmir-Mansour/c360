'use client';

// Reason-collecting confirm dialog for the tenant lifecycle actions that the
// spec requires to capture a reason for the audit trail (suspend / deprovision /
// impersonate — §E.2). The shared <ConfirmDialog/> (foundation) supports
// type-to-confirm but renders no children, so this local variant mirrors its
// behaviour while adding a required `reason` field. Plain confirm actions
// (unsuspend / reprovision / reactivate) keep using the shared ConfirmDialog.

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useT } from '@/components/providers/locale-provider';

interface ReasonConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  reasonLabel: string;
  /** User must type this exact string (the tenant slug). */
  typeToConfirm: string;
  variant?: 'default' | 'destructive';
  loading?: boolean;
  /** Called with the entered reason once the slug matches. */
  onConfirm: (reason: string) => Promise<void> | void;
}

export function ReasonConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  reasonLabel,
  typeToConfirm,
  variant = 'default',
  loading = false,
  onConfirm,
}: ReasonConfirmDialogProps) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canConfirm = typed === typeToConfirm && reason.trim().length > 0;

  const reset = () => {
    setTyped('');
    setReason('');
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
      reset();
      onOpenChange(false);
    } catch {
      // Caller surfaces the error (toast); keep the dialog open for retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            {variant === 'destructive' && (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
              </div>
            )}
            <div>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription className="mt-1">
                {description}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reason-input" className="text-sm">
              {reasonLabel}
            </Label>
            <Input
              id="reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('platformConsole.tenants.reasonPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug-confirm-input" className="text-sm">
              {t('platformConsole.tenants.typeToConfirmPrefix')}{' '}
              <span className="font-mono font-bold">{typeToConfirm}</span>{' '}
              {t('platformConsole.tenants.typeToConfirmSuffix')}
            </Label>
            <Input
              id="slug-confirm-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typeToConfirm}
              aria-invalid={Boolean(typed) && typed !== typeToConfirm}
              aria-describedby={
                typed && typed !== typeToConfirm ? 'slug-confirm-error' : undefined
              }
              className={cn(typed && typed !== typeToConfirm && 'border-destructive')}
            />
            {typed && typed !== typeToConfirm && (
              <p
                id="slug-confirm-error"
                role="alert"
                className="text-xs text-destructive"
              >
                {t('platformConsole.tenants.slugMismatch')}
              </p>
            )}
          </div>
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting || loading}
          >
            {t('platformConsole.tenants.cancel')}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={!canConfirm || submitting || loading}
          >
            {submitting || loading ? t('platformConsole.tenants.processing') : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
