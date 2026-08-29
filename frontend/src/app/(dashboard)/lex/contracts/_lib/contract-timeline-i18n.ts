'use client';

/**
 * Bilingual labels for synthesised contract timeline events.
 *
 * The backend builds these events in `contract_service.go` with **hardcoded
 * Arabic** `title`/`description` (e.g. "تغيّرت الحالة"), so an English-mode user
 * saw Arabic history entries. It does, however, emit a stable `event_type` token
 * and structured `metadata` alongside them — which is everything needed to
 * render the label in the reader's own language.
 *
 * So the label is resolved HERE from the token, exactly as the case, settlement
 * and investigation audit feeds already do, rather than trusting the server's
 * pre-rendered prose. The server strings survive as the fallback for any event
 * type this module does not yet know, so a new backend event degrades to
 * "Arabic in an English UI" rather than to a blank row.
 *
 * Fixing it this way needs no backend change, no migration, and covers every
 * event type at once.
 */

import type { AppLocale } from '@/lib/i18n';

/** The subset of a timeline event this module needs. */
export interface TimelineEventLike {
  event_type?: string | null;
  title?: string | null;
  description?: string | null;
  actor?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ResolvedTimelineEvent {
  title: string;
  description: string;
  /** Display name for the actor, or null when there is no meaningful one. */
  actor: string | null;
}

const TITLES: Record<string, { en: string; ar: string }> = {
  contract_created: { en: 'Contract created', ar: 'تم إنشاء العقد' },
  status_changed: { en: 'Status changed', ar: 'تغيّرت الحالة' },
  analysis_completed: { en: 'Analysis completed', ar: 'اكتمل التحليل' },
  workflow_linked: { en: 'Workflow linked', ar: 'تم ربط سير العمل' },
  version_uploaded: { en: 'Version uploaded', ar: 'تم رفع نسخة' },
};

const CONTRACT_STATUSES: Record<string, { en: string; ar: string }> = {
  draft: { en: 'Draft', ar: 'مسودة' },
  internal_review: { en: 'Internal review', ar: 'مراجعة داخلية' },
  under_review: { en: 'Under review', ar: 'قيد المراجعة' },
  negotiation: { en: 'Negotiation', ar: 'تفاوض' },
  pending_approval: { en: 'Pending approval', ar: 'بانتظار الموافقة' },
  approved: { en: 'Approved', ar: 'معتمد' },
  pending_signature: { en: 'Pending signature', ar: 'بانتظار التوقيع' },
  active: { en: 'Active', ar: 'ساري' },
  expired: { en: 'Expired', ar: 'منتهي' },
  terminated: { en: 'Terminated', ar: 'مفسوخ' },
  renewed: { en: 'Renewed', ar: 'مجدد' },
  archived: { en: 'Archived', ar: 'مؤرشف' },
};

const RISK_LEVELS: Record<string, { en: string; ar: string }> = {
  low: { en: 'low', ar: 'منخفض' },
  medium: { en: 'medium', ar: 'متوسط' },
  high: { en: 'high', ar: 'مرتفع' },
  critical: { en: 'critical', ar: 'حرج' },
};

function pick(
  table: Record<string, { en: string; ar: string }>,
  key: unknown,
  ar: boolean,
): string | null {
  if (typeof key !== 'string' || key.length === 0) return null;
  const entry = table[key];
  if (!entry) return null;
  return ar ? entry.ar : entry.en;
}

/**
 * A bare uuid is not a person. The backend sets `actor` to a raw user id for
 * some events, which rendered as `2456d369-1037-…` where a name belongs. Until
 * the id is resolved to a display name, showing nothing is more honest than
 * showing an opaque identifier.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function displayActor(actor: string | null | undefined): string | null {
  const trimmed = actor?.trim();
  if (!trimmed || UUID_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Resolves one timeline event into the reader's locale. Unknown event types keep
 * the server-provided strings so nothing is ever rendered blank.
 */
export function resolveTimelineEvent(
  event: TimelineEventLike,
  locale: AppLocale,
): ResolvedTimelineEvent {
  const ar = locale === 'ar';
  const type = event.event_type ?? '';
  const meta = event.metadata ?? {};

  const title = pick(TITLES, type, ar) ?? event.title?.trim() ?? '';

  let description: string | null = null;
  switch (type) {
    case 'status_changed': {
      const status = pick(CONTRACT_STATUSES, meta.status, ar);
      if (status) {
        description = ar
          ? `انتقل العقد إلى حالة ${status}.`
          : `The contract moved to ${status}.`;
      }
      break;
    }
    case 'analysis_completed': {
      const risk = pick(RISK_LEVELS, meta.risk_level, ar);
      if (risk) {
        description = ar
          ? `حدّد أحدث تحليل مستوى الخطورة إلى ${risk}.`
          : `The latest analysis set the risk level to ${risk}.`;
      }
      break;
    }
    case 'workflow_linked':
      description = ar
        ? 'تم ربط سير عمل مراجعة العقد بهذا العقد.'
        : 'The contract review workflow was linked to this contract.';
      break;
    case 'contract_created':
      description = ar ? 'تم إنشاء هذا العقد.' : 'This contract was created.';
      break;
    default:
      break;
  }

  return {
    title,
    description: description ?? event.description?.trim() ?? '',
    actor: displayActor(event.actor),
  };
}
