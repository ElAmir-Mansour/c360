'use client';

import { useEffect, useMemo } from 'react';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface DraftingQualityChecklistItem {
  id: string;
  label: string;
  required?: boolean;
  defaultChecked?: boolean;
}

export type DraftingQualityChecklistValue = Record<string, boolean>;

export interface DraftingQualityChecklistLabels {
  title: string;
  complete: string;
  incomplete: string;
  notes: string;
  notesPlaceholder: string;
}

export interface DraftingQualityChecklistProps {
  value: DraftingQualityChecklistValue;
  onChange: (value: DraftingQualityChecklistValue) => void;
  items?: DraftingQualityChecklistItem[];
  disabled?: boolean;
  className?: string;
  labels?: Partial<DraftingQualityChecklistLabels>;
  notes?: string;
  onNotesChange?: (notes: string) => void;
  showNotes?: boolean;
  requireAll?: boolean;
  onValidityChange?: (isValid: boolean, missingItems: DraftingQualityChecklistItem[]) => void;
}

export const DEFAULT_DRAFTING_QUALITY_CHECKLIST_ITEMS: DraftingQualityChecklistItem[] = [
  { id: 'source-reviewed', label: 'Source material is selected or pasted', required: true },
  { id: 'intent-clear', label: 'Drafting intent is specific and complete', required: true },
  { id: 'party-context', label: 'Parties, jurisdiction, and governing law are clear', required: true },
  { id: 'risk-position', label: 'Risk posture and negotiation position are set', required: true },
  { id: 'confidential-data', label: 'Sensitive data is minimized or approved for use', required: true },
  { id: 'human-review', label: 'Output will receive legal review before use', required: true },
];

const DEFAULT_LABELS: DraftingQualityChecklistLabels = {
  title: 'Quality checklist before generate',
  complete: 'Ready',
  incomplete: 'Needs review',
  notes: 'Review notes',
  notesPlaceholder: 'Add generation constraints or reviewer notes.',
};

export function DraftingQualityChecklist({
  value,
  onChange,
  items = DEFAULT_DRAFTING_QUALITY_CHECKLIST_ITEMS,
  disabled = false,
  className,
  labels,
  notes = '',
  onNotesChange,
  showNotes = false,
  requireAll = false,
  onValidityChange,
}: DraftingQualityChecklistProps) {
  const resolvedLabels = { ...DEFAULT_LABELS, ...labels };
  const missingItems = useMemo(
    () => getMissingQualityChecklistItems(items, value, requireAll),
    [items, requireAll, value],
  );
  const isValid = missingItems.length === 0;

  useEffect(() => {
    onValidityChange?.(isValid, missingItems);
  }, [isValid, missingItems, onValidityChange]);

  const handleCheckedChange = (itemId: string, checked: boolean) => {
    onChange({ ...value, [itemId]: checked });
  };

  return (
    <div className={cn('space-y-3 rounded-lg border bg-muted/20 p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Label className="text-sm font-medium">{resolvedLabels.title}</Label>
        </div>
        <Badge variant={isValid ? 'success' : 'warning'} className="tracking-normal normal-case">
          {isValid ? resolvedLabels.complete : resolvedLabels.incomplete}
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const checked = Boolean(value[item.id] ?? item.defaultChecked);
          return (
            <label
              key={item.id}
              className={cn(
                'flex min-h-[44px] items-start gap-2 rounded-md border bg-card/70 px-3 py-2 text-sm',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              )}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(next) => handleCheckedChange(item.id, next === true)}
                disabled={disabled}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1 leading-5">{item.label}</span>
              {checked ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              ) : null}
            </label>
          );
        })}
      </div>

      {showNotes && onNotesChange ? (
        <div className="space-y-2">
          <Label htmlFor="drafting-quality-notes">{resolvedLabels.notes}</Label>
          <Textarea
            id="drafting-quality-notes"
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder={resolvedLabels.notesPlaceholder}
            disabled={disabled}
            rows={3}
          />
        </div>
      ) : null}
    </div>
  );
}

export function createDefaultQualityChecklistValue(
  items: DraftingQualityChecklistItem[] = DEFAULT_DRAFTING_QUALITY_CHECKLIST_ITEMS,
): DraftingQualityChecklistValue {
  return Object.fromEntries(items.map((item) => [item.id, Boolean(item.defaultChecked)]));
}

export function getMissingQualityChecklistItems(
  items: DraftingQualityChecklistItem[],
  value: DraftingQualityChecklistValue,
  requireAll = false,
): DraftingQualityChecklistItem[] {
  return items.filter((item) => {
    const mustBeChecked = requireAll || item.required;
    return mustBeChecked && !Boolean(value[item.id] ?? item.defaultChecked);
  });
}

export function isQualityChecklistComplete(
  items: DraftingQualityChecklistItem[],
  value: DraftingQualityChecklistValue,
  requireAll = false,
): boolean {
  return getMissingQualityChecklistItems(items, value, requireAll).length === 0;
}
