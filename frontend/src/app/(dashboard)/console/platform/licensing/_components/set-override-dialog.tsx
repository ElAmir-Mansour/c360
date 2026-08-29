'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import { useSetOverride, useEntitlementKeys } from '@/hooks/use-platform';

interface SetOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  tenantLabel: string;
  /** When editing an existing override, prefill its key/limit. */
  editKey?: string;
  editLimit?: number | null;
}

export function SetOverrideDialog({
  open,
  onOpenChange,
  tenantId,
  tenantLabel,
  editKey,
  editLimit,
}: SetOverrideDialogProps) {
  const t = useT();
  const { data: keys, isLoading: keysLoading } = useEntitlementKeys();
  const setOverride = useSetOverride();

  const [key, setKey] = useState(editKey ?? '');
  const [limit, setLimit] = useState<string>(
    editLimit === null || editLimit === undefined ? '' : String(editLimit),
  );
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setKey(editKey ?? '');
      setLimit(editLimit === null || editLimit === undefined ? '' : String(editLimit));
      setReason('');
    }
  }, [open, editKey, editLimit]);

  const isEditing = Boolean(editKey);
  const limitNum = limit === '' ? 0 : Number(limit);
  const limitValid = limit === '' || (Number.isFinite(limitNum) && limitNum >= 0);
  const revoking = limitValid && limit !== '' && limitNum === 0;
  const canSubmit = key !== '' && limitValid && reason.trim() !== '' && !setOverride.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      // limit 0 == revoke (verified semantics, service.go:398).
      await setOverride.mutateAsync({
        tenantId,
        key,
        limit: limitNum,
        reason: reason.trim(),
      });
      toast.success(t('platformConsole.licensing.overrideSetToast'));
      onOpenChange(false);
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? t('platformConsole.licensing.editOverride')
              : t('platformConsole.licensing.setOverride')}
          </DialogTitle>
          <DialogDescription>
            {t('platformConsole.licensing.overrideDialogDesc')}{' '}
            <span className="font-medium text-foreground">{tenantLabel}</span>.{' '}
            {t('platformConsole.licensing.overrideZeroNote')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="override-key">{t('platformConsole.licensing.entitlementKey')}</Label>
            <Select value={key} onValueChange={setKey} disabled={keysLoading || isEditing}>
              <SelectTrigger id="override-key">
                <SelectValue placeholder={keysLoading ? t('platformConsole.licensing.loading') : t('platformConsole.licensing.selectKey')} />
              </SelectTrigger>
              <SelectContent>
                {(keys ?? []).map((k) => (
                  <SelectItem key={k.key} value={k.key}>
                    {k.label}
                    <span className="ms-2 font-mono text-xs text-muted-foreground">
                      {k.key}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="override-limit">{t('platformConsole.licensing.limit')}</Label>
            <Input
              id="override-limit"
              type="number"
              min={0}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder={t('platformConsole.licensing.limitPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('platformConsole.licensing.limitLegend')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="override-reason">{t('platformConsole.licensing.reason')}</Label>
            <Input
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('platformConsole.licensing.reasonPlaceholder')}
            />
          </div>

          {revoking && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-500/10 p-3 text-sm text-warning-700 dark:text-warning-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{t('platformConsole.licensing.revokeWarning')}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={setOverride.isPending}>
            {t('platformConsole.licensing.cancel')}
          </Button>
          <Button
            variant={revoking ? 'destructive' : 'default'}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {setOverride.isPending
              ? t('platformConsole.licensing.saving')
              : t('platformConsole.licensing.saveOverride')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
