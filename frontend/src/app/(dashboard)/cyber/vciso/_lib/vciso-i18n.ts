/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber *Virtual CISO* (vCISO) area (`/cyber/vciso/**`).
 *
 * Mirrors the shared `cyber-i18n.ts` `{ en, ar }` bundle pattern. Components read
 * the resolved `T` from `useVcisoLabels()`; the `en` side equals the pre-existing
 * English strings exactly. Acronyms / product names stay as-is: vCISO, CISO,
 * LLM, KPI, KRI, MFA, SoD, IAM, ATT&CK, MITRE, DSPM, SOC, OpenAI, Anthropic,
 * Azure, Jira, ServiceNow, AI.
 *
 * Scope: this bundle covers the vCISO console chrome (briefing, hybrid chat,
 * LLM ops, capability-catalog structure) and the page-level headers + KPI
 * labels of each governance sub-page. The 50 long per-capability marketing
 * descriptions in the capability catalog remain English prose (out of the
 * UI-chrome scope).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { registerMessages } from '@/lib/i18n/registry';
import {
  resolveCyberBilingual,
  type CyberBilingual,
} from '../../_lib/cyber-i18n';

// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).

export interface VcisoLabels {
  // ---- main console page ----
  console: {
    title: string;
    description: string;
    refresh: string;
    generating: string;
    exportReport: string;
    reportStartedToast: string;
    loadError: string;
    executiveBriefing: string;
    postureAtAGlance: string;
    riskScore: string;
    grade: string;
    generated: string;
    criticalIssues: string;
    recommendations: string;
    complianceStatus: string;
  };
  // ---- chat panel ----
  chat: {
    vciso: string;
    live: string;
    reconnecting: string;
    fallback: string;
    autoRoute: string;
    llmForced: string;
    deterministicForced: string;
    assistantTagline: string;
    emptyTitle: string;
    emptyHint: string;
    connectedPrefix: string;
    thinking: string;
    conversationActive: (id: string) => string;
    newConversation: string;
    routerDecides: string;
    llmOverride: string;
    deterministicOverride: string;
    confirmActionTitle: string;
    confirmActionDefault: string;
    proceed: string;
  };
  // ---- conversation list ----
  conversations: {
    newChat: string;
    history: string;
    historyTitle: string;
    historyDescription: string;
    empty: string;
    messageCount: (n: number) => string;
  };
  // ---- message input ----
  input: {
    placeholder: string;
    engineRouting: string;
    autoRouting: string;
    forceLlm: string;
    forceDeterministic: string;
    send: string;
  };
  // ---- risk posture summary ----
  posture: {
    riskScore: string;
    vsLastPeriod: string;
    riskComponents: string;
  };
  // ---- critical issues cards ----
  issues: {
    noneTitle: string;
    impact: string;
    recommendation: string;
    viewDetails: string;
  };
  // ---- recommendations list ----
  recs: {
    none: string;
    effortSuffix: (effort: string) => string;
    ptsSuffix: (pts: number) => string;
    actions: string;
    expectedImpact: string;
  };
  // ---- threat landscape ----
  threat: {
    title: string;
    activeThreats: string;
    topTactic: string;
    topTechnique: string;
    recentIndicators: string;
    threatsByType: string;
  };
  // ---- compliance status ----
  compliance: {
    none: string;
    compliant: string;
    partial: string;
    nonCompliant: string;
    coverage: string;
    controlsPassed: (passed: number, total: number) => string;
  };
  // ---- LLM ops panel ----
  llmOps: {
    title: string;
    subtitle: string;
    auditBadge: string;
    providerHealth: string;
    loading: string;
    unavailable: string;
    healthPending: string;
    latency: string;
    rateLimitRemaining: (n: string) => string;
    noTelemetry: string;
    usageToday: string;
    usageTodayDetail: (calls: string, cost: string) => string;
    usagePending: string;
    usageThisMonth: string;
    usageThisMonthDetail: (calls: string) => string;
    monthlyUnavailable: string;
    adminGate: string;
    providerConfigTitle: string;
    providerConfigDescription: string;
    provider: string;
    selectProvider: string;
    model: string;
    temperature: string;
    currentHealthCheck: (detail: string) => string;
    waitingTelemetry: string;
    saveOverride: string;
    promptVersionsTitle: string;
    promptVersionsDescription: string;
    loadingPrompts: string;
    noPrompts: string;
    active: string;
    noDescription: string;
    createdByOn: (by: string, on: string) => string;
    activate: string;
    createPromptTitle: string;
    createPromptDescription: string;
    version: string;
    description: string;
    promptText: string;
    createPromptVersion: string;
    settingsUpdatedToast: string;
    promptCreatedToast: string;
    promptActivatedToast: string;
    configValidationError: string;
    promptValidationError: string;
  };
  // ---- capability catalog (structural labels only) ----
  catalog: {
    capabilitiesMapped: (n: number) => string;
    briefingAssistantModules: string;
    coverageTitle: string;
    coverageBody: string;
    featuresSuffix: (n: number) => string;
    featureLabel: (id: number) => string;
    howItShowsUp: string;
    footerNote: string;
    categories: {
      executiveCommand: { title: string; summary: string };
      riskGovernance: { title: string; summary: string };
      controlsAssurance: { title: string; summary: string };
      securityOperations: { title: string; summary: string };
      dataIdentityAi: { title: string; summary: string };
    };
  };
  // ---- shared UI verbs / column headers reused across governance sub-pages ----
  common: {
    viewDetails: string;
    edit: string;
    delete: string;
    approve: string;
    reject: string;
    cancel: string;
    close: string;
    save: string;
    saving: string;
    create: string;
    update: string;
    submit: string;
    status: string;
    created: string;
    updated: string;
    owner: string;
    name: string;
    title: string;
    description: string;
    category: string;
    priority: string;
    severity: string;
    actions: string;
    notes: string;
    notesOptional: string;
    optional: string;
    active: string;
    inactive: string;
    none: string;
    all: string;
    yes: string;
    no: string;
    high: string;
    medium: string;
    low: string;
    critical: string;
    loadError: string;
    required: string;
  };
  // ---- governance sub-pages: headers + KPI labels ----
  pages: {
    evidence: {
      title: string;
      description: string;
      totalEvidence: string;
      needsAttention: string;
      frameworksCovered: string;
      controlsWithEvidence: string;
    };
    riskRegister: {
      title: string;
      description: string;
      totalRisks: string;
      totalRisksDesc: string;
      avgResidualScore: string;
      avgResidualDesc: string;
      overdueReviews: string;
      overdueDesc: string;
      acceptedRisks: string;
      acceptedDesc: string;
      closeRisk: string;
      revokeAcceptance: string;
    };
    awareness: {
      title: string;
      description: string;
      privilegedAccounts: string;
      privilegedDesc: string;
      orphanedAccounts: string;
      orphanedDesc: string;
      staleAccess: string;
      staleDesc: string;
    };
    workflows: {
      title: string;
      description: string;
      pendingApprovals: string;
      pendingDesc: string;
      overdue: string;
      overdueDesc: string;
      approvedThisMonth: string;
      approvedDesc: string;
      rejectedThisMonth: string;
      rejectedDesc: string;
      markReviewed: string;
    };
    compliance: {
      title: string;
      description: string;
    };
    incidentReadiness: {
      title: string;
      description: string;
      escalationRules: string;
      totalTriggers: string;
      totalTriggersDesc: string;
      testedPlaybooks: string;
    };
    integrations: {
      title: string;
      description: string;
      totalIntegrations: string;
      connected: string;
      errors: string;
      totalItemsSynced: string;
    };
    maturity: {
      title: string;
      description: string;
      totalProposed: string;
      totalProposedDesc: string;
      totalApproved: string;
      totalApprovedDesc: string;
    };
    policies: {
      title: string;
      description: string;
      totalPolicies: string;
      published: string;
      inReview: string;
      overdueReviews: string;
      activeExceptions: string;
      tabs: { policies: string; exceptions: string; aiDraft: string };
      createPolicy: string;
      requestException: string;
      columns: {
        title: string;
        domain: string;
        version: string;
        status: string;
        owner: string;
        reviewDue: string;
        exceptions: string;
        updated: string;
      };
      exceptionColumns: {
        title: string;
        policy: string;
        status: string;
        requestedBy: string;
        compensatingControls: string;
        expiresAt: string;
        created: string;
      };
      filters: { status: string; domain: string };
      statusOptions: {
        draft: string;
        review: string;
        approved: string;
        published: string;
        retired: string;
      };
      exceptionStatusOptions: {
        pending: string;
        approved: string;
        rejected: string;
        expired: string;
      };
      domains: {
        access_control: string;
        incident_response: string;
        data_protection: string;
        acceptable_use: string;
        business_continuity: string;
        risk_management: string;
        vendor_management: string;
        change_management: string;
        security_awareness: string;
        network_security: string;
        encryption: string;
        physical_security: string;
        other: string;
      };
      actions: { submitReview: string; publish: string; retire: string };
      confirm: {
        submitReviewTitle: string;
        submitReviewDesc: (title: string) => string;
        publishTitle: string;
        publishDesc: (title: string) => string;
        retireTitle: string;
        retireDesc: (title: string) => string;
        approveExceptionTitle: string;
        approveExceptionDesc: (title: string) => string;
        rejectExceptionTitle: string;
        rejectExceptionDesc: (title: string) => string;
      };
      empty: {
        policiesTitle: string;
        policiesDesc: string;
        exceptionsTitle: string;
        exceptionsDesc: string;
      };
      search: { policies: string; exceptions: string };
      exceptionApprovedToast: string;
      exceptionRejectedToast: string;
      exceptionDetail: {
        forPrefix: (policy: string) => string;
        requestedBy: string;
        expiredSuffix: string;
        decisionBy: string;
        justification: string;
        compensatingControls: string;
        decisionNotes: string;
      };
    };
    thirdParty: {
      title: string;
      description: string;
      totalVendors: string;
      criticalVendors: string;
      pendingReviews: string;
      openQuestionnaires: string;
      startReview: string;
    };
  };
}

export const vcisoLabels: CyberBilingual<VcisoLabels> = {
  en: {
    console: {
      title: 'Virtual CISO',
      description: 'Executive security briefing, hybrid routed chat, and LLM observability in one workspace.',
      refresh: 'Refresh',
      generating: 'Generating…',
      exportReport: 'Export Report',
      reportStartedToast: 'Report generation started',
      loadError: 'Failed to load the Virtual CISO briefing.',
      executiveBriefing: 'Executive Briefing',
      postureAtAGlance: 'Security posture at a glance',
      riskScore: 'Risk score',
      grade: 'Grade',
      generated: 'Generated',
      criticalIssues: 'Critical Issues',
      recommendations: 'Recommendations',
      complianceStatus: 'Compliance Status',
    },
    chat: {
      vciso: 'Virtual CISO',
      live: 'Live',
      reconnecting: 'Reconnecting',
      fallback: 'Fallback',
      autoRoute: 'Auto route',
      llmForced: 'LLM forced',
      deterministicForced: 'Deterministic forced',
      assistantTagline: 'Hybrid vCISO assistant with transparent routing, grounded responses, and auditable traces.',
      emptyTitle: 'Start with a direct question.',
      emptyHint: 'Try "What is our risk score?", "Show critical alerts", or "Build a dashboard for alerts and risk this week".',
      connectedPrefix: 'Connected: ',
      thinking: 'vCISO is thinking...',
      conversationActive: (id) => `Conversation ${id} active`,
      newConversation: 'New conversation',
      routerDecides: 'Router decides per message',
      llmOverride: 'LLM override active',
      deterministicOverride: 'Deterministic override active',
      confirmActionTitle: 'Confirm Action',
      confirmActionDefault: 'Do you want to continue?',
      proceed: 'Proceed',
    },
    conversations: {
      newChat: 'New Chat',
      history: 'History',
      historyTitle: 'Conversation History',
      historyDescription: 'Load a previous vCISO conversation.',
      empty: 'No saved conversations yet.',
      messageCount: (n) => `${n} messages`,
    },
    input: {
      placeholder: 'Ask the vCISO...',
      engineRouting: 'Engine routing',
      autoRouting: 'Auto routing',
      forceLlm: 'Force LLM',
      forceDeterministic: 'Force deterministic',
      send: 'Send',
    },
    posture: {
      riskScore: 'Risk Score',
      vsLastPeriod: 'vs last period',
      riskComponents: 'Risk Components',
    },
    issues: {
      noneTitle: 'No critical issues — your security posture is in good standing.',
      impact: 'Impact',
      recommendation: 'Recommendation',
      viewDetails: 'View details →',
    },
    recs: {
      none: 'No recommendations at this time.',
      effortSuffix: (effort) => `${effort} effort`,
      ptsSuffix: (pts) => `-${pts} pts`,
      actions: 'Actions',
      expectedImpact: 'Expected Impact',
    },
    threat: {
      title: 'Threat Landscape',
      activeThreats: 'Active Threats',
      topTactic: 'Top Tactic',
      topTechnique: 'Top Technique',
      recentIndicators: 'Recent Indicators',
      threatsByType: 'Threats by Type',
    },
    compliance: {
      none: 'No compliance frameworks configured.',
      compliant: 'Compliant',
      partial: 'Partial',
      nonCompliant: 'Non-Compliant',
      coverage: 'Coverage',
      controlsPassed: (passed, total) => `${passed} / ${total} controls passed`,
    },
    llmOps: {
      title: 'LLM Operations',
      subtitle: 'Surface provider health, token usage, and prompt governance from the existing vCISO LLM backend.',
      auditBadge: 'Audit traces open from assistant messages',
      providerHealth: 'Provider Health',
      loading: 'Loading...',
      unavailable: 'Unavailable',
      healthPending: 'Health endpoint pending',
      latency: 'Latency',
      rateLimitRemaining: (n) => `${n} rate limit remaining`,
      noTelemetry: 'No provider telemetry yet',
      usageToday: 'Usage Today',
      usageTodayDetail: (calls, cost) => `${calls} calls · ${cost}`,
      usagePending: 'Usage endpoint pending',
      usageThisMonth: 'Usage This Month',
      usageThisMonthDetail: (calls) => `${calls} routed calls`,
      monthlyUnavailable: 'Monthly totals unavailable',
      adminGate: 'LLM admin controls require the `vciso:llm:admin` permission. Health, usage, engine selection, and message-level traces remain visible here.',
      providerConfigTitle: 'Provider Configuration',
      providerConfigDescription: 'Update the active provider override used by the tenant-level LLM manager.',
      provider: 'Provider',
      selectProvider: 'Select provider',
      model: 'Model',
      temperature: 'Temperature',
      currentHealthCheck: (detail) => `Current health check: ${detail}.`,
      waitingTelemetry: 'waiting for provider telemetry',
      saveOverride: 'Save Provider Override',
      promptVersionsTitle: 'Prompt Versions',
      promptVersionsDescription: 'Review prompt versions, activate a candidate, or register a new system prompt.',
      loadingPrompts: 'Loading prompt versions...',
      noPrompts: 'No prompt versions registered yet.',
      active: 'Active',
      noDescription: 'No description provided.',
      createdByOn: (by, on) => `Created by ${by} on ${on}`,
      activate: 'Activate',
      createPromptTitle: 'Create Prompt Version',
      createPromptDescription: 'Register a new version; activation remains explicit.',
      version: 'Version',
      description: 'Description',
      promptText: 'Prompt Text',
      createPromptVersion: 'Create Prompt Version',
      settingsUpdatedToast: 'LLM provider settings updated',
      promptCreatedToast: 'Prompt version created',
      promptActivatedToast: 'Prompt version activated',
      configValidationError: 'Provider, model, and a valid temperature are required.',
      promptValidationError: 'Version and prompt text are required.',
    },
    catalog: {
      capabilitiesMapped: (n) => `${n} capabilities mapped`,
      briefingAssistantModules: 'Briefing + assistant + connected modules',
      coverageTitle: 'Virtual CISO capability coverage',
      coverageBody: 'This workspace now enumerates all 50 platform capabilities across executive reporting, governance, assurance, operations, and AI-assisted oversight.',
      featuresSuffix: (n) => `${n} features`,
      featureLabel: (id) => `Feature ${id}`,
      howItShowsUp: 'How it shows up:',
      footerNote: 'The vCISO route is now the single place where the 50-feature operating model is visible: real-time briefing data for live posture, assistant-led workflows for natural language and policy support, and deep links into the cyber modules that supply evidence, telemetry, remediation, and auditability.',
      categories: {
        executiveCommand: {
          title: 'Executive Command',
          summary: 'Board-level narrative, posture visibility, trends, scenarios, and multi-entity oversight.',
        },
        riskGovernance: {
          title: 'Risk and Governance',
          summary: 'Continuous risk management, accountability, approvals, framework mapping, and business alignment.',
        },
        controlsAssurance: {
          title: 'Controls and Assurance',
          summary: 'Policy, evidence, audits, vendor governance, and framework-aligned compliance operations.',
        },
        securityOperations: {
          title: 'Security Operations',
          summary: 'Asset visibility, threat enrichment, remediation, incidents, escalation, and planning.',
        },
        dataIdentityAi: {
          title: 'Data, Identity, and AI Oversight',
          summary: 'Awareness, identity governance, cloud and data posture, AI guidance, and human approvals.',
        },
      },
    },
    common: {
      viewDetails: 'View Details',
      edit: 'Edit',
      delete: 'Delete',
      approve: 'Approve',
      reject: 'Reject',
      cancel: 'Cancel',
      close: 'Close',
      save: 'Save',
      saving: 'Saving...',
      create: 'Create',
      update: 'Update',
      submit: 'Submit',
      status: 'Status',
      created: 'Created',
      updated: 'Updated',
      owner: 'Owner',
      name: 'Name',
      title: 'Title',
      description: 'Description',
      category: 'Category',
      priority: 'Priority',
      severity: 'Severity',
      actions: 'Actions',
      notes: 'Notes',
      notesOptional: 'Notes (optional)',
      optional: 'optional',
      active: 'Active',
      inactive: 'Inactive',
      none: 'None',
      all: 'All',
      yes: 'Yes',
      no: 'No',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      critical: 'Critical',
      loadError: 'Failed to load data.',
      required: 'Required',
    },
    pages: {
      evidence: {
        title: 'Audit Evidence Repository',
        description: 'Manage evidence collection, track compliance artifacts, and automate evidence gathering across frameworks.',
        totalEvidence: 'Total Evidence',
        needsAttention: 'Needs Attention',
        frameworksCovered: 'Frameworks Covered',
        controlsWithEvidence: 'Controls with Evidence',
      },
      riskRegister: {
        title: 'Risk Register',
        description: 'Identify, assess, and manage organizational risks with business impact alignment and acceptance workflows.',
        totalRisks: 'Total Risks',
        totalRisksDesc: 'All registered risks',
        avgResidualScore: 'Avg Residual Score',
        avgResidualDesc: 'Average residual risk',
        overdueReviews: 'Overdue Reviews',
        overdueDesc: 'Past review date',
        acceptedRisks: 'Accepted Risks',
        acceptedDesc: 'Formally accepted',
        closeRisk: 'Close Risk',
        revokeAcceptance: 'Revoke Risk Acceptance',
      },
      awareness: {
        title: 'Awareness & IAM',
        description: 'Track security awareness programs and manage identity and access governance findings.',
        privilegedAccounts: 'Privileged Accounts',
        privilegedDesc: 'Accounts with elevated access',
        orphanedAccounts: 'Orphaned Accounts',
        orphanedDesc: 'Accounts without active owners',
        staleAccess: 'Stale Access',
        staleDesc: 'Unused access permissions',
      },
      workflows: {
        title: 'Workflows',
        description: 'Manage control ownership assignments and approval workflows for governance decisions.',
        pendingApprovals: 'Pending Approvals',
        pendingDesc: 'Awaiting decision',
        overdue: 'Overdue',
        overdueDesc: 'Deadline passed',
        approvedThisMonth: 'Approved This Month',
        approvedDesc: 'Granted this month',
        rejectedThisMonth: 'Rejected This Month',
        rejectedDesc: 'Declined this month',
        markReviewed: 'Mark as Reviewed',
      },
      compliance: {
        title: 'Compliance Management',
        description: 'Track regulatory obligations, test control effectiveness, and map control dependencies across your compliance program.',
      },
      incidentReadiness: {
        title: 'Incident Readiness',
        description: 'Manage escalation rules and crisis playbooks to ensure rapid, coordinated incident response.',
        escalationRules: 'Escalation Rules',
        totalTriggers: 'Total Triggers',
        totalTriggersDesc: 'Across all rules',
        testedPlaybooks: 'Tested Playbooks',
      },
      integrations: {
        title: 'Integrations',
        description: 'Manage connections to external security tools including asset management, ticketing, cloud security, and data protection platforms.',
        totalIntegrations: 'Total Integrations',
        connected: 'Connected',
        errors: 'Errors',
        totalItemsSynced: 'Total Items Synced',
      },
      maturity: {
        title: 'Maturity & Budget',
        description: 'Assess your security maturity, benchmark against industry peers, and prioritize security investments.',
        totalProposed: 'Total Proposed',
        totalProposedDesc: 'Pending approval',
        totalApproved: 'Total Approved',
        totalApprovedDesc: 'Approved for spending',
      },
      policies: {
        title: 'Policy Management',
        description: 'Manage security policies, handle exceptions, and generate AI-powered policy drafts.',
        totalPolicies: 'Total Policies',
        published: 'Published',
        inReview: 'In Review',
        overdueReviews: 'Overdue Reviews',
        activeExceptions: 'Active Exceptions',
        tabs: { policies: 'Policies', exceptions: 'Exceptions', aiDraft: 'AI Draft' },
        createPolicy: 'Create Policy',
        requestException: 'Request Exception',
        columns: {
          title: 'Title',
          domain: 'Domain',
          version: 'Version',
          status: 'Status',
          owner: 'Owner',
          reviewDue: 'Review Due',
          exceptions: 'Exceptions',
          updated: 'Updated',
        },
        exceptionColumns: {
          title: 'Title',
          policy: 'Policy',
          status: 'Status',
          requestedBy: 'Requested By',
          compensatingControls: 'Compensating Controls',
          expiresAt: 'Expires At',
          created: 'Created',
        },
        filters: { status: 'Status', domain: 'Domain' },
        statusOptions: {
          draft: 'Draft',
          review: 'In Review',
          approved: 'Approved',
          published: 'Published',
          retired: 'Retired',
        },
        exceptionStatusOptions: {
          pending: 'Pending',
          approved: 'Approved',
          rejected: 'Rejected',
          expired: 'Expired',
        },
        domains: {
          access_control: 'Access Control',
          incident_response: 'Incident Response',
          data_protection: 'Data Protection',
          acceptable_use: 'Acceptable Use',
          business_continuity: 'Business Continuity',
          risk_management: 'Risk Management',
          vendor_management: 'Vendor Management',
          change_management: 'Change Management',
          security_awareness: 'Security Awareness',
          network_security: 'Network Security',
          encryption: 'Encryption',
          physical_security: 'Physical Security',
          other: 'Other',
        },
        actions: { submitReview: 'Submit for Review', publish: 'Publish', retire: 'Retire' },
        confirm: {
          submitReviewTitle: 'Submit for Review',
          submitReviewDesc: (title) => `Submit "${title}" for review? Reviewers will be notified.`,
          publishTitle: 'Publish Policy',
          publishDesc: (title) => `Publish "${title}"? This will make it active organization-wide.`,
          retireTitle: 'Retire Policy',
          retireDesc: (title) => `Retire "${title}"? It will remain in the archive but no longer be active.`,
          approveExceptionTitle: 'Approve Exception',
          approveExceptionDesc: (title) => `Approve the exception "${title}"? The requestor will be notified.`,
          rejectExceptionTitle: 'Reject Exception',
          rejectExceptionDesc: (title) => `Reject the exception "${title}"? The requestor will be notified.`,
        },
        empty: {
          policiesTitle: 'No policies found',
          policiesDesc: 'Create your first security policy to get started.',
          exceptionsTitle: 'No exceptions found',
          exceptionsDesc: 'No policy exceptions have been requested yet.',
        },
        search: { policies: 'Search policies...', exceptions: 'Search exceptions...' },
        exceptionApprovedToast: 'Exception approved',
        exceptionRejectedToast: 'Exception rejected',
        exceptionDetail: {
          forPrefix: (policy) => `Exception for: ${policy}`,
          requestedBy: 'Requested By',
          expiredSuffix: ' (Expired)',
          decisionBy: 'Decision By',
          justification: 'Justification',
          compensatingControls: 'Compensating Controls',
          decisionNotes: 'Decision Notes',
        },
      },
      thirdParty: {
        title: 'Third-Party Risk Management',
        description: 'Monitor vendor risk, manage assessments, and track security questionnaires.',
        totalVendors: 'Total Vendors',
        criticalVendors: 'Critical Vendors',
        pendingReviews: 'Pending Reviews',
        openQuestionnaires: 'Open Questionnaires',
        startReview: 'Start Review',
      },
    },
  },
  ar: {
    console: {
      title: 'مدير أمن المعلومات الافتراضي',
      description: 'إحاطة أمنية تنفيذية، ودردشة هجينة موجَّهة، ومراقبة لنماذج اللغة الكبيرة في مساحة عمل واحدة.',
      refresh: 'تحديث',
      generating: 'جارٍ الإنشاء…',
      exportReport: 'تصدير التقرير',
      reportStartedToast: 'بدأ إنشاء التقرير',
      loadError: 'تعذّر تحميل إحاطة مدير أمن المعلومات الافتراضي.',
      executiveBriefing: 'إحاطة تنفيذية',
      postureAtAGlance: 'الوضع الأمني في لمحة',
      riskScore: 'درجة المخاطر',
      grade: 'التقدير',
      generated: 'أُنشئ في',
      criticalIssues: 'القضايا الحرجة',
      recommendations: 'التوصيات',
      complianceStatus: 'حالة الامتثال',
    },
    chat: {
      vciso: 'مدير أمن المعلومات الافتراضي',
      live: 'مباشر',
      reconnecting: 'جارٍ إعادة الاتصال',
      fallback: 'احتياطي',
      autoRoute: 'توجيه تلقائي',
      llmForced: 'فرض LLM',
      deterministicForced: 'فرض حتمي',
      assistantTagline: 'مساعد vCISO هجين بتوجيه شفاف وردود مُؤصَّلة وآثار قابلة للتدقيق.',
      emptyTitle: 'ابدأ بسؤال مباشر.',
      emptyHint: 'جرّب «ما درجة مخاطرنا؟» أو «أظهر التنبيهات الحرجة» أو «أنشئ لوحة للتنبيهات والمخاطر هذا الأسبوع».',
      connectedPrefix: 'متصل: ',
      thinking: 'مدير أمن المعلومات الافتراضي يفكّر...',
      conversationActive: (id) => `المحادثة ${id} نشطة`,
      newConversation: 'محادثة جديدة',
      routerDecides: 'الموجِّه يقرر لكل رسالة',
      llmOverride: 'تجاوز LLM نشط',
      deterministicOverride: 'تجاوز حتمي نشط',
      confirmActionTitle: 'تأكيد الإجراء',
      confirmActionDefault: 'هل تريد المتابعة؟',
      proceed: 'متابعة',
    },
    conversations: {
      newChat: 'محادثة جديدة',
      history: 'السجل',
      historyTitle: 'سجل المحادثات',
      historyDescription: 'حمّل محادثة vCISO سابقة.',
      empty: 'لا توجد محادثات محفوظة بعد.',
      messageCount: (n) => `${n} رسالة`,
    },
    input: {
      placeholder: 'اسأل مدير أمن المعلومات الافتراضي...',
      engineRouting: 'توجيه المحرك',
      autoRouting: 'توجيه تلقائي',
      forceLlm: 'فرض LLM',
      forceDeterministic: 'فرض حتمي',
      send: 'إرسال',
    },
    posture: {
      riskScore: 'درجة المخاطر',
      vsLastPeriod: 'مقارنةً بالفترة السابقة',
      riskComponents: 'مكوّنات المخاطر',
    },
    issues: {
      noneTitle: 'لا توجد قضايا حرجة — وضعك الأمني في حالة جيدة.',
      impact: 'الأثر',
      recommendation: 'التوصية',
      viewDetails: 'عرض التفاصيل ←',
    },
    recs: {
      none: 'لا توجد توصيات في الوقت الحالي.',
      effortSuffix: (effort) => `جهد ${effort}`,
      ptsSuffix: (pts) => `-${pts} نقطة`,
      actions: 'الإجراءات',
      expectedImpact: 'الأثر المتوقَّع',
    },
    threat: {
      title: 'مشهد التهديدات',
      activeThreats: 'التهديدات النشطة',
      topTactic: 'أبرز تكتيك',
      topTechnique: 'أبرز أسلوب',
      recentIndicators: 'المؤشرات الأخيرة',
      threatsByType: 'التهديدات حسب النوع',
    },
    compliance: {
      none: 'لم تُهيَّأ أطر امتثال.',
      compliant: 'ممتثل',
      partial: 'جزئي',
      nonCompliant: 'غير ممتثل',
      coverage: 'التغطية',
      controlsPassed: (passed, total) => `${passed} / ${total} ضابط ناجح`,
    },
    llmOps: {
      title: 'عمليات نماذج اللغة الكبيرة',
      subtitle: 'إظهار صحة المزوّد واستهلاك الرموز وحوكمة الموجِّهات من خلفية vCISO LLM الحالية.',
      auditBadge: 'آثار التدقيق تُفتح من رسائل المساعد',
      providerHealth: 'صحة المزوّد',
      loading: 'جارٍ التحميل...',
      unavailable: 'غير متاح',
      healthPending: 'نقطة نهاية الصحة معلّقة',
      latency: 'زمن الاستجابة',
      rateLimitRemaining: (n) => `${n} من حد المعدل متبقٍ`,
      noTelemetry: 'لا توجد قياسات مزوّد بعد',
      usageToday: 'الاستهلاك اليوم',
      usageTodayDetail: (calls, cost) => `${calls} استدعاء · ${cost}`,
      usagePending: 'نقطة نهاية الاستهلاك معلّقة',
      usageThisMonth: 'الاستهلاك هذا الشهر',
      usageThisMonthDetail: (calls) => `${calls} استدعاء موجَّه`,
      monthlyUnavailable: 'الإجماليات الشهرية غير متاحة',
      adminGate: 'تتطلب أدوات إدارة LLM صلاحية `vciso:llm:admin`. تبقى الصحة والاستهلاك واختيار المحرك وآثار الرسائل ظاهرة هنا.',
      providerConfigTitle: 'تهيئة المزوّد',
      providerConfigDescription: 'تحديث تجاوز المزوّد النشط المستخدَم بواسطة مدير LLM على مستوى المستأجر.',
      provider: 'المزوّد',
      selectProvider: 'اختر المزوّد',
      model: 'النموذج',
      temperature: 'درجة الحرارة',
      currentHealthCheck: (detail) => `فحص الصحة الحالي: ${detail}.`,
      waitingTelemetry: 'بانتظار قياسات المزوّد',
      saveOverride: 'حفظ تجاوز المزوّد',
      promptVersionsTitle: 'إصدارات الموجِّه',
      promptVersionsDescription: 'راجع إصدارات الموجِّه، أو فعّل مرشَّحًا، أو سجّل موجِّه نظام جديدًا.',
      loadingPrompts: 'جارٍ تحميل إصدارات الموجِّه...',
      noPrompts: 'لم تُسجَّل إصدارات موجِّه بعد.',
      active: 'نشط',
      noDescription: 'لم يُقدَّم وصف.',
      createdByOn: (by, on) => `أنشأه ${by} في ${on}`,
      activate: 'تفعيل',
      createPromptTitle: 'إنشاء إصدار موجِّه',
      createPromptDescription: 'سجّل إصدارًا جديدًا؛ يبقى التفعيل صريحًا.',
      version: 'الإصدار',
      description: 'الوصف',
      promptText: 'نص الموجِّه',
      createPromptVersion: 'إنشاء إصدار موجِّه',
      settingsUpdatedToast: 'تم تحديث إعدادات مزوّد LLM',
      promptCreatedToast: 'تم إنشاء إصدار الموجِّه',
      promptActivatedToast: 'تم تفعيل إصدار الموجِّه',
      configValidationError: 'المزوّد والنموذج ودرجة حرارة صالحة مطلوبة.',
      promptValidationError: 'الإصدار ونص الموجِّه مطلوبان.',
    },
    catalog: {
      capabilitiesMapped: (n) => `${n} قدرة مُخطَّطة`,
      briefingAssistantModules: 'الإحاطة + المساعد + الوحدات المتصلة',
      coverageTitle: 'تغطية قدرات مدير أمن المعلومات الافتراضي',
      coverageBody: 'تُعدِّد مساحة العمل الآن جميع قدرات المنصة الـ٥٠ عبر التقارير التنفيذية والحوكمة والضمان والعمليات والإشراف المدعوم بالذكاء الاصطناعي.',
      featuresSuffix: (n) => `${n} ميزة`,
      featureLabel: (id) => `الميزة ${id}`,
      howItShowsUp: 'كيف تظهر:',
      footerNote: 'مسار vCISO هو الآن المكان الوحيد الذي يظهر فيه نموذج التشغيل ذو الـ٥٠ ميزة: بيانات إحاطة في الزمن الفعلي للوضع المباشر، وسير عمل بقيادة المساعد للغة الطبيعية ودعم السياسات، وروابط عميقة إلى وحدات الأمن السيبراني التي توفّر الأدلة والقياسات والمعالجة والقابلية للتدقيق.',
      categories: {
        executiveCommand: {
          title: 'القيادة التنفيذية',
          summary: 'سرد على مستوى مجلس الإدارة، ووضوح الوضع، والاتجاهات، والسيناريوهات، والإشراف متعدد الكيانات.',
        },
        riskGovernance: {
          title: 'المخاطر والحوكمة',
          summary: 'إدارة مخاطر مستمرة، ومساءلة، وموافقات، وربط بالأطر، ومواءمة مع الأعمال.',
        },
        controlsAssurance: {
          title: 'الضوابط والضمان',
          summary: 'السياسات والأدلة والتدقيقات وحوكمة الموردين وعمليات الامتثال المتوافقة مع الأطر.',
        },
        securityOperations: {
          title: 'العمليات الأمنية',
          summary: 'وضوح الأصول، وإثراء التهديدات، والمعالجة، والحوادث، والتصعيد، والتخطيط.',
        },
        dataIdentityAi: {
          title: 'الإشراف على البيانات والهوية والذكاء الاصطناعي',
          summary: 'التوعية، وحوكمة الهوية، ووضع البيانات والسحابة، وإرشاد الذكاء الاصطناعي، والموافقات البشرية.',
        },
      },
    },
    common: {
      viewDetails: 'عرض التفاصيل',
      edit: 'تعديل',
      delete: 'حذف',
      approve: 'اعتماد',
      reject: 'رفض',
      cancel: 'إلغاء',
      close: 'إغلاق',
      save: 'حفظ',
      saving: 'جارٍ الحفظ...',
      create: 'إنشاء',
      update: 'تحديث',
      submit: 'إرسال',
      status: 'الحالة',
      created: 'تاريخ الإنشاء',
      updated: 'تاريخ التحديث',
      owner: 'المسؤول',
      name: 'الاسم',
      title: 'العنوان',
      description: 'الوصف',
      category: 'الفئة',
      priority: 'الأولوية',
      severity: 'الخطورة',
      actions: 'الإجراءات',
      notes: 'ملاحظات',
      notesOptional: 'ملاحظات (اختياري)',
      optional: 'اختياري',
      active: 'نشط',
      inactive: 'غير نشط',
      none: 'لا شيء',
      all: 'الكل',
      yes: 'نعم',
      no: 'لا',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      critical: 'حرج',
      loadError: 'تعذّر تحميل البيانات.',
      required: 'مطلوب',
    },
    pages: {
      evidence: {
        title: 'مستودع أدلة التدقيق',
        description: 'إدارة جمع الأدلة، وتتبّع مستندات الامتثال، وأتمتة جمع الأدلة عبر الأطر.',
        totalEvidence: 'إجمالي الأدلة',
        needsAttention: 'يحتاج إلى اهتمام',
        frameworksCovered: 'الأطر المُغطَّاة',
        controlsWithEvidence: 'الضوابط ذات الأدلة',
      },
      riskRegister: {
        title: 'سجل المخاطر',
        description: 'تحديد المخاطر المؤسسية وتقييمها وإدارتها مع مواءمة أثر الأعمال وسير عمل القبول.',
        totalRisks: 'إجمالي المخاطر',
        totalRisksDesc: 'جميع المخاطر المسجَّلة',
        avgResidualScore: 'متوسط الدرجة المتبقية',
        avgResidualDesc: 'متوسط المخاطر المتبقية',
        overdueReviews: 'مراجعات متأخرة',
        overdueDesc: 'تجاوزت تاريخ المراجعة',
        acceptedRisks: 'المخاطر المقبولة',
        acceptedDesc: 'مقبولة رسميًا',
        closeRisk: 'إغلاق المخاطرة',
        revokeAcceptance: 'إلغاء قبول المخاطرة',
      },
      awareness: {
        title: 'التوعية وإدارة الهوية والوصول',
        description: 'تتبّع برامج التوعية الأمنية وإدارة نتائج حوكمة الهوية والوصول.',
        privilegedAccounts: 'الحسابات المميَّزة',
        privilegedDesc: 'حسابات بصلاحيات مرتفعة',
        orphanedAccounts: 'الحسابات اليتيمة',
        orphanedDesc: 'حسابات بلا مالكين نشطين',
        staleAccess: 'وصول راكد',
        staleDesc: 'صلاحيات وصول غير مستخدَمة',
      },
      workflows: {
        title: 'سير العمل',
        description: 'إدارة تعيينات ملكية الضوابط وسير عمل الموافقات لقرارات الحوكمة.',
        pendingApprovals: 'الموافقات المعلّقة',
        pendingDesc: 'بانتظار القرار',
        overdue: 'متأخر',
        overdueDesc: 'تجاوز الموعد النهائي',
        approvedThisMonth: 'المعتمَدة هذا الشهر',
        approvedDesc: 'مُنحت هذا الشهر',
        rejectedThisMonth: 'المرفوضة هذا الشهر',
        rejectedDesc: 'رُفضت هذا الشهر',
        markReviewed: 'تعليم كمُراجَع',
      },
      compliance: {
        title: 'إدارة الامتثال',
        description: 'تتبّع الالتزامات التنظيمية، واختبار فعالية الضوابط، وربط اعتماديات الضوابط عبر برنامج الامتثال.',
      },
      incidentReadiness: {
        title: 'الجاهزية للحوادث',
        description: 'إدارة قواعد التصعيد وأدلة إجراءات الأزمات لضمان استجابة سريعة ومنسَّقة للحوادث.',
        escalationRules: 'قواعد التصعيد',
        totalTriggers: 'إجمالي المُحفِّزات',
        totalTriggersDesc: 'عبر جميع القواعد',
        testedPlaybooks: 'أدلة الإجراءات المختبَرة',
      },
      integrations: {
        title: 'التكاملات',
        description: 'إدارة الاتصالات بأدوات الأمن الخارجية بما في ذلك إدارة الأصول والتذاكر وأمن السحابة ومنصات حماية البيانات.',
        totalIntegrations: 'إجمالي التكاملات',
        connected: 'متصل',
        errors: 'الأخطاء',
        totalItemsSynced: 'إجمالي العناصر المتزامنة',
      },
      maturity: {
        title: 'النضج والميزانية',
        description: 'قيّم نضجك الأمني، وقارن بنظرائك في القطاع، ورتّب أولويات الاستثمارات الأمنية.',
        totalProposed: 'إجمالي المقترَح',
        totalProposedDesc: 'بانتظار الموافقة',
        totalApproved: 'إجمالي المعتمَد',
        totalApprovedDesc: 'مُعتمَد للإنفاق',
      },
      policies: {
        title: 'إدارة السياسات',
        description: 'إدارة السياسات الأمنية، ومعالجة الاستثناءات، وتوليد مسودات سياسات مدعومة بالذكاء الاصطناعي.',
        totalPolicies: 'إجمالي السياسات',
        published: 'منشورة',
        inReview: 'قيد المراجعة',
        overdueReviews: 'مراجعات متأخرة',
        activeExceptions: 'الاستثناءات النشطة',
        tabs: { policies: 'السياسات', exceptions: 'الاستثناءات', aiDraft: 'مسودة بالذكاء الاصطناعي' },
        createPolicy: 'إنشاء سياسة',
        requestException: 'طلب استثناء',
        columns: {
          title: 'العنوان',
          domain: 'المجال',
          version: 'الإصدار',
          status: 'الحالة',
          owner: 'المسؤول',
          reviewDue: 'استحقاق المراجعة',
          exceptions: 'الاستثناءات',
          updated: 'تاريخ التحديث',
        },
        exceptionColumns: {
          title: 'العنوان',
          policy: 'السياسة',
          status: 'الحالة',
          requestedBy: 'مُقدَّم من',
          compensatingControls: 'الضوابط التعويضية',
          expiresAt: 'تاريخ الانتهاء',
          created: 'تاريخ الإنشاء',
        },
        filters: { status: 'الحالة', domain: 'المجال' },
        statusOptions: {
          draft: 'مسودة',
          review: 'قيد المراجعة',
          approved: 'معتمد',
          published: 'منشورة',
          retired: 'مسحوبة',
        },
        exceptionStatusOptions: {
          pending: 'قيد الانتظار',
          approved: 'معتمد',
          rejected: 'مرفوض',
          expired: 'منتهٍ',
        },
        domains: {
          access_control: 'التحكم في الوصول',
          incident_response: 'الاستجابة للحوادث',
          data_protection: 'حماية البيانات',
          acceptable_use: 'الاستخدام المقبول',
          business_continuity: 'استمرارية الأعمال',
          risk_management: 'إدارة المخاطر',
          vendor_management: 'إدارة الموردين',
          change_management: 'إدارة التغيير',
          security_awareness: 'التوعية الأمنية',
          network_security: 'أمن الشبكات',
          encryption: 'التشفير',
          physical_security: 'الأمن المادي',
          other: 'أخرى',
        },
        actions: { submitReview: 'إرسال للمراجعة', publish: 'نشر', retire: 'سحب' },
        confirm: {
          submitReviewTitle: 'إرسال للمراجعة',
          submitReviewDesc: (title) => `إرسال "${title}" للمراجعة؟ سيتم إشعار المراجعين.`,
          publishTitle: 'نشر السياسة',
          publishDesc: (title) => `نشر "${title}"؟ سيصبح فعّالًا على مستوى المؤسسة.`,
          retireTitle: 'سحب السياسة',
          retireDesc: (title) => `سحب "${title}"؟ سيبقى في الأرشيف لكنه لن يكون فعّالًا بعد الآن.`,
          approveExceptionTitle: 'اعتماد الاستثناء',
          approveExceptionDesc: (title) => `اعتماد الاستثناء "${title}"؟ سيتم إشعار مقدّم الطلب.`,
          rejectExceptionTitle: 'رفض الاستثناء',
          rejectExceptionDesc: (title) => `رفض الاستثناء "${title}"؟ سيتم إشعار مقدّم الطلب.`,
        },
        empty: {
          policiesTitle: 'لا توجد سياسات',
          policiesDesc: 'أنشئ أول سياسة أمنية للبدء.',
          exceptionsTitle: 'لا توجد استثناءات',
          exceptionsDesc: 'لم يُطلب أي استثناء للسياسات بعد.',
        },
        search: { policies: 'بحث في السياسات...', exceptions: 'بحث في الاستثناءات...' },
        exceptionApprovedToast: 'تم اعتماد الاستثناء',
        exceptionRejectedToast: 'تم رفض الاستثناء',
        exceptionDetail: {
          forPrefix: (policy) => `استثناء على: ${policy}`,
          requestedBy: 'مُقدَّم من',
          expiredSuffix: ' (منتهٍ)',
          decisionBy: 'القرار من',
          justification: 'المبرر',
          compensatingControls: 'الضوابط التعويضية',
          decisionNotes: 'ملاحظات القرار',
        },
      },
      thirdParty: {
        title: 'إدارة مخاطر الأطراف الثالثة',
        description: 'مراقبة مخاطر الموردين، وإدارة التقييمات، وتتبّع الاستبيانات الأمنية.',
        totalVendors: 'إجمالي الموردين',
        criticalVendors: 'الموردون الحرجون',
        pendingReviews: 'مراجعات معلّقة',
        openQuestionnaires: 'الاستبيانات المفتوحة',
        startReview: 'بدء المراجعة',
      },
    },
  },
};

