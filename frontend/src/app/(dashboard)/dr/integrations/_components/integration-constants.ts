'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type {
  DRIntegrationKind,
  DRIntegrationVendor,
} from '@/lib/clario-dr';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

/**
 * Static option lists and label maps shared by the DR integrations table and
 * the create/edit dialog. Vendors are grouped by the kind they apply to so the
 * dialog can offer a sensible vendor list once a kind is chosen.
 *
 * Per the console's bilingual contract, the user-facing kind labels/descriptions
 * and the generic part of vendor labels are held in `DRBilingual` bundles and
 * resolved against the active locale (English fallback). Vendor brand names
 * (VMware vSphere, NetApp ONTAP, …) are proper nouns and are NOT translated.
 * Pure resolvers default to English so non-React/test callers stay green; React
 * consumers use the {@link useIntegrationConstants} hook.
 */

interface IntegrationKindCopy {
  label: string;
  description: string;
}

/** Bilingual kind copy keyed by the backend kind token. */
const INTEGRATION_KIND_COPY: DRBilingual<Record<DRIntegrationKind, IntegrationKindCopy>> = {
  en: {
    hypervisor: {
      label: 'Hypervisor',
      description: 'VM-level capture and boot orchestration (e.g. vSphere).',
    },
    storage_array: {
      label: 'Storage Array',
      description: 'Array-native snapshots and replication.',
    },
    cloud_vault: {
      label: 'Cloud Vault',
      description: 'Immutable cloud backup / recovery vault.',
    },
    kubernetes: {
      label: 'Kubernetes',
      description: 'Cluster workload and manifest capture.',
    },
  },
  ar: {
    hypervisor: {
      label: 'مُشرف الأجهزة الافتراضية',
      description: 'التقاط على مستوى الأجهزة الافتراضية وتنسيق الإقلاع (مثل vSphere).',
    },
    storage_array: {
      label: 'مصفوفة التخزين',
      description: 'لقطات ونسخ متماثل أصليّة على مستوى المصفوفة.',
    },
    cloud_vault: {
      label: 'الخزينة السحابية',
      description: 'خزينة نسخ احتياطي / استرداد سحابية غير قابلة للتغيير.',
    },
    kubernetes: {
      label: 'Kubernetes',
      description: 'التقاط أحمال العمل والبيانات الوصفية للعنقود.',
    },
  },
};

/** The kinds, in display order. */
const INTEGRATION_KIND_ORDER: DRIntegrationKind[] = [
  'hypervisor',
  'storage_array',
  'cloud_vault',
  'kubernetes',
];

/**
 * Vendor brand labels are proper nouns (kept across locales); only the generic
 * "Cluster" suffix on the Kubernetes vendor is localised.
 */
const INTEGRATION_VENDOR_LABEL: DRBilingual<Record<DRIntegrationVendor, string>> = {
  en: {
    vmware_vsphere: 'VMware vSphere',
    netapp_ontap: 'NetApp ONTAP',
    dell_powerstore: 'Dell PowerStore',
    nfs: 'NFS',
    aws_backup: 'AWS Backup',
    azure_backup: 'Azure Backup',
    gcp_backup_dr: 'GCP Backup & DR',
    kubernetes: 'Kubernetes Cluster',
  },
  ar: {
    vmware_vsphere: 'VMware vSphere',
    netapp_ontap: 'NetApp ONTAP',
    dell_powerstore: 'Dell PowerStore',
    nfs: 'NFS',
    aws_backup: 'AWS Backup',
    azure_backup: 'Azure Backup',
    gcp_backup_dr: 'GCP Backup & DR',
    kubernetes: 'عنقود Kubernetes',
  },
};

/** Which kinds each vendor applies to (locale-independent). */
const INTEGRATION_VENDOR_KINDS: Record<DRIntegrationVendor, DRIntegrationKind[]> = {
  vmware_vsphere: ['hypervisor'],
  netapp_ontap: ['storage_array'],
  dell_powerstore: ['storage_array'],
  nfs: ['storage_array'],
  aws_backup: ['cloud_vault'],
  azure_backup: ['cloud_vault'],
  gcp_backup_dr: ['cloud_vault'],
  kubernetes: ['kubernetes'],
};

