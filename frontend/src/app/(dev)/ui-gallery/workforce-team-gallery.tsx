'use client';

import { useState } from 'react';

import { WorkforceTeamPanel } from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-team-panel';
import type {
  WorkforceMetricValue,
  WorkforceReport,
  WorkforceTeamMember,
} from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/workforce-contract';
import { LocaleProvider } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';

type GalleryState = 'populated' | 'loading' | 'empty' | 'error' | 'zero' | 'unavailable' | 'degraded';

const STATE_LABELS: Record<AppLocale, Record<GalleryState, string>> = {
  en: {
    populated: 'Populated', loading: 'Loading', empty: 'Empty', error: 'Error with retry',
    zero: 'Zero', unavailable: 'Unavailable metrics', degraded: 'Degraded scope',
  },
  ar: {
    populated: 'معبّأة', loading: 'جارٍ التحميل', empty: 'فارغة', error: 'خطأ مع إعادة المحاولة',
    zero: 'صفر', unavailable: 'مقاييس غير متاحة', degraded: 'نطاق متدهور',
  },
};

const STATES: GalleryState[] = ['populated', 'loading', 'empty', 'error', 'zero', 'unavailable', 'degraded'];

function available(value: number, numerator?: number, denominator?: number): WorkforceMetricValue {
  return { value, available: true, numerator, denominator };
}

function unavailable(reason: string): WorkforceMetricValue {
  return { value: null, available: false, reason };
}

function member(id: string, name: string, title: Record<string, string>, active: number): WorkforceTeamMember {
  return {
    userId: id,
    displayName: name,
    title,
    identityStatus: 'resolved',
    userStatus: 'active',
    linkedCount: 2,
    byDomain: [
      { domain: 'contracts', rel: 'owner', attributionPath: 'direct', open: active, resolved: 3 },
      { domain: 'requests', rel: 'advisor', attributionPath: 'linked', open: 0, resolved: 0 },
    ],
    metrics: {
      activeWorkload: available(active),
      loadIndexPct: available(active === 0 ? 0 : 125),
      utilisationPct: unavailable('capacity_formula_undefined'),
      completionRatePct: available(active === 0 ? 0 : 75, active === 0 ? 0 : 3, active === 0 ? 1 : 4),
      onTimePct: unavailable('aggregation_not_implemented'),
      medianCycleDays: available(active === 0 ? 0 : 4.5),
      approvalLatencyHrs: unavailable('workflow_attribution_undefined'),
      obligationDischargePct: available(active === 0 ? 0 : 80, active === 0 ? 0 : 4, 5),
      overdueCount: available(active === 0 ? 0 : 1),
      idleAssignmentPct: unavailable('workflow_attribution_undefined'),
    },
  };
}

