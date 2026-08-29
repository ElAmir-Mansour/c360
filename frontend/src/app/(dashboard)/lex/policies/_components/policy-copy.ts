'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface PolicyHubCopy {
  title: string;
  description: string;
  all: string;
  search: string;
  emptyTitle: string;
  emptyDescription: string;
  authority: string;
  jurisdiction: string;
  version: string;
  open: string;
  previous: string;
  next: string;
  page: (current: number, total: number) => string;
  status: Record<string, string>;
}

const EN: PolicyHubCopy = {
  title: 'Policy Hub',
  description:
    'Search governed policies and regulations, review their authority and version, and continue to the full regulatory workspace.',
  all: 'All sources',
  search: 'Search policies, regulations, authorities…',
  emptyTitle: 'No governed policies found',
  emptyDescription: 'No policy or regulation matched the current search and type.',
  authority: 'Authority',
  jurisdiction: 'Jurisdiction',
  version: 'Version',
  open: 'Open regulatory workspace',
  previous: 'Previous',
  next: 'Next',
  page: (current, total) => `Page ${current} of ${total}`,
  status: {
    active: 'Active',
    draft: 'Draft',
    archived: 'Archived',
    pending: 'Pending revision',
    deprecated: 'Deprecated',
  },
};

const AR: PolicyHubCopy = {
  title: 'مركز السياسات',
  description:
    'ابحث في السياسات واللوائح الخاضعة للحوكمة وراجع الجهة والإصدار ثم انتقل إلى مساحة العمل التنظيمية الكاملة.',
  all: 'جميع المصادر',
  search: 'ابحث في السياسات واللوائح والجهات…',
  emptyTitle: 'لا توجد سياسات محكومة',
  emptyDescription: 'لا توجد سياسة أو لائحة تطابق البحث والنوع المحددين.',
  authority: 'الجهة',
  jurisdiction: 'النطاق',
  version: 'الإصدار',
  open: 'فتح مساحة اللوائح',
  previous: 'السابق',
  next: 'التالي',
  page: (current, total) => `الصفحة ${current} من ${total}`,
  status: {
    active: 'نشطة',
    draft: 'مسودة',
    archived: 'مؤرشفة',
    pending: 'بانتظار المراجعة',
    deprecated: 'متوقفة',
  },
};

export function usePolicyHubCopy(): PolicyHubCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (locale === 'ar' ? AR : EN), [locale]);
}
