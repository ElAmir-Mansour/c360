/**
 * "My work" panel for the Watheeq Legal-Affairs command center (`/lex` landing
 * page).
 *
 * Surfaces the signed-in user's open work across contracts (owner), litigation
 * cases (handling officer) and service-desk requests (requester) via
 * {@link useLexMyWork}. Each row is a navigational {@link SeverityRow} carrying a
 * leading per-domain icon (resolved from {@link LEX_DOMAINS}), a humanized status
 * meta line, and a trailing domain chip + relative-time stamp. The panel renders
 * a premium empty state when the user has no assigned work, and is hidden
 * entirely when there is no signed-in user.
 *
 * Bilingual (EN/AR) via `useLexLabels()`; RTL-safe via logical spacing.
 */

'use client';

import { ClipboardList, type LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { useLexFormat } from '@/lib/lex/ksa';

import { useLexLabels } from '../_lib/lex-i18n';
import type { LexDomainId } from '../_lib/lex-i18n';
import { LEX_DOMAINS } from '../_lib/lex-domains';
import { useLexMyWork } from '../_lib/use-lex-command-center';
import {
  CommandCard,
  SectionHeader,
  SeverityRow,
  EmptyState,
} from './command-ui';

/** Bilingual, human-readable labels for the raw status enums My Work surfaces. */
const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
  draft: { en: 'Draft', ar: 'مسودة' },
  active: { en: 'Active', ar: 'نشط' },
  expired: { en: 'Expired', ar: 'منتهٍ' },
  routed: { en: 'Routed', ar: 'موجّه' },
  submitted: { en: 'Submitted', ar: 'مُقدّم' },
  classified: { en: 'Classified', ar: 'مُصنّف' },
  responded: { en: 'Responded', ar: 'تمت الإجابة' },
  approved: { en: 'Approved', ar: 'معتمد' },
  rejected: { en: 'Rejected', ar: 'مرفوض' },
  pending: { en: 'Pending', ar: 'قيد الانتظار' },
  in_review: { en: 'In review', ar: 'قيد المراجعة' },
  internal_review: { en: 'Internal review', ar: 'مراجعة داخلية' },
  legal_review: { en: 'Legal review', ar: 'مراجعة قانونية' },
  negotiation: { en: 'Negotiation', ar: 'تفاوض' },
  pending_signature: { en: 'Pending signature', ar: 'بانتظار التوقيع' },
  open: { en: 'Open', ar: 'مفتوح' },
  closed: { en: 'Closed', ar: 'مغلق' },
  completed: { en: 'Completed', ar: 'مكتمل' },
};

function humanizeStatus(raw: string | undefined, locale: string): string | undefined {
  if (!raw) return raw;
  const key = raw.trim().toLowerCase();
  const known = STATUS_LABELS[key];
  if (known) return locale === 'ar' ? known.ar : known.en;
  if (/^[a-z]+(?:_[a-z]+)*$/.test(key)) {
    return key.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  return raw;
}

/** Fast lookup of a domain's icon + i18n leaf by id (built once). */
const DOMAIN_BY_ID: Record<string, { icon: LucideIcon; labelKey: LexDomainId }> =
  Object.fromEntries(
    LEX_DOMAINS.map((d) => [
      d.id,
      { icon: d.icon, labelKey: d.id as LexDomainId },
    ]),
  );

interface DomainBadgeProps {
  domain: string;
}

/** Small domain chip (icon + localized name) shown trailing each work row. */
function DomainBadge({ domain }: DomainBadgeProps) {
  const labels = useLexLabels();
  const meta = DOMAIN_BY_ID[domain];
  const name = meta ? labels.overview.domains[meta.labelKey] : domain;
  return (
    <Badge variant="secondary" className="gap-1.5 normal-case tracking-normal">
      {meta ? <meta.icon className="h-3 w-3" aria-hidden /> : null}
      <span className="truncate">{name}</span>
    </Badge>
  );
}

/** Polished loading placeholder — a stack of row skeletons matching the list. */
function MyWorkSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-soft border border-border bg-card px-3 py-3"
        >
          <Skeleton className="h-9 w-9 shrink-0 rounded-soft" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3 rounded-full" />
            <Skeleton className="h-3 w-1/4 rounded-full" />
          </div>
          <Skeleton className="hidden h-5 w-24 shrink-0 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

export function MyWork() {
  const labels = useLexLabels();
  const f = useLexFormat();
  const mw = labels.overview.myWork;
  const { user } = useAuth();
  const { items, isLoading } = useLexMyWork(user?.id);

  // Hidden entirely when there is no signed-in user (the hook is a no-op too).
  if (!user?.id) return null;

  const isEmpty = !isLoading && items.length === 0;

  return (
    <CommandCard className="space-y-4">
      <SectionHeader
        eyebrow={mw.assignedTo}
        title={mw.title}
        description={mw.description}
        icon={ClipboardList}
        tone="primary"
      />

      {isLoading ? (
        <MyWorkSkeleton />
      ) : isEmpty ? (
        <EmptyState
          icon={ClipboardList}
          title={mw.emptyTitle}
          description={mw.emptyDescription}
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const meta = DOMAIN_BY_ID[item.domain];
            const Icon = meta?.icon ?? ClipboardList;
            return (
              <SeverityRow
                key={item.id}
                severity="neutral"
                icon={Icon}
                href={item.href}
                title={item.title}
                meta={humanizeStatus(item.status, f.locale)}
                trailing={
                  <span className="flex items-center gap-2">
                    <DomainBadge domain={item.domain} />
                    {item.updatedAt ? (
                      <span
                        className="hidden whitespace-nowrap text-caption text-muted-foreground sm:inline"
                        title={f.formatDual(item.updatedAt)}
                      >
                        {f.formatRelative(item.updatedAt)}
                      </span>
                    ) : null}
                  </span>
                }
              />
            );
          })}
        </div>
      )}
    </CommandCard>
  );
}

export default MyWork;
