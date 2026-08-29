'use client';

/**
 * Create-deadline dialog (features #10/#11 of the case-timeline panel split).
 *
 * Pure presentational form: collects a deadline `kind` (Hearing / Objection /
 * generic), an optional title (the backend derives one from the kind when left
 * blank), and a REQUIRED date which is converted to an RFC3339 ISO string on
 * submit. The owning {@link DeadlinesCard} holds the create mutation; this
 * dialog just validates and emits a {@link CreateDeadlinePayload} via `onSubmit`.
 *
 * Bilingual + RTL via {@link useSettlementLabels} and logical (`me-`) spacing.
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { useSettlementLabels } from './labels';
import type { CreateDeadlinePayload } from '@/lib/lex/settlements';

/** Selectable deadline kinds. `deadline` is the neutral/generic default. */
const DEADLINE_KINDS = ['deadline', 'hearing', 'objection'] as const;
type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export interface DeadlineCreateDialogProps {
  open: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateDeadlinePayload) => void;
}

export function DeadlineCreateDialog({
  open,
  loading,
  onOpenChange,
  onSubmit,
}: DeadlineCreateDialogProps) {
  const L = useSettlementLabels();
  const labels = L.timeline.deadlines;

  const [kind, setKind] = useState<DeadlineKind>('hearing');
  const [title, setTitle] = useState('');
  // Local datetime-local string ("YYYY-MM-DDTHH:mm"); converted to ISO on submit.
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKind('hearing');
      setTitle('');
      setDueDate('');
      setError(null);
    }
  }, [open]);

  // Generic kind has no dedicated label key; fall back to the section "add"
  // wording (neutral "deadline") so we never invent an untranslated string.
  const kindLabel = (k: DeadlineKind): string => {
    switch (k) {
      case 'hearing':
        return labels.typeHearing;
      case 'objection':
        return labels.typeObjection;
      default:
        return labels.add;
    }
  };

  const handleSubmit = () => {
    if (!dueDate) {
      setError(labels.fieldDate);
      return;
    }
    const parsed = new Date(dueDate);
    if (Number.isNaN(parsed.getTime())) {
      setError(labels.fieldDate);
      return;
    }
    const trimmedTitle = title.trim();
    onSubmit({
      kind,
      title: trimmedTitle ? trimmedTitle : undefined,
      due_date: parsed.toISOString(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.dialogTitle}</DialogTitle>
          <DialogDescription>{labels.upcomingTitle}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <LexCreationGuidance workflow="settlement" />
          <div className="space-y-2">
            <Label htmlFor="deadline-kind">{labels.fieldType}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as DeadlineKind)}>
              <SelectTrigger id="deadline-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEADLINE_KINDS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {kindLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="deadline-title">{labels.fieldTitle}</Label>
            <Input
              id="deadline-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deadline-date">{labels.fieldDate}</Label>
            <Input
              id="deadline-date"
              type="datetime-local"
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
                if (error) setError(null);
              }}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {L.timeline.delayDialog.cancel}
          </Button>
          <Button type="button" disabled={loading} onClick={handleSubmit}>
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {labels.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
