'use client';

import '../../_lib/admin-i18n';
import { useBilingual } from '@/components/providers/locale-provider';

export type FormsLocalLabels = {
  versionBadge: string;
};

const FORMS_LOCAL_LABELS: { readonly en: FormsLocalLabels; readonly ar: FormsLocalLabels } = {
  en: {
    versionBadge: 'v{version}',
  },
  ar: {
    versionBadge: 'الإصدار {version}',
  },
};

export function useFormsLocalLabels(): FormsLocalLabels {
  return useBilingual(FORMS_LOCAL_LABELS);
}

export function getFormVersionBadge(
  labels: FormsLocalLabels,
  formattedVersion: string,
): string {
  return labels.versionBadge.replace('{version}', formattedVersion);
}
