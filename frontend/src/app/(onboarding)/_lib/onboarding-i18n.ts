/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the tenant
 * ONBOARDING wizard (`/setup`) and its shell (`(onboarding)/layout`).
 *
 * Follows the established files/cyber i18n contract: a single typed shape `T`,
 * two FULL same-shaped copies `{ en, ar }`, and a module-scope
 * {@link registerMessages}('onboarding', ...) call so every string leaf is
 * resolvable through `useT('onboarding')`. Components import this module (for
 * the hook or for its registration side effect) and read strings by dot-path
 * key; `{token}` placeholders interpolate via `useT`'s second argument.
 *
 * The `en` side equals the pre-existing English strings VERBATIM so the
 * no-provider / no-op fallback renders exactly what shipped before.
 *
 * Arabic register: formal Saudi MSA aligned to `scripts/i18n-glossary.json`
 * (اشتراك/ترخيص, لوحة المعلومات, إلغاء/إرسال, المستأجر). Western digits are kept
 * in every interpolated value. Product names / acronyms stay verbatim in both
 * locales: Clario360, PNG, SVG, MB.
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages, resolveBilingualBundle } from '@/lib/i18n/registry';
import type { AppLocale } from '@/lib/i18n';

export type OnboardingBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveOnboardingBilingual<T>(
  bundle: OnboardingBilingual<T>,
  locale: AppLocale,
): T {
  return resolveBilingualBundle(bundle, locale);
}

export interface OnboardingLabels {
  /** Shared wizard action buttons reused across steps. */
  actions: {
    back: string;
    continue: string;
    skip: string;
  };
  /** `(onboarding)/layout` chrome: eyebrow, step rail, footer. */
  chrome: {
    eyebrow: string;
    stepsAria: string;
    needHelp: string;
    steps: {
      organization: string;
      branding: string;
      team: string;
      suites: string;
      ready: string;
    };
  };
  /** `wizard-container`: loader, load errors, per-step heading + subtitle. */
  wizard: {
    loading: string;
    unableToLoad: string;
    loadFailed: string;
    headings: {
      organization: string;
      branding: string;
      team: string;
      suites: string;
      ready: string;
    };
    subtitles: {
      organization: string;
      branding: string;
      team: string;
      suites: string;
      ready: string;
    };
  };
  /** `step-indicator` progress rail labels. */
  indicator: {
    organization: string;
    branding: string;
    team: string;
    products: string;
    ready: string;
  };
  /** `step-organization` form. */
  org: {
    saveFailed: string;
    nameLabel: string;
    industryLabel: string;
    countryLabel: string;
    cityLabel: string;
    sizeLabel: string;
    industries: {
      financial: string;
      government: string;
      healthcare: string;
      technology: string;
      energy: string;
      telecom: string;
      education: string;
      retail: string;
      manufacturing: string;
      other: string;
    };
  };
  /** `step-branding` logo upload + palette preview. */
  branding: {
    logoTypeError: string;
    logoSizeError: string;
    proceedError: string;
    saveFailed: string;
    uploadTitle: string;
    uploadHelp: string;
    chooseLogo: string;
    dragDrop: string;
    previewTitle: string;
    previewAlt: string;
    currentStored: string;
    noLogoYet: string;
    colorsStillApplied: string;
    primaryColor: string;
    accentColor: string;
    overviewTitle: string;
    overviewSubtitle: string;
    riskScore: string;
    criticalAlerts: string;
    compliance: string;
    actionsMetric: string;
  };
  /** `step-team` invitations. */
  team: {
    sendFailed: string;
    sentOne: string;
    sentMany: string;
    addAnother: string;
    rowsCount: string;
  };
  /** `invite-row` fields. */
  invite: {
    email: string;
    emailPlaceholder: string;
    role: string;
    remove: string;
  };
  /** `step-suites` products + plan + seats. */
  suites: {
    selectAtLeastOne: string;
    seatsRange: string;
    saveFailed: string;
    trialIncluded: string;
    trialSummary: string;
    noPayment: string;
    planHeading: string;
    planSubtitle: string;
    planGroupAria: string;
    planAria: string;
    defaultBadge: string;
    upToSeats: string;
    seatsLabel: string;
    seatsHelp: string;
    productsHeading: string;
    productsSubtitle: string;
    notInPlan: string;
  };
  /** `step-ready` completion + provisioning. */
  ready: {
    finalizeFailed: string;
    completedTitle: string;
    completedSubtitle: string;
    goToDashboard: string;
    connectDataTitle: string;
    connectDataDesc: string;
    assetScanTitle: string;
    assetScanDesc: string;
    boardMeetingTitle: string;
    boardMeetingDesc: string;
    exploreDocs: string;
    provisioningTitle: string;
    provisioningSubtitle: string;
  };
  /** `provisioning-progress` bar + status enum. */
  provisioning: {
    percentComplete: string;
    status: {
      pending: string;
      running: string;
      completed: string;
      failed: string;
      skipped: string;
    };
  };
}

