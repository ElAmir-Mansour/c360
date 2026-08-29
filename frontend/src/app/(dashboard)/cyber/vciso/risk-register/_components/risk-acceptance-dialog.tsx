'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { VCISORiskEntry } from '@/types/cyber';
import { useVcisoGovLabels } from '../../_lib/vciso-i18n';

interface RiskAcceptanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  risk: VCISORiskEntry;
  onAccepted: () => void;
}

export function RiskAcceptanceDialog({
  open,
  onOpenChange,
  risk,
  onAccepted,
}: RiskAcceptanceDialogProps) {
  const t = useVcisoGovLabels().risk.acceptance;
  const [rationale, setRationale] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);

  const acceptMutation = useApiMutation<VCISORiskEntry, Record<string, unknown>>(
    'put',
    `${API_ENDPOINTS.CYBER_VCISO_RISKS}/${risk.id}`,
    {
      successMessage: t.acceptedToast,
      invalidateKeys: ['vciso-risks', API_ENDPOINTS.CYBER_VCISO_RISKS_STATS],
      onSuccess: () => {
        resetForm();
        onOpenChange(false);
        onAccepted();
      },
    },
  );

  const resetForm = () => {
    setRationale('');
    setExpiryDate('');
    setConfirmChecked(false);
  };

  const handleSubmit = () => {
    if (!rationale.trim()) {
      toast.error(t.rationaleRequired);
      return;
    }
    if (rationale.trim().length < 20) {
      toast.error(t.rationaleTooShort);
      return;
    }
    if (!confirmChecked) {
      toast.error(t.confirmRequired);
      return;
    }

    acceptMutation.mutate({
      // Preserve all existing fields (UpdateRiskRequest requires full DTO)
      title: risk.title,
      description: risk.description,
      category: risk.category,
      department: risk.department,
      inherent_score: risk.inherent_score,
      residual_score: risk.residual_score,
      likelihood: risk.likelihood,
      impact: risk.impact,
      treatment: risk.treatment,
      owner_id: risk.owner_id || undefined,
      owner_name: risk.owner_name,
      review_date: risk.review_date || undefined,
      business_services: risk.business_services,
      controls: risk.controls,
      tags: risk.tags,
      treatment_plan: risk.treatment_plan,
      // Updated fields
      status: 'accepted',
      acceptance_rationale: rationale.trim(),
      acceptance_expiry: expiryDate || undefined,
    });
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      resetForm();
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning-700 dark:text-warning-300" />
            {t.title}
          </DialogTitle>
          <DialogDescription>{t.description(risk.title)}</DialogDescription>
        </DialogHeader>

        {/* Risk summary */}
        <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t.riskLabel}</span>
            <span className="font-medium">{risk.title}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t.residualScoreLabel}</span>
            <span
              className={cn(
                'font-bold',
                risk.residual_score <= 30
                  ? 'text-primary'
                  : risk.residual_score <= 60
                    ? 'text-warning-700 dark:text-warning-300'
                    : 'text-status-error',
              )}
            >
              {risk.residual_score}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t.categoryLabel}</span>
            <span>{risk.category}</span>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="acceptance-rationale">
              {t.rationaleLabel} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="acceptance-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder={t.rationalePlaceholder}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">{t.rationaleHelp}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="acceptance-expiry">{t.expiryLabel}</Label>
            <Input
              id="acceptance-expiry"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t.expiryHelp}</p>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-warning-300 bg-warning-50 dark:border-warning-800 dark:bg-warning-800/30 p-4">
            <input
              type="checkbox"
              id="accept-confirm"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-warning-300/60 dark:border-warning-700/60 text-warning-700 dark:text-warning-300 focus:ring-status-warning"
            />
            <label htmlFor="accept-confirm" className="text-sm text-warning-700 dark:text-warning-300 leading-relaxed">
              {t.confirmText}
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={acceptMutation.isPending}
          >
            {t.cancel}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={acceptMutation.isPending || !confirmChecked || !rationale.trim()}
            className="bg-warning-600 hover:bg-warning-700 text-white"
          >
            {acceptMutation.isPending ? t.processing : t.acceptRisk}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
