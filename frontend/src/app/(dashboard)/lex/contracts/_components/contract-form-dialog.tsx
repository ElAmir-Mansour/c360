'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FormField } from '@/components/shared/forms/form-field';
import { useAuth } from '@/hooks/use-auth';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { useLocale } from '@/components/providers/locale-provider';
import {
  enterpriseApi,
  lexContractSchema,
  type LexContractFormValues,
  userDisplayName,
} from '@/lib/enterprise';
import { prefillExtractedTextFromFile, resolveUploadExtractedText } from '@/lib/documents/word';
import { lexRequestsApi, type LegalRequest } from '@/lib/lex/requests';
import { showApiError, showSuccess, showWarning } from '@/lib/toast';
import type { FileRecord } from '@/types/models';
import type { LexContractRecord, UserDirectoryEntry } from '@/types/suites';
import { useContractFormLabels, useContractTypeLabels } from '../_lib/contracts-labels';
import { deriveRenewalDate } from '../_lib/renewal-date';
import { reviewDeskApi } from '../[id]/_components/review-desk/review-desk-api';

interface ContractFormDialogProps {
  contract?: LexContractRecord | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (contract: LexContractRecord) => void;
  open: boolean;
}

const CONTRACT_TYPES = [
  'service_agreement',
  'nda',
  'employment',
  'vendor',
  'license',
  'lease',
  'partnership',
  'consulting',
  'procurement',
  'sla',
  'mou',
  'amendment',
  'renewal',
  'other',
] as const;

