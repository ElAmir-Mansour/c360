/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the Notebook
 * Workspace (`/notebooks`) — دفاتر الملاحظات.
 *
 * Follows the established lex/cyber/dr i18n contract: every label group is a
 * bilingual bundle `{ en, ar }` (two FULL, same-shaped copies — English in
 * `en`, professional MSA in `ar`). Components never receive the bundle; they
 * call {@link useNotebooksLabels} and read the resolved `T`. Resolution
 * defaults to English when no LocaleProvider is mounted (`useBilingual` rides
 * `useLocaleOrDefault`), so isolated unit tests keep the English surface.
 *
 * Product names / acronyms stay as-is in both locales: JupyterHub, JupyterLab,
 * Spark, SSO, RBAC, CPU, RAM, MB.
 *
 * The bundle is also registered into the unified namespace registry as
 * `notebooks`, so string leaves resolve through `useT('notebooks')`.
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

export type NotebooksBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveNotebooksBilingual<T>(bundle: NotebooksBilingual<T>, locale: AppLocale): T {
  return resolveBilingualBundle(bundle, locale);
}

export interface NotebooksLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
    hubChecking: string;
    hubReachable: string;
    hubDegraded: string;
    hubUnreachableAlert: string;
    profilesTag: (count: number) => string;
    templatesTag: (count: number) => string;
    activeProfile: string;
    lastActivity: string;
    noServer: string;
    notActive: string;
    openActiveLab: string;
    launchNotebook: string;
  };
  stats: {
    liveServers: string;
    transitioning: string;
    templates: string;
    jupyterhub: string;
    healthy: string;
    degraded: string;
  };
  servers: {
    title: string;
    activityUpdated: (ago: string) => string;
    launchHint: string;
    cpuLoad: string;
    memory: string;
    emptyTitle: string;
    emptyDescription: string;
    stepChooseProfile: string;
    stepStartPod: string;
    stepOpenTemplate: string;
    openJupyterLab: string;
    stopServer: string;
    startedAgo: (ago: string) => string;
    startedRecently: string;
    lastActivityAgo: (ago: string) => string;
    lastActivityUnknown: string;
    ramUsed: string;
    cpu: string;
    memoryShort: string;
  };
  profiles: {
    title: string;
    description: string;
    serverActive: string;
    readyCount: (count: number) => string;
    healthPaused: string;
    emptyProfiles: string;
    viewAll: string;
    profileSuffix: (name: string) => string;
    defaultBadge: string;
    sparkBadge: string;
    start: string;
    cpu: string;
    ram: string;
    disk: string;
    selectorTitle: string;
    selectorDescription: string;
    selectorUnavailable: string;
    launchProfile: (name: string) => string;
    memoryLabel: string;
    storageLabel: string;
  };
  operations: {
    title: string;
    hubStatus: string;
    available: string;
    degraded: string;
    hubCheckDetail: string;
    governance: string;
    ssoEnforced: string;
    governanceDetail: string;
    sparkProfiles: string;
    sparkOf: (spark: number, total: number) => string;
    sparkDetail: string;
    templateLibrary: string;
    templateCount: (count: number) => string;
    templateReadyDetail: string;
    templateLaunchDetail: string;
    access: string;
    network: string;
    data: string;
    accessValue: string;
    networkValue: string;
    dataValue: string;
  };
  templates: {
    title: string;
    description: string;
    beginnerCount: (count: number) => string;
    intermediateCount: (count: number) => string;
    advancedCount: (count: number) => string;
    beginner: string;
    intermediate: string;
    advanced: string;
    emptyTitle: string;
    emptyDescription: string;
    openTemplate: string;
    launchServerFirst: string;
  };
  toasts: {
    serverRequested: string;
    serverStarting: (profile: string) => string;
    serviceUnavailableTitle: string;
    serviceUnavailableBody: string;
    serverStopped: string;
    templateCopied: string;
    templateOpening: string;
    launchServerBeforeTemplate: string;
  };
}

