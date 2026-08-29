// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the Data suite
 * (`/data`) — منصة البيانات.
 *
 * Follows the established notebooks/lex/cyber i18n contract: every label group is
 * a bilingual bundle `{ en, ar }` (two FULL, same-shaped copies — English in
 * `en`, professional MSA in `ar`). Components call {@link useDataLabels} and read
 * the resolved `T`; resolution defaults to English when no LocaleProvider is
 * mounted (`useBilingual` rides `useLocaleOrDefault`), so isolated unit tests
 * keep the English surface.
 *
 * Technical terminology: مصادر البيانات (data sources), جودة البيانات (data
 * quality), خطوط المعالجة (pipelines), النماذج (models), التسلسل/سلسلة النسب
 * (lineage), التناقضات (contradictions), البيانات المظلمة (dark data).
 *
 * The bundle is also registered into the unified namespace registry as `data`,
 * so string leaves resolve through `useT('data')`.
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

export type DataBilingual<T> = { readonly en: T; readonly ar: T };

/** Keys of `T` whose value is a plain string leaf (excludes label factories). */
export type StringKeys<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T];

export function resolveDataBilingual<T>(bundle: DataBilingual<T>, locale: AppLocale): T {
  return resolveBilingualBundle(bundle, locale);
}

export interface DataLabels {
  page: {
    eyebrow: string;
    title: string;
    loadingDescription: string;
    description: string;
    sourcesTag: (count: string) => string;
    activePipelinesTag: (count: string) => string;
    qualityGradeTag: (grade: string) => string;
    openContradictionsTag: (count: string) => string;
    statQuality: string;
    stat30dSuccess: string;
    manageSources: string;
    openPipelines: string;
  };
  kpis: {
    totalSources: string;
    activePipelines: string;
    qualityScore: string;
    openContradictions: string;
    darkDataAssets: string;
    sinceLastPeriod: string;
    failedIn24h: string;
    trend: string;
    perGrade: (grade: string) => string;
    tracked: (count: string) => string;
  };
  charts: {
    pipelineSuccessTitle: string;
    pipelineSuccessDescription: string;
    successRate: (value: string) => string;
    pipelineEmptyTitle: string;
    pipelineEmptyDescription: string;
    qualityTrendTitle: string;
    qualityTrendDescription: string;
    qualityEmptyTitle: string;
    qualityEmptyDescription: string;
    qualityScoreSeries: string;
    successSeries: string;
    failedSeries: string;
    cancelledSeries: string;
    sourcesByStatusTitle: string;
    sourcesByStatusDescription: string;
    refreshing: string;
    liveEvery60s: string;
    noSourceStatusData: string;
    statusActive: string;
    statusInactive: string;
    statusError: string;
    statusSyncing: string;
  };
  recentRuns: {
    title: string;
    description: string;
    viewAll: string;
    emptyTitle: string;
    emptyDescription: string;
    colPipeline: string;
    colStatus: string;
    colDuration: string;
    colCompleted: string;
  };
  qualityIssues: {
    title: string;
    description: string;
    openQuality: string;
    emptyTitle: string;
    emptyDescription: string;
    colModel: string;
    colRule: string;
    colSeverity: string;
    colFailures: string;
  };
  /** Shared connection-form field labels, auth options, and per-connector copy. */
  connForms: {
    host: string;
    port: string;
    database: string;
    schema: string;
    username: string;
    password: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    prefix: string;
    region: string;
    endpoint: string;
    useSsl: string;
    tlsSsl: string;
    authentication: string;
    realm: string;
    kdc: string;
    principal: string;
    keytabPath: string;
    branch: string;
    authNoAuth: string;
    authUsernamePassword: string;
    authKerberos: string;
    authSimple: string;
    authLdap: string;
    sslMode: string;
    sslDisable: string;
    sslAllow: string;
    sslPrefer: string;
    sslRequire: string;
    sslVerifyCa: string;
    sslVerifyFull: string;
    tls: string;
    tlsEnabled: string;
    tlsPreferred: string;
    tlsSkipVerify: string;
    tlsDisabled: string;
    baseUrl: string;
    authType: string;
    authTypeNone: string;
    authTypeBasic: string;
    authTypeBearer: string;
    authTypeApiKey: string;
    authTypeOauth2: string;
    paginationType: string;
    pagOffset: string;
    pagCursor: string;
    pagPage: string;
    pagLinkHeader: string;
    rateLimit: string;
    dataPath: string;
    bearerToken: string;
    keyName: string;
    keyValue: string;
    location: string;
    locHeader: string;
    locQuery: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope: string;
    customHeaders: string;
    addHeader: string;
    noCustomHeaders: string;
    headerName: string;
    headerValue: string;
    protocol: string;
    protocolNative: string;
    protocolHttp: string;
    portHelpClickhouse: string;
    compression: string;
    compressionHelp: string;
    tlsSslEncryptHelp: string;
    uploadFile: string;
    csvUploadHelp: string;
    minioEndpoint: string;
    filePath: string;
    delimiter: string;
    delimComma: string;
    delimTab: string;
    delimSemicolon: string;
    delimPipe: string;
    encoding: string;
    hasHeaderRow: string;
    nameNodes: string;
    nameNodesHelp: string;
    user: string;
    maxFileSizeMb: string;
    basePaths: string;
    basePathsHelp: string;
    auditLogPath: string;
    transportMode: string;
    transportBinary: string;
    httpPath: string;
    tlsSslHiveHelp: string;
    auditLogTable: string;
    tlsSslImpalaHelp: string;
    sqlAccess: string;
    sqlAccessHelp: string;
    thriftHost: string;
    thriftPort: string;
    monitoring: string;
    monitoringHelp: string;
    masterUrl: string;
    historyServerUrl: string;
    tlsSslDoltHelp: string;
    graphqlUrl: string;
    workspace: string;
    apiToken: string;
    timeoutSeconds: string;
    addValue: string;
  };
  /** Generic action/label vocabulary reused across the Data suite. */
  common: {
    save: string;
    cancel: string;
    close: string;
    delete: string;
    edit: string;
    add: string;
    remove: string;
    create: string;
    update: string;
    apply: string;
    reset: string;
    back: string;
    next: string;
    continue: string;
    confirm: string;
    retry: string;
    saving: string;
    loading: string;
    deleting: string;
    running: string;
    refreshing: string;
    search: string;
    viewAll: string;
    view: string;
    status: string;
    actions: string;
    name: string;
    displayName: string;
    description: string;
    type: string;
    enabled: string;
    disabled: string;
    yes: string;
    no: string;
    none: string;
    all: string;
    active: string;
    inactive: string;
    severity: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    passed: string;
    failed: string;
    warning: string;
    error: string;
    success: string;
    pending: string;
    running2: string;
    completed: string;
    cancelled: string;
    runNow: string;
    optional: string;
    required: string;
  };
  quality: {
    noScores: string;
    rulesFailedSummary: (total: string, failed: string) => string;
    qualityScore: string;
    resultTitle: string;
    mStatus: string;
    mChecked: string;
    mFailed: string;
    mDuration: string;
    mCheckedAt: string;
    mPassRate: string;
    deleteRuleTitle: string;
    deleteRuleDesc: (name: string) => string;
    colRule: string;
    colLastStatus: string;
    colLastRun: string;
    neverRun: string;
    editRuleTitle: (name: string) => string;
    createRuleTitle: string;
    fModel: string;
    selectModel: string;
    fRuleType: string;
    rtNotNull: string;
    rtUnique: string;
    rtRange: string;
    rtRegex: string;
    rtReferential: string;
    rtEnum: string;
    rtFreshness: string;
    rtRowCount: string;
    rtCustomSql: string;
    rtStatistical: string;
    fRuleName: string;
    fDescription: string;
    descPlaceholder: string;
    allowedValuesPlaceholder: string;
    tagsPlaceholder: string;
    fColumn: string;
    selectColumn: string;
    ruleConfig: string;
    fMin: string;
    fMax: string;
    fRegexPattern: string;
    fReferenceSource: string;
    selectSource: string;
    fReferenceTable: string;
    fReferenceColumn: string;
    fAllowedValues: string;
    fMaxAge: string;
    fMinRowCount: string;
    fMaxChangePercent: string;
    fSql: string;
    fZScore: string;
    fSchedule: string;
    fTags: string;
    enabledDesc: string;
    saveChanges: string;
    createRule: string;
    overallGrade: string;
    gaugeSummary: (passed: string, failed: string, warnings: string) => string;
    trendEmptyTitle: string;
    trendEmptyDesc: string;
    qualityScoreSeries: string;
    pageEyebrow: string;
    pageTitle: string;
    pageLoadingDesc: string;
    pageDesc: string;
    trendCardTitle: string;
    modelScoresHeading: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDesc: string;
    filterLastStatus: string;
    toastExecuted: string;
    toastExecutedDesc: (name: string, status: string) => string;
    toastEnabled: string;
    toastDisabled: string;
    toastDeleted: string;
    toastUpdated: string;
    toastCreated: string;
    toastGoneTitle: string;
    toastGoneDesc: string;
    loadError: string;
  };
  sources: {
    pageTitle: string;
    pageDesc: string;
    addSource: string;
    addSourceShort: string;
    emptyTitle: string;
    emptyDesc: string;
    searchPlaceholder: string;
    pageOf: (page: string, total: string) => string;
    previous: string;
    filterType: string;
    filterStatus: string;
    statusActive: string;
    statusSyncing: string;
    statusInactive: string;
    statusError: string;
    statusPendingTest: string;
    syncStarted: string;
    syncStartedDesc: (name: string) => string;
    sourceDeleted: string;
    sourceActivated: string;
    sourceDeactivated: string;
    connectionTestFailed: string;
    confirmDeleteSource: (name: string) => string;
    activateTitle: string;
    deactivateTitle: string;
    activateConfirm: (name: string) => string;
    deactivateConfirm: (name: string) => string;
    activate: string;
    deactivate: string;
    stepType: string;
    stepConnection: string;
    stepTest: string;
    stepSchema: string;
    stepConfigure: string;
    createTitle: string;
    createDesc: string;
    skippedTitle: string;
    skippedDesc: string;
    creating: string;
    createSourceBtn: string;
    selectTypeFirst: string;
    schemaDiscoveryFailed: string;
    discardChanges: string;
    sourceCreated: string;
    sourceCreatedDesc: (name: string) => string;
    editTitle: string;
    editTitleNamed: (name: string) => string;
    tags: string;
    addTagPlaceholder: string;
    syncFrequency: string;
    customCron: string;
    nextRun: (time: string) => string;
    credentials: string;
    credentialsHelp: string;
    leaveBlankKeep: string;
    connConfigLabel: string;
    connConfigDesc: string;
    credStrippedNote: (fields: string) => string;
    sourceUpdated: string;
    credPassword: string;
    credKeytab: string;
    credApiToken: string;
    credApiKey: string;
    credBearer: string;
    credClientSecret: string;
    credAccessKeyId: string;
    credSecretAccessKey: string;
    credAuthToken: string;
    freqManual: string;
    freqHourly: string;
    freq6h: string;
    freq12h: string;
    freqDaily: string;
    freqWeekly: string;
    freqCustom: string;
    noDescription: string;
    cardTables: (n: string) => string;
    cardRows: (n: string) => string;
    lastSync: (rel: string) => string;
    viewSchema: string;
    viewPipelines: string;
    testing: string;
    test: string;
    sync: string;
    open: string;
    colTables: string;
    colRows: string;
    colSize: string;
    colLastSynced: string;
    colSchedule: string;
    never: string;
    syncProgressTitle: string;
    syncProgressTitleNamed: (name: string) => string;
    fetchingLatest: string;
    pollingEvery: string;
    syncStatusError: string;
    retryLoad: string;
    startedAt: (rel: string, type: string) => string;
    mRowsRead: string;
    mRowsWritten: string;
    mTablesSynced: string;
    mDuration: string;
    mTransferred: string;
    mErrors: string;
    syncFailedTitle: string;
    syncErrorCount: (n: string) => string;
    syncDidNotComplete: string;
    retrySync: string;
    testingConnection: string;
    connectedIn: (ms: string) => string;
    editConnection: string;
    schemaReviewTitle: string;
    schemaReviewDesc: string;
    schemaReviewedCheck: string;
    sourceName: string;
    testingConnectionTo: (label: string) => string;
    provisioningVerifying: string;
    connectedSuccessfully: string;
    mLatency: string;
    mVersion: string;
    unknown: string;
    mPermissions: string;
    readAccessConfirmed: string;
    mWarnings: string;
    connectionFailed: string;
    checkServiceReachable: string;
    continueWithoutDetails: string;
    catAll: string;
    catDatabases: string;
    catHadoop: string;
    catOrchestration: string;
    catFilesApi: string;
    filesApiBadge: string;
    select: string;
    descPostgres: string;
    descMysql: string;
    descClickhouse: string;
    descDolt: string;
    descImpala: string;
    descHive: string;
    descHdfs: string;
    descSpark: string;
    descDagster: string;
    descApi: string;
    descCsv: string;
    descS3: string;
  };
  sourcesDetail: {
    eyebrow: string;
    loadingTitle: string;
    loadingDesc: string;
    detailDescFallback: string;
    loadError: string;
    backToSources: string;
    sType: string;
    tabOverview: string;
    tabSchema: string;
    tabPipelines: string;
    tabQuality: string;
    tabLineage: string;
    tabActivity: string;
    lastSyncLabel: string;
    propsTitle: string;
    pSyncFrequency: string;
    pSchemaDiscovered: string;
    pCreated: string;
    pUpdated: string;
    healthTitle: string;
    connValidated: string;
    currentStatus: (status: string) => string;
    latestErrorTitle: string;
    noErrorsTitle: string;
    noErrorsDesc: string;
    latestSyncTitle: string;
    statusLine: (v: string) => string;
    rowsWrittenLine: (v: string) => string;
    durationLine: (v: string) => string;
    syncHistoryTitle: string;
    noSyncHistory: string;
    rowsReadCount: (n: string) => string;
    rowsWrittenCount: (n: string) => string;
    tablesCount: (n: string) => string;
    selectTablePrompt: string;
    rowsCount: (n: string) => string;
    estimatedSize: (v: string) => string;
    columnsCount: (n: string) => string;
    previewData: string;
    previewDataNamed: (name: string) => string;
    deriveModel: string;
    viewInLineage: string;
    colColumn: string;
    colDataType: string;
    colNullable: string;
    colPii: string;
    colClassification: string;
    colDefault: string;
    colSampleValues: string;
    pkTitle: string;
    fkTitle: string;
    idxTitle: string;
    pkEmpty: string;
    fkEmpty: string;
    idxEmpty: string;
    keyPrimary: string;
    keyForeign: string;
    lineageTitle: string;
    openFullLineage: string;
    noLineage: string;
    lNodes: string;
    lEdges: string;
    lDepth: string;
    colNode: string;
    colLinks: string;
    inOut: (inc: string, out: string) => string;
    previewUnavailable: string;
    previewUnavailableDesc: string;
    piiMasked: string;
    maskedColumns: (cols: string) => string;
    tablesDiscoveredLabel: string;
    withPiiDetected: (n: string) => string;
    noPiiDetected: string;
    expandAll: string;
    collapseAll: string;
    piiBadge: (n: string) => string;
    modelsDerivedTitle: string;
    noModels: string;
    fieldsSummary: (n: string, pii: string) => string;
    containsPii: string;
    noPii: string;
    qualityRulesTitle: string;
    noRules: string;
    activityTimelineTitle: string;
    activityCreated: string;
    activityUpdated: string;
    configUpdated: string;
    syncActivity: (status: string) => string;
    syncDetail: (type: string, n: string) => string;
    pipelinesUsingTitle: string;
    noPipelines: string;
    totalRuns: (n: string) => string;
    recordsProcessed: (n: string) => string;
    lastRun: (v: string) => string;
    noSchemaDiscovered: string;
    searchTables: string;
    deriveModelTitle: string;
    deriveModelTitleNamed: (table: string) => string;
    modelName: string;
    autoGenRules: string;
    deriving: string;
    deriveModelBtn: string;
    modelDerived: string;
    modelDerivedDesc: string;
  };
  pipelines: {
    filterType: string;
    filterStatus: string;
    ptEtl: string;
    ptElt: string;
    ptBatch: string;
    ptStreaming: string;
    psActive: string;
    psPaused: string;
    psDisabled: string;
    psError: string;
    pageTitle: string;
    pageDesc: string;
    createPipeline: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDesc: string;
    runStarted: string;
    runStartedDesc: (name: string) => string;
    paused: string;
    pausedDesc: (name: string) => string;
    resumed: string;
    resumedDesc: (name: string) => string;
    confirmDelete: (name: string) => string;
    deleted: string;
    stepBasic: string;
    stepSource: string;
    stepTransforms: string;
    stepTarget: string;
    stepQuality: string;
    stepSchedule: string;
    createTitle: string;
    createDesc: string;
    newPipeline: string;
    selectSourceToBegin: string;
    targetPending: string;
    scheduleLabel: string;
    loadError: string;
    discardChanges: string;
    createdSuccess: string;
    createdSuccessDesc: (name: string) => string;
    schemaLoadFailed: string;
    schemaLoadFailedDesc: string;
    cronExpression: string;
    cronDescription: string;
    invalidCron: string;
    next5Runs: string;
    colPipeline: string;
    colSchedule: string;
    colRuns: string;
    colProcessed: string;
    colLastRun: string;
    sourceConfigured: string;
    starting: string;
    runNow: string;
    pipelineActions: string;
    resuming: string;
    resume: string;
    pausing: string;
    pause: string;
    deleting: string;
    lastRunLabel: string;
    pipelineName: string;
    pipelineType: string;
    tagsDesc: string;
    descriptionPlaceholder: string;
    tagsPlaceholder: string;
    source: string;
    selectDataSource: string;
    governedDataSource: string;
    readMode: string;
    rmTable: string;
    rmQuery: string;
    sourceTable: string;
    loadingSchema: string;
    selectTable: string;
    sourceQuery: string;
    enableIncremental: string;
    incrementalField: string;
    selectField: string;
    initialValue: string;
    schemaContext: string;
    loadingRealSchema: string;
    tablesDiscovered: (n: string) => string;
    selectSourceToLoad: string;
    targetSource: string;
    optionalTargetSource: string;
    noTargetSource: string;
    targetModel: string;
    optionalGovernedModel: string;
    noModel: string;
    targetTable: string;
    loadStrategy: string;
    lsAppend: string;
    lsFullReplace: string;
    lsIncremental: string;
    lsMerge: string;
    mergeKeys: string;
    scheduleMode: string;
    smManual: string;
    smPreset: string;
    smCustom: string;
    preset: string;
    choosePreset: string;
    customCron: string;
    maxRetries: string;
    retryBackoff: string;
    creating: string;
    createPipelineBtn: string;
    failOnGate: string;
    failOnGateDesc: string;
    gate: (n: string) => string;
    gateName: string;
    mNullPct: string;
    mUniquePct: string;
    mRowCountChange: string;
    mMinRowCount: string;
    mCustom: string;
    columnPlaceholder: string;
    noColumn: string;
    operator: string;
    threshold: string;
    expression: string;
    addQualityGate: string;
    transformBuilder: string;
    orderMatters: string;
    resolveIssues: string;
    ttRename: string;
    ttCast: string;
    ttFilter: string;
    ttMapValues: string;
    ttDerive: string;
    ttDeduplicate: string;
    ttAggregate: string;
    emptyTransforms: string;
    addTransformation: string;
    previewTransformation: string;
    before: string;
    after: string;
    step: (n: string) => string;
    collapse: string;
    expand: string;
    dragTransform: (n: string) => string;
    removeTransform: string;
    combineWith: string;
    noValueRequired: string;
    valuePlaceholder: string;
    addCondition: string;
    originalValue: string;
    mappedValue: string;
    defaultUnmapped: string;
    addMapping: string;
    groupBy: string;
    alias: string;
    addAggregation: string;
    keyColumns: string;
    keepLatest: string;
    keepFirst: string;
    orderByColumn: string;
    newColumnName: string;
    functionsHint: string;
    expressionLabel: string;
    availableColumns: (cols: string) => string;
    noColumnsYet: string;
    columnLabel: string;
    selectColumn: string;
    targetType: string;
    fromLabel: string;
    toLabel: string;
  };
  pipelinesDetail: {
    eyebrow: string;
    loadingTitle: string;
    loadingDesc: string;
    loadError: string;
    detailDescFallback: string;
    runPipeline: string;
    analyzeRootCause: string;
    backToPipelines: string;
    avgDuration: string;
    tabRuns: string;
    tabConfig: string;
    tabQuality: string;
    tabLineage: string;
    tabRootCause: string;
    lastRunStatus: (date: string, status: string) => string;
    neverRun: string;
    refreshAnalysis: string;
    analyzeFailureTitle: string;
    analyzeFailureDesc: string;
    selectFailedRun: string;
    configTitle: string;
    pSourceTable: string;
    pSourceQuery: string;
    pTargetTable: string;
    pLoadStrategy: string;
    pBatchSize: string;
    pIncrementalField: string;
    transformFlowTitle: string;
    noTransforms: string;
    noRuns: string;
    colPhase: string;
    colLoaded: string;
    colDuration: string;
    colCompleted: string;
    inspect: string;
    lineagePositionTitle: string;
    openFullLineage: string;
    noLineage: string;
    qualityGatesTitle: string;
    noGates: string;
    runDetailTitle: string;
    runDesc: (id: string, status: string) => string;
    selectRunPrompt: string;
    mCurrentPhase: string;
    mStarted: string;
    mCompleted: string;
    mBytesWritten: string;
    mExtracted: string;
    mLoaded: string;
    executionLog: string;
    noLogs: string;
    pipelineRunning: string;
    processing: string;
    loadedOf: (loaded: string, total: string) => string;
    noGatesEvaluated: string;
    gateValue: (v: string) => string;
  };
  analytics: {
    searchModels: string;
    fieldsCount: (n: string) => string;
    piiColumns: (n: string) => string;
    modelHeading: string;
    selectModel: string;
    columnsHeading: string;
    selectAll: string;
    deselectAll: string;
    selectModelPrompt: string;
    filtersHeading: string;
    addFilter: string;
    aggregationsHeading: string;
    groupByHeading: string;
    orderByHeading: string;
    addOrder: string;
    limitHeading: string;
    running: string;
    runQuery: string;
    saveQuery: string;
    clear: string;
    opEquals: string;
    opNotEquals: string;
    opGreaterThan: string;
    opGreaterOrEqual: string;
    opLessThan: string;
    opLessOrEqual: string;
    opIn: string;
    opNotIn: string;
    opLike: string;
    opIlike: string;
    opBetween: string;
    opIsNull: string;
    opIsNotNull: string;
    commaSeparated: string;
    runQueryPrompt: string;
    showingResults: (shown: string, total: string) => string;
    completedIn: (ms: string) => string;
    resultsTruncated: string;
    piiColumnsMasked: (cols: string) => string;
    sensitiveFields: string;
    noSavedQueries: string;
    colModel: string;
    colLastRun: string;
    colRuns: string;
    run: string;
    pageTitle: string;
    loadingDesc: string;
    loadError: string;
    pageDesc: string;
    tabBuilder: string;
    tabSaved: string;
    executingQuery: string;
    rowsReturned: (n: string) => string;
    queryFailed: string;
    savedUpdated: string;
    savedCreated: string;
    savedDeleted: string;
    editSavedTitle: string;
    saveQueryTitle: string;
    visibility: string;
    visPrivate: string;
    visTeam: string;
    visOrg: string;
    execState: {
      idle: string;
      running: string;
      success: string;
      error: string;
    };
  };
  models: {
    loadingTitle: string;
    loadingDesc: string;
    loadError: string;
    detailDescFallback: string;
    validating: string;
    validateModel: string;
    modelActions: string;
    publishVersion: string;
    deprecate: string;
    backToModels: string;
    sFields: string;
    sPiiColumns: string;
    sUpdated: string;
    classification: string;
    openSource: string;
    tabSchema: string;
    tabQualityRules: string;
    tabLineage: string;
    tabVersions: string;
    upstreamSource: (x: string) => string;
    sourceTableLine: (x: string) => string;
    consumers: (n: string) => string;
    modelPublished: string;
    modelDeprecated: string;
    deriveDesc: string;
    tableLabel: string;
    selectSourceFirst: string;
    selectTableOpt: string;
    noTablesDiscovered: string;
    clPublic: string;
    clInternal: string;
    clConfidential: string;
    clRestricted: string;
    editTitle: string;
    editTitleNamed: (name: string) => string;
    modelUpdated: string;
    colModel: string;
    colFields: string;
    colPii: string;
    unmappedTable: string;
    kpiTotal: string;
    kpiActive: string;
    kpiDraft: string;
    kpiRetired: string;
    kpiUpdatedWeek: string;
    noRules: string;
    colField: string;
    validationTitle: string;
    validationDesc: string;
    validatingModel: string;
    validationPassed: string;
    validationFailed: string;
    conformsChecks: string;
    issuesFound: (n: string, suffix: string) => string;
    modelFallback: string;
    noVersions: string;
    versionLine: (v: string, name: string) => string;
    versionMeta: (n: string, date: string) => string;
    current: string;
    fDraft: string;
    fDeprecated: string;
    fArchived: string;
    pageTitle: string;
    pageDesc: string;
    tagSemantic: string;
    tagVersioned: string;
    tagQualityGoverned: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDesc: string;
    deriveFirst: string;
  };
  contradictions: {
    colType: string;
    colTitle: string;
    colSources: string;
    colAffected: string;
    colConfidence: string;
    colCreated: string;
    investigate: string;
    detailTitle: string;
    detailPrompt: string;
    confidence: (n: string) => string;
    sourceA: string;
    sourceB: string;
    sampleRecords: string;
    resolutionGuidance: string;
    acceptRisk: string;
    resolve: string;
    markFalsePositive: string;
    unknownEntity: string;
    resolveTitle: string;
    resolutionAction: string;
    raSourceA: string;
    raSourceB: string;
    raBoth: string;
    raReconciled: string;
    raAccepted: string;
    raFalsePositive: string;
    resolutionNotes: string;
    submitting: string;
    scanTitle: string;
    startingScan: string;
    scanError: string;
    retryScan: string;
    scanStatus: (x: string) => string;
    mModelsScanned: string;
    mPairsCompared: string;
    mFound: string;
    mTriggeredBy: string;
    ctLogical: string;
    ctSemantic: string;
    ctTemporal: string;
    ctAnalytical: string;
    updated: string;
    resolved: string;
    pageTitle: string;
    loadingDesc: string;
    loadError: string;
    pageDesc: string;
    scanNow: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDesc: string;
    status: {
      detected: string;
      investigating: string;
      resolved: string;
      accepted: string;
      false_positive: string;
    };
  };
  lineage: {
    horizontal: string;
    vertical: string;
    fitToScreen: string;
    zoomIn: string;
    zoomOut: string;
    reset: string;
    fullScreen: string;
    selectNodePrompt: string;
    mDepth: string;
    mInbound: string;
    mOutbound: string;
    mCritical: string;
    impactPrompt: string;
    impactTitle: string;
    mDirectlyAffected: string;
    mIndirectlyAffected: string;
    mAffectedSuites: string;
    overview: string;
    minimapHint: string;
    searchPlaceholder: string;
    noResults: string;
    searching: string;
    matched: (x: string) => string;
    pageTitle: string;
    loadingDesc: string;
    loadError: string;
    pageDesc: string;
    impactAnalysis: string;
  };
  darkData: {
    colName: string;
    colType: string;
    colReason: string;
    colSize: string;
    colClassification: string;
    colRisk: string;
    colLastAccessed: string;
    review: string;
    govern: string;
    archive: string;
    scheduleDeletion: string;
    unknownLocation: string;
    ddActions: string;
    detailTitle: string;
    detailPrompt: string;
    mRiskScore: string;
    mEstimatedSize: string;
    mColumns: string;
    mLastAccessed: string;
    governTitle: string;
    modelName: string;
    autoGenRules: string;
    governing: string;
    kpiTotal: string;
    kpiHighRisk: string;
    kpiWithPii: string;
    kpiTotalSize: string;
    scanTitle: string;
    startingScan: string;
    scanStatus: (x: string) => string;
    mSourcesScanned: string;
    mAssetsFound: string;
    mPiiAssets: string;
    mHighRisk: string;
    archiveTitle: string;
    scheduleTitle: string;
    updateGovernance: (name: string) => string;
    selectAsset: string;
    notes: string;
    notesPlaceholder: string;
    saving: string;
    assetArchived: string;
    deletionScheduled: string;
    rUnmodeled: string;
    rOrphaned: string;
    rStale: string;
    rUngoverned: string;
    rUnclassified: string;
    filterGovernance: string;
    gsUnmanaged: string;
    gsUnderReview: string;
    gsGoverned: string;
    gsArchived: string;
    gsScheduled: string;
    broughtUnderGov: string;
    filterReason: string;
    pageTitle: string;
    loadingDesc: string;
    loadError: string;
    pageDesc: string;
    scanNow: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDesc: string;
  };
}

