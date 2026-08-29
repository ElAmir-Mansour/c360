/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber *Asset Inventory* area (`/cyber/assets/**`).
 *
 * Mirrors the shared `cyber-i18n.ts` `{ en, ar }` bundle pattern: every label
 * group is a `CyberBilingual<T> = { en: T; ar: T }` carrying two full,
 * same-shaped copies of the label object — English in `en`, professional
 * Saudi-register MSA in `ar`. Components never receive the bundle; they read
 * the resolved `T` from the `useAssetLabels()` hook (which resolves against the
 * active locale, falling back to English when no LocaleProvider is mounted).
 * The `en` side MUST equal the pre-existing English strings exactly.
 *
 * Acronyms / product names stay as-is across both locales: CVE, CVSS, CIS, IoT,
 * CIDR, IP, OS, MAC, JSON.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveCyberBilingual,
  type CyberBilingual,
} from '../../_lib/cyber-i18n';

export interface AssetLabels {
  // ---- list page (page.tsx) ----
  list: {
    eyebrow: string;
    title: string;
    description: string;
    tagAttackSurface: string;
    tagContinuousDiscovery: string;
    tableView: string;
    gridView: string;
    scan: string;
    schedule: string;
    import: string;
    addAsset: string;
    createAsset: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyDescriptionGrid: string;
  };
  // ---- bulk actions + toasts (page.tsx) ----
  bulk: {
    bulkTag: string;
    setActive: string;
    decommission: string;
    deleteSelected: string;
    selectAtLeastOne: string;
    setActiveDone: (count: number) => string;
    decommissionedDone: (count: number) => string;
    deletedDone: (count: number) => string;
    deleteConfirm: string;
  };
  // ---- KPI cards ----
  kpi: {
    totalAssets: string;
    criticalAssets: string;
    withOpenVulns: string;
    discoveredThisWeek: string;
  };
  // ---- trend charts ----
  trend: {
    byType: string;
    byCriticality: string;
  };
  // ---- table columns + row actions ----
  columns: {
    name: string;
    type: string;
    ipAddress: string;
    criticality: string;
    status: string;
    vulns: string;
    tags: string;
    lastSeen: string;
    actions: string;
    moreTags: (count: number) => string;
  };
  rowActions: {
    edit: string;
    manageTags: string;
    addRelationship: string;
    delete: string;
  };
  // ---- type labels (enum keys) ----
  typeLabels: Record<string, string>;
  // ---- status enum keys ----
  statusLabels: Record<string, string>;
  // ---- list filters (asset-filters.tsx) ----
  filters: {
    type: string;
    criticality: string;
    status: string;
    discoverySource: string;
    hasVulnerabilities: string;
    owner: string;
    department: string;
    tag: string;
    discoveredAfter: string;
    ownerPlaceholder: string;
    departmentPlaceholder: string;
    tagPlaceholder: string;
    yes: string;
    no: string;
    typeOptions: {
      server: string;
      endpoint: string;
      cloudResource: string;
      networkDevice: string;
      iotDevice: string;
      application: string;
      database: string;
      container: string;
    };
    critOptions: {
      critical: string;
      high: string;
      medium: string;
      low: string;
    };
    statusOptions: {
      active: string;
      inactive: string;
      decommissioned: string;
      unknown: string;
    };
    sourceOptions: {
      manual: string;
      networkScan: string;
      cloudScan: string;
      agent: string;
      import: string;
    };
  };
  // ---- grid view ----
  grid: {
    emptyTitle: string;
    criticality: string;
    status: string;
    ip: string;
    vulnerabilities: string;
    critShort: (count: number) => string;
  };
  // ---- create/edit dialogs (shared field labels) ----
  form: {
    name: string;
    type: string;
    criticality: string;
    status: string;
    ipAddress: string;
    hostname: string;
    operatingSystem: string;
    owner: string;
    department: string;
    location: string;
    cancel: string;
    createTitle: string;
    editTitle: string;
    creating: string;
    saving: string;
    createSubmit: string;
    saveSubmit: string;
    createdToast: string;
    updatedToast: string;
    ownerPlaceholder: string;
    departmentPlaceholder: string;
    nameMin: string;
  };
  // ---- delete dialog ----
  deleteDialog: {
    title: string;
    irreversiblePrefix: string;
    irreversibleWord: string;
    irreversibleSuffix: (name: string) => string;
    assetLabel: string;
    typeLabel: string;
    criticalityLabel: string;
    warningLabel: string;
    warningBody: (count: number) => string;
    confirmPromptPrefix: string;
    confirmPromptWord: string;
    confirmPromptSuffix: string;
    confirmPlaceholder: string;
    cancel: string;
    deleting: string;
    deleteSubmit: string;
    deletedToast: string;
  };
  // ---- tag management dialog ----
  tagDialog: {
    title: string;
    description: (name: string) => string;
    inputPlaceholder: string;
    noTags: string;
    removeTag: (tag: string) => string;
    cancel: string;
    saving: string;
    saveTags: string;
    updatedToast: string;
  };
  // ---- bulk tag dialog ----
  bulkTagDialog: {
    title: string;
    description: (count: number) => string;
    tagsToAdd: string;
    inputPlaceholder: string;
    add: string;
    cancel: string;
    applying: string;
    applySubmit: (count: number) => string;
    addAtLeastOne: string;
    appliedToast: (count: number) => string;
    failedToast: string;
  };
  // ---- scan dialog ----
  scanDialog: {
    title: string;
    description: string;
    scanType: string;
    optNetwork: string;
    optCloud: string;
    optAgent: string;
    targets: string;
    targetsHint: string;
    ports: string;
    portsHint: string;
    additionalChecks: string;
    vulnMatching: string;
    configAudit: string;
    cancel: string;
    starting: string;
    startScan: string;
    startedToast: string;
    scanTypeRequired: string;
    targetRequired: string;
  };
  // ---- scan schedule dialog ----
  scheduleDialog: {
    title: string;
    description: string;
    label: string;
    labelPlaceholder: string;
    scanType: string;
    networkDiscovery: string;
    cloudResourceSync: string;
    agentBasedInventory: string;
    targets: string;
    targetsPlaceholder: string;
    targetsHint: string;
    schedule: string;
    cronPrefix: string;
    intervals: {
      hourly: string;
      every6h: string;
      dailyMidnight: string;
      daily6am: string;
      weekly: string;
      monthly: string;
    };
    cancel: string;
    creating: string;
    createSchedule: string;
    createdToast: string;
    failedToast: string;
    targetRequired: string;
    scheduleRequired: string;
    labelRequired: string;
  };
  // ---- bulk import dialog ----
  importDialog: {
    title: string;
    descriptionPrefix: string;
    jsonInput: string;
    invalidArray: string;
    invalidJson: (msg: string) => string;
    validatePreview: string;
    previewTitle: (count: number) => string;
    edit: string;
    colName: string;
    colType: string;
    colCriticality: string;
    colIp: string;
    colOwner: string;
    cancel: string;
    importing: string;
    importSubmit: (count: number) => string;
    completeToast: string;
  };
  // ---- add relationship dialog ----
  relationshipDialog: {
    title: string;
    description: (name: string) => string;
    relationshipType: string;
    targetAsset: string;
    searchPlaceholder: string;
    search: string;
    searching: string;
    noAddress: string;
    cancel: string;
    creating: string;
    createSubmit: string;
    selectTarget: string;
    createdToast: (source: string, target: string) => string;
    searchFailedToast: string;
    createFailedToast: string;
    types: {
      hosts: string;
      runsOn: string;
      connectsTo: string;
      dependsOn: string;
      managedBy: string;
      backsUp: string;
      loadBalances: string;
    };
  };
  // ---- detail page ----
  detail: {
    loadError: string;
    goBack: string;
    scan: string;
    tags: string;
    edit: string;
    delete: string;
    statVulnerabilities: string;
    statCriticalVulns: string;
    statHighVulns: string;
    statOpenAlerts: string;
    tabOverview: string;
    tabVulnerabilities: string;
    tabAlerts: string;
    tabRelationships: string;
    tabConfiguration: string;
    tabActivity: string;
  };
  // ---- overview tab ----
  overview: {
    identity: string;
    network: string;
    system: string;
    ownership: string;
    securityPosture: string;
    tags: string;
    timeline: string;
    fType: string;
    fCriticality: string;
    fStatus: string;
    fDiscoverySource: string;
    fIpAddress: string;
    fHostname: string;
    fMacAddress: string;
    fOperatingSystem: string;
    fOsVersion: string;
    fLocation: string;
    fOwner: string;
    fDepartment: string;
    fTotalVulns: string;
    fCriticalVulns: string;
    fHighVulns: string;
    fOpenAlerts: string;
    fDiscovered: string;
    fLastSeen: string;
    fLastUpdated: string;
    fCreated: string;
  };
  // ---- vulnerabilities tab ----
  vulnsTab: {
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    foundCount: (count: number) => string;
    colSeverity: string;
    colCveTitle: string;
    colCvss: string;
    colStatus: string;
    colAge: string;
    exploitAvailable: string;
  };
  // ---- alerts tab ----
  alertsTab: {
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    countLabel: (count: number) => string;
    confidence: (score: number) => string;
  };
  // ---- relationships tab ----
  relTab: {
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
    countHint: (count: number) => string;
  };
  // ---- activity tab ----
  activityTab: {
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  // ---- config tab ----
  configTab: {
    emptyTitle: string;
    emptyDescription: string;
    intro: string;
    colKey: string;
    colValue: string;
  };
  // ---- scans list page ----
  scansList: {
    eyebrow: string;
    title: string;
    description: string;
    backToAssets: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    colType: string;
    colStatus: string;
    colTarget: string;
    colFound: string;
    colUpdated: string;
    colStarted: string;
    colCompleted: string;
    colError: string;
  };
  // ---- scan status enum (running/completed/failed/cancelled) ----
  scanStatus: Record<string, string>;
  // ---- scan detail page ----
  scanDetail: {
    eyebrow: string;
    loadError: string;
    scanSuffix: string;
    startedPrefix: string;
    statAssetsFound: string;
    statAssetsUpdated: string;
    statDuration: string;
    statTarget: string;
    detailsTitle: string;
    dScanType: string;
    dStatus: string;
    dTargetCidr: string;
    dStartedAt: string;
    dCompletedAt: string;
    dDuration: string;
    dError: string;
    discoveredAssets: string;
    discoveredEmptyTitle: string;
    discoveredEmptyDescription: string;
    colName: string;
    colType: string;
    colIp: string;
    colStatus: string;
    colCriticality: string;
  };
  // ---- scan in-progress / error panels ----
  scanPanels: {
    inProgress: string;
    elapsedSec: (s: number) => string;
    elapsedMin: (m: number, s: number) => string;
    discoveredSoFar: (count: number) => string;
    scanningForAssets: string;
    scanError: string;
  };
}

export const assetLabels: CyberBilingual<AssetLabels> = {
  en: {
    list: {
      eyebrow: 'Cyber Defense',
      title: 'Asset Inventory',
      description: 'Manage and monitor all cyber assets across your environment',
      tagAttackSurface: 'Attack surface',
      tagContinuousDiscovery: 'Continuous discovery',
      tableView: 'Table view',
      gridView: 'Grid view',
      scan: 'Scan',
      schedule: 'Schedule',
      import: 'Import',
      addAsset: 'Add Asset',
      createAsset: 'Create Asset',
      searchPlaceholder: 'Search by name, hostname, IP, owner, department…',
      emptyTitle: 'No assets found',
      emptyDescription: 'Get started by creating an asset or running an automated discovery scan.',
      emptyDescriptionGrid: 'Get started by creating an asset or running a scan.',
    },
    bulk: {
      bulkTag: 'Bulk Tag',
      setActive: 'Set Active',
      decommission: 'Decommission',
      deleteSelected: 'Delete Selected',
      selectAtLeastOne: 'Select at least one asset',
      setActiveDone: (count) => `${count} asset(s) set to active`,
      decommissionedDone: (count) => `${count} asset(s) decommissioned`,
      deletedDone: (count) => `${count} asset(s) deleted`,
      deleteConfirm: 'Are you sure you want to delete the selected assets? This action cannot be undone.',
    },
    kpi: {
      totalAssets: 'Total Assets',
      criticalAssets: 'Critical Assets',
      withOpenVulns: 'With Open Vulns',
      discoveredThisWeek: 'Discovered This Week',
    },
    trend: {
      byType: 'Assets by Type',
      byCriticality: 'Assets by Criticality',
    },
    columns: {
      name: 'Name',
      type: 'Type',
      ipAddress: 'IP Address',
      criticality: 'Criticality',
      status: 'Status',
      vulns: 'Vulns',
      tags: 'Tags',
      lastSeen: 'Last Seen',
      actions: 'Actions',
      moreTags: (count) => `+${count} more`,
    },
    rowActions: {
      edit: 'Edit',
      manageTags: 'Manage Tags',
      addRelationship: 'Add Relationship',
      delete: 'Delete',
    },
    typeLabels: {
      server: 'Server',
      endpoint: 'Endpoint',
      cloud_resource: 'Cloud',
      network_device: 'Network',
      iot_device: 'IoT',
      application: 'App',
      database: 'Database',
      container: 'Container',
    },
    statusLabels: {
      active: 'Active',
      inactive: 'Inactive',
      decommissioned: 'Decommissioned',
      unknown: 'Unknown',
    },
    filters: {
      type: 'Type',
      criticality: 'Criticality',
      status: 'Status',
      discoverySource: 'Discovery Source',
      hasVulnerabilities: 'Has Vulnerabilities',
      owner: 'Owner',
      department: 'Department',
      tag: 'Tag',
      discoveredAfter: 'Discovered After',
      ownerPlaceholder: 'Filter by owner...',
      departmentPlaceholder: 'Filter by department...',
      tagPlaceholder: 'Filter by tag...',
      yes: 'Yes',
      no: 'No',
      typeOptions: {
        server: 'Server',
        endpoint: 'Endpoint',
        cloudResource: 'Cloud Resource',
        networkDevice: 'Network Device',
        iotDevice: 'IoT Device',
        application: 'Application',
        database: 'Database',
        container: 'Container',
      },
      critOptions: {
        critical: 'Critical',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
      },
      statusOptions: {
        active: 'Active',
        inactive: 'Inactive',
        decommissioned: 'Decommissioned',
        unknown: 'Unknown',
      },
      sourceOptions: {
        manual: 'Manual',
        networkScan: 'Network Scan',
        cloudScan: 'Cloud Scan',
        agent: 'Agent',
        import: 'Import',
      },
    },
    grid: {
      emptyTitle: 'No assets found',
      criticality: 'Criticality',
      status: 'Status',
      ip: 'IP',
      vulnerabilities: 'Vulnerabilities',
      critShort: (count) => `(${count} crit)`,
    },
    form: {
      name: 'Name',
      type: 'Type',
      criticality: 'Criticality',
      status: 'Status',
      ipAddress: 'IP Address',
      hostname: 'Hostname',
      operatingSystem: 'Operating System',
      owner: 'Owner',
      department: 'Department',
      location: 'Location',
      cancel: 'Cancel',
      createTitle: 'Create Asset',
      editTitle: 'Edit Asset',
      creating: 'Creating…',
      saving: 'Saving…',
      createSubmit: 'Create Asset',
      saveSubmit: 'Save Changes',
      createdToast: 'Asset created successfully',
      updatedToast: 'Asset updated successfully',
      ownerPlaceholder: 'Security Team',
      departmentPlaceholder: 'Engineering',
      nameMin: 'Name must be at least 2 characters',
    },
    deleteDialog: {
      title: 'Delete Asset',
      irreversiblePrefix: 'This action is ',
      irreversibleWord: 'irreversible',
      irreversibleSuffix: (name) => `. All associated vulnerabilities, alerts references, and scan history for ${name} will be unlinked.`,
      assetLabel: 'Asset:',
      typeLabel: 'Type:',
      criticalityLabel: 'Criticality:',
      warningLabel: 'Warning:',
      warningBody: (count) => `This asset has ${count} open vulnerabilities.`,
      confirmPromptPrefix: 'Type ',
      confirmPromptWord: 'DELETE',
      confirmPromptSuffix: ' to confirm',
      confirmPlaceholder: 'DELETE',
      cancel: 'Cancel',
      deleting: 'Deleting…',
      deleteSubmit: 'Delete Asset',
      deletedToast: 'Asset deleted',
    },
    tagDialog: {
      title: 'Manage Tags',
      description: (name) => `Add or remove tags for ${name}.`,
      inputPlaceholder: 'Add tag (press Enter)',
      noTags: 'No tags. Add one above.',
      removeTag: (tag) => `Remove ${tag}`,
      cancel: 'Cancel',
      saving: 'Saving…',
      saveTags: 'Save Tags',
      updatedToast: 'Tags updated',
    },
    bulkTagDialog: {
      title: 'Bulk Tag Management',
      description: (count) => `Add tags to ${count} selected asset(s). Tags will be merged with existing tags.`,
      tagsToAdd: 'Tags to add',
      inputPlaceholder: 'Type a tag and press Enter...',
      add: 'Add',
      cancel: 'Cancel',
      applying: 'Applying...',
      applySubmit: (count) => `Apply to ${count} Asset(s)`,
      addAtLeastOne: 'Add at least one tag',
      appliedToast: (count) => `Tags applied to ${count} asset(s)`,
      failedToast: 'Failed to apply tags',
    },
    scanDialog: {
      title: 'Start Asset Scan',
      description: 'Scan targets for vulnerabilities, misconfigurations, and network topology.',
      scanType: 'Scan Type',
      optNetwork: 'Network — topology & port discovery',
      optCloud: 'Cloud — cloud asset enumeration',
      optAgent: 'Agent — agent-based host scan',
      targets: 'Targets',
      targetsHint: 'Comma-separated IPs, CIDR ranges, or hostnames.',
      ports: 'Ports',
      portsHint: 'Leave blank to scan the top 1,000 ports.',
      additionalChecks: 'Additional checks',
      vulnMatching: 'Vulnerability matching (CVE lookup)',
      configAudit: 'Configuration audit (CIS benchmarks)',
      cancel: 'Cancel',
      starting: 'Starting…',
      startScan: 'Start Scan',
      startedToast: 'Scan started successfully',
      scanTypeRequired: 'Scan type is required',
      targetRequired: 'At least one target is required',
    },
    scheduleDialog: {
      title: 'Schedule Recurring Scan',
      description: 'Configure automated discovery scans that run on a recurring schedule.',
      label: 'Label',
      labelPlaceholder: 'e.g., Production network weekly scan',
      scanType: 'Scan Type',
      networkDiscovery: 'Network Discovery',
      cloudResourceSync: 'Cloud Resource Sync',
      agentBasedInventory: 'Agent-Based Inventory',
      targets: 'Targets',
      targetsPlaceholder: 'IPs, CIDR ranges, or hostnames (comma-separated)',
      targetsHint: 'Examples: 10.0.0.0/24, 192.168.1.1-100, server-prod-*.example.com',
      schedule: 'Schedule',
      cronPrefix: 'Cron expression:',
      intervals: {
        hourly: 'Every hour',
        every6h: 'Every 6 hours',
        dailyMidnight: 'Daily at midnight',
        daily6am: 'Daily at 6 AM',
        weekly: 'Weekly (Sunday midnight)',
        monthly: 'Monthly (1st at midnight)',
      },
      cancel: 'Cancel',
      creating: 'Creating...',
      createSchedule: 'Create Schedule',
      createdToast: 'Scheduled scan created',
      failedToast: 'Failed to create scheduled scan',
      targetRequired: 'At least one target is required',
      scheduleRequired: 'Schedule is required',
      labelRequired: 'A descriptive label is required',
    },
    importDialog: {
      title: 'Bulk Import Assets',
      descriptionPrefix: 'Paste a JSON array of assets to import. Required fields: ',
      jsonInput: 'JSON Input',
      invalidArray: 'Input must be a JSON array of assets',
      invalidJson: (msg) => `Invalid JSON: ${msg}`,
      validatePreview: 'Validate & Preview',
      previewTitle: (count) => `Preview (${count} assets)`,
      edit: 'Edit',
      colName: 'Name',
      colType: 'Type',
      colCriticality: 'Criticality',
      colIp: 'IP Address',
      colOwner: 'Owner',
      cancel: 'Cancel',
      importing: 'Importing…',
      importSubmit: (count) => `Import ${count} Assets`,
      completeToast: 'Bulk import complete',
    },
    relationshipDialog: {
      title: 'Add Relationship',
      description: (name) => `Create a dependency or connection from ${name} to another asset.`,
      relationshipType: 'Relationship Type',
      targetAsset: 'Target Asset',
      searchPlaceholder: 'Search by name, hostname, or IP...',
      search: 'Search',
      searching: 'Searching...',
      noAddress: 'no address',
      cancel: 'Cancel',
      creating: 'Creating...',
      createSubmit: 'Create Relationship',
      selectTarget: 'Select a target asset',
      createdToast: (source, target) => `Relationship created: ${source} → ${target}`,
      searchFailedToast: 'Failed to search assets',
      createFailedToast: 'Failed to create relationship',
      types: {
        hosts: 'Hosts',
        runsOn: 'Runs On',
        connectsTo: 'Connects To',
        dependsOn: 'Depends On',
        managedBy: 'Managed By',
        backsUp: 'Backs Up',
        loadBalances: 'Load Balances',
      },
    },
    detail: {
      loadError: 'Failed to load asset',
      goBack: 'Go back',
      scan: 'Scan',
      tags: 'Tags',
      edit: 'Edit',
      delete: 'Delete',
      statVulnerabilities: 'Vulnerabilities',
      statCriticalVulns: 'Critical Vulns',
      statHighVulns: 'High Vulns',
      statOpenAlerts: 'Open Alerts',
      tabOverview: 'Overview',
      tabVulnerabilities: 'Vulnerabilities',
      tabAlerts: 'Alerts',
      tabRelationships: 'Relationships',
      tabConfiguration: 'Configuration',
      tabActivity: 'Activity',
    },
    overview: {
      identity: 'Identity',
      network: 'Network',
      system: 'System',
      ownership: 'Ownership',
      securityPosture: 'Security Posture',
      tags: 'Tags',
      timeline: 'Timeline',
      fType: 'Type',
      fCriticality: 'Criticality',
      fStatus: 'Status',
      fDiscoverySource: 'Discovery Source',
      fIpAddress: 'IP Address',
      fHostname: 'Hostname',
      fMacAddress: 'MAC Address',
      fOperatingSystem: 'Operating System',
      fOsVersion: 'OS Version',
      fLocation: 'Location',
      fOwner: 'Owner',
      fDepartment: 'Department',
      fTotalVulns: 'Total Vulnerabilities',
      fCriticalVulns: 'Critical Vulns',
      fHighVulns: 'High Vulns',
      fOpenAlerts: 'Open Alerts',
      fDiscovered: 'Discovered',
      fLastSeen: 'Last Seen',
      fLastUpdated: 'Last Updated',
      fCreated: 'Created',
    },
    vulnsTab: {
      loadError: 'Failed to load vulnerabilities',
      emptyTitle: 'No vulnerabilities',
      emptyDescription: 'This asset has no known vulnerabilities.',
      foundCount: (count) => `${count} vulnerabilities found`,
      colSeverity: 'Severity',
      colCveTitle: 'CVE / Title',
      colCvss: 'CVSS',
      colStatus: 'Status',
      colAge: 'Age',
      exploitAvailable: 'Exploit Available',
    },
    alertsTab: {
      loadError: 'Failed to load alerts',
      emptyTitle: 'No alerts',
      emptyDescription: 'No alerts are associated with this asset.',
      countLabel: (count) => `${count} alerts`,
      confidence: (score) => `Confidence: ${score}%`,
    },
    relTab: {
      loadError: 'Failed to load relationships',
      emptyTitle: 'No relationships',
      emptyDescription: 'No asset relationships have been discovered. Run a network scan to detect connections between assets.',
      countHint: (count) => `${count} relationship${count !== 1 ? 's' : ''} found. Drag nodes to explore. Scroll to zoom.`,
    },
    activityTab: {
      loadError: 'Failed to load activity',
      emptyTitle: 'No activity',
      emptyDescription: 'No activity has been recorded for this asset yet.',
    },
    configTab: {
      emptyTitle: 'No configuration data',
      emptyDescription: 'Configuration metadata will appear here once a configuration scan has been run on this asset.',
      intro: 'Configuration metadata collected during discovery or last scan.',
      colKey: 'Key',
      colValue: 'Value',
    },
    scansList: {
      eyebrow: 'Cyber Defense',
      title: 'Asset Scans',
      description: 'Network and cloud asset discovery scan history',
      backToAssets: 'Back to Assets',
      searchPlaceholder: 'Search scans…',
      emptyTitle: 'No scans found',
      emptyDescription: 'Run an asset discovery scan to populate this list.',
      colType: 'Type',
      colStatus: 'Status',
      colTarget: 'Target',
      colFound: 'Found',
      colUpdated: 'Updated',
      colStarted: 'Started',
      colCompleted: 'Completed',
      colError: 'Error',
    },
    scanStatus: {
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    scanDetail: {
      eyebrow: 'Cyber Defense',
      loadError: 'Failed to load scan details',
      scanSuffix: 'Scan',
      startedPrefix: 'Started',
      statAssetsFound: 'Assets Found',
      statAssetsUpdated: 'Assets Updated',
      statDuration: 'Duration',
      statTarget: 'Target',
      detailsTitle: 'Scan Details',
      dScanType: 'Scan Type',
      dStatus: 'Status',
      dTargetCidr: 'Target (CIDR)',
      dStartedAt: 'Started At',
      dCompletedAt: 'Completed At',
      dDuration: 'Duration',
      dError: 'Error',
      discoveredAssets: 'Discovered Assets',
      discoveredEmptyTitle: 'No assets discovered',
      discoveredEmptyDescription: 'This scan did not discover any assets, or they have not been loaded yet.',
      colName: 'Name',
      colType: 'Type',
      colIp: 'IP Address',
      colStatus: 'Status',
      colCriticality: 'Criticality',
    },
    scanPanels: {
      inProgress: 'Scan in Progress',
      elapsedSec: (s) => `${s}s elapsed`,
      elapsedMin: (m, s) => `${m}m ${s}s elapsed`,
      discoveredSoFar: (count) => `${count.toLocaleString()} asset${count === 1 ? '' : 's'} discovered so far…`,
      scanningForAssets: 'Scanning network for assets…',
      scanError: 'Scan Error',
    },
  },
  ar: {
    list: {
      eyebrow: 'الدفاع السيبراني',
      title: 'سجل الأصول',
      description: 'إدارة ومراقبة جميع الأصول السيبرانية عبر بيئتك',
      tagAttackSurface: 'سطح الهجوم',
      tagContinuousDiscovery: 'اكتشاف مستمر',
      tableView: 'عرض جدولي',
      gridView: 'عرض شبكي',
      scan: 'فحص',
      schedule: 'جدولة',
      import: 'استيراد',
      addAsset: 'إضافة أصل',
      createAsset: 'إنشاء أصل',
      searchPlaceholder: 'البحث بالاسم أو اسم المضيف أو IP أو المسؤول أو القسم…',
      emptyTitle: 'لا توجد أصول',
      emptyDescription: 'ابدأ بإنشاء أصل أو تشغيل فحص اكتشاف آلي.',
      emptyDescriptionGrid: 'ابدأ بإنشاء أصل أو تشغيل فحص.',
    },
    bulk: {
      bulkTag: 'وسم جماعي',
      setActive: 'تعيين كنشط',
      decommission: 'إيقاف التشغيل',
      deleteSelected: 'حذف المحدد',
      selectAtLeastOne: 'اختر أصلًا واحدًا على الأقل',
      setActiveDone: (count) => `تم تعيين ${count} أصل كنشط`,
      decommissionedDone: (count) => `تم إيقاف تشغيل ${count} أصل`,
      deletedDone: (count) => `تم حذف ${count} أصل`,
      deleteConfirm: 'هل أنت متأكد من حذف الأصول المحددة؟ لا يمكن التراجع عن هذا الإجراء.',
    },
    kpi: {
      totalAssets: 'إجمالي الأصول',
      criticalAssets: 'الأصول الحرجة',
      withOpenVulns: 'بثغرات مفتوحة',
      discoveredThisWeek: 'المكتشفة هذا الأسبوع',
    },
    trend: {
      byType: 'الأصول حسب النوع',
      byCriticality: 'الأصول حسب الأهمية',
    },
    columns: {
      name: 'الاسم',
      type: 'النوع',
      ipAddress: 'عنوان IP',
      criticality: 'الأهمية',
      status: 'الحالة',
      vulns: 'الثغرات',
      tags: 'الوسوم',
      lastSeen: 'آخر ظهور',
      actions: 'إجراءات',
      moreTags: (count) => `+${count} المزيد`,
    },
    rowActions: {
      edit: 'تعديل',
      manageTags: 'إدارة الوسوم',
      addRelationship: 'إضافة علاقة',
      delete: 'حذف',
    },
    typeLabels: {
      server: 'خادم',
      endpoint: 'نقطة طرفية',
      cloud_resource: 'سحابي',
      network_device: 'شبكة',
      iot_device: 'IoT',
      application: 'تطبيق',
      database: 'قاعدة بيانات',
      container: 'حاوية',
    },
    statusLabels: {
      active: 'نشط',
      inactive: 'غير نشط',
      decommissioned: 'مُوقَف',
      unknown: 'غير معروف',
    },
    filters: {
      type: 'النوع',
      criticality: 'الأهمية',
      status: 'الحالة',
      discoverySource: 'مصدر الاكتشاف',
      hasVulnerabilities: 'يحتوي على ثغرات',
      owner: 'المسؤول',
      department: 'القسم',
      tag: 'الوسم',
      discoveredAfter: 'مُكتشف بعد',
      ownerPlaceholder: 'تصفية حسب المسؤول...',
      departmentPlaceholder: 'تصفية حسب القسم...',
      tagPlaceholder: 'تصفية حسب الوسم...',
      yes: 'نعم',
      no: 'لا',
      typeOptions: {
        server: 'خادم',
        endpoint: 'نقطة طرفية',
        cloudResource: 'مورد سحابي',
        networkDevice: 'جهاز شبكة',
        iotDevice: 'جهاز IoT',
        application: 'تطبيق',
        database: 'قاعدة بيانات',
        container: 'حاوية',
      },
      critOptions: {
        critical: 'حرج',
        high: 'عالٍ',
        medium: 'متوسط',
        low: 'منخفض',
      },
      statusOptions: {
        active: 'نشط',
        inactive: 'غير نشط',
        decommissioned: 'مُوقَف',
        unknown: 'غير معروف',
      },
      sourceOptions: {
        manual: 'يدوي',
        networkScan: 'فحص شبكة',
        cloudScan: 'فحص سحابي',
        agent: 'وكيل',
        import: 'استيراد',
      },
    },
    grid: {
      emptyTitle: 'لا توجد أصول',
      criticality: 'الأهمية',
      status: 'الحالة',
      ip: 'IP',
      vulnerabilities: 'الثغرات',
      critShort: (count) => `(${count} حرج)`,
    },
    form: {
      name: 'الاسم',
      type: 'النوع',
      criticality: 'الأهمية',
      status: 'الحالة',
      ipAddress: 'عنوان IP',
      hostname: 'اسم المضيف',
      operatingSystem: 'نظام التشغيل',
      owner: 'المسؤول',
      department: 'القسم',
      location: 'الموقع',
      cancel: 'إلغاء',
      createTitle: 'إنشاء أصل',
      editTitle: 'تعديل أصل',
      creating: 'جارٍ الإنشاء…',
      saving: 'جارٍ الحفظ…',
      createSubmit: 'إنشاء أصل',
      saveSubmit: 'حفظ التغييرات',
      createdToast: 'تم إنشاء الأصل بنجاح',
      updatedToast: 'تم تحديث الأصل بنجاح',
      ownerPlaceholder: 'فريق الأمن',
      departmentPlaceholder: 'الهندسة',
      nameMin: 'يجب ألا يقل الاسم عن حرفين',
    },
    deleteDialog: {
      title: 'حذف أصل',
      irreversiblePrefix: 'هذا الإجراء ',
      irreversibleWord: 'لا يمكن التراجع عنه',
      irreversibleSuffix: (name) => `. سيتم فك ارتباط جميع الثغرات ومراجع التنبيهات وسجل الفحص المرتبط بـ ${name}.`,
      assetLabel: 'الأصل:',
      typeLabel: 'النوع:',
      criticalityLabel: 'الأهمية:',
      warningLabel: 'تحذير:',
      warningBody: (count) => `يحتوي هذا الأصل على ${count} ثغرة مفتوحة.`,
      confirmPromptPrefix: 'اكتب ',
      confirmPromptWord: 'DELETE',
      confirmPromptSuffix: ' للتأكيد',
      confirmPlaceholder: 'DELETE',
      cancel: 'إلغاء',
      deleting: 'جارٍ الحذف…',
      deleteSubmit: 'حذف الأصل',
      deletedToast: 'تم حذف الأصل',
    },
    tagDialog: {
      title: 'إدارة الوسوم',
      description: (name) => `إضافة أو إزالة الوسوم لـ ${name}.`,
      inputPlaceholder: 'أضف وسمًا (اضغط Enter)',
      noTags: 'لا توجد وسوم. أضف واحدًا أعلاه.',
      removeTag: (tag) => `إزالة ${tag}`,
      cancel: 'إلغاء',
      saving: 'جارٍ الحفظ…',
      saveTags: 'حفظ الوسوم',
      updatedToast: 'تم تحديث الوسوم',
    },
    bulkTagDialog: {
      title: 'إدارة الوسوم الجماعية',
      description: (count) => `إضافة وسوم إلى ${count} أصل محدد. سيتم دمج الوسوم مع الوسوم الحالية.`,
      tagsToAdd: 'الوسوم المراد إضافتها',
      inputPlaceholder: 'اكتب وسمًا واضغط Enter...',
      add: 'إضافة',
      cancel: 'إلغاء',
      applying: 'جارٍ التطبيق...',
      applySubmit: (count) => `تطبيق على ${count} أصل`,
      addAtLeastOne: 'أضف وسمًا واحدًا على الأقل',
      appliedToast: (count) => `تم تطبيق الوسوم على ${count} أصل`,
      failedToast: 'تعذّر تطبيق الوسوم',
    },
    scanDialog: {
      title: 'بدء فحص الأصول',
      description: 'فحص الأهداف بحثًا عن الثغرات والتهيئات الخاطئة وطوبولوجيا الشبكة.',
      scanType: 'نوع الفحص',
      optNetwork: 'الشبكة — اكتشاف الطوبولوجيا والمنافذ',
      optCloud: 'السحابة — تعداد الأصول السحابية',
      optAgent: 'الوكيل — فحص المضيف عبر الوكيل',
      targets: 'الأهداف',
      targetsHint: 'عناوين IP أو نطاقات CIDR أو أسماء المضيفين مفصولة بفواصل.',
      ports: 'المنافذ',
      portsHint: 'اتركه فارغًا لفحص أعلى ١٠٠٠ منفذ.',
      additionalChecks: 'فحوصات إضافية',
      vulnMatching: 'مطابقة الثغرات (بحث CVE)',
      configAudit: 'تدقيق التهيئة (معايير CIS)',
      cancel: 'إلغاء',
      starting: 'جارٍ البدء…',
      startScan: 'بدء الفحص',
      startedToast: 'تم بدء الفحص بنجاح',
      scanTypeRequired: 'نوع الفحص مطلوب',
      targetRequired: 'مطلوب هدف واحد على الأقل',
    },
    scheduleDialog: {
      title: 'جدولة فحص متكرر',
      description: 'تهيئة فحوصات اكتشاف آلية تعمل وفق جدول متكرر.',
      label: 'التسمية',
      labelPlaceholder: 'مثال: فحص أسبوعي لشبكة الإنتاج',
      scanType: 'نوع الفحص',
      networkDiscovery: 'اكتشاف الشبكة',
      cloudResourceSync: 'مزامنة الموارد السحابية',
      agentBasedInventory: 'جرد عبر الوكيل',
      targets: 'الأهداف',
      targetsPlaceholder: 'عناوين IP أو نطاقات CIDR أو أسماء المضيفين (مفصولة بفواصل)',
      targetsHint: 'أمثلة: 10.0.0.0/24، 192.168.1.1-100، server-prod-*.example.com',
      schedule: 'الجدولة',
      cronPrefix: 'تعبير Cron:',
      intervals: {
        hourly: 'كل ساعة',
        every6h: 'كل ٦ ساعات',
        dailyMidnight: 'يوميًا عند منتصف الليل',
        daily6am: 'يوميًا الساعة ٦ صباحًا',
        weekly: 'أسبوعيًا (الأحد منتصف الليل)',
        monthly: 'شهريًا (اليوم الأول منتصف الليل)',
      },
      cancel: 'إلغاء',
      creating: 'جارٍ الإنشاء...',
      createSchedule: 'إنشاء جدول',
      createdToast: 'تم إنشاء الفحص المجدول',
      failedToast: 'تعذّر إنشاء الفحص المجدول',
      targetRequired: 'مطلوب هدف واحد على الأقل',
      scheduleRequired: 'الجدولة مطلوبة',
      labelRequired: 'مطلوب تسمية وصفية',
    },
    importDialog: {
      title: 'استيراد جماعي للأصول',
      descriptionPrefix: 'الصق مصفوفة JSON من الأصول للاستيراد. الحقول المطلوبة: ',
      jsonInput: 'مدخل JSON',
      invalidArray: 'يجب أن يكون المدخل مصفوفة JSON من الأصول',
      invalidJson: (msg) => `JSON غير صالح: ${msg}`,
      validatePreview: 'تحقّق ومعاينة',
      previewTitle: (count) => `معاينة (${count} أصل)`,
      edit: 'تعديل',
      colName: 'الاسم',
      colType: 'النوع',
      colCriticality: 'الأهمية',
      colIp: 'عنوان IP',
      colOwner: 'المسؤول',
      cancel: 'إلغاء',
      importing: 'جارٍ الاستيراد…',
      importSubmit: (count) => `استيراد ${count} أصل`,
      completeToast: 'اكتمل الاستيراد الجماعي',
    },
    relationshipDialog: {
      title: 'إضافة علاقة',
      description: (name) => `إنشاء اعتمادية أو اتصال من ${name} إلى أصل آخر.`,
      relationshipType: 'نوع العلاقة',
      targetAsset: 'الأصل الهدف',
      searchPlaceholder: 'البحث بالاسم أو اسم المضيف أو IP...',
      search: 'بحث',
      searching: 'جارٍ البحث...',
      noAddress: 'لا يوجد عنوان',
      cancel: 'إلغاء',
      creating: 'جارٍ الإنشاء...',
      createSubmit: 'إنشاء علاقة',
      selectTarget: 'اختر أصلًا هدفًا',
      createdToast: (source, target) => `تم إنشاء العلاقة: ${source} ← ${target}`,
      searchFailedToast: 'تعذّر البحث عن الأصول',
      createFailedToast: 'تعذّر إنشاء العلاقة',
      types: {
        hosts: 'يستضيف',
        runsOn: 'يعمل على',
        connectsTo: 'يتصل بـ',
        dependsOn: 'يعتمد على',
        managedBy: 'يُدار بواسطة',
        backsUp: 'ينسخ احتياطيًا',
        loadBalances: 'يوازن الأحمال',
      },
    },
    detail: {
      loadError: 'تعذّر تحميل الأصل',
      goBack: 'رجوع',
      scan: 'فحص',
      tags: 'الوسوم',
      edit: 'تعديل',
      delete: 'حذف',
      statVulnerabilities: 'الثغرات',
      statCriticalVulns: 'الثغرات الحرجة',
      statHighVulns: 'الثغرات العالية',
      statOpenAlerts: 'التنبيهات المفتوحة',
      tabOverview: 'نظرة عامة',
      tabVulnerabilities: 'الثغرات',
      tabAlerts: 'التنبيهات',
      tabRelationships: 'العلاقات',
      tabConfiguration: 'التهيئة',
      tabActivity: 'النشاط',
    },
    overview: {
      identity: 'الهوية',
      network: 'الشبكة',
      system: 'النظام',
      ownership: 'الملكية',
      securityPosture: 'الوضع الأمني',
      tags: 'الوسوم',
      timeline: 'الخط الزمني',
      fType: 'النوع',
      fCriticality: 'الأهمية',
      fStatus: 'الحالة',
      fDiscoverySource: 'مصدر الاكتشاف',
      fIpAddress: 'عنوان IP',
      fHostname: 'اسم المضيف',
      fMacAddress: 'عنوان MAC',
      fOperatingSystem: 'نظام التشغيل',
      fOsVersion: 'إصدار نظام التشغيل',
      fLocation: 'الموقع',
      fOwner: 'المسؤول',
      fDepartment: 'القسم',
      fTotalVulns: 'إجمالي الثغرات',
      fCriticalVulns: 'الثغرات الحرجة',
      fHighVulns: 'الثغرات العالية',
      fOpenAlerts: 'التنبيهات المفتوحة',
      fDiscovered: 'تاريخ الاكتشاف',
      fLastSeen: 'آخر ظهور',
      fLastUpdated: 'آخر تحديث',
      fCreated: 'أُنشئ في',
    },
    vulnsTab: {
      loadError: 'تعذّر تحميل الثغرات',
      emptyTitle: 'لا توجد ثغرات',
      emptyDescription: 'لا توجد ثغرات معروفة لهذا الأصل.',
      foundCount: (count) => `تم العثور على ${count} ثغرة`,
      colSeverity: 'الخطورة',
      colCveTitle: 'CVE / العنوان',
      colCvss: 'CVSS',
      colStatus: 'الحالة',
      colAge: 'العمر',
      exploitAvailable: 'استغلال متاح',
    },
    alertsTab: {
      loadError: 'تعذّر تحميل التنبيهات',
      emptyTitle: 'لا توجد تنبيهات',
      emptyDescription: 'لا توجد تنبيهات مرتبطة بهذا الأصل.',
      countLabel: (count) => `${count} تنبيه`,
      confidence: (score) => `الثقة: ${score}٪`,
    },
    relTab: {
      loadError: 'تعذّر تحميل العلاقات',
      emptyTitle: 'لا توجد علاقات',
      emptyDescription: 'لم يُكتشف أي علاقات للأصل. شغّل فحص شبكة لاكتشاف الاتصالات بين الأصول.',
      countHint: (count) => `تم العثور على ${count} علاقة. اسحب العقد للاستكشاف. مرّر للتكبير.`,
    },
    activityTab: {
      loadError: 'تعذّر تحميل النشاط',
      emptyTitle: 'لا يوجد نشاط',
      emptyDescription: 'لم يُسجَّل أي نشاط لهذا الأصل حتى الآن.',
    },
    configTab: {
      emptyTitle: 'لا توجد بيانات تهيئة',
      emptyDescription: 'ستظهر بيانات التهيئة الوصفية هنا بعد تشغيل فحص تهيئة على هذا الأصل.',
      intro: 'بيانات التهيئة الوصفية المجمَّعة أثناء الاكتشاف أو الفحص الأخير.',
      colKey: 'المفتاح',
      colValue: 'القيمة',
    },
    scansList: {
      eyebrow: 'الدفاع السيبراني',
      title: 'فحوصات الأصول',
      description: 'سجل فحوصات اكتشاف الأصول الشبكية والسحابية',
      backToAssets: 'العودة إلى الأصول',
      searchPlaceholder: 'البحث في الفحوصات…',
      emptyTitle: 'لا توجد فحوصات',
      emptyDescription: 'شغّل فحص اكتشاف أصول لملء هذه القائمة.',
      colType: 'النوع',
      colStatus: 'الحالة',
      colTarget: 'الهدف',
      colFound: 'المكتشفة',
      colUpdated: 'المحدَّثة',
      colStarted: 'البدء',
      colCompleted: 'الاكتمال',
      colError: 'الخطأ',
    },
    scanStatus: {
      running: 'قيد التشغيل',
      completed: 'مكتمل',
      failed: 'فشل',
      cancelled: 'ملغى',
    },
    scanDetail: {
      eyebrow: 'الدفاع السيبراني',
      loadError: 'تعذّر تحميل تفاصيل الفحص',
      scanSuffix: 'فحص',
      startedPrefix: 'بدأ',
      statAssetsFound: 'الأصول المكتشفة',
      statAssetsUpdated: 'الأصول المحدَّثة',
      statDuration: 'المدة',
      statTarget: 'الهدف',
      detailsTitle: 'تفاصيل الفحص',
      dScanType: 'نوع الفحص',
      dStatus: 'الحالة',
      dTargetCidr: 'الهدف (CIDR)',
      dStartedAt: 'وقت البدء',
      dCompletedAt: 'وقت الاكتمال',
      dDuration: 'المدة',
      dError: 'الخطأ',
      discoveredAssets: 'الأصول المكتشفة',
      discoveredEmptyTitle: 'لم تُكتشف أي أصول',
      discoveredEmptyDescription: 'لم يكتشف هذا الفحص أي أصول، أو لم يتم تحميلها بعد.',
      colName: 'الاسم',
      colType: 'النوع',
      colIp: 'عنوان IP',
      colStatus: 'الحالة',
      colCriticality: 'الأهمية',
    },
    scanPanels: {
      inProgress: 'الفحص قيد التشغيل',
      elapsedSec: (s) => `مضى ${s} ثانية`,
      elapsedMin: (m, s) => `مضى ${m} دقيقة ${s} ثانية`,
      discoveredSoFar: (count) => `تم اكتشاف ${count.toLocaleString()} أصل حتى الآن…`,
      scanningForAssets: 'جارٍ فحص الشبكة بحثًا عن الأصول…',
      scanError: 'خطأ في الفحص',
    },
  },
};

export function useAssetLabels(): AssetLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(assetLabels, locale), [locale]);
}
