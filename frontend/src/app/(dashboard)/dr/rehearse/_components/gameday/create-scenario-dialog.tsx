'use client';

import { useEffect, useId, useMemo, type ReactNode } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DRCreateGameDayScenarioRequest } from '@/types/clario-dr';
import { useGameDayLabels, type GameDayLabels } from './gameday-labels';

/**
 * A protection group the scenario can be scoped to (id + display name), derived
 * by the caller from the live posture rollup. Only real fields are consumed.
 */
export interface ScenarioGroupOption {
  id: string;
  name: string;
}

/**
 * Zod schema mirroring the real {@link DRCreateGameDayScenarioRequest}:
 * `group_id` + `name` + `scope` + a non-empty `steps[]`, each step requiring
 * `action` / `target` / `expect.signal` (the detect/recover windows are
 * optional Go-duration strings the backend treats as such).
 */
function buildScenarioSchema(L: GameDayLabels) {
  return z.object({
    name: z.string().trim().min(1, L.nameError),
    description: z.string().trim().optional(),
    group_id: z.string().trim().min(1, L.groupError),
    scope: z.string().trim().min(1, L.scopeError),
    steps: z
      .array(
        z.object({
          action: z.string().trim().min(1, L.actionError),
          target: z.string().trim().min(1, L.targetError),
          signal: z.string().trim().min(1, L.expectSignalError),
          detect_within: z.string().trim().optional(),
          recover_within: z.string().trim().optional(),
        }),
      )
      .min(1, L.stepsError),
  });
}

type ScenarioFormValues = z.infer<ReturnType<typeof buildScenarioSchema>>;

const EMPTY_STEP: ScenarioFormValues['steps'][number] = {
  action: '',
  target: '',
  signal: '',
  detect_within: '',
  recover_within: '',
};

export interface CreateScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Protection groups the scenario can be scoped to. */
  groups: ScenarioGroupOption[];
  /** Pre-selected group id (the console's active group), if any. */
  defaultGroupId?: string | null;
  /** Wired to `useGameDayActions().createScenario`. */
  onCreate: (payload: DRCreateGameDayScenarioRequest) => void;
  submitting: boolean;
}

/**
 * Create-game-day-scenario dialog. Authors a controlled fault-injection scenario
 * — name, protection group, scope, and an ordered list of fault steps each with
 * an expected signal and optional detect / recover windows — then builds a real
 * {@link DRCreateGameDayScenarioRequest} and hands it to `onCreate`.
 *
 * `react-hook-form` + `zod`; the step list is a `useFieldArray` so operators add
 * and remove steps. Gated upstream by `dr:write` (the page wraps the trigger in
 * the shared write gate). Bilingual + RTL-safe via logical spacing; copy comes
 * from {@link useGameDayLabels}.
 */
