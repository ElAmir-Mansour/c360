'use client';

/**
 * Requested-due-date + additional-notes fields for step 2 of the new request
 * wizard. Both persist on the request's `metadata` JSONB (`requested_due_date`,
 * `notes`) — the only real persistence channel the create endpoint exposes for
 * these.
 *
 * The mockup lays the due date beside the Priority control and the notes on its
 * own full-width row, so the two fields are exported SEPARATELY
 * (`RequestedDueDateField`, `AdditionalNotesField`). A combined block remains the
 * default export for any legacy consumer.
 */

import { CalendarDays } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useDetailsStrings } from '../_lib/details-i18n';

export interface RequestedDueDateFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

/** Required requested due date — native date input with a leading calendar icon. */
export function RequestedDueDateField({
  value,
  onChange,
  error,
  disabled,
}: RequestedDueDateFieldProps) {
  const t = useDetailsStrings();
  const helperId = 'request-due-date-helper';
  const errorId = 'request-due-date-error';
  return (
    <div className="space-y-1.5">
      <Label htmlFor="request-due-date">
        {t.dueDateLabel}
        <span className="ms-1 text-destructive" aria-label={t.dueDateRequired}>
          *
        </span>
      </Label>
      <div className="relative">
        <CalendarDays
          className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          id="request-due-date"
          // Emergency intake promises a turnaround "within 24 hours", which a
          // date-only field cannot express — the hour is part of the ask.
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${helperId} ${errorId}` : helperId}
          className={cn('ps-9', error && 'border-destructive focus-visible:ring-destructive')}
        />
      </div>
      <p id={helperId} className="text-caption text-muted-foreground">
        {t.dueDateHint}
      </p>
      {error ? (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface AdditionalNotesFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Additional notes / instructions (optional) — free-text, persisted to metadata. */
export function AdditionalNotesField({ value, onChange, disabled }: AdditionalNotesFieldProps) {
  const t = useDetailsStrings();
  return (
    <div className="space-y-1.5">
      <Label htmlFor="request-notes">{t.notesLabel}</Label>
      <Textarea
        id="request-notes"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t.notesPlaceholder}
        disabled={disabled}
      />
    </div>
  );
}

export interface ExtraDetailsFieldsProps {
  dueDate: string;
  onDueDateChange: (value: string) => void;
  dueDateError?: string;
  notes: string;
  onNotesChange: (value: string) => void;
  disabled?: boolean;
}

/** Combined block (due date over notes) — retained for backward compatibility. */
export default function ExtraDetailsFields({
  dueDate,
  onDueDateChange,
  dueDateError,
  notes,
  onNotesChange,
  disabled,
}: ExtraDetailsFieldsProps) {
  return (
    <div className="space-y-5">
      <RequestedDueDateField
        value={dueDate}
        onChange={onDueDateChange}
        error={dueDateError}
        disabled={disabled}
      />
      <AdditionalNotesField value={notes} onChange={onNotesChange} disabled={disabled} />
    </div>
  );
}
