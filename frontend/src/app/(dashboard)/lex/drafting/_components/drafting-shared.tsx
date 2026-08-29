'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, BookMarked, ClipboardPaste, Loader2, RefreshCw, Send } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/shared/copy-button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { parseApiError } from '@/lib/format';
import { showBackendError, showInfo, showSuccess } from '@/lib/toast';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import {
  CLAUSE_LIBRARY_PATH,
  type ClausePrefill,
  writeClausePrefill,
} from './clause-prefill';
import {
  type DraftReviewSummary,
  type DraftingTaskKey,
  downloadDraftingDocx,
  downloadDraftingText,
  getDraftReview,
  printDraftingPdf,
  submitDraftForReview,
  toMarkdown,
  writeDraftingHandoff,
} from './drafting-workspace';

/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the AI drafting
 * workspace.
 *
 * Follows the canonical lex i18n contract (see `../../_lib/lex-i18n.ts`): a
 * single {@link LexBilingual} bundle with two full, same-shaped copies and a
 * thin `useDraftingLabels()` hook that resolves against the active locale. The
 * `en` side equals the pre-existing English strings exactly so existing
 * English-asserting tests stay green; the `ar` side is professional MSA for the
 * enterprise legal drafting domain.
 *
 * Function-valued fields (e.g. `sectionObjectError(index)`) appear on BOTH
 * sides and preserve interpolation params + Western digits.
 */
