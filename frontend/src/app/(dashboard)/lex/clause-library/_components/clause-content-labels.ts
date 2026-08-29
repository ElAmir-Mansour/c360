'use client';

/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the
 * clause-library surface (page + authoring/search/governance components).
 *
 * Follows the canonical lex i18n contract (see `../../_lib/lex-i18n.ts`): a
 * single {@link LexBilingual} bundle with two full, same-shaped copies and a
 * thin `useClauseLibraryLabels()` hook that resolves against the active locale.
 * The `en` side equals the pre-existing English strings exactly so existing
 * English-asserting tests stay green under the `renderWithQuery` `en` default;
 * the `ar` side is professional MSA for the enterprise legal/contract domain.
 *
 * Glossary anchors: عقد (contract) / بند (clause) / لائحة (regulation) /
 * التزام (obligation) / حوكمة (governance) / مخاطر (risk) / اختصاص (jurisdiction).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface ClauseLibraryLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyCta: string;
  };
  metrics: {
    total: string;
    active: string;
    pending: string;
    approved: string;
    highRisk: string;
    needsAttention: string;
  };
  columns: {
    clause: string;
    type: string;
    status: string;
    governance: string;
    jurisdiction: string;
    version: string;
    updated: string;
    versionPrefix: (version: number) => string;
    defaultJurisdiction: string;
  };
  filters: {
    status: string;
    governance: string;
    statusOptions: {
      draft: string;
      active: string;
      deprecated: string;
      archived: string;
    };
    governanceOptions: {
      pending_review: string;
      in_review: string;
      approved: string;
      rejected: string;
    };
  };
  governance: {
    reviewer: string;
    reviewerPlaceholder: string;
    reviewerEmail: string;
    reviewerEmailPlaceholder: string;
    comment: string;
    activateApproved: string;
    cancel: string;
    submitting: string;
    detailsRequiredTitle: string;
    detailsRequiredMessage: string;
    decisionFailedTitle: string;
    queueApprove: string;
    queueChanges: string;
    versionPrefix: (version: number) => string;
    actions: {
      submitReview: {
        label: string;
        title: string;
        description: string;
        submitLabel: string;
        successTitle: string;
        commentPlaceholder: string;
      };
      approve: {
        label: string;
        title: string;
        description: string;
        submitLabel: string;
        successTitle: string;
        commentPlaceholder: string;
      };
      requestChanges: {
        label: string;
        title: string;
        description: string;
        submitLabel: string;
        successTitle: string;
        commentPlaceholder: string;
      };
      reject: {
        label: string;
        title: string;
        description: string;
        submitLabel: string;
        successTitle: string;
        commentPlaceholder: string;
      };
    };
  };
  actions: {
    create: string;
    edit: string;
    delete: string;
  };
  form: {
    createTitle: string;
    editTitle: string;
    createDescription: string;
    editDescription: string;
    sectionIdentity: string;
    sectionContent: string;
    sectionClassification: string;
    code: string;
    codePlaceholder: string;
    clauseType: string;
    category: string;
    categoryPlaceholder: string;
    jurisdiction: string;
    jurisdictionPlaceholder: string;
    source: string;
    sourcePlaceholder: string;
    sourceUrl: string;
    sourceUrlPlaceholder: string;
    riskLevel: string;
    status: string;
    titleEn: string;
    titleEnPlaceholder: string;
    titleAr: string;
    titleArPlaceholder: string;
    textEn: string;
    textEnPlaceholder: string;
    textAr: string;
    textArPlaceholder: string;
    tags: string;
    tagsPlaceholder: string;
    tagsHint: string;
    cancel: string;
    submitCreate: string;
    submitEdit: string;
    requiredError: string;
    translateEnToAr: string;
    translateArToEn: string;
    translateDone: string;
    translateEmpty: string;
  };
  search: {
    title: string;
    description: string;
    placeholder: string;
    semanticLabel: string;
    runLabel: string;
    emptyPrompt: string;
    noResults: string;
    loading: string;
    errorTitle: string;
    matchedFields: string;
    scoreLabel: string;
  };
  toast: {
    created: string;
    updated: string;
    deleted: string;
    createFailed: string;
    updateFailed: string;
    deleteFailed: string;
  };
  confirmDelete: {
    title: string;
    description: (title: string) => string;
    confirmLabel: string;
  };
  detail: {
    activity: string;
    activityEmpty: string;
    events: {
      systemActor: string;
      created: string;
      submitted: string;
      approved: string;
      rejected: string;
      updated: string;
      deprecated: string;
    };
  };
  /** Saved-views + pinned-clauses board (page + standalone panel). */
  savedViews: {
    title: string;
    description: string;
    nameThisView: string;
    saveView: string;
    save: string;
    clearFilters: string;
    empty: string;
    pinned: string;
    pinnedEmpty: string;
    panelTitle: string;
    panelDescription: string;
    saveCurrent: string;
    savedHeading: string;
    panelEmpty: string;
    namePlaceholder: string;
    nameAria: string;
    noSearchText: string;
    searchPrefix: (text: string) => string;
    deleteView: string;
    removeView: (name: string) => string;
    pinnedHeading: string;
    pinSelected: string;
    unpinSelected: string;
    pinnedEmptyPanel: string;
    clearPinned: string;
    unpinClause: string;
    countPinned: (count: number) => string;
    toastNameFirst: string;
    toastSaved: string;
    toastSavedDescription: (name: string) => string;
  };
  /** Clause quality linter panel (page + standalone component). */
  qualityLinter: {
    title: string;
    description: string;
    descriptionSelected: (count: number) => string;
    emptyPage: string;
    metrics: {
      entries: string;
      clean: string;
      errors: string;
      warnings: string;
      info: string;
    };
    noClauses: string;
    noIssues: string;
    score: (score: number) => string;
    fixPrefix: (recommendation: string) => string;
    additionalIssues: (count: number) => string;
    review: string;
    edit: string;
    scorePill: (score: number) => string;
    issues: {
      missingArabic: string;
      missingSource: string;
      staleDraft: string;
      approvedInactive: string;
      missingReplacement: string;
      weakTags: string;
      highRiskSource: string;
    };
  };
  /** Governance review queue panel (page + standalone component). */
  governanceQueue: {
    title: string;
    description: string;
    empty: string;
    emptyPage: string;
    criticalCount: (count: number) => string;
    highCount: (count: number) => string;
    lintError: (count: number) => string;
    ageDays: (days: number) => string;
    qualityScore: (score: number) => string;
    riskSuffix: (risk: string) => string;
    edit: string;
    summary: {
      queued: string;
      pending: string;
      inReview: string;
      rejected: string;
    };
    priority: {
      critical: string;
      high: string;
      normal: string;
    };
    intents: {
      approve: string;
      changes: string;
      reject: string;
      submit: string;
    };
  };
  /** Bulk-operations panel (standalone component). */
  bulkOps: {
    title: string;
    description: string;
    selected: (count: number) => string;
    emptyHint: string;
    selectionSummary: string;
    riskSuffix: (risk: string) => string;
    statusHeading: string;
    statusAria: string;
    applyStatus: string;
    governanceHeading: string;
    governanceAria: string;
    applyGovernance: string;
    tagsHeading: string;
    tagsPlaceholder: string;
    replaceTags: string;
    exportJson: string;
    deleteSelected: string;
    clearSelection: string;
    actions: {
      submitReview: string;
      approveMetadata: string;
      deprecate: string;
      exportJson: string;
      delete: string;
    };
  };
  /** Version lineage + compare panel (standalone component). */
  versionHistory: {
    lineage: string;
    compareVersions: string;
    selectVersion: string;
    comparingWith: string;
    loadRelatedHint: string;
    field: string;
    current: string;
    compared: string;
  };
  /** Clause use-actions toolbar (copy / drafting). */
  useActions: {
    copyEn: string;
    copyAr: string;
    copyBilingual: string;
    useInDrafting: string;
    nothingToCopyTitle: string;
    nothingToCopyBody: string;
    copiedTitle: string;
    copiedEn: string;
    copiedAr: string;
    copiedBilingual: string;
    copyFailedTitle: string;
    copyFailedBody: string;
    draftingFailedTitle: string;
    draftingFailedBody: string;
    draftingReadyTitle: string;
    draftingReadyQueued: string;
    draftingReadyCopied: string;
  };
  /** Delete-impact preview dialog + panel (standalone component). */
  deleteImpact: {
    dialogTitle: string;
    dialogDescription: (title: string) => string;
    cancel: string;
    deprecateInstead: string;
    delete: string;
    panelTitle: string;
    panelDescription: string;
    panelEmpty: string;
    recommendedAction: string;
    riskSuffix: (risk: string) => string;
    reasonsHeading: string;
    noReferences: string;
    referencesHeading: string;
    replacementsHeading: string;
    titleBlocked: string;
    titleRisky: string;
    titleSafe: string;
    severity: Record<string, string>;
    kinds: Record<string, string>;
  };
  /** Clause detail drawer (standalone component). */
  drawer: {
    governancePrefix: (status: string) => string;
    clauseForJurisdiction: (type: string, jurisdiction: string) => string;
    defaultJurisdiction: string;
    edit: string;
    cloneVersion: string;
    tabPreview: string;
    tabVersions: string;
    tabMetadata: string;
    english: string;
    arabic: string;
    untitledClause: string;
    noEnglishText: string;
    noArabicTitle: string;
    noArabicText: string;
    metadata: {
      clauseType: string;
      category: string;
      jurisdiction: string;
      language: string;
      riskLevel: string;
      source: string;
      created: string;
      updated: string;
      createdBy: string;
      updatedBy: string;
      notSet: string;
      sourceUrl: string;
      recordIds: string;
      id: string;
      tenantId: string;
      supersedesId: string;
      deprecatedById: string;
      replacementClauseId: string;
      deprecatedRelative: string;
    };
  };
  /** Preview drawer extras rendered on the page (clause-library/page.tsx). */
  pageDetail: {
    copyEn: string;
    copyAr: string;
    copyBilingual: string;
    drafting: string;
    pin: string;
    unpin: string;
    edit: string;
    cloneVersion: string;
    english: string;
    arabic: string;
    noArabicText: string;
    versionLineage: string;
    lineageSupersedes: string;
    lineageDeprecatedBy: string;
    lineageReplacement: string;
    lineageNone: string;
    versionCompare: string;
    loadingRelated: string;
    relatedNotLoaded: string;
    relatedVersion: (version: number) => string;
    currentVersion: (version: number) => string;
    category: string;
    jurisdiction: string;
    source: string;
    sourceUrl: string;
    uncategorized: string;
    defaultJurisdiction: string;
    defaultSource: string;
    notLinked: string;
    tags: string;
    noTags: string;
    metadata: string;
    deleteReviewDescription: (title: string) => string;
    impactVersionLinks: string;
    impactPlaybooks: string;
    impactRegulations: string;
    loadedImpact: string;
    impactVersionLinksTitle: string;
    impactPlaybookMatches: string;
    impactRegulationRefs: string;
    impactBackendNote: string;
    deprecateInstead: string;
    impactNone: string;
    impactMore: (count: number) => string;
  };
  /** Page-level toast strings not already in `toast`. */
  pageToast: {
    versionCreatedTitle: string;
    deprecatedTitle: string;
    copiedTitle: string;
    draftingCopiedTitle: string;
    draftingCopiedBody: string;
    nameViewFirst: string;
    bulkSubmittedTitle: string;
    bulkSubmittedDescription: (count: number) => string;
    bulkArchivedTitle: string;
    bulkArchivedDescription: (count: number) => string;
    bulkPinnedTitle: string;
    bulkPinnedDescription: (count: number) => string;
  };
  /** Page-level bulk-action labels (DataTable bulkActions). */
  pageBulk: {
    submitReview: string;
    archive: string;
    export: string;
    pin: string;
  };
}

