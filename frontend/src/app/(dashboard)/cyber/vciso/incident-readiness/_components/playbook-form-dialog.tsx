'use client';

import { useState, useEffect } from 'react';
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
  VCISOPlaybook,
  PlaybookStatus,
} from '@/types/cyber';
import { useVcisoOpsLabels } from '../../_lib/vciso-i18n';

interface PlaybookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editPlaybook?: VCISOPlaybook | null;
}

const STATUS_VALUES: PlaybookStatus[] = ['draft', 'approved', 'tested', 'retired'];

interface FormState {
  name: string;
  scenario: string;
  status: PlaybookStatus;
  steps_count: string;
  dependencies: string;
  rto_hours: string;
  rpo_hours: string;
  next_test_date: string;
}

const initialFormState: FormState = {
  name: '',
  scenario: '',
  status: 'draft',
  steps_count: '',
  dependencies: '',
  rto_hours: '',
  rpo_hours: '',
  next_test_date: '',
};

function formStateFromPlaybook(playbook: VCISOPlaybook): FormState {
  return {
    name: playbook.name,
    scenario: playbook.scenario,
    status: playbook.status,
    steps_count: String(playbook.steps_count),
    dependencies: playbook.dependencies.join(', '),
    rto_hours: playbook.rto_hours != null ? String(playbook.rto_hours) : '',
    rpo_hours: playbook.rpo_hours != null ? String(playbook.rpo_hours) : '',
    next_test_date: playbook.next_test_date ? playbook.next_test_date.split('T')[0] : '',
  };
}

export function PlaybookFormDialog({
  open,
  onOpenChange,
  onSaved,
  editPlaybook,
}: PlaybookFormDialogProps) {
  const labels = useVcisoOpsLabels().incidentReadiness.playbook;
  const t = labels.form;
  const statusLabels = labels.statuses as Record<string, string>;
  const [form, setForm] = useState<FormState>(initialFormState);
  const isEditing = !!editPlaybook;

  useEffect(() => {
    if (open && editPlaybook) {
      setForm(formStateFromPlaybook(editPlaybook));
    } else if (open && !editPlaybook) {
      setForm(initialFormState);
    }
  }, [open, editPlaybook]);

  const createMutation = useApiMutation<VCISOPlaybook, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_PLAYBOOKS,
    {
      successMessage: t.createdToast(),
      invalidateKeys: ['vciso-playbooks'],
      onSuccess: () => {
        setForm(initialFormState);
        onOpenChange(false);
        onSaved();
      },
    },
  );

  const updateMutation = useApiMutation<VCISOPlaybook, Record<string, unknown>>(
    'put',
    editPlaybook ? `${API_ENDPOINTS.CYBER_VCISO_PLAYBOOKS}/${editPlaybook.id}` : '',
    {
      successMessage: t.updatedToast(),
      invalidateKeys: ['vciso-playbooks'],
      onSuccess: () => {
        setForm(initialFormState);
        onOpenChange(false);
        onSaved();
      },
    },
  );

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast.error(t.nameRequired);
      return;
    }
    if (!form.scenario.trim()) {
      toast.error(t.scenarioRequired);
      return;
    }
    if (!form.next_test_date) {
      toast.error(t.nextTestRequired);
      return;
    }

    const stepsCount = parseInt(form.steps_count, 10);
    if (form.steps_count && (isNaN(stepsCount) || stepsCount < 0)) {
      toast.error(t.stepsInvalid);
      return;
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      scenario: form.scenario.trim(),
      status: form.status,
      steps_count: stepsCount || 0,
      dependencies: form.dependencies
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      next_test_date: form.next_test_date,
      owner_id: (isEditing && editPlaybook?.owner_id) ? editPlaybook.owner_id : undefined,
      owner_name: isEditing ? (editPlaybook?.owner_name ?? '') : '',
    };

    if (form.rto_hours.trim()) {
      const rto = parseFloat(form.rto_hours);
      if (isNaN(rto) || rto < 0) {
        toast.error(t.rtoInvalid);
        return;
      }
      payload.rto_hours = rto;
    }

    if (form.rpo_hours.trim()) {
      const rpo = parseFloat(form.rpo_hours);
      if (isNaN(rpo) || rpo < 0) {
        toast.error(t.rpoInvalid);
        return;
      }
      payload.rpo_hours = rpo;
    }

    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setForm(initialFormState);
    }
    onOpenChange(o);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? t.editTitle() : t.createTitle()}</DialogTitle>
          <DialogDescription>
            {isEditing ? t.editDesc() : t.createDesc()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Basic info */}
          <div className="space-y-2">
            <Label htmlFor="playbook-name">
              {t.name} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="playbook-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t.namePlaceholder()}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="playbook-scenario">
              {t.scenario} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="playbook-scenario"
              value={form.scenario}
              onChange={(e) => setForm((f) => ({ ...f, scenario: e.target.value }))}
              placeholder={t.scenarioPlaceholder()}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t.status}</Label>
              <Select
                value={form.status}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, status: v as PlaybookStatus }))
                }
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
              <Label htmlFor="playbook-steps">{t.stepsCount}</Label>
              <Input
                id="playbook-steps"
                type="number"
                min={0}
                value={form.steps_count}
                onChange={(e) => setForm((f) => ({ ...f, steps_count: e.target.value }))}
                placeholder="e.g. 12"
              />
            </div>
          </div>

          <Separator />

          {/* Recovery Objectives */}
          <h4 className="text-sm font-semibold text-muted-foreground">{t.recoveryObjectives}</h4>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="playbook-rto">{t.rtoHours}</Label>
              <Input
                id="playbook-rto"
                type="number"
                min={0}
                step={0.5}
                value={form.rto_hours}
                onChange={(e) => setForm((f) => ({ ...f, rto_hours: e.target.value }))}
                placeholder="e.g. 4"
              />
              <p className="text-xs text-muted-foreground">{t.rtoHelp}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="playbook-rpo">{t.rpoHours}</Label>
              <Input
                id="playbook-rpo"
                type="number"
                min={0}
                step={0.5}
                value={form.rpo_hours}
                onChange={(e) => setForm((f) => ({ ...f, rpo_hours: e.target.value }))}
                placeholder="e.g. 1"
              />
              <p className="text-xs text-muted-foreground">{t.rpoHelp}</p>
            </div>
          </div>

          <Separator />

          {/* Schedule & Dependencies */}
          <h4 className="text-sm font-semibold text-muted-foreground">
            {t.scheduleDependencies}
          </h4>

          <div className="space-y-2">
            <Label htmlFor="playbook-next-test">
              {t.nextTestDate} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="playbook-next-test"
              type="date"
              value={form.next_test_date}
              onChange={(e) => setForm((f) => ({ ...f, next_test_date: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="playbook-dependencies">{t.dependencies}</Label>
            <Input
              id="playbook-dependencies"
              value={form.dependencies}
              onChange={(e) => setForm((f) => ({ ...f, dependencies: e.target.value }))}
              placeholder={t.dependenciesPlaceholder()}
            />
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
            {isPending
              ? isEditing
                ? t.saving
                : t.creating
              : isEditing
                ? t.saveChanges
                : t.createPlaybook()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