function reportFor(state: GalleryState): WorkforceReport {
  const zero = state === 'zero';
  const degraded = state === 'degraded';
  const first = member('11111111-1111-4111-8111-111111111111', 'Layla Al-Hashimi', {
    en: 'Senior Legal Counsel', ar: 'مستشارة قانونية أولى',
  }, zero ? 0 : 10);
  const second = member('22222222-2222-4222-8222-222222222222', 'سارة الغامدي', {
    en: 'Contract Specialist', ar: 'أخصائية العقود',
  }, zero ? 0 : 4);
  if (zero) {
    second.metrics.utilisationPct = unavailable('no_capacity_configured');
    second.metrics.loadIndexPct = unavailable('no_capacity_configured');
  }
  if (degraded) {
    second.identityStatus = 'unverified';
    second.userStatus = 'inactive';
    second.avatarUrl = undefined;
  }
  return {
    scope: {
      mode: 'unscoped',
      entityIds: [],
      userIds: [first.userId, second.userId],
      memberCount: 2,
      reason: degraded ? 'roster_not_configured' : 'no_org_role',
      warning: degraded ? 'roster_stale' : undefined,
      staleDays: degraded ? 12 : undefined,
    },
    period: {
      from: '2026-07-02', to: '2026-07-31', timezone: degraded ? 'UTC' : 'Asia/Riyadh',
      calendarSource: degraded ? 'fallback_utc' : 'tenant',
      workingDays: degraded ? unavailable('calendar_unavailable') : available(22),
    },
    team: [first, second],
    rollup: {
      distributionGini: available(zero ? 0 : 0.21),
      keyPersonConcentrationPct: available(zero ? 0 : 71),
      backlogBurnPct: unavailable('aggregation_contract_undefined'),
      unroutedRequests: available(zero ? 0 : 3),
      aging: {
        d0_30: available(zero ? 0 : 9),
        d31_60: available(zero ? 0 : 3),
        d61_90: available(0),
        d90_plus: available(zero ? 0 : 2),
      },
    },
    coverage: {
      domainsRequested: 7, domainsReturned: degraded ? 5 : 7, itemsTotal: zero ? 0 : 59,
      itemsAttributed: zero ? 0 : 36, itemsUnattributed: zero ? 0 : 23,
      attributionPct: zero ? 0 : 61, rowsReturned: 2, rowsTruncated: degraded ? 4 : 0,
      exclusions: degraded
        ? [
            { domain: 'contracts', reason: 'forbidden' },
            { domain: 'cases', reason: 'query_error' },
          ]
        : [],
    },
    degraded,
    errors: degraded
      ? [
          { domain: 'contracts', kind: 'forbidden' },
          { domain: 'cases', kind: 'query_error', detail: 'gallery timeout fixture' },
        ]
      : [],
  };
}

function LocaleGallery({ locale, onRetry }: { locale: AppLocale; onRetry: () => void }) {
  return (
    <div className="space-y-8">
      {STATES.map((state) => (
        <article key={state} id={`workforce-team-${locale}-${state}`} className="space-y-3" data-workforce-gallery-state={state}>
          <h4 className="text-body font-semibold text-foreground">{STATE_LABELS[locale][state]}</h4>
          <div className="min-w-0 overflow-hidden rounded-softest border border-border bg-[var(--wt-canvas)] p-4 sm:p-6">
            {state === 'loading' ? <WorkforceTeamPanel state="loading" /> : null}
            {state === 'empty' ? <WorkforceTeamPanel state="empty" /> : null}
            {state === 'error' ? <WorkforceTeamPanel state="error" onRetry={onRetry} /> : null}
            {state === 'populated' ? <WorkforceTeamPanel state="ready" report={reportFor(state)} /> : null}
            {state === 'zero' ? <WorkforceTeamPanel state="zero" report={reportFor(state)} /> : null}
            {state === 'unavailable' ? <WorkforceTeamPanel state="unavailable" report={reportFor(state)} /> : null}
            {state === 'degraded' ? <WorkforceTeamPanel state="degraded" report={reportFor(state)} onRetry={onRetry} /> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function WorkforceTeamGallery() {
  const [retryCount, setRetryCount] = useState(0);
  return (
    <div className="space-y-10" data-workforce-team-gallery="">
      <p aria-live="polite" className="text-caption text-muted-foreground">Workforce retry interactions: {retryCount}</p>
      {(['en', 'ar'] as const).map((locale) => {
        const direction = locale === 'ar' ? 'rtl' : 'ltr';
        return (
          <section key={locale} className="space-y-5" aria-labelledby={`workforce-team-${locale}-heading`}>
            <h3 id={`workforce-team-${locale}-heading`} className="text-[length:var(--wt-font-size-panel-title)] font-bold leading-[var(--wt-line-height-panel-title)]">
              {locale === 'ar' ? 'العربية · من اليمين إلى اليسار' : 'English · LTR'}
            </h3>
            <LocaleProvider locale={locale} direction={direction} messages={getMessages(locale)}>
              <div dir={direction} lang={locale}>
                <LocaleGallery locale={locale} onRetry={() => setRetryCount((count) => count + 1)} />
              </div>
            </LocaleProvider>
          </section>
        );
      })}
    </div>
  );
}
