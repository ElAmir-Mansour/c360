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
import { Checkbox } from '@/components/ui/checkbox';
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
  VCISOEscalationRule,
  EscalationTriggerType,
  EscalationTarget,
} from '@/types/cyber';
import { useVcisoOpsLabels } from '../../_lib/vciso-i18n';

interface EscalationRuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editRule?: VCISOEscalationRule | null;
}

const TRIGGER_TYPE_VALUES: EscalationTriggerType[] = ['severity', 'time', 'count', 'custom'];
const TARGET_VALUES: EscalationTarget[] = ['management', 'legal', 'regulator', 'board', 'custom'];

const NOTIFICATION_CHANNELS = ['email', 'sms', 'slack', 'webhook'] as const;

interface FormState {
  name: string;
  description: string;
  trigger_type: EscalationTriggerType;
  trigger_condition: string;
  escalation_target: EscalationTarget;
  target_contacts: string;
  notification_channels: string[];
}

const initialFormState: FormState = {
  name: '',
  description: '',
  trigger_type: 'severity',
  trigger_condition: '',
  escalation_target: 'management',
  target_contacts: '',
  notification_channels: ['email'],
};

function formStateFromRule(rule: VCISOEscalationRule): FormState {
  return {
    name: rule.name,
    description: rule.description,
    trigger_type: rule.trigger_type,
    trigger_condition: rule.trigger_condition,
    escalation_target: rule.escalation_target,
    target_contacts: rule.target_contacts.join(', '),
    notification_channels: [...rule.notification_channels],
  };
}

export function EscalationRuleFormDialog({
  open,
  onOpenChange,
  onSaved,
  editRule,
}: EscalationRuleFormDialogProps) {
  const labels = useVcisoOpsLabels().incidentReadiness.escalationRule;
  const t = labels.form;
  const triggerTypeLabels = labels.triggerTypes as Record<string, string>;
  const targetLabels = labels.targets;
  const [form, setForm] = useState<FormState>(initialFormState);
  const isEditing = !!editRule;

  useEffect(() => {
    if (open && editRule) {
      setForm(formStateFromRule(editRule));
    } else if (open && !editRule) {
      setForm(initialFormState);
    }
  }, [open, editRule]);

  const createMutation = useApiMutation<VCISOEscalationRule, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_VCISO_ESCALATION_RULES,
    {
      successMessage: t.createdToast,
      invalidateKeys: ['vciso-escalation-rules'],
      onSuccess: () => {
        setForm(initialFormState);
        onOpenChange(false);
        onSaved();
      },
    },
  );

  const updateMutation = useApiMutation<VCISOEscalationRule, Record<string, unknown>>(
    'put',
    editRule ? `${API_ENDPOINTS.CYBER_VCISO_ESCALATION_RULES}/${editRule.id}` : '',
    {
      successMessage: t.updatedToast,
      invalidateKeys: ['vciso-escalation-rules'],
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
    if (!form.trigger_condition.trim()) {
      toast.error(t.conditionRequired);
      return;
    }
    if (form.notification_channels.length === 0) {
      toast.error(t.channelRequired);
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      trigger_type: form.trigger_type,
      trigger_condition: form.trigger_condition.trim(),
      escalation_target: form.escalation_target,
      target_contacts: form.target_contacts
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      notification_channels: form.notification_channels,
      enabled: isEditing ? (editRule?.enabled ?? true) : true,
    };

    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleChannelToggle = (channel: string, checked: boolean) => {
    setForm((f) => ({
      ...f,
      notification_channels: checked
        ? [...f.notification_channels, channel]
        : f.notification_channels.filter((c) => c !== channel),
    }));
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
          <DialogTitle>{isEditing ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>
            {isEditing ? t.editDesc : t.createDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Basic info */}
          <div className="space-y-2">
            <Label htmlFor="rule-name">
              {t.name} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rule-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t.namePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-description">{t.description}</Label>
            <Textarea
              id="rule-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t.descriptionPlaceholder}
              rows={3}
            />
          </div>

          <Separator />

          {/* Trigger configuration */}
          <h4 className="text-sm font-semibold text-muted-foreground">{t.triggerConfig}</h4>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t.triggerType}</Label>
              <Select
                value={form.trigger_type}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, trigger_type: v as EscalationTriggerType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_TYPE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {triggerTypeLabels[value] ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t.escalationTarget}</Label>
              <Select
                value={form.escalation_target}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, escalation_target: v as EscalationTarget }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {targetLabels[value]?.() ?? value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-condition">
              {t.triggerCondition} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rule-condition"
              value={form.trigger_condition}
              onChange={(e) => setForm((f) => ({ ...f, trigger_condition: e.target.value }))}
              placeholder="e.g. severity >= critical AND unresolved > 30m"
            />
            <p className="text-xs text-muted-foreground">{t.triggerConditionHelp}</p>
          </div>

          <Separator />

          {/* Contact & Notification */}
          <h4 className="text-sm font-semibold text-muted-foreground">
            {t.contactsNotifications}
          </h4>

          <div className="space-y-2">
            <Label htmlFor="rule-contacts">{t.targetContacts}</Label>
            <Input
              id="rule-contacts"
              value={form.target_contacts}
              onChange={(e) => setForm((f) => ({ ...f, target_contacts: e.target.value }))}
              placeholder="ciso@company.com, security-team@company.com"
            />
          </div>

          <div className="space-y-2">
            <Label>
              {t.notificationChannels} <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-4 pt-1">
              {NOTIFICATION_CHANNELS.map((channel) => (
                <label
                  key={channel}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={form.notification_channels.includes(channel)}
                    onCheckedChange={(checked) =>
                      handleChannelToggle(channel, checked === true)
                    }
                  />
                  <span className="capitalize">{channel}</span>
                </label>
              ))}
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
            {isPending
              ? isEditing
                ? t.saving
                : t.creating
              : isEditing
                ? t.saveChanges
                : t.createRule}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