export const draftingLabels: LexBilingual<DraftingLabels> = {
  en: {
  page: {
    title: 'AI Drafting',
    description:
      'Watheeq drafting console for governed clause generation, contract drafting, translation, review, and deterministic template assembly.',
    eyebrow: 'Legal Suite',
  },
  tabs: {
    clause: 'Clause',
    contract: 'Draft contract',
    rewrite: 'Rewrite clause',
    fallbacks: 'Fallbacks',
    translate: 'Translate',
    summarize: 'Summarize',
    glossary: 'Glossary',
    rfp: 'RFP response',
    obligationQa: 'Obligation QA',
    assembly: 'Assemble',
  },
  common: {
    language: 'Language',
    submit: 'Generate',
    loading: 'Generating governed result...',
    emptyHeading: 'Nothing generated yet',
    rationale: 'Rationale',
    notes: 'Notes',
    caveats: 'Caveats',
    summary: 'Summary',
    gaps: 'Gaps',
    none: 'None',
    generated: 'Result ready',
  },
  errors: {
    unavailableTitle: 'AI drafting unavailable',
    unavailableHint:
      'Deterministic template assembly remains available because it does not require an LLM provider.',
    genericTitle: 'Drafting request failed',
    requiredTitle: 'Input required',
  },
  resultActions: {
    copy: 'Copy result',
    insert: 'Insert into draft',
    inserted: 'Result copied — paste it into your draft.',
    saveToLibrary: 'Save to Clause Library',
    confidence: 'Confidence',
    riskScore: 'Risk score',
  },
  review: {
    submit: 'Submit for review',
    submitting: 'Submitting…',
    submitted: 'Draft submitted for review.',
    statusTitle: 'Review status',
    refresh: 'Refresh status',
    defaultTitle: 'AI draft',
    status: {
      pending: 'Pending review',
      approved: 'Approved',
      rejected: 'Rejected',
      changes_requested: 'Changes requested',
      cancelled: 'Cancelled',
    },
  },
  workspace: {
    commandTitle: 'Drafting command bar',
    commandDescription: 'Start from one place and route the input into any drafting tool.',
    commandPlaceholder: 'Paste or describe what you want to draft, rewrite, translate, or review.',
    commandSubmit: 'Open',
    commandTargetLabel: 'Destination tool',
    historyTitle: 'Workspace history',
    historyDescription: 'Recent drafting runs are stored locally so results survive tab switches.',
    historyEmpty: 'Generated drafts will appear here.',
    historyClear: 'Clear',
    historyOpenHint: 'Open in workspace',
    historyCount: (count: number) => (count === 1 ? '1 run' : `${count} runs`),
  },
  toolbar: {
    findPlaceholder: 'Find drafting action or text',
    run: 'Run',
    taskSelectorAria: 'Drafting task',
    taskPlaceholder: 'Task',
    searchAria: 'Drafting command search',
    chainTo: 'Chain to',
    history: 'History',
    export: 'Export',
    saveDraft: 'Save draft',
    reset: 'Reset',
    clear: 'Clear',
  },
  structuredEditors: {
    customer: 'Customer',
    supplier: 'Supplier',
    termMonths: 'Term months',
    annualValue: 'Annual value',
    paymentTerms: 'Payment terms',
    governingLaw: 'Governing law',
    renewal: 'Renewal',
    sla: 'SLA',
    dataProcessing: 'Data processing',
    sectionId: 'ID',
    sectionHeading: 'Heading',
    sectionCondition: 'Condition',
    sectionBody: 'Body',
    batchPlaceholder: 'Optional: add one clause or section per line for batch processing.',
    templateSections: 'Template sections',
    rowsToggle: 'Rows',
    jsonToggle: 'JSON',
    add: 'Add',
    newSection: 'New section',
    jsonPreview: 'JSON preview',
    original: 'Original',
    generated: 'Generated',
    compare: 'Compare',
    fieldLabels: {
      description: 'Description',
      owner: 'Owner',
      due: 'Due',
      type: 'Type',
      key: 'Key',
      value: 'Value',
    },
  },
  exportActions: {
    reviewerPlaceholder: 'Reviewer',
    reviewerNameAria: 'Reviewer name',
    rolePlaceholder: 'Role',
    roleAria: 'Reviewer role',
    reviewerOrTeamPlaceholder: 'Reviewer or team',
    reviewCommentPlaceholder: 'Add a review comment',
    replacementTextPlaceholder: 'Replacement or insertion text',
    printOrSavePdf: 'Print or save PDF',
    noContent: 'No content',
    exported: 'Exported',
  },
  promptTemplates: {
    taskFilterAria: 'Prompt template task filter',
  },
  reviewEditor: {
    defaultTitle: 'Editable result',
    defaultDescription: 'Review and refine the generated text before exporting or chaining it.',
    placeholder: 'No result text yet.',
    sourceDraft: 'Source draft',
    currentDraft: 'Current draft',
    preview: 'Preview',
    edit: 'Edit',
    save: 'Save',
    reset: 'Reset',
    draftTab: 'Draft',
    reviewTab: 'Review',
    compareTab: 'Compare',
    openComments: 'Open comments',
    openSuggestions: 'Open suggestions',
    reviewers: 'Reviewers',
    reviewAssignments: 'Review assignments',
    noReviewersAssigned: 'No reviewers assigned.',
    add: 'Add',
    addReviewItem: 'Add review item',
    selectedPrefix: (text) => `Selected: ${text}`,
    selectTextHint: 'Select text while editing to bind a comment or suggestion.',
    assignee: 'Assignee',
    comment: 'Comment',
    commentButton: 'Comment',
    suggestion: 'Suggestion',
    suggestButton: 'Suggest',
    comments: 'Comments',
    suggestions: 'Suggestions',
    noComments: 'No comments.',
    noSuggestions: 'No suggestions.',
    unassigned: 'Unassigned',
    quotePrefix: (quote) => `Quote: ${quote}`,
    statusOpen: 'open',
    resolve: 'Resolve',
    dismiss: 'Dismiss',
    textSuggestion: 'Text suggestion',
    replaceSelectedText: 'Replace selected text',
    insertSuggestedText: 'Insert suggested text',
    accept: 'Accept',
    reject: 'Reject',
    draftChanged: 'Draft changed',
    noDraftChanges: 'No draft changes',
    noTextToCompare: 'No text to compare.',
    defaultResultTitle: 'Drafting result',
    toasts: {
      docxStarted: 'DOCX export started',
      docxReady: 'DOCX export ready',
      pdfStarted: 'PDF export started',
      printOpened: 'Print dialog opened',
      printOpenedDetail: 'Choose Save as PDF in the browser print dialog.',
      exportReady: 'Export ready',
      exportFailed: 'Export failed',
      exportFailedDetail: 'Unable to export result.',
      publishComplete: 'Publish action complete',
      publishFailed: 'Publish failed',
      publishFailedDetail: 'Unable to publish draft.',
      draftSaved: 'Draft saved',
      saveFailed: 'Save failed',
      saveFailedDetail: 'Unable to save draft.',
      commentAdded: 'Comment added',
      suggestionAdded: 'Suggestion added',
    },
  },
  batchQueue: {
    summary: (completed, total, failed) => `${completed} of ${total} complete, ${failed} failed`,
    retryFailed: 'Retry failed',
    export: 'Export',
    exportCsv: 'Export CSV',
    clearBatchJobs: 'Clear batch jobs',
    failureReason: 'Failure reason: ',
    removeItem: 'Remove item',
    batchJobQueue: 'Batch job queue',
    noBatchJobs: 'No batch jobs queued.',
    statusDone: 'Done',
    statusFailed: 'Failed',
    statusRunning: 'Running',
    statusQueued: 'Queued',
  },
  cockpit: {
    title: 'Drafting cockpit',
    description: 'Workspace state, recipes, and recent versions for the current drafting session.',
    workspace: 'Workspace',
    open: 'Open',
    activeTask: 'Active task',
    versions: 'Versions',
    riskFlags: 'Risk flags',
    readiness: 'Readiness',
    readyForReview: 'Ready for review',
    needsFirstRun: 'Needs first run',
    recipes: 'Recipes',
    recentVersions: 'Recent versions',
    active: 'Active',
    noVersions: 'No versions yet.',
    runCount: (count) => (count === 1 ? '1 run' : `${count} runs`),
    nextAction: {
      generateFirst: 'Generate first version',
      reviewRiskGates: 'Review risk gates',
      createFallbacks: 'Create fallbacks',
      summarizeDraft: 'Summarize draft',
      compareEquivalence: 'Compare equivalence',
      publishOrChain: 'Publish or chain result',
    },
    recipeTitles: {
      clauseNegotiation: 'Clause negotiation',
      contractReview: 'Contract review pack',
      rfpResponse: 'RFP response',
    },
    recipePrompts: {
      clauseNegotiation: 'Draft a preferred clause, then create fallback positions and a plain-language rewrite.',
      contractReview: 'Summarize this contract, extract glossary terms, and prepare obligation QA follow-up.',
      rfpResponse: 'Draft an RFP response, rewrite gaps for executive tone, then translate the final answer.',
    },
  },
  panels: {
    markBaseline: 'Mark baseline',
    preview: 'Preview',
    edit: 'Edit',
    draftText: 'Draft text',
    previewMode: 'Preview mode',
    baseline: 'Baseline',
    current: 'Current',
    reviewer: 'Reviewer',
    reviewerPlaceholder: 'Legal reviewer',
    comment: 'Comment',
    commentPlaceholder: 'Add review note or clause-level annotation',
    add: 'Add',
    reviewerFallback: 'Reviewer',
    suggestedReplacement: 'Suggested replacement',
    suggestedReplacementPlaceholder: 'Paste reviewer-approved replacement text',
    accept: 'Accept',
    reject: 'Reject',
    restoreBaseline: 'Restore baseline',
    templateNamePlaceholder: 'Template name',
    saveTemplate: 'Save template',
    promptTemplateSaved: 'Prompt template saved.',
    deleteTemplate: (name) => `Delete ${name}`,
    saveContract: 'Save contract',
    saveDocument: 'Save document',
    saveMatter: 'Save matter',
    draftSavedAsContract: 'Draft saved as contract.',
    draftSavedAsDocument: 'Draft saved as document.',
    draftSavedAsMatter: 'Draft saved as matter.',
    copied: 'Copied',
    matched: 'Matched',
    qualityGates: 'Quality gates',
    ready: 'Ready',
    qualityMissing: (count) => `${count} missing`,
    qualityOk: 'OK',
    qualityGate: 'Gate',
    resolveBeforePublishing: (items) => `Resolve ${items} before publishing.`,
    riskLevel: 'Risk level',
    equivalence: 'Equivalence',
    openIssues: 'Open issues',
    activeTask: 'Active task',
    riskFlags: 'Risk flags',
    removeItem: 'Remove item',
    clearBatchJobs: 'Clear batch jobs',
  },
  riskDashboard: {
    confidence: 'Confidence',
    riskScore: 'Risk score',
    title: 'Risk and confidence',
    description: 'Review model confidence, risk posture, and unresolved concerns.',
    emptyLabel: 'No risk signals available.',
    riskPosture: 'Risk posture',
    unspecified: 'Unspecified',
    issues: 'Issues',
    suggestion: 'Suggestion: ',
    residualRisks: 'Residual risks',
    notes: 'Notes',
  },
  clause: {
    cardTitle: 'Generate clause',
    cardDescription: 'AID-01 governed single-clause drafting',
    intentLabel: 'Drafting intent',
    intentPlaceholder:
      'Limit supplier liability to direct damages with a negotiated cap and standard exclusions.',
    intentRequired: 'Add drafting intent before generating a clause.',
    clauseType: 'Clause type',
    contractType: 'Contract type',
    contextLabel: 'Context',
    contextPlaceholder:
      'Saudi enterprise SaaS deal, annual subscription, regulated customer data.',
    submit: 'Generate clause',
    resultTitle: 'Clause draft',
    resultDescription: 'Generated clause, risk posture, and review notes',
    assumptions: 'Assumptions',
    editableTitle: 'Editable clause text',
    emptyHeading: 'No clause generated yet',
  },
  contract: {
    cardTitle: 'Draft contract',
    cardDescription: 'AID-02 full-document draft from deal terms',
    contractType: 'Contract type',
    templateHint: 'Template hint',
    templateHintPlaceholder: 'Master services agreement, milestone billing.',
    dealTerms: 'Deal terms (JSON)',
    dealTermsRequired: 'Provide deal terms as a JSON object.',
    submit: 'Draft contract',
    resultTitle: 'Contract draft',
    resultDescription: 'Drafted sections, summary, and open items',
    openItems: 'Open items',
    editableTitle: 'Editable contract draft',
    emptyHeading: 'No contract drafted yet',
  },
  rewrite: {
    cardTitle: 'Rewrite clause',
    cardDescription: 'AID-03 rewrite to a target tone and risk posture',
    textLabel: 'Clause text',
    textPlaceholder: 'Paste the clause to rewrite.',
    textRequired: 'Paste the clause text to rewrite.',
    targetTone: 'Target tone',
    targetTonePlaceholder: 'Plain, assertive',
    riskPosture: 'Risk posture',
    riskPosturePlaceholder: 'Buyer-protective',
    instructions: 'Instructions',
    instructionsPlaceholder: 'Tighten obligations, keep the liability cap intact.',
    submit: 'Rewrite clause',
    resultTitle: 'Rewritten clause',
    resultDescription: 'Rewritten text, change log, and residual risks',
    changes: 'Changes',
    riskShift: 'Risk shift',
    residualRisks: 'Residual risks',
    emptyHeading: 'No rewrite generated yet',
    redlineOriginal: 'Original',
    redlineRevised: 'Rewritten',
    actionTitle: 'Clause rewrite',
    editableTitle: 'Editable rewritten clause',
    batchTitle: 'Batch rewrite results',
  },
  fallbacks: {
    cardTitle: 'Suggest fallbacks',
    cardDescription: 'AID-04 negotiation fallback ladder',
    clauseText: 'Clause text',
    clauseTextPlaceholder: 'Paste the preferred-position clause.',
    clauseTextRequired: 'Paste the clause text to generate fallbacks.',
    position: 'Negotiating position',
    positionPlaceholder: 'Buyer-protective preferred position.',
    count: 'Number of fallbacks',
    submit: 'Suggest fallbacks',
    resultTitle: 'Fallback ladder',
    resultDescription: 'Ordered concession options with usage guidance',
    concessionLevel: 'Concession level',
    whenToUse: 'When to use',
    emptyHeading: 'No fallbacks generated yet',
    actionTitle: 'Clause fallbacks',
    editableTitle: 'Editable fallback ladder',
    batchTitle: 'Batch fallback results',
  },
  translate: {
    cardTitle: 'Translate text',
    cardDescription: 'AID-05 legal-equivalence translation',
    textLabel: 'Source text',
    textPlaceholder: 'Paste the text to translate.',
    textRequired: 'Paste the text to translate.',
    sourceLang: 'Source language',
    targetLang: 'Target language',
    submit: 'Translate',
    resultTitle: 'Translation',
    resultDescription: 'Translated text with equivalence assessment',
    equivalence: 'Legal equivalence',
    emptyHeading: 'No translation generated yet',
    editableTitle: 'Editable translation',
    batchTitle: 'Batch translations',
  },
  summarize: {
    cardTitle: 'Summarize contract',
    cardDescription: 'AID-06 executive summary and key terms',
    textLabel: 'Contract text',
    textPlaceholder: 'Paste the contract text to summarize.',
    textRequired: 'Paste the contract text to summarize.',
    contractType: 'Contract type',
    submit: 'Summarize',
    resultTitle: 'Contract summary',
    resultDescription: 'Executive summary, key terms, obligations, and risks',
    executiveSummary: 'Executive summary',
    keyTerms: 'Key terms',
    obligations: 'Obligations',
    risks: 'Risks',
    renewalNotes: 'Renewal notes',
    emptyHeading: 'No summary generated yet',
    editableTitle: 'Editable summary',
  },
  glossary: {
    cardTitle: 'Generate glossary',
    cardDescription: 'AID-07 defined-terms extraction and consistency check',
    textLabel: 'Contract text',
    textPlaceholder: 'Paste the contract text to extract defined terms.',
    textRequired: 'Paste the contract text to build a glossary.',
    submit: 'Generate glossary',
    resultTitle: 'Glossary',
    resultDescription: 'Defined terms and detected inconsistencies',
    terms: 'Defined terms',
    inconsistencies: 'Inconsistencies',
    emptyHeading: 'No glossary generated yet',
    actionTitle: 'Contract glossary',
    editableTitle: 'Editable glossary',
  },
  rfp: {
    cardTitle: 'RFP response',
    cardDescription: 'AID-09 requirement-by-requirement RFP drafting',
    requirements: 'Requirements',
    requirementsPlaceholder: 'Paste the RFP requirements (one per line is fine).',
    requirementsRequired: 'Add the RFP requirements to draft a response.',
    companyProfile: 'Company profile',
    companyProfilePlaceholder: 'Sovereign cloud provider, ISO 27001 certified, KSA hosted.',
    submit: 'Draft RFP response',
    resultTitle: 'RFP response',
    resultDescription: 'Per-requirement responses, summary, and gaps',
    requirement: 'Requirement',
    response: 'Response',
    emptyHeading: 'No RFP response generated yet',
    editableTitle: 'Editable RFP response',
  },
  obligationQa: {
    cardTitle: 'Obligation QA review',
    cardDescription: 'AID-10 review extracted obligations against the contract',
    contractText: 'Contract text',
    contractTextPlaceholder: 'Paste the contract text the obligations were extracted from.',
    contractTextRequired: 'Paste the contract text to run the QA review.',
    obligations: 'Extracted obligations (JSON array)',
    obligationsRequired: 'Provide the extracted obligations as a JSON array.',
    obligationObjectError: (index: number) => `Obligation ${index} must be a JSON object.`,
    submit: 'Run QA review',
    resultTitle: 'QA review',
    resultDescription: 'Detected issues, confidence, and missing obligations',
    overallConfidence: 'Overall confidence',
    issues: 'Issues',
    suggestion: 'Suggestion',
    missingObligations: 'Missing obligations',
    obligationIndex: 'Obligation',
    emptyHeading: 'No QA review generated yet',
  },
  assembly: {
    cardTitle: 'Assemble template',
    cardDescription: 'AID-08 deterministic section logic',
    loadSample: 'Load sample',
    sections: 'Sections JSON',
    variables: 'Variables JSON',
    submit: 'Assemble template',
    resultTitle: 'Assembled document',
    resultDescription: 'Included sections, skips, and unresolved variables',
    included: 'Included',
    skipped: 'Skipped',
    unresolved: 'Unresolved',
    emptyHeading: 'No document assembled yet',
    actionTitle: 'Assembled contract',
    editableTitle: 'Editable assembled document',
    ready: 'Ready',
    needsReview: 'Needs review',
    unresolvedVariable: (item: string) => `Unresolved variable: ${item}`,
    sectionsArrayError: 'Sections must be a JSON array.',
    variablesObjectError: 'Variables must be a JSON object.',
    sectionObjectError: (index: number) => `Section ${index} must be a JSON object.`,
    sectionFieldsError: (index: number) => `Section ${index} needs heading and body.`,
    invalidJson: 'Template JSON is invalid.',
    },
    options: {
      clauseTypes: {
        limitation_of_liability: 'Limitation of liability',
        confidentiality: 'Confidentiality',
        data_protection: 'Data protection',
        termination: 'Termination',
        payment_terms: 'Payment terms',
        dispute_resolution: 'Dispute resolution',
        governing_law: 'Governing law',
        other: 'Other',
      },
      contractTypes: {
        service_agreement: 'Service agreement',
        nda: 'NDA',
        vendor: 'Vendor',
        procurement: 'Procurement',
        sla: 'SLA',
        mou: 'MOU',
        other: 'Other',
      },
      languages: {
        en: 'English',
        ar: 'العربية',
        bilingual: 'Bilingual',
      },
    },
  },
  ar: {
    page: {
      title: 'الصياغة بالذكاء الاصطناعي',
      description:
        'وحدة صياغة وثيق لإنشاء البنود وصياغة العقود والترجمة والمراجعة وتجميع القوالب الحتمي وفق الحوكمة.',
      eyebrow: 'المجموعة القانونية',
    },
    tabs: {
      clause: 'بند',
      contract: 'صياغة عقد',
      rewrite: 'إعادة صياغة بند',
      fallbacks: 'بدائل تفاوضية',
      translate: 'ترجمة',
      summarize: 'تلخيص',
      glossary: 'مسرد المصطلحات',
      rfp: 'رد على طلب عروض',
      obligationQa: 'ضبط جودة الالتزامات',
      assembly: 'تجميع',
    },
    common: {
      language: 'اللغة',
      submit: 'إنشاء',
      loading: 'جارٍ إنشاء نتيجة وفق الحوكمة...',
      emptyHeading: 'لم يُنشأ شيء بعد',
      rationale: 'المسوّغ',
      notes: 'ملاحظات',
      caveats: 'تحفظات',
      summary: 'الملخص',
      gaps: 'الفجوات',
      none: 'لا يوجد',
      generated: 'النتيجة جاهزة',
    },
    errors: {
      unavailableTitle: 'الصياغة بالذكاء الاصطناعي غير متاحة',
      unavailableHint:
        'يظل تجميع القوالب الحتمي متاحًا لأنه لا يتطلب مزوّد نموذج لغوي.',
      genericTitle: 'فشل طلب الصياغة',
      requiredTitle: 'مدخل مطلوب',
    },
    resultActions: {
      copy: 'نسخ النتيجة',
      insert: 'إدراج في المسودة',
      inserted: 'تم نسخ النتيجة — ألصقها في مسودتك.',
      saveToLibrary: 'حفظ في مكتبة البنود',
      confidence: 'الثقة',
      riskScore: 'درجة المخاطر',
    },
    review: {
      submit: 'إرسال للمراجعة',
      submitting: 'جارٍ الإرسال…',
      submitted: 'تم إرسال المسودة للمراجعة.',
      statusTitle: 'حالة المراجعة',
      refresh: 'تحديث الحالة',
      defaultTitle: 'مسودة بالذكاء الاصطناعي',
      status: {
        pending: 'قيد المراجعة',
        approved: 'معتمدة',
        rejected: 'مرفوضة',
        changes_requested: 'مطلوب تعديلات',
        cancelled: 'ملغاة',
      },
    },
    workspace: {
      commandTitle: 'شريط أوامر الصياغة',
      commandDescription: 'ابدأ من مكان واحد ووجّه المدخل إلى أي أداة صياغة.',
      commandPlaceholder: 'ألصق أو صف ما تريد صياغته أو إعادة صياغته أو ترجمته أو مراجعته.',
      commandSubmit: 'فتح',
      commandTargetLabel: 'الأداة الوجهة',
      historyTitle: 'سجل مساحة العمل',
      historyDescription: 'تُحفظ عمليات الصياغة الأخيرة محليًا لتبقى النتائج عند تبديل التبويبات.',
      historyEmpty: 'ستظهر المسودات المُنشأة هنا.',
      historyClear: 'مسح',
      historyOpenHint: 'فتح في مساحة العمل',
      historyCount: (count: number) => (count === 1 ? 'عملية واحدة' : `${count} عمليات`),
    },
    toolbar: {
      findPlaceholder: 'ابحث عن إجراء صياغة أو نص',
      run: 'تشغيل',
      taskSelectorAria: 'مهمة الصياغة',
      taskPlaceholder: 'المهمة',
      searchAria: 'بحث أوامر الصياغة',
      chainTo: 'تسلسل إلى',
      history: 'السجل',
      export: 'تصدير',
      saveDraft: 'حفظ المسودة',
      reset: 'إعادة تعيين',
      clear: 'مسح',
    },
    structuredEditors: {
      customer: 'العميل',
      supplier: 'المورّد',
      termMonths: 'مدة العقد (بالأشهر)',
      annualValue: 'القيمة السنوية',
      paymentTerms: 'شروط الدفع',
      governingLaw: 'القانون الحاكم',
      renewal: 'التجديد',
      sla: 'اتفاقية مستوى الخدمة',
      dataProcessing: 'معالجة البيانات',
      sectionId: 'المعرّف',
      sectionHeading: 'العنوان',
      sectionCondition: 'الشرط',
      sectionBody: 'النص',
      batchPlaceholder: 'اختياري: أضف بندًا أو قسمًا واحدًا في كل سطر للمعالجة الدفعية.',
      templateSections: 'أقسام القالب',
      rowsToggle: 'صفوف',
      jsonToggle: 'JSON',
      add: 'إضافة',
      newSection: 'قسم جديد',
      jsonPreview: 'معاينة JSON',
      original: 'الأصل',
      generated: 'الناتج',
      compare: 'مقارنة',
      fieldLabels: {
        description: 'الوصف',
        owner: 'المالك',
        due: 'الاستحقاق',
        type: 'النوع',
        key: 'المفتاح',
        value: 'القيمة',
      },
    },
    exportActions: {
      reviewerPlaceholder: 'المراجِع',
      reviewerNameAria: 'اسم المراجِع',
      rolePlaceholder: 'الدور',
      roleAria: 'دور المراجِع',
      reviewerOrTeamPlaceholder: 'المراجِع أو الفريق',
      reviewCommentPlaceholder: 'أضف تعليق مراجعة',
      replacementTextPlaceholder: 'نص الاستبدال أو الإدراج',
      printOrSavePdf: 'طباعة أو حفظ بصيغة PDF',
      noContent: 'لا يوجد محتوى',
      exported: 'صُدِّر',
    },
    promptTemplates: {
      taskFilterAria: 'تصفية قوالب الأوامر حسب المهمة',
    },
    reviewEditor: {
      defaultTitle: 'النتيجة القابلة للتحرير',
      defaultDescription: 'راجع النص المُنشأ وحسّنه قبل تصديره أو ربطه.',
      placeholder: 'لا يوجد نص نتيجة بعد.',
      sourceDraft: 'المسودة المصدر',
      currentDraft: 'المسودة الحالية',
      preview: 'معاينة',
      edit: 'تعديل',
      save: 'حفظ',
      reset: 'إعادة تعيين',
      draftTab: 'المسودة',
      reviewTab: 'المراجعة',
      compareTab: 'المقارنة',
      openComments: 'تعليقات مفتوحة',
      openSuggestions: 'اقتراحات مفتوحة',
      reviewers: 'المراجِعون',
      reviewAssignments: 'مهام المراجعة',
      noReviewersAssigned: 'لا يوجد مراجِعون مُسندون.',
      add: 'إضافة',
      addReviewItem: 'إضافة عنصر مراجعة',
      selectedPrefix: (text) => `المحدد: ${text}`,
      selectTextHint: 'حدّد نصًا أثناء التحرير لربط تعليق أو اقتراح به.',
      assignee: 'المُسند إليه',
      comment: 'تعليق',
      commentButton: 'تعليق',
      suggestion: 'اقتراح',
      suggestButton: 'اقتراح',
      comments: 'التعليقات',
      suggestions: 'الاقتراحات',
      noComments: 'لا توجد تعليقات.',
      noSuggestions: 'لا توجد اقتراحات.',
      unassigned: 'غير مُسند',
      quotePrefix: (quote) => `اقتباس: ${quote}`,
      statusOpen: 'مفتوح',
      resolve: 'حل',
      dismiss: 'تجاهل',
      textSuggestion: 'اقتراح نصي',
      replaceSelectedText: 'استبدال النص المحدد',
      insertSuggestedText: 'إدراج النص المقترح',
      accept: 'قبول',
      reject: 'رفض',
      draftChanged: 'تغيّرت المسودة',
      noDraftChanges: 'لا تغييرات على المسودة',
      noTextToCompare: 'لا يوجد نص للمقارنة.',
      defaultResultTitle: 'نتيجة الصياغة',
      toasts: {
        docxStarted: 'بدأ تصدير DOCX',
        docxReady: 'تصدير DOCX جاهز',
        pdfStarted: 'بدأ تصدير PDF',
        printOpened: 'فُتح حوار الطباعة',
        printOpenedDetail: 'اختر «حفظ بصيغة PDF» في حوار طباعة المتصفح.',
        exportReady: 'التصدير جاهز',
        exportFailed: 'فشل التصدير',
        exportFailedDetail: 'تعذّر تصدير النتيجة.',
        publishComplete: 'اكتمل إجراء النشر',
        publishFailed: 'فشل النشر',
        publishFailedDetail: 'تعذّر نشر المسودة.',
        draftSaved: 'تم حفظ المسودة',
        saveFailed: 'فشل الحفظ',
        saveFailedDetail: 'تعذّر حفظ المسودة.',
        commentAdded: 'تمت إضافة التعليق',
        suggestionAdded: 'تمت إضافة الاقتراح',
      },
    },
    batchQueue: {
      summary: (completed, total, failed) => `${completed} من ${total} مكتمل، و${failed} فشل`,
      retryFailed: 'إعادة محاولة الفاشلة',
      export: 'تصدير',
      exportCsv: 'تصدير CSV',
      clearBatchJobs: 'مسح المهام الدفعية',
      failureReason: 'سبب الفشل: ',
      removeItem: 'إزالة العنصر',
      batchJobQueue: 'طابور المهام الدفعية',
      noBatchJobs: 'لا توجد مهام دفعية في الطابور.',
      statusDone: 'منجز',
      statusFailed: 'فشل',
      statusRunning: 'قيد التشغيل',
      statusQueued: 'في الطابور',
    },
    cockpit: {
      title: 'قمرة قيادة الصياغة',
      description: 'حالة مساحة العمل والوصفات والإصدارات الأخيرة لجلسة الصياغة الحالية.',
      workspace: 'مساحة العمل',
      open: 'فتح',
      activeTask: 'المهمة النشطة',
      versions: 'الإصدارات',
      riskFlags: 'علامات المخاطر',
      readiness: 'الجاهزية',
      readyForReview: 'جاهز للمراجعة',
      needsFirstRun: 'يحتاج إلى تشغيل أول',
      recipes: 'الوصفات',
      recentVersions: 'الإصدارات الأخيرة',
      active: 'نشط',
      noVersions: 'لا توجد إصدارات بعد.',
      runCount: (count) => (count === 1 ? 'عملية واحدة' : `${count} عمليات`),
      nextAction: {
        generateFirst: 'إنشاء الإصدار الأول',
        reviewRiskGates: 'مراجعة بوابات المخاطر',
        createFallbacks: 'إنشاء مواقف بديلة',
        summarizeDraft: 'تلخيص المسودة',
        compareEquivalence: 'مقارنة التكافؤ',
        publishOrChain: 'نشر النتيجة أو ربطها',
      },
      recipeTitles: {
        clauseNegotiation: 'التفاوض على البنود',
        contractReview: 'حزمة مراجعة العقد',
        rfpResponse: 'الرد على طلب العروض',
      },
      recipePrompts: {
        clauseNegotiation: 'صُغ بندًا مفضّلًا، ثم أنشئ مواقف بديلة وإعادة صياغة بلغة مبسّطة.',
        contractReview: 'لخّص هذا العقد واستخرج مصطلحات المسرد وجهّز متابعة ضمان جودة الالتزامات.',
        rfpResponse: 'صُغ ردًا على طلب العروض، وأعد صياغة الفجوات بنبرة تنفيذية، ثم ترجم الإجابة النهائية.',
      },
    },
    panels: {
      markBaseline: 'تحديد كأساس',
      preview: 'معاينة',
      edit: 'تعديل',
      draftText: 'نص المسودة',
      previewMode: 'وضع المعاينة',
      baseline: 'الأساس',
      current: 'الحالي',
      reviewer: 'المراجِع',
      reviewerPlaceholder: 'مراجِع قانوني',
      comment: 'تعليق',
      commentPlaceholder: 'أضف ملاحظة مراجعة أو تعليقًا على مستوى البند',
      add: 'إضافة',
      reviewerFallback: 'المراجِع',
      suggestedReplacement: 'الاستبدال المقترح',
      suggestedReplacementPlaceholder: 'الصق النص البديل المعتمد من المراجِع',
      accept: 'قبول',
      reject: 'رفض',
      restoreBaseline: 'استعادة الأساس',
      templateNamePlaceholder: 'اسم القالب',
      saveTemplate: 'حفظ القالب',
      promptTemplateSaved: 'تم حفظ قالب الأمر.',
      deleteTemplate: (name) => `حذف ${name}`,
      saveContract: 'حفظ كعقد',
      saveDocument: 'حفظ كوثيقة',
      saveMatter: 'حفظ كقضية',
      draftSavedAsContract: 'تم حفظ المسودة كعقد.',
      draftSavedAsDocument: 'تم حفظ المسودة كوثيقة.',
      draftSavedAsMatter: 'تم حفظ المسودة كقضية.',
      copied: 'تم النسخ',
      matched: 'مطابق',
      qualityGates: 'بوابات الجودة',
      ready: 'جاهز',
      qualityMissing: (count) => `${count} ناقصة`,
      qualityOk: 'مكتمل',
      qualityGate: 'بوابة',
      resolveBeforePublishing: (items) => `أكمل ${items} قبل النشر.`,
      riskLevel: 'مستوى المخاطر',
      equivalence: 'التكافؤ',
      openIssues: 'المسائل المفتوحة',
      activeTask: 'المهمة النشطة',
      riskFlags: 'علامات المخاطر',
      removeItem: 'إزالة العنصر',
      clearBatchJobs: 'مسح المهام الدفعية',
    },
    riskDashboard: {
      confidence: 'مستوى الثقة',
      riskScore: 'درجة المخاطر',
      title: 'المخاطر ومستوى الثقة',
      description: 'راجع مستوى ثقة النموذج ووضع المخاطر والمسائل غير المحسومة.',
      emptyLabel: 'لا توجد إشارات مخاطر متاحة.',
      riskPosture: 'وضع المخاطر',
      unspecified: 'غير محدد',
      issues: 'المسائل',
      suggestion: 'اقتراح: ',
      residualRisks: 'المخاطر المتبقية',
      notes: 'ملاحظات',
    },
    clause: {
      cardTitle: 'إنشاء بند',
      cardDescription: 'AID-01 صياغة بند مفرد وفق الحوكمة',
      intentLabel: 'هدف الصياغة',
      intentPlaceholder:
        'حدّ من مسؤولية المورّد إلى الأضرار المباشرة مع سقف متفاوَض عليه واستثناءات قياسية.',
      intentRequired: 'أضف هدف الصياغة قبل إنشاء البند.',
      clauseType: 'نوع البند',
      contractType: 'نوع العقد',
      contextLabel: 'السياق',
      contextPlaceholder:
        'صفقة برمجيات كخدمة لمؤسسة سعودية، اشتراك سنوي، بيانات عملاء خاضعة للتنظيم.',
      submit: 'إنشاء البند',
      resultTitle: 'مسودة البند',
      resultDescription: 'البند المُنشأ ووضع المخاطر وملاحظات المراجعة',
      assumptions: 'الافتراضات',
      editableTitle: 'نص البند القابل للتحرير',
      emptyHeading: 'لم يُنشأ بند بعد',
    },
    contract: {
      cardTitle: 'صياغة عقد',
      cardDescription: 'AID-02 مسودة وثيقة كاملة من شروط الصفقة',
      contractType: 'نوع العقد',
      templateHint: 'تلميح القالب',
      templateHintPlaceholder: 'اتفاقية خدمات رئيسية، فوترة بحسب المراحل.',
      dealTerms: 'شروط الصفقة (JSON)',
      dealTermsRequired: 'قدّم شروط الصفقة ككائن JSON.',
      submit: 'صياغة العقد',
      resultTitle: 'مسودة العقد',
      resultDescription: 'الأقسام المصاغة والملخص والبنود المفتوحة',
      openItems: 'بنود مفتوحة',
      editableTitle: 'مسودة العقد القابلة للتحرير',
      emptyHeading: 'لم يُصَغ عقد بعد',
    },
    rewrite: {
      cardTitle: 'إعادة صياغة بند',
      cardDescription: 'AID-03 إعادة الصياغة بنبرة ووضع مخاطر مستهدفين',
      textLabel: 'نص البند',
      textPlaceholder: 'ألصق البند المراد إعادة صياغته.',
      textRequired: 'ألصق نص البند المراد إعادة صياغته.',
      targetTone: 'النبرة المستهدفة',
      targetTonePlaceholder: 'واضحة، حازمة',
      riskPosture: 'وضع المخاطر',
      riskPosturePlaceholder: 'حامية للمشتري',
      instructions: 'تعليمات',
      instructionsPlaceholder: 'شدّد الالتزامات مع الإبقاء على سقف المسؤولية.',
      submit: 'إعادة صياغة البند',
      resultTitle: 'البند المُعاد صياغته',
      resultDescription: 'النص المُعاد صياغته وسجل التغييرات والمخاطر المتبقية',
      changes: 'التغييرات',
      riskShift: 'تحوّل المخاطر',
      residualRisks: 'المخاطر المتبقية',
      emptyHeading: 'لم تُنشأ إعادة صياغة بعد',
      redlineOriginal: 'النص الأصلي',
      redlineRevised: 'النص المُعاد صياغته',
      actionTitle: 'إعادة صياغة البند',
      editableTitle: 'البند المُعاد صياغته القابل للتحرير',
      batchTitle: 'نتائج إعادة الصياغة المجمّعة',
    },
    fallbacks: {
      cardTitle: 'اقتراح بدائل تفاوضية',
      cardDescription: 'AID-04 سُلّم تنازلات التفاوض',
      clauseText: 'نص البند',
      clauseTextPlaceholder: 'ألصق البند ذا الموقف المفضّل.',
      clauseTextRequired: 'ألصق نص البند لإنشاء البدائل.',
      position: 'الموقف التفاوضي',
      positionPlaceholder: 'موقف مفضّل حامٍ للمشتري.',
      count: 'عدد البدائل',
      submit: 'اقتراح البدائل',
      resultTitle: 'سُلّم البدائل',
      resultDescription: 'خيارات تنازل مرتّبة مع إرشادات الاستخدام',
      concessionLevel: 'مستوى التنازل',
      whenToUse: 'متى يُستخدم',
      emptyHeading: 'لم تُنشأ بدائل بعد',
      actionTitle: 'بدائل البند',
      editableTitle: 'سُلّم البدائل القابل للتحرير',
      batchTitle: 'نتائج البدائل المجمّعة',
    },
    translate: {
      cardTitle: 'ترجمة نص',
      cardDescription: 'AID-05 ترجمة بمعادلة قانونية',
      textLabel: 'النص المصدر',
      textPlaceholder: 'ألصق النص المراد ترجمته.',
      textRequired: 'ألصق النص المراد ترجمته.',
      sourceLang: 'لغة المصدر',
      targetLang: 'لغة الهدف',
      submit: 'ترجمة',
      resultTitle: 'الترجمة',
      resultDescription: 'النص المترجَم مع تقييم المعادلة',
      equivalence: 'المعادلة القانونية',
      emptyHeading: 'لم تُنشأ ترجمة بعد',
      editableTitle: 'الترجمة القابلة للتحرير',
      batchTitle: 'الترجمات المجمّعة',
    },
    summarize: {
      cardTitle: 'تلخيص عقد',
      cardDescription: 'AID-06 ملخص تنفيذي وشروط رئيسية',
      textLabel: 'نص العقد',
      textPlaceholder: 'ألصق نص العقد المراد تلخيصه.',
      textRequired: 'ألصق نص العقد المراد تلخيصه.',
      contractType: 'نوع العقد',
      submit: 'تلخيص',
      resultTitle: 'ملخص العقد',
      resultDescription: 'الملخص التنفيذي والشروط الرئيسية والالتزامات والمخاطر',
      executiveSummary: 'الملخص التنفيذي',
      keyTerms: 'الشروط الرئيسية',
      obligations: 'الالتزامات',
      risks: 'المخاطر',
      renewalNotes: 'ملاحظات التجديد',
      emptyHeading: 'لم يُنشأ ملخص بعد',
      editableTitle: 'الملخص القابل للتحرير',
    },
    glossary: {
      cardTitle: 'إنشاء مسرد المصطلحات',
      cardDescription: 'AID-07 استخراج المصطلحات المعرّفة وفحص الاتساق',
      textLabel: 'نص العقد',
      textPlaceholder: 'ألصق نص العقد لاستخراج المصطلحات المعرّفة.',
      textRequired: 'ألصق نص العقد لبناء مسرد المصطلحات.',
      submit: 'إنشاء المسرد',
      resultTitle: 'مسرد المصطلحات',
      resultDescription: 'المصطلحات المعرّفة والتناقضات المكتشفة',
      terms: 'المصطلحات المعرّفة',
      inconsistencies: 'التناقضات',
      emptyHeading: 'لم يُنشأ مسرد بعد',
      actionTitle: 'مسرد مصطلحات العقد',
      editableTitle: 'مسرد المصطلحات القابل للتحرير',
    },
    rfp: {
      cardTitle: 'رد على طلب عروض',
      cardDescription: 'AID-09 صياغة رد على طلب العروض متطلبًا بمتطلب',
      requirements: 'المتطلبات',
      requirementsPlaceholder: 'ألصق متطلبات طلب العروض (متطلب في كل سطر مناسب).',
      requirementsRequired: 'أضف متطلبات طلب العروض لصياغة الرد.',
      companyProfile: 'الملف التعريفي للشركة',
      companyProfilePlaceholder: 'مزوّد سحابة سيادية، حاصل على آيزو 27001، مستضاف في السعودية.',
      submit: 'صياغة الرد على طلب العروض',
      resultTitle: 'الرد على طلب العروض',
      resultDescription: 'ردود لكل متطلب وملخص وفجوات',
      requirement: 'المتطلب',
      response: 'الرد',
      emptyHeading: 'لم يُنشأ رد على طلب العروض بعد',
      editableTitle: 'الرد على طلب العروض القابل للتحرير',
    },
    obligationQa: {
      cardTitle: 'مراجعة ضبط جودة الالتزامات',
      cardDescription: 'AID-10 مراجعة الالتزامات المستخرجة مقابل العقد',
      contractText: 'نص العقد',
      contractTextPlaceholder: 'ألصق نص العقد الذي استُخرجت منه الالتزامات.',
      contractTextRequired: 'ألصق نص العقد لتشغيل مراجعة ضبط الجودة.',
      obligations: 'الالتزامات المستخرجة (مصفوفة JSON)',
      obligationsRequired: 'قدّم الالتزامات المستخرجة كمصفوفة JSON.',
      obligationObjectError: (index: number) => `الالتزام ${index} يجب أن يكون كائن JSON.`,
      submit: 'تشغيل مراجعة الجودة',
      resultTitle: 'مراجعة الجودة',
      resultDescription: 'المشكلات المكتشفة ومستوى الثقة والالتزامات الناقصة',
      overallConfidence: 'الثقة الإجمالية',
      issues: 'المشكلات',
      suggestion: 'اقتراح',
      missingObligations: 'الالتزامات الناقصة',
      obligationIndex: 'الالتزام',
      emptyHeading: 'لم تُنشأ مراجعة جودة بعد',
    },
    assembly: {
      cardTitle: 'تجميع قالب',
      cardDescription: 'AID-08 منطق أقسام حتمي',
      loadSample: 'تحميل نموذج',
      sections: 'أقسام JSON',
      variables: 'متغيرات JSON',
      submit: 'تجميع القالب',
      resultTitle: 'الوثيقة المُجمَّعة',
      resultDescription: 'الأقسام المضمّنة والمتجاوَزة والمتغيرات غير المحلولة',
      included: 'مضمّنة',
      skipped: 'متجاوَزة',
      unresolved: 'غير محلولة',
      emptyHeading: 'لم تُجمَّع وثيقة بعد',
      actionTitle: 'العقد المُجمَّع',
      editableTitle: 'الوثيقة المُجمَّعة القابلة للتحرير',
      ready: 'جاهز',
      needsReview: 'تحتاج إلى مراجعة',
      unresolvedVariable: (item: string) => `متغير غير محلول: ${item}`,
      sectionsArrayError: 'يجب أن تكون الأقسام مصفوفة JSON.',
      variablesObjectError: 'يجب أن تكون المتغيرات كائن JSON.',
      sectionObjectError: (index: number) => `القسم ${index} يجب أن يكون كائن JSON.`,
      sectionFieldsError: (index: number) => `القسم ${index} يحتاج إلى عنوان ونص.`,
      invalidJson: 'قالب JSON غير صالح.',
    },
    options: {
      clauseTypes: {
        limitation_of_liability: 'تحديد المسؤولية',
        confidentiality: 'السرية',
        data_protection: 'حماية البيانات',
        termination: 'الإنهاء',
        payment_terms: 'شروط الدفع',
        dispute_resolution: 'تسوية المنازعات',
        governing_law: 'القانون الحاكم',
        other: 'أخرى',
      },
      contractTypes: {
        service_agreement: 'اتفاقية خدمات',
        nda: 'اتفاقية عدم إفصاح',
        vendor: 'مورّد',
        procurement: 'مشتريات',
        sla: 'اتفاقية مستوى الخدمة',
        mou: 'مذكرة تفاهم',
        other: 'أخرى',
      },
      languages: {
        en: 'الإنجليزية',
        ar: 'العربية',
        bilingual: 'ثنائية اللغة',
      },
    },
  },
};