export function useVcisoLabels(): VcisoLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoLabels);

// ---------------------------------------------------------------------------
// Detail panels + form dialogs for the governance sub-pages. Merged into the
// same 'cyberVciso' namespace via a second registerMessages() call so the
// existing typed VcisoLabels interface stays untouched.
// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
// ---------------------------------------------------------------------------

export interface VcisoPanelLabels {
  briefingCompare: {
    noPrevious: string;
    title: string;
    ptsSuffix: string;
    improved: string;
    declined: string;
    noChange: string;
    previous: string;
    current: string;
    gradePrefix: string;
    unchangedNote: string;
  };
  awareness: {
    types: { training: string; phishing_simulation: string; policy_attestation: string };
    detail: {
      overview: string;
      userBreakdown: string;
      totalUsers: string;
      completed: string;
      passed: string;
      failed: string;
      pendingNote: (count: number) => string;
      ratesTitle: string;
      completionRate: string;
      passRate: string;
      timeline: string;
      startDate: string;
      endDate: string;
      created: string;
      lastUpdated: string;
    };
    form: {
      createTitle: string;
      editTitle: string;
      createDesc: string;
      editDesc: string;
      name: string;
      type: string;
      totalUsers: string;
      startDate: string;
      endDate: string;
      namePlaceholder: string;
      totalUsersPlaceholder: string;
      cancel: string;
      saving: string;
      creating: string;
      saveChanges: string;
      createProgram: string;
      nameRequired: string;
      totalUsersPositive: string;
      startRequired: string;
      endRequired: string;
      createdToast: string;
      updatedToast: string;
    };
    iam: {
      types: {
        mfa_gap: string;
        orphaned_account: string;
        privileged_access: string;
        sod_violation: string;
        stale_access: string;
        excessive_permissions: string;
      };
      overview: string;
      impact: string;
      affectedUsersLabel: string;
      remediation: string;
      noRemediation: string;
      timeline: string;
      discovered: string;
      statusPrefix: string;
      lastUpdatedPrefix: (date: string) => string;
      resolved: string;
      details: string;
      createdLabel: string;
      discoveredLabel: string;
      resolvedLabel: string;
    };
  };
  evidence: {
    types: {
      screenshot: string;
      log: string;
      config: string;
      report: string;
      policy: string;
      certificate: string;
      other: string;
    };
    sources: { manual: string; automated: string };
    detail: {
      description: string;
      metadata: string;
      frameworks: (count: number) => string;
      noFrameworks: string;
      controlIds: (count: number) => string;
      noControls: string;
      fileInformation: string;
      downloadFile: string;
      noFileAttached: string;
      collected: string;
      expires: string;
      noExpiry: string;
      created: string;
      updated: string;
      verification: string;
      collector: string;
      lastVerified: string;
      never: string;
      markVerified: string;
      verifying: string;
      verifiedToast: string;
    };
    form: {
      createTitle: string;
      editTitle: string;
      createDesc: string;
      editDesc: string;
      title: string;
      titlePlaceholder: string;
      description: string;
      descriptionPlaceholder: string;
      type: string;
      selectType: string;
      source: string;
      selectSource: string;
      frameworks: string;
      frameworksPlaceholder: string;
      frameworksHelp: string;
      controlIds: string;
      controlIdsPlaceholder: string;
      controlIdsHelp: string;
      fileName: string;
      fileSize: string;
      fileSizePlaceholder: string;
      fileUrl: string;
      collectorName: string;
      collectorPlaceholder: string;
      collectedAt: string;
      expiresAt: string;
      cancel: string;
      saving: string;
      uploading: string;
      saveChanges: string;
      uploadEvidence: string;
      createdToast: string;
      updatedToast: string;
    };
  };
}

export const vcisoPanelLabels: CyberBilingual<VcisoPanelLabels> = {
  en: {
    briefingCompare: {
      noPrevious: 'No previous briefing available for comparison.',
      title: 'Period-over-Period Comparison',
      ptsSuffix: 'pts',
      improved: 'Improved',
      declined: 'Declined',
      noChange: 'No Change',
      previous: 'Previous',
      current: 'Current',
      gradePrefix: 'Grade:',
      unchangedNote: 'Risk score has not changed since the last briefing.',
    },
    awareness: {
      types: {
        training: 'Training',
        phishing_simulation: 'Phishing Simulation',
        policy_attestation: 'Policy Attestation',
      },
      detail: {
        overview: 'Overview',
        userBreakdown: 'User Breakdown',
        totalUsers: 'Total Users',
        completed: 'Completed',
        passed: 'Passed',
        failed: 'Failed',
        pendingNote: (count) => `${count} user${count !== 1 ? 's' : ''} have not yet completed the program.`,
        ratesTitle: 'Completion & Pass Rates',
        completionRate: 'Completion Rate',
        passRate: 'Pass Rate',
        timeline: 'Timeline',
        startDate: 'Start Date:',
        endDate: 'End Date:',
        created: 'Created:',
        lastUpdated: 'Last Updated:',
      },
      form: {
        createTitle: 'Create Awareness Program',
        editTitle: 'Edit Program',
        createDesc: 'Set up a new security awareness program for your organization.',
        editDesc: 'Update the awareness program details.',
        name: 'Name',
        type: 'Type',
        totalUsers: 'Total Users',
        startDate: 'Start Date',
        endDate: 'End Date',
        namePlaceholder: 'e.g. Q1 2026 Security Training',
        totalUsersPlaceholder: 'e.g. 250',
        cancel: 'Cancel',
        saving: 'Saving...',
        creating: 'Creating...',
        saveChanges: 'Save Changes',
        createProgram: 'Create Program',
        nameRequired: 'Name is required',
        totalUsersPositive: 'Total users must be a positive number',
        startRequired: 'Start date is required',
        endRequired: 'End date is required',
        createdToast: 'Program created successfully',
        updatedToast: 'Program updated successfully',
      },
      iam: {
        types: {
          mfa_gap: 'MFA Gap',
          orphaned_account: 'Orphaned Account',
          privileged_access: 'Privileged Access',
          sod_violation: 'SoD Violation',
          stale_access: 'Stale Access',
          excessive_permissions: 'Excessive Permissions',
        },
        overview: 'Overview',
        impact: 'Impact',
        affectedUsersLabel: 'Affected users',
        remediation: 'Remediation',
        noRemediation: 'No remediation guidance available.',
        timeline: 'Timeline',
        discovered: 'Discovered',
        statusPrefix: 'Status:',
        lastUpdatedPrefix: (date) => `Last updated ${date}`,
        resolved: 'Resolved',
        details: 'Details',
        createdLabel: 'Created:',
        discoveredLabel: 'Discovered:',
        resolvedLabel: 'Resolved:',
      },
    },
    evidence: {
      types: {
        screenshot: 'Screenshot',
        log: 'Log',
        config: 'Configuration',
        report: 'Report',
        policy: 'Policy',
        certificate: 'Certificate',
        other: 'Other',
      },
      sources: { manual: 'Manual', automated: 'Automated' },
      detail: {
        description: 'Description',
        metadata: 'Evidence details and metadata',
        frameworks: (count) => `Frameworks (${count})`,
        noFrameworks: 'No frameworks assigned',
        controlIds: (count) => `Control IDs (${count})`,
        noControls: 'No controls linked',
        fileInformation: 'File Information',
        downloadFile: 'Download File',
        noFileAttached: 'No file attached',
        collected: 'Collected',
        expires: 'Expires',
        noExpiry: 'No expiry',
        created: 'Created',
        updated: 'Updated',
        verification: 'Verification',
        collector: 'Collector:',
        lastVerified: 'Last Verified:',
        never: 'Never',
        markVerified: 'Mark as Verified',
        verifying: 'Verifying...',
        verifiedToast: 'Evidence marked as verified',
      },
      form: {
        createTitle: 'Upload Evidence',
        editTitle: 'Edit Evidence',
        createDesc: 'Add new evidence to the audit repository.',
        editDesc: 'Update the evidence details below.',
        title: 'Title *',
        titlePlaceholder: 'e.g., SOC 2 Access Control Screenshot',
        description: 'Description *',
        descriptionPlaceholder: 'Describe the evidence and its relevance...',
        type: 'Type',
        selectType: 'Select type',
        source: 'Source',
        selectSource: 'Select source',
        frameworks: 'Frameworks',
        frameworksPlaceholder: 'SOC 2, ISO 27001, NIST CSF (comma-separated)',
        frameworksHelp: 'Separate multiple frameworks with commas',
        controlIds: 'Control IDs',
        controlIdsPlaceholder: 'CC6.1, A.9.1.1, PR.AC-1 (comma-separated)',
        controlIdsHelp: 'Separate multiple control IDs with commas',
        fileName: 'File Name',
        fileSize: 'File Size (bytes)',
        fileSizePlaceholder: 'e.g., 1048576',
        fileUrl: 'File URL',
        collectorName: 'Collector Name',
        collectorPlaceholder: 'e.g., Jane Smith',
        collectedAt: 'Collected At',
        expiresAt: 'Expires At',
        cancel: 'Cancel',
        saving: 'Saving...',
        uploading: 'Uploading...',
        saveChanges: 'Save Changes',
        uploadEvidence: 'Upload Evidence',
        createdToast: 'Evidence uploaded successfully',
        updatedToast: 'Evidence updated successfully',
      },
    },
  },
  ar: {
    briefingCompare: {
      noPrevious: 'لا تتوفّر إحاطة سابقة للمقارنة.',
      title: 'مقارنة بين الفترات',
      ptsSuffix: 'نقطة',
      improved: 'تحسّن',
      declined: 'تراجع',
      noChange: 'دون تغيير',
      previous: 'السابقة',
      current: 'الحالية',
      gradePrefix: 'التقدير:',
      unchangedNote: 'لم تتغيّر درجة المخاطر منذ الإحاطة الأخيرة.',
    },
    awareness: {
      types: {
        training: 'تدريب',
        phishing_simulation: 'محاكاة تصيّد',
        policy_attestation: 'إقرار السياسات',
      },
      detail: {
        overview: 'نظرة عامة',
        userBreakdown: 'تفصيل المستخدمين',
        totalUsers: 'إجمالي المستخدمين',
        completed: 'مكتمل',
        passed: 'ناجح',
        failed: 'راسب',
        pendingNote: (count) => `${count} مستخدم لم يُكملوا البرنامج بعد.`,
        ratesTitle: 'معدلات الإكمال والنجاح',
        completionRate: 'معدل الإكمال',
        passRate: 'معدل النجاح',
        timeline: 'الجدول الزمني',
        startDate: 'تاريخ البدء:',
        endDate: 'تاريخ الانتهاء:',
        created: 'تاريخ الإنشاء:',
        lastUpdated: 'آخر تحديث:',
      },
      form: {
        createTitle: 'إنشاء برنامج توعية',
        editTitle: 'تعديل البرنامج',
        createDesc: 'أنشئ برنامج توعية أمنية جديدًا لمؤسستك.',
        editDesc: 'حدّث تفاصيل برنامج التوعية.',
        name: 'الاسم',
        type: 'النوع',
        totalUsers: 'إجمالي المستخدمين',
        startDate: 'تاريخ البدء',
        endDate: 'تاريخ الانتهاء',
        namePlaceholder: 'مثال: تدريب الأمن للربع الأول 2026',
        totalUsersPlaceholder: 'مثال: 250',
        cancel: 'إلغاء',
        saving: 'جارٍ الحفظ...',
        creating: 'جارٍ الإنشاء...',
        saveChanges: 'حفظ التغييرات',
        createProgram: 'إنشاء البرنامج',
        nameRequired: 'الاسم مطلوب',
        totalUsersPositive: 'يجب أن يكون إجمالي المستخدمين رقمًا موجبًا',
        startRequired: 'تاريخ البدء مطلوب',
        endRequired: 'تاريخ الانتهاء مطلوب',
        createdToast: 'تم إنشاء البرنامج بنجاح',
        updatedToast: 'تم تحديث البرنامج بنجاح',
      },
      iam: {
        types: {
          mfa_gap: 'فجوة المصادقة متعددة العوامل (MFA)',
          orphaned_account: 'حساب يتيم',
          privileged_access: 'وصول مميّز',
          sod_violation: 'انتهاك الفصل بين المهام',
          stale_access: 'وصول راكد',
          excessive_permissions: 'صلاحيات مفرطة',
        },
        overview: 'نظرة عامة',
        impact: 'الأثر',
        affectedUsersLabel: 'المستخدمون المتأثرون',
        remediation: 'المعالجة',
        noRemediation: 'لا تتوفّر إرشادات معالجة.',
        timeline: 'الجدول الزمني',
        discovered: 'اكتُشف',
        statusPrefix: 'الحالة:',
        lastUpdatedPrefix: (date) => `آخر تحديث ${date}`,
        resolved: 'تم الحل',
        details: 'التفاصيل',
        createdLabel: 'تاريخ الإنشاء:',
        discoveredLabel: 'تاريخ الاكتشاف:',
        resolvedLabel: 'تاريخ الحل:',
      },
    },
    evidence: {
      types: {
        screenshot: 'لقطة شاشة',
        log: 'سجل',
        config: 'إعدادات',
        report: 'تقرير',
        policy: 'سياسة',
        certificate: 'شهادة',
        other: 'أخرى',
      },
      sources: { manual: 'يدوي', automated: 'آلي' },
      detail: {
        description: 'الوصف',
        metadata: 'تفاصيل الأدلة والبيانات الوصفية',
        frameworks: (count) => `الأطر (${count})`,
        noFrameworks: 'لم تُسنَد أطر',
        controlIds: (count) => `معرّفات الضوابط (${count})`,
        noControls: 'لا توجد ضوابط مرتبطة',
        fileInformation: 'معلومات الملف',
        downloadFile: 'تنزيل الملف',
        noFileAttached: 'لا يوجد ملف مرفق',
        collected: 'تاريخ الجمع',
        expires: 'تاريخ الانتهاء',
        noExpiry: 'بلا انتهاء',
        created: 'تاريخ الإنشاء',
        updated: 'تاريخ التحديث',
        verification: 'التحقق',
        collector: 'جامع الأدلة:',
        lastVerified: 'آخر تحقق:',
        never: 'أبدًا',
        markVerified: 'تعليم كمُتحقَّق منه',
        verifying: 'جارٍ التحقق...',
        verifiedToast: 'تم تعليم الأدلة كمُتحقَّق منها',
      },
      form: {
        createTitle: 'رفع الأدلة',
        editTitle: 'تعديل الأدلة',
        createDesc: 'أضف أدلة جديدة إلى مستودع التدقيق.',
        editDesc: 'حدّث تفاصيل الأدلة أدناه.',
        title: 'العنوان *',
        titlePlaceholder: 'مثال: لقطة شاشة ضابط التحكم في الوصول SOC 2',
        description: 'الوصف *',
        descriptionPlaceholder: 'صِف الأدلة ومدى صلتها...',
        type: 'النوع',
        selectType: 'اختر النوع',
        source: 'المصدر',
        selectSource: 'اختر المصدر',
        frameworks: 'الأطر',
        frameworksPlaceholder: 'SOC 2، ISO 27001، NIST CSF (مفصولة بفواصل)',
        frameworksHelp: 'افصل بين الأطر المتعددة بفواصل',
        controlIds: 'معرّفات الضوابط',
        controlIdsPlaceholder: 'CC6.1، A.9.1.1، PR.AC-1 (مفصولة بفواصل)',
        controlIdsHelp: 'افصل بين معرّفات الضوابط المتعددة بفواصل',
        fileName: 'اسم الملف',
        fileSize: 'حجم الملف (بايت)',
        fileSizePlaceholder: 'مثال: 1048576',
        fileUrl: 'رابط الملف',
        collectorName: 'اسم جامع الأدلة',
        collectorPlaceholder: 'مثال: جين سميث',
        collectedAt: 'تاريخ الجمع',
        expiresAt: 'تاريخ الانتهاء',
        cancel: 'إلغاء',
        saving: 'جارٍ الحفظ...',
        uploading: 'جارٍ الرفع...',
        saveChanges: 'حفظ التغييرات',
        uploadEvidence: 'رفع الأدلة',
        createdToast: 'تم رفع الأدلة بنجاح',
        updatedToast: 'تم تحديث الأدلة بنجاح',
      },
    },
  },
};

