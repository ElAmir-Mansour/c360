/**
 * Local bilingual label bundle for the Lex document editor workspace (H22).
 *
 * Follows the canonical lex `LexBilingual<T>` idiom: two full copies of the same
 * label object, one per locale, resolved through the shared
 * `resolveLexBilingual` helper. This bundle is OWNED by the document-editor
 * feature — it is never folded into the shared `_lib/lex-i18n.ts`. The
 * `useEditorLabels()` hook reads the active locale from the provider and
 * memoizes the resolved copy.
 *
 * Scope: the HIGH-VISIBILITY chrome a reviewer actually SEES — SectionCard /
 * Panel titles + descriptions, the page eyebrow, Tabs labels, panel
 * empty-states, primary buttons and visible fallback strings. Deep
 * `aria-label`s and tooltips are intentionally out of scope.
 */

'use client';

import { useMemo } from 'react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  type LexBilingual,
  resolveLexBilingual,
} from '../../_lib/lex-i18n';
import type { LexEditorMode } from '../_lib/editor-session';

export interface EditorLabels {
  /** Page eyebrow + generic fallbacks. */
  eyebrow: string;
  documentEditor: string;
  documentEditorDesc: string;
  workspaceFallbackDesc: string;
  notRecorded: string;
  notSet: string;
  na: string;

  /** Editor mode chips. */
  modes: Record<LexEditorMode, string>;

  /** PageHeader stats + actions. */
  stats: { version: string; comments: string; changes: string };
  refresh: string;
  documents: string;
  modeSuffix: string;
  versionLabel: (version: string) => string;

  /** Session-unavailable alert. */
  sessionUnavailableTitle: string;
  sessionUnavailableDesc: string;

  /** Command bar actions. */
  commandBar: {
    save: string;
    snapshot: string;
    compare: string;
    export: string;
    preflight: string;
  };

  /** Autosave / recovery strip. */
  strip: {
    autosave: string;
    recovery: string;
    snapshot: string;
    lastSaved: (when: string) => string;
    conflictMarkers: (n: string) => string;
    recoveryClear: string;
    noSnapshot: string;
    pendingChanges: (n: string) => string;
  };

  /** Maturity summary tiles. */
  maturity: {
    health: string;
    playbook: string;
    negotiation: string;
    signature: string;
    privilege: string;
    documentReadiness: string;
    attached: string;
    noPlaybook: string;
    deviations: (n: string, score: string) => string;
    openPoints: (n: string) => string;
    signed: (done: string, total: string) => string;
    next: (name: string) => string;
    blockers: (n: string) => string;
    notClassified: string;
    controlsEnabled: (active: string, total: string) => string;
  };

  /** Lock + autosave status text. */
  lock: {
    available: string;
    checkedOutByYou: string;
    lockedByOther: string;
    checkedOut: string;
    readOnly: string;
  };
  autosave: {
    saved: string;
    saving: string;
    pending: string;
    unavailable: string;
    error: string;
  };

  /** Provider embed host. */
  embed: {
    canvas: string;
    hostDesc: string;
    open: string;
    scriptReady: string;
    scriptReadyDesc: string;
    scriptUrl: string;
    config: string;
    configKeys: (n: string) => string;
    configMissing: string;
    fallbackTitle: string;
    fallbackDesc: string;
    document: string;
    mode: string;
    provider: string;
    version: string;
  };

  /** Operational status section. */
  operational: {
    title: string;
    description: string;
    provider: string;
    providerHasConfig: string;
    providerNoConfig: string;
    checkOut: string;
    noLock: string;
    until: (when: string) => string;
    release: string;
    checkOutAction: string;
    autosave: string;
  };

  /** Legal workspace section + its tabs. */
  legalWorkspace: {
    title: string;
    description: string;
    healthSuffix: (score: string) => string;
    tabs: {
      room: string;
      book: string;
      terms: string;
      assign: string;
      guests: string;
      issues: string;
      sign: string;
      ai: string;
      health: string;
      priv: string;
    };
  };

  /** Negotiation room panel. */
  room: {
    title: string;
    openRoom: string;
    summary: (open: string, agreed: string) => string;
    lastOffer: string;
    nextSession: string;
    emptyTitle: string;
    emptyDesc: string;
    participant: string;
  };

  /** Playbook enforcement panel. */
  playbook: {
    title: string;
    runCheck: string;
    requiredClauses: (met: string, total: string) => string;
    compliant: (score: string) => string;
    noScore: string;
    fallbackScore: string;
    coverage: (pct: string) => string;
    emptyTitle: string;
    emptyDesc: string;
    waive: string;
    unassigned: string;
  };

  /** Terms & cross-reference panel. */
  terms: {
    title: string;
    scan: string;
    summary: (terms: string, refs: string) => string;
    emptyTitle: string;
    emptyDesc: string;
    definedTerms: string;
    crossReferences: string;
    definitionMissing: string;
    noSection: string;
    refs: (n: string) => string;
    target: (value: string) => string;
    unresolved: string;
  };

  /** Section assignments panel. */
  assignments: {
    title: (n: string) => string;
    detail: string;
    assign: string;
    emptyTitle: string;
    emptyDesc: string;
    due: (when: string) => string;
    review: string;
  };

  /** Guest reviewers panel. */
  guests: {
    title: (n: string) => string;
    detail: string;
    invite: string;
    emptyTitle: string;
    emptyDesc: string;
    externalReviewer: string;
    access: string;
    expires: string;
  };

  /** Legal issue tracker panel. */
  issues: {
    title: (open: string) => string;
    total: (n: string) => string;
    newIssue: string;
    emptyTitle: string;
    emptyDesc: string;
    unassigned: string;
    due: (when: string) => string;
    escalate: string;
  };

  /** Signature readiness panel. */
  signature: {
    ready: string;
    title: string;
    signersComplete: (done: string, total: string) => string;
    prepare: string;
    envelopePending: string;
    nextSigner: (name: string) => string;
    noNextSigner: string;
    noBlockers: string;
  };

  /** Clause AI actions panel. */
  clauseAi: {
    title: (n: string) => string;
    detail: string;
    analyze: string;
    emptyTitle: string;
    emptyDesc: string;
    confidence: (pct: string) => string;
    stage: string;
    draftAlternative: string;
  };

  /** Document health panel. */
  health: {
    title: (score: string) => string;
    readinessScore: string;
    refresh: string;
    healthScore: string;
    signalsDesc: string;
    signals: string;
  };

