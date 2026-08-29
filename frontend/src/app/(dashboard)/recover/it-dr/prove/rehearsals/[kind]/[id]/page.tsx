'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Download,
  FileCheck2,
  FileJson,
  Hash,
  KeyRound,
  Printer,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader, type PageHeaderTag } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, downloadTextFile } from '@/lib/utils';
import { showError, showSuccess } from '@/lib/toast';
import type {
  DRRehearsalHealthCheck,
  DRRehearsalIntegrityVerdict,
  DRRehearsalProof,
  DRRehearsalProofKind,
} from '@/lib/clario-dr';
import { useDRRehearsalProof } from '../../../../../../dr/_hooks/use-dr-queries';
import { useRecoverT } from '../../../../../_lib/recover-i18n';
import {
  buildRehearsalProofPrintHtml,
  rehearsalProofFilename,
  serializeRehearsalProof,
} from './_lib/proof-envelope-export';

type RecoverTranslate = ReturnType<typeof useRecoverT>;

const VALID_KINDS: DRRehearsalProofKind[] = ['gameday', 'runbook-runs', 'failover-runs'];

const KIND_LABEL_KEY: Record<DRRehearsalProofKind, string> = {
  gameday: 'rehearsalProof.kindGameday',
  'runbook-runs': 'rehearsalProof.kindRunbook',
  'failover-runs': 'rehearsalProof.kindFailover',
};