const notebooksLabels: NotebooksBilingual<NotebooksLabels> = {
  en: {
    page: {
      eyebrow: 'Notebook Lab',
      title: 'Notebook Workspace',
      description:
        'Secure Jupyter-based analysis for SOC investigation, model validation, and Spark-scale threat research.',
      hubChecking: 'Checking JupyterHub',
      hubReachable: 'JupyterHub reachable',
      hubDegraded: 'JupyterHub degraded',
      hubUnreachableAlert:
        'JupyterHub is currently unreachable. Notebook servers may not start or respond correctly.',
      profilesTag: (count) => `${count} compute profiles`,
      templatesTag: (count) => `${count} governed templates`,
      activeProfile: 'Active profile',
      lastActivity: 'Last activity',
      noServer: 'No server',
      notActive: 'Not active',
      openActiveLab: 'Open Active Lab',
      launchNotebook: 'Launch Notebook',
    },
    stats: {
      liveServers: 'Live Servers',
      transitioning: 'Transitioning',
      templates: 'Templates',
      jupyterhub: 'JupyterHub',
      healthy: 'Healthy',
      degraded: 'Degraded',
    },
    servers: {
      title: 'Active Servers',
      activityUpdated: (ago) => `Current activity updated ${ago}.`,
      launchHint: 'Launch an isolated notebook pod with governed data access and JupyterHub SSO.',
      cpuLoad: 'CPU load',
      memory: 'Memory',
      emptyTitle: 'No active notebook server.',
      emptyDescription: 'Launch one to open JupyterLab and copy a template into your workspace.',
      stepChooseProfile: 'Choose profile',
      stepStartPod: 'Start pod',
      stepOpenTemplate: 'Open template',
      openJupyterLab: 'Open JupyterLab',
      stopServer: 'Stop Server',
      startedAgo: (ago) => `Started ${ago}`,
      startedRecently: 'Started recently',
      lastActivityAgo: (ago) => `Last activity ${ago}`,
      lastActivityUnknown: 'Last activity unknown',
      ramUsed: 'RAM used',
      cpu: 'CPU',
      memoryShort: 'Memory',
    },
    profiles: {
      title: 'Compute Profiles',
      description: 'Select the runtime envelope for the next notebook session.',
      serverActive: 'server active',
      readyCount: (count) => `${count} ready`,
      healthPaused:
        'JupyterHub health is not confirmed. Launch is paused until the workspace reports healthy.',
      emptyProfiles: 'No compute profiles are published for this tenant.',
      viewAll: 'View all profiles',
      profileSuffix: (name) => `${name} profile`,
      defaultBadge: 'default',
      sparkBadge: 'spark',
      start: 'Start',
      cpu: 'CPU',
      ram: 'RAM',
      disk: 'Disk',
      selectorTitle: 'Launch Notebook Workspace',
      selectorDescription: 'Select a compute profile to start your notebook server.',
      selectorUnavailable: 'JupyterHub is not ready for new notebook sessions.',
      launchProfile: (name) => `Launch ${name}`,
      memoryLabel: 'Memory',
      storageLabel: 'Storage',
    },
    operations: {
      title: 'Workspace Readiness',
      hubStatus: 'Hub status',
      available: 'Available',
      degraded: 'Degraded',
      hubCheckDetail: 'JupyterHub API check',
      governance: 'Governance',
      ssoEnforced: 'SSO enforced',
      governanceDetail: 'Personal workspace and audited copy flow',
      sparkProfiles: 'Spark profiles',
      sparkOf: (spark, total) => `${spark} of ${total}`,
      sparkDetail: 'Scale-out notebooks',
      templateLibrary: 'Template library',
      templateCount: (count) => `${count} notebooks`,
      templateReadyDetail: 'Ready to copy into the active server',
      templateLaunchDetail: 'Launch a server to open templates',
      access: 'Access',
      network: 'Network',
      data: 'Data',
      accessValue: 'RBAC',
      networkValue: 'Hub SSO',
      dataValue: 'Scoped',
    },
    templates: {
      title: 'Notebook Templates',
      description:
        'Copy one of the governed starter notebooks into your personal workspace and open it directly in JupyterLab.',
      beginnerCount: (count) => `${count} beginner`,
      intermediateCount: (count) => `${count} intermediate`,
      advancedCount: (count) => `${count} advanced`,
      beginner: 'beginner',
      intermediate: 'intermediate',
      advanced: 'advanced',
      emptyTitle: 'No templates available',
      emptyDescription:
        'Governed starter notebooks will appear here once they are published to your workspace.',
      openTemplate: 'Open Template',
      launchServerFirst: 'Launch a server first',
    },
    toasts: {
      serverRequested: 'Notebook server requested',
      serverStarting: (profile) => `${profile} is starting now.`,
      serviceUnavailableTitle: 'Notebook service unavailable',
      serviceUnavailableBody:
        'JupyterHub is not reachable right now. Try again after the workspace health returns to healthy.',
      serverStopped: 'Notebook server stopped',
      templateCopied: 'Template copied',
      templateOpening: 'Opening JupyterLab in a new tab.',
      launchServerBeforeTemplate: 'Launch a notebook server before opening a template.',
    },
  },
  ar: {
    page: {
      eyebrow: 'مختبر دفاتر الملاحظات',
      title: 'مساحة عمل دفاتر الملاحظات',
      description:
        'تحليل آمن قائم على Jupyter لتحقيقات مركز العمليات الأمنية والتحقق من النماذج وأبحاث التهديدات على نطاق Spark.',
      hubChecking: 'جارٍ فحص JupyterHub',
      hubReachable: 'JupyterHub متاح',
      hubDegraded: 'أداء JupyterHub متدهور',
      hubUnreachableAlert:
        'يتعذّر الوصول إلى JupyterHub حاليًا. قد لا تبدأ خوادم دفاتر الملاحظات أو لا تستجيب بشكل صحيح.',
      profilesTag: (count) => `${count} ملفات تعريف حوسبة`,
      templatesTag: (count) => `${count} قالبًا محوكمًا`,
      activeProfile: 'الملف التعريفي النشط',
      lastActivity: 'آخر نشاط',
      noServer: 'لا يوجد خادم',
      notActive: 'غير نشط',
      openActiveLab: 'فتح المختبر النشط',
      launchNotebook: 'تشغيل دفتر ملاحظات',
    },
    stats: {
      liveServers: 'الخوادم النشطة',
      transitioning: 'قيد الانتقال',
      templates: 'القوالب',
      jupyterhub: 'JupyterHub',
      healthy: 'سليم',
      degraded: 'متدهور',
    },
    servers: {
      title: 'الخوادم النشطة',
      activityUpdated: (ago) => `آخر تحديث للنشاط ${ago}.`,
      launchHint: 'شغّل حاوية دفتر ملاحظات معزولة مع وصول محوكم إلى البيانات وتسجيل دخول موحّد عبر JupyterHub.',
      cpuLoad: 'حمل المعالج',
      memory: 'الذاكرة',
      emptyTitle: 'لا يوجد خادم دفتر ملاحظات نشط.',
      emptyDescription: 'شغّل خادمًا لفتح JupyterLab ونسخ قالب إلى مساحة عملك.',
      stepChooseProfile: 'اختر الملف التعريفي',
      stepStartPod: 'ابدأ الحاوية',
      stepOpenTemplate: 'افتح القالب',
      openJupyterLab: 'فتح JupyterLab',
      stopServer: 'إيقاف الخادم',
      startedAgo: (ago) => `بدأ ${ago}`,
      startedRecently: 'بدأ مؤخرًا',
      lastActivityAgo: (ago) => `آخر نشاط ${ago}`,
      lastActivityUnknown: 'آخر نشاط غير معروف',
      ramUsed: 'الذاكرة المستخدمة',
      cpu: 'المعالج',
      memoryShort: 'الذاكرة',
    },
    profiles: {
      title: 'ملفات تعريف الحوسبة',
      description: 'اختر غلاف التشغيل لجلسة دفتر الملاحظات التالية.',
      serverActive: 'الخادم نشط',
      readyCount: (count) => `${count} جاهزة`,
      healthPaused: 'لم يتم تأكيد سلامة JupyterHub. التشغيل متوقف مؤقتًا حتى تعود مساحة العمل إلى الحالة السليمة.',
      emptyProfiles: 'لا توجد ملفات تعريف حوسبة منشورة لهذا المستأجر.',
      viewAll: 'عرض جميع الملفات التعريفية',
      profileSuffix: (name) => `ملف ${name} التعريفي`,
      defaultBadge: 'افتراضي',
      sparkBadge: 'Spark',
      start: 'بدء',
      cpu: 'المعالج',
      ram: 'الذاكرة',
      disk: 'التخزين',
      selectorTitle: 'تشغيل مساحة عمل دفاتر الملاحظات',
      selectorDescription: 'اختر ملف تعريف حوسبة لبدء خادم دفتر الملاحظات الخاص بك.',
      selectorUnavailable: 'JupyterHub غير جاهز لجلسات دفاتر ملاحظات جديدة.',
      launchProfile: (name) => `تشغيل ${name}`,
      memoryLabel: 'الذاكرة',
      storageLabel: 'التخزين',
    },
    operations: {
      title: 'جاهزية مساحة العمل',
      hubStatus: 'حالة المركز',
      available: 'متاح',
      degraded: 'متدهور',
      hubCheckDetail: 'فحص واجهة JupyterHub البرمجية',
      governance: 'الحوكمة',
      ssoEnforced: 'تسجيل دخول موحّد مفروض',
      governanceDetail: 'مساحة عمل شخصية وتدفق نسخ مُدقّق',
      sparkProfiles: 'ملفات تعريف Spark',
      sparkOf: (spark, total) => `${spark} من ${total}`,
      sparkDetail: 'دفاتر ملاحظات قابلة للتوسّع',
      templateLibrary: 'مكتبة القوالب',
      templateCount: (count) => `${count} دفترًا`,
      templateReadyDetail: 'جاهزة للنسخ إلى الخادم النشط',
      templateLaunchDetail: 'شغّل خادمًا لفتح القوالب',
      access: 'الوصول',
      network: 'الشبكة',
      data: 'البيانات',
      accessValue: 'صلاحيات RBAC',
      networkValue: 'دخول موحّد عبر المركز',
      dataValue: 'نطاق محدد',
    },
    templates: {
      title: 'قوالب دفاتر الملاحظات',
      description: 'انسخ أحد دفاتر الملاحظات المحوكمة إلى مساحة عملك الشخصية وافتحه مباشرة في JupyterLab.',
      beginnerCount: (count) => `${count} مبتدئ`,
      intermediateCount: (count) => `${count} متوسط`,
      advancedCount: (count) => `${count} متقدم`,
      beginner: 'مبتدئ',
      intermediate: 'متوسط',
      advanced: 'متقدم',
      emptyTitle: 'لا توجد قوالب متاحة',
      emptyDescription: 'ستظهر دفاتر الملاحظات المحوكمة هنا فور نشرها في مساحة عملك.',
      openTemplate: 'فتح القالب',
      launchServerFirst: 'شغّل خادمًا أولًا',
    },
    toasts: {
      serverRequested: 'تم طلب خادم دفتر الملاحظات',
      serverStarting: (profile) => `${profile} قيد البدء الآن.`,
      serviceUnavailableTitle: 'خدمة دفاتر الملاحظات غير متاحة',
      serviceUnavailableBody: 'يتعذّر الوصول إلى JupyterHub حاليًا. حاول مجددًا بعد عودة مساحة العمل إلى الحالة السليمة.',
      serverStopped: 'تم إيقاف خادم دفتر الملاحظات',
      templateCopied: 'تم نسخ القالب',
      templateOpening: 'جارٍ فتح JupyterLab في تبويب جديد.',
      launchServerBeforeTemplate: 'شغّل خادم دفتر ملاحظات قبل فتح قالب.',
    },
  },
};

export function useNotebooksLabels(): NotebooksLabels {
  return useBilingual(notebooksLabels);
}

registerMessages('notebooks', notebooksLabels);