export interface DraftingLabels {
  page: { title: string; description: string; eyebrow: string };
  tabs: {
    clause: string;
    contract: string;
    rewrite: string;
    fallbacks: string;
    translate: string;
    summarize: string;
    glossary: string;
    rfp: string;
    obligationQa: string;
    assembly: string;
  };
  common: {
    language: string;
    submit: string;
    loading: string;
    emptyHeading: string;
    rationale: string;
    notes: string;
    caveats: string;
    summary: string;
    gaps: string;
    none: string;
    generated: string;
  };
  errors: {
    unavailableTitle: string;
    unavailableHint: string;
    genericTitle: string;
    requiredTitle: string;
  };
  resultActions: {
    copy: string;
    insert: string;
    inserted: string;
    saveToLibrary: string;
    confidence: string;
    riskScore: string;
  };
  /** Feature 4 AI-draft human review (submit + status) control. */
  review: {
    submit: string;
    submitting: string;
    submitted: string;
    statusTitle: string;
    refresh: string;
    defaultTitle: string;
    status: {
      pending: string;
      approved: string;
      rejected: string;
      changes_requested: string;
      cancelled: string;
    };
  };
  workspace: {
    commandTitle: string;
    commandDescription: string;
    commandPlaceholder: string;
    commandSubmit: string;
    commandTargetLabel: string;
    historyTitle: string;
    historyDescription: string;
    historyEmpty: string;
    historyClear: string;
    historyOpenHint: string;
    historyCount: (count: number) => string;
  };
  /** Command-bar toolbar: search, task selector, run, and icon-button labels. */
  toolbar: {
    findPlaceholder: string;
    run: string;
    taskSelectorAria: string;
    taskPlaceholder: string;
    searchAria: string;
    chainTo: string;
    history: string;
    export: string;
    saveDraft: string;
    reset: string;
    clear: string;
  };
  /** Structured editors: deal-terms builder, template section editor, batch input. */
  structuredEditors: {
    customer: string;
    supplier: string;
    termMonths: string;
    annualValue: string;
    paymentTerms: string;
    governingLaw: string;
    renewal: string;
    sla: string;
    dataProcessing: string;
    sectionId: string;
    sectionHeading: string;
    sectionCondition: string;
    sectionBody: string;
    batchPlaceholder: string;
    templateSections: string;
    rowsToggle: string;
    jsonToggle: string;
    add: string;
    newSection: string;
    jsonPreview: string;
    original: string;
    generated: string;
    compare: string;
    fieldLabels: Record<string, string>;
  };
  /** Export / review-pack actions: reviewer fields and the printable HTML button. */
  exportActions: {
    reviewerPlaceholder: string;
    reviewerNameAria: string;
    rolePlaceholder: string;
    roleAria: string;
    reviewerOrTeamPlaceholder: string;
    reviewCommentPlaceholder: string;
    replacementTextPlaceholder: string;
    printOrSavePdf: string;
    noContent: string;
    exported: string;
  };
  /** Saved prompt templates panel. */
  promptTemplates: {
    taskFilterAria: string;
  };
  /** Inline editable result panel: editor chrome, review tools, compare, export toasts. */
  reviewEditor: {
    defaultTitle: string;
    defaultDescription: string;
    placeholder: string;
    sourceDraft: string;
    currentDraft: string;
    preview: string;
    edit: string;
    save: string;
    reset: string;
    draftTab: string;
    reviewTab: string;
    compareTab: string;
    openComments: string;
    openSuggestions: string;
    reviewers: string;
    reviewAssignments: string;
    noReviewersAssigned: string;
    add: string;
    addReviewItem: string;
    selectedPrefix: (text: string) => string;
    selectTextHint: string;
    assignee: string;
    comment: string;
    commentButton: string;
    suggestion: string;
    suggestButton: string;
    comments: string;
    suggestions: string;
    noComments: string;
    noSuggestions: string;
    unassigned: string;
    quotePrefix: (quote: string) => string;
    statusOpen: string;
    resolve: string;
    dismiss: string;
    textSuggestion: string;
    replaceSelectedText: string;
    insertSuggestedText: string;
    accept: string;
    reject: string;
    draftChanged: string;
    noDraftChanges: string;
    noTextToCompare: string;
    defaultResultTitle: string;
    toasts: {
      docxStarted: string;
      docxReady: string;
      pdfStarted: string;
      printOpened: string;
      printOpenedDetail: string;
      exportReady: string;
      exportFailed: string;
      exportFailedDetail: string;
      publishComplete: string;
      publishFailed: string;
      publishFailedDetail: string;
      draftSaved: string;
      saveFailed: string;
      saveFailedDetail: string;
      commentAdded: string;
      suggestionAdded: string;
    };
  };
  /** Batch job queue + batch processing helper UI. */
  batchQueue: {
    summary: (completed: number, total: number, failed: number) => string;
    retryFailed: string;
    export: string;
    exportCsv: string;
    clearBatchJobs: string;
    failureReason: string;
    removeItem: string;
    batchJobQueue: string;
    noBatchJobs: string;
    statusDone: string;
    statusFailed: string;
    statusRunning: string;
    statusQueued: string;
  };
  /** Drafting cockpit: workspace state, recipes, readiness, recent versions. */
  cockpit: {
    title: string;
    description: string;
    workspace: string;
    open: string;
    activeTask: string;
    versions: string;
    riskFlags: string;
    readiness: string;
    readyForReview: string;
    needsFirstRun: string;
    recipes: string;
    recentVersions: string;
    active: string;
    noVersions: string;
    runCount: (count: number) => string;
    nextAction: {
      generateFirst: string;
      reviewRiskGates: string;
      createFallbacks: string;
      summarizeDraft: string;
      compareEquivalence: string;
      publishOrChain: string;
    };
    recipeTitles: {
      clauseNegotiation: string;
      contractReview: string;
      rfpResponse: string;
    };
    recipePrompts: {
      clauseNegotiation: string;
      contractReview: string;
      rfpResponse: string;
    };
  };
  /** Workspace panels: editable result panel, prompt-template bar, save targets, cockpit. */
  panels: {
    markBaseline: string;
    preview: string;
    edit: string;
    draftText: string;
    previewMode: string;
    baseline: string;
    current: string;
    reviewer: string;
    reviewerPlaceholder: string;
    comment: string;
    commentPlaceholder: string;
    add: string;
    reviewerFallback: string;
    suggestedReplacement: string;
    suggestedReplacementPlaceholder: string;
    accept: string;
    reject: string;
    restoreBaseline: string;
    templateNamePlaceholder: string;
    saveTemplate: string;
    promptTemplateSaved: string;
    deleteTemplate: (name: string) => string;
    saveContract: string;
    saveDocument: string;
    saveMatter: string;
    draftSavedAsContract: string;
    draftSavedAsDocument: string;
    draftSavedAsMatter: string;
    copied: string;
    matched: string;
    qualityGates: string;
    ready: string;
    qualityMissing: (count: string) => string;
    qualityOk: string;
    qualityGate: string;
    resolveBeforePublishing: (items: string) => string;
    riskLevel: string;
    equivalence: string;
    openIssues: string;
    activeTask: string;
    riskFlags: string;
    removeItem: string;
    clearBatchJobs: string;
  };
  /** Risk dashboard metric blocks + section copy. */
  riskDashboard: {
    confidence: string;
    riskScore: string;
    title: string;
    description: string;
    emptyLabel: string;
    riskPosture: string;
    unspecified: string;
    issues: string;
    suggestion: string;
    residualRisks: string;
    notes: string;
  };
  clause: {
    cardTitle: string;
    cardDescription: string;
    intentLabel: string;
    intentPlaceholder: string;
    intentRequired: string;
    clauseType: string;
    contractType: string;
    contextLabel: string;
    contextPlaceholder: string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    assumptions: string;
    editableTitle: string;
    emptyHeading: string;
  };
  contract: {
    cardTitle: string;
    cardDescription: string;
    contractType: string;
    templateHint: string;
    templateHintPlaceholder: string;
    dealTerms: string;
    dealTermsRequired: string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    openItems: string;
    editableTitle: string;
    emptyHeading: string;
  };
  rewrite: {
    cardTitle: string;
    cardDescription: string;
    textLabel: string;
    textPlaceholder: string;
    textRequired: string;
    targetTone: string;
    targetTonePlaceholder: string;
    riskPosture: string;
    riskPosturePlaceholder: string;
    instructions: string;
    instructionsPlaceholder: string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    changes: string;
    riskShift: string;
    residualRisks: string;
    emptyHeading: string;
    redlineOriginal: string;
    redlineRevised: string;
    actionTitle: string;
    editableTitle: string;
    batchTitle: string;
  };
  fallbacks: {
    cardTitle: string;
    cardDescription: string;
    clauseText: string;
    clauseTextPlaceholder: string;
    clauseTextRequired: string;
    position: string;
    positionPlaceholder: string;
    count: string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    concessionLevel: string;
    whenToUse: string;
    emptyHeading: string;
    actionTitle: string;
    editableTitle: string;
    batchTitle: string;
  };
  translate: {
    cardTitle: string;
    cardDescription: string;
    textLabel: string;
    textPlaceholder: string;
    textRequired: string;
    sourceLang: string;
    targetLang: string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    equivalence: string;
    emptyHeading: string;
    editableTitle: string;
    batchTitle: string;
  };
  summarize: {
    cardTitle: string;
    cardDescription: string;
    textLabel: string;
    textPlaceholder: string;
    textRequired: string;
    contractType: string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    executiveSummary: string;
    keyTerms: string;
    obligations: string;
    risks: string;
    renewalNotes: string;
    emptyHeading: string;
    editableTitle: string;
  };
  glossary: {
    cardTitle: string;
    cardDescription: string;
    textLabel: string;
    textPlaceholder: string;
    textRequired: string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    terms: string;
    inconsistencies: string;
    emptyHeading: string;
    actionTitle: string;
    editableTitle: string;
  };
  rfp: {
    cardTitle: string;
    cardDescription: string;
    requirements: string;
    requirementsPlaceholder: string;
    requirementsRequired: string;
    companyProfile: string;
    companyProfilePlaceholder: string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    requirement: string;
    response: string;
    emptyHeading: string;
    editableTitle: string;
  };
  obligationQa: {
    cardTitle: string;
    cardDescription: string;
    contractText: string;
    contractTextPlaceholder: string;
    contractTextRequired: string;
    obligations: string;
    obligationsRequired: string;
    obligationObjectError: (index: number) => string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    overallConfidence: string;
    issues: string;
    suggestion: string;
    missingObligations: string;
    obligationIndex: string;
    emptyHeading: string;
  };
  assembly: {
    cardTitle: string;
    cardDescription: string;
    loadSample: string;
    sections: string;
    variables: string;
    submit: string;
    resultTitle: string;
    resultDescription: string;
    included: string;
    skipped: string;
    unresolved: string;
    emptyHeading: string;
    actionTitle: string;
    editableTitle: string;
    ready: string;
    needsReview: string;
    unresolvedVariable: (item: string) => string;
    sectionsArrayError: string;
    variablesObjectError: string;
    sectionObjectError: (index: number) => string;
    sectionFieldsError: (index: number) => string;
    invalidJson: string;
  };
  options: {
    clauseTypes: Record<string, string>;
    contractTypes: Record<string, string>;
    languages: Record<string, string>;
  };
}

