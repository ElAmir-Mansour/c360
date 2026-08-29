'use client';

import { CheckCircle2, Pencil, PowerOff, RefreshCw, TestTube2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SimpleTable } from '@/components/shared/simple-table';
import { StatusChip } from '@/components/shared/status-chip';
import { RelativeTime } from '@/components/shared/relative-time';
import type { DRIntegration } from '@/lib/clario-dr';
import {
  type IntegrationHealthCopy,
  presentationForStatus,
  statusLabel,
  useIntegrationHealthLabels,
} from './integration-health';
import { useIntegrationConstants } from './integration-constants';

interface IntegrationsTableProps {
  integrations: DRIntegration[];
  loading?: boolean;
  /** True while a write action is allowed (gated on dr:write upstream). */
  canWrite: boolean;
  /** Id of the integration whose test-connection request is in flight, if any. */
  testingId?: string | null;
  onEdit: (integration: DRIntegration) => void;
  onTest: (integration: DRIntegration) => void;
  onDelete: (integration: DRIntegration) => void;
}

// SimpleTable<T> requires T extends Record<string, unknown>; DRIntegration's index
// signature is satisfied via this row type so the generic narrows cleanly.
type IntegrationRow = DRIntegration & Record<string, unknown>;

export function IntegrationsTable({
  integrations,
  loading = false,
  canWrite,
  testingId,
  onEdit,
  onTest,
  onDelete,
}: IntegrationsTableProps) {
  const copy = useIntegrationHealthLabels();
  const constants = useIntegrationConstants();
  const rows = integrations as IntegrationRow[];

  return (
    <SimpleTable<IntegrationRow>
      loading={loading}
      data={rows}
      emptyMessage={copy.tableEmpty}
      columns={[
        {
          key: 'name',
          header: copy.colName,
          render: (item) => (
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{item.name}</span>
              <span className="break-all font-mono text-xs text-muted-foreground">
                {item.endpoint}
              </span>
            </div>
          ),
        },
        {
          key: 'kind',
          header: copy.colKind,
          render: (item) => (
            <Badge variant="outline">{constants.prettyIntegrationKind(item.kind)}</Badge>
          ),
        },
        {
          key: 'vendor',
          header: copy.colVendor,
          render: (item) => (
            <span className="text-sm">{constants.prettyIntegrationVendor(item.vendor)}</span>
          ),
        },
        {
          key: 'health',
          header: copy.colHealth,
          render: (item) => <HealthCell integration={item} copy={copy} />,
        },
        {
          key: 'actions',
          header: copy.colActions,
          render: (item) => (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onTest(item)}
                disabled={!canWrite || testingId === item.id}
              >
                {testingId === item.id ? (
                  <RefreshCw className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <TestTube2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {testingId === item.id ? copy.testActionRunning : copy.testAction}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEdit(item)}
                disabled={!canWrite}
              >
                <Pencil className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {copy.editAction}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(item)}
                disabled={!canWrite}
              >
                <Trash2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {copy.deleteAction}
              </Button>
            </div>
          ),
        },
      ]}
    />
  );
}

/**
 * Per-integration connection-health summary: status chip (icon + text), the
 * enabled flag, the last-test relative time, and — when present — the last test
 * error surfaced through a `role="alert"` region so assistive tech announces it.
 */
function HealthCell({
  integration,
  copy,
}: {
  integration: DRIntegration;
  copy: IntegrationHealthCopy;
}) {
  const presentation = presentationForStatus(integration.status);

  return (
    <div className="flex max-w-xs flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusChip
          tone={presentation.tone}
          icon={presentation.icon}
          label={statusLabel(copy, integration.status)}
        />
        {integration.enabled ? (
          <StatusChip tone="success" icon={CheckCircle2} label={copy.enabledLabel} size="sm" />
        ) : (
          <StatusChip tone="neutral" icon={PowerOff} label={copy.disabledLabel} size="sm" />
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {integration.last_tested_at ? (
          <RelativeTime date={integration.last_tested_at} className="text-xs" />
        ) : (
          copy.lastTestedNever
        )}
      </span>
      {integration.last_test_error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          <span className="font-medium">{copy.lastTestErrorLabel}: </span>
          {integration.last_test_error}
        </p>
      ) : null}
    </div>
  );
}