export function useVcisoPanelLabels(): VcisoPanelLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoPanelLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoPanelLabels);

// ---------------------------------------------------------------------------
// Governance sub-pages: risk-register, maturity/budget, compliance.
// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
// ---------------------------------------------------------------------------

export interface VcisoGovLabels {
  risk: {
    options: {
      level: { low: string; medium: string; high: string; critical: string };
      status: { open: string; mitigated: string; accepted: string; closed: string };
      treatment: { mitigate: string; transfer: string; accept: string; avoid: string };
    };
    detail: {
      editTitle: string;
      editDescription: string;
      cancel: string;
      save: string;
      saving: string;
      edit: string;
      titleLabel: string;
      titlePlaceholder: string;
      descriptionLabel: string;
      descriptionPlaceholder: string;
      category: string;
      categoryPlaceholder: string;
      department: string;
      departmentPlaceholder: string;
      likelihood: string;
      impact: string;
      status: string;
      treatment: string;
      reviewDate: string;
      treatmentPlan: string;
      treatmentPlanPlaceholder: string;
      controls: string;
      businessServices: string;
      businessServicesPlaceholder: string;
      overview: string;
      noDescription: string;
      riskScores: string;
      inherentScore: string;
      residualScore: string;
      likelihoodLabel: string;
      impactLabel: string;
      assignmentTimeline: string;
      owner: string;
      unassigned: string;
      departmentLabel: string;
      na: string;
      reviewDateLabel: string;
      notSet: string;
      createdLabel: string;
      updatedLabel: string;
      treatmentPlanTitle: string;
      noTreatmentPlan: string;
      controlsTitle: string;
      businessServicesTitle: string;
      tags: string;
      riskAcceptance: string;
      riskAccepted: string;
      approvedByPrefix: (name: string) => string;
      expiresPrefix: (date: string) => string;
      titleRequired: string;
      updatedToast: string;
    };
    form: {
      title: string;
      description: string;
      titleLabel: string;
      titlePlaceholder: string;
      descriptionLabel: string;
      descriptionPlaceholder: string;
      category: string;
      categoryPlaceholder: string;
      department: string;
      departmentPlaceholder: string;
      riskAssessment: string;
      mitigationDetails: string;
      likelihood: string;
      impact: string;
      status: string;
      treatment: string;
      reviewDate: string;
      treatmentPlan: string;
      treatmentPlanPlaceholder: string;
      controls: string;
      businessServices: string;
      businessServicesPlaceholder: string;
      cancel: string;
      creating: string;
      createRisk: string;
      titleRequired: string;
      categoryRequired: string;
      descriptionRequired: string;
      createdToast: string;
    };
    acceptance: {
      title: string;
      description: (title: string) => string;
      riskLabel: string;
      residualScoreLabel: string;
      categoryLabel: string;
      rationaleLabel: string;
      rationalePlaceholder: string;
      rationaleHelp: string;
      expiryLabel: string;
      expiryHelp: string;
      confirmText: string;
      cancel: string;
      processing: string;
      acceptRisk: string;
      rationaleRequired: string;
      rationaleTooShort: string;
      confirmRequired: string;
      acceptedToast: string;
    };
  };
  maturity: {
    categories: {
      people: string;
      process: string;
      technology: string;
      governance: string;
      security: string;
      operations: string;
    };
    dimension: {
      score: string;
      levelPrefix: (current: number, target: number) => string;
      findings: string;
      recommendations: string;
      hideDetails: string;
      showDetails: string;
      viewFullDetails: string;
    };
    budgetDetail: {
      metadata: string;
      amount: string;
      riskReduction: string;
      priority: string;
      fiscalYear: string;
      businessJustification: string;
      linkedRisks: (count: number) => string;
      noRisksLinked: string;
      linkedRecommendations: (count: number) => string;
      noRecommendationsLinked: string;
      owner: string;
      created: string;
      updated: string;
    };
    budgetForm: {
      title: string;
      description: string;
      titleLabel: string;
      titlePlaceholder: string;
      category: string;
      selectCategory: string;
      categories: Record<string, string>;
      type: string;
      capexLabel: string;
      opexLabel: string;
      amount: string;
      currency: () => string;
      priority15: string;
      quarterNotSpecified: string;
      timeline: string;
      fiscalYear: string;
      quarter: string;
      selectQuarter: string;
      businessCase: () => string;
      justification: string;
      justificationPlaceholder: string;
      linkedEntities: string;
      linkedRiskIds: string;
      selectRisks: string;
      linkedRecIds: string;
      linkedRecPlaceholder: string;
      cancel: string;
      creating: string;
      createBudgetItem: string;
      titleRequired: string;
      categoryRequired: string;
      amountRequired: string;
      justificationRequired: string;
      createdToast: string;
    };
  };
  compliance: {
    obligationTypes: { legal: () => string; regulatory: () => string; contractual: () => string; industry_standard: () => string };
    testTypes: { design: string; operating_effectiveness: string };
    testResults: {
      effective: string;
      partially_effective: string;
      ineffective: string;
      not_tested: string;
    };
    obligationDetail: {
      subtitle: (typeLabel: string, jurisdiction: string) => string;
      edit: string;
      type: string;
      jurisdiction: string;
      owner: string;
      mappedControls: string;
      effectiveDate: string;
      reviewDate: string;
      overdueSuffix: string;
      created: string;
      lastUpdated: string;
      description: string;
      complianceProgress: string;
      requirementsMet: string;
      percentComplete: (pct: number) => string;
      requirements: (count: number) => string;
    };
    obligationForm: {
      editTitle: string;
      createTitle: string;
      editDesc: string;
      createDesc: () => string;
      name: string;
      namePlaceholder: string;
      type: string;
      selectType: string;
      jurisdiction: string;
      jurisdictionPlaceholder: string;
      description: string;
      descriptionPlaceholder: string;
      ownerId: string;
      ownerIdPlaceholder: string;
      ownerName: string;
      ownerNamePlaceholder: string;
      effectiveDate: string;
      reviewDate: string;
      cancel: string;
      creating: string;
      updating: string;
      addObligation: string;
      updateObligation: string;
      nameRequired: string;
      typeRequired: string;
      jurisdictionRequired: string;
      descriptionRequired: string;
      createdToast: string;
      updatedToast: string;
    };
    controlTest: {
      title: () => string;
      description: () => string;
      controlId: string;
      controlIdPlaceholder: string;
      controlName: string;
      controlNamePlaceholder: string;
      framework: string;
      frameworkPlaceholder: string;
      testType: string;
      selectTestType: string;
      result: string;
      selectResult: string;
      testerName: string;
      testerNamePlaceholder: string;
      nextTestDate: string;
      findings: string;
      findingsPlaceholder: string;
      cancel: string;
      recording: string;
      recordTest: () => string;
      controlIdRequired: string;
      controlNameRequired: string;
      frameworkRequired: string;
      testTypeRequired: string;
      resultRequired: string;
      testerRequired: string;
      recordedToast: string;
    };
    dependency: {
      frameworkPrefix: (framework: string) => string;
      failureImpact: string;
      framework: string;
      dependsOn: (count: number) => string;
      noUpstream: string;
      dependedBy: (count: number) => string;
      noDownstream: string;
      riskDomains: (count: number) => string;
      noRiskDomains: string;
      complianceDomains: (count: number) => string;
      noComplianceDomains: string;
    };
  };
}

export const vcisoGovLabels: CyberBilingual<VcisoGovLabels> = {
  en: {
    risk: {
      options: {
        level: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
        status: { open: 'Open', mitigated: 'Mitigated', accepted: 'Accepted', closed: 'Closed' },
        treatment: { mitigate: 'Mitigate', transfer: 'Transfer', accept: 'Accept', avoid: 'Avoid' },
      },
      detail: {
        editTitle: 'Edit Risk',
        editDescription: 'Update risk details below',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving...',
        edit: 'Edit',
        titleLabel: 'Title',
        titlePlaceholder: 'Risk title',
        descriptionLabel: 'Description',
        descriptionPlaceholder: 'Describe the risk',
        category: 'Category',
        categoryPlaceholder: 'e.g. Operational',
        department: 'Department',
        departmentPlaceholder: 'e.g. Engineering',
        likelihood: 'Likelihood',
        impact: 'Impact',
        status: 'Status',
        treatment: 'Treatment',
        reviewDate: 'Review Date',
        treatmentPlan: 'Treatment Plan',
        treatmentPlanPlaceholder: 'Describe the treatment plan',
        controls: 'Controls (comma-separated)',
        businessServices: 'Business Services (comma-separated)',
        businessServicesPlaceholder: 'Payment Processing, Customer Portal',
        overview: 'Overview',
        noDescription: 'No description provided.',
        riskScores: 'Risk Scores',
        inherentScore: 'Inherent Score',
        residualScore: 'Residual Score',
        likelihoodLabel: 'Likelihood:',
        impactLabel: 'Impact:',
        assignmentTimeline: 'Assignment & Timeline',
        owner: 'Owner:',
        unassigned: 'Unassigned',
        departmentLabel: 'Department:',
        na: 'N/A',
        reviewDateLabel: 'Review Date:',
        notSet: 'Not set',
        createdLabel: 'Created:',
        updatedLabel: 'Updated:',
        treatmentPlanTitle: 'Treatment Plan',
        noTreatmentPlan: 'No treatment plan documented.',
        controlsTitle: 'Controls',
        businessServicesTitle: 'Business Services',
        tags: 'Tags',
        riskAcceptance: 'Risk Acceptance',
        riskAccepted: 'Risk Accepted',
        approvedByPrefix: (name) => `Approved by: ${name}`,
        expiresPrefix: (date) => `Expires: ${date}`,
        titleRequired: 'Title is required',
        updatedToast: 'Risk updated successfully',
      },
      form: {
        title: 'Add New Risk',
        description: 'Create a new risk entry in the register. All required fields are marked.',
        titleLabel: 'Title',
        titlePlaceholder: 'e.g. Unauthorized access to production database',
        descriptionLabel: 'Description',
        descriptionPlaceholder: 'Detailed description of the risk, including context and potential consequences',
        category: 'Category',
        categoryPlaceholder: 'e.g. Operational, Compliance',
        department: 'Department',
        departmentPlaceholder: 'e.g. Engineering',
        riskAssessment: 'Risk Assessment',
        mitigationDetails: 'Mitigation Details',
        likelihood: 'Likelihood',
        impact: 'Impact',
        status: 'Status',
        treatment: 'Treatment',
        reviewDate: 'Review Date',
        treatmentPlan: 'Treatment Plan',
        treatmentPlanPlaceholder: 'Describe the planned mitigation steps',
        controls: 'Controls (comma-separated)',
        businessServices: 'Business Services (comma-separated)',
        businessServicesPlaceholder: 'Payment Processing, Customer Portal',
        cancel: 'Cancel',
        creating: 'Creating...',
        createRisk: 'Create Risk',
        titleRequired: 'Title is required',
        categoryRequired: 'Category is required',
        descriptionRequired: 'Description is required',
        createdToast: 'Risk created successfully',
      },
      acceptance: {
        title: 'Accept Risk',
        description: (title) => `You are about to accept the risk "${title}". This means the organization acknowledges the risk and chooses not to mitigate it further.`,
        riskLabel: 'Risk:',
        residualScoreLabel: 'Residual Score:',
        categoryLabel: 'Category:',
        rationaleLabel: 'Acceptance Rationale',
        rationalePlaceholder: 'Explain why this risk is being accepted and the business justification for not mitigating it further...',
        rationaleHelp: 'Minimum 20 characters. This will be recorded in the audit trail.',
        expiryLabel: 'Acceptance Expiry Date (optional)',
        expiryHelp: 'If set, the risk acceptance will need to be reviewed by this date.',
        confirmText: "I confirm that I understand the implications of accepting this risk and that the residual risk level is within the organization's risk appetite. This decision will be logged for compliance and audit purposes.",
        cancel: 'Cancel',
        processing: 'Processing...',
        acceptRisk: 'Accept Risk',
        rationaleRequired: 'Acceptance rationale is required',
        rationaleTooShort: 'Please provide a more detailed rationale (at least 20 characters)',
        confirmRequired: 'Please confirm that you understand the implications',
        acceptedToast: 'Risk accepted successfully',
      },
    },
    maturity: {
      categories: {
        people: 'People',
        process: 'Process',
        technology: 'Technology',
        governance: 'Governance',
        security: 'Security',
        operations: 'Operations',
      },
      dimension: {
        score: 'Score',
        levelPrefix: (current, target) => `Level ${current} / ${target}`,
        findings: 'Findings',
        recommendations: 'Recommendations',
        hideDetails: 'Hide Details',
        showDetails: 'Show Details',
        viewFullDetails: 'View Full Details',
      },
      budgetDetail: {
        metadata: 'Budget item details and justification',
        amount: 'Amount',
        riskReduction: 'Risk Reduction',
        priority: 'Priority',
        fiscalYear: 'Fiscal Year',
        businessJustification: 'Business Justification',
        linkedRisks: (count) => `Linked Risks (${count})`,
        noRisksLinked: 'No risks linked',
        linkedRecommendations: (count) => `Linked Recommendations (${count})`,
        noRecommendationsLinked: 'No recommendations linked',
        owner: 'Owner',
        created: 'Created',
        updated: 'Updated',
      },
      budgetForm: {
        title: 'Add Budget Item',
        description: 'Create a new security budget item for investment prioritization. Required fields are marked.',
        titleLabel: 'Title',
        titlePlaceholder: 'e.g. SIEM Platform Upgrade',
        category: 'Category',
        selectCategory: 'Select category',
        categories: {
          'Identity & Access Management': 'Identity & Access Management',
          'Endpoint Security': 'Endpoint Security',
          'Network Security': 'Network Security',
          'Cloud Security': 'Cloud Security',
          'Security Operations': 'Security Operations',
          'Compliance & Governance': 'Compliance & Governance',
          'Training & Awareness': 'Training & Awareness',
          'Incident Response': 'Incident Response',
          'Data Protection': 'Data Protection',
          'Application Security': 'Application Security',
          'Third-Party Risk': 'Third-Party Risk',
          'Other': 'Other',
        },
        type: 'Type',
        capexLabel: 'Capital Expenditure (CapEx)',
        opexLabel: 'Operating Expenditure (OpEx)',
        amount: 'Amount',
        currency: () => 'Currency',
        priority15: 'Priority (1-5)',
        quarterNotSpecified: 'Not specified',
        timeline: 'Timeline',
        fiscalYear: 'Fiscal Year',
        quarter: 'Quarter',
        selectQuarter: 'Select quarter',
        businessCase: () => 'Business Case',
        justification: 'Justification',
        justificationPlaceholder: 'Provide a business justification for this investment, including expected outcomes and risk reduction impact',
        linkedEntities: 'Linked Entities',
        linkedRiskIds: 'Linked risks',
        selectRisks: 'Select risks from the risk register',
        linkedRecIds: 'Recommendation references (optional)',
        linkedRecPlaceholder: 'Enter business references separated by commas',
        cancel: 'Cancel',
        creating: 'Creating...',
        createBudgetItem: 'Create Budget Item',
        titleRequired: 'Title is required',
        categoryRequired: 'Category is required',
        amountRequired: 'A valid amount is required',
        justificationRequired: 'Justification is required',
        createdToast: 'Budget item created successfully',
      },
    },
    compliance: {
      obligationTypes: {
        legal: () => 'Legal',
        regulatory: () => 'Regulatory',
        contractual: () => 'Contractual',
        industry_standard: () => 'Industry Standard',
      },
      testTypes: { design: 'Design', operating_effectiveness: 'Operating Effectiveness' },
      testResults: {
        effective: 'Effective',
        partially_effective: 'Partially Effective',
        ineffective: 'Ineffective',
        not_tested: 'Not Tested',
      },
      obligationDetail: {
        subtitle: (typeLabel, jurisdiction) => `${typeLabel} obligation - ${jurisdiction}`,
        edit: 'Edit',
        type: 'Type',
        jurisdiction: 'Jurisdiction',
        owner: 'Owner',
        mappedControls: 'Mapped Controls',
        effectiveDate: 'Effective Date',
        reviewDate: 'Review Date',
        overdueSuffix: ' (Overdue)',
        created: 'Created',
        lastUpdated: 'Last Updated',
        description: 'Description',
        complianceProgress: 'Compliance Progress',
        requirementsMet: 'Requirements Met',
        percentComplete: (pct) => `${pct}% complete`,
        requirements: (count) => `Requirements (${count})`,
      },
      obligationForm: {
        editTitle: 'Edit Obligation',
        createTitle: 'Add Obligation',
        editDesc: 'Update the regulatory obligation details below.',
        createDesc: () => 'Add a new regulatory obligation to your compliance library.',
        name: 'Name',
        namePlaceholder: 'e.g., GDPR Data Processing Requirements',
        type: 'Type',
        selectType: 'Select type',
        jurisdiction: 'Jurisdiction',
        jurisdictionPlaceholder: 'e.g., European Union',
        description: 'Description',
        descriptionPlaceholder: 'Describe the regulatory obligation...',
        ownerId: 'Owner (optional)',
        ownerIdPlaceholder: 'Select an owner (optional)',
        ownerName: 'Owner (optional)',
        ownerNamePlaceholder: 'Search users',
        effectiveDate: 'Effective Date',
        reviewDate: 'Review Date',
        cancel: 'Cancel',
        creating: 'Creating...',
        updating: 'Updating...',
        addObligation: 'Add Obligation',
        updateObligation: 'Update Obligation',
        nameRequired: 'Name is required',
        typeRequired: 'Type is required',
        jurisdictionRequired: 'Jurisdiction is required',
        descriptionRequired: 'Description is required',
        createdToast: 'Obligation created successfully',
        updatedToast: 'Obligation updated successfully',
      },
      controlTest: {
        title: () => 'Record Control Test',
        description: () => 'Record a new control effectiveness test result.',
        controlId: 'Control ID',
        controlIdPlaceholder: 'e.g., AC-2',
        controlName: 'Control Name',
        controlNamePlaceholder: 'e.g., Account Management',
        framework: 'Framework',
        frameworkPlaceholder: 'e.g., NIST 800-53',
        testType: 'Test Type',
        selectTestType: 'Select test type',
        result: 'Result',
        selectResult: 'Select result',
        testerName: 'Tester Name',
        testerNamePlaceholder: 'e.g., Jane Smith',
        nextTestDate: 'Next Test Date',
        findings: 'Findings',
        findingsPlaceholder: 'Describe the test findings...',
        cancel: 'Cancel',
        recording: 'Recording...',
        recordTest: () => 'Record Test',
        controlIdRequired: 'Control ID is required',
        controlNameRequired: 'Control name is required',
        frameworkRequired: 'Framework is required',
        testTypeRequired: 'Test type is required',
        resultRequired: 'Result is required',
        testerRequired: 'Tester name is required',
        recordedToast: 'Test recorded successfully',
      },
      dependency: {
        frameworkPrefix: (framework) => `Framework: ${framework}`,
        failureImpact: 'Failure Impact',
        framework: 'Framework',
        dependsOn: (count) => `Depends On (${count})`,
        noUpstream: 'This control has no upstream dependencies.',
        dependedBy: (count) => `Depended By (${count})`,
        noDownstream: 'No other controls depend on this control.',
        riskDomains: (count) => `Risk Domains (${count})`,
        noRiskDomains: 'No risk domains assigned.',
        complianceDomains: (count) => `Compliance Domains (${count})`,
        noComplianceDomains: 'No compliance domains assigned.',
      },
    },
  },
  ar: {
    risk: {
      options: {
        level: { low: 'منخفض', medium: 'متوسط', high: 'عالٍ', critical: 'حرج' },
        status: { open: 'مفتوح', mitigated: 'مُخفَّف', accepted: 'مقبول', closed: 'مغلق' },
        treatment: { mitigate: 'تخفيف', transfer: 'نقل', accept: 'قبول', avoid: 'تجنّب' },
      },
      detail: {
        editTitle: 'تعديل المخاطرة',
        editDescription: 'حدّث تفاصيل المخاطرة أدناه',
        cancel: 'إلغاء',
        save: 'حفظ',
        saving: 'جارٍ الحفظ...',
        edit: 'تعديل',
        titleLabel: 'العنوان',
        titlePlaceholder: 'عنوان المخاطرة',
        descriptionLabel: 'الوصف',
        descriptionPlaceholder: 'صِف المخاطرة',
        category: 'الفئة',
        categoryPlaceholder: 'مثال: تشغيلية',
        department: 'الإدارة',
        departmentPlaceholder: 'مثال: الهندسة',
        likelihood: 'الاحتمالية',
        impact: 'الأثر',
        status: 'الحالة',
        treatment: 'المعالجة',
        reviewDate: 'تاريخ المراجعة',
        treatmentPlan: 'خطة المعالجة',
        treatmentPlanPlaceholder: 'صِف خطة المعالجة',
        controls: 'الضوابط (مفصولة بفواصل)',
        businessServices: 'خدمات الأعمال (مفصولة بفواصل)',
        businessServicesPlaceholder: 'معالجة المدفوعات، بوابة العملاء',
        overview: 'نظرة عامة',
        noDescription: 'لم يُقدَّم وصف.',
        riskScores: 'درجات المخاطر',
        inherentScore: 'الدرجة الكامنة',
        residualScore: 'الدرجة المتبقية',
        likelihoodLabel: 'الاحتمالية:',
        impactLabel: 'الأثر:',
        assignmentTimeline: 'الإسناد والجدول الزمني',
        owner: 'المسؤول:',
        unassigned: 'غير مُسنَد',
        departmentLabel: 'الإدارة:',
        na: 'غير متاح',
        reviewDateLabel: 'تاريخ المراجعة:',
        notSet: 'غير محدد',
        createdLabel: 'تاريخ الإنشاء:',
        updatedLabel: 'تاريخ التحديث:',
        treatmentPlanTitle: 'خطة المعالجة',
        noTreatmentPlan: 'لم تُوثَّق خطة معالجة.',
        controlsTitle: 'الضوابط',
        businessServicesTitle: 'خدمات الأعمال',
        tags: 'الوسوم',
        riskAcceptance: 'قبول المخاطرة',
        riskAccepted: 'تم قبول المخاطرة',
        approvedByPrefix: (name) => `اعتمده: ${name}`,
        expiresPrefix: (date) => `ينتهي: ${date}`,
        titleRequired: 'العنوان مطلوب',
        updatedToast: 'تم تحديث المخاطرة بنجاح',
      },
      form: {
        title: 'إضافة مخاطرة جديدة',
        description: 'أنشئ مدخل مخاطرة جديدًا في السجل. جميع الحقول المطلوبة مُعلَّمة.',
        titleLabel: 'العنوان',
        titlePlaceholder: 'مثال: وصول غير مصرّح به إلى قاعدة بيانات الإنتاج',
        descriptionLabel: 'الوصف',
        descriptionPlaceholder: 'وصف تفصيلي للمخاطرة، بما في ذلك السياق والعواقب المحتملة',
        category: 'الفئة',
        categoryPlaceholder: 'مثال: تشغيلية، امتثال',
        department: 'الإدارة',
        departmentPlaceholder: 'مثال: الهندسة',
        riskAssessment: 'تقييم المخاطر',
        mitigationDetails: 'تفاصيل التخفيف',
        likelihood: 'الاحتمالية',
        impact: 'الأثر',
        status: 'الحالة',
        treatment: 'المعالجة',
        reviewDate: 'تاريخ المراجعة',
        treatmentPlan: 'خطة المعالجة',
        treatmentPlanPlaceholder: 'صِف خطوات التخفيف المخطَّطة',
        controls: 'الضوابط (مفصولة بفواصل)',
        businessServices: 'خدمات الأعمال (مفصولة بفواصل)',
        businessServicesPlaceholder: 'معالجة المدفوعات، بوابة العملاء',
        cancel: 'إلغاء',
        creating: 'جارٍ الإنشاء...',
        createRisk: 'إنشاء المخاطرة',
        titleRequired: 'العنوان مطلوب',
        categoryRequired: 'الفئة مطلوبة',
        descriptionRequired: 'الوصف مطلوب',
        createdToast: 'تم إنشاء المخاطرة بنجاح',
      },
      acceptance: {
        title: 'قبول المخاطرة',
        description: (title) => `أنت على وشك قبول المخاطرة "${title}". يعني هذا أن المؤسسة تُقرّ بالمخاطرة وتختار عدم تخفيفها أكثر.`,
        riskLabel: 'المخاطرة:',
        residualScoreLabel: 'الدرجة المتبقية:',
        categoryLabel: 'الفئة:',
        rationaleLabel: 'مبرر القبول',
        rationalePlaceholder: 'اشرح سبب قبول هذه المخاطرة والمبرر التجاري لعدم تخفيفها أكثر...',
        rationaleHelp: 'الحد الأدنى 20 حرفًا. سيُسجَّل هذا في مسار التدقيق.',
        expiryLabel: 'تاريخ انتهاء القبول (اختياري)',
        expiryHelp: 'في حال تحديده، سيلزم مراجعة قبول المخاطرة بحلول هذا التاريخ.',
        confirmText: 'أؤكّد أنني أدرك تبعات قبول هذه المخاطرة وأن مستوى المخاطرة المتبقية ضمن حدود تقبّل المؤسسة للمخاطر. سيُسجَّل هذا القرار لأغراض الامتثال والتدقيق.',
        cancel: 'إلغاء',
        processing: 'جارٍ المعالجة...',
        acceptRisk: 'قبول المخاطرة',
        rationaleRequired: 'مبرر القبول مطلوب',
        rationaleTooShort: 'يرجى تقديم مبرر أكثر تفصيلًا (20 حرفًا على الأقل)',
        confirmRequired: 'يرجى تأكيد إدراكك للتبعات',
        acceptedToast: 'تم قبول المخاطرة بنجاح',
      },
    },
    maturity: {
      categories: {
        people: 'الأفراد',
        process: 'العمليات',
        technology: 'التقنية',
        governance: 'الحوكمة',
        security: 'الأمن',
        operations: 'العمليات التشغيلية',
      },
      dimension: {
        score: 'الدرجة',
        levelPrefix: (current, target) => `المستوى ${current} / ${target}`,
        findings: 'النتائج',
        recommendations: 'التوصيات',
        hideDetails: 'إخفاء التفاصيل',
        showDetails: 'عرض التفاصيل',
        viewFullDetails: 'عرض كامل التفاصيل',
      },
      budgetDetail: {
        metadata: 'تفاصيل بند الميزانية ومبرره',
        amount: 'المبلغ',
        riskReduction: 'خفض المخاطر',
        priority: 'الأولوية',
        fiscalYear: 'السنة المالية',
        businessJustification: 'المبرر التجاري',
        linkedRisks: (count) => `المخاطر المرتبطة (${count})`,
        noRisksLinked: 'لا توجد مخاطر مرتبطة',
        linkedRecommendations: (count) => `التوصيات المرتبطة (${count})`,
        noRecommendationsLinked: 'لا توجد توصيات مرتبطة',
        owner: 'المسؤول',
        created: 'تاريخ الإنشاء',
        updated: 'تاريخ التحديث',
      },
      budgetForm: {
        title: 'إضافة بند ميزانية',
        description: 'أنشئ بند ميزانية أمنية جديدًا لترتيب أولويات الاستثمار. الحقول المطلوبة مُعلَّمة.',
        titleLabel: 'العنوان',
        titlePlaceholder: 'مثال: ترقية منصة SIEM (إدارة معلومات وأحداث الأمن)',
        category: 'الفئة',
        selectCategory: 'اختر الفئة',
        categories: {
          'Identity & Access Management': 'إدارة الهوية والوصول',
          'Endpoint Security': 'أمن نقاط النهاية',
          'Network Security': 'أمن الشبكات',
          'Cloud Security': 'أمن السحابة',
          'Security Operations': 'العمليات الأمنية',
          'Compliance & Governance': 'الامتثال والحوكمة',
          'Training & Awareness': 'التدريب والتوعية',
          'Incident Response': 'الاستجابة للحوادث',
          'Data Protection': 'حماية البيانات',
          'Application Security': 'أمن التطبيقات',
          'Third-Party Risk': 'مخاطر الطرف الثالث',
          'Other': 'أخرى',
        },
        type: 'النوع',
        capexLabel: 'النفقات الرأسمالية (CapEx)',
        opexLabel: 'النفقات التشغيلية (OpEx)',
        amount: 'المبلغ',
        currency: () => 'العملة',
        priority15: 'الأولوية (1-5)',
        quarterNotSpecified: 'غير محدد',
        timeline: 'الجدول الزمني',
        fiscalYear: 'السنة المالية',
        quarter: 'الربع',
        selectQuarter: 'اختر الربع',
        businessCase: () => 'دراسة الجدوى',
        justification: 'المبرر',
        justificationPlaceholder: 'قدّم مبررًا تجاريًا لهذا الاستثمار، بما في ذلك النتائج المتوقَّعة وأثر خفض المخاطر',
        linkedEntities: 'الكيانات المرتبطة',
        linkedRiskIds: 'المخاطر المرتبطة',
        selectRisks: 'اختر المخاطر من سجل المخاطر',
        linkedRecIds: 'مراجع التوصيات (اختياري)',
        linkedRecPlaceholder: 'أدخل مراجع الأعمال مفصولة بفواصل',
        cancel: 'إلغاء',
        creating: 'جارٍ الإنشاء...',
        createBudgetItem: 'إنشاء بند الميزانية',
        titleRequired: 'العنوان مطلوب',
        categoryRequired: 'الفئة مطلوبة',
        amountRequired: 'مطلوب مبلغ صالح',
        justificationRequired: 'المبرر مطلوب',
        createdToast: 'تم إنشاء بند الميزانية بنجاح',
      },
    },
    compliance: {
      obligationTypes: {
        legal: () => 'قانوني',
        regulatory: () => 'تنظيمي',
        contractual: () => 'تعاقدي',
        industry_standard: () => 'معيار قطاعي',
      },
      testTypes: { design: 'التصميم', operating_effectiveness: 'الفعالية التشغيلية' },
      testResults: {
        effective: 'فعّال',
        partially_effective: 'فعّال جزئيًا',
        ineffective: 'غير فعّال',
        not_tested: 'غير مُختبَر',
      },
      obligationDetail: {
        subtitle: (typeLabel, jurisdiction) => `التزام ${typeLabel} - ${jurisdiction}`,
        edit: 'تعديل',
        type: 'النوع',
        jurisdiction: 'الاختصاص القضائي',
        owner: 'المسؤول',
        mappedControls: 'الضوابط المرتبطة',
        effectiveDate: 'تاريخ السريان',
        reviewDate: 'تاريخ المراجعة',
        overdueSuffix: ' (متأخر)',
        created: 'تاريخ الإنشاء',
        lastUpdated: 'آخر تحديث',
        description: 'الوصف',
        complianceProgress: 'تقدّم الامتثال',
        requirementsMet: 'المتطلبات المستوفاة',
        percentComplete: (pct) => `${pct}% مكتمل`,
        requirements: (count) => `المتطلبات (${count})`,
      },
      obligationForm: {
        editTitle: 'تعديل الالتزام',
        createTitle: 'إضافة التزام',
        editDesc: 'حدّث تفاصيل الالتزام التنظيمي أدناه.',
        createDesc: () => 'أضف متطلبًا تنظيميًا جديدًا إلى مكتبة الامتثال.',
        name: 'الاسم',
        namePlaceholder: 'مثال: متطلبات معالجة البيانات في GDPR',
        type: 'النوع',
        selectType: 'اختر النوع',
        jurisdiction: 'الاختصاص القضائي',
        jurisdictionPlaceholder: 'مثال: الاتحاد الأوروبي',
        description: 'الوصف',
        descriptionPlaceholder: 'صِف الالتزام التنظيمي...',
        ownerId: 'المسؤول (اختياري)',
        ownerIdPlaceholder: 'اختر المسؤول (اختياري)',
        ownerName: 'المسؤول (اختياري)',
        ownerNamePlaceholder: 'ابحث عن مستخدم',
        effectiveDate: 'تاريخ السريان',
        reviewDate: 'تاريخ المراجعة',
        cancel: 'إلغاء',
        creating: 'جارٍ الإنشاء...',
        updating: 'جارٍ التحديث...',
        addObligation: 'إضافة التزام',
        updateObligation: 'تحديث الالتزام',
        nameRequired: 'الاسم مطلوب',
        typeRequired: 'النوع مطلوب',
        jurisdictionRequired: 'الاختصاص القضائي مطلوب',
        descriptionRequired: 'الوصف مطلوب',
        createdToast: 'تم إنشاء الالتزام بنجاح',
        updatedToast: 'تم تحديث الالتزام بنجاح',
      },
      controlTest: {
        title: () => 'تسجيل اختبار الضابط',
        description: () => 'سجّل نتيجة اختبار فعالية ضابط جديدة.',
        controlId: 'معرّف الضابط',
        controlIdPlaceholder: 'مثال: AC-2',
        controlName: 'اسم الضابط',
        controlNamePlaceholder: 'مثال: إدارة الحسابات',
        framework: 'الإطار',
        frameworkPlaceholder: 'مثال: NIST 800-53',
        testType: 'نوع الاختبار',
        selectTestType: 'اختر نوع الاختبار',
        result: 'النتيجة',
        selectResult: 'اختر النتيجة',
        testerName: 'اسم المختبِر',
        testerNamePlaceholder: 'مثال: جين سميث',
        nextTestDate: 'تاريخ الاختبار التالي',
        findings: 'النتائج',
        findingsPlaceholder: 'صِف نتائج الاختبار...',
        cancel: 'إلغاء',
        recording: 'جارٍ التسجيل...',
        recordTest: () => 'تسجيل الاختبار',
        controlIdRequired: 'معرّف الضابط مطلوب',
        controlNameRequired: 'اسم الضابط مطلوب',
        frameworkRequired: 'الإطار مطلوب',
        testTypeRequired: 'نوع الاختبار مطلوب',
        resultRequired: 'النتيجة مطلوبة',
        testerRequired: 'اسم المختبِر مطلوب',
        recordedToast: 'تم تسجيل الاختبار بنجاح',
      },
      dependency: {
        frameworkPrefix: (framework) => `الإطار: ${framework}`,
        failureImpact: 'أثر الفشل',
        framework: 'الإطار',
        dependsOn: (count) => `يعتمد على (${count})`,
        noUpstream: 'لا توجد لهذا الضابط اعتماديات أعلى.',
        dependedBy: (count) => `يعتمد عليه (${count})`,
        noDownstream: 'لا توجد ضوابط أخرى تعتمد على هذا الضابط.',
        riskDomains: (count) => `مجالات المخاطر (${count})`,
        noRiskDomains: 'لم تُسنَد مجالات مخاطر.',
        complianceDomains: (count) => `مجالات الامتثال (${count})`,
        noComplianceDomains: 'لم تُسنَد مجالات امتثال.',
      },
    },
  },
};

