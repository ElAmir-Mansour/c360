'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexRequestsApi, type LegalRequest, type RequestPriority } from '@/lib/lex/requests';
import { REQUEST_PRIORITY_OPTIONS, useServiceDeskLabels } from './labels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: LegalRequest;
  onSaved?: () => void;
}

export function ReclassifyDialog({ open, onOpenChange, request, onSaved }: Props) {
  const labels = useServiceDeskLabels();
  const t = labels.reclassifyDialog;
  const qc = useQueryClient();

  const [priority, setPriority] = useState<RequestPriority>('normal');
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setPriority(request.priority === 'urgent' ? 'normal' : 'urgent');
      setReason('');
      setUrgency('');
      setErrors({});
    }
  }, [open, request.priority]);

  const saveMutation = useMutation({
    mutationFn: () =>
      lexRequestsApi.reclassifyPriority(request.id, {
        priority,
        reason: reason.trim(),
        urgency_justification: priority === 'urgent' ? urgency.trim() : undefined,
      }),
    onSuccess: async () => {
      showSuccess(labels.detail.reclassify);
      await qc.invalidateQueries({ queryKey: ['lex-legal-request', request.id] });
      await qc.invalidateQueries({ queryKey: ['lex-request-priority-history', request.id] });
      await qc.invalidateQueries({ queryKey: ['lex-legal-requests'] });
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  const submit = () => {
    const next: Record<string, string> = {};
    if (!reason.trim()) next.reason = t.errors.reasonRequired;
    if (priority === 'urgent' && !urgency.trim()) next.urgency = t.errors.urgencyRequired;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reclassify-priority">{t.priority}</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as RequestPriority)}>
              <SelectTrigger id="reclassify-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REQUEST_PRIORITY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.priorityOptions[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reclassify-reason">{t.reason}</Label>
            <Textarea
              id="reclassify-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.reasonPlaceholder}
              rows={2}
            />
            {errors.reason ? <p className="text-sm text-destructive">{errors.reason}</p> : null}
          </div>

          {priority === 'urgent' ? (
            <div className="space-y-1.5">
              <Label htmlFor="reclassify-urgency">{t.urgencyJustification}</Label>
              <Textarea
                id="reclassify-urgency"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value)}
                placeholder={t.urgencyJustificationPlaceholder}
                rows={2}
              />
              {errors.urgency ? <p className="text-sm text-destructive">{errors.urgency}</p> : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button type="button" onClick={submit} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