export function CreateScenarioDialog({
  open,
  onOpenChange,
  groups,
  defaultGroupId,
  onCreate,
  submitting,
}: CreateScenarioDialogProps) {
  const labels = useGameDayLabels();
  const schema = useMemo(() => buildScenarioSchema(labels), [labels]);

  const initialGroupId =
    defaultGroupId && groups.some((group) => group.id === defaultGroupId)
      ? defaultGroupId
      : (groups[0]?.id ?? '');

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ScenarioFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      description: '',
      group_id: initialGroupId,
      scope: 'group',
      steps: [{ ...EMPTY_STEP }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'steps' });

  useEffect(() => {
    if (open) {
      reset({
        name: '',
        description: '',
        group_id: initialGroupId,
        scope: 'group',
        steps: [{ ...EMPTY_STEP }],
      });
    }
    // `initialGroupId` is derived from props; resetting on open keeps the seeded
    // group current without re-running on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  const submit = handleSubmit((values) => {
    const payload: DRCreateGameDayScenarioRequest = {
      group_id: values.group_id.trim(),
      name: values.name.trim(),
      scope: values.scope.trim(),
      steps: values.steps.map((step) => ({
        action: step.action.trim(),
        target: step.target.trim(),
        expect: {
          signal: step.signal.trim(),
          ...(step.detect_within?.trim() ? { detect_within: step.detect_within.trim() } : {}),
          ...(step.recover_within?.trim()
            ? { recover_within: step.recover_within.trim() }
            : {}),
        },
      })),
    };
    const description = values.description?.trim();
    if (description) {
      payload.description = description;
    }
    onCreate(payload);
  });

  const scopeKeys = Object.keys(labels.scope);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>{labels.createDialogTitle}</DialogTitle>
            <DialogDescription>{labels.createDialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field label={labels.nameLabel} required hint={labels.requiredFieldHint} error={errors.name?.message}>
              {(props) => (
                <Input {...props} {...register('name')} placeholder={labels.namePlaceholder} autoComplete="off" />
              )}
            </Field>

            <Field label={labels.scenarioDescriptionLabel} error={errors.description?.message}>
              {(props) => (
                <Textarea
                  {...props}
                  {...register('description')}
                  placeholder={labels.scenarioDescriptionPlaceholder}
                  rows={2}
                />
              )}
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={labels.groupLabel}
                required
                hint={labels.requiredFieldHint}
                error={errors.group_id?.message}
              >
                {(props) => (
                  <Controller
                    control={control}
                    name="group_id"
                    render={({ field }) => (
                      <Select
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                        disabled={groups.length === 0}
                      >
                        <SelectTrigger
                          id={props.id}
                          aria-invalid={props['aria-invalid']}
                          aria-describedby={props['aria-describedby']}
                        >
                          <SelectValue
                            placeholder={groups.length === 0 ? labels.noGroups : labels.groupPlaceholder}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {groups.map((group) => (
                            <SelectItem key={group.id} value={group.id}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>

              <Field label={labels.scopeLabel} required hint={labels.requiredFieldHint} error={errors.scope?.message}>
                {(props) => (
                  <Controller
                    control={control}
                    name="scope"
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={field.onChange}>
                        <SelectTrigger
                          id={props.id}
                          aria-invalid={props['aria-invalid']}
                          aria-describedby={props['aria-describedby']}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {scopeKeys.map((key) => (
                            <SelectItem key={key} value={key}>
                              {labels.scope[key]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
              </Field>
            </div>

            <fieldset className="space-y-3 border-0 p-0">
              <div className="flex items-center justify-between gap-3">
                <legend className="text-sm font-semibold">{labels.stepsHeading}</legend>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => append({ ...EMPTY_STEP })}
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {labels.addStepLabel}
                </Button>
              </div>

              {errors.steps?.root?.message ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {errors.steps.root.message}
                </p>
              ) : null}

              {fields.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  {labels.noSteps}
                </p>
              ) : (
                <ol className="space-y-3">
                  {fields.map((stepField, index) => (
                    <li key={stepField.id} className="space-y-3 rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold uppercase text-muted-foreground">
                          {labels.stepNumber(index + 1)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(index)}
                          disabled={fields.length === 1}
                          aria-label={labels.removeStepLabel}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field
                          label={labels.actionLabel}
                          required
                          hint={labels.requiredFieldHint}
                          error={errors.steps?.[index]?.action?.message}
                        >
                          {(props) => (
                            <Input
                              {...props}
                              {...register(`steps.${index}.action` as const)}
                              placeholder={labels.actionPlaceholder}
                              autoComplete="off"
                            />
                          )}
                        </Field>

                        <Field
                          label={labels.targetLabel}
                          required
                          hint={labels.requiredFieldHint}
                          error={errors.steps?.[index]?.target?.message}
                        >
                          {(props) => (
                            <Input
                              {...props}
                              {...register(`steps.${index}.target` as const)}
                              placeholder={labels.targetPlaceholder}
                              autoComplete="off"
                            />
                          )}
                        </Field>
                      </div>

                      <Field
                        label={labels.expectSignalLabel}
                        required
                        hint={labels.requiredFieldHint}
                        error={errors.steps?.[index]?.signal?.message}
                      >
                        {(props) => (
                          <Input
                            {...props}
                            {...register(`steps.${index}.signal` as const)}
                            placeholder={labels.expectSignalPlaceholder}
                            autoComplete="off"
                          />
                        )}
                      </Field>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label={labels.detectWithinLabel} help={labels.durationHelp}>
                          {(props) => (
                            <Input
                              {...props}
                              {...register(`steps.${index}.detect_within` as const)}
                              placeholder={labels.detectWithinPlaceholder}
                              autoComplete="off"
                              dir="ltr"
                            />
                          )}
                        </Field>

                        <Field label={labels.recoverWithinLabel} help={labels.durationHelp}>
                          {(props) => (
                            <Input
                              {...props}
                              {...register(`steps.${index}.recover_within` as const)}
                              placeholder={labels.recoverWithinPlaceholder}
                              autoComplete="off"
                              dir="ltr"
                            />
                          )}
                        </Field>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </fieldset>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={submitting || groups.length === 0}>
              {submitting ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                  {labels.loading}
                </>
              ) : (
                labels.submit
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A labelled field with an accessible inline error / help region, mirroring the
 * provisioning `ProvisionField` contract (stable id, `aria-describedby`,
 * `role="alert"` error) so the form is WCAG 2.1 AA. Local to the game-day
 * feature so it can sit inside the field-array rows.
 */
function Field({
  label,
  required,
  hint,
  error,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  help?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy =
    [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="ms-1 text-destructive" aria-hidden>
            *
          </span>
        ) : null}
        {required && hint ? <span className="sr-only"> {hint}</span> : null}
      </Label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {help ? (
        <p id={helpId} className="text-xs leading-5 text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
