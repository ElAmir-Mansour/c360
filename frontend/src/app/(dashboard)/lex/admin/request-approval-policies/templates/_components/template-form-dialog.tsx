'use client';

/**
 * Create/edit dialog for a Request-Approval Policy Template.
 *
 * The template `definition` is the policy-shape object (the same fields as a
 * request-approval policy create payload: scope dims, value range, routing,
 * authority block, approvers, form_fields, validity window). This dialog mirrors
 * the live policy editor's structured controls and validation.
 *
 * SINGLE SOURCE OF TRUTH: the structured editor (`TemplateDefinitionDraft`) is
 * authoritative. The definition is DERIVED from it via `definitionFromDraft` on
 * save. There is NO editable raw-JSON source — only a collapsible read-only JSON
 * preview of the derived definition, plus an "advanced metadata" key/value list
 * for ARBITRARY EXTRA keys that merge last and can never overwrite a managed
 * field. So no code path where editing one field wipes another.
 */

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  type CreateRequestApprovalPolicyTemplatePayload,
  lexRequestApprovalPoliciesApi,
  type RequestApprovalPolicyTemplate,
} from '@/lib/lex/request-approval-policies';
import { lexRequestsApi } from '@/lib/lex/requests';
import type {
  LexApprovalFormFieldType,
  LexApprovalPolicyApproverType,
  LexApprovalPolicyMode,
  LexApprovalPolicyQuorum,
} from '@/types/suites';
import { resolveValidationMessage, type TemplateLabels } from '../_labels';
import {
  type ApproverDraft,
  definitionFromDraft,
  draftFromDefinition,
  emptyApprover,
  emptyExtraMetadata,
  emptyFormField,
  emptyTemplateDraft,
  type FormFieldDraft,
  STRUCTURED_MANAGED_KEYS,
  type TemplateDefinitionDraft,
  TEMPLATE_APPROVER_TYPES,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_MODES,
  TEMPLATE_QUORUMS,
  validateDefinition,
} from '../_lib/template-definition';
import { TEMPLATES_QUERY_KEY } from './query-keys';

const STAGE_ANY = '__any__';
const COMMON_CATEGORIES = ['procurement', 'legal', 'finance', 'hr', 'general'] as const;
const MANAGED_KEY_SET = new Set<string>(STRUCTURED_MANAGED_KEYS);

