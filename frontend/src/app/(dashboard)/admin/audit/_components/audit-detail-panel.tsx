'use client';

import { Bot, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { DetailPanel } from '@/components/shared/detail-panel';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { formatDateTime, copyToClipboard } from '@/lib/utils';
import type { AuditLog } from '@/types/models';
import { formatAuditAction } from './audit-columns';
import { JsonDiffViewer } from './json-diff-viewer';
import { useAdminLabels } from '../../_lib/admin-i18n';

interface AuditDetailPanelProps {
  log: AuditLog;
  open: boolean;
  onClose: () => void;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const labels = useAdminLabels();
  return (
    <button
      onClick={async () => {
        await copyToClipboard(value);
        toast.success(labels.auditPanel.copied.replace('{label}', label));
      }}
      className="ms-1 inline-flex items-center text-muted-foreground hover:text-foreground"
      title={labels.auditPanel.copyTitle.replace('{label}', label)}
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}

export function AuditDetailPanel({ log, open, onClose }: AuditDetailPanelProps) {
  const labels = useAdminLabels();
  const isSystem = !log.user_id || log.user_email === 'system';

  return (
    <DetailPanel
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={formatAuditAction(log.action)}
      description={formatDateTime(log.created_at)}
      width="lg"
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          {log.severity && (
            <SeverityIndicator
              severity={
                log.severity === 'warning'
                  ? 'medium'
                  : log.severity === 'high'
                  ? 'high'
                  : log.severity === 'critical'
                  ? 'critical'
                  : 'info'
              }
            />
          )}
          <span className="text-xs font-mono text-muted-foreground">
            {log.id.slice(0, 16)}...
            <CopyButton value={log.id} label={labels.fields.entryId} />
          </span>
        </div>

        <Separator />

        {/* Context */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">{labels.auditPanel.context}</h4>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground w-28 shrink-0">{labels.fields.user}</dt>
              <dd>
                {isSystem ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Bot className="h-3.5 w-3.5" /> {labels.common.system}
                  </span>
                ) : (
                  log.user_email
                )}
              </dd>
            </div>
            {log.service && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground w-28 shrink-0">{labels.fields.service}</dt>
                <dd>
                  <Badge variant="outline" className="text-xs">{log.service}</Badge>
                </dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="text-muted-foreground w-28 shrink-0">{labels.fields.resource}</dt>
              <dd>
                {log.resource_type}
                {log.resource_id && (
                  <span className="ms-1 font-mono text-xs text-muted-foreground">
                    {log.resource_id}
                    <CopyButton value={log.resource_id} label={labels.fields.resourceId} />
                  </span>
                )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground w-28 shrink-0">{labels.fields.ipAddress}</dt>
              <dd className="font-mono text-xs">{log.ip_address || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground w-28 shrink-0">{labels.fields.userAgent}</dt>
              <dd className="text-xs text-muted-foreground truncate max-w-xs" title={log.user_agent}>
                {log.user_agent || '—'}
              </dd>
            </div>
            {log.correlation_id && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground w-28 shrink-0">{labels.fields.correlationId}</dt>
                <dd className="font-mono text-xs">
                  {log.correlation_id}
                  <CopyButton value={log.correlation_id} label={labels.fields.correlationId} />
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Changes */}
        {(log.old_value !== undefined || log.new_value !== undefined) && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-medium">{labels.auditPanel.changes}</h4>
              <JsonDiffViewer oldValue={log.old_value} newValue={log.new_value} />
            </div>
          </>
        )}

        {/* Hash Chain */}
        {log.entry_hash && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-medium">{labels.auditPanel.hashChain}</h4>
              <dl className="space-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground mb-0.5">{labels.fields.entryHash}</dt>
                  <dd className="font-mono break-all text-foreground">
                    {log.entry_hash}
                    <CopyButton value={log.entry_hash} label={labels.fields.entryHash} />
                  </dd>
                </div>
                {log.previous_hash && (
                  <div>
                    <dt className="text-muted-foreground mb-0.5">{labels.fields.previousHash}</dt>
                    <dd className="font-mono break-all text-muted-foreground">
                      {log.previous_hash}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </>
        )}

        {/* Metadata */}
        {Object.keys(log.metadata ?? {}).length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-medium">{labels.auditPanel.metadata}</h4>
              <dl className="space-y-1.5 text-xs">
                {Object.entries(log.metadata).map(([key, val]) => (
                  <div key={key} className="flex gap-2">
                    <dt className="text-muted-foreground w-28 shrink-0 font-mono">{key}</dt>
                    <dd className="font-mono text-foreground break-all">
                      {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        )}
      </div>
    </DetailPanel>
  );
}
