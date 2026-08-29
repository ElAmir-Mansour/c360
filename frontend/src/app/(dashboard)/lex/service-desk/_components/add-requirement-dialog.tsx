'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexRequestsApi, type RequirementKind } from '@/lib/lex/requests';
import { useServiceDeskLabels } from './labels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  onSaved?: () => void;
}

export function AddRequirementDialog({ open, onOpenChange, requestId, onSaved }: Props) {
  const labels = useServiceDeskLabels();
  const t = labels.addRequirementDialog;

  const [code, setCode] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const [kind, setKind] = useState<RequirementKind>('attachment');
  const [required, setRequired] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setCode('');
      setLabelEn('');
      setLabelAr('');
      setKind('attachment');
      setRequired(true);
      setErrors({});
    }
  }, [open]);

  const saveMutation = useMutation({
    mutationFn: () =>
      lexRequestsApi.addRequirement(requestId, {
        code: code.trim(),
        label: { en: labelEn.trim(), ar: labelAr.trim() },
        kind,
        required,
      }),
    onSuccess: () => {
      showSuccess(labels.execution.toast.requirementAdded);
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  const submit = () => {
    const next: Record<string, string> = {};
    if (!code.trim()) next.code = t.errors.codeRequired;
    if (!labelEn.trim() && !labelAr.trim()) next.label = t.errors.labelRequired;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
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
          <LexCreationGuidance workflow="service" />
          <div className="space-y-1.5">
            <Label htmlFor="req-code">{t.code}</Label>
            <Input
              id="req-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t.codePlaceholder}
            />
            {errors.code ? <p className="text-sm text-destructive">{errors.code}</p> : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="req-label-ar">{t.labelAr}</Label>
              <Input
                id="req-label-ar"
                value={labelAr}
                onChange={(e) => setLabelAr(e.target.value)}
                dir="rtl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-label-en">{t.labelEn}</Label>
              <Input
                id="req-label-en"
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
          {errors.label ? <p className="text-sm text-destructive">{errors.label}</p> : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="req-kind">{t.kind}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as RequirementKind)}>
                <SelectTrigger id="req-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="attachment">{labels.execution.kindAttachment}</SelectItem>
                  <SelectItem value="data">{labels.execution.kindData}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border px-4 py-2.5">
              <Label htmlFor="req-required">{t.required}</Label>
              <Switch id="req-required" checked={required} onCheckedChange={setRequired} />
            </div>
          </div>
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
