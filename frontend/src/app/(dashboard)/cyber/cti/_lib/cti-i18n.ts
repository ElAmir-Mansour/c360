/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber Threat Intelligence (`/cyber/cti/**`) area.
 *
 * Same `{ en, ar }` bundle pattern as the alerts/events bundles: pages read the
 * resolved `T` from `useCtiLabels()`, which falls back to English when no
 * LocaleProvider is mounted. The `en` side equals the pre-existing English
 * strings VERBATIM.
 *
 * NOTE: shared CTI widgets under `@/components/cyber/cti/*` (risk-score gauge,
 * sector-threat chart, KPI cards, badges, dialogs) are out of this area's scope
 * and keep their own copy; this bundle covers the strings authored in the
 * `cti/**` route/page files.
 *
 * Acronyms / product names stay as-is across both locales: CTI, IOC, MITRE
 * ATT&CK, MTTD, MTTR, WS, WHOIS, SSL, ASN.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveCyberBilingual, type CyberBilingual } from '../../_lib/cyber-i18n';

interface CtiLabels {
  dashboard: {
    title: string;
    description: string;
    ws: (status: string) => string;
    wsStatuses: {
      idle: string;
      connecting: string;
      connected: string;
      error: string;
      closed: string;
    };
    refresh: string;
    kpiEvents24h: string;
    kpiEvents7d: (count: string) => string;
    kpiActiveCampaigns: string;
    kpiCriticalCount: (count: number) => string;
    kpiTotalIocs: string;
    kpiTopSector: (sector: string) => string;
    kpiBrandAbuse: string;
    liveEventFeed: string;
    activeCampaigns: string;
    viewAll: string;
    colCampaign: string;
    colStatus: string;
    colActor: string;
    colIocs: string;
    colEvents: string;
    unknownActor: string;
    noCampaigns: string;
    criticalBrandAbuse: string;
    unknownRegion: string;
    detections: (count: number) => string;
    noBrandAbuse: string;
    topTargetedSectors: string;
    eventsIn: (count: string, period: string) => string;
    noSectorAnalytics: string;
    executiveRiskPosture: string;
    topOrigin: string;
    topSector: string;
    refreshWindow: string;
    unavailable: string;
    loadFailed: string;
  };
  campaigns: {
    title: string;
    description: string;
    newCampaign: string;
    statusActive: string;
    statusMonitoring: string;
    statusDormant: string;
    statusResolved: string;
    statusArchived: string;
    subtitleCampaigns: string;
    filterStatus: string;
    filterSeverity: string;
    filterActor: string;
    sevCritical: string;
    sevHigh: string;
    sevMedium: string;
    sevLow: string;
    sevInformational: string;
    viewCampaign: string;
    editCampaign: string;
    moveToMonitoring: string;
    resolveCampaign: string;
    deleteCampaign: string;
    setMonitoring: string;
    resolveSelected: string;
    deleteSelected: string;
    colCode: string;
    colCampaign: string;
    colActor: string;
    colStatus: string;
    colSeverity: string;
    colTargets: string;
    colIocs: string;
    colEvents: string;
    colLastSeen: string;
    noNarrative: string;
    unassigned: string;
    noTargets: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    createCampaign: string;
    deleteTitle: string;
    deleteDescription: string;
    deleteConfirm: string;
    statusUpdateFailed: string;
    moved: (count: number, status: string) => string;
    deleteFailed: string;
    deleted: (count: number) => string;
  };
  actors: {
    title: string;
    description: string;
    newActor: string;
    filterActorType: string;
    filterSophistication: string;
    filterActive: string;
    typeStateSponsored: string;
    typeCybercriminal: string;
    typeHacktivist: string;
    typeInsider: string;
    typeUnknown: string;
    sophAdvanced: string;
    sophIntermediate: string;
    sophBasic: string;
    active: string;
    inactive: string;
    viewActor: string;
    editActor: string;
    toggleActive: string;
    deleteActor: string;
    activateSelected: string;
    deactivateSelected: string;
    deleteSelected: string;
    colActor: string;
    colType: string;
    colOrigin: string;
    colSophistication: string;
    colMotivation: string;
    colRisk: string;
    colStatus: string;
    colLastActivity: string;
    noAliases: string;
    unknown: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    createActor: string;
    deleteTitle: string;
    deleteDescription: string;
    deleteConfirm: string;
    statusUpdateFailed: string;
    updated: (count: number) => string;
    deleteFailed: string;
    deleted: (count: number) => string;
  };
  events: {
    title: string;
    description: string;
    colSeverity: string;
    colTitle: string;
    colEventType: string;
    colOrigin: string;
    colTargetSector: string;
    colConfidence: string;
    colFirstSeen: string;
    new: string;
    noContext: string;
    unknown: string;
    viewDetail: string;
    resolve: string;
    markFalsePositive: string;
    delete: string;
    resolveSelected: string;
    eventResolved: string;
    resolveFailed: string;
    markedFalsePositive: string;
    updateFailed: string;
    deleted: string;
    deleteFailed: string;
    eventsResolved: (count: number) => string;
    eventsUpdated: (count: number) => string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  brandAbuse: {
    title: string;
    description: string;
    manageBrands: string;
    newIncident: string;
    filterBrand: string;
    filterRisk: string;
    filterTakedown: string;
    filterAbuseType: string;
    filterAbuseTypePlaceholder: string;
    markReported: string;
    requestTakedown: string;
    markTakenDown: string;
    setMonitoring: string;
    markFalsePositive: string;
    viewIncident: string;
    editIncident: string;
    colBrand: string;
    colDomain: string;
    colRisk: string;
    colTakedown: string;
    colDetections: string;
    colLastDetected: string;
    kpiMonitoredBrands: string;
    kpiMonitoredBrandsSub: string;
    kpiCriticalAlerts: string;
    kpiCriticalAlertsSub: string;
    kpiTotalIncidents: string;
    kpiTotalIncidentsSub: string;
    kpiPendingTakedowns: string;
    kpiPendingTakedownsSub: string;
    kpiTakenDown: string;
    kpiTakenDownSub: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    createIncident: string;
    moved: (count: number, status: string) => string;
    updateFailed: string;
  };
  sectors: {
    title: string;
    description: string;
    kpiImpactedSectors: string;
    reportingWindow: (period: string) => string;
    kpiTotalSectorEvents: string;
    aggregatedAcrossAll: string;
    kpiCriticalEvents: string;
    criticalSeverityPressure: string;
    failedToLoad: string;
    lensBadge: string;
    lensHeadline: string;
    lensBody: string;
    uniqueSectors: (count: number) => string;
    summaryPoints: (count: string) => string;
    sectorHoldsPressure: (sector: string, pct: number) => string;
    primaryFocus: string;
    none: string;
    selectSector: string;
    eventsCount: (count: string) => string;
    snapshotFreshness: string;
    live: string;
    latestAggregation: string;
    criticalMix: string;
    ofDisplayedEvents: string;
    navigatorTitle: string;
    navigatorBody: string;
    selected: string;
    eventsSuffix: (count: string) => string;
    deepDive: string;
    latestAggregationRelative: (when: string) => string;
    sectorShare: string;
    ofDisplayedActivity: string;
    metricTotal: string;
    metricTotalSub: string;
    metricCritical: string;
    metricCriticalSub: string;
    metricHigh: string;
    metricHighSub: string;
    metricMediumLow: string;
    metricMediumLowSub: string;
    topThreatTypes: string;
    noThreatTaxonomy: string;
    topOrigins: string;
    noGeoSignal: string;
    severityTrend: string;
    recentEventCadence: string;
    recentEvents: string;
    matchedEvents: (count: string) => string;
    unknownOrigin: string;
    unknownActor: string;
    unknown: string;
    noRecentEvents: string;
    viewAllEventsFor: (sector: string) => string;
    campaignPressure: string;
    linked: (count: number) => string;
    noCampaignsTargetSector: string;
    attributionLane: string;
    actorsCount: (count: number) => string;
    noAttributedActors: string;
  };
  geo: {
    title: string;
    description: string;
    kpiCountriesObserved: string;
    coverageWindow: (period: string) => string;
    kpiHotspotEvents: string;
    aggregatedFromGeo: string;
    kpiTopOrigin: string;
    eventsCount: (count: string) => string;
    noCountrySelected: string;
    kpiAvgPressure: string;
    eventsPerCountry: string;
    loadFailed: string;
    countryRankings: string;
    colRank: string;
    colCountry: string;
    colEvents: string;
    colCritical: string;
    colHigh: string;
    colTrend: string;
    noCountryData: string;
    countryDetail: string;
    metricTotalEvents: string;
    metricCritical: string;
    metricActiveCampaigns: string;
    topThreatTypes: string;
    noThreatBreakdown: string;
    topTargetedSectors: string;
    noSectorTargeting: string;
    activeActors: string;
    noActiveActors: string;
    activeCampaigns: string;
    noActiveCampaigns: string;
    recentEvents: string;
    unknownCity: string;
    noRecentEvents: string;
    viewAllEventsFrom: (country: string) => string;
    selectCountry: string;
    unknown: string;
    unknownActor: string;
  };
  campaignDetail: {
    updateStatus: string;
    moveTo: (status: string) => string;
    linkEvent: string;
    addIoc: string;
    edit: string;
    delete: string;
    kpiIocCount: string;
    kpiIocCountSub: string;
    kpiEventCount: string;
    kpiEventCountSub: string;
    kpiDuration: string;
    kpiDurationSub: string;
    tabOverview: string;
    tabIocs: (count: number) => string;
    tabEvents: (count: number) => string;
    tabTimeline: string;
    campaignOverview: string;
    firstSeen: string;
    lastSeen: string;
    status: string;
    severity: string;
    description: string;
    noDescription: string;
    targetingNotes: string;
    noTargeting: string;
    threatActor: string;
    primaryActorNarrative: string;
    viewActorProfile: string;
    noPrimaryActor: string;
    targetSectors: string;
    noTargetSectors: string;
    targetRegions: string;
    noTargetRegions: string;
    ttpCoverage: string;
    noTtpSummary: string;
    campaignIndicators: string;
    noCampaignIocs: string;
    linkedThreatEvents: string;
    noEventMetadata: string;
    unlink: string;
    noEventsLinked: string;
    campaignTimeline: string;
    noTimeline: string;
    confidence: (score: string) => string;
    lastSeenRelative: (when: string) => string;
    remove: string;
    results0: string;
    rangeOf: (start: number, end: number, total: string) => string;
    previous: string;
    next: string;
    addCampaignIocTitle: string;
    addCampaignIocDescription: string;
    iocType: string;
    confidencePct: string;
    iocValue: string;
    sourceName: string;
    cancel: string;
    savingDots: string;
    addIocBtn: string;
    timelineCampaignCreated: string;
    timelineCampaignCreatedDesc: (name: string) => string;
    timelineFirstSeen: string;
    timelineFirstSeenDesc: string;
    timelineLastActivity: string;
    timelineLastActivityDesc: string;
    timelineIocAdded: string;
    timelineEventLinked: string;
    timelineResolved: string;
    timelineResolvedDesc: string;
    linkDialogTitle: string;
    linkDialogDescription: string;
    linkSearchPlaceholder: string;
    deleteTitle: string;
    deleteDescription: string;
    deleteConfirm: string;
    statusUpdated: string;
    statusUpdateFailed: string;
    eventUnlinked: string;
    eventUnlinkFailed: string;
    campaignDeleted: string;
    campaignDeleteFailed: string;
    iocRemoved: string;
    iocRemoveFailed: string;
    eventLinked: string;
    iocAdded: string;
    iocAddFailed: string;
    loadFailed: string;
  };
  actorDetail: {
    active: string;
    inactive: string;
    riskLabel: (score: number) => string;
    unknown: string;
    deactivate: string;
    activate: string;
    edit: string;
    delete: string;
    tabProfile: string;
    tabCampaigns: (count: number) => string;
    tabTechniques: (count: number) => string;
    tabIocs: (count: number) => string;
    kpiActiveCampaigns: string;
    kpiActiveCampaignsSub: string;
    kpiTotalIocs: string;
    kpiTotalIocsSub: string;
    kpiObservedSince: string;
    kpiObservedSinceSub: string;
    actorProfile: string;
    originCountry: string;
    sophistication: string;
    motivation: string;
    firstObserved: string;
    lastActivity: string;
    mitreGroup: string;
    aliasesNotes: string;
    noAliases: string;
    noNotes: string;
    associatedCampaigns: string;
    noCampaigns: string;
    observedTechniques: string;
    aggregatedIocs: string;
    confidencePct: (pct: string) => string;
    noIocs: string;
    actorStatusUpdateFailed: string;
    actorStatusUpdated: string;
    actorDeleted: string;
    actorDeleteFailed: string;
    loadFailed: string;
    deleteTitle: string;
    deleteDescription: string;
    deleteConfirm: string;
  };
  eventDetail: {
    threatEventSummary: (idShort: string, type: string) => string;
    firstSeenRelative: (when: string) => string;
    resolve: string;
    falsePositive: string;
    linkToCampaign: string;
    delete: string;
    eventDetails: string;
    confidence: string;
    category: string;
    source: string;
    targetSector: string;
    targetOrganization: string;
    origin: string;
    targetCountry: string;
    created: string;
    lastSeen: string;
    unknown: string;
    indicatorOrigin: string;
    mitreTechniques: string;
    tags: string;
    addTagsPlaceholder: string;
    add: string;
    noTags: string;
    timeline: string;
    relatedCampaigns: string;
    noRelatedCampaigns: string;
    linkDialogTitle: string;
    linkDialogDescription: string;
    campaign: string;
    selectCampaign: string;
    cancel: string;
    linkCampaign: string;
    iocCopied: string;
    eventResolved: string;
    markedFalsePositive: string;
    eventDeleted: string;
    tagsAdded: string;
    tagRemoved: string;
    eventLinked: string;
    idMissing: string;
    loadFailed: string;
    tlFirstObserved: string;
    tlFirstObservedDesc: string;
    tlIngested: string;
    tlIngestedDesc: string;
    tlLastSeen: string;
    tlLastSeenDesc: string;
    tlFalsePositive: string;
    tlFalsePositiveDesc: string;
    tlResolved: string;
    tlResolvedDesc: string;
  };
  brandAbuseDetail: {
    updateStatus: string;
    moveTo: (status: string) => string;
    manageBrands: string;
    edit: string;
    kpiDetectionCount: string;
    kpiDetectionCountSub: string;
    kpiTakedownStatus: string;
    kpiTakedownStatusSub: string;
    kpiDaysActive: string;
    kpiDaysActiveSub: string;
    requestTakedown: string;
    markTakenDown: string;
    markFalsePositive: string;
    relatedEvents: string;
    incidentDetails: string;
    abuseType: string;
    region: string;
    hostingIp: string;
    hostingAsn: string;
    whoisRegistrant: string;
    whoisCreated: string;
    sslIssuer: string;
    firstDetected: string;
    lastDetected: string;
    monitoredBrandContext: string;
    brand: string;
    domainPattern: string;
    keywords: string;
    noKeywords: string;
    takedownStatusUpdated: string;
    takedownStatusUpdateFailed: string;
    loadFailed: string;
  };
  /**
   * Value→label maps for the fixed CTI enums (actor type, sophistication,
   * motivation). These mirror the English-only `CTI_*_LABELS` constants in
   * `@/types/cti`; the CTI area reads them locale-aware so the actor list,
   * actor profile, and geo attribution surfaces render Arabic instead of the
   * raw enum key. Keys equal the backend enum values verbatim.
   */
  enumLabels: {
    actorType: {
      state_sponsored: string;
      cybercriminal: string;
      hacktivist: string;
      insider: string;
      unknown: string;
    };
    sophistication: {
      advanced: string;
      intermediate: string;
      basic: string;
    };
    motivation: {
      espionage: string;
      financial_gain: string;
      disruption: string;
      ideological: string;
      unknown: string;
    };
  };
}

// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
export const ctiLabels: CyberBilingual<CtiLabels> = {
  en: {
    dashboard: {
      title: 'Cyber Threat Intelligence',
      description: 'Cyber Threat Intelligence Command Center',
      ws: (status) => `WS ${status}`,
      wsStatuses: {
        idle: 'idle',
        connecting: 'connecting',
        connected: 'connected',
        error: 'error',
        closed: 'closed',
      },
      refresh: 'Refresh',
      kpiEvents24h: 'Events 24h',
      kpiEvents7d: (count) => `${count} in 7d`,
      kpiActiveCampaigns: 'Active Campaigns',
      kpiCriticalCount: (count) => `${count} critical`,
      kpiTotalIocs: 'Total IOCs',
      kpiTopSector: (sector) => `Top sector: ${sector}`,
      kpiBrandAbuse: 'Brand Abuse Alerts',
      liveEventFeed: 'Live Event Feed',
      activeCampaigns: 'Active Campaigns',
      viewAll: 'View all →',
      colCampaign: 'Campaign',
      colStatus: 'Status',
      colActor: 'Actor',
      colIocs: 'IOCs',
      colEvents: 'Events',
      unknownActor: 'Unknown actor',
      noCampaigns: 'No campaigns available.',
      criticalBrandAbuse: 'Critical Brand Abuse Alerts',
      unknownRegion: 'Unknown region',
      detections: (count) => `${count} detections`,
      noBrandAbuse: 'No active brand abuse incidents.',
      topTargetedSectors: 'Top Targeted Sectors',
      eventsIn: (count, period) => `${count} events in ${period}`,
      noSectorAnalytics: 'No sector analytics available.',
      executiveRiskPosture: 'Executive Risk Posture',
      topOrigin: 'Top Origin',
      topSector: 'Top Sector',
      refreshWindow: 'Refresh Window',
      unavailable: 'Unavailable',
      loadFailed: 'Failed to load CTI dashboard.',
    },
    campaigns: {
      title: 'Active Campaigns',
      description: 'Track and profile ongoing cyber attack campaigns.',
      newCampaign: 'New Campaign',
      statusActive: 'Active',
      statusMonitoring: 'Monitoring',
      statusDormant: 'Dormant',
      statusResolved: 'Resolved',
      statusArchived: 'Archived',
      subtitleCampaigns: 'Campaigns',
      filterStatus: 'Status',
      filterSeverity: 'Severity',
      filterActor: 'Actor',
      sevCritical: 'Critical',
      sevHigh: 'High',
      sevMedium: 'Medium',
      sevLow: 'Low',
      sevInformational: 'Informational',
      viewCampaign: 'View Campaign',
      editCampaign: 'Edit Campaign',
      moveToMonitoring: 'Move to Monitoring',
      resolveCampaign: 'Resolve Campaign',
      deleteCampaign: 'Delete Campaign',
      setMonitoring: 'Set Monitoring',
      resolveSelected: 'Resolve Selected',
      deleteSelected: 'Delete Selected',
      colCode: 'Code',
      colCampaign: 'Campaign',
      colActor: 'Actor',
      colStatus: 'Status',
      colSeverity: 'Severity',
      colTargets: 'Targets',
      colIocs: 'IOCs',
      colEvents: 'Events',
      colLastSeen: 'Last Seen',
      noNarrative: 'No analyst narrative',
      unassigned: 'Unassigned',
      noTargets: 'Sector and region targets not captured',
      searchPlaceholder: 'Search campaigns by name, code, or actor…',
      emptyTitle: 'No campaigns found',
      emptyDescription: 'Campaigns will appear here as CTI data is linked and aggregated.',
      createCampaign: 'Create Campaign',
      deleteTitle: 'Delete campaign',
      deleteDescription: 'This permanently removes the campaign record from CTI views.',
      deleteConfirm: 'Delete Campaign',
      statusUpdateFailed: 'Failed to update campaign status',
      moved: (count, status) => `${count} campaign${count === 1 ? '' : 's'} moved to ${status}`,
      deleteFailed: 'Failed to delete campaign',
      deleted: (count) => `${count} campaign${count === 1 ? '' : 's'} deleted`,
    },
    actors: {
      title: 'Threat Actor Profiles',
      description: 'Monitor threat actor profiles, motivations, and campaign attribution.',
      newActor: 'New Actor',
      filterActorType: 'Actor Type',
      filterSophistication: 'Sophistication',
      filterActive: 'Active',
      typeStateSponsored: 'State Sponsored',
      typeCybercriminal: 'Cybercriminal',
      typeHacktivist: 'Hacktivist',
      typeInsider: 'Insider',
      typeUnknown: 'Unknown',
      sophAdvanced: 'Advanced',
      sophIntermediate: 'Intermediate',
      sophBasic: 'Basic',
      active: 'Active',
      inactive: 'Inactive',
      viewActor: 'View Actor',
      editActor: 'Edit Actor',
      toggleActive: 'Toggle Active',
      deleteActor: 'Delete Actor',
      activateSelected: 'Activate Selected',
      deactivateSelected: 'Deactivate Selected',
      deleteSelected: 'Delete Selected',
      colActor: 'Actor',
      colType: 'Type',
      colOrigin: 'Origin',
      colSophistication: 'Sophistication',
      colMotivation: 'Motivation',
      colRisk: 'Risk',
      colStatus: 'Status',
      colLastActivity: 'Last Activity',
      noAliases: 'No aliases',
      unknown: 'Unknown',
      searchPlaceholder: 'Search actors by name, alias, or MITRE group…',
      emptyTitle: 'No threat actors found',
      emptyDescription: 'Threat actor profiles will appear here as intelligence records are curated.',
      createActor: 'Create Actor',
      deleteTitle: 'Delete threat actor',
      deleteDescription: 'This removes the threat actor profile from CTI views.',
      deleteConfirm: 'Delete Actor',
      statusUpdateFailed: 'Failed to update actor status',
      updated: (count) => `${count} actor${count === 1 ? '' : 's'} updated`,
      deleteFailed: 'Failed to delete threat actor',
      deleted: (count) => `${count} actor${count === 1 ? '' : 's'} deleted`,
    },
    events: {
      title: 'CTI Threat Events',
      description: 'Browse, filter, and investigate observed cyber threat intelligence events.',
      colSeverity: 'Severity',
      colTitle: 'Title',
      colEventType: 'Event Type',
      colOrigin: 'Origin',
      colTargetSector: 'Target Sector',
      colConfidence: 'Confidence',
      colFirstSeen: 'First Seen',
      new: 'New',
      noContext: 'No additional context',
      unknown: 'Unknown',
      viewDetail: 'View Detail',
      resolve: 'Resolve',
      markFalsePositive: 'Mark False Positive',
      delete: 'Delete',
      resolveSelected: 'Resolve Selected',
      eventResolved: 'Threat event resolved',
      resolveFailed: 'Failed to resolve threat event',
      markedFalsePositive: 'Threat event marked as false positive',
      updateFailed: 'Failed to update threat event',
      deleted: 'Threat event deleted',
      deleteFailed: 'Failed to delete threat event',
      eventsResolved: (count) => `${count} events resolved`,
      eventsUpdated: (count) => `${count} events updated`,
      searchPlaceholder: 'Search events by title, IOC, or source reference…',
      emptyTitle: 'No threat events found',
      emptyDescription: 'Adjust the current filters or wait for new CTI events to arrive.',
    },
    brandAbuse: {
      title: 'Brand Abuse Monitoring',
      description:
        'Track malicious domains, takedown progress, and the monitored-brand catalogue that powers executive CTI reporting.',
      manageBrands: 'Manage Brands',
      newIncident: 'New Incident',
      filterBrand: 'Brand',
      filterRisk: 'Risk',
      filterTakedown: 'Takedown',
      filterAbuseType: 'Abuse Type',
      filterAbuseTypePlaceholder: 'Filter by abuse type',
      markReported: 'Mark Reported',
      requestTakedown: 'Request Takedown',
      markTakenDown: 'Mark Taken Down',
      setMonitoring: 'Set Monitoring',
      markFalsePositive: 'Mark False Positive',
      viewIncident: 'View Incident',
      editIncident: 'Edit Incident',
      colBrand: 'Brand',
      colDomain: 'Domain',
      colRisk: 'Risk',
      colTakedown: 'Takedown',
      colDetections: 'Detections',
      colLastDetected: 'Last Detected',
      kpiMonitoredBrands: 'Monitored Brands',
      kpiMonitoredBrandsSub: 'Protected brands',
      kpiCriticalAlerts: 'Critical Alerts',
      kpiCriticalAlertsSub: 'Immediate action',
      kpiTotalIncidents: 'Total Incidents',
      kpiTotalIncidentsSub: 'Tracked abuse cases',
      kpiPendingTakedowns: 'Pending Takedowns',
      kpiPendingTakedownsSub: 'Reported or requested',
      kpiTakenDown: 'Taken Down',
      kpiTakenDownSub: 'Remediated incidents',
      searchPlaceholder: 'Search incidents by brand or malicious domain',
      emptyTitle: 'No brand abuse incidents found',
      emptyDescription: 'No incidents match the current filters.',
      createIncident: 'Create Incident',
      moved: (count, status) => `${count} incident${count === 1 ? '' : 's'} moved to ${status}`,
      updateFailed: 'Failed to update takedown status',
    },
    sectors: {
      title: 'Sector & Geographic Targeting',
      description:
        'Understand how threats are distributed across industries and pivot into deeper CTI investigations.',
      kpiImpactedSectors: 'Impacted Sectors',
      reportingWindow: (period) => `${period} reporting window`,
      kpiTotalSectorEvents: 'Total Sector Events',
      aggregatedAcrossAll: 'Aggregated across all sectors',
      kpiCriticalEvents: 'Critical Events',
      criticalSeverityPressure: 'Critical severity pressure',
      failedToLoad: 'Failed to load sector threat overview',
      lensBadge: 'Sector Intelligence Lens',
      lensHeadline: 'Focus the industries carrying the highest threat pressure.',
      lensBody:
        'The selector below now normalizes repeated aggregation snapshots into a clean set of sector lenses so you can pivot quickly without the page turning into noise.',
      uniqueSectors: (count) => `${count} unique sectors`,
      summaryPoints: (count) => `${count} summary points analyzed`,
      sectorHoldsPressure: (sector, pct) => `${sector} holds ${pct}% of pressure`,
      primaryFocus: 'Primary focus',
      none: 'None',
      selectSector: 'Select a sector',
      eventsCount: (count) => `${count} events`,
      snapshotFreshness: 'Snapshot freshness',
      live: 'Live',
      latestAggregation: 'Latest sector aggregation',
      criticalMix: 'Critical mix',
      ofDisplayedEvents: 'Of all displayed sector events',
      navigatorTitle: 'Sector Navigator',
      navigatorBody:
        'A tighter view of the highest-pressure sectors. Scroll horizontally to pivot the deep dive.',
      selected: 'Selected',
      eventsSuffix: (count) => `${count} events`,
      deepDive: 'Deep Dive',
      latestAggregationRelative: (when) => `Latest aggregation ${when}`,
      sectorShare: 'Sector share',
      ofDisplayedActivity: 'of displayed sector activity',
      metricTotal: 'Total',
      metricTotalSub: 'Events attributed to this sector',
      metricCritical: 'Critical',
      metricCriticalSub: 'Highest-severity pressure',
      metricHigh: 'High',
      metricHighSub: 'Active campaign overlap',
      metricMediumLow: 'Medium / Low',
      metricMediumLowSub: 'Broader background activity',
      topThreatTypes: 'Top Threat Types',
      noThreatTaxonomy: 'No recent threat taxonomy available for this sector.',
      topOrigins: 'Top Origins',
      noGeoSignal: 'No geographic origin signal is available yet.',
      severityTrend: 'Severity Trend',
      recentEventCadence: 'Recent event cadence for this sector',
      recentEvents: 'Recent Events',
      matchedEvents: (count) => `${count} matched events`,
      unknownOrigin: 'Unknown origin',
      unknownActor: 'Unknown actor',
      unknown: 'Unknown',
      noRecentEvents: 'No recent events are mapped to this sector for the selected period.',
      viewAllEventsFor: (sector) => `View All Events for ${sector} →`,
      campaignPressure: 'Campaign Pressure',
      linked: (count) => `${count} linked`,
      noCampaignsTargetSector: 'No campaigns explicitly target this sector.',
      attributionLane: 'Attribution Lane',
      actorsCount: (count) => `${count} actors`,
      noAttributedActors: 'No attributed actors for this sector yet.',
    },
    geo: {
      title: 'Geographic Threat Analysis',
      description:
        'Review country-level threat pressure, investigate hotspots, and pivot directly into country-scoped CTI events.',
      kpiCountriesObserved: 'Countries Observed',
      coverageWindow: (period) => `${period} coverage window`,
      kpiHotspotEvents: 'Hotspot Events',
      aggregatedFromGeo: 'Aggregated from geo summaries',
      kpiTopOrigin: 'Top Origin',
      eventsCount: (count) => `${count} events`,
      noCountrySelected: 'No country selected',
      kpiAvgPressure: 'Avg Pressure',
      eventsPerCountry: 'Events per active country',
      loadFailed: 'Failed to load geographic CTI analysis.',
      countryRankings: 'Country Rankings',
      colRank: 'Rank',
      colCountry: 'Country',
      colEvents: 'Events',
      colCritical: 'Critical',
      colHigh: 'High',
      colTrend: 'Trend',
      noCountryData: 'No country-level hotspot data is available for this period.',
      countryDetail: 'Country Detail',
      metricTotalEvents: 'Total Events',
      metricCritical: 'Critical',
      metricActiveCampaigns: 'Active Campaigns',
      topThreatTypes: 'Top Threat Types',
      noThreatBreakdown: 'No threat-type breakdown available.',
      topTargetedSectors: 'Top Targeted Sectors',
      noSectorTargeting: 'No sector targeting metadata available.',
      activeActors: 'Active Actors',
      noActiveActors: 'No active actors attributed to this country.',
      activeCampaigns: 'Active Campaigns',
      noActiveCampaigns: 'No active campaigns mapped to actors from this country.',
      recentEvents: 'Recent Events',
      unknownCity: 'Unknown city',
      noRecentEvents: 'No recent events found for this country.',
      viewAllEventsFrom: (country) => `View All Events from ${country} →`,
      selectCountry: 'Select a country to inspect hotspot composition and attributed CTI activity.',
      unknown: 'Unknown',
      unknownActor: 'Unknown actor',
    },
    campaignDetail: {
      updateStatus: 'Update Status',
      moveTo: (status) => `Move to ${status}`,
      linkEvent: 'Link Event',
      addIoc: 'Add IOC',
      edit: 'Edit',
      delete: 'Delete',
      kpiIocCount: 'IOC Count',
      kpiIocCountSub: 'Tracked indicators',
      kpiEventCount: 'Event Count',
      kpiEventCountSub: 'Linked observations',
      kpiDuration: 'Duration',
      kpiDurationSub: 'Days active',
      tabOverview: 'Overview',
      tabIocs: (count) => `IOCs (${count})`,
      tabEvents: (count) => `Events (${count})`,
      tabTimeline: 'Timeline',
      campaignOverview: 'Campaign Overview',
      firstSeen: 'First Seen',
      lastSeen: 'Last Seen',
      status: 'Status',
      severity: 'Severity',
      description: 'Description',
      noDescription: 'No detailed campaign description captured yet.',
      targetingNotes: 'Targeting Notes',
      noTargeting: 'No targeting narrative captured.',
      threatActor: 'Threat Actor',
      primaryActorNarrative: 'Primary actor attribution for this campaign.',
      viewActorProfile: 'View Actor Profile →',
      noPrimaryActor: 'No primary actor assigned.',
      targetSectors: 'Target Sectors',
      noTargetSectors: 'No target sectors recorded.',
      targetRegions: 'Target Regions',
      noTargetRegions: 'No target regions recorded.',
      ttpCoverage: 'TTP Coverage',
      noTtpSummary: 'No TTP summary recorded.',
      campaignIndicators: 'Campaign Indicators',
      noCampaignIocs: 'No campaign IOCs added yet.',
      linkedThreatEvents: 'Linked Threat Events',
      noEventMetadata: 'No IOC or target metadata',
      unlink: 'Unlink',
      noEventsLinked: 'No threat events linked yet.',
      campaignTimeline: 'Campaign Timeline',
      noTimeline: 'No timeline activity recorded for this campaign.',
      confidence: (score) => `Confidence ${score}`,
      lastSeenRelative: (when) => `Last seen ${when}`,
      remove: 'Remove',
      results0: '0 results',
      rangeOf: (start, end, total) => `${start}-${end} of ${total}`,
      previous: 'Previous',
      next: 'Next',
      addCampaignIocTitle: 'Add Campaign IOC',
      addCampaignIocDescription:
        'Attach a new indicator of compromise to this campaign and surface it in campaign pivots.',
      iocType: 'IOC Type',
      confidencePct: 'Confidence %',
      iocValue: 'IOC Value',
      sourceName: 'Source Name',
      cancel: 'Cancel',
      savingDots: 'Saving...',
      addIocBtn: 'Add IOC',
      timelineCampaignCreated: 'Campaign Created',
      timelineCampaignCreatedDesc: (name) => `${name} was added to CTI tracking.`,
      timelineFirstSeen: 'First Seen',
      timelineFirstSeenDesc: 'Initial campaign observation recorded.',
      timelineLastActivity: 'Last Activity',
      timelineLastActivityDesc: 'Most recent campaign activity observed.',
      timelineIocAdded: 'IOC Added',
      timelineEventLinked: 'Threat Event Linked',
      timelineResolved: 'Campaign Resolved',
      timelineResolvedDesc: 'Campaign status moved to resolved.',
      linkDialogTitle: 'Link Threat Events',
      linkDialogDescription:
        'Search the live CTI event stream and attach relevant observations to this campaign.',
      linkSearchPlaceholder: 'Search threat events by title, IOC, or target',
      deleteTitle: 'Delete campaign',
      deleteDescription: 'This deletes the campaign record and removes it from the active CTI graph.',
      deleteConfirm: 'Delete Campaign',
      statusUpdated: 'Campaign status updated',
      statusUpdateFailed: 'Failed to update campaign status',
      eventUnlinked: 'Threat event unlinked',
      eventUnlinkFailed: 'Failed to unlink threat event',
      campaignDeleted: 'Campaign deleted',
      campaignDeleteFailed: 'Failed to delete campaign',
      iocRemoved: 'Campaign IOC removed',
      iocRemoveFailed: 'Failed to remove campaign IOC',
      eventLinked: 'Threat event linked to campaign',
      iocAdded: 'Campaign IOC added',
      iocAddFailed: 'Failed to add campaign IOC',
      loadFailed: 'Failed to load campaign',
    },
    actorDetail: {
      active: 'Active',
      inactive: 'Inactive',
      riskLabel: (score) => `Risk ${score}`,
      unknown: 'Unknown',
      deactivate: 'Deactivate',
      activate: 'Activate',
      edit: 'Edit',
      delete: 'Delete',
      tabProfile: 'Profile',
      tabCampaigns: (count) => `Campaigns (${count})`,
      tabTechniques: (count) => `Techniques (${count})`,
      tabIocs: (count) => `IOCs (${count})`,
      kpiActiveCampaigns: 'Active Campaigns',
      kpiActiveCampaignsSub: 'Currently active',
      kpiTotalIocs: 'Total IOCs',
      kpiTotalIocsSub: 'Across linked campaigns',
      kpiObservedSince: 'Observed Since',
      kpiObservedSinceSub: 'Earliest record',
      actorProfile: 'Actor Profile',
      originCountry: 'Origin Country',
      sophistication: 'Sophistication',
      motivation: 'Motivation',
      firstObserved: 'First Observed',
      lastActivity: 'Last Activity',
      mitreGroup: 'MITRE Group',
      aliasesNotes: 'Aliases & Notes',
      noAliases: 'No aliases recorded',
      noNotes: 'No analyst notes recorded for this actor.',
      associatedCampaigns: 'Associated Campaigns',
      noCampaigns: 'No campaigns currently reference this threat actor.',
      observedTechniques: 'Observed Techniques',
      aggregatedIocs: 'Aggregated IOCs',
      confidencePct: (pct) => `${pct}% confidence`,
      noIocs: 'No IOCs are linked through this actor’s campaigns yet.',
      actorStatusUpdateFailed: 'Failed to update actor status',
      actorStatusUpdated: 'Actor status updated',
      actorDeleted: 'Threat actor deleted',
      actorDeleteFailed: 'Failed to delete threat actor',
      loadFailed: 'Failed to load threat actor',
      deleteTitle: 'Delete threat actor',
      deleteDescription: 'This removes the actor profile from CTI views and detaches it from analyst pivots.',
      deleteConfirm: 'Delete Actor',
    },
    eventDetail: {
      threatEventSummary: (idShort, type) => `Threat event ${idShort} • ${type}`,
      firstSeenRelative: (when) => `First seen ${when}`,
      resolve: 'Resolve',
      falsePositive: 'False Positive',
      linkToCampaign: 'Link to Campaign',
      delete: 'Delete',
      eventDetails: 'Event Details',
      confidence: 'Confidence',
      category: 'Category',
      source: 'Source',
      targetSector: 'Target Sector',
      targetOrganization: 'Target Organization',
      origin: 'Origin',
      targetCountry: 'Target Country',
      created: 'Created',
      lastSeen: 'Last Seen',
      unknown: 'Unknown',
      indicatorOrigin: 'Indicator & Origin',
      mitreTechniques: 'MITRE Techniques',
      tags: 'Tags',
      addTagsPlaceholder: 'Add tags, comma separated',
      add: 'Add',
      noTags: 'No tags attached to this event.',
      timeline: 'Timeline',
      relatedCampaigns: 'Related Campaigns',
      noRelatedCampaigns: 'No linked campaigns found for this event.',
      linkDialogTitle: 'Link Event to Campaign',
      linkDialogDescription: 'Choose an existing CTI campaign to associate with this threat event.',
      campaign: 'Campaign',
      selectCampaign: 'Select a campaign',
      cancel: 'Cancel',
      linkCampaign: 'Link Campaign',
      iocCopied: 'IOC copied to clipboard',
      eventResolved: 'Threat event resolved',
      markedFalsePositive: 'Threat event marked as false positive',
      eventDeleted: 'Threat event deleted',
      tagsAdded: 'Tags added',
      tagRemoved: 'Tag removed',
      eventLinked: 'Event linked to campaign',
      idMissing: 'Threat event identifier is missing.',
      loadFailed: 'Failed to load CTI threat event.',
      tlFirstObserved: 'First Observed',
      tlFirstObservedDesc: 'Initial intelligence sighting was recorded.',
      tlIngested: 'Ingested',
      tlIngestedDesc: 'Event entered the CTI platform.',
      tlLastSeen: 'Last Seen',
      tlLastSeenDesc: 'Most recent observation from the source feed.',
      tlFalsePositive: 'Marked False Positive',
      tlFalsePositiveDesc: 'Analyst marked this event as noise.',
      tlResolved: 'Resolved',
      tlResolvedDesc: 'Response workflow completed.',
    },
    brandAbuseDetail: {
      updateStatus: 'Update Status',
      moveTo: (status) => `Move to ${status}`,
      manageBrands: 'Manage Brands',
      edit: 'Edit',
      kpiDetectionCount: 'Detection Count',
      kpiDetectionCountSub: 'Observed detections',
      kpiTakedownStatus: 'Takedown Status',
      kpiTakedownStatusSub: 'Current lifecycle stage',
      kpiDaysActive: 'Days Active',
      kpiDaysActiveSub: 'Time since first sighting',
      requestTakedown: 'Request Takedown',
      markTakenDown: 'Mark Taken Down',
      markFalsePositive: 'Mark False Positive',
      relatedEvents: 'Related Events →',
      incidentDetails: 'Incident Details',
      abuseType: 'Abuse Type',
      region: 'Region',
      hostingIp: 'Hosting IP',
      hostingAsn: 'Hosting ASN',
      whoisRegistrant: 'WHOIS Registrant',
      whoisCreated: 'WHOIS Created',
      sslIssuer: 'SSL Issuer',
      firstDetected: 'First Detected',
      lastDetected: 'Last Detected',
      monitoredBrandContext: 'Monitored Brand Context',
      brand: 'Brand',
      domainPattern: 'Domain Pattern',
      keywords: 'Keywords',
      noKeywords: 'No keywords configured',
      takedownStatusUpdated: 'Takedown status updated',
      takedownStatusUpdateFailed: 'Failed to update takedown status',
      loadFailed: 'Failed to load brand abuse incident',
    },
    enumLabels: {
      actorType: {
        state_sponsored: 'State Sponsored',
        cybercriminal: 'Cybercriminal',
        hacktivist: 'Hacktivist',
        insider: 'Insider',
        unknown: 'Unknown',
      },
      sophistication: {
        advanced: 'Advanced',
        intermediate: 'Intermediate',
        basic: 'Basic',
      },
      motivation: {
        espionage: 'Espionage',
        financial_gain: 'Financial Gain',
        disruption: 'Disruption',
        ideological: 'Ideological',
        unknown: 'Unknown',
      },
    },
  },
  ar: {
    dashboard: {
      title: 'استخبارات التهديدات السيبرانية',
      description: 'مركز قيادة استخبارات التهديدات السيبرانية',
      ws: (status) => `WS ${status}`,
      wsStatuses: {
        idle: 'خامل',
        connecting: 'قيد الاتصال',
        connected: 'متصل',
        error: 'خطأ',
        closed: 'مغلق',
      },
      refresh: 'تحديث',
      kpiEvents24h: 'الأحداث (٢٤ ساعة)',
      kpiEvents7d: (count) => `${count} خلال ٧ أيام`,
      kpiActiveCampaigns: 'الحملات النشطة',
      kpiCriticalCount: (count) => `${count} حرج`,
      kpiTotalIocs: 'إجمالي مؤشرات الاختراق',
      kpiTopSector: (sector) => `أبرز قطاع: ${sector}`,
      kpiBrandAbuse: 'تنبيهات انتهاك العلامة',
      liveEventFeed: 'بث الأحداث الحي',
      activeCampaigns: 'الحملات النشطة',
      viewAll: 'عرض الكل ←',
      colCampaign: 'الحملة',
      colStatus: 'الحالة',
      colActor: 'جهة التهديد',
      colIocs: 'مؤشرات الاختراق',
      colEvents: 'الأحداث',
      unknownActor: 'جهة تهديد غير معروفة',
      noCampaigns: 'لا توجد حملات متاحة.',
      criticalBrandAbuse: 'تنبيهات انتهاك العلامة الحرجة',
      unknownRegion: 'منطقة غير معروفة',
      detections: (count) => `${count} عملية كشف`,
      noBrandAbuse: 'لا توجد حوادث انتهاك علامة نشطة.',
      topTargetedSectors: 'أكثر القطاعات استهدافًا',
      eventsIn: (count, period) => `${count} حدث خلال ${period}`,
      noSectorAnalytics: 'لا توجد تحليلات قطاعية متاحة.',
      executiveRiskPosture: 'الوضع الأمني التنفيذي للمخاطر',
      topOrigin: 'أبرز مصدر',
      topSector: 'أبرز قطاع',
      refreshWindow: 'نافذة التحديث',
      unavailable: 'غير متاح',
      loadFailed: 'تعذّر تحميل لوحة الاستخبارات.',
    },
    campaigns: {
      title: 'الحملات النشطة',
      description: 'تتبّع حملات الهجمات السيبرانية الجارية وحلّل ملفاتها.',
      newCampaign: 'حملة جديدة',
      statusActive: 'نشطة',
      statusMonitoring: 'قيد المراقبة',
      statusDormant: 'خاملة',
      statusResolved: 'محلولة',
      statusArchived: 'مؤرشفة',
      subtitleCampaigns: 'الحملات',
      filterStatus: 'الحالة',
      filterSeverity: 'الخطورة',
      filterActor: 'جهة التهديد',
      sevCritical: 'حرج',
      sevHigh: 'عالٍ',
      sevMedium: 'متوسط',
      sevLow: 'منخفض',
      sevInformational: 'معلوماتي',
      viewCampaign: 'عرض الحملة',
      editCampaign: 'تعديل الحملة',
      moveToMonitoring: 'النقل إلى المراقبة',
      resolveCampaign: 'حل الحملة',
      deleteCampaign: 'حذف الحملة',
      setMonitoring: 'تعيين قيد المراقبة',
      resolveSelected: 'حل المحدد',
      deleteSelected: 'حذف المحدد',
      colCode: 'الرمز',
      colCampaign: 'الحملة',
      colActor: 'جهة التهديد',
      colStatus: 'الحالة',
      colSeverity: 'الخطورة',
      colTargets: 'الأهداف',
      colIocs: 'مؤشرات الاختراق',
      colEvents: 'الأحداث',
      colLastSeen: 'آخر ظهور',
      noNarrative: 'لا يوجد سرد للمحلل',
      unassigned: 'غير مُسند',
      noTargets: 'لم تُسجَّل أهداف القطاع والمنطقة',
      searchPlaceholder: 'ابحث في الحملات بالاسم أو الرمز أو جهة التهديد…',
      emptyTitle: 'لا توجد حملات',
      emptyDescription: 'ستظهر الحملات هنا عند ربط بيانات الاستخبارات وتجميعها.',
      createCampaign: 'إنشاء حملة',
      deleteTitle: 'حذف الحملة',
      deleteDescription: 'يؤدي ذلك إلى إزالة سجل الحملة نهائيًا من عروض الاستخبارات.',
      deleteConfirm: 'حذف الحملة',
      statusUpdateFailed: 'تعذّر تحديث حالة الحملة',
      moved: (count, status) => `تم نقل ${count} حملة إلى ${status}`,
      deleteFailed: 'تعذّر حذف الحملة',
      deleted: (count) => `تم حذف ${count} حملة`,
    },
    actors: {
      title: 'ملفات جهات التهديد',
      description: 'راقب ملفات جهات التهديد ودوافعها وإسناد الحملات.',
      newActor: 'جهة تهديد جديدة',
      filterActorType: 'نوع جهة التهديد',
      filterSophistication: 'مستوى التطور',
      filterActive: 'نشط',
      typeStateSponsored: 'مدعومة من دولة',
      typeCybercriminal: 'مجرم سيبراني',
      typeHacktivist: 'ناشط قرصنة',
      typeInsider: 'داخلي',
      typeUnknown: 'غير معروف',
      sophAdvanced: 'متقدم',
      sophIntermediate: 'متوسط',
      sophBasic: 'أساسي',
      active: 'نشط',
      inactive: 'غير نشط',
      viewActor: 'عرض جهة التهديد',
      editActor: 'تعديل جهة التهديد',
      toggleActive: 'تبديل النشاط',
      deleteActor: 'حذف جهة التهديد',
      activateSelected: 'تنشيط المحدد',
      deactivateSelected: 'إلغاء تنشيط المحدد',
      deleteSelected: 'حذف المحدد',
      colActor: 'جهة التهديد',
      colType: 'النوع',
      colOrigin: 'المصدر',
      colSophistication: 'مستوى التطور',
      colMotivation: 'الدافع',
      colRisk: 'المخاطر',
      colStatus: 'الحالة',
      colLastActivity: 'آخر نشاط',
      noAliases: 'لا توجد أسماء بديلة',
      unknown: 'غير معروف',
      searchPlaceholder: 'ابحث في جهات التهديد بالاسم أو الاسم البديل أو مجموعة MITRE…',
      emptyTitle: 'لا توجد جهات تهديد',
      emptyDescription: 'ستظهر ملفات جهات التهديد هنا عند تنسيق سجلات الاستخبارات.',
      createActor: 'إنشاء جهة تهديد',
      deleteTitle: 'حذف جهة التهديد',
      deleteDescription: 'يؤدي ذلك إلى إزالة ملف جهة التهديد من عروض الاستخبارات.',
      deleteConfirm: 'حذف جهة التهديد',
      statusUpdateFailed: 'تعذّر تحديث حالة جهة التهديد',
      updated: (count) => `تم تحديث ${count} جهة تهديد`,
      deleteFailed: 'تعذّر حذف جهة التهديد',
      deleted: (count) => `تم حذف ${count} جهة تهديد`,
    },
    events: {
      title: 'أحداث الاستخبارات التهديدية',
      description: 'تصفّح أحداث استخبارات التهديدات السيبرانية المرصودة وصفّها وحقّق فيها.',
      colSeverity: 'الخطورة',
      colTitle: 'العنوان',
      colEventType: 'نوع الحدث',
      colOrigin: 'المصدر',
      colTargetSector: 'القطاع المستهدف',
      colConfidence: 'الثقة',
      colFirstSeen: 'أول ظهور',
      new: 'جديد',
      noContext: 'لا يوجد سياق إضافي',
      unknown: 'غير معروف',
      viewDetail: 'عرض التفاصيل',
      resolve: 'حل',
      markFalsePositive: 'وسم كإنذار كاذب',
      delete: 'حذف',
      resolveSelected: 'حل المحدد',
      eventResolved: 'تم حل حدث التهديد',
      resolveFailed: 'تعذّر حل حدث التهديد',
      markedFalsePositive: 'تم وسم حدث التهديد كإنذار كاذب',
      updateFailed: 'تعذّر تحديث حدث التهديد',
      deleted: 'تم حذف حدث التهديد',
      deleteFailed: 'تعذّر حذف حدث التهديد',
      eventsResolved: (count) => `تم حل ${count} حدث`,
      eventsUpdated: (count) => `تم تحديث ${count} حدث`,
      searchPlaceholder: 'ابحث في الأحداث بالعنوان أو مؤشر الاختراق أو مرجع المصدر…',
      emptyTitle: 'لا توجد أحداث تهديد',
      emptyDescription: 'عدّل عوامل التصفية الحالية أو انتظر وصول أحداث استخبارات جديدة.',
    },
    brandAbuse: {
      title: 'مراقبة انتهاك العلامة التجارية',
      description:
        'تتبّع النطاقات الخبيثة وتقدّم عمليات الإزالة وكتالوج العلامات المراقَبة الذي يغذّي تقارير الاستخبارات التنفيذية.',
      manageBrands: 'إدارة العلامات',
      newIncident: 'حادث جديد',
      filterBrand: 'العلامة',
      filterRisk: 'المخاطر',
      filterTakedown: 'الإزالة',
      filterAbuseType: 'نوع الانتهاك',
      filterAbuseTypePlaceholder: 'تصفية حسب نوع الانتهاك',
      markReported: 'وسم كمُبلَّغ',
      requestTakedown: 'طلب الإزالة',
      markTakenDown: 'وسم كمُزال',
      setMonitoring: 'تعيين قيد المراقبة',
      markFalsePositive: 'وسم كإنذار كاذب',
      viewIncident: 'عرض الحادث',
      editIncident: 'تعديل الحادث',
      colBrand: 'العلامة',
      colDomain: 'النطاق',
      colRisk: 'المخاطر',
      colTakedown: 'الإزالة',
      colDetections: 'عمليات الكشف',
      colLastDetected: 'آخر كشف',
      kpiMonitoredBrands: 'العلامات المراقَبة',
      kpiMonitoredBrandsSub: 'العلامات المحمية',
      kpiCriticalAlerts: 'التنبيهات الحرجة',
      kpiCriticalAlertsSub: 'إجراء فوري',
      kpiTotalIncidents: 'إجمالي الحوادث',
      kpiTotalIncidentsSub: 'حالات الانتهاك المتتبَّعة',
      kpiPendingTakedowns: 'عمليات الإزالة المعلّقة',
      kpiPendingTakedownsSub: 'مُبلَّغ عنها أو مطلوبة',
      kpiTakenDown: 'تمت إزالتها',
      kpiTakenDownSub: 'الحوادث المعالَجة',
      searchPlaceholder: 'ابحث في الحوادث حسب العلامة أو النطاق الخبيث',
      emptyTitle: 'لا توجد حوادث انتهاك علامة',
      emptyDescription: 'لا توجد حوادث مطابقة لعوامل التصفية الحالية.',
      createIncident: 'إنشاء حادث',
      moved: (count, status) => `تم نقل ${count} حادث إلى ${status}`,
      updateFailed: 'تعذّر تحديث حالة الإزالة',
    },
    sectors: {
      title: 'الاستهداف القطاعي والجغرافي',
      description: 'افهم كيفية توزّع التهديدات عبر الصناعات وانتقل إلى تحقيقات استخباراتية أعمق.',
      kpiImpactedSectors: 'القطاعات المتأثرة',
      reportingWindow: (period) => `نافذة تقارير ${period}`,
      kpiTotalSectorEvents: 'إجمالي أحداث القطاعات',
      aggregatedAcrossAll: 'مُجمَّعة عبر جميع القطاعات',
      kpiCriticalEvents: 'الأحداث الحرجة',
      criticalSeverityPressure: 'ضغط الخطورة الحرجة',
      failedToLoad: 'تعذّر تحميل نظرة التهديدات القطاعية',
      lensBadge: 'عدسة الاستخبارات القطاعية',
      lensHeadline: 'ركّز على الصناعات التي تحمل أعلى ضغط تهديدي.',
      lensBody:
        'يقوم المُحدِّد أدناه الآن بتطبيع لقطات التجميع المتكررة إلى مجموعة نظيفة من عدسات القطاعات لتتمكن من الانتقال بسرعة دون أن تتحول الصفحة إلى ضوضاء.',
      uniqueSectors: (count) => `${count} قطاع فريد`,
      summaryPoints: (count) => `تم تحليل ${count} نقطة ملخّص`,
      sectorHoldsPressure: (sector, pct) => `${sector} يحمل ${pct}% من الضغط`,
      primaryFocus: 'التركيز الأساسي',
      none: 'لا شيء',
      selectSector: 'اختر قطاعًا',
      eventsCount: (count) => `${count} حدث`,
      snapshotFreshness: 'حداثة اللقطة',
      live: 'حي',
      latestAggregation: 'أحدث تجميع للقطاع',
      criticalMix: 'المزيج الحرج',
      ofDisplayedEvents: 'من جميع أحداث القطاعات المعروضة',
      navigatorTitle: 'مستكشف القطاعات',
      navigatorBody: 'عرض أكثر إحكامًا لأعلى القطاعات ضغطًا. مرّر أفقيًا لتغيير الغوص المعمّق.',
      selected: 'المحدد',
      eventsSuffix: (count) => `${count} حدث`,
      deepDive: 'غوص معمّق',
      latestAggregationRelative: (when) => `أحدث تجميع ${when}`,
      sectorShare: 'حصة القطاع',
      ofDisplayedActivity: 'من نشاط القطاعات المعروض',
      metricTotal: 'الإجمالي',
      metricTotalSub: 'الأحداث المنسوبة إلى هذا القطاع',
      metricCritical: 'حرج',
      metricCriticalSub: 'ضغط أعلى خطورة',
      metricHigh: 'عالٍ',
      metricHighSub: 'تداخل الحملات النشطة',
      metricMediumLow: 'متوسط / منخفض',
      metricMediumLowSub: 'نشاط خلفي أوسع',
      topThreatTypes: 'أبرز أنواع التهديدات',
      noThreatTaxonomy: 'لا يوجد تصنيف تهديدات حديث متاح لهذا القطاع.',
      topOrigins: 'أبرز المصادر',
      noGeoSignal: 'لا تتوفر إشارة مصدر جغرافي بعد.',
      severityTrend: 'اتجاه الخطورة',
      recentEventCadence: 'وتيرة الأحداث الأخيرة لهذا القطاع',
      recentEvents: 'الأحداث الأخيرة',
      matchedEvents: (count) => `${count} حدث مطابق`,
      unknownOrigin: 'مصدر غير معروف',
      unknownActor: 'جهة تهديد غير معروفة',
      unknown: 'غير معروف',
      noRecentEvents: 'لا توجد أحداث حديثة مرتبطة بهذا القطاع للفترة المحددة.',
      viewAllEventsFor: (sector) => `عرض جميع أحداث ${sector} ←`,
      campaignPressure: 'ضغط الحملات',
      linked: (count) => `${count} مرتبط`,
      noCampaignsTargetSector: 'لا توجد حملات تستهدف هذا القطاع صراحةً.',
      attributionLane: 'مسار الإسناد',
      actorsCount: (count) => `${count} جهة تهديد`,
      noAttributedActors: 'لا توجد جهات تهديد منسوبة لهذا القطاع بعد.',
    },
    geo: {
      title: 'التحليل الجغرافي للتهديدات',
      description:
        'راجع ضغط التهديدات على مستوى الدول، وحقّق في البؤر الساخنة، وانتقل مباشرةً إلى أحداث الاستخبارات المحصورة بالدولة.',
      kpiCountriesObserved: 'الدول المرصودة',
      coverageWindow: (period) => `نافذة تغطية ${period}`,
      kpiHotspotEvents: 'أحداث البؤر الساخنة',
      aggregatedFromGeo: 'مُجمَّعة من ملخّصات جغرافية',
      kpiTopOrigin: 'أبرز مصدر',
      eventsCount: (count) => `${count} حدث`,
      noCountrySelected: 'لم تُحدَّد دولة',
      kpiAvgPressure: 'متوسط الضغط',
      eventsPerCountry: 'الأحداث لكل دولة نشطة',
      loadFailed: 'تعذّر تحميل التحليل الجغرافي للاستخبارات.',
      countryRankings: 'تصنيفات الدول',
      colRank: 'الترتيب',
      colCountry: 'الدولة',
      colEvents: 'الأحداث',
      colCritical: 'حرج',
      colHigh: 'عالٍ',
      colTrend: 'الاتجاه',
      noCountryData: 'لا تتوفر بيانات بؤر ساخنة على مستوى الدول لهذه الفترة.',
      countryDetail: 'تفاصيل الدولة',
      metricTotalEvents: 'إجمالي الأحداث',
      metricCritical: 'حرج',
      metricActiveCampaigns: 'الحملات النشطة',
      topThreatTypes: 'أبرز أنواع التهديدات',
      noThreatBreakdown: 'لا يتوفر تفصيل لأنواع التهديدات.',
      topTargetedSectors: 'أكثر القطاعات استهدافًا',
      noSectorTargeting: 'لا تتوفر بيانات استهداف قطاعي.',
      activeActors: 'جهات التهديد النشطة',
      noActiveActors: 'لا توجد جهات تهديد نشطة منسوبة لهذه الدولة.',
      activeCampaigns: 'الحملات النشطة',
      noActiveCampaigns: 'لا توجد حملات نشطة مرتبطة بجهات تهديد من هذه الدولة.',
      recentEvents: 'الأحداث الأخيرة',
      unknownCity: 'مدينة غير معروفة',
      noRecentEvents: 'لا توجد أحداث حديثة لهذه الدولة.',
      viewAllEventsFrom: (country) => `عرض جميع الأحداث من ${country} ←`,
      selectCountry: 'اختر دولة لفحص تكوين البؤر الساخنة ونشاط الاستخبارات المنسوب.',
      unknown: 'غير معروف',
      unknownActor: 'جهة تهديد غير معروفة',
    },
    campaignDetail: {
      updateStatus: 'تحديث الحالة',
      moveTo: (status) => `الانتقال إلى ${status}`,
      linkEvent: 'ربط حدث',
      addIoc: 'إضافة مؤشر اختراق',
      edit: 'تعديل',
      delete: 'حذف',
      kpiIocCount: 'عدد مؤشرات الاختراق',
      kpiIocCountSub: 'المؤشرات المتتبَّعة',
      kpiEventCount: 'عدد الأحداث',
      kpiEventCountSub: 'الملاحظات المرتبطة',
      kpiDuration: 'المدة',
      kpiDurationSub: 'أيام النشاط',
      tabOverview: 'نظرة عامة',
      tabIocs: (count) => `مؤشرات الاختراق (${count})`,
      tabEvents: (count) => `الأحداث (${count})`,
      tabTimeline: 'الخط الزمني',
      campaignOverview: 'نظرة عامة على الحملة',
      firstSeen: 'أول ظهور',
      lastSeen: 'آخر ظهور',
      status: 'الحالة',
      severity: 'الخطورة',
      description: 'الوصف',
      noDescription: 'لم يُسجَّل وصف تفصيلي للحملة بعد.',
      targetingNotes: 'ملاحظات الاستهداف',
      noTargeting: 'لم يُسجَّل سرد للاستهداف.',
      threatActor: 'جهة التهديد',
      primaryActorNarrative: 'إسناد جهة التهديد الأساسية لهذه الحملة.',
      viewActorProfile: 'عرض ملف جهة التهديد ←',
      noPrimaryActor: 'لم تُسند جهة تهديد أساسية.',
      targetSectors: 'القطاعات المستهدفة',
      noTargetSectors: 'لم تُسجَّل قطاعات مستهدفة.',
      targetRegions: 'المناطق المستهدفة',
      noTargetRegions: 'لم تُسجَّل مناطق مستهدفة.',
      ttpCoverage: 'تغطية التكتيكات والتقنيات والإجراءات',
      noTtpSummary: 'لم يُسجَّل ملخّص للتكتيكات والتقنيات والإجراءات.',
      campaignIndicators: 'مؤشرات الحملة',
      noCampaignIocs: 'لم تُضَف مؤشرات اختراق للحملة بعد.',
      linkedThreatEvents: 'أحداث التهديد المرتبطة',
      noEventMetadata: 'لا توجد بيانات مؤشر اختراق أو هدف',
      unlink: 'إلغاء الربط',
      noEventsLinked: 'لم تُربط أي أحداث تهديد بعد.',
      campaignTimeline: 'الخط الزمني للحملة',
      noTimeline: 'لم يُسجَّل أي نشاط زمني لهذه الحملة.',
      confidence: (score) => `الثقة ${score}`,
      lastSeenRelative: (when) => `آخر ظهور ${when}`,
      remove: 'إزالة',
      results0: '٠ نتيجة',
      rangeOf: (start, end, total) => `${start}-${end} من ${total}`,
      previous: 'السابق',
      next: 'التالي',
      addCampaignIocTitle: 'إضافة مؤشر اختراق للحملة',
      addCampaignIocDescription: 'أرفق مؤشر اختراق جديدًا بهذه الحملة وأظهره في تحويلات الحملة.',
      iocType: 'نوع مؤشر الاختراق',
      confidencePct: 'الثقة %',
      iocValue: 'قيمة مؤشر الاختراق',
      sourceName: 'اسم المصدر',
      cancel: 'إلغاء',
      savingDots: 'جارٍ الحفظ...',
      addIocBtn: 'إضافة مؤشر اختراق',
      timelineCampaignCreated: 'تم إنشاء الحملة',
      timelineCampaignCreatedDesc: (name) => `تمت إضافة ${name} إلى تتبّع الاستخبارات.`,
      timelineFirstSeen: 'أول ظهور',
      timelineFirstSeenDesc: 'تم تسجيل أول رصد للحملة.',
      timelineLastActivity: 'آخر نشاط',
      timelineLastActivityDesc: 'تم رصد أحدث نشاط للحملة.',
      timelineIocAdded: 'تمت إضافة مؤشر اختراق',
      timelineEventLinked: 'تم ربط حدث تهديد',
      timelineResolved: 'تم حل الحملة',
      timelineResolvedDesc: 'انتقلت حالة الحملة إلى محلولة.',
      linkDialogTitle: 'ربط أحداث التهديد',
      linkDialogDescription: 'ابحث في بث أحداث الاستخبارات الحي وأرفق الملاحظات ذات الصلة بهذه الحملة.',
      linkSearchPlaceholder: 'ابحث في أحداث التهديد بالعنوان أو مؤشر الاختراق أو الهدف',
      deleteTitle: 'حذف الحملة',
      deleteDescription: 'يؤدي ذلك إلى حذف سجل الحملة وإزالته من رسم الاستخبارات النشط.',
      deleteConfirm: 'حذف الحملة',
      statusUpdated: 'تم تحديث حالة الحملة',
      statusUpdateFailed: 'تعذّر تحديث حالة الحملة',
      eventUnlinked: 'تم إلغاء ربط حدث التهديد',
      eventUnlinkFailed: 'تعذّر إلغاء ربط حدث التهديد',
      campaignDeleted: 'تم حذف الحملة',
      campaignDeleteFailed: 'تعذّر حذف الحملة',
      iocRemoved: 'تمت إزالة مؤشر اختراق الحملة',
      iocRemoveFailed: 'تعذّرت إزالة مؤشر اختراق الحملة',
      eventLinked: 'تم ربط حدث التهديد بالحملة',
      iocAdded: 'تمت إضافة مؤشر اختراق الحملة',
      iocAddFailed: 'تعذّرت إضافة مؤشر اختراق الحملة',
      loadFailed: 'تعذّر تحميل الحملة',
    },
    actorDetail: {
      active: 'نشط',
      inactive: 'غير نشط',
      riskLabel: (score) => `المخاطر ${score}`,
      unknown: 'غير معروف',
      deactivate: 'إلغاء التنشيط',
      activate: 'تنشيط',
      edit: 'تعديل',
      delete: 'حذف',
      tabProfile: 'الملف',
      tabCampaigns: (count) => `الحملات (${count})`,
      tabTechniques: (count) => `الأساليب (${count})`,
      tabIocs: (count) => `مؤشرات الاختراق (${count})`,
      kpiActiveCampaigns: 'الحملات النشطة',
      kpiActiveCampaignsSub: 'نشطة حاليًا',
      kpiTotalIocs: 'إجمالي مؤشرات الاختراق',
      kpiTotalIocsSub: 'عبر الحملات المرتبطة',
      kpiObservedSince: 'مرصودة منذ',
      kpiObservedSinceSub: 'أقدم سجل',
      actorProfile: 'ملف جهة التهديد',
      originCountry: 'دولة المنشأ',
      sophistication: 'مستوى التطور',
      motivation: 'الدافع',
      firstObserved: 'أول رصد',
      lastActivity: 'آخر نشاط',
      mitreGroup: 'مجموعة MITRE',
      aliasesNotes: 'الأسماء البديلة والملاحظات',
      noAliases: 'لا توجد أسماء بديلة مسجَّلة',
      noNotes: 'لا توجد ملاحظات محلل مسجَّلة لجهة التهديد هذه.',
      associatedCampaigns: 'الحملات المرتبطة',
      noCampaigns: 'لا توجد حملات تشير حاليًا إلى جهة التهديد هذه.',
      observedTechniques: 'الأساليب المرصودة',
      aggregatedIocs: 'مؤشرات الاختراق المجمَّعة',
      confidencePct: (pct) => `${pct}% ثقة`,
      noIocs: 'لا توجد مؤشرات اختراق مرتبطة عبر حملات جهة التهديد هذه بعد.',
      actorStatusUpdateFailed: 'تعذّر تحديث حالة جهة التهديد',
      actorStatusUpdated: 'تم تحديث حالة جهة التهديد',
      actorDeleted: 'تم حذف جهة التهديد',
      actorDeleteFailed: 'تعذّر حذف جهة التهديد',
      loadFailed: 'تعذّر تحميل جهة التهديد',
      deleteTitle: 'حذف جهة التهديد',
      deleteDescription: 'يؤدي ذلك إلى إزالة ملف جهة التهديد من عروض الاستخبارات وفصله عن تحويلات المحلل.',
      deleteConfirm: 'حذف جهة التهديد',
    },
    eventDetail: {
      threatEventSummary: (idShort, type) => `حدث تهديد ${idShort} • ${type}`,
      firstSeenRelative: (when) => `أول ظهور ${when}`,
      resolve: 'حل',
      falsePositive: 'إنذار كاذب',
      linkToCampaign: 'الربط بحملة',
      delete: 'حذف',
      eventDetails: 'تفاصيل الحدث',
      confidence: 'الثقة',
      category: 'الفئة',
      source: 'المصدر',
      targetSector: 'القطاع المستهدف',
      targetOrganization: 'المنظمة المستهدفة',
      origin: 'المصدر',
      targetCountry: 'الدولة المستهدفة',
      created: 'أُنشئ في',
      lastSeen: 'آخر ظهور',
      unknown: 'غير معروف',
      indicatorOrigin: 'المؤشر والمصدر',
      mitreTechniques: 'أساليب MITRE',
      tags: 'الوسوم',
      addTagsPlaceholder: 'أضف وسومًا مفصولة بفواصل',
      add: 'إضافة',
      noTags: 'لا توجد وسوم مرتبطة بهذا الحدث.',
      timeline: 'الخط الزمني',
      relatedCampaigns: 'الحملات المرتبطة',
      noRelatedCampaigns: 'لا توجد حملات مرتبطة بهذا الحدث.',
      linkDialogTitle: 'ربط الحدث بحملة',
      linkDialogDescription: 'اختر حملة استخبارات موجودة لربطها بحدث التهديد هذا.',
      campaign: 'الحملة',
      selectCampaign: 'اختر حملة',
      cancel: 'إلغاء',
      linkCampaign: 'ربط الحملة',
      iocCopied: 'تم نسخ مؤشر الاختراق إلى الحافظة',
      eventResolved: 'تم حل حدث التهديد',
      markedFalsePositive: 'تم وسم حدث التهديد كإنذار كاذب',
      eventDeleted: 'تم حذف حدث التهديد',
      tagsAdded: 'تمت إضافة الوسوم',
      tagRemoved: 'تمت إزالة الوسم',
      eventLinked: 'تم ربط الحدث بالحملة',
      idMissing: 'مُعرّف حدث التهديد مفقود.',
      loadFailed: 'تعذّر تحميل حدث الاستخبارات التهديدية.',
      tlFirstObserved: 'أول رصد',
      tlFirstObservedDesc: 'تم تسجيل أول مشاهدة استخباراتية.',
      tlIngested: 'تم الاستيعاب',
      tlIngestedDesc: 'دخل الحدث منصة الاستخبارات.',
      tlLastSeen: 'آخر ظهور',
      tlLastSeenDesc: 'أحدث رصد من خلاصة المصدر.',
      tlFalsePositive: 'تم وسمه كإنذار كاذب',
      tlFalsePositiveDesc: 'وسم المحلل هذا الحدث كضوضاء.',
      tlResolved: 'تم الحل',
      tlResolvedDesc: 'اكتمل سير عمل الاستجابة.',
    },
    brandAbuseDetail: {
      updateStatus: 'تحديث الحالة',
      moveTo: (status) => `الانتقال إلى ${status}`,
      manageBrands: 'إدارة العلامات',
      edit: 'تعديل',
      kpiDetectionCount: 'عدد عمليات الكشف',
      kpiDetectionCountSub: 'عمليات الكشف المرصودة',
      kpiTakedownStatus: 'حالة الإزالة',
      kpiTakedownStatusSub: 'المرحلة الحالية من دورة الحياة',
      kpiDaysActive: 'أيام النشاط',
      kpiDaysActiveSub: 'الوقت منذ أول رصد',
      requestTakedown: 'طلب الإزالة',
      markTakenDown: 'وسم كمُزال',
      markFalsePositive: 'وسم كإنذار كاذب',
      relatedEvents: 'الأحداث المرتبطة ←',
      incidentDetails: 'تفاصيل الحادث',
      abuseType: 'نوع الانتهاك',
      region: 'المنطقة',
      hostingIp: 'IP الاستضافة',
      hostingAsn: 'ASN الاستضافة',
      whoisRegistrant: 'مُسجِّل WHOIS',
      whoisCreated: 'تاريخ إنشاء WHOIS',
      sslIssuer: 'مُصدِر SSL',
      firstDetected: 'أول كشف',
      lastDetected: 'آخر كشف',
      monitoredBrandContext: 'سياق العلامة المراقَبة',
      brand: 'العلامة',
      domainPattern: 'نمط النطاق',
      keywords: 'الكلمات المفتاحية',
      noKeywords: 'لم تُهيّأ كلمات مفتاحية',
      takedownStatusUpdated: 'تم تحديث حالة الإزالة',
      takedownStatusUpdateFailed: 'تعذّر تحديث حالة الإزالة',
      loadFailed: 'تعذّر تحميل حادث انتهاك العلامة',
    },
    enumLabels: {
      actorType: {
        state_sponsored: 'مدعومة من دولة',
        cybercriminal: 'مجرم سيبراني',
        hacktivist: 'ناشط قرصنة',
        insider: 'داخلي',
        unknown: 'غير معروف',
      },
      sophistication: {
        advanced: 'متقدم',
        intermediate: 'متوسط',
        basic: 'أساسي',
      },
      motivation: {
        espionage: 'التجسّس',
        financial_gain: 'الكسب المالي',
        disruption: 'التعطيل',
        ideological: 'أيديولوجي',
        unknown: 'غير معروف',
      },
    },
  },
};

export function useCtiLabels(): CtiLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(ctiLabels, locale), [locale]);
}