export function useVcisoGovLabels(): VcisoGovLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoGovLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoGovLabels);

// ---------------------------------------------------------------------------
// Operational sub-pages: incident-readiness, integrations, third-party.
// Some enum labels ('Legal', 'Regulator') collide with unrelated glossary terms
// (legal consultation / regulator authority) so they are kept as `() => string`
// factory leaves — the termbase walker only maps paired string leaves.
// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
// ---------------------------------------------------------------------------

export interface VcisoOpsLabels {
  incidentReadiness: {
    escalationRule: {
      triggerTypes: { severity: string; time: string; count: string; custom: string };
      targets: Record<string, () => string>;
      detail: {
        subtitle: string;
        overview: string;
        noDescription: string;
        enabled: string;
        disabled: string;
        triggerConfig: string;
        triggerTypeLabel: string;
        conditionLabel: string;
        escalationTarget: string;
        targetLabel: string;
        targetContacts: string;
        notificationChannels: string;
        triggerHistory: string;
        triggerCount: string;
        lastTriggered: string;
        never: string;
        timestamps: string;
        created: string;
        updated: string;
      };
      form: {
        createTitle: string;
        editTitle: string;
        createDesc: string;
        editDesc: string;
        name: string;
        namePlaceholder: string;
        description: string;
        descriptionPlaceholder: string;
        triggerConfig: string;
        triggerType: string;
        escalationTarget: string;
        triggerCondition: string;
        triggerConditionHelp: string;
        contactsNotifications: string;
        targetContacts: string;
        notificationChannels: string;
        cancel: string;
        saving: string;
        creating: string;
        saveChanges: string;
        createRule: string;
        nameRequired: string;
        conditionRequired: string;
        channelRequired: string;
        createdToast: string;
        updatedToast: string;
      };
    };
    playbook: {
      statuses: { draft: string; approved: string; tested: string; retired: string };
      detail: {
        subtitle: () => string;
        overview: string;
        scenario: string;
        noScenario: string;
        recoveryObjectives: string;
        rtoLabel: string;
        rpoLabel: string;
        details: string;
        owner: string;
        unassigned: string;
        steps: string;
        lastSimulation: string;
        neverTested: string;
        testingSchedule: string;
        lastTested: string;
        nextTest: string;
        never: string;
        overdueSuffix: string;
        dependencies: string;
        timestamps: string;
        created: string;
        updated: string;
      };
      form: {
        createTitle: () => string;
        editTitle: () => string;
        createDesc: () => string;
        editDesc: () => string;
        name: string;
        namePlaceholder: () => string;
        scenario: string;
        scenarioPlaceholder: () => string;
        status: string;
        stepsCount: string;
        recoveryObjectives: string;
        rtoHours: string;
        rtoHelp: string;
        rpoHours: string;
        rpoHelp: string;
        scheduleDependencies: string;
        nextTestDate: string;
        dependencies: string;
        dependenciesPlaceholder: () => string;
        cancel: string;
        saving: string;
        creating: string;
        saveChanges: string;
        createPlaybook: () => string;
        nameRequired: string;
        scenarioRequired: string;
        nextTestRequired: string;
        stepsInvalid: string;
        rtoInvalid: string;
        rpoInvalid: string;
        createdToast: () => string;
        updatedToast: () => string;
      };
    };
  };
  integrations: {
    types: Record<string, string>;
    syncFrequencies: Record<string, () => string>;
    card: {
      viewDetails: string;
      configure: string;
      syncNow: string;
      syncing: string;
      reconnect: string;
      disconnect: string;
      remove: string;
      itemsSynced: string;
      frequency: string;
      lastSync: string;
      never: string;
    };
    detail: {
      subtitle: (provider: string, typeLabel: string) => string;
      errorTitle: string;
      syncInformation: string;
      itemsSynced: string;
      syncFrequency: string;
      lastSync: string;
      provider: string;
      never: string;
      configuration: (count: number) => string;
      noConfig: string;
      timeline: string;
      created: string;
      updated: string;
      syncNow: string;
      syncing: string;
      configure: string;
      reconnect: string;
      disconnect: string;
      remove: string;
    };
    form: {
      createTitle: string;
      editTitle: string;
      createDesc: string;
      editDesc: string;
      name: string;
      namePlaceholder: string;
      type: string;
      selectType: string;
      provider: string;
      providerPlaceholder: string;
      syncFrequency: string;
      selectFrequency: string;
      configJson: string;
      invalidJson: string;
      configHelp: string;
      cancel: string;
      saving: string;
      adding: string;
      saveChanges: string;
      addIntegration: string;
      createdToast: string;
      updatedToast: string;
    };
    sync: { syncNow: string; syncing: string; triggeredToast: string };
  };
  thirdParty: {
    vendor: {
      riskTiers: { critical: string; high: string; medium: string; low: string };
      statuses: {
        active: string;
        onboarding: string;
        under_review: string;
        offboarding: string;
        terminated: string;
      };
      categories: Record<string, () => string>;
      detail: {
        editTitle: string;
        editDescription: string;
        cancel: string;
        save: string;
        saving: string;
        edit: string;
        name: string;
        namePlaceholder: string;
        category: string;
        categoryPlaceholder: string;
        riskTier: string;
        status: string;
        contactName: string;
        contactNamePlaceholder: string;
        contactEmail: string;
        nextReviewDate: string;
        servicesProvided: string;
        servicesPlaceholder: string;
        dataShared: string;
        dataPlaceholder: string;
        overview: string;
        riskAssessment: string;
        riskScore: string;
        openFindings: string;
        controlsCoverage: string;
        contactDetails: string;
        contact: string;
        notProvided: string;
        email: string;
        timeline: string;
        lastAssessment: string;
        never: string;
        nextReview: string;
        created: string;
        updated: string;
        servicesTitle: string;
        dataTitle: string;
        complianceFrameworks: string;
        openFindingsCount: (count: number) => string;
        openFindingsWarning: string;
        fullyCompliant: string;
        fullyCompliantNote: string;
        nameRequired: string;
        updatedToast: string;
      };
      form: {
        createTitle: string;
        editTitle: string;
        createDesc: string;
        editDesc: string;
        name: string;
        namePlaceholder: string;
        category: string;
        selectCategory: string;
        riskTier: string;
        servicesProvided: string;
        servicesPlaceholder: string;
        dataShared: string;
        dataPlaceholder: string;
        contactName: string;
        contactNamePlaceholder: string;
        contactEmail: string;
        nextReviewDate: string;
        cancel: string;
        updating: string;
        adding: string;
        updateVendor: string;
        addVendor: string;
        nameRequired: string;
        categoryRequired: string;
        nextReviewRequired: string;
        createdToast: string;
        updatedToast: string;
      };
    };
    questionnaire: {
      types: { vendor: string; customer: string; audit: string; internal: string };
      form: {
        createTitle: string;
        editTitle: string;
        createDesc: string;
        editDesc: string;
        title: string;
        titlePlaceholder: string;
        type: string;
        totalQuestions: string;
        vendorId: string;
        vendorIdPlaceholder: string;
        vendorName: string;
        vendorNamePlaceholder: string;
        dueDate: string;
        assignedTo: string;
        assignedToPlaceholder: string;
        assigneeName: string;
        assigneeNamePlaceholder: string;
        cancel: string;
        updating: string;
        creating: string;
        updateQuestionnaire: string;
        createQuestionnaire: string;
        titleRequired: string;
        totalQuestionsMin: string;
        dueDateRequired: string;
        createdToast: string;
        updatedToast: string;
      };
    };
  };
}

