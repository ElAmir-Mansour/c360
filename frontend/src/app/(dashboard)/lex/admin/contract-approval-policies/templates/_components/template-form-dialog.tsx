'use client';

/**
 * Create / edit dialog for a Contract Approval-Policy Template.
 *
 * The template `definition` is the policy-shape object (the same fields as a
 * contract approval-policy create payload: contract_type, department, value
 * range, routing, authority block, approvers, form_fields). The backend stores
 * it as a free-form JSON document, so this dialog edits the definition as
 * validated JSON. Create uses POST; edit uses PATCH (matches the backend route).
 */

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Textarea } from '@/components/ui/textarea';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  enterpriseApi,
  type LexApprovalPolicyTemplate,
  type LexCreateApprovalPolicyTemplatePayload,
} from '@/lib/enterprise/api';
import type { JsonObject } from '@/types/suites';
import type { ContractApprovalPolicyLabels } from '../../_labels';
import { TEMPLATES_QUERY_KEY } from './query-keys';

const DEFAULT_DEFINITION: JsonObject = {
  contract_type: null,
  department: null,
  min_value: null,
  max_value: null,
  currency: 'SAR',
  mode: 'parallel',
  quorum: 'all',
  quorum_n: null,
  approvers: [{ type: 'role', ref: 'legal-director', label: '' }],
  form_fields: [],
  require_authority_evidence: false,
  required_role: null,
  required_authority_amount: null,
};

export function TemplateFormDialog({
  labels,
  open,
  onOpenChange,
  template,
}: {
  labels: ContractApprovalPolicyLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: LexApprovalPolicyTemplate | null;
}) {
  const queryClient = useQueryClient();
  const t = labels.templates;
  const isEditing = template != null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [definitionText, setDefinitionText] = useState('');
  const [nameError, setNameError] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setName(template?.name ?? '');
    setDescription(template?.description ?? '');
    setCategory(template?.category ?? '');
    setDefinitionText(
      JSON.stringify(template?.definition ?? DEFAULT_DEFINITION, null, 2),
    );
    setNameError(false);
  }, [open, template]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY });

  const createMutation = useMutation({
    mutationFn: (payload: LexCreateApprovalPolicyTemplatePayload) =>
      enterpriseApi.lex.createApprovalPolicyTemplate(payload),
    onSuccess: async () => {
      showSuccess(t.formToast.created);
      await refresh();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: LexCreateApprovalPolicyTemplatePayload) => {
      if (!template) {
        throw new Error('missing template');
      }
      return enterpriseApi.lex.updateApprovalPolicyTemplate(template.id, payload);
    },
    onSuccess: async () => {
      showSuccess(t.formToast.updated);
      await refresh();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // parsedDefinition is the JSON object when the textarea holds a valid object,
  // otherwise null (a validation error surfaces below).
  const parsedDefinition = useMemo<JsonObject | null>(
    () => parseDefinition(definitionText),
    [definitionText],
  );
  const definitionInvalid = parsedDefinition === null;
  const canSubmit = name.trim() !== '' && !definitionInvalid;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === '') {
      setNameError(true);
      return;
    }
    if (parsedDefinition === null) {
      return;
    }
    const payload: LexCreateApprovalPolicyTemplatePayload = {
      name: name.trim(),
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      definition: parsedDefinition,
    };
    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? t.form.editTitle : t.form.createTitle}</DialogTitle>
          <DialogDescription>{t.form.description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          {!isEditing ? <LexCreationGuidance workflow="policy" /> : null}
          <div className="space-y-2">
            <Label htmlFor="template-name">{t.form.name}</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) {
                  setNameError(false);
                }
              }}
              placeholder={t.form.namePlaceholder}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-description">{t.form.descriptionField}</Label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder={t.form.descriptionPlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-category">{t.form.category}</Label>
            <Input
              id="template-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder={t.form.categoryPlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-definition">{t.form.definition}</Label>
            <Textarea
              id="template-definition"
              value={definitionText}
              onChange={(event) => setDefinitionText(event.target.value)}
              rows={14}
              dir="ltr"
              spellCheck={false}
              className="font-mono text-xs"
              aria-invalid={definitionInvalid}
            />
            <p className="text-xs text-muted-foreground">{t.form.definitionHint}</p>
          </div>

          {nameError || definitionInvalid ? (
            <div
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <p className="font-medium">{t.form.validationHeader}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {nameError ? <li>{t.formValidation.nameRequired}</li> : null}
                {definitionInvalid ? <li>{t.formValidation.definitionInvalid}</li> : null}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.form.cancel}
            </Button>
            <Button type="submit" disabled={isSaving || !canSubmit}>
              {isSaving ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {isEditing ? t.form.save : t.form.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Parse the definition textarea into a JSON object. Returns null when the text
 * is not valid JSON or does not describe a plain object (arrays/primitives are
 * rejected — a policy definition is always an object).
 */
function parseDefinition(text: string): JsonObject | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
    return null;
  } catch {
    return null;
  }
}