  /** Privileged controls panel. */
  privilege: {
    title: string;
    review: string;
    accessReview: (when: string) => string;
    emptyTitle: string;
    emptyDesc: string;
    notice: string;
  };

  /** Advanced operations section + its tabs. */
  advanced: {
    title: string;
    description: string;
    active: (n: string) => string;
    tabs: { ops: string; work: string; structure: string; governance: string };
  };

  /** Provider-events operations panel. */
  ops: {
    providerEvents: (n: string) => string;
    providerEventsDesc: string;
    syncEvents: string;
    providerEventsEmptyTitle: string;
    providerEventsEmptyDesc: string;
    guestLinks: (n: string) => string;
    guestLinksDetail: (expired: string, revoked: string) => string;
    reviewPortal: string;
    externalPortal: string;
    lastActivity: (when: string) => string;
    watermarked: string;
    noWatermark: string;
    offlineRecovery: string;
    offlineDetail: (edits: string, comments: string) => string;
    restore: string;
    lastBuffer: (when: string, conflicts: string) => string;
  };

  /** Workflow operations panel. */
  work: {
    automationTasks: (n: string) => string;
    automationTasksDesc: string;
    createTask: string;
    tasksEmptyTitle: string;
    tasksEmptyDesc: string;
    approvalMatrix: string;
    gates: (n: string, status: string) => string;
    request: string;
    gatesEmptyTitle: string;
    gatesEmptyDesc: string;
    inbox: (n: string) => string;
    inboxDesc: string;
    openInbox: string;
    inboxEmptyTitle: string;
    inboxEmptyDesc: string;
    unassigned: string;
    due: (when: string) => string;
    noApprover: string;
    required: string;
  };

  /** Structure operations panel. */
  structure: {
    clauseAnchors: (n: string) => string;
    clauseAnchorsDesc: string;
    extract: string;
    anchorsEmptyTitle: string;
    anchorsEmptyDesc: string;
    redlinePackages: (n: string) => string;
    redlinePackagesDesc: string;
    generate: string;
    packagesEmptyTitle: string;
    packagesEmptyDesc: string;
    compareWorkspaces: (n: string) => string;
    compareWorkspacesDesc: string;
    compare: string;
    compareEmptyTitle: string;
    compareEmptyDesc: string;
    termRepairs: (n: string) => string;
    termRepairsDesc: string;
    repair: string;
    repairsEmptyTitle: string;
    repairsEmptyDesc: string;
    evidenceBindings: (n: string) => string;
    evidenceBindingsDesc: string;
    bind: string;
    evidenceEmptyTitle: string;
    evidenceEmptyDesc: string;
    redlinePackage: string;
    noFormats: string;
    changes: (changes: string, material: string) => string;
    base: string;
    target: string;
  };

  /** Governance operations panel. */
  governance: {
    ruleBuilders: (n: string) => string;
    ruleBuildersDesc: string;
    openRules: string;
    rulesEmptyTitle: string;
    rulesEmptyDesc: string;
    aiSafety: string;
    aiSafetyDetail: (pending: string, approvals: string) => string;
    configure: string;
    disabled: string;
    aiSafetyFallback: string;
    analytics: string;
    analyticsDetail: (revisions: string, issues: string) => string;
    refresh: string;
    cycleTime: string;
    approvalDelay: string;
    externalReview: string;
    deviationRate: string;
    signatureTrend: string;
    noTrend: string;
    rules: (n: string) => string;
    updated: (when: string) => string;
  };

  /** Review panels section + its tabs. */
  review: {
    title: string;
    description: string;
    tabs: { comments: string; changes: string; clauses: string; audit: string };
  };

  /** Comments panel. */
  comments: {
    unresolved: (n: string) => string;
    total: (n: string) => string;
    newThread: string;
    emptyTitle: string;
    emptyDesc: string;
  };

  /** Track-changes panel. */
  trackChanges: {
    on: string;
    off: string;
    total: (n: string) => string;
    reviewAll: string;
    emptyTitle: string;
    emptyDesc: string;
    accept: string;
    reject: string;
  };

  /** Clause library panel. */
  clauseLibrary: {
    title: string;
    detail: string;
    browse: string;
    emptyTitle: string;
    emptyDesc: string;
    insert: string;
    clause: string;
    notice: string;
    stagedTitle: string;
    stagedBody: string;
  };

  /** Audit panel. */
  audit: {
    title: string;
    detail: string;
    export: string;
    emptyTitle: string;
    emptyDesc: string;
  };

  /** Empty / no-document state. */
  emptyState: {
    title: string;
    description: string;
    chooseTitle: string;
    chooseDesc: string;
    selectDocument: string;
    searchDocuments: string;
    openDocument: string;
  };

  /** No-session error state. */
  noSession: {
    description: string;
    message: string;
  };

  /** Action-toast strings (visible to users). */
  toastReady: (action: string) => string;
  toastReadyBody: string;

  /** User-perceived accessibility labels + embedded-frame title. */
  aria: {
    editorMode: string;
    playbookScore: string;
    editorFrameTitle: (provider: string) => string;
  };

  /** Route-level error boundary copy. */
  routeError: string;
}

