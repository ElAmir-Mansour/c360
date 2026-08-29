'use client';

/**
 * Feature 14 — Richer governance audit feed (Settlements / ADR detail).
 *
 * REPLACES the inline `<SectionCard title={labels.auditTitle} …>` audit-list
 * block in `app/(dashboard)/lex/settlements/[id]/page.tsx` (the integrator-DETAIL
 * agent swaps that block for `<SettlementAuditFeed settlementId={settlement.id} />`).
 *
 * Over the raw list it previously rendered, this feed adds:
 *   • A proper vertical timeline (icon rail) instead of stacked cards.
 *   • Humanized action copy keyed off the raw backend `action` token, with a
 *     status-transition line (`from → to`, RTL-aware arrow) resolved through the
 *     shared `settlementStatusLabel`.
 *   • A readable key/value rendering of the immutable `entry.detail` payload, with
 *     money fields (`value` / `proposed_value` / `amount`, paired with `currency`)
 *     formatted via `formatSettlementValue`.
 *   • Actor attribution: `actor_user_id` is resolved to a display name through the
 *     shared user directory (`enterpriseApi.users.list`, same query key the
 *     delay-event register uses so the page warms one directory fetch); when a
 *     name is not resolvable it falls back to a shortened id behind a tooltip
 *     exposing the full UUID.
 *   • Relative + absolute timestamps.
 *   • An action-type filter (dropdown) over the distinct actions present.
 *   • Loading / empty / error states.
 *
 * Self-contained per the lex bilingual contract (`../../_lib/lex-i18n.ts`): it
 * owns its OWN `LexBilingual<AuditFeedLabels>` bundle (full EN + professional MSA
 * copies, function-valued interpolation preserved on both sides). Glossary:
 * تسوية (settlement) / مفاوضة (negotiation) / تحكيم (arbitration) / وساطة
 * (mediation) / مصالحة (reconciliation) / اعتماد (approval) / طرف مقابل
 * (counterparty) / حوكمة (governance) / منفِّذ (actor).
 *
 * It does NOT mutate; the page's mutation flows already invalidate
 * `['lex-settlement-audit', settlementId]`, which this component reads — so the
 * feed refreshes automatically after submit / decide / close / record actions.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListFilter, ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SectionCard } from '@/components/suites/section-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { enterpriseApi } from '@/lib/enterprise/api';
import { userDisplayName } from '@/lib/enterprise/utils';
import {
  LexActivityTimeline,
  type LexActivityEvent,
  type LexActivityTone,
} from '@/components/lex/activity-timeline';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LexFormatter } from '@/lib/lex/ksa';
import {
  settlementsApi,
  type SettlementAuditEntry,
} from '@/lib/lex/settlements';
import {
  settlementStatusLabel,
  useSettlementLabels,
  type SettlementLabels,
} from './labels';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Self-contained bilingual labels (lex contract).
 * ------------------------------------------------------------------------- */

interface AuditFeedLabels {
  title: string;
  description: string;
  loadingLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  errorMessage: string;
  retry: string;
  /** Filter control. */
  filter: {
    label: string;
    all: string;
  };
  /** No rows after the filter narrows the set. */
  filteredEmptyTitle: string;
  filteredEmptyDescription: string;
  /** Actor attribution. */
  actor: {
    label: string;
    /** Tooltip on the shortened-id fallback chip. */
    unknownTooltip: (id: string) => string;
  };
  /** Detail-payload key/value section heading. */
  detailsLabel: string;
  /** Humanized names for the known raw `action` tokens. */
  actions: Record<string, string>;
  /** Friendly labels for known detail-payload keys. */
  detailKeys: Record<string, string>;
  /** Transition line, e.g. "Proposed → Negotiating". RTL flips the arrow. */
  transition: (from: string, to: string) => string;
  /** Shown for a transition endpoint that is absent. */
  notSet: string;
}

