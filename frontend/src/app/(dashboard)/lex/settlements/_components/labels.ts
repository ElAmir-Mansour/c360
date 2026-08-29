/**
 * Feature-local bilingual label catalog for the Settlements / ADR surface
 * (CAP-089..093) and the embedded Case-Timeline panel (CAP-084..088).
 *
 * Follows the canonical lex bilingual contract (`../../_lib/lex-i18n.ts`): the
 * label group is a `LexBilingual<SettlementLabels>` bundle holding two FULL,
 * same-shaped copies — English in `en` and professional MSA in `ar`. Components
 * never receive the bundle; they read the resolved `SettlementLabels` from
 * {@link useSettlementLabels} (React) or {@link resolveSettlementLabels}
 * (non-React / tests, English default).
 *
 * Interpolation params and Western digits are preserved across both locales.
 * Legal glossary: قضية (matter) / تسوية (settlement) / صلح (reconciliation) /
 * وساطة (mediation) / تحكيم (arbitration) / تفاوض (negotiation) / جولة (round) /
 * اعتماد (approval) / حجز خارجي (external hold) / تأخير (delay).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import {
  DELAY_CATEGORY_VALUES,
  SETTLEMENT_METHOD_VALUES,
  SETTLEMENT_STATUS_VALUES,
  type DelayCategory,
  type ObligationType,
  type SettlementMethod,
  type SettlementStatus,
} from '@/lib/lex/settlements';

export const SETTLEMENT_STATUS_OPTIONS = SETTLEMENT_STATUS_VALUES;
export const SETTLEMENT_METHOD_OPTIONS = SETTLEMENT_METHOD_VALUES;
export const DELAY_CATEGORY_OPTIONS = DELAY_CATEGORY_VALUES;

export interface SettlementLabels {
  list: {
    title: string;
    description: string;
    newSettlement: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    columns: {
      title: string;
      reference: string;
      status: string;
      method: string;
      value: string;
      counterparty: string;
      updated: string;
      actions: string;
    };
    rowActions: {
      view: string;
      recordTerms: string;
      submit: string;
      close: string;
      delete: string;
    };
    notSet: string;
    noValue: string;
  };
  stats: {
    total: string;
    negotiating: string;
    pendingApproval: string;
    executed: string;
  };
  statDetails: {
    portfolioScope: string;
    matchingFilters: string;
    portfolioShare: string;
    activeNegotiation: string;
    negotiationShare: string;
    approvalQueue: string;
    approvalShare: string;
    executedTerms: string;
    executionShare: string;
  };
  filters: {
    status: string;
    method: string;
    statusOptions: Record<SettlementStatus, string>;
    methodOptions: Record<SettlementMethod, string>;
  };
  form: {
    createTitle: string;
    editTitle: string;
    createDescription: string;
    editDescription: string;
    matter: string;
    matterPlaceholder: string;
    matterHint: string;
    title: string;
    titlePlaceholder: string;
    reference: string;
    referencePlaceholder: string;
    method: string;
    terms: string;
    termsPlaceholder: string;
    value: string;
    valuePlaceholder: string;
    currency: string;
    currencyPlaceholder: string;
    counterpartyName: string;
    counterpartyNamePlaceholder: string;
    counterpartyContact: string;
    counterpartyContactPlaceholder: string;
    counterpartyIdNumber: string;
    counterpartyIdNumberPlaceholder: string;
    pii: string;
    cancel: string;
    create: string;
    save: string;
    errors: {
      matterRequired: string;
      titleRequired: string;
      termsRequired: string;
      valueInvalid: string;
    };
  };
  round: {
    title: string;
    description: string;
    addRound: string;
    proposedBy: string;
    proposedByPlaceholder: string;
    proposedValue: string;
    proposedValuePlaceholder: string;
    currency: string;
    currencyPlaceholder: string;
    terms: string;
    termsPlaceholder: string;
    outcome: string;
    outcomePlaceholder: string;
    cancel: string;
    submit: string;
    roundLabel: (n: number) => string;
    emptyTitle: string;
    emptyDescription: string;
    valueInvalid: string;
    termsRequired: string;
    proposedByRequired: string;
  };
  decision: {
    title: string;
    description: string;
    decision: string;
    approve: string;
    reject: string;
    notes: string;
    notesPlaceholder: string;
    cancel: string;
    submit: string;
    notReady: string;
    workflowMissing: string;
  };
  detail: {
    loadingTitle: string;
    fallbackDescription: string;
    errorMessage: string;
    edit: string;
    recordTerms: string;
    addRound: string;
    submit: string;
    decide: string;
    close: string;
    delete: string;
    metricStatus: string;
    metricMethod: string;
    metricValue: string;
    metricRounds: string;
    overviewTitle: string;
    overviewDescription: string;
    termsTitle: string;
    termsEmpty: string;
    counterpartyTitle: string;
    counterpartyDescription: string;
    roundsTitle: string;
    roundsDescription: string;
    auditTitle: string;
    auditDescription: string;
    auditEmptyTitle: string;
    auditEmptyDescription: string;
    auditError: string;
    metadata: {
      reference: string;
      matter: string;
      method: string;
      value: string;
      counterpartyName: string;
      counterpartyContact: string;
      counterpartyId: string;
      approvedBy: string;
      approvedAt: string;
      executedAt: string;
      created: string;
      updated: string;
    };
    viewMatter: string;
    notProvided: string;
  };
  toast: {
    created: string;
    updated: string;
    deleted: string;
    roundAdded: string;
    submitted: string;
    closed: string;
    decided: string;
  };
  confirm: {
    deleteTitle: string;
    deleteDescription: (title: string) => string;
    deleteConfirm: string;
    submitTitle: string;
    submitDescription: string;
    submitConfirm: string;
    closeTitle: string;
    closeDescription: string;
    closeConfirm: string;
  };
  audit: {
    actorLabel: string;
    transition: (from: string, to: string) => string;
  };
  timeline: {
    title: string;
    description: string;
    estimatedDuration: string;
    estimatedCompletion: string;
    openDelayDays: string;
    externalHold: string;
    onHold: string;
    notOnHold: string;
    notEstimated: string;
    days: (n: number) => string;
    setEstimate: string;
    clearEstimate: string;
    toggleHold: string;
    holdSince: string;
    holdCategory: string;
    holdReason: string;
    recordDelay: string;
    delayEventsTitle: string;
    delayEventsDescription: string;
    delayEmptyTitle: string;
    delayEmptyDescription: string;
    delayError: string;
    open: string;
    resolved: string;
    resolve: string;
    openedAt: string;
    resolvedAt: string;
    categoryOptions: Record<DelayCategory, string>;
    // --- feature #2: per-event duration ---------------------------------
    duration: {
      label: string;
      days: (n: number) => string;
      hours: (n: number) => string;
      /** Wraps a computed amount, e.g. ongoing("12 days") → "ongoing — 12 days". */
      ongoing: (amount: string) => string;
    };
    // --- feature: list filtering ----------------------------------------
    filter: {
      label: string;
      all: string;
      open: string;
      resolved: string;
      allCategories: string;
      categoryOptions: Record<DelayCategory, string>;
    };
    // --- feature: list sorting ------------------------------------------
    sort: {
      label: string;
      newestFirst: string;
      oldestFirst: string;
      opened: string;
      resolved: string;
      category: string;
      created: string;
    };
    // --- feature: search ------------------------------------------------
    search: {
      placeholder: string;
    };
    // --- feature: pagination --------------------------------------------
    pagination: {
      loadMore: string;
      showing: (n: number, total: number) => string;
      page: (n: number) => string;
    };
    // --- feature: bulk selection ----------------------------------------
    bulk: {
      select: string;
      resolveSelected: (n: number) => string;
      clearSelection: string;
    };
    // --- feature: attribution -------------------------------------------
    attribution: {
      recordedBy: string;
      resolvedBy: string;
    };
    // --- feature: edit / reopen -----------------------------------------
    editEvent: {
      edit: string;
      reopen: string;
      saveChanges: string;
      reopenTitle: string;
      reopenDescription: (reason: string) => string;
      reopenConfirm: string;
    };
    // --- feature #4: completion projection ------------------------------
    projection: {
      onTrack: string;
      atRisk: string;
      overdue: string;
      projectedCompletion: string;
      adjustedForDelay: (n: number) => string;
    };
    // --- feature #3: by-category breakdown ------------------------------
    breakdown: {
      title: string;
      noOpenDelays: string;
    };
    // --- feature #1: timeline track -------------------------------------
    track: {
      title: string;
      opened: string;
      estimatedCompletion: string;
      due: string;
      externalHold: string;
      today: string;
    };
    // --- features #10/#11: deadlines ------------------------------------
    deadlines: {
      add: string;
      upcomingTitle: string;
      empty: string;
      inDays: (n: number) => string;
      daysAgo: (n: number) => string;
      dueToday: string;
      dialogTitle: string;
      fieldTitle: string;
      fieldDate: string;
      fieldType: string;
      typeHearing: string;
      typeObjection: string;
      /**
       * Bilingual labels for the raw obligation-type token surfaced on each
       * deadline badge (`DeadlineObligation.type`, an `ObligationType`). Backend
       * currently stamps every case-timeline deadline as `notice`, but the badge
       * renders whatever type the row carries, so the full enum is covered.
       */
      typeOptions: Record<ObligationType, string>;
    };
    // --- feature #12: hold history --------------------------------------
    holdHistory: {
      title: string;
      placed: string;
      cleared: string;
      empty: string;
    };
    // --- feature #20: export --------------------------------------------
    exportMenu: {
      label: string;
      csv: string;
      print: string;
      /** CSV column headers + boolean tokens (sourced by buildTimelineCsv). */
      matterNumber: string;
      title: string;
      reason: string;
      yes: string;
      no: string;
    };
    // --- feature #15: cross-matter dashboard ----------------------------
    dashboard: {
      title: string;
      description: string;
      mattersOnHold: string;
      mattersWithOpenDelays: string;
      allMatters: string;
      viewTimeline: string;
    };
    // --- feature #19: realtime ------------------------------------------
    realtime: {
      updated: string;
      delayRecordedBy: (name: string) => string;
      delayResolvedBy: (name: string) => string;
    };
    estimateDialog: {
      title: string;
      description: string;
      durationDays: string;
      durationPlaceholder: string;
      completionDate: string;
      cancel: string;
      save: string;
      durationInvalid: string;
    };
    holdDialog: {
      title: string;
      description: string;
      held: string;
      heldOn: string;
      heldOff: string;
      category: string;
      reason: string;
      reasonPlaceholder: string;
      cancel: string;
      save: string;
      categoryRequired: string;
    };
    delayDialog: {
      title: string;
      description: string;
      category: string;
      reason: string;
      reasonPlaceholder: string;
      alsoHold: string;
      cancel: string;
      submit: string;
      reasonRequired: string;
    };
    resolveDialog: {
      title: string;
      description: (reason: string) => string;
      alsoClearHold: string;
      cancel: string;
      confirm: string;
    };
    toast: {
      estimateUpdated: string;
      holdUpdated: string;
      delayRecorded: string;
      delayResolved: string;
    };
  };
}

