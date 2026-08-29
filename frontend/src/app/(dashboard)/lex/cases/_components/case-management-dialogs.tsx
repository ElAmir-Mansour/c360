'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
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
import { FormField } from '@/components/shared/forms/form-field';
import { OrgEntityUserPicker } from '@/components/shared/forms/org-entity-user-picker';
import { apiPost } from '@/lib/api';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  casesApi,
  CASE_STATUS_TRANSITIONS,
  CASE_STRENGTH_OPTIONS,
  CASE_RISK_RATING_OPTIONS,
  LEGAL_PRIORITY_OPTIONS,
  formatCaseToken,
  type CaseRiskRating,
  type CaseStatus,
  type CaseStrength,
  type DelayCategory,
  type LegalCase,
  type LegalCaseDetail,
  type LegalPriority,
  type SetCaseRiskRatingPayload,
  type UpdateCaseStatusPayload,
} from '@/lib/lex/cases';
import { useCaseLabels } from './labels';

const DELAY_CATEGORY_OPTIONS: readonly DelayCategory[] = ['court', 'government', 'department', 'expert'];

/* ----------------------------- Status dialog ----------------------------- */

export function CaseStatusDialog({
  legalCase,
  open,
  onOpenChange,
  onSaved,
}: {
  legalCase: LegalCase | LegalCaseDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.statusDialog;
  const options = CASE_STATUS_TRANSITIONS[legalCase.status] ?? [];
  const [status, setStatus] = useState<CaseStatus | ''>('');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<DelayCategory | ''>('');
  const [lateJustification, setLateJustification] = useState('');
  const requiresCategory = status === 'on_hold';
  const slaDeadline = 'computed' in legalCase ? legalCase.computed.sla_turnaround_due_at : null;
  const requiresLateJustification =
    (status === 'closed' || status === 'cancelled') &&
    Boolean(slaDeadline && Date.now() > new Date(slaDeadline).getTime());

  useEffect(() => {
    if (open) {
      setStatus('');
      setReason('');
      setCategory('');
      setLateJustification('');
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!status) throw new Error('no status');
      const payload: UpdateCaseStatusPayload = { status, reason };
      if (requiresLateJustification) payload.late_justification = lateJustification.trim();
      if (status === 'on_hold') {
        if (!category) throw new Error('no category');
        payload.category = category;
      }
      return casesApi.updateCaseStatus(legalCase.id, payload);
    },
    onSuccess: () => {
      showSuccess(labels.toast.statusUpdated);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noTransitions}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t.nextStatus}</span>
              <Select value={status} onValueChange={(v) => setStatus(v as CaseStatus)}>
                <SelectTrigger>
                  <SelectValue placeholder={t.selectStatus} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o} value={o}>
                      {labels.filters.statusOptions[o] ?? formatCaseToken(o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {requiresCategory ? (
              <div className="space-y-1.5">
                <span className="text-sm font-medium">{t.delayCategory}</span>
                <Select value={category} onValueChange={(v) => setCategory(v as DelayCategory)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t.selectCategory} />
                  </SelectTrigger>
                  <SelectContent>
                    {DELAY_CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t.categoryOptions[c] ?? formatCaseToken(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t.reason}</span>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonPlaceholder} />
            </div>
            {requiresLateJustification ? (
              <div className="space-y-1.5">
                <span className="text-sm font-medium">{t.lateJustification}</span>
                <Textarea
                  rows={4}
                  value={lateJustification}
                  onChange={(event) => setLateJustification(event.target.value)}
                  placeholder={t.lateJustificationPlaceholder}
                />
                <p className="text-xs text-muted-foreground">{t.lateJustificationPrivacy}</p>
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={
              !status ||
              (requiresCategory && !category) ||
              (requiresLateJustification && !lateJustification.trim()) ||
              mutation.isPending
            }
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- Strength dialog ---------------------------- */

function buildStrengthSchema() {
  return z.object({
    strength: z.enum(CASE_STRENGTH_OPTIONS as unknown as [CaseStrength, ...CaseStrength[]]),
    reason: z.string().trim().optional().default(''),
  });
}
type StrengthValues = z.infer<ReturnType<typeof buildStrengthSchema>>;

export function CaseStrengthDialog({
  legalCase,
  open,
  onOpenChange,
  onSaved,
}: {
  legalCase: LegalCase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.strengthDialog;
  const schema = useMemo(() => buildStrengthSchema(), []);
  const form = useForm<StrengthValues>({
    resolver: zodResolver(schema),
    defaultValues: { strength: legalCase.strength ?? 'strong', reason: '' },
  });

  useEffect(() => {
    if (open) form.reset({ strength: legalCase.strength ?? 'strong', reason: '' });
  }, [open, legalCase.strength, form]);

  const mutation = useMutation({
    mutationFn: (values: StrengthValues) =>
      casesApi.setCaseStrength(legalCase.id, { strength: values.strength, reason: values.reason }),
    onSuccess: () => {
      showSuccess(labels.toast.strengthUpdated);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  const strengthValue = form.watch('strength');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <FormField name="strength" label={t.strength} required>
              <Select
                value={strengthValue}
                onValueChange={(v) => form.setValue('strength', v as CaseStrength, { shouldValidate: true })}
              >
                <SelectTrigger id="strength">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_STRENGTH_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {labels.filters.strengthOptions[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField name="reason" label={t.reason}>
              <Textarea id="reason" rows={3} {...form.register('reason')} placeholder={t.reasonPlaceholder} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Risk-rating dialog -------------------------- */

/** Sentinel Select value meaning "derive the band from likelihood × impact". */
const RISK_DERIVE = '__derive__';

/** Client-side mirror of the backend derivation (model.DeriveCaseRiskRating):
 * score = likelihood × impact × 4, mapped onto the graded bands with the floor
 * clamped to `low` (Othaim PRD 8.2). Used only for the live preview. */
function deriveCaseRiskRating(likelihood: number, impact: number): CaseRiskRating {
  const score = likelihood * impact * 4;
  if (score > 75) return 'critical';
  if (score > 55) return 'high';
  if (score > 35) return 'medium';
  return 'low';
}

/** Parse a 1–5 risk factor from free text; returns null when blank/invalid. */
function parseRiskFactor(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  return n;
}

function buildRiskRatingSchema() {
  return z
    .object({
      rating: z.string(),
      likelihood: z.string().optional().default(''),
      impact: z.string().optional().default(''),
      exposureValue: z.string().optional().default(''),
      exposureCurrency: z.string().trim().optional().default(''),
      reason: z.string().trim().optional().default(''),
    })
    .superRefine((val, ctx) => {
      const deriving = val.rating === RISK_DERIVE;
      const l = (val.likelihood ?? '').trim();
      const i = (val.impact ?? '').trim();
      // When deriving, both factors are required and must be 1–5.
      if (deriving) {
        if (parseRiskFactor(l) === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['likelihood'], message: 'range' });
        }
        if (parseRiskFactor(i) === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['impact'], message: 'range' });
        }
      } else {
        // A band is chosen: factors are optional but paired, and each valid.
        if ((l === '') !== (i === '')) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['likelihood'], message: 'paired' });
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['impact'], message: 'paired' });
        }
        if (l !== '' && parseRiskFactor(l) === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['likelihood'], message: 'range' });
        }
        if (i !== '' && parseRiskFactor(i) === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['impact'], message: 'range' });
        }
      }
      if (val.exposureValue.trim() !== '') {
        const ev = Number(val.exposureValue.trim());
        if (Number.isNaN(ev) || ev < 0) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['exposureValue'], message: 'invalid' });
        }
      }
    });
}
type RiskRatingValues = z.infer<ReturnType<typeof buildRiskRatingSchema>>;

