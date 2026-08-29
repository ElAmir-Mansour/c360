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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import type { VCISOAwarenessProgram, AwarenessProgramType } from '@/types/cyber';
import { useVcisoPanelLabels } from '../../_lib/vciso-i18n';

interface AwarenessFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  program?: VCISOAwarenessProgram | null;
}

const TYPE_VALUES: AwarenessProgramType[] = [
  'training',
  'phishing_simulation',
  'policy_attestation',
];

interface FormState {
  name: string;
  type: AwarenessProgramType;
  total_users: string;
  start_date: string;
  end_date: string;
}

const initialFormState: FormState = {
  name: '',
  type: 'training',
  total_users: '',
  start_date: '',
  end_date: '',
};

export function AwarenessFormDialog({
  open,
  onOpenChange,
  onCreated,
  program,
}: AwarenessFormDialogProps) {
  const labels = useVcisoPanelLabels().awareness;
  const t = labels.form;
  const typeLabels = labels.types as Record<string, string>;
  const isEdit = !!program;

  const [form, setForm] = useState<FormState>(() =>
    program
      ? {
          name: program.name,
          type: program.type,
          total_users: String(program.total_users),
          start_date: program.start_date ? program.start_date.split('T')[0] : '',
          end_date: program.end_date ? program.end_date.split('T')[0] : '',
        }
      : initialFormState,
  );

  const createMutation = useApiMutation<VCISOAwarenessProgram, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_AWARENESS,
    {
      successMessage: t.createdToast,
      invalidateKeys: ['vciso-awareness'],
      onSuccess: () => {
        setForm(initialFormState);
        onOpenChange(false);
        onCreated();
      },
    },
  );

  const updateMutation = useApiMutation<VCISOAwarenessProgram, Record<string, unknown>>(
    'put',
    program ? `${API_ENDPOINTS.CYBER_VCISO_AWARENESS}/${program.id}` : '',
    {
      successMessage: t.updatedToast,
      invalidateKeys: ['vciso-awareness'],
      onSuccess: () => {
        onOpenChange(false);
        onCreated();
      },
    },
  );

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast.error(t.nameRequired);
      return;
    }
    if (!form.total_users || parseInt(form.total_users, 10) <= 0) {
      toast.error(t.totalUsersPositive);
      return;
    }
    if (!form.start_date) {
      toast.error(t.startRequired);
      return;
    }
    if (!form.end_date) {
      toast.error(t.endRequired);
      return;
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      type: form.type,
      status: isEdit ? (program?.status ?? 'scheduled') : 'scheduled',
      total_users: parseInt(form.total_users, 10),
      completed_users: isEdit ? (program?.completed_users ?? 0) : 0,
      passed_users: isEdit ? (program?.passed_users ?? 0) : 0,
      failed_users: isEdit ? (program?.failed_users ?? 0) : 0,
      start_date: form.start_date,
      end_date: form.end_date,
    };

    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleOpenChange = (o: boolean) => {
    if (!o && !isEdit) {
      setForm(initialFormState);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? t.editDesc : t.createDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="program-name">
              {t.name} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="program-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t.namePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label>
              {t.type} <span className="text-destructive">*</span>
            </Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm((f) => ({ ...f, type: v as AwarenessProgramType }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {typeLabels[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="program-total-users">
              {t.totalUsers} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="program-total-users"
              type="number"
              min={1}
              value={form.total_users}
              onChange={(e) => setForm((f) => ({ ...f, total_users: e.target.value }))}
              placeholder={t.totalUsersPlaceholder}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="program-start-date">
                {t.startDate} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="program-start-date"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="program-end-date">
                {t.endDate} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="program-end-date"
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            {t.cancel}
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (isEdit ? t.saving : t.creating) : (isEdit ? t.saveChanges : t.createProgram)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