export const clauseLibraryLabels: LexBilingual<ClauseLibraryLabels> = {
  en: {
    page: {
      eyebrow: 'Legal Suite',
      title: 'Clause Library',
      description:
        'Reusable bilingual clause templates, versions, risk posture, and deprecation state.',
      searchPlaceholder: 'Search clause templates...',
      emptyTitle: 'No clauses found',
      emptyDescription: 'No clause-library entries matched the current filters.',
      emptyCta: 'Create your first clause',
    },
    metrics: {
      total: 'Total Clauses',
      active: 'Active',
      pending: 'Pending Review',
      approved: 'Approved',
      highRisk: 'High Risk',
      needsAttention: 'Needs Attention',
    },
    columns: {
      clause: 'Clause',
      type: 'Type',
      status: 'Status',
      governance: 'Governance',
      jurisdiction: 'Jurisdiction',
      version: 'Version',
      updated: 'Updated',
      versionPrefix: (version) => `v${version}`,
      defaultJurisdiction: 'SA',
    },
    filters: {
      status: 'Status',
      governance: 'Governance',
      statusOptions: {
        draft: 'Draft',
        active: 'Active',
        deprecated: 'Deprecated',
        archived: 'Archived',
      },
      governanceOptions: {
        pending_review: 'Pending Review',
        in_review: 'In Review',
        approved: 'Approved',
        rejected: 'Rejected',
      },
    },
    governance: {
      reviewer: 'Reviewer',
      reviewerPlaceholder: 'Reviewer name',
      reviewerEmail: 'Reviewer email',
      reviewerEmailPlaceholder: 'reviewer@example.com',
      comment: 'Comment',
      activateApproved: 'Activate approved clause',
      cancel: 'Cancel',
      submitting: 'Submitting...',
      detailsRequiredTitle: 'Decision details required.',
      detailsRequiredMessage: 'Add a reviewer and governance comment before submitting.',
      decisionFailedTitle: 'Governance decision failed.',
      queueApprove: 'Approve',
      queueChanges: 'Changes',
      versionPrefix: (version) => `v${version}`,
      actions: {
        submitReview: {
          label: 'Submit for review',
          title: 'Submit clause for governance review',
          description: 'Move this clause into the Watheeq governance review queue.',
          submitLabel: 'Submit for Review',
          successTitle: 'Clause submitted for review.',
          commentPlaceholder: 'Summarize why this clause is ready for review.',
        },
        approve: {
          label: 'Approve governance',
          title: 'Approve clause governance',
          description: 'Record reviewer approval for this clause-library entry.',
          submitLabel: 'Approve Clause',
          successTitle: 'Clause governance approved.',
          commentPlaceholder: 'Add the legal or operational basis for approval.',
        },
        requestChanges: {
          label: 'Request changes',
          title: 'Request clause changes',
          description:
            'Return this clause with reviewer comments while preserving the governance audit trail.',
          submitLabel: 'Request Changes',
          successTitle: 'Clause changes requested.',
          commentPlaceholder: 'Describe the changes required before approval.',
        },
        reject: {
          label: 'Reject governance',
          title: 'Reject clause governance',
          description: 'Record a final rejection for this clause-library entry.',
          submitLabel: 'Reject Clause',
          successTitle: 'Clause governance rejected.',
          commentPlaceholder: 'Explain why this clause cannot be approved.',
        },
      },
    },
    actions: {
      create: 'New Clause',
      edit: 'Edit clause',
      delete: 'Delete clause',
    },
    form: {
      createTitle: 'New clause-library entry',
      editTitle: 'Edit clause-library entry',
      createDescription:
        'Author a reusable bilingual clause template. New entries start in draft governance and can be submitted for Watheeq review afterwards.',
      editDescription:
        'Update the clause content, metadata, and lifecycle state. Governance review history is preserved.',
      sectionIdentity: 'Identity',
      sectionContent: 'Clause content',
      sectionClassification: 'Classification',
      code: 'Code',
      codePlaceholder: 'CL-CONF-001',
      clauseType: 'Clause type',
      category: 'Category',
      categoryPlaceholder: 'confidentiality',
      jurisdiction: 'Jurisdiction',
      jurisdictionPlaceholder: 'SA',
      source: 'Source',
      sourcePlaceholder: 'internal_template',
      sourceUrl: 'Source URL',
      sourceUrlPlaceholder: 'https://example.com/policy',
      riskLevel: 'Risk level',
      status: 'Status',
      titleEn: 'Title (English)',
      titleEnPlaceholder: 'Mutual confidentiality',
      titleAr: 'Title (Arabic)',
      titleArPlaceholder: 'السرية المتبادلة',
      textEn: 'Clause text (English)',
      textEnPlaceholder: 'Each party shall keep the other party’s confidential information secret...',
      textAr: 'Clause text (Arabic)',
      textArPlaceholder: 'يلتزم كل طرف بالحفاظ على سرية المعلومات...',
      tags: 'Tags',
      tagsPlaceholder: 'confidentiality, nda',
      tagsHint: 'Comma-separated tags.',
      cancel: 'Cancel',
      submitCreate: 'Create clause',
      submitEdit: 'Save changes',
      requiredError: 'Add a code, English title, and English clause text before saving.',
      translateEnToAr: 'Translate EN→AR',
      translateArToEn: 'Translate AR→EN',
      translateDone: 'Translation inserted.',
      translateEmpty: 'Add clause text before translating.',
    },
    search: {
      title: 'Clause search',
      description: 'Full-text and semantic search across the clause library, scored by relevance.',
      placeholder: 'Search clauses by title, text, or tag...',
      semanticLabel: 'Semantic search',
      runLabel: 'Search',
      emptyPrompt: 'Enter a query above to search the clause library.',
      noResults: 'No clauses matched this query.',
      loading: 'Searching clauses...',
      errorTitle: 'Search failed.',
      matchedFields: 'Matched',
      scoreLabel: 'Relevance',
    },
    toast: {
      created: 'Clause created.',
      updated: 'Clause updated.',
      deleted: 'Clause deleted.',
      createFailed: 'Failed to create clause.',
      updateFailed: 'Failed to update clause.',
      deleteFailed: 'Failed to delete clause.',
    },
    confirmDelete: {
      title: 'Delete clause-library entry',
      description: (title) =>
        `Delete "${title}"? This removes the clause template from the active library.`,
      confirmLabel: 'Delete',
    },
    detail: {
      activity: 'Activity',
      activityEmpty: 'No lifecycle activity recorded yet.',
      events: {
        systemActor: 'System',
        created: 'created the clause',
        submitted: 'submitted the clause for review',
        approved: 'approved the clause governance',
        rejected: 'rejected the clause governance',
        updated: 'updated the clause',
        deprecated: 'deprecated the clause',
      },
    },
    savedViews: {
      title: 'Saved views and pinned clauses',
      description: 'Keep common filters and frequently used clauses one click away.',
      nameThisView: 'Name this view',
      saveView: 'Save view',
      save: 'Save',
      clearFilters: 'Clear filters',
      empty: 'No saved views yet.',
      pinned: 'Pinned',
      pinnedEmpty: 'Pin clauses from row actions or the preview drawer.',
      panelTitle: 'Saved Views + Pinned Clauses',
      panelDescription: 'Local saved filters and pinned clauses for recurring review workflows.',
      saveCurrent: 'Save current view',
      savedHeading: 'Saved views',
      panelEmpty: 'No saved views yet.',
      namePlaceholder: 'High-risk pending review',
      nameAria: 'Saved view name',
      noSearchText: 'No search text',
      searchPrefix: (text) => `Search: ${text}`,
      deleteView: 'Delete saved view',
      removeView: (name) => `Remove ${name}`,
      pinnedHeading: 'Pinned clauses',
      pinSelected: 'Pin selected',
      unpinSelected: 'Unpin selected',
      pinnedEmptyPanel: 'Pin clauses that need repeated governance review or editing.',
      clearPinned: 'Clear pinned clauses',
      unpinClause: 'Unpin clause',
      countPinned: (count) => `${count} pinned`,
      toastNameFirst: 'Name the saved view first.',
      toastSaved: 'Saved view created.',
      toastSavedDescription: (name) => name,
    },
    qualityLinter: {
      title: 'Clause quality linter',
      description: 'Authoring checks for missing bilingual, source, lifecycle, tag, and risk data.',
      descriptionSelected: (count) =>
        `Linting ${count} selected clause${count === 1 ? '' : 's'}.`,
      emptyPage: 'No quality warnings in the loaded clause sample.',
      metrics: {
        entries: 'Entries',
        clean: 'Clean',
        errors: 'Errors',
        warnings: 'Warnings',
        info: 'Info',
      },
      noClauses: 'No clauses are available for linting.',
      noIssues: 'No quality issues were found in the current set.',
      score: (score) => `Score ${score}`,
      fixPrefix: (recommendation) => `Fix: ${recommendation}`,
      additionalIssues: (count) => `${count} additional issue${count === 1 ? '' : 's'} found.`,
      review: 'Review',
      edit: 'Edit',
      scorePill: (score) => `${score}/100`,
      issues: {
        missingArabic: 'Missing Arabic clause text',
        missingSource: 'Missing source URL',
        staleDraft: 'Draft has not been updated recently',
        approvedInactive: 'Approved clause is not active',
        missingReplacement: 'Deprecated clause has no replacement',
        weakTags: 'Add stronger tags for discovery',
        highRiskSource: 'High-risk clause needs source evidence',
      },
    },
    governanceQueue: {
      title: 'Governance review queue',
      description: 'Pending and in-review clauses with approval actions in one place.',
      empty: 'No clauses currently need governance review.',
      emptyPage: 'No clauses are waiting for governance review.',
      criticalCount: (count) => `${count} critical`,
      highCount: (count) => `${count} high`,
      lintError: (count) => `${count} lint error`,
      ageDays: (days) => `${days} days since update`,
      qualityScore: (score) => `Quality ${score}/100`,
      riskSuffix: (risk) => `${risk} risk`,
      edit: 'Edit',
      summary: {
        queued: 'Queued',
        pending: 'Pending',
        inReview: 'In review',
        rejected: 'Rejected',
      },
      priority: {
        critical: 'Critical',
        high: 'High',
        normal: 'Normal',
      },
      intents: {
        approve: 'Approve',
        changes: 'Changes',
        reject: 'Reject',
        submit: 'Submit',
      },
    },
    bulkOps: {
      title: 'Bulk Operations',
      description: 'Apply status, governance, tag, export, or delete operations to the current selection.',
      selected: (count) => `${count} selected`,
      emptyHint: 'Select one or more clauses to enable bulk operations.',
      selectionSummary: 'Selection summary',
      riskSuffix: (risk) => `${risk} risk`,
      statusHeading: 'Status',
      statusAria: 'Bulk status',
      applyStatus: 'Apply status',
      governanceHeading: 'Governance',
      governanceAria: 'Bulk governance status',
      applyGovernance: 'Apply governance',
      tagsHeading: 'Tags',
      tagsPlaceholder: 'privacy, fallback, procurement',
      replaceTags: 'Replace tags',
      exportJson: 'Export JSON',
      deleteSelected: 'Delete selected',
      clearSelection: 'Clear selection',
      actions: {
        submitReview: 'Submit review',
        approveMetadata: 'Approve metadata',
        deprecate: 'Deprecate',
        exportJson: 'Export JSON',
        delete: 'Delete',
      },
    },
    versionHistory: {
      lineage: 'Version lineage',
      compareVersions: 'Compare versions',
      selectVersion: 'Select version',
      comparingWith: 'Comparing current clause with',
      loadRelatedHint:
        'Load a related entry in the table page and pass it as `relatedEntries` to enable side-by-side field comparison.',
      field: 'Field',
      current: 'Current',
      compared: 'Compared',
    },
    useActions: {
      copyEn: 'Copy EN',
      copyAr: 'Copy AR',
      copyBilingual: 'Copy bilingual',
      useInDrafting: 'Use in drafting',
      nothingToCopyTitle: 'Nothing to copy',
      nothingToCopyBody: 'This clause does not have content for that language.',
      copiedTitle: 'Clause copied',
      copiedEn: 'English clause text is on your clipboard.',
      copiedAr: 'Arabic clause text is on your clipboard.',
      copiedBilingual: 'Bilingual clause text is on your clipboard.',
      copyFailedTitle: 'Copy failed',
      copyFailedBody: 'Your browser blocked clipboard access.',
      draftingFailedTitle: 'Drafting handoff failed',
      draftingFailedBody: 'The clause could not be queued or copied.',
      draftingReadyTitle: 'Clause ready for drafting',
      draftingReadyQueued: 'Opening AI Drafting with the clause payload queued.',
      draftingReadyCopied: 'Opening AI Drafting after copying the clause to your clipboard.',
    },
    deleteImpact: {
      dialogTitle: 'Delete impact preview',
      dialogDescription: (title) =>
        `Review lifecycle references and replacement options before deleting ${title}.`,
      cancel: 'Cancel',
      deprecateInstead: 'Deprecate instead',
      delete: 'Delete',
      panelTitle: 'Safe delete impact',
      panelDescription: 'Lifecycle and reference checks for the selected clause.',
      panelEmpty: 'Select a clause to preview delete or deprecation impact.',
      recommendedAction: 'Recommended action:',
      riskSuffix: (risk) => `${risk} risk`,
      reasonsHeading: 'Impact reasons',
      noReferences: 'No lifecycle or metadata references were found in the provided entries.',
      referencesHeading: 'References found',
      replacementsHeading: 'Replacement candidates',
      titleBlocked: 'Deletion should be blocked until lifecycle links are resolved.',
      titleRisky: 'Deprecation is safer than immediate deletion.',
      titleSafe: 'No blocking impact found.',
      severity: {
        blocker: 'blocker',
        warning: 'warning',
        info: 'info',
      },
      kinds: {
        superseded_by: 'superseded by',
        deprecated_by: 'deprecated by',
        replacement_for: 'replacement for',
        same_code: 'same code',
        metadata_reference: 'metadata reference',
        outbound_link: 'outbound link',
      },
    },
    drawer: {
      governancePrefix: (status) => `Governance: ${status}`,
      clauseForJurisdiction: (type, jurisdiction) => `${type} clause for ${jurisdiction}.`,
      defaultJurisdiction: 'default jurisdiction',
      edit: 'Edit',
      cloneVersion: 'Clone version',
      tabPreview: 'Preview',
      tabVersions: 'Versions',
      tabMetadata: 'Metadata',
      english: 'English',
      arabic: 'Arabic',
      untitledClause: 'Untitled clause',
      noEnglishText: 'No English clause text.',
      noArabicTitle: 'No Arabic title',
      noArabicText: 'No Arabic clause text.',
      metadata: {
        clauseType: 'Clause type',
        category: 'Category',
        jurisdiction: 'Jurisdiction',
        language: 'Language',
        riskLevel: 'Risk level',
        source: 'Source',
        created: 'Created',
        updated: 'Updated',
        createdBy: 'Created by',
        updatedBy: 'Updated by',
        notSet: 'Not set',
        sourceUrl: 'Source URL',
        recordIds: 'Record IDs',
        id: 'ID',
        tenantId: 'Tenant ID',
        supersedesId: 'Supersedes ID',
        deprecatedById: 'Deprecated by ID',
        replacementClauseId: 'Replacement clause ID',
        deprecatedRelative: 'Deprecated',
      },
    },
    pageDetail: {
      copyEn: 'Copy EN',
      copyAr: 'Copy AR',
      copyBilingual: 'Copy bilingual',
      drafting: 'Drafting',
      pin: 'Pin',
      unpin: 'Unpin',
      edit: 'Edit',
      cloneVersion: 'Clone version',
      english: 'English',
      arabic: 'Arabic',
      noArabicText: 'لم تتم إضافة نص عربي.',
      versionLineage: 'Version lineage',
      lineageSupersedes: 'Supersedes',
      lineageDeprecatedBy: 'Deprecated by',
      lineageReplacement: 'Replacement',
      lineageNone: 'None',
      versionCompare: 'Version compare',
      loadingRelated: 'Loading related version...',
      relatedNotLoaded: 'Related version metadata is present, but the record was not loaded.',
      relatedVersion: (version) => `Related v${version}`,
      currentVersion: (version) => `Current v${version}`,
      category: 'Category',
      jurisdiction: 'Jurisdiction',
      source: 'Source',
      sourceUrl: 'Source URL',
      uncategorized: 'Uncategorized',
      defaultJurisdiction: 'SA',
      defaultSource: 'internal_template',
      notLinked: 'Not linked',
      tags: 'Tags',
      noTags: 'No tags.',
      metadata: 'Metadata',
      deleteReviewDescription: (title) =>
        `Review loaded downstream impact before deleting "${title}". Deprecation keeps the clause searchable while steering users to a replacement.`,
      impactVersionLinks: 'Version links',
      impactPlaybooks: 'Playbooks',
      impactRegulations: 'Regulations',
      loadedImpact: 'Loaded impact',
      impactVersionLinksTitle: 'Version/replacement links',
      impactPlaybookMatches: 'Playbook matches',
      impactRegulationRefs: 'Regulation references',
      impactBackendNote: 'Contract/deviation usage is not loaded on this page; backend checks remain authoritative.',
      deprecateInstead: 'Deprecate instead',
      impactNone: 'None in loaded data',
      impactMore: (count) => `, +${count} more`,
    },
    pageToast: {
      versionCreatedTitle: 'New clause version created.',
      deprecatedTitle: 'Clause deprecated.',
      copiedTitle: 'Clause copied.',
      draftingCopiedTitle: 'Clause copied for drafting.',
      draftingCopiedBody: 'Opening the drafting workspace.',
      nameViewFirst: 'Name the saved view first.',
      bulkSubmittedTitle: 'Selected clauses submitted for review.',
      bulkSubmittedDescription: (count) => `${count} clauses updated.`,
      bulkArchivedTitle: 'Selected clauses archived.',
      bulkArchivedDescription: (count) => `${count} clauses updated.`,
      bulkPinnedTitle: 'Selected clauses pinned.',
      bulkPinnedDescription: (count) => `${count} clauses added to pinned list.`,
    },
    pageBulk: {
      submitReview: 'Submit review',
      archive: 'Archive',
      export: 'Export',
      pin: 'Pin',
    },
  },
  ar: {
    page: {
      eyebrow: 'المجموعة القانونية',
      title: 'مكتبة البنود',
      description: 'قوالب بنود ثنائية اللغة قابلة لإعادة الاستخدام مع الإصدارات ووضع المخاطر وحالة الإيقاف.',
      searchPlaceholder: 'ابحث في قوالب البنود...',
      emptyTitle: 'لا توجد بنود',
      emptyDescription: 'لا توجد سجلات في مكتبة البنود تطابق عوامل التصفية الحالية.',
      emptyCta: 'أنشئ أول بند لك',
    },
    metrics: {
      total: 'إجمالي البنود',
      active: 'سارية',
      pending: 'بانتظار المراجعة',
      approved: 'موافَق عليها',
      highRisk: 'عالية المخاطر',
      needsAttention: 'تحتاج إلى انتباه',
    },
    columns: {
      clause: 'البند',
      type: 'النوع',
      status: 'الحالة',
      governance: 'الحوكمة',
      jurisdiction: 'الاختصاص',
      version: 'الإصدار',
      updated: 'آخر تحديث',
      versionPrefix: (version) => `الإصدار ${version}`,
      defaultJurisdiction: 'السعودية',
    },
    filters: {
      status: 'الحالة',
      governance: 'الحوكمة',
      statusOptions: {
        draft: 'مسودة',
        active: 'ساري',
        deprecated: 'موقوف',
        archived: 'مؤرشف',
      },
      governanceOptions: {
        pending_review: 'بانتظار المراجعة',
        in_review: 'قيد المراجعة',
        approved: 'موافَق عليه',
        rejected: 'مرفوض',
      },
    },
    governance: {
      reviewer: 'المراجِع',
      reviewerPlaceholder: 'اسم المراجِع',
      reviewerEmail: 'بريد المراجِع الإلكتروني',
      reviewerEmailPlaceholder: 'reviewer@example.com',
      comment: 'تعليق',
      activateApproved: 'تفعيل البند الموافَق عليه',
      cancel: 'إلغاء',
      submitting: 'جارٍ الإرسال...',
      detailsRequiredTitle: 'تفاصيل القرار مطلوبة.',
      detailsRequiredMessage: 'أضف مراجِعًا وتعليق حوكمة قبل الإرسال.',
      decisionFailedTitle: 'فشل قرار الحوكمة.',
      queueApprove: 'اعتماد',
      queueChanges: 'تعديلات',
      versionPrefix: (version) => `الإصدار ${version}`,
      actions: {
        submitReview: {
          label: 'تقديم للمراجعة',
          title: 'تقديم البند لمراجعة الحوكمة',
          description: 'نقل هذا البند إلى قائمة مراجعة الحوكمة في وثيق.',
          submitLabel: 'تقديم للمراجعة',
          successTitle: 'تم تقديم البند للمراجعة.',
          commentPlaceholder: 'لخّص سبب جاهزية هذا البند للمراجعة.',
        },
        approve: {
          label: 'الموافقة على الحوكمة',
          title: 'الموافقة على حوكمة البند',
          description: 'تسجيل موافقة المراجِع على سجل مكتبة البنود هذا.',
          submitLabel: 'الموافقة على البند',
          successTitle: 'تمت الموافقة على حوكمة البند.',
          commentPlaceholder: 'أضف الأساس القانوني أو التشغيلي للموافقة.',
        },
        requestChanges: {
          label: 'طلب تعديلات',
          title: 'طلب تعديلات على البند',
          description: 'إعادة هذا البند مع تعليقات المراجِع مع الحفاظ على سجل تدقيق الحوكمة.',
          submitLabel: 'طلب تعديلات',
          successTitle: 'تم طلب تعديلات على البند.',
          commentPlaceholder: 'صِف التعديلات المطلوبة قبل الموافقة.',
        },
        reject: {
          label: 'رفض الحوكمة',
          title: 'رفض حوكمة البند',
          description: 'تسجيل رفض نهائي لسجل مكتبة البنود هذا.',
          submitLabel: 'رفض البند',
          successTitle: 'تم رفض حوكمة البند.',
          commentPlaceholder: 'وضّح سبب تعذّر الموافقة على هذا البند.',
        },
      },
    },
    actions: {
      create: 'بند جديد',
      edit: 'تعديل البند',
      delete: 'حذف البند',
    },
    form: {
      createTitle: 'سجل جديد في مكتبة البنود',
      editTitle: 'تعديل سجل مكتبة البنود',
      createDescription:
        'أنشئ قالب بند ثنائي اللغة قابلًا لإعادة الاستخدام. تبدأ السجلات الجديدة في حوكمة المسودة ويمكن تقديمها لمراجعة وثيق لاحقًا.',
      editDescription:
        'حدّث محتوى البند والبيانات الوصفية وحالة دورة الحياة. يُحفظ سجل مراجعة الحوكمة.',
      sectionIdentity: 'الهوية',
      sectionContent: 'محتوى البند',
      sectionClassification: 'التصنيف',
      code: 'الرمز',
      codePlaceholder: 'CL-CONF-001',
      clauseType: 'نوع البند',
      category: 'الفئة',
      categoryPlaceholder: 'السرية',
      jurisdiction: 'الاختصاص',
      jurisdictionPlaceholder: 'السعودية',
      source: 'المصدر',
      sourcePlaceholder: 'قالب داخلي',
      sourceUrl: 'رابط المصدر',
      sourceUrlPlaceholder: 'https://example.com/policy',
      riskLevel: 'مستوى المخاطر',
      status: 'الحالة',
      titleEn: 'العنوان (بالإنجليزية)',
      titleEnPlaceholder: 'السرية المتبادلة',
      titleAr: 'العنوان (بالعربية)',
      titleArPlaceholder: 'السرية المتبادلة',
      textEn: 'نص البند (بالإنجليزية)',
      textEnPlaceholder: 'يلتزم كل طرف بالحفاظ على سرية معلومات الطرف الآخر...',
      textAr: 'نص البند (بالعربية)',
      textArPlaceholder: 'يلتزم كل طرف بالحفاظ على سرية المعلومات...',
      tags: 'الوسوم',
      tagsPlaceholder: 'السرية، اتفاقية عدم إفصاح',
      tagsHint: 'وسوم مفصولة بفواصل.',
      cancel: 'إلغاء',
      submitCreate: 'إنشاء البند',
      submitEdit: 'حفظ التغييرات',
      requiredError: 'أضف رمزًا وعنوانًا إنجليزيًا ونص بند إنجليزيًا قبل الحفظ.',
      translateEnToAr: 'ترجمة من الإنجليزية إلى العربية',
      translateArToEn: 'ترجمة من العربية إلى الإنجليزية',
      translateDone: 'تم إدراج الترجمة.',
      translateEmpty: 'أضف نص البند قبل الترجمة.',
    },
    search: {
      title: 'بحث البنود',
      description: 'بحث نصي ودلالي شامل في مكتبة البنود مرتّب حسب الصلة.',
      placeholder: 'ابحث في البنود بالعنوان أو النص أو الوسم...',
      semanticLabel: 'بحث دلالي',
      runLabel: 'بحث',
      emptyPrompt: 'أدخل استعلامًا أعلاه للبحث في مكتبة البنود.',
      noResults: 'لا توجد بنود تطابق هذا الاستعلام.',
      loading: 'جارٍ البحث في البنود...',
      errorTitle: 'فشل البحث.',
      matchedFields: 'المطابق',
      scoreLabel: 'الصلة',
    },
    toast: {
      created: 'تم إنشاء البند.',
      updated: 'تم تحديث البند.',
      deleted: 'تم حذف البند.',
      createFailed: 'تعذّر إنشاء البند.',
      updateFailed: 'تعذّر تحديث البند.',
      deleteFailed: 'تعذّر حذف البند.',
    },
    confirmDelete: {
      title: 'حذف سجل مكتبة البنود',
      description: (title) => `حذف "${title}"؟ يؤدي ذلك إلى إزالة قالب البند من المكتبة السارية.`,
      confirmLabel: 'حذف',
    },
    detail: {
      activity: 'النشاط',
      activityEmpty: 'لا يوجد نشاط دورة حياة مُسجَّل بعد.',
      events: {
        systemActor: 'النظام',
        created: 'أنشأ البند',
        submitted: 'قدّم البند للمراجعة',
        approved: 'اعتمد حوكمة البند',
        rejected: 'رفض حوكمة البند',
        updated: 'حدّث البند',
        deprecated: 'أوقف البند',
      },
    },
    savedViews: {
      title: 'العروض المحفوظة والبنود المثبَّتة',
      description: 'أبقِ المرشّحات الشائعة والبنود كثيرة الاستخدام على بُعد نقرة واحدة.',
      nameThisView: 'سمِّ هذا العرض',
      saveView: 'حفظ العرض',
      save: 'حفظ',
      clearFilters: 'مسح المرشّحات',
      empty: 'لا توجد عروض محفوظة بعد.',
      pinned: 'المثبَّتة',
      pinnedEmpty: 'ثبّت البنود من إجراءات الصف أو لوحة المعاينة.',
      panelTitle: 'العروض المحفوظة + البنود المثبَّتة',
      panelDescription: 'مرشّحات محفوظة محليًا وبنود مثبَّتة لسير عمل المراجعة المتكرّر.',
      saveCurrent: 'حفظ العرض الحالي',
      savedHeading: 'العروض المحفوظة',
      panelEmpty: 'لا توجد عروض محفوظة بعد.',
      namePlaceholder: 'عالية المخاطر بانتظار المراجعة',
      nameAria: 'اسم العرض المحفوظ',
      noSearchText: 'لا يوجد نص بحث',
      searchPrefix: (text) => `البحث: ${text}`,
      deleteView: 'حذف العرض المحفوظ',
      removeView: (name) => `إزالة ${name}`,
      pinnedHeading: 'البنود المثبَّتة',
      pinSelected: 'تثبيت المحدد',
      unpinSelected: 'إلغاء تثبيت المحدد',
      pinnedEmptyPanel: 'ثبّت البنود التي تحتاج إلى مراجعة حوكمة أو تعديل متكرّر.',
      clearPinned: 'مسح البنود المثبَّتة',
      unpinClause: 'إلغاء تثبيت البند',
      countPinned: (count) => `${count} مثبَّت`,
      toastNameFirst: 'سمِّ العرض المحفوظ أولًا.',
      toastSaved: 'تم إنشاء العرض المحفوظ.',
      toastSavedDescription: (name) => name,
    },
    qualityLinter: {
      title: 'مدقّق جودة البنود',
      description: 'فحوص التأليف للبيانات الناقصة من الثنائية اللغوية والمصدر ودورة الحياة والوسوم والمخاطر.',
      descriptionSelected: (count) => `تدقيق ${count} بند محدد.`,
      emptyPage: 'لا توجد تحذيرات جودة في عيّنة البنود المحمّلة.',
      metrics: {
        entries: 'السجلات',
        clean: 'سليمة',
        errors: 'أخطاء',
        warnings: 'تحذيرات',
        info: 'معلومات',
      },
      noClauses: 'لا توجد بنود متاحة للتدقيق.',
      noIssues: 'لم يُعثر على أي مشكلات جودة في المجموعة الحالية.',
      score: (score) => `الدرجة ${score}`,
      fixPrefix: (recommendation) => `الإصلاح: ${recommendation}`,
      additionalIssues: (count) => `عُثر على ${count} مشكلة إضافية.`,
      review: 'مراجعة',
      edit: 'تعديل',
      scorePill: (score) => `${score}/100`,
      issues: {
        missingArabic: 'نص البند العربي مفقود',
        missingSource: 'رابط المصدر مفقود',
        staleDraft: 'لم تُحدَّث المسودة مؤخرًا',
        approvedInactive: 'البند الموافَق عليه غير ساري',
        missingReplacement: 'البند المُوقَف بلا بديل',
        weakTags: 'أضف وسومًا أقوى لتحسين الاكتشاف',
        highRiskSource: 'البند عالي المخاطر يحتاج إلى دليل مصدري',
      },
    },
    governanceQueue: {
      title: 'قائمة مراجعة الحوكمة',
      description: 'البنود المعلّقة وقيد المراجعة مع إجراءات الاعتماد في مكان واحد.',
      empty: 'لا توجد بنود تحتاج إلى مراجعة حوكمة حاليًا.',
      emptyPage: 'لا توجد بنود بانتظار مراجعة الحوكمة.',
      criticalCount: (count) => `${count} حرجة`,
      highCount: (count) => `${count} مرتفعة`,
      lintError: (count) => `${count} خطأ تدقيق`,
      ageDays: (days) => `${days} يومًا منذ آخر تحديث`,
      qualityScore: (score) => `الجودة ${score}/100`,
      riskSuffix: (risk) => `مخاطر ${risk}`,
      edit: 'تعديل',
      summary: {
        queued: 'في القائمة',
        pending: 'معلّقة',
        inReview: 'قيد المراجعة',
        rejected: 'مرفوضة',
      },
      priority: {
        critical: 'حرجة',
        high: 'مرتفعة',
        normal: 'عادية',
      },
      intents: {
        approve: 'اعتماد',
        changes: 'تعديلات',
        reject: 'رفض',
        submit: 'تقديم',
      },
    },
    bulkOps: {
      title: 'العمليات الجماعية',
      description: 'طبّق عمليات الحالة أو الحوكمة أو الوسوم أو التصدير أو الحذف على التحديد الحالي.',
      selected: (count) => `${count} محدد`,
      emptyHint: 'حدّد بندًا واحدًا أو أكثر لتمكين العمليات الجماعية.',
      selectionSummary: 'ملخص التحديد',
      riskSuffix: (risk) => `مخاطر ${risk}`,
      statusHeading: 'الحالة',
      statusAria: 'الحالة الجماعية',
      applyStatus: 'تطبيق الحالة',
      governanceHeading: 'الحوكمة',
      governanceAria: 'حالة الحوكمة الجماعية',
      applyGovernance: 'تطبيق الحوكمة',
      tagsHeading: 'الوسوم',
      tagsPlaceholder: 'الخصوصية، البديل، المشتريات',
      replaceTags: 'استبدال الوسوم',
      exportJson: 'تصدير JSON',
      deleteSelected: 'حذف المحدد',
      clearSelection: 'مسح التحديد',
      actions: {
        submitReview: 'تقديم للمراجعة',
        approveMetadata: 'اعتماد البيانات الوصفية',
        deprecate: 'إيقاف',
        exportJson: 'تصدير JSON',
        delete: 'حذف',
      },
    },
    versionHistory: {
      lineage: 'سلالة الإصدارات',
      compareVersions: 'مقارنة الإصدارات',
      selectVersion: 'اختر إصدارًا',
      comparingWith: 'مقارنة البند الحالي مع',
      loadRelatedHint:
        'حمّل سجلًا ذا صلة في صفحة الجدول ومرّره بوصفه `relatedEntries` لتمكين المقارنة الحقلية جنبًا إلى جنب.',
      field: 'الحقل',
      current: 'الحالي',
      compared: 'المُقارَن',
    },
    useActions: {
      copyEn: 'نسخ الإنجليزية',
      copyAr: 'نسخ العربية',
      copyBilingual: 'نسخ ثنائي اللغة',
      useInDrafting: 'استخدام في الصياغة',
      nothingToCopyTitle: 'لا يوجد ما يُنسخ',
      nothingToCopyBody: 'لا يحتوي هذا البند على محتوى لتلك اللغة.',
      copiedTitle: 'تم نسخ البند',
      copiedEn: 'نص البند الإنجليزي في الحافظة.',
      copiedAr: 'نص البند العربي في الحافظة.',
      copiedBilingual: 'نص البند ثنائي اللغة في الحافظة.',
      copyFailedTitle: 'فشل النسخ',
      copyFailedBody: 'حظر متصفحك الوصول إلى الحافظة.',
      draftingFailedTitle: 'فشل تسليم الصياغة',
      draftingFailedBody: 'تعذّر إدراج البند في القائمة أو نسخه.',
      draftingReadyTitle: 'البند جاهز للصياغة',
      draftingReadyQueued: 'جارٍ فتح الصياغة بالذكاء الاصطناعي مع إدراج حمولة البند في القائمة.',
      draftingReadyCopied: 'جارٍ فتح الصياغة بالذكاء الاصطناعي بعد نسخ البند إلى الحافظة.',
    },
    deleteImpact: {
      dialogTitle: 'معاينة أثر الحذف',
      dialogDescription: (title) =>
        `راجِع إحالات دورة الحياة وخيارات الاستبدال قبل حذف ${title}.`,
      cancel: 'إلغاء',
      deprecateInstead: 'الإيقاف بدلًا من الحذف',
      delete: 'حذف',
      panelTitle: 'أثر الحذف الآمن',
      panelDescription: 'فحوص دورة الحياة والإحالات للبند المحدد.',
      panelEmpty: 'حدّد بندًا لمعاينة أثر الحذف أو الإيقاف.',
      recommendedAction: 'الإجراء المُوصى به:',
      riskSuffix: (risk) => `مخاطر ${risk}`,
      reasonsHeading: 'أسباب الأثر',
      noReferences: 'لم يُعثر على إحالات لدورة الحياة أو البيانات الوصفية في السجلات المُقدَّمة.',
      referencesHeading: 'الإحالات المُكتشَفة',
      replacementsHeading: 'بنود الاستبدال المرشّحة',
      titleBlocked: 'ينبغي حظر الحذف حتى تُحلّ روابط دورة الحياة.',
      titleRisky: 'الإيقاف أكثر أمانًا من الحذف الفوري.',
      titleSafe: 'لم يُعثر على أثر مانع.',
      severity: {
        blocker: 'مانع',
        warning: 'تحذير',
        info: 'معلومة',
      },
      kinds: {
        superseded_by: 'مُستبدَل بـ',
        deprecated_by: 'أُوقف بواسطة',
        replacement_for: 'بديل لـ',
        same_code: 'نفس الرمز',
        metadata_reference: 'مرجع بيانات وصفية',
        outbound_link: 'رابط صادر',
      },
    },
    drawer: {
      governancePrefix: (status) => `الحوكمة: ${status}`,
      clauseForJurisdiction: (type, jurisdiction) => `بند ${type} للاختصاص ${jurisdiction}.`,
      defaultJurisdiction: 'الاختصاص الافتراضي',
      edit: 'تعديل',
      cloneVersion: 'استنساخ الإصدار',
      tabPreview: 'معاينة',
      tabVersions: 'الإصدارات',
      tabMetadata: 'البيانات الوصفية',
      english: 'الإنجليزية',
      arabic: 'العربية',
      untitledClause: 'بند بلا عنوان',
      noEnglishText: 'لا يوجد نص بند إنجليزي.',
      noArabicTitle: 'لا يوجد عنوان عربي',
      noArabicText: 'لا يوجد نص بند عربي.',
      metadata: {
        clauseType: 'نوع البند',
        category: 'الفئة',
        jurisdiction: 'الاختصاص',
        language: 'اللغة',
        riskLevel: 'مستوى المخاطر',
        source: 'المصدر',
        created: 'أُنشئ في',
        updated: 'آخر تحديث',
        createdBy: 'أنشأه',
        updatedBy: 'حدّثه',
        notSet: 'غير محدد',
        sourceUrl: 'رابط المصدر',
        recordIds: 'معرّفات السجل',
        id: 'المعرّف',
        tenantId: 'معرّف المستأجر',
        supersedesId: 'معرّف البند المُستبدَل',
        deprecatedById: 'معرّف المُوقِف',
        replacementClauseId: 'معرّف بند الاستبدال',
        deprecatedRelative: 'أُوقف',
      },
    },
    pageDetail: {
      copyEn: 'نسخ الإنجليزية',
      copyAr: 'نسخ العربية',
      copyBilingual: 'نسخ ثنائي اللغة',
      drafting: 'الصياغة',
      pin: 'تثبيت',
      unpin: 'إلغاء التثبيت',
      edit: 'تعديل',
      cloneVersion: 'استنساخ الإصدار',
      english: 'الإنجليزية',
      arabic: 'العربية',
      noArabicText: 'لم تتم إضافة نص عربي.',
      versionLineage: 'سلالة الإصدارات',
      lineageSupersedes: 'يستبدل',
      lineageDeprecatedBy: 'أُوقف بواسطة',
      lineageReplacement: 'الاستبدال',
      lineageNone: 'لا يوجد',
      versionCompare: 'مقارنة الإصدارات',
      loadingRelated: 'جارٍ تحميل الإصدار ذي الصلة...',
      relatedNotLoaded: 'البيانات الوصفية للإصدار ذي الصلة موجودة، لكن لم يُحمَّل السجل.',
      relatedVersion: (version) => `الإصدار ذو الصلة ${version}`,
      currentVersion: (version) => `الإصدار الحالي ${version}`,
      category: 'الفئة',
      jurisdiction: 'الاختصاص',
      source: 'المصدر',
      sourceUrl: 'رابط المصدر',
      uncategorized: 'غير مُصنّف',
      defaultJurisdiction: 'السعودية',
      defaultSource: 'قالب داخلي',
      notLinked: 'غير مرتبط',
      tags: 'الوسوم',
      noTags: 'لا توجد وسوم.',
      metadata: 'البيانات الوصفية',
      deleteReviewDescription: (title) =>
        `راجِع الأثر اللاحق المحمّل قبل حذف "${title}". يُبقي الإيقاف البند قابلًا للبحث مع توجيه المستخدمين إلى بديل.`,
      impactVersionLinks: 'روابط الإصدارات',
      impactPlaybooks: 'الأدلة الإرشادية',
      impactRegulations: 'اللوائح',
      loadedImpact: 'الأثر المحمّل',
      impactVersionLinksTitle: 'روابط الإصدارات/الاستبدال',
      impactPlaybookMatches: 'مطابقات الأدلة الإرشادية',
      impactRegulationRefs: 'مراجع اللوائح',
      impactBackendNote: 'استخدام العقود/الانحرافات غير محمّل في هذه الصفحة؛ تبقى فحوص الخادم هي المرجع.',
      deprecateInstead: 'الإيقاف بدلًا من الحذف',
      impactNone: 'لا يوجد في البيانات المحمّلة',
      impactMore: (count) => `، +${count} أخرى`,
    },
    pageToast: {
      versionCreatedTitle: 'تم إنشاء إصدار جديد من البند.',
      deprecatedTitle: 'تم إيقاف البند.',
      copiedTitle: 'تم نسخ البند.',
      draftingCopiedTitle: 'تم نسخ البند للصياغة.',
      draftingCopiedBody: 'جارٍ فتح مساحة عمل الصياغة.',
      nameViewFirst: 'سمِّ العرض المحفوظ أولًا.',
      bulkSubmittedTitle: 'تم تقديم البنود المحددة للمراجعة.',
      bulkSubmittedDescription: (count) => `تم تحديث ${count} بنود.`,
      bulkArchivedTitle: 'تمت أرشفة البنود المحددة.',
      bulkArchivedDescription: (count) => `تم تحديث ${count} بنود.`,
      bulkPinnedTitle: 'تم تثبيت البنود المحددة.',
      bulkPinnedDescription: (count) => `تمت إضافة ${count} بنود إلى قائمة المثبَّتة.`,
    },
    pageBulk: {
      submitReview: 'تقديم للمراجعة',
      archive: 'أرشفة',
      export: 'تصدير',
      pin: 'تثبيت',
    },
  },
};

export function resolveClauseLibraryLabels(locale: AppLocale = 'en'): ClauseLibraryLabels {
  return resolveLexBilingual(clauseLibraryLabels, locale);
}

export function useClauseLibraryLabels(): ClauseLibraryLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveClauseLibraryLabels(locale), [locale]);
}
