'use client';

import { useEffect, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import type { SavedViewScope } from '@/lib/lex/saved-views';
import type { ReportBuilderLabels } from '../_lib/report-builder-labels';

interface SaveReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: ReportBuilderLabels;
  initialName: string;
  initialDescription: string;
  initialScope: SavedViewScope;
  pending: boolean;
  onSave: (values: {
    name: string;
    description: string;
    scope: SavedViewScope;
  }) => Promise<void>;
}

export function SaveReportDialog({
  open,
  onOpenChange,
  labels,
  initialName,
  initialDescription,
  initialScope,
  pending,
  onSave,
}: SaveReportDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [scope, setScope] = useState<SavedViewScope>(initialScope);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setScope(initialScope);
    setNameError('');
  }, [initialDescription, initialName, initialScope, open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(labels.validationName);
      return;
    }
    await onSave({ name: trimmed, description: description.trim(), scope });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.saveTitle}</DialogTitle>
          <DialogDescription>{labels.saveDescription}</DialogDescription>
        </DialogHeader>

        <LexCreationGuidance workflow="report" />

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="report-builder-save-name">{labels.reportName}</Label>
            <Input
              id="report-builder-save-name"
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
                if (event.target.value.trim()) setNameError('');
              }}
              placeholder={labels.reportNamePlaceholder}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'report-builder-save-name-error' : undefined}
              autoFocus
            />
            {nameError ? (
              <p id="report-builder-save-name-error" className="text-xs text-destructive">
                {nameError}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-builder-save-description">
              {labels.descriptionLabel}
            </Label>
            <Textarea
              id="report-builder-save-description"
              value={description}
              maxLength={500}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={labels.descriptionPlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-builder-save-scope">{labels.scope}</Label>
            <Select
              value={scope}
              onValueChange={(value) => setScope(value as SavedViewScope)}
            >
              <SelectTrigger id="report-builder-save-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="personal">{labels.personal}</SelectItem>
                <SelectItem value="team">{labels.team}</SelectItem>
                <SelectItem value="org">{labels.organization}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {labels.cancel}
          </Button>
          <Button onClick={() => void submit()} disabled={pending}>
            {pending ? labels.saving : labels.confirmSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
