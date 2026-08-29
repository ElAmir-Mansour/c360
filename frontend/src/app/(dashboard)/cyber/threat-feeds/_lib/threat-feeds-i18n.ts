/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber *Threat Feeds* area (`/cyber/threat-feeds/**`).
 *
 * Same `{ en, ar }` bundle pattern as the alerts/events bundles: components read
 * the resolved `T` from `useThreatFeedLabels()`, which falls back to English
 * when no LocaleProvider is mounted. The `en` side equals the pre-existing
 * English strings VERBATIM.
 *
 * Acronyms / product names stay as-is across both locales: STIX, TAXII, MISP,
 * CSV, IOC, URL, API, PEM, UUID.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveCyberBilingual, type CyberBilingual } from '../../_lib/cyber-i18n';

interface ThreatFeedLabels {
  page: {
    title: string;
    description: string;
    syncing: string;
    addFeed: string;
    statActiveFeeds: string;
    statConfiguredFeeds: string;
    statLastSync: string;
    never: string;
    indicatorsImported: (count: number, feed: string) => string;
    unableToSync: string;
    feedDeleted: (feed: string) => string;
    deleteTitle: string;
    deleteDescription: (feed: string) => string;
    deleting: string;
    delete: string;
  };
  list: {
    feed: string;
    type: string;
    url: string;
    status: string;
    lastSync: string;
    imported: string;
    nextSync: string;
    manualFeed: string;
    never: string;
    manual: string;
    viewDetails: string;
    editFeed: string;
    syncNow: string;
    deleteFeed: string;
    searchPlaceholder: string;
  };
  detail: {
    fallbackTitle: string;
    configDescription: (type: string) => string;
    detailDescription: string;
    selectFeed: string;
    enabled: string;
    paused: string;
    manualFeedNoUrl: string;
    editFeed: string;
    syncNow: string;
    syncing: string;
    indicatorsImported: (count: number) => string;
    configuration: string;
    syncInterval: string;
    defaultSeverity: string;
    defaultConfidence: string;
    indicatorFilter: string;
    allTypes: string;
    tags: string;
    noDefaults: string;
    syncState: string;
    lastSync: string;
    never: string;
    lastStatus: string;
    notSyncedYet: string;
    nextSync: string;
    manualOnly: string;
    authType: string;
    lastSyncError: string;
    importHistory: string;
    loadingHistory: string;
    colStarted: string;
    colStatus: string;
    colImported: string;
    colDuration: string;
    noExecutions: string;
    lastImportPreview: string;
    colType: string;
    colValue: string;
    colSeverity: string;
    noPreview: string;
  };
  form: {
    editTitle: string;
    addTitle: string;
    description: string;
    name: string;
    namePlaceholder: string;
    type: string;
    syncInterval: string;
    url: string;
    urlPlaceholder: string;
    authentication: string;
    defaultSeverity: string;
    apiKey: string;
    username: string;
    password: string;
    certificate: string;
    certificatePlaceholder: string;
    privateKey: string;
    privateKeyPlaceholder: string;
    defaultConfidence: (value: number) => string;
    defaultTags: string;
    defaultTagsPlaceholder: string;
    indicatorTypeFilter: string;
    indicatorTypeFilterDescription: string;
    allIndicatorTypes: string;
    enableFeed: string;
    enableFeedDescription: string;
    cancel: string;
    saving: string;
    saveFeed: string;
    createFeed: string;
    severityCritical: string;
    severityHigh: string;
    severityMedium: string;
    severityLow: string;
    feedCreated: string;
    feedUpdated: string;
    nameRequired: string;
    urlRequiredForType: string;
    enterValidUrl: string;
    apiKeyRequired: string;
    usernamePasswordRequired: string;
  };
}

