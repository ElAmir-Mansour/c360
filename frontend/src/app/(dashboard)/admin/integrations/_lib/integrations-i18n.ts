"use client";

/**
 * Bilingual (English + Modern Standard Arabic) copy for the admin External
 * Integrations console (provider readiness, configured integrations, the
 * integration form dialog with per-provider connection fields and event
 * filters, the delivery log, ticket links, and the ticket-link detail page).
 *
 * Pattern: a single `INTEGRATIONS_I18N` bundle holds two full, same-shaped
 * copies of the label object — `en` and professional MSA `ar`. Components call
 * {@link useIntegrationsT} and read `t.someKey`. English is preserved exactly;
 * established acronyms/product names (Slack, Teams, Jira, ServiceNow, OAuth,
 * JSON, HTTP, URL, ID) are kept verbatim.
 */

import { useLocale } from "@/components/providers/locale-provider";

export interface IntegrationsLabels {
  // List page header
  pageTitle: string;
  pageDescription: string;
  manualSetup: string;
  refresh: string;
  loadErrorTitle: string;
  loadIntegrationsError: string;

  // Hero eyebrow + fleet tags + KPI strip (connector-marketplace uplift)
  integrationHub: string;
  providersChip: string;
  activeChip: string;
  setupPendingChip: string;
  withErrorsChip: string;
  kpiTotalConnectors: string;
  kpiActive: string;
  kpiDeliveries: string;
  kpiErrors: string;
  manualMode: string;
  configuredCountLabel: (n: number) => string;
  providerNames: Record<string, string>;
  providerDescriptions: Record<string, string>;
  typeLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  deliveryStatusLabels: Record<string, string>;
  eventTypeLabels: Record<string, string>;
  severityLabels: Record<string, string>;
  suiteLabels: Record<string, string>;
  syncDirectionLabels: Record<string, string>;
  entityTypeLabels: Record<string, string>;
  externalSystemLabels: Record<string, string>;
  externalStatusLabels: Record<string, string>;
  priorityLabels: Record<string, string>;

  // Provider readiness section
  providerReadinessTitle: string;
  providerReadinessDescription: string;
  ready: string;
  runtimeConfigNeeded: string;
  setupMode: string;
  inbound: string;
  outbound: string;
  yes: string;
  no: string;
  configuredIntegrations: string;
  runtimeValuesMissingTitle: string;
  connectViaOAuth: string;
  advancedSetup: string;
  oauthNotAvailable: string;
  unableToStartOAuth: string;

  // Configured integrations section
  configuredTitle: string;
  configuredDescription: string;
  noIntegrationsTitle: string;
  noIntegrationsDescription: string;
  deliveries: string;
  errors: string;
  lastUsed: string;
  updated: string;
  never: string;
  configurationLabel: string;
  deliveryIssue: string;
  attentionNeeded: string;
  noErrorRecorded: string;
  integrationDiagnosticMessage: string;
  deliveryDiagnosticMessage: string;
  ticketSyncDiagnosticMessage: string;
  technicalDetails: string;
  viewDetails: string;
  edit: string;
  test: string;
  retryFailed: string;
  enable: string;
  disable: string;
  delete: string;

  // Toasts (list + detail)
  testCompleted: (code: number) => string;
  testFailed: string;
  requeued: (count: number) => string;
  retryToastFailed: string;
  integrationMarked: (status: string) => string;
  statusUpdateFailed: string;
  integrationDeleted: string;
  deleteFailed: string;
  configUpdated: string;

  // Delete confirm
  deleteIntegrationTitle: string;
  deleteIntegrationDesc: (name: string) => string;

  // Detail page
  integrationUnavailableTitle: string;
  integrationUnavailableMessage: string;
  setupPendingTitle: string;
  setupPendingWithFields: (fields: string) => string;
  setupPendingNoFields: string;
  usageTitle: string;
  usageDescription: string;
  consecutiveErrors: string;
  recently: string;
  created: string;
  configurationSummaryTitle: string;
  configurationSummaryDescription: string;
  noConfigValues: string;
  integrationErrorTitle: string;
  attentionRequired: string;
  overviewTab: string;
  deliveryLogTab: string;
  ticketLinksTab: string;
  integrationNotesTitle: string;
  noDescription: string;
  typeLabel: string;
  statusLabel: string;
  createdByLabel: string;
  filtersTitle: string;
  filtersDescription: string;
  statusFilterLabel: string;
  eventTypeFilterLabel: string;
  all: string;
  pending: string;
  retrying: string;
  delivered: string;
  failed: string;
  deliveryRecordsTitle: string;
  deliveryRecordsDescription: (total: number) => string;
  loadDeliveriesError: string;
  externalTicketLinksTitle: string;
  externalTicketLinksDescription: string;
  loadTicketLinksError: string;
  ticketLinkSynced: string;
  ticketLinkSyncFailed: string;
  page: string;
  of: string;
  previous: string;
  next: string;

  // Form dialog
  configureIntegration: string;
  editName: (name: string) => string;
  editDescription: string;
  createDescription: string;
  provider: string;
  oauthAvailableTitle: string;
  oauthConfiguredHint: (provider: string, field: string) => string;
  oauthNotConfiguredHint: (provider: string) => string;
  channelWord: string;
  projectWord: string;
  missingRuntimeConfig: (values: string) => string;
  name: string;
  namePlaceholder: (type: string) => string;
  type: string;
  selectTypePlaceholder: string;
  description: string;
  descriptionPlaceholder: string;
  cancel: string;
  saving: string;
  saveChanges: string;
  createIntegration: string;
  integrationUpdated: (type: string) => string;
  integrationCreated: (type: string) => string;
  unableToSaveIntegration: string;
  invalidJson: (field: string) => string;
  oauthUnavailableProvider: string;

  // Connection field sections
  slackConnectionTitle: string;
  slackConnectionDesc: string;
  teamsConnectionTitle: string;
  teamsConnectionDesc: string;
  jiraConnectionTitle: string;
  jiraConnectionDesc: string;
  servicenowConnectionTitle: string;
  servicenowConnectionDesc: string;
  webhookConnectionTitle: string;
  webhookConnectionDesc: string;

  secretHintEditing: string;
  secretHintNew: string;

