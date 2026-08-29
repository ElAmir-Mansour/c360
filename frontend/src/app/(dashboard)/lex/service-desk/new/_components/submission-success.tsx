'use client';

/**
 * SubmissionSuccess — the post-submit CONFIRMATION screen for the "New Legal
 * Service Request" wizard. Replaces the wizard after create + submit succeeds:
 * the parent stores the submitted {@link LegalRequest} and renders this screen
 * in place of the step flow.
 *
 * Layout follows the stakeholder confirmation mockup (`request-confirmation-en`):
 *   - A success ring + "Request Submitted Successfully" + the REAL intake id
 *     (`request.request_number`, mono, copy-to-clipboard).
 *   - A "Request Summary" card (Service Type / current status / Priority badge /
 *     Submission Date) with a full-width "Go to Dashboard" primary action plus the
 *     existing "View request" / "Create another" actions.
 *   - A "Live Status Tracker" derived from the status returned by the submit
 *     endpoint: submitted → approval → routing → assigned-counsel review.
 *
 * Presentational + self-contained. All copy is a local bilingual bundle (EN / MSA
 * AR) resolved by the active locale — the Arabic is professional MSA pending the
 * localization-gate / termbase review, not treated as final. Logical-direction
 * CSS throughout (`ms/me`, `start/end`, centered timeline rail, `rtl:` mirrored
 * directional icons) so it renders correctly RTL with Arabic as the default.
 */

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  LayoutDashboard,
  Plus,
} from 'lucide-react';
import type {
  LegalRequest,
  RequestPriority,
  RequestStatus,
} from '@/lib/lex/requests';
import { useLexFormat } from '@/lib/lex/ksa';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  getServiceTypeConfig,
  resolveRequestTypeLabel,
} from '../_lib/service-type-config';

export interface SubmissionSuccessProps {
  request: LegalRequest;
  onCreateAnother: () => void;
}

/** In-suite "dashboard" destination — the Watheeq Legal Affairs role landing. */
const DASHBOARD_PATH = '/lex';

/**
 * Tracker node order. State is derived from the request status returned by the
 * submit endpoint; the confirmation never invents an AI-routing stage.
 */
const TRACKER_NODE_KEYS = ['submitted', 'approval', 'routing', 'review'] as const;
type TrackerNodeKey = (typeof TRACKER_NODE_KEYS)[number];
type TrackerNodeState = 'done' | 'current' | 'upcoming';

const REQUEST_STATUS_ORDER: Record<RequestStatus, number> = {
  draft: 0,
  submitted: 1,
  pending_requester_approval: 1,
  pending_provider_approval: 1,
  approved: 2,
  routed: 3,
  in_execution: 3,
  delivered: 4,
  closed: 4,
  returned: 1,
  cancelled: 1,
};

export function requestTrackerNodes(
  status: RequestStatus,
): Array<{ key: TrackerNodeKey; state: TrackerNodeState }> {
  const progress = REQUEST_STATUS_ORDER[status];
  return TRACKER_NODE_KEYS.map((key, index) => ({
    key,
    state:
      progress >= TRACKER_NODE_KEYS.length
        ? 'done'
        : index < progress
          ? 'done'
          : index === progress
            ? 'current'
            : 'upcoming',
  }));
}

/** Priority badge tone — mirrors the Step-2 priority selector tones. */
const PRIORITY_BADGE_VARIANT: Record<RequestPriority, BadgeProps['variant']> = {
  normal: 'success',
  urgent: 'warning',
  emergency: 'destructive',
};

interface ConfirmationCopy {
  regionAria: string;
  heading: string;
  intakeIdLabel: string;
  copyIntakeId: string;
  copyIntakeIdDone: string;
  summaryTitle: string;
  serviceTypeLabel: string;
  currentStatusLabel: string;
  status: Record<RequestStatus, string>;
  priorityLabel: string;
  submissionDateLabel: string;
  goToDashboard: string;
  viewRequest: string;
  createAnother: string;
  trackerTitle: string;
  priority: Record<RequestPriority, string>;
  nodes: Record<TrackerNodeKey, { title: string; desc: string }>;
}

/**
 * Local bilingual copy (EN / MSA AR). Arabic is professional MSA — FLAG for the
 * localization gate / termbase review; do not treat it as final.
 */