const bundle: LexBilingual<AuditFeedLabels> = {
  en: {
    title: 'Governance audit',
    description: 'Append-only record of every settlement state change.',
    loadingLabel: 'Loading audit trail…',
    emptyTitle: 'No audit entries',
    emptyDescription: 'Audit entries appear as the settlement progresses.',
    errorMessage: 'Failed to load the audit trail.',
    retry: 'Retry',
    filter: {
      label: 'Action',
      all: 'All actions',
    },
    filteredEmptyTitle: 'No matching entries',
    filteredEmptyDescription: 'No audit entries match the selected action filter.',
    actor: {
      label: 'By',
      unknownTooltip: (id) => `User ${id}`,
    },
    detailsLabel: 'Details',
    actions: {
      // Authoritative raw backend tokens (SettlementService.appendAudit).
      'settlement.opened': 'Settlement opened',
      'settlement.recorded': 'Terms recorded',
      'settlement.negotiation_round_added': 'Negotiation round added',
      'settlement.submitted_for_approval': 'Submitted for approval',
      'settlement.closed_by_reconciliation': 'Closed by reconciliation',
      'settlement.approved': 'Settlement approved',
      'settlement.rejected': 'Settlement rejected',
      // Defensive unprefixed aliases (legacy / forward-compat).
      opened: 'Settlement opened',
      created: 'Settlement opened',
      recorded: 'Terms recorded',
      updated: 'Terms updated',
      round_added: 'Negotiation round added',
      negotiation_round_added: 'Negotiation round added',
      submitted: 'Submitted for approval',
      submitted_for_approval: 'Submitted for approval',
      submit: 'Submitted for approval',
      approved: 'Settlement approved',
      rejected: 'Settlement rejected',
      decided: 'Approval decision recorded',
      executed: 'Settlement executed',
      closed: 'Closed by reconciliation',
      closed_by_reconciliation: 'Closed by reconciliation',
      abandoned: 'Settlement abandoned',
      deleted: 'Settlement deleted',
      status_changed: 'Status changed',
    },
    detailKeys: {
      value: 'Value',
      proposed_value: 'Proposed value',
      amount: 'Amount',
      method: 'Method',
      reference: 'Reference',
      title: 'Title',
      terms: 'Terms',
      decision: 'Decision',
      notes: 'Notes',
      outcome: 'Outcome',
      proposed_by: 'Proposed by',
      round_number: 'Round',
      counterparty_name: 'Counterparty',
      workflow_instance_id: 'Workflow',
      reason: 'Reason',
    },
    transition: (from, to) => `${from} → ${to}`,
    notSet: '—',
  },
  ar: {
    title: 'سجل الحوكمة',
    description: 'سجل غير قابل للتعديل لكل تغيير في حالة التسوية.',
    loadingLabel: 'جارٍ تحميل سجل التدقيق…',
    emptyTitle: 'لا توجد قيود تدقيق',
    emptyDescription: 'تظهر قيود التدقيق مع تقدّم التسوية.',
    errorMessage: 'تعذّر تحميل سجل التدقيق.',
    retry: 'إعادة المحاولة',
    filter: {
      label: 'الإجراء',
      all: 'كل الإجراءات',
    },
    filteredEmptyTitle: 'لا توجد قيود مطابقة',
    filteredEmptyDescription: 'لا توجد قيود تدقيق مطابقة لمرشّح الإجراء المحدد.',
    actor: {
      label: 'بواسطة',
      unknownTooltip: (id) => `المستخدم ${id}`,
    },
    detailsLabel: 'التفاصيل',
    actions: {
      // الرموز الخلفية الأصلية المعتمدة (SettlementService.appendAudit).
      'settlement.opened': 'تم فتح التسوية',
      'settlement.recorded': 'تم تسجيل البنود',
      'settlement.negotiation_round_added': 'أُضيفت جولة مفاوضة',
      'settlement.submitted_for_approval': 'أُرسلت للاعتماد',
      'settlement.closed_by_reconciliation': 'أُغلقت بالمصالحة',
      'settlement.approved': 'اعتُمدت التسوية',
      'settlement.rejected': 'رُفضت التسوية',
      // مرادفات دفاعية بدون بادئة (توافق خلفي / مستقبلي).
      opened: 'تم فتح التسوية',
      created: 'تم فتح التسوية',
      recorded: 'تم تسجيل البنود',
      updated: 'تم تحديث البنود',
      round_added: 'أُضيفت جولة مفاوضة',
      negotiation_round_added: 'أُضيفت جولة مفاوضة',
      submitted: 'أُرسلت للاعتماد',
      submitted_for_approval: 'أُرسلت للاعتماد',
      submit: 'أُرسلت للاعتماد',
      approved: 'اعتُمدت التسوية',
      rejected: 'رُفضت التسوية',
      decided: 'سُجّل قرار الاعتماد',
      executed: 'نُفّذت التسوية',
      closed: 'أُغلقت بالمصالحة',
      closed_by_reconciliation: 'أُغلقت بالمصالحة',
      abandoned: 'تُركت التسوية',
      deleted: 'حُذفت التسوية',
      status_changed: 'تغيّرت الحالة',
    },
    detailKeys: {
      value: 'القيمة',
      proposed_value: 'القيمة المقترحة',
      amount: 'المبلغ',
      method: 'الأسلوب',
      reference: 'المرجع',
      title: 'العنوان',
      terms: 'البنود',
      decision: 'القرار',
      notes: 'ملاحظات',
      outcome: 'النتيجة',
      proposed_by: 'مُقدِّم العرض',
      round_number: 'الجولة',
      counterparty_name: 'الطرف المقابل',
      workflow_instance_id: 'سير العمل',
      reason: 'السبب',
    },
    transition: (from, to) => `${to} ← ${from}`,
    notSet: '—',
  },
};