export const vcisoOpsLabels: CyberBilingual<VcisoOpsLabels> = {
  en: {
    incidentReadiness: {
      escalationRule: {
        triggerTypes: { severity: 'Severity', time: 'Time', count: 'Count', custom: 'Custom' },
        targets: {
          management: () => 'Management',
          legal: () => 'Legal',
          regulator: () => 'Regulator',
          board: () => 'Board',
          custom: () => 'Custom',
        },
        detail: {
          subtitle: 'Escalation Rule Details',
          overview: 'Overview',
          noDescription: 'No description provided.',
          enabled: 'Enabled',
          disabled: 'Disabled',
          triggerConfig: 'Trigger Configuration',
          triggerTypeLabel: 'Trigger Type:',
          conditionLabel: 'Condition:',
          escalationTarget: 'Escalation Target',
          targetLabel: 'Target:',
          targetContacts: 'Target Contacts',
          notificationChannels: 'Notification Channels',
          triggerHistory: 'Trigger History',
          triggerCount: 'Trigger Count:',
          lastTriggered: 'Last Triggered:',
          never: 'Never',
          timestamps: 'Timestamps',
          created: 'Created:',
          updated: 'Updated:',
        },
        form: {
          createTitle: 'Add Escalation Rule',
          editTitle: 'Edit Escalation Rule',
          createDesc: 'Create a new escalation rule to define when and how incidents are escalated.',
          editDesc: 'Update the escalation rule configuration.',
          name: 'Name',
          namePlaceholder: 'e.g. Critical Alert Escalation',
          description: 'Description',
          descriptionPlaceholder: 'Describe when and why this escalation rule triggers',
          triggerConfig: 'Trigger Configuration',
          triggerType: 'Trigger Type',
          escalationTarget: 'Escalation Target',
          triggerCondition: 'Trigger Condition',
          triggerConditionHelp: 'Define the condition that triggers this escalation rule.',
          contactsNotifications: 'Contacts & Notifications',
          targetContacts: 'Target Contacts (comma-separated)',
          notificationChannels: 'Notification Channels',
          cancel: 'Cancel',
          saving: 'Saving...',
          creating: 'Creating...',
          saveChanges: 'Save Changes',
          createRule: 'Create Rule',
          nameRequired: 'Name is required',
          conditionRequired: 'Trigger condition is required',
          channelRequired: 'At least one notification channel is required',
          createdToast: 'Escalation rule created successfully',
          updatedToast: 'Escalation rule updated successfully',
        },
      },
      playbook: {
        statuses: { draft: 'Draft', approved: 'Approved', tested: 'Tested', retired: 'Retired' },
        detail: {
          subtitle: () => 'Crisis Playbook Details',
          overview: 'Overview',
          scenario: 'Scenario',
          noScenario: 'No scenario description provided.',
          recoveryObjectives: 'Recovery Objectives',
          rtoLabel: 'Recovery Time Objective',
          rpoLabel: 'Recovery Point Objective',
          details: 'Details',
          owner: 'Owner:',
          unassigned: 'Unassigned',
          steps: 'Steps:',
          lastSimulation: 'Last Simulation:',
          neverTested: 'Never tested',
          testingSchedule: 'Testing Schedule',
          lastTested: 'Last Tested:',
          nextTest: 'Next Test:',
          never: 'Never',
          overdueSuffix: ' (Overdue)',
          dependencies: 'Dependencies',
          timestamps: 'Timestamps',
          created: 'Created:',
          updated: 'Updated:',
        },
        form: {
          createTitle: () => 'Add Crisis Playbook',
          editTitle: () => 'Edit Playbook',
          createDesc: () => 'Create a new crisis playbook to document incident response procedures.',
          editDesc: () => 'Update the crisis playbook configuration.',
          name: 'Name',
          namePlaceholder: () => 'e.g. Ransomware Response Playbook',
          scenario: 'Scenario',
          scenarioPlaceholder: () => 'Describe the crisis scenario this playbook addresses, including scope and expected impact',
          status: 'Status',
          stepsCount: 'Steps Count',
          recoveryObjectives: 'Recovery Objectives',
          rtoHours: 'RTO (hours)',
          rtoHelp: 'Recovery Time Objective',
          rpoHours: 'RPO (hours)',
          rpoHelp: 'Recovery Point Objective',
          scheduleDependencies: 'Schedule & Dependencies',
          nextTestDate: 'Next Test Date',
          dependencies: 'Dependencies (comma-separated)',
          dependenciesPlaceholder: () => 'Backup Systems, Communication Plan, External Counsel',
          cancel: 'Cancel',
          saving: 'Saving...',
          creating: 'Creating...',
          saveChanges: 'Save Changes',
          createPlaybook: () => 'Create Playbook',
          nameRequired: 'Name is required',
          scenarioRequired: 'Scenario is required',
          nextTestRequired: 'Next test date is required',
          stepsInvalid: 'Steps count must be a valid positive number',
          rtoInvalid: 'RTO must be a valid positive number',
          rpoInvalid: 'RPO must be a valid positive number',
          createdToast: () => 'Playbook created successfully',
          updatedToast: () => 'Playbook updated successfully',
        },
      },
    },
    integrations: {
      types: {
        ticketing: 'Ticketing',
        cloud_security: 'Cloud Security',
        asset_management: 'Asset Management',
        data_protection: 'Data Protection',
        siem: 'SIEM',
        iam: 'IAM',
      },
      syncFrequencies: {
        every_5m: () => 'Every 5 minutes',
        every_15m: () => 'Every 15 minutes',
        every_hour: () => 'Every hour',
        every_6h: () => 'Every 6 hours',
        daily: () => 'Daily',
      },
      card: {
        viewDetails: 'View Details',
        configure: 'Configure',
        syncNow: 'Sync Now',
        syncing: 'Syncing...',
        reconnect: 'Reconnect',
        disconnect: 'Disconnect',
        remove: 'Remove',
        itemsSynced: 'items synced',
        frequency: 'frequency',
        lastSync: 'last sync',
        never: 'Never',
      },
      detail: {
        subtitle: (provider, typeLabel) => `${provider} - ${typeLabel}`,
        errorTitle: 'Error',
        syncInformation: 'Sync Information',
        itemsSynced: 'Items Synced',
        syncFrequency: 'Sync Frequency',
        lastSync: 'Last Sync',
        provider: 'Provider',
        never: 'Never',
        configuration: (count) => `Configuration (${count} ${count === 1 ? 'parameter' : 'parameters'})`,
        noConfig: 'No configuration parameters set',
        timeline: 'Timeline',
        created: 'Created',
        updated: 'Updated',
        syncNow: 'Sync Now',
        syncing: 'Syncing...',
        configure: 'Configure',
        reconnect: 'Reconnect',
        disconnect: 'Disconnect',
        remove: 'Remove',
      },
      form: {
        createTitle: 'Add Integration',
        editTitle: 'Edit Integration',
        createDesc: 'Connect a new external service to your security platform.',
        editDesc: 'Update the integration configuration.',
        name: 'Name *',
        namePlaceholder: 'e.g., Jira Cloud, AWS Security Hub',
        type: 'Type *',
        selectType: 'Select type',
        provider: 'Provider *',
        providerPlaceholder: 'e.g., Atlassian, AWS, CrowdStrike',
        syncFrequency: 'Sync Frequency',
        selectFrequency: 'Select frequency',
        configJson: 'Configuration (JSON)',
        invalidJson: 'Invalid JSON format',
        configHelp: 'Enter connection configuration as a JSON object. Sensitive values will be encrypted.',
        cancel: 'Cancel',
        saving: 'Saving...',
        adding: 'Adding...',
        saveChanges: 'Save Changes',
        addIntegration: 'Add Integration',
        createdToast: 'Integration added successfully',
        updatedToast: 'Integration updated successfully',
      },
      sync: {
        syncNow: 'Sync Now',
        syncing: 'Syncing...',
        triggeredToast: 'Sync triggered successfully',
      },
    },
    thirdParty: {
      vendor: {
        riskTiers: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' },
        statuses: {
          active: 'Active',
          onboarding: 'Onboarding',
          under_review: 'Under Review',
          offboarding: 'Offboarding',
          terminated: 'Terminated',
        },
        categories: {
          'Cloud Infrastructure': () => 'Cloud Infrastructure',
          'SaaS Provider': () => 'SaaS Provider',
          'Security Services': () => 'Security Services',
          'Data Analytics': () => 'Data Analytics',
          'Payment Processing': () => 'Payment Processing',
          'Communication': () => 'Communication',
          'HR & Payroll': () => 'HR & Payroll',
          'Legal & Compliance': () => 'Legal & Compliance',
          'Consulting': () => 'Consulting',
          'Other': () => 'Other',
        },
        detail: {
          editTitle: 'Edit Vendor',
          editDescription: 'Update vendor details below',
          cancel: 'Cancel',
          save: 'Save',
          saving: 'Saving...',
          edit: 'Edit',
          name: 'Name',
          namePlaceholder: 'Vendor name',
          category: 'Category',
          categoryPlaceholder: 'e.g. Cloud Infrastructure',
          riskTier: 'Risk Tier',
          status: 'Status',
          contactName: 'Contact Name',
          contactNamePlaceholder: 'Contact person',
          contactEmail: 'Contact Email',
          nextReviewDate: 'Next Review Date',
          servicesProvided: 'Services Provided (comma-separated)',
          servicesPlaceholder: 'Cloud Hosting, CDN, DNS',
          dataShared: 'Data Shared (comma-separated)',
          dataPlaceholder: 'PII, Financial, Logs',
          overview: 'Overview',
          riskAssessment: 'Risk Assessment',
          riskScore: 'Risk Score',
          openFindings: 'Open Findings',
          controlsCoverage: 'Controls Coverage',
          contactDetails: 'Contact Details',
          contact: 'Contact:',
          notProvided: 'Not provided',
          email: 'Email:',
          timeline: 'Timeline',
          lastAssessment: 'Last Assessment:',
          never: 'Never',
          nextReview: 'Next Review:',
          created: 'Created:',
          updated: 'Updated:',
          servicesTitle: 'Services Provided',
          dataTitle: 'Data Shared',
          complianceFrameworks: 'Compliance Frameworks',
          openFindingsCount: (count) => `${count} Open Finding${count !== 1 ? 's' : ''}`,
          openFindingsWarning: 'This vendor has unresolved findings that require attention.',
          fullyCompliant: 'Fully Compliant',
          fullyCompliantNote: 'All controls are met and no open findings.',
          nameRequired: 'Name is required',
          updatedToast: 'Vendor updated successfully',
        },
        form: {
          createTitle: 'Add Vendor',
          editTitle: 'Edit Vendor',
          createDesc: 'Register a new third-party vendor for risk tracking.',
          editDesc: 'Update vendor details below.',
          name: 'Name',
          namePlaceholder: 'e.g., Amazon Web Services',
          category: 'Category',
          selectCategory: 'Select category',
          riskTier: 'Risk Tier',
          servicesProvided: 'Services Provided (comma-separated)',
          servicesPlaceholder: 'Cloud Hosting, CDN, Object Storage',
          dataShared: 'Data Shared (comma-separated)',
          dataPlaceholder: 'PII, Financial Records, Logs',
          contactName: 'Contact Name',
          contactNamePlaceholder: 'John Doe',
          contactEmail: 'Contact Email',
          nextReviewDate: 'Next Review Date',
          cancel: 'Cancel',
          updating: 'Updating...',
          adding: 'Adding...',
          updateVendor: 'Update Vendor',
          addVendor: 'Add Vendor',
          nameRequired: 'Name is required',
          categoryRequired: 'Category is required',
          nextReviewRequired: 'Next review date is required',
          createdToast: 'Vendor added successfully',
          updatedToast: 'Vendor updated successfully',
        },
      },
      questionnaire: {
        types: {
          vendor: 'Vendor Assessment',
          customer: 'Customer Due Diligence',
          audit: 'Audit Questionnaire',
          internal: 'Internal Review',
        },
        form: {
          createTitle: 'Create Questionnaire',
          editTitle: 'Edit Questionnaire',
          createDesc: 'Create a new security assessment questionnaire.',
          editDesc: 'Update the questionnaire details below.',
          title: 'Title',
          titlePlaceholder: 'e.g., SOC 2 Vendor Assessment',
          type: 'Type',
          totalQuestions: 'Total Questions',
          vendorId: 'Vendor (optional)',
          vendorIdPlaceholder: 'Select a vendor (optional)',
          vendorName: 'Vendor (optional)',
          vendorNamePlaceholder: 'Search vendors',
          dueDate: 'Due Date',
          assignedTo: 'Assigned To (optional)',
          assignedToPlaceholder: 'Search users',
          assigneeName: 'Assignee Name (optional)',
          assigneeNamePlaceholder: 'e.g., Jane Smith',
          cancel: 'Cancel',
          updating: 'Updating...',
          creating: 'Creating...',
          updateQuestionnaire: 'Update Questionnaire',
          createQuestionnaire: 'Create Questionnaire',
          titleRequired: 'Title is required',
          totalQuestionsMin: 'Total questions must be at least 1',
          dueDateRequired: 'Due date is required',
          createdToast: 'Questionnaire created successfully',
          updatedToast: 'Questionnaire updated successfully',
        },
      },
    },
  },
  ar: {
    incidentReadiness: {
      escalationRule: {
        triggerTypes: { severity: 'الخطورة', time: 'الوقت', count: 'العدد', custom: 'مخصّص' },
        targets: {
          management: () => 'الإدارة',
          legal: () => 'الشؤون القانونية',
          regulator: () => 'الجهة التنظيمية',
          board: () => 'مجلس الإدارة',
          custom: () => 'مخصّص',
        },
        detail: {
          subtitle: 'تفاصيل قاعدة التصعيد',
          overview: 'نظرة عامة',
          noDescription: 'لم يُقدَّم وصف.',
          enabled: 'مُفعّل',
          disabled: 'مُعطّل',
          triggerConfig: 'إعدادات المُشغِّل',
          triggerTypeLabel: 'نوع المُشغِّل:',
          conditionLabel: 'الشرط:',
          escalationTarget: 'هدف التصعيد',
          targetLabel: 'الهدف:',
          targetContacts: 'جهات الاتصال المستهدَفة',
          notificationChannels: 'قنوات الإشعار',
          triggerHistory: 'سجل المُشغِّل',
          triggerCount: 'مرّات المُشغِّل:',
          lastTriggered: 'آخر تشغيل:',
          never: 'أبدًا',
          timestamps: 'الطوابع الزمنية',
          created: 'تاريخ الإنشاء:',
          updated: 'تاريخ التحديث:',
        },
        form: {
          createTitle: 'إضافة قاعدة تصعيد',
          editTitle: 'تعديل قاعدة التصعيد',
          createDesc: 'أنشئ قاعدة تصعيد جديدة لتحديد متى وكيف تُصعَّد الحوادث.',
          editDesc: 'حدّث إعدادات قاعدة التصعيد.',
          name: 'الاسم',
          namePlaceholder: 'مثال: تصعيد التنبيهات الحرجة',
          description: 'الوصف',
          descriptionPlaceholder: 'صِف متى ولماذا تُشغَّل قاعدة التصعيد هذه',
          triggerConfig: 'إعدادات المُشغِّل',
          triggerType: 'نوع المُشغِّل',
          escalationTarget: 'هدف التصعيد',
          triggerCondition: 'شرط المُشغِّل',
          triggerConditionHelp: 'حدّد الشرط الذي يُشغّل قاعدة التصعيد هذه.',
          contactsNotifications: 'جهات الاتصال والإشعارات',
          targetContacts: 'جهات الاتصال المستهدَفة (مفصولة بفواصل)',
          notificationChannels: 'قنوات الإشعار',
          cancel: 'إلغاء',
          saving: 'جارٍ الحفظ...',
          creating: 'جارٍ الإنشاء...',
          saveChanges: 'حفظ التغييرات',
          createRule: 'إنشاء القاعدة',
          nameRequired: 'الاسم مطلوب',
          conditionRequired: 'شرط المُشغِّل مطلوب',
          channelRequired: 'مطلوب قناة إشعار واحدة على الأقل',
          createdToast: 'تم إنشاء قاعدة التصعيد بنجاح',
          updatedToast: 'تم تحديث قاعدة التصعيد بنجاح',
        },
      },
      playbook: {
        statuses: { draft: 'مسودة', approved: 'معتمد', tested: 'مُختبَر', retired: 'مسحوب' },
        detail: {
          subtitle: () => 'تفاصيل دليل إجراءات الأزمات',
          overview: 'نظرة عامة',
          scenario: 'السيناريو',
          noScenario: 'لم يُقدَّم وصف للسيناريو.',
          recoveryObjectives: 'أهداف الاسترداد',
          rtoLabel: 'هدف زمن الاسترداد (RTO)',
          rpoLabel: 'هدف نقطة الاسترداد (RPO)',
          details: 'التفاصيل',
          owner: 'المسؤول:',
          unassigned: 'غير مُسنَد',
          steps: 'الخطوات:',
          lastSimulation: 'آخر محاكاة:',
          neverTested: 'لم يُختبر مطلقًا',
          testingSchedule: 'جدول الاختبار',
          lastTested: 'آخر اختبار:',
          nextTest: 'الاختبار التالي:',
          never: 'أبدًا',
          overdueSuffix: ' (متأخر)',
          dependencies: 'الاعتماديات',
          timestamps: 'الطوابع الزمنية',
          created: 'تاريخ الإنشاء:',
          updated: 'تاريخ التحديث:',
        },
        form: {
          createTitle: () => 'إضافة دليل إجراءات أزمات',
          editTitle: () => 'تعديل الدليل',
          createDesc: () => 'أنشئ دليل إجراءات أزمات جديدًا لتوثيق إجراءات الاستجابة للحوادث.',
          editDesc: () => 'حدّث إعدادات دليل إجراءات الأزمات.',
          name: 'الاسم',
          namePlaceholder: () => 'مثال: دليل الاستجابة لبرمجيات الفدية',
          scenario: 'السيناريو',
          scenarioPlaceholder: () => 'صِف سيناريو الأزمة الذي يعالجه هذا الدليل، بما في ذلك النطاق والأثر المتوقَّع',
          status: 'الحالة',
          stepsCount: 'عدد الخطوات',
          recoveryObjectives: 'أهداف الاسترداد',
          rtoHours: 'هدف زمن الاسترداد (ساعات)',
          rtoHelp: 'هدف زمن الاسترداد (RTO)',
          rpoHours: 'هدف نقطة الاسترداد (ساعات)',
          rpoHelp: 'هدف نقطة الاسترداد (RPO)',
          scheduleDependencies: 'الجدول والاعتماديات',
          nextTestDate: 'تاريخ الاختبار التالي',
          dependencies: 'الاعتماديات (مفصولة بفواصل)',
          dependenciesPlaceholder: () => 'أنظمة النسخ الاحتياطي، خطة التواصل، مستشار خارجي',
          cancel: 'إلغاء',
          saving: 'جارٍ الحفظ...',
          creating: 'جارٍ الإنشاء...',
          saveChanges: 'حفظ التغييرات',
          createPlaybook: () => 'إنشاء الدليل',
          nameRequired: 'الاسم مطلوب',
          scenarioRequired: 'السيناريو مطلوب',
          nextTestRequired: 'تاريخ الاختبار التالي مطلوب',
          stepsInvalid: 'يجب أن يكون عدد الخطوات رقمًا موجبًا صالحًا',
          rtoInvalid: 'يجب أن يكون هدف زمن الاسترداد (RTO) رقمًا موجبًا صالحًا',
          rpoInvalid: 'يجب أن يكون هدف نقطة الاسترداد (RPO) رقمًا موجبًا صالحًا',
          createdToast: () => 'تم إنشاء الدليل بنجاح',
          updatedToast: () => 'تم تحديث الدليل بنجاح',
        },
      },
    },
    integrations: {
      types: {
        ticketing: 'التذاكر',
        cloud_security: 'أمن السحابة',
        asset_management: 'إدارة الأصول',
        data_protection: 'حماية البيانات',
        siem: 'SIEM — إدارة معلومات وأحداث الأمن',
        iam: 'IAM — إدارة الهوية والوصول',
      },
      syncFrequencies: {
        every_5m: () => 'كل 5 دقائق',
        every_15m: () => 'كل 15 دقيقة',
        every_hour: () => 'كل ساعة',
        every_6h: () => 'كل 6 ساعات',
        daily: () => 'يوميًا',
      },
      card: {
        viewDetails: 'عرض التفاصيل',
        configure: 'تهيئة',
        syncNow: 'مزامنة الآن',
        syncing: 'جارٍ المزامنة...',
        reconnect: 'إعادة الاتصال',
        disconnect: 'قطع الاتصال',
        remove: 'إزالة',
        itemsSynced: 'عناصر متزامنة',
        frequency: 'التكرار',
        lastSync: 'آخر مزامنة',
        never: 'أبدًا',
      },
      detail: {
        subtitle: (provider, typeLabel) => `${provider} - ${typeLabel}`,
        errorTitle: 'خطأ',
        syncInformation: 'معلومات المزامنة',
        itemsSynced: 'العناصر المتزامنة',
        syncFrequency: 'تكرار المزامنة',
        lastSync: 'آخر مزامنة',
        provider: 'المزوّد',
        never: 'أبدًا',
        configuration: (count) => `التهيئة (${count} ${count === 1 ? 'مُعامل' : 'مُعاملات'})`,
        noConfig: 'لا توجد مُعاملات تهيئة',
        timeline: 'الجدول الزمني',
        created: 'تاريخ الإنشاء',
        updated: 'تاريخ التحديث',
        syncNow: 'مزامنة الآن',
        syncing: 'جارٍ المزامنة...',
        configure: 'تهيئة',
        reconnect: 'إعادة الاتصال',
        disconnect: 'قطع الاتصال',
        remove: 'إزالة',
      },
      form: {
        createTitle: 'إضافة تكامل',
        editTitle: 'تعديل التكامل',
        createDesc: 'اربط خدمة خارجية جديدة بمنصة الأمن لديك.',
        editDesc: 'حدّث إعدادات التكامل.',
        name: 'الاسم *',
        namePlaceholder: 'مثال: Jira Cloud، AWS Security Hub',
        type: 'النوع *',
        selectType: 'اختر النوع',
        provider: 'المزوّد *',
        providerPlaceholder: 'مثال: Atlassian، AWS، CrowdStrike',
        syncFrequency: 'تكرار المزامنة',
        selectFrequency: 'اختر التكرار',
        configJson: 'التهيئة (JSON)',
        invalidJson: 'صيغة JSON غير صالحة',
        configHelp: 'أدخل إعدادات الاتصال ككائن JSON. ستُشفَّر القيم الحساسة.',
        cancel: 'إلغاء',
        saving: 'جارٍ الحفظ...',
        adding: 'جارٍ الإضافة...',
        saveChanges: 'حفظ التغييرات',
        addIntegration: 'إضافة التكامل',
        createdToast: 'تمت إضافة التكامل بنجاح',
        updatedToast: 'تم تحديث التكامل بنجاح',
      },
      sync: {
        syncNow: 'مزامنة الآن',
        syncing: 'جارٍ المزامنة...',
        triggeredToast: 'تم تشغيل المزامنة بنجاح',
      },
    },
    thirdParty: {
      vendor: {
        riskTiers: { critical: 'حرج', high: 'عالٍ', medium: 'متوسط', low: 'منخفض' },
        statuses: {
          active: 'نشط',
          onboarding: 'قيد الإعداد',
          under_review: 'قيد المراجعة',
          offboarding: 'قيد الإنهاء',
          terminated: 'منتهٍ',
        },
        categories: {
          'Cloud Infrastructure': () => 'البنية التحتية السحابية',
          'SaaS Provider': () => 'مزوّد برمجيات كخدمة (SaaS)',
          'Security Services': () => 'خدمات أمنية',
          'Data Analytics': () => 'تحليلات البيانات',
          'Payment Processing': () => 'معالجة المدفوعات',
          'Communication': () => 'الاتصالات',
          'HR & Payroll': () => 'الموارد البشرية والرواتب',
          'Legal & Compliance': () => 'الشؤون القانونية والامتثال',
          'Consulting': () => 'الاستشارات',
          'Other': () => 'أخرى',
        },
        detail: {
          editTitle: 'تعديل المورد',
          editDescription: 'حدّث تفاصيل المورد أدناه',
          cancel: 'إلغاء',
          save: 'حفظ',
          saving: 'جارٍ الحفظ...',
          edit: 'تعديل',
          name: 'الاسم',
          namePlaceholder: 'اسم المورد',
          category: 'الفئة',
          categoryPlaceholder: 'مثال: البنية التحتية السحابية',
          riskTier: 'مستوى المخاطر',
          status: 'الحالة',
          contactName: 'اسم جهة الاتصال',
          contactNamePlaceholder: 'الشخص المسؤول',
          contactEmail: 'البريد الإلكتروني لجهة الاتصال',
          nextReviewDate: 'تاريخ المراجعة التالية',
          servicesProvided: 'الخدمات المقدَّمة (مفصولة بفواصل)',
          servicesPlaceholder: 'استضافة سحابية، CDN، DNS',
          dataShared: 'البيانات المشتركة (مفصولة بفواصل)',
          dataPlaceholder: 'PII، بيانات مالية، سجلات',
          overview: 'نظرة عامة',
          riskAssessment: 'تقييم المخاطر',
          riskScore: 'درجة المخاطر',
          openFindings: 'النتائج المفتوحة',
          controlsCoverage: 'تغطية الضوابط',
          contactDetails: 'تفاصيل الاتصال',
          contact: 'جهة الاتصال:',
          notProvided: 'غير متوفّر',
          email: 'البريد الإلكتروني:',
          timeline: 'الجدول الزمني',
          lastAssessment: 'آخر تقييم:',
          never: 'أبدًا',
          nextReview: 'المراجعة التالية:',
          created: 'تاريخ الإنشاء:',
          updated: 'تاريخ التحديث:',
          servicesTitle: 'الخدمات المقدَّمة',
          dataTitle: 'البيانات المشتركة',
          complianceFrameworks: 'أطر الامتثال',
          openFindingsCount: (count) => `${count} نتيجة مفتوحة`,
          openFindingsWarning: 'لهذا المورد نتائج غير مُعالَجة تتطلّب اهتمامًا.',
          fullyCompliant: 'ممتثل بالكامل',
          fullyCompliantNote: 'جميع الضوابط مستوفاة ولا توجد نتائج مفتوحة.',
          nameRequired: 'الاسم مطلوب',
          updatedToast: 'تم تحديث المورد بنجاح',
        },
        form: {
          createTitle: 'إضافة مورد',
          editTitle: 'تعديل المورد',
          createDesc: 'سجّل موردًا من طرف ثالث جديدًا لتتبّع المخاطر.',
          editDesc: 'حدّث تفاصيل المورد أدناه.',
          name: 'الاسم',
          namePlaceholder: 'مثال: Amazon Web Services',
          category: 'الفئة',
          selectCategory: 'اختر الفئة',
          riskTier: 'مستوى المخاطر',
          servicesProvided: 'الخدمات المقدَّمة (مفصولة بفواصل)',
          servicesPlaceholder: 'استضافة سحابية، CDN، تخزين كائنات',
          dataShared: 'البيانات المشتركة (مفصولة بفواصل)',
          dataPlaceholder: 'PII، سجلات مالية، سجلات',
          contactName: 'اسم جهة الاتصال',
          contactNamePlaceholder: 'جون دو',
          contactEmail: 'البريد الإلكتروني لجهة الاتصال',
          nextReviewDate: 'تاريخ المراجعة التالية',
          cancel: 'إلغاء',
          updating: 'جارٍ التحديث...',
          adding: 'جارٍ الإضافة...',
          updateVendor: 'تحديث المورد',
          addVendor: 'إضافة المورد',
          nameRequired: 'الاسم مطلوب',
          categoryRequired: 'الفئة مطلوبة',
          nextReviewRequired: 'تاريخ المراجعة التالية مطلوب',
          createdToast: 'تمت إضافة المورد بنجاح',
          updatedToast: 'تم تحديث المورد بنجاح',
        },
      },
      questionnaire: {
        types: {
          vendor: 'تقييم مورد',
          customer: 'العناية الواجبة للعميل',
          audit: 'استبيان تدقيق',
          internal: 'مراجعة داخلية',
        },
        form: {
          createTitle: 'إنشاء استبيان',
          editTitle: 'تعديل الاستبيان',
          createDesc: 'أنشئ استبيان تقييم أمني جديدًا.',
          editDesc: 'حدّث تفاصيل الاستبيان أدناه.',
          title: 'العنوان',
          titlePlaceholder: 'مثال: تقييم مورد SOC 2',
          type: 'النوع',
          totalQuestions: 'إجمالي الأسئلة',
          vendorId: 'المورد (اختياري)',
          vendorIdPlaceholder: 'اختر موردًا (اختياري)',
          vendorName: 'المورد (اختياري)',
          vendorNamePlaceholder: 'ابحث عن مورد',
          dueDate: 'تاريخ الاستحقاق',
          assignedTo: 'مُسنَد إلى (اختياري)',
          assignedToPlaceholder: 'ابحث عن مستخدم',
          assigneeName: 'اسم المُكلَّف (اختياري)',
          assigneeNamePlaceholder: 'مثال: جين سميث',
          cancel: 'إلغاء',
          updating: 'جارٍ التحديث...',
          creating: 'جارٍ الإنشاء...',
          updateQuestionnaire: 'تحديث الاستبيان',
          createQuestionnaire: 'إنشاء الاستبيان',
          titleRequired: 'العنوان مطلوب',
          totalQuestionsMin: 'يجب أن يكون إجمالي الأسئلة 1 على الأقل',
          dueDateRequired: 'تاريخ الاستحقاق مطلوب',
          createdToast: 'تم إنشاء الاستبيان بنجاح',
          updatedToast: 'تم تحديث الاستبيان بنجاح',
        },
      },
    },
  },
};

export function useVcisoOpsLabels(): VcisoOpsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoOpsLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoOpsLabels);

// ---------------------------------------------------------------------------
// Hybrid chat transcript (message bubble + diagnostics), the chat hook status
// line, and the Predictive Analytics page.
// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
// ---------------------------------------------------------------------------

export interface VcisoChatLabels {
  hook: {
    statuses: {
      classifying: string;
      executing: string;
      fetching: string;
      building: string;
      investigating: string;
      generating: string;
      thinking: string;
      sending: string;
    };
    processFailed: string;
    loadFailed: string;
  };
  bubble: {
    currentScore: string;
    vsLastPeriod: string;
    gradePrefix: (grade: string) => string;
    riskContributors: string;
    componentN: (n: number) => string;
    highlights: string;
    details: string;
    dashboardCreated: string;
    customDashboard: string;
    widgetN: (n: number) => string;
    moreCount: (n: number) => string;
    openDashboard: string;
    idPrefix: (id: string) => string;
    investigation: string;
    alertInvestigation: string;
    confidencePrefix: string;
    rulePrefix: string;
    detectedPrefix: string;
    whatHappened: string;
    confidenceAnalysis: string;
    matchedConditions: string;
    recommendedActions: string;
    falsePositiveIndicators: string;
    affectedAssets: (n: number) => string;
    colName: string;
    colType: string;
    colCriticality: string;
    colStatus: string;
    relatedAlerts: (n: number) => string;
    alertN: (n: number) => string;
    techniquePrefix: string;
    tacticsPrefix: string;
    behavioralContext: string;
    entityPrefix: string;
    riskScorePrefix: string;
    trend: string;
    coverage: string;
    coverageCenter: string;
    covered: string;
    gaps: string;
    topGaps: string;
    unknown: string;
    itemN: (n: number) => string;
    count: string;
    yes: string;
    no: string;
    moreRows: (n: number) => string;
  };
  diagnostics: {
    groundingPrefix: string;
    tokensSuffix: string;
    reasoningStepsSuffix: string;
    viewTrace: string;
    routePrefix: string;
    llmTrace: string;
    traceDescription: string;
    engine: string;
    noRoutingReason: string;
    grounding: string;
    createdPrefix: (when: string) => string;
    tokens: string;
    tokenEstimate: string;
    promptCompletion: (prompt: string, completion: string) => string;
    reasoning: string;
    toolCallsRecorded: (n: number) => string;
    reasoningFromMeta: string;
    loadingTrace: string;
    provider: string;
    routing: string;
    logged: string;
    messagePrefix: (id: string) => string;
    reasoningTrace: string;
    noReasoningTrace: string;
    stepPrefix: (step: number, action: string) => string;
    toolsSuffix: (n: number) => string;
    toolCalls: string;
    noToolCalls: string;
    success: string;
    failed: string;
    msSuffix: (ms: number) => string;
    arguments: string;
    deterministic: string;
    fallback: string;
  };
  predict: {
    eyebrow: string;
    title: string;
    description: string;
    predictionModels: string;
    loadedSuffix: (n: number) => string;
    averageConfidence: string;
    acrossLoaded: string;
    accuracyDashboard: string;
    ready: string;
    loading: string;
    awaitingTelemetry: string;
    retrainControls: string;
    manualAdminTrigger: string;
    forecastTitle: string;
    forecastDesc: string;
    assetTitle: string;
    assetDesc: string;
    vulnTitle: string;
    vulnDesc: string;
    techTitle: string;
    techDesc: string;
    insiderTitle: string;
    insiderDesc: string;
    campaignTitle: string;
    campaignDesc: string;
    accuracyTitle: string;
    accuracyDesc: string;
    retrainTitle: string;
    retrainDesc: string;
    retrain: string;
    retrainQueued: (model: string) => string;
    loadingPrediction: string;
    confidenceBadge: (pct: number) => string;
    modelPrefix: (version: string) => string;
    rankedItems: (n: number) => string;
    predictionPayload: string;
    noPrediction: string;
  };
}

