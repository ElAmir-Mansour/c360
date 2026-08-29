'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  FileText,
  Loader2,
  MessageSquareText,
  Search,
  UserRoundPlus,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import type { UserDirectoryEntry } from '@/types/suites';
import type { LexContractRecord } from '@/types/suites';
import type { Consultation } from '@/lib/lex/consultations';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useContractsControlLabels } from '../_lib/labels';

export type AssignmentKind = 'contract' | 'consultation';

export interface AssignmentBacklogItem {
  kind: AssignmentKind;
  id: string;
  reference: string;
  title: string;
  ownerName: string;
  receivedAt: string;
  href: string;
  approvedRequest: boolean;
  contract?: LexContractRecord;
  consultation?: Consultation;
}

export interface AssignmentSelection {
  id: string;
  name: string;
}

function permissionMatches(grant: string, required: string): boolean {
  if (grant === '*' || grant === required) return true;
  const grantParts = grant.split(':');
  const requiredParts = required.split(':');
  if (grantParts.length !== requiredParts.length) return false;
  return grantParts.every((part, index) => part === '*' || part === requiredParts[index]);
}

export function isEligibleAssignee(
  user: UserDirectoryEntry,
  permission: string,
): boolean {
  if (user.status && user.status.toLocaleLowerCase() !== 'active') return false;
  const grants = (user.roles ?? []).flatMap((role) => role.permissions ?? []);
  // Some directory deployments return role membership without expanding role
  // permissions. Keep the picker operational there; when grants are present,
  // enforce the domain-specific handler capability client-side.
  if (grants.length === 0) return true;
  return grants.some((grant) => permissionMatches(grant, permission));
}

