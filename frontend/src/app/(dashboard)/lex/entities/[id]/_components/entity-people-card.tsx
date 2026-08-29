'use client';

/**
 * ENTITY-360 detail — right-rail Organization / people card (#5).
 *
 * An entity is a counterparty PROFILE aggregated from contracts, cases and
 * settlements — the source records name only the ORGANIZATION, never a person,
 * email or representative. So this card surfaces the honest "who": an org avatar
 * + display name (`dir="auto"`), a copyable normalized match key (the stable id
 * the aggregator groups on), last-activity, and the client's litigation posture
 * toward this counterparty (plaintiff / defendant split + active contracts). It
 * states plainly that no named representatives are on record rather than faking a
 * contact list.
 *
 * Presentational + derived from the `entity` prop — no fetch. Mirrors the
 * service-desk `RequestPeopleCard` structure (avatar + copyable id + roster).
 */

import { useState } from 'react';
import { Building2, CheckCircle2, Copy, FileText, Gavel, Users } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { showSuccess } from '@/lib/toast';
import type { LexFormatter } from '@/lib/lex/ksa';
import type { EntityFootprint } from '../../_lib/entity-data';
import { useEntityDetailLabels } from './entity-detail-labels';

export interface EntityPeopleCardProps {
  entity: EntityFootprint;
  f: LexFormatter;
  className?: string;
}

function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function CopyKeyButton({ value, label, doneLabel }: { value: string; label: string; doneLabel: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(doneLabel);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Low-stakes copy — the key stays visible/selectable on failure.
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

function RelationshipRow({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof Gavel;
  label: string;
  tone: 'info' | 'warning' | 'primary';
}) {
  const toneClass =
    tone === 'info'
      ? 'text-info-600 dark:text-info-300'
      : tone === 'warning'
        ? 'text-warning-600 dark:text-warning-300'
        : 'text-primary';
  return (
    <li className="flex items-center gap-2">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', toneClass)} aria-hidden />
      <span className="min-w-0 truncate text-xs font-medium text-foreground">{label}</span>
    </li>
  );
}

export function EntityPeopleCard({ entity, f, className }: EntityPeopleCardProps) {
  const t = useEntityDetailLabels().people;

  const lastActivity = entity.lastActivityAt ? f.formatRelative(entity.lastActivityAt) : '—';

  const rows: { key: string; icon: typeof Gavel; label: string; tone: 'info' | 'warning' | 'primary' }[] = [];
  if (entity.asPlaintiffCount > 0) {
    rows.push({
      key: 'plaintiff',
      icon: Gavel,
      label: t.asPlaintiff(f.formatNumber(entity.asPlaintiffCount)),
      tone: 'info',
    });
  }
  if (entity.asDefendantCount > 0) {
    rows.push({
      key: 'defendant',
      icon: Gavel,
      label: t.asDefendant(f.formatNumber(entity.asDefendantCount)),
      tone: 'warning',
    });
  }
  if (entity.activeContractCount > 0) {
    rows.push({
      key: 'active-contracts',
      icon: FileText,
      label: t.activeContracts(f.formatNumber(entity.activeContractCount)),
      tone: 'primary',
    });
  }

  return (
    <SectionCard title={t.title} className={className}>
      <div className="space-y-4">
        {/* Organization identity */}
        <div className="flex items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[image:var(--ds-gradient-primary)] text-xs font-semibold text-primary-foreground shadow-elevation-1 ring-1 ring-inset ring-white/15"
            aria-hidden
          >
            {orgInitials(entity.name) || <Building2 className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm font-semibold text-foreground" dir="auto" title={entity.name}>
              {entity.name}
            </p>
            <p className="text-xs text-muted-foreground">{t.organization}</p>
            <div className="flex items-center gap-1">
              <p
                className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
                dir="ltr"
                title={entity.key}
              >
                {entity.key}
              </p>
              <CopyKeyButton value={entity.key} label={t.copyKey} doneLabel={t.copied} />
            </div>
          </div>
        </div>

        <div className="h-px bg-border/70" aria-hidden />

        {/* Relationship posture */}
        {rows.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {t.relationship}
            </p>
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <RelationshipRow key={row.key} icon={row.icon} label={row.label} tone={row.tone} />
              ))}
            </ul>
          </div>
        ) : null}

        {/* Last activity + honest representatives gap */}
        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{t.lastActivity}</span>
            <span className="font-medium text-foreground">{lastActivity}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t.noRepresentatives}</p>
        </div>
      </div>
    </SectionCard>
  );
}
