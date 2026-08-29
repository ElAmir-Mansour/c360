'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
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
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import type { VCISOPolicy, VCISOPolicyException } from '@/types/cyber';
import { useVcisoWorkflowLabels } from '../../_lib/vciso-i18n';

interface ExceptionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policies: VCISOPolicy[];
  onSuccess: () => void;
  preselectedPolicyId?: string;
}

export function ExceptionFormDialog({
  open,
  onOpenChange,
  policies,
  onSuccess,
  preselectedPolicyId,
}: ExceptionFormDialogProps) {
  const t = useVcisoWorkflowLabels().exceptionForm;
  const [policyId, setPolicyId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [justification, setJustification] = useState('');
  const [compensatingControls, setCompensatingControls] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  useEffect(() => {
    if (open) {
      setPolicyId(preselectedPolicyId ?? '');
      setTitle('');
      setDescription('');
      setJustification('');
      setCompensatingControls('');
      setExpiresAt('');
    }
  }, [open, preselectedPolicyId]);

  const createMutation = useApiMutation<VCISOPolicyException, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_POLICY_EXCEPTIONS,
    {
      invalidateKeys: ['vciso-policy-exceptions', 'vciso-policies'],
      successMessage: t.submittedToast,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!policyId) {
      toast.error(t.selectPolicyRequired);
      return;
    }
    if (!title.trim()) {
      toast.error(t.titleRequired);
      return;
    }
    if (!description.trim()) {
      toast.error(t.descriptionRequired);
      return;
    }
    if (!justification.trim()) {
      toast.error(t.justificationRequired);
      return;
    }
    if (!compensatingControls.trim()) {
      toast.error(t.compensatingRequired);
      return;
    }
    if (!expiresAt) {
      toast.error(t.expirationRequired);
      return;
    }

    createMutation.mutate({
      policy_id: policyId,
      title: title.trim(),
      description: description.trim(),
      justification: justification.trim(),
      compensating_controls: compensatingControls.trim(),
      expires_at: new Date(expiresAt).toISOString(),
    });
  };

  const isSubmitting = createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="exception-policy">{t.policy}</Label>
            <Select
              value={policyId}
              onValueChange={setPolicyId}
              disabled={isSubmitting}
            >
              <SelectTrigger id="exception-policy">
                <SelectValue placeholder={t.selectPolicy} />
              </SelectTrigger>
              <SelectContent>
                {policies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="exception-title">{t.titleLabel}</Label>
            <Input
              id="exception-title"
              placeholder={t.titlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exception-description">{t.descriptionLabel}</Label>
            <Textarea
              id="exception-description"
              placeholder={t.descriptionPlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              className="min-h-[80px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exception-justification">{t.justification}</Label>
            <Textarea
              id="exception-justification"
              placeholder={t.justificationPlaceholder}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              disabled={isSubmitting}
              className="min-h-[80px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exception-controls">{t.compensatingControls}</Label>
            <Textarea
              id="exception-controls"
              placeholder={t.compensatingControlsPlaceholder}
              value={compensatingControls}
              onChange={(e) => setCompensatingControls(e.target.value)}
              disabled={isSubmitting}
              className="min-h-[80px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exception-expires">{t.expiresAt}</Label>
            <Input
              id="exception-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={isSubmitting}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t.cancel}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t.submitting : t.submitException}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
