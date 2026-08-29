'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { VCISOVendor, VendorRiskTier } from '@/types/cyber';
import { useVcisoOpsLabels } from '../../_lib/vciso-i18n';

const RISK_TIER_VALUES: VendorRiskTier[] = ['critical', 'high', 'medium', 'low'];

const CATEGORY_OPTIONS = [
  'Cloud Infrastructure',
  'SaaS Provider',
  'Security Services',
  'Data Analytics',
  'Payment Processing',
  'Communication',
  'HR & Payroll',
  'Legal & Compliance',
  'Consulting',
  'Other',
];

interface VendorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: VCISOVendor | null;
  onSuccess: () => void;
}

export function VendorFormDialog({
  open,
  onOpenChange,
  vendor,
  onSuccess,
}: VendorFormDialogProps) {
  const labels = useVcisoOpsLabels().thirdParty.vendor;
  const t = labels.form;
  const riskTierLabels = labels.riskTiers as Record<string, string>;
  const categoryLabels = labels.categories;
  const isEditing = !!vendor;

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [riskTier, setRiskTier] = useState<VendorRiskTier>('medium');
  const [servicesProvided, setServicesProvided] = useState('');
  const [dataShared, setDataShared] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [nextReviewDate, setNextReviewDate] = useState('');

  useEffect(() => {
    if (open) {
      if (vendor) {
        setName(vendor.name);
        setCategory(vendor.category);
        setRiskTier(vendor.risk_tier);
        setServicesProvided(vendor.services_provided.join(', '));
        setDataShared(vendor.data_shared.join(', '));
        setContactName(vendor.contact_name ?? '');
        setContactEmail(vendor.contact_email ?? '');
        setNextReviewDate(vendor.next_review_date ? vendor.next_review_date.split('T')[0] : '');
      } else {
        setName('');
        setCategory('');
        setRiskTier('medium');
        setServicesProvided('');
        setDataShared('');
        setContactName('');
        setContactEmail('');
        setNextReviewDate('');
      }
    }
  }, [open, vendor]);

  const createMutation = useApiMutation<VCISOVendor, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_VENDORS,
    {
      invalidateKeys: ['vciso-vendors'],
      successMessage: t.createdToast,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const updateMutation = useApiMutation<VCISOVendor, Record<string, unknown>>(
    'put',
    () => `${API_ENDPOINTS.CYBER_VCISO_VENDORS}/${vendor?.id}`,
    {
      invalidateKeys: ['vciso-vendors'],
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
    if (!category) {
      toast.error(t.categoryRequired);
      return;
    }
    if (!nextReviewDate) {
      toast.error(t.nextReviewRequired);
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      category,
      risk_tier: riskTier,
      status: isEditing ? (vendor?.status ?? 'active') : 'active',
      risk_score: isEditing ? (vendor?.risk_score ?? 0) : 0,
      services_provided: servicesProvided
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      data_shared: dataShared
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      compliance_frameworks: isEditing ? (vendor?.compliance_frameworks ?? []) : [],
      controls_met: isEditing ? (vendor?.controls_met ?? 0) : 0,
      controls_total: isEditing ? (vendor?.controls_total ?? 0) : 0,
      contact_name: contactName.trim() || undefined,
      contact_email: contactEmail.trim() || undefined,
      next_review_date: nextReviewDate,
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
          <DialogTitle>{isEditing ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>
            {isEditing ? t.editDesc : t.createDesc}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="vendor-name">{t.name}</Label>
            <Input
              id="vendor-name"
              placeholder={t.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor-category">{t.category}</Label>
              <Select
                value={category}
                onValueChange={setCategory}
                disabled={isSubmitting}
              >
                <SelectTrigger id="vendor-category">
                  <SelectValue placeholder={t.selectCategory} />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {categoryLabels[cat]?.() ?? cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-risk-tier">{t.riskTier}</Label>
              <Select
                value={riskTier}
                onValueChange={(v) => setRiskTier(v as VendorRiskTier)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="vendor-risk-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RISK_TIER_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {riskTierLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor-services">{t.servicesProvided}</Label>
            <Input
              id="vendor-services"
              placeholder={t.servicesPlaceholder}
              value={servicesProvided}
              onChange={(e) => setServicesProvided(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor-data">{t.dataShared}</Label>
            <Input
              id="vendor-data"
              placeholder={t.dataPlaceholder}
              value={dataShared}
              onChange={(e) => setDataShared(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vendor-contact-name">{t.contactName}</Label>
              <Input
                id="vendor-contact-name"
                placeholder={t.contactNamePlaceholder}
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-contact-email">{t.contactEmail}</Label>
              <Input
                id="vendor-contact-email"
                type="email"
                placeholder="vendor@example.com"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vendor-next-review">{t.nextReviewDate}</Label>
            <Input
              id="vendor-next-review"
              type="date"
              value={nextReviewDate}
              onChange={(e) => setNextReviewDate(e.target.value)}
              disabled={isSubmitting}
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
              {isSubmitting
                ? isEditing
                  ? t.updating
                  : t.adding
                : isEditing
                  ? t.updateVendor
                  : t.addVendor}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
