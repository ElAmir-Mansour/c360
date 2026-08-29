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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import type {
  VCISORiskEntry,
  RiskLikelihood,
  RiskImpact,
  RiskStatus,
  RiskTreatment,
} from '@/types/cyber';
import { useVcisoGovLabels } from '../../_lib/vciso-i18n';

interface RiskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

const LEVEL_VALUES = ['low', 'medium', 'high', 'critical'] as const;
const STATUS_VALUES = ['open', 'mitigated'] as const;
const TREATMENT_VALUES = ['mitigate', 'transfer', 'accept', 'avoid'] as const;

interface FormState {
  title: string;
  description: string;
  category: string;
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  status: RiskStatus;
  treatment: RiskTreatment;
  department: string;
  business_services: string;
  treatment_plan: string;
  controls: string;
  review_date: string;
}

const initialFormState: FormState = {
  title: '',
  description: '',
  category: '',
  likelihood: 'medium',
  impact: 'medium',
  status: 'open',
  treatment: 'mitigate',
  department: '',
  business_services: '',
  treatment_plan: '',
  controls: '',
  review_date: '',
};

export function RiskFormDialog({ open, onOpenChange, onCreated }: RiskFormDialogProps) {
  const labels = useVcisoGovLabels().risk;
  const t = labels.form;
  const levelLabels = labels.options.level as Record<string, string>;
  const statusLabels = labels.options.status as Record<string, string>;
  const treatmentLabels = labels.options.treatment as Record<string, string>;
  const [form, setForm] = useState<FormState>(initialFormState);

  const createMutation = useApiMutation<VCISORiskEntry, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_RISKS,
    {
      successMessage: t.createdToast,
      invalidateKeys: ['vciso-risks', API_ENDPOINTS.CYBER_VCISO_RISKS_STATS],
      onSuccess: () => {
        setForm(initialFormState);
        onOpenChange(false);
        onCreated();
      },
    },
  );

  const handleSubmit = () => {
    if (!form.title.trim()) {
      toast.error(t.titleRequired);
      return;
    }
    if (!form.category.trim()) {
      toast.error(t.categoryRequired);
      return;
    }
    if (!form.description.trim()) {
      toast.error(t.descriptionRequired);
      return;
    }

    createMutation.mutate({
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category.trim(),
      likelihood: form.likelihood,
      impact: form.impact,
      status: form.status,
      treatment: form.treatment,
      department: form.department.trim(),
      inherent_score: 0,
      residual_score: 0,
      owner_name: '',
      business_services: form.business_services
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      treatment_plan: form.treatment_plan.trim(),
      controls: form.controls
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      tags: [],
      review_date: form.review_date || undefined,
    });
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setForm(initialFormState);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Basic info */}
          <div className="space-y-2">
            <Label htmlFor="risk-title">
              {t.titleLabel} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="risk-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t.titlePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="risk-description">
              {t.descriptionLabel} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="risk-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t.descriptionPlaceholder}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="risk-category">
                {t.category} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="risk-category"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder={t.categoryPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk-department">{t.department}</Label>
              <Input
                id="risk-department"
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                placeholder={t.departmentPlaceholder}
              />
            </div>
          </div>

          <Separator />

          {/* Assessment */}
          <h4 className="text-sm font-semibold text-muted-foreground">{t.riskAssessment}</h4>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t.likelihood}</Label>
              <Select
                value={form.likelihood}
                onValueChange={(v) => setForm((f) => ({ ...f, likelihood: v as RiskLikelihood }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVEL_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {levelLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.impact}</Label>
              <Select
                value={form.impact}
                onValueChange={(v) => setForm((f) => ({ ...f, impact: v as RiskImpact }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVEL_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {levelLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t.status}</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as RiskStatus }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {statusLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.treatment}</Label>
              <Select
                value={form.treatment}
                onValueChange={(v) => setForm((f) => ({ ...f, treatment: v as RiskTreatment }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TREATMENT_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {treatmentLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Mitigation */}
          <h4 className="text-sm font-semibold text-muted-foreground">{t.mitigationDetails}</h4>

          <div className="space-y-2">
            <Label htmlFor="risk-review-date">{t.reviewDate}</Label>
            <Input
              id="risk-review-date"
              type="date"
              value={form.review_date}
              onChange={(e) => setForm((f) => ({ ...f, review_date: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="risk-treatment-plan">{t.treatmentPlan}</Label>
            <Textarea
              id="risk-treatment-plan"
              value={form.treatment_plan}
              onChange={(e) => setForm((f) => ({ ...f, treatment_plan: e.target.value }))}
              placeholder={t.treatmentPlanPlaceholder}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="risk-controls">{t.controls}</Label>
            <Input
              id="risk-controls"
              value={form.controls}
              onChange={(e) => setForm((f) => ({ ...f, controls: e.target.value }))}
              placeholder="AC-1, AC-2, SC-7"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="risk-services">{t.businessServices}</Label>
            <Input
              id="risk-services"
              value={form.business_services}
              onChange={(e) => setForm((f) => ({ ...f, business_services: e.target.value }))}
              placeholder={t.businessServicesPlaceholder}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createMutation.isPending}
          >
            {t.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? t.creating : t.createRisk}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