export function resolveDraftingLabels(locale: AppLocale = 'en'): DraftingLabels {
  return resolveLexBilingual(draftingLabels, locale);
}

export function useDraftingLabels(): DraftingLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDraftingLabels(locale), [locale]);
}

/**
 * Stable option value lists (the wire tokens). Display labels are resolved
 * per-locale via {@link draftingOptions} from the bundle's `options` maps, so
 * the dropdown copy is bilingual while the submitted value stays a fixed token.
 */
export const CLAUSE_TYPE_VALUES = [
  'limitation_of_liability',
  'confidentiality',
  'data_protection',
  'termination',
  'payment_terms',
  'dispute_resolution',
  'governing_law',
  'other',
] as const;

export const CONTRACT_TYPE_VALUES = [
  'service_agreement',
  'nda',
  'vendor',
  'procurement',
  'sla',
  'mou',
  'other',
] as const;

export const LANGUAGE_VALUES = ['en', 'ar', 'bilingual'] as const;

export interface DraftingOption {
  label: string;
  value: string;
}

/**
 * Builds the localized `{label, value}[]` option lists for the clause-type,
 * contract-type, and language selects from the resolved drafting labels.
 */
export function draftingOptions(labels: DraftingLabels): {
  clauseTypes: DraftingOption[];
  contractTypes: DraftingOption[];
  languages: DraftingOption[];
} {
  return {
    clauseTypes: CLAUSE_TYPE_VALUES.map((value) => ({
      value,
      label: labels.options.clauseTypes[value] ?? value,
    })),
    contractTypes: CONTRACT_TYPE_VALUES.map((value) => ({
      value,
      label: labels.options.contractTypes[value] ?? value,
    })),
    languages: LANGUAGE_VALUES.map((value) => ({
      value,
      label: labels.options.languages[value] ?? value,
    })),
  };
}

