'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useFieldArray, useForm } from 'react-hook-form';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ScrollText,
  Trash2,
  X,
} from 'lucide-react';
import { z } from 'zod';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { FormField } from '@/components/shared/forms/form-field';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { enterpriseApi } from '@/lib/enterprise';
import type { AppLocale } from '@/lib/i18n';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn, formatDateTime } from '@/lib/utils';
import type {
  LexCreateSignatureEnvelopePayload,
  LexContractRecord,
  LexDocument,
  LexSignatureEnvelope,
  LexSignatureRecipientInput,
} from '@/types/suites';
import type { FetchParams } from '@/types/table';
import { lexContractStatusLabels, resolveLexBilingual } from '../../_lib/lex-i18n';
import { ContractFormDialog } from '../../contracts/_components/contract-form-dialog';
import { contractTypeLabels } from '../../contracts/_lib/contracts-labels';
import { resolveDocumentsLabels } from '../../documents/_lib/documents-labels';
import { type SignatureLabels, useSignatureLabels } from './labels';

const SIGNATURE_PROVIDERS = ['native', 'nafath', 'external'] as const;
const SIGNATURE_METHODS = ['otp', 'nafath', 'certificate', 'wet_signature'] as const;
const SIGNATURE_LANGUAGES = ['en', 'ar', 'bilingual'] as const;
const TARGET_TYPES = ['contract', 'document'] as const;

/**
 * Builds the envelope zod schema with locale-aware validation messages. Created
 * inside the component (memoized on the resolved `validation` labels) so error
 * copy follows the active locale.
 */
function buildEnvelopeSchema(validation: SignatureLabels['validation']) {
  const recipientSchema = z.object({
    user_id: z.string().trim(),
    name: z.string().trim().min(1, validation.recipientNameRequired),
    email: z.string().trim().email(validation.emailInvalid).or(z.literal('')),
    phone: z.string().trim(),
    role: z.string().trim(),
    method: z.enum(SIGNATURE_METHODS),
    language: z.enum(SIGNATURE_LANGUAGES),
  });

  return z
    .object({
      target_type: z.enum(TARGET_TYPES),
      contract_id: z.string().trim(),
      document_id: z.string().trim(),
      title: z.string().trim().min(1, validation.titleRequired),
      subject: z.string().trim(),
      message: z.string().trim(),
      language: z.enum(SIGNATURE_LANGUAGES),
      provider: z.enum(SIGNATURE_PROVIDERS),
      method: z.enum(SIGNATURE_METHODS),
      due_at: z.string().trim(),
      expires_at: z.string().trim(),
      recipients: z.array(recipientSchema).min(1, validation.recipientsMin),
    })
    .superRefine((values, ctx) => {
      if (values.target_type === 'contract' && values.contract_id === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: validation.contractIdRequired,
          path: ['contract_id'],
        });
      }
      if (values.target_type === 'document' && values.document_id === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: validation.documentIdRequired,
          path: ['document_id'],
        });
      }
    });
}

type EnvelopeFormValues = z.infer<ReturnType<typeof buildEnvelopeSchema>>;
type RecipientFormValue = EnvelopeFormValues['recipients'][number];
type TargetType = EnvelopeFormValues['target_type'];

interface TargetOption {
  kind: TargetType;
  id: string;
  label: string;
  summary: string;
  description?: string;
}

interface SavedRecipientGroup {
  id: string;
  name: string;
  recipients: RecipientFormValue[];
}

interface RecipientTemplate {
  id: string;
  name: string;
  recipients: RecipientFormValue[];
}

interface PreflightItem {
  key: string;
  label: string;
  ready: boolean;
}

const FORM_DEFAULTS: EnvelopeFormValues = {
  target_type: 'contract',
  contract_id: '',
  document_id: '',
  title: '',
  subject: '',
  message: '',
  language: 'bilingual',
  provider: 'native',
  method: 'otp',
  due_at: '',
  expires_at: '',
  recipients: [
    {
      user_id: '',
      name: '',
      email: '',
      phone: '',
      role: '',
      method: 'otp',
      language: 'bilingual',
    },
  ],
};

const TARGET_PICKER_PARAMS: FetchParams = {
  page: 1,
  per_page: 12,
  order: 'desc',
};

const ROLE_PRESET_KEYS = [
  'authorisedSignatory',
  'counterpartyReviewer',
  'financeApprover',
  'legalCounsel',
  'witness',
] as const;

interface SignatureEnvelopeDialogProps {
  open: boolean;
  contractId?: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated?: (envelope: LexSignatureEnvelope) => void;
}

