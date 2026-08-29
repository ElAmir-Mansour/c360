'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { FormField } from '@/components/shared/forms/form-field';
import { LexRecordPicker } from '@/components/lex/lex-record-picker';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  INVESTIGATION_PRIORITY_VALUES,
  investigationsApi,
  type CreateInvestigationPayload,
  type Investigation,
  type UpdateInvestigationPayload,
} from '@/lib/lex/investigations';
import {
  INVESTIGATION_PRIORITY_OPTIONS,
  useInvestigationLabels,
  type InvestigationLabels,
} from './labels';
import {
  withInvestigationWorkspaceMetadata,
  type InvestigationWorkspace,
} from './investigation-workspaces';

// Zero-UUID unlink sentinel. Go can't distinguish a JSON null *uuid.UUID from an
// absent key (both decode to nil → "unchanged"), so clearing an existing case link on
// edit must send this sentinel; the backend maps it back to NULL (mirrors the contract
// legal_reviewer_id / matter requester_user_id convention).
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function buildSchema(errors: InvestigationLabels['form']['errors']) {
  return z.object({
    case_id: z.string().trim().optional().nullable(),
    subject: z.string().trim().min(3, errors.subjectRequired),
    lead_investigator: z.string().trim().min(1, errors.leadRequired),
    investigation_number: z.string().trim().optional().nullable(),
    priority: z.enum(INVESTIGATION_PRIORITY_VALUES),
    department: z.string().trim().optional().nullable(),
    readiness_parties_identified: z.boolean().default(false),
    readiness_evidence_sources_identified: z.boolean().default(false),
    readiness_approval_path_ready: z.boolean().default(false),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  investigation?: Investigation | null;
  workspace?: InvestigationWorkspace | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (investigation: Investigation) => void;
}

function buildDefaults(investigation?: Investigation | null): FormValues {
  const readiness = readMetadataRecord(investigation?.metadata, 'intake_readiness');
  return {
    case_id: investigation?.case_id ?? '',
    subject: investigation?.subject ?? '',
    lead_investigator: investigation?.lead_investigator ?? '',
    investigation_number: investigation?.investigation_number ?? '',
    priority: (INVESTIGATION_PRIORITY_VALUES as readonly string[]).includes(
      investigation?.priority ?? '',
    )
      ? (investigation?.priority as FormValues['priority'])
      : 'medium',
    department: investigation?.department ?? '',
    readiness_parties_identified: readMetadataBoolean(readiness, 'parties_identified'),
    readiness_evidence_sources_identified: readMetadataBoolean(
      readiness,
      'evidence_sources_identified',
    ),
    readiness_approval_path_ready: readMetadataBoolean(readiness, 'approval_path_ready'),
  };
}

export function InvestigationFormDialog({
  investigation,
  workspace,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const isEdit = Boolean(investigation);
  const qc = useQueryClient();
  const L = useInvestigationLabels();
  const { locale } = useLocaleOrDefault();
  const labels = L.form;
  const schema = useMemo(() => buildSchema(L.form.errors), [L.form.errors]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: buildDefaults(investigation),
  });

  useEffect(() => {
    if (open) form.reset(buildDefaults(investigation));
  }, [investigation, form, open]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const metadata = buildInvestigationIntakeMetadata(values, investigation?.metadata, workspace);
      if (isEdit && investigation) {
        const payload: UpdateInvestigationPayload = {
          // Send the NIL_UUID sentinel (not null) so a cleared case picker actually
          // unlinks, and '' (not null) so a cleared department actually clears — a JSON
          // null reads as "unchanged" on the Go side and silently keeps the old value.
          case_id: values.case_id?.trim() || NIL_UUID,
          subject: values.subject.trim(),
          lead_investigator: values.lead_investigator.trim(),
          priority: values.priority,
          department: values.department?.trim() ?? '',
          metadata,
        };
        return investigationsApi.update(investigation.id, payload);
      }
      const payload: CreateInvestigationPayload = {
        case_id: values.case_id?.trim() || null,
        subject: values.subject.trim(),
        lead_investigator: values.lead_investigator.trim(),
        investigation_number: values.investigation_number?.trim() || null,
        priority: values.priority,
        department: values.department?.trim() || null,
        metadata,
      };
      return investigationsApi.create(payload);
    },
    onSuccess: async (saved) => {
      showSuccess(isEdit ? L.toast.updated : L.toast.created);
      await qc.invalidateQueries({ queryKey: ['lex-investigations'] });
      if (investigation) {
        await qc.invalidateQueries({ queryKey: ['lex-investigation', investigation.id] });
      }
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });

  const priorityValue = form.watch('priority');
  const caseId = form.watch('case_id') ?? '';
  const subject = form.watch('subject') ?? '';
  const lead = form.watch('lead_investigator') ?? '';
  const partiesReady = form.watch('readiness_parties_identified');
  const evidenceReady = form.watch('readiness_evidence_sources_identified');
  const approvalReady = form.watch('readiness_approval_path_ready');
  const readyCount = [
    caseId.trim().length > 0,
    subject.trim().length >= 3,
    lead.trim().length > 0,
    partiesReady,
    evidenceReady,
    approvalReady,
  ].filter(Boolean).length;
  const workspaceLabel = workspace
    ? {
        fraud: locale === 'ar' ? 'تحقيقات الاحتيال' : 'Fraud Investigations',
        compliance: locale === 'ar' ? 'تدقيق الالتزام' : 'Compliance Audits',
        forensics: locale === 'ar' ? 'الأدلة الرقمية' : 'Digital Forensics',
        board: locale === 'ar' ? 'مراجعة المجلس' : 'Board Review',
      }[workspace]
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? labels.editTitle : labels.createTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? labels.editDescription : labels.createDescription}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            {!isEdit ? <LexCreationGuidance workflow="investigation" /> : null}
            {!isEdit && workspace ? (
              <p
                className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground"
                role="status"
              >
                {locale === 'ar'
                  ? `سيتم إنشاء هذا التحقيق داخل مساحة ${workspaceLabel}.`
                  : `This investigation will be created in the ${workspaceLabel} workspace.`}
              </p>
            ) : null}
            <WizardSection
              step="1"
              title={labels.caseStepTitle}
              description={labels.caseStepDescription}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <FormField
                  name="case_id"
                  label={labels.caseId}
                  description={labels.caseIdDescription}
                >
                  <LexRecordPicker
                    id="case_id"
                    kind="case"
                    ariaLabel={labels.caseId}
                    value={caseId}
                    onChange={(value) => form.setValue('case_id', value || null, { shouldDirty: true })}
                    enabled={open}
                    allowClear
                    labels={{
                      select: labels.caseIdPlaceholder,
                      search: labels.caseIdPlaceholder,
                    }}
                  />
                </FormField>

                <FormField
                  name="subject"
                  label={labels.subject}
                  description={labels.subjectDescription}
                  required
                >
                  <Input
                    id="subject"
                    {...form.register('subject')}
                    placeholder={labels.subjectPlaceholder}
                  />
                </FormField>
              </div>

              {!isEdit ? (
                <FormField name="investigation_number" label={labels.number}>
                  <Input
                    id="investigation_number"
                    {...form.register('investigation_number')}
                    placeholder={labels.numberPlaceholder}
                  />
                </FormField>
              ) : null}
            </WizardSection>

            <WizardSection
              step="2"
              title={labels.assignmentStepTitle}
              description={labels.assignmentStepDescription}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  name="lead_investigator"
                  label={labels.lead}
                  description={labels.leadDescription}
                  required
                  className="md:col-span-1"
                >
                  <Input
                    id="lead_investigator"
                    {...form.register('lead_investigator')}
                    placeholder={labels.leadPlaceholder}
                  />
                </FormField>

                <FormField
                  name="priority"
                  label={labels.priority}
                  description={labels.priorityDescription}
                  required
                >
                  <Select
                    value={priorityValue}
                    onValueChange={(v) =>
                      form.setValue('priority', v as FormValues['priority'], {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger id="priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INVESTIGATION_PRIORITY_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o}>
                          {L.filters.priorityOptions[o]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField name="department" label={labels.department}>
                  <Input
                    id="department"
                    {...form.register('department')}
                    placeholder={labels.departmentPlaceholder}
                  />
                </FormField>
              </div>
            </WizardSection>

            <WizardSection
              step="3"
              title={labels.readinessStepTitle}
              description={labels.readinessStepDescription}
            >
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-3">
                  <ReadinessCheckbox
                    id="readiness_parties_identified"
                    label={labels.readinessParties}
                    checked={partiesReady}
                    onCheckedChange={(checked) =>
                      form.setValue('readiness_parties_identified', checked, {
                        shouldDirty: true,
                      })
                    }
                  />
                  <ReadinessCheckbox
                    id="readiness_evidence_sources_identified"
                    label={labels.readinessEvidence}
                    checked={evidenceReady}
                    onCheckedChange={(checked) =>
                      form.setValue('readiness_evidence_sources_identified', checked, {
                        shouldDirty: true,
                      })
                    }
                  />
                  <ReadinessCheckbox
                    id="readiness_approval_path_ready"
                    label={labels.readinessApproval}
                    checked={approvalReady}
                    onCheckedChange={(checked) =>
                      form.setValue('readiness_approval_path_ready', checked, {
                        shouldDirty: true,
                      })
                    }
                  />
                </div>

                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{labels.readinessTitle}</p>
                    <span className="text-xs text-muted-foreground">{readyCount}/6</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    <ReadinessCue ready={caseId.trim().length > 0} label={labels.readinessCase} />
                    <ReadinessCue
                      ready={subject.trim().length >= 3}
                      label={labels.readinessSubject}
                    />
                    <ReadinessCue ready={lead.trim().length > 0} label={labels.readinessLead} />
                    <ReadinessCue ready={partiesReady} label={labels.readinessPartiesCue} />
                    <ReadinessCue ready={evidenceReady} label={labels.readinessEvidenceCue} />
                    <ReadinessCue ready={approvalReady} label={labels.readinessApprovalCue} />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {readyCount === 6 ? labels.readinessComplete : labels.readinessIncomplete}
                  </p>
                </div>
              </div>
            </WizardSection>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {isEdit ? labels.save : labels.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function WizardSection({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border p-4">
      <div className="mb-4 flex gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {step}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ReadinessCheckbox({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-background px-3 py-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <Label htmlFor={id} className="cursor-pointer text-sm leading-5">
        {label}
      </Label>
    </div>
  );
}

function ReadinessCue({ ready, label }: { ready: boolean; label: string }) {
  const Icon = ready ? CheckCircle2 : Circle;
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon
        className={ready ? 'h-3.5 w-3.5 text-success-600' : 'h-3.5 w-3.5 text-muted-foreground'}
      />
      <span className={ready ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

export function buildInvestigationIntakeMetadata(
  values: FormValues,
  existing?: Record<string, unknown> | null,
  workspace?: InvestigationWorkspace | null,
): Record<string, unknown> {
  const existingReadiness = readMetadataRecord(existing, 'intake_readiness');
  return withInvestigationWorkspaceMetadata(
    {
      ...(existing ?? {}),
      intake_readiness: {
        ...existingReadiness,
        case_linked: Boolean(values.case_id?.trim()),
        parties_identified: values.readiness_parties_identified,
        evidence_sources_identified: values.readiness_evidence_sources_identified,
        approval_path_ready: values.readiness_approval_path_ready,
      },
    },
    workspace,
  );
}

function readMetadataRecord(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> {
  const value = metadata?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean {
  return metadata[key] === true;
}
