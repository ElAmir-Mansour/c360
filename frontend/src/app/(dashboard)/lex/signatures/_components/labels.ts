'use client';

/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the Watheeq
 * signature envelope + chain-of-custody surface (page + create dialog + detail
 * sheet + recipient/custody/provider-event dialogs).
 *
 * Follows the canonical lex i18n contract (see `../../_lib/lex-i18n.ts`): a
 * single {@link LexBilingual} bundle with two full, same-shaped copies and a
 * thin `useSignatureLabels()` hook that resolves against the active locale. The
 * `en` side equals the pre-existing English strings exactly so existing
 * English-asserting tests stay green; the `ar` side is professional MSA for the
 * enterprise legal e-signature domain.
 *
 * Function-valued fields (e.g. `signedOf(signed, total)`) appear on BOTH sides
 * and preserve interpolation params + Western digits. Enum maps (`enums.*`,
 * `filters.*Options`) are keyed by the RAW backend token with the same key set
 * on both locales.
 *
 * Glossary anchors: توقيع (signature) / مظروف (envelope) / عقد (contract) /
 * حجز قانوني (legal hold) / سلسلة العهدة (chain of custody) / مستلِم (recipient).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface SignatureLabels {
  page: {
    title: string;
    description: string;
    reports: string;
    newEnvelope: string;
    searchPlaceholder: string;
  };
  views: {
    portfolio: { label: string; description: string };
    myEnvelopes: { label: string; description: string };
    expiringSoon: { label: string; description: string };
    awaitingSigner: { label: string; description: string };
    declined: { label: string; description: string };
    nafathIssues: { label: string; description: string };
    missingCustody: { label: string; description: string };
    contractSignatures: { label: string; description: string };
  };
  bulkActions: {
    send: string;
    cancel: string;
    export: string;
    remind: string;
    extend: string;
    archive: string;
  };
  savedViews: {
    save: string;
    saved: string;
    empty: string;
  };
  filters: {
    status: string;
    provider: string;
    statusOptions: Record<string, string>;
    providerOptions: Record<string, string>;
  };
  enums: {
    targetType: Record<string, string>;
    provider: Record<string, string>;
    method: Record<string, string>;
    recipientAction: Record<string, string>;
    /** Audit event-type verbs (`SignatureEventType`), keyed by raw backend token. */
    eventType: Record<string, string>;
    language: Record<string, string>;
  };
  validation: {
    recipientNameRequired: string;
    emailInvalid: string;
    titleRequired: string;
    recipientsMin: string;
    contractIdRequired: string;
    documentIdRequired: string;
  };
  upcoming: {
    noDeadline: string;
  };
  table: {
    envelope: string;
    contract: string;
    target: string;
    status: string;
    recipients: string;
    deadline: string;
    updated: string;
    actions: string;
    providerNotSet: string;
    notLinked: string;
    linkedContract: string;
    standaloneDocument: string;
    signedOf: (signed: number, total: number) => string;
    open: string;
    send: string;
    cancel: string;
  };
  emptyState: {
    title: string;
    description: string;
    cta: string;
  };
  kpi: {
    total: string;
    pending: string;
    signed: string;
    declined: string;
    overdue: string;
    dueSoon: string;
    providerIssues: string;
    custodyGaps: string;
  };
  kpiDetails: {
    total: string;
    pending: string;
    signed: string;
    declined: string;
    overdue: string;
    providerIssues: string;
    envelopeShare: string;
    loadedRows: string;
    providerHealth: string;
  };
  risk: {
    heading: string;
    summary: (overdue: string, dueSoon: string, providerFailures: string, missingCustody: string) => string;
    listMode: string;
    calendarMode: string;
    emptyList: string;
    emptyCalendar: string;
    loading: string;
    error: string;
    retry: string;
    countdownLabel: string;
    custodyMissing: string;
    providerIssue: string;
    diagnosticsNote: string;
  };
  toast: {
    sent: { title: string; detail: string };
    cancelled: { title: string; detail: string };
    created: { title: string; detail: string };
    recipientAction: { title: string; detail: string };
    custody: { title: string; detail: string };
    providerEvent: { title: string; detail: string };
    placements: { title: string; detail: string };
    bulkSent: { title: string; detail: (count: number) => string };
    bulkCancelled: { title: string; detail: (count: number) => string };
    bulkReminder: { title: string; detail: (count: number) => string };
    bulkExtend: { title: string; detail: (count: number) => string };
    bulkArchive: { title: string; detail: (count: number) => string };
  };
  cancelReason: string;
  create: {
    title: string;
    description: string;
    sections: {
      target: string;
      delivery: string;
      recipients: string;
      preflight: string;
    };
    fields: {
      targetType: string;
      contractId: string;
      documentId: string;
      title: string;
      subject: string;
      message: string;
      language: string;
      provider: string;
      method: string;
      dueAt: string;
      expiresAt: string;
    };
    placeholders: {
      contractId: string;
      documentId: string;
      title: string;
      subject: string;
      message: string;
    };
    targetHint: {
      contract: string;
      document: string;
    };
    targetPicker: {
      label: string;
      contractPlaceholder: string;
      documentPlaceholder: string;
      searchPlaceholder: string;
      loading: string;
      noResults: string;
      error: string;
      retry: string;
      clear: string;
      createContract: string;
      selected: string;
      manualEntry: string;
      manualDescription: string;
      previewHeading: string;
      previewMissing: string;
      recentHint: string;
      updated: (value: string) => string;
    };
    recipientsHint: string;
    recipient: {
      heading: (index: number) => string;
      internalUser: string;
      internalUserDescription: string;
      name: string;
      email: string;
      phone: string;
      role: string;
      method: string;
      language: string;
      namePlaceholder: string;
      emailPlaceholder: string;
      phonePlaceholder: string;
      rolePlaceholder: string;
      remove: string;
      add: string;
      moveUp: string;
      moveDown: string;
      orderBadge: (order: number) => string;
    };
    rolePresets: {
      authorisedSignatory: string;
      counterpartyReviewer: string;
      financeApprover: string;
      legalCounsel: string;
      witness: string;
    };
    recipientTools: {
      presets: string;
      presetsHint: string;
      useTemplate: string;
      replaceWithTemplate: string;
      primarySignerTemplate: string;
      counterpartyTemplate: string;
      boardTemplate: string;
      bulkTitle: string;
      bulkPlaceholder: string;
      bulkHint: string;
      bulkImportAppend: string;
      bulkImportReplace: string;
      bulkImported: (count: number) => string;
      saveGroup: string;
      groupNamePlaceholder: string;
      savedGroups: string;
      savedGroupCount: (count: number) => string;
      noSavedGroups: string;
      useGroup: string;
      removeGroup: string;
      savedGroupBadge: (count: number) => string;
    };
    preflight: {
      title: string;
      description: string;
      ready: string;
      needsReview: string;
      targetSelected: string;
      recipientsReachable: string;
      languageConsentReady: string;
      dueDateValid: string;
      targetPreviewKnown: string;
      custodyStrategySet: string;
    };
    cancel: string;
    submit: string;
  };
  detail: {
    triggerAria: (title: string) => string;
    description: string;
    loading: string;
    error: string;
    empty: string;
    tabs: {
      recipients: string;
      custody: string;
      events: string;
    };
    journey: {
      heading: string;
      serial: string;
      parallel: string;
      flowLabel: string;
      statuses: Record<string, string>;
      nafathStatuses: Record<string, string>;
    };
    auditTimeline: {
      heading: string;
      empty: string;
      custodySealed: (fileName: string) => string;
      custodyDetail: string;
      providerVia: (provider: string) => string;
    };
    preview: {
      action: string;
      title: string;
      loading: string;
      error: string;
      empty: string;
      emptyDescription: string;
      noTarget: string;
    };
    overview: {
      provider: string;
      method: string;
      language: string;
      due: string;
      expires: string;
      sent: string;
      completed: string;
      notSet: string;
    };
    recipients: {
      empty: string;
      order: (order: number) => string;
      viewed: string;
      signed: string;
      declined: string;
      recordAction: string;
      signAsMe: string;
      viewRendering: string;
    };
    rendering: {
      title: (name: string) => string;
      description: string;
      loading: string;
      error: string;
      primary: string;
      secondary: string;
      subject: string;
      message: string;
      consent: string;
      close: string;
    };
    action: {
      title: (name: string) => string;
      selfTitle: (name: string) => string;
      description: string;
      selfDescription: string;
      action: string;
      actorName: string;
      actorEmail: string;
      evidenceHash: string;
      declineReason: string;
      actorNamePlaceholder: string;
      evidenceHashPlaceholder: string;
      declineReasonPlaceholder: string;
      savedSignature: string;
      loadingSignatureProfile: string;
      noSavedSignature: string;
      manageSignature: string;
      signaturePreview: string;
      cancel: string;
      submit: string;
      selfSubmit: string;
    };
    placements: {
      action: string;
      title: string;
      description: string;
      empty: string;
      add: string;
      save: string;
      saving: string;
      remove: string;
      recipient: string;
      allRecipients: string;
      kind: string;
      kindOptions: Record<string, string>;
      page: string;
      x: string;
      y: string;
      width: string;
      height: string;
      required: string;
      label: string;
      fieldPreview: string;
      placementCount: (count: number) => string;
    };
    custody: {
      empty: string;
      record: string;
      sealHash: string;
      contentHash: string;
      signedAt: string;
      size: string;
    };
    custodyForm: {
      title: string;
      description: string;
      fileId: string;
      fileName: string;
      fileSize: string;
      contentHash: string;
      sealHash: string;
      evidenceHash: string;
      provider: string;
      signedAt: string;
      fileIdPlaceholder: string;
      fileNamePlaceholder: string;
      contentHashPlaceholder: string;
      sealHashPlaceholder: string;
      evidenceHashPlaceholder: string;
      cancel: string;
      submit: string;
    };
    providerEvent: {
      title: string;
      description: string;
      empty: string;
      record: string;
      provider: string;
      providerStatus: string;
      providerEventId: string;
      providerEnvelopeId: string;
      occurredAt: string;
      reason: string;
      providerStatusPlaceholder: string;
      providerEventIdPlaceholder: string;
      providerEnvelopeIdPlaceholder: string;
      reasonPlaceholder: string;
      statusHint: string;
      providerRecipientId: string;
      providerRecipientIdPlaceholder: string;
      evidenceHash: string;
      evidenceHashPlaceholder: string;
      webhookDiagnostics: string;
      webhookDiagnosticsHint: string;
      webhookSignature: string;
      webhookSignaturePlaceholder: string;
      webhookTimestamp: string;
      webhookTimestampPlaceholder: string;
      webhookAlgorithm: string;
      webhookAlgorithmPlaceholder: string;
      signatureBase: string;
      signatureBasePlaceholder: string;
      webhookPayload: string;
      webhookPayloadPlaceholder: string;
      cancel: string;
      submit: string;
    };
  };
  /**
   * Operations surface inside the detail sheet: recipient operations, provider
   * sync center, custody evidence package, webhook diagnostics, and the
   * status/risk helper copy returned by the diagnostic helper functions.
   */
  operations: {
    syncTab: string;
    recipient: {
      progress: string;
      lastActivity: (when: string) => string;
      noActivity: string;
      risk: string;
      provider: string;
      providerRecipientId: (method: string) => string;
      providerRecipientIdMissing: string;
      evidenceHashCaptured: string;
      noContact: string;
      copySigningLink: string;
      resend: string;
      nudge: string;
      replace: string;
      skip: string;
      notConnected: (action: string) => string;
      copyLinkAction: string;
      copyLinkUnavailable: string;
      signingLinkCopiedTitle: string;
      signingLinkCopiedDetail: string;
      clipboardBlockedTitle: string;
      clipboardBlockedDetail: string;
      resendDetail: string;
      nudgeDetail: string;
      replaceDetail: string;
      skipDetail: string;
    };
    riskStates: {
      cleared: string;
      clearedDetail: string;
      blocked: string;
      blockedDetail: string;
      expired: string;
      expiredDetail: string;
      high: string;
      watch: string;
      normal: string;
      normalActive: string;
      normalInactive: string;
    };
    riskFactors: {
      expired: string;
      noContact: string;
      envelopeExpired: string;
      expiresSoon: string;
      pastDue: string;
      missingProviderId: string;
      staleDelivery: string;
    };
    sync: {
      status: string;
      provider: string;
      webhook: string;
      envelopeIdPrefix: (id: string) => string;
      providerEnvelopeIdMissing: string;
      validated: string;
      notValidated: string;
      noValidationFlag: string;
      latestEvent: (when: string) => string;
      noProviderEvents: string;
      failureExplanationTitle: (provider: string) => string;
      identifiersTitle: string;
      identifiersHint: string;
      retryFailedSync: string;
      recordProviderEvent: string;
      envelopeProviderId: string;
      latestProviderEventId: string;
      latestProviderStatus: string;
      webhookTimestamp: string;
      webhookAlgorithm: string;
      envelopeEvidenceHash: string;
      notSet: string;
      noProviderStatusRecorded: string;
      notPresent: string;
      notCaptured: string;
      providerRecipientIds: string;
      noRecipients: string;
      providerRecipientIdNotSet: string;
      diagnosticsTitle: string;
      signature: string;
      signatureValid: string;
      signatureInvalid: string;
      signatureNotChecked: string;
      payload: string;
      payloadHashNotStored: string;
      callbackAge: string;
      noCallback: string;
      recentEventsTitle: string;
      eventEnvelopePrefix: (id: string) => string;
      eventRecipientPrefix: (id: string) => string;
    };
    syncStates: {
      attention: string;
      attentionLatest: (status: string) => string;
      attentionStatus: (status: string) => string;
      complete: string;
      completeAt: (when: string) => string;
      completeSigned: string;
      synced: string;
      syncedLatest: (status: string) => string;
      native: string;
      nativeDetail: string;
      waiting: string;
      waitingDetail: string;
    };
    noFailedSyncTitle: string;
    noFailedSyncDetail: string;
    retryUnavailableTitle: string;
    retryUnavailableDetail: string;
    failureExplanations: {
      nafathTimeout: string;
      nafathDeclined: string;
      nafathGeneric: string;
      externalVoided: string;
      externalGeneric: string;
      nativeGeneric: string;
    };
    custody: {
      evidencePackage: string;
      fileCount: (count: number) => string;
      latestSeal: (when: string) => string;
      noSignedDate: string;
      hashVerification: string;
      sealedOf: (sealed: number, total: number) => string;
      hashesPresent: string;
      hashesMissing: string;
      retention: string;
      missingPackageTitle: string;
      missingPackageDetail: string;
      pickupArtifact: string;
      downloadJson: string;
      hashIncompleteTitle: string;
      hashIncompleteDetail: string;
      evidenceHash: string;
      fileId: string;
      retentionInline: (label: string, detail: string) => string;
      downloadedTitle: string;
      downloadedDetail: string;
      pickupTitle: string;
      pickupDetail: string;
    };
    retentionStates: {
      legalHold: string;
      legalHoldDetail: string;
      reviewDue: string;
      reviewDueDetail: (when: string) => string;
      retained: string;
      retainedDetail: (when: string) => string;
      policySet: string;
      notSpecified: string;
      notSpecifiedDetail: string;
    };
  };
}