export const threatFeedLabels: CyberBilingual<ThreatFeedLabels> = {
  en: {
    page: {
      title: 'Threat Intelligence Feeds',
      description:
        'Configure external IOC sources, control sync cadence, and inspect the last ingest preview before those indicators enter your tenant.',
      syncing: 'Syncing…',
      addFeed: 'Add Feed',
      statActiveFeeds: 'Active Feeds',
      statConfiguredFeeds: 'Configured Feeds',
      statLastSync: 'Last Sync',
      never: 'Never',
      indicatorsImported: (count, feed) => `${count} indicators imported from ${feed}`,
      unableToSync: 'Unable to sync feed',
      feedDeleted: (feed) => `Feed "${feed}" deleted`,
      deleteTitle: 'Delete threat feed',
      deleteDescription: (feed) =>
        `Are you sure you want to delete "${feed}"? Previously imported indicators will not be removed.`,
      deleting: 'Deleting…',
      delete: 'Delete',
    },
    list: {
      feed: 'Feed',
      type: 'Type',
      url: 'URL',
      status: 'Status',
      lastSync: 'Last Sync',
      imported: 'Imported',
      nextSync: 'Next Sync',
      manualFeed: 'Manual feed',
      never: 'Never',
      manual: 'Manual',
      viewDetails: 'View details',
      editFeed: 'Edit feed',
      syncNow: 'Sync now',
      deleteFeed: 'Delete feed',
      searchPlaceholder: 'Search feeds…',
    },
    detail: {
      fallbackTitle: 'Threat Feed',
      configDescription: (type) => `${type} feed configuration`,
      detailDescription: 'Threat feed detail',
      selectFeed: 'Select a feed to inspect its sync history.',
      enabled: 'Enabled',
      paused: 'Paused',
      manualFeedNoUrl: 'Manual feed without remote URL',
      editFeed: 'Edit Feed',
      syncNow: 'Sync Now',
      syncing: 'Syncing…',
      indicatorsImported: (count) => `${count} indicators imported`,
      configuration: 'Configuration',
      syncInterval: 'Sync Interval',
      defaultSeverity: 'Default Severity',
      defaultConfidence: 'Default Confidence',
      indicatorFilter: 'Indicator Filter',
      allTypes: 'All types',
      tags: 'Tags',
      noDefaults: 'No defaults',
      syncState: 'Sync State',
      lastSync: 'Last Sync',
      never: 'Never',
      lastStatus: 'Last Status',
      notSyncedYet: 'Not synced yet',
      nextSync: 'Next Sync',
      manualOnly: 'Manual only',
      authType: 'Auth Type',
      lastSyncError: 'Last Sync Error',
      importHistory: 'Import History',
      loadingHistory: 'Loading sync history…',
      colStarted: 'Started',
      colStatus: 'Status',
      colImported: 'Imported',
      colDuration: 'Duration',
      noExecutions: 'No sync executions recorded yet.',
      lastImportPreview: 'Last Import Preview',
      colType: 'Type',
      colValue: 'Value',
      colSeverity: 'Severity',
      noPreview: 'The last sync did not record a preview payload.',
    },
    form: {
      editTitle: 'Edit Threat Feed',
      addTitle: 'Add Threat Feed',
      description:
        'Configure the source, authentication, and import defaults the ingestion pipeline should apply.',
      name: 'Name',
      namePlaceholder: 'MISP community feed',
      type: 'Type',
      syncInterval: 'Sync Interval',
      url: 'URL',
      urlPlaceholder: 'https://intel.example.com/feed.json',
      authentication: 'Authentication',
      defaultSeverity: 'Default Severity',
      apiKey: 'API Key',
      username: 'Username',
      password: 'Password',
      certificate: 'Certificate',
      certificatePlaceholder: 'PEM certificate',
      privateKey: 'Private Key',
      privateKeyPlaceholder: 'PEM private key',
      defaultConfidence: (value) => `Default Confidence (${value}%)`,
      defaultTags: 'Default Tags',
      defaultTagsPlaceholder: 'community, inbound, watchlist',
      indicatorTypeFilter: 'Indicator Type Filter',
      indicatorTypeFilterDescription: 'Leave empty to ingest all IOC types the feed publishes.',
      allIndicatorTypes: 'All indicator types',
      enableFeed: 'Enable feed',
      enableFeedDescription: 'Disabled feeds remain configured but do not schedule syncs.',
      cancel: 'Cancel',
      saving: 'Saving…',
      saveFeed: 'Save Feed',
      createFeed: 'Create Feed',
      severityCritical: 'Critical',
      severityHigh: 'High',
      severityMedium: 'Medium',
      severityLow: 'Low',
      feedCreated: 'Threat feed created',
      feedUpdated: 'Threat feed updated',
      nameRequired: 'Name is required',
      urlRequiredForType: 'URL is required for this feed type',
      enterValidUrl: 'Enter a valid URL',
      apiKeyRequired: 'API key is required',
      usernamePasswordRequired: 'Username and password are required',
    },
  },
  ar: {
    page: {
      title: 'خلاصات الاستخبارات التهديدية',
      description:
        'هيّئ مصادر مؤشرات الاختراق الخارجية، وتحكّم في وتيرة المزامنة، وافحص معاينة آخر استيراد قبل دخول تلك المؤشرات إلى مستأجرك.',
      syncing: 'جارٍ المزامنة…',
      addFeed: 'إضافة خلاصة',
      statActiveFeeds: 'الخلاصات النشطة',
      statConfiguredFeeds: 'الخلاصات المهيّأة',
      statLastSync: 'آخر مزامنة',
      never: 'مطلقًا',
      indicatorsImported: (count, feed) => `تم استيراد ${count} مؤشر من ${feed}`,
      unableToSync: 'تعذّرت مزامنة الخلاصة',
      feedDeleted: (feed) => `تم حذف الخلاصة "${feed}"`,
      deleteTitle: 'حذف خلاصة التهديدات',
      deleteDescription: (feed) =>
        `هل أنت متأكد من حذف "${feed}"؟ لن تُزال المؤشرات المستوردة سابقًا.`,
      deleting: 'جارٍ الحذف…',
      delete: 'حذف',
    },
    list: {
      feed: 'الخلاصة',
      type: 'النوع',
      url: 'الرابط',
      status: 'الحالة',
      lastSync: 'آخر مزامنة',
      imported: 'المستورَد',
      nextSync: 'المزامنة التالية',
      manualFeed: 'خلاصة يدوية',
      never: 'مطلقًا',
      manual: 'يدوي',
      viewDetails: 'عرض التفاصيل',
      editFeed: 'تعديل الخلاصة',
      syncNow: 'مزامنة الآن',
      deleteFeed: 'حذف الخلاصة',
      searchPlaceholder: 'ابحث في الخلاصات…',
    },
    detail: {
      fallbackTitle: 'خلاصة التهديدات',
      configDescription: (type) => `إعدادات خلاصة ${type}`,
      detailDescription: 'تفاصيل خلاصة التهديدات',
      selectFeed: 'اختر خلاصة لفحص سجل مزامنتها.',
      enabled: 'مُفعّلة',
      paused: 'موقوفة مؤقتًا',
      manualFeedNoUrl: 'خلاصة يدوية بدون رابط بعيد',
      editFeed: 'تعديل الخلاصة',
      syncNow: 'مزامنة الآن',
      syncing: 'جارٍ المزامنة…',
      indicatorsImported: (count) => `تم استيراد ${count} مؤشر`,
      configuration: 'الإعدادات',
      syncInterval: 'فترة المزامنة',
      defaultSeverity: 'الخطورة الافتراضية',
      defaultConfidence: 'الثقة الافتراضية',
      indicatorFilter: 'تصفية المؤشرات',
      allTypes: 'جميع الأنواع',
      tags: 'الوسوم',
      noDefaults: 'لا توجد افتراضات',
      syncState: 'حالة المزامنة',
      lastSync: 'آخر مزامنة',
      never: 'مطلقًا',
      lastStatus: 'آخر حالة',
      notSyncedYet: 'لم تتم المزامنة بعد',
      nextSync: 'المزامنة التالية',
      manualOnly: 'يدوية فقط',
      authType: 'نوع المصادقة',
      lastSyncError: 'خطأ آخر مزامنة',
      importHistory: 'سجل الاستيراد',
      loadingHistory: 'جارٍ تحميل سجل المزامنة…',
      colStarted: 'بدأت في',
      colStatus: 'الحالة',
      colImported: 'المستورَد',
      colDuration: 'المدة',
      noExecutions: 'لم تُسجَّل أي عمليات مزامنة بعد.',
      lastImportPreview: 'معاينة آخر استيراد',
      colType: 'النوع',
      colValue: 'القيمة',
      colSeverity: 'الخطورة',
      noPreview: 'لم تسجّل آخر مزامنة حمولة معاينة.',
    },
    form: {
      editTitle: 'تعديل خلاصة التهديدات',
      addTitle: 'إضافة خلاصة تهديدات',
      description: 'هيّئ المصدر والمصادقة وافتراضات الاستيراد التي يجب أن يطبّقها مسار الاستيعاب.',
      name: 'الاسم',
      namePlaceholder: 'MISP community feed',
      type: 'النوع',
      syncInterval: 'فترة المزامنة',
      url: 'الرابط',
      urlPlaceholder: 'https://intel.example.com/feed.json',
      authentication: 'المصادقة',
      defaultSeverity: 'الخطورة الافتراضية',
      apiKey: 'مفتاح API',
      username: 'اسم المستخدم',
      password: 'كلمة المرور',
      certificate: 'الشهادة',
      certificatePlaceholder: 'شهادة PEM',
      privateKey: 'المفتاح الخاص',
      privateKeyPlaceholder: 'مفتاح PEM الخاص',
      defaultConfidence: (value) => `الثقة الافتراضية (${value}%)`,
      defaultTags: 'الوسوم الافتراضية',
      defaultTagsPlaceholder: 'community, inbound, watchlist',
      indicatorTypeFilter: 'تصفية أنواع المؤشرات',
      indicatorTypeFilterDescription: 'اتركه فارغًا لاستيعاب جميع أنواع مؤشرات الاختراق التي تنشرها الخلاصة.',
      allIndicatorTypes: 'جميع أنواع المؤشرات',
      enableFeed: 'تفعيل الخلاصة',
      enableFeedDescription: 'تبقى الخلاصات المعطَّلة مهيّأة لكنها لا تجدول عمليات مزامنة.',
      cancel: 'إلغاء',
      saving: 'جارٍ الحفظ…',
      saveFeed: 'حفظ الخلاصة',
      createFeed: 'إنشاء الخلاصة',
      severityCritical: 'حرج',
      severityHigh: 'عالٍ',
      severityMedium: 'متوسط',
      severityLow: 'منخفض',
      feedCreated: 'تم إنشاء خلاصة التهديدات',
      feedUpdated: 'تم تحديث خلاصة التهديدات',
      nameRequired: 'الاسم مطلوب',
      urlRequiredForType: 'الرابط مطلوب لهذا النوع من الخلاصات',
      enterValidUrl: 'أدخل رابطًا صالحًا',
      apiKeyRequired: 'مفتاح API مطلوب',
      usernamePasswordRequired: 'اسم المستخدم وكلمة المرور مطلوبان',
    },
  },
};

export function useThreatFeedLabels(): ThreatFeedLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(threatFeedLabels, locale), [locale]);
}
