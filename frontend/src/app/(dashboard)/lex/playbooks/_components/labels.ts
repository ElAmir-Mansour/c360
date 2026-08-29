'use client';

/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the Watheeq
 * clause-playbooks surface (page + catalog + deviation review + dialog).
 *
 * Follows the canonical lex i18n contract (see `../../_lib/lex-i18n.ts`): a
 * single {@link LexBilingual} bundle with two full, same-shaped copies and a
 * thin `usePlaybookLabels()` hook that resolves against the active locale. The
 * `en` side equals the pre-existing English strings exactly so existing
 * English-asserting tests stay green; the `ar` side is professional MSA for the
 * enterprise legal/contract domain.
 *
 * Function-valued fields (e.g. `clauseCount(total, required)`) appear on BOTH
 * sides and preserve interpolation params + Western digits.
 *
 * Glossary anchors: دليل إرشادي (playbook) / بند (clause) / عقد (contract) /
 * انحراف (deviation) / امتثال (compliance) / مخاطر (risk).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface PlaybookLabels {
  page: {
    title: string;
    description: string;
    createPlaybook: string;
  };
  metrics: {
    playbooks: string;
    active: string;
    standardClauses: string;
    requiredClauses: string;
  };
  // Premium KPI strip — portfolio-aware headline metrics for the catalog.
  kpis: {
    playbooks: string;
    active: string;
    standardClauses: string;
    requiredClauses: string;
    avgCompliance: string;
    needsReview: string;
    needsReviewHint: string;
  };
  catalog: {
    title: string;
    description: string;
    columns: {
      playbook: string;
      scope: string;
      clauses: string;
      updated: string;
      actions: string;
    };
    emptyTitle: string;
    emptyDescription: string;
    loadError: string;
    clauseCount: (total: number, required: number) => string;
    editAction: (name: string) => string;
    deleteAction: (name: string) => string;
    // Feature #1 — catalog filters / sort / pagination.
    search: string;
    filterContractType: string;
    filterStatus: string;
    allTypes: string;
    allStatuses: string;
    sortBy: string;
    newest: string;
    oldest: string;
    name: string;
    showing: (n: number, total: number) => string;
    loadMore: string;
    page: (n: number) => string;
    // Feature #10 — needs-review badge + portfolio shortcut.
    needsReview: (n: number) => string;
    viewPortfolio: string;
    // Premium polish — rich empty CTA on the catalog.
    emptyCta: string;
  };
  // Feature #2 — cross-playbook compliance portfolio dashboard.
  portfolio: {
    title: string;
    description: string;
    minScore: string;
    maxScore: string;
    contract: string;
    playbook: string;
    score: string;
    missing: string;
    altered: string;
    extra: string;
    viewReview: string;
    empty: string;
    belowThreshold: (n: number) => string;
    // Premium polish — KPI strip + rich empty CTA + KSA generated stamp.
    scored: string;
    avgScore: string;
    atRisk: string;
    healthy: string;
    emptyTitle: string;
    emptyCta: string;
    generatedDual: (value: string) => string;
  };
  deviations: {
    title: string;
    description: string;
    contractLabel: string;
    contractPlaceholder: string;
    runButton: string;
    contractsLoadError: string;
    noContracts: string;
    deviationLoadError: string;
    emptyTitle: string;
    emptyDescription: string;
    matched: string;
    review: string;
    complianceScore: string;
    standardClauses: string;
    missing: string;
    altered: string;
    extra: string;
    threshold: string;
    generatedAt: string;
    openContract: string;
    noDeviationsTitle: string;
    noDeviationsDescription: string;
    table: {
      clause: string;
      kind: string;
      severity: string;
      similarity: string;
      riskWeight: string;
      reference: string;
    };
    expectedExcerpt: string;
    actualExcerpt: string;
    requiredTag: string;
    showRedline: string;
    collapseRedline: string;
    // Feature #3 — deviation triage / review status.
    reviewStatus: string;
    statusOpen: string;
    statusAccepted: string;
    statusRejected: string;
    statusNeedsFix: string;
    addNote: string;
    hideResolved: string;
    markReviewed: string;
    reviewedBy: (name: string) => string;
    // Feature #4 — deviation filters.
    filterKind: string;
    kindMissing: string;
    kindAltered: string;
    kindExtra: string;
    filterSeverity: string;
    /** Raw deviation-severity token -> localized label (filter chips). */
    severityLabels: Record<string, string>;
    requiredOnly: string;
    clearFilters: string;
    all: string;
    // Feature #5 — deep-link into clause / contract.
    jumpToClause: string;
    openInContract: string;
    // Feature #6 — export.
    export: string;
    exportCsv: string;
    print: string;
  };
  dialog: {
    createTitle: string;
    editTitle: string;
    description: string;
    nameLabel: string;
    namePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    contractTypeLabel: string;
    statusLabel: string;
    clausesTitle: string;
    clausesDescription: string;
    addClause: string;
    removeClause: string;
    clauseTypeLabel: string;
    clauseTitleLabel: string;
    clauseTitlePlaceholder: string;
    standardTextLabel: string;
    standardTextPlaceholder: string;
    requiredLabel: string;
    riskWeightLabel: string;
    similarityThresholdLabel: string;
    cancel: string;
    submitCreate: string;
    submitEdit: string;
    validationTitle: string;
    errors: {
      nameRequired: string;
      clauseRequired: string;
      clauseTitleRequired: (index: number) => string;
      clauseTextRequired: (index: number) => string;
      thresholdRange: (index: number) => string;
      riskWeightRange: (index: number) => string;
    };
    // Feature #7 — create from template.
    newFromTemplate: string;
    // Feature #8 — dry-run a draft against a real contract.
    testAgainstContract: string;
    selectContract: string;
    runTest: string;
    testScore: string;
    testing: string;
    testHint: string;
    // Feature #9 — submit a draft for approval before activation.
    submitForApproval: string;
    approvalPending: string;
    approvalRequired: string;
    approve: string;
    reject: string;
    approvalTasks: string;
  };
  // Feature #7 — template picker.
  templates: {
    pickerTitle: string;
    pickerDescription: string;
    use: string;
    empty: string;
    clauses: (n: number) => string;
  };
  toast: {
    created: string;
    updated: string;
    deleted: string;
    // Feature #9 — approval toasts.
    approvalStarted: string;
    approvalDecided: string;
    // Feature #3 — triage toast.
    reviewSaved: string;
  };
  confirmDelete: {
    title: string;
    description: (name: string) => string;
    confirmLabel: string;
  };
  anyType: string;
  /** Raw backend `contract_type` token -> localized label. */
  contractTypeLabels: Record<string, string>;
  /** Raw backend `clause_type` token -> localized label. */
  clauseTypeLabels: Record<string, string>;
  /** Raw backend playbook `status` token -> localized label. */
  statusLabels: Record<string, string>;
}

