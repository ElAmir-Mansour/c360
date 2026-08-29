'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
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
import type { VCISORegulatoryObligation, ObligationType } from '@/types/cyber';
import { useVcisoGovLabels } from '../../_lib/vciso-i18n';

const OBLIGATION_TYPE_VALUES: ObligationType[] = [
  'legal',
  'regulatory',
  'contractual',
  'industry_standard',
];

interface ObligationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  obligation?: VCISORegulatoryObligation | null;
  onSuccess: () => void;
}

export function ObligationFormDialog({
  open,
  onOpenChange,
  obligation,
  onSuccess,
}: ObligationFormDialogProps) {
  const labels = useVcisoGovLabels().compliance;
  const t = labels.obligationForm;
  const typeLabels = labels.obligationTypes as Record<string, () => string>;
  const isEditing = !!obligation;

  const [name, setName] = useState('');
  const [type, setType] = useState<ObligationType | ''>('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [description, setDescription] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [ownerName, setOwnerName] = useState('');

  useEffect(() => {
    if (open) {
      if (obligation) {
        setName(obligation.name);
        setType(obligation.type);
        setJurisdiction(obligation.jurisdiction);
        setDescription(obligation.description);
        setEffectiveDate(obligation.effective_date?.slice(0, 10) ?? '');
        setReviewDate(obligation.review_date?.slice(0, 10) ?? '');
        setOwnerId(obligation.owner_id ?? '');
        setOwnerName(obligation.owner_name ?? '');
      } else {
        setName('');
        setType('');
        setJurisdiction('');
        setDescription('');
        setEffectiveDate('');
        setReviewDate('');
        setOwnerId('');
        setOwnerName('');
      }
    }
  }, [open, obligation]);

  const createMutation = useApiMutation<VCISORegulatoryObligation, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_OBLIGATIONS,
    {
      invalidateKeys: ['vciso-obligations'],
      successMessage: t.createdToast,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const updateMutation = useApiMutation<VCISORegulatoryObligation, Record<string, unknown>>(
    'put',
    () => `${API_ENDPOINTS.CYBER_VCISO_OBLIGATIONS}/${obligation?.id}`,
    {
      invalidateKeys: ['vciso-obligations'],
      successMessage: t.updatedToast,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error(t.nameRequired);
      return;
    }
    if (!type) {
      toast.error(t.typeRequired);
      return;
    }
    if (!jurisdiction.trim()) {
      toast.error(t.jurisdictionRequired);
      return;
    }
    if (!description.trim()) {
      toast.error(t.descriptionRequired);
      return;
    }

    const payload = {
      name: name.trim(),
      type,
      jurisdiction: jurisdiction.trim(),
      description: description.trim(),
      requirements: isEditing ? (obligation?.requirements ?? []) : [],
      status: isEditing ? (obligation?.status ?? 'not_assessed') : 'not_assessed',
      mapped_controls: isEditing ? (obligation?.mapped_controls ?? 0) : 0,
      total_requirements: isEditing ? (obligation?.total_requirements ?? 0) : 0,
      met_requirements: isEditing ? (obligation?.met_requirements ?? 0) : 0,
      effective_date: effectiveDate || undefined,
      review_date: reviewDate || undefined,
      owner_id: ownerId.trim() || undefined,
      owner_name: ownerName.trim() || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t.editTitle : t.createTitle}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t.editDesc : t.createDesc()}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="obligation-name">{t.name}</Label>
            <Input
              id="obligation-name"
              placeholder={t.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="obligation-type">{t.type}</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as ObligationType)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="obligation-type">
                  <SelectValue placeholder={t.selectType} />
                </SelectTrigger>
                <SelectContent>
                  {OBLIGATION_TYPE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {typeLabels[value]?.() ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="obligation-jurisdiction">{t.jurisdiction}</Label>
              <Input
                id="obligation-jurisdiction"
                placeholder={t.jurisdictionPlaceholder}
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="obligation-description">{t.description}</Label>
            <Textarea
              id="obligation-description"
              placeholder={t.descriptionPlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSubmitting}
              className="min-h-[120px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="obligation-owner-id">{t.ownerName}</Label>
            <TenantUserPicker
              id="obligation-owner-id"
              ariaLabel={t.ownerName}
              value={ownerId}
              onChange={(userId, option) => {
                setOwnerId(userId);
                setOwnerName(option?.label ?? '');
              }}
              enabled={open}
              disabled={isSubmitting}
              allowClear
              selectedLabel={ownerName}
              labels={{ select: t.ownerIdPlaceholder, search: t.ownerNamePlaceholder }}
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="obligation-effective-date">{t.effectiveDate}</Label>
              <Input
                id="obligation-effective-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="obligation-review-date">{t.reviewDate}</Label>
              <Input
                id="obligation-review-date"
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
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
              {isSubmitting
                ? isEditing
                  ? t.updating
                  : t.creating
                : isEditing
                  ? t.updateObligation
                  : t.addObligation}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
