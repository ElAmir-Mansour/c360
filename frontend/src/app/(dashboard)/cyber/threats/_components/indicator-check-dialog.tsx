'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { CheckCircle, XCircle, Search, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { IndicatorCheckResult } from '@/types/cyber';
import { getIndicatorTypeLabel } from '@/lib/cyber-threats';
import { useThreatLabels } from '../_lib/threats-i18n';

interface IndicatorCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IndicatorCheckDialog({ open, onOpenChange }: IndicatorCheckDialogProps) {
  const t = useThreatLabels();
  const ic = t.indicatorCheck;
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<IndicatorCheckResult[] | null>(null);

  const handleCheck = async () => {
    const indicators = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (indicators.length === 0) return;
    setLoading(true);
    setResults(null);

    try {
      const res = await apiPost<{ data: IndicatorCheckResult[] }>(
        API_ENDPOINTS.CYBER_INDICATORS_CHECK,
        { values: indicators },
      );
      setResults(res.data);
    } catch {
      toast.error(ic.checkFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setRaw('');
    setResults(null);
    onOpenChange(false);
  };

  const matched = results?.filter((r) => (r.indicators?.length ?? 0) > 0) ?? [];
  const clean = results?.filter((r) => (r.indicators?.length ?? 0) === 0) ?? [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            {ic.title}
          </DialogTitle>
          <DialogDescription>
            {ic.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="indicators-input">{ic.label}</Label>
            <Textarea
              id="indicators-input"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={ic.placeholder}
              rows={5}
              className="mt-1 font-mono text-xs"
            />
          </div>

          {results && (
            <div className="space-y-3">
              {matched.length > 0 && (
                <div className="rounded-xl border border-error-100 bg-error-50/50 p-3 dark:border-error-700 dark:bg-error-700/20">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-error-600 dark:text-error-300">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {ic.maliciousCount(matched.length)}
                  </div>
                  <div className="space-y-1.5">
                    {matched.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <XCircle className="h-4 w-4 shrink-0 text-error-500" />
                        <span className="font-mono text-xs flex-1 truncate">{r.value}</span>
                        <div className="flex flex-wrap items-center gap-2">
                          {r.indicators.slice(0, 2).map((indicator) => (
                            <div key={indicator.id} className="flex items-center gap-1.5 rounded-full bg-background px-2 py-1">
                              <span className="text-[11px] text-muted-foreground">{getIndicatorTypeLabel(indicator.type)}</span>
                              <SeverityIndicator severity={indicator.severity} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {clean.length > 0 && (
                <div className="rounded-xl border border-primary/30 bg-brand-primary-400/50 p-3 dark:border-primary dark:bg-brand-primary-800/20">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary dark:text-primary">
                    <CheckCircle className="h-3.5 w-3.5" />
                    {ic.cleanCount(clean.length)}
                  </div>
                  <div className="space-y-1">
                    {clean.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <CheckCircle className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="font-mono">{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>{ic.close}</Button>
          <Button
            type="button"
            onClick={handleCheck}
            disabled={!raw.trim() || loading}
          >
            <Search className="me-1.5 h-3.5 w-3.5" />
            {loading ? ic.checking : ic.check}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
