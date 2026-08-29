'use client';

import Link from 'next/link';
import { BadgeAlert, Radar, Server } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { ROUTES } from '@/lib/constants';
import {
  ALERT_STATUS_CONFIG,
  alertConfidencePercent,
  getAlertStatusVariant,
} from '@/lib/cyber-alerts';
import { formatDateTime } from '@/lib/utils';
import { getAvatarColor, getInitials } from '@/lib/format';
import type { CyberAlert } from '@/types/cyber';

import { AlertActions } from './alert-actions';
import { ConfidenceGauge } from './confidence-gauge';
import { useAlertLabels } from '../../_lib/alerts-i18n';

interface AlertHeaderProps {
  alert: CyberAlert;
  onUpdated: () => void;
}

export function AlertHeader({ alert, onUpdated }: AlertHeaderProps) {
  const t = useAlertLabels();
  const assignedName = alert.assigned_to_name ?? '';
  const [firstName, ...rest] = assignedName.split(' ');
  const lastName = rest.join(' ');
  const initials = getInitials(firstName || '?', lastName || '');
  const avatarTone = getAvatarColor(assignedName || alert.assigned_to_email || 'analyst');
  const assetLabel = alert.asset_name ?? alert.asset_hostname ?? alert.asset_ip_address;

  return (
    <div className="rounded-softest surface-panel p-6">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityIndicator severity={alert.severity} showLabel />
              <StatusBadge
                status={alert.status}
                config={ALERT_STATUS_CONFIG}
                variant={getAlertStatusVariant(alert.status)}
              />
              {alert.mitre_technique_id && (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {alert.mitre_technique_id}
                </Badge>
              )}
              {alert.mitre_tactic_name && (
                <Badge variant="secondary" className="text-[11px]">
                  {alert.mitre_tactic_name}
                </Badge>
              )}
            </div>

            <div className="space-y-2">
              <h1 className="text-h1 font-semibold text-foreground">
                {alert.title}
              </h1>
              <p className="max-w-4xl text-sm leading-7 text-foreground/70">
                {alert.description || t.header.noDescription}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <HeaderFact
              icon={BadgeAlert}
              label={t.header.eventsCorrelated}
              value={String(alert.event_count)}
              caption={t.header.source(alert.source)}
            />
            <HeaderFact
              icon={Radar}
              label={t.header.firstSeen}
              value={formatDateTime(alert.first_event_at)}
              caption={t.header.lastSeen(formatDateTime(alert.last_event_at))}
            />
            <HeaderFact
              icon={Server}
              label={t.header.affectedAsset}
              value={assetLabel ?? t.header.noLinkedAsset}
              caption={alert.asset_criticality ? t.header.criticality(alert.asset_criticality) : t.header.assetContextUnavailable}
              href={alert.asset_id ? `${ROUTES.CYBER_ASSETS}/${alert.asset_id}` : undefined}
            />
            <div className="rounded-2xl border bg-card/75 p-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className={`${avatarTone} text-sm font-semibold text-white`}>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                    {t.header.assignedAnalyst}
                  </p>
                  <p className="truncate text-sm font-medium text-foreground">
                    {alert.assigned_to_name ?? t.header.unassigned}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {alert.assigned_to_email ?? t.header.noAnalystAttached}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex w-full max-w-sm flex-col gap-4">
          <ConfidenceGauge score={alertConfidencePercent(alert.confidence_score)} size="lg" />
          <div className="rounded-2xl border bg-card/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
              {t.header.analystActions}
            </p>
            <div className="mt-3">
              <AlertActions alert={alert} onUpdated={onUpdated} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface HeaderFactProps {
  icon: typeof BadgeAlert;
  label: string;
  value: string;
  caption: string;
  href?: string;
}

function HeaderFact({ icon: Icon, label, value, caption, href }: HeaderFactProps) {
  const body = (
    <div className="rounded-2xl border bg-card/75 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {label}
          </p>
          <p className="truncate text-sm font-medium text-foreground">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{caption}</p>
        </div>
      </div>
    </div>
  );

  if (!href) {
    return body;
  }

  return (
    <Link href={href} className="block">
      {body}
    </Link>
  );
}
