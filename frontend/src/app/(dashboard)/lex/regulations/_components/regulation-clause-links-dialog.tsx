'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, Trash2 } from 'lucide-react';
import { Combobox } from '@/components/shared/forms/combobox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { enterpriseApi } from '@/lib/enterprise';
import { parseApiError } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  LexRegulation,
  LexRegulationClauseReference,
  LexRegulationClauseReferenceType,
} from '@/types/suites';
import { useRegulationLabels } from './regulation-content-labels';

export interface RegulationClauseLinksDialogProps {
  open: boolean;
  regulation: LexRegulation;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void> | void;
}

export function RegulationClauseLinksDialog({
  open,
  regulation,
  onOpenChange,
  onChanged,
}: RegulationClauseLinksDialogProps) {
  const queryClient = useQueryClient();
  const allLabels = useRegulationLabels();
  const labels = allLabels.links;
  const referenceTypeOptions = allLabels.referenceTypeOptions;
  const [clauseId, setClauseId] = useState('');
  const [referenceType, setReferenceType] = useState<LexRegulationClauseReferenceType>('implements');
  const [notes, setNotes] = useState('');

  const detailQuery = useQuery({
    queryKey: ['lex-regulation-detail', regulation.id],
    queryFn: () => enterpriseApi.lex.getRegulation(regulation.id),
    enabled: open,
    initialData: regulation,
  });

  const clauseLibraryQuery = useQuery({
    queryKey: ['lex-clause-library-options', regulation.id],
    queryFn: () => enterpriseApi.lex.listClauseLibrary({ page: 1, per_page: 100 }),
    enabled: open,
  });

  const references = detailQuery.data?.clause_references ?? [];
  const clauseOptions = useMemo(
    () =>
      (clauseLibraryQuery.data?.data ?? []).map((entry) => ({
        label: `${entry.code} — ${entry.title_en}`,
        value: entry.id,
      })),
    [clauseLibraryQuery.data],
  );

  const refreshLinks = async () => {
    await queryClient.invalidateQueries({ queryKey: ['lex-regulation-detail', regulation.id] });
    await queryClient.invalidateQueries({ queryKey: ['lex-regulations'] });
    await onChanged();
  };

  const linkMutation = useMutation({
    mutationFn: () =>
      enterpriseApi.lex.linkRegulationClause(regulation.id, {
        clause_id: clauseId,
        reference_type: referenceType,
        notes: notes.trim() || undefined,
      }),
    onSuccess: async () => {
      showSuccess(allLabels.toast.linked);
      setClauseId('');
      setReferenceType('implements');
      setNotes('');
      await refreshLinks();
    },
    onError: showApiError,
  });

  const unlinkMutation = useMutation({
    mutationFn: (reference: LexRegulationClauseReference) =>
      enterpriseApi.lex.unlinkRegulationClause(regulation.id, {
        clause_id: reference.clause_id,
        reference_type: reference.reference_type,
      }),
    onSuccess: async () => {
      showSuccess(allLabels.toast.unlinked);
      await refreshLinks();
    },
    onError: showApiError,
  });

  const canLink = clauseId.trim() !== '' && !linkMutation.isPending;

  const submitLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canLink) {
      return;
    }
    linkMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
            {regulation.title_ar ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <p className="truncate text-sm font-medium" dir="ltr">{regulation.title_en}</p>
                <p className="truncate text-sm font-medium sm:text-end" dir="rtl">{regulation.title_ar}</p>
              </div>
            ) : (
              <p className="truncate text-sm font-medium">{regulation.title_en}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {[regulation.authority, regulation.code].filter(Boolean).join(' — ') || labels.sourceFallback}
            </p>
          </div>

          <form className="space-y-4" onSubmit={submitLink}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="regulation-link-clause">{labels.clause}</Label>
                <Combobox
                  options={clauseOptions}
                  value={clauseId}
                  onChange={setClauseId}
                  placeholder={clauseLibraryQuery.isLoading ? labels.loading : labels.clausePlaceholder}
                  searchPlaceholder={labels.clausePlaceholder}
                  disabled={clauseLibraryQuery.isLoading || linkMutation.isPending}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regulation-link-type">{labels.referenceType}</Label>
                <Select
                  value={referenceType}
                  onValueChange={(value) => setReferenceType(value as LexRegulationClauseReferenceType)}
                  disabled={linkMutation.isPending}
                >
                  <SelectTrigger id="regulation-link-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {referenceTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="regulation-link-notes">{labels.notes}</Label>
              <Textarea
                id="regulation-link-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                dir="auto"
                placeholder={labels.notesPlaceholder}
                disabled={linkMutation.isPending}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={!canLink}>
                {linkMutation.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Link2 className="me-1.5 h-4 w-4" aria-hidden />
                )}
                {labels.linkSubmit}
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            {detailQuery.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {labels.loading}
              </p>
            ) : detailQuery.isError ? (
              <p className="text-sm text-destructive">
                {labels.errorTitle} {parseApiError(detailQuery.error)}
              </p>
            ) : references.length === 0 ? (
              <p className="text-sm text-muted-foreground">{labels.empty}</p>
            ) : (
              <ul className="space-y-2">
                {references.map((reference) => (
                  <li
                    key={reference.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border/70 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {reference.clause_title_en || reference.clause_code || reference.clause_id}
                      </p>
                      {reference.clause_code ? (
                        <p className="text-xs text-muted-foreground">{reference.clause_code}</p>
                      ) : null}
                      {reference.notes ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{reference.notes}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">
                        {referenceTypeLabel(String(reference.reference_type), referenceTypeOptions)}
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        aria-label={`${labels.unlink} ${reference.clause_title_en || reference.clause_code || reference.clause_id}`}
                        disabled={unlinkMutation.isPending}
                        onClick={() => unlinkMutation.mutate(reference)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function referenceTypeLabel(
  value: string,
  options: ReadonlyArray<{ label: string; value: string }>,
): string {
  return options.find((option) => option.value === value)?.label ?? value.replace(/_/g, ' ');
}