export const playbookLabels: LexBilingual<PlaybookLabels> = {
  en: {
    page: {
      title: 'Clause Playbooks',
      description:
        'Watheeq preferred and fallback clause standards used to score contract clause deviations.',
      createPlaybook: 'Create Playbook',
    },
    metrics: {
      playbooks: 'Playbooks',
      active: 'Active',
      standardClauses: 'Standard Clauses',
      requiredClauses: 'Required Clauses',
    },
    kpis: {
      playbooks: 'Playbooks',
      active: 'Active',
      standardClauses: 'Standard clauses',
      requiredClauses: 'Required clauses',
      avgCompliance: 'Avg compliance',
      needsReview: 'Need review',
      needsReviewHint: 'Contracts below 80%',
    },
    catalog: {
      title: 'Playbook Catalog',
      description:
        'Tenant playbooks defining the standard clause set, risk weights, and similarity thresholds per contract type.',
      columns: {
        playbook: 'Playbook',
        scope: 'Contract type',
        clauses: 'Clauses',
        updated: 'Updated',
        actions: 'Actions',
      },
      emptyTitle: 'No playbooks configured',
      emptyDescription:
        'Create a playbook to define the standard clause set Watheeq compares each contract against.',
      loadError: 'Failed to load clause playbooks.',
      clauseCount: (total, required) => `${total} standard (${required} required)`,
      editAction: (name) => `Edit ${name}`,
      deleteAction: (name) => `Delete ${name}`,
      search: 'Search playbooks…',
      filterContractType: 'Contract type',
      filterStatus: 'Status',
      allTypes: 'All types',
      allStatuses: 'All statuses',
      sortBy: 'Sort by',
      newest: 'Newest',
      oldest: 'Oldest',
      name: 'Name',
      showing: (n, total) => `Showing ${n} of ${total}`,
      loadMore: 'Load more',
      page: (n) => `Page ${n}`,
      needsReview: (n) => `${n} need review`,
      viewPortfolio: 'Portfolio',
      emptyCta: 'Create your first playbook',
    },
    portfolio: {
      title: 'Compliance portfolio',
      description:
        'Compliance scores for every contract scored against its playbook, so you can spot the worst-performing agreements first.',
      minScore: 'Min score',
      maxScore: 'Max score',
      contract: 'Contract',
      playbook: 'Playbook',
      score: 'Score',
      missing: 'Missing',
      altered: 'Altered',
      extra: 'Extra',
      viewReview: 'Review',
      empty: 'No contracts have been scored against a playbook yet.',
      belowThreshold: (n) => `Below ${n}%`,
      scored: 'Scored contracts',
      avgScore: 'Avg compliance',
      atRisk: 'At risk',
      healthy: 'Healthy',
      emptyTitle: 'Nothing scored yet',
      emptyCta: 'Manage playbooks',
      generatedDual: (value) => `Generated ${value}`,
    },
    deviations: {
      title: 'Clause Deviation Review',
      description:
        'Select a contract to compare its clauses against the matched playbook and surface missing, altered, or extra clauses.',
      contractLabel: 'Contract',
      contractPlaceholder: 'Select contract',
      runButton: 'Run Deviation Check',
      contractsLoadError: 'Failed to load contracts for deviation review.',
      noContracts: 'No contracts are available for deviation review.',
      deviationLoadError: 'Failed to load clause deviations for this contract.',
      emptyTitle: 'No deviation report yet',
      emptyDescription:
        'Choose a contract and run the deviation check to compare it against its playbook.',
      matched: 'Matched',
      review: 'Review',
      complianceScore: 'Compliance score',
      standardClauses: 'Standard clauses',
      missing: 'Missing',
      altered: 'Altered',
      extra: 'Extra',
      threshold: 'Similarity threshold',
      generatedAt: 'Generated',
      openContract: 'Open contract',
      noDeviationsTitle: 'No deviations detected',
      noDeviationsDescription:
        'Every standard clause in the playbook is present and within the similarity threshold.',
      table: {
        clause: 'Clause',
        kind: 'Deviation',
        severity: 'Severity',
        similarity: 'Similarity',
        riskWeight: 'Risk weight',
        reference: 'Section',
      },
      expectedExcerpt: 'Expected standard',
      actualExcerpt: 'Contract text',
      requiredTag: 'Required',
      showRedline: 'Compare clause text',
      collapseRedline: 'Collapse comparison',
      reviewStatus: 'Review status',
      statusOpen: 'Open',
      statusAccepted: 'Accepted',
      statusRejected: 'Rejected',
      statusNeedsFix: 'Needs fix',
      addNote: 'Note',
      hideResolved: 'Hide resolved',
      markReviewed: 'Mark reviewed',
      reviewedBy: (name) => `Reviewed by ${name}`,
      filterKind: 'Deviation type',
      kindMissing: 'Missing',
      kindAltered: 'Altered',
      kindExtra: 'Extra',
      filterSeverity: 'Severity',
      severityLabels: {
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        critical: 'Critical',
      },
      requiredOnly: 'Required only',
      clearFilters: 'Clear filters',
      all: 'All',
      jumpToClause: 'Jump to clause',
      openInContract: 'Open in contract',
      export: 'Export',
      exportCsv: 'Export CSV',
      print: 'Print',
    },
    dialog: {
      createTitle: 'Create Clause Playbook',
      editTitle: 'Edit Clause Playbook',
      description:
        'Define the standard clause set, risk weights, and similarity thresholds Watheeq uses to score contracts.',
      nameLabel: 'Playbook name',
      namePlaceholder: 'Vendor master agreement standard',
      descriptionLabel: 'Description',
      descriptionPlaceholder: 'Standard clause expectations for vendor master agreements.',
      contractTypeLabel: 'Contract type',
      statusLabel: 'Status',
      clausesTitle: 'Standard clauses',
      clausesDescription:
        'At least one standard clause is required. Each clause is matched against contract text by similarity.',
      addClause: 'Add clause',
      removeClause: 'Remove clause',
      clauseTypeLabel: 'Clause type',
      clauseTitleLabel: 'Clause title',
      clauseTitlePlaceholder: 'Limitation of liability',
      standardTextLabel: 'Standard text',
      standardTextPlaceholder:
        'Each party’s aggregate liability shall not exceed the fees paid in the prior twelve months.',
      requiredLabel: 'Required',
      riskWeightLabel: 'Risk weight',
      similarityThresholdLabel: 'Similarity threshold',
      cancel: 'Cancel',
      submitCreate: 'Create playbook',
      submitEdit: 'Save changes',
      validationTitle: 'Resolve playbook validation issues',
      errors: {
        nameRequired: 'Enter a playbook name.',
        clauseRequired: 'Add at least one standard clause with a title.',
        clauseTitleRequired: (index) => `Clause ${index + 1} needs a title.`,
        clauseTextRequired: (index) => `Clause ${index + 1} needs standard text.`,
        thresholdRange: (index) => `Clause ${index + 1} similarity threshold must be between 0 and 1.`,
        riskWeightRange: (index) => `Clause ${index + 1} risk weight must be 0 or greater.`,
      },
      newFromTemplate: 'New from template',
      testAgainstContract: 'Test against a contract',
      selectContract: 'Select a contract',
      runTest: 'Run test',
      testScore: 'Would-be compliance',
      testing: 'Testing…',
      testHint:
        'Run this draft against a real contract to preview the compliance score and deviations before saving.',
      submitForApproval: 'Submit for approval',
      approvalPending: 'Approval pending',
      approvalRequired: 'A draft must be approved before it can go active.',
      approve: 'Approve',
      reject: 'Reject',
      approvalTasks: 'Approval',
    },
    templates: {
      pickerTitle: 'Choose a template',
      pickerDescription:
        'Start from a curated standard clause set for a common contract type, then tailor it to your tenant.',
      use: 'Use template',
      empty: 'No templates are available.',
      clauses: (n) => `${n} clauses`,
    },
    toast: {
      created: 'Playbook created.',
      updated: 'Playbook updated.',
      deleted: 'Playbook deleted.',
      approvalStarted: 'Submitted for approval.',
      approvalDecided: 'Approval decision recorded.',
      reviewSaved: 'Review status saved.',
    },
    confirmDelete: {
      title: 'Delete clause playbook',
      description: (name) =>
        `Delete ${name}? Contracts will no longer be scored against this playbook. This cannot be undone.`,
      confirmLabel: 'Delete',
    },
    anyType: 'Any type',
    contractTypeLabels: {
      service_agreement: 'Service Agreement',
      nda: 'NDA',
      employment: 'Employment',
      vendor: 'Vendor',
      license: 'License',
      lease: 'Lease',
      partnership: 'Partnership',
      consulting: 'Consulting',
      procurement: 'Procurement',
      sla: 'SLA',
      mou: 'MOU',
      amendment: 'Amendment',
      renewal: 'Renewal',
      other: 'Other',
    },
    clauseTypeLabels: {
      indemnification: 'Indemnification',
      termination: 'Termination',
      limitation_of_liability: 'Limitation of Liability',
      confidentiality: 'Confidentiality',
      ip_ownership: 'IP Ownership',
      non_compete: 'Non-Compete',
      payment_terms: 'Payment Terms',
      warranty: 'Warranty',
      force_majeure: 'Force Majeure',
      dispute_resolution: 'Dispute Resolution',
      data_protection: 'Data Protection',
      governing_law: 'Governing Law',
      assignment: 'Assignment',
      insurance: 'Insurance',
      audit_rights: 'Audit Rights',
      sla: 'SLA',
      auto_renewal: 'Auto-Renewal',
      representations: 'Representations',
      non_solicitation: 'Non-Solicitation',
      other: 'Other',
    },
    statusLabels: {
      active: 'Active',
      draft: 'Draft',
      archived: 'Archived',
    },
  },
  ar: {
    page: {
      title: 'أدلة البنود الإرشادية',
      description:
        'معايير البنود المفضّلة والبديلة في وثيق المستخدمة لتقييم انحرافات بنود العقود.',
      createPlaybook: 'إنشاء دليل إرشادي',
    },
    metrics: {
      playbooks: 'الأدلة الإرشادية',
      active: 'سارية',
      standardClauses: 'البنود القياسية',
      requiredClauses: 'البنود المطلوبة',
    },
    kpis: {
      playbooks: 'الأدلة الإرشادية',
      active: 'سارية',
      standardClauses: 'البنود القياسية',
      requiredClauses: 'البنود المطلوبة',
      avgCompliance: 'متوسط الامتثال',
      needsReview: 'بحاجة لمراجعة',
      needsReviewHint: 'عقود أقل من 80%',
    },
    catalog: {
      title: 'فهرس الأدلة الإرشادية',
      description:
        'أدلة المستأجر الإرشادية التي تحدّد مجموعة البنود القياسية وأوزان المخاطر وعتبات التشابه لكل نوع عقد.',
      columns: {
        playbook: 'الدليل الإرشادي',
        scope: 'نوع العقد',
        clauses: 'البنود',
        updated: 'آخر تحديث',
        actions: 'إجراءات',
      },
      emptyTitle: 'لا توجد أدلة إرشادية مُهيّأة',
      emptyDescription:
        'أنشئ دليلًا إرشاديًا لتحديد مجموعة البنود القياسية التي يقارن بها وثيق كل عقد.',
      loadError: 'تعذّر تحميل أدلة البنود الإرشادية.',
      clauseCount: (total, required) => `${total} قياسي (${required} مطلوب)`,
      editAction: (name) => `تعديل ${name}`,
      deleteAction: (name) => `حذف ${name}`,
      search: 'البحث في الأدلة الإرشادية…',
      filterContractType: 'نوع العقد',
      filterStatus: 'الحالة',
      allTypes: 'جميع الأنواع',
      allStatuses: 'جميع الحالات',
      sortBy: 'الترتيب حسب',
      newest: 'الأحدث',
      oldest: 'الأقدم',
      name: 'الاسم',
      showing: (n, total) => `عرض ${n} من ${total}`,
      loadMore: 'تحميل المزيد',
      page: (n) => `صفحة ${n}`,
      needsReview: (n) => `${n} بحاجة إلى مراجعة`,
      viewPortfolio: 'المحفظة',
      emptyCta: 'أنشئ أول دليل إرشادي',
    },
    portfolio: {
      title: 'محفظة الامتثال',
      description:
        'درجات الامتثال لكل عقد جرى تقييمه بدليله الإرشادي، لتتمكّن من رصد العقود الأضعف أداءً أولًا.',
      minScore: 'الحد الأدنى للدرجة',
      maxScore: 'الحد الأعلى للدرجة',
      contract: 'العقد',
      playbook: 'الدليل الإرشادي',
      score: 'الدرجة',
      missing: 'ناقص',
      altered: 'مُعدّل',
      extra: 'زائد',
      viewReview: 'مراجعة',
      empty: 'لم يُقيَّم أي عقد بدليل إرشادي بعد.',
      belowThreshold: (n) => `أقل من ${n}%`,
      scored: 'العقود المُقيَّمة',
      avgScore: 'متوسط الامتثال',
      atRisk: 'معرّضة للخطر',
      healthy: 'سليمة',
      emptyTitle: 'لا يوجد تقييم بعد',
      emptyCta: 'إدارة الأدلة الإرشادية',
      generatedDual: (value) => `أُنشئ ${value}`,
    },
    deviations: {
      title: 'مراجعة انحراف البنود',
      description:
        'اختر عقدًا لمقارنة بنوده بالدليل الإرشادي المطابق وإظهار البنود الناقصة أو المُعدّلة أو الزائدة.',
      contractLabel: 'العقد',
      contractPlaceholder: 'اختر عقدًا',
      runButton: 'تشغيل فحص الانحراف',
      contractsLoadError: 'تعذّر تحميل العقود لمراجعة الانحراف.',
      noContracts: 'لا توجد عقود متاحة لمراجعة الانحراف.',
      deviationLoadError: 'تعذّر تحميل انحرافات البنود لهذا العقد.',
      emptyTitle: 'لا يوجد تقرير انحراف بعد',
      emptyDescription: 'اختر عقدًا وشغّل فحص الانحراف لمقارنته بدليله الإرشادي.',
      matched: 'مطابق',
      review: 'مراجعة',
      complianceScore: 'درجة الامتثال',
      standardClauses: 'البنود القياسية',
      missing: 'ناقص',
      altered: 'مُعدّل',
      extra: 'زائد',
      threshold: 'عتبة التشابه',
      generatedAt: 'أُنشئ في',
      openContract: 'فتح العقد',
      noDeviationsTitle: 'لم تُكتشف انحرافات',
      noDeviationsDescription: 'كل بند قياسي في الدليل الإرشادي موجود وضمن عتبة التشابه.',
      table: {
        clause: 'البند',
        kind: 'الانحراف',
        severity: 'الخطورة',
        similarity: 'التشابه',
        riskWeight: 'وزن المخاطر',
        reference: 'القسم',
      },
      expectedExcerpt: 'المعيار المتوقع',
      actualExcerpt: 'نص العقد',
      requiredTag: 'مطلوب',
      showRedline: 'مقارنة نص البند',
      collapseRedline: 'طيّ المقارنة',
      reviewStatus: 'حالة المراجعة',
      statusOpen: 'مفتوح',
      statusAccepted: 'مقبول',
      statusRejected: 'مرفوض',
      statusNeedsFix: 'بحاجة إلى إصلاح',
      addNote: 'ملاحظة',
      hideResolved: 'إخفاء المُعالَجة',
      markReviewed: 'وضع علامة مُراجَع',
      reviewedBy: (name) => `راجعها ${name}`,
      filterKind: 'نوع الانحراف',
      kindMissing: 'ناقص',
      kindAltered: 'مُعدّل',
      kindExtra: 'زائد',
      filterSeverity: 'الخطورة',
      severityLabels: {
        low: 'منخفضة',
        medium: 'متوسطة',
        high: 'عالية',
        critical: 'حرجة',
      },
      requiredOnly: 'المطلوبة فقط',
      clearFilters: 'مسح عوامل التصفية',
      all: 'الكل',
      jumpToClause: 'الانتقال إلى البند',
      openInContract: 'فتح في العقد',
      export: 'تصدير',
      exportCsv: 'تصدير CSV',
      print: 'طباعة',
    },
    dialog: {
      createTitle: 'إنشاء دليل بنود إرشادي',
      editTitle: 'تعديل دليل البنود الإرشادي',
      description:
        'حدّد مجموعة البنود القياسية وأوزان المخاطر وعتبات التشابه التي يستخدمها وثيق لتقييم العقود.',
      nameLabel: 'اسم الدليل الإرشادي',
      namePlaceholder: 'معيار اتفاقية المورّد الرئيسية',
      descriptionLabel: 'الوصف',
      descriptionPlaceholder: 'توقعات البنود القياسية لاتفاقيات المورّد الرئيسية.',
      contractTypeLabel: 'نوع العقد',
      statusLabel: 'الحالة',
      clausesTitle: 'البنود القياسية',
      clausesDescription:
        'يُشترط وجود بند قياسي واحد على الأقل. يُطابَق كل بند مع نص العقد حسب التشابه.',
      addClause: 'إضافة بند',
      removeClause: 'إزالة البند',
      clauseTypeLabel: 'نوع البند',
      clauseTitleLabel: 'عنوان البند',
      clauseTitlePlaceholder: 'تحديد المسؤولية',
      standardTextLabel: 'النص القياسي',
      standardTextPlaceholder:
        'لا تتجاوز المسؤولية الإجمالية لأي طرف الرسوم المدفوعة خلال الاثني عشر شهرًا السابقة.',
      requiredLabel: 'مطلوب',
      riskWeightLabel: 'وزن المخاطر',
      similarityThresholdLabel: 'عتبة التشابه',
      cancel: 'إلغاء',
      submitCreate: 'إنشاء الدليل الإرشادي',
      submitEdit: 'حفظ التغييرات',
      validationTitle: 'عالج مشكلات التحقق من الدليل الإرشادي',
      errors: {
        nameRequired: 'أدخل اسم الدليل الإرشادي.',
        clauseRequired: 'أضف بندًا قياسيًا واحدًا على الأقل بعنوان.',
        clauseTitleRequired: (index) => `البند ${index + 1} يحتاج إلى عنوان.`,
        clauseTextRequired: (index) => `البند ${index + 1} يحتاج إلى نص قياسي.`,
        thresholdRange: (index) => `عتبة تشابه البند ${index + 1} يجب أن تكون بين 0 و1.`,
        riskWeightRange: (index) => `وزن مخاطر البند ${index + 1} يجب أن يكون 0 أو أكبر.`,
      },
      newFromTemplate: 'جديد من قالب',
      testAgainstContract: 'اختبار على عقد',
      selectContract: 'اختر عقدًا',
      runTest: 'تشغيل الاختبار',
      testScore: 'الامتثال المتوقع',
      testing: 'جارٍ الاختبار…',
      testHint:
        'شغّل هذه المسودة على عقد حقيقي لمعاينة درجة الامتثال والانحرافات قبل الحفظ.',
      submitForApproval: 'إرسال للموافقة',
      approvalPending: 'بانتظار الموافقة',
      approvalRequired: 'يجب اعتماد المسودة قبل أن تصبح سارية.',
      approve: 'موافقة',
      reject: 'رفض',
      approvalTasks: 'الموافقة',
    },
    templates: {
      pickerTitle: 'اختر قالبًا',
      pickerDescription:
        'ابدأ من مجموعة بنود قياسية مُعدّة لنوع عقد شائع، ثم خصّصها لمستأجرك.',
      use: 'استخدام القالب',
      empty: 'لا توجد قوالب متاحة.',
      clauses: (n) => `${n} بنود`,
    },
    toast: {
      created: 'تم إنشاء الدليل الإرشادي.',
      updated: 'تم تحديث الدليل الإرشادي.',
      deleted: 'تم حذف الدليل الإرشادي.',
      approvalStarted: 'تم الإرسال للموافقة.',
      approvalDecided: 'تم تسجيل قرار الموافقة.',
      reviewSaved: 'تم حفظ حالة المراجعة.',
    },
    confirmDelete: {
      title: 'حذف دليل البنود الإرشادي',
      description: (name) =>
        `حذف ${name}؟ لن تُقيَّم العقود بهذا الدليل الإرشادي بعد الآن. لا يمكن التراجع عن ذلك.`,
      confirmLabel: 'حذف',
    },
    anyType: 'أي نوع',
    contractTypeLabels: {
      service_agreement: 'اتفاقية خدمات',
      nda: 'اتفاقية سرية',
      employment: 'توظيف',
      vendor: 'مورّد',
      license: 'ترخيص',
      lease: 'إيجار',
      partnership: 'شراكة',
      consulting: 'استشارات',
      procurement: 'مشتريات',
      sla: 'SLA — اتفاقية مستوى الخدمة',
      mou: 'مذكرة تفاهم',
      amendment: 'تعديل',
      renewal: 'تجديد',
      other: 'أخرى',
    },
    clauseTypeLabels: {
      indemnification: 'التعويض',
      termination: 'الإنهاء',
      limitation_of_liability: 'تحديد المسؤولية',
      confidentiality: 'السرية',
      ip_ownership: 'ملكية الملكية الفكرية',
      non_compete: 'عدم المنافسة',
      payment_terms: 'شروط الدفع',
      warranty: 'الضمان',
      force_majeure: 'القوة القاهرة',
      dispute_resolution: 'تسوية النزاعات',
      data_protection: 'حماية البيانات',
      governing_law: 'القانون الحاكم',
      assignment: 'التنازل',
      insurance: 'التأمين',
      audit_rights: 'حقوق التدقيق',
      sla: 'اتفاقية مستوى الخدمة',
      auto_renewal: 'التجديد التلقائي',
      representations: 'الإقرارات والتعهدات',
      non_solicitation: 'عدم الاستقطاب',
      other: 'أخرى',
    },
    statusLabels: {
      active: 'نشط',
      draft: 'مسودة',
      archived: 'مؤرشف',
    },
  },
};

export function resolvePlaybookLabels(locale: AppLocale = 'en'): PlaybookLabels {
  return resolveLexBilingual(playbookLabels, locale);
}

export function usePlaybookLabels(): PlaybookLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolvePlaybookLabels(locale), [locale]);
}
