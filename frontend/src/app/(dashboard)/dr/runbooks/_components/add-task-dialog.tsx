'use client';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RUNBOOK_TASK_TYPES, type RunbookTaskType } from '@/components/product';
import type { DRRunbookAddTaskRequest, DRRunbookTask } from '@/types/clario-dr';
import { ProvisionField } from '../../_components/provision/provision-field';
import { useRunbookStudioLabels } from '../../_components/runbook-studio/runbook-studio-labels';
import { RunbookDialogShell } from './runbook-dialog-shell';

/**
 * Zod schema for the add-runbook-task form. Mirrors the real
 * {@link DRRunbookAddTaskRequest}: `task_key` + `name` required; `task_type`
 * constrained to the real backend enum; `owner`/`team`/`instructions`/
 * `automation_action` optional; `planned_duration_seconds` a non-negative integer
 * count of seconds; `predecessors` a list of existing task ids. Validation copy is
 * injected from the bilingual studio bundle.
 */
function buildSchema(messages: { keyError: string; nameError: string; durationError: string }) {
  return z.object({
    task_key: z.string().trim().min(1, messages.keyError),
    name: z.string().trim().min(1, messages.nameError),
    task_type: z.enum(RUNBOOK_TASK_TYPES),
    required: z.boolean(),
    owner: z.string().trim().optional(),
    team: z.string().trim().optional(),
    instructions: z.string().trim().optional(),
    automation_action: z.string().trim().optional(),
    planned_duration_seconds: z.coerce
      .number({ invalid_type_error: messages.durationError })
      .int(messages.durationError)
      .min(0, messages.durationError),
    predecessors: z.array(z.string()),
  });
}

type TaskFormValues = z.infer<ReturnType<typeof buildSchema>>;

export interface AddTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing authored tasks — the selectable predecessor set (real `task_key`s). */
  existingTasks: DRRunbookTask[];
  /** Wired to `useRunbookStudioActions().addTask(runbookId, payload)`. */
  onAddTask: (payload: DRRunbookAddTaskRequest) => void;
  submitting: boolean;
}

export function AddTaskDialog({
  open,
  onOpenChange,
  existingTasks,
  onAddTask,
  submitting,
}: AddTaskDialogProps) {
  const labels = useRunbookStudioLabels();

  const schema = useMemo(
    () =>
      buildSchema({
        keyError: labels.taskKeyLabel,
        nameError: labels.taskNameLabel,
        durationError: labels.plannedDurationLabel,
      }),
    [labels.taskKeyLabel, labels.taskNameLabel, labels.plannedDurationLabel],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      task_key: '',
      name: '',
      task_type: 'manual',
      required: true,
      owner: '',
      team: '',
      instructions: '',
      automation_action: '',
      planned_duration_seconds: 300,
      predecessors: [],
    },
  });

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const submit = handleSubmit((values) => {
    const owner = values.owner?.trim();
    const team = values.team?.trim();
    const instructions = values.instructions?.trim();
    const automationAction = values.automation_action?.trim();
    onAddTask({
      task_key: values.task_key.trim(),
      name: values.name.trim(),
      task_type: values.task_type,
      required: values.required,
      planned_duration_seconds: values.planned_duration_seconds,
      predecessors: values.predecessors,
      ...(owner ? { owner } : {}),
      ...(team ? { team } : {}),
      ...(instructions ? { instructions } : {}),
      ...(automationAction ? { automation_action: automationAction } : {}),
    });
  });

  return (
    <RunbookDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={labels.addTaskDialogTitle}
      description={labels.addTaskDialogDescription}
      onSubmit={submit}
      submitting={submitting}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <ProvisionField label={labels.taskKeyLabel} required error={errors.task_key?.message}>
          {(props) => (
            <Input
              {...props}
              {...register('task_key')}
              placeholder={labels.taskKeyPlaceholder}
              autoComplete="off"
            />
          )}
        </ProvisionField>

        <ProvisionField label={labels.taskNameLabel} required error={errors.name?.message}>
          {(props) => (
            <Input
              {...props}
              {...register('name')}
              placeholder={labels.taskNamePlaceholder}
              autoComplete="off"
            />
          )}
        </ProvisionField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ProvisionField label={labels.taskTypeLabel} error={errors.task_type?.message}>
          {(props) => (
            <Controller
              control={control}
              name="task_type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id={props.id}
                    aria-invalid={props['aria-invalid']}
                    aria-describedby={props['aria-describedby']}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RUNBOOK_TASK_TYPES.map((type: RunbookTaskType) => (
                      <SelectItem key={type} value={type}>
                        {labels.taskFlow.taskTypes[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </ProvisionField>

        <ProvisionField
          label={labels.plannedDurationLabel}
          error={errors.planned_duration_seconds?.message}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              {...register('planned_duration_seconds')}
            />
          )}
        </ProvisionField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ProvisionField label={labels.ownerLabel}>
          {(props) => <Input {...props} {...register('owner')} autoComplete="off" />}
        </ProvisionField>

        <ProvisionField label={labels.teamLabel}>
          {(props) => <Input {...props} {...register('team')} autoComplete="off" />}
        </ProvisionField>
      </div>

      <ProvisionField label={labels.instructionsLabel}>
        {(props) => <Textarea {...props} {...register('instructions')} rows={2} />}
      </ProvisionField>

      <ProvisionField label={labels.automationActionLabel}>
        {(props) => <Input {...props} {...register('automation_action')} autoComplete="off" />}
      </ProvisionField>

      <Controller
        control={control}
        name="predecessors"
        render={({ field }) => (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">
              {labels.predecessorsLabel}
            </legend>
            <p className="text-xs leading-5 text-muted-foreground">
              {labels.predecessorsHint}
            </p>
            {existingTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {labels.taskFlow.noDependencies}
              </p>
            ) : (
              <ul className="space-y-2">
                {existingTasks.map((task) => {
                  const checked = field.value.includes(task.id);
                  const inputId = `predecessor-${task.id}`;
                  return (
                    <li key={task.id} className="flex items-center gap-2">
                      <Checkbox
                        id={inputId}
                        checked={checked}
                        onCheckedChange={(next) => {
                          const isChecked = next === true;
                          field.onChange(
                            isChecked
                              ? [...field.value, task.id]
                              : field.value.filter((id) => id !== task.id),
                          );
                        }}
                      />
                      <Label htmlFor={inputId} className="font-normal">
                        <span className="font-medium">{task.name}</span>
                        <span className="ms-2 font-mono text-xs text-muted-foreground" dir="ltr">
                          {task.task_key}
                        </span>
                      </Label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        )}
      />

      <label className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Controller
          control={control}
          name="required"
          render={({ field }) => (
            <Checkbox
              checked={field.value}
              onCheckedChange={(next) => field.onChange(next === true)}
            />
          )}
        />
        {labels.requiredLabel}
      </label>
    </RunbookDialogShell>
  );
}
