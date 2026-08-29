'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/shared/copy-button';
import { useT } from '@/components/providers/locale-provider';

interface OfflineLicenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantLabel: string;
  /** The signed license file, or null while not yet issued. */
  licenseFile: string | null;
}

/**
 * Shows the signed offline license file after it is issued so the operator can
 * copy it for an air-gapped tenant. The file is sensitive but already minted; we
 * only render it for transfer.
 */
export function OfflineLicenseDialog({
  open,
  onOpenChange,
  tenantLabel,
  licenseFile,
}: OfflineLicenseDialogProps) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('platformConsole.licensing.offlineIssuedTitle')}</DialogTitle>
          <DialogDescription>
            {t('platformConsole.licensing.offlineIssuedDesc')}{' '}
            <span className="font-medium text-foreground">{tenantLabel}</span>.{' '}
            {t('platformConsole.licensing.offlineTransferNote')}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <div className="absolute end-2 top-2 z-10">
            {licenseFile && <CopyButton value={licenseFile} />}
          </div>
          <pre
            className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap"
            aria-live="polite"
          >
            {licenseFile ?? t('platformConsole.licensing.generating')}
          </pre>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('platformConsole.licensing.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
