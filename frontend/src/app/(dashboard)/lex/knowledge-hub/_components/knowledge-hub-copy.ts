'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface KnowledgeHubCopy {
  breadcrumb: string;
  title: string;
  description: string;
  searchPlaceholder: string;
  find: string;
  categories: {
    clauses: [string, string, string];
    playbooks: [string, string, string];
    templates: [string, string, string];
    policies: [string, string, string];
    precedents: [string, string, string];
    learning: [string, string, string];
  };
  recent: string;
  recentDescription: string;
  viewAll: string;
  openResource: string;
  emptyRecent: string;
  recommended: string;
  recommendedDescription: string;
  recommendations: Array<[string, string, string, string]>;
  mostUsed: string;
  mostUsedDescription: string;
}

const EN: KnowledgeHubCopy = {
  breadcrumb: 'Knowledge Hub',
  title: 'Legal Knowledge Center',
  description:
    'Access governed clauses, policies, compliance references, playbooks, and vetted legal resources.',
  searchPlaceholder: 'Search clauses, policies, templates…',
  find: 'Find',
  categories: {
    clauses: [
      'Clause Library',
      'Governed clauses',
      'Standard clauses, fallback language, indemnity guidance, and liability positions.',
    ],
    playbooks: [
      'Playbooks',
      'Guided workflows',
      'Step-by-step negotiation guides and legal compliance protocols.',
    ],
    templates: [
      'Document Repository',
      'Governed documents',
      'Approved legal documents, versions, retention controls, and attachments.',
    ],
    policies: [
      'Policies and Regulations',
      'Governed sources',
      'Internal policy references, codes of conduct, and regulatory updates.',
    ],
    precedents: [
      'Case Precedents',
      'Reference corpus',
      'Judicial journals, legal research, and source-grounded precedent material.',
    ],
    learning: [
      'Learning Centre',
      '3 guided modules',
      'Short guides for drafting, compliance, and Watheeq legal operations.',
    ],
  },
  recent: 'Recently Added Resources',
  recentDescription:
    'The newest governed material available in the Watheeq reference corpus.',
  viewAll: 'View all resources',
  openResource: 'Open',
  emptyRecent: 'No reference resources are available yet.',
  recommended: 'Suggested Workspaces',
  recommendedDescription:
    'Continue in the governed workspace that owns the task you need to complete.',
  recommendations: [
    [
      'Contract drafting',
      'Draft with governed clauses, compare language, and save reusable wording.',
      '/lex/drafting',
      'Open drafting',
    ],
    [
      'Regulatory review',
      'Review sources, governance state, linked clauses, and compliance effects.',
      '/lex/regulations',
      'Open regulations',
    ],
    [
      'Ask the library',
      'Search document contents and produce source-grounded answers with citations.',
      '/lex/library',
      'Open library',
    ],
  ],
  mostUsed: 'Knowledge Areas',
  mostUsedDescription:
    'Direct access to the core governed knowledge collections.',
};

const AR: KnowledgeHubCopy = {
  breadcrumb: 'مركز المعرفة',
  title: 'مركز المعرفة القانونية',
  description:
    'الوصول إلى البنود والسياسات والمراجع التنظيمية والأدلة والموارد القانونية الخاضعة للحوكمة.',
  searchPlaceholder: 'ابحث في البنود والسياسات والنماذج…',
  find: 'بحث',
  categories: {
    clauses: [
      'مكتبة البنود',
      'بنود خاضعة للحوكمة',
      'بنود معيارية وصياغات بديلة وإرشادات للتعويض وحدود المسؤولية.',
    ],
    playbooks: [
      'الأدلة الإرشادية',
      'مسارات عمل موجهة',
      'أدلة تفاوض خطوة بخطوة وبروتوكولات للامتثال القانوني.',
    ],
    templates: [
      'مستودع الوثائق',
      'وثائق خاضعة للحوكمة',
      'وثائق قانونية معتمدة وإصدارات وضوابط احتفاظ ومرفقات.',
    ],
    policies: [
      'السياسات واللوائح',
      'مصادر خاضعة للحوكمة',
      'مراجع السياسات الداخلية ومدونات السلوك والتحديثات التنظيمية.',
    ],
    precedents: [
      'السوابق والمراجع',
      'المجموعة المرجعية',
      'المجلة القضائية والبحوث القانونية ومواد السوابق الموثقة بالمصدر.',
    ],
    learning: [
      'مركز التعلّم',
      '3 وحدات إرشادية',
      'أدلة قصيرة للصياغة والامتثال وتشغيل منظومة وثيق القانونية.',
    ],
  },
  recent: 'الموارد المضافة حديثًا',
  recentDescription:
    'أحدث المواد الخاضعة للحوكمة والمتاحة في مجموعة مراجع وثيق.',
  viewAll: 'عرض جميع الموارد',
  openResource: 'فتح',
  emptyRecent: 'لا توجد موارد مرجعية متاحة حتى الآن.',
  recommended: 'مساحات العمل المقترحة',
  recommendedDescription:
    'تابع العمل في المساحة الخاضعة للحوكمة والمسؤولة عن المهمة المطلوبة.',
  recommendations: [
    [
      'صياغة العقود',
      'صِغ باستخدام بنود محكومة وقارن الصياغات واحفظ النصوص القابلة لإعادة الاستخدام.',
      '/lex/drafting',
      'فتح الصياغة',
    ],
    [
      'المراجعة التنظيمية',
      'راجع المصادر وحالة الحوكمة والبنود المرتبطة وآثار الامتثال.',
      '/lex/regulations',
      'فتح اللوائح',
    ],
    [
      'اسأل المكتبة',
      'ابحث داخل المستندات وأنشئ إجابات موثقة بالمصادر والاستشهادات.',
      '/lex/library',
      'فتح المكتبة',
    ],
  ],
  mostUsed: 'مجالات المعرفة',
  mostUsedDescription:
    'وصول مباشر إلى مجموعات المعرفة الأساسية الخاضعة للحوكمة.',
};

export function useKnowledgeHubCopy(): KnowledgeHubCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (locale === 'ar' ? AR : EN), [locale]);
}
