'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { showSuccess, showError } from '@/lib/toast';
import type { CTEMFinding } from '@/types/cyber';
import { useCtemLabels } from '../../_lib/ctem-i18n';

interface FindingStatusDialogProps {
  finding: CTEMFinding;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function FindingStatusDialog({ finding, open, onOpenChange, onSuccess }: FindingStatusDialogProps) {
  const t = useCtemLabels();
  const STATUS_OPTIONS: { value: CTEMFinding['status']; label: string }[] = [
    { value: 'open', label: t.findingStatus.open },
    { value: 'in_remediation', label: t.findingStatus.in_remediation },
    { value: 'remediated', label: t.findingStatus.remediated },
    { value: 'accepted_risk', label: t.findingStatus.accepted_risk },
    { value: 'false_positive', label: t.findingStatus.false_positive },
    { value: 'deferred', label: t.findingStatus.deferred },
  ];
  const [status, setStatus] = useState<CTEMFinding['status']>(finding.status);
  const [notes, setNotes] = useState(finding.status_notes ?? '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await apiPut(API_ENDPOINTS.CYBER_CTEM_FINDING_STATUS(finding.id), {
        status,
        notes: notes.trim() || undefined,
      });
      showSuccess(t.findingStatusDialog.updatedToast);
      onSuccess();
      onOpenChange(false);
    } catch {
      showError(t.findingStatusDialog.failedToast);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.findingStatusDialog.title}</DialogTitle>
          <DialogDescription className="line-clamp-2">{finding.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="finding-status">{t.findingStatusDialog.statusLabel}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as CTEMFinding['status'])}>
              <SelectTrigger id="finding-status">
                <SelectValue placeholder={t.findingStatusDialog.selectStatus} />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="finding-notes">{t.findingStatusDialog.notesLabel}</Label>
            <Textarea
              id="finding-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.findingStatusDialog.notesPlaceholder}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t.findingStatusDialog.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || status === finding.status}>
            {submitting ? t.findingStatusDialog.updating : t.findingStatusDialog.updateStatus}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