export interface DraftingErrorState {
  title: string;
  message: string;
  unavailable: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function apiErrorCode(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.code === 'string') {
    return error.code;
  }
  if (isRecord(error) && isRecord(error.response) && isRecord(error.response.data)) {
    const { data } = error.response;
    if (typeof data.code === 'string') {
      return data.code;
    }
    if (isRecord(data.error) && typeof data.error.code === 'string') {
      return data.error.code;
    }
  }
  return undefined;
}

function apiErrorStatus(error: unknown): number | undefined {
  if (isRecord(error) && typeof error.status === 'number') {
    return error.status;
  }
  if (isRecord(error) && isRecord(error.response) && typeof error.response.status === 'number') {
    return error.response.status;
  }
  return undefined;
}

/**
 * Normalises any drafting op error into a panel-friendly shape, flagging the
 * "provider not configured / 503" case so the surface can degrade gracefully
 * rather than read as a hard failure. The resolved `errors` labels are passed in
 * so the title is locale-aware (callers read them from `useDraftingLabels()`).
 */
export function buildDraftingError(
  error: unknown,
  errors: DraftingLabels['errors'],
  genericTitle?: string,
): DraftingErrorState {
  const message = parseApiError(error);
  const code = apiErrorCode(error);
  const status = apiErrorStatus(error);
  const unavailable =
    code === 'DRAFTING_UNAVAILABLE' ||
    status === 503 ||
    /not enabled|unavailable|provider not configured/i.test(message);

  return {
    title: unavailable ? errors.unavailableTitle : genericTitle ?? errors.genericTitle,
    message,
    unavailable,
  };
}