export function CaseRiskRatingDialog({
  legalCase,
  open,
  onOpenChange,
  onSaved,
}: {
  legalCase: LegalCase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.riskRatingDialog;
  const schema = useMemo(() => buildRiskRatingSchema(), []);
  const defaults = useMemo<RiskRatingValues>(
    () => ({
      rating: legalCase.risk_rating ?? 'medium',
      likelihood: legalCase.risk_likelihood != null ? String(legalCase.risk_likelihood) : '',
      impact: legalCase.risk_impact != null ? String(legalCase.risk_impact) : '',
      exposureValue: legalCase.risk_exposure_value != null ? String(legalCase.risk_exposure_value) : '',
      exposureCurrency: legalCase.risk_exposure_currency ?? '',
      reason: '',
    }),
    [legalCase],
  );
  const form = useForm<RiskRatingValues>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);

  const mutation = useMutation({
    mutationFn: (values: RiskRatingValues) => {
      const payload: SetCaseRiskRatingPayload = { reason: values.reason };
      if (values.rating !== RISK_DERIVE) payload.rating = values.rating as CaseRiskRating;
      const l = parseRiskFactor(values.likelihood ?? '');
      const i = parseRiskFactor(values.impact ?? '');
      if (l !== null && i !== null) {
        payload.likelihood = l;
        payload.impact = i;
      }
      if (values.exposureValue.trim() !== '') payload.exposure_value = Number(values.exposureValue.trim());
      if (values.exposureCurrency.trim() !== '') payload.exposure_currency = values.exposureCurrency.trim();
      return casesApi.setCaseRiskRating(legalCase.id, payload);
    },
    onSuccess: () => {
      showSuccess(labels.toast.riskRatingUpdated);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  const ratingValue = form.watch('rating');
  const likelihoodValue = form.watch('likelihood');
  const impactValue = form.watch('impact');
  const deriving = ratingValue === RISK_DERIVE;
  const l = parseRiskFactor(likelihoodValue ?? '');
  const i = parseRiskFactor(impactValue ?? '');
  const derivedBand = l !== null && i !== null ? deriveCaseRiskRating(l, i) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <FormField name="rating" label={t.rating} required>
              <Select
                value={ratingValue}
                onValueChange={(v) => form.setValue('rating', v, { shouldValidate: true })}
              >
                <SelectTrigger id="rating">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_RISK_RATING_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {labels.filters.riskRatingOptions[o]}
                    </SelectItem>
                  ))}
                  <SelectItem value={RISK_DERIVE}>{t.autoRating}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField name="likelihood" label={t.likelihood} required={deriving}>
                <Input
                  id="likelihood"
                  type="number"
                  min={1}
                  max={5}
                  inputMode="numeric"
                  placeholder={t.factorPlaceholder}
                  {...form.register('likelihood')}
                />
              </FormField>
              <FormField name="impact" label={t.impact} required={deriving}>
                <Input
                  id="impact"
                  type="number"
                  min={1}
                  max={5}
                  inputMode="numeric"
                  placeholder={t.factorPlaceholder}
                  {...form.register('impact')}
                />
              </FormField>
            </div>
            {derivedBand ? (
              <p className="text-xs text-muted-foreground" dir="auto">
                {t.derivedHint(labels.filters.riskRatingOptions[derivedBand] ?? derivedBand)}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <FormField name="exposureValue" label={t.exposureValue}>
                <Input
                  id="exposureValue"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  placeholder={t.exposureValuePlaceholder}
                  {...form.register('exposureValue')}
                />
              </FormField>
              <FormField name="exposureCurrency" label={t.exposureCurrency}>
                <Input
                  id="exposureCurrency"
                  placeholder={t.exposureCurrencyPlaceholder}
                  {...form.register('exposureCurrency')}
                />
              </FormField>
            </div>
            <FormField name="reason" label={t.reason}>
              <Textarea id="riskReason" rows={3} {...form.register('reason')} placeholder={t.reasonPlaceholder} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- Priority dialog ---------------------------- */

function buildPrioritySchema() {
  return z.object({
    priority: z.enum(LEGAL_PRIORITY_OPTIONS as unknown as [LegalPriority, ...LegalPriority[]]),
    reason: z.string().trim().optional().default(''),
  });
}
type PriorityValues = z.infer<ReturnType<typeof buildPrioritySchema>>;

export function CasePriorityDialog({
  legalCase,
  open,
  onOpenChange,
  onSaved,
}: {
  legalCase: LegalCase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.priorityDialog;
  const schema = useMemo(() => buildPrioritySchema(), []);
  const form = useForm<PriorityValues>({
    resolver: zodResolver(schema),
    defaultValues: { priority: legalCase.priority ?? 'medium', reason: '' },
  });

  useEffect(() => {
    if (open) form.reset({ priority: legalCase.priority ?? 'medium', reason: '' });
  }, [open, legalCase.priority, form]);

  const mutation = useMutation({
    mutationFn: (values: PriorityValues) =>
      casesApi.setCasePriority(legalCase.id, { priority: values.priority, reason: values.reason }),
    onSuccess: () => {
      showSuccess(labels.toast.priorityUpdated);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  const priorityValue = form.watch('priority');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => mutation.mutate(v))}>
            <FormField name="priority" label={t.priority} required>
              <Select
                value={priorityValue}
                onValueChange={(v) => form.setValue('priority', v as LegalPriority, { shouldValidate: true })}
              >
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEGAL_PRIORITY_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {labels.filters.priorityOptions[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField name="reason" label={t.reason}>
              <Textarea id="reason" rows={3} {...form.register('reason')} placeholder={t.reasonPlaceholder} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.submit}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Intake dialog ----------------------------- */

function buildIntakeSchema() {
  return z.object({
    ceo_directive_ref: z.string().trim().min(1, 'Required'),
    doa_authority_ref: z.string().trim().min(1, 'Required'),
    strength_assessment: z.enum(CASE_STRENGTH_OPTIONS as unknown as [CaseStrength, ...CaseStrength[]]),
  });
}
type IntakeValues = z.infer<ReturnType<typeof buildIntakeSchema>>;

export function CaseIntakeDialog({
  legalCase,
  canAssign,
  open,
  onOpenChange,
  onSaved,
}: {
  legalCase: LegalCase;
  canAssign: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const labels = useCaseLabels();
  const t = labels.intake;
  const queryClient = useQueryClient();

  const intakeQuery = useQuery({
    queryKey: ['lex-case-intake', legalCase.id],
    queryFn: () => casesApi.getIntake(legalCase.id),
    enabled: open,
    retry: false,
  });

  const schema = useMemo(() => buildIntakeSchema(), []);
  const form = useForm<IntakeValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ceo_directive_ref: '',
      doa_authority_ref: '',
      strength_assessment: legalCase.strength ?? 'strong',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        ceo_directive_ref: '',
        doa_authority_ref: '',
        strength_assessment: legalCase.strength ?? 'strong',
      });
    }
  }, [open, form, legalCase.strength]);

  const startMutation = useMutation({
    mutationFn: (values: IntakeValues) =>
      casesApi.startIntake(legalCase.id, {
        ceo_directive_ref: values.ceo_directive_ref,
        doa_authority_ref: values.doa_authority_ref,
        strength_assessment: values.strength_assessment,
      }),
    onSuccess: async () => {
      showSuccess(labels.toast.intakeStarted);
      await queryClient.invalidateQueries({ queryKey: ['lex-case-intake', legalCase.id] });
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  const strengthValue = form.watch('strength_assessment');
  const intake = intakeQuery.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        {intakeQuery.isLoading ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t.loading}
          </div>
        ) : intakeQuery.isError ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {t.loadError}
          </p>
        ) : intake ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p>
              {t.statusLabel}: <span className="font-medium">{formatCaseToken(intake.phase)}</span>
            </p>
            {intake.ceo_directive_ref ? (
              <p className="text-muted-foreground">
                {t.ceoDirectiveRef}: {intake.ceo_directive_ref}
              </p>
            ) : null}
            {intake.workflow_instance_id ? (
              <p className="text-muted-foreground">
                {t.workflowLabel}: {intake.workflow_instance_id}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{t.notStarted}</p>
            <p className="text-muted-foreground">{t.notStartedDescription}</p>
          </div>
        )}

        {intake?.phase === 'phase1' ? (
          <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-4 text-sm">
            <p className="font-medium">{t.awaitingApproval}</p>
            <p className="text-muted-foreground">{t.awaitingApprovalDescription}</p>
            <Button asChild type="button" variant="outline" size="sm">
              <Link href="/lex/inbox">{t.openApprovals}</Link>
            </Button>
          </div>
        ) : null}

        {intake?.phase === 'phase2' && canAssign ? (
          <CaseHandoffForm
            legalCase={legalCase}
            onCancel={() => onOpenChange(false)}
            onSaved={async () => {
              await queryClient.invalidateQueries({ queryKey: ['lex-case-intake', legalCase.id] });
              onOpenChange(false);
              onSaved();
            }}
          />
        ) : null}

        {!intakeQuery.isLoading && !intakeQuery.isError && !intake && legalCase.status === 'intake' ? (
          <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => startMutation.mutate(v))}>
            <FormField name="ceo_directive_ref" label={t.ceoDirectiveRef} required>
              <Input id="ceo_directive_ref" {...form.register('ceo_directive_ref')} placeholder={t.ceoDirectiveRefPlaceholder} />
            </FormField>
            <FormField name="doa_authority_ref" label={t.doaAuthorityRef} required>
              <Input id="doa_authority_ref" {...form.register('doa_authority_ref')} placeholder={t.doaAuthorityRefPlaceholder} />
            </FormField>
            <FormField name="strength_assessment" label={t.strengthAssessment} required>
              <Select
                value={strengthValue}
                onValueChange={(v) => form.setValue('strength_assessment', v as CaseStrength, { shouldValidate: true })}
              >
                <SelectTrigger id="strength_assessment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_STRENGTH_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {labels.filters.strengthOptions[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={startMutation.isPending}>
                {startMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t.start}
              </Button>
            </DialogFooter>
          </form>
          </FormProvider>
        ) : null}

        {intake?.phase === 'complete' ? (
          <p className="rounded-lg border bg-success-500/5 p-4 text-sm text-success-700 dark:text-success-300">
            {t.handoffComplete}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CaseHandoffForm({
  legalCase,
  onCancel,
  onSaved,
}: {
  legalCase: LegalCase;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useCaseLabels().intake;
  const entityId = useMemo(() => {
    const value = legalCase.metadata?.beneficiary_entity_id;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }, [legalCase.metadata]);
  const [sectionManagerId, setSectionManagerId] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [handlingOfficerId, setHandlingOfficerId] = useState('');
  const [taskEstimate, setTaskEstimate] = useState('');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/v1/lex/legal-cases/${legalCase.id}/intake/handoff`, {
        section_manager_id: sectionManagerId,
        supervisor_id: supervisorId || null,
        handling_officer_id: handlingOfficerId || null,
        task_estimate: taskEstimate.trim() || null,
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      showSuccess(t.handoffSaved);
      await onSaved();
    },
    onError: showApiError,
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">{t.handoffTitle}</p>
        <p className="text-xs text-muted-foreground">{t.handoffDescription}</p>
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t.sectionManager} *</span>
        <OrgEntityUserPicker
          ariaLabel={t.sectionManager}
          entityId={entityId}
          value={sectionManagerId}
          onChange={setSectionManagerId}
          required
          disabled={mutation.isPending}
        />
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t.supervisor}</span>
        <OrgEntityUserPicker
          ariaLabel={t.supervisor}
          entityId={entityId}
          value={supervisorId}
          onChange={setSupervisorId}
          allowClear
          disabled={mutation.isPending}
        />
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t.handlingOfficer}</span>
        <OrgEntityUserPicker
          ariaLabel={t.handlingOfficer}
          entityId={entityId}
          value={handlingOfficerId}
          onChange={setHandlingOfficerId}
          allowClear
          disabled={mutation.isPending}
        />
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t.taskEstimate}</span>
        <Input
          value={taskEstimate}
          onChange={(event) => setTaskEstimate(event.target.value)}
          placeholder={t.taskEstimatePlaceholder}
        />
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{t.handoffReason}</span>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder={t.handoffReasonPlaceholder}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          {t.cancel}
        </Button>
        <Button
          type="button"
          disabled={!sectionManagerId || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
          {t.completeHandoff}
        </Button>
      </DialogFooter>
    </div>
  );
}