export const vcisoChatLabels: CyberBilingual<VcisoChatLabels> = {
  en: {
    hook: {
      statuses: {
        classifying: 'Classifying request...',
        executing: 'Executing tool...',
        fetching: 'Fetching data...',
        building: 'Building dashboard...',
        investigating: 'Analyzing alert...',
        generating: 'Generating report...',
        thinking: 'vCISO is thinking...',
        sending: 'Sending request...',
      },
      processFailed: 'Failed to process request',
      loadFailed: 'Failed to load conversation',
    },
    bubble: {
      currentScore: 'Current Score',
      vsLastPeriod: 'vs last period',
      gradePrefix: (grade) => `Grade: ${grade}`,
      riskContributors: 'Risk Contributors',
      componentN: (n) => `Component ${n}`,
      highlights: 'Highlights',
      details: 'Details',
      dashboardCreated: 'Dashboard Created',
      customDashboard: 'Custom Dashboard',
      widgetN: (n) => `Widget ${n}`,
      moreCount: (n) => `+${n} more`,
      openDashboard: 'Open Dashboard',
      idPrefix: (id) => `ID: ${id}`,
      investigation: 'Investigation',
      alertInvestigation: 'Alert Investigation',
      confidencePrefix: 'Confidence:',
      rulePrefix: 'Rule:',
      detectedPrefix: 'Detected:',
      whatHappened: 'What Happened',
      confidenceAnalysis: 'Confidence Analysis',
      matchedConditions: 'Matched Conditions',
      recommendedActions: 'Recommended Actions',
      falsePositiveIndicators: 'False Positive Indicators',
      affectedAssets: (n) => `Affected Assets (${n})`,
      colName: 'Name',
      colType: 'Type',
      colCriticality: 'Criticality',
      colStatus: 'Status',
      relatedAlerts: (n) => `Related Alerts (${n})`,
      alertN: (n) => `Alert ${n}`,
      techniquePrefix: 'Technique:',
      tacticsPrefix: 'Tactics:',
      behavioralContext: 'Behavioral Context',
      entityPrefix: 'Entity:',
      riskScorePrefix: 'Risk Score:',
      trend: 'Trend',
      coverage: 'Coverage',
      coverageCenter: 'coverage',
      covered: 'Covered',
      gaps: 'Gaps',
      topGaps: 'Top Gaps',
      unknown: 'Unknown',
      itemN: (n) => `Item ${n}`,
      count: 'Count',
      yes: 'Yes',
      no: 'No',
      moreRows: (n) => `+${n} more rows`,
    },
    diagnostics: {
      groundingPrefix: 'Grounding:',
      tokensSuffix: 'tokens',
      reasoningStepsSuffix: 'reasoning steps',
      viewTrace: 'View trace',
      routePrefix: 'Route:',
      llmTrace: 'LLM Trace',
      traceDescription: 'Inspect routing, token usage, tool calls, and reasoning for this assistant response.',
      engine: 'Engine',
      noRoutingReason: 'No routing reason recorded',
      grounding: 'Grounding',
      createdPrefix: (when) => `Created ${when}`,
      tokens: 'Tokens',
      tokenEstimate: 'Per-response token estimate',
      promptCompletion: (prompt, completion) => `${prompt} prompt / ${completion} completion`,
      reasoning: 'Reasoning',
      toolCallsRecorded: (n) => `${n} tool calls recorded`,
      reasoningFromMeta: 'Reasoning count from response metadata',
      loadingTrace: 'Loading trace details...',
      provider: 'Provider',
      routing: 'Routing',
      logged: 'Logged',
      messagePrefix: (id) => `Message ${id}`,
      reasoningTrace: 'Reasoning Trace',
      noReasoningTrace: 'No explicit reasoning trace recorded.',
      stepPrefix: (step, action) => `Step ${step}: ${action}`,
      toolsSuffix: (n) => `${n} tools`,
      toolCalls: 'Tool Calls',
      noToolCalls: 'This response did not invoke any tools.',
      success: 'Success',
      failed: 'Failed',
      msSuffix: (ms) => `${ms}ms`,
      arguments: 'Arguments',
      deterministic: 'Deterministic',
      fallback: 'Fallback',
    },
    predict: {
      eyebrow: 'Virtual CISO',
      title: 'Predictive Analytics',
      description: 'Forecast alert volume, asset risk, vulnerability exploitability, technique trends, insider risk, and campaigns.',
      predictionModels: 'Prediction models',
      loadedSuffix: (n) => `${n} loaded`,
      averageConfidence: 'Average confidence',
      acrossLoaded: 'Across loaded models',
      accuracyDashboard: 'Accuracy dashboard',
      ready: 'Ready',
      loading: 'Loading',
      awaitingTelemetry: 'Awaiting telemetry',
      retrainControls: 'Retrain controls',
      manualAdminTrigger: 'Manual admin trigger',
      forecastTitle: 'Alert Volume Forecast',
      forecastDesc: 'Projected alert load and confidence for the next 30 days.',
      assetTitle: 'Asset Risk',
      assetDesc: 'Assets predicted to drive the highest security risk.',
      vulnTitle: 'Vulnerability Priority',
      vulnDesc: 'Vulnerabilities ranked by exploit likelihood.',
      techTitle: 'Technique Trends',
      techDesc: 'MITRE technique movement and emerging attack patterns.',
      insiderTitle: 'Insider Threats',
      insiderDesc: 'Entities with elevated behavioral trajectory risk.',
      campaignTitle: 'Campaign Detection',
      campaignDesc: 'Likely campaign clusters and shared indicators.',
      accuracyTitle: 'Accuracy Dashboard',
      accuracyDesc: 'Backtest and drift metrics returned by the prediction engine.',
      retrainTitle: 'Retrain Models',
      retrainDesc: 'Manual retraining is backend-gated to cyber write or admin permissions.',
      retrain: 'Retrain',
      retrainQueued: (model) => `Retrain queued for ${model}`,
      loadingPrediction: 'Loading prediction...',
      confidenceBadge: (pct) => `confidence ${pct}%`,
      modelPrefix: (version) => `model ${version}`,
      rankedItems: (n) => `${n} ranked items`,
      predictionPayload: 'Prediction payload',
      noPrediction: 'No prediction data returned.',
    },
  },
  ar: {
    hook: {
      statuses: {
        classifying: 'جارٍ تصنيف الطلب...',
        executing: 'جارٍ تنفيذ الأداة...',
        fetching: 'جارٍ جلب البيانات...',
        building: 'جارٍ إنشاء لوحة المعلومات...',
        investigating: 'جارٍ تحليل التنبيه...',
        generating: 'جارٍ إنشاء التقرير...',
        thinking: 'مدير أمن المعلومات الافتراضي يفكّر...',
        sending: 'جارٍ إرسال الطلب...',
      },
      processFailed: 'تعذّرت معالجة الطلب',
      loadFailed: 'تعذّر تحميل المحادثة',
    },
    bubble: {
      currentScore: 'الدرجة الحالية',
      vsLastPeriod: 'مقارنةً بالفترة السابقة',
      gradePrefix: (grade) => `التقدير: ${grade}`,
      riskContributors: 'مساهمو المخاطر',
      componentN: (n) => `المكوّن ${n}`,
      highlights: 'أبرز النقاط',
      details: 'التفاصيل',
      dashboardCreated: 'تم إنشاء لوحة المعلومات',
      customDashboard: 'لوحة المعلومات المخصّصة',
      widgetN: (n) => `عنصر ${n}`,
      moreCount: (n) => `+${n} أخرى`,
      openDashboard: 'فتح لوحة المعلومات',
      idPrefix: (id) => `المعرّف: ${id}`,
      investigation: 'تحقيق',
      alertInvestigation: 'تحقيق التنبيه',
      confidencePrefix: 'الثقة:',
      rulePrefix: 'القاعدة:',
      detectedPrefix: 'اكتُشف:',
      whatHappened: 'ما الذي حدث',
      confidenceAnalysis: 'تحليل الثقة',
      matchedConditions: 'الشروط المطابقة',
      recommendedActions: 'الإجراءات الموصى بها',
      falsePositiveIndicators: 'مؤشرات الإنذار الكاذب',
      affectedAssets: (n) => `الأصول المتأثرة (${n})`,
      colName: 'الاسم',
      colType: 'النوع',
      colCriticality: 'الأهمية',
      colStatus: 'الحالة',
      relatedAlerts: (n) => `التنبيهات المرتبطة (${n})`,
      alertN: (n) => `تنبيه ${n}`,
      techniquePrefix: 'الأسلوب:',
      tacticsPrefix: 'التكتيكات:',
      behavioralContext: 'السياق السلوكي',
      entityPrefix: 'الكيان:',
      riskScorePrefix: 'درجة المخاطر:',
      trend: 'الاتجاه',
      coverage: 'التغطية',
      coverageCenter: 'تغطية',
      covered: 'مُغطّى',
      gaps: 'فجوات',
      topGaps: 'أبرز الفجوات',
      unknown: 'غير معروف',
      itemN: (n) => `عنصر ${n}`,
      count: 'العدد',
      yes: 'نعم',
      no: 'لا',
      moreRows: (n) => `+${n} صف إضافي`,
    },
    diagnostics: {
      groundingPrefix: 'الإسناد:',
      tokensSuffix: 'رمز',
      reasoningStepsSuffix: 'خطوة استدلال',
      viewTrace: 'عرض الأثر',
      routePrefix: 'المسار:',
      llmTrace: 'أثر LLM',
      traceDescription: 'افحص التوجيه واستهلاك الرموز واستدعاءات الأدوات والاستدلال لهذا الرد.',
      engine: 'المحرك',
      noRoutingReason: 'لم يُسجَّل سبب التوجيه',
      grounding: 'الإسناد',
      createdPrefix: (when) => `أُنشئ ${when}`,
      tokens: 'الرموز',
      tokenEstimate: 'تقدير الرموز لكل رد',
      promptCompletion: (prompt, completion) => `${prompt} موجِّه / ${completion} إكمال`,
      reasoning: 'الاستدلال',
      toolCallsRecorded: (n) => `${n} استدعاء أداة مُسجَّل`,
      reasoningFromMeta: 'عدد خطوات الاستدلال من بيانات الرد',
      loadingTrace: 'جارٍ تحميل تفاصيل الأثر...',
      provider: 'المزوّد',
      routing: 'التوجيه',
      logged: 'مُسجَّل',
      messagePrefix: (id) => `الرسالة ${id}`,
      reasoningTrace: 'أثر الاستدلال',
      noReasoningTrace: 'لم يُسجَّل أثر استدلال صريح.',
      stepPrefix: (step, action) => `الخطوة ${step}: ${action}`,
      toolsSuffix: (n) => `${n} أداة`,
      toolCalls: 'استدعاءات الأدوات',
      noToolCalls: 'لم يستدعِ هذا الرد أي أدوات.',
      success: 'نجاح',
      failed: 'فشل',
      msSuffix: (ms) => `${ms} مللي ثانية`,
      arguments: 'الوسائط',
      deterministic: 'حتمي',
      fallback: 'احتياطي',
    },
    predict: {
      eyebrow: 'مدير أمن المعلومات الافتراضي',
      title: 'التحليلات التنبؤية',
      description: 'توقّع حجم التنبيهات ومخاطر الأصول وقابلية استغلال الثغرة واتجاهات الأساليب ومخاطر التهديد الداخلي والحملات.',
      predictionModels: 'نماذج التنبؤ',
      loadedSuffix: (n) => `${n} مُحمَّل`,
      averageConfidence: 'متوسط الثقة',
      acrossLoaded: 'عبر النماذج المُحمَّلة',
      accuracyDashboard: 'لوحة المعلومات الخاصة بالدقة',
      ready: 'جاهزة',
      loading: 'جارٍ التحميل',
      awaitingTelemetry: 'بانتظار القياسات',
      retrainControls: 'ضوابط إعادة التدريب',
      manualAdminTrigger: 'مُشغِّل يدوي من المشرف',
      forecastTitle: 'توقّع حجم التنبيهات',
      forecastDesc: 'حِمل التنبيهات المتوقَّع والثقة لل30 يومًا القادمة.',
      assetTitle: 'مخاطر الأصول',
      assetDesc: 'الأصول المتوقَّع أن تسبّب أعلى مخاطر أمنية.',
      vulnTitle: 'أولوية الثغرة الأمنية',
      vulnDesc: 'الثغرات مُرتَّبة حسب احتمالية الاستغلال.',
      techTitle: 'اتجاهات الأساليب',
      techDesc: 'حركة أساليب MITRE وأنماط الهجوم الناشئة.',
      insiderTitle: 'التهديدات الداخلية',
      insiderDesc: 'الكيانات ذات مسار سلوكي مرتفع المخاطر.',
      campaignTitle: 'اكتشاف الحملات',
      campaignDesc: 'التجمّعات المحتملة للحملات والمؤشرات المشتركة.',
      accuracyTitle: 'لوحة المعلومات الخاصة بالدقة',
      accuracyDesc: 'مقاييس الاختبار الرجعي والانحراف التي يعيدها محرّك التنبؤ.',
      retrainTitle: 'إعادة تدريب النماذج',
      retrainDesc: 'إعادة التدريب اليدوية مقيَّدة بصلاحيات الكتابة أو الإدارة في الأمن السيبراني.',
      retrain: 'إعادة التدريب',
      retrainQueued: (model) => `تمّت جدولة إعادة التدريب لـ ${model}`,
      loadingPrediction: 'جارٍ تحميل التنبؤ...',
      confidenceBadge: (pct) => `الثقة ${pct}%`,
      modelPrefix: (version) => `النموذج ${version}`,
      rankedItems: (n) => `${n} عنصر مُرتَّب`,
      predictionPayload: 'حمولة التنبؤ',
      noPrediction: 'لم تُعَد بيانات تنبؤ.',
    },
  },
};

export function useVcisoChatLabels(): VcisoChatLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoChatLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoChatLabels);

// ---------------------------------------------------------------------------
// Workflows (approvals, control ownership) + Policies (form, exception, detail,
// AI draft generator) sub-page detail panels & dialogs.
// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
// ---------------------------------------------------------------------------

export interface VcisoWorkflowLabels {
  approvalTypes: {
    risk_acceptance: string;
    policy_exception: string;
    remediation: string;
    budget: string;
    vendor_onboarding: string;
  };
  priorities: { critical: string; high: string; medium: string; low: string };
  approvalAction: {
    approveTitle: string;
    rejectTitle: string;
    escalateTitle: string;
    approveDesc: (title: string) => string;
    rejectDesc: (title: string) => string;
    escalateDesc: (title: string) => string;
    approveConfirm: string;
    rejectConfirm: string;
    escalateConfirm: string;
    decisionNotes: string;
    decisionNotesRequired: string;
    notesPlaceholder: string;
    cancel: string;
    processing: string;
    approvedToast: string;
    rejectedToast: string;
    escalatedToast: string;
  };
  createApproval: {
    title: string;
    description: () => string;
    type: string;
    selectType: string;
    titleLabel: string;
    titlePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    priority: string;
    selectPriority: string;
    deadline: string;
    approverId: string;
    approverIdPlaceholder: string;
    approverName: string;
    approverNamePlaceholder: string;
    linkedEntityType: string;
    linkedEntityTypePlaceholder: string;
    linkedEntityId: string;
    linkedEntityIdPlaceholder: string;
    cancel: string;
    creating: string;
    createRequest: string;
    createdToast: string;
    vTypeRequired: string;
    vTitleMin: string;
    vUuid: string;
    vApproverName: string;
    vPriorityRequired: string;
    vDeadlineRequired: string;
  };
  approvalDetail: {
    requestDetails: string;
    type: string;
    priority: string;
    requestedBy: string;
    approver: string;
    deadline: string;
    overdueSuffix: string;
    created: string;
    linkedEntity: string;
    description: string;
    decision: string;
    decidedPrefix: (when: string) => string;
    makeDecision: string;
    decisionNotes: string;
    notesPlaceholder: string;
    approve: string;
    approving: string;
    reject: string;
    rejecting: string;
    escalate: string;
    escalating: string;
    notesRequired: string;
    grantedToast: string;
    rejectedToast: string;
    escalatedToast: string;
  };
  ownershipDetail: {
    subtitle: (controlId: string, framework: string) => string;
    reassign: string;
    markReviewed: string;
    controlInformation: string;
    controlId: string;
    framework: string;
    controlName: string;
    ownership: string;
    primaryOwner: string;
    delegate: string;
    noDelegate: string;
    reviewTimeline: string;
    nextReview: string;
    overdueSuffix: string;
    neverReviewed: string;
    lastReviewed: string;
    created: string;
    updated: string;
  };
  ownershipForm: {
    createTitle: string;
    editTitle: string;
    createDesc: string;
    editDesc: string;
    controlInformation: string;
    controlId: string;
    controlIdPlaceholder: string;
    framework: string;
    frameworkPlaceholder: string;
    controlName: string;
    controlNamePlaceholder: string;
    ownerAssignment: string;
    ownerId: string;
    ownerIdPlaceholder: string;
    ownerName: string;
    ownerNamePlaceholder: string;
    delegateOptional: string;
    delegateId: string;
    delegateIdPlaceholder: string;
    delegateName: string;
    delegateNamePlaceholder: string;
    nextReviewDate: string;
    cancel: string;
    updating: string;
    assigning: string;
    updateOwnership: string;
    assignOwnership: string;
    controlIdRequired: string;
    controlNameRequired: string;
    frameworkRequired: string;
    ownerIdRequired: string;
    ownerNameRequired: string;
    nextReviewRequired: string;
    createdToast: string;
    updatedToast: string;
  };
  policyForm: {
    createTitle: string;
    editTitle: string;
    createDesc: string;
    editDesc: string;
    title: string;
    titlePlaceholder: string;
    domain: string;
    selectDomain: string;
    content: string;
    contentPlaceholder: string;
    tags: string;
    tagsPlaceholder: string;
    add: string;
    removeTagAria: (tag: string) => string;
    cancel: string;
    updating: string;
    creating: string;
    updatePolicy: string;
    createPolicy: string;
    titleRequired: string;
    domainRequired: string;
    contentRequired: string;
    createdToast: string;
    updatedToast: string;
  };
  exceptionForm: {
    title: string;
    description: string;
    policy: string;
    selectPolicy: string;
    titleLabel: string;
    titlePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    justification: string;
    justificationPlaceholder: string;
    compensatingControls: string;
    compensatingControlsPlaceholder: string;
    expiresAt: string;
    cancel: string;
    submitting: string;
    submitException: string;
    submittedToast: string;
    selectPolicyRequired: string;
    titleRequired: string;
    descriptionRequired: string;
    justificationRequired: string;
    compensatingRequired: string;
    expirationRequired: string;
  };
  policyDetail: {
    subtitle: (version: string) => string;
    edit: string;
    submitReview: string;
    publish: string;
    retire: string;
    confirmSubmitTitle: string;
    confirmSubmitDesc: string;
    confirmPublishTitle: string;
    confirmPublishDesc: string;
    confirmRetireTitle: string;
    confirmRetireDesc: string;
    domain: string;
    version: string;
    owner: string;
    reviewer: string;
    reviewDue: string;
    overdueSuffix: string;
    lastReviewed: string;
    approvedBy: string;
    approvedAt: string;
    exceptions: string;
    activeSuffix: (n: number) => string;
    none: string;
    lastUpdated: string;
    tags: string;
    policyContent: string;
  };
  draftGenerator: {
    title: string;
    policyDomain: string;
    selectDomain: string;
    additionalContext: string;
    optional: string;
    contextPlaceholder: string;
    generating: string;
    generateDraft: string;
    generatedDraft: string;
    saveAsDraft: string;
    generatingUsingAi: string;
    mayTakeMoment: string;
    noDraftYet: string;
    emptyHint: string;
    selectDomainToast: string;
    generatedToast: string;
  };
}

