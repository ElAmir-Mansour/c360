'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { useLicensePlans, useAssignTenantLicense } from '../_lib/use-license-plans';

interface AssignLicenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  tenantLabel: string;
  /** Current seats used by the tenant, to warn on a downgrade below usage. */
  currentSeatsUsed?: number;
  /** Pre-select the tenant's current plan / seats when changing a license. */
  currentPlanKey?: string;
  currentSeats?: number;
}

/** Default expiry: one year out, as a date input value (YYYY-MM-DD). */
function defaultExpiryDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export function AssignLicenseDialog({
  open,
  onOpenChange,
  tenantId,
  tenantLabel,
  currentSeatsUsed,
  currentPlanKey,
  currentSeats,
}: AssignLicenseDialogProps) {
  const t = useT();
  const { data: plans, isLoading: plansLoading } = useLicensePlans();
  const assign = useAssignTenantLicense();

  const [planKey, setPlanKey] = useState(currentPlanKey ?? '');
  const [seats, setSeats] = useState<string>(currentSeats ? String(currentSeats) : '1');
  const [expiry, setExpiry] = useState(defaultExpiryDate());

  // Reset local form whenever the dialog (re)opens for a tenant.
  useEffect(() => {
    if (open) {
      setPlanKey(currentPlanKey ?? '');
      setSeats(currentSeats ? String(currentSeats) : '1');
      setExpiry(defaultExpiryDate());
    }
  }, [open, currentPlanKey, currentSeats]);

  const seatsNum = Number(seats);
  const seatsValid = Number.isFinite(seatsNum) && seatsNum >= 1;

  // Warn (don't block) when the requested seats drop below current usage.
  const downgradeWarning = useMemo(
    () =>
      seatsValid &&
      currentSeatsUsed !== undefined &&
      seatsNum < currentSeatsUsed,
    [seatsValid, seatsNum, currentSeatsUsed],
  );

  const activePlans = (plans ?? []).filter((p) => p.status !== 'retired');
  const canSubmit = planKey !== '' && seatsValid && expiry !== '' && !assign.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await assign.mutateAsync({
        tenantId,
        plan_key: planKey,
        seats: seatsNum,
        // Send an RFC3339 timestamp at end-of-day UTC.
        expires_at: new Date(`${expiry}T23:59:59Z`).toISOString(),
      });
      toast.success(t('platformConsole.licensing.assignedToast'));
      onOpenChange(false);
    } catch (e) {
      toast.error(parseApiError(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('platformConsole.licensing.assignLicense')}</DialogTitle>
          <DialogDescription>
            {t('platformConsole.licensing.assignDialogDesc')}{' '}
            <span className="font-medium text-foreground">{tenantLabel}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="assign-plan">{t('platformConsole.licensing.plan')}</Label>
            <Select value={planKey} onValueChange={setPlanKey} disabled={plansLoading}>
              <SelectTrigger id="assign-plan">
                <SelectValue placeholder={plansLoading ? t('platformConsole.licensing.loading') : t('platformConsole.licensing.selectPlan')} />
              </SelectTrigger>
              <SelectContent>
                {activePlans.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.name}
                    <span className="ms-2 font-mono text-xs text-muted-foreground">
                      {p.key}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="assign-seats">{t('platformConsole.licensing.seats')}</Label>
              <Input
                id="assign-seats"
                type="number"
                min={1}
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
              />
              {currentSeatsUsed !== undefined && (
                <p className="text-xs text-muted-foreground">
                  {t('platformConsole.licensing.currentlyUsing').replace(
                    '{count}',
                    currentSeatsUsed.toLocaleString(),
                  )}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assign-expiry">{t('platformConsole.licensing.expires')}</Label>
              <Input
                id="assign-expiry"
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </div>
          </div>

          {downgradeWarning && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-500/10 p-3 text-sm text-warning-700 dark:text-warning-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {t('platformConsole.licensing.seatDowngradeWarning')
                  .replace('{seats}', String(seatsNum))
                  .replace('{used}', currentSeatsUsed?.toLocaleString() ?? '')}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={assign.isPending}>
            {t('platformConsole.licensing.cancel')}
          </Button>
          <Button
            variant={downgradeWarning ? 'destructive' : 'default'}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {assign.isPending
              ? t('platformConsole.licensing.assigning')
              : t('platformConsole.licensing.assignLicense')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