  // Field labels
  botToken: string;
  signingSecret: string;
  signingSecretPlaceholder: string;
  workspaceId: string;
  workspaceName: string;
  channelId: string;
  incomingWebhookUrl: string;
  threadPerAlert: string;
  includeExplanation: string;
  botAppId: string;
  botPassword: string;
  serviceUrl: string;
  conversationId: string;
  tenantId: string;
  baseUrl: string;
  cloudId: string;
  projectKey: string;
  issueTypeId: string;
  authToken: string;
  refreshToken: string;
  webhookSecret: string;
  webhookSecretJiraHint: string;
  webhookSecretServiceNowHint: string;
  priorityMappingJson: string;
  statusMappingJson: string;
  customFieldsJson: string;
  instanceUrl: string;
  authType: string;
  basic: string;
  oauth: string;
  username: string;
  password: string;
  oauthTokenLabel: string;
  assignmentGroup: string;
  callerId: string;
  category: string;
  subcategory: string;
  url: string;
  method: string;
  contentType: string;
  sharedSecret: string;
  headersJson: string;
  toggleFieldHint: string;
  workspaceNamePlaceholder: string;
  categoryPlaceholder: string;
  subcategoryPlaceholder: string;

  // Event filter editor
  eventFiltersTitle: string;
  eventFiltersDescription: string;
  filterRule: string;
  filterRuleNumbered: (n: number) => string;
  remove: string;
  eventTypes: string;
  severities: string;
  suites: string;
  minimumConfidence: string;
  addFilterRule: string;

  // Delivery log table
  noDeliveryRecords: string;
  event: string;
  attempts: string;
  response: string;
  latency: string;
  nextRetry: string;
  createdHeader: string;
  statusHeader: string;

  // Ticket links table
  noTicketLinks: string;
  externalTicket: string;
  entity: string;
  direction: string;
  lastSynced: string;
  actions: string;
  unknown: string;
  details: string;
  open: string;
  sync: string;

  // Ticket link detail page
  ticketLinkUnavailable: string;
  linkedTicketDescription: (system: string, entityType: string, entityId: string) => string;
  forceSync: string;
  openTicket: string;
  ticketLinkSyncError: string;
  externalRecordTitle: string;
  externalRecordDescription: string;
  system: string;
  key: string;
  externalIdLabel: string;
  priorityLabel: string;
  clarioLinkageTitle: string;
  clarioLinkageDescription: string;
  integrationLabel: string;
  entityTypeLabel: string;
  entityIdLabel: string;
  syncDirectionLabel: string;
  lastSyncDirectionLabel: string;
  timestampsTitle: string;
  lastSyncErrorTitle: string;
  backToIntegration: string;

  // Config-summary row labels (per provider)
  summaryWorkspace: string;
  summaryChannel: string;
  summaryIncomingWebhook: string;
  summaryBotApp: string;
  summaryConversation: string;
  summaryServiceUrl: string;
  summaryBaseUrl: string;
  summaryProject: string;
  summaryIssueType: string;
  summaryInstance: string;
  summaryAuth: string;
  summaryAssignmentGroup: string;
  summaryUrl: string;
  summaryMethod: string;
  summaryContentType: string;
}

/** Stable keys for config-summary rows so the resolver stays locale-agnostic. */
export type ConfigSummaryKey =
  | "workspace"
  | "channel"
  | "incomingWebhook"
  | "botApp"
  | "conversation"
  | "serviceUrl"
  | "baseUrl"
  | "project"
  | "issueType"
  | "instance"
  | "auth"
  | "assignmentGroup"
  | "url"
  | "method"
  | "contentType";

export function configSummaryLabel(t: IntegrationsLabels, key: ConfigSummaryKey): string {
  switch (key) {
    case "workspace":
      return t.summaryWorkspace;
    case "channel":
      return t.summaryChannel;
    case "incomingWebhook":
      return t.summaryIncomingWebhook;
    case "botApp":
      return t.summaryBotApp;
    case "conversation":
      return t.summaryConversation;
    case "serviceUrl":
      return t.summaryServiceUrl;
    case "baseUrl":
      return t.summaryBaseUrl;
    case "project":
      return t.summaryProject;
    case "issueType":
      return t.summaryIssueType;
    case "instance":
      return t.summaryInstance;
    case "auth":
      return t.summaryAuth;
    case "assignmentGroup":
      return t.summaryAssignmentGroup;
    case "url":
      return t.summaryUrl;
    case "method":
      return t.summaryMethod;
    case "contentType":
      return t.summaryContentType;
  }
}

export interface ProviderPresentationInput {
  type: string;
  name: string;
  description: string;
}

export function providerPresentation(
  t: IntegrationsLabels,
  provider: ProviderPresentationInput,
): { name: string; description: string } {
  const key = providerKey(provider);
  const isArabic = isArabicLabels(t);
  return {
    name: t.providerNames[key] ?? (isArabic ? t.unknown : provider.name),
    description: t.providerDescriptions[key] ?? (isArabic ? t.unknown : provider.description),
  };
}

export function integrationTypeLabel(t: IntegrationsLabels, type: string): string {
  return t.typeLabels[providerKey({ type, name: type, description: "" })] ?? fallbackToken(t, type);
}

export function integrationStatusLabel(t: IntegrationsLabels, status: string): string {
  return labelFromMap(t, t.statusLabels, status);
}

export function deliveryStatusLabel(t: IntegrationsLabels, status: string): string {
  return labelFromMap(t, t.deliveryStatusLabels, status);
}

export function eventTypeLabel(t: IntegrationsLabels, eventType: string): string {
  return labelFromMap(t, t.eventTypeLabels, eventType);
}

export function severityLabel(t: IntegrationsLabels, severity: string): string {
  return labelFromMap(t, t.severityLabels, severity);
}

export function suiteLabel(t: IntegrationsLabels, suite: string): string {
  return labelFromMap(t, t.suiteLabels, suite);
}

export function syncDirectionLabel(t: IntegrationsLabels, direction?: string | null): string {
  return direction ? labelFromMap(t, t.syncDirectionLabels, direction) : t.unknown;
}

export function entityTypeLabel(t: IntegrationsLabels, entityType: string): string {
  return labelFromMap(t, t.entityTypeLabels, entityType);
}

export function externalSystemLabel(t: IntegrationsLabels, system: string): string {
  return labelFromMap(t, t.externalSystemLabels, system);
}

export function externalStatusLabel(t: IntegrationsLabels, status?: string | null): string {
  return status ? labelFromMap(t, t.externalStatusLabels, status) : t.unknown;
}

export function priorityLabel(t: IntegrationsLabels, priority?: string | null): string {
  return priority ? labelFromMap(t, t.priorityLabels, priority) : t.unknown;
}

