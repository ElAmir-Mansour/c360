'use client';

/**
 * Create / edit dialog for one competent court.
 *
 * Deliberately plain: a code, the two localized names, an active flag and a sort
 * order. No presets, no suggestions — the whole point of this screen is that the
 * tenant supplies the real court names, and offering guesses would defeat it.
 */

import { type FormEvent, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Switch } from '@/components/ui/switch';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LegalCourt } from '@/lib/lex/cases';
import { useAdminCommonLabels } from '../../_lib/admin-labels';
import { LEX_COURTS_QUERY_KEY, lexCourtsApi, type CourtInput } from '../_lib/courts-api';
import { useCourtLabels } from '../_lib/courts-labels';

/** Mirrors the backend's validateLegalCourtCode so the message arrives locally. */
const COURT_CODE_PATTERN = /^[\p{L}\p{N}_-]+$/u;

export interface CourtFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The court being edited, or null when creating. */
  court?: LegalCourt | null;
  /**
   * Seed for the create form. Used by the legacy-value panel so an admin can turn
   * a historical free-text spelling into a real court without retyping it. It
   * only prefills the form — it never re-points the cases that carry the value.
   */
  initialNameEn?: string;
  initialNameAr?: string;
}

export function CourtFormDialog({
  open,
  onOpenChange,
  court,
  initialNameEn,
  initialNameAr,
}: CourtFormDialogProps) {
  const t = useCourtLabels();
  const common = useAdminCommonLabels();
  const queryClient = useQueryClient();
  const isEditing = court != null;

  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [active, setActive] = useState(true);
  const [sort, setSort] = useState('0');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode(court?.code ?? '');
    setNameEn(court?.name?.en ?? initialNameEn ?? '');
    setNameAr(court?.name?.ar ?? initialNameAr ?? '');
    setActive(court?.active ?? true);
    setSort(String(court?.sort ?? 0));
    setError(null);
  }, [open, court, initialNameEn, initialNameAr]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [LEX_COURTS_QUERY_KEY] });

  const save = useMutation({
    mutationFn: (payload: CourtInput) =>
      isEditing && court ? lexCourtsApi.update(court.id, payload) : lexCourtsApi.create(payload),
    onSuccess: async () => {
      showSuccess(isEditing ? t.toast.updated : t.toast.created);
      await refresh();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    const trimmedEn = nameEn.trim();
    const trimmedAr = nameAr.trim();

    if (!trimmedCode) {
      setError(t.form.codeRequired);
      return;
    }
    if (!COURT_CODE_PATTERN.test(trimmedCode)) {
      setError(t.form.codeInvalid);
      return;
    }
    // One locale is enough. An admin may only have the Arabic name to hand, and
    // forcing an English translation would invite invented ones.
    if (!trimmedEn && !trimmedAr) {
      setError(t.form.nameRequired);
      return;
    }
    setError(null);

    const parsedSort = Number.parseInt(sort, 10);
    save.mutate({
      code: trimmedCode,
      name: { en: trimmedEn, ar: trimmedAr },
      active,
      sort: Number.isFinite(parsedSort) ? parsedSort : 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t.form.editTitle : t.form.createTitle}</DialogTitle>
          <DialogDescription>
            {isEditing ? t.form.editDescription : t.form.createDescription}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="court-code">{t.form.code}</Label>
            <Input
              id="court-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t.form.codePlaceholder}
              disabled={save.isPending || Boolean(court?.is_system)}
            />
            <p className="text-xs text-muted-foreground">{t.form.codeHint}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="court-name-en">{t.form.nameEn}</Label>
              <Input
                id="court-name-en"
                value={nameEn}
                onChange={(event) => setNameEn(event.target.value)}
                placeholder={t.form.nameEnPlaceholder}
                disabled={save.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="court-name-ar">{t.form.nameAr}</Label>
              <Input
                id="court-name-ar"
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
                placeholder={t.form.nameArPlaceholder}
                dir="rtl"
                disabled={save.isPending}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="court-sort">{t.form.sort}</Label>
              <Input
                id="court-sort"
                type="number"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                disabled={save.isPending}
              />
              <p className="text-xs text-muted-foreground">{t.form.sortHint}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="court-active">{t.form.active}</Label>
              <div className="flex items-center gap-2 pt-1">
                <Switch
                  id="court-active"
                  checked={active}
                  onCheckedChange={setActive}
                  disabled={save.isPending}
                />
                <span className="text-sm text-muted-foreground">
                  {active ? common.active : common.inactive}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t.form.activeHint}</p>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              {common.cancel}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? (
                <>
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                  {t.form.saving}
                </>
              ) : (
                t.form.submit
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
