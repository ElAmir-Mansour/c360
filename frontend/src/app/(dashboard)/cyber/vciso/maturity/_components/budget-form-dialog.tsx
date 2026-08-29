'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { MultiSelect } from '@/components/shared/forms/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { PaginatedResponse } from '@/types/api';
import type { VCISOBudgetItem, BudgetItemType, VCISORiskEntry } from '@/types/cyber';
import { useVcisoGovLabels } from '../../_lib/vciso-i18n';

interface BudgetFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface FormState {
  title: string;
  category: string;
  type: BudgetItemType;
  amount: string;
  currency: string;
  priority: string;
  justification: string;
  fiscal_year: string;
  quarter: string;
  linked_risk_ids: string[];
  linked_recommendation_ids: string;
}

const initialFormState: FormState = {
  title: '',
  category: '',
  type: 'opex',
  amount: '',
  currency: 'USD',
  priority: '3',
  justification: '',
  fiscal_year: new Date().getFullYear().toString(),
  quarter: '',
  linked_risk_ids: [],
  linked_recommendation_ids: '',
};

const QUARTER_VALUES = ['Q1', 'Q2', 'Q3', 'Q4'];

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

const CATEGORY_OPTIONS = [
  'Identity & Access Management',
  'Endpoint Security',
  'Network Security',
  'Cloud Security',
  'Security Operations',
  'Compliance & Governance',
  'Training & Awareness',
  'Incident Response',
  'Data Protection',
  'Application Security',
  'Third-Party Risk',
  'Other',
];

export function BudgetFormDialog({
  open,
  onOpenChange,
  onCreated,
}: BudgetFormDialogProps) {
  const t = useVcisoGovLabels().maturity.budgetForm;
  const categoryLabels = t.categories;
  const [form, setForm] = useState<FormState>(initialFormState);
  const risksQuery = useQuery({
    queryKey: ['vciso-budget-risk-options'],
    queryFn: () =>
      apiGet<PaginatedResponse<VCISORiskEntry>>(API_ENDPOINTS.CYBER_VCISO_RISKS, {
        page: 1,
        per_page: 500,
        sort: 'residual_score',
        order: 'desc',
      }),
    enabled: open,
  });
  const riskOptions = (risksQuery.data?.data ?? []).map((risk) => ({
    value: risk.id,
    label: `${risk.title} · ${risk.category}`,
  }));

  const createMutation = useApiMutation<VCISOBudgetItem, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_BUDGET,
    {
      successMessage: t.createdToast,
      invalidateKeys: [
        'vciso-budget',
        API_ENDPOINTS.CYBER_VCISO_BUDGET_SUMMARY,
      ],
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
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error(t.amountRequired);
      return;
    }
    if (!form.justification.trim()) {
      toast.error(t.justificationRequired);
      return;
    }

    createMutation.mutate({
      title: form.title.trim(),
      category: form.category.trim(),
      type: form.type,
      amount: Number(form.amount),
      currency: form.currency,
      priority: Number(form.priority),
      justification: form.justification.trim(),
      fiscal_year: form.fiscal_year.trim(),
      quarter: (form.quarter && form.quarter !== 'none') ? form.quarter : undefined,
      linked_risk_ids: form.linked_risk_ids,
      linked_recommendation_ids: form.linked_recommendation_ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      risk_reduction_estimate: 0,
      status: 'proposed',
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
          {/* Basic Info */}
          <div className="space-y-2">
            <Label htmlFor="budget-title">
              {t.titleLabel} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="budget-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t.titlePlaceholder}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>
                {t.category} <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.selectCategory} />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {categoryLabels[cat] ?? cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.type}</Label>
              <Select
                value={form.type}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, type: v as BudgetItemType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="capex">{t.capexLabel}</SelectItem>
                  <SelectItem value="opex">{t.opexLabel}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="budget-amount">
                {t.amount} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="budget-amount"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amount: e.target.value }))
                }
                placeholder="50000"
              />
            </div>
            <div className="space-y-2">
              <Label>{t.currency()}</Label>
              <Select
                value={form.currency}
                onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget-priority">{t.priority15}</Label>
              <Input
                id="budget-priority"
                type="number"
                min="1"
                max="5"
                value={form.priority}
                onChange={(e) =>
                  setForm((f) => ({ ...f, priority: e.target.value }))
                }
              />
            </div>
          </div>

          <Separator />

          {/* Timeline */}
          <h4 className="text-sm font-semibold text-muted-foreground">
            {t.timeline}
          </h4>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="budget-fiscal-year">{t.fiscalYear}</Label>
              <Input
                id="budget-fiscal-year"
                value={form.fiscal_year}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fiscal_year: e.target.value }))
                }
                placeholder="2026"
              />
            </div>
            <div className="space-y-2">
              <Label>{t.quarter}</Label>
              <Select
                value={form.quarter}
                onValueChange={(v) => setForm((f) => ({ ...f, quarter: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.selectQuarter} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.quarterNotSpecified}</SelectItem>
                  {QUARTER_VALUES.map((q) => (
                    <SelectItem key={q} value={q}>
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Justification */}
          <h4 className="text-sm font-semibold text-muted-foreground">
            {t.businessCase()}
          </h4>

          <div className="space-y-2">
            <Label htmlFor="budget-justification">
              {t.justification} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="budget-justification"
              value={form.justification}
              onChange={(e) =>
                setForm((f) => ({ ...f, justification: e.target.value }))
              }
              placeholder={t.justificationPlaceholder}
              rows={4}
            />
          </div>

          <Separator />

          {/* Linked Entities */}
          <h4 className="text-sm font-semibold text-muted-foreground">
            {t.linkedEntities}
          </h4>

          <div className="space-y-2">
            <Label htmlFor="budget-risk-ids">{t.linkedRiskIds}</Label>
            <MultiSelect
              id="budget-risk-ids"
              ariaLabel={t.linkedRiskIds}
              options={riskOptions}
              selected={form.linked_risk_ids}
              onChange={(linkedRiskIds) =>
                setForm((current) => ({ ...current, linked_risk_ids: linkedRiskIds }))
              }
              placeholder={t.selectRisks}
              disabled={risksQuery.isLoading || createMutation.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget-rec-ids">{t.linkedRecIds}</Label>
            <Input
              id="budget-rec-ids"
              value={form.linked_recommendation_ids}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  linked_recommendation_ids: e.target.value,
                }))
              }
              placeholder={t.linkedRecPlaceholder}
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
            {createMutation.isPending ? t.creating : t.createBudgetItem}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
