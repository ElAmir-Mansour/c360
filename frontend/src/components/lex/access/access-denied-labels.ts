/**
 * Bilingual copy for the §15 Access-Denied UX. Mirrors the lex bilingual-labels
 * pattern (an object per locale, resolved against the active locale).
 */

export interface AccessDeniedLabels {
  eyebrow: string;
  /** "You do not have access to this page." (no resource name available). */
  title: string;
  /** Headline with a {resource} placeholder e.g. "You do not have access to {resource}." */
  titleWithResource: (resource: string) => string;
  requiredPermission: string;
  yourActiveRole: string;
  noActiveRole: string;
  /** Body explaining the active role lacks the permission. */
  explanation: string;
  /** Shown when the user holds no legal role at all (access_state NO_LEX_ROLE_ASSIGNED). */
  noLexRole: string;
  switchPrompt: string;
  switchTo: (roleName: string) => string;
  switching: string;
  switchFailed: string;
  backToWorkspace: string;
  and: string;
  or: string;
}

export const ACCESS_DENIED_LABELS: Record<'en' | 'ar', AccessDeniedLabels> = {
  en: {
    eyebrow: 'Access restricted',
    title: 'You do not have access to this page.',
    titleWithResource: (resource) => `You do not have access to ${resource}.`,
    requiredPermission: 'Required permission',
    yourActiveRole: 'Your active Lex role',
    noActiveRole: 'No active legal role',
    explanation:
      'Your current role does not grant this permission. Backend authorization is the source of truth — switching persona below, or asking an administrator to grant the permission, is the way to gain access.',
    noLexRole:
      'You are not assigned any legal-affairs role in this workspace, so Lex pages are unavailable. Ask an administrator to assign you a legal role.',
    switchPrompt: 'You have another role that can access this page:',
    switchTo: (roleName) => `Switch to ${roleName}`,
    switching: 'Switching persona…',
    switchFailed: 'Could not switch persona. You may no longer hold that role.',
    backToWorkspace: 'Back to my workspace',
    and: 'AND',
    or: 'OR',
  },
  ar: {
    eyebrow: 'الوصول مقيّد',
    title: 'ليس لديك صلاحية الوصول إلى هذه الصفحة.',
    titleWithResource: (resource) => `ليس لديك صلاحية الوصول إلى ${resource}.`,
    requiredPermission: 'الصلاحية المطلوبة',
    yourActiveRole: 'دورك القانوني الحالي',
    noActiveRole: 'لا يوجد دور قانوني نشط',
    explanation:
      'دورك الحالي لا يمنح هذه الصلاحية. التحقق من الصلاحيات في الخادم هو المرجع. يمكنك تبديل الدور أدناه أو الطلب من المسؤول منحك الصلاحية.',
    noLexRole:
      'لم يتم تعيين أي دور قانوني لك في مساحة العمل هذه، لذا فإن صفحات النظام القانوني غير متاحة. اطلب من المسؤول تعيين دور قانوني لك.',
    switchPrompt: 'لديك دور آخر يمكنه الوصول إلى هذه الصفحة:',
    switchTo: (roleName) => `التبديل إلى ${roleName}`,
    switching: 'جارٍ تبديل الدور…',
    switchFailed: 'تعذّر تبديل الدور. قد لا تكون تملك هذا الدور بعد الآن.',
    backToWorkspace: 'العودة إلى مساحة عملي',
    and: 'و',
    or: 'أو',
  },
};

export function getAccessDeniedLabels(locale: string): AccessDeniedLabels {
  return locale.startsWith('ar') ? ACCESS_DENIED_LABELS.ar : ACCESS_DENIED_LABELS.en;
}
