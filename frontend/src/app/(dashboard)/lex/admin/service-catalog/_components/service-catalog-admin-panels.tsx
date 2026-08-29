'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import { useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Mail, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import type { IntakeMailbox, ServiceCatalogEntry, SLATarget } from '@/lib/lex/admin';
import { useServiceCatalogLabels } from '../../_lib/admin-labels';

/**
 * The health detector only reads {id, address, request_type, service_id, active}
 * off a mailbox row, but the page now loads the full {@link IntakeMailbox}
 * records (so the admin section can edit them). Alias the shared type to keep a
 * single source of truth and avoid a duplicate shape drifting from the model.
 */
export type IntakeMailboxSummary = IntakeMailbox;

interface Props {
  services: ServiceCatalogEntry[];
  slaTargets: SLATarget[];
  mailboxes: IntakeMailboxSummary[];
  locale: AppLocale;
  loading?: boolean;
}

interface Issue {
  id: string;
  tone: 'destructive' | 'warning';
  title: string;
  detail: string;
}

function grouped(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const value of values.filter(Boolean)) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return map;
}

export function ServiceCatalogAdminPanels({ services, slaTargets, mailboxes, locale, loading }: Props) {
  const labels = useServiceCatalogLabels();
  const ap = labels.adminPanels;
  const issues = useMemo<Issue[]>(() => {
    const next: Issue[] = [];
    const codeCounts = grouped(services.map((service) => service.code));
    for (const [code, count] of codeCounts.entries()) {
      if (count > 1) {
        next.push({
          id: `code:${code}`,
          tone: 'destructive',
          title: ap.dupCodeTitle,
          detail: ap.dupCodeDetail(code, count),
        });
      }
    }

    const requestTypeCounts = grouped(services.filter((service) => service.active).map((service) => service.request_type));
    for (const [requestType, count] of requestTypeCounts.entries()) {
      if (count > 1) {
        next.push({
          id: `request-type:${requestType}`,
          tone: 'warning',
          title: ap.requestCollisionTitle,
          detail: ap.requestCollisionDetail(count, requestType),
        });
      }
    }

    const activeSlaCodes = new Set(slaTargets.filter((target) => target.active).map((target) => target.service_code));
    for (const service of services.filter((row) => row.active)) {
      if (!activeSlaCodes.has(service.code)) {
        next.push({
          id: `sla:${service.id}`,
          tone: 'warning',
          title: ap.missingSlaTitle,
          detail: ap.missingSlaDetail(service.code),
        });
      }
    }

    for (const service of services.filter((row) => row.active && (row.channel === 'email' || row.channel === 'both'))) {
      const hasMailbox = mailboxes.some(
        (mailbox) =>
          mailbox.active &&
          (mailbox.service_id === service.id ||
            mailbox.request_type === service.request_type ||
            (service.intake_email && mailbox.address === service.intake_email)),
      );
      if (!hasMailbox) {
        next.push({
          id: `mailbox:${service.id}`,
          tone: 'destructive',
          title: ap.emailNotWiredTitle,
          detail: ap.emailNotWiredDetail(service.code),
        });
      }
    }

    return next;
  }, [mailboxes, services, slaTargets, ap]);

  const published = services.filter((service) => service.active).length;
  const draft = services.length - published;
  const emailReady = services.filter((service) => service.channel === 'email' || service.channel === 'both').length;

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{ap.detectorTitle}</h3>
            <p className="text-xs text-muted-foreground">{ap.detectorHint}</p>
          </div>
          <Badge variant={issues.length ? 'destructive' : 'default'}>
            {loading ? ap.checking : issues.length ? ap.issuesCount(issues.length) : ap.noIssues}
          </Badge>
        </div>
        {issues.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-success-600" />
            {ap.noIssuesDetail}
          </div>
        ) : (
          <div className="space-y-2">
            {issues.slice(0, 8).map((issue) => (
              <div key={issue.id} className="flex items-start gap-2 rounded-md border bg-muted/20 p-3">
                <AlertTriangle
                  className={issue.tone === 'destructive' ? 'mt-0.5 h-4 w-4 text-destructive' : 'mt-0.5 h-4 w-4 text-warning-700 dark:text-warning-300'}
                />
                <div>
                  <p className="text-sm font-medium">{issue.title}</p>
                  <p className="text-xs text-muted-foreground">{issue.detail}</p>
                </div>
              </div>
            ))}
            {issues.length > 8 ? <p className="text-xs text-muted-foreground">{ap.moreHidden(issues.length - 8)}</p> : null}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div>
          <h3 className="text-sm font-semibold">{ap.statusTitle}</h3>
          <p className="text-xs text-muted-foreground">{ap.statusHint}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StatusTile icon={CheckCircle2} label={labels.panels.published} value={published} href="/lex/admin/service-catalog?active=true" />
          <StatusTile icon={Timer} label={labels.panels.draft} value={draft} href="/lex/admin/service-catalog?active=false" />
          <StatusTile icon={Mail} label={labels.panels.emailServices} value={emailReady} href="/lex/admin/service-catalog?channel=email&channel=both" />
        </div>
        <div className="space-y-2">
          {services.slice(0, 4).map((service) => (
            <div key={service.id} className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{resolveLocalized(service.name, locale) || service.code}</p>
                <p className="truncate text-xs text-muted-foreground">{service.code}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant={service.active ? 'default' : 'outline'}>{service.active ? labels.panels.published : labels.panels.draft}</Badge>
                <Badge variant="secondary">{labels.channels[service.channel] ?? service.channel}</Badge>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      title={statisticHint(label)}
      className="rounded-md border bg-muted/20 p-3 outline-none transition-colors hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="mb-2 h-4 w-4 text-primary" />
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Link>
  );
}