export function requiredError(title: string, message: string): DraftingErrorState {
  return { title, message, unavailable: false };
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

/**
 * Pulls a numeric signal (e.g. `confidence`, `risk_score`) out of a drafting
 * op's `meta` bag, where the API stashes scores that the typed result shape
 * does not surface. Returns `undefined` when absent or non-numeric.
 */
export function numericMeta(meta: unknown, ...keys: string[]): number | undefined {
  if (!isRecord(meta)) {
    return undefined;
  }
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Shared result container handling the three required states (loading / error /
 * empty) for every drafting op, so each panel only renders its success body.
 */
export function DraftingResultShell({
  isLoading,
  error,
  isEmpty,
  emptyHeading,
  emptyIcon,
  loadingLabel,
  showAssemblyHint,
  children,
}: {
  isLoading: boolean;
  error: DraftingErrorState | null;
  isEmpty: boolean;
  emptyHeading: string;
  emptyIcon: ReactNode;
  loadingLabel?: string;
  showAssemblyHint?: boolean;
  children: ReactNode;
}) {
  const labels = useDraftingLabels();

  // Confirm a freshly generated result with a single success toast. Fires only
  // on the transition into the success state (not loading, no error, content
  // present) so re-renders and the empty/error states stay quiet.
  const succeeded = !isLoading && !error && !isEmpty;
  const announcedRef = useRef(false);
  useEffect(() => {
    if (succeeded && !announcedRef.current) {
      announcedRef.current = true;
      showSuccess(labels.common.generated);
    } else if (!succeeded) {
      announcedRef.current = false;
    }
  }, [succeeded, labels.common.generated]);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center"
      >
        <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">{loadingLabel ?? labels.common.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant={error.unavailable ? 'warning' : 'destructive'}>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{error.title}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{error.message}</p>
          {error.unavailable && showAssemblyHint ? (
            <p>{labels.errors.unavailableHint}</p>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
        <span className="mb-3 text-muted-foreground" aria-hidden="true">
          {emptyIcon}
        </span>
        <p className="text-sm font-medium">{emptyHeading}</p>
      </div>
    );
  }

  return <>{children}</>;
}

function draftReviewStatusVariant(
  status: string,
): 'default' | 'destructive' | 'warning' | 'success' | 'outline' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'destructive';
    case 'changes_requested':
      return 'warning';
    case 'cancelled':
      return 'outline';
    default:
      return 'default';
  }
}