export function SignatureEnvelopeDialog({
  open,
  contractId,
  onOpenChange,
  onCreated,
}: SignatureEnvelopeDialogProps) {
  const allLabels = useSignatureLabels();
  const labels = allLabels.create;
  const { locale } = useLocaleOrDefault();
  const queryClient = useQueryClient();

  const envelopeSchema = useMemo(
    () => buildEnvelopeSchema(allLabels.validation),
    [allLabels.validation],
  );

  const form = useForm<EnvelopeFormValues>({
    resolver: zodResolver(envelopeSchema),
    defaultValues: FORM_DEFAULTS,
  });

  const recipients = useFieldArray({ control: form.control, name: 'recipients' });
  const [targetQuery, setTargetQuery] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<TargetOption | null>(null);
  const [contractCreateOpen, setContractCreateOpen] = useState(false);
  const [bulkRecipientsText, setBulkRecipientsText] = useState('');
  const [bulkImportFeedback, setBulkImportFeedback] = useState<string | null>(null);
  const [recipientGroupName, setRecipientGroupName] = useState('');
  const [savedRecipientGroups, setSavedRecipientGroups] = useState<SavedRecipientGroup[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedTarget(null);
    setContractCreateOpen(false);
    setTargetQuery('');
    setBulkRecipientsText('');
    setBulkImportFeedback(null);
    setRecipientGroupName('');
    form.reset({
      ...FORM_DEFAULTS,
      contract_id: contractId ?? '',
    });
  }, [contractId, form, open]);

  const createMutation = useMutation({
    mutationFn: (payload: LexCreateSignatureEnvelopePayload) => enterpriseApi.lex.createSignature(payload),
    onSuccess: async (envelope) => {
      showSuccess(allLabels.toast.created.title, allLabels.toast.created.detail);
      await queryClient.invalidateQueries({ queryKey: ['lex-signatures'] });
      onOpenChange(false);
      onCreated?.(envelope);
    },
    onError: showApiError,
  });

  const targetType = form.watch('target_type');
  const envelopeMethod = form.watch('method');
  const envelopeLanguage = form.watch('language');
  const envelopeProvider = form.watch('provider');
  const dueAt = form.watch('due_at');
  const expiresAt = form.watch('expires_at');
  const watchedRecipients = form.watch('recipients');
  const targetFieldName: 'contract_id' | 'document_id' =
    targetType === 'contract' ? 'contract_id' : 'document_id';
  const targetId = form.watch(targetFieldName);
  const trimmedTargetQuery = targetQuery.trim();

  const targetParams = useMemo<FetchParams>(
    () => ({
      ...TARGET_PICKER_PARAMS,
      search: trimmedTargetQuery || undefined,
    }),
    [trimmedTargetQuery],
  );

  const contractTargetsQuery = useQuery({
    queryKey: ['lex-signature-target-picker', 'contracts', targetParams],
    queryFn: () => enterpriseApi.lex.listContracts(targetParams),
    enabled: open && targetType === 'contract',
  });

  const documentTargetsQuery = useQuery({
    queryKey: ['lex-signature-target-picker', 'documents', targetParams],
    queryFn: () => enterpriseApi.lex.listDocuments(targetParams),
    enabled: open && targetType === 'document',
  });

  const selectedContractTargetQuery = useQuery({
    queryKey: ['lex-signature-target-picker', 'selected-contract', targetId],
    queryFn: () => enterpriseApi.lex.getContract(targetId.trim()),
    enabled:
      open &&
      targetType === 'contract' &&
      Boolean(targetId.trim()) &&
      selectedTarget?.id !== targetId.trim(),
    retry: false,
  });

  const selectedDocumentTargetQuery = useQuery({
    queryKey: ['lex-signature-target-picker', 'selected-document', targetId],
    queryFn: () => enterpriseApi.lex.getDocument(targetId.trim()),
    enabled:
      open &&
      targetType === 'document' &&
      Boolean(targetId.trim()) &&
      selectedTarget?.id !== targetId.trim(),
    retry: false,
  });

  const activeTargetQuery = targetType === 'contract' ? contractTargetsQuery : documentTargetsQuery;
  const targetOptions = useMemo(
    () =>
      targetType === 'contract'
        ? (contractTargetsQuery.data?.data ?? []).map((contract) =>
            contractToTargetOption(contract, labels, locale),
          )
        : (documentTargetsQuery.data?.data ?? []).map((document) =>
            documentToTargetOption(document, labels, locale),
          ),
    [contractTargetsQuery.data?.data, documentTargetsQuery.data?.data, labels, locale, targetType],
  );

  const recipientTemplates = useMemo(
    () => buildRecipientTemplates(labels, envelopeMethod, envelopeLanguage),
    [envelopeLanguage, envelopeMethod, labels],
  );

  const preflightItems = useMemo(
    () =>
      buildPreflightItems({
        labels,
        targetId,
        selectedTarget,
        recipients: watchedRecipients,
        language: envelopeLanguage,
        provider: envelopeProvider,
        method: envelopeMethod,
        dueAt,
        expiresAt,
      }),
    [
      dueAt,
      envelopeLanguage,
      envelopeMethod,
      envelopeProvider,
      expiresAt,
      labels,
      selectedTarget,
      targetId,
      watchedRecipients,
    ],
  );

  useEffect(() => {
    if (selectedTarget && (selectedTarget.kind !== targetType || selectedTarget.id !== targetId.trim())) {
      setSelectedTarget(null);
    }
  }, [selectedTarget, targetId, targetType]);

  useEffect(() => {
    if (selectedTarget?.id === targetId.trim()) return;
    if (targetType === 'contract' && selectedContractTargetQuery.data) {
      setSelectedTarget(contractToTargetOption(selectedContractTargetQuery.data.contract, labels, locale));
    } else if (targetType === 'document' && selectedDocumentTargetQuery.data) {
      setSelectedTarget(documentToTargetOption(selectedDocumentTargetQuery.data, labels, locale));
    }
  }, [
    labels,
    locale,
    selectedContractTargetQuery.data,
    selectedDocumentTargetQuery.data,
    selectedTarget?.id,
    targetId,
    targetType,
  ]);

  const selectTargetOption = (option: TargetOption) => {
    setSelectedTarget(option);
    form.setValue(option.kind === 'contract' ? 'contract_id' : 'document_id', option.id, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const handleContractCreated = (contract: LexContractRecord) => {
    const option = contractToTargetOption(contract, labels, locale);
    form.setValue('target_type', 'contract', { shouldValidate: true });
    form.setValue('document_id', '', { shouldDirty: true, shouldValidate: false });
    setTargetQuery(contract.title);
    selectTargetOption(option);
    void queryClient.invalidateQueries({ queryKey: ['lex-signature-target-picker', 'contracts'] });
  };

  const clearSelectedTarget = () => {
    setSelectedTarget(null);
    form.setValue(targetFieldName, '', { shouldDirty: true, shouldValidate: true });
  };

  const handleTargetTypeChange = (value: EnvelopeFormValues['target_type']) => {
    form.setValue('target_type', value, { shouldValidate: true });
    setSelectedTarget(null);
    setTargetQuery('');
  };

  const applyRolePreset = (index: number, role: string) => {
    form.setValue(`recipients.${index}.role` as const, role, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const replaceRecipients = (nextRecipients: RecipientFormValue[]) => {
    recipients.replace(nextRecipients.length > 0 ? nextRecipients : [blankRecipient(envelopeMethod, envelopeLanguage)]);
  };

  const applyRecipientTemplate = (template: RecipientTemplate) => {
    replaceRecipients(template.recipients.map(cloneRecipient));
  };

  const importRecipientRows = (mode: 'append' | 'replace') => {
    const parsedRecipients = parseRecipientImport(
      bulkRecipientsText,
      envelopeMethod,
      envelopeLanguage,
    );
    if (parsedRecipients.length === 0) {
      setBulkImportFeedback(labels.recipientTools.bulkImported(0));
      return;
    }
    if (mode === 'replace') {
      replaceRecipients(parsedRecipients);
    } else {
      recipients.append(parsedRecipients);
    }
    setBulkImportFeedback(labels.recipientTools.bulkImported(parsedRecipients.length));
    setBulkRecipientsText('');
  };

  const saveCurrentRecipientGroup = () => {
    const snapshot = form
      .getValues('recipients')
      .map(cloneRecipient)
      .filter(hasRecipientContent);
    if (snapshot.length === 0) {
      return;
    }
    const name =
      recipientGroupName.trim() || `${labels.recipientTools.savedGroups} ${savedRecipientGroups.length + 1}`;
    setSavedRecipientGroups((groups) => [
      ...groups,
      {
        id: `${Date.now()}-${groups.length}`,
        name,
        recipients: snapshot,
      },
    ]);
    setRecipientGroupName('');
  };

  const applySavedRecipientGroup = (group: SavedRecipientGroup) => {
    replaceRecipients(group.recipients.map(cloneRecipient));
  };

  const removeSavedRecipientGroup = (groupId: string) => {
    setSavedRecipientGroups((groups) => groups.filter((group) => group.id !== groupId));
  };

  const submit = form.handleSubmit((values) => {
    createMutation.mutate(buildEnvelopePayload(values));
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form className="space-y-6" onSubmit={submit}>
            <LexCreationGuidance workflow="signature" />
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">{labels.sections.target}</h3>
              <div className="space-y-4">
                <FormField name="target_type" label={labels.fields.targetType} required>
                  <Tabs
                    value={targetType}
                    onValueChange={(value) => handleTargetTypeChange(value as EnvelopeFormValues['target_type'])}
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      {TARGET_TYPES.map((option) => {
                        const Icon = option === 'contract' ? ScrollText : FileText;
                        return (
                          <TabsTrigger key={option} value={option} className="gap-2 rounded-md">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                            {allLabels.enums.targetType[option] ?? titleCase(option)}
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </Tabs>
                </FormField>
                <FormField
                  name={targetFieldName}
                  label={targetType === 'contract' ? labels.fields.contractId : labels.fields.documentId}
                  description={targetType === 'contract' ? labels.targetHint.contract : labels.targetHint.document}
                  required
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-foreground">{labels.targetPicker.label}</p>
                        <p className="text-xs text-muted-foreground">{labels.targetPicker.recentHint}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {targetId.trim() ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={clearSelectedTarget}
                          >
                            <X className="me-1 h-3.5 w-3.5" aria-hidden="true" />
                            {labels.targetPicker.clear}
                          </Button>
                        ) : null}
                        {targetType === 'contract' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => setContractCreateOpen(true)}
                          >
                            <Plus className="me-1 h-3.5 w-3.5" aria-hidden="true" />
                            {labels.targetPicker.createContract}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        value={targetQuery}
                        onChange={(event) => setTargetQuery(event.target.value)}
                        className="ps-9"
                        placeholder={labels.targetPicker.searchPlaceholder}
                      />
                    </div>

                    <div className="overflow-hidden rounded-md border bg-background">
                      {activeTargetQuery.isLoading || (activeTargetQuery.isFetching && !activeTargetQuery.data) ? (
                        <div className="flex min-h-28 items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          {labels.targetPicker.loading}
                        </div>
                      ) : activeTargetQuery.isError ? (
                        <div className="space-y-3 px-3 py-4 text-sm">
                          <p className="text-destructive">{labels.targetPicker.error}</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void activeTargetQuery.refetch()}
                          >
                            <RefreshCw className="me-1.5 h-4 w-4" aria-hidden="true" />
                            {labels.targetPicker.retry}
                          </Button>
                        </div>
                      ) : targetOptions.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-muted-foreground">
                          {labels.targetPicker.noResults}
                        </div>
                      ) : (
                        <div className="max-h-72 overflow-y-auto p-1">
                          {targetOptions.map((option) => {
                            const selected =
                              selectedTarget?.kind === option.kind && selectedTarget.id === option.id;
                            return (
                              <Button
                                key={`${option.kind}:${option.id}`}
                                type="button"
                                variant="ghost"
                                className={cn(
                                  'h-auto min-h-0 w-full justify-start gap-3 whitespace-normal rounded-md px-3 py-3 text-start hover:bg-muted/70',
                                  selected && 'bg-primary/10 text-primary hover:bg-primary/10',
                                )}
                                onClick={() => selectTargetOption(option)}
                              >
                                <span
                                  className={cn(
                                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background',
                                    selected && 'border-primary bg-primary text-primary-foreground',
                                  )}
                                >
                                  {selected ? (
                                    <Check className="h-4 w-4" aria-hidden="true" />
                                  ) : option.kind === 'contract' ? (
                                    <ScrollText className="h-4 w-4" aria-hidden="true" />
                                  ) : (
                                    <FileText className="h-4 w-4" aria-hidden="true" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{option.label}</span>
                                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                                    {option.summary}
                                  </span>
                                  {option.description ? (
                                    <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                                      {option.description}
                                    </span>
                                  ) : null}
                                </span>
                              </Button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="tracking-normal normal-case">
                          {allLabels.enums.targetType[targetType] ?? titleCase(targetType)}
                        </Badge>
                        <span className="font-medium">
                          {selectedTarget ? labels.targetPicker.selected : labels.targetPicker.previewHeading}
                        </span>
                      </div>
                      {selectedTarget ? (
                        <div className="mt-2 space-y-1">
                          <p className="font-medium">{selectedTarget.label}</p>
                          <p className="text-xs text-muted-foreground">{selectedTarget.summary}</p>
                        </div>
                      ) : targetId.trim() ? (
                        <p className="mt-2 text-xs text-muted-foreground">{labels.targetPicker.loading}</p>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">{labels.targetPicker.previewMissing}</p>
                      )}
                    </div>
                  </div>
                </FormField>
              </div>
              <FormField name="title" label={labels.fields.title} required>
                <Input id="title" {...form.register('title')} placeholder={labels.placeholders.title} />
              </FormField>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">{labels.sections.delivery}</h3>
              <FormField name="subject" label={labels.fields.subject}>
                <Input id="subject" {...form.register('subject')} placeholder={labels.placeholders.subject} />
              </FormField>
              <FormField name="message" label={labels.fields.message}>
                <Textarea
                  id="message"
                  rows={3}
                  {...form.register('message')}
                  placeholder={labels.placeholders.message}
                />
              </FormField>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField name="provider" label={labels.fields.provider} required>
                  <Select
                    value={form.watch('provider')}
                    onValueChange={(value) =>
                      form.setValue('provider', value as EnvelopeFormValues['provider'], {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger id="provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIGNATURE_PROVIDERS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {allLabels.enums.provider[option] ?? titleCase(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField name="method" label={labels.fields.method} required>
                  <Select
                    value={form.watch('method')}
                    onValueChange={(value) =>
                      form.setValue('method', value as EnvelopeFormValues['method'], {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger id="method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIGNATURE_METHODS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {allLabels.enums.method[option] ?? titleCase(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField name="language" label={labels.fields.language} required>
                  <Select
                    value={form.watch('language')}
                    onValueChange={(value) =>
                      form.setValue('language', value as EnvelopeFormValues['language'], {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger id="language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIGNATURE_LANGUAGES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {allLabels.enums.language[option] ?? option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField name="due_at" label={labels.fields.dueAt}>
                  <Input id="due_at" type="datetime-local" {...form.register('due_at')} />
                </FormField>
                <FormField name="expires_at" label={labels.fields.expiresAt}>
                  <Input id="expires_at" type="datetime-local" {...form.register('expires_at')} />
                </FormField>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{labels.sections.recipients}</h3>
                  <p className="text-xs text-muted-foreground">{labels.recipientsHint}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    recipients.append({
                      user_id: '',
                      name: '',
                      email: '',
                      phone: '',
                      role: '',
                      method: form.getValues('method'),
                      language: form.getValues('language'),
                    })
                  }
                >
                  <Plus className="me-1.5 h-4 w-4" />
                  {labels.recipient.add}
                </Button>
              </div>
              {form.formState.errors.recipients?.root ? (
                <p className="text-xs text-destructive" role="alert">
                  {form.formState.errors.recipients.root.message}
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="space-y-3 rounded-lg border p-3">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">{labels.recipientTools.presets}</h4>
                    <p className="mt-1 text-xs text-muted-foreground">{labels.recipientTools.presetsHint}</p>
                  </div>
                  <div className="space-y-2">
                    {recipientTemplates.map((template) => (
                      <Button
                        key={template.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-between gap-2"
                        aria-label={`${labels.recipientTools.useTemplate}: ${template.name}`}
                        onClick={() => applyRecipientTemplate(template)}
                      >
                        <span className="truncate">{template.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {labels.recipientTools.replaceWithTemplate}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border p-3 lg:col-span-2">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">{labels.recipientTools.bulkTitle}</h4>
                    <p className="mt-1 text-xs text-muted-foreground">{labels.recipientTools.bulkHint}</p>
                  </div>
                  <Textarea
                    value={bulkRecipientsText}
                    onChange={(event) => {
                      setBulkRecipientsText(event.target.value);
                      setBulkImportFeedback(null);
                    }}
                    rows={4}
                    placeholder={labels.recipientTools.bulkPlaceholder}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => importRecipientRows('append')}
                      disabled={!bulkRecipientsText.trim()}
                    >
                      <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
                      {labels.recipientTools.bulkImportAppend}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => importRecipientRows('replace')}
                      disabled={!bulkRecipientsText.trim()}
                    >
                      {labels.recipientTools.bulkImportReplace}
                    </Button>
                    {bulkImportFeedback ? (
                      <span className="text-xs text-muted-foreground">{bulkImportFeedback}</span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border p-3 lg:col-span-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium text-foreground">{labels.recipientTools.savedGroups}</h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {savedRecipientGroups.length === 0
                          ? labels.recipientTools.noSavedGroups
                          : labels.recipientTools.savedGroupCount(savedRecipientGroups.length)}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-1 gap-2 sm:max-w-md">
                      <Input
                        value={recipientGroupName}
                        onChange={(event) => setRecipientGroupName(event.target.value)}
                        placeholder={labels.recipientTools.groupNamePlaceholder}
                      />
                      <Button type="button" variant="outline" onClick={saveCurrentRecipientGroup}>
                        {labels.recipientTools.saveGroup}
                      </Button>
                    </div>
                  </div>
                  {savedRecipientGroups.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {savedRecipientGroups.map((group) => (
                        <div key={group.id} className="flex items-center gap-1 rounded-md border px-2 py-1">
                          <span className="max-w-48 truncate text-sm">{group.name}</span>
                          <Badge variant="outline" className="tracking-normal normal-case">
                            {labels.recipientTools.savedGroupBadge(group.recipients.length)}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => applySavedRecipientGroup(group)}
                          >
                            {labels.recipientTools.useGroup}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            aria-label={labels.recipientTools.removeGroup}
                            onClick={() => removeSavedRecipientGroup(group.id)}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="space-y-4">
                {recipients.fields.map((field, index) => (
                  <div key={field.id} className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{labels.recipient.heading(index)}</span>
                        <Badge variant="outline">{labels.recipient.orderBadge(index + 1)}</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={labels.recipient.moveUp}
                          disabled={index === 0}
                          onClick={() => recipients.move(index, index - 1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={labels.recipient.moveDown}
                          disabled={index === recipients.fields.length - 1}
                          onClick={() => recipients.move(index, index + 1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          aria-label={labels.recipient.remove}
                          disabled={recipients.fields.length === 1}
                          onClick={() => recipients.remove(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <FormField
                        name={`recipients.${index}.user_id`}
                        label={labels.recipient.internalUser}
                        description={labels.recipient.internalUserDescription}
                        className="md:col-span-2"
                      >
                        <TenantUserPicker
                          id={`recipients.${index}.user_id`}
                          ariaLabel={labels.recipient.internalUser}
                          value={form.watch(`recipients.${index}.user_id`)}
                          allowClear
                          selectedLabel={
                            compactJoin([
                              form.watch(`recipients.${index}.name`),
                              form.watch(`recipients.${index}.email`),
                            ]) || undefined
                          }
                          onChange={(userId, option) => {
                            form.setValue(`recipients.${index}.user_id` as const, userId, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                            if (userId && option) {
                              form.setValue(`recipients.${index}.name` as const, option.label, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                              form.setValue(
                                `recipients.${index}.email` as const,
                                option.description ?? '',
                                { shouldDirty: true, shouldValidate: true },
                              );
                            }
                          }}
                        />
                      </FormField>
                      <FormField name={`recipients.${index}.name`} label={labels.recipient.name} required>
                        <Input
                          id={`recipients.${index}.name`}
                          disabled={Boolean(form.watch(`recipients.${index}.user_id`))}
                          {...form.register(`recipients.${index}.name` as const)}
                          placeholder={labels.recipient.namePlaceholder}
                        />
                      </FormField>
                      <FormField name={`recipients.${index}.email`} label={labels.recipient.email}>
                        <Input
                          id={`recipients.${index}.email`}
                          type="email"
                          disabled={Boolean(form.watch(`recipients.${index}.user_id`))}
                          {...form.register(`recipients.${index}.email` as const)}
                          placeholder={labels.recipient.emailPlaceholder}
                        />
                      </FormField>
                      <FormField name={`recipients.${index}.phone`} label={labels.recipient.phone}>
                        <Input
                          id={`recipients.${index}.phone`}
                          {...form.register(`recipients.${index}.phone` as const)}
                          placeholder={labels.recipient.phonePlaceholder}
                        />
                      </FormField>
                      <FormField name={`recipients.${index}.role`} label={labels.recipient.role}>
                        <Input
                          id={`recipients.${index}.role`}
                          {...form.register(`recipients.${index}.role` as const)}
                          placeholder={labels.recipient.rolePlaceholder}
                        />
                      </FormField>
                      <div className="space-y-2 md:col-span-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          {labels.recipientTools.presets}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {ROLE_PRESET_KEYS.map((presetKey) => (
                            <Button
                              key={presetKey}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => applyRolePreset(index, labels.rolePresets[presetKey])}
                            >
                              {labels.rolePresets[presetKey]}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <FormField name={`recipients.${index}.method`} label={labels.recipient.method}>
                        <Select
                          value={form.watch(`recipients.${index}.method`)}
                          onValueChange={(value) =>
                            form.setValue(
                              `recipients.${index}.method` as const,
                              value as EnvelopeFormValues['recipients'][number]['method'],
                              { shouldValidate: true },
                            )
                          }
                        >
                          <SelectTrigger id={`recipients.${index}.method`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SIGNATURE_METHODS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {allLabels.enums.method[option] ?? titleCase(option)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                      <FormField name={`recipients.${index}.language`} label={labels.recipient.language}>
                        <Select
                          value={form.watch(`recipients.${index}.language`)}
                          onValueChange={(value) =>
                            form.setValue(
                              `recipients.${index}.language` as const,
                              value as EnvelopeFormValues['recipients'][number]['language'],
                              { shouldValidate: true },
                            )
                          }
                        >
                          <SelectTrigger id={`recipients.${index}.language`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SIGNATURE_LANGUAGES.map((option) => (
                              <SelectItem key={option} value={option}>
                                {allLabels.enums.language[option] ?? option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{labels.sections.preflight}</h3>
                <p className="text-xs text-muted-foreground">{labels.preflight.description}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {preflightItems.map((item) => (
                  <div
                    key={item.key}
                    className={
                      item.ready
                        ? 'flex items-center justify-between gap-3 rounded-lg border bg-success-50/50 px-3 py-2 text-sm dark:bg-success-700/20'
                        : 'flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm'
                    }
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {item.ready ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600" aria-hidden="true" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300" aria-hidden="true" />
                      )}
                      <span className="truncate">{item.label}</span>
                    </div>
                    <Badge
                      variant={item.ready ? 'default' : 'secondary'}
                      className="shrink-0 tracking-normal normal-case"
                    >
                      {item.ready ? labels.preflight.ready : labels.preflight.needsReview}
                    </Badge>
                  </div>
                ))}
              </div>
            </section>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {labels.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
      </Dialog>
      <ContractFormDialog
        open={contractCreateOpen}
        onOpenChange={setContractCreateOpen}
        onSaved={handleContractCreated}
      />
    </>
  );
}

function contractToTargetOption(
  contract: LexContractRecord,
  labels: SignatureLabels['create'],
  locale: AppLocale,
): TargetOption {
  const typeLabels = resolveLexBilingual(contractTypeLabels, locale);
  const statusLabels = resolveLexBilingual(lexContractStatusLabels, locale);
  return {
    kind: 'contract',
    id: contract.id,
    label: contract.title,
    summary: compactJoin([
      contract.contract_number,
      contract.party_b_name,
      typeLabels[contract.type] ?? titleCase(contract.type),
      statusLabels[contract.status] ?? titleCase(contract.status),
      contract.updated_at ? labels.targetPicker.updated(formatDateTime(contract.updated_at)) : undefined,
    ]),
    description: previewText(contract.description || contract.document_text),
  };
}

function documentToTargetOption(
  document: LexDocument,
  labels: SignatureLabels['create'],
  locale: AppLocale,
): TargetOption {
  const documentEnums = resolveDocumentsLabels(locale).enums;
  return {
    kind: 'document',
    id: document.id,
    label: document.title,
    summary: compactJoin([
      document.file_name,
      document.category,
      documentEnums.types[document.type] ?? titleCase(document.type),
      documentEnums.statuses[document.status] ?? titleCase(document.status),
      document.updated_at ? labels.targetPicker.updated(formatDateTime(document.updated_at)) : undefined,
    ]),
    description: previewText(document.description),
  };
}

function buildRecipientTemplates(
  labels: SignatureLabels['create'],
  method: RecipientFormValue['method'],
  language: RecipientFormValue['language'],
): RecipientTemplate[] {
  return [
    {
      id: 'primary-signer',
      name: labels.recipientTools.primarySignerTemplate,
      recipients: [blankRecipient(method, language, labels.rolePresets.authorisedSignatory)],
    },
    {
      id: 'counterparty-handoff',
      name: labels.recipientTools.counterpartyTemplate,
      recipients: [
        blankRecipient(method, language, labels.rolePresets.legalCounsel),
        blankRecipient(method, language, labels.rolePresets.authorisedSignatory),
      ],
    },
    {
      id: 'board-approval',
      name: labels.recipientTools.boardTemplate,
      recipients: [
        blankRecipient(method, language, labels.rolePresets.legalCounsel),
        blankRecipient(method, language, labels.rolePresets.financeApprover),
        blankRecipient(method, language, labels.rolePresets.witness),
      ],
    },
  ];
}

function buildPreflightItems({
  labels,
  targetId,
  selectedTarget,
  recipients,
  language,
  provider,
  method,
  dueAt,
  expiresAt,
}: {
  labels: SignatureLabels['create'];
  targetId: string;
  selectedTarget: TargetOption | null;
  recipients: RecipientFormValue[];
  language: EnvelopeFormValues['language'];
  provider: EnvelopeFormValues['provider'];
  method: EnvelopeFormValues['method'];
  dueAt: string;
  expiresAt: string;
}): PreflightItem[] {
  const recipientRows = recipients.filter(hasRecipientContent);
  const hasTarget = targetId.trim().length > 0;

  return [
    {
      key: 'target-selected',
      label: labels.preflight.targetSelected,
      ready: hasTarget,
    },
    {
      key: 'recipients-reachable',
      label: labels.preflight.recipientsReachable,
      ready: recipientRows.length > 0 && recipientRows.every(isRecipientReachable),
    },
    {
      key: 'language-consent',
      label: labels.preflight.languageConsentReady,
      ready: Boolean(language && provider && method),
    },
    {
      key: 'due-date',
      label: labels.preflight.dueDateValid,
      ready: isDueWindowValid(dueAt, expiresAt),
    },
    {
      key: 'target-preview',
      label: labels.preflight.targetPreviewKnown,
      ready: Boolean(selectedTarget || hasTarget),
    },
    {
      key: 'custody-strategy',
      label: labels.preflight.custodyStrategySet,
      ready: Boolean(provider && method),
    },
  ];
}

function blankRecipient(
  method: RecipientFormValue['method'],
  language: RecipientFormValue['language'],
  role = '',
): RecipientFormValue {
  return {
    user_id: '',
    name: '',
    email: '',
    phone: '',
    role,
    method,
    language,
  };
}

function cloneRecipient(recipient: RecipientFormValue): RecipientFormValue {
  return {
    user_id: recipient.user_id,
    name: recipient.name,
    email: recipient.email,
    phone: recipient.phone,
    role: recipient.role,
    method: recipient.method,
    language: recipient.language,
  };
}

function parseRecipientImport(
  value: string,
  fallbackMethod: RecipientFormValue['method'],
  fallbackLanguage: RecipientFormValue['language'],
): RecipientFormValue[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine)
    .filter((row, index) => !isRecipientImportHeader(row, index))
    .map((row) => {
      const [name = '', email = '', phone = '', role = '', method = '', language = ''] = row.map((cell) =>
        cell.trim(),
      );
      return {
        user_id: '',
        name,
        email,
        phone,
        role,
        method: normalizeSignatureMethod(method, fallbackMethod),
        language: normalizeSignatureLanguage(language, fallbackLanguage),
      };
    })
    .filter(hasRecipientContent);
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function isRecipientImportHeader(row: string[], index: number): boolean {
  if (index !== 0) {
    return false;
  }
  const normalized = row.map((cell) => cell.trim().toLowerCase());
  return normalized[0] === 'name' && normalized.includes('email');
}

function normalizeSignatureMethod(
  value: string,
  fallback: RecipientFormValue['method'],
): RecipientFormValue['method'] {
  return (SIGNATURE_METHODS as readonly string[]).includes(value)
    ? (value as RecipientFormValue['method'])
    : fallback;
}

function normalizeSignatureLanguage(
  value: string,
  fallback: RecipientFormValue['language'],
): RecipientFormValue['language'] {
  return (SIGNATURE_LANGUAGES as readonly string[]).includes(value)
    ? (value as RecipientFormValue['language'])
    : fallback;
}

function hasRecipientContent(recipient: RecipientFormValue): boolean {
  return [recipient.user_id, recipient.name, recipient.email, recipient.phone, recipient.role].some(
    (value) => value.trim().length > 0,
  );
}

function isRecipientReachable(recipient: RecipientFormValue): boolean {
  if (recipient.user_id.trim()) {
    return true;
  }
  const email = recipient.email.trim();
  const phone = recipient.phone.trim();
  return phone.length > 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isDueWindowValid(dueAt: string, expiresAt: string): boolean {
  const dueTime = parseDateInput(dueAt);
  const expiresTime = parseDateInput(expiresAt);

  if ((dueAt.trim() && dueTime === null) || (expiresAt.trim() && expiresTime === null)) {
    return false;
  }

  if (dueTime !== null && dueTime < Date.now()) {
    return false;
  }

  if (dueTime !== null && expiresTime !== null && dueTime > expiresTime) {
    return false;
  }

  return true;
}

function parseDateInput(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.valueOf();
}

function compactJoin(parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function previewText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
}

function buildEnvelopePayload(values: EnvelopeFormValues): LexCreateSignatureEnvelopePayload {
  const recipients: LexSignatureRecipientInput[] = values.recipients.map((recipient, index) => ({
    user_id: emptyToNull(recipient.user_id),
    name: recipient.name.trim(),
    email: emptyToNull(recipient.email),
    phone: emptyToNull(recipient.phone),
    role: emptyToNull(recipient.role),
    method: recipient.method,
    language: recipient.language,
    signing_order: index + 1,
  }));

  return {
    title: values.title.trim(),
    subject: emptyToUndefined(values.subject),
    message: emptyToNull(values.message),
    language: values.language,
    provider: values.provider,
    method: values.method,
    contract_id: values.target_type === 'contract' ? values.contract_id.trim() : null,
    document_id: values.target_type === 'document' ? values.document_id.trim() : null,
    due_at: toIsoOrNull(values.due_at),
    expires_at: toIsoOrNull(values.expires_at),
    recipients,
  };
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toIsoOrNull(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
