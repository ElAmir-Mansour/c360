'use client';

import { useEffect, useState } from 'react';
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
import type { LexDocumentConfidentiality } from '@/types/suites';
import type { DocumentsLabels } from '../_lib/documents-labels';

const CONFIDENTIALITY_LEVELS: LexDocumentConfidentiality[] = [
  'public',
  'internal',
  'confidential',
  'privileged',
];

/**
 * BulkConfidentialityDialog lets the operator pick a single confidentiality
 * level to apply to all currently-selected documents. The page owns the actual
 * per-id fan-out; this component only collects the chosen value.
 */
export function BulkConfidentialityDialog({
  open,
  onOpenChange,
  onApply,
  labels,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (value: LexDocumentConfidentiality) => void;
  labels: DocumentsLabels;
  pending: boolean;
}) {
  const t = labels.bulkActions;
  const [value, setValue] = useState<LexDocumentConfidentiality>('internal');

  useEffect(() => {
    if (open) setValue('internal');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.changeConfidentialityTitle}</DialogTitle>
          <DialogDescription>{t.changeConfidentialityDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-confidentiality">{t.changeConfidentialityField}</Label>
          <Select value={value} onValueChange={(next) => setValue(next as LexDocumentConfidentiality)}>
            <SelectTrigger id="bulk-confidentiality">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONFIDENTIALITY_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {labels.enums.confidentiality[level] ?? level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.cancel}
          </Button>
          <Button type="button" onClick={() => onApply(value)} disabled={pending}>
            {t.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * BulkAddTagsDialog collects a comma-separated list of tags to merge into all
 * currently-selected documents (existing tags preserved by the page).
 */
export function BulkAddTagsDialog({
  open,
  onOpenChange,
  onApply,
  labels,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (rawTags: string) => void;
  labels: DocumentsLabels;
  pending: boolean;
}) {
  const t = labels.bulkActions;
  const [rawTags, setRawTags] = useState('');

  useEffect(() => {
    if (open) setRawTags('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.addTagsTitle}</DialogTitle>
          <DialogDescription>{t.addTagsDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-add-tags">{t.addTagsField}</Label>
          <Input
            id="bulk-add-tags"
            value={rawTags}
            onChange={(event) => setRawTags(event.target.value)}
            placeholder={t.addTagsPlaceholder}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.cancel}
          </Button>
          <Button type="button" onClick={() => onApply(rawTags)} disabled={pending || !rawTags.trim()}>
            {t.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
