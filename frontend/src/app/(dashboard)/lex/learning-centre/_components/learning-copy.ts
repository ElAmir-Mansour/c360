'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface LearningModuleCopy {
  id: string;
  title: string;
  duration: string;
  level: string;
  description: string;
  href: string;
}

export interface LearningCentreCopy {
  title: string;
  description: string;
  progressTitle: string;
  progressDescription: (remaining: number) => string;
  completedGoal: string;
  completedGoalDescription: string;
  modulesTitle: string;
  complete: string;
  completed: string;
  openGuide: string;
  progress: (value: number) => string;
  modules: LearningModuleCopy[];
}

const EN: LearningCentreCopy = {
  title: 'Learning Centre',
  description:
    'Build practical Watheeq skills with short, source-linked legal operations guides.',
  progressTitle: 'Your learning progress',
  progressDescription: (remaining) =>
    `Complete ${remaining} more ${remaining === 1 ? 'module' : 'modules'} to finish this learning path.`,
  completedGoal: 'Learning path achieved',
  completedGoalDescription:
    'You completed every module in this Watheeq legal operations path.',
  modulesTitle: 'My Modules',
  complete: 'Mark complete',
  completed: 'Completed',
  openGuide: 'Open guide',
  progress: (value) => `${value}% complete`,
  modules: [
    {
      id: 'drafting-basics',
      title: 'Modern Legal Drafting Basics',
      duration: '45 mins',
      level: 'Beginner',
      description:
        'Use governed clauses, drafting controls, comparison, and review evidence.',
      href: '/docs/watheeq/knowledge-compliance',
    },
    {
      id: 'compliance-api',
      title: 'Understanding Legal Compliance',
      duration: '1 hr 15 mins',
      level: 'Intermediate',
      description:
        'Trace regulations to clauses, compliance findings, and auditable decisions.',
      href: '/docs/watheeq/knowledge-compliance',
    },
    {
      id: 'contract-lifecycle',
      title: 'Watheeq Contract Lifecycle',
      duration: '2 hrs',
      level: 'Advanced',
      description:
        'Follow a contract from intake and drafting through approval, signature, and renewal.',
      href: '/docs/watheeq/contract-lifecycle',
    },
  ],
};

const AR: LearningCentreCopy = {
  title: 'مركز التعلّم',
  description:
    'طوّر مهارات عملية في وثيق عبر أدلة قصيرة مرتبطة بالمصادر لتشغيل الأعمال القانونية.',
  progressTitle: 'تقدّمك في التعلّم',
  progressDescription: (remaining) =>
    `أكمل ${remaining} من الوحدات المتبقية لإنهاء هذا المسار التعليمي.`,
  completedGoal: 'اكتمل المسار التعليمي',
  completedGoalDescription:
    'أكملت جميع وحدات مسار تشغيل الأعمال القانونية في وثيق.',
  modulesTitle: 'وحداتي',
  complete: 'تحديد كمكتملة',
  completed: 'مكتملة',
  openGuide: 'فتح الدليل',
  progress: (value) => `اكتمل ${value}٪`,
  modules: [
    {
      id: 'drafting-basics',
      title: 'أساسيات الصياغة القانونية الحديثة',
      duration: '45 دقيقة',
      level: 'مبتدئ',
      description:
        'استخدم البنود المحكومة وضوابط الصياغة والمقارنة وأدلة المراجعة.',
      href: '/docs/watheeq/knowledge-compliance',
    },
    {
      id: 'compliance-api',
      title: 'فهم الامتثال القانوني',
      duration: 'ساعة و15 دقيقة',
      level: 'متوسط',
      description:
        'اربط اللوائح بالبنود ونتائج الامتثال والقرارات القابلة للتدقيق.',
      href: '/docs/watheeq/knowledge-compliance',
    },
    {
      id: 'contract-lifecycle',
      title: 'دورة حياة العقد في وثيق',
      duration: 'ساعتان',
      level: 'متقدم',
      description:
        'تابع العقد من الاستقبال والصياغة حتى الاعتماد والتوقيع والتجديد.',
      href: '/docs/watheeq/contract-lifecycle',
    },
  ],
};

export function useLearningCentreCopy(): LearningCentreCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (locale === 'ar' ? AR : EN), [locale]);
}