/**
 * Feature 4 draft-review control: submits the generated draft as a first-class,
 * engine-tracked human task (`POST /drafting/{id}/submit-for-review`) and then
 * surfaces its live review status, refreshable via `GET /drafting/{id}/review`.
 * A stable draft UUID is minted at submit time so the status can be replayed
 * within the session.
 */
function DraftReviewControl({
  title,
  copyText,
  sourceTask,
  json,
}: {
  title: string;
  copyText: string;
  sourceTask?: DraftingTaskKey;
  json?: unknown;
}) {
  const t = useDraftingLabels().review;
  const [review, setReview] = useState<DraftReviewSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const statusLabel = (status: string): string =>
    t.status[status as keyof typeof t.status] ?? status;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const created = await submitDraftForReview({
        title: title.trim() || t.defaultTitle,
        draftKind: sourceTask ?? 'draft',
        content: { text: copyText, payload: json ?? null },
      });
      setReview(created);
      showSuccess(t.submitted);
    } catch (error) {
      showBackendError(error, t.submit);
    } finally {
      setSubmitting(false);
    }
  };

  const refresh = async () => {
    if (!review || refreshing) return;
    setRefreshing(true);
    try {
      setReview(await getDraftReview(review.draft_id));
    } catch (error) {
      showBackendError(error, t.statusTitle);
    } finally {
      setRefreshing(false);
    }
  };

  if (!review) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => void submit()} disabled={submitting}>
        {submitting ? (
          <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="me-1.5 h-4 w-4" aria-hidden="true" />
        )}
        {submitting ? t.submitting : t.submit}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-2 py-1">
      <span className="text-xs font-medium text-muted-foreground">{t.statusTitle}:</span>
      <Badge variant={draftReviewStatusVariant(review.review_status)}>{statusLabel(review.review_status)}</Badge>
      <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()} disabled={refreshing}>
        <RefreshCw className={`me-1.5 h-4 w-4${refreshing ? ' animate-spin' : ''}`} aria-hidden="true" />
        {t.refresh}
      </Button>
    </div>
  );
}

