/**
 * Bilingual copy for the magic-link verification landing page
 * (/auth/magic-link/verify). Component-local labels following the app's
 * `*-labels.ts` pattern: an object per locale resolved against the active
 * locale via `useBilingual` — the global message catalog is owned by another
 * workstream and is intentionally not touched here.
 */

export interface MagicLinkVerifyLabels {
  /** Badge + heading shown while the token is being redeemed. */
  verifyingBadge: string;
  verifyingTitle: string;
  verifyingDescription: string;
  verifyingDetail: string;
  /** Brief success state shown while the post-login redirect kicks in. */
  successBadge: string;
  successTitle: string;
  successDescription: string;
  /** Invalid / expired / missing token. */
  errorBadge: string;
  errorTitle: string;
  errorDescription: string;
  invalidOrExpired: string;
  missingToken: string;
  /** Backend has not shipped / has disabled the capability. */
  unavailable: string;
  /** MFA continuation: the account requires a second factor. */
  mfaBadge: string;
  mfaTitle: string;
  mfaDescription: string;
  /** Action strip back to the sign-in page. */
  actionDescription: string;
  backToLogin: string;
}

export const MAGIC_LINK_VERIFY_LABELS: Record<'en' | 'ar', MagicLinkVerifyLabels> = {
  en: {
    verifyingBadge: 'Passwordless sign-in',
    verifyingTitle: 'Verifying your sign-in link',
    verifyingDescription:
      'Hold on while we confirm your one-time link and establish a secure session.',
    verifyingDetail: 'This usually takes a moment. Do not close this tab.',
    successBadge: 'Signed in',
    successTitle: 'You are signed in',
    successDescription: 'Taking you to your workspace…',
    errorBadge: 'Link problem',
    errorTitle: 'This sign-in link did not work',
    errorDescription:
      'We could not sign you in with this link. You can request a fresh link from the sign-in page at any time.',
    invalidOrExpired:
      'The link is invalid or has expired. Sign-in links are single-use and valid for a short time — request a new one from the sign-in page.',
    missingToken:
      'The link is missing its sign-in token. Open the most recent email we sent you and use the full link, or request a new one.',
    unavailable:
      'Passwordless sign-in is not available right now. Please sign in with your email and password instead.',
    mfaBadge: 'Verification required',
    mfaTitle: 'One more step',
    mfaDescription:
      'Your link was verified, but this account requires two-factor authentication. Continue from the sign-in page to complete verification.',
    actionDescription: 'Continue from the sign-in page.',
    backToLogin: 'Go to sign in',
  },
  ar: {
    verifyingBadge: 'تسجيل دخول بدون كلمة مرور',
    verifyingTitle: 'جارٍ التحقق من رابط تسجيل الدخول',
    verifyingDescription:
      'انتظر قليلاً بينما نتحقق من الرابط أحادي الاستخدام وننشئ جلسة آمنة.',
    verifyingDetail: 'يستغرق ذلك عادةً لحظات. لا تُغلق هذا التبويب.',
    successBadge: 'تم تسجيل الدخول',
    successTitle: 'تم تسجيل دخولك بنجاح',
    successDescription: 'جارٍ نقلك إلى مساحة عملك…',
    errorBadge: 'مشكلة في الرابط',
    errorTitle: 'تعذّر تسجيل الدخول عبر هذا الرابط',
    errorDescription:
      'لم نتمكن من تسجيل دخولك عبر هذا الرابط. يمكنك طلب رابط جديد من صفحة تسجيل الدخول في أي وقت.',
    invalidOrExpired:
      'الرابط غير صالح أو انتهت صلاحيته. روابط تسجيل الدخول أحادية الاستخدام وصالحة لفترة قصيرة — اطلب رابطًا جديدًا من صفحة تسجيل الدخول.',
    missingToken:
      'الرابط لا يحتوي على رمز تسجيل الدخول. افتح أحدث رسالة بريد إلكتروني أرسلناها إليك واستخدم الرابط كاملاً، أو اطلب رابطًا جديدًا.',
    unavailable:
      'تسجيل الدخول بدون كلمة مرور غير متاح حاليًا. الرجاء تسجيل الدخول بالبريد الإلكتروني وكلمة المرور.',
    mfaBadge: 'مطلوب تحقق إضافي',
    mfaTitle: 'خطوة أخيرة',
    mfaDescription:
      'تم التحقق من الرابط، لكن هذا الحساب يتطلب المصادقة الثنائية. تابع من صفحة تسجيل الدخول لإكمال التحقق.',
    actionDescription: 'تابع من صفحة تسجيل الدخول.',
    backToLogin: 'الانتقال إلى تسجيل الدخول',
  },
};