const onboardingLabels: OnboardingBilingual<OnboardingLabels> = {
  en: {
    actions: {
      back: 'Back',
      continue: 'Continue',
      skip: 'Skip',
    },
    chrome: {
      eyebrow: 'Tenant onboarding',
      stepsAria: 'Onboarding steps',
      needHelp: 'Need help?',
      steps: {
        organization: 'Organization',
        branding: 'Branding',
        team: 'Team',
        suites: 'Suites',
        ready: 'Ready',
      },
    },
    wizard: {
      loading: 'Loading your onboarding wizard…',
      unableToLoad: 'Unable to load onboarding state.',
      loadFailed: 'Failed to load onboarding wizard.',
      headings: {
        organization: 'Tell us about your organization',
        branding: 'Shape the look of your workspace',
        team: 'Invite your team',
        suites: 'Choose products, plan, and seats',
        ready: 'Finish provisioning',
      },
      subtitles: {
        organization: 'These details seed your tenant profile and guide default settings.',
        branding: 'Colors can be changed later. They are applied across shared dashboards.',
        team: 'Send invites now or skip and handle team setup later from the dashboard.',
        suites: 'Trial starts by default. Select the products and seats to provision for this tenant.',
        ready: 'We will poll the provisioning pipeline in real time until the platform is ready.',
      },
    },
    indicator: {
      organization: 'Organization',
      branding: 'Branding',
      team: 'Team',
      products: 'Products',
      ready: 'Ready',
    },
    org: {
      saveFailed: 'Failed to save organization details.',
      nameLabel: 'Organization name',
      industryLabel: 'Industry',
      countryLabel: 'Country',
      cityLabel: 'City',
      sizeLabel: 'Organization size',
      industries: {
        financial: 'Financial Services',
        government: 'Government',
        healthcare: 'Healthcare',
        technology: 'Technology',
        energy: 'Energy',
        telecom: 'Telecom',
        education: 'Education',
        retail: 'Retail',
        manufacturing: 'Manufacturing',
        other: 'Other',
      },
    },
    branding: {
      logoTypeError: 'Logo must be a PNG or SVG image.',
      logoSizeError: 'Logo must be 2MB or smaller.',
      proceedError: 'Failed to proceed. Please try again.',
      saveFailed: 'Failed to save branding.',
      uploadTitle: 'Upload your organization logo',
      uploadHelp:
        'PNG or SVG only, up to 2MB. We store it with your tenant branding so dashboards and welcome surfaces can reuse it.',
      chooseLogo: 'Choose Logo',
      dragDrop: 'Drag and drop supported',
      previewTitle: 'Logo preview',
      previewAlt: 'Selected logo preview',
      currentStored: 'Current logo is already stored for this tenant.',
      noLogoYet: 'No logo selected yet.',
      colorsStillApplied: 'Your colors will still be applied if you skip this step.',
      primaryColor: 'Primary color',
      accentColor: 'Accent color',
      overviewTitle: 'Executive Overview Preview',
      overviewSubtitle: 'A quick feel for your chosen palette',
      riskScore: 'Risk Score',
      criticalAlerts: 'Critical Alerts',
      compliance: 'Compliance',
      actionsMetric: 'Actions',
    },
    team: {
      sendFailed: 'Failed to send invitations.',
      sentOne: '{count} invitation sent.',
      sentMany: '{count} invitations sent.',
      addAnother: 'Add another',
      rowsCount: '{count}/10 rows',
    },
    invite: {
      email: 'Email',
      emailPlaceholder: 'alice@company.com',
      role: 'Role',
      remove: 'Remove',
    },
    suites: {
      selectAtLeastOne: 'Select at least one product.',
      seatsRange: 'Choose between 1 and {limit} seats for this plan.',
      saveFailed: 'Failed to save product and plan selection.',
      trialIncluded: 'Trial included by default',
      trialSummary: '{days} days, {seats} seats, upgrade anytime.',
      noPayment: 'No payment required',
      planHeading: 'Plan',
      planSubtitle: 'Choose the onboarding plan to provision.',
      planGroupAria: 'Onboarding plan',
      planAria: '{plan} plan',
      defaultBadge: 'Default',
      upToSeats: 'Up to {limit} seats',
      seatsLabel: 'Seats',
      seatsHelp: 'Choose 1-{limit} seats for {plan}.',
      productsHeading: 'Products',
      productsSubtitle: 'Select the products to activate during onboarding.',
      notInPlan: 'Not included in selected plan',
    },
    ready: {
      finalizeFailed: 'Failed to finalize onboarding.',
      completedTitle: 'Your Clario360 platform is ready!',
      completedSubtitle:
        'Provisioning completed successfully. You can start from the dashboard or jump into a suite.',
      goToDashboard: 'Go to Dashboard',
      connectDataTitle: 'Connect your first data source',
      connectDataDesc: 'Start ingesting structured data.',
      assetScanTitle: 'Set up asset scanning',
      assetScanDesc: 'Bring cyber inventory online.',
      boardMeetingTitle: 'Schedule a board meeting',
      boardMeetingDesc: 'Begin governance workflows.',
      exploreDocs: 'Explore the documentation',
      provisioningTitle: 'Provisioning your workspace',
      provisioningSubtitle:
        'We are setting up tenant defaults, security roles, dashboards, and storage.',
    },
    provisioning: {
      percentComplete: '{pct}% complete',
      status: {
        pending: 'pending',
        running: 'running',
        completed: 'completed',
        failed: 'failed',
        skipped: 'skipped',
      },
    },
  },
  ar: {
    actions: {
      back: 'رجوع',
      continue: 'متابعة',
      skip: 'تخطّي',
    },
    chrome: {
      eyebrow: 'إعداد المستأجر',
      stepsAria: 'خطوات الإعداد',
      needHelp: 'تحتاج مساعدة؟',
      steps: {
        organization: 'المؤسسة',
        branding: 'الهوية البصرية',
        team: 'الفريق',
        suites: 'الأجنحة',
        ready: 'جاهز',
      },
    },
    wizard: {
      loading: 'جارٍ تحميل معالج الإعداد…',
      unableToLoad: 'تعذّر تحميل حالة الإعداد.',
      loadFailed: 'تعذّر تحميل معالج الإعداد.',
      headings: {
        organization: 'أخبِرنا عن مؤسستك',
        branding: 'صمّم مظهر مساحة عملك',
        team: 'ادعُ فريقك',
        suites: 'اختر المنتجات والخطة والمقاعد',
        ready: 'إنهاء التجهيز',
      },
      subtitles: {
        organization: 'تُهيّئ هذه التفاصيل ملف المستأجر وتوجّه الإعدادات الافتراضية.',
        branding: 'يمكن تغيير الألوان لاحقًا. وتُطبَّق عبر لوحات المعلومات المشتركة.',
        team: 'أرسِل الدعوات الآن أو تخطَّ الخطوة وأكمل إعداد الفريق لاحقًا من لوحة المعلومات.',
        suites: 'تبدأ النسخة التجريبية افتراضيًا. اختر المنتجات والمقاعد المراد تجهيزها لهذا المستأجر.',
        ready: 'سنراقب مسار التجهيز لحظيًا حتى تصبح المنصة جاهزة.',
      },
    },
    indicator: {
      organization: 'المؤسسة',
      branding: 'الهوية البصرية',
      team: 'الفريق',
      products: 'المنتجات',
      ready: 'جاهز',
    },
    org: {
      saveFailed: 'تعذّر حفظ تفاصيل المؤسسة.',
      nameLabel: 'اسم المؤسسة',
      industryLabel: 'القطاع',
      countryLabel: 'الدولة',
      cityLabel: 'المدينة',
      sizeLabel: 'حجم المؤسسة',
      industries: {
        financial: 'الخدمات المالية',
        government: 'القطاع الحكومي',
        healthcare: 'الرعاية الصحية',
        technology: 'التقنية',
        energy: 'الطاقة',
        telecom: 'الاتصالات',
        education: 'التعليم',
        retail: 'تجارة التجزئة',
        manufacturing: 'التصنيع',
        other: 'أخرى',
      },
    },
    branding: {
      logoTypeError: 'يجب أن يكون الشعار صورة بصيغة PNG أو SVG.',
      logoSizeError: 'يجب ألا يتجاوز حجم الشعار 2 ميغابايت.',
      proceedError: 'تعذّر المتابعة. يُرجى المحاولة مرة أخرى.',
      saveFailed: 'تعذّر حفظ الهوية البصرية.',
      uploadTitle: 'ارفع شعار مؤسستك',
      uploadHelp:
        'بصيغة PNG أو SVG فقط، وبحجم أقصاه 2 ميغابايت. نحفظه ضمن الهوية البصرية للمستأجر لتتمكن لوحات المعلومات وشاشات الترحيب من إعادة استخدامه.',
      chooseLogo: 'اختيار الشعار',
      dragDrop: 'السحب والإفلات مدعوم',
      previewTitle: 'معاينة الشعار',
      previewAlt: 'معاينة الشعار المحدد',
      currentStored: 'الشعار الحالي مخزَّن بالفعل لهذا المستأجر.',
      noLogoYet: 'لم يُحدَّد شعار بعد.',
      colorsStillApplied: 'ستُطبَّق ألوانك حتى لو تخطّيت هذه الخطوة.',
      primaryColor: 'اللون الأساسي',
      accentColor: 'لون التمييز',
      overviewTitle: 'معاينة النظرة التنفيذية',
      overviewSubtitle: 'لمحة سريعة عن لوحة الألوان التي اخترتها',
      riskScore: 'درجة المخاطر',
      criticalAlerts: 'التنبيهات الحرجة',
      compliance: 'الامتثال',
      actionsMetric: 'الإجراءات',
    },
    team: {
      sendFailed: 'تعذّر إرسال الدعوات.',
      sentOne: 'تم إرسال {count} دعوة.',
      sentMany: 'تم إرسال {count} دعوة.',
      addAnother: 'إضافة صف آخر',
      rowsCount: '{count}/10 صفوف',
    },
    invite: {
      email: 'البريد الإلكتروني',
      emailPlaceholder: 'alice@company.com',
      role: 'الدور',
      remove: 'إزالة',
    },
    suites: {
      selectAtLeastOne: 'اختر منتجًا واحدًا على الأقل.',
      seatsRange: 'اختر عددًا بين 1 و{limit} مقعدًا لهذه الخطة.',
      saveFailed: 'تعذّر حفظ اختيار المنتجات والخطة.',
      trialIncluded: 'النسخة التجريبية مضمّنة افتراضيًا',
      trialSummary: '{days} يومًا، {seats} مقاعد، مع إمكانية الترقية في أي وقت.',
      noPayment: 'لا يلزم أي دفع',
      planHeading: 'الخطة',
      planSubtitle: 'اختر خطة الإعداد المراد تجهيزها.',
      planGroupAria: 'خطة الإعداد',
      planAria: 'خطة {plan}',
      defaultBadge: 'افتراضية',
      upToSeats: 'حتى {limit} مقعدًا',
      seatsLabel: 'المقاعد',
      seatsHelp: 'اختر من 1 إلى {limit} مقعدًا لخطة {plan}.',
      productsHeading: 'المنتجات',
      productsSubtitle: 'اختر المنتجات المراد تفعيلها أثناء الإعداد.',
      notInPlan: 'غير مضمَّن في الخطة المحددة',
    },
    ready: {
      finalizeFailed: 'تعذّر إنهاء الإعداد.',
      completedTitle: 'منصة Clario360 الخاصة بك جاهزة!',
      completedSubtitle:
        'اكتمل التجهيز بنجاح. يمكنك البدء من لوحة المعلومات أو الانتقال مباشرةً إلى أحد الأجنحة.',
      goToDashboard: 'الانتقال إلى لوحة المعلومات',
      connectDataTitle: 'اربط مصدر بياناتك الأول',
      connectDataDesc: 'ابدأ باستيعاب البيانات المنظَّمة.',
      assetScanTitle: 'إعداد فحص الأصول',
      assetScanDesc: 'أدرِج جرد الأمن السيبراني.',
      boardMeetingTitle: 'جدولة اجتماع مجلس',
      boardMeetingDesc: 'ابدأ سير عمل الحوكمة.',
      exploreDocs: 'استكشف الوثائق',
      provisioningTitle: 'جارٍ تجهيز مساحة عملك',
      provisioningSubtitle:
        'نُعِدّ الآن الإعدادات الافتراضية للمستأجر وأدوار الأمان ولوحات المعلومات والتخزين.',
    },
    provisioning: {
      percentComplete: '{pct}٪ مكتمل',
      status: {
        pending: 'قيد الانتظار',
        running: 'قيد التنفيذ',
        completed: 'مكتمل',
        failed: 'فشل',
        skipped: 'مُتخطّى',
      },
    },
  },
};

export function useOnboardingLabels(): OnboardingLabels {
  return useBilingual(onboardingLabels);
}

registerMessages('onboarding', onboardingLabels);