const bundle: LexBilingual<SettlementLabels> = {
  en: {
    list: {
      title: 'Settlements & ADR',
      description: 'Reconciliation and alternative-dispute-resolution attempts across legal matters.',
      newSettlement: 'New Settlement',
      searchPlaceholder: 'Search settlements...',
      emptyTitle: 'No settlements found',
      emptyDescription: 'No settlement or reconciliation attempts matched the current filters.',
      columns: {
        title: 'Settlement',
        reference: 'Reference',
        status: 'Status',
        method: 'Method',
        value: 'Value',
        counterparty: 'Counterparty',
        updated: 'Updated',
        actions: 'Actions',
      },
      rowActions: {
        view: 'View',
        recordTerms: 'Record terms',
        submit: 'Submit for approval',
        close: 'Close by reconciliation',
        delete: 'Delete',
      },
      notSet: 'Not set',
      noValue: 'No value',
    },
    stats: {
      total: 'Total',
      negotiating: 'Negotiating',
      pendingApproval: 'Pending approval',
      executed: 'Executed',
    },
    statDetails: {
      portfolioScope: 'Filtered settlement register across the current ADR portfolio.',
      matchingFilters: 'Matching filters',
      portfolioShare: 'Portfolio share',
      activeNegotiation: 'Negotiation rounds still in progress.',
      negotiationShare: 'Negotiation share',
      approvalQueue: 'Terms awaiting approval before execution.',
      approvalShare: 'Approval queue',
      executedTerms: 'Approved terms already executed.',
      executionShare: 'Execution share',
    },
    filters: {
      status: 'Status',
      method: 'Method',
      statusOptions: {
        proposed: 'Proposed',
        negotiating: 'Negotiating',
        pending_approval: 'Pending approval',
        approved: 'Approved',
        executed: 'Executed',
        rejected: 'Rejected',
        abandoned: 'Abandoned',
      },
      methodOptions: {
        reconciliation: 'Reconciliation',
        mediation: 'Mediation',
        arbitration: 'Arbitration',
        negotiation: 'Negotiation',
        other: 'Other',
      },
    },
    form: {
      createTitle: 'Open settlement',
      editTitle: 'Record settlement terms',
      createDescription: 'Open a reconciliation or ADR attempt on a legal matter.',
      editDescription: 'Update the negotiated settlement terms.',
      matter: 'Matter',
      matterPlaceholder: 'Select a matter',
      matterHint: 'Search by title or matter number.',
      title: 'Title',
      titlePlaceholder: 'Reconciliation with vendor X',
      reference: 'Reference',
      referencePlaceholder: 'Auto-generated if left blank',
      method: 'Method',
      terms: 'Terms',
      termsPlaceholder: 'Describe the proposed settlement terms...',
      value: 'Value',
      valuePlaceholder: '0.00',
      currency: 'Currency',
      currencyPlaceholder: 'SAR',
      counterpartyName: 'Counterparty name',
      counterpartyNamePlaceholder: 'Other party',
      counterpartyContact: 'Counterparty contact',
      counterpartyContactPlaceholder: 'Email or phone',
      counterpartyIdNumber: 'Counterparty ID',
      counterpartyIdNumberPlaceholder: 'CR / national ID',
      pii: 'Counterparty details are encrypted at rest.',
      cancel: 'Cancel',
      create: 'Open settlement',
      save: 'Save terms',
      errors: {
        matterRequired: 'A matter is required.',
        titleRequired: 'A settlement title is required.',
        termsRequired: 'Settlement terms are required.',
        valueInvalid: 'Value must be a non-negative number.',
      },
    },
    round: {
      title: 'Negotiation rounds',
      description: 'Recorded offers and counter-offers in the negotiation.',
      addRound: 'Add round',
      proposedBy: 'Proposed by',
      proposedByPlaceholder: 'Our side / counterparty',
      proposedValue: 'Proposed value',
      proposedValuePlaceholder: '0.00',
      currency: 'Currency',
      currencyPlaceholder: 'SAR',
      terms: 'Terms',
      termsPlaceholder: 'Describe this round of terms...',
      outcome: 'Outcome',
      outcomePlaceholder: 'e.g. countered, accepted in principle',
      cancel: 'Cancel',
      submit: 'Add round',
      roundLabel: (n) => `Round ${n}`,
      emptyTitle: 'No rounds recorded',
      emptyDescription: 'Add the first negotiation round to start the record.',
      valueInvalid: 'Value must be a non-negative number.',
      termsRequired: 'Round terms are required.',
      proposedByRequired: 'Proposing party is required.',
    },
    decision: {
      title: 'Approve settlement',
      description: 'Record an approval decision for the pending settlement.',
      decision: 'Decision',
      approve: 'Approve',
      reject: 'Reject',
      notes: 'Notes',
      notesPlaceholder: 'Optional decision rationale...',
      cancel: 'Cancel',
      submit: 'Submit decision',
      notReady: 'This settlement is not awaiting an approval decision.',
      workflowMissing: 'No approval workflow is attached to this settlement.',
    },
    detail: {
      loadingTitle: 'Settlement',
      fallbackDescription: 'Settlement / ADR detail.',
      errorMessage: 'Failed to load settlement details.',
      edit: 'Record terms',
      recordTerms: 'Record terms',
      addRound: 'Add round',
      submit: 'Submit for approval',
      decide: 'Approval decision',
      close: 'Close by reconciliation',
      delete: 'Delete',
      metricStatus: 'Status',
      metricMethod: 'Method',
      metricValue: 'Value',
      metricRounds: 'Rounds',
      overviewTitle: 'Settlement overview',
      overviewDescription: 'Core settlement state and approval context.',
      termsTitle: 'Settlement terms',
      termsEmpty: 'No terms recorded yet.',
      counterpartyTitle: 'Counterparty',
      counterpartyDescription: 'Encrypted at rest; visible to authorized users.',
      roundsTitle: 'Negotiation rounds',
      roundsDescription: 'Offers and counter-offers recorded for this settlement.',
      auditTitle: 'Governance audit',
      auditDescription: 'Append-only record of settlement state changes.',
      auditEmptyTitle: 'No audit entries',
      auditEmptyDescription: 'Audit entries appear as the settlement progresses.',
      auditError: 'Failed to load the audit trail.',
      metadata: {
        reference: 'Reference',
        matter: 'Matter',
        method: 'Method',
        value: 'Value',
        counterpartyName: 'Name',
        counterpartyContact: 'Contact',
        counterpartyId: 'Identifier',
        approvedBy: 'Approved by',
        approvedAt: 'Approved at',
        executedAt: 'Executed at',
        created: 'Created',
        updated: 'Updated',
      },
      viewMatter: 'View matter',
      notProvided: 'Not provided',
    },
    toast: {
      created: 'Settlement opened.',
      updated: 'Settlement terms saved.',
      deleted: 'Settlement deleted.',
      roundAdded: 'Negotiation round added.',
      submitted: 'Settlement submitted for approval.',
      closed: 'Matter closed by reconciliation.',
      decided: 'Approval decision recorded.',
    },
    confirm: {
      deleteTitle: 'Delete settlement',
      deleteDescription: (title) => `Delete "${title}"? This removes it from the register.`,
      deleteConfirm: 'Delete',
      submitTitle: 'Submit for approval',
      submitDescription: 'Submit this settlement to the approval chain? Terms become locked.',
      submitConfirm: 'Submit',
      closeTitle: 'Close by reconciliation',
      closeDescription: 'Execute this approved settlement and close the owning matter?',
      closeConfirm: 'Close matter',
    },
    audit: {
      actorLabel: 'Actor',
      transition: (from, to) => `${from} → ${to}`,
    },
    timeline: {
      title: 'Case timeline',
      description: 'Estimated duration, external holds, and classified delay events.',
      estimatedDuration: 'Estimated duration',
      estimatedCompletion: 'Estimated completion',
      openDelayDays: 'Open delay (days)',
      externalHold: 'External hold',
      onHold: 'On hold',
      notOnHold: 'Active',
      notEstimated: 'Not estimated',
      days: (n) => `${n} days`,
      setEstimate: 'Set estimate',
      clearEstimate: 'Clear estimate',
      toggleHold: 'External hold',
      holdSince: 'Since',
      holdCategory: 'Category',
      holdReason: 'Reason',
      recordDelay: 'Record delay',
      delayEventsTitle: 'Delay events',
      delayEventsDescription: 'Classified external-dependency windows on this matter.',
      delayEmptyTitle: 'No delay events',
      delayEmptyDescription: 'Record a delay event when the matter is blocked externally.',
      delayError: 'Failed to load delay events.',
      open: 'Open',
      resolved: 'Resolved',
      resolve: 'Resolve',
      openedAt: 'Opened',
      resolvedAt: 'Resolved',
      categoryOptions: {
        court: 'Court',
        government: 'Government',
        department: 'Department',
        expert: 'Expert',
      },
      duration: {
        label: 'Duration',
        days: (n) => `${n} days`,
        hours: (n) => `${n} hours`,
        ongoing: (amount) => `ongoing — ${amount}`,
      },
      filter: {
        label: 'Filter',
        all: 'All',
        open: 'Open',
        resolved: 'Resolved',
        allCategories: 'All categories',
        categoryOptions: {
          court: 'Court',
          government: 'Government',
          department: 'Department',
          expert: 'Expert',
        },
      },
      sort: {
        label: 'Sort by',
        newestFirst: 'Newest first',
        oldestFirst: 'Oldest first',
        opened: 'Opened',
        resolved: 'Resolved',
        category: 'Category',
        created: 'Created',
      },
      search: {
        placeholder: 'Search delay reasons…',
      },
      pagination: {
        loadMore: 'Load more',
        showing: (n, total) => `Showing ${n} of ${total}`,
        page: (n) => `Page ${n}`,
      },
      bulk: {
        select: 'Select',
        resolveSelected: (n) => `Resolve selected (${n})`,
        clearSelection: 'Clear selection',
      },
      attribution: {
        recordedBy: 'Recorded by',
        resolvedBy: 'Resolved by',
      },
      editEvent: {
        edit: 'Edit delay',
        reopen: 'Reopen',
        saveChanges: 'Save changes',
        reopenTitle: 'Reopen delay event',
        reopenDescription: (reason) => `Reopen the resolved delay window "${reason}"?`,
        reopenConfirm: 'Reopen',
      },
      projection: {
        onTrack: 'On track',
        atRisk: 'At risk',
        overdue: 'Overdue',
        projectedCompletion: 'Projected completion',
        adjustedForDelay: (n) => `Adjusted for ${n} delay days`,
      },
      breakdown: {
        title: 'Delay by category',
        noOpenDelays: 'No open delays',
      },
      track: {
        title: 'Timeline',
        opened: 'Opened',
        estimatedCompletion: 'Estimated completion',
        due: 'Due',
        externalHold: 'External hold',
        today: 'Today',
      },
      deadlines: {
        add: 'Add deadline',
        upcomingTitle: 'Upcoming deadlines',
        empty: 'No deadlines',
        inDays: (n) => `in ${n} days`,
        daysAgo: (n) => `${n} days ago`,
        dueToday: 'due today',
        dialogTitle: 'Add deadline',
        fieldTitle: 'Title',
        fieldDate: 'Date',
        fieldType: 'Type',
        typeHearing: 'Hearing',
        typeObjection: 'Objection',
        typeOptions: {
          contractual: 'Contractual',
          renewal: 'Renewal',
          notice: 'Notice',
          payment: 'Payment',
          delivery: 'Delivery',
          reporting: 'Reporting',
          compliance: 'Compliance',
          covenant: 'Covenant',
          condition_precedent: 'Condition precedent',
          regulatory: 'Regulatory',
          other: 'Other',
        },
      },
      holdHistory: {
        title: 'Hold history',
        placed: 'Placed on hold',
        cleared: 'Hold cleared',
        empty: 'No hold changes',
      },
      exportMenu: {
        label: 'Export',
        csv: 'Export CSV',
        print: 'Print',
        matterNumber: 'Matter number',
        title: 'Title',
        reason: 'Reason',
        yes: 'Yes',
        no: 'No',
      },
      dashboard: {
        title: 'Case timelines',
        description: 'Matters on hold and matters with open delay events across the practice.',
        mattersOnHold: 'Matters on hold',
        mattersWithOpenDelays: 'Matters with open delays',
        allMatters: 'All matters',
        viewTimeline: 'View timeline',
      },
      realtime: {
        updated: 'Timeline updated',
        delayRecordedBy: (name) => `${name} recorded a delay`,
        delayResolvedBy: (name) => `${name} resolved a delay`,
      },
      estimateDialog: {
        title: 'Set estimated duration',
        description: 'Project the expected duration or completion date for this matter.',
        durationDays: 'Duration (days)',
        durationPlaceholder: 'e.g. 90',
        completionDate: 'Estimated completion date',
        cancel: 'Cancel',
        save: 'Save estimate',
        durationInvalid: 'Duration must be a positive whole number.',
      },
      holdDialog: {
        title: 'External hold',
        description: 'Flag or clear the external-pending state of this matter.',
        held: 'Status',
        heldOn: 'Place on external hold',
        heldOff: 'Clear external hold',
        category: 'Delay category',
        reason: 'Reason',
        reasonPlaceholder: 'Why is the matter externally blocked?',
        cancel: 'Cancel',
        save: 'Save',
        categoryRequired: 'A delay category is required when placing on hold.',
      },
      delayDialog: {
        title: 'Record delay event',
        description: 'Open a classified delay window on this matter.',
        category: 'Delay category',
        reason: 'Reason',
        reasonPlaceholder: 'Describe the cause of the delay...',
        alsoHold: 'Also place the matter on external hold',
        cancel: 'Cancel',
        submit: 'Record delay',
        reasonRequired: 'A reason is required.',
      },
      resolveDialog: {
        title: 'Resolve delay event',
        description: (reason) => `Resolve the delay window "${reason}"?`,
        alsoClearHold: 'Also clear the external hold if no other delays remain',
        cancel: 'Cancel',
        confirm: 'Resolve',
      },
      toast: {
        estimateUpdated: 'Timeline estimate updated.',
        holdUpdated: 'External hold updated.',
        delayRecorded: 'Delay event recorded.',
        delayResolved: 'Delay event resolved.',
      },
    },
  },
  ar: {
    list: {
      title: 'التسويات وحل النزاعات',
      description: 'محاولات الصلح والحلول البديلة للنزاعات عبر القضايا القانونية.',
      newSettlement: 'تسوية جديدة',
      searchPlaceholder: 'البحث في التسويات...',
      emptyTitle: 'لا توجد تسويات',
      emptyDescription: 'لا توجد محاولات تسوية أو صلح مطابقة للمرشّحات الحالية.',
      columns: {
        title: 'التسوية',
        reference: 'المرجع',
        status: 'الحالة',
        method: 'الأسلوب',
        value: 'القيمة',
        counterparty: 'الطرف الآخر',
        updated: 'آخر تحديث',
        actions: 'الإجراءات',
      },
      rowActions: {
        view: 'عرض',
        recordTerms: 'تسجيل البنود',
        submit: 'إرسال للاعتماد',
        close: 'الإغلاق بالصلح',
        delete: 'حذف',
      },
      notSet: 'غير محدد',
      noValue: 'لا توجد قيمة',
    },
    stats: {
      total: 'الإجمالي',
      negotiating: 'قيد التفاوض',
      pendingApproval: 'بانتظار الاعتماد',
      executed: 'منفّذة',
    },
    statDetails: {
      portfolioScope: 'سجل التسويات المصفّى ضمن محفظة حل النزاع الحالية.',
      matchingFilters: 'مطابقة للمرشّحات',
      portfolioShare: 'حصة المحفظة',
      activeNegotiation: 'جولات تفاوض ما زالت قيد التنفيذ.',
      negotiationShare: 'حصة التفاوض',
      approvalQueue: 'بنود بانتظار الاعتماد قبل التنفيذ.',
      approvalShare: 'قائمة الاعتماد',
      executedTerms: 'بنود معتمدة تم تنفيذها.',
      executionShare: 'حصة التنفيذ',
    },
    filters: {
      status: 'الحالة',
      method: 'الأسلوب',
      statusOptions: {
        proposed: 'مقترحة',
        negotiating: 'قيد التفاوض',
        pending_approval: 'بانتظار الاعتماد',
        approved: 'معتمدة',
        executed: 'منفّذة',
        rejected: 'مرفوضة',
        abandoned: 'متروكة',
      },
      methodOptions: {
        reconciliation: 'صلح',
        mediation: 'وساطة',
        arbitration: 'تحكيم',
        negotiation: 'تفاوض',
        other: 'أخرى',
      },
    },
    form: {
      createTitle: 'فتح تسوية',
      editTitle: 'تسجيل بنود التسوية',
      createDescription: 'فتح محاولة صلح أو حل بديل للنزاع على قضية قانونية.',
      editDescription: 'تحديث بنود التسوية المتفاوض عليها.',
      matter: 'القضية',
      matterPlaceholder: 'اختر قضية',
      matterHint: 'ابحث بالعنوان أو رقم القضية.',
      title: 'العنوان',
      titlePlaceholder: 'الصلح مع المورّد س',
      reference: 'المرجع',
      referencePlaceholder: 'يُنشأ تلقائيًا إذا تُرك فارغًا',
      method: 'الأسلوب',
      terms: 'البنود',
      termsPlaceholder: 'اشرح بنود التسوية المقترحة...',
      value: 'القيمة',
      valuePlaceholder: '0.00',
      currency: 'العملة',
      currencyPlaceholder: '\u20C1',
      counterpartyName: 'اسم الطرف الآخر',
      counterpartyNamePlaceholder: 'الطرف المقابل',
      counterpartyContact: 'وسيلة تواصل الطرف الآخر',
      counterpartyContactPlaceholder: 'بريد إلكتروني أو هاتف',
      counterpartyIdNumber: 'هوية الطرف الآخر',
      counterpartyIdNumberPlaceholder: 'سجل تجاري / هوية وطنية',
      pii: 'تُشفَّر بيانات الطرف الآخر عند التخزين.',
      cancel: 'إلغاء',
      create: 'فتح التسوية',
      save: 'حفظ البنود',
      errors: {
        matterRequired: 'القضية مطلوبة.',
        titleRequired: 'عنوان التسوية مطلوب.',
        termsRequired: 'بنود التسوية مطلوبة.',
        valueInvalid: 'يجب أن تكون القيمة رقمًا غير سالب.',
      },
    },
    round: {
      title: 'جولات التفاوض',
      description: 'العروض والعروض المضادة المسجّلة في التفاوض.',
      addRound: 'إضافة جولة',
      proposedBy: 'مُقدِّم العرض',
      proposedByPlaceholder: 'طرفنا / الطرف الآخر',
      proposedValue: 'القيمة المقترحة',
      proposedValuePlaceholder: '0.00',
      currency: 'العملة',
      currencyPlaceholder: '\u20C1',
      terms: 'البنود',
      termsPlaceholder: 'اشرح بنود هذه الجولة...',
      outcome: 'النتيجة',
      outcomePlaceholder: 'مثال: عرض مضاد، قبول مبدئي',
      cancel: 'إلغاء',
      submit: 'إضافة الجولة',
      roundLabel: (n) => `الجولة ${n}`,
      emptyTitle: 'لا توجد جولات مسجّلة',
      emptyDescription: 'أضِف أول جولة تفاوض لبدء السجل.',
      valueInvalid: 'يجب أن تكون القيمة رقمًا غير سالب.',
      termsRequired: 'بنود الجولة مطلوبة.',
      proposedByRequired: 'الطرف مُقدِّم العرض مطلوب.',
    },
    decision: {
      title: 'اعتماد التسوية',
      description: 'سجّل قرار الاعتماد للتسوية المعلّقة.',
      decision: 'القرار',
      approve: 'اعتماد',
      reject: 'رفض',
      notes: 'ملاحظات',
      notesPlaceholder: 'مبرر القرار (اختياري)...',
      cancel: 'إلغاء',
      submit: 'إرسال القرار',
      notReady: 'هذه التسوية ليست بانتظار قرار اعتماد.',
      workflowMissing: 'لا يوجد سير اعتماد مرتبط بهذه التسوية.',
    },
    detail: {
      loadingTitle: 'التسوية',
      fallbackDescription: 'تفاصيل التسوية / حل النزاع.',
      errorMessage: 'تعذّر تحميل تفاصيل التسوية.',
      edit: 'تسجيل البنود',
      recordTerms: 'تسجيل البنود',
      addRound: 'إضافة جولة',
      submit: 'إرسال للاعتماد',
      decide: 'قرار الاعتماد',
      close: 'الإغلاق بالصلح',
      delete: 'حذف',
      metricStatus: 'الحالة',
      metricMethod: 'الأسلوب',
      metricValue: 'القيمة',
      metricRounds: 'الجولات',
      overviewTitle: 'نظرة عامة على التسوية',
      overviewDescription: 'الحالة الأساسية للتسوية وسياق الاعتماد.',
      termsTitle: 'بنود التسوية',
      termsEmpty: 'لم تُسجَّل بنود بعد.',
      counterpartyTitle: 'الطرف الآخر',
      counterpartyDescription: 'مشفّرة عند التخزين؛ متاحة للمستخدمين المخوَّلين.',
      roundsTitle: 'جولات التفاوض',
      roundsDescription: 'العروض والعروض المضادة المسجّلة لهذه التسوية.',
      auditTitle: 'سجل الحوكمة',
      auditDescription: 'سجل غير قابل للتعديل لتغيّرات حالة التسوية.',
      auditEmptyTitle: 'لا توجد قيود تدقيق',
      auditEmptyDescription: 'تظهر قيود التدقيق مع تقدّم التسوية.',
      auditError: 'تعذّر تحميل سجل التدقيق.',
      metadata: {
        reference: 'المرجع',
        matter: 'القضية',
        method: 'الأسلوب',
        value: 'القيمة',
        counterpartyName: 'الاسم',
        counterpartyContact: 'وسيلة التواصل',
        counterpartyId: 'المعرّف',
        approvedBy: 'اعتمدها',
        approvedAt: 'تاريخ الاعتماد',
        executedAt: 'تاريخ التنفيذ',
        created: 'تاريخ الإنشاء',
        updated: 'آخر تحديث',
      },
      viewMatter: 'عرض القضية',
      notProvided: 'غير متوفّر',
    },
    toast: {
      created: 'تم فتح التسوية.',
      updated: 'تم حفظ بنود التسوية.',
      deleted: 'تم حذف التسوية.',
      roundAdded: 'تمت إضافة جولة التفاوض.',
      submitted: 'تم إرسال التسوية للاعتماد.',
      closed: 'تم إغلاق القضية بالصلح.',
      decided: 'تم تسجيل قرار الاعتماد.',
    },
    confirm: {
      deleteTitle: 'حذف التسوية',
      deleteDescription: (title) => `حذف "${title}"؟ سيؤدي ذلك إلى إزالتها من السجل.`,
      deleteConfirm: 'حذف',
      submitTitle: 'إرسال للاعتماد',
      submitDescription: 'إرسال هذه التسوية إلى سلسلة الاعتماد؟ ستُقفَل البنود.',
      submitConfirm: 'إرسال',
      closeTitle: 'الإغلاق بالصلح',
      closeDescription: 'تنفيذ هذه التسوية المعتمدة وإغلاق القضية المالكة؟',
      closeConfirm: 'إغلاق القضية',
    },
    audit: {
      actorLabel: 'المنفِّذ',
      transition: (from, to) => `${from} ← ${to}`,
    },
    timeline: {
      title: 'الجدول الزمني للقضية',
      description: 'المدة المقدّرة وحالات الحجز الخارجي وأحداث التأخير المصنّفة.',
      estimatedDuration: 'المدة المقدّرة',
      estimatedCompletion: 'الإنجاز المتوقّع',
      openDelayDays: 'أيام التأخير المفتوحة',
      externalHold: 'الحجز الخارجي',
      onHold: 'محجوزة',
      notOnHold: 'نشطة',
      notEstimated: 'غير مقدّرة',
      days: (n) => `${n} يومًا`,
      setEstimate: 'تحديد التقدير',
      clearEstimate: 'مسح التقدير',
      toggleHold: 'الحجز الخارجي',
      holdSince: 'منذ',
      holdCategory: 'الفئة',
      holdReason: 'السبب',
      recordDelay: 'تسجيل تأخير',
      delayEventsTitle: 'أحداث التأخير',
      delayEventsDescription: 'نوافذ الاعتماد الخارجي المصنّفة على هذه القضية.',
      delayEmptyTitle: 'لا توجد أحداث تأخير',
      delayEmptyDescription: 'سجّل حدث تأخير عند تعطّل القضية لأسباب خارجية.',
      delayError: 'تعذّر تحميل أحداث التأخير.',
      open: 'مفتوح',
      resolved: 'مُعالَج',
      resolve: 'إنهاء',
      openedAt: 'فُتح في',
      resolvedAt: 'عولج في',
      categoryOptions: {
        court: 'المحكمة',
        government: 'جهة حكومية',
        department: 'إدارة داخلية',
        expert: 'خبير',
      },
      duration: {
        label: 'المدة',
        days: (n) => `${n} يومًا`,
        hours: (n) => `${n} ساعة`,
        ongoing: (amount) => `مستمر — ${amount}`,
      },
      filter: {
        label: 'تصفية',
        all: 'الكل',
        open: 'مفتوح',
        resolved: 'مُعالَج',
        allCategories: 'كل الفئات',
        categoryOptions: {
          court: 'المحكمة',
          government: 'جهة حكومية',
          department: 'إدارة داخلية',
          expert: 'خبير',
        },
      },
      sort: {
        label: 'الترتيب حسب',
        newestFirst: 'الأحدث أولًا',
        oldestFirst: 'الأقدم أولًا',
        opened: 'تاريخ الفتح',
        resolved: 'تاريخ المعالجة',
        category: 'الفئة',
        created: 'تاريخ الإنشاء',
      },
      search: {
        placeholder: 'البحث في أسباب التأخير…',
      },
      pagination: {
        loadMore: 'تحميل المزيد',
        showing: (n, total) => `عرض ${n} من ${total}`,
        page: (n) => `صفحة ${n}`,
      },
      bulk: {
        select: 'تحديد',
        resolveSelected: (n) => `إنهاء المحدد (${n})`,
        clearSelection: 'إلغاء التحديد',
      },
      attribution: {
        recordedBy: 'سجّله',
        resolvedBy: 'أنهاه',
      },
      editEvent: {
        edit: 'تعديل التأخير',
        reopen: 'إعادة فتح',
        saveChanges: 'حفظ التغييرات',
        reopenTitle: 'إعادة فتح حدث التأخير',
        reopenDescription: (reason) => `إعادة فتح نافذة التأخير المُعالَجة "${reason}"؟`,
        reopenConfirm: 'إعادة فتح',
      },
      projection: {
        onTrack: 'ضمن المسار',
        atRisk: 'معرّضة للخطر',
        overdue: 'متأخّرة',
        projectedCompletion: 'الإنجاز المتوقّع',
        adjustedForDelay: (n) => `معدّل لـ ${n} يوم تأخير`,
      },
      breakdown: {
        title: 'التأخير حسب الفئة',
        noOpenDelays: 'لا توجد تأخيرات مفتوحة',
      },
      track: {
        title: 'الجدول الزمني',
        opened: 'فُتح',
        estimatedCompletion: 'الإنجاز المتوقّع',
        due: 'الاستحقاق',
        externalHold: 'الحجز الخارجي',
        today: 'اليوم',
      },
      deadlines: {
        add: 'إضافة موعد نهائي',
        upcomingTitle: 'المواعيد النهائية القادمة',
        empty: 'لا توجد مواعيد نهائية',
        inDays: (n) => `خلال ${n} يوم`,
        daysAgo: (n) => `قبل ${n} يوم`,
        dueToday: 'يستحق اليوم',
        dialogTitle: 'إضافة موعد نهائي',
        fieldTitle: 'العنوان',
        fieldDate: 'التاريخ',
        fieldType: 'النوع',
        typeHearing: 'جلسة',
        typeObjection: 'اعتراض',
        typeOptions: {
          contractual: 'تعاقدي',
          renewal: 'تجديد',
          notice: 'إشعار',
          payment: 'دفع',
          delivery: 'تسليم',
          reporting: 'تقارير',
          compliance: 'امتثال',
          covenant: 'تعهّد',
          condition_precedent: 'شرط مسبق',
          regulatory: 'تنظيمي',
          other: 'أخرى',
        },
      },
      holdHistory: {
        title: 'سجل الحجز',
        placed: 'تم الوضع على حجز',
        cleared: 'تم إلغاء الحجز',
        empty: 'لا توجد تغييرات على الحجز',
      },
      exportMenu: {
        label: 'تصدير',
        csv: 'تصدير CSV',
        print: 'طباعة',
        matterNumber: 'رقم القضية',
        title: 'العنوان',
        reason: 'السبب',
        yes: 'نعم',
        no: 'لا',
      },
      dashboard: {
        title: 'الجداول الزمنية للقضايا',
        description: 'القضايا المحجوزة والقضايا ذات أحداث التأخير المفتوحة عبر المكتب.',
        mattersOnHold: 'قضايا محجوزة',
        mattersWithOpenDelays: 'قضايا بتأخيرات مفتوحة',
        allMatters: 'كل القضايا',
        viewTimeline: 'عرض الجدول الزمني',
      },
      realtime: {
        updated: 'تم تحديث الجدول الزمني',
        delayRecordedBy: (name) => `سجّل ${name} تأخيرًا`,
        delayResolvedBy: (name) => `أنهى ${name} تأخيرًا`,
      },
      estimateDialog: {
        title: 'تحديد المدة المقدّرة',
        description: 'قدّر المدة المتوقّعة أو تاريخ الإنجاز لهذه القضية.',
        durationDays: 'المدة (أيام)',
        durationPlaceholder: 'مثال: 90',
        completionDate: 'تاريخ الإنجاز المتوقّع',
        cancel: 'إلغاء',
        save: 'حفظ التقدير',
        durationInvalid: 'يجب أن تكون المدة رقمًا صحيحًا موجبًا.',
      },
      holdDialog: {
        title: 'الحجز الخارجي',
        description: 'تفعيل أو إلغاء حالة الانتظار الخارجي لهذه القضية.',
        held: 'الحالة',
        heldOn: 'وضع على حجز خارجي',
        heldOff: 'إلغاء الحجز الخارجي',
        category: 'فئة التأخير',
        reason: 'السبب',
        reasonPlaceholder: 'لماذا تعطّلت القضية خارجيًا؟',
        cancel: 'إلغاء',
        save: 'حفظ',
        categoryRequired: 'فئة التأخير مطلوبة عند الوضع على حجز.',
      },
      delayDialog: {
        title: 'تسجيل حدث تأخير',
        description: 'افتح نافذة تأخير مصنّفة على هذه القضية.',
        category: 'فئة التأخير',
        reason: 'السبب',
        reasonPlaceholder: 'اشرح سبب التأخير...',
        alsoHold: 'وضع القضية أيضًا على حجز خارجي',
        cancel: 'إلغاء',
        submit: 'تسجيل التأخير',
        reasonRequired: 'السبب مطلوب.',
      },
      resolveDialog: {
        title: 'إنهاء حدث التأخير',
        description: (reason) => `إنهاء نافذة التأخير "${reason}"؟`,
        alsoClearHold: 'إلغاء الحجز الخارجي أيضًا إذا لم تتبقَّ تأخيرات أخرى',
        cancel: 'إلغاء',
        confirm: 'إنهاء',
      },
      toast: {
        estimateUpdated: 'تم تحديث تقدير الجدول الزمني.',
        holdUpdated: 'تم تحديث الحجز الخارجي.',
        delayRecorded: 'تم تسجيل حدث التأخير.',
        delayResolved: 'تم إنهاء حدث التأخير.',
      },
    },
  },
};

export function resolveSettlementLabels(locale: AppLocale = 'en'): SettlementLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useSettlementLabels(): SettlementLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSettlementLabels(locale), [locale]);
}

export function settlementStatusLabel(labels: SettlementLabels, status: string): string {
  return labels.filters.statusOptions[status as SettlementStatus] ?? status.replace(/_/g, ' ');
}

export function settlementMethodLabel(labels: SettlementLabels, method: string): string {
  return labels.filters.methodOptions[method as SettlementMethod] ?? method.replace(/_/g, ' ');
}

export function delayCategoryLabel(labels: SettlementLabels, category: string): string {
  return labels.timeline.categoryOptions[category as DelayCategory] ?? category.replace(/_/g, ' ');
}

/**
 * Resolve a raw deadline obligation-type token (`DeadlineObligation.type`) to its
 * bilingual label. Prettify (`replace(/_/g, ' ')`) stays only as a last-resort for
 * tokens outside the known {@link ObligationType} enum.
 */
export function deadlineTypeLabel(labels: SettlementLabels, type: string): string {
  return labels.timeline.deadlines.typeOptions[type as ObligationType] ?? type.replace(/_/g, ' ');
}
