/**
 * Feature-local bilingual label bundle for the Protect route page chrome
 * (header, tab labels, loading/error copy, and the write-blocked toast).
 *
 * Adopts the foundation bilingual contract: a `DRBilingual<ProtectPageLabels>`
 * bundle of two FULL, identically-shaped copies — the original English in `en`
 * (unchanged so English-asserting tests stay green) and professional Modern
 * Standard Arabic in `ar`. Resolved against the active locale via
 * {@link useProtectPageLabels} (English under the `renderWithQuery` `en`
 * default). Acronyms RTO/RPO are kept and glossed in Arabic on first use.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../_lib/dr-i18n';

export interface ProtectPageLabels {
  title: string;
  loadingDescription: string;
  errorDescription: string;
  description: string;
  loadError: string;
  tabGroups: string;
  tabReplication: string;
  tabAdvisor: string;
  tabInventory: string;
  noWriteToastTitle: string;
  noWriteToastBody: string;
}

export const protectPageLabels: DRBilingual<ProtectPageLabels> = {
  en: {
    title: 'Protect',
    loadingDescription: 'Loading protection groups and replication streams.',
    errorDescription:
      'Protection groups, replication topology, and continuous data protection streams.',
    description:
      'Protection groups, replication topology, recovery-point validation, and continuous data protection streams.',
    loadError: 'Failed to load protection and replication data.',
    tabGroups: 'Protection groups',
    tabReplication: 'Replication',
    tabAdvisor: 'Recovery advisor',
    tabInventory: 'Inventory',
    noWriteToastTitle: 'Write action blocked',
    noWriteToastBody: 'Requires the dr:write permission',
  },
  ar: {
    title: 'الحماية',
    loadingDescription: 'جارٍ تحميل مجموعات الحماية وتدفقات النسخ المتماثل.',
    errorDescription:
      'مجموعات الحماية وطوبولوجيا النسخ المتماثل وتدفقات الحماية المستمرة للبيانات.',
    description:
      'مجموعات الحماية وطوبولوجيا النسخ المتماثل والتحقق من نقاط الاسترداد وتدفقات الحماية المستمرة للبيانات.',
    loadError: 'فشل تحميل بيانات الحماية والنسخ المتماثل.',
    tabGroups: 'مجموعات الحماية',
    tabReplication: 'النسخ المتماثل',
    tabAdvisor: 'مستشار التعافي',
    tabInventory: 'المخزون',
    noWriteToastTitle: 'تم حظر إجراء الكتابة',
    noWriteToastBody: 'يتطلب صلاحية dr:write',
  },
};

/**
 * useProtectPageLabels resolves the Protect page-chrome labels against the
 * active locale (English fallback / default), mirroring the shared `useDRLabels`
 * hook.
 */
export function useProtectPageLabels(): ProtectPageLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(protectPageLabels, locale), [locale]);
}
