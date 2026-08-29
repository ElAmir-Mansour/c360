'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TenantRolePicker } from '@/components/shared/forms/tenant-role-picker';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  LexApprovalFormFieldRequest,
  LexApprovalFormFieldType,
  LexApprovalPolicyApprover,
  LexApprovalPolicyApproverType,
  LexApprovalPolicyMode,
  LexApprovalPolicyQuorum,
} from '@/types/suites';
import {
  type CreateRequestApprovalPolicyPayload,
  type RequestApprovalPolicy,
  type RequestApprovalStage,
  lexRequestApprovalPoliciesApi,
} from '@/lib/lex/request-approval-policies';
import type { ServiceCatalogEntry } from '@/lib/lex/requests';
import type { RequestApprovalPolicyLabels } from '../_labels';

const POLICY_STATUSES = ['active', 'draft', 'archived'] as const;
const STAGES = ['requester', 'provider'] as const satisfies readonly RequestApprovalStage[];
const APPROVER_TYPES = ['role', 'user'] as const satisfies readonly LexApprovalPolicyApproverType[];
const POLICY_MODES = [
  'parallel',
  'sequential',
] as const satisfies readonly LexApprovalPolicyMode[];
const POLICY_QUORUMS = [
  'all',
  'any',
  'n_of_m',
] as const satisfies readonly LexApprovalPolicyQuorum[];
const FIELD_TYPES = [
  'textarea',
  'text',
  'select',
  'number',
  'date',
  'boolean',
] as const satisfies readonly LexApprovalFormFieldType[];

type RequestApprovalPolicyStatus = (typeof POLICY_STATUSES)[number];
const ANY = '__any__';

interface ApproverDraft {
  type: LexApprovalPolicyApproverType;
  ref: string;
  label: string;
}

interface FormFieldDraft {
  name: string;
  type: LexApprovalFormFieldType;
  label: string;
  required: boolean;
  options: string;
  placeholder: string;
  description: string;
}

interface PolicyFormValues {
  name: string;
  description: string;
  status: RequestApprovalPolicyStatus;
  priority: string;
  request_type: string;
  service_id: string;
  stage: RequestApprovalStage | typeof ANY;
  department: string;
  priority_tier: string;
  min_value: string;
  max_value: string;
  currency: string;
  mode: LexApprovalPolicyMode;
  quorum: LexApprovalPolicyQuorum;
  quorum_n: string;
  require_authority_evidence: boolean;
  required_role: string;
  required_authority_amount: string;
  valid_from: string;
  valid_until: string;
  approvers: ApproverDraft[];
  form_fields: FormFieldDraft[];
}

