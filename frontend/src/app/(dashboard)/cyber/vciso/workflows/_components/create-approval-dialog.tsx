'use client';

import { useMemo } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import {
  AsyncRecordPicker,
  type RecordPickerOption,
} from '@/components/shared/forms/async-record-picker';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { PaginatedResponse } from '@/types/api';
import type {
  ApprovalRequestType,
  RemediationAction,
  VCISOApprovalRequest,
  VCISOBudgetItem,
  VCISOPolicy,
  VCISORiskEntry,
  VCISOVendor,
} from '@/types/cyber';
import { useVcisoWorkflowLabels } from '../../_lib/vciso-i18n';

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_VALUES: ApprovalRequestType[] = [
  'risk_acceptance',
  'policy_exception',
  'remediation',
  'budget',
  'vendor_onboarding',
];

const PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'];

const LINKED_ENTITY_TYPE: Record<ApprovalRequestType, string> = {
  risk_acceptance: 'risk',
  policy_exception: 'policy',
  remediation: 'remediation',
  budget: 'budget',
  vendor_onboarding: 'vendor',
};

async function loadLinkedEntities(type: ApprovalRequestType, search: string): Promise<RecordPickerOption[]> {
  const params = { page: 1, per_page: 50, search: search || undefined };
  switch (type) {
    case 'risk_acceptance': {
      const response = await apiGet<PaginatedResponse<VCISORiskEntry>>(API_ENDPOINTS.CYBER_VCISO_RISKS, params);
      return response.data.map((item) => ({ value: item.id, label: item.title, description: `${item.category} · ${item.status}` }));
    }
    case 'policy_exception': {
      const response = await apiGet<PaginatedResponse<VCISOPolicy>>(API_ENDPOINTS.CYBER_VCISO_POLICIES, params);
      return response.data.map((item) => ({ value: item.id, label: item.title, description: `v${item.version} · ${item.status}` }));
    }
    case 'remediation': {
      const response = await apiGet<PaginatedResponse<RemediationAction>>(API_ENDPOINTS.CYBER_REMEDIATION, params);
      return response.data.map((item) => ({ value: item.id, label: item.title, description: `${item.severity} · ${item.status}` }));
    }
    case 'budget': {
      const response = await apiGet<PaginatedResponse<VCISOBudgetItem>>(API_ENDPOINTS.CYBER_VCISO_BUDGET, params);
      return response.data.map((item) => ({ value: item.id, label: item.title, description: `${item.currency} ${item.amount} · ${item.status}` }));
    }
    case 'vendor_onboarding': {
      const response = await apiGet<PaginatedResponse<VCISOVendor>>(API_ENDPOINTS.CYBER_VCISO_VENDORS, params);
      return response.data.map((item) => ({ value: item.id, label: item.name, description: `${item.category} · ${item.status}` }));
    }
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface CreateApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CreateApprovalDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateApprovalDialogProps) {
  const t = useVcisoWorkflowLabels().createApproval;
  const typeLabels = useVcisoWorkflowLabels().approvalTypes as Record<string, string>;
  const priorityLabels = useVcisoWorkflowLabels().priorities as Record<string, string>;

  const schema = useMemo(
    () =>
      z.object({
        type: z.string().min(1, t.vTypeRequired),
        title: z.string().min(2, t.vTitleMin).max(255),
        description: z.string().optional().default(''),
        approver_id: z.string().uuid(t.vUuid),
        approver_name: z.string().min(1, t.vApproverName),
        priority: z.string().min(1, t.vPriorityRequired),
        deadline: z.string().min(1, t.vDeadlineRequired),
        linked_entity_type: z.string().optional().default(''),
        linked_entity_id: z.string().optional().default(''),
      }),
    [t],
  );

  type FormValues = z.infer<typeof schema>;

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: '',
      title: '',
      description: '',
      approver_id: '',
      approver_name: '',
      priority: '',
      deadline: '',
      linked_entity_type: '',
      linked_entity_id: '',
    },
  });

  const { register, handleSubmit, setValue, watch, reset } = methods;

  const mutation = useApiMutation<VCISOApprovalRequest, FormValues>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_APPROVALS,
    {
      successMessage: t.createdToast,
      invalidateKeys: ['vciso-approvals'],
      onSuccess: () => {
        reset();
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const onSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  const typeValue = watch('type');
  const priorityValue = watch('priority');
  const approverIdValue = watch('approver_id');
  const approverNameValue = watch('approver_name');
  const linkedEntityIdValue = watch('linked_entity_id');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description()}</DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
            {/* Type */}
            <FormField name="type" label={t.type} required>
              <Select
                value={typeValue}
                onValueChange={(v) => {
                  const nextType = v as ApprovalRequestType;
                  setValue('type', nextType, { shouldValidate: true });
                  setValue('linked_entity_type', LINKED_ENTITY_TYPE[nextType], { shouldDirty: true });
                  setValue('linked_entity_id', '', { shouldDirty: true });
                }}
                disabled={mutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.selectType} />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {typeLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {/* Title */}
            <FormField name="title" label={t.titleLabel} required>
              <Input
                {...register('title')}
                id="title"
                placeholder={t.titlePlaceholder}
                disabled={mutation.isPending}
              />
            </FormField>

            {/* Description */}
            <FormField name="description" label={t.descriptionLabel}>
              <Textarea
                {...register('description')}
                id="description"
                placeholder={t.descriptionPlaceholder}
                rows={3}
                disabled={mutation.isPending}
              />
            </FormField>

            {/* Priority */}
            <FormField name="priority" label={t.priority} required>
              <Select
                value={priorityValue}
                onValueChange={(v) => setValue('priority', v, { shouldValidate: true })}
                disabled={mutation.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.selectPriority} />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {priorityLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {/* Deadline */}
            <FormField name="deadline" label={t.deadline} required>
              <Input
                {...register('deadline')}
                id="deadline"
                type="date"
                disabled={mutation.isPending}
              />
            </FormField>

            {/* Approver */}
            <FormField name="approver_id" label={t.approverName} required>
              <TenantUserPicker
                id="approver_id"
                ariaLabel={t.approverName}
                value={approverIdValue}
                onChange={(userId, option) => {
                  setValue('approver_id', userId, { shouldDirty: true, shouldValidate: true });
                  setValue('approver_name', option?.label ?? '', {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }}
                enabled={open}
                disabled={mutation.isPending}
                required
                selectedLabel={approverNameValue}
                labels={{ select: t.approverIdPlaceholder, search: t.approverNamePlaceholder }}
                className="w-full"
              />
            </FormField>

            {/* Linked Entity (optional) */}
            <FormField name="linked_entity_id" label={t.linkedEntityId}>
              <AsyncRecordPicker
                id="linked_entity_id"
                ariaLabel={t.linkedEntityId}
                queryKey={['vciso-approval-linked-entity', typeValue]}
                loadOptions={(search) => loadLinkedEntities(typeValue as ApprovalRequestType, search)}
                value={linkedEntityIdValue}
                onChange={(value) => setValue('linked_entity_id', value, { shouldDirty: true })}
                enabled={open && TYPE_VALUES.includes(typeValue as ApprovalRequestType)}
                disabled={mutation.isPending}
                allowClear
                labels={{
                  select: typeValue ? t.linkedEntityIdPlaceholder : t.selectType,
                  search: t.linkedEntityIdPlaceholder,
                }}
              />
            </FormField>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={mutation.isPending}
              >
                {t.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? t.creating : t.createRequest}
              </Button>
            </div>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