export default function RecoverRehearsalProofPage() {
  const t = useRecoverT();
  const params = useParams<{ kind: string; id: string }>();
  const kind = VALID_KINDS.includes(params?.kind as DRRehearsalProofKind)
    ? (params.kind as DRRehearsalProofKind)
    : null;
  const runId = params?.id ?? null;

  const proofQuery = useDRRehearsalProof(kind, runId);
  const proof = proofQuery.data ?? null;

  if (!kind || !runId) {
    return (
      <div className="space-y-6">
        <ErrorState message={t('rehearsalProof.invalidLink')} />
      </div>
    );
  }

  if (proofQuery.isLoading && !proof) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('rehearsalProof.title')} description={t('rehearsalProof.loadingEnvelope')} />
        <LoadingSkeleton variant="card" count={4} />
      </div>
    );
  }

  if ((proofQuery.error && !proof) || !proof) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('rehearsalProof.title')}
          description={`${t(KIND_LABEL_KEY[kind])} ${runId}`}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/recover/it-dr/prove">
                <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden />
                {t('rehearsalProof.backToProve')}
              </Link>
            </Button>
          }
        />
        <ErrorState
          message={t('rehearsalProof.envelopeLoadFailed')}
          error={proofQuery.error}
          onRetry={() => void proofQuery.refetch()}
        />
      </div>
    );
  }

  const verdict = verdictTone(proof.overall_verdict);
  const headerTags: PageHeaderTag[] = [
    { label: t(KIND_LABEL_KEY[kind]), tone: 'info' },
    { label: proof.provenance.live ? t('rehearsalProof.liveEvidence') : t('rehearsalProof.nonLiveEvidence'), tone: proof.provenance.live ? 'success' : 'warning' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Recover · Prove"
        tags={headerTags}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{t('rehearsalProof.title')}</span>
            <Badge variant="outline" className={cn('normal-case', verdict.badge)}>
              {proof.overall_verdict}
            </Badge>
          </span>
        }
        description={`${proof.run.type} ${proof.run.id}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/recover/it-dr/prove">
                <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden />
                {t('rehearsalProof.backToProve')}
              </Link>
            </Button>
            <ProofExportMenu proof={proof} kind={kind} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <ProofMetric
          icon={verdict.icon}
          label={t('rehearsalProof.metricVerdict')}
          value={proof.overall_verdict}
          tone={verdict.card}
        />
        <ProofMetric
          icon={Clock3}
          label={t('rehearsalProof.metricRto')}
          value={rtoLabel(t, proof)}
          detail={proof.targets.rto_met === undefined ? undefined : proof.targets.rto_met ? t('rehearsalProof.objectiveMet') : t('rehearsalProof.objectiveMissed')}
        />
        <ProofMetric
          icon={ShieldCheck}
          label={t('rehearsalProof.metricProvenance')}
          value={proof.provenance.source}
          detail={proof.provenance.captured_from}
        />
        <ProofMetric
          icon={Hash}
          label={t('rehearsalProof.metricEnvelopeHash')}
          value={shortHash(proof.envelope_hash)}
          detail={proof.schema_version}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck2 className="h-4 w-4 text-primary" aria-hidden />
              {t('rehearsalProof.healthChecks')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {proof.health_checks.length > 0 ? (
              <div className="divide-y divide-border">
                {proof.health_checks.map((check) => (
                  <HealthRow key={check.evidence_id ?? `${check.name}-${check.checked_at}`} check={check} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('rehearsalProof.noHealthChecks')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" aria-hidden />
              {t('rehearsalProof.evidenceChain')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Field label={t('rehearsalProof.fieldProofId')} value={proof.id} mono />
            <Field label={t('rehearsalProof.fieldTenant')} value={proof.tenant_id} mono />
            <Field label={t('rehearsalProof.fieldStarted')} value={formatDate(proof.started_at)} />
            <Field label={t('rehearsalProof.fieldCompleted')} value={proof.completed_at ? formatDate(proof.completed_at) : t('rehearsalProof.notCompleted')} />
            <Field label={t('rehearsalProof.fieldGenerated')} value={formatDate(proof.generated_at)} />
            <Field label={t('rehearsalProof.fieldEnvelopeHash')} value={proof.envelope_hash} mono />
            {proof.evidence_report ? (
              <>
                <Field label={t('rehearsalProof.fieldEvidenceReport')} value={proof.evidence_report.id} mono />
                <Field label={t('rehearsalProof.fieldEvidenceHash')} value={proof.evidence_report.hash} mono />
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BadgeCheck className="h-4 w-4 text-primary" aria-hidden />
              {t('rehearsalProof.approvals')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {proof.approval_refs.length > 0 ? (
              <div className="space-y-3">
                {proof.approval_refs.map((approval, index) => (
                  <div key={approval.id ?? `${approval.approver}-${index}`} className="rounded-card border border-border bg-card px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">{approval.action ?? t('rehearsalProof.approvalFallback')}</p>
                      {approval.approved_at ? (
                        <span className="text-xs text-muted-foreground">{formatDate(approval.approved_at)}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{approval.approver ?? approval.id ?? t('rehearsalProof.unknownApprover')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('rehearsalProof.noApprovalRefs')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              {t('rehearsalProof.integrityVerdicts')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {proof.integrity_verdicts.length > 0 ? (
              <div className="divide-y divide-border">
                {proof.integrity_verdicts.map((item) => (
                  <IntegrityRow key={`${item.source}-${item.checked_at}`} item={item} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('rehearsalProof.noIntegrityVerdicts')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * ProofExportMenu
 * ===============
 * Primary "Download proof envelope" CTA for the signed rehearsal proof. The
 * envelope is already loaded on this page, so both exports are pure client-side
 * renderings of that exact payload — no server export endpoint and no proof /
 * signing / WORM machinery is invoked (DR irreversible operations are on hold):
 *
 *  - JSON: the exact envelope bytes as fetched (its `envelope_hash` verifies
 *    against these bytes) via the shared {@link downloadTextFile} helper, and
 *  - PDF:  a self-contained, print-optimised report opened in a new window for
 *    browser print-to-PDF, mirroring the Prove evidence-pack print path.
 *
 * Viewing/exporting the envelope is read-only, so no `dr:write` gate applies.
 * A single primary Button opens the format menu; logical spacing keeps it RTL-safe.
 */
function ProofExportMenu({
  proof,
  kind,
}: {
  proof: DRRehearsalProof;
  kind: DRRehearsalProofKind;
}) {
  const t = useRecoverT();
  const handleDownloadJson = () => {
    try {
      downloadTextFile(
        serializeRehearsalProof(proof),
        rehearsalProofFilename(proof, kind, 'json'),
      );
      showSuccess(t('rehearsalProof.envelopeDownloaded'), proof.run.id);
    } catch {
      showError(t('rehearsalProof.couldNotDownload'));
    }
  };

  const handlePrintPdf = () => {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000');
    if (!printWindow) {
      showError(t('rehearsalProof.allowPopups'));
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildRehearsalProofPrintHtml(proof, kind));
    printWindow.document.close();
    printWindow.focus();
    // Defer printing until the standalone document has laid out.
    printWindow.addEventListener('load', () => {
      printWindow.print();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Download className="me-1.5 h-4 w-4" aria-hidden />
          {t('rehearsalProof.downloadEnvelope')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={handleDownloadJson}>
          <FileJson className="me-2 h-4 w-4" aria-hidden />
          {t('rehearsalProof.exportJson')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handlePrintPdf}>
          <Printer className="me-2 h-4 w-4" aria-hidden />
          {t('rehearsalProof.exportPdf')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProofMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}) {
  return (
    <Card className={cn('overflow-hidden', tone)}>
      <CardContent className="flex min-h-28 items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-button bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-caption font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 break-words text-base font-semibold text-foreground">{value}</p>
          {detail ? <p className="mt-1 break-words text-xs text-muted-foreground">{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function HealthRow({ check }: { check: DRRehearsalHealthCheck }) {
  const tone = check.passed
    ? 'text-state-success'
    : check.status === 'unknown'
      ? 'text-state-warning'
      : 'text-destructive';
  const Icon = check.passed ? CheckCircle2 : check.status === 'unknown' ? AlertTriangle : XCircle;
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-foreground">{check.name}</p>
          <Badge variant="outline" className="normal-case">{check.status}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(check.finished_at ?? check.checked_at)}</p>
        {check.detail ? <p className="mt-2 text-sm text-muted-foreground">{check.detail}</p> : null}
        {check.evidence_id ? <p className="mt-2 font-mono text-xs text-muted-foreground">{check.evidence_id}</p> : null}
      </div>
    </div>
  );
}

function IntegrityRow({ item }: { item: DRRehearsalIntegrityVerdict }) {
  const Icon = item.passed ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', item.passed ? 'text-state-success' : 'text-destructive')} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-foreground">{item.source}</p>
          <Badge variant="outline" className="normal-case">{item.verdict}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{formatDate(item.checked_at)}</p>
        {item.detail ? <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p> : null}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn('break-words text-foreground', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  );
}

function verdictTone(verdict: string): {
  icon: typeof ShieldCheck;
  badge: string;
  card: string;
} {
  switch (verdict.toLowerCase()) {
    case 'passed':
      return { icon: CheckCircle2, badge: 'border-state-success/40 text-state-success', card: 'border-state-success/30' };
    case 'failed':
      return { icon: XCircle, badge: 'border-destructive/40 text-destructive', card: 'border-destructive/30' };
    case 'warning':
      return { icon: AlertTriangle, badge: 'border-state-warning/40 text-state-warning', card: 'border-state-warning/30' };
    default:
      return { icon: ShieldCheck, badge: 'border-outline-subtle text-muted-foreground', card: '' };
  }
}

function rtoLabel(t: RecoverTranslate, proof: DRRehearsalProof): string {
  const target = proof.targets.rto_target_seconds;
  const actual = proof.targets.rto_actual_seconds;
  if (target && actual !== undefined && actual !== null) {
    return `${seconds(actual)} / ${seconds(target)}`;
  }
  if (target) {
    return seconds(target);
  }
  return t('rehearsalProof.noTarget');
}

function seconds(value: number): string {
  if (value < 60) {
    return `${value}s`;
  }
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function shortHash(hash: string): string {
  if (hash.length <= 22) {
    return hash;
  }
  return `${hash.slice(0, 14)}...${hash.slice(-8)}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