const dataLabels: DataBilingual<DataLabels> = {
  en: {
    page: {
      eyebrow: 'Data Platform',
      title: 'Data Suite',
      loadingDescription:
        'Unified operational view across sources, models, pipelines, quality, lineage, and governed analytics.',
      description:
        'Operational command center for sources, pipelines, quality posture, contradictions, dark data, lineage, and governed analytics.',
      sourcesTag: (count) => `${count} sources`,
      activePipelinesTag: (count) => `${count} active pipelines`,
      qualityGradeTag: (grade) => `Grade ${grade} quality`,
      openContradictionsTag: (count) => `${count} open contradictions`,
      statQuality: 'Quality',
      stat30dSuccess: '30d success',
      manageSources: 'Manage sources',
      openPipelines: 'Open pipelines',
    },
    kpis: {
      totalSources: 'Total Sources',
      activePipelines: 'Active Pipelines',
      qualityScore: 'Quality Score',
      openContradictions: 'Open Contradictions',
      darkDataAssets: 'Dark Data Assets',
      sinceLastPeriod: 'since last period',
      failedIn24h: 'failed in 24h',
      trend: 'trend',
      perGrade: (grade) => `/ Grade ${grade}`,
      tracked: (count) => `/ ${count} tracked`,
    },
    charts: {
      pipelineSuccessTitle: 'Pipeline Success Rate',
      pipelineSuccessDescription: 'Last 30 days of pipeline outcomes.',
      successRate: (value) => `Success rate ${value}`,
      pipelineEmptyTitle: 'No pipeline runs in the last 30 days',
      pipelineEmptyDescription:
        'Pipelines are configured, but no runs have executed in the trend window yet. Trigger a run to populate this chart.',
      qualityTrendTitle: 'Quality Score Trend',
      qualityTrendDescription: '30-day rolling quality score from the live quality service.',
      qualityEmptyTitle: 'No quality history in the last 30 days',
      qualityEmptyDescription:
        'The current quality score is live, but no dated quality results exist in the trend window. Run quality rules to build history.',
      qualityScoreSeries: 'Quality score',
      successSeries: 'Success',
      failedSeries: 'Failed',
      cancelledSeries: 'Cancelled',
      sourcesByStatusTitle: 'Sources by Status',
      sourcesByStatusDescription:
        'Source-type coverage overlaid with current status mix from the dashboard.',
      refreshing: 'Refreshing…',
      liveEvery60s: 'Live every 60s',
      noSourceStatusData: 'No source-status data available yet',
      statusActive: 'Active',
      statusInactive: 'Inactive',
      statusError: 'Error',
      statusSyncing: 'Syncing',
    },
    recentRuns: {
      title: 'Recent Pipeline Runs',
      description: 'Last 10 executions.',
      viewAll: 'View all',
      emptyTitle: 'No recent pipeline runs',
      emptyDescription:
        'No pipeline executions have completed yet. Trigger a run to see activity here.',
      colPipeline: 'Pipeline',
      colStatus: 'Status',
      colDuration: 'Duration',
      colCompleted: 'Completed',
    },
    qualityIssues: {
      title: 'Quality Issues',
      description: 'Current failed or warning rules with impacted records.',
      openQuality: 'Open quality',
      emptyTitle: 'No active quality issues',
      emptyDescription:
        'All quality rules are passing. New failures and warnings will surface here as they are detected.',
      colModel: 'Model',
      colRule: 'Rule',
      colSeverity: 'Severity',
      colFailures: 'Failures',
    },
    connForms: {
      host: 'Host',
      port: 'Port',
      database: 'Database',
      schema: 'Schema',
      username: 'Username',
      password: 'Password',
      accessKey: 'Access key',
      secretKey: 'Secret key',
      bucket: 'Bucket',
      prefix: 'Prefix',
      region: 'Region',
      endpoint: 'Endpoint',
      useSsl: 'Use SSL',
      tlsSsl: 'TLS / SSL',
      authentication: 'Authentication',
      realm: 'Realm',
      kdc: 'KDC',
      principal: 'Principal',
      keytabPath: 'Keytab Path',
      branch: 'Branch',
      authNoAuth: 'No Auth',
      authUsernamePassword: 'Username / Password',
      authKerberos: 'Kerberos',
      authSimple: 'Simple',
      authLdap: 'LDAP',
      sslMode: 'SSL mode',
      sslDisable: 'Disable',
      sslAllow: 'Allow',
      sslPrefer: 'Prefer',
      sslRequire: 'Require',
      sslVerifyCa: 'Verify CA',
      sslVerifyFull: 'Verify full',
      tls: 'TLS',
      tlsEnabled: 'Enabled',
      tlsPreferred: 'Preferred',
      tlsSkipVerify: 'Skip verify',
      tlsDisabled: 'Disabled',
      baseUrl: 'Base URL',
      authType: 'Auth type',
      authTypeNone: 'None',
      authTypeBasic: 'Basic',
      authTypeBearer: 'Bearer',
      authTypeApiKey: 'API key',
      authTypeOauth2: 'OAuth2',
      paginationType: 'Pagination type',
      pagOffset: 'Offset',
      pagCursor: 'Cursor',
      pagPage: 'Page',
      pagLinkHeader: 'Link header',
      rateLimit: 'Rate limit (req/s)',
      dataPath: 'Data path',
      bearerToken: 'Bearer token',
      keyName: 'Key name',
      keyValue: 'Key value',
      location: 'Location',
      locHeader: 'Header',
      locQuery: 'Query',
      tokenUrl: 'Token URL',
      clientId: 'Client ID',
      clientSecret: 'Client Secret',
      scope: 'Scope',
      customHeaders: 'Custom headers',
      addHeader: 'Add header',
      noCustomHeaders: 'No custom headers configured.',
      headerName: 'Header name',
      headerValue: 'Header value',
      protocol: 'Protocol',
      protocolNative: 'Native',
      protocolHttp: 'HTTP',
      portHelpClickhouse: '9000 for native TCP, 8123 for HTTP.',
      compression: 'Compression',
      compressionHelp: 'Enable LZ4 compression for faster transfer.',
      tlsSslEncryptHelp: 'Encrypt the connection to ClickHouse.',
      uploadFile: 'Upload file',
      csvUploadHelp:
        'Upload uses the file service for governed storage. You still need to confirm the MinIO path fields below because the data connector requires explicit storage coordinates.',
      minioEndpoint: 'MinIO endpoint',
      filePath: 'File path',
      delimiter: 'Delimiter',
      delimComma: 'Comma',
      delimTab: 'Tab',
      delimSemicolon: 'Semicolon',
      delimPipe: 'Pipe',
      encoding: 'Encoding',
      hasHeaderRow: 'Has header row',
      nameNodes: 'NameNodes',
      nameNodesHelp: 'Enter one or more HDFS NameNode addresses.',
      user: 'User',
      maxFileSizeMb: 'Max File Size (MB)',
      basePaths: 'Base Paths',
      basePathsHelp: 'Directories to scan for warehouse data and DSPM inspection.',
      auditLogPath: 'Audit Log Path',
      transportMode: 'Transport Mode',
      transportBinary: 'Binary',
      httpPath: 'HTTP Path',
      tlsSslHiveHelp: 'Enable TLS when HiveServer2 is configured with secure transport.',
      auditLogTable: 'Audit Log Table',
      tlsSslImpalaHelp: 'Enable TLS when Impala is fronted by secure transport.',
      sqlAccess: 'SQL Access',
      sqlAccessHelp: 'Configure Spark Thrift Server for schema discovery and data access.',
      thriftHost: 'Thrift Host',
      thriftPort: 'Thrift Port',
      monitoring: 'Monitoring',
      monitoringHelp: 'Spark REST endpoints provide job telemetry for lineage and UEBA.',
      masterUrl: 'Master URL',
      historyServerUrl: 'History Server URL',
      tlsSslDoltHelp: 'Enable TLS for encrypted MySQL wire-protocol sessions.',
      graphqlUrl: 'GraphQL URL',
      workspace: 'Workspace',
      apiToken: 'API Token',
      timeoutSeconds: 'Timeout (seconds)',
      addValue: 'Add value',
    },
    common: {
      save: 'Save',
      cancel: 'Cancel',
      close: 'Close',
      delete: 'Delete',
      edit: 'Edit',
      add: 'Add',
      remove: 'Remove',
      create: 'Create',
      update: 'Update',
      apply: 'Apply',
      reset: 'Reset',
      back: 'Back',
      next: 'Next',
      continue: 'Continue',
      confirm: 'Confirm',
      retry: 'Retry',
      saving: 'Saving…',
      loading: 'Loading…',
      deleting: 'Deleting…',
      running: 'Running…',
      refreshing: 'Refreshing…',
      search: 'Search',
      viewAll: 'View all',
      view: 'View',
      status: 'Status',
      actions: 'Actions',
      name: 'Name',
      displayName: 'Display name',
      description: 'Description',
      type: 'Type',
      enabled: 'Enabled',
      disabled: 'Disabled',
      yes: 'Yes',
      no: 'No',
      none: 'None',
      all: 'All',
      active: 'Active',
      inactive: 'Inactive',
      severity: 'Severity',
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      passed: 'Passed',
      failed: 'Failed',
      warning: 'Warning',
      error: 'Error',
      success: 'Success',
      pending: 'Pending',
      running2: 'Running',
      completed: 'Completed',
      cancelled: 'Cancelled',
      runNow: 'Run now',
      optional: 'Optional',
      required: 'Required',
    },
    quality: {
      noScores: 'No model quality scores are available.',
      rulesFailedSummary: (total, failed) => `${total} rules • ${failed} failed`,
      qualityScore: 'Quality score',
      resultTitle: 'Quality Result',
      mStatus: 'Status',
      mChecked: 'Checked',
      mFailed: 'Failed',
      mDuration: 'Duration',
      mCheckedAt: 'Checked At',
      mPassRate: 'Pass Rate',
      deleteRuleTitle: 'Delete quality rule',
      deleteRuleDesc: (name) =>
        `Permanently delete "${name}"? This will remove all historical results linked to this rule.`,
      colRule: 'Rule',
      colLastStatus: 'Last status',
      colLastRun: 'Last run',
      neverRun: 'never run',
      editRuleTitle: (name) => `Edit Rule: ${name}`,
      createRuleTitle: 'Create Quality Rule',
      fModel: 'Model',
      selectModel: 'Select model',
      fRuleType: 'Rule type',
      rtNotNull: 'Not Null',
      rtUnique: 'Unique',
      rtRange: 'Range',
      rtRegex: 'Regex',
      rtReferential: 'Referential',
      rtEnum: 'Enum',
      rtFreshness: 'Freshness',
      rtRowCount: 'Row Count',
      rtCustomSql: 'Custom SQL',
      rtStatistical: 'Statistical',
      fRuleName: 'Rule name',
      fDescription: 'Description',
      descPlaceholder: 'What this rule validates and why it matters.',
      allowedValuesPlaceholder: 'active, inactive, pending',
      tagsPlaceholder: 'critical, finance, nightly',
      fColumn: 'Column',
      selectColumn: 'Select column',
      ruleConfig: 'Rule configuration',
      fMin: 'Minimum',
      fMax: 'Maximum',
      fRegexPattern: 'Regex pattern',
      fReferenceSource: 'Reference source',
      selectSource: 'Select source',
      fReferenceTable: 'Reference table',
      fReferenceColumn: 'Reference column',
      fAllowedValues: 'Allowed values',
      fMaxAge: 'Max age (hours)',
      fMinRowCount: 'Minimum row count',
      fMaxChangePercent: 'Max change percent',
      fSql: 'SQL',
      fZScore: 'Z-score threshold',
      fSchedule: 'Schedule',
      fTags: 'Tags',
      enabledDesc: 'Disabled rules remain in the catalog but are not executed.',
      saveChanges: 'Save changes',
      createRule: 'Create rule',
      overallGrade: 'Overall grade',
      gaugeSummary: (passed, failed, warnings) =>
        `${passed} passed • ${failed} failed • ${warnings} warnings`,
      trendEmptyTitle: 'No quality history yet',
      trendEmptyDesc:
        'No dated quality results fall within the trend window. Run quality rules to build a 30-day trend.',
      qualityScoreSeries: 'Quality score',
      pageEyebrow: 'Data Platform',
      pageTitle: 'Data Quality',
      pageLoadingDesc: 'Loading score, trend, and live rule telemetry.',
      pageDesc: 'Live quality posture across governed models, rule execution, and recent trend movement.',
      trendCardTitle: '30-Day Trend',
      modelScoresHeading: 'Model Quality Scores',
      searchPlaceholder: 'Search quality rules...',
      emptyTitle: 'No quality rules found',
      emptyDesc: 'No quality rules matched the current filters.',
      filterLastStatus: 'Last Status',
      toastExecuted: 'Quality rule executed.',
      toastExecutedDesc: (name, status) => `${name} finished with status ${status}.`,
      toastEnabled: 'Rule enabled.',
      toastDisabled: 'Rule disabled.',
      toastDeleted: 'Quality rule deleted.',
      toastUpdated: 'Quality rule updated.',
      toastCreated: 'Quality rule created.',
      toastGoneTitle: 'Rule no longer exists',
      toastGoneDesc: 'This rule was deleted before the update could be saved.',
      loadError: 'Failed to load quality metrics.',
    },
    sources: {
      pageTitle: 'Data Sources',
      pageDesc: 'Connected operational, file, API, and object-store sources available to the data platform.',
      addSource: '+ Add Source',
      addSourceShort: 'Add Source',
      emptyTitle: 'No data sources found',
      emptyDesc: 'Connect your first governed source to begin schema discovery and pipeline orchestration.',
      searchPlaceholder: 'Search sources...',
      pageOf: (page, total) => `Page ${page} of ${total}`,
      previous: 'Previous',
      filterType: 'Type',
      filterStatus: 'Status',
      statusActive: 'Active',
      statusSyncing: 'Syncing',
      statusInactive: 'Inactive',
      statusError: 'Error',
      statusPendingTest: 'Pending Test',
      syncStarted: 'Sync started.',
      syncStartedDesc: (name) => `${name} is now syncing.`,
      sourceDeleted: 'Source deleted.',
      sourceActivated: 'Source activated.',
      sourceDeactivated: 'Source deactivated.',
      connectionTestFailed: 'Connection test failed',
      confirmDeleteSource: (name) => `Delete source "${name}"?`,
      activateTitle: 'Activate Source',
      deactivateTitle: 'Deactivate Source',
      activateConfirm: (name) => `Are you sure you want to activate "${name}"?`,
      deactivateConfirm: (name) => `Are you sure you want to deactivate "${name}"?`,
      activate: 'Activate',
      deactivate: 'Deactivate',
      stepType: 'Type',
      stepConnection: 'Connection',
      stepTest: 'Test',
      stepSchema: 'Schema',
      stepConfigure: 'Configure',
      createTitle: 'Create Source',
      createDesc: 'Add a governed source with connection verification, schema discovery, and sync configuration.',
      skippedTitle: 'Verification details were skipped',
      skippedDesc:
        'The source will be created during schema discovery or final submission, so no connection health record was persisted yet.',
      creating: 'Creating…',
      createSourceBtn: 'Create Source',
      selectTypeFirst: 'Select a source type first.',
      schemaDiscoveryFailed: 'Schema discovery failed',
      discardChanges: 'Discard changes?',
      sourceCreated: 'Source created successfully.',
      sourceCreatedDesc: (name) => `${name} is ready for use.`,
      editTitle: 'Edit source',
      editTitleNamed: (name) => `Edit source: ${name}`,
      tags: 'Tags',
      addTagPlaceholder: 'Add tag and press Enter',
      syncFrequency: 'Sync frequency',
      customCron: 'Custom cron schedule',
      nextRun: (time) => `Next run: ${time}`,
      credentials: 'Credentials',
      credentialsHelp: 'Leave blank to preserve the existing stored credential. Only fill in a field to rotate it.',
      leaveBlankKeep: 'Leave blank to keep existing',
      connConfigLabel: 'Connection config (non-sensitive fields)',
      connConfigDesc: 'Credential fields are managed above and are never included in this JSON.',
      credStrippedNote: (fields) =>
        `Credential fields (${fields}) are stripped from the JSON display for security. Blank credential inputs above are preserved server-side automatically.`,
      sourceUpdated: 'Source updated successfully.',
      credPassword: 'Password',
      credKeytab: 'Keytab (base64)',
      credApiToken: 'API Token',
      credApiKey: 'API Key',
      credBearer: 'Bearer Token',
      credClientSecret: 'Client Secret',
      credAccessKeyId: 'Access Key ID',
      credSecretAccessKey: 'Secret Access Key',
      credAuthToken: 'Auth Token',
      freqManual: 'Manual only',
      freqHourly: 'Every hour',
      freq6h: 'Every 6 hours',
      freq12h: 'Every 12 hours',
      freqDaily: 'Daily',
      freqWeekly: 'Weekly',
      freqCustom: 'Custom',
      noDescription: 'No description provided.',
      cardTables: (n) => `${n} tables`,
      cardRows: (n) => `${n} rows`,
      lastSync: (rel) => `Last sync: ${rel}`,
      viewSchema: 'View schema',
      viewPipelines: 'View pipelines',
      testing: 'Testing…',
      test: 'Test',
      sync: 'Sync',
      open: 'Open',
      colTables: 'Tables',
      colRows: 'Rows',
      colSize: 'Size',
      colLastSynced: 'Last synced',
      colSchedule: 'Schedule',
      never: 'Never',
      syncProgressTitle: 'Sync progress',
      syncProgressTitleNamed: (name) => `Sync progress: ${name}`,
      fetchingLatest: 'Fetching latest sync run…',
      pollingEvery: 'Polling sync history every 3 seconds.',
      syncStatusError: 'Could not load sync status. Please try again.',
      retryLoad: 'Retry',
      startedAt: (rel, type) => `Started ${rel} • ${type}`,
      mRowsRead: 'Rows read',
      mRowsWritten: 'Rows written',
      mTablesSynced: 'Tables synced',
      mDuration: 'Duration',
      mTransferred: 'Transferred',
      mErrors: 'Errors',
      syncFailedTitle: 'Sync failed',
      syncErrorCount: (n) => `${n} error(s) were reported during sync.`,
      syncDidNotComplete: 'The sync did not complete successfully.',
      retrySync: 'Retry sync',
      testingConnection: 'Testing connection…',
      connectedIn: (ms) => `Connected in ${ms}ms`,
      editConnection: 'Edit connection',
      schemaReviewTitle: 'Schema review',
      schemaReviewDesc:
        'Review the discovered tables and PII flags before continuing. Sensitive columns will remain masked for users without `data:pii`.',
      schemaReviewedCheck: "I've reviewed the schema and PII classifications.",
      sourceName: 'Source name',
      testingConnectionTo: (label) => `Testing connection to ${label}…`,
      provisioningVerifying: 'The source is being provisioned and verified against the backend connector.',
      connectedSuccessfully: 'Connected successfully',
      mLatency: 'Latency',
      mVersion: 'Version',
      unknown: 'Unknown',
      mPermissions: 'Permissions',
      readAccessConfirmed: 'Read access confirmed',
      mWarnings: 'Warnings',
      connectionFailed: 'Connection failed',
      checkServiceReachable: 'Check that the service is reachable from the platform network and that the credentials are correct.',
      continueWithoutDetails: 'Continue without test details',
      catAll: 'All',
      catDatabases: 'Databases',
      catHadoop: 'Hadoop',
      catOrchestration: 'Orchestration',
      catFilesApi: 'Files & API',
      filesApiBadge: 'files & api',
      select: 'Select',
      descPostgres: 'Relational operational database',
      descMysql: 'Relational operational database',
      descClickhouse: 'High-performance columnar analytics',
      descDolt: 'Versioned SQL database with commit history',
      descImpala: 'Interactive SQL analytics for Cloudera',
      descHive: 'HiveServer2 warehouse over Hadoop storage',
      descHdfs: 'Direct Hadoop Distributed File System access',
      descSpark: 'Distributed compute with SQL and job telemetry',
      descDagster: 'Pipeline orchestration and asset lineage',
      descApi: 'HTTP API endpoint integration',
      descCsv: 'Delimited files in object storage',
      descS3: 'Object storage buckets and prefixes',
    },
    sourcesDetail: {
      eyebrow: 'Data Source',
      loadingTitle: 'Source Detail',
      loadingDesc: 'Loading source metadata, schema, and lineage.',
      detailDescFallback: 'Governed source detail with schema, lineage, quality, and pipeline context.',
      loadError: 'Failed to load source detail.',
      backToSources: 'Back to sources',
      sType: 'Type',
      tabOverview: 'Overview',
      tabSchema: 'Schema',
      tabPipelines: 'Pipelines',
      tabQuality: 'Quality',
      tabLineage: 'Lineage',
      tabActivity: 'Activity',
      lastSyncLabel: 'Last Sync',
      propsTitle: 'Source Properties',
      pSyncFrequency: 'Sync Frequency',
      pSchemaDiscovered: 'Schema Discovered',
      pCreated: 'Created',
      pUpdated: 'Updated',
      healthTitle: 'Connection Health',
      connValidated: 'Connection validated and active.',
      currentStatus: (status) => `Current status: ${status}`,
      latestErrorTitle: 'Latest error',
      noErrorsTitle: 'No active connector errors',
      noErrorsDesc: 'The source does not report recent connection or sync failures.',
      latestSyncTitle: 'Latest sync',
      statusLine: (v) => `Status: ${v}`,
      rowsWrittenLine: (v) => `Rows written: ${v}`,
      durationLine: (v) => `Duration: ${v}`,
      syncHistoryTitle: 'Sync History',
      noSyncHistory: 'No sync history is available yet.',
      rowsReadCount: (n) => `${n} rows read`,
      rowsWrittenCount: (n) => `${n} rows written`,
      tablesCount: (n) => `${n} tables`,
      selectTablePrompt: 'Select a table to inspect its columns, keys, and preview actions.',
      rowsCount: (n) => `${n} rows`,
      estimatedSize: (v) => `${v} estimated size`,
      columnsCount: (n) => `${n} columns`,
      previewData: 'Preview Data',
      previewDataNamed: (name) => `Preview Data: ${name}`,
      deriveModel: 'Derive Model',
      viewInLineage: 'View in Lineage',
      colColumn: 'Column',
      colDataType: 'Data type',
      colNullable: 'Nullable',
      colPii: 'PII',
      colClassification: 'Classification',
      colDefault: 'Default',
      colSampleValues: 'Sample values',
      pkTitle: 'Primary Keys',
      fkTitle: 'Foreign Keys',
      idxTitle: 'Indexes',
      pkEmpty: 'No primary key metadata.',
      fkEmpty: 'No foreign keys discovered.',
      idxEmpty: 'No index metadata exposed by the connector.',
      keyPrimary: 'primary',
      keyForeign: 'foreign',
      lineageTitle: 'Lineage Around This Source',
      openFullLineage: 'Open full lineage',
      noLineage: 'No lineage graph is available for this source.',
      lNodes: 'Nodes',
      lEdges: 'Edges',
      lDepth: 'Depth',
      colNode: 'Node',
      colLinks: 'Links',
      inOut: (inc, out) => `${inc} in / ${out} out`,
      previewUnavailable: 'Preview unavailable',
      previewUnavailableDesc:
        'This source table does not have a derived model yet. Derive a model first, then preview rows through the governed analytics API.',
      piiMasked: 'PII masked',
      maskedColumns: (cols) => `Masked columns: ${cols}`,
      tablesDiscoveredLabel: 'Tables discovered:',
      withPiiDetected: (n) => `${n} with PII detected`,
      noPiiDetected: 'No PII detected',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      piiBadge: (n) => `${n} PII`,
      modelsDerivedTitle: 'Models Derived From This Source',
      noModels: 'No governed models have been derived from this source yet.',
      fieldsSummary: (n, pii) => `${n} fields • ${pii}`,
      containsPii: 'Contains PII',
      noPii: 'No PII',
      qualityRulesTitle: 'Quality Rules',
      noRules: 'No quality rules are attached to models from this source.',
      activityTimelineTitle: 'Activity Timeline',
      activityCreated: 'Source created',
      activityUpdated: 'Source updated',
      configUpdated: 'Configuration updated',
      syncActivity: (status) => `Sync ${status}`,
      syncDetail: (type, n) => `${type} sync • ${n} rows written`,
      pipelinesUsingTitle: 'Pipelines Using This Source',
      noPipelines: 'No pipelines currently reference this source.',
      totalRuns: (n) => `${n} total runs`,
      recordsProcessed: (n) => `${n} records processed`,
      lastRun: (v) => `Last run ${v}`,
      noSchemaDiscovered: 'No schema has been discovered for this source yet.',
      searchTables: 'Search tables...',
      deriveModelTitle: 'Derive model',
      deriveModelTitleNamed: (table) => `Derive model from ${table}`,
      modelName: 'Model name',
      autoGenRules: 'Auto-generate quality rules',
      deriving: 'Deriving…',
      deriveModelBtn: 'Derive model',
      modelDerived: 'Model derived successfully.',
      modelDerivedDesc: 'The schema is now available as a governed model.',
    },
    pipelines: {
      filterType: 'Type',
      filterStatus: 'Status',
      ptEtl: 'ETL',
      ptElt: 'ELT',
      ptBatch: 'Batch',
      ptStreaming: 'Streaming',
      psActive: 'Active',
      psPaused: 'Paused',
      psDisabled: 'Disabled',
      psError: 'Error',
      pageTitle: 'Pipelines',
      pageDesc: 'Operational pipeline registry with live execution controls, schedule context, and processed volume.',
      createPipeline: 'Create pipeline',
      searchPlaceholder: 'Search pipelines...',
      emptyTitle: 'No pipelines found',
      emptyDesc: 'No pipelines matched the current filters.',
      runStarted: 'Pipeline run started.',
      runStartedDesc: (name) => `${name} is now executing.`,
      paused: 'Pipeline paused.',
      pausedDesc: (name) => `${name} will not run until resumed.`,
      resumed: 'Pipeline resumed.',
      resumedDesc: (name) => `${name} is active again.`,
      confirmDelete: (name) => `Delete pipeline "${name}"?`,
      deleted: 'Pipeline deleted.',
      stepBasic: 'Basic',
      stepSource: 'Source',
      stepTransforms: 'Transforms',
      stepTarget: 'Target',
      stepQuality: 'Quality',
      stepSchedule: 'Schedule',
      createTitle: 'Create Pipeline',
      createDesc: 'Define the source, transformation flow, quality gates, and schedule for a governed data pipeline.',
      newPipeline: 'New pipeline',
      selectSourceToBegin: 'Select a source to begin.',
      targetPending: 'target pending',
      scheduleLabel: 'Schedule:',
      loadError: 'Failed to load pipeline wizard data.',
      discardChanges: 'Discard pipeline wizard changes?',
      createdSuccess: 'Pipeline created successfully.',
      createdSuccessDesc: (name) => `${name} is ready to run.`,
      schemaLoadFailed: 'Schema load failed',
      schemaLoadFailedDesc: 'Could not load source schema.',
      cronExpression: 'Cron expression',
      cronDescription: 'Five-field cron expression in minute hour day month weekday format.',
      invalidCron: 'Invalid cron expression',
      next5Runs: 'Next 5 runs:',
      colPipeline: 'Pipeline',
      colSchedule: 'Schedule',
      colRuns: 'Runs',
      colProcessed: 'Processed',
      colLastRun: 'Last run',
      sourceConfigured: 'Source configured',
      starting: 'Starting…',
      runNow: 'Run now',
      pipelineActions: 'Pipeline actions',
      resuming: 'Resuming…',
      resume: 'Resume',
      pausing: 'Pausing…',
      pause: 'Pause',
      deleting: 'Deleting…',
      lastRunLabel: 'last run',
      pipelineName: 'Pipeline name',
      pipelineType: 'Pipeline type',
      tagsDesc: 'Press Enter to add a tag.',
      descriptionPlaceholder: 'Describe what this pipeline extracts, transforms, and loads.',
      tagsPlaceholder: 'governed, hourly, finance',
      source: 'Source',
      selectDataSource: 'Select a data source',
      governedDataSource: 'Governed data source',
      readMode: 'Read mode',
      rmTable: 'Table',
      rmQuery: 'Query',
      sourceTable: 'Source table',
      loadingSchema: 'Loading schema…',
      selectTable: 'Select table',
      sourceQuery: 'Source query',
      enableIncremental: 'Enable incremental extraction',
      incrementalField: 'Incremental field',
      selectField: 'Select field',
      initialValue: 'Initial value',
      schemaContext: 'Schema context',
      loadingRealSchema: 'Loading real source schema…',
      tablesDiscovered: (n) => `${n} tables discovered`,
      selectSourceToLoad: 'Select a source to load schema',
      targetSource: 'Target source',
      optionalTargetSource: 'Optional target source',
      noTargetSource: 'No target source',
      targetModel: 'Target model',
      optionalGovernedModel: 'Optional governed model',
      noModel: 'No model',
      targetTable: 'Target table',
      loadStrategy: 'Load strategy',
      lsAppend: 'Append',
      lsFullReplace: 'Full replace',
      lsIncremental: 'Incremental',
      lsMerge: 'Merge',
      mergeKeys: 'Merge keys',
      scheduleMode: 'Schedule mode',
      smManual: 'Manual only',
      smPreset: 'Preset schedule',
      smCustom: 'Custom cron',
      preset: 'Preset',
      choosePreset: 'Choose a preset',
      customCron: 'Custom cron',
      maxRetries: 'Max retries',
      retryBackoff: 'Retry backoff (sec)',
      creating: 'Creating…',
      createPipelineBtn: 'Create Pipeline',
      failOnGate: 'Fail pipeline on quality gate failure',
      failOnGateDesc: 'Stop the load phase if a gate returns a failed status.',
      gate: (n) => `Gate ${n}`,
      gateName: 'Gate name',
      mNullPct: 'Null percentage',
      mUniquePct: 'Unique percentage',
      mRowCountChange: 'Row count change',
      mMinRowCount: 'Minimum row count',
      mCustom: 'Custom expression',
      columnPlaceholder: 'Column',
      noColumn: 'No column',
      operator: 'Operator',
      threshold: 'Threshold',
      expression: 'Expression',
      addQualityGate: 'Add quality gate',
      transformBuilder: 'Transformation builder',
      orderMatters: 'Order matters. Transformations run sequentially against the selected source rows.',
      resolveIssues: 'Resolve transform issues before continuing',
      ttRename: 'Rename',
      ttCast: 'Cast',
      ttFilter: 'Filter',
      ttMapValues: 'Map Values',
      ttDerive: 'Derive',
      ttDeduplicate: 'Deduplicate',
      ttAggregate: 'Aggregate',
      emptyTransforms: 'Add one or more transformations to define the pipeline flow.',
      addTransformation: 'Add transformation',
      previewTransformation: 'Preview Transformation (first 5 rows)',
      before: 'Before',
      after: 'After',
      step: (n) => `Step ${n}`,
      collapse: 'Collapse',
      expand: 'Expand',
      dragTransform: (n) => `Drag transform ${n}`,
      removeTransform: 'Remove transform',
      combineWith: 'Combine with',
      noValueRequired: 'No value required',
      valuePlaceholder: 'Value',
      addCondition: 'Add condition',
      originalValue: 'Original value',
      mappedValue: 'Mapped value',
      defaultUnmapped: 'Default value for unmapped items',
      addMapping: 'Add mapping',
      groupBy: 'Group by',
      alias: 'Alias',
      addAggregation: 'Add aggregation',
      keyColumns: 'Key columns',
      keepLatest: 'Latest',
      keepFirst: 'First',
      orderByColumn: 'Order by column',
      newColumnName: 'New column name',
      functionsHint: 'Functions: `UPPER`, `LOWER`, `TRIM`, `CONCAT`, `COALESCE`',
      expressionLabel: 'Expression',
      availableColumns: (cols) => `Available columns: ${cols}`,
      noColumnsYet: 'No columns selected yet',
      columnLabel: 'Column',
      selectColumn: 'Select column',
      targetType: 'Target type',
      fromLabel: 'From',
      toLabel: 'To',
    },
    pipelinesDetail: {
      eyebrow: 'Pipeline',
      loadingTitle: 'Pipeline Detail',
      loadingDesc: 'Loading pipeline runs, configuration, and lineage.',
      loadError: 'Failed to load pipeline detail.',
      detailDescFallback: 'Pipeline execution, configuration, quality, and lineage detail.',
      runPipeline: 'Run pipeline',
      analyzeRootCause: 'Analyze Root Cause',
      backToPipelines: 'Back to pipelines',
      avgDuration: 'Avg Duration',
      tabRuns: 'Runs',
      tabConfig: 'Config',
      tabQuality: 'Quality',
      tabLineage: 'Lineage',
      tabRootCause: 'Root Cause',
      lastRunStatus: (date, status) => `Last run ${date} • status ${status}`,
      neverRun: 'never run',
      refreshAnalysis: 'Refresh Analysis',
      analyzeFailureTitle: 'Analyze pipeline failure',
      analyzeFailureDesc:
        'Trace the failure upstream through lineage, schema changes, and recent run history to isolate the real source of the outage.',
      selectFailedRun: 'Select a failed run to analyze root cause.',
      configTitle: 'Configuration',
      pSourceTable: 'Source Table',
      pSourceQuery: 'Source Query',
      pTargetTable: 'Target Table',
      pLoadStrategy: 'Load Strategy',
      pBatchSize: 'Batch Size',
      pIncrementalField: 'Incremental Field',
      transformFlowTitle: 'Transformation Flow',
      noTransforms: 'No transformations are configured.',
      noRuns: 'No runs have been recorded for this pipeline yet.',
      colPhase: 'Phase',
      colLoaded: 'Loaded',
      colDuration: 'Duration',
      colCompleted: 'Completed',
      inspect: 'Inspect',
      lineagePositionTitle: 'Lineage Position',
      openFullLineage: 'Open full lineage',
      noLineage: 'No lineage information is available for this pipeline.',
      qualityGatesTitle: 'Quality Gates',
      noGates: 'No quality gates are configured for this pipeline.',
      runDetailTitle: 'Run Detail',
      runDesc: (id, status) => `Run ${id} • ${status}`,
      selectRunPrompt: 'Select a run to inspect metrics, phases, and logs.',
      mCurrentPhase: 'Current Phase',
      mStarted: 'Started',
      mCompleted: 'Completed',
      mBytesWritten: 'Bytes Written',
      mExtracted: 'Extracted',
      mLoaded: 'Loaded',
      executionLog: 'Execution Log',
      noLogs: 'No logs available for this run.',
      pipelineRunning: 'Pipeline is running',
      processing: 'processing',
      loadedOf: (loaded, total) => `${loaded} loaded of ${total} observed records`,
      noGatesEvaluated: 'No quality gates were evaluated for this run.',
      gateValue: (v) => `value ${v}`,
    },
    analytics: {
      searchModels: 'Search models or columns...',
      fieldsCount: (n) => `${n} fields`,
      piiColumns: (n) => `• ${n} PII columns`,
      modelHeading: 'Model',
      selectModel: 'Select a model',
      columnsHeading: 'Columns',
      selectAll: 'Select all',
      deselectAll: 'Deselect all',
      selectModelPrompt: 'Select a model to choose columns.',
      filtersHeading: 'Filters',
      addFilter: 'Add filter',
      aggregationsHeading: 'Aggregations',
      groupByHeading: 'Group By',
      orderByHeading: 'Order By',
      addOrder: 'Add order',
      limitHeading: 'Limit',
      running: 'Running…',
      runQuery: 'Run Query',
      saveQuery: 'Save Query',
      clear: 'Clear',
      opEquals: 'Equals',
      opNotEquals: 'Not equals',
      opGreaterThan: 'Greater than',
      opGreaterOrEqual: 'Greater than or equals',
      opLessThan: 'Less than',
      opLessOrEqual: 'Less than or equals',
      opIn: 'In',
      opNotIn: 'Not in',
      opLike: 'Like',
      opIlike: 'ILike',
      opBetween: 'Between',
      opIsNull: 'Is null',
      opIsNotNull: 'Is not null',
      commaSeparated: 'Comma-separated values',
      runQueryPrompt: 'Run a query to see governed analytics results.',
      showingResults: (shown, total) => `Showing ${shown} of ${total} results`,
      completedIn: (ms) => `Completed in ${ms}ms`,
      resultsTruncated: 'Results truncated to the selected limit.',
      piiColumnsMasked: (cols) => `PII columns masked: ${cols}`,
      sensitiveFields: 'sensitive fields',
      noSavedQueries: 'No saved queries yet.',
      colModel: 'Model',
      colLastRun: 'Last Run',
      colRuns: 'Runs',
      run: 'Run',
      pageTitle: 'Analytics',
      loadingDesc: 'Loading governed models and saved queries.',
      loadError: 'Failed to load analytics workspace.',
      pageDesc: 'Governed query builder for data models with saved query execution and PII-aware result rendering.',
      tabBuilder: 'Query Builder',
      tabSaved: 'Saved Queries',
      executingQuery: 'Executing analytics query...',
      rowsReturned: (n) => `${n} row(s) returned.`,
      queryFailed: 'Query execution failed.',
      savedUpdated: 'Saved query updated.',
      savedCreated: 'Saved query created.',
      savedDeleted: 'Saved query deleted.',
      editSavedTitle: 'Edit Saved Query',
      saveQueryTitle: 'Save Query',
      visibility: 'Visibility',
      visPrivate: 'Private',
      visTeam: 'Team',
      visOrg: 'Organization',
      execState: {
        idle: 'Idle',
        running: 'Running',
        success: 'Success',
        error: 'Error',
      },
    },
    models: {
      loadingTitle: 'Model Detail',
      loadingDesc: 'Loading model schema, rules, lineage, and versions.',
      loadError: 'Failed to load model detail.',
      detailDescFallback: 'Governed model definition with schema, quality, lineage, and version history.',
      validating: 'Validating…',
      validateModel: 'Validate model',
      modelActions: 'Model actions',
      publishVersion: 'Publish version',
      deprecate: 'Deprecate',
      backToModels: 'Back to models',
      sFields: 'Fields',
      sPiiColumns: 'PII Columns',
      sUpdated: 'Updated',
      classification: 'Classification',
      openSource: 'Open source',
      tabSchema: 'Schema',
      tabQualityRules: 'Quality Rules',
      tabLineage: 'Lineage',
      tabVersions: 'Versions',
      upstreamSource: (x) => `Upstream source: ${x}`,
      sourceTableLine: (x) => `Source table: ${x}`,
      consumers: (n) => `Consumers: ${n}`,
      modelPublished: 'Model published.',
      modelDeprecated: 'Model deprecated.',
      deriveDesc: 'Select a discovered source and table to derive a governed semantic model.',
      tableLabel: 'Table',
      selectSourceFirst: 'Select a source first',
      selectTableOpt: 'Select a table',
      noTablesDiscovered: 'No tables discovered for this source. Run discovery on the source first.',
      clPublic: 'Public',
      clInternal: 'Internal',
      clConfidential: 'Confidential',
      clRestricted: 'Restricted',
      editTitle: 'Edit model',
      editTitleNamed: (name) => `Edit model: ${name}`,
      modelUpdated: 'Model updated successfully.',
      colModel: 'Model',
      colFields: 'Fields',
      colPii: 'PII',
      unmappedTable: 'Unmapped source table',
      kpiTotal: 'Total Models',
      kpiActive: 'Active',
      kpiDraft: 'Draft',
      kpiRetired: 'Deprecated / Archived',
      kpiUpdatedWeek: 'Updated This Week',
      noRules: 'No quality rules are attached to this model.',
      colField: 'Field',
      validationTitle: 'Model validation',
      validationDesc: 'Governance checks against the model schema, quality rules, and source table.',
      validatingModel: 'Validating model…',
      validationPassed: 'Validation passed',
      validationFailed: 'Validation failed',
      conformsChecks: 'The model conforms to all governance checks.',
      issuesFound: (n, suffix) => `${n} issue${suffix} found.`,
      modelFallback: 'model',
      noVersions: 'No historical versions are available for this model.',
      versionLine: (v, name) => `Version ${v} • ${name}`,
      versionMeta: (n, date) => `${n} fields • updated ${date}`,
      current: 'Current',
      fDraft: 'Draft',
      fDeprecated: 'Deprecated',
      fArchived: 'Archived',
      pageTitle: 'Data Models',
      pageDesc: 'Governed semantic models derived from discovered sources and used by analytics, quality, and lineage.',
      tagSemantic: 'Semantic layer',
      tagVersioned: 'Versioned',
      tagQualityGoverned: 'Quality-governed',
      searchPlaceholder: 'Search models...',
      emptyTitle: 'No models found',
      emptyDesc: 'No data models matched the current filters.',
      deriveFirst: 'Derive your first model',
    },
    contradictions: {
      colType: 'Type',
      colTitle: 'Title',
      colSources: 'Sources',
      colAffected: 'Affected',
      colConfidence: 'Confidence',
      colCreated: 'Created',
      investigate: 'Investigate',
      detailTitle: 'Contradiction detail',
      detailPrompt: 'Select a contradiction to inspect details.',
      confidence: (n) => `Confidence ${n}%`,
      sourceA: 'Source A',
      sourceB: 'Source B',
      sampleRecords: 'Sample Records',
      resolutionGuidance: 'Resolution Guidance',
      acceptRisk: 'Accept Risk',
      resolve: 'Resolve',
      markFalsePositive: 'Mark False Positive',
      unknownEntity: 'Unknown entity',
      resolveTitle: 'Resolve Contradiction',
      resolutionAction: 'Resolution action',
      raSourceA: 'Source A corrected',
      raSourceB: 'Source B corrected',
      raBoth: 'Both corrected',
      raReconciled: 'Data reconciled',
      raAccepted: 'Accepted as is',
      raFalsePositive: 'False positive',
      resolutionNotes: 'Resolution notes',
      submitting: 'Submitting…',
      scanTitle: 'Contradiction Scan',
      startingScan: 'Starting contradiction scan…',
      scanError: 'The scan could not be completed. Please try again.',
      retryScan: 'Retry scan',
      scanStatus: (x) => `Status: ${x}`,
      mModelsScanned: 'Models Scanned',
      mPairsCompared: 'Pairs Compared',
      mFound: 'Found',
      mTriggeredBy: 'Triggered By',
      ctLogical: 'Logical',
      ctSemantic: 'Semantic',
      ctTemporal: 'Temporal',
      ctAnalytical: 'Analytical',
      updated: 'Contradiction updated.',
      resolved: 'Contradiction resolved.',
      pageTitle: 'Contradictions',
      loadingDesc: 'Loading contradiction telemetry and active investigation queue.',
      loadError: 'Failed to load contradiction statistics.',
      pageDesc: 'Cross-source inconsistency detection, investigation workflow, and live scan orchestration.',
      scanNow: 'Scan now',
      searchPlaceholder: 'Search contradictions...',
      emptyTitle: 'No contradictions found',
      emptyDesc: 'No contradictions matched the current filters.',
      status: {
        detected: 'Detected',
        investigating: 'Investigating',
        resolved: 'Resolved',
        accepted: 'Accepted',
        false_positive: 'False positive',
      },
    },
    lineage: {
      horizontal: 'Horizontal',
      vertical: 'Vertical',
      fitToScreen: 'Fit to screen',
      zoomIn: 'Zoom +',
      zoomOut: 'Zoom -',
      reset: 'Reset',
      fullScreen: 'Full screen',
      selectNodePrompt: 'Select a node to inspect lineage details.',
      mDepth: 'Depth',
      mInbound: 'Inbound',
      mOutbound: 'Outbound',
      mCritical: 'Critical',
      impactPrompt: 'Enable impact analysis and select a node to see downstream blast radius.',
      impactTitle: 'Impact Analysis',
      mDirectlyAffected: 'Directly Affected',
      mIndirectlyAffected: 'Indirectly Affected',
      mAffectedSuites: 'Affected Suites',
      overview: 'Overview',
      minimapHint: 'Drag or click the viewport to navigate.',
      searchPlaceholder: 'Search lineage...',
      noResults: 'No results found.',
      searching: 'Searching...',
      matched: (x) => `matched: ${x}`,
      pageTitle: 'Lineage',
      loadingDesc: 'Loading lineage graph and relationship metadata.',
      loadError: 'Failed to load lineage.',
      pageDesc: 'End-to-end data flow from sources through pipelines and models to downstream consumers.',
      impactAnalysis: 'Impact Analysis',
    },
    darkData: {
      colName: 'Name',
      colType: 'Type',
      colReason: 'Reason',
      colSize: 'Size',
      colClassification: 'Classification',
      colRisk: 'Risk',
      colLastAccessed: 'Last Accessed',
      review: 'Review',
      govern: 'Govern',
      archive: 'Archive',
      scheduleDeletion: 'Schedule deletion',
      unknownLocation: 'Unknown location',
      ddActions: 'Dark data actions',
      detailTitle: 'Dark data asset',
      detailPrompt: 'Select an asset to inspect governance risk.',
      mRiskScore: 'Risk Score',
      mEstimatedSize: 'Estimated Size',
      mColumns: 'Columns',
      mLastAccessed: 'Last Accessed',
      governTitle: 'Govern Asset',
      modelName: 'Model name',
      autoGenRules: 'Auto-generate quality rules',
      governing: 'Governing…',
      kpiTotal: 'Total Assets',
      kpiHighRisk: 'High Risk',
      kpiWithPii: 'With PII',
      kpiTotalSize: 'Total Size',
      scanTitle: 'Dark Data Scan',
      startingScan: 'Starting dark data scan…',
      scanStatus: (x) => `Status: ${x}`,
      mSourcesScanned: 'Sources Scanned',
      mAssetsFound: 'Assets Found',
      mPiiAssets: 'PII Assets',
      mHighRisk: 'High Risk',
      archiveTitle: 'Archive asset',
      scheduleTitle: 'Schedule deletion',
      updateGovernance: (name) => `Update governance for ${name}.`,
      selectAsset: 'Select an asset.',
      notes: 'Notes',
      notesPlaceholder: 'Explain why this asset should be archived or scheduled for deletion.',
      saving: 'Saving…',
      assetArchived: 'Asset archived.',
      deletionScheduled: 'Deletion scheduled.',
      rUnmodeled: 'Unmodeled',
      rOrphaned: 'Orphaned',
      rStale: 'Stale',
      rUngoverned: 'Ungoverned',
      rUnclassified: 'Unclassified',
      filterGovernance: 'Governance',
      gsUnmanaged: 'Unmanaged',
      gsUnderReview: 'Under Review',
      gsGoverned: 'Governed',
      gsArchived: 'Archived',
      gsScheduled: 'Scheduled Deletion',
      broughtUnderGov: 'Asset brought under governance.',
      filterReason: 'Reason',
      pageTitle: 'Dark Data',
      loadingDesc: 'Loading dark data inventory and governance posture.',
      loadError: 'Failed to load dark data statistics.',
      pageDesc: 'Discovery and governance workflow for unmodeled, stale, or unmanaged data assets.',
      scanNow: 'Scan now',
      searchPlaceholder: 'Search dark data assets...',
      emptyTitle: 'No dark data assets found',
      emptyDesc: 'No dark data assets matched the current filters.',
    },
  },
  ar: {
    page: {
      eyebrow: 'منصة البيانات',
      title: 'جناح البيانات',
      loadingDescription:
        'عرض تشغيلي موحّد يشمل المصادر والنماذج وخطوط المعالجة والجودة وسلسلة النسب والتحليلات المحوكمة.',
      description:
        'مركز قيادة تشغيلي لمصادر البيانات وخطوط المعالجة ووضع الجودة والتناقضات والبيانات المظلمة وسلسلة النسب والتحليلات المحوكمة.',
      sourcesTag: (count) => `${count} مصدرًا`,
      activePipelinesTag: (count) => `${count} خط معالجة نشط`,
      qualityGradeTag: (grade) => `جودة بدرجة ${grade}`,
      openContradictionsTag: (count) => `${count} تناقض مفتوح`,
      statQuality: 'الجودة',
      stat30dSuccess: 'نجاح 30 يومًا',
      manageSources: 'إدارة المصادر',
      openPipelines: 'فتح خطوط المعالجة',
    },
    kpis: {
      totalSources: 'إجمالي المصادر',
      activePipelines: 'خطوط المعالجة النشطة',
      qualityScore: 'درجة الجودة',
      openContradictions: 'التناقضات المفتوحة',
      darkDataAssets: 'أصول البيانات المظلمة',
      sinceLastPeriod: 'منذ الفترة السابقة',
      failedIn24h: 'فشلت خلال 24 ساعة',
      trend: 'الاتجاه',
      perGrade: (grade) => `/ درجة ${grade}`,
      tracked: (count) => `/ ${count} متتبَّعة`,
    },
    charts: {
      pipelineSuccessTitle: 'معدل نجاح خطوط المعالجة',
      pipelineSuccessDescription: 'آخر 30 يومًا من نتائج خطوط المعالجة.',
      successRate: (value) => `معدل النجاح ${value}`,
      pipelineEmptyTitle: 'لا توجد عمليات تشغيل لخطوط المعالجة خلال آخر 30 يومًا',
      pipelineEmptyDescription:
        'خطوط المعالجة مُهيَّأة، لكن لم تُنفَّذ أي عمليات تشغيل في نافذة الاتجاه بعد. شغّل عملية لملء هذا الرسم البياني.',
      qualityTrendTitle: 'اتجاه درجة الجودة',
      qualityTrendDescription: 'درجة جودة متجددة على مدى 30 يومًا من خدمة الجودة المباشرة.',
      qualityEmptyTitle: 'لا يوجد سجل جودة خلال آخر 30 يومًا',
      qualityEmptyDescription:
        'درجة الجودة الحالية مباشرة، لكن لا توجد نتائج جودة مؤرَّخة في نافذة الاتجاه. شغّل قواعد الجودة لبناء السجل.',
      qualityScoreSeries: 'درجة الجودة',
      successSeries: 'ناجحة',
      failedSeries: 'فاشلة',
      cancelledSeries: 'ملغاة',
      sourcesByStatusTitle: 'المصادر حسب الحالة',
      sourcesByStatusDescription: 'تغطية أنواع المصادر متراكبة مع مزيج الحالة الحالي من لوحة المعلومات.',
      refreshing: 'جارٍ التحديث…',
      liveEvery60s: 'مباشر كل 60 ثانية',
      noSourceStatusData: 'لا تتوفر بيانات حالة المصادر بعد',
      statusActive: 'نشط',
      statusInactive: 'غير نشط',
      statusError: 'خطأ',
      statusSyncing: 'قيد المزامنة',
    },
    recentRuns: {
      title: 'عمليات تشغيل خطوط المعالجة الأخيرة',
      description: 'آخر 10 عمليات تنفيذ.',
      viewAll: 'عرض الكل',
      emptyTitle: 'لا توجد عمليات تشغيل حديثة لخطوط المعالجة',
      emptyDescription: 'لم تكتمل أي عمليات تنفيذ لخطوط المعالجة بعد. شغّل عملية لرؤية النشاط هنا.',
      colPipeline: 'خط المعالجة',
      colStatus: 'الحالة',
      colDuration: 'المدة',
      colCompleted: 'اكتملت',
    },
    qualityIssues: {
      title: 'مشكلات الجودة',
      description: 'القواعد الفاشلة أو التحذيرية الحالية مع السجلات المتأثرة.',
      openQuality: 'فتح الجودة',
      emptyTitle: 'لا توجد مشكلات جودة نشطة',
      emptyDescription:
        'جميع قواعد الجودة ناجحة. ستظهر حالات الفشل والتحذيرات الجديدة هنا فور اكتشافها.',
      colModel: 'النموذج',
      colRule: 'القاعدة',
      colSeverity: 'الخطورة',
      colFailures: 'حالات الفشل',
    },
    connForms: {
      host: 'المضيف',
      port: 'المنفذ',
      database: 'قاعدة البيانات',
      schema: 'المخطط',
      username: 'اسم المستخدم',
      password: 'كلمة المرور',
      accessKey: 'مفتاح الوصول',
      secretKey: 'المفتاح السري',
      bucket: 'الحاوية',
      prefix: 'البادئة',
      region: 'المنطقة',
      endpoint: 'نقطة النهاية',
      useSsl: 'استخدام SSL',
      tlsSsl: 'TLS / SSL',
      authentication: 'المصادقة',
      realm: 'المجال (Realm)',
      kdc: 'خادم KDC',
      principal: 'الحساب الرئيسي (Principal)',
      keytabPath: 'مسار Keytab',
      branch: 'الفرع',
      authNoAuth: 'بدون مصادقة',
      authUsernamePassword: 'اسم المستخدم / كلمة المرور',
      authKerberos: 'بروتوكول Kerberos',
      authSimple: 'بسيطة',
      authLdap: 'بروتوكول LDAP',
      sslMode: 'وضع SSL',
      sslDisable: 'تعطيل',
      sslAllow: 'سماح',
      sslPrefer: 'تفضيل',
      sslRequire: 'إلزام',
      sslVerifyCa: 'التحقق من CA',
      sslVerifyFull: 'تحقق كامل',
      tls: 'TLS',
      tlsEnabled: 'مُفعَّل',
      tlsPreferred: 'مُفضَّل',
      tlsSkipVerify: 'تخطي التحقق',
      tlsDisabled: 'مُعطَّل',
      baseUrl: 'عنوان URL الأساسي',
      authType: 'نوع المصادقة',
      authTypeNone: 'بدون',
      authTypeBasic: 'أساسية',
      authTypeBearer: 'مصادقة Bearer',
      authTypeApiKey: 'مفتاح API',
      authTypeOauth2: 'مصادقة OAuth2',
      paginationType: 'نوع ترقيم الصفحات',
      pagOffset: 'إزاحة',
      pagCursor: 'مؤشر',
      pagPage: 'صفحة',
      pagLinkHeader: 'ترويسة الرابط',
      rateLimit: 'حد المعدل (طلب/ث)',
      dataPath: 'مسار البيانات',
      bearerToken: 'رمز Bearer',
      keyName: 'اسم المفتاح',
      keyValue: 'قيمة المفتاح',
      location: 'الموقع',
      locHeader: 'الترويسة',
      locQuery: 'الاستعلام',
      tokenUrl: 'عنوان URL للرمز',
      clientId: 'معرّف العميل',
      clientSecret: 'سر العميل',
      scope: 'النطاق',
      customHeaders: 'ترويسات مخصصة',
      addHeader: 'إضافة ترويسة',
      noCustomHeaders: 'لا توجد ترويسات مخصصة مُهيّأة.',
      headerName: 'اسم الترويسة',
      headerValue: 'قيمة الترويسة',
      protocol: 'البروتوكول',
      protocolNative: 'أصلي',
      protocolHttp: 'بروتوكول HTTP',
      portHelpClickhouse: '9000 لبروتوكول TCP الأصلي، و8123 لبروتوكول HTTP.',
      compression: 'الضغط',
      compressionHelp: 'فعّل ضغط LZ4 لنقل أسرع.',
      tlsSslEncryptHelp: 'تشفير الاتصال بخادم ClickHouse.',
      uploadFile: 'رفع ملف',
      csvUploadHelp:
        'يستخدم الرفع خدمة الملفات للتخزين المحوكم. لا يزال عليك تأكيد حقول مسار MinIO أدناه لأن موصّل البيانات يتطلب إحداثيات تخزين صريحة.',
      minioEndpoint: 'نقطة نهاية MinIO',
      filePath: 'مسار الملف',
      delimiter: 'الفاصل',
      delimComma: 'فاصلة',
      delimTab: 'علامة جدولة',
      delimSemicolon: 'فاصلة منقوطة',
      delimPipe: 'شرطة عمودية',
      encoding: 'الترميز',
      hasHeaderRow: 'يحتوي على صف ترويسة',
      nameNodes: 'عُقَد NameNode',
      nameNodesHelp: 'أدخل عنوانًا واحدًا أو أكثر لعُقَد HDFS NameNode.',
      user: 'المستخدم',
      maxFileSizeMb: 'الحد الأقصى لحجم الملف (ميغابايت)',
      basePaths: 'المسارات الأساسية',
      basePathsHelp: 'الأدلة المراد فحصها لبيانات المستودع وفحص DSPM.',
      auditLogPath: 'مسار سجل التدقيق',
      transportMode: 'وضع النقل',
      transportBinary: 'ثنائي',
      httpPath: 'مسار HTTP',
      tlsSslHiveHelp: 'فعّل TLS عندما يكون HiveServer2 مُهيّأً بنقل آمن.',
      auditLogTable: 'جدول سجل التدقيق',
      tlsSslImpalaHelp: 'فعّل TLS عندما تكون Impala محمية بنقل آمن.',
      sqlAccess: 'الوصول عبر SQL',
      sqlAccessHelp: 'هيّئ خادم Spark Thrift لاكتشاف المخطط والوصول إلى البيانات.',
      thriftHost: 'مضيف Thrift',
      thriftPort: 'منفذ Thrift',
      monitoring: 'المراقبة',
      monitoringHelp: 'توفّر نقاط نهاية Spark REST قياسات المهام لسلسلة النسب وتحليلات سلوك المستخدمين والكيانات (UEBA).',
      masterUrl: 'عنوان URL الرئيسي',
      historyServerUrl: 'عنوان URL لخادم السجل',
      tlsSslDoltHelp: 'فعّل TLS لجلسات بروتوكول MySQL المشفّرة.',
      graphqlUrl: 'عنوان URL لـ GraphQL',
      workspace: 'مساحة العمل',
      apiToken: 'رمز API',
      timeoutSeconds: 'المهلة (بالثواني)',
      addValue: 'إضافة قيمة',
    },
    common: {
      save: 'حفظ',
      cancel: 'إلغاء',
      close: 'إغلاق',
      delete: 'حذف',
      edit: 'تعديل',
      add: 'إضافة',
      remove: 'إزالة',
      create: 'إنشاء',
      update: 'تحديث',
      apply: 'تطبيق',
      reset: 'إعادة تعيين',
      back: 'رجوع',
      next: 'التالي',
      continue: 'متابعة',
      confirm: 'تأكيد',
      retry: 'إعادة المحاولة',
      saving: 'جارٍ الحفظ…',
      loading: 'جارٍ التحميل…',
      deleting: 'جارٍ الحذف…',
      running: 'جارٍ التشغيل…',
      refreshing: 'جارٍ التحديث…',
      search: 'بحث',
      viewAll: 'عرض الكل',
      view: 'عرض',
      status: 'الحالة',
      actions: 'الإجراءات',
      name: 'الاسم',
      displayName: 'الاسم المعروض',
      description: 'الوصف',
      type: 'النوع',
      enabled: 'مُفعَّل',
      disabled: 'مُعطَّل',
      yes: 'نعم',
      no: 'لا',
      none: 'بدون',
      all: 'الكل',
      active: 'نشط',
      inactive: 'غير نشط',
      severity: 'الخطورة',
      critical: 'حرج',
      high: 'مرتفع',
      medium: 'متوسط',
      low: 'منخفض',
      passed: 'ناجحة',
      failed: 'فاشلة',
      warning: 'تحذير',
      error: 'خطأ',
      success: 'نجاح',
      pending: 'قيد الانتظار',
      running2: 'قيد التشغيل',
      completed: 'مكتملة',
      cancelled: 'ملغاة',
      runNow: 'تشغيل الآن',
      optional: 'اختياري',
      required: 'مطلوب',
    },
    quality: {
      noScores: 'لا تتوفر درجات جودة للنماذج.',
      rulesFailedSummary: (total, failed) => `${total} قاعدة • ${failed} فاشلة`,
      qualityScore: 'درجة الجودة',
      resultTitle: 'نتيجة الجودة',
      mStatus: 'الحالة',
      mChecked: 'المفحوصة',
      mFailed: 'الفاشلة',
      mDuration: 'المدة',
      mCheckedAt: 'وقت الفحص',
      mPassRate: 'معدل النجاح',
      deleteRuleTitle: 'حذف قاعدة الجودة',
      deleteRuleDesc: (name) =>
        `حذف "${name}" نهائيًا؟ سيؤدي ذلك إلى إزالة جميع النتائج التاريخية المرتبطة بهذه القاعدة.`,
      colRule: 'القاعدة',
      colLastStatus: 'آخر حالة',
      colLastRun: 'آخر تشغيل',
      neverRun: 'لم تُشغَّل بعد',
      editRuleTitle: (name) => `تعديل القاعدة: ${name}`,
      createRuleTitle: 'إنشاء قاعدة جودة',
      fModel: 'النموذج',
      selectModel: 'اختر النموذج',
      fRuleType: 'نوع القاعدة',
      rtNotNull: 'غير فارغ',
      rtUnique: 'فريد',
      rtRange: 'نطاق',
      rtRegex: 'تعبير نمطي',
      rtReferential: 'مرجعي',
      rtEnum: 'قائمة قيم',
      rtFreshness: 'حداثة',
      rtRowCount: 'عدد الصفوف',
      rtCustomSql: 'SQL مخصّص',
      rtStatistical: 'إحصائي',
      fRuleName: 'اسم القاعدة',
      fDescription: 'الوصف',
      descPlaceholder: 'ما الذي تتحقق منه هذه القاعدة ولماذا تهم.',
      allowedValuesPlaceholder: 'نشط، غير نشط، قيد الانتظار',
      tagsPlaceholder: 'حرج، مالية، ليلي',
      fColumn: 'العمود',
      selectColumn: 'اختر العمود',
      ruleConfig: 'إعدادات القاعدة',
      fMin: 'الحد الأدنى',
      fMax: 'الحد الأقصى',
      fRegexPattern: 'نمط التعبير النمطي',
      fReferenceSource: 'المصدر المرجعي',
      selectSource: 'اختر المصدر',
      fReferenceTable: 'الجدول المرجعي',
      fReferenceColumn: 'العمود المرجعي',
      fAllowedValues: 'القيم المسموح بها',
      fMaxAge: 'الحد الأقصى للعمر (ساعات)',
      fMinRowCount: 'الحد الأدنى لعدد الصفوف',
      fMaxChangePercent: 'الحد الأقصى لنسبة التغيّر',
      fSql: 'SQL',
      fZScore: 'عتبة درجة Z',
      fSchedule: 'الجدولة',
      fTags: 'الوسوم',
      enabledDesc: 'تبقى القواعد المعطَّلة في الفهرس لكنها لا تُنفَّذ.',
      saveChanges: 'حفظ التغييرات',
      createRule: 'إنشاء قاعدة',
      overallGrade: 'الدرجة الإجمالية',
      gaugeSummary: (passed, failed, warnings) =>
        `${passed} ناجحة • ${failed} فاشلة • ${warnings} تحذيرات`,
      trendEmptyTitle: 'لا يوجد سجل جودة بعد',
      trendEmptyDesc:
        'لا توجد نتائج جودة مؤرَّخة ضمن نافذة الاتجاه. شغّل قواعد الجودة لبناء اتجاه لـ 30 يومًا.',
      qualityScoreSeries: 'درجة الجودة',
      pageEyebrow: 'منصة البيانات',
      pageTitle: 'جودة البيانات',
      pageLoadingDesc: 'جارٍ تحميل الدرجة والاتجاه وقياسات القواعد المباشرة.',
      pageDesc: 'وضع جودة مباشر عبر النماذج المحوكمة وتنفيذ القواعد وحركة الاتجاه الأخيرة.',
      trendCardTitle: 'اتجاه 30 يومًا',
      modelScoresHeading: 'درجات جودة النماذج',
      searchPlaceholder: 'ابحث في قواعد الجودة...',
      emptyTitle: 'لم يُعثر على قواعد جودة',
      emptyDesc: 'لا توجد قواعد جودة مطابقة للمرشِّحات الحالية.',
      filterLastStatus: 'آخر حالة',
      toastExecuted: 'تم تنفيذ قاعدة الجودة.',
      toastExecutedDesc: (name, status) => `انتهت ${name} بالحالة ${status}.`,
      toastEnabled: 'تم تفعيل القاعدة.',
      toastDisabled: 'تم تعطيل القاعدة.',
      toastDeleted: 'تم حذف قاعدة الجودة.',
      toastUpdated: 'تم تحديث قاعدة الجودة.',
      toastCreated: 'تم إنشاء قاعدة الجودة.',
      toastGoneTitle: 'لم تعد القاعدة موجودة',
      toastGoneDesc: 'حُذفت هذه القاعدة قبل التمكّن من حفظ التحديث.',
      loadError: 'تعذّر تحميل مقاييس الجودة.',
    },
    sources: {
      pageTitle: 'مصادر البيانات',
      pageDesc: 'المصادر التشغيلية وملفات الأنظمة وواجهات API ومخازن الكائنات المتصلة والمتاحة لمنصة البيانات.',
      addSource: '+ إضافة مصدر',
      addSourceShort: 'إضافة مصدر',
      emptyTitle: 'لم يُعثر على مصادر بيانات',
      emptyDesc: 'اربط أول مصدر محوكم لبدء اكتشاف المخطط وتنسيق خطوط المعالجة.',
      searchPlaceholder: 'ابحث في المصادر...',
      pageOf: (page, total) => `الصفحة ${page} من ${total}`,
      previous: 'السابق',
      filterType: 'النوع',
      filterStatus: 'الحالة',
      statusActive: 'نشط',
      statusSyncing: 'قيد المزامنة',
      statusInactive: 'غير نشط',
      statusError: 'خطأ',
      statusPendingTest: 'بانتظار الاختبار',
      syncStarted: 'بدأت المزامنة.',
      syncStartedDesc: (name) => `تجري الآن مزامنة ${name}.`,
      sourceDeleted: 'تم حذف المصدر.',
      sourceActivated: 'تم تفعيل المصدر.',
      sourceDeactivated: 'تم تعطيل المصدر.',
      connectionTestFailed: 'فشل اختبار الاتصال',
      confirmDeleteSource: (name) => `حذف المصدر "${name}"؟`,
      activateTitle: 'تفعيل المصدر',
      deactivateTitle: 'تعطيل المصدر',
      activateConfirm: (name) => `هل أنت متأكد من رغبتك في تفعيل "${name}"؟`,
      deactivateConfirm: (name) => `هل أنت متأكد من رغبتك في تعطيل "${name}"؟`,
      activate: 'تفعيل',
      deactivate: 'تعطيل',
      stepType: 'النوع',
      stepConnection: 'الاتصال',
      stepTest: 'الاختبار',
      stepSchema: 'المخطط',
      stepConfigure: 'التهيئة',
      createTitle: 'إنشاء مصدر',
      createDesc: 'أضِف مصدرًا محوكمًا مع التحقق من الاتصال واكتشاف المخطط وتهيئة المزامنة.',
      skippedTitle: 'تم تخطّي تفاصيل التحقق',
      skippedDesc:
        'سيُنشأ المصدر أثناء اكتشاف المخطط أو عند التقديم النهائي، لذا لم يُحفظ بعد أي سجل لسلامة الاتصال.',
      creating: 'جارٍ الإنشاء…',
      createSourceBtn: 'إنشاء مصدر',
      selectTypeFirst: 'اختر نوع المصدر أولًا.',
      schemaDiscoveryFailed: 'فشل اكتشاف المخطط',
      discardChanges: 'تجاهل التغييرات؟',
      sourceCreated: 'تم إنشاء المصدر بنجاح.',
      sourceCreatedDesc: (name) => `${name} جاهز للاستخدام.`,
      editTitle: 'تعديل المصدر',
      editTitleNamed: (name) => `تعديل المصدر: ${name}`,
      tags: 'الوسوم',
      addTagPlaceholder: 'أضِف وسمًا واضغط Enter',
      syncFrequency: 'تكرار المزامنة',
      customCron: 'جدولة cron مخصّصة',
      nextRun: (time) => `التشغيل التالي: ${time}`,
      credentials: 'بيانات الاعتماد',
      credentialsHelp: 'اترك الحقل فارغًا للإبقاء على بيانات الاعتماد المخزَّنة. املأ الحقل فقط لتدويرها.',
      leaveBlankKeep: 'اترك الحقل فارغًا للإبقاء على الحالي',
      connConfigLabel: 'إعدادات الاتصال (الحقول غير الحساسة)',
      connConfigDesc: 'تُدار حقول بيانات الاعتماد أعلاه ولا تُضمَّن أبدًا في هذا الـ JSON.',
      credStrippedNote: (fields) =>
        `تُزال حقول بيانات الاعتماد (${fields}) من عرض الـ JSON لأغراض الأمان. وتُحفظ حقول بيانات الاعتماد الفارغة أعلاه من جانب الخادم تلقائيًا.`,
      sourceUpdated: 'تم تحديث المصدر بنجاح.',
      credPassword: 'كلمة المرور',
      credKeytab: 'Keytab (base64)',
      credApiToken: 'رمز API',
      credApiKey: 'مفتاح API',
      credBearer: 'رمز Bearer',
      credClientSecret: 'سر العميل',
      credAccessKeyId: 'معرّف مفتاح الوصول',
      credSecretAccessKey: 'مفتاح الوصول السري',
      credAuthToken: 'رمز المصادقة',
      freqManual: 'يدوي فقط',
      freqHourly: 'كل ساعة',
      freq6h: 'كل 6 ساعات',
      freq12h: 'كل 12 ساعة',
      freqDaily: 'يوميًا',
      freqWeekly: 'أسبوعيًا',
      freqCustom: 'مخصّص',
      noDescription: 'لا يوجد وصف.',
      cardTables: (n) => `${n} جدول`,
      cardRows: (n) => `${n} صف`,
      lastSync: (rel) => `آخر مزامنة: ${rel}`,
      viewSchema: 'عرض المخطط',
      viewPipelines: 'عرض خطوط المعالجة',
      testing: 'جارٍ الاختبار…',
      test: 'اختبار',
      sync: 'مزامنة',
      open: 'فتح',
      colTables: 'الجداول',
      colRows: 'الصفوف',
      colSize: 'الحجم',
      colLastSynced: 'آخر مزامنة',
      colSchedule: 'الجدولة',
      never: 'أبدًا',
      syncProgressTitle: 'تقدّم المزامنة',
      syncProgressTitleNamed: (name) => `تقدّم المزامنة: ${name}`,
      fetchingLatest: 'جارٍ جلب أحدث عملية مزامنة…',
      pollingEvery: 'استطلاع سجل المزامنة كل 3 ثوانٍ.',
      syncStatusError: 'تعذّر تحميل حالة المزامنة. يُرجى المحاولة مرة أخرى.',
      retryLoad: 'إعادة المحاولة',
      startedAt: (rel, type) => `بدأت ${rel} • ${type}`,
      mRowsRead: 'الصفوف المقروءة',
      mRowsWritten: 'الصفوف المكتوبة',
      mTablesSynced: 'الجداول المُزامَنة',
      mDuration: 'المدة',
      mTransferred: 'المنقول',
      mErrors: 'الأخطاء',
      syncFailedTitle: 'فشلت المزامنة',
      syncErrorCount: (n) => `أُبلِغ عن ${n} خطأ أثناء المزامنة.`,
      syncDidNotComplete: 'لم تكتمل المزامنة بنجاح.',
      retrySync: 'إعادة المزامنة',
      testingConnection: 'جارٍ اختبار الاتصال…',
      connectedIn: (ms) => `تم الاتصال خلال ${ms} مللي ثانية`,
      editConnection: 'تعديل الاتصال',
      schemaReviewTitle: 'مراجعة المخطط',
      schemaReviewDesc:
        'راجِع الجداول المكتشَفة وإشارات البيانات الشخصية قبل المتابعة. ستبقى الأعمدة الحساسة محجوبة للمستخدمين الذين لا يملكون `data:pii`.',
      schemaReviewedCheck: 'راجعتُ المخطط وتصنيفات البيانات الشخصية.',
      sourceName: 'اسم المصدر',
      testingConnectionTo: (label) => `جارٍ اختبار الاتصال بـ ${label}…`,
      provisioningVerifying: 'يجري تجهيز المصدر والتحقق منه مقابل موصّل الخادم.',
      connectedSuccessfully: 'تم الاتصال بنجاح',
      mLatency: 'زمن الاستجابة',
      mVersion: 'الإصدار',
      unknown: 'غير معروف',
      mPermissions: 'الصلاحيات',
      readAccessConfirmed: 'تم تأكيد صلاحية القراءة',
      mWarnings: 'التحذيرات',
      connectionFailed: 'فشل الاتصال',
      checkServiceReachable: 'تحقّق من إمكانية الوصول إلى الخدمة من شبكة المنصة وأن بيانات الاعتماد صحيحة.',
      continueWithoutDetails: 'المتابعة دون تفاصيل الاختبار',
      catAll: 'الكل',
      catDatabases: 'قواعد البيانات',
      catHadoop: 'Hadoop',
      catOrchestration: 'التنسيق',
      catFilesApi: 'الملفات وواجهات API',
      filesApiBadge: 'ملفات وواجهات API',
      select: 'اختيار',
      descPostgres: 'قاعدة بيانات تشغيلية علائقية',
      descMysql: 'قاعدة بيانات تشغيلية علائقية',
      descClickhouse: 'تحليلات عمودية عالية الأداء',
      descDolt: 'قاعدة بيانات SQL مُدارة بالإصدارات مع سجل التغييرات',
      descImpala: 'تحليلات SQL تفاعلية لمنصة Cloudera',
      descHive: 'مستودع HiveServer2 فوق تخزين Hadoop',
      descHdfs: 'وصول مباشر إلى نظام ملفات Hadoop الموزّع',
      descSpark: 'حوسبة موزّعة مع SQL وقياسات المهام',
      descDagster: 'تنسيق خطوط المعالجة وسلسلة نسب الأصول',
      descApi: 'تكامل مع نقطة نهاية HTTP API',
      descCsv: 'ملفات محددة الفواصل في تخزين الكائنات',
      descS3: 'حاويات مخازن الكائنات وبادئاتها',
    },
    sourcesDetail: {
      eyebrow: 'مصدر البيانات',
      loadingTitle: 'تفاصيل المصدر',
      loadingDesc: 'جارٍ تحميل بيانات المصدر الوصفية والمخطط وسلسلة النسب.',
      detailDescFallback: 'تفاصيل المصدر المحوكم مع المخطط وسلسلة النسب والجودة وسياق خطوط المعالجة.',
      loadError: 'تعذّر تحميل تفاصيل المصدر.',
      backToSources: 'العودة إلى المصادر',
      sType: 'النوع',
      tabOverview: 'نظرة عامة',
      tabSchema: 'المخطط',
      tabPipelines: 'خطوط المعالجة',
      tabQuality: 'الجودة',
      tabLineage: 'سلسلة النسب',
      tabActivity: 'النشاط',
      lastSyncLabel: 'آخر مزامنة',
      propsTitle: 'خصائص المصدر',
      pSyncFrequency: 'تكرار المزامنة',
      pSchemaDiscovered: 'تاريخ اكتشاف المخطط',
      pCreated: 'تاريخ الإنشاء',
      pUpdated: 'تاريخ التحديث',
      healthTitle: 'سلامة الاتصال',
      connValidated: 'تم التحقق من الاتصال وهو نشط.',
      currentStatus: (status) => `الحالة الحالية: ${status}`,
      latestErrorTitle: 'أحدث خطأ',
      noErrorsTitle: 'لا توجد أخطاء نشطة في الموصّل',
      noErrorsDesc: 'لا يُبلِّغ المصدر عن حالات فشل حديثة في الاتصال أو المزامنة.',
      latestSyncTitle: 'أحدث مزامنة',
      statusLine: (v) => `الحالة: ${v}`,
      rowsWrittenLine: (v) => `الصفوف المكتوبة: ${v}`,
      durationLine: (v) => `المدة: ${v}`,
      syncHistoryTitle: 'سجل المزامنة',
      noSyncHistory: 'لا يتوفر سجل مزامنة بعد.',
      rowsReadCount: (n) => `${n} صف مقروء`,
      rowsWrittenCount: (n) => `${n} صف مكتوب`,
      tablesCount: (n) => `${n} جدول`,
      selectTablePrompt: 'اختر جدولًا لفحص أعمدته ومفاتيحه وإجراءات المعاينة.',
      rowsCount: (n) => `${n} صف`,
      estimatedSize: (v) => `${v} حجم تقديري`,
      columnsCount: (n) => `${n} عمود`,
      previewData: 'معاينة البيانات',
      previewDataNamed: (name) => `معاينة البيانات: ${name}`,
      deriveModel: 'اشتقاق نموذج',
      viewInLineage: 'العرض في سلسلة النسب',
      colColumn: 'العمود',
      colDataType: 'نوع البيانات',
      colNullable: 'قابل للقيمة الفارغة',
      colPii: 'بيانات شخصية',
      colClassification: 'التصنيف',
      colDefault: 'القيمة الافتراضية',
      colSampleValues: 'قيم عيّنة',
      pkTitle: 'المفاتيح الأساسية',
      fkTitle: 'المفاتيح الأجنبية',
      idxTitle: 'الفهارس',
      pkEmpty: 'لا توجد بيانات وصفية للمفتاح الأساسي.',
      fkEmpty: 'لم تُكتشف مفاتيح أجنبية.',
      idxEmpty: 'لم يعرض الموصّل أي بيانات وصفية للفهارس.',
      keyPrimary: 'أساسي',
      keyForeign: 'أجنبي',
      lineageTitle: 'سلسلة النسب حول هذا المصدر',
      openFullLineage: 'فتح سلسلة النسب الكاملة',
      noLineage: 'لا تتوفر سلسلة نسب لهذا المصدر.',
      lNodes: 'العُقَد',
      lEdges: 'الحواف',
      lDepth: 'العمق',
      colNode: 'العُقدة',
      colLinks: 'الروابط',
      inOut: (inc, out) => `${inc} داخل / ${out} خارج`,
      previewUnavailable: 'المعاينة غير متاحة',
      previewUnavailableDesc:
        'لا يملك جدول المصدر هذا نموذجًا مشتقًا بعد. اشتق نموذجًا أولًا ثم عاين الصفوف عبر واجهة التحليلات المحوكمة.',
      piiMasked: 'البيانات الشخصية محجوبة',
      maskedColumns: (cols) => `الأعمدة المحجوبة: ${cols}`,
      tablesDiscoveredLabel: 'الجداول المكتشَفة:',
      withPiiDetected: (n) => `${n} يحتوي على بيانات شخصية`,
      noPiiDetected: 'لم تُكتشف بيانات شخصية',
      expandAll: 'توسيع الكل',
      collapseAll: 'طيّ الكل',
      piiBadge: (n) => `${n} بيانات شخصية`,
      modelsDerivedTitle: 'النماذج المشتقة من هذا المصدر',
      noModels: 'لم تُشتق أي نماذج محوكمة من هذا المصدر بعد.',
      fieldsSummary: (n, pii) => `${n} حقل • ${pii}`,
      containsPii: 'يحتوي على بيانات شخصية',
      noPii: 'لا بيانات شخصية',
      qualityRulesTitle: 'قواعد الجودة',
      noRules: 'لا توجد قواعد جودة مرتبطة بنماذج من هذا المصدر.',
      activityTimelineTitle: 'الجدول الزمني للنشاط',
      activityCreated: 'تم إنشاء المصدر',
      activityUpdated: 'تم تحديث المصدر',
      configUpdated: 'تم تحديث الإعدادات',
      syncActivity: (status) => `مزامنة ${status}`,
      syncDetail: (type, n) => `مزامنة ${type} • ${n} صف مكتوب`,
      pipelinesUsingTitle: 'خطوط المعالجة التي تستخدم هذا المصدر',
      noPipelines: 'لا توجد خطوط معالجة تشير حاليًا إلى هذا المصدر.',
      totalRuns: (n) => `${n} إجمالي عمليات التشغيل`,
      recordsProcessed: (n) => `${n} سجل معالَج`,
      lastRun: (v) => `آخر تشغيل ${v}`,
      noSchemaDiscovered: 'لم يُكتشف أي مخطط لهذا المصدر بعد.',
      searchTables: 'ابحث في الجداول...',
      deriveModelTitle: 'اشتقاق نموذج',
      deriveModelTitleNamed: (table) => `اشتقاق نموذج من ${table}`,
      modelName: 'اسم النموذج',
      autoGenRules: 'توليد قواعد الجودة تلقائيًا',
      deriving: 'جارٍ الاشتقاق…',
      deriveModelBtn: 'اشتقاق نموذج',
      modelDerived: 'تم اشتقاق النموذج بنجاح.',
      modelDerivedDesc: 'أصبح المخطط الآن متاحًا كنموذج محوكم.',
    },
    pipelines: {
      filterType: 'النوع',
      filterStatus: 'الحالة',
      ptEtl: 'ETL',
      ptElt: 'ELT',
      ptBatch: 'دُفعي',
      ptStreaming: 'تدفّقي',
      psActive: 'نشط',
      psPaused: 'موقوف مؤقتًا',
      psDisabled: 'مُعطَّل',
      psError: 'خطأ',
      pageTitle: 'خطوط المعالجة',
      pageDesc: 'سجل تشغيلي لخطوط المعالجة مع ضوابط تنفيذ مباشرة وسياق الجدولة والحجم المعالَج.',
      createPipeline: 'إنشاء خط معالجة',
      searchPlaceholder: 'ابحث في خطوط المعالجة...',
      emptyTitle: 'لم يُعثر على خطوط معالجة',
      emptyDesc: 'لا توجد خطوط معالجة مطابقة للمرشِّحات الحالية.',
      runStarted: 'بدأ تشغيل خط المعالجة.',
      runStartedDesc: (name) => `يجري الآن تنفيذ ${name}.`,
      paused: 'تم إيقاف خط المعالجة مؤقتًا.',
      pausedDesc: (name) => `لن يعمل ${name} حتى يُستأنف.`,
      resumed: 'تم استئناف خط المعالجة.',
      resumedDesc: (name) => `أصبح ${name} نشطًا مجددًا.`,
      confirmDelete: (name) => `حذف خط المعالجة "${name}"؟`,
      deleted: 'تم حذف خط المعالجة.',
      stepBasic: 'أساسي',
      stepSource: 'المصدر',
      stepTransforms: 'التحويلات',
      stepTarget: 'الوجهة',
      stepQuality: 'الجودة',
      stepSchedule: 'الجدولة',
      createTitle: 'إنشاء خط معالجة',
      createDesc: 'حدّد المصدر وتدفّق التحويلات وبوابات الجودة والجدولة لخط معالجة بيانات محوكم.',
      newPipeline: 'خط معالجة جديد',
      selectSourceToBegin: 'اختر مصدرًا للبدء.',
      targetPending: 'الوجهة معلّقة',
      scheduleLabel: 'الجدولة:',
      loadError: 'تعذّر تحميل بيانات معالج إنشاء خط المعالجة.',
      discardChanges: 'تجاهل تغييرات معالج خط المعالجة؟',
      createdSuccess: 'تم إنشاء خط المعالجة بنجاح.',
      createdSuccessDesc: (name) => `${name} جاهز للتشغيل.`,
      schemaLoadFailed: 'فشل تحميل المخطط',
      schemaLoadFailedDesc: 'تعذّر تحميل مخطط المصدر.',
      cronExpression: 'تعبير cron',
      cronDescription: 'تعبير cron من خمسة حقول بترتيب: الدقيقة الساعة اليوم الشهر يوم الأسبوع.',
      invalidCron: 'تعبير cron غير صالح',
      next5Runs: 'عمليات التشغيل الخمس التالية:',
      colPipeline: 'خط المعالجة',
      colSchedule: 'الجدولة',
      colRuns: 'عمليات التشغيل',
      colProcessed: 'المعالَج',
      colLastRun: 'آخر تشغيل',
      sourceConfigured: 'تم تهيئة المصدر',
      starting: 'جارٍ البدء…',
      runNow: 'تشغيل الآن',
      pipelineActions: 'إجراءات خط المعالجة',
      resuming: 'جارٍ الاستئناف…',
      resume: 'استئناف',
      pausing: 'جارٍ الإيقاف المؤقت…',
      pause: 'إيقاف مؤقت',
      deleting: 'جارٍ الحذف…',
      lastRunLabel: 'آخر تشغيل',
      pipelineName: 'اسم خط المعالجة',
      pipelineType: 'نوع خط المعالجة',
      tagsDesc: 'اضغط Enter لإضافة وسم.',
      descriptionPlaceholder: 'صِف ما يستخرجه خط المعالجة هذا ويحوّله ويحمّله.',
      tagsPlaceholder: 'محوكم، كل ساعة، مالية',
      source: 'المصدر',
      selectDataSource: 'اختر مصدر بيانات',
      governedDataSource: 'مصدر بيانات محوكم',
      readMode: 'وضع القراءة',
      rmTable: 'جدول',
      rmQuery: 'استعلام',
      sourceTable: 'جدول المصدر',
      loadingSchema: 'جارٍ تحميل المخطط…',
      selectTable: 'اختر جدولًا',
      sourceQuery: 'استعلام المصدر',
      enableIncremental: 'تفعيل الاستخراج التزايدي',
      incrementalField: 'الحقل التزايدي',
      selectField: 'اختر حقلًا',
      initialValue: 'القيمة الأولية',
      schemaContext: 'سياق المخطط',
      loadingRealSchema: 'جارٍ تحميل مخطط المصدر الفعلي…',
      tablesDiscovered: (n) => `${n} جدول مكتشَف`,
      selectSourceToLoad: 'اختر مصدرًا لتحميل المخطط',
      targetSource: 'مصدر الوجهة',
      optionalTargetSource: 'مصدر وجهة اختياري',
      noTargetSource: 'بدون مصدر وجهة',
      targetModel: 'نموذج الوجهة',
      optionalGovernedModel: 'نموذج محوكم اختياري',
      noModel: 'بدون نموذج',
      targetTable: 'جدول الوجهة',
      loadStrategy: 'استراتيجية التحميل',
      lsAppend: 'إلحاق',
      lsFullReplace: 'استبدال كامل',
      lsIncremental: 'تزايدي',
      lsMerge: 'دمج',
      mergeKeys: 'مفاتيح الدمج',
      scheduleMode: 'وضع الجدولة',
      smManual: 'يدوي فقط',
      smPreset: 'جدولة مُعدّة مسبقًا',
      smCustom: 'cron مخصّص',
      preset: 'الإعداد المسبق',
      choosePreset: 'اختر إعدادًا مسبقًا',
      customCron: 'cron مخصّص',
      maxRetries: 'الحد الأقصى لإعادة المحاولة',
      retryBackoff: 'مهلة إعادة المحاولة (ثانية)',
      creating: 'جارٍ الإنشاء…',
      createPipelineBtn: 'إنشاء خط معالجة',
      failOnGate: 'إفشال خط المعالجة عند فشل بوابة الجودة',
      failOnGateDesc: 'أوقف مرحلة التحميل إذا أعادت البوابة حالة فشل.',
      gate: (n) => `البوابة ${n}`,
      gateName: 'اسم البوابة',
      mNullPct: 'نسبة القيم الفارغة',
      mUniquePct: 'نسبة القيم الفريدة',
      mRowCountChange: 'تغيّر عدد الصفوف',
      mMinRowCount: 'الحد الأدنى لعدد الصفوف',
      mCustom: 'تعبير مخصّص',
      columnPlaceholder: 'العمود',
      noColumn: 'بدون عمود',
      operator: 'المُعامِل',
      threshold: 'العتبة',
      expression: 'التعبير',
      addQualityGate: 'إضافة بوابة جودة',
      transformBuilder: 'مُنشئ التحويلات',
      orderMatters: 'الترتيب مهم. تُنفَّذ التحويلات تسلسليًا على صفوف المصدر المحددة.',
      resolveIssues: 'عالِج مشكلات التحويل قبل المتابعة',
      ttRename: 'إعادة تسمية',
      ttCast: 'تحويل النوع',
      ttFilter: 'تصفية',
      ttMapValues: 'تعيين القيم',
      ttDerive: 'اشتقاق',
      ttDeduplicate: 'إزالة التكرار',
      ttAggregate: 'تجميع',
      emptyTransforms: 'أضِف تحويلًا واحدًا أو أكثر لتعريف تدفّق خط المعالجة.',
      addTransformation: 'إضافة تحويل',
      previewTransformation: 'معاينة التحويل (أول 5 صفوف)',
      before: 'قبل',
      after: 'بعد',
      step: (n) => `الخطوة ${n}`,
      collapse: 'طيّ',
      expand: 'توسيع',
      dragTransform: (n) => `اسحب التحويل ${n}`,
      removeTransform: 'إزالة التحويل',
      combineWith: 'الدمج باستخدام',
      noValueRequired: 'لا حاجة لقيمة',
      valuePlaceholder: 'القيمة',
      addCondition: 'إضافة شرط',
      originalValue: 'القيمة الأصلية',
      mappedValue: 'القيمة المُعيَّنة',
      defaultUnmapped: 'القيمة الافتراضية للعناصر غير المُعيَّنة',
      addMapping: 'إضافة تعيين',
      groupBy: 'التجميع حسب',
      alias: 'الاسم المستعار',
      addAggregation: 'إضافة تجميع',
      keyColumns: 'الأعمدة المفتاحية',
      keepLatest: 'الأحدث',
      keepFirst: 'الأول',
      orderByColumn: 'الترتيب حسب العمود',
      newColumnName: 'اسم العمود الجديد',
      functionsHint: 'الدوال: `UPPER`، `LOWER`، `TRIM`، `CONCAT`، `COALESCE`',
      expressionLabel: 'التعبير',
      availableColumns: (cols) => `الأعمدة المتاحة: ${cols}`,
      noColumnsYet: 'لم تُحدَّد أعمدة بعد',
      columnLabel: 'العمود',
      selectColumn: 'اختر العمود',
      targetType: 'النوع الهدف',
      fromLabel: 'من',
      toLabel: 'إلى',
    },
    pipelinesDetail: {
      eyebrow: 'خط المعالجة',
      loadingTitle: 'تفاصيل خط المعالجة',
      loadingDesc: 'جارٍ تحميل عمليات تشغيل خط المعالجة وإعداداته وسلسلة نسبه.',
      loadError: 'تعذّر تحميل تفاصيل خط المعالجة.',
      detailDescFallback: 'تفاصيل تنفيذ خط المعالجة وإعداداته وجودته وسلسلة نسبه.',
      runPipeline: 'تشغيل خط المعالجة',
      analyzeRootCause: 'تحليل السبب الجذري',
      backToPipelines: 'العودة إلى خطوط المعالجة',
      avgDuration: 'متوسط المدة',
      tabRuns: 'عمليات التشغيل',
      tabConfig: 'الإعدادات',
      tabQuality: 'الجودة',
      tabLineage: 'سلسلة النسب',
      tabRootCause: 'السبب الجذري',
      lastRunStatus: (date, status) => `آخر تشغيل ${date} • الحالة ${status}`,
      neverRun: 'لم يُشغَّل بعد',
      refreshAnalysis: 'تحديث التحليل',
      analyzeFailureTitle: 'تحليل فشل خط المعالجة',
      analyzeFailureDesc:
        'تتبّع الفشل إلى المنبع عبر سلسلة النسب وتغييرات المخطط وسجل التشغيل الأخير لعزل المصدر الفعلي للانقطاع.',
      selectFailedRun: 'اختر عملية تشغيل فاشلة لتحليل السبب الجذري.',
      configTitle: 'الإعدادات',
      pSourceTable: 'جدول المصدر',
      pSourceQuery: 'استعلام المصدر',
      pTargetTable: 'جدول الوجهة',
      pLoadStrategy: 'استراتيجية التحميل',
      pBatchSize: 'حجم الدُّفعة',
      pIncrementalField: 'الحقل التزايدي',
      transformFlowTitle: 'تدفّق التحويلات',
      noTransforms: 'لا توجد تحويلات مُهيّأة.',
      noRuns: 'لم تُسجَّل أي عمليات تشغيل لخط المعالجة هذا بعد.',
      colPhase: 'المرحلة',
      colLoaded: 'المُحمَّل',
      colDuration: 'المدة',
      colCompleted: 'اكتملت',
      inspect: 'فحص',
      lineagePositionTitle: 'موضع سلسلة النسب',
      openFullLineage: 'فتح سلسلة النسب الكاملة',
      noLineage: 'لا تتوفر معلومات سلسلة نسب لخط المعالجة هذا.',
      qualityGatesTitle: 'بوابات الجودة',
      noGates: 'لا توجد بوابات جودة مُهيّأة لخط المعالجة هذا.',
      runDetailTitle: 'تفاصيل التشغيل',
      runDesc: (id, status) => `التشغيل ${id} • ${status}`,
      selectRunPrompt: 'اختر عملية تشغيل لفحص المقاييس والمراحل والسجلات.',
      mCurrentPhase: 'المرحلة الحالية',
      mStarted: 'بدأت',
      mCompleted: 'اكتملت',
      mBytesWritten: 'البايتات المكتوبة',
      mExtracted: 'المُستخرَج',
      mLoaded: 'المُحمَّل',
      executionLog: 'سجل التنفيذ',
      noLogs: 'لا تتوفر سجلات لعملية التشغيل هذه.',
      pipelineRunning: 'خط المعالجة قيد التشغيل',
      processing: 'قيد المعالجة',
      loadedOf: (loaded, total) => `تم تحميل ${loaded} من ${total} سجل مرصود`,
      noGatesEvaluated: 'لم تُقيَّم أي بوابات جودة لعملية التشغيل هذه.',
      gateValue: (v) => `القيمة ${v}`,
    },
    analytics: {
      searchModels: 'ابحث في النماذج أو الأعمدة...',
      fieldsCount: (n) => `${n} حقل`,
      piiColumns: (n) => `• ${n} عمود بيانات شخصية`,
      modelHeading: 'النموذج',
      selectModel: 'اختر نموذجًا',
      columnsHeading: 'الأعمدة',
      selectAll: 'تحديد الكل',
      deselectAll: 'إلغاء تحديد الكل',
      selectModelPrompt: 'اختر نموذجًا لاختيار الأعمدة.',
      filtersHeading: 'عوامل التصفية',
      addFilter: 'إضافة عامل تصفية',
      aggregationsHeading: 'التجميعات',
      groupByHeading: 'التجميع حسب',
      orderByHeading: 'الترتيب حسب',
      addOrder: 'إضافة ترتيب',
      limitHeading: 'الحد',
      running: 'جارٍ التنفيذ…',
      runQuery: 'تشغيل الاستعلام',
      saveQuery: 'حفظ الاستعلام',
      clear: 'مسح',
      opEquals: 'يساوي',
      opNotEquals: 'لا يساوي',
      opGreaterThan: 'أكبر من',
      opGreaterOrEqual: 'أكبر من أو يساوي',
      opLessThan: 'أصغر من',
      opLessOrEqual: 'أصغر من أو يساوي',
      opIn: 'ضمن',
      opNotIn: 'ليس ضمن',
      opLike: 'يشبه',
      opIlike: 'يشبه (غير حسّاس لحالة الأحرف)',
      opBetween: 'بين',
      opIsNull: 'فارغ',
      opIsNotNull: 'غير فارغ',
      commaSeparated: 'قيم مفصولة بفواصل',
      runQueryPrompt: 'شغّل استعلامًا لرؤية نتائج التحليلات المحوكمة.',
      showingResults: (shown, total) => `عرض ${shown} من ${total} نتيجة`,
      completedIn: (ms) => `اكتمل خلال ${ms} مللي ثانية`,
      resultsTruncated: 'اقتُصّت النتائج إلى الحد المحدد.',
      piiColumnsMasked: (cols) => `أعمدة البيانات الشخصية المحجوبة: ${cols}`,
      sensitiveFields: 'حقول حساسة',
      noSavedQueries: 'لا توجد استعلامات محفوظة بعد.',
      colModel: 'النموذج',
      colLastRun: 'آخر تشغيل',
      colRuns: 'عمليات التشغيل',
      run: 'تشغيل',
      pageTitle: 'التحليلات',
      loadingDesc: 'جارٍ تحميل النماذج المحوكمة والاستعلامات المحفوظة.',
      loadError: 'تعذّر تحميل مساحة عمل التحليلات.',
      pageDesc: 'مُنشئ استعلامات محوكم لنماذج البيانات مع تنفيذ الاستعلامات المحفوظة وعرض النتائج المراعي للبيانات الشخصية.',
      tabBuilder: 'مُنشئ الاستعلامات',
      tabSaved: 'الاستعلامات المحفوظة',
      executingQuery: 'جارٍ تنفيذ استعلام التحليلات...',
      rowsReturned: (n) => `تم إرجاع ${n} صف.`,
      queryFailed: 'فشل تنفيذ الاستعلام.',
      savedUpdated: 'تم تحديث الاستعلام المحفوظ.',
      savedCreated: 'تم إنشاء الاستعلام المحفوظ.',
      savedDeleted: 'تم حذف الاستعلام المحفوظ.',
      editSavedTitle: 'تعديل الاستعلام المحفوظ',
      saveQueryTitle: 'حفظ الاستعلام',
      visibility: 'الظهور',
      visPrivate: 'خاص',
      visTeam: 'الفريق',
      visOrg: 'المؤسسة',
      execState: {
        idle: 'خامل',
        running: 'قيد التشغيل',
        success: 'نجاح',
        error: 'خطأ',
      },
    },
    models: {
      loadingTitle: 'تفاصيل النموذج',
      loadingDesc: 'جارٍ تحميل مخطط النموذج والقواعد وسلسلة النسب والإصدارات.',
      loadError: 'تعذّر تحميل تفاصيل النموذج.',
      detailDescFallback: 'تعريف نموذج محوكم مع المخطط والجودة وسلسلة النسب وسجل الإصدارات.',
      validating: 'جارٍ التحقق…',
      validateModel: 'التحقق من النموذج',
      modelActions: 'إجراءات النموذج',
      publishVersion: 'نشر إصدار',
      deprecate: 'إيقاف',
      backToModels: 'العودة إلى النماذج',
      sFields: 'الحقول',
      sPiiColumns: 'أعمدة البيانات الشخصية',
      sUpdated: 'آخر تحديث',
      classification: 'التصنيف',
      openSource: 'فتح المصدر',
      tabSchema: 'المخطط',
      tabQualityRules: 'قواعد الجودة',
      tabLineage: 'سلسلة النسب',
      tabVersions: 'الإصدارات',
      upstreamSource: (x) => `المصدر الأعلى: ${x}`,
      sourceTableLine: (x) => `جدول المصدر: ${x}`,
      consumers: (n) => `المستهلكون: ${n}`,
      modelPublished: 'تم نشر النموذج.',
      modelDeprecated: 'تم إيقاف النموذج.',
      deriveDesc: 'اختر مصدرًا وجدولًا مكتشَفَين لاشتقاق نموذج دلالي محوكم.',
      tableLabel: 'الجدول',
      selectSourceFirst: 'اختر مصدرًا أولًا',
      selectTableOpt: 'اختر جدولًا',
      noTablesDiscovered: 'لم تُكتشف جداول لهذا المصدر. شغّل الاكتشاف على المصدر أولًا.',
      clPublic: 'عام',
      clInternal: 'داخلي',
      clConfidential: 'سرّي',
      clRestricted: 'مقيَّد',
      editTitle: 'تعديل النموذج',
      editTitleNamed: (name) => `تعديل النموذج: ${name}`,
      modelUpdated: 'تم تحديث النموذج بنجاح.',
      colModel: 'النموذج',
      colFields: 'الحقول',
      colPii: 'بيانات شخصية',
      unmappedTable: 'جدول مصدر غير مربوط',
      kpiTotal: 'إجمالي النماذج',
      kpiActive: 'نشط',
      kpiDraft: 'مسودة',
      kpiRetired: 'مُوقَف / مؤرشف',
      kpiUpdatedWeek: 'مُحدَّث هذا الأسبوع',
      noRules: 'لا توجد قواعد جودة مرتبطة بهذا النموذج.',
      colField: 'الحقل',
      validationTitle: 'التحقق من النموذج',
      validationDesc: 'فحوص الحوكمة مقابل مخطط النموذج وقواعد الجودة وجدول المصدر.',
      validatingModel: 'جارٍ التحقق من النموذج…',
      validationPassed: 'نجح التحقق',
      validationFailed: 'فشل التحقق',
      conformsChecks: 'يتوافق النموذج مع جميع فحوص الحوكمة.',
      issuesFound: (n, suffix) => `عُثر على ${n} مشكلة${suffix ? '' : ''}.`,
      modelFallback: 'النموذج',
      noVersions: 'لا تتوفر إصدارات تاريخية لهذا النموذج.',
      versionLine: (v, name) => `الإصدار ${v} • ${name}`,
      versionMeta: (n, date) => `${n} حقل • حُدِّث ${date}`,
      current: 'الحالي',
      fDraft: 'مسودة',
      fDeprecated: 'مُوقَف',
      fArchived: 'مؤرشف',
      pageTitle: 'نماذج البيانات',
      pageDesc: 'نماذج دلالية محوكمة مشتقة من المصادر المكتشَفة وتستخدمها التحليلات والجودة وسلسلة النسب.',
      tagSemantic: 'الطبقة الدلالية',
      tagVersioned: 'مُدار بالإصدارات',
      tagQualityGoverned: 'محوكم بالجودة',
      searchPlaceholder: 'ابحث في النماذج...',
      emptyTitle: 'لم يُعثر على نماذج',
      emptyDesc: 'لا توجد نماذج بيانات مطابقة للمرشِّحات الحالية.',
      deriveFirst: 'اشتق أول نموذج لك',
    },
    contradictions: {
      colType: 'النوع',
      colTitle: 'العنوان',
      colSources: 'المصادر',
      colAffected: 'المتأثرة',
      colConfidence: 'الثقة',
      colCreated: 'تاريخ الإنشاء',
      investigate: 'تحقيق',
      detailTitle: 'تفاصيل التناقض',
      detailPrompt: 'اختر تناقضًا لفحص التفاصيل.',
      confidence: (n) => `الثقة ${n}%`,
      sourceA: 'المصدر أ',
      sourceB: 'المصدر ب',
      sampleRecords: 'سجلات عيّنة',
      resolutionGuidance: 'إرشادات المعالجة',
      acceptRisk: 'قبول المخاطرة',
      resolve: 'معالجة',
      markFalsePositive: 'وضع علامة إنذار كاذب',
      unknownEntity: 'كيان غير معروف',
      resolveTitle: 'معالجة التناقض',
      resolutionAction: 'إجراء المعالجة',
      raSourceA: 'تم تصحيح المصدر أ',
      raSourceB: 'تم تصحيح المصدر ب',
      raBoth: 'تم تصحيح كليهما',
      raReconciled: 'تمت مطابقة البيانات',
      raAccepted: 'مقبول كما هو',
      raFalsePositive: 'إنذار كاذب',
      resolutionNotes: 'ملاحظات المعالجة',
      submitting: 'جارٍ الإرسال…',
      scanTitle: 'فحص التناقضات',
      startingScan: 'جارٍ بدء فحص التناقضات…',
      scanError: 'تعذّر إكمال الفحص. يُرجى المحاولة مرة أخرى.',
      retryScan: 'إعادة المحاولة',
      scanStatus: (x) => `الحالة: ${x}`,
      mModelsScanned: 'النماذج المفحوصة',
      mPairsCompared: 'الأزواج المقارَنة',
      mFound: 'المكتشَفة',
      mTriggeredBy: 'بدأها',
      ctLogical: 'منطقي',
      ctSemantic: 'دلالي',
      ctTemporal: 'زمني',
      ctAnalytical: 'تحليلي',
      updated: 'تم تحديث التناقض.',
      resolved: 'تمت معالجة التناقض.',
      pageTitle: 'التناقضات',
      loadingDesc: 'جارٍ تحميل قياسات التناقضات وقائمة التحقيقات النشطة.',
      loadError: 'تعذّر تحميل إحصاءات التناقضات.',
      pageDesc: 'اكتشاف عدم الاتساق عبر المصادر وسير عمل التحقيق وتنسيق الفحص المباشر.',
      scanNow: 'افحص الآن',
      searchPlaceholder: 'ابحث في التناقضات...',
      emptyTitle: 'لم يُعثر على تناقضات',
      emptyDesc: 'لا توجد تناقضات مطابقة للمرشِّحات الحالية.',
      status: {
        detected: 'مُكتشَف',
        investigating: 'قيد التحقيق',
        resolved: 'مُعالَجة',
        accepted: 'مقبولة',
        false_positive: 'إيجابية كاذبة',
      },
    },
    lineage: {
      horizontal: 'أفقي',
      vertical: 'عمودي',
      fitToScreen: 'ملاءمة الشاشة',
      zoomIn: 'تكبير +',
      zoomOut: 'تصغير -',
      reset: 'إعادة تعيين',
      fullScreen: 'ملء الشاشة',
      selectNodePrompt: 'اختر عُقدة لفحص تفاصيل سلسلة النسب.',
      mDepth: 'العمق',
      mInbound: 'الوارد',
      mOutbound: 'الصادر',
      mCritical: 'حرج',
      impactPrompt: 'فعّل تحليل الأثر واختر عُقدة لرؤية نطاق التأثير في المصب.',
      impactTitle: 'تحليل الأثر',
      mDirectlyAffected: 'المتأثرة مباشرة',
      mIndirectlyAffected: 'المتأثرة غير مباشرة',
      mAffectedSuites: 'الأجنحة المتأثرة',
      overview: 'نظرة عامة',
      minimapHint: 'اسحب أو انقر على نافذة العرض للتنقل.',
      searchPlaceholder: 'ابحث في سلسلة النسب...',
      noResults: 'لم يُعثر على نتائج.',
      searching: 'جارٍ البحث...',
      matched: (x) => `مطابقة: ${x}`,
      pageTitle: 'سلسلة النسب',
      loadingDesc: 'جارٍ تحميل رسم سلسلة النسب والبيانات الوصفية للعلاقات.',
      loadError: 'تعذّر تحميل سلسلة النسب.',
      pageDesc: 'تدفّق البيانات من طرف إلى طرف من المصادر عبر خطوط المعالجة والنماذج إلى المستهلكين في المصب.',
      impactAnalysis: 'تحليل الأثر',
    },
    darkData: {
      colName: 'الاسم',
      colType: 'النوع',
      colReason: 'السبب',
      colSize: 'الحجم',
      colClassification: 'التصنيف',
      colRisk: 'المخاطرة',
      colLastAccessed: 'آخر وصول',
      review: 'مراجعة',
      govern: 'حوكمة',
      archive: 'أرشفة',
      scheduleDeletion: 'جدولة الحذف',
      unknownLocation: 'موقع غير معروف',
      ddActions: 'إجراءات البيانات المظلمة',
      detailTitle: 'أصل بيانات مظلمة',
      detailPrompt: 'اختر أصلًا لفحص مخاطر الحوكمة.',
      mRiskScore: 'درجة المخاطرة',
      mEstimatedSize: 'الحجم التقديري',
      mColumns: 'الأعمدة',
      mLastAccessed: 'آخر وصول',
      governTitle: 'حوكمة الأصل',
      modelName: 'اسم النموذج',
      autoGenRules: 'توليد قواعد الجودة تلقائيًا',
      governing: 'جارٍ الحوكمة…',
      kpiTotal: 'إجمالي الأصول',
      kpiHighRisk: 'مخاطرة مرتفعة',
      kpiWithPii: 'تحتوي على بيانات شخصية',
      kpiTotalSize: 'الحجم الإجمالي',
      scanTitle: 'فحص البيانات المظلمة',
      startingScan: 'جارٍ بدء فحص البيانات المظلمة…',
      scanStatus: (x) => `الحالة: ${x}`,
      mSourcesScanned: 'المصادر المفحوصة',
      mAssetsFound: 'الأصول المكتشَفة',
      mPiiAssets: 'أصول البيانات الشخصية',
      mHighRisk: 'مخاطرة مرتفعة',
      archiveTitle: 'أرشفة الأصل',
      scheduleTitle: 'جدولة الحذف',
      updateGovernance: (name) => `تحديث حوكمة ${name}.`,
      selectAsset: 'اختر أصلًا.',
      notes: 'ملاحظات',
      notesPlaceholder: 'اشرح سبب وجوب أرشفة هذا الأصل أو جدولته للحذف.',
      saving: 'جارٍ الحفظ…',
      assetArchived: 'تمت أرشفة الأصل.',
      deletionScheduled: 'تمت جدولة الحذف.',
      rUnmodeled: 'غير مُنمذَج',
      rOrphaned: 'يتيم',
      rStale: 'قديم',
      rUngoverned: 'غير محوكم',
      rUnclassified: 'غير مصنَّف',
      filterGovernance: 'الحوكمة',
      gsUnmanaged: 'غير مُدار',
      gsUnderReview: 'قيد المراجعة',
      gsGoverned: 'محوكم',
      gsArchived: 'مؤرشف',
      gsScheduled: 'مُجدوَل للحذف',
      broughtUnderGov: 'تم إخضاع الأصل للحوكمة.',
      filterReason: 'السبب',
      pageTitle: 'البيانات المظلمة',
      loadingDesc: 'جارٍ تحميل جرد البيانات المظلمة ووضع الحوكمة.',
      loadError: 'تعذّر تحميل إحصاءات البيانات المظلمة.',
      pageDesc: 'سير عمل الاكتشاف والحوكمة للأصول غير المُنمذَجة أو القديمة أو غير المُدارة.',
      scanNow: 'افحص الآن',
      searchPlaceholder: 'ابحث في أصول البيانات المظلمة...',
      emptyTitle: 'لم يُعثر على أصول بيانات مظلمة',
      emptyDesc: 'لا توجد أصول بيانات مظلمة مطابقة للمرشِّحات الحالية.',
    },
  },
};

export function useDataLabels(): DataLabels {
  return useBilingual(dataLabels);
}

registerMessages('data', dataLabels);