export function PolicyFormDialog({
  labels,
  open,
  onOpenChange,
  onSaved,
  policy,
  services,
}: {
  labels: RequestApprovalPolicyLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  policy?: RequestApprovalPolicy | null;
  services: ServiceCatalogEntry[];
}) {
  const { locale } = useLocaleOrDefault();
  const isEditing = policy != null;
  const [values, setValues] = useState<PolicyFormValues>(() => policyDefaults(policy));

  useEffect(() => {
    if (open) {
      setValues(policyDefaults(policy));
    }
  }, [open, policy]);

  const createMutation = useMutation({
    mutationFn: (payload: CreateRequestApprovalPolicyPayload) =>
      lexRequestApprovalPoliciesApi.createPolicy(payload),
    onSuccess: async () => {
      showSuccess(labels.toast.created);
      await onSaved();
      setValues(policyDefaults());
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: CreateRequestApprovalPolicyPayload) => {
      if (!policy) {
        throw new Error(labels.missingPolicy);
      }
      return lexRequestApprovalPoliciesApi.updatePolicy(policy.id, payload);
    },
    onSuccess: async () => {
      showSuccess(labels.toast.updated);
      await onSaved();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const conflictMutation = useMutation({
    mutationFn: (payload: CreateRequestApprovalPolicyPayload) =>
      lexRequestApprovalPoliciesApi.conflictCheck({
        ...payload,
        exclude_id: policy?.id,
      }),
    onError: showApiError,
  });

  const updateValue = <K extends keyof PolicyFormValues>(key: K, value: PolicyFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const updateApprover = <K extends keyof ApproverDraft>(
    index: number,
    key: K,
    value: ApproverDraft[K],
  ) => {
    setValues((current) => ({
      ...current,
      approvers: current.approvers.map((approver, i) =>
        i === index ? { ...approver, [key]: value } : approver,
      ),
    }));
  };

  const updateFormField = <K extends keyof FormFieldDraft>(
    index: number,
    key: K,
    value: FormFieldDraft[K],
  ) => {
    setValues((current) => ({
      ...current,
      form_fields: current.form_fields.map((field, i) =>
        i === index ? { ...field, [key]: value } : field,
      ),
    }));
  };

  const validApprovers = values.approvers.filter((a) => a.ref.trim() !== '');
  const validationErrors = validatePolicyForm(values, labels);
  const canSubmit = validationErrors.length === 0;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const payload = buildPolicyPayload(values);
    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const runConflictCheck = () => {
    if (validationErrors.length > 0) {
      return;
    }
    conflictMutation.mutate(buildPolicyPayload(values));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? labels.dialog.editTitle : labels.dialog.createTitle}
          </DialogTitle>
          <DialogDescription>{labels.dialog.description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-6" onSubmit={submit}>
          {!isEditing ? <LexCreationGuidance workflow="policy" /> : null}
          {/* Identity */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="rap-name">{labels.dialog.name}</Label>
              <Input
                id="rap-name"
                value={values.name}
                onChange={(e) => updateValue('name', e.target.value)}
                placeholder={labels.dialog.namePlaceholder}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="rap-description">{labels.dialog.descriptionField}</Label>
              <Textarea
                id="rap-description"
                value={values.description}
                onChange={(e) => updateValue('description', e.target.value)}
                rows={3}
                placeholder={labels.dialog.descriptionPlaceholder}
              />
            </div>
            <SelectField
              label={labels.dialog.status}
              value={values.status}
              onValueChange={(v) => updateValue('status', v as RequestApprovalPolicyStatus)}
              options={POLICY_STATUSES}
              formatOption={(o) => labels.statusLabels[o] ?? formatToken(o)}
            />
            <div className="space-y-2">
              <Label htmlFor="rap-priority">{labels.dialog.priority}</Label>
              <Input
                id="rap-priority"
                type="number"
                value={values.priority}
                onChange={(e) => updateValue('priority', e.target.value)}
                min={0}
              />
            </div>
          </div>

          {/* Scope */}
          <fieldset className="space-y-4 rounded-lg border px-4 py-4">
            <legend className="px-1 text-sm font-medium">{labels.dialog.sections.scope}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="rap-request-type">{labels.dialog.requestType}</Label>
                <Input
                  id="rap-request-type"
                  value={values.request_type}
                  onChange={(e) => updateValue('request_type', e.target.value)}
                  placeholder={labels.dialog.requestTypePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label>{labels.dialog.service}</Label>
                <Select
                  value={values.service_id || ANY}
                  onValueChange={(v) => updateValue('service_id', v === ANY ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={labels.dialog.selectService} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{labels.dialog.serviceAny}</SelectItem>
                    {services.map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {resolveLocalized(service.name, locale) || service.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SelectField
                label={labels.dialog.stage}
                value={values.stage}
                onValueChange={(v) =>
                  updateValue('stage', v as RequestApprovalStage | typeof ANY)
                }
                options={[ANY, ...STAGES]}
                formatOption={(o) =>
                  o === ANY ? labels.dialog.stageAny : labels.stageLabels[o] ?? formatToken(o)
                }
              />
              <div className="space-y-2">
                <Label htmlFor="rap-department">{labels.dialog.department}</Label>
                <Input
                  id="rap-department"
                  value={values.department}
                  onChange={(e) => updateValue('department', e.target.value)}
                  placeholder={labels.dialog.departmentPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rap-tier">{labels.dialog.priorityTier}</Label>
                <Input
                  id="rap-tier"
                  value={values.priority_tier}
                  onChange={(e) => updateValue('priority_tier', e.target.value)}
                  placeholder={labels.dialog.priorityTierPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rap-currency">{labels.dialog.currency}</Label>
                <Input
                  id="rap-currency"
                  value={values.currency}
                  onChange={(e) => updateValue('currency', e.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder={labels.dialog.currencyPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rap-min">{labels.dialog.minValue}</Label>
                <Input
                  id="rap-min"
                  type="number"
                  value={values.min_value}
                  onChange={(e) => updateValue('min_value', e.target.value)}
                  min={0}
                  placeholder={labels.dialog.minValuePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rap-max">{labels.dialog.maxValue}</Label>
                <Input
                  id="rap-max"
                  type="number"
                  value={values.max_value}
                  onChange={(e) => updateValue('max_value', e.target.value)}
                  min={values.min_value || 0}
                  placeholder={labels.dialog.maxValuePlaceholder}
                />
              </div>
            </div>
          </fieldset>

          {/* Routing */}
          <fieldset className="space-y-4 rounded-lg border px-4 py-4">
            <legend className="px-1 text-sm font-medium">{labels.dialog.sections.routing}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <SelectField
                label={labels.dialog.mode}
                value={values.mode}
                onValueChange={(v) => updateValue('mode', v as LexApprovalPolicyMode)}
                options={POLICY_MODES}
                formatOption={(o) => labels.modeLabels[o] ?? formatToken(o)}
              />
              <SelectField
                label={labels.dialog.quorum}
                value={values.quorum}
                onValueChange={(v) => updateValue('quorum', v as LexApprovalPolicyQuorum)}
                options={POLICY_QUORUMS}
                formatOption={(o) => labels.quorumLabels[o] ?? formatToken(o)}
              />
              <div className="space-y-2">
                <Label htmlFor="rap-quorum-n">{labels.dialog.quorumCount}</Label>
                <Input
                  id="rap-quorum-n"
                  type="number"
                  value={values.quorum_n}
                  onChange={(e) => updateValue('quorum_n', e.target.value)}
                  min={1}
                  max={validApprovers.length || undefined}
                  disabled={values.quorum !== 'n_of_m'}
                />
              </div>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr]">
            {/* Authority evidence */}
            <fieldset className="rounded-lg border px-4 py-4">
              <legend className="px-1 text-sm font-medium">
                {labels.dialog.sections.authority}
              </legend>
              <div className="flex items-start justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  {labels.dialog.authorityEvidenceDescription}
                </p>
                <Switch
                  checked={values.require_authority_evidence}
                  onCheckedChange={(checked) => updateValue('require_authority_evidence', checked)}
                  aria-label={labels.dialog.toggleAuthorityEvidence}
                />
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="rap-required-role">{labels.dialog.requiredRole}</Label>
                <TenantRolePicker
                  id="rap-required-role"
                  ariaLabel={labels.dialog.requiredRole}
                  valueKind="slug"
                  value={values.required_role}
                  onChange={(value) => updateValue('required_role', value)}
                  enabled={open}
                  allowClear
                  labels={{
                    select: labels.dialog.requiredRolePlaceholder,
                    search: labels.dialog.requiredRolePlaceholder,
                  }}
                />
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="rap-required-amount">{labels.dialog.authorityAmount}</Label>
                <Input
                  id="rap-required-amount"
                  type="number"
                  value={values.required_authority_amount}
                  onChange={(e) => updateValue('required_authority_amount', e.target.value)}
                  min={0}
                  placeholder={labels.dialog.authorityAmountPlaceholder}
                />
              </div>
            </fieldset>

            {/* Approvers */}
            <fieldset className="rounded-lg border px-4 py-4">
              <legend className="px-1 text-sm font-medium">
                {labels.dialog.sections.approvers}
              </legend>
              <div className="flex items-start justify-between gap-4">
                <p className="text-xs text-muted-foreground">{labels.dialog.approversDescription}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => updateValue('approvers', [...values.approvers, emptyApprover()])}
                >
                  <Plus className="me-1 h-3.5 w-3.5" />
                  {labels.dialog.add}
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {values.approvers.map((approver, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/20 p-3 md:grid-cols-[120px_1fr_1fr_auto]"
                  >
                    <Select
                      value={approver.type}
                      onValueChange={(v) => {
                        updateApprover(index, 'type', v as LexApprovalPolicyApproverType);
                        updateApprover(index, 'ref', '');
                        updateApprover(index, 'label', '');
                      }}
                    >
                      <SelectTrigger aria-label={labels.dialog.approverType}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {APPROVER_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {labels.approverTypeLabels[type] ?? formatToken(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {approver.type === 'role' ? (
                      <TenantRolePicker
                        ariaLabel={labels.dialog.approverRefRolePlaceholder}
                        valueKind="slug"
                        value={approver.ref}
                        onChange={(value, option) => {
                          updateApprover(index, 'ref', value);
                          if (option?.label) updateApprover(index, 'label', option.label);
                        }}
                        enabled={open}
                        required={index === 0}
                        selectedLabel={approver.label || undefined}
                        labels={{
                          select: labels.dialog.approverRefRolePlaceholder,
                          search: labels.dialog.approverRefRolePlaceholder,
                        }}
                      />
                    ) : (
                      <TenantUserPicker
                        ariaLabel={labels.dialog.approverRefUserPlaceholder}
                        value={approver.ref}
                        onChange={(value, option) => {
                          updateApprover(index, 'ref', value);
                          if (option?.label) updateApprover(index, 'label', option.label);
                        }}
                        enabled={open}
                        required={index === 0}
                        selectedLabel={approver.label || undefined}
                        labels={{
                          select: labels.dialog.approverRefUserPlaceholder,
                          search: labels.dialog.approverRefUserPlaceholder,
                        }}
                      />
                    )}
                    <Input
                      value={approver.label}
                      onChange={(e) => updateApprover(index, 'label', e.target.value)}
                      placeholder={labels.dialog.approverLabelPlaceholder}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateValue(
                          'approvers',
                          values.approvers.filter((_, i) => i !== index),
                        )
                      }
                      disabled={values.approvers.length === 1}
                      aria-label={labels.dialog.removeApprover}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </fieldset>
          </div>

          {/* Form fields */}
          <fieldset className="rounded-lg border px-4 py-4">
            <legend className="px-1 text-sm font-medium">
              {labels.dialog.sections.formFields}
            </legend>
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs text-muted-foreground">{labels.dialog.formFieldsDescription}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateValue('form_fields', [...values.form_fields, emptyFormField()])}
              >
                <Plus className="me-1 h-3.5 w-3.5" />
                {labels.dialog.add}
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {values.form_fields.map((field, index) => (
                <div key={index} className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_150px_auto]">
                    <Input
                      value={field.name}
                      onChange={(e) => updateFormField(index, 'name', e.target.value)}
                      placeholder={labels.dialog.fieldNamePlaceholder}
                    />
                    <Input
                      value={field.label}
                      onChange={(e) => updateFormField(index, 'label', e.target.value)}
                      placeholder={labels.dialog.fieldLabelPlaceholder}
                    />
                    <Select
                      value={field.type}
                      onValueChange={(v) =>
                        updateFormField(index, 'type', v as LexApprovalFormFieldType)
                      }
                    >
                      <SelectTrigger aria-label={labels.dialog.fieldType}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {labels.fieldTypeLabels[type] ?? formatToken(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateValue(
                          'form_fields',
                          values.form_fields.filter((_, i) => i !== index),
                        )
                      }
                      aria-label={labels.dialog.removeFormField}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <Input
                      value={field.placeholder}
                      onChange={(e) => updateFormField(index, 'placeholder', e.target.value)}
                      placeholder={labels.dialog.fieldPlaceholderPlaceholder}
                    />
                    <Input
                      value={field.options}
                      onChange={(e) => updateFormField(index, 'options', e.target.value)}
                      aria-label={labels.dialog.fieldOptions}
                      placeholder={labels.dialog.fieldOptionsPlaceholder}
                      disabled={field.type !== 'select'}
                      required={field.type === 'select'}
                    />
                    <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                      <Switch
                        checked={field.required}
                        onCheckedChange={(checked) => updateFormField(index, 'required', checked)}
                        aria-label={labels.dialog.toggleRequired}
                      />
                      {labels.dialog.required}
                    </label>
                  </div>
                  <Input
                    value={field.description}
                    onChange={(e) => updateFormField(index, 'description', e.target.value)}
                    aria-label={labels.dialog.fieldDescription}
                    placeholder={labels.dialog.fieldDescriptionPlaceholder}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          {/* Validity window */}
          <fieldset className="rounded-lg border px-4 py-4">
            <legend className="px-1 text-sm font-medium">{labels.dialog.sections.validity}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rap-valid-from">{labels.dialog.validFrom}</Label>
                <Input
                  id="rap-valid-from"
                  type="date"
                  value={values.valid_from}
                  onChange={(e) => updateValue('valid_from', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rap-valid-until">{labels.dialog.validUntil}</Label>
                <Input
                  id="rap-valid-until"
                  type="date"
                  value={values.valid_until}
                  onChange={(e) => updateValue('valid_until', e.target.value)}
                />
              </div>
            </div>
          </fieldset>

          {/* Conflict-check preview */}
          {conflictMutation.data ? (
            <ConflictPreview labels={labels} result={conflictMutation.data} />
          ) : null}

          {/* Validation errors */}
          {validationErrors.length > 0 ? (
            <div
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <p className="font-medium">{labels.dialog.validationHeader}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={runConflictCheck}
              disabled={!canSubmit || conflictMutation.isPending}
            >
              {conflictMutation.isPending ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
              ) : null}
              {labels.dialog.checkConflicts}
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.dialog.cancel}
              </Button>
              <Button type="submit" disabled={!canSubmit || isSaving}>
                {isSaving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {isEditing ? labels.dialog.save : labels.dialog.create}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConflictPreview({
  labels,
  result,
}: {
  labels: RequestApprovalPolicyLabels;
  result: { conflicts: RequestApprovalPolicy[]; has_conflicts: boolean; has_identical: boolean };
}) {
  if (!result.has_conflicts && !result.has_identical) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-primary">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {labels.conflict.noneTitle}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{labels.conflict.noneDescription}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning-300 bg-warning-50 px-4 py-3 text-sm dark:bg-warning-800/20">
      <p className="flex items-center gap-2 font-medium text-warning-700 dark:text-warning-300">
        {result.has_identical ? (
          <ShieldAlert className="h-4 w-4" aria-hidden />
        ) : (
          <AlertTriangle className="h-4 w-4" aria-hidden />
        )}
        {result.has_identical
          ? labels.conflict.identicalHeader
          : labels.conflict.conflictsHeader(result.conflicts.length)}
      </p>
      {result.conflicts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.conflicts.map((conflict) => (
            <Badge key={conflict.id} variant="warning">
              {conflict.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
  formatOption,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  formatOption?: (option: string) => string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {formatOption ? formatOption(option) : formatToken(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* --------------------------- form value helpers --------------------------- */

function policyDefaults(policy?: RequestApprovalPolicy | null): PolicyFormValues {
  if (policy) {
    return policyValuesFromPolicy(policy);
  }
  return {
    name: '',
    description: '',
    status: 'active',
    priority: '10',
    request_type: '',
    service_id: '',
    stage: ANY,
    department: '',
    priority_tier: '',
    min_value: '',
    max_value: '',
    currency: 'SAR',
    mode: 'parallel',
    quorum: 'all',
    quorum_n: '',
    require_authority_evidence: false,
    required_role: '',
    required_authority_amount: '',
    valid_from: '',
    valid_until: '',
    approvers: [emptyApprover()],
    form_fields: [],
  };
}

function policyValuesFromPolicy(policy: RequestApprovalPolicy): PolicyFormValues {
  const status = (POLICY_STATUSES as readonly string[]).includes(policy.status)
    ? (policy.status as RequestApprovalPolicyStatus)
    : 'draft';
  return {
    name: policy.name,
    description: policy.description ?? '',
    status,
    priority: String(policy.priority),
    request_type: policy.request_type ?? '',
    service_id: policy.service_id ?? '',
    stage: policy.stage ?? ANY,
    department: policy.department ?? '',
    priority_tier: policy.priority_tier ?? '',
    min_value: formatOptionalNumber(policy.min_value),
    max_value: formatOptionalNumber(policy.max_value),
    currency: policy.currency || 'SAR',
    mode: policy.mode,
    quorum: policy.quorum,
    quorum_n: formatOptionalNumber(policy.quorum_n),
    require_authority_evidence: policy.require_authority_evidence,
    required_role: policy.required_role ?? '',
    required_authority_amount: formatOptionalNumber(policy.required_authority_amount),
    valid_from: toDateInput(policy.valid_from),
    valid_until: toDateInput(policy.valid_until),
    approvers:
      policy.approvers.length > 0
        ? policy.approvers.map((a) => ({ type: a.type, ref: a.ref, label: a.label ?? '' }))
        : [emptyApprover()],
    form_fields: policy.form_fields.map((field) => ({
      name: field.name,
      type: field.type,
      label: field.label,
      required: Boolean(field.required),
      options: field.options?.join(', ') ?? '',
      placeholder: field.placeholder ?? '',
      description: field.description ?? '',
    })),
  };
}

function emptyApprover(): ApproverDraft {
  return { type: 'role', ref: '', label: '' };
}

function emptyFormField(): FormFieldDraft {
  return {
    name: '',
    type: 'text',
    label: '',
    required: false,
    options: '',
    placeholder: '',
    description: '',
  };
}

function validatePolicyForm(
  values: PolicyFormValues,
  labels: RequestApprovalPolicyLabels,
): string[] {
  const errors: string[] = [];
  if (values.name.trim() === '') {
    errors.push(labels.validation.nameRequired);
  }
  const approverCount = values.approvers.filter((a) => a.ref.trim() !== '').length;
  if (approverCount === 0) {
    errors.push(labels.validation.approverRequired);
  }
  if (values.quorum === 'n_of_m') {
    const quorumCount = Number.parseInt(values.quorum_n, 10);
    if (!Number.isFinite(quorumCount) || quorumCount < 1) {
      errors.push(labels.validation.quorumAtLeastOne);
    } else if (quorumCount > approverCount) {
      errors.push(labels.validation.quorumExceedsApprovers);
    }
  }
  const minValue = optionalNumber(values.min_value);
  const maxValue = optionalNumber(values.max_value);
  if (minValue != null && maxValue != null && minValue > maxValue) {
    errors.push(labels.validation.minExceedsMax);
  }
  values.form_fields.forEach((field, index) => {
    if (field.type === 'select' && parseCsv(field.options).length === 0) {
      errors.push(labels.validation.selectFieldNeedsOption(index + 1));
    }
  });
  return errors;
}

export function buildPolicyPayload(values: PolicyFormValues): CreateRequestApprovalPolicyPayload {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    status: values.status,
    priority: parseInteger(values.priority, 0),
    request_type: optionalString(values.request_type),
    service_id: optionalString(values.service_id),
    stage: values.stage === ANY ? null : values.stage,
    department: optionalString(values.department),
    priority_tier: optionalString(values.priority_tier),
    min_value: optionalNumber(values.min_value),
    max_value: optionalNumber(values.max_value),
    currency: formatCurrency(values.currency),
    mode: values.mode,
    quorum: values.quorum,
    quorum_n: values.quorum === 'n_of_m' ? parseInteger(values.quorum_n, 1) : null,
    approvers: buildApprovers(values.approvers),
    form_fields: buildFormFields(values.form_fields),
    require_authority_evidence: values.require_authority_evidence,
    required_role: optionalString(values.required_role),
    required_authority_amount: optionalNumber(values.required_authority_amount),
    valid_from: optionalString(values.valid_from),
    valid_until: optionalString(values.valid_until),
    metadata: { source: 'watheeq_request_approval_policy_admin' },
  };
}

function buildApprovers(approvers: ApproverDraft[]): LexApprovalPolicyApprover[] {
  return approvers
    .map((a) => ({ type: a.type, ref: a.ref.trim(), label: optionalString(a.label) }))
    .filter((a) => a.ref.length > 0);
}

function buildFormFields(fields: FormFieldDraft[]): LexApprovalFormFieldRequest[] {
  return fields
    .map((field) => ({
      name: field.name.trim(),
      type: field.type,
      label: field.label.trim(),
      required: field.required,
      options: field.type === 'select' ? parseCsv(field.options) : undefined,
      placeholder: optionalString(field.placeholder) ?? undefined,
      description: optionalString(field.description) ?? undefined,
    }))
    .filter((field) => field.name.length > 0 && field.label.length > 0);
}

function formatOptionalNumber(value?: number | null): string {
  return value == null ? '' : String(value);
}

function toDateInput(value?: string | null): string {
  if (!value) {
    return '';
  }
  return value.slice(0, 10);
}

function optionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatCurrency(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : 'SAR';
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}
