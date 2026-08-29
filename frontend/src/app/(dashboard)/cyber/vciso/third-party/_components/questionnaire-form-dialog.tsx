'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AsyncRecordPicker,
  type RecordPickerOption,
} from '@/components/shared/forms/async-record-picker';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
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
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { PaginatedResponse } from '@/types/api';
import type {
  QuestionnaireType,
  VCISOQuestionnaire,
  VCISOVendor,
} from '@/types/cyber';
import { useVcisoOpsLabels } from '../../_lib/vciso-i18n';

const QUESTIONNAIRE_TYPE_VALUES: QuestionnaireType[] = ['vendor', 'customer', 'audit', 'internal'];

async function loadVendorOptions(search: string): Promise<RecordPickerOption[]> {
  const response = await apiGet<PaginatedResponse<VCISOVendor>>(
    API_ENDPOINTS.CYBER_VCISO_VENDORS,
    {
      page: 1,
      per_page: 30,
      sort: 'name',
      order: 'asc',
      search: search || undefined,
    },
  );

  return response.data.map((vendor) => ({
    value: vendor.id,
    label: vendor.name,
    description: `${vendor.category} · ${vendor.risk_tier}`,
    keywords: [vendor.category, vendor.status, vendor.risk_tier],
  }));
}

interface QuestionnaireFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionnaire?: VCISOQuestionnaire | null;
  onSuccess: () => void;
  defaultVendorId?: string;
}

export function QuestionnaireFormDialog({
  open,
  onOpenChange,
  questionnaire,
  onSuccess,
  defaultVendorId,
}: QuestionnaireFormDialogProps) {
  const labels = useVcisoOpsLabels().thirdParty.questionnaire;
  const t = labels.form;
  const typeLabels = labels.types as Record<string, string>;
  const isEditing = !!questionnaire;

  const [title, setTitle] = useState('');
  const [type, setType] = useState<QuestionnaireType>('vendor');
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [totalQuestions, setTotalQuestions] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [assignedToName, setAssignedToName] = useState('');

  useEffect(() => {
    if (open) {
      if (questionnaire) {
        setTitle(questionnaire.title);
        setType(questionnaire.type);
        setVendorId(questionnaire.vendor_id ?? '');
        setVendorName(questionnaire.vendor_name ?? '');
        setTotalQuestions(String(questionnaire.total_questions));
        setDueDate(questionnaire.due_date ? questionnaire.due_date.split('T')[0] : '');
        setAssignedTo(questionnaire.assigned_to ?? '');
        setAssignedToName(questionnaire.assigned_to_name ?? '');
      } else {
        setTitle('');
        setType('vendor');
        setVendorId(defaultVendorId ?? '');
        setVendorName('');
        setTotalQuestions('');
        setDueDate('');
        setAssignedTo('');
        setAssignedToName('');
      }
    }
  }, [open, questionnaire, defaultVendorId]);

  const createMutation = useApiMutation<VCISOQuestionnaire, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_QUESTIONNAIRES,
    {
      invalidateKeys: ['vciso-questionnaires'],
      successMessage: t.createdToast,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const updateMutation = useApiMutation<VCISOQuestionnaire, Record<string, unknown>>(
    'put',
    () => `${API_ENDPOINTS.CYBER_VCISO_QUESTIONNAIRES}/${questionnaire?.id}`,
    {
      invalidateKeys: ['vciso-questionnaires'],
      successMessage: t.updatedToast,
      onSuccess: () => {
        onOpenChange(false);
        onSuccess();
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error(t.titleRequired);
      return;
    }
    if (!totalQuestions || parseInt(totalQuestions, 10) < 1) {
      toast.error(t.totalQuestionsMin);
      return;
    }
    if (!dueDate) {
      toast.error(t.dueDateRequired);
      return;
    }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      type,
      status: isEditing ? (questionnaire?.status ?? 'draft') : 'draft',
      total_questions: parseInt(totalQuestions, 10),
      due_date: dueDate,
      vendor_id: vendorId.trim() || undefined,
      vendor_name: vendorName.trim() || undefined,
      assigned_to: assignedTo.trim() || undefined,
      assigned_to_name: assignedToName.trim() || undefined,
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t.editTitle : t.createTitle}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t.editDesc : t.createDesc}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="q-title">{t.title}</Label>
            <Input
              id="q-title"
              placeholder={t.titlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="q-type">{t.type}</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as QuestionnaireType)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="q-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTIONNAIRE_TYPE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {typeLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-questions">{t.totalQuestions}</Label>
              <Input
                id="q-questions"
                type="number"
                min={1}
                placeholder="e.g., 50"
                value={totalQuestions}
                onChange={(e) => setTotalQuestions(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="q-vendor-id">{t.vendorName}</Label>
            <AsyncRecordPicker
              id="q-vendor-id"
              ariaLabel={t.vendorName}
              queryKey={['vciso-questionnaire-vendor-picker']}
              loadOptions={loadVendorOptions}
              value={vendorId}
              onChange={(selectedVendorId, option) => {
                setVendorId(selectedVendorId);
                setVendorName(option?.label ?? '');
              }}
              enabled={open}
              disabled={isSubmitting}
              allowClear
              selectedLabel={vendorName}
              labels={{
                select: t.vendorName,
                search: t.vendorNamePlaceholder,
              }}
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="q-due-date">{t.dueDate}</Label>
              <Input
                id="q-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="q-assigned-to">{t.assignedTo}</Label>
              <TenantUserPicker
                id="q-assigned-to"
                ariaLabel={t.assignedTo}
                value={assignedTo}
                onChange={(userId, option) => {
                  setAssignedTo(userId);
                  setAssignedToName(option?.label ?? '');
                }}
                enabled={open}
                disabled={isSubmitting}
                allowClear
                selectedLabel={assignedToName}
                labels={{ select: t.assignedToPlaceholder, search: t.assignedToPlaceholder }}
                className="w-full"
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
                  ? t.updateQuestionnaire
                  : t.createQuestionnaire}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
