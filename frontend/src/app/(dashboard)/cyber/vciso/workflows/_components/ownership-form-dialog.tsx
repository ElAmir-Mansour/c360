'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import type { VCISOControlOwnership } from '@/types/cyber';
import { useVcisoWorkflowLabels } from '../../_lib/vciso-i18n';

interface OwnershipFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  ownership?: VCISOControlOwnership;
}

interface FormState {
  control_id: string;
  control_name: string;
  framework: string;
  owner_id: string;
  owner_name: string;
  delegate_id: string;
  delegate_name: string;
  next_review_date: string;
}

const initialFormState: FormState = {
  control_id: '',
  control_name: '',
  framework: '',
  owner_id: '',
  owner_name: '',
  delegate_id: '',
  delegate_name: '',
  next_review_date: '',
};

function formStateFromOwnership(ownership: VCISOControlOwnership): FormState {
  return {
    control_id: ownership.control_id,
    control_name: ownership.control_name,
    framework: ownership.framework,
    owner_id: ownership.owner_id,
    owner_name: ownership.owner_name,
    delegate_id: ownership.delegate_id ?? '',
    delegate_name: ownership.delegate_name ?? '',
    next_review_date: ownership.next_review_date
      ? ownership.next_review_date.split('T')[0]
      : '',
  };
}

export function OwnershipFormDialog({
  open,
  onOpenChange,
  onSuccess,
  ownership,
}: OwnershipFormDialogProps) {
  const t = useVcisoWorkflowLabels().ownershipForm;
  const isEdit = !!ownership;
  const [form, setForm] = useState<FormState>(
    ownership ? formStateFromOwnership(ownership) : initialFormState,
  );

  const createMutation = useApiMutation<VCISOControlOwnership, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_CONTROL_OWNERSHIP,
    {
      successMessage: t.createdToast,
      invalidateKeys: ['vciso-control-ownership'],
      onSuccess: () => {
        setForm(initialFormState);
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const updateMutation = useApiMutation<VCISOControlOwnership, Record<string, unknown>>(
    'put',
    `${API_ENDPOINTS.CYBER_VCISO_CONTROL_OWNERSHIP}/${ownership?.id ?? ''}`,
    {
      successMessage: t.updatedToast,
      invalidateKeys: ['vciso-control-ownership'],
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const mutation = isEdit ? updateMutation : createMutation;

  const handleSubmit = () => {
    if (!form.control_id.trim()) {
      toast.error(t.controlIdRequired);
      return;
    }
    if (!form.control_name.trim()) {
      toast.error(t.controlNameRequired);
      return;
    }
    if (!form.framework.trim()) {
      toast.error(t.frameworkRequired);
      return;
    }
    if (!form.owner_id.trim()) {
      toast.error(t.ownerIdRequired);
      return;
    }
    if (!form.owner_name.trim()) {
      toast.error(t.ownerNameRequired);
      return;
    }
    if (!form.next_review_date) {
      toast.error(t.nextReviewRequired);
      return;
    }

    const payload: Record<string, unknown> = {
      control_id: form.control_id.trim(),
      control_name: form.control_name.trim(),
      framework: form.framework.trim(),
      owner_id: form.owner_id.trim(),
      owner_name: form.owner_name.trim(),
      status: isEdit ? (ownership?.status ?? 'assigned') : 'assigned',
      next_review_date: form.next_review_date,
    };

    if (form.delegate_id.trim()) {
      payload.delegate_id = form.delegate_id.trim();
      payload.delegate_name = form.delegate_name.trim();
    }

    mutation.mutate(payload);
  };

  const handleOpenChange = (o: boolean) => {
    if (!o && !isEdit) {
      setForm(initialFormState);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? t.editDesc : t.createDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Control Info */}
          <h4 className="text-sm font-semibold text-muted-foreground">{t.controlInformation}</h4>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ownership-control-id">
                {t.controlId} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ownership-control-id"
                value={form.control_id}
                onChange={(e) => setForm((f) => ({ ...f, control_id: e.target.value }))}
                placeholder={t.controlIdPlaceholder}
                disabled={isEdit}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ownership-framework">
                {t.framework} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ownership-framework"
                value={form.framework}
                onChange={(e) => setForm((f) => ({ ...f, framework: e.target.value }))}
                placeholder={t.frameworkPlaceholder}
                disabled={isEdit}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ownership-control-name">
              {t.controlName} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ownership-control-name"
              value={form.control_name}
              onChange={(e) => setForm((f) => ({ ...f, control_name: e.target.value }))}
              placeholder={t.controlNamePlaceholder}
              disabled={isEdit}
            />
          </div>

          <Separator />

          {/* Owner Info */}
          <h4 className="text-sm font-semibold text-muted-foreground">{t.ownerAssignment}</h4>

          <div className="space-y-2">
            <Label htmlFor="ownership-owner-id">
              {t.ownerName} <span className="text-destructive">*</span>
            </Label>
            <TenantUserPicker
              id="ownership-owner-id"
              ariaLabel={t.ownerName}
              value={form.owner_id}
              onChange={(userId, option) =>
                setForm((current) => ({
                  ...current,
                  owner_id: userId,
                  owner_name: option?.label ?? '',
                }))
              }
              enabled={open}
              disabled={mutation.isPending}
              required
              selectedLabel={form.owner_name}
              labels={{ select: t.ownerIdPlaceholder, search: t.ownerNamePlaceholder }}
              className="w-full"
            />
          </div>

          <Separator />

          {/* Delegate Info */}
          <h4 className="text-sm font-semibold text-muted-foreground">{t.delegateOptional}</h4>

          <div className="space-y-2">
            <Label htmlFor="ownership-delegate-id">{t.delegateName}</Label>
            <TenantUserPicker
              id="ownership-delegate-id"
              ariaLabel={t.delegateName}
              value={form.delegate_id}
              onChange={(userId, option) =>
                setForm((current) => ({
                  ...current,
                  delegate_id: userId,
                  delegate_name: option?.label ?? '',
                }))
              }
              enabled={open}
              disabled={mutation.isPending}
              allowClear
              selectedLabel={form.delegate_name}
              labels={{ select: t.delegateIdPlaceholder, search: t.delegateNamePlaceholder }}
              className="w-full"
            />
          </div>

          <Separator />

          {/* Schedule */}
          <div className="space-y-2">
            <Label htmlFor="ownership-review-date">
              {t.nextReviewDate} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ownership-review-date"
              type="date"
              value={form.next_review_date}
              onChange={(e) => setForm((f) => ({ ...f, next_review_date: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending
              ? isEdit
                ? t.updating
                : t.assigning
              : isEdit
                ? t.updateOwnership
                : t.assignOwnership}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
