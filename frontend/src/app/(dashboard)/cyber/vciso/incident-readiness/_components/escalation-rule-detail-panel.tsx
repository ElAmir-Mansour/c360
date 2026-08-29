'use client';

import {
  Zap,
  Target,
  Bell,
  Calendar,
  Clock,
  Hash,
  User,
} from 'lucide-react';
import { DetailPanel } from '@/components/shared/detail-panel';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { formatDate, titleCase } from '@/lib/format';
import type { VCISOEscalationRule } from '@/types/cyber';
import { useVcisoOpsLabels } from '../../_lib/vciso-i18n';

interface EscalationRuleDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: VCISOEscalationRule;
}

export function EscalationRuleDetailPanel({
  open,
  onOpenChange,
  rule,
}: EscalationRuleDetailPanelProps) {
  const labels = useVcisoOpsLabels().incidentReadiness.escalationRule;
  const t = labels.detail;
  const triggerTypeLabels = labels.triggerTypes as Record<string, string>;
  const targetLabels = labels.targets;

  return (
    <DetailPanel
      open={open}
      onOpenChange={onOpenChange}
      title={rule.name}
      description={t.subtitle}
      width="xl"
    >
      <div className="space-y-6">
        {/* Overview */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.overview}
          </h3>
          <p className="text-sm text-foreground leading-relaxed">
            {rule.description || t.noDescription}
          </p>
          <div className="flex items-center gap-2">
            <Badge variant={rule.enabled ? 'default' : 'secondary'}>
              {rule.enabled ? t.enabled : t.disabled}
            </Badge>
          </div>
        </div>

        <Separator />

        {/* Trigger Configuration */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.triggerConfig}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.triggerTypeLabel}</span>
              <Badge variant="outline">{triggerTypeLabels[rule.trigger_type] ?? titleCase(rule.trigger_type)}</Badge>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <Hash className="h-4 w-4 text-muted-foreground mt-0.5" />
              <span className="text-muted-foreground">{t.conditionLabel}</span>
              <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                {rule.trigger_condition}
              </span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Escalation Target */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.escalationTarget}
          </h3>
          <div className="flex items-center gap-2 text-sm">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{t.targetLabel}</span>
            <Badge variant="outline">{targetLabels[rule.escalation_target]?.() ?? titleCase(rule.escalation_target)}</Badge>
          </div>
        </div>

        {/* Target Contacts */}
        {rule.target_contacts.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.targetContacts}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {rule.target_contacts.map((contact) => (
                  <Badge key={contact} variant="secondary" className="text-xs">
                    <User className="me-1 h-3 w-3" />
                    {contact}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Notification Channels */}
        {rule.notification_channels.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.notificationChannels}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {rule.notification_channels.map((channel) => (
                  <Badge key={channel} variant="outline" className="text-xs capitalize">
                    <Bell className="me-1 h-3 w-3" />
                    {channel}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Trigger History */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.triggerHistory}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.triggerCount}</span>
              <span className="font-semibold">{rule.trigger_count}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.lastTriggered}</span>
              <span className="font-medium">
                {rule.last_triggered_at ? formatDate(rule.last_triggered_at) : t.never}
              </span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Timestamps */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t.timestamps}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.created}</span>
              <span className="font-medium">{formatDate(rule.created_at)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t.updated}</span>
              <span className="font-medium">{formatDate(rule.updated_at)}</span>
            </div>
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}