const COPY: { readonly en: ConfirmationCopy; readonly ar: ConfirmationCopy } = {
  en: {
    regionAria: 'Request submission confirmation',
    heading: 'Request Submitted Successfully',
    intakeIdLabel: 'Intake ID',
    copyIntakeId: 'Copy intake ID',
    copyIntakeIdDone: 'Intake ID copied.',
    summaryTitle: 'Request Summary',
    serviceTypeLabel: 'Service Type',
    currentStatusLabel: 'Current Status',
    status: {
      draft: 'Draft',
      submitted: 'Submitted',
      pending_requester_approval: 'Pending requester approval',
      pending_provider_approval: 'Pending provider approval',
      approved: 'Approved',
      routed: 'Routed',
      in_execution: 'In execution',
      delivered: 'Delivered',
      closed: 'Closed',
      returned: 'Returned for revision',
      cancelled: 'Cancelled',
    },
    priorityLabel: 'Priority',
    submissionDateLabel: 'Submission Date',
    goToDashboard: 'Go to Dashboard',
    viewRequest: 'View request',
    createAnother: 'Create another',
    trackerTitle: 'Live Status Tracker',
    priority: { normal: 'Normal', urgent: 'Urgent', emergency: 'Emergency' },
    nodes: {
      submitted: {
        title: 'Intake Submitted',
        desc: 'Your legal request was logged successfully.',
      },
      approval: {
        title: 'Approval & Triage',
        desc: 'Required requester or provider approvals are completed.',
      },
      routing: {
        title: 'Legal Routing',
        desc: 'The approved request is routed to the responsible legal team.',
      },
      review: {
        title: 'Assigned Counsel Review',
        desc: 'Legal specialist starts reviewing terms.',
      },
    },
  },
  ar: {
    regionAria: 'تأكيد تقديم الطلب',
    heading: 'تم إرسال الطلب بنجاح',
    intakeIdLabel: 'رقم الطلب',
    copyIntakeId: 'نسخ رقم الطلب',
    copyIntakeIdDone: 'تم نسخ رقم الطلب.',
    summaryTitle: 'ملخص الطلب',
    serviceTypeLabel: 'نوع الخدمة',
    currentStatusLabel: 'الحالة الحالية',
    status: {
      draft: 'مسودة',
      submitted: 'مُقدّم',
      pending_requester_approval: 'بانتظار موافقة مقدم الطلب',
      pending_provider_approval: 'بانتظار موافقة مقدم الخدمة',
      approved: 'معتمد',
      routed: 'موجّه',
      in_execution: 'قيد التنفيذ',
      delivered: 'تم التسليم',
      closed: 'مغلق',
      returned: 'مُعاد للمراجعة',
      cancelled: 'ملغى',
    },
    priorityLabel: 'الأولوية',
    submissionDateLabel: 'تاريخ الإرسال',
    goToDashboard: 'الذهاب إلى لوحة التحكم',
    viewRequest: 'عرض الطلب',
    createAnother: 'إنشاء طلب آخر',
    trackerTitle: 'متتبّع الحالة المباشر',
    priority: { normal: 'عادية', urgent: 'عاجلة', emergency: 'طارئة' },
    nodes: {
      submitted: {
        title: 'تم استلام الطلب',
        desc: 'تم تسجيل طلبك القانوني بنجاح.',
      },
      approval: {
        title: 'الموافقة والفرز',
        desc: 'تُستكمل موافقات مقدم الطلب أو مقدم الخدمة المطلوبة.',
      },
      routing: {
        title: 'التوجيه القانوني',
        desc: 'يُوجّه الطلب المعتمد إلى الفريق القانوني المسؤول.',
      },
      review: {
        title: 'مراجعة المستشار المكلّف',
        desc: 'يبدأ المختص القانوني بمراجعة التفاصيل.',
      },
    },
  },
};

