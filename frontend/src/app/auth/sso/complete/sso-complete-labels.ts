/**
 * Bilingual copy for the enterprise-SSO completion page (/auth/sso/complete).
 * Component-local labels following the app's `*-labels.ts` pattern: an object
 * per locale resolved against the active locale via `useBilingual` — the
 * global message catalog is owned by another workstream and is intentionally
 * not touched here.
 */

export interface SsoCompleteLabels {
  /** Badge + heading shown while the token handoff is being finalized. */
  completingBadge: string;
  completingTitle: string;
  completingDescription: string;
  completingDetail: string;
  /** Brief success state shown while the post-login redirect kicks in. */
  successBadge: string;
  successTitle: string;
  successDescription: string;
  /** Error surface. */
  errorBadge: string;
  errorTitle: string;
  errorDescription: string;
  /** The redirect landed without the expected token fragment. */
  missingToken: string;
  /** Storing the session (BFF handoff) failed. */
  sessionFailed: string;
  /** Action strip back to the sign-in page. */
  actionDescription: string;
  backToLogin: string;
}

export const SSO_COMPLETE_LABELS: Record<'en' | 'ar', SsoCompleteLabels> = {
  en: {
    completingBadge: 'Enterprise SSO',
    completingTitle: 'Completing your sign-in',
    completingDescription:
      'Your identity provider confirmed who you are. We are finalizing a secure session.',
    completingDetail: 'This usually takes a moment. Do not close this tab.',
    successBadge: 'Signed in',
    successTitle: 'You are signed in',
    successDescription: 'Taking you to your workspace…',
    errorBadge: 'Sign-in problem',
    errorTitle: 'We could not complete your SSO sign-in',
    errorDescription:
      'The single sign-on handoff did not finish. Return to the sign-in page and try again; if the problem persists, contact your administrator.',
    missingToken:
      'The sign-in response from your identity provider was missing its security token. Start the sign-in again from the sign-in page.',
    sessionFailed:
      'Your identity was confirmed, but we could not establish a session in this browser. Return to the sign-in page and try again.',
    actionDescription: 'Continue from the sign-in page.',
    backToLogin: 'Go to sign in',
  },
  ar: {
    completingBadge: 'الدخول الموحّد للمنشآت',
    completingTitle: 'جارٍ إكمال تسجيل دخولك',
    completingDescription:
      'أكّد مزوّد الهوية لديك هويتك. نقوم الآن بإنشاء جلسة آمنة.',
    completingDetail: 'يستغرق ذلك عادةً لحظات. لا تُغلق هذا التبويب.',
    successBadge: 'تم تسجيل الدخول',
    successTitle: 'تم تسجيل دخولك بنجاح',
    successDescription: 'جارٍ نقلك إلى مساحة عملك…',
    errorBadge: 'مشكلة في تسجيل الدخول',
    errorTitle: 'تعذّر إكمال تسجيل الدخول الموحّد',
    errorDescription:
      'لم تكتمل عملية الدخول الموحّد. عُد إلى صفحة تسجيل الدخول وحاول مرة أخرى؛ وإذا استمرت المشكلة فتواصل مع مسؤول النظام لديك.',
    missingToken:
      'استجابة تسجيل الدخول من مزوّد الهوية لا تحتوي على رمز الأمان المطلوب. ابدأ تسجيل الدخول من جديد من صفحة تسجيل الدخول.',
    sessionFailed:
      'تم تأكيد هويتك، لكن تعذّر إنشاء جلسة في هذا المتصفح. عُد إلى صفحة تسجيل الدخول وحاول مرة أخرى.',
    actionDescription: 'تابع من صفحة تسجيل الدخول.',
    backToLogin: 'الانتقال إلى تسجيل الدخول',
  },
};