function QuickAssignmentDialog({
  item,
  open,
  assigning,
  onOpenChange,
  onAssign,
}: {
  item: AssignmentBacklogItem | null;
  open: boolean;
  assigning: boolean;
  onOpenChange: (open: boolean) => void;
  onAssign: (selection: AssignmentSelection) => void;
}) {
  const t = useContractsControlLabels().assignment;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AssignmentSelection | null>(null);

  const requiredPermission =
    item?.kind === 'contract' ? 'lex:contract:edit' : 'lex:consultation:edit';
  const eligibleRoleSlugs =
    item?.kind === 'contract'
      ? ['legal-contracts-supervisor', 'legal-advisor']
      : ['legal-advisor'];

  const usersQuery = useQuery({
    queryKey: ['contracts-control', 'eligible-assignees', ...eligibleRoleSlugs],
    queryFn: async () => {
      const groups = await Promise.all(
        eligibleRoleSlugs.map((roleSlug) => enterpriseApi.users.listByRole(roleSlug)),
      );
      const byID = new Map<string, UserDirectoryEntry>();
      for (const user of groups.flat()) byID.set(user.id, user);
      return [...byID.values()];
    },
    enabled: open && item !== null,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (open) {
      setSearch('');
      setSelected(null);
    }
  }, [open, item?.id]);

  const users = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (usersQuery.data ?? [])
      .filter((user) => isEligibleAssignee(user, requiredPermission))
      .filter((user) => {
        if (!needle) return true;
        return `${userDisplayName(user)} ${user.email}`.toLocaleLowerCase().includes(needle);
      });
  }, [requiredPermission, search, usersQuery.data]);

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.dialogDescription(item.reference)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="text-body-sm font-medium text-foreground" htmlFor="assignment-search">
            {t.teamMember}
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="assignment-search"
              className="ps-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.searchPlaceholder}
              autoComplete="off"
            />
          </div>

          <div
            className="max-h-64 overflow-y-auto rounded-xl border border-border"
            role="listbox"
            aria-label={t.teamMember}
          >
            {usersQuery.isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" aria-label={t.assigning} />
              </div>
            ) : users.length === 0 ? (
              <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">
                {t.noEligibleMembers}
              </p>
            ) : (
              users.map((user) => {
                const name = userDisplayName(user);
                const active = selected?.id === user.id;
                return (
                  <Button
                    key={user.id}
                    type="button"
                    variant="ghost"
                    role="option"
                    aria-selected={active}
                    className={cn(
                      'h-auto w-full justify-start gap-3 rounded-none border-b border-border/70 px-4 py-3 text-start last:border-b-0 hover:bg-muted/70 focus-visible:ring-inset',
                      active && 'bg-primary/10',
                    )}
                    onClick={() => setSelected({ id: user.id, name })}
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-body-sm font-semibold text-muted-foreground',
                        active && 'bg-primary text-primary-foreground',
                      )}
                      aria-hidden
                    >
                      {name.slice(0, 1).toLocaleUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm font-semibold text-foreground">
                        {name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </span>
                  </Button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            disabled={!selected || assigning}
            onClick={() => {
              if (selected) onAssign(selected);
            }}
          >
            {assigning ? (
              <>
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                {t.assigning}
              </>
            ) : (
              <>
                <UserRoundPlus className="me-1.5 h-4 w-4" aria-hidden />
                {t.confirm}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function toAssignmentBacklogItems({
  contracts,
  consultations,
  locale,
}: {
  contracts: LexContractRecord[];
  consultations: Consultation[];
  locale: 'en' | 'ar';
}): AssignmentBacklogItem[] {
  const contractItems: AssignmentBacklogItem[] = contracts.map((contract) => ({
    kind: 'contract',
    id: contract.id,
    reference: contract.contract_number?.trim() || contract.title,
    title: contract.title,
    ownerName: contract.owner_name,
    receivedAt: contract.created_at,
    href: `/lex/contracts/${contract.id}`,
    approvedRequest: typeof contract.metadata?.legal_request_id === 'string',
    contract,
  }));

  const consultationItems: AssignmentBacklogItem[] = consultations.map((consultation) => ({
    kind: 'consultation',
    id: consultation.id,
    reference:
      consultation.consultation_number?.trim() ||
      resolveLocalized(consultation.title, locale) ||
      consultation.id,
    title:
      resolveLocalized(consultation.title, locale) ||
      consultation.consultation_number ||
      consultation.id,
    ownerName: consultation.requester_name,
    receivedAt: consultation.created_at,
    href: `/lex/consultations/${consultation.id}`,
    approvedRequest: Boolean(consultation.legal_request_id),
    consultation,
  }));

  return [...contractItems, ...consultationItems].sort(
    (a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt),
  );
}

export function UnassignedWorkCard({
  contracts,
  consultations,
  loading,
  assigning,
  canAssignContract,
  canAssignConsultation,
  onAssign,
}: {
  contracts: LexContractRecord[];
  consultations: Consultation[];
  loading?: boolean;
  assigning: boolean;
  canAssignContract: boolean;
  canAssignConsultation: boolean;
  onAssign: (
    item: AssignmentBacklogItem,
    selection: AssignmentSelection,
  ) => Promise<void>;
}) {
  const t = useContractsControlLabels().assignment;
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const [activeItem, setActiveItem] = useState<AssignmentBacklogItem | null>(null);

  const items = useMemo(
    () => toAssignmentBacklogItems({ contracts, consultations, locale }),
    [contracts, consultations, locale],
  );

  const canAssign = (item: AssignmentBacklogItem) =>
    item.kind === 'contract' ? canAssignContract : canAssignConsultation;

  return (
    <>
      <section
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
        dir={direction}
        lang={locale}
        aria-label={t.title}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-h4 font-semibold text-foreground">{t.title}</h2>
              {!loading && items.length > 0 ? (
                <Badge variant="secondary">{t.count(f.formatNumber(items.length))}</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-body-sm text-muted-foreground">{t.description}</p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {loading ? (
            Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="h-36 animate-pulse rounded-xl border border-border bg-muted/40"
              />
            ))
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-8 text-center">
              <p className="text-body-sm font-semibold text-foreground">{t.empty}</p>
              <p className="mt-1 text-body-sm text-muted-foreground">{t.emptyHint}</p>
            </div>
          ) : (
            items.slice(0, 8).map((item) => {
              const isContract = item.kind === 'contract';
              return (
                <article
                  key={`${item.kind}:${item.id}`}
                  className="rounded-xl border border-border bg-muted/20 p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="bg-background">
                          {isContract ? (
                            <FileText className="me-1 h-3 w-3" aria-hidden />
                          ) : (
                            <MessageSquareText className="me-1 h-3 w-3" aria-hidden />
                          )}
                          {isContract ? t.contract : t.consultation}
                        </Badge>
                        {item.approvedRequest ? (
                          <Badge variant="secondary">{t.approvedRequest}</Badge>
                        ) : null}
                      </div>
                      <h3 className="mt-3 truncate text-body-sm font-semibold text-foreground">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.reference}
                        {item.ownerName ? ` · ${item.ownerName}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t.received(f.formatRelative(item.receivedAt))}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={item.href}
                      className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline"
                    >
                      {t.viewDetails}
                      <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
                    </Link>
                    {canAssign(item) ? (
                      <Button size="sm" onClick={() => setActiveItem(item)}>
                        <UserRoundPlus className="me-1.5 h-4 w-4" aria-hidden />
                        {t.assign}
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <QuickAssignmentDialog
        item={activeItem}
        open={activeItem !== null}
        assigning={assigning}
        onOpenChange={(open) => {
          if (!open && !assigning) setActiveItem(null);
        }}
        onAssign={(selection) => {
          if (activeItem) {
            void onAssign(activeItem, selection)
              .then(() => setActiveItem(null))
              .catch(() => undefined);
          }
        }}
      />
    </>
  );
}