/** Vendor order (matches the original option list). */
const INTEGRATION_VENDOR_ORDER: DRIntegrationVendor[] = [
  'vmware_vsphere',
  'netapp_ontap',
  'dell_powerstore',
  'nfs',
  'aws_backup',
  'azure_backup',
  'gcp_backup_dr',
  'kubernetes',
];

export interface IntegrationKindOption {
  value: DRIntegrationKind;
  label: string;
  description: string;
}

export interface IntegrationVendorOption {
  value: DRIntegrationVendor;
  label: string;
  kinds: DRIntegrationKind[];
}

/** Resolved kind options for the given locale (defaults to English). */
export function resolveIntegrationKindOptions(
  locale: AppLocale = 'en',
): IntegrationKindOption[] {
  const copy = resolveDRBilingual(INTEGRATION_KIND_COPY, locale);
  return INTEGRATION_KIND_ORDER.map((value) => ({
    value,
    label: copy[value].label,
    description: copy[value].description,
  }));
}

/** Resolved vendor options for the given locale (defaults to English). */
export function resolveIntegrationVendorOptions(
  locale: AppLocale = 'en',
): IntegrationVendorOption[] {
  const labels = resolveDRBilingual(INTEGRATION_VENDOR_LABEL, locale);
  return INTEGRATION_VENDOR_ORDER.map((value) => ({
    value,
    label: labels[value],
    kinds: INTEGRATION_VENDOR_KINDS[value],
  }));
}

/** Resolved kind label map (token → display) for the given locale. */
export function resolveIntegrationKindLabels(
  locale: AppLocale = 'en',
): Record<string, string> {
  const copy = resolveDRBilingual(INTEGRATION_KIND_COPY, locale);
  return INTEGRATION_KIND_ORDER.reduce<Record<string, string>>((acc, value) => {
    acc[value] = copy[value].label;
    return acc;
  }, {});
}

/** Resolved vendor label map (token → display) for the given locale. */
export function resolveIntegrationVendorLabels(
  locale: AppLocale = 'en',
): Record<string, string> {
  const labels = resolveDRBilingual(INTEGRATION_VENDOR_LABEL, locale);
  return INTEGRATION_VENDOR_ORDER.reduce<Record<string, string>>((acc, value) => {
    acc[value] = labels[value];
    return acc;
  }, {});
}

export function vendorsForKind(
  kind: string,
  locale: AppLocale = 'en',
): Array<{ value: DRIntegrationVendor; label: string }> {
  return resolveIntegrationVendorOptions(locale)
    .filter((vendor) => vendor.kinds.includes(kind as DRIntegrationKind))
    .map(({ value, label }) => ({ value, label }));
}

export function prettyIntegrationKind(kind: string, locale: AppLocale = 'en'): string {
  return resolveIntegrationKindLabels(locale)[kind] ?? kind.replace(/_/g, ' ');
}

export function prettyIntegrationVendor(vendor: string, locale: AppLocale = 'en'): string {
  return resolveIntegrationVendorLabels(locale)[vendor] ?? vendor.replace(/_/g, ' ');
}

/**
 * Locale-bound view of the integration constants for React consumers. Mirrors
 * {@link useDRLabels}: reads the active locale (English fallback) and memoises
 * the resolved option lists + label maps + pretty helpers.
 */
export interface IntegrationConstants {
  kindOptions: IntegrationKindOption[];
  vendorOptions: IntegrationVendorOption[];
  vendorsForKind: (kind: string) => Array<{ value: DRIntegrationVendor; label: string }>;
  prettyIntegrationKind: (kind: string) => string;
  prettyIntegrationVendor: (vendor: string) => string;
}

export function useIntegrationConstants(): IntegrationConstants {
  const { locale } = useLocaleOrDefault();
  return useMemo<IntegrationConstants>(
    () => ({
      kindOptions: resolveIntegrationKindOptions(locale),
      vendorOptions: resolveIntegrationVendorOptions(locale),
      vendorsForKind: (kind: string) => vendorsForKind(kind, locale),
      prettyIntegrationKind: (kind: string) => prettyIntegrationKind(kind, locale),
      prettyIntegrationVendor: (vendor: string) => prettyIntegrationVendor(vendor, locale),
    }),
    [locale],
  );
}
