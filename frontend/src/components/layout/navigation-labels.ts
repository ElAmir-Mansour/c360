'use client';

import { useCallback } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { normalizeLocale } from '@/lib/i18n';
import { getMessages, readMessage, type AppMessages, type MessageKey } from '@/lib/i18n/messages';
import { translateWatheeqTechVisibleText } from '@/lib/i18n/watheeqtech-visible-text-v22.generated';

interface NavigationLabelOptions {
  useWatheeqTranslationMemory?: boolean;
}

const WORKFLOW_NAV_LABELS = {
  'admin-workflows': { en: 'Workflows', ar: 'سير العمل' },
  'workflows-my-tasks': { en: 'My Tasks', ar: 'مهامي' },
  'workflows-definitions-browse': { en: 'Browse Workflows', ar: 'استعراض سير العمل' },
  'admin-workflow-tasks': { en: 'Task Queue', ar: 'قائمة المهام' },
  'admin-workflow-instances': { en: 'Instances', ar: 'المثيلات' },
  'admin-workflow-definitions': { en: 'Definitions', ar: 'التعريفات' },
  'admin-workflow-templates': { en: 'Templates', ar: 'القوالب' },
  'admin-workflow-forms': { en: 'Forms', ar: 'النماذج' },
  'admin-workflow-operations': { en: 'Operations', ar: 'العمليات' },
  'admin-automation-engine': { en: 'Automation Engine', ar: 'محرك الأتمتة' },
  'admin-workflow-analytics': { en: 'Analytics', ar: 'التحليلات' },
} as const;

function shouldUseWatheeqTranslationMemory(
  locale: string | null | undefined,
  options: NavigationLabelOptions | undefined,
): boolean {
  return Boolean(options?.useWatheeqTranslationMemory && normalizeLocale(locale) === 'ar');
}

function overlayWatheeqTranslation(
  source: string,
  fallback: string,
  locale: string | null | undefined,
  options: NavigationLabelOptions | undefined,
): string {
  if (!shouldUseWatheeqTranslationMemory(locale, options)) {
    return fallback;
  }

  return translateWatheeqTechVisibleText(source) ?? fallback;
}

export function resolveMessage(
  messages: AppMessages,
  key: string,
  fallback: string,
  locale?: string | null,
  options?: NavigationLabelOptions,
): string {
  const value = readMessage(messages, key as MessageKey);
  const resolved = value === key ? fallback : value;
  const englishValue = readMessage(getMessages('en'), key as MessageKey);
  const source = englishValue === key ? fallback : englishValue;
  return overlayWatheeqTranslation(source, resolved, locale, options);
}

export function resolveNavLabel(
  messages: AppMessages,
  id: string,
  fallback: string,
  locale?: string | null,
  options?: NavigationLabelOptions,
): string {
  const value = readMessage(messages, `nav.${id}` as MessageKey);
  if (value !== `nav.${id}`) {
    return overlayWatheeqTranslation(fallback, value, locale, options);
  }

  const workflowLabel = WORKFLOW_NAV_LABELS[id as keyof typeof WORKFLOW_NAV_LABELS];
  if (!workflowLabel) {
    return overlayWatheeqTranslation(fallback, fallback, locale, options);
  }

  const resolved = normalizeLocale(locale) === 'ar' ? workflowLabel.ar : workflowLabel.en;
  return overlayWatheeqTranslation(workflowLabel.en, resolved, locale, options);
}

export function useNavigationLabels() {
  const { locale, messages, direction } = useLocaleOrDefault();

  const nav = useCallback(
    (id: string, fallback: string) =>
      resolveNavLabel(messages, id, fallback, locale),
    [locale, messages],
  );

  const shell = useCallback(
    (key: MessageKey, fallback?: string) =>
      resolveMessage(messages, key, fallback ?? key, locale),
    [locale, messages],
  );

  return { direction, nav, shell };
}
