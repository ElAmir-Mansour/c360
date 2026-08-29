'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clipboard,
  Download,
  Eye,
  FileSearch,
  FileSignature,
  Fingerprint,
  Loader2,
  PackageCheck,
  PenLine,
  Plus,
  RefreshCcw,
  Replace,
  Send,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  Trash2,
  type LucideIcon,
  Workflow,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatusBadge } from '@/components/shared/status-badge';
import { DocumentPreviewSheet } from '@/components/shared/document-viewer';
import { LexRecordPicker } from '@/components/lex/lex-record-picker';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { downloadBlob, formatBytes, formatDateTime } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import { useAuth } from '@/hooks/use-auth';
import type {
  JsonObject,
  LexRecordSignatureCustodyPayload,
  LexSignatureEnvelope,
  LexSignaturePlacement,
  LexSignatureProviderEventPayload,
  LexSignatureRecipient,
  LexSignatureRecipientActionPayload,
} from '@/types/suites';
import { type SignatureLabels, useSignatureLabels } from './labels';
import { SignatureJourney } from './signature-journey';

const RECIPIENT_ACTIONS = ['view', 'sign', 'decline'] as const;
const PROVIDERS = ['native', 'nafath', 'external'] as const;
const PLACEMENT_KINDS = ['signature', 'initials', 'name', 'date'] as const;
const SIGNATURE_PLACEMENTS_METADATA_KEY = 'native_signature_placements';
const NO_RECIPIENT_PLACEMENT = '__any__';
const SELF_SIGNATURE_PROFILE_QUERY_KEY = ['lex-signature-profile-me'] as const;
const ACTIVE_SIGNATURE_STATUSES = new Set(['draft', 'sent', 'viewed']);
const COMPLETED_SIGNATURE_STATUSES = new Set(['signed', 'declined', 'expired', 'cancelled']);
const FAILURE_STATUS_TERMS = ['fail', 'error', 'reject', 'declin', 'expire', 'timeout', 'void', 'cancel'];
const SIGNING_LINK_METADATA_KEYS = [
  'signing_url',
  'signing_link',
  'recipient_signing_url',
  'recipient_signing_link',
  'provider_signing_url',
  'provider_signing_link',
  'nafath_url',
  'nafath_link',
];

type SignatureEvent = NonNullable<LexSignatureEnvelope['events']>[number];
type CustodyEvidence = NonNullable<LexSignatureEnvelope['custody_evidence']>[number];

interface OperationNotice {
  title: string;
  description: string;
  variant?: 'default' | 'warning' | 'destructive' | 'success';
}

