'use client';

/**
 * #9 Revise-in-execution dialog — edits a request while `status === 'in_execution'`
 * via `reviseRequest(id, payload)`. After the call it surfaces the returned
 * {@link ChangeDecision}: whether the edit was *substantial* (which reopens the
 * completeness gate and resets the SLA clock) and the friendly-mapped reasons.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  LEGAL_SERVICE_CODES,
  lexRequestsApi,
  type ChangeDecision,
  type LegalRequest,
  type UpdateLegalRequestPayload,
} from '@/lib/lex/requests';
import { useDetailExtraLabels } from './detail-extra-labels';
import { useServiceTypeLabel } from './lex-enums-i18n';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: LegalRequest;
  onChanged?: () => void;
}

/** Request-type options: the canonical service codes plus the request's own
 * current type (so a non-standard type stays selectable). */
function buildTypeOptions(current: string): string[] {
  const codes = LEGAL_SERVICE_CODES as readonly string[];
  return codes.includes(current) || !current ? [...codes] : [current, ...codes];
}

export function ReviseRequestDialog({ open, onOpenChange, request, onChanged }: Props) {
  const labels = useDetailExtraLabels();
  const t = labels.revise;
  const serviceTypeLabel = useServiceTypeLabel();
  const qc = useQueryClient();

  const [titleEn, setTitleEn] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState('');
  const [requestType, setRequestType] = useState('');
  const [requesterApproval, setRequesterApproval] = useState(false);
  const [providerApproval, setProviderApproval] = useState(false);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<ChangeDecision | null>(null);

  useEffect(() => {
    if (open) {
      setTitleEn(request.title?.en ?? '');
      setTitleAr(request.title?.ar ?? '');
      setDescription(request.description ?? '');
      setDepartment(request.department ?? '');
      setRequestType(request.request_type ?? '');
      setRequesterApproval(request.requester_approval_required);
      setProviderApproval(request.provider_approval_required);
      setError('');
      setDecision(null);
    }
  }, [open, request]);

  const reviseMutation = useMutation({
    mutationFn: () => {
      const payload: UpdateLegalRequestPayload = {
        title: { en: titleEn.trim(), ar: titleAr.trim() },
        description: description.trim(),
        department: department.trim() || undefined,
        request_type: requestType || undefined,
        requester_approval_required: requesterApproval,
        provider_approval_required: providerApproval,
      };
      return lexRequestsApi.reviseRequest(request.id, payload);
    },
    onSuccess: async (result) => {
      showSuccess(t.toast);
      setDecision(result.change);
      await qc.invalidateQueries({ queryKey: ['lex-legal-request', request.id] });
      await qc.invalidateQueries({ queryKey: ['lex-request-execution', request.id] });
      await qc.invalidateQueries({ queryKey: ['lex-sla-clock', request.id] });
      await qc.invalidateQueries({ queryKey: ['lex-legal-requests'] });
      onChanged?.();
    },
    onError: showApiError,
  });

  const submit = () => {
    if (!titleEn.trim() && !titleAr.trim()) {
      setError(t.errors.titleRequired);
      return;
    }
    setError('');
    reviseMutation.mutate();
  };

  const typeOptions = buildTypeOptions(request.request_type ?? '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.dialogDescription}</DialogDescription>
        </DialogHeader>

        {decision ? (
          // --- Outcome view (the change decision) ---
          <div className="space-y-4">
            <div
              className={
                decision.substantial
                  ? 'flex gap-3 rounded-lg border border-warning-300 bg-warning-50 p-4 dark:border-warning-800/40 dark:bg-warning-800/20'
                  : 'flex gap-3 rounded-lg border border-primary/30 bg-primary/[0.06] p-4'
              }
            >
              {decision.substantial ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-700 dark:text-warning-300" aria-hidden />
              ) : (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              )}
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold">
                  {decision.substantial ? t.substantialTitle : t.nonSubstantialTitle}
                </p>
                <p className="text-sm text-muted-foreground">
                  {decision.substantial ? t.substantialBody : t.nonSubstantialBody}
                </p>
              </div>
            </div>

            {decision.substantial && decision.reasons.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                  {t.reasonsHeading}
                </p>
                <ul className="space-y-1.5">
                  {decision.reasons.map((reason) => (
                    <li key={reason} className="flex items-center gap-2 text-sm">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-500" aria-hidden />
                      {t.reasonLabels[reason] ?? reason.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t.close}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          // --- Form view ---
          <>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="revise-title-ar">{t.titleAr}</Label>
                  <Input
                    id="revise-title-ar"
                    value={titleAr}
                    onChange={(e) => setTitleAr(e.target.value)}
                    dir="rtl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="revise-title-en">{t.titleEn}</Label>
                  <Input
                    id="revise-title-en"
                    value={titleEn}
                    onChange={(e) => setTitleEn(e.target.value)}
                    dir="ltr"
                  />
                </div>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <div className="space-y-1.5">
                <Label htmlFor="revise-description">{t.requestDescription}</Label>
                <Textarea
                  id="revise-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="revise-department">{t.department}</Label>
                  <Input
                    id="revise-department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="revise-type">{t.requestType}</Label>
                  <Select value={requestType} onValueChange={setRequestType}>
                    <SelectTrigger id="revise-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {typeOptions.map((code) => (
                        <SelectItem key={code} value={code}>
                          {serviceTypeLabel(code)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="revise-requester-approval" className="cursor-pointer">
                    {t.requesterApproval}
                  </Label>
                  <Switch
                    id="revise-requester-approval"
                    checked={requesterApproval}
                    onCheckedChange={setRequesterApproval}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="revise-provider-approval" className="cursor-pointer">
                    {t.providerApproval}
                  </Label>
                  <Switch
                    id="revise-provider-approval"
                    checked={providerApproval}
                    onCheckedChange={setProviderApproval}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="button" onClick={submit} disabled={reviseMutation.isPending}>
                {reviseMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : null}
                {t.save}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