export function errorToastMessage(t: IntegrationsLabels, error: unknown, fallback: string): string {
  return !isArabicLabels(t) && error instanceof Error ? error.message : fallback;
}

export function visibleDiagnosticMessage(
  t: IntegrationsLabels,
  rawMessage: string,
  fallback: string,
): string {
  return isArabicLabels(t) ? fallback : rawMessage;
}

export function technicalDiagnosticMessage(t: IntegrationsLabels, rawMessage?: string | null): string | null {
  return isArabicLabels(t) && rawMessage ? rawMessage : null;
}

function labelFromMap(t: IntegrationsLabels, map: Record<string, string>, value: string): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[\s-]+/g, "_");
  return map[trimmed] ?? map[lower] ?? map[normalized] ?? fallbackToken(t, trimmed);
}

function fallbackToken(t: IntegrationsLabels, value: string): string {
  return isArabicLabels(t) ? t.unknown : value.replace(/[._-]+/g, " ");
}

function isArabicLabels(t: IntegrationsLabels): boolean {
  return t === INTEGRATIONS_I18N.ar;
}

function providerKey(provider: ProviderPresentationInput): string {
  const raw = `${provider.type} ${provider.name}`.toLowerCase();
  const compact = raw.replace(/[^a-z0-9]/g, "");
  if (compact.includes("slack")) return "slack";
  if (compact.includes("team") || compact.includes("microsoft")) return "teams";
  if (compact.includes("jira")) return "jira";
  if (compact.includes("service")) return "servicenow";
  if (compact.includes("pager")) return "pagerduty";
  if (compact.includes("email") || compact.includes("smtp") || compact.includes("mail")) return "email";
  if (compact.includes("rest")) return "rest";
  if (compact.includes("generic")) return "genericWebhook";
  if (compact.includes("webhook") || compact.includes("http")) return "webhook";
  return compact || "unknown";
}

type IntegrationsBundle = { en: IntegrationsLabels; ar: IntegrationsLabels };