const labels: LexBilingual<EditorLabels> = {
  en: {
    eyebrow: 'Lex Document Editor',
    documentEditor: 'Document editor',
    documentEditorDesc: 'The editor workspace could not load the requested document.',
    workspaceFallbackDesc:
      'Provider-agnostic editor workspace for document review, comments, track changes, and legal drafting assistance.',
    notRecorded: 'Not recorded',
    notSet: 'Not set',
    na: 'n/a',

    modes: { view: 'View', comment: 'Comment', edit: 'Edit' },

    stats: { version: 'Version', comments: 'Comments', changes: 'Changes' },
    refresh: 'Refresh',
    documents: 'Documents',
    modeSuffix: 'mode',
    versionLabel: (version) => `version ${version}`,

    sessionUnavailableTitle: 'Editor provider config unavailable',
    sessionUnavailableDesc:
      'The document metadata loaded, but the Lex editor-session API did not return a usable provider configuration. The workspace remains available in fallback mode.',

    commandBar: {
      save: 'Save',
      snapshot: 'Snapshot',
      compare: 'Compare',
      export: 'Export',
      preflight: 'Preflight',
    },

    strip: {
      autosave: 'Autosave',
      recovery: 'Recovery',
      snapshot: 'Snapshot',
      lastSaved: (when) => `Last saved: ${when}`,
      conflictMarkers: (n) => `${n} conflict markers`,
      recoveryClear: 'Recovery point tracking is clear',
      noSnapshot: 'No snapshot yet',
      pendingChanges: (n) => `${n} pending changes`,
    },

    maturity: {
      health: 'Health',
      playbook: 'Playbook',
      negotiation: 'Negotiation',
      signature: 'Signature',
      privilege: 'Privilege',
      documentReadiness: 'Document readiness',
      attached: 'Attached',
      noPlaybook: 'No playbook',
      deviations: (n, score) => `${n} deviations · ${score}`,
      openPoints: (n) => `${n} open points`,
      signed: (done, total) => `${done}/${total} signed`,
      next: (name) => `Next: ${name}`,
      blockers: (n) => `${n} blockers`,
      notClassified: 'Not classified',
      controlsEnabled: (active, total) => `${active}/${total} controls enabled`,
    },

    lock: {
      available: 'Available',
      checkedOutByYou: 'Checked out by you',
      lockedByOther: 'Locked by another reviewer',
      checkedOut: 'Checked out',
      readOnly: 'Read only',
    },
    autosave: {
      saved: 'Saved',
      saving: 'Saving',
      pending: 'Pending',
      unavailable: 'Unavailable',
      error: 'Error',
    },

    embed: {
      canvas: 'Editor canvas',
      hostDesc: 'Provider-neutral host for iframe, launch URL, or script-based editor bootstraps.',
      open: 'Open',
      scriptReady: 'Script container ready',
      scriptReadyDesc:
        'Lex returned provider bootstrap data. The container is prepared for the OnlyOffice-style script mount without binding this workspace to a specific editor implementation.',
      scriptUrl: 'Script URL:',
      config: 'Config:',
      configKeys: (n) => `${n} top-level key(s)`,
      configMissing: 'not supplied',
      fallbackTitle: 'Provider configuration required',
      fallbackDesc:
        'This document workspace is ready, but Lex has not supplied an iframe URL, launch URL, script URL, or editor config for OnlyOffice, Collabora, or Microsoft Graph.',
      document: 'Document',
      mode: 'Mode',
      provider: 'Provider',
      version: 'Version',
    },

    operational: {
      title: 'Operational status',
      description: 'Provider, check-out, autosave, and recovery signals.',
      provider: 'Provider',
      providerHasConfig: 'Embed configuration is present.',
      providerNoConfig: 'No embed configuration returned.',
      checkOut: 'Check-out',
      noLock: 'No exclusive editor lock is active.',
      until: (when) => ` until ${when}`,
      release: 'Release',
      checkOutAction: 'Check out',
      autosave: 'Autosave',
    },

    legalWorkspace: {
      title: 'Legal workspace',
      description: 'Negotiation, playbook, signature, privilege, and clause-level controls.',
      healthSuffix: (score) => `${score}% health`,
      tabs: {
        room: 'Room',
        book: 'Book',
        terms: 'Terms',
        assign: 'Assign',
        guests: 'Guests',
        issues: 'Issues',
        sign: 'Sign',
        ai: 'AI',
        health: 'Health',
        priv: 'Priv',
      },
    },

    room: {
      title: 'Negotiation room',
      openRoom: 'Open room',
      summary: (open, agreed) => `${open} open · ${agreed} agreed`,
      lastOffer: 'Last offer',
      nextSession: 'Next session',
      emptyTitle: 'No negotiation participants',
      emptyDesc: 'Counterparty, counsel, and internal negotiator presence will appear here.',
      participant: 'Participant',
    },

    playbook: {
      title: 'Playbook enforcement',
      runCheck: 'Run check',
      requiredClauses: (met, total) => `${met}/${total} required clauses`,
      compliant: (score) => `${score}% compliant`,
      noScore: 'No compliance score',
      fallbackScore: 'Fallback score from session or metadata',
      coverage: (pct) => `Required clause coverage: ${pct}`,
      emptyTitle: 'No playbook deviations',
      emptyDesc: 'Policy gaps, missing mandatory clauses, and approved waivers will be grouped here.',
      waive: 'Waive',
      unassigned: 'Unassigned',
    },

    terms: {
      title: 'Defined terms and cross-refs',
      scan: 'Scan',
      summary: (terms, refs) => `${terms} terms · ${refs} references`,
      emptyTitle: 'No terms or references indexed',
      emptyDesc:
        'Defined term extraction and section cross-reference checks will populate this navigator.',
      definedTerms: 'Defined terms',
      crossReferences: 'Cross-references',
      definitionMissing: 'Definition not captured',
      noSection: 'No section',
      refs: (n) => `${n} refs`,
      target: (value) => `Target: ${value}`,
      unresolved: 'Unresolved',
    },

    assignments: {
      title: (n) => `${n} section assignments`,
      detail: 'Owner, deadline, and review state',
      assign: 'Assign',
      emptyTitle: 'No section assignments',
      emptyDesc: 'Assign sections to reviewers and track section-level approvals here.',
      due: (when) => `Due ${when}`,
      review: 'Review',
    },

    guests: {
      title: (n) => `${n} guest reviewers`,
      detail: 'External review access',
      invite: 'Invite',
      emptyTitle: 'No external guests',
      emptyDesc: 'Outside counsel and counterparty reviewer invitations will be managed here.',
      externalReviewer: 'External reviewer',
      access: 'Access',
      expires: 'Expires',
    },

    issues: {
      title: (open) => `${open} open legal issues`,
      total: (n) => `${n} total issues`,
      newIssue: 'New issue',
      emptyTitle: 'No legal issues',
      emptyDesc: 'Risk calls, drafting blockers, and preflight findings will be tracked here.',
      unassigned: 'Unassigned',
      due: (when) => `Due ${when}`,
      escalate: 'Escalate',
    },

    signature: {
      ready: 'Ready for signature',
      title: 'Signature readiness',
      signersComplete: (done, total) => `${done}/${total} signers complete`,
      prepare: 'Prepare',
      envelopePending: 'Envelope provider pending',
      nextSigner: (name) => `Next signer: ${name}`,
      noNextSigner: 'No next signer queued.',
      noBlockers: 'No signature blockers are currently reported.',
    },

    clauseAi: {
      title: (n) => `${n} clause AI actions`,
      detail: 'Clause-level drafting, review, and redline support',
      analyze: 'Analyze',
      emptyTitle: 'No clause AI actions',
      emptyDesc:
        'Select a clause or sync recommendations to stage rewrite, explain, compare, and risk-check actions.',
      confidence: (pct) => `Confidence ${pct}`,
      stage: 'Stage',
      draftAlternative: 'Draft alternative',
    },

    health: {
      title: (score) => `${score}% document health`,
      readinessScore: 'Readiness score',
      refresh: 'Refresh',
      healthScore: 'Health score',
      signalsDesc: 'Provider, review, issue, playbook, and signature signals',
      signals: 'Health signals',
    },

    privilege: {
      title: 'Privilege controls',
      review: 'Review',
      accessReview: (when) => `Access review: ${when}`,
      emptyTitle: 'No privilege controls',
      emptyDesc: 'Legal hold, watermark, download, and external AI restrictions will appear here.',
      notice:
        'Controls are shown from session or metadata fallbacks until policy endpoints are connected.',
    },

    advanced: {
      title: 'Advanced operations',
      description:
        'Provider events, task automation, packages, approvals, evidence, safety, and analytics.',
      active: (n) => `${n} active`,
      tabs: { ops: 'Ops', work: 'Work', structure: 'Struct', governance: 'Gov' },
    },

    ops: {
      providerEvents: (n) => `${n} provider events`,
      providerEventsDesc: 'Saves, joins, comments, redlines, exports, and provider failures.',
      syncEvents: 'Sync events',
      providerEventsEmptyTitle: 'No provider events',
      providerEventsEmptyDesc:
        'OnlyOffice, Collabora, or Microsoft Graph webhook activity will appear here.',
      guestLinks: (n) => `${n} active guest links`,
      guestLinksDetail: (expired, revoked) => `${expired} expired · ${revoked} revoked`,
      reviewPortal: 'Review portal',
      externalPortal: 'External review portal',
      lastActivity: (when) => `Last activity: ${when}`,
      watermarked: 'watermarked',
      noWatermark: 'no watermark',
      offlineRecovery: 'Offline recovery',
      offlineDetail: (edits, comments) => `${edits} edits · ${comments} comments queued`,
      restore: 'Restore',
      lastBuffer: (when, conflicts) => `Last buffer: ${when} · ${conflicts} conflicts`,
    },

    work: {
      automationTasks: (n) => `${n} automation tasks`,
      automationTasksDesc:
        'Tasks created from issues, comments, playbook deviations, and signature blockers.',
      createTask: 'Create task',
      tasksEmptyTitle: 'No document tasks',
      tasksEmptyDesc:
        'Legal issues, comments, deviations, and blockers can be converted into owned tasks.',
      approvalMatrix: 'Approval matrix',
      gates: (n, status) => `${n} gates · ${status}`,
      request: 'Request',
      gatesEmptyTitle: 'No approval gates',
      gatesEmptyDesc:
        'Sensitive edits, AI insertions, external sharing, and signature readiness gates will be shown here.',
      inbox: (n) => `${n} unread inbox items`,
      inboxDesc: 'Mentions, review requests, guest activity, approvals, and blockers.',
      openInbox: 'Open inbox',
      inboxEmptyTitle: 'Inbox clear',
      inboxEmptyDesc: 'Unread collaboration activity and review requests will be grouped here.',
      unassigned: 'Unassigned',
      due: (when) => `Due ${when}`,
      noApprover: 'No approver',
      required: 'required',
    },

    structure: {
      clauseAnchors: (n) => `${n} clause anchors`,
      clauseAnchorsDesc:
        'Persisted clause and section anchors for comments, issues, approvals, and AI actions.',
      extract: 'Extract',
      anchorsEmptyTitle: 'No clause anchors',
      anchorsEmptyDesc: 'DOCX section anchors will appear here after extraction.',
      redlinePackages: (n) => `${n} redline packages`,
      redlinePackagesDesc:
        'Clean copy, redline, issue list, deviation report, approval evidence, and audit bundle.',
      generate: 'Generate',
      packagesEmptyTitle: 'No redline packages',
      packagesEmptyDesc: 'Negotiation, approval, and signature package exports will be listed here.',
      compareWorkspaces: (n) => `${n} compare workspaces`,
      compareWorkspacesDesc: 'Version, counterparty draft, and uploaded DOCX comparisons.',
      compare: 'Compare',
      compareEmptyTitle: 'No comparisons',
      compareEmptyDesc: 'Version and counterparty draft comparisons will appear here.',
      termRepairs: (n) => `${n} term repairs`,
      termRepairsDesc: 'One-click fixes for undefined, duplicate, or inconsistent defined terms.',
      repair: 'Repair',
      repairsEmptyTitle: 'No term repairs',
      repairsEmptyDesc: 'Suggested repairs for defined terms will appear here.',
      evidenceBindings: (n) => `${n} evidence bindings`,
      evidenceBindingsDesc: 'Source links to documents, policies, regulation clauses, cases, and matters.',
      bind: 'Bind',
      evidenceEmptyTitle: 'No evidence bindings',
      evidenceEmptyDesc: 'Source citations and evidence links will be shown here.',
      redlinePackage: 'Redline package',
      noFormats: 'No formats',
      changes: (changes, material) => `${changes} changes · ${material} material`,
      base: 'Base',
      target: 'Target',
    },

    governance: {
      ruleBuilders: (n) => `${n} rule builders`,
      ruleBuildersDesc: 'Admin links for required clauses, fallbacks, risky language, and approvals.',
      openRules: 'Open rules',
      rulesEmptyTitle: 'No rule builder links',
      rulesEmptyDesc: 'Configured playbook rule builders will link from this document context.',
      aiSafety: 'AI change safety',
      aiSafetyDetail: (pending, approvals) => `${pending} pending proposals · ${approvals} approvals`,
      configure: 'Configure',
      disabled: 'disabled',
      aiSafetyFallback: 'AI insertions stay in preview, redline, or approval-required mode.',
      analytics: 'Editor analytics',
      analyticsDetail: (revisions, issues) => `${revisions} revisions · ${issues} unresolved issues`,
      refresh: 'Refresh',
      cycleTime: 'Cycle time',
      approvalDelay: 'Approval delay',
      externalReview: 'External review',
      deviationRate: 'Deviation rate',
      signatureTrend: 'Signature trend',
      noTrend: 'No trend yet',
      rules: (n) => `${n} rules`,
      updated: (when) => `Updated ${when}`,
    },

    review: {
      title: 'Review panels',
      description: 'Comments, changes, clause support, and audit activity.',
      tabs: { comments: 'Comments', changes: 'Changes', clauses: 'Clauses', audit: 'Audit' },
    },

    comments: {
      unresolved: (n) => `${n} unresolved`,
      total: (n) => `${n} total comment threads`,
      newThread: 'New thread',
      emptyTitle: 'No comment threads',
      emptyDesc:
        'Provider comments will appear here with author, selection, and resolution state.',
    },

    trackChanges: {
      on: 'Track changes on',
      off: 'Track changes off',
      total: (n) => `${n} tracked changes`,
      reviewAll: 'Review all',
      emptyTitle: 'No tracked changes',
      emptyDesc: 'Insertions, deletions, and reviewer decisions will be grouped here.',
      accept: 'Accept',
      reject: 'Reject',
    },

    clauseLibrary: {
      title: 'Clause assistant',
      detail: 'Insertion and recommendation staging',
      browse: 'Browse library',
      emptyTitle: 'No recommendations yet',
      emptyDesc:
        'Clause suggestions can be populated from playbooks, document context, or selected text.',
      insert: 'Insert',
      clause: 'Clause',
      notice:
        'Placeholder hooks are ready for insert-at-cursor, replace-selection, and playbook-based recommendations once provider cursor APIs are connected.',
      stagedTitle: 'Clause staged',
      stagedBody: 'The recommendation is ready for provider insert-at-cursor wiring.',
    },

    audit: {
      title: 'Audit activity',
      detail: 'Editor and collaboration events',
      export: 'Export audit',
      emptyTitle: 'No editor audit events',
      emptyDesc:
        'Session starts, saves, lock changes, comments, and exports will be listed here.',
    },

    emptyState: {
      title: 'Document editor',
      description:
        'Open a Lex document in the in-app editor workspace with provider status, lock handling, autosave, comments, changes, clauses, and audit panels.',
      chooseTitle: 'Choose a document',
      chooseDesc: 'Search the document repository and choose a document to open an editor session.',
      selectDocument: 'Select a document',
      searchDocuments: 'Search by document title…',
      openDocument: 'Open document',
    },

    noSession: {
      description: 'The editor workspace could not load the requested document.',
      message: 'Unable to load the document metadata needed to open the editor.',
    },

    toastReady: (action) => `${action} ready`,
    toastReadyBody: 'The workspace control is wired for the editor provider integration.',

    aria: {
      editorMode: 'Editor mode',
      playbookScore: 'Playbook score',
      editorFrameTitle: (provider) => `${provider} document editor`,
    },

    routeError: 'The document editor route failed to render.',
  },

  ar: {
    eyebrow: 'محرّر مستندات Lex',
    documentEditor: 'محرّر المستندات',
    documentEditorDesc: 'تعذّر على مساحة عمل المحرّر تحميل المستند المطلوب.',
    workspaceFallbackDesc:
      'مساحة عمل محرّر مستقلة عن المزوّد لمراجعة المستندات والتعليقات وتتبّع التغييرات والمساعدة في الصياغة القانونية.',
    notRecorded: 'غير مُسجّل',
    notSet: 'غير محدّد',
    na: 'غير متاح',

    modes: { view: 'عرض', comment: 'تعليق', edit: 'تحرير' },

    stats: { version: 'الإصدار', comments: 'التعليقات', changes: 'التغييرات' },
    refresh: 'تحديث',
    documents: 'المستندات',
    modeSuffix: 'الوضع',
    versionLabel: (version) => `الإصدار ${version}`,

    sessionUnavailableTitle: 'إعدادات مزوّد المحرّر غير متاحة',
    sessionUnavailableDesc:
      'تم تحميل بيانات المستند، لكن واجهة جلسة محرّر Lex لم تُرجِع إعدادات مزوّد قابلة للاستخدام. تبقى مساحة العمل متاحة في الوضع الاحتياطي.',

    commandBar: {
      save: 'حفظ',
      snapshot: 'لقطة',
      compare: 'مقارنة',
      export: 'تصدير',
      preflight: 'فحص مسبق',
    },

    strip: {
      autosave: 'الحفظ التلقائي',
      recovery: 'الاسترجاع',
      snapshot: 'اللقطة',
      lastSaved: (when) => `آخر حفظ: ${when}`,
      conflictMarkers: (n) => `${n} علامات تعارض`,
      recoveryClear: 'تتبّع نقطة الاسترجاع خالٍ',
      noSnapshot: 'لا توجد لقطة بعد',
      pendingChanges: (n) => `${n} تغييرات معلّقة`,
    },

    maturity: {
      health: 'الجاهزية',
      playbook: 'دليل العمل',
      negotiation: 'التفاوض',
      signature: 'التوقيع',
      privilege: 'الامتياز',
      documentReadiness: 'جاهزية المستند',
      attached: 'مُرفق',
      noPlaybook: 'لا يوجد دليل عمل',
      deviations: (n, score) => `${n} انحرافات · ${score}`,
      openPoints: (n) => `${n} نقاط مفتوحة`,
      signed: (done, total) => `${done}/${total} موقّعون`,
      next: (name) => `التالي: ${name}`,
      blockers: (n) => `${n} عوائق`,
      notClassified: 'غير مُصنّف',
      controlsEnabled: (active, total) => `${active}/${total} ضوابط مُفعّلة`,
    },

    lock: {
      available: 'متاح',
      checkedOutByYou: 'محجوز بواسطتك',
      lockedByOther: 'مقفل بواسطة مراجع آخر',
      checkedOut: 'محجوز',
      readOnly: 'للقراءة فقط',
    },
    autosave: {
      saved: 'تم الحفظ',
      saving: 'جارٍ الحفظ',
      pending: 'معلّق',
      unavailable: 'غير متاح',
      error: 'خطأ',
    },

    embed: {
      canvas: 'لوحة المحرّر',
      hostDesc: 'مضيف محايد للمزوّد عبر iframe أو رابط التشغيل أو تهيئة المحرّر القائمة على النصوص البرمجية.',
      open: 'فتح',
      scriptReady: 'حاوية النص البرمجي جاهزة',
      scriptReadyDesc:
        'أرجع Lex بيانات تهيئة المزوّد. الحاوية مهيّأة لتركيب النص البرمجي على نمط OnlyOffice دون ربط مساحة العمل بمحرّر بعينه.',
      scriptUrl: 'رابط النص البرمجي:',
      config: 'التهيئة:',
      configKeys: (n) => `${n} مفتاح/مفاتيح رئيسية`,
      configMissing: 'غير مُتوفّرة',
      fallbackTitle: 'مطلوب تهيئة المزوّد',
      fallbackDesc:
        'مساحة عمل هذا المستند جاهزة، لكن Lex لم يوفّر رابط iframe أو رابط تشغيل أو رابط نص برمجي أو تهيئة محرّر لـ OnlyOffice أو Collabora أو Microsoft Graph.',
      document: 'المستند',
      mode: 'الوضع',
      provider: 'المزوّد',
      version: 'الإصدار',
    },

    operational: {
      title: 'الحالة التشغيلية',
      description: 'إشارات المزوّد والحجز والحفظ التلقائي والاسترجاع.',
      provider: 'المزوّد',
      providerHasConfig: 'إعدادات التضمين متوفّرة.',
      providerNoConfig: 'لم تُرجَع إعدادات تضمين.',
      checkOut: 'الحجز',
      noLock: 'لا يوجد قفل تحرير حصري نشط.',
      until: (when) => ` حتى ${when}`,
      release: 'إطلاق',
      checkOutAction: 'حجز',
      autosave: 'الحفظ التلقائي',
    },

    legalWorkspace: {
      title: 'مساحة العمل القانونية',
      description: 'التفاوض ودليل العمل والتوقيع والامتياز والضوابط على مستوى البنود.',
      healthSuffix: (score) => `${score}% جاهزية`,
      tabs: {
        room: 'الغرفة',
        book: 'الدليل',
        terms: 'المصطلحات',
        assign: 'الإسناد',
        guests: 'الضيوف',
        issues: 'المسائل',
        sign: 'التوقيع',
        ai: 'الذكاء',
        health: 'الجاهزية',
        priv: 'الامتياز',
      },
    },

    room: {
      title: 'غرفة التفاوض',
      openRoom: 'فتح الغرفة',
      summary: (open, agreed) => `${open} مفتوحة · ${agreed} متّفق عليها`,
      lastOffer: 'آخر عرض',
      nextSession: 'الجلسة القادمة',
      emptyTitle: 'لا يوجد مشاركون في التفاوض',
      emptyDesc: 'سيظهر هنا حضور الطرف المقابل والمستشار والمفاوض الداخلي.',
      participant: 'مشارك',
    },

    playbook: {
      title: 'تطبيق دليل العمل',
      runCheck: 'تشغيل الفحص',
      requiredClauses: (met, total) => `${met}/${total} بنود مطلوبة`,
      compliant: (score) => `${score}% متوافق`,
      noScore: 'لا توجد درجة امتثال',
      fallbackScore: 'درجة احتياطية من الجلسة أو البيانات الوصفية',
      coverage: (pct) => `تغطية البنود المطلوبة: ${pct}`,
      emptyTitle: 'لا توجد انحرافات عن دليل العمل',
      emptyDesc: 'سيتم تجميع فجوات السياسة والبنود الإلزامية المفقودة والإعفاءات المعتمدة هنا.',
      waive: 'إعفاء',
      unassigned: 'غير مُسند',
    },

    terms: {
      title: 'المصطلحات المُعرّفة والإحالات المرجعية',
      scan: 'فحص',
      summary: (terms, refs) => `${terms} مصطلحات · ${refs} إحالات`,
      emptyTitle: 'لا توجد مصطلحات أو إحالات مفهرسة',
      emptyDesc: 'سيتم تعبئة هذا المتصفّح باستخراج المصطلحات المُعرّفة وفحوص الإحالات بين الأقسام.',
      definedTerms: 'المصطلحات المُعرّفة',
      crossReferences: 'الإحالات المرجعية',
      definitionMissing: 'لم يُلتقط التعريف',
      noSection: 'لا يوجد قسم',
      refs: (n) => `${n} إحالات`,
      target: (value) => `الهدف: ${value}`,
      unresolved: 'غير مُحلّ',
    },

    assignments: {
      title: (n) => `${n} إسنادات أقسام`,
      detail: 'المالك والموعد النهائي وحالة المراجعة',
      assign: 'إسناد',
      emptyTitle: 'لا توجد إسنادات أقسام',
      emptyDesc: 'أسنِد الأقسام إلى المراجعين وتتبّع الموافقات على مستوى الأقسام هنا.',
      due: (when) => `الاستحقاق ${when}`,
      review: 'مراجعة',
    },

    guests: {
      title: (n) => `${n} مراجعون ضيوف`,
      detail: 'صلاحية المراجعة الخارجية',
      invite: 'دعوة',
      emptyTitle: 'لا يوجد ضيوف خارجيون',
      emptyDesc: 'ستتم إدارة دعوات المستشار الخارجي ومراجع الطرف المقابل هنا.',
      externalReviewer: 'مراجع خارجي',
      access: 'الصلاحية',
      expires: 'تنتهي',
    },

    issues: {
      title: (open) => `${open} مسائل قانونية مفتوحة`,
      total: (n) => `${n} مسائل إجمالًا`,
      newIssue: 'مسألة جديدة',
      emptyTitle: 'لا توجد مسائل قانونية',
      emptyDesc: 'سيتم تتبّع تقييمات المخاطر وعوائق الصياغة ونتائج الفحص المسبق هنا.',
      unassigned: 'غير مُسند',
      due: (when) => `الاستحقاق ${when}`,
      escalate: 'تصعيد',
    },

    signature: {
      ready: 'جاهز للتوقيع',
      title: 'جاهزية التوقيع',
      signersComplete: (done, total) => `${done}/${total} موقّعون مكتملون`,
      prepare: 'تحضير',
      envelopePending: 'مزوّد المظروف قيد الانتظار',
      nextSigner: (name) => `الموقّع التالي: ${name}`,
      noNextSigner: 'لا يوجد موقّع تالٍ في قائمة الانتظار.',
      noBlockers: 'لا توجد عوائق توقيع مُبلّغ عنها حاليًا.',
    },

    clauseAi: {
      title: (n) => `${n} إجراءات ذكاء اصطناعي للبنود`,
      detail: 'الصياغة والمراجعة ودعم التصحيح التتبّعي على مستوى البنود',
      analyze: 'تحليل',
      emptyTitle: 'لا توجد إجراءات ذكاء اصطناعي للبنود',
      emptyDesc:
        'اختر بندًا أو زامِن التوصيات لتجهيز إجراءات إعادة الصياغة والشرح والمقارنة وفحص المخاطر.',
      confidence: (pct) => `الثقة ${pct}`,
      stage: 'تجهيز',
      draftAlternative: 'صياغة بديل',
    },

    health: {
      title: (score) => `${score}% جاهزية المستند`,
      readinessScore: 'درجة الجاهزية',
      refresh: 'تحديث',
      healthScore: 'درجة الجاهزية',
      signalsDesc: 'إشارات المزوّد والمراجعة والمسائل ودليل العمل والتوقيع',
      signals: 'إشارات الجاهزية',
    },

    privilege: {
      title: 'ضوابط الامتياز',
      review: 'مراجعة',
      accessReview: (when) => `مراجعة الصلاحيات: ${when}`,
      emptyTitle: 'لا توجد ضوابط امتياز',
      emptyDesc: 'ستظهر هنا قيود الحجز القانوني والعلامة المائية والتنزيل والذكاء الاصطناعي الخارجي.',
      notice: 'تُعرض الضوابط من الجلسة أو البيانات الاحتياطية حتى يتم ربط واجهات السياسات.',
    },

    advanced: {
      title: 'العمليات المتقدّمة',
      description: 'أحداث المزوّد وأتمتة المهام والحزم والموافقات والأدلة والأمان والتحليلات.',
      active: (n) => `${n} نشطة`,
      tabs: { ops: 'العمليات', work: 'العمل', structure: 'البنية', governance: 'الحوكمة' },
    },

    ops: {
      providerEvents: (n) => `${n} أحداث المزوّد`,
      providerEventsDesc: 'عمليات الحفظ والانضمام والتعليقات والتصحيح التتبّعي والتصدير وإخفاقات المزوّد.',
      syncEvents: 'مزامنة الأحداث',
      providerEventsEmptyTitle: 'لا توجد أحداث للمزوّد',
      providerEventsEmptyDesc: 'سيظهر هنا نشاط webhook الخاص بـ OnlyOffice أو Collabora أو Microsoft Graph.',
      guestLinks: (n) => `${n} روابط ضيوف نشطة`,
      guestLinksDetail: (expired, revoked) => `${expired} منتهية · ${revoked} مُلغاة`,
      reviewPortal: 'مراجعة البوابة',
      externalPortal: 'بوابة المراجعة الخارجية',
      lastActivity: (when) => `آخر نشاط: ${when}`,
      watermarked: 'بعلامة مائية',
      noWatermark: 'بدون علامة مائية',
      offlineRecovery: 'الاسترجاع دون اتصال',
      offlineDetail: (edits, comments) => `${edits} تعديلات · ${comments} تعليقات في الانتظار`,
      restore: 'استرجاع',
      lastBuffer: (when, conflicts) => `آخر تخزين مؤقت: ${when} · ${conflicts} تعارضات`,
    },

    work: {
      automationTasks: (n) => `${n} مهام مؤتمتة`,
      automationTasksDesc: 'مهام مُنشأة من المسائل والتعليقات وانحرافات دليل العمل وعوائق التوقيع.',
      createTask: 'إنشاء مهمة',
      tasksEmptyTitle: 'لا توجد مهام للمستند',
      tasksEmptyDesc: 'يمكن تحويل المسائل القانونية والتعليقات والانحرافات والعوائق إلى مهام مُسندة.',
      approvalMatrix: 'مصفوفة الموافقات',
      gates: (n, status) => `${n} بوابات · ${status}`,
      request: 'طلب',
      gatesEmptyTitle: 'لا توجد بوابات موافقة',
      gatesEmptyDesc:
        'ستظهر هنا بوابات التعديلات الحساسة وإدراجات الذكاء الاصطناعي والمشاركة الخارجية وجاهزية التوقيع.',
      inbox: (n) => `${n} عناصر بريد غير مقروءة`,
      inboxDesc: 'الإشارات وطلبات المراجعة ونشاط الضيوف والموافقات والعوائق.',
      openInbox: 'فتح البريد',
      inboxEmptyTitle: 'البريد فارغ',
      inboxEmptyDesc: 'سيتم تجميع نشاط التعاون غير المقروء وطلبات المراجعة هنا.',
      unassigned: 'غير مُسند',
      due: (when) => `الاستحقاق ${when}`,
      noApprover: 'لا يوجد معتمِد',
      required: 'مطلوب',
    },

    structure: {
      clauseAnchors: (n) => `${n} مراسي بنود`,
      clauseAnchorsDesc: 'مراسي البنود والأقسام الثابتة للتعليقات والمسائل والموافقات وإجراءات الذكاء الاصطناعي.',
      extract: 'استخراج',
      anchorsEmptyTitle: 'لا توجد مراسي بنود',
      anchorsEmptyDesc: 'ستظهر مراسي أقسام DOCX هنا بعد الاستخراج.',
      redlinePackages: (n) => `${n} حزم تصحيح تتبّعي`,
      redlinePackagesDesc:
        'نسخة نظيفة، تصحيح تتبّعي، قائمة مسائل، تقرير انحرافات، أدلة موافقة، وحزمة تدقيق.',
      generate: 'توليد',
      packagesEmptyTitle: 'لا توجد حزم تصحيح تتبّعي',
      packagesEmptyDesc: 'سيتم سرد تصديرات حزم التفاوض والموافقة والتوقيع هنا.',
      compareWorkspaces: (n) => `${n} مساحات مقارنة`,
      compareWorkspacesDesc: 'مقارنات الإصدارات ومسودّات الطرف المقابل وملفات DOCX المرفوعة.',
      compare: 'مقارنة',
      compareEmptyTitle: 'لا توجد مقارنات',
      compareEmptyDesc: 'ستظهر هنا مقارنات الإصدارات ومسودّات الطرف المقابل.',
      termRepairs: (n) => `${n} إصلاحات مصطلحات`,
      termRepairsDesc: 'إصلاحات بنقرة واحدة للمصطلحات غير المُعرّفة أو المكرّرة أو غير المتّسقة.',
      repair: 'إصلاح',
      repairsEmptyTitle: 'لا توجد إصلاحات مصطلحات',
      repairsEmptyDesc: 'ستظهر هنا الإصلاحات المقترحة للمصطلحات المُعرّفة.',
      evidenceBindings: (n) => `${n} روابط أدلة`,
      evidenceBindingsDesc: 'روابط مصدرية للمستندات والسياسات وبنود اللوائح والقضايا والمسائل.',
      bind: 'ربط',
      evidenceEmptyTitle: 'لا توجد روابط أدلة',
      evidenceEmptyDesc: 'ستظهر هنا الاستشهادات المصدرية وروابط الأدلة.',
      redlinePackage: 'حزمة تصحيح تتبّعي',
      noFormats: 'لا توجد صيغ',
      changes: (changes, material) => `${changes} تغييرات · ${material} جوهرية`,
      base: 'الأساس',
      target: 'الهدف',
    },

    governance: {
      ruleBuilders: (n) => `${n} مُنشئو قواعد`,
      ruleBuildersDesc: 'روابط المسؤول للبنود المطلوبة والبدائل واللغة المحفوفة بالمخاطر والموافقات.',
      openRules: 'فتح القواعد',
      rulesEmptyTitle: 'لا توجد روابط مُنشئ قواعد',
      rulesEmptyDesc: 'ستربط مُنشئات قواعد دليل العمل المُهيّأة من سياق هذا المستند.',
      aiSafety: 'أمان تغييرات الذكاء الاصطناعي',
      aiSafetyDetail: (pending, approvals) => `${pending} اقتراحات معلّقة · ${approvals} موافقات`,
      configure: 'تهيئة',
      disabled: 'مُعطّل',
      aiSafetyFallback: 'تبقى إدراجات الذكاء الاصطناعي في وضع المعاينة أو التصحيح التتبّعي أو الموافقة المطلوبة.',
      analytics: 'تحليلات المحرّر',
      analyticsDetail: (revisions, issues) => `${revisions} مراجعات · ${issues} مسائل غير محلولة`,
      refresh: 'تحديث',
      cycleTime: 'زمن الدورة',
      approvalDelay: 'تأخير الموافقة',
      externalReview: 'المراجعة الخارجية',
      deviationRate: 'معدّل الانحراف',
      signatureTrend: 'اتجاه التوقيع',
      noTrend: 'لا يوجد اتجاه بعد',
      rules: (n) => `${n} قواعد`,
      updated: (when) => `حُدّث ${when}`,
    },

    review: {
      title: 'لوحات المراجعة',
      description: 'التعليقات والتغييرات ودعم البنود ونشاط التدقيق.',
      tabs: { comments: 'التعليقات', changes: 'التغييرات', clauses: 'البنود', audit: 'التدقيق' },
    },

    comments: {
      unresolved: (n) => `${n} غير محلولة`,
      total: (n) => `${n} سلاسل تعليقات إجمالًا`,
      newThread: 'سلسلة جديدة',
      emptyTitle: 'لا توجد سلاسل تعليقات',
      emptyDesc: 'ستظهر تعليقات المزوّد هنا مع الكاتب والتحديد وحالة الحل.',
    },

    trackChanges: {
      on: 'تتبّع التغييرات مُفعّل',
      off: 'تتبّع التغييرات مُعطّل',
      total: (n) => `${n} تغييرات متتبَّعة`,
      reviewAll: 'مراجعة الكل',
      emptyTitle: 'لا توجد تغييرات متتبَّعة',
      emptyDesc: 'سيتم تجميع الإضافات والحذف وقرارات المراجعين هنا.',
      accept: 'قبول',
      reject: 'رفض',
    },

    clauseLibrary: {
      title: 'مساعد البنود',
      detail: 'تجهيز الإدراج والتوصيات',
      browse: 'تصفّح المكتبة',
      emptyTitle: 'لا توجد توصيات بعد',
      emptyDesc: 'يمكن تعبئة اقتراحات البنود من أدلة العمل أو سياق المستند أو النص المُحدّد.',
      insert: 'إدراج',
      clause: 'بند',
      notice:
        'الخطّافات النائبة جاهزة للإدراج عند المؤشّر واستبدال التحديد والتوصيات المبنية على أدلة العمل بمجرّد ربط واجهات مؤشّر المزوّد.',
      stagedTitle: 'تم تجهيز البند',
      stagedBody: 'التوصية جاهزة لربط الإدراج عند مؤشّر المزوّد.',
    },

    audit: {
      title: 'نشاط التدقيق',
      detail: 'أحداث المحرّر والتعاون',
      export: 'تصدير التدقيق',
      emptyTitle: 'لا توجد أحداث تدقيق للمحرّر',
      emptyDesc: 'سيتم سرد بدايات الجلسات وعمليات الحفظ وتغييرات القفل والتعليقات والتصديرات هنا.',
    },

    emptyState: {
      title: 'محرّر المستندات',
      description:
        'افتح مستند Lex في مساحة عمل المحرّر داخل التطبيق مع حالة المزوّد وإدارة القفل والحفظ التلقائي والتعليقات والتغييرات والبنود ولوحات التدقيق.',
      chooseTitle: 'اختر مستندًا',
      chooseDesc: 'ابحث في مستودع المستندات واختر مستندًا لفتح جلسة المحرّر.',
      selectDocument: 'اختر مستندًا',
      searchDocuments: 'ابحث بعنوان المستند…',
      openDocument: 'فتح المستند',
    },

    noSession: {
      description: 'تعذّر على مساحة عمل المحرّر تحميل المستند المطلوب.',
      message: 'تعذّر تحميل بيانات المستند اللازمة لفتح المحرّر.',
    },

    toastReady: (action) => `${action} جاهز`,
    toastReadyBody: 'عنصر تحكّم مساحة العمل مُهيّأ لتكامل مزوّد المحرّر.',

    aria: {
      editorMode: 'وضع المحرّر',
      playbookScore: 'درجة دليل العمل',
      editorFrameTitle: (provider) => `محرّر مستندات ${provider}`,
    },

    routeError: 'تعذّر عرض مسار محرّر المستندات.',
  },
};

/**
 * React hook resolving the editor label bundle against the active locale.
 * Mirrors `useCalendarLabels` / the canonical lex bilingual idiom.
 */
export function useEditorLabels(): EditorLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(labels, locale), [locale]);
}