export const vcisoWorkflowLabels: CyberBilingual<VcisoWorkflowLabels> = {
  en: {
    approvalTypes: {
      risk_acceptance: 'Risk Acceptance',
      policy_exception: 'Policy Exception',
      remediation: 'Remediation',
      budget: 'Budget',
      vendor_onboarding: 'Vendor Onboarding',
    },
    priorities: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' },
    approvalAction: {
      approveTitle: 'Approve Request',
      rejectTitle: 'Reject Request',
      escalateTitle: 'Escalate Request',
      approveDesc: (title) => `Approve the request "${title}"? This action cannot be undone.`,
      rejectDesc: (title) => `Reject the request "${title}"? The requestor will be notified.`,
      escalateDesc: (title) => `Escalate the request "${title}" to a higher authority? Provide your reasoning below.`,
      approveConfirm: 'Approve',
      rejectConfirm: 'Reject',
      escalateConfirm: 'Escalate',
      decisionNotes: 'Decision Notes',
      decisionNotesRequired: 'Decision notes are required',
      notesPlaceholder: 'Provide reasoning for your decision...',
      cancel: 'Cancel',
      processing: 'Processing...',
      approvedToast: 'Request approved',
      rejectedToast: 'Request rejected',
      escalatedToast: 'Request escalated',
    },
    createApproval: {
      title: 'New Approval Request',
      description: () => 'Submit a new item to the approval queue for governance review.',
      type: 'Type',
      selectType: 'Select type...',
      titleLabel: 'Title',
      titlePlaceholder: 'Brief description of the request',
      descriptionLabel: 'Description',
      descriptionPlaceholder: 'Detailed context and justification...',
      priority: 'Priority',
      selectPriority: 'Select priority...',
      deadline: 'Deadline',
      approverId: 'Approver',
      approverIdPlaceholder: 'Select an approver',
      approverName: 'Approver',
      approverNamePlaceholder: 'Search users',
      linkedEntityType: 'Linked Entity Type',
      linkedEntityTypePlaceholder: 'e.g. risk, policy, asset (optional)',
      linkedEntityId: 'Linked record (optional)',
      linkedEntityIdPlaceholder: 'Select a linked record (optional)',
      cancel: 'Cancel',
      creating: 'Creating...',
      createRequest: 'Create Request',
      createdToast: 'Approval request created',
      vTypeRequired: 'Type is required',
      vTitleMin: 'Title must be at least 2 characters',
      vUuid: 'Select a valid approver',
      vApproverName: 'Approver name is required',
      vPriorityRequired: 'Priority is required',
      vDeadlineRequired: 'Deadline is required',
    },
    approvalDetail: {
      requestDetails: 'Request Details',
      type: 'Type',
      priority: 'Priority',
      requestedBy: 'Requested By',
      approver: 'Approver',
      deadline: 'Deadline',
      overdueSuffix: ' (Overdue)',
      created: 'Created',
      linkedEntity: 'Linked Entity',
      description: 'Description',
      decision: 'Decision',
      decidedPrefix: (when) => `Decided: ${when}`,
      makeDecision: 'Make Decision',
      decisionNotes: 'Decision Notes',
      notesPlaceholder: 'Provide reasoning for your decision...',
      approve: 'Approve',
      approving: 'Approving...',
      reject: 'Reject',
      rejecting: 'Rejecting...',
      escalate: 'Escalate',
      escalating: 'Escalating...',
      notesRequired: 'Decision notes are required',
      grantedToast: 'Approval granted',
      rejectedToast: 'Request rejected',
      escalatedToast: 'Request escalated',
    },
    ownershipDetail: {
      subtitle: (controlId, framework) => `Control ${controlId} - ${framework}`,
      reassign: 'Reassign',
      markReviewed: 'Mark Reviewed',
      controlInformation: 'Control Information',
      controlId: 'Control ID',
      framework: 'Framework',
      controlName: 'Control Name',
      ownership: 'Ownership',
      primaryOwner: 'Primary Owner',
      delegate: 'Delegate',
      noDelegate: 'No delegate assigned',
      reviewTimeline: 'Review Timeline',
      nextReview: 'Next Review:',
      overdueSuffix: ' (Overdue)',
      neverReviewed: 'Never reviewed',
      lastReviewed: 'Last Reviewed:',
      created: 'Created:',
      updated: 'Updated:',
    },
    ownershipForm: {
      createTitle: 'Assign Control Ownership',
      editTitle: 'Reassign Ownership',
      createDesc: 'Assign an owner to a security control. Required fields are marked.',
      editDesc: 'Update the owner, delegate, or review schedule for this control.',
      controlInformation: 'Control Information',
      controlId: 'Control ID',
      controlIdPlaceholder: 'e.g. AC-1',
      framework: 'Framework',
      frameworkPlaceholder: 'e.g. NIST 800-53',
      controlName: 'Control Name',
      controlNamePlaceholder: 'e.g. Access Control Policy and Procedures',
      ownerAssignment: 'Owner Assignment',
      ownerId: 'Owner',
      ownerIdPlaceholder: 'Select an owner',
      ownerName: 'Owner',
      ownerNamePlaceholder: 'Search users',
      delegateOptional: 'Delegate (Optional)',
      delegateId: 'Delegate',
      delegateIdPlaceholder: 'Select a delegate (optional)',
      delegateName: 'Delegate',
      delegateNamePlaceholder: 'Search users',
      nextReviewDate: 'Next Review Date',
      cancel: 'Cancel',
      updating: 'Updating...',
      assigning: 'Assigning...',
      updateOwnership: 'Update Ownership',
      assignOwnership: 'Assign Ownership',
      controlIdRequired: 'Control ID is required',
      controlNameRequired: 'Control Name is required',
      frameworkRequired: 'Framework is required',
      ownerIdRequired: 'Owner is required',
      ownerNameRequired: 'Owner is required',
      nextReviewRequired: 'Next Review Date is required',
      createdToast: 'Ownership assigned successfully',
      updatedToast: 'Ownership updated successfully',
    },
    policyForm: {
      createTitle: 'Create Policy',
      editTitle: 'Edit Policy',
      createDesc: 'Fill in the details to create a new security policy.',
      editDesc: 'Update the policy details below.',
      title: 'Title',
      titlePlaceholder: 'e.g., Information Security Policy',
      domain: 'Domain',
      selectDomain: 'Select a domain',
      content: 'Content',
      contentPlaceholder: 'Write the policy content here...',
      tags: 'Tags',
      tagsPlaceholder: 'Add a tag and press Enter',
      add: 'Add',
      removeTagAria: (tag) => `Remove tag ${tag}`,
      cancel: 'Cancel',
      updating: 'Updating...',
      creating: 'Creating...',
      updatePolicy: 'Update Policy',
      createPolicy: 'Create Policy',
      titleRequired: 'Title is required',
      domainRequired: 'Domain is required',
      contentRequired: 'Content is required',
      createdToast: 'Policy created successfully',
      updatedToast: 'Policy updated successfully',
    },
    exceptionForm: {
      title: 'Request Policy Exception',
      description: 'Submit a request for a temporary exception to an existing policy. Include compensating controls and a justification.',
      policy: 'Policy',
      selectPolicy: 'Select a policy',
      titleLabel: 'Title',
      titlePlaceholder: 'e.g., Temporary access exception for Project X',
      descriptionLabel: 'Description',
      descriptionPlaceholder: 'Describe the exception being requested...',
      justification: 'Justification',
      justificationPlaceholder: 'Explain why this exception is necessary...',
      compensatingControls: 'Compensating Controls',
      compensatingControlsPlaceholder: 'Describe the compensating controls in place...',
      expiresAt: 'Expires At',
      cancel: 'Cancel',
      submitting: 'Submitting...',
      submitException: 'Submit Exception Request',
      submittedToast: 'Exception request submitted',
      selectPolicyRequired: 'Please select a policy',
      titleRequired: 'Title is required',
      descriptionRequired: 'Description is required',
      justificationRequired: 'Justification is required',
      compensatingRequired: 'Compensating controls are required',
      expirationRequired: 'Expiration date is required',
    },
    policyDetail: {
      subtitle: (version) => `Version ${version}`,
      edit: 'Edit',
      submitReview: 'Submit for Review',
      publish: 'Publish',
      retire: 'Retire',
      confirmSubmitTitle: 'Submit for Review',
      confirmSubmitDesc: 'This will submit the policy for review. Reviewers will be notified.',
      confirmPublishTitle: 'Publish Policy',
      confirmPublishDesc: 'This will publish the policy and make it active across the organization.',
      confirmRetireTitle: 'Retire Policy',
      confirmRetireDesc: 'This will retire the policy. It will no longer be active but will remain in the archive.',
      domain: 'Domain',
      version: 'Version',
      owner: 'Owner',
      reviewer: 'Reviewer',
      reviewDue: 'Review Due',
      overdueSuffix: ' (Overdue)',
      lastReviewed: 'Last Reviewed',
      approvedBy: 'Approved By',
      approvedAt: 'Approved At',
      exceptions: 'Exceptions',
      activeSuffix: (n) => `${n} active`,
      none: 'None',
      lastUpdated: 'Last Updated',
      tags: 'Tags',
      policyContent: 'Policy Content',
    },
    draftGenerator: {
      title: 'AI Policy Draft Generator',
      policyDomain: 'Policy Domain',
      selectDomain: 'Select a domain to generate a policy for',
      additionalContext: 'Additional Context',
      optional: '(optional)',
      contextPlaceholder: 'Provide any specific requirements, industry standards, or organizational context to guide the draft generation...',
      generating: 'Generating...',
      generateDraft: 'Generate Draft',
      generatedDraft: 'Generated Draft',
      saveAsDraft: 'Save as Draft',
      generatingUsingAi: 'Generating policy draft using AI...',
      mayTakeMoment: 'This may take a moment',
      noDraftYet: 'No draft generated yet',
      emptyHint: 'Select a policy domain and optionally provide additional context, then click Generate Draft to create an AI-powered policy document.',
      selectDomainToast: 'Please select a policy domain',
      generatedToast: 'Policy draft generated successfully',
    },
  },
  ar: {
    approvalTypes: {
      risk_acceptance: 'قبول المخاطرة',
      policy_exception: 'استثناء السياسة',
      remediation: 'المعالجة',
      budget: 'الميزانية',
      vendor_onboarding: 'إعداد المورد',
    },
    priorities: { critical: 'حرج', high: 'عالٍ', medium: 'متوسط', low: 'منخفض' },
    approvalAction: {
      approveTitle: 'اعتماد الطلب',
      rejectTitle: 'رفض الطلب',
      escalateTitle: 'تصعيد الطلب',
      approveDesc: (title) => `اعتماد الطلب "${title}"؟ لا يمكن التراجع عن هذا الإجراء.`,
      rejectDesc: (title) => `رفض الطلب "${title}"؟ سيتم إشعار مقدّم الطلب.`,
      escalateDesc: (title) => `تصعيد الطلب "${title}" إلى جهة أعلى؟ قدّم مبررك أدناه.`,
      approveConfirm: 'اعتماد',
      rejectConfirm: 'رفض',
      escalateConfirm: 'تصعيد',
      decisionNotes: 'ملاحظات القرار',
      decisionNotesRequired: 'ملاحظات القرار مطلوبة',
      notesPlaceholder: 'قدّم مبرر قرارك...',
      cancel: 'إلغاء',
      processing: 'جارٍ المعالجة...',
      approvedToast: 'تم اعتماد الطلب',
      rejectedToast: 'تم رفض الطلب',
      escalatedToast: 'تم تصعيد الطلب',
    },
    createApproval: {
      title: 'طلب اعتماد جديد',
      description: () => 'أرسل عنصرًا جديدًا إلى قائمة الاعتماد لمراجعة الحوكمة.',
      type: 'النوع',
      selectType: 'اختر النوع...',
      titleLabel: 'العنوان',
      titlePlaceholder: 'وصف موجز للطلب',
      descriptionLabel: 'الوصف',
      descriptionPlaceholder: 'سياق تفصيلي ومبرر...',
      priority: 'الأولوية',
      selectPriority: 'اختر الأولوية...',
      deadline: 'الموعد النهائي',
      approverId: 'المُعتمِد',
      approverIdPlaceholder: 'اختر المُعتمِد',
      approverName: 'المُعتمِد',
      approverNamePlaceholder: 'ابحث عن مستخدم',
      linkedEntityType: 'نوع الكيان المرتبط',
      linkedEntityTypePlaceholder: 'مثال: مخاطرة، سياسة، أصل (اختياري)',
      linkedEntityId: 'السجل المرتبط (اختياري)',
      linkedEntityIdPlaceholder: 'اختر سجلًا مرتبطًا (اختياري)',
      cancel: 'إلغاء',
      creating: 'جارٍ الإنشاء...',
      createRequest: 'إنشاء الطلب',
      createdToast: 'تم إنشاء طلب الاعتماد',
      vTypeRequired: 'النوع مطلوب',
      vTitleMin: 'يجب أن يكون العنوان حرفين على الأقل',
      vUuid: 'اختر مُعتمِدًا صالحًا',
      vApproverName: 'اسم المُعتمِد مطلوب',
      vPriorityRequired: 'الأولوية مطلوبة',
      vDeadlineRequired: 'الموعد النهائي مطلوب',
    },
    approvalDetail: {
      requestDetails: 'تفاصيل الطلب',
      type: 'النوع',
      priority: 'الأولوية',
      requestedBy: 'مُقدَّم من',
      approver: 'المُعتمِد',
      deadline: 'الموعد النهائي',
      overdueSuffix: ' (متأخر)',
      created: 'تاريخ الإنشاء',
      linkedEntity: 'الكيان المرتبط',
      description: 'الوصف',
      decision: 'القرار',
      decidedPrefix: (when) => `تاريخ القرار: ${when}`,
      makeDecision: 'اتخاذ القرار',
      decisionNotes: 'ملاحظات القرار',
      notesPlaceholder: 'قدّم مبرر قرارك...',
      approve: 'اعتماد',
      approving: 'جارٍ الاعتماد...',
      reject: 'رفض',
      rejecting: 'جارٍ الرفض...',
      escalate: 'تصعيد',
      escalating: 'جارٍ التصعيد...',
      notesRequired: 'ملاحظات القرار مطلوبة',
      grantedToast: 'تم منح الاعتماد',
      rejectedToast: 'تم رفض الطلب',
      escalatedToast: 'تم تصعيد الطلب',
    },
    ownershipDetail: {
      subtitle: (controlId, framework) => `الضابط ${controlId} - ${framework}`,
      reassign: 'إعادة الإسناد',
      markReviewed: 'تعليم كمُراجَع',
      controlInformation: 'معلومات الضابط',
      controlId: 'معرّف الضابط',
      framework: 'الإطار',
      controlName: 'اسم الضابط',
      ownership: 'الملكية',
      primaryOwner: 'المسؤول الأساسي',
      delegate: 'المفوَّض',
      noDelegate: 'لا يوجد مفوَّض مُسنَد',
      reviewTimeline: 'الجدول الزمني للمراجعة',
      nextReview: 'المراجعة التالية:',
      overdueSuffix: ' (متأخر)',
      neverReviewed: 'لم تتم مراجعته مطلقًا',
      lastReviewed: 'آخر مراجعة:',
      created: 'تاريخ الإنشاء:',
      updated: 'تاريخ التحديث:',
    },
    ownershipForm: {
      createTitle: 'إسناد ملكية الضابط',
      editTitle: 'إعادة إسناد الملكية',
      createDesc: 'أسنِد المسؤول لضابط أمني. الحقول المطلوبة مُعلَّمة.',
      editDesc: 'حدّث المسؤول أو المفوَّض أو جدول المراجعة لهذا الضابط.',
      controlInformation: 'معلومات الضابط',
      controlId: 'معرّف الضابط',
      controlIdPlaceholder: 'مثال: AC-1',
      framework: 'الإطار',
      frameworkPlaceholder: 'مثال: NIST 800-53',
      controlName: 'اسم الضابط',
      controlNamePlaceholder: 'مثال: سياسة وإجراءات التحكم في الوصول',
      ownerAssignment: 'إسناد المسؤول',
      ownerId: 'المسؤول',
      ownerIdPlaceholder: 'اختر المسؤول',
      ownerName: 'المسؤول',
      ownerNamePlaceholder: 'ابحث عن مستخدم',
      delegateOptional: 'المفوَّض (اختياري)',
      delegateId: 'المفوَّض',
      delegateIdPlaceholder: 'اختر المفوَّض (اختياري)',
      delegateName: 'المفوَّض',
      delegateNamePlaceholder: 'ابحث عن مستخدم',
      nextReviewDate: 'تاريخ المراجعة التالية',
      cancel: 'إلغاء',
      updating: 'جارٍ التحديث...',
      assigning: 'جارٍ الإسناد...',
      updateOwnership: 'تحديث الملكية',
      assignOwnership: 'إسناد الملكية',
      controlIdRequired: 'معرّف الضابط مطلوب',
      controlNameRequired: 'اسم الضابط مطلوب',
      frameworkRequired: 'الإطار مطلوب',
      ownerIdRequired: 'المسؤول مطلوب',
      ownerNameRequired: 'المسؤول مطلوب',
      nextReviewRequired: 'تاريخ المراجعة التالية مطلوب',
      createdToast: 'تم إسناد الملكية بنجاح',
      updatedToast: 'تم تحديث الملكية بنجاح',
    },
    policyForm: {
      createTitle: 'إنشاء سياسة',
      editTitle: 'تعديل السياسة',
      createDesc: 'أدخِل التفاصيل لإنشاء سياسة أمنية جديدة.',
      editDesc: 'حدّث تفاصيل السياسة أدناه.',
      title: 'العنوان',
      titlePlaceholder: 'مثال: سياسة أمن المعلومات',
      domain: 'المجال',
      selectDomain: 'اختر مجالًا',
      content: 'المحتوى',
      contentPlaceholder: 'اكتب محتوى السياسة هنا...',
      tags: 'الوسوم',
      tagsPlaceholder: 'أضف وسمًا واضغط Enter',
      add: 'إضافة',
      removeTagAria: (tag) => `إزالة الوسم ${tag}`,
      cancel: 'إلغاء',
      updating: 'جارٍ التحديث...',
      creating: 'جارٍ الإنشاء...',
      updatePolicy: 'تحديث السياسة',
      createPolicy: 'إنشاء السياسة',
      titleRequired: 'العنوان مطلوب',
      domainRequired: 'المجال مطلوب',
      contentRequired: 'المحتوى مطلوب',
      createdToast: 'تم إنشاء السياسة بنجاح',
      updatedToast: 'تم تحديث السياسة بنجاح',
    },
    exceptionForm: {
      title: 'طلب استثناء سياسة',
      description: 'إرسال طلب لاستثناء مؤقت من سياسة قائمة. أدرِج الضوابط التعويضية ومبررًا.',
      policy: 'السياسة',
      selectPolicy: 'اختر سياسة',
      titleLabel: 'العنوان',
      titlePlaceholder: 'مثال: استثناء وصول مؤقت لمشروع X',
      descriptionLabel: 'الوصف',
      descriptionPlaceholder: 'صِف الاستثناء المطلوب...',
      justification: 'المبرر',
      justificationPlaceholder: 'اشرح سبب ضرورة هذا الاستثناء...',
      compensatingControls: 'الضوابط التعويضية',
      compensatingControlsPlaceholder: 'صِف الضوابط التعويضية القائمة...',
      expiresAt: 'تاريخ الانتهاء',
      cancel: 'إلغاء',
      submitting: 'جارٍ الإرسال...',
      submitException: 'إرسال طلب الاستثناء',
      submittedToast: 'تم إرسال طلب الاستثناء',
      selectPolicyRequired: 'يرجى اختيار سياسة',
      titleRequired: 'العنوان مطلوب',
      descriptionRequired: 'الوصف مطلوب',
      justificationRequired: 'المبرر مطلوب',
      compensatingRequired: 'الضوابط التعويضية مطلوبة',
      expirationRequired: 'تاريخ الانتهاء مطلوب',
    },
    policyDetail: {
      subtitle: (version) => `الإصدار ${version}`,
      edit: 'تعديل',
      submitReview: 'إرسال للمراجعة',
      publish: 'نشر',
      retire: 'سحب',
      confirmSubmitTitle: 'إرسال للمراجعة',
      confirmSubmitDesc: 'سيؤدي هذا إلى إرسال السياسة للمراجعة. سيتم إشعار المراجعين.',
      confirmPublishTitle: 'نشر السياسة',
      confirmPublishDesc: 'سيؤدي هذا إلى نشر السياسة وجعلها فعّالة على مستوى المؤسسة.',
      confirmRetireTitle: 'سحب السياسة',
      confirmRetireDesc: 'سيؤدي هذا إلى سحب السياسة. لن تكون فعّالة بعد الآن لكنها ستبقى في الأرشيف.',
      domain: 'المجال',
      version: 'الإصدار',
      owner: 'المسؤول',
      reviewer: 'المراجِع',
      reviewDue: 'استحقاق المراجعة',
      overdueSuffix: ' (متأخر)',
      lastReviewed: 'آخر مراجعة',
      approvedBy: 'اعتمده',
      approvedAt: 'تاريخ الاعتماد',
      exceptions: 'الاستثناءات',
      activeSuffix: (n) => `${n} نشط`,
      none: 'لا شيء',
      lastUpdated: 'آخر تحديث',
      tags: 'الوسوم',
      policyContent: 'محتوى السياسة',
    },
    draftGenerator: {
      title: 'مولّد مسودة السياسات بالذكاء الاصطناعي',
      policyDomain: 'مجال السياسة',
      selectDomain: 'اختر مجالًا لتوليد سياسة له',
      additionalContext: 'سياق إضافي',
      optional: '(اختياري)',
      contextPlaceholder: 'قدّم أي متطلبات محددة أو معايير قطاعية أو سياق مؤسسي لتوجيه توليد المسودة...',
      generating: 'جارٍ التوليد...',
      generateDraft: 'توليد المسودة',
      generatedDraft: 'المسودة المُولَّدة',
      saveAsDraft: 'حفظ كمسودة',
      generatingUsingAi: 'جارٍ توليد مسودة السياسة بالذكاء الاصطناعي...',
      mayTakeMoment: 'قد يستغرق هذا لحظة',
      noDraftYet: 'لم تُولَّد مسودة بعد',
      emptyHint: 'اختر مجال السياسة وقدّم سياقًا إضافيًا اختياريًا، ثم انقر "توليد المسودة" لإنشاء مستند سياسة مدعوم بالذكاء الاصطناعي.',
      selectDomainToast: 'يرجى اختيار مجال السياسة',
      generatedToast: 'تم توليد مسودة السياسة بنجاح',
    },
  },
};

export function useVcisoWorkflowLabels(): VcisoWorkflowLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoWorkflowLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoWorkflowLabels);

// ---------------------------------------------------------------------------
// List-page chrome (filters, table columns, row actions, tabs, empty states,
// confirm dialogs, toasts, search placeholders) for the governance list pages.
// These finish the page.tsx surfaces the earlier pass left in English.
// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
// ---------------------------------------------------------------------------

export interface VcisoRiskListLabels {
  addRisk: string;
  tabs: { register: string; acceptance: string; impact: string };
  filters: {
    status: string;
    treatment: string;
    likelihood: string;
    impact: string;
    statusOptions: { open: string; mitigated: string; accepted: string; closed: string };
    treatmentOptions: { mitigate: string; transfer: string; accept: string; avoid: string };
    levelOptions: { low: string; medium: string; high: string; critical: string };
  };
  columns: {
    title: string;
    category: string;
    likelihood: string;
    impact: string;
    inherent: string;
    residual: string;
    status: string;
    treatment: string;
    owner: string;
    reviewDate: string;
    residualScore: string;
    rationale: string;
    approvedBy: string;
    expiry: string;
  };
  unassigned: string;
  noExpiry: string;
  actions: { viewDetails: string; acceptRisk: string; closeRisk: string; revokeAcceptance: string };
  search: { risks: string; accepted: string };
  empty: { risksTitle: string; risksDesc: string; acceptedTitle: string; acceptedDesc: string };
  impact: {
    failedLoad: string;
    heatMatrix: string;
    likelihoodImpact: string;
    risksByDept: string;
    noRisksDisplay: string;
    avgResidual: string;
    critical: string;
    services: string;
    businessServices: string;
    topRisks: string;
  };
  riskCount: (n: number) => string;
  moreCount: (n: number) => string;
  confirm: { closeDesc: (title: string) => string; revokeDesc: (title: string) => string };
  toasts: { closed: string; revoked: string };
}

export const vcisoRiskListLabels: CyberBilingual<VcisoRiskListLabels> = {
  en: {
    addRisk: 'Add Risk',
    tabs: { register: 'Risk Register', acceptance: 'Risk Acceptance', impact: 'Business Impact' },
    filters: {
      status: 'Status',
      treatment: 'Treatment',
      likelihood: 'Likelihood',
      impact: 'Impact',
      statusOptions: { open: 'Open', mitigated: 'Mitigated', accepted: 'Accepted', closed: 'Closed' },
      treatmentOptions: { mitigate: 'Mitigate', transfer: 'Transfer', accept: 'Accept', avoid: 'Avoid' },
      levelOptions: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
    },
    columns: {
      title: 'Title',
      category: 'Category',
      likelihood: 'Likelihood',
      impact: 'Impact',
      inherent: 'Inherent',
      residual: 'Residual',
      status: 'Status',
      treatment: 'Treatment',
      owner: 'Owner',
      reviewDate: 'Review Date',
      residualScore: 'Residual Score',
      rationale: 'Rationale',
      approvedBy: 'Approved By',
      expiry: 'Expiry',
    },
    unassigned: 'Unassigned',
    noExpiry: 'No expiry',
    actions: {
      viewDetails: 'View Details',
      acceptRisk: 'Accept Risk',
      closeRisk: 'Close Risk',
      revokeAcceptance: 'Revoke Acceptance',
    },
    search: { risks: 'Search risks...', accepted: 'Search accepted risks...' },
    empty: {
      risksTitle: 'No risks found',
      risksDesc: 'No risks match the current filters or no risks have been registered yet.',
      acceptedTitle: 'No accepted risks',
      acceptedDesc: 'No risks have been formally accepted yet.',
    },
    impact: {
      failedLoad: 'Failed to load business impact data',
      heatMatrix: 'Risk Heat Matrix',
      likelihoodImpact: 'Likelihood / Impact',
      risksByDept: 'Risks by Department',
      noRisksDisplay: 'No risks to display.',
      avgResidual: 'Avg Residual',
      critical: 'Critical',
      services: 'Services',
      businessServices: 'Business Services',
      topRisks: 'Top Risks',
    },
    riskCount: (n) => `${n} risk${n !== 1 ? 's' : ''}`,
    moreCount: (n) => `+${n} more`,
    confirm: {
      closeDesc: (title) => `Are you sure you want to close the risk "${title}"? This indicates the risk is no longer applicable or has been fully resolved.`,
      revokeDesc: (title) => `Are you sure you want to revoke the acceptance for "${title}"? The risk will be moved back to "open" status for re-evaluation.`,
    },
    toasts: { closed: 'Risk closed successfully', revoked: 'Risk acceptance revoked' },
  },
  ar: {
    addRisk: 'إضافة مخاطرة',
    tabs: { register: 'سجل المخاطر', acceptance: 'قبول المخاطر', impact: 'أثر الأعمال' },
    filters: {
      status: 'الحالة',
      treatment: 'المعالجة',
      likelihood: 'الاحتمالية',
      impact: 'الأثر',
      statusOptions: { open: 'مفتوح', mitigated: 'مُخفَّف', accepted: 'مقبول', closed: 'مغلق' },
      treatmentOptions: { mitigate: 'تخفيف', transfer: 'نقل', accept: 'قبول', avoid: 'تجنّب' },
      levelOptions: { low: 'منخفض', medium: 'متوسط', high: 'عالٍ', critical: 'حرج' },
    },
    columns: {
      title: 'العنوان',
      category: 'الفئة',
      likelihood: 'الاحتمالية',
      impact: 'الأثر',
      inherent: 'الكامنة',
      residual: 'المتبقية',
      status: 'الحالة',
      treatment: 'المعالجة',
      owner: 'المسؤول',
      reviewDate: 'تاريخ المراجعة',
      residualScore: 'الدرجة المتبقية',
      rationale: 'المبرر',
      approvedBy: 'اعتمده',
      expiry: 'تاريخ الانتهاء',
    },
    unassigned: 'غير مُسنَد',
    noExpiry: 'بلا انتهاء',
    actions: {
      viewDetails: 'عرض التفاصيل',
      acceptRisk: 'قبول المخاطرة',
      closeRisk: 'إغلاق المخاطرة',
      revokeAcceptance: 'إلغاء القبول',
    },
    search: { risks: 'البحث في المخاطر...', accepted: 'البحث في المخاطر المقبولة...' },
    empty: {
      risksTitle: 'لا توجد مخاطر',
      risksDesc: 'لا توجد مخاطر مطابقة للمرشِّحات الحالية أو لم تُسجَّل أي مخاطر بعد.',
      acceptedTitle: 'لا توجد مخاطر مقبولة',
      acceptedDesc: 'لم تُقبل أي مخاطر رسميًا بعد.',
    },
    impact: {
      failedLoad: 'تعذّر تحميل بيانات أثر الأعمال',
      heatMatrix: 'مصفوفة حرارة المخاطر',
      likelihoodImpact: 'الاحتمالية / الأثر',
      risksByDept: 'المخاطر حسب الإدارة',
      noRisksDisplay: 'لا توجد مخاطر للعرض.',
      avgResidual: 'متوسط المتبقية',
      critical: 'حرجة',
      services: 'الخدمات',
      businessServices: 'خدمات الأعمال',
      topRisks: 'أبرز المخاطر',
    },
    riskCount: (n) => `${n} مخاطرة`,
    moreCount: (n) => `+${n} أخرى`,
    confirm: {
      closeDesc: (title) => `هل أنت متأكد من إغلاق المخاطرة "${title}"؟ يشير هذا إلى أن المخاطرة لم تعد قائمة أو عولجت بالكامل.`,
      revokeDesc: (title) => `هل أنت متأكد من إلغاء القبول لـ "${title}"؟ ستُعاد المخاطرة إلى حالة "مفتوح" لإعادة التقييم.`,
    },
    toasts: { closed: 'تم إغلاق المخاطرة بنجاح', revoked: 'تم إلغاء قبول المخاطرة' },
  },
};

export function useVcisoRiskListLabels(): VcisoRiskListLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoRiskListLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoRiskListLabels);

export interface VcisoEvidenceListLabels {
  refresh: string;
  uploadEvidence: string;
  toasts: { deleted: string; verified: string };
  filters: {
    type: string;
    source: string;
    status: string;
    typeOptions: {
      screenshot: string;
      log: string;
      config: string;
      report: string;
      policy: string;
      certificate: string;
      other: string;
    };
    sourceOptions: { manual: string; automated: string };
    statusOptions: { current: string; stale: string; expired: string };
  };
  columns: {
    title: string;
    type: string;
    source: string;
    status: string;
    frameworks: string;
    file: string;
    collected: string;
    expires: string;
  };
  rowMenu: { view: string; download: string; verify: string; delete: string };
  tabs: { repository: string; collection: string };
  search: string;
  empty: { title: string; desc: string };
  sourceSummary: (manual: number, automated: number) => string;
  attentionSummary: (stale: number, expired: number) => string;
  ofTotal: (n: number) => string;
  collection: {
    manualTitle: string;
    manualDesc: string;
    automatedTitle: string;
    automatedDesc: string;
    byType: string;
    noTypeData: string;
    coverageTitle: string;
    withEvidence: string;
    withoutEvidence: string;
    coverage: string;
    itemsAttention: (n: number) => string;
    expiresPrefix: (date: string) => string;
    needAttention: (n: number) => string;
    allCurrent: string;
    statsError: string;
  };
}

export const vcisoEvidenceListLabels: CyberBilingual<VcisoEvidenceListLabels> = {
  en: {
    refresh: 'Refresh',
    uploadEvidence: 'Upload Evidence',
    toasts: { deleted: 'Evidence deleted', verified: 'Evidence verified' },
    filters: {
      type: 'Type',
      source: 'Source',
      status: 'Status',
      typeOptions: {
        screenshot: 'Screenshot',
        log: 'Log',
        config: 'Configuration',
        report: 'Report',
        policy: 'Policy',
        certificate: 'Certificate',
        other: 'Other',
      },
      sourceOptions: { manual: 'Manual', automated: 'Automated' },
      statusOptions: { current: 'Current', stale: 'Stale', expired: 'Expired' },
    },
    columns: {
      title: 'Title',
      type: 'Type',
      source: 'Source',
      status: 'Status',
      frameworks: 'Frameworks',
      file: 'File',
      collected: 'Collected',
      expires: 'Expires',
    },
    rowMenu: { view: 'View', download: 'Download', verify: 'Verify', delete: 'Delete' },
    tabs: { repository: 'Evidence Repository', collection: 'Collection Status' },
    search: 'Search evidence...',
    empty: {
      title: 'No evidence found',
      desc: 'Upload evidence or adjust your filters to see results.',
    },
    sourceSummary: (manual, automated) => `${manual} manual, ${automated} automated`,
    attentionSummary: (stale, expired) => `${stale} stale, ${expired} expired`,
    ofTotal: (n) => `of ${n}`,
    collection: {
      manualTitle: 'Manual Collection',
      manualDesc: 'Evidence items collected manually by team members',
      automatedTitle: 'Automated Collection',
      automatedDesc: 'Evidence items gathered by automated collection pipelines',
      byType: 'Evidence by Type',
      noTypeData: 'No evidence data available',
      coverageTitle: 'Control Evidence Coverage',
      withEvidence: 'Controls with Evidence',
      withoutEvidence: 'Controls without Evidence',
      coverage: 'Coverage',
      itemsAttention: (n) => `Items Requiring Attention (${n})`,
      expiresPrefix: (date) => `Expires ${date}`,
      needAttention: (n) => `${n} items need attention. Adjust table filters to view them.`,
      allCurrent: 'All evidence items are current. No action required.',
      statsError: 'Failed to load evidence statistics.',
    },
  },
  ar: {
    refresh: 'تحديث',
    uploadEvidence: 'رفع الأدلة',
    toasts: { deleted: 'تم حذف الأدلة', verified: 'تم التحقق من الأدلة' },
    filters: {
      type: 'النوع',
      source: 'المصدر',
      status: 'الحالة',
      typeOptions: {
        screenshot: 'لقطة شاشة',
        log: 'سجل',
        config: 'إعدادات',
        report: 'تقرير',
        policy: 'سياسة',
        certificate: 'شهادة',
        other: 'أخرى',
      },
      sourceOptions: { manual: 'يدوي', automated: 'آلي' },
      statusOptions: { current: 'حالية', stale: 'راكدة', expired: 'منتهية' },
    },
    columns: {
      title: 'العنوان',
      type: 'النوع',
      source: 'المصدر',
      status: 'الحالة',
      frameworks: 'الأطر',
      file: 'الملف',
      collected: 'تاريخ الجمع',
      expires: 'تاريخ الانتهاء',
    },
    rowMenu: { view: 'عرض', download: 'تنزيل', verify: 'تحقق', delete: 'حذف' },
    tabs: { repository: 'مستودع الأدلة', collection: 'الحالة العامة للجمع' },
    search: 'البحث في الأدلة...',
    empty: {
      title: 'لا توجد أدلة',
      desc: 'ارفع أدلة أو عدّل المرشِّحات لعرض النتائج.',
    },
    sourceSummary: (manual, automated) => `${manual} يدوي، ${automated} آلي`,
    attentionSummary: (stale, expired) => `${stale} راكد، ${expired} منتهٍ`,
    ofTotal: (n) => `من ${n}`,
    collection: {
      manualTitle: 'الجمع اليدوي',
      manualDesc: 'أدلة جُمعت يدويًا بواسطة أعضاء الفريق',
      automatedTitle: 'الجمع الآلي',
      automatedDesc: 'أدلة جُمعت بواسطة مسارات الجمع الآلي',
      byType: 'الأدلة حسب النوع',
      noTypeData: 'لا توجد بيانات أدلة متاحة',
      coverageTitle: 'تغطية أدلة الضوابط',
      withEvidence: 'الضوابط ذات الأدلة',
      withoutEvidence: 'الضوابط بلا أدلة',
      coverage: 'التغطية',
      itemsAttention: (n) => `العناصر التي تتطلّب اهتمامًا (${n})`,
      expiresPrefix: (date) => `تنتهي ${date}`,
      needAttention: (n) => `${n} عنصر يتطلّب اهتمامًا. عدّل مرشِّحات الجدول لعرضها.`,
      allCurrent: 'جميع الأدلة حالية. لا يلزم أي إجراء.',
      statsError: 'تعذّر تحميل إحصاءات الأدلة.',
    },
  },
};