export const signatureLabels: LexBilingual<SignatureLabels> = {
  en: {
    page: {
      title: 'Signature Envelopes',
      description:
        'E-signature handoff and chain-of-custody tracking for contracts and documents moving through draft, sent, signed, and completed states.',
      reports: 'Reports',
      newEnvelope: 'New Envelope',
      searchPlaceholder: 'Search signature envelopes...',
    },
    views: {
      portfolio: {
        label: 'Portfolio',
        description: 'All signature envelopes',
      },
      myEnvelopes: {
        label: 'My envelopes',
        description: 'Loaded envelopes sent or created by you',
      },
      expiringSoon: {
        label: 'Expiring soon',
        description: 'Loaded open envelopes due in the next 14 days',
      },
      awaitingSigner: {
        label: 'Awaiting signer',
        description: 'Sent or viewed envelopes waiting on recipients',
      },
      declined: {
        label: 'Declined',
        description: 'Declined envelopes',
      },
      nafathIssues: {
        label: 'Nafath issues',
        description: 'Nafath envelopes with loaded provider failures',
      },
      missingCustody: {
        label: 'Missing custody',
        description: 'Signed loaded envelopes without custody evidence',
      },
      contractSignatures: {
        label: 'Contract signatures',
        description: 'Envelopes linked to contracts',
      },
    },
    bulkActions: {
      send: 'Send',
      cancel: 'Cancel',
      export: 'Export',
      remind: 'Remind',
      extend: 'Extend',
      archive: 'Archive',
    },
    savedViews: {
      save: 'Save current signature view',
      saved: 'Saved signature views',
      empty: 'No saved signature views yet',
    },
    filters: {
      status: 'Status',
      provider: 'Provider',
      statusOptions: {
        draft: 'Draft',
        sent: 'Sent',
        viewed: 'Viewed',
        signed: 'Signed',
        declined: 'Declined',
        expired: 'Expired',
        cancelled: 'Cancelled',
      },
      providerOptions: {
        native: 'Native',
        nafath: 'Nafath',
        external: 'External',
      },
    },
    enums: {
      targetType: {
        contract: 'Contract',
        document: 'Document',
      },
      provider: {
        native: 'Native',
        nafath: 'Nafath',
        external: 'External',
      },
      method: {
        otp: 'Otp',
        nafath: 'Nafath',
        certificate: 'Certificate',
        wet_signature: 'Wet signature',
      },
      recipientAction: {
        view: 'View',
        sign: 'Sign',
        decline: 'Decline',
      },
      eventType: {
        created: 'Created',
        sent: 'Sent',
        viewed: 'Viewed',
        signed: 'Signed',
        declined: 'Declined',
        expired: 'Expired',
        cancelled: 'Cancelled',
        custody_recorded: 'Custody Recorded',
      },
      language: {
        en: 'English',
        ar: 'العربية',
        bilingual: 'Bilingual',
      },
    },
    validation: {
      recipientNameRequired: 'Recipient name is required.',
      emailInvalid: 'Enter a valid email.',
      titleRequired: 'Title is required.',
      recipientsMin: 'Add at least one recipient.',
      contractIdRequired: 'Select a contract for a contract envelope.',
      documentIdRequired: 'Select a document for a document envelope.',
    },
    upcoming: {
      noDeadline: 'No deadline',
    },
    table: {
      envelope: 'Envelope',
      contract: 'Contract',
      target: 'Target',
      status: 'Status',
      recipients: 'Recipients',
      deadline: 'Deadline',
      updated: 'Updated',
      actions: 'Actions',
      providerNotSet: 'Provider not set',
      notLinked: 'Not linked',
      linkedContract: 'Linked contract',
      standaloneDocument: 'Standalone document',
      signedOf: (signed, total) => `${signed}/${total} signed`,
      open: 'Open',
      send: 'Send',
      cancel: 'Cancel',
    },
    emptyState: {
      title: 'No signature envelopes found',
      description: 'No contract or document signature handoffs matched the current filters.',
      cta: 'Create your first envelope',
    },
    kpi: {
      total: 'Envelopes',
      pending: 'Awaiting signature',
      signed: 'Signed',
      declined: 'Declined / expired',
      overdue: 'Overdue',
      dueSoon: 'Due in 7 days',
      providerIssues: 'Provider issues',
      custodyGaps: 'Custody gaps',
    },
    kpiDetails: {
      total: 'Signature envelopes matching the current portfolio view.',
      pending: 'Sent or viewed envelopes awaiting recipient action.',
      signed: 'Envelopes completed with signature evidence.',
      declined: 'Recipients declined or envelopes expired.',
      overdue: 'Loaded envelopes past expiry or due date.',
      providerIssues: 'Loaded envelopes with provider failure signals.',
      envelopeShare: 'Envelope share',
      loadedRows: 'Loaded rows',
      providerHealth: 'Provider health',
    },
    risk: {
      heading: 'Deadline risk center',
      summary: (overdue, dueSoon, providerFailures, missingCustody) =>
        `${overdue} overdue · ${dueSoon} due in 7 days · ${providerFailures} provider issue(s) · ${missingCustody} custody gap(s)`,
      listMode: 'List',
      calendarMode: 'Calendar',
      emptyList: 'No loaded envelopes have active due or expiry dates.',
      emptyCalendar: 'No loaded deadlines to place on the calendar.',
      loading: 'Loading deadline risk...',
      error: 'Unable to load the deadline risk center.',
      retry: 'Retry',
      countdownLabel: 'Time to expiry',
      custodyMissing: 'Custody missing',
      providerIssue: 'Provider issue',
      diagnosticsNote:
        'Status totals use backend count queries. Provider failures, custody gaps and expiry diagnostics use the currently loaded envelope rows.',
    },
    toast: {
      sent: {
        title: 'Signature envelope sent.',
        detail: 'Recipients can now complete the signing handoff.',
      },
      cancelled: {
        title: 'Signature envelope cancelled.',
        detail: 'The signing handoff is no longer active.',
      },
      created: {
        title: 'Signature envelope created.',
        detail: 'The envelope is in draft and ready to send to recipients.',
      },
      recipientAction: {
        title: 'Recipient action recorded.',
        detail: 'The recipient timeline and envelope status have been updated.',
      },
      custody: {
        title: 'Custody evidence recorded.',
        detail: 'The signed artefact is now sealed into the chain of custody.',
      },
      providerEvent: {
        title: 'Provider event recorded.',
        detail: 'The external provider event has been appended to the audit trail.',
      },
      placements: {
        title: 'Signature fields saved.',
        detail: 'Native signature and initials placement fields were updated.',
      },
      bulkSent: {
        title: 'Selected envelopes sent.',
        detail: (count) => `${count} envelope(s) were submitted.`,
      },
      bulkCancelled: {
        title: 'Selected envelopes cancelled.',
        detail: (count) => `${count} envelope(s) were cancelled.`,
      },
      bulkReminder: {
        title: 'Reminder queue prepared.',
        detail: (count) => `${count} open envelope(s) selected for reminder follow-up.`,
      },
      bulkExtend: {
        title: 'Deadline extension review prepared.',
        detail: (count) =>
          `${count} envelope(s) selected. No direct extension endpoint is available yet.`,
      },
      bulkArchive: {
        title: 'Archive set prepared.',
        detail: (count) => `${count} completed envelope(s) selected for archive policy review.`,
      },
    },
    cancelReason: 'Cancelled from Watheeq signature console',
    create: {
      title: 'New Signature Envelope',
      description:
        'Define the signing target, delivery copy, provider, and the ordered list of recipients for this handoff.',
      sections: {
        target: 'Signing target',
        delivery: 'Delivery & provider',
        recipients: 'Recipients',
        preflight: 'Pre-send validation',
      },
      fields: {
        targetType: 'Target type',
        contractId: 'Contract',
        documentId: 'Document',
        title: 'Envelope title',
        subject: 'Subject',
        message: 'Message',
        language: 'Language',
        provider: 'Provider',
        method: 'Signing method',
        dueAt: 'Due date',
        expiresAt: 'Expiry date',
      },
      placeholders: {
        contractId: 'Select a contract',
        documentId: 'Select a document',
        title: 'Master Services Agreement — signature',
        subject: 'Please sign: Master Services Agreement',
        message: 'Kindly review and apply your signature to the attached agreement.',
      },
      targetHint: {
        contract: 'Select the contract this envelope is bound to.',
        document: 'Select the document this envelope is bound to.',
      },
      targetPicker: {
        label: 'Select signing target',
        contractPlaceholder: 'Search recent contracts',
        documentPlaceholder: 'Search recent documents',
        searchPlaceholder: 'Search by title, party, or reference number...',
        loading: 'Loading targets...',
        noResults: 'No matching targets found.',
        error: 'Unable to load signing targets.',
        retry: 'Retry',
        clear: 'Clear selection',
        createContract: 'Create contract',
        selected: 'Selected target',
        manualEntry: 'Use another record reference',
        manualDescription: 'Use this only when the target is unavailable in search.',
        previewHeading: 'Target preview',
        previewMissing: 'Choose a row from the list to identify the document for signature.',
        recentHint: 'Recent results are listed below and update as you search.',
        updated: (value) => `Updated ${value}`,
      },
      recipientsHint:
        'Each recipient signs in the listed order. At least one recipient with a name is required.',
      recipient: {
        heading: (index) => `Recipient ${index + 1}`,
        internalUser: 'Internal platform user',
        internalUserDescription:
          'Choose a tenant user to bind signing to their account, or leave blank for an external signer.',
        name: 'Full name',
        email: 'Email',
        phone: 'Phone',
        role: 'Role',
        method: 'Method',
        language: 'Language',
        namePlaceholder: 'Layla Al-Harbi',
        emailPlaceholder: 'layla@counterparty.com',
        phonePlaceholder: '+966 5X XXX XXXX',
        rolePlaceholder: 'Authorised signatory',
        remove: 'Remove recipient',
        add: 'Add recipient',
        moveUp: 'Move recipient earlier',
        moveDown: 'Move recipient later',
        orderBadge: (order) => `Order ${order}`,
      },
      rolePresets: {
        authorisedSignatory: 'Authorised signatory',
        counterpartyReviewer: 'Counterparty reviewer',
        financeApprover: 'Finance approver',
        legalCounsel: 'Legal counsel',
        witness: 'Witness',
      },
      recipientTools: {
        presets: 'Signer role presets',
        presetsHint: 'Apply common roles to the active recipient or use a template to rebuild the signer list.',
        useTemplate: 'Use template',
        replaceWithTemplate: 'Replace recipients',
        primarySignerTemplate: 'Single authorised signer',
        counterpartyTemplate: 'Internal + counterparty',
        boardTemplate: 'Board approval',
        bulkTitle: 'Bulk import',
        bulkPlaceholder:
          'Name, email, phone, role, method, language\nLayla Al-Harbi, layla@counterparty.com, +966 5X XXX XXXX, Authorised signatory, otp, bilingual',
        bulkHint: 'Paste CSV rows. Columns after name are optional; method and language fall back to the envelope defaults.',
        bulkImportAppend: 'Append rows',
        bulkImportReplace: 'Replace recipients',
        bulkImported: (count) => `${count} recipient${count === 1 ? '' : 's'} imported.`,
        saveGroup: 'Save group',
        groupNamePlaceholder: 'Counterparty signers',
        savedGroups: 'Saved signer groups',
        savedGroupCount: (count) => `${count} group${count === 1 ? '' : 's'} saved`,
        noSavedGroups: 'No signer groups saved in this dialog yet.',
        useGroup: 'Use group',
        removeGroup: 'Remove group',
        savedGroupBadge: (count) => `${count} signer${count === 1 ? '' : 's'}`,
      },
      preflight: {
        title: 'Ready to create?',
        description: 'Review the signature handoff before creating the draft envelope.',
        ready: 'Ready',
        needsReview: 'Needs review',
        targetSelected: 'Target selected',
        recipientsReachable: 'Recipients reachable',
        languageConsentReady: 'Language and consent ready',
        dueDateValid: 'Due date valid',
        targetPreviewKnown: 'Document preview or target known',
        custodyStrategySet: 'Custody strategy set',
      },
      cancel: 'Cancel',
      submit: 'Create envelope',
    },
    detail: {
      triggerAria: (title) => `Open signature envelope ${title}`,
      description: 'Recipient progress, chain-of-custody evidence, and provider event audit trail.',
      loading: 'Loading signature envelope...',
      error: 'Failed to load the signature envelope.',
      empty: 'Select a signature envelope to inspect its detail.',
      tabs: {
        recipients: 'Recipients',
        custody: 'Custody',
        events: 'Events',
      },
      journey: {
        heading: 'Signer journey',
        serial: 'Serial signing',
        parallel: 'Parallel signing',
        flowLabel: 'Flow',
        statuses: {
          draft: 'Pending',
          sent: 'Sent',
          viewed: 'Viewed',
          signed: 'Signed',
          declined: 'Declined',
          expired: 'Expired',
          cancelled: 'Cancelled',
        },
        nafathStatuses: {
          draft: 'Pending',
          sent: 'Nafath request sent',
          viewed: 'Opened in Nafath',
          signed: 'Verified via Nafath',
          declined: 'Declined in Nafath',
          expired: 'Nafath request expired',
          cancelled: 'Cancelled',
        },
      },
      auditTimeline: {
        heading: 'Audit timeline',
        empty: 'No provider events or custody evidence have been recorded yet.',
        custodySealed: (fileName) => `Custody evidence sealed — ${fileName}`,
        custodyDetail: 'Signed artefact sealed into the chain of custody.',
        providerVia: (provider) => `via ${provider}`,
      },
      preview: {
        action: 'Preview document',
        title: 'Document preview',
        loading: 'Loading document...',
        error: 'Failed to load the document for preview.',
        empty: 'No document content available',
        emptyDescription: 'There is no file or extracted text to preview for this envelope.',
        noTarget: 'This envelope is not linked to a previewable contract or document.',
      },
      overview: {
        provider: 'Provider',
        method: 'Method',
        language: 'Language',
        due: 'Due',
        expires: 'Expires',
        sent: 'Sent',
        completed: 'Completed',
        notSet: 'Not set',
      },
      recipients: {
        empty: 'No recipients are attached to this envelope.',
        order: (order) => `Order ${order}`,
        viewed: 'Viewed',
        signed: 'Signed',
        declined: 'Declined',
        recordAction: 'Record action',
        signAsMe: 'Sign as me',
        viewRendering: 'View rendering',
      },
      rendering: {
        title: (name) => `Signing view — ${name}`,
        description: 'The localized subject, message, and legal consent rendered for this recipient.',
        loading: 'Loading recipient rendering...',
        error: 'Failed to load the recipient rendering.',
        primary: 'Primary language',
        secondary: 'Secondary language',
        subject: 'Subject',
        message: 'Message',
        consent: 'Legal consent',
        close: 'Close',
      },
      action: {
        title: (name) => `Record action — ${name}`,
        selfTitle: (name) => `Sign as ${name}`,
        description: 'Capture a recipient view, signature, or decline with optional evidence.',
        selfDescription: 'Use your saved Watheeq signature profile to record your own recipient action.',
        action: 'Action',
        actorName: 'Actor name',
        actorEmail: 'Actor email',
        evidenceHash: 'Evidence hash',
        declineReason: 'Decline reason',
        actorNamePlaceholder: 'Defaults to recipient name when blank',
        evidenceHashPlaceholder: 'SHA-256 of the signing evidence (optional)',
        declineReasonPlaceholder: 'Reason provided by the recipient',
        savedSignature: 'Saved signature',
        loadingSignatureProfile: 'Loading signature profile...',
        noSavedSignature: 'No saved signature image. Your typed name will still be recorded.',
        manageSignature: 'Manage signature',
        signaturePreview: 'Signature preview',
        cancel: 'Cancel',
        submit: 'Record action',
        selfSubmit: 'Sign as me',
      },
      placements: {
        action: 'Signature fields',
        title: 'Signature fields',
        description: 'Place native signature, initials, name, and date fields by page percentage.',
        empty: 'No signature fields are configured for this envelope.',
        add: 'Add field',
        save: 'Save fields',
        saving: 'Saving...',
        remove: 'Remove',
        recipient: 'Recipient',
        allRecipients: 'Any recipient',
        kind: 'Field',
        kindOptions: {
          signature: 'Signature',
          initials: 'Initials',
          name: 'Name',
          date: 'Date',
        },
        page: 'Page',
        x: 'X %',
        y: 'Y %',
        width: 'Width %',
        height: 'Height %',
        required: 'Required',
        label: 'Label',
        fieldPreview: 'Document field preview',
        placementCount: (count) => `${count} field${count === 1 ? '' : 's'}`,
      },
      custody: {
        empty: 'No custody evidence has been sealed for this envelope yet.',
        record: 'Record custody',
        sealHash: 'Seal hash',
        contentHash: 'Content hash',
        signedAt: 'Signed',
        size: 'Size',
      },
      custodyForm: {
        title: 'Record custody evidence',
        description:
          'Seal the signed artefact into the chain of custody with its file reference and integrity hashes.',
        fileId: 'Stored signed artefact',
        fileName: 'File name',
        fileSize: 'File size (bytes)',
        contentHash: 'Content hash',
        sealHash: 'Seal hash',
        evidenceHash: 'Evidence hash',
        provider: 'Provider',
        signedAt: 'Signed at',
        fileIdPlaceholder: 'Select the stored signed artefact',
        fileNamePlaceholder: 'agreement-signed.pdf',
        contentHashPlaceholder: 'SHA-256 of the signed file content',
        sealHashPlaceholder: 'Provider seal hash (optional)',
        evidenceHashPlaceholder: 'Composite evidence hash (optional)',
        cancel: 'Cancel',
        submit: 'Record custody',
      },
      providerEvent: {
        title: 'Record provider event',
        description: 'Append an external provider lifecycle event to the envelope audit trail.',
        empty: 'No provider events have been recorded for this envelope yet.',
        record: 'Record provider event',
        provider: 'Provider',
        providerStatus: 'Provider status',
        providerEventId: 'Provider event ID',
        providerEnvelopeId: 'Provider envelope ID',
        occurredAt: 'Occurred at',
        reason: 'Reason',
        providerStatusPlaceholder: 'delivered, completed, declined, ...',
        providerEventIdPlaceholder: 'External event identifier (optional)',
        providerEnvelopeIdPlaceholder: 'External envelope identifier (optional)',
        reasonPlaceholder: 'Optional context for this event',
        statusHint: 'Accepted lifecycle statuses include viewed, signed/completed, declined, cancelled, and expired.',
        providerRecipientId: 'Provider recipient ID',
        providerRecipientIdPlaceholder: 'External recipient identifier (optional)',
        evidenceHash: 'Evidence hash',
        evidenceHashPlaceholder: 'Provider callback or evidence hash (optional)',
        webhookDiagnostics: 'Webhook diagnostics',
        webhookDiagnosticsHint: 'Optional callback details for signature validation and troubleshooting.',
        webhookSignature: 'Webhook signature',
        webhookSignaturePlaceholder: 'sha256=...',
        webhookTimestamp: 'Webhook timestamp',
        webhookTimestampPlaceholder: 'Provider timestamp header',
        webhookAlgorithm: 'Webhook algorithm',
        webhookAlgorithmPlaceholder: 'hmac-sha256',
        signatureBase: 'Signature base',
        signatureBasePlaceholder: 'auto, body, timestamp.body',
        webhookPayload: 'Webhook payload',
        webhookPayloadPlaceholder: 'Raw JSON payload used for provider signature verification',
        cancel: 'Cancel',
        submit: 'Record event',
      },
    },
    operations: {
      syncTab: 'Sync',
      recipient: {
        progress: 'Progress',
        lastActivity: (when) => `Last activity ${when}`,
        noActivity: 'No recipient activity yet',
        risk: 'Risk',
        provider: 'Provider',
        providerRecipientId: (method) => `${method}; provider recipient ID not set`,
        providerRecipientIdMissing: 'Provider recipient ID not set',
        evidenceHashCaptured: 'Evidence hash captured',
        noContact: 'No email or phone on recipient',
        copySigningLink: 'Copy signing link',
        resend: 'Resend',
        nudge: 'Nudge',
        replace: 'Replace',
        skip: 'Skip',
        notConnected: (action) => `${action} is not connected`,
        copyLinkAction: 'Copy signing link',
        copyLinkUnavailable:
          'This envelope detail does not include a provider signing URL. No signing-link endpoint is exposed here, so there is nothing safe to synthesize.',
        signingLinkCopiedTitle: 'Signing link copied.',
        signingLinkCopiedDetail: 'The recipient signing URL is now on your clipboard.',
        clipboardBlockedTitle: 'Clipboard blocked',
        clipboardBlockedDetail: 'Your browser blocked clipboard access. Open the provider console to copy the signing URL.',
        resendDetail: 'Resending requires a delivery endpoint for this recipient. This frontend only has audit/event recording APIs.',
        nudgeDetail: 'Recipient nudges require a notification dispatch endpoint. No nudge API is exposed in this surface.',
        replaceDetail: 'Replacing a signer would change the recipient list. This sheet has no safe update endpoint for recipient replacement.',
        skipDetail: 'Skipping a signer would alter the signing order and completion rules. No skip endpoint is available here.',
      },
      riskStates: {
        cleared: 'Cleared',
        clearedDetail: 'Recipient has signed.',
        blocked: 'Blocked',
        blockedDetail: 'Recipient can no longer complete this handoff.',
        expired: 'Expired',
        expiredDetail: 'The signing window has elapsed.',
        high: 'High',
        watch: 'Watch',
        normal: 'Normal',
        normalActive: 'Recipient can still complete this step.',
        normalInactive: 'No active recipient risk detected.',
      },
      riskFactors: {
        expired: 'Expired',
        noContact: 'No contact',
        envelopeExpired: 'Envelope expired',
        expiresSoon: 'Expires soon',
        pastDue: 'Past due',
        missingProviderId: 'Missing provider ID',
        staleDelivery: 'Stale delivery',
      },
      sync: {
        status: 'Sync status',
        provider: 'Provider',
        webhook: 'Webhook',
        envelopeIdPrefix: (id) => `Envelope ID ${id}`,
        providerEnvelopeIdMissing: 'Provider envelope ID not set',
        validated: 'Validated',
        notValidated: 'Not validated',
        noValidationFlag: 'No validation flag',
        latestEvent: (when) => `Latest event ${when}`,
        noProviderEvents: 'No provider events recorded',
        failureExplanationTitle: (provider) => `${provider} failure explanation`,
        identifiersTitle: 'Provider identifiers',
        identifiersHint: 'IDs shown here come from envelope metadata, recipient records, or provider event callbacks.',
        retryFailedSync: 'Retry failed sync',
        recordProviderEvent: 'Record provider event',
        envelopeProviderId: 'Envelope provider ID',
        latestProviderEventId: 'Latest provider event ID',
        latestProviderStatus: 'Latest provider status',
        webhookTimestamp: 'Webhook timestamp',
        webhookAlgorithm: 'Webhook algorithm',
        envelopeEvidenceHash: 'Envelope evidence hash',
        notSet: 'Not set',
        noProviderStatusRecorded: 'No provider status recorded',
        notPresent: 'Not present',
        notCaptured: 'Not captured',
        providerRecipientIds: 'Provider recipient IDs',
        noRecipients: 'No recipients are attached to this envelope.',
        providerRecipientIdNotSet: 'Provider recipient ID not set',
        diagnosticsTitle: 'Webhook diagnostics',
        signature: 'Signature',
        signatureValid: 'Valid',
        signatureInvalid: 'Invalid or unchecked',
        signatureNotChecked: 'Not checked',
        payload: 'Payload',
        payloadHashNotStored: 'Payload hash not stored',
        callbackAge: 'Callback age',
        noCallback: 'No callback',
        recentEventsTitle: 'Recent provider events',
        eventEnvelopePrefix: (id) => `Envelope ${id}`,
        eventRecipientPrefix: (id) => `Recipient ${id}`,
      },
      syncStates: {
        attention: 'Attention',
        attentionLatest: (status) => `Latest provider callback was ${status}.`,
        attentionStatus: (status) => `Envelope status is ${status}.`,
        complete: 'Complete',
        completeAt: (when) => `Provider completed at ${when}.`,
        completeSigned: 'Envelope is signed.',
        synced: 'Synced',
        syncedLatest: (status) => `Latest provider callback was ${status}.`,
        native: 'Native',
        nativeDetail: 'Native signatures do not require an external provider callback.',
        waiting: 'Waiting',
        waitingDetail: 'No provider callback has been recorded yet.',
      },
      noFailedSyncTitle: 'No failed sync selected',
      noFailedSyncDetail: 'Retry is only available as an operator affordance when the latest provider status looks failed.',
      retryUnavailableTitle: 'Retry dispatch endpoint unavailable',
      retryUnavailableDetail:
        'This frontend has no provider retry endpoint. Use the provider console to retry delivery, then record the accepted lifecycle result here as viewed, signed, declined, cancelled, or expired.',
      failureExplanations: {
        nafathTimeout:
          'Nafath requests expire when the signer does not approve within the authentication window. Start a fresh provider request before asking the signer to retry.',
        nafathDeclined:
          'The signer rejected or declined the Nafath authentication request. Confirm identity details before resending.',
        nafathGeneric:
          'The Nafath callback indicates an authentication or synchronization failure. Check the provider request ID, national identity binding, and webhook validation result.',
        externalVoided:
          'The external envelope was voided or cancelled by the provider. Reconcile the provider envelope ID before creating a replacement handoff.',
        externalGeneric:
          'The external provider reported a failed lifecycle state. Confirm provider envelope and recipient IDs before recording the next accepted callback.',
        nativeGeneric:
          'The native signature lifecycle is in an unsuccessful state. Confirm recipient status and custody evidence before closeout.',
      },
      custody: {
        evidencePackage: 'Evidence package',
        fileCount: (count) => `${count} file${count === 1 ? '' : 's'}`,
        latestSeal: (when) => `Latest seal ${when}`,
        noSignedDate: 'No signed date available',
        hashVerification: 'Hash verification',
        sealedOf: (sealed, total) => `${sealed}/${total} sealed`,
        hashesPresent: 'Content and seal/evidence hashes are present',
        hashesMissing: 'Some entries are missing seal or evidence hashes',
        retention: 'Retention',
        missingPackageTitle: 'Missing custody evidence package',
        missingPackageDetail: 'A completed signature should be sealed with content and evidence hashes before closeout.',
        pickupArtifact: 'Pickup signed artifact',
        downloadJson: 'Download evidence JSON',
        hashIncompleteTitle: 'Hash verification incomplete',
        hashIncompleteDetail:
          'At least one custody record has a content hash but no seal or evidence hash. Verify the artifact against the provider seal before relying on this package.',
        evidenceHash: 'Evidence hash',
        fileId: 'File ID',
        retentionInline: (label, detail) => `${label} · ${detail}`,
        downloadedTitle: 'Evidence package downloaded.',
        downloadedDetail: 'The sealed custody summary was exported as JSON.',
        pickupTitle: 'Automatic pickup needs a file source',
        pickupDetail:
          'This sheet cannot upload or fetch the signed artifact. Use Record custody once the signed file, size, and hashes are available from storage or the provider.',
      },
      retentionStates: {
        legalHold: 'Legal hold',
        legalHoldDetail: 'Deletion should remain blocked while the hold is active.',
        reviewDue: 'Review due',
        reviewDueDetail: (when) => `Retention date passed ${when}.`,
        retained: 'Retained',
        retainedDetail: (when) => `Retain until ${when}.`,
        policySet: 'Policy set',
        notSpecified: 'Not specified',
        notSpecifiedDetail: 'No retention schedule is stored on the custody evidence.',
      },
    },
  },
  ar: {
    page: {
      title: 'مظاريف التوقيع',
      description:
        'تسليم التوقيع الإلكتروني وتتبّع سلسلة العهدة للعقود والوثائق المنتقلة عبر حالات المسودة والإرسال والتوقيع والاكتمال.',
      reports: 'التقارير',
      newEnvelope: 'مظروف جديد',
      searchPlaceholder: 'ابحث في مظاريف التوقيع...',
    },
    views: {
      portfolio: {
        label: 'المحفظة',
        description: 'كل مظاريف التوقيع',
      },
      myEnvelopes: {
        label: 'مظاريفي',
        description: 'المظاريف المحمّلة التي أرسلتها أو أنشأتها',
      },
      expiringSoon: {
        label: 'تنتهي قريبًا',
        description: 'المظاريف المفتوحة المحمّلة والمستحقة خلال 14 يومًا',
      },
      awaitingSigner: {
        label: 'بانتظار الموقّع',
        description: 'مظاريف مرسلة أو تمت مشاهدتها وتنتظر المستلمين',
      },
      declined: {
        label: 'مرفوضة',
        description: 'المظاريف المرفوضة',
      },
      nafathIssues: {
        label: 'مشكلات نفاذ',
        description: 'مظاريف نفاذ التي تتضمن إخفاقات مزوّد محمّلة',
      },
      missingCustody: {
        label: 'العهدة مفقودة',
        description: 'مظاريف موقّعة محمّلة بلا دليل عهدة',
      },
      contractSignatures: {
        label: 'توقيعات العقود',
        description: 'مظاريف مرتبطة بالعقود',
      },
    },
    bulkActions: {
      send: 'إرسال',
      cancel: 'إلغاء',
      export: 'تصدير',
      remind: 'تذكير',
      extend: 'تمديد',
      archive: 'أرشفة',
    },
    savedViews: {
      save: 'حفظ عرض التوقيعات الحالي',
      saved: 'عروض التوقيعات المحفوظة',
      empty: 'لا توجد عروض توقيعات محفوظة بعد',
    },
    filters: {
      status: 'الحالة',
      provider: 'المزوّد',
      statusOptions: {
        draft: 'مسودة',
        sent: 'مُرسل',
        viewed: 'مُطّلع عليه',
        signed: 'موقّع',
        declined: 'مرفوض',
        expired: 'منتهٍ',
        cancelled: 'ملغى',
      },
      providerOptions: {
        native: 'محلي',
        nafath: 'نفاذ',
        external: 'خارجي',
      },
    },
    enums: {
      targetType: {
        contract: 'عقد',
        document: 'وثيقة',
      },
      provider: {
        native: 'محلي',
        nafath: 'نفاذ',
        external: 'خارجي',
      },
      method: {
        otp: 'رمز لمرة واحدة',
        nafath: 'نفاذ',
        certificate: 'شهادة',
        wet_signature: 'توقيع يدوي',
      },
      recipientAction: {
        view: 'اطّلاع',
        sign: 'توقيع',
        decline: 'رفض',
      },
      eventType: {
        created: 'أُنشئ',
        sent: 'أُرسل',
        viewed: 'اطُّلع عليه',
        signed: 'وُقّع',
        declined: 'رُفض',
        expired: 'انتهت الصلاحية',
        cancelled: 'أُلغي',
        custody_recorded: 'سُجِّلت العهدة',
      },
      language: {
        en: 'الإنجليزية',
        ar: 'العربية',
        bilingual: 'ثنائي اللغة',
      },
    },
    validation: {
      recipientNameRequired: 'اسم المستلِم مطلوب.',
      emailInvalid: 'أدخل بريدًا إلكترونيًا صالحًا.',
      titleRequired: 'العنوان مطلوب.',
      recipientsMin: 'أضف مستلِمًا واحدًا على الأقل.',
      contractIdRequired: 'اختر عقدًا لمظروف العقد.',
      documentIdRequired: 'اختر وثيقة لمظروف الوثيقة.',
    },
    upcoming: {
      noDeadline: 'بلا موعد نهائي',
    },
    table: {
      envelope: 'المظروف',
      contract: 'العقد',
      target: 'الهدف',
      status: 'الحالة',
      recipients: 'المستلِمون',
      deadline: 'الموعد النهائي',
      updated: 'آخر تحديث',
      actions: 'إجراءات',
      providerNotSet: 'لم يُحدَّد المزوّد',
      notLinked: 'غير مرتبط',
      linkedContract: 'عقد مرتبط',
      standaloneDocument: 'وثيقة مستقلة',
      signedOf: (signed, total) => `${signed}/${total} موقّع`,
      open: 'فتح',
      send: 'إرسال',
      cancel: 'إلغاء',
    },
    emptyState: {
      title: 'لا توجد مظاريف توقيع',
      description: 'لا توجد عمليات تسليم توقيع لعقود أو وثائق تطابق عوامل التصفية الحالية.',
      cta: 'أنشئ أول مظروف',
    },
    kpi: {
      total: 'المظاريف',
      pending: 'بانتظار التوقيع',
      signed: 'موقّعة',
      declined: 'مرفوضة / منتهية',
      overdue: 'متجاوزة المهلة',
      dueSoon: 'تستحق خلال 7 أيام',
      providerIssues: 'مشكلات المزوّد',
      custodyGaps: 'فجوات العهدة',
    },
    kpiDetails: {
      total: 'مظاريف التوقيع المطابقة لعرض المحفظة الحالي.',
      pending: 'مظاريف مرسلة أو تمت مشاهدتها وتنتظر إجراء المستلِم.',
      signed: 'مظاريف مكتملة مع دليل توقيع.',
      declined: 'رفضها المستلمون أو انتهت صلاحيتها.',
      overdue: 'مظاريف محمّلة تجاوزت تاريخ الانتهاء أو الاستحقاق.',
      providerIssues: 'مظاريف محمّلة بها إشارات إخفاق من المزوّد.',
      envelopeShare: 'حصة المظاريف',
      loadedRows: 'الصفوف المحمّلة',
      providerHealth: 'صحة المزوّد',
    },
    risk: {
      heading: 'مركز مخاطر المواعيد',
      summary: (overdue, dueSoon, providerFailures, missingCustody) =>
        `${overdue} متجاوزة · ${dueSoon} تستحق خلال 7 أيام · ${providerFailures} مشكلة مزوّد · ${missingCustody} فجوة عهدة`,
      listMode: 'قائمة',
      calendarMode: 'تقويم',
      emptyList: 'لا توجد مظاريف محمّلة لها مواعيد استحقاق أو انتهاء نشطة.',
      emptyCalendar: 'لا توجد مواعيد محمّلة لوضعها على التقويم.',
      loading: 'جارٍ تحميل مخاطر المواعيد...',
      error: 'تعذّر تحميل مركز مخاطر المواعيد.',
      retry: 'إعادة المحاولة',
      countdownLabel: 'الوقت حتى الانتهاء',
      custodyMissing: 'العهدة مفقودة',
      providerIssue: 'مشكلة مزوّد',
      diagnosticsNote:
        'تستخدم إجماليات الحالة استعلامات العدّ من الخادم. أما إخفاقات المزوّد وفجوات العهدة وتشخيصات الانتهاء فتعتمد على صفوف المظاريف المحمّلة حاليًا.',
    },
    toast: {
      sent: {
        title: 'تم إرسال مظروف التوقيع.',
        detail: 'يمكن للمستلِمين الآن إتمام تسليم التوقيع.',
      },
      cancelled: {
        title: 'تم إلغاء مظروف التوقيع.',
        detail: 'لم يعد تسليم التوقيع نشطًا.',
      },
      created: {
        title: 'تم إنشاء مظروف التوقيع.',
        detail: 'المظروف في حالة المسودة وجاهز للإرسال إلى المستلِمين.',
      },
      recipientAction: {
        title: 'تم تسجيل إجراء المستلِم.',
        detail: 'تم تحديث المخطط الزمني للمستلِم وحالة المظروف.',
      },
      custody: {
        title: 'تم تسجيل دليل العهدة.',
        detail: 'تم ختم النسخة الموقّعة ضمن سلسلة العهدة.',
      },
      providerEvent: {
        title: 'تم تسجيل حدث المزوّد.',
        detail: 'تمت إضافة حدث المزوّد الخارجي إلى سجل التدقيق.',
      },
      placements: {
        title: 'تم حفظ حقول التوقيع.',
        detail: 'تم تحديث مواضع حقول التوقيع والأحرف الأولى المحلية.',
      },
      bulkSent: {
        title: 'تم إرسال المظاريف المحددة.',
        detail: (count) => `تم تقديم ${count} مظروف.`,
      },
      bulkCancelled: {
        title: 'تم إلغاء المظاريف المحددة.',
        detail: (count) => `تم إلغاء ${count} مظروف.`,
      },
      bulkReminder: {
        title: 'تم تجهيز قائمة التذكير.',
        detail: (count) => `تم تحديد ${count} مظروف مفتوح لمتابعة التذكير.`,
      },
      bulkExtend: {
        title: 'تم تجهيز مراجعة تمديد الموعد النهائي.',
        detail: (count) =>
          `تم تحديد ${count} مظروف. لا تتوفّر حاليًا نقطة نهاية مباشرة للتمديد.`,
      },
      bulkArchive: {
        title: 'تم تجهيز مجموعة الأرشفة.',
        detail: (count) => `تم تحديد ${count} مظروف مكتمل لمراجعة سياسة الأرشفة.`,
      },
    },
    cancelReason: 'أُلغي من وحدة توقيع وثيق',
    create: {
      title: 'مظروف توقيع جديد',
      description:
        'حدّد هدف التوقيع ونص التسليم والمزوّد والقائمة المرتّبة للمستلِمين لهذا التسليم.',
      sections: {
        target: 'هدف التوقيع',
        delivery: 'التسليم والمزوّد',
        recipients: 'المستلِمون',
        preflight: 'التحقق قبل الإرسال',
      },
      fields: {
        targetType: 'نوع الهدف',
        contractId: 'العقد',
        documentId: 'الوثيقة',
        title: 'عنوان المظروف',
        subject: 'الموضوع',
        message: 'الرسالة',
        language: 'اللغة',
        provider: 'المزوّد',
        method: 'طريقة التوقيع',
        dueAt: 'تاريخ الاستحقاق',
        expiresAt: 'تاريخ الانتهاء',
      },
      placeholders: {
        contractId: 'اختر عقدًا',
        documentId: 'اختر وثيقة',
        title: 'اتفاقية الخدمات الرئيسية — توقيع',
        subject: 'يرجى التوقيع: اتفاقية الخدمات الرئيسية',
        message: 'يرجى مراجعة الاتفاقية المرفقة وتطبيق توقيعك عليها.',
      },
      targetHint: {
        contract: 'اختر العقد المرتبط بهذا المظروف.',
        document: 'اختر الوثيقة المرتبطة بهذا المظروف.',
      },
      targetPicker: {
        label: 'اختيار هدف التوقيع',
        contractPlaceholder: 'ابحث في العقود الحديثة',
        documentPlaceholder: 'ابحث في الوثائق الحديثة',
        searchPlaceholder: 'ابحث بالعنوان أو الطرف أو الرقم المرجعي...',
        loading: 'جارٍ تحميل الأهداف...',
        noResults: 'لا توجد أهداف مطابقة.',
        error: 'تعذّر تحميل أهداف التوقيع.',
        retry: 'إعادة المحاولة',
        clear: 'مسح الاختيار',
        createContract: 'إنشاء عقد',
        selected: 'الهدف المحدّد',
        manualEntry: 'استخدم مرجع سجل آخر',
        manualDescription: 'استخدم هذا الخيار فقط إذا لم يظهر الهدف في البحث.',
        previewHeading: 'معاينة الهدف',
        previewMissing: 'اختر صفًا من القائمة لتحديد الوثيقة المطلوب توقيعها.',
        recentHint: 'تظهر النتائج الحديثة أدناه وتتحدّث أثناء البحث.',
        updated: (value) => `آخر تحديث ${value}`,
      },
      recipientsHint:
        'يوقّع كل مستلِم بالترتيب المُدرج. يُشترط وجود مستلِم واحد على الأقل باسم.',
      recipient: {
        heading: (index) => `المستلِم ${index + 1}`,
        internalUser: 'مستخدم داخلي في المنصة',
        internalUserDescription:
          'اختر أحد مستخدمي المستأجر لربط التوقيع بحسابه، أو اتركه فارغًا لموقّع خارجي.',
        name: 'الاسم الكامل',
        email: 'البريد الإلكتروني',
        phone: 'الهاتف',
        role: 'الدور',
        method: 'الطريقة',
        language: 'اللغة',
        namePlaceholder: 'ليلى الحربي',
        emailPlaceholder: 'layla@counterparty.com',
        phonePlaceholder: '+966 5X XXX XXXX',
        rolePlaceholder: 'مفوّض بالتوقيع',
        remove: 'إزالة المستلِم',
        add: 'إضافة مستلِم',
        moveUp: 'تقديم المستلِم',
        moveDown: 'تأخير المستلِم',
        orderBadge: (order) => `الترتيب ${order}`,
      },
      rolePresets: {
        authorisedSignatory: 'مفوّض بالتوقيع',
        counterpartyReviewer: 'مراجع لدى الطرف المقابل',
        financeApprover: 'معتمد مالي',
        legalCounsel: 'مستشار قانوني',
        witness: 'شاهد',
      },
      recipientTools: {
        presets: 'قوالب أدوار الموقّعين',
        presetsHint: 'طبّق أدوارًا شائعة على المستلِم النشط أو استخدم قالبًا لإعادة بناء القائمة.',
        useTemplate: 'استخدام القالب',
        replaceWithTemplate: 'استبدال المستلِمين',
        primarySignerTemplate: 'موقّع مفوّض واحد',
        counterpartyTemplate: 'داخلي + طرف مقابل',
        boardTemplate: 'اعتماد مجلس الإدارة',
        bulkTitle: 'استيراد جماعي',
        bulkPlaceholder:
          'Name, email, phone, role, method, language\nليلى الحربي, layla@counterparty.com, +966 5X XXX XXXX, مفوّض بالتوقيع, otp, bilingual',
        bulkHint: 'الصق صفوف CSV. الأعمدة بعد الاسم اختيارية؛ تُستخدم الطريقة واللغة الافتراضيتان عند تركهما فارغتين.',
        bulkImportAppend: 'إلحاق الصفوف',
        bulkImportReplace: 'استبدال المستلِمين',
        bulkImported: (count) => `تم استيراد ${count} مستلِم.`,
        saveGroup: 'حفظ المجموعة',
        groupNamePlaceholder: 'موقّعو الطرف المقابل',
        savedGroups: 'مجموعات الموقّعين المحفوظة',
        savedGroupCount: (count) => `تم حفظ ${count} مجموعة`,
        noSavedGroups: 'لا توجد مجموعات موقّعين محفوظة في هذا الحوار بعد.',
        useGroup: 'استخدام المجموعة',
        removeGroup: 'إزالة المجموعة',
        savedGroupBadge: (count) => `${count} موقّع`,
      },
      preflight: {
        title: 'هل هو جاهز للإنشاء؟',
        description: 'راجع تسليم التوقيع قبل إنشاء مظروف المسودة.',
        ready: 'جاهز',
        needsReview: 'بحاجة إلى مراجعة',
        targetSelected: 'تم تحديد الهدف',
        recipientsReachable: 'يمكن الوصول إلى المستلِمين',
        languageConsentReady: 'اللغة والموافقة جاهزتان',
        dueDateValid: 'تاريخ الاستحقاق صالح',
        targetPreviewKnown: 'المعاينة أو الهدف معروفان',
        custodyStrategySet: 'تم تحديد استراتيجية العهدة',
      },
      cancel: 'إلغاء',
      submit: 'إنشاء المظروف',
    },
    detail: {
      triggerAria: (title) => `فتح مظروف التوقيع ${title}`,
      description: 'تقدّم المستلِمين وأدلة سلسلة العهدة وسجل تدقيق أحداث المزوّد.',
      loading: 'جارٍ تحميل مظروف التوقيع...',
      error: 'تعذّر تحميل مظروف التوقيع.',
      empty: 'اختر مظروف توقيع لفحص تفاصيله.',
      tabs: {
        recipients: 'المستلِمون',
        custody: 'العهدة',
        events: 'الأحداث',
      },
      journey: {
        heading: 'مسار التوقيع',
        serial: 'توقيع متسلسل',
        parallel: 'توقيع متوازٍ',
        flowLabel: 'التدفّق',
        statuses: {
          draft: 'قيد الانتظار',
          sent: 'مُرسل',
          viewed: 'مُطّلع عليه',
          signed: 'موقّع',
          declined: 'مرفوض',
          expired: 'منتهٍ',
          cancelled: 'ملغى',
        },
        nafathStatuses: {
          draft: 'قيد الانتظار',
          sent: 'أُرسل طلب نفاذ',
          viewed: 'فُتح في نفاذ',
          signed: 'تم التحقّق عبر نفاذ',
          declined: 'رُفض في نفاذ',
          expired: 'انتهى طلب نفاذ',
          cancelled: 'ملغى',
        },
      },
      auditTimeline: {
        heading: 'المخطط الزمني للتدقيق',
        empty: 'لم تُسجَّل أحداث مزوّد أو أدلة عهدة بعد.',
        custodySealed: (fileName) => `خُتم دليل العهدة — ${fileName}`,
        custodyDetail: 'خُتمت النسخة الموقّعة ضمن سلسلة العهدة.',
        providerVia: (provider) => `عبر ${provider}`,
      },
      preview: {
        action: 'معاينة الوثيقة',
        title: 'معاينة الوثيقة',
        loading: 'جارٍ تحميل الوثيقة...',
        error: 'تعذّر تحميل الوثيقة للمعاينة.',
        empty: 'لا يوجد محتوى وثيقة متاح',
        emptyDescription: 'لا يوجد ملف أو نص مستخرج لمعاينته لهذا المظروف.',
        noTarget: 'هذا المظروف غير مرتبط بعقد أو وثيقة قابلة للمعاينة.',
      },
      overview: {
        provider: 'المزوّد',
        method: 'الطريقة',
        language: 'اللغة',
        due: 'الاستحقاق',
        expires: 'الانتهاء',
        sent: 'الإرسال',
        completed: 'الاكتمال',
        notSet: 'غير محدد',
      },
      recipients: {
        empty: 'لا يوجد مستلِمون مرتبطون بهذا المظروف.',
        order: (order) => `الترتيب ${order}`,
        viewed: 'اطّلع في',
        signed: 'وقّع في',
        declined: 'رفض في',
        recordAction: 'تسجيل إجراء',
        signAsMe: 'التوقيع بنفسي',
        viewRendering: 'عرض المعاينة',
      },
      rendering: {
        title: (name) => `معاينة التوقيع — ${name}`,
        description: 'الموضوع والرسالة والموافقة القانونية المعروضة لهذا المستلِم باللغة المحددة.',
        loading: 'جارٍ تحميل معاينة المستلِم...',
        error: 'تعذّر تحميل معاينة المستلِم.',
        primary: 'اللغة الأساسية',
        secondary: 'اللغة الثانوية',
        subject: 'الموضوع',
        message: 'الرسالة',
        consent: 'الموافقة القانونية',
        close: 'إغلاق',
      },
      action: {
        title: (name) => `تسجيل إجراء — ${name}`,
        selfTitle: (name) => `التوقيع باسم ${name}`,
        description: 'سجّل اطّلاع المستلِم أو توقيعه أو رفضه مع دليل اختياري.',
        selfDescription: 'استخدم ملف توقيعك المحفوظ في وثيقتك لتسجيل إجراء المستلِم الخاص بك.',
        action: 'الإجراء',
        actorName: 'اسم المنفّذ',
        actorEmail: 'بريد المنفّذ الإلكتروني',
        evidenceHash: 'بصمة الدليل',
        declineReason: 'سبب الرفض',
        actorNamePlaceholder: 'يُستخدم اسم المستلِم افتراضيًا عند الترك فارغًا',
        evidenceHashPlaceholder: 'بصمة SHA-256 لدليل التوقيع (اختياري)',
        declineReasonPlaceholder: 'السبب المقدّم من المستلِم',
        savedSignature: 'التوقيع المحفوظ',
        loadingSignatureProfile: 'جارٍ تحميل ملف التوقيع...',
        noSavedSignature: 'لا توجد صورة توقيع محفوظة. سيظل اسمك المكتوب مسجّلًا.',
        manageSignature: 'إدارة التوقيع',
        signaturePreview: 'معاينة التوقيع',
        cancel: 'إلغاء',
        submit: 'تسجيل الإجراء',
        selfSubmit: 'التوقيع بنفسي',
      },
      placements: {
        action: 'حقول التوقيع',
        title: 'حقول التوقيع',
        description: 'ضع حقول التوقيع والأحرف الأولى والاسم والتاريخ كنسب مئوية من الصفحة.',
        empty: 'لا توجد حقول توقيع مهيأة لهذا المظروف.',
        add: 'إضافة حقل',
        save: 'حفظ الحقول',
        saving: 'جارٍ الحفظ...',
        remove: 'إزالة',
        recipient: 'المستلِم',
        allRecipients: 'أي مستلِم',
        kind: 'الحقل',
        kindOptions: {
          signature: 'التوقيع',
          initials: 'الأحرف الأولى',
          name: 'الاسم',
          date: 'التاريخ',
        },
        page: 'الصفحة',
        x: 'X %',
        y: 'Y %',
        width: 'العرض %',
        height: 'الارتفاع %',
        required: 'مطلوب',
        label: 'التسمية',
        fieldPreview: 'معاينة الحقول على الوثيقة',
        placementCount: (count) => `${count} حقل`,
      },
      custody: {
        empty: 'لم يُختم أي دليل عهدة لهذا المظروف بعد.',
        record: 'تسجيل العهدة',
        sealHash: 'بصمة الختم',
        contentHash: 'بصمة المحتوى',
        signedAt: 'وُقّع في',
        size: 'الحجم',
      },
      custodyForm: {
        title: 'تسجيل دليل العهدة',
        description:
          'اختم النسخة الموقّعة ضمن سلسلة العهدة مع مرجع ملفها وبصمات سلامتها.',
        fileId: 'النسخة الموقّعة المخزّنة',
        fileName: 'اسم الملف',
        fileSize: 'حجم الملف (بايت)',
        contentHash: 'بصمة المحتوى',
        sealHash: 'بصمة الختم',
        evidenceHash: 'بصمة الدليل',
        provider: 'المزوّد',
        signedAt: 'وُقّع في',
        fileIdPlaceholder: 'اختر النسخة الموقّعة المخزّنة',
        fileNamePlaceholder: 'agreement-signed.pdf',
        contentHashPlaceholder: 'بصمة SHA-256 لمحتوى الملف الموقّع',
        sealHashPlaceholder: 'بصمة ختم المزوّد (اختياري)',
        evidenceHashPlaceholder: 'بصمة الدليل المركّبة (اختياري)',
        cancel: 'إلغاء',
        submit: 'تسجيل العهدة',
      },
      providerEvent: {
        title: 'تسجيل حدث المزوّد',
        description: 'أضف حدث دورة حياة من مزوّد خارجي إلى سجل تدقيق المظروف.',
        empty: 'لم تُسجَّل أي أحداث مزوّد لهذا المظروف بعد.',
        record: 'تسجيل حدث المزوّد',
        provider: 'المزوّد',
        providerStatus: 'حالة المزوّد',
        providerEventId: 'معرّف حدث المزوّد',
        providerEnvelopeId: 'معرّف مظروف المزوّد',
        occurredAt: 'وقع في',
        reason: 'السبب',
        providerStatusPlaceholder: 'تم التسليم، اكتمل، رُفض، ...',
        providerEventIdPlaceholder: 'معرّف الحدث الخارجي (اختياري)',
        providerEnvelopeIdPlaceholder: 'معرّف المظروف الخارجي (اختياري)',
        reasonPlaceholder: 'سياق اختياري لهذا الحدث',
        statusHint: 'تشمل حالات دورة الحياة المقبولة: مُطّلع عليه، وموقّع/مكتمل، ومرفوض، وملغى، ومنتهٍ.',
        providerRecipientId: 'معرّف مستلِم المزوّد',
        providerRecipientIdPlaceholder: 'معرّف المستلِم الخارجي (اختياري)',
        evidenceHash: 'بصمة الدليل',
        evidenceHashPlaceholder: 'بصمة استدعاء المزوّد أو بصمة الدليل (اختياري)',
        webhookDiagnostics: 'تشخيصات الـ Webhook',
        webhookDiagnosticsHint: 'تفاصيل استدعاء اختيارية للتحقّق من التوقيع واستكشاف الأعطال.',
        webhookSignature: 'توقيع الـ Webhook',
        webhookSignaturePlaceholder: 'sha256=...',
        webhookTimestamp: 'الطابع الزمني للـ Webhook',
        webhookTimestampPlaceholder: 'ترويسة الطابع الزمني للمزوّد',
        webhookAlgorithm: 'خوارزمية الـ Webhook',
        webhookAlgorithmPlaceholder: 'hmac-sha256',
        signatureBase: 'أساس التوقيع',
        signatureBasePlaceholder: 'auto، body، timestamp.body',
        webhookPayload: 'حمولة الـ Webhook',
        webhookPayloadPlaceholder: 'حمولة JSON الخام المُستخدمة للتحقّق من توقيع المزوّد',
        cancel: 'إلغاء',
        submit: 'تسجيل الحدث',
      },
    },
    operations: {
      syncTab: 'المزامنة',
      recipient: {
        progress: 'التقدّم',
        lastActivity: (when) => `آخر نشاط ${when}`,
        noActivity: 'لا يوجد نشاط للمستلِم بعد',
        risk: 'المخاطر',
        provider: 'المزوّد',
        providerRecipientId: (method) => `${method}؛ لم يُحدَّد معرّف مستلِم المزوّد`,
        providerRecipientIdMissing: 'لم يُحدَّد معرّف مستلِم المزوّد',
        evidenceHashCaptured: 'تم التقاط بصمة الدليل',
        noContact: 'لا يوجد بريد إلكتروني أو هاتف للمستلِم',
        copySigningLink: 'نسخ رابط التوقيع',
        resend: 'إعادة الإرسال',
        nudge: 'تذكير',
        replace: 'استبدال',
        skip: 'تخطّي',
        notConnected: (action) => `${action} غير متصل`,
        copyLinkAction: 'نسخ رابط التوقيع',
        copyLinkUnavailable:
          'لا يتضمّن تفصيل هذا المظروف رابط توقيع من المزوّد. لا توجد واجهة لرابط التوقيع هنا، لذا لا يوجد ما يمكن توليده بأمان.',
        signingLinkCopiedTitle: 'تم نسخ رابط التوقيع.',
        signingLinkCopiedDetail: 'أصبح رابط توقيع المستلِم الآن في الحافظة.',
        clipboardBlockedTitle: 'الحافظة محظورة',
        clipboardBlockedDetail: 'حظر متصفّحك الوصول إلى الحافظة. افتح وحدة المزوّد لنسخ رابط التوقيع.',
        resendDetail: 'تتطلّب إعادة الإرسال واجهة تسليم لهذا المستلِم. لا تتوفّر في هذه الواجهة سوى واجهات تسجيل التدقيق والأحداث.',
        nudgeDetail: 'تتطلّب تذكيرات المستلِم واجهة إرسال إشعارات. لا توجد واجهة تذكير في هذا السطح.',
        replaceDetail: 'سيؤدّي استبدال موقّع إلى تغيير قائمة المستلِمين. لا توجد واجهة تحديث آمنة لاستبدال المستلِم في هذه اللوحة.',
        skipDetail: 'سيؤدّي تخطّي موقّع إلى تغيير ترتيب التوقيع وقواعد الاكتمال. لا تتوفّر واجهة تخطّي هنا.',
      },
      riskStates: {
        cleared: 'مُخلَص',
        clearedDetail: 'وقّع المستلِم.',
        blocked: 'محظور',
        blockedDetail: 'لم يعد بإمكان المستلِم إتمام هذا التسليم.',
        expired: 'منتهٍ',
        expiredDetail: 'انقضت نافذة التوقيع.',
        high: 'مرتفع',
        watch: 'مراقبة',
        normal: 'عادي',
        normalActive: 'لا يزال بإمكان المستلِم إتمام هذه الخطوة.',
        normalInactive: 'لم تُكتشف أي مخاطر نشطة للمستلِم.',
      },
      riskFactors: {
        expired: 'منتهٍ',
        noContact: 'لا توجد وسيلة تواصل',
        envelopeExpired: 'المظروف منتهٍ',
        expiresSoon: 'ينتهي قريبًا',
        pastDue: 'متجاوز الاستحقاق',
        missingProviderId: 'معرّف المزوّد مفقود',
        staleDelivery: 'تسليم متقادم',
      },
      sync: {
        status: 'حالة المزامنة',
        provider: 'المزوّد',
        webhook: 'Webhook',
        envelopeIdPrefix: (id) => `معرّف المظروف ${id}`,
        providerEnvelopeIdMissing: 'لم يُحدَّد معرّف مظروف المزوّد',
        validated: 'مُتحقَّق منه',
        notValidated: 'غير مُتحقَّق منه',
        noValidationFlag: 'لا توجد علامة تحقّق',
        latestEvent: (when) => `آخر حدث ${when}`,
        noProviderEvents: 'لم تُسجَّل أحداث مزوّد',
        failureExplanationTitle: (provider) => `تفسير إخفاق ${provider}`,
        identifiersTitle: 'معرّفات المزوّد',
        identifiersHint: 'المعرّفات المعروضة هنا مأخوذة من بيانات المظروف أو سجلات المستلِمين أو استدعاءات أحداث المزوّد.',
        retryFailedSync: 'إعادة محاولة المزامنة الفاشلة',
        recordProviderEvent: 'تسجيل حدث المزوّد',
        envelopeProviderId: 'معرّف مزوّد المظروف',
        latestProviderEventId: 'معرّف آخر حدث للمزوّد',
        latestProviderStatus: 'آخر حالة للمزوّد',
        webhookTimestamp: 'الطابع الزمني للـ Webhook',
        webhookAlgorithm: 'خوارزمية الـ Webhook',
        envelopeEvidenceHash: 'بصمة دليل المظروف',
        notSet: 'غير محدد',
        noProviderStatusRecorded: 'لم تُسجَّل حالة مزوّد',
        notPresent: 'غير موجود',
        notCaptured: 'لم يُلتقط',
        providerRecipientIds: 'معرّفات مستلِمي المزوّد',
        noRecipients: 'لا يوجد مستلِمون مرتبطون بهذا المظروف.',
        providerRecipientIdNotSet: 'لم يُحدَّد معرّف مستلِم المزوّد',
        diagnosticsTitle: 'تشخيصات الـ Webhook',
        signature: 'التوقيع',
        signatureValid: 'صالح',
        signatureInvalid: 'غير صالح أو غير مفحوص',
        signatureNotChecked: 'لم يُفحص',
        payload: 'الحمولة',
        payloadHashNotStored: 'لم تُخزَّن بصمة الحمولة',
        callbackAge: 'عمر الاستدعاء',
        noCallback: 'لا يوجد استدعاء',
        recentEventsTitle: 'أحدث أحداث المزوّد',
        eventEnvelopePrefix: (id) => `المظروف ${id}`,
        eventRecipientPrefix: (id) => `المستلِم ${id}`,
      },
      syncStates: {
        attention: 'انتباه',
        attentionLatest: (status) => `كان آخر استدعاء من المزوّد ${status}.`,
        attentionStatus: (status) => `حالة المظروف ${status}.`,
        complete: 'مكتمل',
        completeAt: (when) => `أكمل المزوّد في ${when}.`,
        completeSigned: 'المظروف موقّع.',
        synced: 'مُزامَن',
        syncedLatest: (status) => `كان آخر استدعاء من المزوّد ${status}.`,
        native: 'محلي',
        nativeDetail: 'التوقيعات المحلية لا تتطلّب استدعاءً من مزوّد خارجي.',
        waiting: 'بانتظار',
        waitingDetail: 'لم يُسجَّل أي استدعاء من المزوّد بعد.',
      },
      noFailedSyncTitle: 'لم يُحدَّد فشل مزامنة',
      noFailedSyncDetail: 'تتوفّر إعادة المحاولة كأداة للمشغّل فقط عندما تبدو آخر حالة للمزوّد فاشلة.',
      retryUnavailableTitle: 'واجهة إرسال إعادة المحاولة غير متاحة',
      retryUnavailableDetail:
        'لا توجد في هذه الواجهة نقطة لإعادة محاولة المزوّد. استخدم وحدة المزوّد لإعادة محاولة التسليم، ثم سجّل النتيجة المقبولة لدورة الحياة هنا بوصفها: مُطّلع عليه أو موقّع أو مرفوض أو ملغى أو منتهٍ.',
      failureExplanations: {
        nafathTimeout:
          'تنتهي طلبات نفاذ عندما لا يوافق الموقّع ضمن نافذة المصادقة. ابدأ طلب مزوّد جديدًا قبل أن تطلب من الموقّع إعادة المحاولة.',
        nafathDeclined:
          'رفض الموقّع طلب مصادقة نفاذ أو لم يوافق عليه. تأكّد من بيانات الهوية قبل إعادة الإرسال.',
        nafathGeneric:
          'يشير استدعاء نفاذ إلى إخفاق في المصادقة أو المزامنة. تحقّق من معرّف طلب المزوّد وربط الهوية الوطنية ونتيجة التحقّق من الـ Webhook.',
        externalVoided:
          'أُبطل المظروف الخارجي أو أُلغي من قِبل المزوّد. وفّق معرّف مظروف المزوّد قبل إنشاء تسليم بديل.',
        externalGeneric:
          'أبلغ المزوّد الخارجي عن حالة فاشلة في دورة الحياة. تأكّد من معرّفات مظروف المزوّد والمستلِمين قبل تسجيل الاستدعاء المقبول التالي.',
        nativeGeneric:
          'دورة حياة التوقيع المحلي في حالة غير ناجحة. تأكّد من حالة المستلِم وأدلة العهدة قبل الإغلاق.',
      },
      custody: {
        evidencePackage: 'حزمة الأدلة',
        fileCount: (count) => `${count} ملف`,
        latestSeal: (when) => `آخر ختم ${when}`,
        noSignedDate: 'لا يتوفّر تاريخ توقيع',
        hashVerification: 'التحقّق من البصمات',
        sealedOf: (sealed, total) => `${sealed}/${total} مختوم`,
        hashesPresent: 'بصمات المحتوى والختم/الدليل موجودة',
        hashesMissing: 'بعض السجلات تفتقر إلى بصمة الختم أو الدليل',
        retention: 'الاحتفاظ',
        missingPackageTitle: 'حزمة أدلة العهدة مفقودة',
        missingPackageDetail: 'ينبغي ختم التوقيع المكتمل ببصمات المحتوى والدليل قبل الإغلاق.',
        pickupArtifact: 'التقاط النسخة الموقّعة',
        downloadJson: 'تنزيل الأدلة بصيغة JSON',
        hashIncompleteTitle: 'التحقّق من البصمات غير مكتمل',
        hashIncompleteDetail:
          'يحتوي سجل عهدة واحد على الأقل على بصمة محتوى لكن دون بصمة ختم أو دليل. تحقّق من النسخة مقابل ختم المزوّد قبل الاعتماد على هذه الحزمة.',
        evidenceHash: 'بصمة الدليل',
        fileId: 'معرّف الملف',
        retentionInline: (label, detail) => `${label} · ${detail}`,
        downloadedTitle: 'تم تنزيل حزمة الأدلة.',
        downloadedDetail: 'صُدِّر ملخّص العهدة المختوم بصيغة JSON.',
        pickupTitle: 'يتطلّب الالتقاط التلقائي مصدر ملف',
        pickupDetail:
          'لا يمكن لهذه اللوحة رفع النسخة الموقّعة أو جلبها. استخدم «تسجيل العهدة» بمجرّد توفّر الملف الموقّع وحجمه وبصماته من التخزين أو المزوّد.',
      },
      retentionStates: {
        legalHold: 'حجز قانوني',
        legalHoldDetail: 'ينبغي أن يبقى الحذف محظورًا طوال سريان الحجز.',
        reviewDue: 'مراجعة مستحقّة',
        reviewDueDetail: (when) => `انقضى تاريخ الاحتفاظ في ${when}.`,
        retained: 'محتفظ به',
        retainedDetail: (when) => `يُحتفظ به حتى ${when}.`,
        policySet: 'سياسة مُحدَّدة',
        notSpecified: 'غير محدد',
        notSpecifiedDetail: 'لا يوجد جدول احتفاظ مخزّن على دليل العهدة.',
      },
    },
  },
};

export function resolveSignatureLabels(locale: AppLocale = 'en'): SignatureLabels {
  return resolveLexBilingual(signatureLabels, locale);
}

export function useSignatureLabels(): SignatureLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSignatureLabels(locale), [locale]);
}
