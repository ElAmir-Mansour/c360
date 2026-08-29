'use client';

/**
 * People card — right-rail SectionCard for the Litigation Case detail page.
 * Surfaces the human context of a case: the responsible lawyer (initials avatar
 * + email), named section-manager / supervisor / handling-officer assignments,
 * the case parties (avatar + role + name + identifier) with a deep link to the
 * Parties tab, and a muted "created by" footer.
 *
 * Case assignment fields persist UUIDs, but this card hydrates them through IAM
 * so users see people rather than implementation identifiers. The copy-id
 * affordance remains available for support/audit work.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, UserCog, UserRound, Users } from 'lucide-react';
import { OrgEntityUserPicker } from '@/components/shared/forms/org-entity-user-picker';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { SectionCard } from '@/components/suites/section-card';
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
import { Textarea } from '@/components/ui/textarea';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import { casesApi, type CaseParty, type LegalCase } from '@/lib/lex/cases';
import type { User } from '@/types/models';
import { useCaseDetailExtraLabels } from './case-detail-labels';
import { usePartyRoleLabel } from './case-enums-i18n';

/** Which named case owner a reassignment dialog is targeting (F22, CAP-037/038). */
type ReassignRole = 'section_manager' | 'supervisor';

/**
 * Self-contained bilingual copy for the section-manager / supervisor reassignment
 * dialogs. Kept local (mirroring CaseOfficerAssignmentDialog's own COPY) so the
 * People card gains the two missing `lex:case:assign` affordances without editing
 * the shared case-detail label catalog.
 */
const REASSIGN_COPY = {
  en: {
    reassign: 'Reassign',
    sectionManagerTitle: 'Transfer to section manager',
    supervisorTitle: 'Assign supervisor',
    sectionManagerDescription: 'Choose the section manager who should own this case.',
    supervisorDescription: 'Choose the supervisor responsible for this case.',
    person: 'Person',
    select: 'Select a person',
    search: 'Search by name or email…',
    loading: 'Loading eligible people…',
    empty: 'No active employees match this organisational unit.',
    loadError: 'Eligible employees could not be loaded.',
    retry: 'Retry',
    reason: 'Reassignment note (optional)',
    reasonPlaceholder: 'Why is this owner changing?',
    cancel: 'Cancel',
    submit: 'Save',
    sectionManagerSuccess: 'Section manager updated',
    supervisorSuccess: 'Supervisor updated',
  },
  ar: {
    reassign: 'إعادة تعيين',
    sectionManagerTitle: 'النقل إلى مدير القسم',
    supervisorTitle: 'تعيين المشرف',
    sectionManagerDescription: 'اختر مدير القسم الذي يتولى هذه القضية.',
    supervisorDescription: 'اختر المشرف المسؤول عن هذه القضية.',
    person: 'الشخص',
    select: 'اختر شخصاً',
    search: 'ابحث بالاسم أو البريد الإلكتروني…',
    loading: 'جارٍ تحميل الأشخاص المؤهلين…',
    empty: 'لا يوجد موظفون نشطون مطابقون في هذه الوحدة التنظيمية.',
    loadError: 'تعذّر تحميل الموظفين المؤهلين.',
    retry: 'إعادة المحاولة',
    reason: 'ملاحظة إعادة التعيين (اختياري)',
    reasonPlaceholder: 'لماذا يتم تغيير هذا المسؤول؟',
    cancel: 'إلغاء',
    submit: 'حفظ',
    sectionManagerSuccess: 'تم تحديث مدير القسم',
    supervisorSuccess: 'تم تحديث المشرف',
  },
} as const;

function beneficiaryEntityId(legalCase: LegalCase): string | undefined {
  const value = legalCase.metadata?.beneficiary_entity_id;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export interface CasePeopleCardProps {
  legalCase: LegalCase;
  parties: CaseParty[];
  canAssign: boolean;
  onAssign: () => void;
  onViewParties: () => void;
  className?: string;
}

/** Max parties shown before the "view all" affordance. */
const MAX_PARTIES = 4;

/**
 * Watheeq brand avatar rotation with contrast-safe foregrounds. Deterministically
 * indexed by name hash so a person keeps a stable swatch across the card.
 */
const AVATAR_PALETTE = [
  {
    background: 'rgb(var(--ds-clario-primary))',
    foreground: 'rgb(var(--ds-clario-canvas))',
  },
  {
    background: 'rgb(var(--ds-clario-spring-teal))',
    foreground: 'rgb(var(--ds-clario-dark-teal))',
  },
  {
    background: 'rgb(var(--ds-clario-accent))',
    foreground: 'rgb(var(--ds-clario-dark-teal))',
  },
  {
    background: 'rgb(var(--ds-clario-dark-teal))',
    foreground: 'rgb(var(--ds-clario-canvas))',
  },
  {
    background: 'rgb(var(--ds-clario-muted))',
    foreground: 'rgb(var(--ds-clario-canvas))',
  },
] as const;

function hashToIndex(value: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash) % modulo;
}

function getNameInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function userName(user: Pick<User, 'first_name' | 'last_name' | 'email' | 'full_name'>): string {
  return user.full_name?.trim() || `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email;
}

function InitialsAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const seed = name.trim() || '?';
  const color = AVATAR_PALETTE[hashToIndex(seed, AVATAR_PALETTE.length)];
  return (
    <div
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold',
        size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs',
      )}
      style={{ backgroundColor: color.background, color: color.foreground }}
    >
      {getNameInitials(name)}
    </div>
  );
}

function CopyIdButton({ value, label, doneLabel }: { value: string; label: string; doneLabel: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(doneLabel);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Low-stakes copy — the id stays visible/selectable on failure.
    }
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={onCopy}
      aria-label={label}
      title={label}
    >
      {copied ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-success-600 dark:text-success-300" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </Button>
  );
}

function AssignmentRow({
  label,
  id,
  user,
  loading,
  copyLabel,
  copiedLabel,
  onReassign,
  reassignLabel,
}: {
  label: string;
  id: string;
  user?: User;
  loading?: boolean;
  copyLabel: string;
  copiedLabel: string;
  onReassign?: () => void;
  reassignLabel?: string;
}) {
  const name = user ? userName(user) : loading ? '…' : id;
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-xs font-medium text-foreground" dir="auto" title={id}>
          {name}
        </p>
        {user ? <p className="truncate text-[11px] text-muted-foreground">{user.email}</p> : null}
      </div>
      {onReassign ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onReassign}
          aria-label={reassignLabel}
          title={reassignLabel}
        >
          <UserCog className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : null}
      <CopyIdButton value={id} label={copyLabel} doneLabel={copiedLabel} />
    </div>
  );
}

/**
 * Reassignment dialog for the two named owners the People card previously rendered
 * read-only (F22). Posts to the case-assign–tiered endpoints:
 *   section_manager -> POST /legal-cases/{id}/transfer-section-manager
 *   supervisor      -> POST /legal-cases/{id}/assign-supervisor
 * Both are gated on `lex:case:assign` server-side; the trigger is gated the same
 * way through the card's `canAssign` prop. On success the case queries refetch.
 */
function ReassignOwnerDialog({
  legalCase,
  role,
  open,
  onOpenChange,
  onSaved,
}: {
  legalCase: LegalCase;
  role: ReassignRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { locale } = useLocaleOrDefault();
  const t = REASSIGN_COPY[locale === 'ar' ? 'ar' : 'en'];
  const entityId = useMemo(() => beneficiaryEntityId(legalCase), [legalCase]);
  const currentId =
    role === 'section_manager' ? legalCase.section_manager_id : legalCase.supervisor_id;
  const [personId, setPersonId] = useState(currentId ?? '');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setPersonId(currentId ?? '');
    setReason('');
  }, [currentId, open]);

  const mutation = useMutation({
    mutationFn: () =>
      role === 'section_manager'
        ? casesApi.transferSectionManager(legalCase.id, {
            section_manager_id: personId,
            reason: reason.trim(),
          })
        : casesApi.assignSupervisor(legalCase.id, {
            supervisor_id: personId,
            reason: reason.trim(),
          }),
    onSuccess: () => {
      showSuccess(role === 'section_manager' ? t.sectionManagerSuccess : t.supervisorSuccess);
      onOpenChange(false);
      onSaved();
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{role === 'section_manager' ? t.sectionManagerTitle : t.supervisorTitle}</DialogTitle>
          <DialogDescription>
            {role === 'section_manager' ? t.sectionManagerDescription : t.supervisorDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="case-reassign-person">{t.person}</Label>
            <OrgEntityUserPicker
              id="case-reassign-person"
              ariaLabel={t.person}
              entityId={entityId}
              value={personId}
              onChange={setPersonId}
              required
              disabled={mutation.isPending}
              labels={{
                select: t.select,
                search: t.search,
                loading: t.loading,
                empty: t.empty,
                loadError: t.loadError,
                retry: t.retry,
              }}
              className="w-full"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="case-reassign-reason">{t.reason}</Label>
            <Textarea
              id="case-reassign-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t.reasonPlaceholder}
              disabled={mutation.isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            loading={mutation.isPending}
            disabled={!personId || personId === currentId}
            onClick={() => mutation.mutate()}
          >
            {t.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CasePeopleCard({
  legalCase,
  parties,
  canAssign,
  onAssign,
  onViewParties,
  className,
}: CasePeopleCardProps) {
  const t = useCaseDetailExtraLabels().people;
  const roleLabel = usePartyRoleLabel();
  const queryClient = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const reassignLabel = REASSIGN_COPY[locale === 'ar' ? 'ar' : 'en'].reassign;
  const [reassignRole, setReassignRole] = useState<ReassignRole | null>(null);

  const identityIds = useMemo(
    () =>
      [...new Set([
        legalCase.section_manager_id,
        legalCase.supervisor_id,
        legalCase.handling_officer_id,
        legalCase.created_by,
      ].filter((id): id is string => Boolean(id)))],
    [
      legalCase.created_by,
      legalCase.handling_officer_id,
      legalCase.section_manager_id,
      legalCase.supervisor_id,
    ],
  );
  const identityQueries = useQueries({
    queries: identityIds.map((id) => ({
      queryKey: ['tenant-user', id],
      queryFn: () => apiGet<User>(`/api/v1/users/${id}`),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const identities = new Map<string, User>();
  identityQueries.forEach((query, index) => {
    if (query.data) identities.set(identityIds[index], query.data);
  });
  const loadingIdentityIds = new Set(
    identityQueries.flatMap((query, index) => (query.isLoading ? [identityIds[index]] : [])),
  );

  const handlingOfficer = legalCase.handling_officer_id
    ? identities.get(legalCase.handling_officer_id)
    : undefined;
  const lawyer = handlingOfficer
    ? userName(handlingOfficer)
    : legalCase.responsible_lawyer?.trim() ||
      (legalCase.handling_officer_id && !loadingIdentityIds.has(legalCase.handling_officer_id)
        ? legalCase.handling_officer_id
        : undefined);
  const assignments = [
    { label: t.sectionManager, id: legalCase.section_manager_id, role: 'section_manager' as const },
    { label: t.supervisor, id: legalCase.supervisor_id, role: 'supervisor' as const },
    { label: t.handlingOfficer, id: legalCase.handling_officer_id, role: 'officer' as const },
  ].filter(
    (row): row is { label: string; id: string; role: ReassignRole | 'officer' } => Boolean(row.id),
  );

  const visibleParties = parties.slice(0, MAX_PARTIES);
  const extraParties = Math.max(0, parties.length - visibleParties.length);

  return (
    <>
      <SectionCard title={t.title} className={className}>
      <div className="space-y-4">
        {/* Responsible lawyer */}
        <div className="flex items-start gap-3">
          {lawyer ? (
            <InitialsAvatar name={lawyer} />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <UserRound className="h-4 w-4" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t.responsibleLawyer}
            </p>
            {lawyer ? (
              <>
                <p className="truncate text-sm font-medium text-foreground" dir="auto">
                  {lawyer}
                </p>
                {handlingOfficer?.email ? (
                  <p className="truncate text-xs text-muted-foreground" dir="auto">
                    {handlingOfficer.email}
                  </p>
                ) : legalCase.department ? (
                  <p className="truncate text-xs text-muted-foreground" dir="auto">
                    {legalCase.department}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t.unassigned}</span>
                {canAssign ? (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onAssign}>
                    {t.assign}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {lawyer && canAssign ? (
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={onAssign}>
            {t.assign}
          </Button>
        ) : null}

        {/* Named assignments (only those present). */}
        {assignments.length > 0 ? (
          <div className="space-y-2 border-t border-border/60 pt-3">
            {assignments.map((row) => {
              const reassignTarget = row.role;
              return (
                <AssignmentRow
                  key={row.label}
                  label={row.label}
                  id={row.id}
                  user={identities.get(row.id)}
                  loading={loadingIdentityIds.has(row.id)}
                  copyLabel={t.copyId}
                  copiedLabel={t.copied}
                  onReassign={
                    canAssign && reassignTarget !== 'officer'
                      ? () => setReassignRole(reassignTarget)
                      : undefined
                  }
                  reassignLabel={reassignLabel}
                />
              );
            })}
          </div>
        ) : null}

        {/* Parties */}
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {t.partiesHeading(String(parties.length))}
            </p>
            {parties.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={onViewParties}
              >
                {t.viewAllParties}
              </Button>
            ) : null}
          </div>

          {parties.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t.noParties}</p>
          ) : (
            <ul className="space-y-2">
              {visibleParties.map((party) => (
                <li key={party.id} className="flex items-center gap-2">
                  <InitialsAvatar name={party.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground" dir="auto">
                      {party.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground" dir="auto">
                      {party.identifier?.trim() || t.noIdentifier}
                    </p>
                  </div>
                  <Badge variant="outline" size="sm">
                    {roleLabel(party.role)}
                  </Badge>
                </li>
              ))}
              {extraParties > 0 ? (
                <li>
                  <button
                    type="button"
                    onClick={onViewParties}
                    className="text-xs font-medium text-primary hover:text-primary/80"
                  >
                    {t.viewAllParties}
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </div>

        {/* Created by */}
        <p
          className="truncate border-t border-border/60 pt-2 text-[11px] text-muted-foreground"
          title={legalCase.created_by || undefined}
        >
          {t.createdBy(
            legalCase.created_by
              ? identities.get(legalCase.created_by)
                ? userName(identities.get(legalCase.created_by)!)
                : loadingIdentityIds.has(legalCase.created_by)
                  ? '…'
                  : legalCase.created_by
              : '—',
          )}
        </p>
      </div>
      </SectionCard>
      {reassignRole ? (
        <ReassignOwnerDialog
          legalCase={legalCase}
          role={reassignRole}
          open={Boolean(reassignRole)}
          onOpenChange={(open) => {
            if (!open) setReassignRole(null);
          }}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['lex-case', legalCase.id] });
            void queryClient.invalidateQueries({ queryKey: ['lex-cases'] });
          }}
        />
      ) : null}
    </>
  );
}