export function TemplateFormDialog({
  labels,
  open,
  onOpenChange,
  template,
}: {
  labels: TemplateLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: RequestApprovalPolicyTemplate | null;
}) {
  const queryClient = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const isEditing = template != null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [draft, setDraft] = useState<TemplateDefinitionDraft>(emptyTemplateDraft);
  const [nameError, setNameError] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const servicesQuery = useQuery({
    queryKey: ['lex-request-approval-policy-services'],
    queryFn: () =>
      lexRequestsApi.listServices({ page: 1, per_page: 500, sort: 'code', order: 'asc' }),
    enabled: open,
  });
  const services = useMemo(() => servicesQuery.data?.data ?? [], [servicesQuery.data]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(template?.name ?? '');
    setDescription(template?.description ?? '');
    setCategory(template?.category ?? '');
    setDraft(draftFromDefinition(template?.definition ?? null));
    setNameError(false);
    setShowPreview(false);
  }, [open, template]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY });

  const createMutation = useMutation({
    mutationFn: (payload: CreateRequestApprovalPolicyTemplatePayload) =>
      lexRequestApprovalPoliciesApi.createTemplate(payload),
    onSuccess: async () => {
      showSuccess(labels.toast.created);
      await refresh();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: CreateRequestApprovalPolicyTemplatePayload) => {
      if (!template) {
        throw new Error('missing template');
      }
      return lexRequestApprovalPoliciesApi.updateTemplate(template.id, payload);
    },
    onSuccess: async () => {
      showSuccess(labels.toast.updated);
      await refresh();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const update = <K extends keyof TemplateDefinitionDraft>(
    key: K,
    value: TemplateDefinitionDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateApprover = <K extends keyof ApproverDraft>(
    index: number,
    key: K,
    value: ApproverDraft[K],
  ) => {
    setDraft((current) => ({
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
    setDraft((current) => ({
      ...current,
      form_fields: current.form_fields.map((field, i) =>
        i === index ? { ...field, [key]: value } : field,
      ),
    }));
  };

  const updateMetadata = (index: number, key: 'key' | 'value', value: string) => {
    setDraft((current) => ({
      ...current,
      extra_metadata: current.extra_metadata.map((entry, i) =>
        i === index ? { ...entry, [key]: value } : entry,
      ),
    }));
  };

  const validApprovers = draft.approvers.filter((a) => a.ref.trim() !== '');
  const validationKeys = useMemo(() => validateDefinition(draft), [draft]);
  const validationMessages = useMemo(
    () => validationKeys.map((key) => resolveValidationMessage(key, labels)),
    [validationKeys, labels],
  );
  const derivedDefinition = useMemo(() => definitionFromDraft(draft), [draft]);
  const canSubmit = name.trim() !== '' && validationKeys.length === 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === '') {
      setNameError(true);
      return;
    }
    if (validationKeys.length > 0) {
      return;
    }
    const payload: CreateRequestApprovalPolicyTemplatePayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      definition: derivedDefinition,
    };
    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? labels.dialog.editTitle : labels.dialog.createTitle}</DialogTitle>
          <DialogDescription>{labels.dialog.description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-6" onSubmit={submit}>
          {!isEditing ? <LexCreationGuidance workflow="policy" /> : null}
          {/* Identity */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="template-name">{labels.dialog.name}</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) {
                    setNameError(false);
                  }
                }}
                placeholder={labels.dialog.namePlaceholder}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="template-description">{labels.dialog.descriptionField}</Label>
              <Textarea
                id="template-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                placeholder={labels.dialog.descriptionPlaceholder}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="template-category">{labels.dialog.category}</Label>
              <Input
                id="template-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder={labels.dialog.categoryPlaceholder}
                list="template-category-options"
              />
              <datalist id="template-category-options">
                {COMMON_CATEGORIES.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">{labels.dialog.definitionSectionTitle}</p>
            <p className="text-xs text-muted-foreground">
              {labels.dialog.definitionSectionDescription}
            </p>
          </div>

          {/* Scope */}
          <fieldset className="space-y-4 rounded-lg border px-4 py-4">
            <legend className="px-1 text-sm font-medium">{labels.dialog.sections.scope}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="template-request-type">{labels.dialog.requestType}</Label>
                <Input
                  id="template-request-type"
                  value={draft.request_type}
                  onChange={(event) => update('request_type', event.target.value)}
                  placeholder={labels.dialog.requestTypePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label>{labels.dialog.service}</Label>
                <Select
                  value={draft.service_id || STAGE_ANY}
                  onValueChange={(value) =>
                    update('service_id', value === STAGE_ANY ? '' : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={labels.dialog.selectService} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={STAGE_ANY}>{labels.dialog.serviceAny}</SelectItem>
                    {services.map((service) => (
                      <SelectItem key={service.id} value={service.id}>
                        {resolveLocalized(service.name, locale) || service.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{labels.dialog.stage}</Label>
                <Select
                  value={draft.stage || STAGE_ANY}
                  onValueChange={(value) =>
                    update('stage', value === STAGE_ANY ? '' : (value as TemplateDefinitionDraft['stage']))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={STAGE_ANY}>{labels.dialog.stageAny}</SelectItem>
                    <SelectItem value="requester">
                      {labels.stageLabels.requester ?? 'requester'}
                    </SelectItem>
                    <SelectItem value="provider">
                      {labels.stageLabels.provider ?? 'provider'}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-department">{labels.dialog.department}</Label>
                <Input
                  id="template-department"
                  value={draft.department}
                  onChange={(event) => update('department', event.target.value)}
                  placeholder={labels.dialog.departmentPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-tier">{labels.dialog.priorityTier}</Label>
                <Input
                  id="template-tier"
                  value={draft.priority_tier}
                  onChange={(event) => update('priority_tier', event.target.value)}
                  placeholder={labels.dialog.priorityTierPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-priority">{labels.dialog.priority}</Label>
                <Input
                  id="template-priority"
                  type="number"
                  min={0}
                  value={draft.priority}
                  onChange={(event) => update('priority', event.target.value)}
                  placeholder={labels.dialog.priorityPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-currency">{labels.dialog.currency}</Label>
                <Input
                  id="template-currency"
                  value={draft.currency}
                  onChange={(event) => update('currency', event.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder={labels.dialog.currencyPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-min">{labels.dialog.minValue}</Label>
                <Input
                  id="template-min"
                  type="number"
                  min={0}
                  value={draft.min_value}
                  onChange={(event) => update('min_value', event.target.value)}
                  placeholder={labels.dialog.minValuePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-max">{labels.dialog.maxValue}</Label>
                <Input
                  id="template-max"
                  type="number"
                  min={draft.min_value || 0}
                  value={draft.max_value}
                  onChange={(event) => update('max_value', event.target.value)}
                  placeholder={labels.dialog.maxValuePlaceholder}
                />
              </div>
            </div>
          </fieldset>

          {/* Routing */}
          <fieldset className="space-y-4 rounded-lg border px-4 py-4">
            <legend className="px-1 text-sm font-medium">{labels.dialog.sections.routing}</legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>{labels.dialog.mode}</Label>
                <Select
                  value={draft.mode}
                  onValueChange={(value) => update('mode', value as LexApprovalPolicyMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {labels.modeLabels[mode] ?? mode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{labels.dialog.quorum}</Label>
                <Select
                  value={draft.quorum}
                  onValueChange={(value) => update('quorum', value as LexApprovalPolicyQuorum)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_QUORUMS.map((quorum) => (
                      <SelectItem key={quorum} value={quorum}>
                        {labels.quorumLabels[quorum] ?? quorum}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-quorum-n">{labels.dialog.quorumCount}</Label>
                <Input
                  id="template-quorum-n"
                  type="number"
                  min={1}
                  max={validApprovers.length || undefined}
                  value={draft.quorum_n}
                  onChange={(event) => update('quorum_n', event.target.value)}
                  disabled={draft.quorum !== 'n_of_m'}
                />
              </div>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr]">
            {/* Authority evidence */}
            <fieldset className="rounded-lg border px-4 py-4">
              <legend className="px-1 text-sm font-medium">{labels.dialog.sections.authority}</legend>
              <div className="flex items-start justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  {labels.dialog.authorityEvidenceDescription}
                </p>
                <Switch
                  checked={draft.require_authority_evidence}
                  onCheckedChange={(checked) => update('require_authority_evidence', checked)}
                  aria-label={labels.dialog.toggleAuthorityEvidence}
                />
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="template-required-role">{labels.dialog.requiredRole}</Label>
                <TenantRolePicker
                  id="template-required-role"
                  ariaLabel={labels.dialog.requiredRole}
                  valueKind="slug"
                  value={draft.required_role}
                  onChange={(value) => update('required_role', value)}
                  enabled={open}
                  allowClear
                  labels={{
                    select: labels.dialog.requiredRolePlaceholder,
                    search: labels.dialog.requiredRolePlaceholder,
                  }}
                />
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="template-required-amount">{labels.dialog.authorityAmount}</Label>
                <Input
                  id="template-required-amount"
                  type="number"
                  min={0}
                  value={draft.required_authority_amount}
                  onChange={(event) => update('required_authority_amount', event.target.value)}
                  placeholder={labels.dialog.authorityAmountPlaceholder}
                />
              </div>
            </fieldset>

            {/* Approvers */}
            <fieldset className="rounded-lg border px-4 py-4">
              <legend className="px-1 text-sm font-medium">{labels.dialog.sections.approvers}</legend>
              <div className="flex items-start justify-between gap-4">
                <p className="text-xs text-muted-foreground">{labels.dialog.approversDescription}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update('approvers', [...draft.approvers, emptyApprover()])}
                >
                  <Plus className="me-1 h-3.5 w-3.5" />
                  {labels.dialog.add}
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {draft.approvers.map((approver, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/20 p-3 md:grid-cols-[120px_1fr_1fr_auto]"
                  >
                    <Select
                      value={approver.type}
                      onValueChange={(value) => {
                        updateApprover(index, 'type', value as LexApprovalPolicyApproverType);
                        updateApprover(index, 'ref', '');
                        updateApprover(index, 'label', '');
                      }}
                    >
                      <SelectTrigger aria-label={labels.dialog.approverType}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_APPROVER_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {labels.approverTypeLabels[type] ?? type}
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
                        selectedLabel={approver.label || undefined}
                        labels={{
                          select: labels.dialog.approverRefUserPlaceholder,
                          search: labels.dialog.approverRefUserPlaceholder,
                        }}
                      />
                    )}
                    <Input
                      value={approver.label}
                      onChange={(event) => updateApprover(index, 'label', event.target.value)}
                      placeholder={labels.dialog.approverLabelPlaceholder}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        update(
                          'approvers',
                          draft.approvers.filter((_, i) => i !== index),
                        )
                      }
                      disabled={draft.approvers.length === 1}
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
            <legend className="px-1 text-sm font-medium">{labels.dialog.sections.formFields}</legend>
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs text-muted-foreground">{labels.dialog.formFieldsDescription}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => update('form_fields', [...draft.form_fields, emptyFormField()])}
              >
                <Plus className="me-1 h-3.5 w-3.5" />
                {labels.dialog.add}
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {draft.form_fields.map((field, index) => (
                <div key={index} className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_150px_auto]">
                    <Input
                      value={field.name}
                      onChange={(event) => updateFormField(index, 'name', event.target.value)}
                      placeholder={labels.dialog.fieldNamePlaceholder}
                    />
                    <Input
                      value={field.label}
                      onChange={(event) => updateFormField(index, 'label', event.target.value)}
                      placeholder={labels.dialog.fieldLabelPlaceholder}
                    />
                    <Select
                      value={field.type}
                      onValueChange={(value) =>
                        updateFormField(index, 'type', value as LexApprovalFormFieldType)
                      }
                    >
                      <SelectTrigger aria-label={labels.dialog.fieldType}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TEMPLATE_FIELD_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {labels.fieldTypeLabels[type] ?? type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        update(
                          'form_fields',
                          draft.form_fields.filter((_, i) => i !== index),
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
                      onChange={(event) => updateFormField(index, 'placeholder', event.target.value)}
                      placeholder={labels.dialog.fieldPlaceholderPlaceholder}
                    />
                    <Input
                      value={field.options}
                      onChange={(event) => updateFormField(index, 'options', event.target.value)}
                      aria-label={labels.dialog.fieldOptions}
                      placeholder={labels.dialog.fieldOptionsPlaceholder}
                      disabled={field.type !== 'select'}
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
                    onChange={(event) => updateFormField(index, 'description', event.target.value)}
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
                <Label htmlFor="template-valid-from">{labels.dialog.validFrom}</Label>
                <Input
                  id="template-valid-from"
                  type="date"
                  value={draft.valid_from}
                  onChange={(event) => update('valid_from', event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-valid-until">{labels.dialog.validUntil}</Label>
                <Input
                  id="template-valid-until"
                  type="date"
                  value={draft.valid_until}
                  onChange={(event) => update('valid_until', event.target.value)}
                />
              </div>
            </div>
          </fieldset>

          {/* Advanced metadata (arbitrary extra keys only) */}
          <fieldset className="rounded-lg border px-4 py-4">
            <legend className="px-1 text-sm font-medium">{labels.dialog.advancedTitle}</legend>
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs text-muted-foreground">{labels.dialog.advancedDescription}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => update('extra_metadata', [...draft.extra_metadata, emptyExtraMetadata()])}
              >
                <Plus className="me-1 h-3.5 w-3.5" />
                {labels.dialog.addMetadata}
              </Button>
            </div>
            {draft.extra_metadata.length > 0 ? (
              <div className="mt-4 space-y-3">
                {draft.extra_metadata.map((entry, index) => {
                  const reserved = MANAGED_KEY_SET.has(entry.key.trim());
                  return (
                    <div key={index} className="space-y-1">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                        <Input
                          value={entry.key}
                          onChange={(event) => updateMetadata(index, 'key', event.target.value)}
                          placeholder={labels.dialog.metadataKeyPlaceholder}
                          dir="ltr"
                          aria-invalid={reserved}
                        />
                        <Input
                          value={entry.value}
                          onChange={(event) => updateMetadata(index, 'value', event.target.value)}
                          placeholder={labels.dialog.metadataValuePlaceholder}
                          dir="ltr"
                          className="font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            update(
                              'extra_metadata',
                              draft.extra_metadata.filter((_, i) => i !== index),
                            )
                          }
                          aria-label={labels.dialog.removeMetadata}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {reserved ? (
                        <p className="text-xs text-warning-700 dark:text-warning-300">{labels.dialog.metadataReservedKey}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </fieldset>

          {/* Read-only derived JSON preview */}
          <div className="rounded-lg border px-4 py-3">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 text-start"
              onClick={() => setShowPreview((value) => !value)}
              aria-expanded={showPreview}
            >
              <span>
                <span className="block text-sm font-medium">
                  {labels.dialog.definitionPreviewTitle}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {labels.dialog.definitionPreviewDescription}
                </span>
              </span>
              {showPreview ? (
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 rtl:-scale-x-100" aria-hidden />
              )}
              <span className="sr-only">
                {showPreview ? labels.dialog.hidePreview : labels.dialog.showPreview}
              </span>
            </button>
            {showPreview ? (
              <pre
                dir="ltr"
                className="mt-3 max-h-72 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs"
              >
                {JSON.stringify(derivedDefinition, null, 2)}
              </pre>
            ) : null}
          </div>

          {/* Validation errors */}
          {validationMessages.length > 0 || nameError ? (
            <div
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <p className="font-medium">{labels.dialog.validationHeader}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {nameError ? <li key="name-error">{labels.validation.nameRequired}</li> : null}
                {validationMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.dialog.cancel}
            </Button>
            <Button type="submit" disabled={isSaving || !canSubmit}>
              {isSaving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {isEditing ? labels.dialog.save : labels.dialog.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