export function useVcisoEvidenceListLabels(): VcisoEvidenceListLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoEvidenceListLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoEvidenceListLabels);

export interface VcisoAwarenessListLabels {
  createProgram: string;
  tabs: { awareness: string; iam: string };
  toasts: { remediating: string; accepted: string };
  awarenessFilters: {
    type: string;
    status: string;
    typeOptions: { training: string; phishing_simulation: string; policy_attestation: string };
    statusOptions: { scheduled: string; active: string; completed: string };
  };
  iamFilters: {
    type: string;
    severity: string;
    status: string;
    typeOptions: {
      mfa_gap: string;
      orphaned_account: string;
      privileged_access: string;
      sod_violation: string;
      stale_access: string;
      excessive_permissions: string;
    };
    severityOptions: { critical: string; high: string; medium: string; low: string; info: string };
    statusOptions: { open: string; in_progress: string; resolved: string; accepted: string };
  };
  iamTypeChart: {
    mfa_gap: string;
    orphaned_account: string;
    privileged_access: string;
    sod_violation: string;
    stale_access: string;
    excessive_permissions: string;
  };
  awarenessColumns: {
    name: string;
    type: string;
    status: string;
    totalUsers: string;
    completionRate: string;
    passRate: string;
    startDate: string;
    endDate: string;
  };
  iamColumns: {
    title: string;
    type: string;
    severity: string;
    affectedUsers: string;
    status: string;
    remediation: string;
    discoveredAt: string;
  };
  awarenessActions: { viewDetails: string; edit: string };
  iamActions: { view: string; remediate: string; accept: string };
  search: { awareness: string; iam: string };
  empty: { awarenessTitle: string; awarenessDesc: string; iamTitle: string; iamDesc: string };
  iamError: string;
  charts: { mfaCoverage: string; coverage: string; findingsByType: string; total: string };
}

export const vcisoAwarenessListLabels: CyberBilingual<VcisoAwarenessListLabels> = {
  en: {
    createProgram: 'Create Program',
    tabs: { awareness: 'Security Awareness', iam: 'Identity & Access Governance' },
    toasts: {
      remediating: 'Finding marked as in progress for remediation',
      accepted: 'Finding accepted',
    },
    awarenessFilters: {
      type: 'Type',
      status: 'Status',
      typeOptions: {
        training: 'Training',
        phishing_simulation: 'Phishing Simulation',
        policy_attestation: 'Policy Attestation',
      },
      statusOptions: { scheduled: 'Scheduled', active: 'Active', completed: 'Completed' },
    },
    iamFilters: {
      type: 'Type',
      severity: 'Severity',
      status: 'Status',
      typeOptions: {
        mfa_gap: 'MFA Gap',
        orphaned_account: 'Orphaned Account',
        privileged_access: 'Privileged Access',
        sod_violation: 'SoD Violation',
        stale_access: 'Stale Access',
        excessive_permissions: 'Excessive Permissions',
      },
      severityOptions: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' },
      statusOptions: { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', accepted: 'Accepted' },
    },
    iamTypeChart: {
      mfa_gap: 'MFA Gaps',
      orphaned_account: 'Orphaned Accounts',
      privileged_access: 'Privileged Access',
      sod_violation: 'SoD Violations',
      stale_access: 'Stale Access',
      excessive_permissions: 'Excessive Permissions',
    },
    awarenessColumns: {
      name: 'Name',
      type: 'Type',
      status: 'Status',
      totalUsers: 'Total Users',
      completionRate: 'Completion Rate',
      passRate: 'Pass Rate',
      startDate: 'Start Date',
      endDate: 'End Date',
    },
    iamColumns: {
      title: 'Title',
      type: 'Type',
      severity: 'Severity',
      affectedUsers: 'Affected Users',
      status: 'Status',
      remediation: 'Remediation',
      discoveredAt: 'Discovered At',
    },
    awarenessActions: { viewDetails: 'View Details', edit: 'Edit' },
    iamActions: { view: 'View', remediate: 'Remediate', accept: 'Accept' },
    search: { awareness: 'Search awareness programs...', iam: 'Search IAM findings...' },
    empty: {
      awarenessTitle: 'No awareness programs',
      awarenessDesc: 'Create a new security awareness program to get started.',
      iamTitle: 'No IAM findings',
      iamDesc: 'No identity and access management findings have been detected.',
    },
    iamError: 'Failed to load IAM summary data',
    charts: {
      mfaCoverage: 'MFA Coverage',
      coverage: 'Coverage',
      findingsByType: 'Findings by Type',
      total: 'Total',
    },
  },
  ar: {
    createProgram: 'إنشاء برنامج',
    tabs: { awareness: 'التوعية الأمنية', iam: 'حوكمة الهوية والوصول' },
    toasts: {
      remediating: 'تم تحديد النتيجة قيد المعالجة',
      accepted: 'تم قبول النتيجة',
    },
    awarenessFilters: {
      type: 'النوع',
      status: 'الحالة',
      typeOptions: {
        training: 'تدريب',
        phishing_simulation: 'محاكاة تصيّد',
        policy_attestation: 'إقرار السياسات',
      },
      statusOptions: { scheduled: 'مجدول', active: 'نشط', completed: 'مكتمل' },
    },
    iamFilters: {
      type: 'النوع',
      severity: 'الخطورة',
      status: 'الحالة',
      typeOptions: {
        mfa_gap: 'فجوة المصادقة متعددة العوامل (MFA)',
        orphaned_account: 'حساب يتيم',
        privileged_access: 'وصول مميّز',
        sod_violation: 'انتهاك الفصل بين المهام',
        stale_access: 'وصول راكد',
        excessive_permissions: 'صلاحيات مفرطة',
      },
      severityOptions: { critical: 'حرج', high: 'عالٍ', medium: 'متوسط', low: 'منخفض', info: 'معلومة' },
      statusOptions: { open: 'مفتوح', in_progress: 'قيد التنفيذ', resolved: 'تم الحل', accepted: 'مقبول' },
    },
    iamTypeChart: {
      mfa_gap: 'فجوات المصادقة متعددة العوامل (MFA)',
      orphaned_account: 'الحسابات اليتيمة',
      privileged_access: 'الوصول المميّز',
      sod_violation: 'انتهاكات الفصل بين المهام',
      stale_access: 'الوصول الراكد',
      excessive_permissions: 'الصلاحيات المفرطة',
    },
    awarenessColumns: {
      name: 'الاسم',
      type: 'النوع',
      status: 'الحالة',
      totalUsers: 'إجمالي المستخدمين',
      completionRate: 'معدل الإكمال',
      passRate: 'معدل النجاح',
      startDate: 'تاريخ البدء',
      endDate: 'تاريخ الانتهاء',
    },
    iamColumns: {
      title: 'العنوان',
      type: 'النوع',
      severity: 'الخطورة',
      affectedUsers: 'المستخدمون المتأثرون',
      status: 'الحالة',
      remediation: 'المعالجة',
      discoveredAt: 'تاريخ الاكتشاف',
    },
    awarenessActions: { viewDetails: 'عرض التفاصيل', edit: 'تعديل' },
    iamActions: { view: 'عرض', remediate: 'معالجة', accept: 'قبول' },
    search: { awareness: 'البحث في برامج التوعية...', iam: 'البحث في نتائج إدارة الهوية والوصول...' },
    empty: {
      awarenessTitle: 'لا توجد برامج توعية',
      awarenessDesc: 'أنشئ برنامج توعية أمنية جديدًا للبدء.',
      iamTitle: 'لا توجد نتائج لإدارة الهوية والوصول',
      iamDesc: 'لم تُكتشف أي نتائج لإدارة الهوية والوصول.',
    },
    iamError: 'تعذّر تحميل بيانات ملخص إدارة الهوية والوصول',
    charts: {
      mfaCoverage: 'تغطية المصادقة متعددة العوامل (MFA)',
      coverage: 'التغطية',
      findingsByType: 'النتائج حسب النوع',
      total: 'الإجمالي',
    },
  },
};

export function useVcisoAwarenessListLabels(): VcisoAwarenessListLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoAwarenessListLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoAwarenessListLabels);

export interface VcisoWorkflowsListLabels {
  headerActions: { assignOwnership: string; newApproval: string };
  tabs: { controlOwnership: string; approvalQueue: string };
  ownershipFilters: {
    status: string;
    framework: string;
    statusOptions: { assigned: string; pending_review: string; reviewed: string };
  };
  approvalFilters: {
    type: string;
    status: string;
    priority: string;
    statusOptions: { pending: string; approved: string; rejected: string; escalated: string };
  };
  ownershipColumns: {
    controlName: string;
    framework: string;
    owner: string;
    delegate: string;
    status: string;
    lastReviewed: string;
    nextReview: string;
    never: string;
  };
  approvalColumns: {
    title: string;
    type: string;
    priority: string;
    status: string;
    requestedBy: string;
    approver: string;
    deadline: string;
    created: string;
  };
  ownershipActions: { viewDetails: string; reassign: string; markReviewed: string };
  approvalActions: { viewDetails: string; approve: string; reject: string; escalate: string };
  search: { controls: string; approvals: string };
  empty: { ownershipTitle: string; ownershipDesc: string; approvalTitle: string; approvalDesc: string };
  toasts: { reviewed: string };
  confirm: { markReviewedDesc: (name: string) => string; markReviewedConfirm: string };
}

export const vcisoWorkflowsListLabels: CyberBilingual<VcisoWorkflowsListLabels> = {
  en: {
    headerActions: { assignOwnership: 'Assign Ownership', newApproval: 'New Approval' },
    tabs: { controlOwnership: 'Control Ownership', approvalQueue: 'Approval Queue' },
    ownershipFilters: {
      status: 'Status',
      framework: 'Framework',
      statusOptions: { assigned: 'Assigned', pending_review: 'Pending Review', reviewed: 'Reviewed' },
    },
    approvalFilters: {
      type: 'Type',
      status: 'Status',
      priority: 'Priority',
      statusOptions: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', escalated: 'Escalated' },
    },
    ownershipColumns: {
      controlName: 'Control Name',
      framework: 'Framework',
      owner: 'Owner',
      delegate: 'Delegate',
      status: 'Status',
      lastReviewed: 'Last Reviewed',
      nextReview: 'Next Review',
      never: 'Never',
    },
    approvalColumns: {
      title: 'Title',
      type: 'Type',
      priority: 'Priority',
      status: 'Status',
      requestedBy: 'Requested By',
      approver: 'Approver',
      deadline: 'Deadline',
      created: 'Created',
    },
    ownershipActions: { viewDetails: 'View Details', reassign: 'Reassign', markReviewed: 'Mark Reviewed' },
    approvalActions: { viewDetails: 'View Details', approve: 'Approve', reject: 'Reject', escalate: 'Escalate' },
    search: { controls: 'Search controls...', approvals: 'Search approvals...' },
    empty: {
      ownershipTitle: 'No control ownership records',
      ownershipDesc: 'No controls have been assigned to owners yet. Start by assigning ownership.',
      approvalTitle: 'No approval requests',
      approvalDesc: 'No approval requests have been submitted yet. Requests will appear here when created.',
    },
    toasts: { reviewed: 'Control marked as reviewed' },
    confirm: {
      markReviewedDesc: (name) => `Mark the control "${name}" as reviewed? This will update the review timestamp and set the status to reviewed.`,
      markReviewedConfirm: 'Mark Reviewed',
    },
  },
  ar: {
    headerActions: { assignOwnership: 'إسناد الملكية', newApproval: 'اعتماد جديد' },
    tabs: { controlOwnership: 'ملكية الضوابط', approvalQueue: 'قائمة الاعتماد' },
    ownershipFilters: {
      status: 'الحالة',
      framework: 'الإطار',
      statusOptions: { assigned: 'مُسنَد', pending_review: 'بانتظار المراجعة', reviewed: 'تمت مراجعته' },
    },
    approvalFilters: {
      type: 'النوع',
      status: 'الحالة',
      priority: 'الأولوية',
      statusOptions: { pending: 'قيد الانتظار', approved: 'معتمد', rejected: 'مرفوض', escalated: 'مُصعَّد' },
    },
    ownershipColumns: {
      controlName: 'اسم الضابط',
      framework: 'الإطار',
      owner: 'المسؤول',
      delegate: 'المفوَّض',
      status: 'الحالة',
      lastReviewed: 'آخر مراجعة',
      nextReview: 'المراجعة التالية',
      never: 'أبدًا',
    },
    approvalColumns: {
      title: 'العنوان',
      type: 'النوع',
      priority: 'الأولوية',
      status: 'الحالة',
      requestedBy: 'مُقدَّم من',
      approver: 'المُعتمِد',
      deadline: 'الموعد النهائي',
      created: 'تاريخ الإنشاء',
    },
    ownershipActions: { viewDetails: 'عرض التفاصيل', reassign: 'إعادة الإسناد', markReviewed: 'تعليم كمُراجَع' },
    approvalActions: { viewDetails: 'عرض التفاصيل', approve: 'اعتماد', reject: 'رفض', escalate: 'تصعيد' },
    search: { controls: 'البحث في الضوابط...', approvals: 'البحث في الاعتمادات...' },
    empty: {
      ownershipTitle: 'لا توجد سجلات ملكية ضوابط',
      ownershipDesc: 'لم تُسنَد أي ضوابط لمسؤولين بعد. ابدأ بإسناد الملكية.',
      approvalTitle: 'لا توجد طلبات اعتماد',
      approvalDesc: 'لم تُقدَّم أي طلبات اعتماد بعد. ستظهر الطلبات هنا عند إنشائها.',
    },
    toasts: { reviewed: 'تم تعليم الضابط كمُراجَع' },
    confirm: {
      markReviewedDesc: (name) => `تعليم الضابط "${name}" كمُراجَع؟ سيؤدي هذا إلى تحديث طابع المراجعة وضبط الحالة إلى "تمت مراجعته".`,
      markReviewedConfirm: 'تعليم كمُراجَع',
    },
  },
};

export function useVcisoWorkflowsListLabels(): VcisoWorkflowsListLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoWorkflowsListLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoWorkflowsListLabels);

export interface VcisoComplianceListLabels {
  tabs: { obligations: string; testing: string; dependencies: string };
  headerActions: { addObligation: string; recordTest: () => string };
  obligFilters: {
    type: string;
    status: string;
    statusOptions: { compliant: string; partially_compliant: string; non_compliant: string; not_assessed: string };
  };
  obligColumns: {
    name: string;
    type: string;
    jurisdiction: string;
    status: string;
    requirementsMet: string;
    owner: string;
    reviewDate: string;
    unassigned: string;
  };
  obligActions: { viewDetails: string; edit: string };
  obligSearch: string;
  obligEmpty: { title: string; desc: () => string };
  testFilters: { result: string; testType: string };
  testColumns: {
    controlName: string;
    framework: string;
    testType: string;
    result: string;
    tester: string;
    testDate: string;
    nextTestDate: string;
  };
  testActions: { viewDetails: string; recordNew: () => string };
  testSearch: string;
  testEmpty: { title: string; desc: () => string };
  testDetail: {
    frameworkPrefix: (framework: string) => string;
    framework: string;
    testType: string;
    tester: string;
    testDate: string;
    nextTestDate: string;
    overdueSuffix: string;
    evidenceItems: string;
    findings: string;
    noFindings: string;
  };
  depColumns: {
    controlName: string;
    framework: string;
    failureImpact: string;
    dependsOn: string;
    dependedBy: string;
    riskDomains: string;
    complianceDomains: string;
  };
  depSearch: string;
  depEmpty: { title: string; desc: string };
}

export const vcisoComplianceListLabels: CyberBilingual<VcisoComplianceListLabels> = {
  en: {
    tabs: { obligations: 'Regulatory Obligations', testing: 'Control Testing', dependencies: 'Control Dependencies' },
    headerActions: { addObligation: 'Add Obligation', recordTest: () => 'Record Test' },
    obligFilters: {
      type: 'Type',
      status: 'Status',
      statusOptions: {
        compliant: 'Compliant',
        partially_compliant: 'Partially Compliant',
        non_compliant: 'Non-Compliant',
        not_assessed: 'Not Assessed',
      },
    },
    obligColumns: {
      name: 'Name',
      type: 'Type',
      jurisdiction: 'Jurisdiction',
      status: 'Status',
      requirementsMet: 'Requirements Met',
      owner: 'Owner',
      reviewDate: 'Review Date',
      unassigned: 'Unassigned',
    },
    obligActions: { viewDetails: 'View Details', edit: 'Edit' },
    obligSearch: 'Search obligations...',
    obligEmpty: {
      title: 'No obligations found',
      desc: () => 'Add your first regulatory obligation to start tracking compliance.',
    },
    testFilters: { result: 'Result', testType: 'Test Type' },
    testColumns: {
      controlName: 'Control Name',
      framework: 'Framework',
      testType: 'Test Type',
      result: 'Result',
      tester: 'Tester',
      testDate: 'Test Date',
      nextTestDate: 'Next Test Date',
    },
    testActions: { viewDetails: 'View Details', recordNew: () => 'Record New Test' },
    testSearch: 'Search control tests...',
    testEmpty: {
      title: 'No control tests found',
      desc: () => 'Record your first control effectiveness test.',
    },
    testDetail: {
      frameworkPrefix: (framework) => `Framework: ${framework}`,
      framework: 'Framework',
      testType: 'Test Type',
      tester: 'Tester',
      testDate: 'Test Date',
      nextTestDate: 'Next Test Date',
      overdueSuffix: ' (Overdue)',
      evidenceItems: 'Evidence Items',
      findings: 'Findings',
      noFindings: 'No findings recorded.',
    },
    depColumns: {
      controlName: 'Control Name',
      framework: 'Framework',
      failureImpact: 'Failure Impact',
      dependsOn: 'Depends On',
      dependedBy: 'Depended By',
      riskDomains: 'Risk Domains',
      complianceDomains: 'Compliance Domains',
    },
    depSearch: 'Search dependencies...',
    depEmpty: {
      title: 'No control dependencies found',
      desc: 'Control dependency mappings will appear here once configured.',
    },
  },
  ar: {
    tabs: { obligations: 'الالتزامات التنظيمية', testing: 'اختبار الضوابط', dependencies: 'اعتماديات الضوابط' },
    headerActions: { addObligation: 'إضافة التزام', recordTest: () => 'تسجيل الاختبار' },
    obligFilters: {
      type: 'النوع',
      status: 'الحالة',
      statusOptions: {
        compliant: 'ممتثل',
        partially_compliant: 'ممتثل جزئيًا',
        non_compliant: 'غير ممتثل',
        not_assessed: 'غير مُقيَّم',
      },
    },
    obligColumns: {
      name: 'الاسم',
      type: 'النوع',
      jurisdiction: 'الاختصاص القضائي',
      status: 'الحالة',
      requirementsMet: 'المتطلبات المستوفاة',
      owner: 'المسؤول',
      reviewDate: 'تاريخ المراجعة',
      unassigned: 'غير مُسنَد',
    },
    obligActions: { viewDetails: 'عرض التفاصيل', edit: 'تعديل' },
    obligSearch: 'البحث في الالتزامات...',
    obligEmpty: {
      title: 'لا توجد التزامات',
      desc: () => 'أضف أول التزام تنظيمي لبدء تتبّع الامتثال.',
    },
    testFilters: { result: 'النتيجة', testType: 'نوع الاختبار' },
    testColumns: {
      controlName: 'اسم الضابط',
      framework: 'الإطار',
      testType: 'نوع الاختبار',
      result: 'النتيجة',
      tester: 'المختبِر',
      testDate: 'تاريخ الاختبار',
      nextTestDate: 'تاريخ الاختبار التالي',
    },
    testActions: { viewDetails: 'عرض التفاصيل', recordNew: () => 'تسجيل اختبار جديد' },
    testSearch: 'البحث في اختبارات الضوابط...',
    testEmpty: {
      title: 'لا توجد اختبارات ضوابط',
      desc: () => 'سجّل أول اختبار لفعالية ضابط.',
    },
    testDetail: {
      frameworkPrefix: (framework) => `الإطار: ${framework}`,
      framework: 'الإطار',
      testType: 'نوع الاختبار',
      tester: 'المختبِر',
      testDate: 'تاريخ الاختبار',
      nextTestDate: 'تاريخ الاختبار التالي',
      overdueSuffix: ' (متأخر)',
      evidenceItems: 'عناصر الأدلة',
      findings: 'النتائج',
      noFindings: 'لم تُسجَّل نتائج.',
    },
    depColumns: {
      controlName: 'اسم الضابط',
      framework: 'الإطار',
      failureImpact: 'أثر الفشل',
      dependsOn: 'يعتمد على',
      dependedBy: 'يعتمد عليه',
      riskDomains: 'مجالات المخاطر',
      complianceDomains: 'مجالات الامتثال',
    },
    depSearch: 'البحث في الاعتماديات...',
    depEmpty: {
      title: 'لا توجد اعتماديات ضوابط',
      desc: 'ستظهر تعيينات اعتماديات الضوابط هنا بعد تهيئتها.',
    },
  },
};

export function useVcisoComplianceListLabels(): VcisoComplianceListLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoComplianceListLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoComplianceListLabels);

export interface VcisoIntegrationsListLabels {
  refresh: string;
  addIntegration: string;
  kpi: {
    connectedSummary: (n: number) => string;
    ofTotal: (n: number) => string;
    requireAttention: string;
    allNominal: string;
    acrossAll: string;
  };
  categoryDescriptions: {
    asset_management: string;
    ticketing: string;
    cloud_security: string;
    data_protection: string;
    siem: string;
    iam: string;
  };
  upSuffix: (n: number) => string;
  search: string;
  filterAll: { types: string; status: () => string; health: string };
  statusOptions: { connected: string; disconnected: string; error: string; pending: string };
  healthOptions: { healthy: string; degraded: string; unavailable: string };
  clearFilters: string;
  empty: { matchingTitle: string; noneTitle: string; matchingDesc: string; noneDesc: string };
  showing: (shown: number, total: number) => string;
  toasts: { disconnected: string; reconnecting: string; removed: string };
  confirm: {
    disconnectTitle: string;
    disconnectDesc: (name: string) => string;
    disconnectConfirm: string;
    removeTitle: string;
    removeDesc: (name: string) => string;
    removeConfirm: string;
  };
}

export const vcisoIntegrationsListLabels: CyberBilingual<VcisoIntegrationsListLabels> = {
  en: {
    refresh: 'Refresh',
    addIntegration: 'Add Integration',
    kpi: {
      connectedSummary: (n) => `${n} connected`,
      ofTotal: (n) => `of ${n} total`,
      requireAttention: 'Require attention',
      allNominal: 'All systems nominal',
      acrossAll: 'Across all integrations',
    },
    categoryDescriptions: {
      asset_management: 'Asset inventory and CMDB integrations',
      ticketing: 'Issue tracking and service desk',
      cloud_security: 'Cloud security posture management',
      data_protection: 'DLP and data classification',
      siem: 'Security information and event management',
      iam: 'Identity and access management',
    },
    upSuffix: (n) => `${n} up`,
    search: 'Search integrations...',
    filterAll: { types: 'All Types', status: () => 'All Status', health: 'All Health' },
    statusOptions: { connected: 'Connected', disconnected: 'Disconnected', error: 'Error', pending: 'Pending' },
    healthOptions: { healthy: 'Healthy', degraded: 'Degraded', unavailable: 'Unavailable' },
    clearFilters: 'Clear filters',
    empty: {
      matchingTitle: 'No matching integrations',
      noneTitle: 'No integrations yet',
      matchingDesc: 'Try adjusting your filters to see more results.',
      noneDesc: 'Connect your first external security tool to start syncing data.',
    },
    showing: (shown, total) => `Showing ${shown} of ${total} integrations`,
    toasts: {
      disconnected: 'Integration disconnected',
      reconnecting: 'Integration reconnecting…',
      removed: 'Integration removed',
    },
    confirm: {
      disconnectTitle: 'Disconnect Integration',
      disconnectDesc: (name) => `Are you sure you want to disconnect "${name}"? This will pause all data synchronization. You can reconnect later by editing the integration.`,
      disconnectConfirm: 'Disconnect',
      removeTitle: 'Remove Integration',
      removeDesc: (name) => `Are you sure you want to permanently remove "${name}"? This action cannot be undone.`,
      removeConfirm: 'Remove',
    },
  },
  ar: {
    refresh: 'تحديث',
    addIntegration: 'إضافة تكامل',
    kpi: {
      connectedSummary: (n) => `${n} متصل`,
      ofTotal: (n) => `من ${n} إجمالًا`,
      requireAttention: 'تتطلّب اهتمامًا',
      allNominal: 'جميع الأنظمة طبيعية',
      acrossAll: 'عبر جميع التكاملات',
    },
    categoryDescriptions: {
      asset_management: 'تكاملات جرد الأصول وقاعدة بيانات إدارة التهيئة (CMDB)',
      ticketing: 'تتبّع المشكلات ومكتب الخدمة',
      cloud_security: 'إدارة وضع أمن السحابة',
      data_protection: 'منع فقدان البيانات (DLP) وتصنيف البيانات',
      siem: 'إدارة معلومات وأحداث الأمن',
      iam: 'إدارة الهوية والوصول',
    },
    upSuffix: (n) => `${n} نشط`,
    search: 'البحث في التكاملات...',
    filterAll: { types: 'كل الأنواع', status: () => 'كل الحالات', health: 'كل حالات الصحة' },
    statusOptions: { connected: 'متصل', disconnected: 'غير متصل', error: 'خطأ', pending: 'قيد الانتظار' },
    healthOptions: { healthy: 'سليم', degraded: 'متدهور', unavailable: 'غير متاح' },
    clearFilters: 'مسح عوامل التصفية',
    empty: {
      matchingTitle: 'لا توجد تكاملات مطابقة',
      noneTitle: 'لا توجد تكاملات بعد',
      matchingDesc: 'حاول تعديل عوامل التصفية لعرض المزيد من النتائج.',
      noneDesc: 'اربط أول أداة أمنية خارجية لبدء مزامنة البيانات.',
    },
    showing: (shown, total) => `عرض ${shown} من ${total} تكامل`,
    toasts: {
      disconnected: 'تم قطع اتصال التكامل',
      reconnecting: 'جارٍ إعادة اتصال التكامل…',
      removed: 'تمت إزالة التكامل',
    },
    confirm: {
      disconnectTitle: 'قطع اتصال التكامل',
      disconnectDesc: (name) => `هل أنت متأكد من قطع اتصال "${name}"؟ سيؤدي هذا إلى إيقاف جميع مزامنة البيانات مؤقتًا. يمكنك إعادة الاتصال لاحقًا بتعديل التكامل.`,
      disconnectConfirm: 'قطع الاتصال',
      removeTitle: 'إزالة التكامل',
      removeDesc: (name) => `هل أنت متأكد من إزالة "${name}" نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.`,
      removeConfirm: 'إزالة',
    },
  },
};

export function useVcisoIntegrationsListLabels(): VcisoIntegrationsListLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(vcisoIntegrationsListLabels, locale), [locale]);
}

registerMessages('cyberVciso', vcisoIntegrationsListLabels);