export const INTEGRATIONS_I18N: IntegrationsBundle = {
  en: {
    pageTitle: "External Integrations",
    pageDescription:
      "Operate Slack, Teams, Jira, ServiceNow, and webhook connectors from one place.",
    manualSetup: "Manual Setup",
    refresh: "Refresh",
    loadErrorTitle: "Unable to load integration admin data",
    loadIntegrationsError: "Failed to load integrations",

    integrationHub: "Integration Hub",
    providersChip: "providers",
    activeChip: "active",
    setupPendingChip: "setup pending",
    withErrorsChip: "with errors",
    kpiTotalConnectors: "Connectors",
    kpiActive: "Active",
    kpiDeliveries: "Deliveries",
    kpiErrors: "Errors",
    manualMode: "Manual",
    configuredCountLabel: (n) => `${n} configured`,
    providerNames: {
      slack: "Slack",
      teams: "Microsoft Teams",
      jira: "Jira Cloud",
      servicenow: "ServiceNow",
      pagerduty: "PagerDuty",
      email: "Email (SMTP)",
      rest: "REST / Webhook",
      webhook: "Generic Webhook",
      genericWebhook: "Generic Webhook",
    },
    providerDescriptions: {
      slack: "Workspace install plus slash commands, interactions, and inbound status.",
      teams: "Manual Bot Framework setup for outbound cards and inbound bot commands.",
      jira: "OAuth install for outbound ticket creation and inbound status.",
      servicenow: "Manual incident integration with bidirectional webhook synchronization.",
      pagerduty: "Config-driven connector delivered via the connector registry.",
      email: "Config-driven connector delivered via the connector registry.",
      rest: "Config-driven connector delivered via the connector registry.",
      webhook: "Signed outbound webhook delivery to arbitrary HTTP endpoints.",
      genericWebhook: "Signed outbound webhook delivery to arbitrary HTTP endpoints.",
    },
    typeLabels: {
      slack: "Slack",
      teams: "Microsoft Teams",
      jira: "Jira",
      servicenow: "ServiceNow",
      pagerduty: "PagerDuty",
      email: "Email",
      rest: "REST / Webhook",
      webhook: "Webhook",
      genericWebhook: "Generic Webhook",
    },
    statusLabels: {
      active: "active",
      inactive: "inactive",
      error: "error",
      setup_pending: "setup pending",
    },
    deliveryStatusLabels: {
      pending: "Pending",
      retrying: "Retrying",
      delivered: "Delivered",
      failed: "Failed",
    },
    eventTypeLabels: {
      "alert.created": "Alert created",
      "alert.escalated": "Alert escalated",
      "alert.resolved": "Alert resolved",
      "remediation.started": "Remediation started",
      "pipeline.failed": "Pipeline failed",
      "quality.failed": "Quality failed",
      "contradiction.detected": "Contradiction detected",
      "meeting.scheduled": "Meeting scheduled",
      "action_item.overdue": "Action item overdue",
      "contract.expiring": "Contract expiring",
    },
    severityLabels: {
      critical: "Critical",
      high: "High",
      medium: "Medium",
      low: "Low",
      info: "Info",
    },
    suiteLabels: {
      cyber: "Cyber",
      data: "Data",
      acta: "Acta",
      lex: "Lex",
      visus: "Visus",
      platform: "Platform",
    },
    syncDirectionLabels: {
      inbound: "Inbound",
      outbound: "Outbound",
      bidirectional: "Bidirectional",
    },
    entityTypeLabels: {
      alert: "Alert",
      incident: "Incident",
      ticket: "Ticket",
      case: "Case",
      contract: "Contract",
      document: "Document",
      request: "Request",
    },
    externalSystemLabels: {
      jira: "Jira",
      servicenow: "ServiceNow",
      service_now: "ServiceNow",
    },
    externalStatusLabels: {
      open: "Open",
      new: "New",
      todo: "To do",
      "to do": "To do",
      in_progress: "In progress",
      pending: "Pending",
      resolved: "Resolved",
      closed: "Closed",
      done: "Done",
      blocked: "Blocked",
    },
    priorityLabels: {
      critical: "Critical",
      high: "High",
      medium: "Medium",
      low: "Low",
      info: "Info",
      urgent: "Urgent",
    },

    providerReadinessTitle: "Provider Readiness",
    providerReadinessDescription:
      "OAuth-backed providers expose their runtime readiness here. Manual setup remains available for every integration type.",
    ready: "ready",
    runtimeConfigNeeded: "runtime config needed",
    setupMode: "Setup mode",
    inbound: "Inbound",
    outbound: "Outbound",
    yes: "Yes",
    no: "No",
    configuredIntegrations: "Configured integrations",
    runtimeValuesMissingTitle: "Runtime values missing",
    connectViaOAuth: "Connect via OAuth",
    advancedSetup: "Advanced Setup",
    oauthNotAvailable: "OAuth is not available for this provider",
    unableToStartOAuth: "Unable to start OAuth setup",

    configuredTitle: "Configured Integrations",
    configuredDescription:
      "Inspect delivery state, finish setup-pending installs, and jump into the detail pages for logs and ticket sync.",
    noIntegrationsTitle: "No integrations configured",
    noIntegrationsDescription:
      "Start from the provider cards above or open the manual setup dialog to create the first integration.",
    deliveries: "Deliveries",
    errors: "Errors",
    lastUsed: "Last used",
    updated: "Updated",
    never: "Never",
    configurationLabel: "Configuration",
    deliveryIssue: "Delivery issue",
    attentionNeeded: "Attention needed",
    noErrorRecorded: "No current integration error recorded.",
    integrationDiagnosticMessage: "Integration diagnostic detail is available.",
    deliveryDiagnosticMessage: "Delivery diagnostic detail is available.",
    ticketSyncDiagnosticMessage: "Ticket synchronization diagnostic detail is available.",
    technicalDetails: "Technical details",
    viewDetails: "View Details",
    edit: "Edit",
    test: "Test",
    retryFailed: "Retry Failed",
    enable: "Enable",
    disable: "Disable",
    delete: "Delete",

    testCompleted: (code) => `Test completed with HTTP ${code}`,
    testFailed: "Integration test failed",
    requeued: (count) => `Re-queued ${count} failed deliveries`,
    retryToastFailed: "Retry failed",
    integrationMarked: (status) => `Integration marked ${status}`,
    statusUpdateFailed: "Status update failed",
    integrationDeleted: "Integration deleted",
    deleteFailed: "Delete failed",
    configUpdated: "Integration configuration updated",

    deleteIntegrationTitle: "Delete integration",
    deleteIntegrationDesc: (name) => `Delete "${name}" and cancel its pending deliveries?`,

    integrationUnavailableTitle: "Integration unavailable",
    integrationUnavailableMessage: "The selected integration could not be loaded.",
    setupPendingTitle: "Setup still needs completion",
    setupPendingWithFields: (fields) =>
      `Complete the missing fields to move this integration to active: ${fields}.`,
    setupPendingNoFields:
      "This integration is still pending completion. Review the configuration below and save the required fields.",
    usageTitle: "Usage",
    usageDescription: "Delivery and runtime health for this integration.",
    consecutiveErrors: "Consecutive errors",
    recently: "recently",
    created: "Created",
    configurationSummaryTitle: "Configuration Summary",
    configurationSummaryDescription:
      "Sanitized, non-secret values currently stored for this integration.",
    noConfigValues: "No non-secret configuration values available.",
    integrationErrorTitle: "Integration error",
    attentionRequired: "Attention required",
    overviewTab: "Overview",
    deliveryLogTab: "Delivery Log",
    ticketLinksTab: "Ticket Links",
    integrationNotesTitle: "Integration Notes",
    noDescription: "No description recorded.",
    typeLabel: "Type",
    statusLabel: "Status",
    createdByLabel: "Created by",
    filtersTitle: "Filters",
    filtersDescription: "Slice the delivery log by status or event type.",
    statusFilterLabel: "Status",
    eventTypeFilterLabel: "Event type",
    all: "All",
    pending: "Pending",
    retrying: "Retrying",
    delivered: "Delivered",
    failed: "Failed",
    deliveryRecordsTitle: "Delivery Records",
    deliveryRecordsDescription: (total) => `${total} matching record(s) across this integration.`,
    loadDeliveriesError: "Failed to load delivery records",
    externalTicketLinksTitle: "External Ticket Links",
    externalTicketLinksDescription:
      "Bidirectional sync state for Jira or ServiceNow tickets linked through this integration.",
    loadTicketLinksError: "Failed to load ticket links",
    ticketLinkSynced: "Ticket link synchronized",
    ticketLinkSyncFailed: "Ticket link sync failed",
    page: "Page",
    of: "of",
    previous: "Previous",
    next: "Next",

    configureIntegration: "Configure Integration",
    editName: (name) => `Edit ${name}`,
    editDescription:
      "Update connection settings, delivery filters, and synchronization behavior.",
    createDescription: "Create a new outbound or bidirectional integration for your tenant.",
    provider: "Provider",
    oauthAvailableTitle: "OAuth-assisted setup is available",
    oauthConfiguredHint: (provider, field) =>
      `Use ${provider} OAuth to prefill tenant credentials, then finish the remaining ${field} fields in Clario360.`,
    oauthNotConfiguredHint: (provider) =>
      `${provider} OAuth is not configured in this local runtime. You can still use advanced/manual setup below.`,
    channelWord: "channel",
    projectWord: "project",
    missingRuntimeConfig: (values) => `Missing runtime config: ${values}`,
    name: "Name",
    namePlaceholder: (type) => `${type} production integration`,
    type: "Type",
    selectTypePlaceholder: "Select an integration type",
    description: "Description",
    descriptionPlaceholder:
      "Where this integration is used, what it notifies, and who owns it.",
    cancel: "Cancel",
    saving: "Saving...",
    saveChanges: "Save Changes",
    createIntegration: "Create Integration",
    integrationUpdated: (type) => `${type} integration updated`,
    integrationCreated: (type) => `${type} integration created`,
    unableToSaveIntegration: "Unable to save integration",
    invalidJson: (field) => `Invalid JSON in "${field}". Please check the syntax and try again.`,
    oauthUnavailableProvider: "OAuth is unavailable for this provider",

    slackConnectionTitle: "Slack Connection",
    slackConnectionDesc:
      "OAuth can populate the workspace credentials automatically. Manual fields remain available for advanced setup.",
    teamsConnectionTitle: "Teams Connection",
    teamsConnectionDesc:
      "Configure the Bot Framework app credentials and the target conversation details.",
    jiraConnectionTitle: "Jira Connection",
    jiraConnectionDesc:
      "Project and token fields can be completed after OAuth or entered manually for advanced setup.",
    servicenowConnectionTitle: "ServiceNow Connection",
    servicenowConnectionDesc:
      "Choose the auth mode and provide the corresponding credentials, assignment defaults, and inbound webhook secret.",
    webhookConnectionTitle: "Webhook Connection",
    webhookConnectionDesc:
      "Configure the outbound receiver, request method, signed secret, and any static headers.",

    secretHintEditing: "Leave blank to keep the stored secret.",
    secretHintNew: "Required for a working integration.",

    botToken: "Bot token",
    signingSecret: "Signing secret",
    signingSecretPlaceholder: "Set via OAuth or enter manually",
    workspaceId: "Workspace ID",
    workspaceName: "Workspace name",
    channelId: "Channel ID",
    incomingWebhookUrl: "Incoming webhook URL",
    threadPerAlert: "Thread updates per alert",
    includeExplanation: "Include explanation content",
    botAppId: "Bot app ID",
    botPassword: "Bot password",
    serviceUrl: "Service URL",
    conversationId: "Conversation ID",
    tenantId: "Tenant ID",
    baseUrl: "Base URL",
    cloudId: "Cloud ID",
    projectKey: "Project key",
    issueTypeId: "Issue type ID",
    authToken: "Auth token",
    refreshToken: "Refresh token",
    webhookSecret: "Webhook secret",
    webhookSecretJiraHint: "Used to verify inbound Jira webhooks.",
    webhookSecretServiceNowHint:
      "Shared secret for outbound ServiceNow business-rule callbacks.",
    priorityMappingJson: "Priority mapping JSON",
    statusMappingJson: "Status mapping JSON",
    customFieldsJson: "Custom fields JSON",
    instanceUrl: "Instance URL",
    authType: "Auth type",
    basic: "Basic",
    oauth: "OAuth",
    username: "Username",
    password: "Password",
    oauthTokenLabel: "OAuth token",
    assignmentGroup: "Assignment group",
    callerId: "Caller ID",
    category: "Category",
    subcategory: "Subcategory",
    url: "URL",
    method: "Method",
    contentType: "Content type",
    sharedSecret: "Shared secret",
    headersJson: "Headers JSON",
    toggleFieldHint: "Stored as part of the integration configuration.",
    workspaceNamePlaceholder: "Security Operations",
    categoryPlaceholder: "Security",
    subcategoryPlaceholder: "Threat Detection",

    eventFiltersTitle: "Event Filters",
    eventFiltersDescription:
      "Leave everything empty to deliver every event. Multiple filter rules are evaluated with OR logic — an event matching any rule is delivered.",
    filterRule: "Filter rule",
    filterRuleNumbered: (n) => `Filter rule ${n}`,
    remove: "Remove",
    eventTypes: "Event types",
    severities: "Severities",
    suites: "Suites",
    minimumConfidence: "Minimum confidence",
    addFilterRule: "Add filter rule",

    noDeliveryRecords: "No delivery records match the current filters.",
    event: "Event",
    attempts: "Attempts",
    response: "Response",
    latency: "Latency",
    nextRetry: "Next Retry",
    createdHeader: "Created",
    statusHeader: "Status",

    noTicketLinks: "No external ticket links are recorded for this integration.",
    externalTicket: "External Ticket",
    entity: "Entity",
    direction: "Direction",
    lastSynced: "Last Synced",
    actions: "Actions",
    unknown: "Unknown",
    details: "Details",
    open: "Open",
    sync: "Sync",

    ticketLinkUnavailable: "Failed to load ticket link",
    linkedTicketDescription: (system, entityType, entityId) =>
      `Linked ${system} ticket for ${entityType} ${entityId}`,
    forceSync: "Force Sync",
    openTicket: "Open Ticket",
    ticketLinkSyncError: "Unable to synchronize ticket link",
    externalRecordTitle: "External Record",
    externalRecordDescription: "Current external system metadata and sync status.",
    system: "System",
    key: "Key",
    externalIdLabel: "External ID",
    priorityLabel: "Priority",
    clarioLinkageTitle: "Clario Linkage",
    clarioLinkageDescription: "How this external ticket is mapped back into Clario360.",
    integrationLabel: "Integration",
    entityTypeLabel: "Entity type",
    entityIdLabel: "Entity ID",
    syncDirectionLabel: "Sync direction",
    lastSyncDirectionLabel: "Last sync direction",
    timestampsTitle: "Timestamps",
    lastSyncErrorTitle: "Last Sync Error",
    backToIntegration: "Back to Integration",

    summaryWorkspace: "Workspace",
    summaryChannel: "Channel",
    summaryIncomingWebhook: "Incoming webhook",
    summaryBotApp: "Bot app",
    summaryConversation: "Conversation",
    summaryServiceUrl: "Service URL",
    summaryBaseUrl: "Base URL",
    summaryProject: "Project",
    summaryIssueType: "Issue type",
    summaryInstance: "Instance",
    summaryAuth: "Auth",
    summaryAssignmentGroup: "Assignment group",
    summaryUrl: "URL",
    summaryMethod: "Method",
    summaryContentType: "Content type",
  },
  ar: {
    pageTitle: "التكاملات الخارجية",
    pageDescription:
      "إدارة موصّلات Slack وTeams وJira وServiceNow وخطافات الويب من مكان واحد.",
    manualSetup: "الإعداد اليدوي",
    refresh: "تحديث",
    loadErrorTitle: "تعذّر تحميل بيانات إدارة التكامل",
    loadIntegrationsError: "تعذّر تحميل التكاملات",

    integrationHub: "مركز التكاملات",
    providersChip: "مزوّدون",
    activeChip: "نشط",
    setupPendingChip: "بانتظار الإعداد",
    withErrorsChip: "بها أخطاء",
    kpiTotalConnectors: "الموصّلات",
    kpiActive: "النشطة",
    kpiDeliveries: "عمليات التسليم",
    kpiErrors: "الأخطاء",
    manualMode: "يدوي",
    configuredCountLabel: (n) => `${n} مهيّأ`,
    providerNames: {
      slack: "Slack",
      teams: "Microsoft Teams",
      jira: "Jira Cloud",
      servicenow: "ServiceNow",
      pagerduty: "PagerDuty",
      email: "البريد الإلكتروني (SMTP)",
      rest: "REST / خطاف ويب",
      webhook: "خطاف ويب عام",
      genericWebhook: "خطاف ويب عام",
    },
    providerDescriptions: {
      slack: "تثبيت مساحة العمل مع أوامر الشرطة المائلة والتفاعلات وحالة الوارد.",
      teams: "إعداد يدوي لـ Bot Framework للبطاقات الصادرة وأوامر البوت الواردة.",
      jira: "تثبيت OAuth لإنشاء التذاكر الصادرة وحالة الوارد.",
      servicenow: "تكامل يدوي للحوادث مع مزامنة ثنائية الاتجاه عبر خطاف الويب.",
      pagerduty: "موصّل قائم على التهيئة يُسلّم عبر سجل الموصّلات.",
      email: "موصّل قائم على التهيئة يُسلّم عبر سجل الموصّلات.",
      rest: "موصّل قائم على التهيئة يُسلّم عبر سجل الموصّلات.",
      webhook: "تسليم خطاف ويب صادر وموقّع إلى نقاط HTTP مخصّصة.",
      genericWebhook: "تسليم خطاف ويب صادر وموقّع إلى نقاط HTTP مخصّصة.",
    },
    typeLabels: {
      slack: "Slack",
      teams: "Microsoft Teams",
      jira: "Jira",
      servicenow: "ServiceNow",
      pagerduty: "PagerDuty",
      email: "البريد الإلكتروني",
      rest: "REST / خطاف ويب",
      webhook: "خطاف ويب",
      genericWebhook: "خطاف ويب عام",
    },
    statusLabels: {
      active: "نشط",
      inactive: "غير نشط",
      error: "خطأ",
      setup_pending: "بانتظار الإعداد",
    },
    deliveryStatusLabels: {
      pending: "معلّق",
      retrying: "قيد إعادة المحاولة",
      delivered: "تم التسليم",
      failed: "فشل",
    },
    eventTypeLabels: {
      "alert.created": "تم إنشاء تنبيه",
      "alert.escalated": "تم تصعيد تنبيه",
      "alert.resolved": "تم حل تنبيه",
      "remediation.started": "بدأت المعالجة",
      "pipeline.failed": "فشل خط المعالجة",
      "quality.failed": "فشل فحص الجودة",
      "contradiction.detected": "تم اكتشاف تعارض",
      "meeting.scheduled": "تمت جدولة اجتماع",
      "action_item.overdue": "بند إجراء متأخر",
      "contract.expiring": "عقد يوشك على الانتهاء",
    },
    severityLabels: {
      critical: "حرج",
      high: "عالٍ",
      medium: "متوسط",
      low: "منخفض",
      info: "معلومة",
    },
    suiteLabels: {
      cyber: "الأمن السيبراني",
      data: "البيانات",
      acta: "Acta",
      lex: "Lex",
      visus: "Visus",
      platform: "المنصة",
    },
    syncDirectionLabels: {
      inbound: "وارد",
      outbound: "صادر",
      bidirectional: "ثنائي الاتجاه",
    },
    entityTypeLabels: {
      alert: "تنبيه",
      incident: "حادث",
      ticket: "تذكرة",
      case: "قضية",
      contract: "عقد",
      document: "وثيقة",
      request: "طلب",
    },
    externalSystemLabels: {
      jira: "Jira",
      servicenow: "ServiceNow",
      service_now: "ServiceNow",
    },
    externalStatusLabels: {
      open: "مفتوح",
      new: "جديد",
      todo: "قيد التنفيذ",
      "to do": "قيد التنفيذ",
      in_progress: "قيد التنفيذ",
      pending: "معلّق",
      resolved: "محلول",
      closed: "مغلق",
      done: "منجز",
      blocked: "محظور",
    },
    priorityLabels: {
      critical: "حرج",
      high: "عالٍ",
      medium: "متوسط",
      low: "منخفض",
      info: "معلومة",
      urgent: "عاجل",
    },

    providerReadinessTitle: "جاهزية المزوّدين",
    providerReadinessDescription:
      "تعرض المزوّدات المعتمدة على OAuth جاهزيتها التشغيلية هنا. يبقى الإعداد اليدوي متاحًا لكل أنواع التكامل.",
    ready: "جاهز",
    runtimeConfigNeeded: "بحاجة إلى تهيئة تشغيلية",
    setupMode: "وضع الإعداد",
    inbound: "وارد",
    outbound: "صادر",
    yes: "نعم",
    no: "لا",
    configuredIntegrations: "التكاملات المهيّأة",
    runtimeValuesMissingTitle: "قيم تشغيلية مفقودة",
    connectViaOAuth: "الاتصال عبر OAuth",
    advancedSetup: "الإعداد المتقدّم",
    oauthNotAvailable: "OAuth غير متاح لهذا المزوّد",
    unableToStartOAuth: "تعذّر بدء إعداد OAuth",

    configuredTitle: "التكاملات المهيّأة",
    configuredDescription:
      "افحص حالة التسليم، وأكمِل عمليات التثبيت المعلّقة، وانتقل إلى صفحات التفاصيل للاطّلاع على السجلات ومزامنة التذاكر.",
    noIntegrationsTitle: "لا توجد تكاملات مهيّأة",
    noIntegrationsDescription:
      "ابدأ من بطاقات المزوّدين أعلاه أو افتح نافذة الإعداد اليدوي لإنشاء أول تكامل.",
    deliveries: "عمليات التسليم",
    errors: "الأخطاء",
    lastUsed: "آخر استخدام",
    updated: "آخر تحديث",
    never: "أبدًا",
    configurationLabel: "التهيئة",
    deliveryIssue: "مشكلة في التسليم",
    attentionNeeded: "بحاجة إلى انتباه",
    noErrorRecorded: "لا يوجد خطأ تكامل مسجَّل حاليًا.",
    integrationDiagnosticMessage: "توجد تفاصيل تشخيصية للتكامل.",
    deliveryDiagnosticMessage: "توجد تفاصيل تشخيصية لعملية التسليم.",
    ticketSyncDiagnosticMessage: "توجد تفاصيل تشخيصية لمزامنة التذكرة.",
    technicalDetails: "تفاصيل تقنية",
    viewDetails: "عرض التفاصيل",
    edit: "تعديل",
    test: "اختبار",
    retryFailed: "إعادة محاولة الفاشلة",
    enable: "تفعيل",
    disable: "تعطيل",
    delete: "حذف",

    testCompleted: (code) => `اكتمل الاختبار باستجابة HTTP ${code}`,
    testFailed: "فشل اختبار التكامل",
    requeued: (count) => `أُعيدت جدولة ${count} من عمليات التسليم الفاشلة`,
    retryToastFailed: "فشلت إعادة المحاولة",
    integrationMarked: (status) => `تم تعيين حالة التكامل إلى ${status}`,
    statusUpdateFailed: "فشل تحديث الحالة",
    integrationDeleted: "تم حذف التكامل",
    deleteFailed: "فشل الحذف",
    configUpdated: "تم تحديث تهيئة التكامل",

    deleteIntegrationTitle: "حذف التكامل",
    deleteIntegrationDesc: (name) => `حذف "${name}" وإلغاء عمليات التسليم المعلّقة الخاصة به؟`,

    integrationUnavailableTitle: "التكامل غير متاح",
    integrationUnavailableMessage: "تعذّر تحميل التكامل المحدّد.",
    setupPendingTitle: "لا يزال الإعداد بحاجة إلى إكمال",
    setupPendingWithFields: (fields) =>
      `أكمِل الحقول المفقودة لتفعيل هذا التكامل: ${fields}.`,
    setupPendingNoFields:
      "لا يزال هذا التكامل بانتظار الإكمال. راجِع التهيئة أدناه واحفظ الحقول المطلوبة.",
    usageTitle: "الاستخدام",
    usageDescription: "حالة التسليم والصحة التشغيلية لهذا التكامل.",
    consecutiveErrors: "الأخطاء المتتالية",
    recently: "مؤخرًا",
    created: "أُنشئ في",
    configurationSummaryTitle: "ملخّص التهيئة",
    configurationSummaryDescription:
      "القيم غير السرّية المخزّنة حاليًا لهذا التكامل بعد تنقيتها.",
    noConfigValues: "لا تتوفّر قيم تهيئة غير سرّية.",
    integrationErrorTitle: "خطأ في التكامل",
    attentionRequired: "يتطلّب انتباهًا",
    overviewTab: "نظرة عامة",
    deliveryLogTab: "سجل التسليم",
    ticketLinksTab: "روابط التذاكر",
    integrationNotesTitle: "ملاحظات التكامل",
    noDescription: "لا يوجد وصف مسجَّل.",
    typeLabel: "النوع",
    statusLabel: "الحالة",
    createdByLabel: "أنشأه",
    filtersTitle: "عوامل التصفية",
    filtersDescription: "صفِّ سجل التسليم حسب الحالة أو نوع الحدث.",
    statusFilterLabel: "الحالة",
    eventTypeFilterLabel: "نوع الحدث",
    all: "الكل",
    pending: "معلّق",
    retrying: "قيد إعادة المحاولة",
    delivered: "تم التسليم",
    failed: "فشل",
    deliveryRecordsTitle: "سجلات التسليم",
    deliveryRecordsDescription: (total) => `${total} سجل مطابق ضمن هذا التكامل.`,
    loadDeliveriesError: "تعذّر تحميل سجلات التسليم",
    externalTicketLinksTitle: "روابط التذاكر الخارجية",
    externalTicketLinksDescription:
      "حالة المزامنة ثنائية الاتجاه لتذاكر Jira أو ServiceNow المرتبطة عبر هذا التكامل.",
    loadTicketLinksError: "تعذّر تحميل روابط التذاكر",
    ticketLinkSynced: "تمت مزامنة رابط التذكرة",
    ticketLinkSyncFailed: "فشلت مزامنة رابط التذكرة",
    page: "صفحة",
    of: "من",
    previous: "السابق",
    next: "التالي",

    configureIntegration: "تهيئة التكامل",
    editName: (name) => `تعديل ${name}`,
    editDescription: "تحديث إعدادات الاتصال وعوامل تصفية التسليم وسلوك المزامنة.",
    createDescription: "إنشاء تكامل صادر أو ثنائي الاتجاه جديد لمستأجرك.",
    provider: "المزوّد",
    oauthAvailableTitle: "الإعداد المدعوم بـ OAuth متاح",
    oauthConfiguredHint: (provider, field) =>
      `استخدم OAuth الخاص بـ ${provider} لتعبئة بيانات اعتماد المستأجر تلقائيًا، ثم أكمِل حقول ${field} المتبقية في Clario360.`,
    oauthNotConfiguredHint: (provider) =>
      `لم تتم تهيئة OAuth الخاص بـ ${provider} في بيئة التشغيل المحلية هذه. لا يزال بإمكانك استخدام الإعداد المتقدّم/اليدوي أدناه.`,
    channelWord: "القناة",
    projectWord: "المشروع",
    missingRuntimeConfig: (values) => `تهيئة تشغيلية مفقودة: ${values}`,
    name: "الاسم",
    namePlaceholder: (type) => `تكامل ${type} للإنتاج`,
    type: "النوع",
    selectTypePlaceholder: "اختر نوع التكامل",
    description: "الوصف",
    descriptionPlaceholder: "أين يُستخدَم هذا التكامل، وما الذي يُنبّه عنه، ومن المسؤول عنه.",
    cancel: "إلغاء",
    saving: "جارٍ الحفظ...",
    saveChanges: "حفظ التغييرات",
    createIntegration: "إنشاء تكامل",
    integrationUpdated: (type) => `تم تحديث تكامل ${type}`,
    integrationCreated: (type) => `تم إنشاء تكامل ${type}`,
    unableToSaveIntegration: "تعذّر حفظ التكامل",
    invalidJson: (field) => `صيغة JSON غير صحيحة في "${field}". راجِع البنية ثم حاول مرة أخرى.`,
    oauthUnavailableProvider: "OAuth غير متاح لهذا المزوّد",

    slackConnectionTitle: "اتصال Slack",
    slackConnectionDesc:
      "يمكن لـ OAuth تعبئة بيانات اعتماد مساحة العمل تلقائيًا. تبقى الحقول اليدوية متاحة للإعداد المتقدّم.",
    teamsConnectionTitle: "اتصال Teams",
    teamsConnectionDesc:
      "هيّئ بيانات اعتماد تطبيق Bot Framework وتفاصيل المحادثة المستهدفة.",
    jiraConnectionTitle: "اتصال Jira",
    jiraConnectionDesc:
      "يمكن إكمال حقول المشروع والرمز المميّز بعد OAuth أو إدخالها يدويًا للإعداد المتقدّم.",
    servicenowConnectionTitle: "اتصال ServiceNow",
    servicenowConnectionDesc:
      "اختر وضع المصادقة وقدّم بيانات الاعتماد المقابلة، وإعدادات الإسناد الافتراضية، وسرّ خطاف الويب الوارد.",
    webhookConnectionTitle: "اتصال خطاف الويب",
    webhookConnectionDesc:
      "هيّئ المستقبِل الصادر، وطريقة الطلب، والسرّ الموقَّع، وأي ترويسات ثابتة.",

    secretHintEditing: "اتركه فارغًا للإبقاء على السرّ المخزَّن.",
    secretHintNew: "مطلوب لعمل التكامل.",

    botToken: "رمز البوت المميّز",
    signingSecret: "سرّ التوقيع",
    signingSecretPlaceholder: "عيّنه عبر OAuth أو أدخله يدويًا",
    workspaceId: "معرّف مساحة العمل",
    workspaceName: "اسم مساحة العمل",
    channelId: "معرّف القناة",
    incomingWebhookUrl: "رابط خطاف الويب الوارد",
    threadPerAlert: "تحديثات في سلسلة لكل تنبيه",
    includeExplanation: "تضمين محتوى التفسير",
    botAppId: "معرّف تطبيق البوت",
    botPassword: "كلمة مرور البوت",
    serviceUrl: "رابط الخدمة",
    conversationId: "معرّف المحادثة",
    tenantId: "معرّف المستأجر",
    baseUrl: "الرابط الأساسي",
    cloudId: "معرّف السحابة",
    projectKey: "مفتاح المشروع",
    issueTypeId: "معرّف نوع المهمة",
    authToken: "رمز المصادقة المميّز",
    refreshToken: "رمز التحديث المميّز",
    webhookSecret: "سرّ خطاف الويب",
    webhookSecretJiraHint: "يُستخدَم للتحقق من خطافات Jira الواردة.",
    webhookSecretServiceNowHint:
      "سرّ مشترك لاستدعاءات قواعد عمل ServiceNow الصادرة.",
    priorityMappingJson: "تعيين الأولوية بصيغة JSON",
    statusMappingJson: "تعيين الحالة بصيغة JSON",
    customFieldsJson: "الحقول المخصّصة بصيغة JSON",
    instanceUrl: "رابط المثيل",
    authType: "نوع المصادقة",
    basic: "أساسية",
    oauth: "OAuth",
    username: "اسم المستخدم",
    password: "كلمة المرور",
    oauthTokenLabel: "رمز OAuth المميّز",
    assignmentGroup: "مجموعة الإسناد",
    callerId: "معرّف المتصل",
    category: "الفئة",
    subcategory: "الفئة الفرعية",
    url: "الرابط",
    method: "الطريقة",
    contentType: "نوع المحتوى",
    sharedSecret: "السرّ المشترك",
    headersJson: "الترويسات بصيغة JSON",
    toggleFieldHint: "يُخزَّن كجزء من تهيئة التكامل.",
    workspaceNamePlaceholder: "عمليات الأمن",
    categoryPlaceholder: "الأمن",
    subcategoryPlaceholder: "كشف التهديدات",

    eventFiltersTitle: "عوامل تصفية الأحداث",
    eventFiltersDescription:
      "اترك كل شيء فارغًا لتسليم جميع الأحداث. تُقيَّم قواعد التصفية المتعددة بمنطق OR — يُسلَّم أي حدث يطابق أي قاعدة.",
    filterRule: "قاعدة تصفية",
    filterRuleNumbered: (n) => `قاعدة التصفية ${n}`,
    remove: "إزالة",
    eventTypes: "أنواع الأحداث",
    severities: "مستويات الخطورة",
    suites: "الحزم",
    minimumConfidence: "الحد الأدنى للثقة",
    addFilterRule: "إضافة قاعدة تصفية",

    noDeliveryRecords: "لا توجد سجلات تسليم مطابقة لعوامل التصفية الحالية.",
    event: "الحدث",
    attempts: "المحاولات",
    response: "الاستجابة",
    latency: "زمن الاستجابة",
    nextRetry: "إعادة المحاولة التالية",
    createdHeader: "أُنشئ في",
    statusHeader: "الحالة",

    noTicketLinks: "لا توجد روابط تذاكر خارجية مسجَّلة لهذا التكامل.",
    externalTicket: "التذكرة الخارجية",
    entity: "الكيان",
    direction: "الاتجاه",
    lastSynced: "آخر مزامنة",
    actions: "إجراءات",
    unknown: "غير معروف",
    details: "التفاصيل",
    open: "فتح",
    sync: "مزامنة",

    ticketLinkUnavailable: "تعذّر تحميل رابط التذكرة",
    linkedTicketDescription: (system, entityType, entityId) =>
      `تذكرة ${system} مرتبطة بـ ${entityType} ${entityId}`,
    forceSync: "فرض المزامنة",
    openTicket: "فتح التذكرة",
    ticketLinkSyncError: "تعذّرت مزامنة رابط التذكرة",
    externalRecordTitle: "السجل الخارجي",
    externalRecordDescription: "بيانات النظام الخارجي الحالية وحالة المزامنة.",
    system: "النظام",
    key: "المفتاح",
    externalIdLabel: "المعرّف الخارجي",
    priorityLabel: "الأولوية",
    clarioLinkageTitle: "ربط Clario",
    clarioLinkageDescription: "كيفية ربط هذه التذكرة الخارجية مرة أخرى داخل Clario360.",
    integrationLabel: "التكامل",
    entityTypeLabel: "نوع الكيان",
    entityIdLabel: "معرّف الكيان",
    syncDirectionLabel: "اتجاه المزامنة",
    lastSyncDirectionLabel: "اتجاه آخر مزامنة",
    timestampsTitle: "الطوابع الزمنية",
    lastSyncErrorTitle: "آخر خطأ مزامنة",
    backToIntegration: "العودة إلى التكامل",

    summaryWorkspace: "مساحة العمل",
    summaryChannel: "القناة",
    summaryIncomingWebhook: "خطاف الويب الوارد",
    summaryBotApp: "تطبيق البوت",
    summaryConversation: "المحادثة",
    summaryServiceUrl: "رابط الخدمة",
    summaryBaseUrl: "الرابط الأساسي",
    summaryProject: "المشروع",
    summaryIssueType: "نوع المهمة",
    summaryInstance: "المثيل",
    summaryAuth: "المصادقة",
    summaryAssignmentGroup: "مجموعة الإسناد",
    summaryUrl: "الرابط",
    summaryMethod: "الطريقة",
    summaryContentType: "نوع المحتوى",
  },
};

/** useIntegrationsT resolves the active-locale label object. */
export function useIntegrationsT(): IntegrationsLabels {
  const { locale } = useLocale();
  return locale === "ar" ? INTEGRATIONS_I18N.ar : INTEGRATIONS_I18N.en;
}