function resolveAuditFeedLabels(locale: AppLocale = 'en'): AuditFeedLabels {
  return resolveLexBilingual(bundle, locale);
}

function useAuditFeedLabels(): AuditFeedLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveAuditFeedLabels(locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Action → semantic tone for the shared <LexActivityTimeline> dot + rail.
 * Keeps the previous color language (sky/slate/indigo → info·neutral,
 * amber → warning, emerald → success, rose → danger).
 * ------------------------------------------------------------------------- */

const ACTION_TONES: Record<string, LexActivityTone> = {
  // Authoritative raw backend tokens.
  'settlement.opened': 'info',
  'settlement.recorded': 'neutral',
  'settlement.negotiation_round_added': 'info',
  'settlement.submitted_for_approval': 'warning',
  'settlement.closed_by_reconciliation': 'success',
  'settlement.approved': 'success',
  'settlement.rejected': 'danger',
  // Defensive unprefixed aliases.
  opened: 'info',
  created: 'info',
  recorded: 'neutral',
  updated: 'neutral',
  round_added: 'info',
  submitted: 'warning',
  submit: 'warning',
  decided: 'warning',
  approved: 'success',
  executed: 'success',
  closed: 'success',
  rejected: 'danger',
  abandoned: 'danger',
  deleted: 'danger',
};

function actionTone(action: string): LexActivityTone {
  return ACTION_TONES[action] ?? 'info';
}

/* ------------------------------------------------------------------------- *
 * Pure helpers.
 * ------------------------------------------------------------------------- */

/**
 * Humanize a raw action token. Real tokens (`settlement.*`) resolve through the
 * bilingual map above; the spaced/capitalized form is a LAST-RESORT fallback for
 * unknown tokens only (dots + underscores flattened so nothing raw leaks).
 */
function humanizeAction(L: AuditFeedLabels, action: string): string {
  const known = L.actions[action];
  if (known) {
    return known;
  }
  const spaced = action.replace(/[._]/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : action;
}

/** Money-valued detail keys; rendered with the entry's `currency` when present. */
const MONEY_KEYS = new Set(['value', 'proposed_value', 'amount']);
/** Keys we never surface in the key/value details (rendered elsewhere / noisy). */
const HIDDEN_DETAIL_KEYS = new Set(['currency', 'from_status', 'to_status', 'action']);

interface DetailPair {
  key: string;
  label: string;
  value: string;
}

/** Friendly label for a detail key, falling back to a spaced form. */
function detailKeyLabel(L: AuditFeedLabels, key: string): string {
  return L.detailKeys[key] ?? key.replace(/_/g, ' ');
}

/**
 * Render a single primitive detail value as a readable string. Money + plain
 * numbers route through the shared {@link LexFormatter} so Arabic mode renders
 * the Saudi Riyal symbol and Arabic-Indic digits.
 */
function renderDetailValue(
  f: LexFormatter,
  key: string,
  value: unknown,
  currency?: string | null,
): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (MONEY_KEYS.has(key) && typeof value === 'number') {
    return f.formatCurrency(value, { currency: currency ?? 'SAR' }) || '—';
  }
  if (typeof value === 'boolean') {
    return value ? '✓' : '✗';
  }
  if (typeof value === 'number') {
    return f.formatNumber(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  // Objects / arrays: compact JSON so nothing is silently dropped.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Flatten a detail payload into displayable key/value pairs (hidden keys dropped). */
function detailPairs(
  f: LexFormatter,
  L: AuditFeedLabels,
  entry: SettlementAuditEntry,
): DetailPair[] {
  const detail = entry.detail ?? {};
  const currency =
    typeof detail.currency === 'string' ? detail.currency : undefined;
  const pairs: DetailPair[] = [];
  for (const [key, raw] of Object.entries(detail)) {
    if (HIDDEN_DETAIL_KEYS.has(key)) {
      continue;
    }
    if (raw === null || raw === undefined || raw === '') {
      continue;
    }
    const value = renderDetailValue(f, key, raw, currency);
    if (!value || value === '—') {
      continue;
    }
    pairs.push({ key, label: detailKeyLabel(L, key), value });
  }
  return pairs;
}

/**
 * Build the human-readable `detail` line shown beneath each timeline row:
 * the status transition (RTL-aware arrow) first, then "Label: value" pairs
 * separated by a middle dot. Empty when there is nothing to show.
 */
function buildDetailLine(
  f: LexFormatter,
  L: AuditFeedLabels,
  SL: SettlementLabels,
  entry: SettlementAuditEntry,
): string | undefined {
  const segments: string[] = [];

  if (entry.from_status || entry.to_status) {
    const fromLabel = entry.from_status
      ? settlementStatusLabel(SL, entry.from_status)
      : L.notSet;
    const toLabel = entry.to_status ? settlementStatusLabel(SL, entry.to_status) : L.notSet;
    segments.push(L.transition(fromLabel, toLabel));
  }

  for (const pair of detailPairs(f, L, entry)) {
    segments.push(`${pair.label}: ${pair.value}`);
  }

  return segments.length > 0 ? segments.join(' · ') : undefined;
}

/* ------------------------------------------------------------------------- *
 * Component.
 * ------------------------------------------------------------------------- */

const ALL_ACTIONS = '__all__';

export interface SettlementAuditFeedProps {
  settlementId: string;
}

export function SettlementAuditFeed({ settlementId }: SettlementAuditFeedProps) {
  const L = useAuditFeedLabels();
  const SL = useSettlementLabels();
  const f = useLexFormat();

  const [actionFilter, setActionFilter] = useState<string>(ALL_ACTIONS);

  const auditQuery = useQuery({
    queryKey: ['lex-settlement-audit', settlementId],
    queryFn: () => settlementsApi.listAudit(settlementId),
    enabled: Boolean(settlementId),
  });

  // Shared user directory (same key as the delay-event register so a single
  // fetch warms both); resolves actor_user_id → display name.
  const usersQuery = useQuery({
    queryKey: ['lex-user-directory'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200 }),
    staleTime: 5 * 60 * 1000,
  });
  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of usersQuery.data?.data ?? []) {
      map.set(u.id, userDisplayName(u));
    }
    return map;
  }, [usersQuery.data]);

  const entries = useMemo(
    () =>
      [...(auditQuery.data ?? [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [auditQuery.data],
  );

  // Distinct actions present, for the filter dropdown.
  const actionOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const e of entries) {
      seen.add(e.action);
    }
    return [...seen].sort();
  }, [entries]);

  const visibleEntries = useMemo(
    () =>
      actionFilter === ALL_ACTIONS
        ? entries
        : entries.filter((e) => e.action === actionFilter),
    [entries, actionFilter],
  );

  // Shape audit entries into the shared timeline's event model so this feed
  // tells the same governance story as every other Lex detail page.
  const timelineEvents = useMemo<LexActivityEvent[]>(
    () =>
      visibleEntries.map((entry) => ({
        id: entry.id,
        actor: { name: resolveActorName(L, userMap, entry.actor_user_id) },
        action: humanizeAction(L, entry.action),
        at: entry.created_at,
        tone: actionTone(entry.action),
        detail: buildDetailLine(f, L, SL, entry),
      })),
    [visibleEntries, userMap, L, SL, f],
  );

  const filterControl =
    actionOptions.length > 1 ? (
      <Select value={actionFilter} onValueChange={setActionFilter}>
        <SelectTrigger className="h-9 w-auto min-w-[11rem] gap-2">
          <ListFilter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <SelectValue placeholder={L.filter.label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_ACTIONS}>{L.filter.all}</SelectItem>
          {actionOptions.map((action) => (
            <SelectItem key={action} value={action}>
              {humanizeAction(L, action)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : undefined;

  let body: React.ReactNode;
  if (auditQuery.isLoading) {
    body = <LoadingSkeleton variant="list-item" count={3} />;
  } else if (auditQuery.isError) {
    body = <ErrorState message={L.errorMessage} onRetry={() => void auditQuery.refetch()} />;
  } else if (entries.length === 0) {
    body = (
      <EmptyState
        icon={ShieldCheck}
        title={L.emptyTitle}
        description={L.emptyDescription}
      />
    );
  } else if (visibleEntries.length === 0) {
    body = (
      <EmptyState
        icon={ListFilter}
        title={L.filteredEmptyTitle}
        description={L.filteredEmptyDescription}
      />
    );
  } else {
    body = (
      <LexActivityTimeline events={timelineEvents} emptyLabel={L.emptyDescription} />
    );
  }

  return (
    <SectionCard title={L.title} description={L.description} actions={filterControl}>
      {body}
    </SectionCard>
  );
}

/* ------------------------------------------------------------------------- *
 * Actor resolution — directory display name, else a shortened, readable id.
 * ------------------------------------------------------------------------- */

function resolveActorName(
  L: AuditFeedLabels,
  userMap: Map<string, string>,
  actorUserId: string,
): string {
  const resolved = userMap.get(actorUserId);
  if (resolved) {
    return resolved;
  }
  return L.actor.unknownTooltip(`${actorUserId.slice(0, 8)}…`);
}
