/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber *Events* area (`/cyber/events/**`).
 *
 * Same `{ en, ar }` bundle pattern as the alerts bundle: components read the
 * resolved `T` from `useEventLabels()`, which falls back to English when no
 * LocaleProvider is mounted. The `en` side equals the pre-existing English.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveCyberBilingual, type CyberBilingual } from '../../alerts/_lib/alerts-i18n';

interface EventLabels {
  page: {
    title: string;
    description: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  kpi: {
    totalEvents: string;
    sources: string;
    eventTypes: string;
    criticalHigh: string;
  };
  charts: {
    eventsBySource: string;
    eventsByType: string;
    eventsBySeverity: string;
    events: string;
    eventsCenterLabel: string;
  };
  rowActions: {
    copyId: string;
    copyRawJson: string;
    eventIdCopied: string;
    rawJsonCopied: string;
    exportDownloaded: string;
    exportFailedTitle: string;
    exportFailedBody: string;
  };
  filters: {
    timeRange: string;
    severity: string;
    protocol: string;
    source: string;
    eventType: string;
    sourceIp: string;
    destIp: string;
    username: string;
    process: string;
    command: string;
    fileHash: string;
    ruleId: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    info: string;
    placeholderSource: string;
    placeholderType: string;
    placeholderSourceIp: string;
    placeholderDestIp: string;
    placeholderUsername: string;
    placeholderProcess: string;
    placeholderCommand: string;
    placeholderFileHash: string;
    placeholderRuleId: string;
  };
  columns: {
    timestamp: string;
    severity: string;
    source: string;
    type: string;
    sourceIp: string;
    dest: string;
    proto: string;
    user: string;
    process: string;
    parent: string;
    command: string;
    fileHash: string;
    asset: string;
    rules: string;
  };
  detail: {
    title: string;
    timestamp: string;
    severity: string;
    source: string;
    eventType: string;
    eventId: string;
    processedAt: string;
    networkContext: string;
    processInformation: string;
    process: string;
    parent: string;
    command: string;
    fileDetails: string;
    path: string;
    hash: string;
    username: string;
    asset: string;
    matchedRules: (count: number) => string;
    rawEvent: string;
    copy: string;
  };
}

export const eventLabels: CyberBilingual<EventLabels> = {
  en: {
    page: {
      title: 'Event Explorer',
      description:
        'Search and analyze security events across all log sources — the SIEM log viewer for incident investigations.',
      searchPlaceholder: 'Search events (IP, process, command, text)…',
      emptyTitle: 'No events found',
      emptyDescription: 'No security events match the current filters.',
    },
    kpi: {
      totalEvents: 'Total Events',
      sources: 'Sources',
      eventTypes: 'Event Types',
      criticalHigh: 'Critical / High',
    },
    charts: {
      eventsBySource: 'Events by Source',
      eventsByType: 'Events by Type',
      eventsBySeverity: 'Events by Severity',
      events: 'Events',
      eventsCenterLabel: 'events',
    },
    rowActions: {
      copyId: 'Copy ID',
      copyRawJson: 'Copy Raw JSON',
      eventIdCopied: 'Event ID copied',
      rawJsonCopied: 'Raw JSON copied',
      exportDownloaded: 'Export downloaded',
      exportFailedTitle: 'Export failed',
      exportFailedBody: 'Unable to download the export file.',
    },
    filters: {
      timeRange: 'Time Range',
      severity: 'Severity',
      protocol: 'Protocol',
      source: 'Source',
      eventType: 'Event Type',
      sourceIp: 'Source IP',
      destIp: 'Dest IP',
      username: 'Username',
      process: 'Process',
      command: 'Command',
      fileHash: 'File Hash',
      ruleId: 'Rule ID',
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      info: 'Info',
      placeholderSource: 'e.g. firewall, endpoint…',
      placeholderType: 'e.g. connection_attempt…',
      placeholderSourceIp: 'e.g. 192.168.1.1',
      placeholderDestIp: 'e.g. 10.0.0.1',
      placeholderUsername: 'e.g. jsmith',
      placeholderProcess: 'e.g. powershell.exe',
      placeholderCommand: 'Command line substring…',
      placeholderFileHash: 'SHA256 or MD5…',
      placeholderRuleId: 'Select a detection rule…',
    },
    columns: {
      timestamp: 'Timestamp',
      severity: 'Severity',
      source: 'Source',
      type: 'Type',
      sourceIp: 'Source IP',
      dest: 'Dest',
      proto: 'Proto',
      user: 'User',
      process: 'Process',
      parent: 'Parent',
      command: 'Command',
      fileHash: 'File Hash',
      asset: 'Asset',
      rules: 'Rules',
    },
    detail: {
      title: 'Event Detail',
      timestamp: 'Timestamp',
      severity: 'Severity',
      source: 'Source',
      eventType: 'Event Type',
      eventId: 'Event ID',
      processedAt: 'Processed At',
      networkContext: 'Network Context',
      processInformation: 'Process Information',
      process: 'Process:',
      parent: 'Parent:',
      command: 'Command:',
      fileDetails: 'File Details',
      path: 'Path:',
      hash: 'Hash:',
      username: 'Username',
      asset: 'Asset',
      matchedRules: (count) => `Matched Rules (${count})`,
      rawEvent: 'Raw Event',
      copy: 'Copy',
    },
  },
  ar: {
    page: {
      title: 'مستكشف الأحداث',
      description:
        'ابحث وحلّل الأحداث الأمنية عبر جميع مصادر السجلات — عارض سجلات SIEM لتحقيقات الحوادث.',
      searchPlaceholder: 'ابحث في الأحداث (IP، عملية، أمر، نص)…',
      emptyTitle: 'لا توجد أحداث',
      emptyDescription: 'لا توجد أحداث أمنية مطابقة لعوامل التصفية الحالية.',
    },
    kpi: {
      totalEvents: 'إجمالي الأحداث',
      sources: 'المصادر',
      eventTypes: 'أنواع الأحداث',
      criticalHigh: 'حرج / عالٍ',
    },
    charts: {
      eventsBySource: 'الأحداث حسب المصدر',
      eventsByType: 'الأحداث حسب النوع',
      eventsBySeverity: 'الأحداث حسب الخطورة',
      events: 'الأحداث',
      eventsCenterLabel: 'حدث',
    },
    rowActions: {
      copyId: 'نسخ المُعرّف',
      copyRawJson: 'نسخ JSON الخام',
      eventIdCopied: 'تم نسخ مُعرّف الحدث',
      rawJsonCopied: 'تم نسخ JSON الخام',
      exportDownloaded: 'تم تنزيل التصدير',
      exportFailedTitle: 'فشل التصدير',
      exportFailedBody: 'تعذّر تنزيل ملف التصدير.',
    },
    filters: {
      timeRange: 'النطاق الزمني',
      severity: 'الخطورة',
      protocol: 'البروتوكول',
      source: 'المصدر',
      eventType: 'نوع الحدث',
      sourceIp: 'IP المصدر',
      destIp: 'IP الوجهة',
      username: 'اسم المستخدم',
      process: 'العملية',
      command: 'الأمر',
      fileHash: 'بصمة الملف',
      ruleId: 'مُعرّف القاعدة',
      critical: 'حرج',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      info: 'معلوماتي',
      placeholderSource: 'مثال: جدار ناري، نقطة طرفية…',
      placeholderType: 'مثال: connection_attempt…',
      placeholderSourceIp: 'مثال: 192.168.1.1',
      placeholderDestIp: 'مثال: 10.0.0.1',
      placeholderUsername: 'مثال: jsmith',
      placeholderProcess: 'مثال: powershell.exe',
      placeholderCommand: 'جزء من سطر الأوامر…',
      placeholderFileHash: 'SHA256 أو MD5…',
      placeholderRuleId: 'اختر قاعدة كشف…',
    },
    columns: {
      timestamp: 'الطابع الزمني',
      severity: 'الخطورة',
      source: 'المصدر',
      type: 'النوع',
      sourceIp: 'IP المصدر',
      dest: 'الوجهة',
      proto: 'البروتوكول',
      user: 'المستخدم',
      process: 'العملية',
      parent: 'الأصل',
      command: 'الأمر',
      fileHash: 'بصمة الملف',
      asset: 'الأصل',
      rules: 'القواعد',
    },
    detail: {
      title: 'تفاصيل الحدث',
      timestamp: 'الطابع الزمني',
      severity: 'الخطورة',
      source: 'المصدر',
      eventType: 'نوع الحدث',
      eventId: 'مُعرّف الحدث',
      processedAt: 'تمت المعالجة في',
      networkContext: 'سياق الشبكة',
      processInformation: 'معلومات العملية',
      process: 'العملية:',
      parent: 'الأصل:',
      command: 'الأمر:',
      fileDetails: 'تفاصيل الملف',
      path: 'المسار:',
      hash: 'البصمة:',
      username: 'اسم المستخدم',
      asset: 'الأصل',
      matchedRules: (count) => `القواعد المطابِقة (${count})`,
      rawEvent: 'الحدث الخام',
      copy: 'نسخ',
    },
  },
};

export function useEventLabels(): EventLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(eventLabels, locale), [locale]);
}