export function ContractFormDialog({
  contract,
  onOpenChange,
  onSaved,
  open,
}: ContractFormDialogProps) {
  const isEdit = Boolean(contract);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const labels = useContractFormLabels();
  const typeLabels = useContractTypeLabels();
  const { locale, direction } = useLocale();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentExtractedText, setDocumentExtractedText] = useState('');
  const [documentChangeSummary, setDocumentChangeSummary] = useState('');
  const [tagInputValue, setTagInputValue] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  // A contract that already carries a renewal date keeps it; otherwise the field
  // tracks `expiry - notice` until the user types one of their own.
  const [renewalDateOverridden, setRenewalDateOverridden] = useState(
    Boolean(contract?.renewal_date),
  );

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-contract-dialog'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open,
  });

  const approvedRequestsQuery = useQuery({
    queryKey: ['lex-approved-contract-requests'],
    queryFn: () =>
      lexRequestsApi.listRequests({
        page: 1,
        per_page: 100,
        order: 'desc',
        filters: { status: 'approved' },
      }),
    enabled: open && !isEdit,
  });

  const form = useForm<LexContractFormValues>({
    resolver: zodResolver(lexContractSchema),
    defaultValues: buildFormDefaults(contract),
  });

  const users = useMemo(() => usersQuery.data?.data ?? [], [usersQuery.data]);
  const approvedRequests = useMemo(
    () => (approvedRequestsQuery.data?.data ?? []).filter((request) => !request.subject_id),
    [approvedRequestsQuery.data],
  );
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );

  const applyOwner = useCallback(
    (userId: string) => {
      const user = usersById.get(userId);
      form.setValue('owner_user_id', userId, { shouldValidate: true });
      form.setValue('owner_name', user ? userDisplayName(user) : '', { shouldValidate: true });
    },
    [form, usersById],
  );

  const applyReviewer = useCallback(
    (userId: string | null) => {
      const user = userId ? usersById.get(userId) : undefined;
      form.setValue('legal_reviewer_id', userId, { shouldValidate: true });
      form.setValue('legal_reviewer_name', user ? userDisplayName(user) : '', { shouldValidate: true });
    },
    [form, usersById],
  );

  const applySourceRequest = useCallback(
    (requestId: string) => {
      if (requestId === 'manual') {
        form.setValue('legal_request_id', null, { shouldValidate: true });
        return;
      }
      const request = approvedRequests.find((item) => item.id === requestId);
      if (!request) return;

      form.setValue('legal_request_id', request.id, { shouldValidate: true });
      form.setValue('contract_number', null, { shouldValidate: true });
      form.setValue('title', localizedRequestTitle(request, locale), { shouldValidate: true });
      form.setValue('description', request.description, { shouldValidate: true });
      form.setValue('type', contractTypeFromRequest(request.request_type), { shouldValidate: true });
      form.setValue('department', request.department ?? null, { shouldValidate: true });
      form.setValue('metadata', {
        ...(form.getValues('metadata') ?? {}),
        legal_request_id: request.id,
        spawned_from_request: request.request_number,
      });
      if (usersById.has(request.requester_user_id)) {
        applyOwner(request.requester_user_id);
      }
    },
    [applyOwner, approvedRequests, form, locale, usersById],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    form.reset(buildFormDefaults(contract));
    setSelectedFile(null);
    setDocumentExtractedText('');
    setDocumentChangeSummary('');
    setTagInputValue(buildTagInputValue(contract?.tags));
    setUploadProgress(0);
    setRenewalDateOverridden(Boolean(contract?.renewal_date));
  }, [contract, form, open]);

  useEffect(() => {
    if (!open || isEdit || users.length === 0) {
      return;
    }

    const currentOwnerId = form.getValues('owner_user_id');
    if (currentOwnerId) {
      return;
    }

    const currentUserId = user?.id;
    if (!currentUserId || !usersById.has(currentUserId)) {
      return;
    }

    applyOwner(currentUserId);
  }, [applyOwner, form, isEdit, open, user?.id, users.length, usersById]);

  const saveMutation = useMutation({
    mutationFn: async (values: LexContractFormValues) => {
      let documentPayload: Record<string, unknown> | undefined;
      let reviewDocument: FileRecord | null = null;
      let attachmentSkipped = false;

      if (!isEdit && selectedFile) {
        const resolvedExtractedText = await resolveUploadExtractedText(selectedFile, documentExtractedText);
        if (resolvedExtractedText !== documentExtractedText.trim()) {
          setDocumentExtractedText(resolvedExtractedText);
        }
        const uploaded = await uploadContractDocument({
          changeSummary: documentChangeSummary,
          file: selectedFile,
          onProgress: setUploadProgress,
          type: values.type,
          tags: values.tags,
        });
        reviewDocument = uploaded;
        documentPayload = toFileReference(uploaded, resolvedExtractedText, documentChangeSummary);
      }

      if (isEdit && contract) {
        const payload = buildUpdateContractPayload(values, contract);
        const updated = await enterpriseApi.lex.updateContract(contract.id, payload);
        return { attachmentSkipped, saved: updated };
      }
      const payload = buildCreateContractPayload(values, documentPayload);
      const saved = await enterpriseApi.lex.createContract(payload);
      if (reviewDocument) {
        // Registering the file in the review desk's `draft` slot is a SECONDARY
        // copy — the create call above already stored the document as contract
        // version 1. It must never fail the creation: POST /contracts is not
        // idempotent (contract_number is unique per tenant, and an approved
        // source request is consumed on first use), so rejecting here left a
        // real contract behind while showing an error, and every retry then hit
        // a permanent 409. The desk route also sits on the coarse `lex:write`
        // tier while creation only needs `lex:contract:add`, so roles such as
        // legal-requester / legal-dept-manager are legitimately 403 here.
        try {
          await reviewDeskApi.uploadAttachment(saved.id, {
            slot: 'draft',
            file_id: reviewDocument.id,
            file_name: reviewDocument.original_name,
            file_size_bytes: reviewDocument.size_bytes,
            content_hash: reviewDocument.checksum_sha256,
            notes: documentChangeSummary.trim() || undefined,
          });
        } catch {
          attachmentSkipped = true;
        }
      }
      return { attachmentSkipped, saved };
    },
    onSuccess: async ({ attachmentSkipped, saved: savedContract }) => {
      if (attachmentSkipped) {
        showWarning(
          labels.toast.attachmentSkippedTitle,
          labels.toast.attachmentSkippedDescription,
        );
      } else {
        showSuccess(
          isEdit ? labels.toast.updatedTitle : labels.toast.createdTitle,
          isEdit ? labels.toast.updatedDescription : labels.toast.createdDescription,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-contracts'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        contract
          ? queryClient.invalidateQueries({ queryKey: ['lex-contract', contract.id] })
          : Promise.resolve(),
      ]);
      onOpenChange(false);
      onSaved?.(savedContract);
    },
    onError: showApiError,
  });

  const ownerValue = form.watch('owner_user_id');
  const reviewerValue = form.watch('legal_reviewer_id');
  const sourceRequestValue = form.watch('legal_request_id');
  const effectiveDateValue = form.watch('effective_date');
  const expiryDateValue = form.watch('expiry_date');
  const renewalNoticeValue = form.watch('renewal_notice_days');
  const durationText = useMemo(
    () => computeContractDuration(effectiveDateValue, expiryDateValue),
    [effectiveDateValue, expiryDateValue],
  );

  // The renewal date follows from the expiry date and the notice period, so it
  // is filled in automatically rather than left to the user to work out. Typing
  // a date takes manual control; clearing the field hands it back.
  const derivedRenewalDate = useMemo(
    () => toDateTimeInputValue(deriveRenewalDate(expiryDateValue, renewalNoticeValue)),
    [expiryDateValue, renewalNoticeValue],
  );

  useEffect(() => {
    if (!open || renewalDateOverridden) {
      return;
    }
    if (form.getValues('renewal_date') !== derivedRenewalDate) {
      form.setValue('renewal_date', derivedRenewalDate, { shouldValidate: true });
    }
  }, [derivedRenewalDate, form, open, renewalDateOverridden]);

  // 'requesting department' is a required field (PRD). The shared zod schema keeps
  // it optional, so guard it here before the mutation runs and surface the error
  // through react-hook-form on the department field.
  const submit = form.handleSubmit((values) => {
    if (!values.contract_number?.trim() && !values.legal_request_id) {
      form.setError('contract_number', {
        type: 'required',
        message: labels.fields.sourceRequired,
      });
      return;
    }
    if (!values.department || !values.department.trim()) {
      form.setError('department', {
        type: 'required',
        message: labels.fields.requestingDepartmentRequired,
      });
      return;
    }
    saveMutation.mutate(values);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={direction} lang={locale} className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? labels.editTitle : labels.createTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? labels.editDescription : labels.createDescription}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={submit}>
            {!isEdit ? <LexCreationGuidance workflow="contract" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="title" label={labels.fields.title} required>
                <Input id="title" {...form.register('title')} placeholder={labels.fields.titlePlaceholder} />
              </FormField>

              <FormField name="contract_number" label={labels.fields.contractNumber}>
                <Input
                  id="contract_number"
                  {...form.register('contract_number')}
                  placeholder={labels.fields.contractNumberPlaceholder}
                  disabled={Boolean(sourceRequestValue)}
                />
              </FormField>
            </div>

            {!isEdit ? (
              <FormField name="legal_request_id" label={labels.fields.sourceRequest}>
                <Select
                  value={sourceRequestValue ?? 'manual'}
                  onValueChange={applySourceRequest}
                >
                  <SelectTrigger id="legal_request_id">
                    <SelectValue placeholder={labels.fields.sourceRequestPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">{labels.fields.sourceRequestManual}</SelectItem>
                    {approvedRequests.map((request) => (
                      <SelectItem key={request.id} value={request.id}>
                        {request.request_number} — {localizedRequestTitle(request, locale)}
                      </SelectItem>
                    ))}
                    {!approvedRequestsQuery.isLoading && approvedRequests.length === 0 ? (
                      <SelectItem value="no-approved-requests" disabled>
                        {labels.fields.sourceRequestEmpty}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{labels.fields.sourceRequestHelp}</p>
              </FormField>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="type" label={labels.fields.type} required>
                <Select
                  value={form.watch('type')}
                  onValueChange={(value) =>
                    form.setValue('type', value as LexContractFormValues['type'], { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {typeLabels[type] ?? type.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="currency" label={labels.fields.currency} required>
                <Input
                  id="currency"
                  {...form.register('currency')}
                  maxLength={3}
                  placeholder={labels.fields.currencyPlaceholder}
                  onChange={(event) =>
                    form.setValue('currency', event.target.value.toUpperCase(), { shouldValidate: true })
                  }
                />
              </FormField>
            </div>

            <FormField name="description" label={labels.fields.description} required>
              <Textarea
                id="description"
                {...form.register('description')}
                placeholder={labels.fields.descriptionPlaceholder}
                rows={3}
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="party_a_name" label={labels.fields.partyA} required>
                <Input
                  id="party_a_name"
                  {...form.register('party_a_name')}
                  placeholder={labels.fields.partyAPlaceholder}
                />
              </FormField>

              <FormField name="party_b_name" label={labels.fields.counterparty} required>
                <Input
                  id="party_b_name"
                  {...form.register('party_b_name')}
                  placeholder={labels.fields.counterpartyPlaceholder}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField name="party_a_entity" label={labels.fields.partyAEntity}>
                <Input
                  id="party_a_entity"
                  {...form.register('party_a_entity')}
                  placeholder={labels.fields.entityPlaceholder}
                />
              </FormField>

              <FormField name="party_b_entity" label={labels.fields.counterpartyEntity}>
                <Input
                  id="party_b_entity"
                  {...form.register('party_b_entity')}
                  placeholder={labels.fields.entityPlaceholder}
                />
              </FormField>

              <FormField name="party_b_contact" label={labels.fields.counterpartyContact}>
                <Input
                  id="party_b_contact"
                  {...form.register('party_b_contact')}
                  placeholder={labels.fields.counterpartyContactPlaceholder}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="owner_user_id" label={labels.fields.owner} required>
                <Select value={ownerValue} onValueChange={applyOwner}>
                  <SelectTrigger id="owner_user_id">
                    <SelectValue placeholder={labels.fields.ownerPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {userDisplayName(user)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField name="legal_reviewer_id" label={labels.fields.legalReviewer}>
                <Select
                  value={reviewerValue ?? 'none'}
                  onValueChange={(value) => applyReviewer(value === 'none' ? null : value)}
                >
                  <SelectTrigger id="legal_reviewer_id">
                    <SelectValue placeholder={labels.fields.reviewerPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{labels.fields.unassigned}</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {userDisplayName(user)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField name="total_value" label={labels.fields.totalValue}>
                <Input
                  id="total_value"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  {...form.register('total_value', {
                    setValueAs: (value) => (value === '' ? null : Number(value)),
                  })}
                  placeholder={labels.fields.totalValuePlaceholder}
                />
              </FormField>

              <FormField name="effective_date" label={labels.fields.effectiveDate}>
                <Input id="effective_date" type="datetime-local" {...form.register('effective_date')} />
              </FormField>

              <FormField name="expiry_date" label={labels.fields.expiryDate}>
                <Input id="expiry_date" type="datetime-local" {...form.register('expiry_date')} />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField name="renewal_date" label={labels.fields.renewalDate}>
                <Input
                  id="renewal_date"
                  type="datetime-local"
                  {...form.register('renewal_date', {
                    // Clearing the field drops the override so the derived value
                    // takes over again.
                    onChange: (event) =>
                      setRenewalDateOverridden(Boolean(event.target.value)),
                  })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {labels.fields.renewalDateHelp}
                </p>
              </FormField>

              <FormField name="renewal_notice_days" label={labels.fields.renewalNoticeDays} required>
                <Input
                  id="renewal_notice_days"
                  type="number"
                  min={0}
                  max={365}
                  {...form.register('renewal_notice_days', {
                    setValueAs: (value) => Number(value),
                  })}
                />
              </FormField>

              <FormField name="department" label={labels.fields.requestingDepartment} required>
                <Input
                  id="department"
                  {...form.register('department')}
                  placeholder={labels.fields.requestingDepartmentPlaceholder}
                />
              </FormField>
            </div>

            {/* Contract duration derived from the effective / expiry dates. */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="contract_duration" label={labels.fields.contractDuration}>
                <Input
                  id="contract_duration"
                  readOnly
                  value={
                    durationText
                      ? labels.fields.durationValue(durationText.months, durationText.days)
                      : ''
                  }
                  placeholder={labels.fields.durationNotAvailable}
                />
                <p className="mt-1 text-xs text-muted-foreground">{labels.fields.durationHelp}</p>
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="payment_terms" label={labels.fields.paymentTerms}>
                <Input
                  id="payment_terms"
                  {...form.register('payment_terms')}
                  placeholder={labels.fields.paymentTermsPlaceholder}
                />
              </FormField>

              <FormField name="tags" label={labels.fields.tags}>
                <Input
                  id="tags"
                  value={tagInputValue}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setTagInputValue(nextValue);
                    form.setValue('tags', parseTagInput(nextValue), { shouldValidate: true });
                  }}
                  placeholder={labels.fields.tagsPlaceholder}
                />
              </FormField>
            </div>

            <div className="rounded-lg border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{labels.autoRenew.title}</p>
                  <p className="text-xs text-muted-foreground">{labels.autoRenew.description}</p>
                </div>
                <Switch
                  checked={form.watch('auto_renew')}
                  onCheckedChange={(checked) =>
                    form.setValue('auto_renew', checked, { shouldValidate: true })
                  }
                />
              </div>
            </div>

            {!isEdit ? (
              <div className="space-y-4 rounded-lg border px-4 py-4">
                <div>
                  <p className="text-sm font-medium">{labels.initialDocument.title}</p>
                  <p className="text-xs text-muted-foreground">{labels.initialDocument.description}</p>
                </div>

                <FormField name="initial_document" label={labels.initialDocument.fileLabel}>
                  <Input
                    id="initial_document"
                    type="file"
                    accept=".pdf,.docx,.txt"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      setSelectedFile(file);
                      void prefillExtractedTextFromFile(file, setDocumentExtractedText);
                    }}
                  />
                </FormField>

                {selectedFile ? (
                  <p className="text-xs text-muted-foreground">
                    {labels.initialDocument.selectedPrefix(selectedFile.name)}
                  </p>
                ) : null}

                <FormField name="document_extracted_text" label={labels.initialDocument.textLabel}>
                  <Textarea
                    id="document_extracted_text"
                    value={documentExtractedText}
                    onChange={(event) => setDocumentExtractedText(event.target.value)}
                    placeholder={labels.initialDocument.textPlaceholder}
                    rows={5}
                  />
                </FormField>

                <FormField name="document_change_summary" label={labels.initialDocument.changeSummaryLabel}>
                  <Input
                    id="document_change_summary"
                    value={documentChangeSummary}
                    onChange={(event) => setDocumentChangeSummary(event.target.value)}
                    placeholder={labels.initialDocument.changeSummaryPlaceholder}
                  />
                </FormField>

                {saveMutation.isPending && selectedFile ? (
                  <p className="text-xs text-muted-foreground">
                    {labels.initialDocument.uploadProgress(Math.round(uploadProgress))}
                  </p>
                ) : null}
              </div>
            ) : null}

            {usersQuery.isError ? (
              <p className="text-sm text-destructive">{labels.usersError}</p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.cancel}
              </Button>
              <Button
                type="submit"
                disabled={saveMutation.isPending || usersQuery.isLoading || usersQuery.isError}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : null}
                {isEdit ? labels.save : labels.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function buildFormDefaults(contract?: LexContractRecord | null): LexContractFormValues {
  return {
    title: contract?.title ?? '',
    contract_number: contract?.contract_number ?? null,
    legal_request_id:
      typeof contract?.metadata?.legal_request_id === 'string'
        ? contract.metadata.legal_request_id
        : null,
    type: contract?.type ?? 'service_agreement',
    description: contract?.description ?? '',
    party_a_name: contract?.party_a_name ?? '',
    party_a_entity: contract?.party_a_entity ?? null,
    party_b_name: contract?.party_b_name ?? '',
    party_b_entity: contract?.party_b_entity ?? null,
    party_b_contact: contract?.party_b_contact ?? null,
    total_value: contract?.total_value ?? null,
    currency: contract?.currency ?? 'SAR',
    payment_terms: contract?.payment_terms ?? null,
    effective_date: toDateTimeInputValue(contract?.effective_date),
    expiry_date: toDateTimeInputValue(contract?.expiry_date),
    renewal_date: toDateTimeInputValue(contract?.renewal_date),
    auto_renew: contract?.auto_renew ?? false,
    renewal_notice_days: contract?.renewal_notice_days ?? 30,
    owner_user_id: contract?.owner_user_id ?? '',
    owner_name: contract?.owner_name ?? '',
    legal_reviewer_id: contract?.legal_reviewer_id ?? null,
    legal_reviewer_name: contract?.legal_reviewer_name ?? null,
    department: contract?.department ?? null,
    tags: contract?.tags ?? [],
    metadata: contract?.metadata ?? {},
    document: null,
  };
}

/**
 * Build contract payload for CREATE requests.
 * Null optional fields are omitted so the backend treats them as "not provided".
 */
function buildCreateContractPayload(
  values: LexContractFormValues,
  documentPayload?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    title: values.title.trim(),
    contract_number: emptyToNull(values.contract_number),
    legal_request_id: values.legal_request_id ?? null,
    type: values.type,
    description: values.description.trim(),
    party_a_name: values.party_a_name.trim(),
    party_a_entity: emptyToNull(values.party_a_entity),
    party_b_name: values.party_b_name.trim(),
    party_b_entity: emptyToNull(values.party_b_entity),
    party_b_contact: emptyToNull(values.party_b_contact),
    total_value: values.total_value ?? null,
    currency: values.currency.trim().toUpperCase(),
    payment_terms: emptyToNull(values.payment_terms),
    effective_date: toOptionalDateTime(values.effective_date),
    expiry_date: toOptionalDateTime(values.expiry_date),
    renewal_date: toOptionalDateTime(values.renewal_date),
    auto_renew: values.auto_renew,
    renewal_notice_days: values.renewal_notice_days,
    owner_user_id: values.owner_user_id,
    owner_name: values.owner_name.trim(),
    legal_reviewer_id: values.legal_reviewer_id ?? null,
    legal_reviewer_name: emptyToNull(values.legal_reviewer_name),
    department: emptyToNull(values.department),
    tags: values.tags,
    metadata: values.metadata ?? {},
    ...(documentPayload ? { document: documentPayload } : {}),
  };
}

/**
 * Build contract payload for UPDATE requests.
 *
 * For optional string fields, sends "" (empty string) instead of null when the
 * user clears a field. The backend's normalizeOptionalString converts "" to nil,
 * which correctly clears the DB column. Sending null would be indistinguishable
 * from "field not provided" (both decode to *string nil in Go), causing the
 * backend to silently skip the update.
 *
 * For the legal_reviewer_id UUID, sends the nil UUID sentinel when the user
 * selects "Unassigned", so the backend can distinguish "clear reviewer" from
 * "don't change reviewer".
 */
function buildUpdateContractPayload(
  values: LexContractFormValues,
  original: LexContractRecord,
): Record<string, unknown> {
  const NIL_UUID = '00000000-0000-0000-0000-000000000000';

  // Detect fields that were previously set but are now cleared by the user.
  // Go's *time.Time / *float64 unmarshaling can't distinguish JSON null from
  // an absent key (both → nil), so we send an explicit cleared_fields array
  // for these types.
  const clearedFields: string[] = [];
  if (original.effective_date && !values.effective_date) clearedFields.push('effective_date');
  if (original.expiry_date && !values.expiry_date) clearedFields.push('expiry_date');
  if (original.renewal_date && !values.renewal_date) clearedFields.push('renewal_date');
  if (original.total_value != null && values.total_value == null) clearedFields.push('total_value');

  return {
    title: values.title.trim(),
    contract_number: values.contract_number?.trim() ?? '',
    type: values.type,
    description: values.description.trim(),
    party_a_name: values.party_a_name.trim(),
    party_a_entity: values.party_a_entity?.trim() ?? '',
    party_b_name: values.party_b_name.trim(),
    party_b_entity: values.party_b_entity?.trim() ?? '',
    party_b_contact: values.party_b_contact?.trim() ?? '',
    total_value: values.total_value ?? null,
    currency: values.currency.trim().toUpperCase(),
    payment_terms: values.payment_terms?.trim() ?? '',
    effective_date: toOptionalDateTime(values.effective_date),
    expiry_date: toOptionalDateTime(values.expiry_date),
    renewal_date: toOptionalDateTime(values.renewal_date),
    auto_renew: values.auto_renew,
    renewal_notice_days: values.renewal_notice_days,
    owner_user_id: values.owner_user_id,
    owner_name: values.owner_name.trim(),
    legal_reviewer_id: values.legal_reviewer_id || NIL_UUID,
    legal_reviewer_name: values.legal_reviewer_name?.trim() ?? '',
    department: values.department?.trim() ?? '',
    tags: values.tags,
    metadata: values.metadata ?? {},
    ...(clearedFields.length > 0 ? { cleared_fields: clearedFields } : {}),
  };
}

async function uploadContractDocument({
  changeSummary,
  file,
  onProgress,
  tags,
  type,
}: {
  changeSummary: string;
  file: File;
  onProgress: (progress: number) => void;
  tags: string[];
  type: LexContractFormValues['type'];
}): Promise<FileRecord> {
  return enterpriseApi.files.upload(
    file,
    {
      suite: 'lex',
      entity_type: 'contract',
      tags: Array.from(new Set(['contract', type, ...tags])).join(','),
      lifecycle_policy: 'standard',
    },
    onProgress,
  );
}

function toFileReference(
  upload: FileRecord,
  extractedText: string,
  changeSummary: string,
): Record<string, unknown> {
  return {
    file_id: upload.id,
    file_name: upload.original_name,
    file_size_bytes: upload.size_bytes,
    content_hash: upload.checksum_sha256,
    extracted_text: extractedText.trim(),
    change_summary: changeSummary.trim(),
  };
}

function parseTagInput(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function buildTagInputValue(tags?: string[] | null): string {
  return tags?.join(', ') ?? '';
}

function toDateTimeInputValue(value?: Date | string | null): string {
  if (!value) {
    return '';
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toOptionalDateTime(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString();
}

function emptyToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Derive the contract duration (whole months + remaining days) between the
 * effective and expiry dates. Returns null when either date is missing or the
 * range is non-positive. Values come from `<input type="datetime-local">`.
 */
function computeContractDuration(
  effective?: string | null,
  expiry?: string | null,
): { months: number; days: number } | null {
  if (!effective || !expiry) {
    return null;
  }
  const start = new Date(effective);
  const end = new Date(expiry);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  let anchor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()),
  );
  if (anchor > end) {
    months -= 1;
    anchor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()),
    );
  }
  const days = Math.round((end.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24));
  return { months: Math.max(0, months), days: Math.max(0, days) };
}

function localizedRequestTitle(request: LegalRequest, locale: string): string {
  return (locale === 'ar' ? request.title.ar : request.title.en).trim()
    || request.title.en.trim()
    || request.title.ar.trim()
    || request.request_number;
}

function contractTypeFromRequest(requestType: string): LexContractFormValues['type'] {
  const value = requestType.toLowerCase();
  if (value.includes('nda') || value.includes('confidential')) return 'nda';
  if (value.includes('employment')) return 'employment';
  if (value.includes('license') || value.includes('licence')) return 'license';
  if (value.includes('lease')) return 'lease';
  if (value.includes('consult')) return 'consulting';
  if (value.includes('procurement') || value.includes('purchase')) return 'procurement';
  if (value.includes('service_level') || value.includes('service level') || value.includes('sla')) return 'sla';
  if (value.includes('mou') || value.includes('memorandum')) return 'mou';
  if (value.includes('amendment') || value.includes('addendum')) return 'amendment';
  if (value.includes('renewal')) return 'renewal';
  if (value.includes('vendor') || value.includes('supplier')) return 'vendor';
  return 'service_agreement';
}