/**
 * Closed-loop action bar shown beneath a successful drafting result: copy the
 * generated text, an "insert into draft" affordance (clipboard-based, since the
 * drafting surface has no in-place editor), an optional "Save to Clause Library"
 * cross-launch, and any confidence / risk-score signals surfaced as badges.
 *
 * `prefill` (when provided) is written to sessionStorage and the user is routed
 * to the clause-library page, which opens a pre-filled create dialog on mount.
 */
export function DraftingResultActionBar({
  copyText,
  prefill,
  confidence,
  riskScore,
  showInsert = true,
  sourceTask,
  title = 'Drafting result',
  json,
}: {
  /** The primary generated text to copy / hand off. */
  copyText: string;
  /** When set, enables the "Save to Clause Library" cross-launch. */
  prefill?: ClausePrefill;
  /** 0..1 model confidence, surfaced as a percentage badge when present. */
  confidence?: number | null;
  /** 0..1 (or 0..100) risk score, surfaced as a badge when present. */
  riskScore?: number | null;
  /** Toggle the clipboard-based "Insert into draft" affordance. */
  showInsert?: boolean;
  /** Enables cross-task chaining buttons when provided. */
  sourceTask?: DraftingTaskKey;
  /** Export filename/title. */
  title?: string;
  /** Optional raw result payload for JSON export. */
  json?: unknown;
}) {
  const labels = useDraftingLabels();
  const t = labels.resultActions;
  const router = useRouter();

  const handleInsert = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(copyText);
    }
    showInfo(t.inserted);
  };

  const handleSaveToLibrary = () => {
    if (prefill) {
      writeClausePrefill(prefill);
    }
    router.push(CLAUSE_LIBRARY_PATH);
  };
  const fileBase = title.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'drafting-result';
  const chainTargets: Array<{ label: string; target: DraftingTaskKey }> = [
    { label: labels.tabs.translate, target: 'translate' },
    { label: labels.tabs.rewrite, target: 'rewrite' },
    { label: labels.tabs.summarize, target: 'summarize' },
    { label: labels.tabs.fallbacks, target: 'fallbacks' },
    { label: labels.tabs.obligationQa, target: 'obligationQa' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      <CopyButton value={copyText} label={t.copy} size="md" />
      {showInsert ? (
        <Button type="button" variant="outline" size="sm" onClick={handleInsert}>
          <ClipboardPaste className="me-1.5 h-4 w-4" aria-hidden="true" />
          {t.insert}
        </Button>
      ) : null}
      {prefill ? (
        <Button type="button" variant="outline" size="sm" onClick={handleSaveToLibrary}>
          <BookMarked className="me-1.5 h-4 w-4" aria-hidden="true" />
          {t.saveToLibrary}
        </Button>
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={() => downloadDraftingText(`${fileBase}.txt`, copyText)}>
        TXT
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => downloadDraftingText(`${fileBase}.md`, toMarkdown(title, copyText), 'text/markdown;charset=utf-8')}
      >
        MD
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => downloadDraftingText(`${fileBase}.json`, JSON.stringify(json ?? { title, text: copyText }, null, 2), 'application/json;charset=utf-8')}
      >
        JSON
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => downloadDraftingDocx(`${fileBase}.docx`, title, copyText)}>
        DOCX
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => printDraftingPdf(title, copyText)}>
        PDF
      </Button>
      {sourceTask
        ? chainTargets
            .filter((target) => target.target !== sourceTask)
            .slice(0, 3)
            .map((target) => (
              <Button
                key={target.target}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => writeDraftingHandoff({ target: target.target, text: copyText, title, sourceTask })}
              >
                {target.label}
              </Button>
            ))
        : null}
      <DraftReviewControl title={title} copyText={copyText} sourceTask={sourceTask} json={json} />
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {typeof confidence === 'number' && Number.isFinite(confidence) ? (
          <Badge variant="outline">
            {t.confidence}: {formatScore(confidence)}
          </Badge>
        ) : null}
        {typeof riskScore === 'number' && Number.isFinite(riskScore) ? (
          <Badge variant="outline">
            {t.riskScore}: {formatScore(riskScore)}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Renders a 0..1 or 0..100 numeric signal as a clean percentage. Values at or
 * below 1 are treated as fractions; anything larger is assumed to already be a
 * 0..100 figure.
 */
function formatScore(value: number): string {
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

export function riskBadgeVariant(
  riskLevel?: string,
): 'default' | 'destructive' | 'warning' | 'success' | 'outline' {
  const normalized = (riskLevel ?? '').toLowerCase();
  if (normalized === 'high' || normalized === 'critical') {
    return 'destructive';
  }
  if (normalized === 'medium') {
    return 'warning';
  }
  if (normalized === 'low' || normalized === 'none') {
    return 'success';
  }
  return 'outline';
}

export function severityBadgeVariant(
  severity?: string,
): 'default' | 'destructive' | 'warning' | 'success' | 'outline' {
  const normalized = (severity ?? '').toLowerCase();
  if (normalized === 'error' || normalized === 'critical') {
    return 'destructive';
  }
  if (normalized === 'warning') {
    return 'warning';
  }
  if (normalized === 'info') {
    return 'success';
  }
  return 'outline';
}

export function equivalenceBadgeVariant(
  equivalence?: string,
): 'default' | 'destructive' | 'warning' | 'success' | 'outline' {
  const normalized = (equivalence ?? '').toLowerCase();
  if (normalized === 'equivalent') {
    return 'success';
  }
  if (normalized === 'partial') {
    return 'warning';
  }
  if (normalized === 'divergent') {
    return 'destructive';
  }
  return 'outline';
}

export function languageLabel(value: string | undefined, labels: DraftingLabels): string | undefined {
  if (!value) {
    return undefined;
  }
  return labels.options.languages[value] ?? value;
}
