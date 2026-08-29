'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/use-auth';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { HumanTask } from '@/types/models';
import type {
  LexClausePlaybook,
  LexClauseType,
  LexContractType,
  LexCreatePlaybookPayload,
  LexPlaybookStatus,
  LexPlaybookTemplate,
} from '@/types/suites';
import { complianceTone, clampPercent } from './deviation-meta';
import { usePlaybookLabels } from './labels';
import {
  CLAUSE_TYPES,
  CONTRACT_TYPES,
  PLAYBOOK_STATUSES,
  type PlaybookClauseDraft,
  type PlaybookFormValues,
  buildPlaybookClauses,
  buildPlaybookPayload,
  emptyClause,
  formatToken,
  playbookDefaults,
  playbookDefaultsFromTemplate,
  validatePlaybookForm,
} from './playbook-form';

// Convenience re-export: the canonical PlaybookTemplatePicker definition lives in
// `./playbook-template-picker`. We re-export it here so callers can import either
// from the picker module directly or alongside PlaybookDialog. The cross-agent
// contract ownership of the component remains `playbook-template-picker.tsx`.
export { PlaybookTemplatePicker } from './playbook-template-picker';

interface PlaybookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  playbook?: LexClausePlaybook | null;
  /**
   * WTQ-RSK-02 #7 — optional template to prefill a NEW (create-mode) playbook
   * from. Only applied when `playbook == null`. Existing "blank create" still
   * works when this is null/undefined. Ignored entirely in edit mode.
   */
  templateSeed?: LexPlaybookTemplate | null;
}

// Tone → text-color class for the dry-run "would-be" compliance score, derived
// from the shared complianceTone() bands so the preview matches the catalog /
// portfolio / deviation-review color vocabulary.
const SCORE_TONE_CLASS: Record<ReturnType<typeof complianceTone>, string> = {
  emerald: 'text-success-600 dark:text-success-300',
  gold: 'text-warning-700 dark:text-warning-300',
  rose: 'text-rose-600 dark:text-rose-400',
  sky: 'text-sky-600 dark:text-sky-400',
  slate: 'text-neutral-600 dark:text-neutral-300',
  teal: 'text-neutral-600 dark:text-neutral-300',
  neutral: 'text-muted-foreground',
};

// A workflow HumanTask is still "open" (awaiting a decision) while pending,
// claimed, or escalated. Completed/rejected/cancelled tasks are terminal.
function isOpenApprovalTask(task: HumanTask): boolean {
  return (
    task.status === 'pending' ||
    task.status === 'claimed' ||
    task.status === 'escalated'
  );
}