export default function SubmissionSuccess({ request, onCreateAnother }: SubmissionSuccessProps) {
  const f = useLexFormat();
  const locale = f.locale === 'ar' ? 'ar' : 'en';
  const t = COPY[locale];
  const [numberCopied, setNumberCopied] = useState(false);

  const requestPath = `/lex/service-desk/${request.id}`;
  const ServiceIcon = getServiceTypeConfig(request.request_type).icon;
  const serviceLabel = resolveRequestTypeLabel(request.request_type, f.locale);
  const priorityLabel = t.priority[request.priority] ?? request.priority;
  const priorityVariant = PRIORITY_BADGE_VARIANT[request.priority] ?? 'outline';
  const statusLabel = t.status[request.status] ?? request.status;
  const trackerNodes = requestTrackerNodes(request.status);
  const submissionDate = f.formatDate(request.created_at, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const onCopyNumber = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(request.request_number)
      .then(() => {
        showSuccess(t.copyIntakeIdDone);
        setNumberCopied(true);
        window.setTimeout(() => setNumberCopied(false), 2000);
      })
      .catch(() => {
        /* clipboard unavailable — no-op, the id stays visible/selectable */
      });
  };

  return (
    <section aria-label={t.regionAria} className="mx-auto w-full max-w-3xl space-y-6">
      {/* Hero: success ring + heading + intake id */}
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-success-500/10 text-success-600 ring-8 ring-success-500/5 dark:text-success-300"
          aria-hidden
        >
          <CheckCircle2 className="h-11 w-11" />
        </span>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{t.heading}</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t.intakeIdLabel}:</span>
          <span className="select-all font-mono text-base font-semibold tracking-wide text-foreground" dir="ltr">
            #{request.request_number}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCopyNumber}
            aria-label={t.copyIntakeId}
            title={t.copyIntakeId}
          >
            {numberCopied ? (
              <Check className="h-4 w-4 text-success-600 dark:text-success-300" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Two cards: Request Summary + Live Status Tracker */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Request Summary */}
        <SectionCard title={t.summaryTitle}>
          <div className="space-y-4">
            <dl className="divide-y divide-border/70">
              <SummaryRow label={t.serviceTypeLabel}>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                    aria-hidden
                  >
                    <ServiceIcon className="h-3.5 w-3.5" />
                  </span>
                  <span>{serviceLabel}</span>
                </span>
              </SummaryRow>
              <SummaryRow label={t.currentStatusLabel}>{statusLabel}</SummaryRow>
              <SummaryRow label={t.priorityLabel}>
                <Badge variant={priorityVariant}>{priorityLabel}</Badge>
              </SummaryRow>
              <SummaryRow label={t.submissionDateLabel}>{submissionDate}</SummaryRow>
            </dl>

            <div className="space-y-2 pt-1">
              <Button asChild className="w-full">
                <Link href={DASHBOARD_PATH}>
                  <LayoutDashboard className="me-1.5 h-4 w-4" />
                  {t.goToDashboard}
                </Link>
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild variant="outline" className="sm:flex-1">
                  <Link href={requestPath}>
                    <ExternalLink className="me-1.5 h-4 w-4 rtl:-scale-x-100" />
                    {t.viewRequest}
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCreateAnother}
                  className="sm:flex-1"
                >
                  <Plus className="me-1.5 h-4 w-4" />
                  {t.createAnother}
                </Button>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Live Status Tracker */}
        <SectionCard title={t.trackerTitle}>
          <ol className="space-y-0">
            {trackerNodes.map((node, index) => {
              const copy = t.nodes[node.key];
              const isLast = index === trackerNodes.length - 1;
              return (
                <li
                  key={node.key}
                  className="flex gap-4"
                  aria-current={node.state === 'current' ? 'step' : undefined}
                >
                  {/* Marker rail (centered — direction-agnostic) */}
                  <div className="flex flex-col items-center">
                    <TrackerMarker state={node.state} />
                    {!isLast ? (
                      <span
                        className={cn(
                          'w-0.5 flex-1',
                          node.state === 'done' ? 'bg-success-500/50' : 'bg-border',
                        )}
                        aria-hidden
                      />
                    ) : null}
                  </div>
                  {/* Content */}
                  <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-6')}>
                    <p
                      className={cn(
                        'text-sm font-semibold',
                        node.state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {copy.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{copy.desc}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </SectionCard>
      </div>
    </section>
  );
}

/** One label→value row in the Request Summary definition list. */
function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/** The circular marker for one tracker node — done / current / upcoming. */
function TrackerMarker({ state }: { state: TrackerNodeState }) {
  if (state === 'done') {
    return (
      <span
        className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-500 text-white"
        aria-hidden
      >
        <Check className="h-4 w-4" />
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span
        className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-success-500 bg-success-50 ring-4 ring-success-500/15 dark:bg-success-500/15"
        aria-hidden
      >
        <span className="h-2.5 w-2.5 rounded-full bg-success-500" />
      </span>
    );
  }
  return (
    <span
      className="relative z-10 h-8 w-8 shrink-0 rounded-full border-2 border-border bg-muted"
      aria-hidden
    />
  );
}
