'use client';

/**
 * First-class "Move" (re-parent / reorganize) dialog for an org entity.
 *
 * Beyond editing `parent_id` in a form, this dialog:
 *   - self-fetches the full entity pool (key ['lex-admin-org-entities','move']);
 *   - offers a parent picker over `validParents(entity, all)` — cycles are
 *     impossible by construction — plus a "(make root)" option (parent_id=null);
 *   - renders a live impact preview (descendants moving, new depth, escalation
 *     ladder before→after) as the parent selection changes;
 *   - applies the move via `lexAdminApi.updateOrgEntity`, surfaces success /
 *     error toasts, invalidates the org-entities cache, and closes.
 *
 * Confirm-style footer; Apply is disabled while pending or when no real change
 * is selected. Bilingual EN/AR, logical-direction CSS, lucide icons.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, MoveRight, Network } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { resolveLocalized } from '@/lib/i18n/localized';
import { lexAdminApi, type OrgEntity } from '@/lib/lex/admin';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { validParents } from '../../_lib/reparent-impact';
import { reorganizeLabels } from '../../_lib/reorganize-i18n';
import { ReparentImpactPreview } from './reparent-impact-preview';

/** Sentinel select value standing in for `parent_id = null` (make root). */
const ROOT_VALUE = '__root__';

export interface OrgMoveDialogProps {
  /** The entity to move. `null` keeps the dialog dormant (no fetch fired). */
  entity: OrgEntity | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful move (in addition to cache invalidation). */
  onMoved?: () => void;
}

export function OrgMoveDialog({ entity, open, onOpenChange, onMoved }: OrgMoveDialogProps) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? reorganizeLabels.ar : reorganizeLabels.en;
  const queryClient = useQueryClient();

  // Selected new parent, expressed as a select value (id or ROOT_VALUE).
  const [selected, setSelected] = useState<string>('');

  const entitiesQuery = useQuery({
    queryKey: ['lex-admin-org-entities', 'move'],
    enabled: open && Boolean(entity),
    queryFn: async () => {
      // Pull a generous page; the org registry is small (hundreds at most).
      const res = await lexAdminApi.listOrgEntities({ page: 1, per_page: 500 });
      return res.data;
    },
  });

  const all: OrgEntity[] = useMemo(() => entitiesQuery.data ?? [], [entitiesQuery.data]);

  // Re-seed the selection to the entity's CURRENT parent whenever the dialog
  // (re)opens for a given entity, so "no change" is the honest default.
  useEffect(() => {
    if (open && entity) {
      setSelected(entity.parent_id ? entity.parent_id : ROOT_VALUE);
    }
  }, [open, entity]);

  const parents = useMemo<OrgEntity[]>(() => {
    if (!entity || all.length === 0) return [];
    return validParents(entity, all).filter((candidate) => candidate.id !== entity.id);
  }, [entity, all]);

  const newParentId: string | null = selected === ROOT_VALUE ? null : selected || null;

  const currentParentId: string | null = entity?.parent_id ?? null;
  const hasChange = selected !== '' && newParentId !== currentParentId;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!entity) throw new Error('No entity to move');
      return lexAdminApi.updateOrgEntity(entity.id, { parent_id: newParentId });
    },
    onSuccess: () => {
      const name = entity ? resolveLocalized(entity.name, locale) || entity.code : '';
      showSuccess(t.successTitle, t.successBody(name));
      void queryClient.invalidateQueries({ queryKey: ['lex-admin-org-entities'] });
      onMoved?.();
      onOpenChange(false);
    },
    onError: (error) => {
      showApiError(error);
    },
  });

  const loading = entitiesQuery.isLoading;
  const pending = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => (!pending ? onOpenChange(next) : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>
            {entity
              ? t.description(resolveLocalized(entity.name, locale) || entity.code)
              : t.description('')}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <LoadingSkeleton variant="form" count={3} />
        ) : !entity ? null : parents.length === 0 ? (
          <EmptyState icon={Network} title={t.parentLabel} description={t.noParents} />
        ) : (
          <div className="space-y-4">
            {/* Parent picker */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t.parentLabel}</label>
              <Select value={selected} onValueChange={setSelected} disabled={pending}>
                <SelectTrigger>
                  <SelectValue placeholder={t.parentPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_VALUE}>{t.makeRoot}</SelectItem>
                  {parents.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {resolveLocalized(candidate.name, locale) || candidate.code}
                      <span className="ms-1.5 text-xs text-muted-foreground">{candidate.code}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Impact preview (only once a real change is staged) */}
            {hasChange ? (
              <ReparentImpactPreview
                entity={entity}
                newParentId={newParentId}
                all={all}
                locale={locale}
                t={t}
              />
            ) : (
              <Alert>
                <AlertDescription>{t.noChange}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.cancel}
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={pending || !hasChange || !entity}>
            {pending ? (
              <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <MoveRight className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
            )}
            {pending ? t.applying : t.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OrgMoveDialog;
