'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { type ConnectionTestResult } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface TestConnectionInlineProps {
  loading: boolean;
  result?: ConnectionTestResult | null;
  error?: string | null;
  onEdit?: () => void;
}

export function TestConnectionInline({
  loading,
  result,
  error,
  onEdit,
}: TestConnectionInlineProps) {
  const labels = useDataLabels();
  const [visible, setVisible] = useState(Boolean(loading || result || error));

  useEffect(() => {
    if (loading || result || error) {
      setVisible(true);
    }
  }, [loading, result, error]);

  useEffect(() => {
    if (loading || (!result && !error)) {
      return;
    }
    const timer = window.setTimeout(() => setVisible(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [loading, result, error]);

  if (!visible) {
    return null;
  }

  if (loading) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {labels.sources.testingConnection}
      </div>
    );
  }

  if (result?.success) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {labels.sources.connectedIn(String(result.latency_ms))}
        {result.version ? ` • ${result.version}` : ''}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 space-y-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
        <div className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5" />
          <span>{error}</span>
        </div>
        {onEdit ? (
          <Button type="button" variant="link" size="sm" className="h-auto px-0 text-rose-700 dark:text-rose-300" onClick={onEdit}>
            {labels.sources.editConnection}
            <ExternalLink className="ms-1 h-3 w-3" />
          </Button>
        ) : null}
      </div>
    );
  }

  return null;
}
