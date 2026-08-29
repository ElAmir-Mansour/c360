'use client';

import { useId } from 'react';
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DRAttestationLedgerVerifyResult } from '@/types/clario-dr';
import { shortHash } from './ledger-format';
import type { LedgerExplorerCopy } from './ledger-labels';

type VerifyStatus = 'intact' | 'broken' | 'pending';

function statusOf(verification: DRAttestationLedgerVerifyResult | null | undefined): VerifyStatus {
  if (verification?.intact === true) return 'intact';
  if (verification?.intact === false) return 'broken';
  return 'pending';
}

export interface LedgerVerifyCardProps {
  copy: LedgerExplorerCopy;
  verification: DRAttestationLedgerVerifyResult | null | undefined;
  refreshing: boolean;
  onRefresh: () => void;
}

export function LedgerVerifyCard({
  copy,
  verification,
  refreshing,
  onRefresh,
}: LedgerVerifyCardProps) {
  const headingId = useId();
  const status = statusOf(verification);

  const StatusIcon =
    status === 'intact' ? ShieldCheck : status === 'broken' ? ShieldAlert : ShieldQuestion;
  const statusLabel =
    status === 'intact'
      ? copy.verifyIntact
      : status === 'broken'
        ? copy.verifyBroken
        : copy.verifyPending;
  const badgeVariant =
    status === 'intact' ? 'success' : status === 'broken' ? 'destructive' : 'warning';

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle id={headingId} className="flex items-center gap-2 text-base">
            <StatusIcon className="h-4 w-4 shrink-0" aria-hidden />
            {copy.verifyHeading}
          </CardTitle>
          <CardDescription>{copy.verifyDescription}</CardDescription>
        </div>
        <Badge variant={badgeVariant} className="shrink-0 normal-case tracking-normal">
          {statusLabel}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Datum label={copy.verifyEntriesChecked} value={verification?.entries_checked ?? 0} />
          <Datum
            label={copy.verifyFirstBrokenSeq}
            value={verification?.first_broken_seq ?? copy.notAvailable}
            tone={verification?.first_broken_seq != null ? 'critical' : 'default'}
          />
          <Datum
            label={copy.verifyHeadHash}
            value={shortHash(verification?.head_hash, copy.notAvailable)}
            mono
          />
          <Datum
            label={copy.verifyReason}
            value={verification?.reason ?? (status === 'intact' ? copy.verifyIntact : copy.notAvailable)}
          />
        </dl>

        <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? (
            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {copy.verifyRefresh}
        </Button>
      </CardContent>
    </Card>
  );
}

function Datum({
  label,
  value,
  mono = false,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  tone?: 'default' | 'critical';
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={[
          'mt-1 truncate font-medium',
          mono ? 'font-mono text-xs' : '',
          tone === 'critical' ? 'text-destructive' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}
