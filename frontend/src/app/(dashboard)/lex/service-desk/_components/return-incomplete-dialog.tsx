'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  lexRequestsApi,
  type RequirementItem,
  type ReturnIncompleteReasonCode,
} from '@/lib/lex/requests';
import { useServiceDeskLabels } from './labels';

const RETURN_REASON_CODES: ReturnIncompleteReasonCode[] = [
  'missing_information',
  'doa_non_compliance',
  'incomplete_referral_procedures',
  'invalid_attachments',
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  requirements: RequirementItem[];
  onSaved?: () => void;
}

export function ReturnIncompleteDialog({
  open,
  onOpenChange,
  requestId,
  requirements,
  onSaved,
}: Props) {
  const labels = useServiceDeskLabels();
  const t = labels.returnDialog;
  const { locale } = useLocale();
  const [reasonCode, setReasonCode] = useState<ReturnIncompleteReasonCode | ''>('');
  const [details, setDetails] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReasonCode('');
      setDetails('');
      setMissing([]);
      setError('');
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: () =>
      lexRequestsApi.returnIncomplete(requestId, {
        reason_code: reasonCode || undefined,
        reason: details.trim(),
        missing_requirement_codes: missing.length > 0 ? missing : undefined,
      }),
    onSuccess: () => {
      showSuccess(labels.execution.toast.returnedIncomplete);
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  const toggle = (code: string) => {
    setMissing((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const submit = () => {
    if (!reasonCode) {
      setError(t.errors.reasonRequired);
      return;
    }
    setError('');
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="return-reason">{t.reason}</Label>
            <Select
              value={reasonCode}
              onValueChange={(value) => {
                setReasonCode(value as ReturnIncompleteReasonCode);
                setError('');
              }}
            >
              <SelectTrigger id="return-reason">
                <SelectValue placeholder={t.errors.reasonRequired} />
              </SelectTrigger>
              <SelectContent>
                {RETURN_REASON_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t.reasons[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="return-details">{t.details}</Label>
            <Textarea
              id="return-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t.reasonPlaceholder}
              rows={3}
            />
          </div>

          {requirements.length > 0 ? (
            <div className="space-y-2">
              {requirements.map((item) => (
                <label
                  key={item.id}
                  htmlFor={`miss-${item.id}`}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <Checkbox
                    id={`miss-${item.id}`}
                    checked={missing.includes(item.code)}
                    onCheckedChange={() => toggle(item.code)}
                  />
                  <span>{resolveLocalized(item.label, locale)}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={submit}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