export function PlaybookDialog({
  onOpenChange,
  onSaved,
  open,
  playbook,
  templateSeed,
}: PlaybookDialogProps) {
  const labels = usePlaybookLabels();
  const { direction, locale } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const [values, setValues] = useState<PlaybookFormValues>(() =>
    playbookDefaults(playbook),
  );
  const isEditing = playbook != null;

  // §13/§22.4 — playbook approve/reject is an approval-policy decision; gate on
  // the granular lex:approval:admin verb (replaces the coarse approval-write/
  // lex:write fallbacks). A super-admin `lex:*` wildcard still satisfies it.
  const canDecide = hasPermission('lex:approval:admin');

  // Dry-run "Test against a contract" local state.
  const [testContractId, setTestContractId] = useState('');

  useEffect(() => {
    if (open) {
      // CREATE + templateSeed → prefill from the template; otherwise the usual
      // edit (playbook) / blank-create defaults.
      if (!playbook && templateSeed) {
        setValues(playbookDefaultsFromTemplate(templateSeed));
      } else {
        setValues(playbookDefaults(playbook));
      }
      setTestContractId('');
    }
  }, [open, playbook, templateSeed]);

  const createMutation = useMutation({
    mutationFn: (payload: LexCreatePlaybookPayload) =>
      enterpriseApi.lex.createPlaybook(payload),
    onSuccess: async () => {
      showSuccess(labels.toast.created);
      await onSaved();
      setValues(playbookDefaults());
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: LexCreatePlaybookPayload) => {
      if (!playbook) {
        throw new Error('Missing clause playbook.');
      }
      return enterpriseApi.lex.updatePlaybook(playbook.id, payload);
    },
    onSuccess: async () => {
      showSuccess(labels.toast.updated);
      await onSaved();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  // WTQ-RSK-02 #9 — approval workflow. Only relevant when editing a DRAFT.
  const isDraftEdit = isEditing && playbook?.status === 'draft';

  const approvalQuery = useQuery({
    queryKey: ['lex-playbook-approval', playbook?.id],
    queryFn: () => enterpriseApi.lex.listPlaybookApprovalTasks(playbook!.id),
    enabled: open && isDraftEdit && Boolean(playbook?.id),
  });
  const approvalTasks = approvalQuery.data ?? [];
  const openApprovalTasks = approvalTasks.filter(isOpenApprovalTask);
  const approvalInFlight = openApprovalTasks.length > 0;

  const startApprovalMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.startPlaybookApproval(playbook!.id),
    onSuccess: async () => {
      showSuccess(labels.toast.approvalStarted);
      await approvalQuery.refetch();
    },
    onError: showApiError,
  });

  const decideMutation = useMutation({
    mutationFn: ({
      task,
      decision,
    }: {
      task: HumanTask;
      decision: 'approve' | 'reject';
    }) =>
      enterpriseApi.lex.decidePlaybookApproval(
        playbook!.id,
        task.instance_id,
        task.id,
        { decision },
      ),
    onSuccess: async () => {
      showSuccess(labels.toast.approvalDecided);
      await approvalQuery.refetch();
      // Backend flips draft→active on approve; refresh the catalog so the new
      // status is reflected.
      await onSaved();
    },
    onError: showApiError,
  });

  // WTQ-RSK-02 #8 — dry-run. Test the CURRENT unsaved edits against a real
  // contract by sending the in-memory clauses (never persisted).
  const dryRunMutation = useMutation({
    mutationFn: () =>
      enterpriseApi.lex.dryRunPlaybook({
        contract_id: testContractId,
        clauses: buildPlaybookClauses(values.clauses),
        contract_type: values.contract_type,
      }),
    onError: showApiError,
  });

  const contractsQuery = useQuery({
    queryKey: ['lex-playbook-dryrun-contracts'],
    queryFn: () =>
      enterpriseApi.lex.listContracts({ page: 1, per_page: 50 }),
    enabled: open,
  });
  const contracts = contractsQuery.data?.data ?? [];

  const updateValue = <K extends keyof PlaybookFormValues>(
    key: K,
    value: PlaybookFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const updateClause = <K extends keyof PlaybookClauseDraft>(
    index: number,
    key: K,
    value: PlaybookClauseDraft[K],
  ) => {
    setValues((current) => ({
      ...current,
      clauses: current.clauses.map((clause, itemIndex) =>
        itemIndex === index ? { ...clause, [key]: value } : clause,
      ),
    }));
  };

  const validationErrors = useMemo(
    () => validatePlaybookForm(values, labels.dialog.errors),
    [labels, values],
  );
  const canSubmit = validationErrors.length === 0;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  // Activation guard (UX guidance only — backend still allows direct active for
  // back-compat): when editing a draft that hasn't been approved yet, steer the
  // user to the approval flow by disabling the `active` status option.
  const blockDirectActivation = isDraftEdit;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const payload = buildPlaybookPayload(values);
    if (isEditing) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const dryRunReport = dryRunMutation.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-4xl overflow-y-auto"
        dir={direction}
        lang={locale}
      >
        <DialogHeader>
          <DialogTitle>
            {isEditing ? labels.dialog.editTitle : labels.dialog.createTitle}
          </DialogTitle>
          <DialogDescription>{labels.dialog.description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-6" onSubmit={submit}>
          {!isEditing ? <LexCreationGuidance workflow="playbook" /> : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="playbook-name">{labels.dialog.nameLabel}</Label>
              <Input
                id="playbook-name"
                value={values.name}
                onChange={(event) => updateValue('name', event.target.value)}
                placeholder={labels.dialog.namePlaceholder}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="playbook-description">
                {labels.dialog.descriptionLabel}
              </Label>
              <Textarea
                id="playbook-description"
                value={values.description}
                onChange={(event) =>
                  updateValue('description', event.target.value)
                }
                rows={2}
                placeholder={labels.dialog.descriptionPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="playbook-contract-type">
                {labels.dialog.contractTypeLabel}
              </Label>
              <Select
                value={values.contract_type}
                onValueChange={(value) =>
                  updateValue('contract_type', value as LexContractType)
                }
              >
                <SelectTrigger id="playbook-contract-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {labels.contractTypeLabels[type] ?? formatToken(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="playbook-status">
                {labels.dialog.statusLabel}
              </Label>
              <Select
                value={values.status}
                onValueChange={(value) =>
                  updateValue('status', value as LexPlaybookStatus)
                }
              >
                <SelectTrigger id="playbook-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAYBOOK_STATUSES.map((status) => (
                    <SelectItem
                      key={status}
                      value={status}
                      disabled={
                        status === 'active' && blockDirectActivation
                      }
                    >
                      {labels.statusLabels[status] ?? formatToken(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {blockDirectActivation ? (
                <p className="text-xs text-muted-foreground">
                  {labels.dialog.approvalRequired}
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">
                  {labels.dialog.clausesTitle}
                </p>
                <p className="text-xs text-muted-foreground">
                  {labels.dialog.clausesDescription}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateValue('clauses', [...values.clauses, emptyClause()])
                }
              >
                <Plus className="me-1 h-3.5 w-3.5" />
                {labels.dialog.addClause}
              </Button>
            </div>
            <div className="mt-4 space-y-4">
              {values.clauses.map((clause, index) => (
                <div
                  key={index}
                  className="space-y-3 rounded-lg border bg-muted/20 p-3"
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr_auto]">
                    <div className="space-y-1.5">
                      <Label
                        className="text-xs"
                        htmlFor={`clause-type-${index}`}
                      >
                        {labels.dialog.clauseTypeLabel}
                      </Label>
                      <Select
                        value={clause.clause_type}
                        onValueChange={(value) =>
                          updateClause(
                            index,
                            'clause_type',
                            value as LexClauseType,
                          )
                        }
                      >
                        <SelectTrigger id={`clause-type-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CLAUSE_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {labels.clauseTypeLabels[type] ?? formatToken(type)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        className="text-xs"
                        htmlFor={`clause-title-${index}`}
                      >
                        {labels.dialog.clauseTitleLabel}
                      </Label>
                      <Input
                        id={`clause-title-${index}`}
                        value={clause.title}
                        onChange={(event) =>
                          updateClause(index, 'title', event.target.value)
                        }
                        placeholder={labels.dialog.clauseTitlePlaceholder}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          updateValue(
                            'clauses',
                            values.clauses.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                        disabled={values.clauses.length === 1}
                        aria-label={labels.dialog.removeClause}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      className="text-xs"
                      htmlFor={`clause-text-${index}`}
                    >
                      {labels.dialog.standardTextLabel}
                    </Label>
                    <Textarea
                      id={`clause-text-${index}`}
                      value={clause.standard_text}
                      onChange={(event) =>
                        updateClause(
                          index,
                          'standard_text',
                          event.target.value,
                        )
                      }
                      rows={3}
                      placeholder={labels.dialog.standardTextPlaceholder}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label
                        className="text-xs"
                        htmlFor={`clause-risk-${index}`}
                      >
                        {labels.dialog.riskWeightLabel}
                      </Label>
                      <Input
                        id={`clause-risk-${index}`}
                        type="number"
                        min={0}
                        step={0.5}
                        value={clause.risk_weight}
                        onChange={(event) =>
                          updateClause(
                            index,
                            'risk_weight',
                            event.target.value,
                          )
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        className="text-xs"
                        htmlFor={`clause-threshold-${index}`}
                      >
                        {labels.dialog.similarityThresholdLabel}
                      </Label>
                      <Input
                        id={`clause-threshold-${index}`}
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={clause.similarity_threshold}
                        onChange={(event) =>
                          updateClause(
                            index,
                            'similarity_threshold',
                            event.target.value,
                          )
                        }
                      />
                    </div>
                    <label className="flex items-end gap-2 pb-1 text-sm">
                      <Switch
                        checked={clause.required}
                        onCheckedChange={(checked) =>
                          updateClause(index, 'required', checked)
                        }
                        aria-label={`${labels.dialog.requiredLabel} ${index + 1}`}
                      />
                      {labels.dialog.requiredLabel}
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* WTQ-RSK-02 #8 — dry-run the current (unsaved) edits against a real
              contract. */}
          <div className="rounded-lg border px-4 py-4">
            <div>
              <p className="text-sm font-medium">
                {labels.dialog.testAgainstContract}
              </p>
              <p className="text-xs text-muted-foreground">
                {labels.dialog.testHint}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="playbook-test-contract">
                  {labels.dialog.selectContract}
                </Label>
                <Select
                  value={testContractId}
                  onValueChange={setTestContractId}
                  disabled={
                    contractsQuery.isLoading || contracts.length === 0
                  }
                >
                  <SelectTrigger id="playbook-test-contract">
                    <SelectValue placeholder={labels.dialog.selectContract} />
                  </SelectTrigger>
                  <SelectContent>
                    {contracts.map((contract) => (
                      <SelectItem key={contract.id} value={contract.id}>
                        {contract.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => dryRunMutation.mutate()}
                disabled={testContractId === '' || dryRunMutation.isPending}
              >
                {dryRunMutation.isPending ? (
                  <>
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                    {labels.dialog.testing}
                  </>
                ) : (
                  labels.dialog.runTest
                )}
              </Button>
            </div>

            {dryRunReport ? (
              <div className="mt-4 space-y-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {labels.dialog.testScore}
                  </span>
                  <span
                    className={`text-lg font-semibold ${SCORE_TONE_CLASS[complianceTone(dryRunReport.compliance_score)]}`}
                  >
                    {clampPercent(dryRunReport.compliance_score)}%
                  </span>
                </div>
                <Progress
                  value={clampPercent(dryRunReport.compliance_score)}
                  aria-label={labels.dialog.testScore}
                />
                <div className="flex flex-wrap gap-2">
                  <Badge variant="destructive">
                    {labels.deviations.missing}: {dryRunReport.missing_count}
                  </Badge>
                  <Badge variant="warning">
                    {labels.deviations.altered}: {dryRunReport.altered_count}
                  </Badge>
                  <Badge variant="secondary">
                    {labels.deviations.extra}: {dryRunReport.extra_count}
                  </Badge>
                </div>
              </div>
            ) : null}
          </div>

          {/* WTQ-RSK-02 #9 — approval workflow (edit-draft only). */}
          {isDraftEdit ? (
            <div className="rounded-lg border px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    {labels.dialog.approvalTasks}
                  </p>
                  {approvalInFlight ? (
                    <Badge variant="warning">
                      {labels.dialog.approvalPending}
                    </Badge>
                  ) : null}
                </div>
                {!approvalInFlight ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => startApprovalMutation.mutate()}
                    disabled={startApprovalMutation.isPending}
                  >
                    {startApprovalMutation.isPending ? (
                      <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                    ) : null}
                    {labels.dialog.submitForApproval}
                  </Button>
                ) : null}
              </div>

              {approvalInFlight ? (
                <div className="mt-4 space-y-3">
                  {openApprovalTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">
                          {task.name || task.id}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {task.assignee_role ?? ''}
                          {task.status ? ` • ${task.status}` : ''}
                        </p>
                      </div>
                      {canDecide ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              decideMutation.mutate({
                                task,
                                decision: 'approve',
                              })
                            }
                            disabled={decideMutation.isPending}
                          >
                            {labels.dialog.approve}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              decideMutation.mutate({
                                task,
                                decision: 'reject',
                              })
                            }
                            disabled={decideMutation.isPending}
                          >
                            {labels.dialog.reject}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  {labels.dialog.approvalRequired}
                </p>
              )}
            </div>
          ) : null}

          {validationErrors.length > 0 ? (
            <div
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <p className="font-medium">{labels.dialog.validationTitle}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {validationErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {labels.dialog.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit || isSaving}>
              {isSaving ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
              ) : null}
              {isEditing
                ? labels.dialog.submitEdit
                : labels.dialog.submitCreate}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