interface SignatureDetailSheetProps {
  envelopeId: string | null;
  open: boolean;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignatureDetailSheet({ envelopeId, open, canWrite, onOpenChange }: SignatureDetailSheetProps) {
  const allLabels = useSignatureLabels();
  const labels = allLabels.detail;
  const { direction } = useLocaleOrDefault();
  const { user } = useAuth();
  const [actionTarget, setActionTarget] = useState<LexSignatureRecipient | null>(null);
  const [actionMode, setActionMode] = useState<'admin' | 'self'>('admin');
  const [renderingTarget, setRenderingTarget] = useState<LexSignatureRecipient | null>(null);
  const [custodyOpen, setCustodyOpen] = useState(false);
  const [placementsOpen, setPlacementsOpen] = useState(false);
  const [providerEventOpen, setProviderEventOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [operationNotice, setOperationNotice] = useState<OperationNotice | null>(null);

  const detailQuery = useQuery({
    queryKey: ['lex-signature', envelopeId],
    queryFn: () => enterpriseApi.lex.getSignature(envelopeId as string),
    enabled: open && Boolean(envelopeId),
  });

  useEffect(() => {
    if (!open) {
      setActionTarget(null);
      setActionMode('admin');
      setRenderingTarget(null);
      setCustodyOpen(false);
      setPlacementsOpen(false);
      setProviderEventOpen(false);
      setPreviewOpen(false);
      setOperationNotice(null);
    }
  }, [open]);

  const envelope = detailQuery.data;
  const currentUserName = useMemo(() => {
    const fromFullName = user?.full_name?.trim();
    if (fromFullName) {
      return fromFullName;
    }
    return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  }, [user?.first_name, user?.full_name, user?.last_name]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{envelope?.title ?? labels.empty}</SheetTitle>
            <SheetDescription>{labels.description}</SheetDescription>
          </SheetHeader>

          {detailQuery.isLoading ? (
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {labels.loading}
            </div>
          ) : detailQuery.isError ? (
            <p className="mt-6 text-sm text-destructive" role="alert">
              {labels.error}
            </p>
          ) : !envelope ? (
            <p className="mt-6 text-sm text-muted-foreground">{labels.empty}</p>
          ) : (
            <div className="mt-6 space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={envelope.status}
                  label={allLabels.filters.statusOptions[envelope.status]}
                  size="sm"
                />
                <Badge variant="outline">
                  {allLabels.enums.provider[envelope.provider] ?? titleCase(envelope.provider)}
                </Badge>
                <Badge variant="outline">
                  {allLabels.enums.method[envelope.method] ?? titleCase(envelope.method)}
                </Badge>
                {envelope.contract_id ? (
                  <Link
                    href={`/lex/contracts/${envelope.contract_id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {envelope.contract_title ?? envelope.contract_number ?? allLabels.table.linkedContract}
                  </Link>
                ) : null}
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <OverviewItem label={labels.overview.due} value={formatDateOrNotSet(envelope.due_at, labels.overview.notSet)} />
                <OverviewItem label={labels.overview.expires} value={formatDateOrNotSet(envelope.expires_at, labels.overview.notSet)} />
                <OverviewItem label={labels.overview.sent} value={formatDateOrNotSet(envelope.sent_at, labels.overview.notSet)} />
                <OverviewItem label={labels.overview.completed} value={formatDateOrNotSet(envelope.completed_at, labels.overview.notSet)} />
              </dl>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                  <FileSearch className="me-1.5 h-4 w-4" />
                  {labels.preview.action}
                </Button>
                {canWrite ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setCustodyOpen(true)}>
                      <ShieldCheck className="me-1.5 h-4 w-4" />
                      {labels.custody.record}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPlacementsOpen(true)}>
                      <FileSignature className="me-1.5 h-4 w-4" />
                      {labels.placements.action}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setProviderEventOpen(true)}>
                      <Workflow className="me-1.5 h-4 w-4" />
                      {labels.providerEvent.record}
                    </Button>
                  </>
                ) : null}
              </div>

              {operationNotice ? (
                <Alert variant={operationNotice.variant ?? 'warning'}>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{operationNotice.title}</AlertTitle>
                  <AlertDescription>{operationNotice.description}</AlertDescription>
                </Alert>
              ) : null}

              <Separator />

              <Tabs defaultValue="recipients">
                <TabsList>
                  <TabsTrigger value="recipients">{labels.tabs.recipients}</TabsTrigger>
                  <TabsTrigger value="sync">{allLabels.operations.syncTab}</TabsTrigger>
                  <TabsTrigger value="custody">{labels.tabs.custody}</TabsTrigger>
                  <TabsTrigger value="events">{labels.tabs.events}</TabsTrigger>
                </TabsList>

                <TabsContent value="recipients" className="space-y-4">
                  <SignatureJourney envelope={envelope} />
                  <Separator />
                  {(envelope.recipients ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">{labels.recipients.empty}</p>
                  ) : (
                    [...(envelope.recipients ?? [])]
                      .sort((left, right) => left.signing_order - right.signing_order)
                      .map((recipient) => (
                        <RecipientRow
                          key={recipient.id}
                          envelope={envelope}
                          recipient={recipient}
                          canWrite={canWrite}
                          currentUserId={user?.id}
                          currentUserEmail={user?.email}
                          labels={allLabels}
                          onNotice={setOperationNotice}
                          onRecordAction={() => {
                            setActionMode('admin');
                            setActionTarget(recipient);
                          }}
                          onSelfSign={() => {
                            setActionMode('self');
                            setActionTarget(recipient);
                          }}
                          onViewRendering={() => setRenderingTarget(recipient)}
                        />
                      ))
                  )}
                </TabsContent>

                <TabsContent value="sync" className="space-y-4">
                  <ProviderSyncCenter
                    envelope={envelope}
                    canWrite={canWrite}
                    labels={allLabels}
                    onNotice={setOperationNotice}
                    onRecordProviderEvent={() => setProviderEventOpen(true)}
                  />
                </TabsContent>

                <TabsContent value="custody" className="space-y-3">
                  <CustodyEvidencePackage
                    envelope={envelope}
                    canWrite={canWrite}
                    labels={allLabels}
                    onNotice={setOperationNotice}
                    onRecordCustody={() => setCustodyOpen(true)}
                  />
                </TabsContent>

                <TabsContent value="events" className="space-y-3">
                  {(envelope.events ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">{labels.providerEvent.empty}</p>
                  ) : (
                    [...(envelope.events ?? [])]
                      .sort((left, right) => new Date(right.occurred_at).valueOf() - new Date(left.occurred_at).valueOf())
                      .map((event) => (
                        <div key={event.id} className="rounded-lg border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              {allLabels.enums.eventType[event.event_type] ?? titleCase(event.event_type)}
                            </span>
                            <RelativeTime date={event.occurred_at} />
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {event.provider ? (
                              <Badge variant="outline">
                                {allLabels.enums.provider[event.provider] ?? titleCase(event.provider)}
                              </Badge>
                            ) : null}
                            {event.provider_status ? <span>{event.provider_status}</span> : null}
                          </div>
                        </div>
                      ))
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {envelopeId ? (
        <>
          <RecipientActionDialog
            envelopeId={envelopeId}
            recipient={actionTarget}
            envelope={envelope}
            selfService={actionMode === 'self'}
            currentUserName={currentUserName}
            currentUserEmail={user?.email}
            onOpenChange={(value) => {
              if (!value) {
                setActionTarget(null);
                setActionMode('admin');
              }
            }}
          />
          <RecipientRenderingDialog
            envelopeId={envelopeId}
            recipient={renderingTarget}
            onOpenChange={(value) => {
              if (!value) {
                setRenderingTarget(null);
              }
            }}
          />
          <CustodyDialog
            envelopeId={envelopeId}
            defaultProvider={envelope?.provider}
            open={custodyOpen}
            onOpenChange={setCustodyOpen}
          />
          {envelope ? (
            <SignaturePlacementsDialog
              envelope={envelope}
              open={placementsOpen}
              onOpenChange={setPlacementsOpen}
            />
          ) : null}
          <ProviderEventDialog
            envelopeId={envelopeId}
            defaultProvider={envelope?.provider}
            open={providerEventOpen}
            onOpenChange={setProviderEventOpen}
          />
          {envelope ? (
            <DocumentPreview
              envelope={envelope}
              open={previewOpen}
              dir={direction}
              onOpenChange={setPreviewOpen}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function RecipientRow({
  envelope,
  recipient,
  canWrite,
  currentUserId,
  currentUserEmail,
  labels: allLabels,
  onNotice,
  onRecordAction,
  onSelfSign,
  onViewRendering,
}: {
  envelope: LexSignatureEnvelope;
  recipient: LexSignatureRecipient;
  canWrite: boolean;
  currentUserId?: string;
  currentUserEmail?: string;
  labels: SignatureLabels;
  onNotice: (notice: OperationNotice) => void;
  onRecordAction: () => void;
  onSelfSign: () => void;
  onViewRendering: () => void;
}) {
  const labels = allLabels.detail.recipients;
  const ops = allLabels.operations;
  const risk = recipientRisk(envelope, recipient, ops, allLabels.filters.statusOptions);
  const provider = recipient.provider ?? envelope.provider;
  const method = recipient.method ?? envelope.method;
  const signingLink = getRecipientSigningLink(envelope, recipient);
  const providerRecipientId = recipient.provider_recipient_id ?? latestRecipientProviderId(envelope, recipient.id);
  const lastActivity = recipient.signed_at ?? recipient.declined_at ?? recipient.viewed_at ?? recipient.updated_at;
  const hasContact = Boolean(recipient.email || recipient.phone);
  const canSelfSign =
    signatureRecipientBelongsToCurrentUser(recipient, currentUserId, currentUserEmail) &&
    canSelfSignRecipient(envelope, recipient);

  const unsupported = (action: string, detail: string) => {
    onNotice({
      title: ops.recipient.notConnected(action),
      description: detail,
      variant: 'warning',
    });
  };

  const copySigningLink = () => {
    if (!signingLink) {
      unsupported(ops.recipient.copyLinkAction, ops.recipient.copyLinkUnavailable);
      return;
    }
    void copyTextToClipboard(signingLink, {
      onSuccess: () => showSuccess(ops.recipient.signingLinkCopiedTitle, ops.recipient.signingLinkCopiedDetail),
      onFailure: () =>
        onNotice({
          title: ops.recipient.clipboardBlockedTitle,
          description: ops.recipient.clipboardBlockedDetail,
          variant: 'warning',
        }),
    });
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{recipient.name}</p>
            <Badge variant="outline">{labels.order(recipient.signing_order)}</Badge>
          </div>
          {recipient.email ? <p className="truncate text-xs text-muted-foreground">{recipient.email}</p> : null}
          {recipient.phone ? <p className="text-xs text-muted-foreground">{recipient.phone}</p> : null}
          {recipient.role ? <p className="text-xs text-muted-foreground">{recipient.role}</p> : null}
        </div>
        <StatusBadge
          status={recipient.status}
          label={allLabels.filters.statusOptions[recipient.status]}
          size="sm"
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <OperationalCard
          icon={CheckCircle2}
          label={ops.recipient.progress}
          value={allLabels.filters.statusOptions[recipient.status] ?? titleCase(String(recipient.status))}
          detail={lastActivity ? ops.recipient.lastActivity(formatDateTime(lastActivity)) : ops.recipient.noActivity}
          tone={COMPLETED_SIGNATURE_STATUSES.has(String(recipient.status)) ? 'success' : 'default'}
        />
        <OperationalCard
          icon={risk.tone === 'high' ? ShieldAlert : AlertTriangle}
          label={ops.recipient.risk}
          value={risk.label}
          detail={risk.detail}
          tone={risk.tone === 'high' ? 'destructive' : risk.tone === 'medium' ? 'warning' : 'success'}
        />
        <OperationalCard
          icon={Workflow}
          label={ops.recipient.provider}
          value={allLabels.enums.provider[provider] ?? titleCase(String(provider))}
          detail={
            providerRecipientId
              ? ops.sync.eventRecipientPrefix(providerRecipientId)
              : method
                ? ops.recipient.providerRecipientId(allLabels.enums.method[method] ?? titleCase(String(method)))
                : ops.recipient.providerRecipientIdMissing
          }
          tone={providerRecipientId || provider === 'native' ? 'default' : 'warning'}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {recipient.viewed_at ? (
          <span>
            {labels.viewed} {formatDateTime(recipient.viewed_at)}
          </span>
        ) : null}
        {recipient.signed_at ? (
          <span>
            {labels.signed} {formatDateTime(recipient.signed_at)}
          </span>
        ) : null}
        {recipient.declined_at ? (
          <span>
            {labels.declined} {formatDateTime(recipient.declined_at)}
          </span>
        ) : null}
        {recipient.evidence_hash ? <span>{ops.recipient.evidenceHashCaptured}</span> : null}
        {!hasContact ? <span>{ops.recipient.noContact}</span> : null}
      </div>

      {risk.factors.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {risk.factors.map((factor) => (
            <Badge key={factor} variant="outline" className="text-[11px]">
              {factor}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onViewRendering}>
          <Eye className="me-1.5 h-4 w-4" />
          {labels.viewRendering}
        </Button>
        {canWrite ? (
          <Button variant="outline" size="sm" onClick={onRecordAction}>
            <FileSignature className="me-1.5 h-4 w-4" />
            {labels.recordAction}
          </Button>
        ) : null}
        {canSelfSign ? (
          <Button variant="outline" size="sm" onClick={onSelfSign}>
            <Fingerprint className="me-1.5 h-4 w-4" />
            {labels.signAsMe}
          </Button>
        ) : null}
        {canWrite ? (
          <>
            <Button variant="outline" size="sm" onClick={copySigningLink}>
              <Clipboard className="me-1.5 h-4 w-4" />
              {ops.recipient.copySigningLink}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => unsupported(ops.recipient.resend, ops.recipient.resendDetail)}
            >
              <Send className="me-1.5 h-4 w-4" />
              {ops.recipient.resend}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => unsupported(ops.recipient.nudge, ops.recipient.nudgeDetail)}
            >
              <BellRing className="me-1.5 h-4 w-4" />
              {ops.recipient.nudge}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => unsupported(ops.recipient.replace, ops.recipient.replaceDetail)}
            >
              <Replace className="me-1.5 h-4 w-4" />
              {ops.recipient.replace}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => unsupported(ops.recipient.skip, ops.recipient.skipDetail)}
            >
              <SkipForward className="me-1.5 h-4 w-4" />
              {ops.recipient.skip}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ProviderSyncCenter({
  envelope,
  canWrite,
  labels: allLabels,
  onNotice,
  onRecordProviderEvent,
}: {
  envelope: LexSignatureEnvelope;
  canWrite: boolean;
  labels: SignatureLabels;
  onNotice: (notice: OperationNotice) => void;
  onRecordProviderEvent: () => void;
}) {
  const ops = allLabels.operations;
  const providerName = allLabels.enums.provider[envelope.provider] ?? titleCase(String(envelope.provider));
  const providerEvents = [...(envelope.events ?? [])]
    .filter((event) => event.provider || event.provider_status || event.provider_envelope_id || event.provider_recipient_id)
    .sort((left, right) => new Date(right.occurred_at).valueOf() - new Date(left.occurred_at).valueOf());
  const latestEvent = providerEvents[0];
  const providerEnvelopeId = getEnvelopeProviderId(envelope);
  const sync = providerSyncState(envelope, ops, latestEvent);
  const failureExplanation = providerFailureExplanation(envelope.provider, latestEvent?.provider_status ?? envelope.status, ops);
  const webhookMetadata = latestEvent?.evidence_metadata;
  const webhookValidated = metadataBoolean(webhookMetadata, ['webhook_signature_validated', 'signature_validated']);
  const webhookTimestamp = metadataString(webhookMetadata, [
    'webhook_timestamp',
    'timestamp',
    'signature_timestamp',
  ]);
  const webhookAlgorithm = metadataString(webhookMetadata, [
    'webhook_algorithm',
    'signature_algorithm',
    'algorithm',
  ]);

  const retryFailedSync = () => {
    if (sync.tone !== 'destructive') {
      onNotice({
        title: ops.noFailedSyncTitle,
        description: ops.noFailedSyncDetail,
        variant: 'warning',
      });
      return;
    }
    onNotice({
      title: ops.retryUnavailableTitle,
      description: ops.retryUnavailableDetail,
      variant: 'warning',
    });
    onRecordProviderEvent();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <OperationalCard
          icon={RefreshCcw}
          label={ops.sync.status}
          value={sync.label}
          detail={sync.detail}
          tone={sync.tone}
        />
        <OperationalCard
          icon={Workflow}
          label={ops.sync.provider}
          value={providerName}
          detail={providerEnvelopeId ? ops.sync.envelopeIdPrefix(providerEnvelopeId) : ops.sync.providerEnvelopeIdMissing}
          tone={providerEnvelopeId || envelope.provider === 'native' ? 'default' : 'warning'}
        />
        <OperationalCard
          icon={Fingerprint}
          label={ops.sync.webhook}
          value={webhookValidated === true ? ops.sync.validated : webhookValidated === false ? ops.sync.notValidated : ops.sync.noValidationFlag}
          detail={latestEvent ? ops.sync.latestEvent(formatDateTime(latestEvent.occurred_at)) : ops.sync.noProviderEvents}
          tone={webhookValidated === true ? 'success' : latestEvent ? 'warning' : 'default'}
        />
      </div>

      {failureExplanation ? (
        <Alert variant={sync.tone === 'destructive' ? 'destructive' : 'warning'}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{ops.sync.failureExplanationTitle(providerName)}</AlertTitle>
          <AlertDescription>{failureExplanation}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{ops.sync.identifiersTitle}</h3>
            <p className="text-xs text-muted-foreground">{ops.sync.identifiersHint}</p>
          </div>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={retryFailedSync}>
                <RefreshCcw className="me-1.5 h-4 w-4" />
                {ops.sync.retryFailedSync}
              </Button>
              <Button variant="outline" size="sm" onClick={onRecordProviderEvent}>
                <Workflow className="me-1.5 h-4 w-4" />
                {ops.sync.recordProviderEvent}
              </Button>
            </div>
          ) : null}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <DetailValue label={ops.sync.envelopeProviderId} value={providerEnvelopeId ?? ops.sync.notSet} mono={Boolean(providerEnvelopeId)} />
          <DetailValue label={ops.sync.latestProviderEventId} value={latestEvent?.provider_event_id ?? ops.sync.notSet} mono={Boolean(latestEvent?.provider_event_id)} />
          <DetailValue label={ops.sync.latestProviderStatus} value={latestEvent?.provider_status ?? ops.sync.noProviderStatusRecorded} />
          <DetailValue label={ops.sync.webhookTimestamp} value={webhookTimestamp ?? ops.sync.notPresent} mono={Boolean(webhookTimestamp)} />
          <DetailValue label={ops.sync.webhookAlgorithm} value={webhookAlgorithm ?? ops.sync.notPresent} />
          <DetailValue
            label={ops.sync.envelopeEvidenceHash}
            value={envelope.evidence_hash ?? ops.sync.notCaptured}
            mono={Boolean(envelope.evidence_hash)}
          />
        </dl>

        <div className="mt-4 space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{ops.sync.providerRecipientIds}</h4>
          {(envelope.recipients ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{ops.sync.noRecipients}</p>
          ) : (
            <div className="space-y-2">
              {(envelope.recipients ?? []).map((recipient) => {
                const providerRecipientId = recipient.provider_recipient_id ?? latestRecipientProviderId(envelope, recipient.id);
                return (
                  <div key={recipient.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{recipient.name}</p>
                      <p className="break-all font-mono text-xs text-muted-foreground">
                        {providerRecipientId ?? ops.sync.providerRecipientIdNotSet}
                      </p>
                    </div>
                    <StatusBadge
                      status={recipient.status}
                      label={allLabels.filters.statusOptions[recipient.status]}
                      size="sm"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{ops.sync.diagnosticsTitle}</h3>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <DiagnosticChip
            label={ops.sync.signature}
            value={webhookValidated === true ? ops.sync.signatureValid : webhookValidated === false ? ops.sync.signatureInvalid : ops.sync.signatureNotChecked}
            tone={webhookValidated === true ? 'success' : latestEvent ? 'warning' : 'default'}
          />
          <DiagnosticChip
            label={ops.sync.payload}
            value={metadataString(webhookMetadata, ['webhook_payload_hash', 'payload_hash', 'body_hash']) ?? ops.sync.payloadHashNotStored}
            tone="default"
          />
          <DiagnosticChip
            label={ops.sync.callbackAge}
            value={latestEvent ? relativeAge(latestEvent.occurred_at) : ops.sync.noCallback}
            tone={latestEvent ? 'default' : 'warning'}
          />
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{ops.sync.recentEventsTitle}</h3>
        {providerEvents.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{allLabels.detail.providerEvent.empty}</p>
        ) : (
          <div className="mt-3 space-y-3">
            {providerEvents.slice(0, 5).map((event) => (
              <div key={event.id} className="rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {allLabels.enums.eventType[event.event_type] ?? titleCase(event.event_type)}
                  </p>
                  <RelativeTime date={event.occurred_at} />
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {event.provider_status ? <span>{event.provider_status}</span> : null}
                  {event.provider_envelope_id ? <span>{ops.sync.eventEnvelopePrefix(event.provider_envelope_id)}</span> : null}
                  {event.provider_recipient_id ? <span>{ops.sync.eventRecipientPrefix(event.provider_recipient_id)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CustodyEvidencePackage({
  envelope,
  canWrite,
  labels: allLabels,
  onNotice,
  onRecordCustody,
}: {
  envelope: LexSignatureEnvelope;
  canWrite: boolean;
  labels: SignatureLabels;
  onNotice: (notice: OperationNotice) => void;
  onRecordCustody: () => void;
}) {
  const labels = allLabels.detail.custody;
  const ops = allLabels.operations;
  const evidence = envelope.custody_evidence ?? [];
  const packagePayload = useMemo(() => buildCustodyPackage(envelope), [envelope]);
  const retention = custodyRetentionStatus(evidence, ops);
  const latestSignedAt = latestDate(evidence.map((entry) => entry.signed_at));
  const sealedCount = evidence.filter((entry) => entry.seal_hash || entry.evidence_hash).length;

  const downloadPackage = () => {
    downloadBlob(
      new Blob([JSON.stringify(packagePayload, null, 2)], { type: 'application/json;charset=utf-8' }),
      `signature-custody-${envelope.id}.json`,
    );
    showSuccess(ops.custody.downloadedTitle, ops.custody.downloadedDetail);
  };

  const requestAutomaticPickup = () => {
    onNotice({
      title: ops.custody.pickupTitle,
      description: ops.custody.pickupDetail,
      variant: 'warning',
    });
  };

  if (evidence.length === 0) {
    return (
      <div className="space-y-3">
        <Alert variant="warning">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>{ops.custody.missingPackageTitle}</AlertTitle>
          <AlertDescription>
            {labels.empty} {ops.custody.missingPackageDetail}
          </AlertDescription>
        </Alert>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onRecordCustody}>
              <ShieldCheck className="me-1.5 h-4 w-4" />
              {labels.record}
            </Button>
            <Button variant="outline" size="sm" onClick={requestAutomaticPickup}>
              <PackageCheck className="me-1.5 h-4 w-4" />
              {ops.custody.pickupArtifact}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <OperationalCard
          icon={PackageCheck}
          label={ops.custody.evidencePackage}
          value={ops.custody.fileCount(evidence.length)}
          detail={latestSignedAt ? ops.custody.latestSeal(formatDateTime(latestSignedAt)) : ops.custody.noSignedDate}
          tone="success"
        />
        <OperationalCard
          icon={Fingerprint}
          label={ops.custody.hashVerification}
          value={ops.custody.sealedOf(sealedCount, evidence.length)}
          detail={sealedCount === evidence.length ? ops.custody.hashesPresent : ops.custody.hashesMissing}
          tone={sealedCount === evidence.length ? 'success' : 'warning'}
        />
        <OperationalCard
          icon={ShieldCheck}
          label={ops.custody.retention}
          value={retention.label}
          detail={retention.detail}
          tone={retention.tone}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={downloadPackage}>
          <Download className="me-1.5 h-4 w-4" />
          {ops.custody.downloadJson}
        </Button>
        {canWrite ? (
          <>
            <Button variant="outline" size="sm" onClick={onRecordCustody}>
              <ShieldCheck className="me-1.5 h-4 w-4" />
              {labels.record}
            </Button>
            <Button variant="outline" size="sm" onClick={requestAutomaticPickup}>
              <PackageCheck className="me-1.5 h-4 w-4" />
              {ops.custody.pickupArtifact}
            </Button>
          </>
        ) : null}
      </div>

      {evidence.some((entry) => !entry.seal_hash && !entry.evidence_hash) ? (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{ops.custody.hashIncompleteTitle}</AlertTitle>
          <AlertDescription>{ops.custody.hashIncompleteDetail}</AlertDescription>
        </Alert>
      ) : null}

      {evidence.map((entry) => {
        const retentionStatus = custodyRetentionStatus([entry], ops);
        return (
          <div key={entry.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{entry.file_name}</p>
                <p className="text-xs text-muted-foreground">
                  {labels.size}: {formatBytes(entry.file_size_bytes)}
                </p>
              </div>
              <Badge variant="outline">
                {allLabels.enums.provider[entry.provider] ?? titleCase(String(entry.provider))}
              </Badge>
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <HashItem label={labels.contentHash} value={entry.content_hash} />
              <HashItem label={labels.sealHash} value={entry.seal_hash ?? undefined} />
              <HashItem label={ops.custody.evidenceHash} value={entry.evidence_hash ?? undefined} />
              <DetailValue label={ops.custody.fileId} value={entry.file_id} mono />
            </dl>
            <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
              <DetailValue label={labels.signedAt} value={formatDateTime(entry.signed_at)} />
              <DetailValue label={ops.custody.retention} value={ops.custody.retentionInline(retentionStatus.label, retentionStatus.detail)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OperationalCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: OperationNotice['variant'];
}) {
  const [expanded, setExpanded] = useState(false);
  const toneClass =
    tone === 'success'
      ? 'border-primary/30 bg-primary/5 text-primary'
      : tone === 'warning'
        ? 'border-yellow-500/40 bg-yellow-50/70 text-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-300'
        : tone === 'destructive'
          ? 'border-destructive/40 bg-destructive/5 text-destructive'
          : 'border-border bg-muted/30 text-foreground';

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => setExpanded((current) => !current)}
      aria-expanded={expanded}
      className={`h-auto flex-col items-stretch rounded-lg border p-3 text-start font-normal transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${toneClass}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 truncate text-sm font-semibold">{value}</p>
      <p className={`mt-1 text-xs text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>{detail}</p>
    </Button>
  );
}

function DiagnosticChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: OperationNotice['variant'];
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
            tone === 'success'
              ? 'bg-primary'
              : tone === 'warning'
                ? 'bg-yellow-500'
                : tone === 'destructive'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground'
          }`}
          aria-hidden
        />
        <p className="break-words text-xs">{value}</p>
      </div>
    </div>
  );
}

function DetailValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-words ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
    </div>
  );
}

function RecipientActionDialog({
  envelopeId,
  recipient,
  envelope,
  selfService,
  currentUserName,
  currentUserEmail,
  onOpenChange,
}: {
  envelopeId: string;
  recipient: LexSignatureRecipient | null;
  envelope?: LexSignatureEnvelope;
  selfService: boolean;
  currentUserName?: string;
  currentUserEmail?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const allLabels = useSignatureLabels();
  const labels = allLabels.detail.action;
  const queryClient = useQueryClient();
  const [action, setAction] = useState<(typeof RECIPIENT_ACTIONS)[number]>('sign');
  const [actorName, setActorName] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [evidenceHash, setEvidenceHash] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const assignedPlacements = useMemo(
    () => (envelope && recipient ? signaturePlacementsForRecipient(envelope, recipient.id) : []),
    [envelope, recipient],
  );

  const profileQuery = useQuery({
    queryKey: SELF_SIGNATURE_PROFILE_QUERY_KEY,
    queryFn: () => enterpriseApi.lex.getMySignatureProfile(),
    enabled: selfService && recipient !== null,
  });

  useEffect(() => {
    if (recipient) {
      setAction('sign');
      setActorName(selfService ? currentUserName || recipient.name : '');
      setActorEmail(selfService ? currentUserEmail ?? recipient.email ?? '' : '');
      setEvidenceHash('');
      setDeclineReason('');
    }
  }, [currentUserEmail, currentUserName, recipient, selfService]);

  useEffect(() => {
    const typedName = profileQuery.data?.typed_name?.trim();
    if (!recipient || !selfService || !typedName) {
      return;
    }
    setActorName((current) => {
      const fallbackName = currentUserName || recipient.name;
      if (!current.trim() || current === fallbackName || current === recipient.name) {
        return typedName;
      }
      return current;
    });
  }, [currentUserName, profileQuery.data?.typed_name, recipient, selfService]);

  const mutation = useMutation({
    mutationFn: (payload: LexSignatureRecipientActionPayload) =>
      selfService
        ? enterpriseApi.lex.recordSelfSignatureRecipientAction(envelopeId, payload)
        : enterpriseApi.lex.recordSignatureRecipientAction(envelopeId, payload),
    onSuccess: async () => {
      showSuccess(allLabels.toast.recipientAction.title, allLabels.toast.recipientAction.detail);
      await invalidateEnvelope(queryClient, envelopeId);
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recipient) {
      return;
    }
    mutation.mutate({
      recipient_id: recipient.id,
      action,
      actor_name: emptyToNull(actorName),
      actor_email: emptyToNull(actorEmail),
      evidence_hash: emptyToNull(evidenceHash),
      evidence_metadata: selfService ? { signing_mode: 'self_service_native' } : undefined,
      decline_reason: action === 'decline' ? emptyToNull(declineReason) : null,
    });
  };

  return (
    <Dialog open={recipient !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {recipient
              ? selfService
                ? labels.selfTitle(recipient.name)
                : labels.title(recipient.name)
              : labels.action}
          </DialogTitle>
          <DialogDescription>{selfService ? labels.selfDescription : labels.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="recipient-action">{labels.action}</Label>
            <Select value={action} onValueChange={(value) => setAction(value as (typeof RECIPIENT_ACTIONS)[number])}>
              <SelectTrigger id="recipient-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECIPIENT_ACTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {allLabels.enums.recipientAction[option] ?? titleCase(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="actor-name">{labels.actorName}</Label>
              <Input
                id="actor-name"
                value={actorName}
                onChange={(event) => setActorName(event.target.value)}
                placeholder={labels.actorNamePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="actor-email">{labels.actorEmail}</Label>
              <Input
                id="actor-email"
                type="email"
                value={actorEmail}
                onChange={(event) => setActorEmail(event.target.value)}
                disabled={selfService && Boolean(currentUserEmail)}
              />
            </div>
          </div>
          {selfService ? (
            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>{labels.savedSignature}</Label>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings">
                    <PenLine className="me-1.5 h-4 w-4" />
                    {labels.manageSignature}
                  </Link>
                </Button>
              </div>
              {profileQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {labels.loadingSignatureProfile}
                </div>
              ) : profileQuery.data?.signature_image ? (
                <div className="rounded-md border bg-background p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">{labels.signaturePreview}</p>
                  <div className="flex h-24 items-center justify-center rounded border border-dashed bg-muted/20 p-2">
                    <img
                      src={profileQuery.data.signature_image}
                      alt={labels.savedSignature}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{labels.noSavedSignature}</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="evidence-hash">{labels.evidenceHash}</Label>
              <Input
                id="evidence-hash"
                value={evidenceHash}
                onChange={(event) => setEvidenceHash(event.target.value)}
                placeholder={labels.evidenceHashPlaceholder}
              />
            </div>
          )}
          {selfService && assignedPlacements.length > 0 ? (
            <SignaturePlacementPreview
              title={labels.signaturePreview}
              placements={assignedPlacements}
              profile={profileQuery.data ?? null}
              recipient={recipient}
              actorName={actorName}
              labels={allLabels}
            />
          ) : null}
          {action === 'decline' ? (
            <div className="space-y-2">
              <Label htmlFor="decline-reason">{labels.declineReason}</Label>
              <Textarea
                id="decline-reason"
                rows={2}
                value={declineReason}
                onChange={(event) => setDeclineReason(event.target.value)}
                placeholder={labels.declineReasonPlaceholder}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {selfService ? labels.selfSubmit : labels.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecipientRenderingDialog({
  envelopeId,
  recipient,
  onOpenChange,
}: {
  envelopeId: string;
  recipient: LexSignatureRecipient | null;
  onOpenChange: (open: boolean) => void;
}) {
  const labels = useSignatureLabels().detail.rendering;
  const renderingQuery = useQuery({
    queryKey: ['lex-signature-rendering', envelopeId, recipient?.id],
    queryFn: () => enterpriseApi.lex.getSignatureRecipientRendering(envelopeId, recipient?.id as string),
    enabled: recipient !== null,
  });

  const rendering = renderingQuery.data;

  return (
    <Dialog open={recipient !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recipient ? labels.title(recipient.name) : labels.title('')}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        {renderingQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {labels.loading}
          </div>
        ) : renderingQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {labels.error}
          </p>
        ) : rendering ? (
          <div className="space-y-4">
            <RenderingBlock heading={labels.primary} language={rendering.primary.language} text={rendering.primary} />
            {rendering.secondary ? (
              <RenderingBlock
                heading={labels.secondary}
                language={rendering.secondary.language}
                text={rendering.secondary}
              />
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenderingBlock({
  heading,
  language,
  text,
}: {
  heading: string;
  language: string;
  text: { subject: string; message: string; legal_consent: string };
}) {
  const allLabels = useSignatureLabels();
  const labels = allLabels.detail.rendering;
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{heading}</p>
        <Badge variant="outline">{allLabels.enums.language[language] ?? language}</Badge>
      </div>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{labels.subject}</dt>
          <dd className="mt-0.5">{text.subject}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{labels.message}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap">{text.message}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{labels.consent}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap">{text.legal_consent}</dd>
        </div>
      </dl>
    </div>
  );
}

function SignaturePlacementsDialog({
  envelope,
  open,
  onOpenChange,
}: {
  envelope: LexSignatureEnvelope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const allLabels = useSignatureLabels();
  const labels = allLabels.detail.placements;
  const queryClient = useQueryClient();
  const [placements, setPlacements] = useState<LexSignaturePlacement[]>([]);

  useEffect(() => {
    if (open) {
      setPlacements(signaturePlacementsFromEnvelope(envelope));
    }
  }, [envelope, open]);

  const mutation = useMutation({
    mutationFn: (payload: { placements: LexSignaturePlacement[] }) =>
      enterpriseApi.lex.updateSignaturePlacements(envelope.id, payload),
    onSuccess: async () => {
      showSuccess(allLabels.toast.placements.title, allLabels.toast.placements.detail);
      await invalidateEnvelope(queryClient, envelope.id);
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const updatePlacement = (id: string, patch: Partial<LexSignaturePlacement>) => {
    setPlacements((current) =>
      current.map((placement) => (placement.id === id ? { ...placement, ...patch } : placement)),
    );
  };

  const addPlacement = () => {
    const recipient = envelope.recipients?.[0];
    const nextIndex = placements.length + 1;
    setPlacements((current) => [
      ...current,
      {
        id: `field-${Date.now()}-${nextIndex}`,
        recipient_id: recipient?.id ?? null,
        kind: 'signature',
        page: 1,
        x: 60,
        y: 78,
        width: 28,
        height: 8,
        required: true,
        label: '',
      },
    ]);
  };

  const removePlacement = (id: string) => {
    setPlacements((current) => current.filter((placement) => placement.id !== id));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate({ placements });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="outline">{labels.placementCount(placements.length)}</Badge>
            <Button type="button" variant="outline" size="sm" onClick={addPlacement}>
              <Plus className="me-1.5 h-4 w-4" aria-hidden />
              {labels.add}
            </Button>
          </div>

          {placements.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{labels.empty}</p>
          ) : (
            <div className="space-y-3">
              {placements.map((placement) => (
                <div key={placement.id} className="rounded-lg border p-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="space-y-2 md:col-span-2">
                      <Label>{labels.recipient}</Label>
                      <Select
                        value={placement.recipient_id ?? NO_RECIPIENT_PLACEMENT}
                        onValueChange={(value) =>
                          updatePlacement(placement.id, {
                            recipient_id: value === NO_RECIPIENT_PLACEMENT ? null : value,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_RECIPIENT_PLACEMENT}>{labels.allRecipients}</SelectItem>
                          {(envelope.recipients ?? []).map((recipient) => (
                            <SelectItem key={recipient.id} value={recipient.id}>
                              {recipient.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{labels.kind}</Label>
                      <Select
                        value={String(placement.kind)}
                        onValueChange={(value) => updatePlacement(placement.id, { kind: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PLACEMENT_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                              {labels.kindOptions[kind]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${placement.id}-page`}>{labels.page}</Label>
                      <Input
                        id={`${placement.id}-page`}
                        type="number"
                        min={1}
                        value={placement.page}
                        onChange={(event) =>
                          updatePlacement(placement.id, { page: numberOrFallback(event.target.value, 1) })
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
                    <PlacementNumberInput id={`${placement.id}-x`} label={labels.x} value={placement.x} onChange={(x) => updatePlacement(placement.id, { x })} />
                    <PlacementNumberInput id={`${placement.id}-y`} label={labels.y} value={placement.y} onChange={(y) => updatePlacement(placement.id, { y })} />
                    <PlacementNumberInput id={`${placement.id}-width`} label={labels.width} value={placement.width} onChange={(width) => updatePlacement(placement.id, { width })} />
                    <PlacementNumberInput id={`${placement.id}-height`} label={labels.height} value={placement.height} onChange={(height) => updatePlacement(placement.id, { height })} />
                    <div className="space-y-2">
                      <Label htmlFor={`${placement.id}-required`}>{labels.required}</Label>
                      <div className="flex h-10 items-center">
                        <input
                          id={`${placement.id}-required`}
                          type="checkbox"
                          checked={placement.required ?? false}
                          onChange={(event) => updatePlacement(placement.id, { required: event.target.checked })}
                          className="h-4 w-4 rounded border-border"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
                    <div className="space-y-2">
                      <Label htmlFor={`${placement.id}-label`}>{labels.label}</Label>
                      <Input
                        id={`${placement.id}-label`}
                        value={placement.label ?? ''}
                        onChange={(event) => updatePlacement(placement.id, { label: event.target.value })}
                      />
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removePlacement(placement.id)}>
                      <Trash2 className="me-1.5 h-4 w-4" aria-hidden />
                      {labels.remove}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <SignaturePlacementPreview
            title={labels.fieldPreview}
            placements={placements}
            recipient={null}
            actorName=""
            labels={allLabels}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {allLabels.detail.action.cancel}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {mutation.isPending ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlacementNumberInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={100}
        step={0.5}
        value={value}
        onChange={(event) => onChange(numberOrFallback(event.target.value, 0))}
      />
    </div>
  );
}

function SignaturePlacementPreview({
  title,
  placements,
  profile,
  recipient,
  actorName,
  labels,
}: {
  title: string;
  placements: LexSignaturePlacement[];
  profile?: { typed_name?: string; initials?: string; signature_image?: string | null; initials_image?: string | null } | null;
  recipient: LexSignatureRecipient | null;
  actorName: string;
  labels: SignatureLabels;
}) {
  if (placements.length === 0) {
    return null;
  }
  const pages = Array.from(new Set(placements.map((placement) => placement.page))).sort((left, right) => left - right);
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-semibold">{title}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pages.map((page) => (
          <div key={page} className="space-y-2">
            <Badge variant="outline">{labels.detail.placements.page} {page}</Badge>
            <div className="relative mx-auto w-full max-w-[280px] rounded-md border bg-white shadow-sm" style={{ aspectRatio: '0.707 / 1' }}>
              {placements
                .filter((placement) => placement.page === page)
                .map((placement) => (
                  <div
                    key={placement.id}
                    className="absolute flex items-center justify-center overflow-hidden rounded border border-primary/60 bg-primary/10 px-1 text-center text-[10px] font-medium text-primary"
                    style={{
                      left: `${placement.x}%`,
                      top: `${placement.y}%`,
                      width: `${placement.width}%`,
                      height: `${placement.height}%`,
                    }}
                  >
                    {placementPreviewContent(placement, profile, recipient, actorName, labels)}
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function placementPreviewContent(
  placement: LexSignaturePlacement,
  profile: { typed_name?: string; initials?: string; signature_image?: string | null; initials_image?: string | null } | null | undefined,
  recipient: LexSignatureRecipient | null,
  actorName: string,
  labels: SignatureLabels,
) {
  switch (placement.kind) {
    case 'signature':
      return profile?.signature_image ? (
        <img src={profile.signature_image} alt={labels.detail.placements.kindOptions.signature} className="max-h-full max-w-full object-contain" />
      ) : (
        profile?.typed_name || actorName || recipient?.name || labels.detail.placements.kindOptions.signature
      );
    case 'initials':
      return profile?.initials_image ? (
        <img src={profile.initials_image} alt={labels.detail.placements.kindOptions.initials} className="max-h-full max-w-full object-contain" />
      ) : (
        profile?.initials || initialsForName(actorName || recipient?.name || '') || labels.detail.placements.kindOptions.initials
      );
    case 'name':
      return actorName || profile?.typed_name || recipient?.name || labels.detail.placements.kindOptions.name;
    case 'date':
      return new Date().toLocaleDateString();
    default:
      return placement.label || String(placement.kind);
  }
}

function CustodyDialog({
  envelopeId,
  defaultProvider,
  open,
  onOpenChange,
}: {
  envelopeId: string;
  defaultProvider?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const allLabels = useSignatureLabels();
  const labels = allLabels.detail.custodyForm;
  const queryClient = useQueryClient();
  const [fileId, setFileId] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [contentHash, setContentHash] = useState('');
  const [sealHash, setSealHash] = useState('');
  const [evidenceHash, setEvidenceHash] = useState('');
  const [provider, setProvider] = useState<string>(defaultProvider ?? 'native');
  const [signedAt, setSignedAt] = useState('');

  useEffect(() => {
    if (open) {
      setFileId('');
      setFileName('');
      setFileSize('');
      setContentHash('');
      setSealHash('');
      setEvidenceHash('');
      setProvider(defaultProvider ?? 'native');
      setSignedAt('');
    }
  }, [defaultProvider, open]);

  const mutation = useMutation({
    mutationFn: (payload: LexRecordSignatureCustodyPayload) =>
      enterpriseApi.lex.recordSignatureCustody(envelopeId, payload),
    onSuccess: async () => {
      showSuccess(allLabels.toast.custody.title, allLabels.toast.custody.detail);
      await invalidateEnvelope(queryClient, envelopeId);
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const canSubmit =
    fileId.trim() !== '' &&
    fileName.trim() !== '' &&
    contentHash.trim() !== '' &&
    Number.isFinite(Number.parseInt(fileSize, 10)) &&
    Number.parseInt(fileSize, 10) >= 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    mutation.mutate({
      file_id: fileId.trim(),
      file_name: fileName.trim(),
      file_size_bytes: Number.parseInt(fileSize, 10),
      content_hash: contentHash.trim(),
      seal_hash: emptyToNull(sealHash),
      evidence_hash: emptyToNull(evidenceHash),
      provider,
      signed_at: toIsoOrNull(signedAt),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="custody-file-id">{labels.fileId}</Label>
              <LexRecordPicker
                id="custody-file-id"
                kind="file"
                ariaLabel={labels.fileId}
                value={fileId}
                onChange={(value, option) => {
                  setFileId(value);
                  if (!option) return;
                  setFileName(option.label);
                  const sizeBytes = option.metadata?.sizeBytes;
                  const hash = option.metadata?.contentHash;
                  if (typeof sizeBytes === 'number') setFileSize(String(sizeBytes));
                  if (typeof hash === 'string') setContentHash(hash);
                }}
                enabled={open}
                required
                labels={{ select: labels.fileIdPlaceholder, search: labels.fileIdPlaceholder }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custody-file-name">{labels.fileName}</Label>
              <Input
                id="custody-file-name"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                placeholder={labels.fileNamePlaceholder}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custody-file-size">{labels.fileSize}</Label>
              <Input
                id="custody-file-size"
                type="number"
                min={0}
                value={fileSize}
                onChange={(event) => setFileSize(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custody-provider">{labels.provider}</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger id="custody-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {allLabels.enums.provider[option] ?? titleCase(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="custody-content-hash">{labels.contentHash}</Label>
            <Input
              id="custody-content-hash"
              value={contentHash}
              onChange={(event) => setContentHash(event.target.value)}
              placeholder={labels.contentHashPlaceholder}
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="custody-seal-hash">{labels.sealHash}</Label>
              <Input
                id="custody-seal-hash"
                value={sealHash}
                onChange={(event) => setSealHash(event.target.value)}
                placeholder={labels.sealHashPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="custody-evidence-hash">{labels.evidenceHash}</Label>
              <Input
                id="custody-evidence-hash"
                value={evidenceHash}
                onChange={(event) => setEvidenceHash(event.target.value)}
                placeholder={labels.evidenceHashPlaceholder}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="custody-signed-at">{labels.signedAt}</Label>
            <Input
              id="custody-signed-at"
              type="datetime-local"
              value={signedAt}
              onChange={(event) => setSignedAt(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {labels.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProviderEventDialog({
  envelopeId,
  defaultProvider,
  open,
  onOpenChange,
}: {
  envelopeId: string;
  defaultProvider?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const allLabels = useSignatureLabels();
  const labels = allLabels.detail.providerEvent;
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<string>(defaultProvider ?? 'external');
  const [providerStatus, setProviderStatus] = useState('');
  const [providerEventId, setProviderEventId] = useState('');
  const [providerEnvelopeId, setProviderEnvelopeId] = useState('');
  const [providerRecipientId, setProviderRecipientId] = useState('');
  const [evidenceHash, setEvidenceHash] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [reason, setReason] = useState('');
  const [webhookSignature, setWebhookSignature] = useState('');
  const [webhookTimestamp, setWebhookTimestamp] = useState('');
  const [webhookPayload, setWebhookPayload] = useState('');
  const [webhookAlgorithm, setWebhookAlgorithm] = useState('');
  const [webhookSignatureBase, setWebhookSignatureBase] = useState('');

  useEffect(() => {
    if (open) {
      setProvider(defaultProvider ?? 'external');
      setProviderStatus('');
      setProviderEventId('');
      setProviderEnvelopeId('');
      setProviderRecipientId('');
      setEvidenceHash('');
      setOccurredAt('');
      setReason('');
      setWebhookSignature('');
      setWebhookTimestamp('');
      setWebhookPayload('');
      setWebhookAlgorithm('');
      setWebhookSignatureBase('');
    }
  }, [defaultProvider, open]);

  const mutation = useMutation({
    mutationFn: (payload: LexSignatureProviderEventPayload) =>
      enterpriseApi.lex.recordSignatureProviderEvent(envelopeId, payload),
    onSuccess: async () => {
      showSuccess(allLabels.toast.providerEvent.title, allLabels.toast.providerEvent.detail);
      await invalidateEnvelope(queryClient, envelopeId);
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const canSubmit = providerStatus.trim() !== '';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    mutation.mutate({
      provider,
      provider_status: providerStatus.trim(),
      provider_event_id: emptyToNull(providerEventId),
      provider_envelope_id: emptyToNull(providerEnvelopeId),
      provider_recipient_id: emptyToNull(providerRecipientId),
      evidence_hash: emptyToNull(evidenceHash),
      occurred_at: toIsoOrNull(occurredAt),
      reason: emptyToNull(reason),
      webhook_signature: emptyToNull(webhookSignature),
      webhook_timestamp: emptyToNull(webhookTimestamp),
      webhook_payload: emptyToNull(webhookPayload),
      webhook_algorithm: emptyToNull(webhookAlgorithm),
      webhook_signature_base: emptyToNull(webhookSignatureBase),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="event-provider">{labels.provider}</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger id="event-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {allLabels.enums.provider[option] ?? titleCase(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-status">{labels.providerStatus}</Label>
              <Input
                id="event-status"
                value={providerStatus}
                onChange={(event) => setProviderStatus(event.target.value)}
                placeholder={labels.providerStatusPlaceholder}
                required
              />
              <p className="text-xs text-muted-foreground">{labels.statusHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-id">{labels.providerEventId}</Label>
              <Input
                id="event-id"
                value={providerEventId}
                onChange={(event) => setProviderEventId(event.target.value)}
                placeholder={labels.providerEventIdPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-envelope-id">{labels.providerEnvelopeId}</Label>
              <Input
                id="event-envelope-id"
                value={providerEnvelopeId}
                onChange={(event) => setProviderEnvelopeId(event.target.value)}
                placeholder={labels.providerEnvelopeIdPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-recipient-id">{labels.providerRecipientId}</Label>
              <Input
                id="event-recipient-id"
                value={providerRecipientId}
                onChange={(event) => setProviderRecipientId(event.target.value)}
                placeholder={labels.providerRecipientIdPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-evidence-hash">{labels.evidenceHash}</Label>
              <Input
                id="event-evidence-hash"
                value={evidenceHash}
                onChange={(event) => setEvidenceHash(event.target.value)}
                placeholder={labels.evidenceHashPlaceholder}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-occurred-at">{labels.occurredAt}</Label>
            <Input
              id="event-occurred-at"
              type="datetime-local"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-reason">{labels.reason}</Label>
            <Textarea
              id="event-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={labels.reasonPlaceholder}
            />
          </div>
          <div className="rounded-lg border p-4">
            <div>
              <h3 className="text-sm font-semibold">{labels.webhookDiagnostics}</h3>
              <p className="text-xs text-muted-foreground">{labels.webhookDiagnosticsHint}</p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event-webhook-signature">{labels.webhookSignature}</Label>
                <Input
                  id="event-webhook-signature"
                  value={webhookSignature}
                  onChange={(event) => setWebhookSignature(event.target.value)}
                  placeholder={labels.webhookSignaturePlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-webhook-timestamp">{labels.webhookTimestamp}</Label>
                <Input
                  id="event-webhook-timestamp"
                  value={webhookTimestamp}
                  onChange={(event) => setWebhookTimestamp(event.target.value)}
                  placeholder={labels.webhookTimestampPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-webhook-algorithm">{labels.webhookAlgorithm}</Label>
                <Input
                  id="event-webhook-algorithm"
                  value={webhookAlgorithm}
                  onChange={(event) => setWebhookAlgorithm(event.target.value)}
                  placeholder={labels.webhookAlgorithmPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-webhook-base">{labels.signatureBase}</Label>
                <Input
                  id="event-webhook-base"
                  value={webhookSignatureBase}
                  onChange={(event) => setWebhookSignatureBase(event.target.value)}
                  placeholder={labels.signatureBasePlaceholder}
                />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Label htmlFor="event-webhook-payload">{labels.webhookPayload}</Label>
              <Textarea
                id="event-webhook-payload"
                rows={3}
                value={webhookPayload}
                onChange={(event) => setWebhookPayload(event.target.value)}
                placeholder={labels.webhookPayloadPlaceholder}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {labels.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DocumentPreview({
  envelope,
  open,
  dir,
  onOpenChange,
}: {
  envelope: LexSignatureEnvelope;
  open: boolean;
  dir: 'ltr' | 'rtl';
  onOpenChange: (open: boolean) => void;
}) {
  const labels = useSignatureLabels().detail.preview;
  const contractId = envelope.contract_id ?? null;
  const documentId = envelope.document_id ?? null;

  const versionsQuery = useQuery({
    queryKey: ['lex-contract-versions', contractId],
    queryFn: () => enterpriseApi.lex.listContractVersions(contractId as string),
    enabled: open && Boolean(contractId),
  });

  const documentQuery = useQuery({
    queryKey: ['lex-document', documentId],
    queryFn: () => enterpriseApi.lex.getDocument(documentId as string),
    enabled: open && Boolean(documentId) && !contractId,
  });

  const isLoading =
    (Boolean(contractId) && versionsQuery.isLoading) ||
    (Boolean(documentId) && !contractId && documentQuery.isLoading);
  const isError =
    (Boolean(contractId) && versionsQuery.isError) ||
    (Boolean(documentId) && !contractId && documentQuery.isError);

  const latestVersion = [...(versionsQuery.data ?? [])].sort(
    (left, right) => right.version - left.version,
  )[0];

  const fileName = contractId
    ? latestVersion?.file_name
    : documentQuery.data?.file_name ?? undefined;
  const extractedText = contractId ? latestVersion?.extracted_text ?? undefined : undefined;

  const statusMessage = (() => {
    if (!contractId && !documentId) {
      return labels.noTarget;
    }
    if (isLoading) {
      return labels.loading;
    }
    if (isError) {
      return labels.error;
    }
    if (!extractedText && !fileName) {
      return `${labels.empty}. ${labels.emptyDescription}`;
    }
    return undefined;
  })();

  return (
    <DocumentPreviewSheet
      open={open}
      onOpenChange={onOpenChange}
      dir={dir}
      title={labels.title}
      fileName={fileName ?? envelope.title}
      extractedText={statusMessage ?? extractedText}
    />
  );
}

function OverviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

function HashItem({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }
  return (
    <div className="min-w-0">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-xs">{value}</dd>
    </div>
  );
}

async function copyTextToClipboard(
  value: string,
  handlers: { onSuccess: () => void; onFailure: () => void },
): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    handlers.onFailure();
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    handlers.onSuccess();
  } catch {
    handlers.onFailure();
  }
}

function signaturePlacementsFromEnvelope(envelope: LexSignatureEnvelope): LexSignaturePlacement[] {
  const raw = envelope.evidence_metadata?.[SIGNATURE_PLACEMENTS_METADATA_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item, index) => normalizeSignaturePlacement(item, index))
    .filter((item): item is LexSignaturePlacement => item !== null);
}

function signaturePlacementsForRecipient(envelope: LexSignatureEnvelope, recipientId: string): LexSignaturePlacement[] {
  return signaturePlacementsFromEnvelope(envelope).filter(
    (placement) => !placement.recipient_id || placement.recipient_id === recipientId,
  );
}

function normalizeSignaturePlacement(item: unknown, index: number): LexSignaturePlacement | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const raw = item as Record<string, unknown>;
  const kind = typeof raw.kind === 'string' ? raw.kind : 'signature';
  const page = numberOrFallback(raw.page, 1);
  const x = numberOrFallback(raw.x, 0);
  const y = numberOrFallback(raw.y, 0);
  const width = numberOrFallback(raw.width, 20);
  const height = numberOrFallback(raw.height, 8);
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `field-${index + 1}`,
    recipient_id: typeof raw.recipient_id === 'string' && raw.recipient_id.trim() ? raw.recipient_id : null,
    kind,
    page,
    x,
    y,
    width,
    height,
    required: typeof raw.required === 'boolean' ? raw.required : true,
    label: typeof raw.label === 'string' ? raw.label : null,
  };
}

function numberOrFallback(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function initialsForName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function getRecipientSigningLink(envelope: LexSignatureEnvelope, recipient: LexSignatureRecipient): string | null {
  const direct =
    metadataString(recipient.evidence_metadata, SIGNING_LINK_METADATA_KEYS) ??
    metadataString(envelope.evidence_metadata, SIGNING_LINK_METADATA_KEYS);
  if (direct) {
    return direct;
  }

  const signingLinks = metadataObject(envelope.evidence_metadata, 'signing_links');
  if (!signingLinks) {
    return null;
  }
  const byRecipientId = jsonString(signingLinks[recipient.id]);
  if (byRecipientId) {
    return byRecipientId;
  }
  if (recipient.provider_recipient_id) {
    return jsonString(signingLinks[recipient.provider_recipient_id]);
  }
  return null;
}

function signatureRecipientBelongsToCurrentUser(
  recipient: LexSignatureRecipient,
  currentUserId?: string,
  currentUserEmail?: string,
): boolean {
  if (currentUserId && recipient.user_id === currentUserId) {
    return true;
  }
  if (currentUserEmail && recipient.email) {
    return recipient.email.trim().toLowerCase() === currentUserEmail.trim().toLowerCase();
  }
  return false;
}

function canSelfSignRecipient(envelope: LexSignatureEnvelope, recipient: LexSignatureRecipient): boolean {
  const envelopeStatus = String(envelope.status).toLowerCase();
  const recipientStatus = String(recipient.status).toLowerCase();
  const recipientRole = String(recipient.role ?? '').toLowerCase();
  return (
    (envelopeStatus === 'sent' || envelopeStatus === 'viewed') &&
    (recipientStatus === 'sent' || recipientStatus === 'viewed') &&
    recipientRole !== 'carbon_copy'
  );
}

function latestRecipientProviderId(envelope: LexSignatureEnvelope, recipientId: string): string | null {
  return [...(envelope.events ?? [])]
    .filter((event) => event.recipient_id === recipientId && event.provider_recipient_id)
    .sort((left, right) => new Date(right.occurred_at).valueOf() - new Date(left.occurred_at).valueOf())[0]
    ?.provider_recipient_id ?? null;
}

function getEnvelopeProviderId(envelope: LexSignatureEnvelope): string | null {
  const latestEventId = [...(envelope.events ?? [])]
    .filter((event) => event.provider_envelope_id)
    .sort((left, right) => new Date(right.occurred_at).valueOf() - new Date(left.occurred_at).valueOf())[0]
    ?.provider_envelope_id;
  return (
    latestEventId ??
    metadataString(envelope.evidence_metadata, [
      'provider_envelope_id',
      'provider_request_id',
      'nafath_request_id',
      'external_envelope_id',
    ])
  );
}

type OperationsLabels = SignatureLabels['operations'];

function recipientRisk(
  envelope: LexSignatureEnvelope,
  recipient: LexSignatureRecipient,
  ops: OperationsLabels,
  statusLabels: Record<string, string>,
): { label: string; detail: string; tone: 'low' | 'medium' | 'high'; factors: string[] } {
  const status = String(recipient.status).toLowerCase();
  const factors: string[] = [];

  if (status === 'signed') {
    return {
      label: ops.riskStates.cleared,
      detail: ops.riskStates.clearedDetail,
      tone: 'low',
      factors,
    };
  }

  if (status === 'declined' || status === 'cancelled') {
    factors.push(statusLabels[status] ?? titleCase(status));
    return {
      label: ops.riskStates.blocked,
      detail: recipient.decline_reason ?? ops.riskStates.blockedDetail,
      tone: 'high',
      factors,
    };
  }

  if (status === 'expired') {
    factors.push(ops.riskFactors.expired);
    return {
      label: ops.riskStates.expired,
      detail: ops.riskStates.expiredDetail,
      tone: 'high',
      factors,
    };
  }

  let highSignal = false;
  if (!recipient.email && !recipient.phone) {
    factors.push(ops.riskFactors.noContact);
    highSignal = true;
  }
  if (envelope.expires_at && isPast(envelope.expires_at)) {
    factors.push(ops.riskFactors.envelopeExpired);
    highSignal = true;
  } else if (envelope.expires_at && hoursUntil(envelope.expires_at) <= 24) {
    factors.push(ops.riskFactors.expiresSoon);
  }
  if (envelope.due_at && isPast(envelope.due_at)) {
    factors.push(ops.riskFactors.pastDue);
    highSignal = true;
  }
  if (envelope.provider !== 'native' && !recipient.provider_recipient_id) {
    factors.push(ops.riskFactors.missingProviderId);
  }
  if (recipient.status === 'sent' && recipient.updated_at && daysSince(recipient.updated_at) >= 3) {
    factors.push(ops.riskFactors.staleDelivery);
  }

  if (highSignal) {
    return {
      label: ops.riskStates.high,
      detail: factors[0],
      tone: 'high',
      factors,
    };
  }
  if (factors.length > 0) {
    return {
      label: ops.riskStates.watch,
      detail: factors[0],
      tone: 'medium',
      factors,
    };
  }
  return {
    label: ops.riskStates.normal,
    detail: ACTIVE_SIGNATURE_STATUSES.has(status) ? ops.riskStates.normalActive : ops.riskStates.normalInactive,
    tone: 'low',
    factors,
  };
}

function providerSyncState(
  envelope: LexSignatureEnvelope,
  ops: OperationsLabels,
  latestEvent?: SignatureEvent,
): { label: string; detail: string; tone: OperationNotice['variant'] } {
  const latestStatus = latestEvent?.provider_status ?? envelope.status;
  const normalized = String(latestStatus).toLowerCase();
  if (statusLooksFailed(normalized)) {
    return {
      label: ops.syncStates.attention,
      detail: latestEvent
        ? ops.syncStates.attentionLatest(latestEvent.provider_status ?? latestEvent.event_type)
        : ops.syncStates.attentionStatus(envelope.status),
      tone: 'destructive',
    };
  }
  if (normalized.includes('signed') || normalized.includes('complete') || envelope.status === 'signed') {
    return {
      label: ops.syncStates.complete,
      detail: latestEvent ? ops.syncStates.completeAt(formatDateTime(latestEvent.occurred_at)) : ops.syncStates.completeSigned,
      tone: 'success',
    };
  }
  if (latestEvent) {
    return {
      label: ops.syncStates.synced,
      detail: ops.syncStates.syncedLatest(latestEvent.provider_status ?? latestEvent.event_type),
      tone: 'default',
    };
  }
  if (envelope.provider === 'native') {
    return {
      label: ops.syncStates.native,
      detail: ops.syncStates.nativeDetail,
      tone: 'default',
    };
  }
  return {
    label: ops.syncStates.waiting,
    detail: ops.syncStates.waitingDetail,
    tone: 'warning',
  };
}

function statusLooksFailed(status: string): boolean {
  const normalized = status.toLowerCase();
  return FAILURE_STATUS_TERMS.some((term) => normalized.includes(term));
}

function providerFailureExplanation(provider: string, status: string, ops: OperationsLabels): string | null {
  const normalized = status.toLowerCase();
  if (!statusLooksFailed(normalized)) {
    return null;
  }
  if (provider === 'nafath') {
    if (normalized.includes('timeout') || normalized.includes('expire')) {
      return ops.failureExplanations.nafathTimeout;
    }
    if (normalized.includes('declin') || normalized.includes('reject')) {
      return ops.failureExplanations.nafathDeclined;
    }
    return ops.failureExplanations.nafathGeneric;
  }
  if (provider === 'external') {
    if (normalized.includes('cancel') || normalized.includes('void')) {
      return ops.failureExplanations.externalVoided;
    }
    return ops.failureExplanations.externalGeneric;
  }
  return ops.failureExplanations.nativeGeneric;
}

function custodyRetentionStatus(entries: CustodyEvidence[], ops: OperationsLabels): {
  label: string;
  detail: string;
  tone: OperationNotice['variant'];
} {
  if (entries.some((entry) => metadataBoolean(entry.retention_metadata, ['legal_hold', 'hold', 'retention_hold']) === true)) {
    return {
      label: ops.retentionStates.legalHold,
      detail: ops.retentionStates.legalHoldDetail,
      tone: 'warning',
    };
  }

  const retentionDates = entries
    .map((entry) =>
      metadataString(entry.retention_metadata, [
        'retention_until',
        'retain_until',
        'delete_after',
        'expires_at',
      ]),
    )
    .filter((value): value is string => Boolean(value));
  const earliestRetention = earliestDate(retentionDates);
  if (earliestRetention) {
    if (isPast(earliestRetention)) {
      return {
        label: ops.retentionStates.reviewDue,
        detail: ops.retentionStates.reviewDueDetail(formatDateTime(earliestRetention)),
        tone: 'warning',
      };
    }
    return {
      label: ops.retentionStates.retained,
      detail: ops.retentionStates.retainedDetail(formatDateTime(earliestRetention)),
      tone: 'success',
    };
  }

  const policy = entries
    .map((entry) => metadataString(entry.retention_metadata, ['policy', 'retention_policy', 'schedule']))
    .find((value): value is string => Boolean(value));
  if (policy) {
    return {
      label: ops.retentionStates.policySet,
      detail: policy,
      tone: 'default',
    };
  }
  return {
    label: ops.retentionStates.notSpecified,
    detail: ops.retentionStates.notSpecifiedDetail,
    tone: 'warning',
  };
}

function buildCustodyPackage(envelope: LexSignatureEnvelope) {
  return {
    package_type: 'lex_signature_custody_evidence',
    generated_at: new Date().toISOString(),
    envelope: {
      id: envelope.id,
      title: envelope.title,
      status: envelope.status,
      provider: envelope.provider,
      method: envelope.method,
      target_type: envelope.target_type,
      contract_id: envelope.contract_id ?? null,
      document_id: envelope.document_id ?? null,
      evidence_hash: envelope.evidence_hash ?? null,
      completed_at: envelope.completed_at ?? null,
    },
    summary: {
      recipient_count: envelope.recipient_count ?? envelope.recipients?.length ?? 0,
      signed_count:
        envelope.signed_count ??
        (envelope.recipients ?? []).filter((recipient) => recipient.status === 'signed').length,
      custody_evidence_count: envelope.custody_evidence?.length ?? 0,
      provider_event_count: envelope.events?.length ?? 0,
      provider_envelope_id: getEnvelopeProviderId(envelope),
      hash_verification: {
        envelope_evidence_hash_present: Boolean(envelope.evidence_hash),
        content_hashes_present: (envelope.custody_evidence ?? []).every((entry) => Boolean(entry.content_hash)),
        seal_or_evidence_hashes_present: (envelope.custody_evidence ?? []).every((entry) =>
          Boolean(entry.seal_hash || entry.evidence_hash),
        ),
      },
    },
    recipients: (envelope.recipients ?? []).map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: recipient.email ?? null,
      phone: recipient.phone ?? null,
      role: recipient.role ?? null,
      status: recipient.status,
      signing_order: recipient.signing_order,
      provider_recipient_id: recipient.provider_recipient_id ?? latestRecipientProviderId(envelope, recipient.id),
      evidence_hash: recipient.evidence_hash ?? null,
      viewed_at: recipient.viewed_at ?? null,
      signed_at: recipient.signed_at ?? null,
      declined_at: recipient.declined_at ?? null,
    })),
    provider_events: (envelope.events ?? []).map((event) => ({
      id: event.id,
      event_type: event.event_type,
      recipient_id: event.recipient_id ?? null,
      provider: event.provider ?? null,
      provider_status: event.provider_status ?? null,
      provider_event_id: event.provider_event_id ?? null,
      provider_envelope_id: event.provider_envelope_id ?? null,
      provider_recipient_id: event.provider_recipient_id ?? null,
      evidence_hash: event.evidence_hash ?? null,
      evidence_metadata: event.evidence_metadata ?? {},
      occurred_at: event.occurred_at,
    })),
    custody_evidence: (envelope.custody_evidence ?? []).map((entry) => ({
      id: entry.id,
      file_id: entry.file_id,
      file_name: entry.file_name,
      file_size_bytes: entry.file_size_bytes,
      content_hash: entry.content_hash,
      seal_hash: entry.seal_hash ?? null,
      evidence_hash: entry.evidence_hash ?? null,
      provider: entry.provider,
      signed_at: entry.signed_at,
      retention_metadata: entry.retention_metadata,
      custody_metadata: entry.custody_metadata,
      created_at: entry.created_at,
    })),
  };
}

function metadataString(metadata: JsonObject | undefined, keys: string[]): string | null {
  if (!metadata) {
    return null;
  }
  for (const key of keys) {
    const value = jsonString(metadata[key]);
    if (value) {
      return value;
    }
  }
  for (const parent of ['webhook', 'webhook_validation', 'signature_validation', 'provider', 'nafath']) {
    const child = metadataObject(metadata, parent);
    if (!child) {
      continue;
    }
    for (const key of keys) {
      const value = jsonString(child[key]);
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function metadataBoolean(metadata: JsonObject | undefined, keys: string[]): boolean | null {
  if (!metadata) {
    return null;
  }
  for (const key of keys) {
    const value = jsonBoolean(metadata[key]);
    if (value !== null) {
      return value;
    }
  }
  for (const parent of ['webhook', 'webhook_validation', 'signature_validation']) {
    const child = metadataObject(metadata, parent);
    if (!child) {
      continue;
    }
    for (const key of keys) {
      const value = jsonBoolean(child[key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function metadataObject(metadata: JsonObject | undefined, key: string): JsonObject | null {
  if (!metadata) {
    return null;
  }
  const value = metadata[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function jsonString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function jsonBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    if (['true', 'valid', 'validated', 'yes', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'invalid', 'no', '0'].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function isPast(value: string): boolean {
  const parsed = new Date(value).valueOf();
  return Number.isFinite(parsed) && parsed < Date.now();
}

function hoursUntil(value: string): number {
  const parsed = new Date(value).valueOf();
  if (!Number.isFinite(parsed)) {
    return Number.POSITIVE_INFINITY;
  }
  return (parsed - Date.now()) / 36e5;
}

function daysSince(value: string): number {
  const parsed = new Date(value).valueOf();
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return (Date.now() - parsed) / 86_400_000;
}

function relativeAge(value: string): string {
  const parsed = new Date(value).valueOf();
  if (!Number.isFinite(parsed)) {
    return 'Unknown age';
  }
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function latestDate(values: string[]): string | null {
  const sorted = values
    .filter((value) => Number.isFinite(new Date(value).valueOf()))
    .sort((left, right) => new Date(right).valueOf() - new Date(left).valueOf());
  return sorted[0] ?? null;
}

function earliestDate(values: string[]): string | null {
  const sorted = values
    .filter((value) => Number.isFinite(new Date(value).valueOf()))
    .sort((left, right) => new Date(left).valueOf() - new Date(right).valueOf());
  return sorted[0] ?? null;
}

async function invalidateEnvelope(
  queryClient: ReturnType<typeof useQueryClient>,
  envelopeId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['lex-signature', envelopeId] }),
    queryClient.invalidateQueries({ queryKey: ['lex-signatures'] }),
  ]);
}

function formatDateOrNotSet(value: string | null | undefined, notSet: string): string {
  return value ? formatDateTime(value) : notSet;
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoOrNull(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
