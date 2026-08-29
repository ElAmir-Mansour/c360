'use client';

/**
 * Bilingual (English + Modern Standard Arabic, Saudi enterprise register)
 * label bundle for the Account Settings area.
 *
 * Pattern: a single `SETTINGS_L = { en: {...}, ar: {...} }` bundle holding two
 * full, same-shaped copies of every user-visible string. Components resolve the
 * active locale via the shared `useLocale()` provider and index the bundle:
 *
 *   import { useSettingsT } from '../_lib/settings-i18n';
 *   const t = useSettingsT();
 *   ...{t.accountSettings}...
 *
 * Code identifiers, enum keys, console logs, and product acronyms are NOT
 * translated. Western digits and interpolation params are preserved across
 * both locales.
 */

import { useLocale } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

interface SettingsStrings {
  /* Settings page header */
  eyebrowAccount: string;
  segmentLabel: string;
  accountSettings: string;
  accountSettingsDesc: string;
  loadingAccountSettings: string;

  /* Profile form */
  profileInformation: string;
  profileInformationDesc: string;
  /* Profile picture */
  profilePicture: string;
  changePhoto: string;
  uploadPhoto: string;
  removePhoto: string;
  uploadingPhoto: string;
  photoHint: string;
  photoUpdated: string;
  photoRemoved: string;
  photoUpdateFailed: string;
  photoErrorNotImage: string;
  photoErrorTooLarge: string;
  photoErrorDecode: string;
  firstName: string;
  lastName: string;
  email: string;
  emailChangeNote: string;
  emailVerificationStatus: string;
  emailVerified: string;
  emailVerifiedOn: (date: string) => string;
  emailVerificationPending: string;
  emailVerificationPendingDesc: string;
  verifyEmail: string;
  resendVerificationCode: string;
  sendingVerificationCode: string;
  verificationCodeSent: string;
  verificationCodeSendFailed: string;
  saveChanges: string;
  saving: string;
  profileUpdated: string;
  failedUpdateProfile: string;

  /* Signature profile */
  signatureProfile: string;
  signatureProfileDesc: string;
  signatureTypedName: string;
  signatureTypedNamePlaceholder: string;
  signatureInitials: string;
  signatureInitialsPlaceholder: string;
  signatureImage: string;
  signatureInitialsImage: string;
  signatureUploadSignature: string;
  signatureUploadInitials: string;
  signatureDrawSignature: string;
  signatureDrawInitials: string;
  signatureUseDrawing: string;
  signatureClearDrawing: string;
  signatureRemoveImage: string;
  signaturePreview: string;
  signatureNoImage: string;
  signatureConsent: string;
  signatureOpenSignatures: string;
  signatureSave: string;
  signatureSaving: string;
  signatureDelete: string;
  signatureSaved: string;
  signatureDeleted: string;
  signatureLoadError: string;
  signatureSaveError: string;
  signatureDeleteError: string;
  signatureUploadTooLarge: string;
  signatureUnsupportedFile: string;
  signatureEmptyProfile: string;

  /* Password change form */
  changePassword: string;
  changePasswordDesc: string;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  updatePassword: string;
  updating: string;
  passwordChangedSuccess: string;
  otherSessionsLoggedOut: string;
  incorrectCurrentPassword: string;
  invalidValue: string;
  failedChangePassword: string;

  /* MFA section */
  twoFactorAuth: string;
  twoFactorAuthDesc: string;
  mfaRequiredWarning: string;
  twoFAEnabled: string;
  twoFANotEnabled: string;
  enabled: string;
  disabled: string;
  enable2FA: string;
  disable2FA: string;

  /* Sessions section */
  activeSessions: string;
  activeSessionsDesc: string;
  sessionsBeingSetUp: string;
  current: string;
  revoke: string;
  revokeAllOtherSessions: string;
  revokeAllOtherSessionsTitle: string;
  revokeAllOtherSessionsDesc: string;
  revokeAll: string;
  sessionRevoked: string;
  failedRevokeSession: string;
  allOtherSessionsRevoked: string;
  failedRevokeSessions: string;
  deviceMobile: string;
  deviceTablet: string;
  deviceDesktop: string;
  browserGeneric: string;

  /* API keys section */
  apiKeys: string;
  apiKeysDesc: string;
  createApiKey: string;
  noApiKeysYet: string;
  expiresLabel: string;
  createdLabel: string;
  lastUsedLabel: string;
  neverUsed: string;
  apiKeyDialogDesc: string;
  cancel: string;
  copyKeyNow: string;
  copyApiKeyAria: string;
  done: string;
  nameRequired: string;
  namePlaceholder: string;
  scopesRequired: string;
  creating: string;
  apiKeyCreated: string;
  apiKeyCopied: string;
  failedCreateApiKey: string;
  closeWithoutSaving: string;
  closeWithoutSavingDesc: string;
  closeAnyway: string;
  revokeApiKeyTitle: string;
  revokeApiKeyDesc: (name: string) => string;
  revokeKey: string;
  apiKeyRevoked: string;
  failedRevokeApiKey: string;

  /* Notification preferences page */
  notificationPreferences: string;
  notificationPreferencesDesc: string;
  resetToDefaults: string;
  notificationChannels: string;
  notificationChannelsDesc: string;
  inAppNotifications: string;
  alwaysEnabled: string;
  emailNotifications: string;
  emailNotificationsDesc: string;
  realtimeNotifications: string;
  realtimeNotificationsDesc: string;
  webhookNotifications: string;
  webhookNotificationsDesc: string;
  quietHours: string;
  quietHoursDesc: string;
  enableQuietHours: string;
  startTime: string;
  endTime: string;
  timezone: string;
  digest: string;
  digestDesc: string;
  dailyDigest: string;
  dailyDigestDesc: string;
  weeklyDigest: string;
  weeklyDigestDesc: string;
  enableDailyDigest: string;
  enableWeeklyDigest: string;
  perTypeSettings: string;
  perTypeSettingsDesc: string;
  channelOverrides: string;
  channelInApp: string;
  channelEmail: string;
  channelRealtime: string;
  channelWebhook: string;
  savePreferences: string;
  savingPreferences: string;
  resetToDefaultsTitle: string;
  resetToDefaultsDesc: string;
  reset: string;
  preferencesSaved: string;
  failedSavePreferences: string;
  loadingPreferences: string;
  failedLoadPreferences: string;

  /* Notification type labels */
  notificationTypes: Record<string, string>;
}

const en: SettingsStrings = {
  eyebrowAccount: 'Account',
  segmentLabel: 'Settings',
  accountSettings: 'Account Settings',
  accountSettingsDesc: 'Manage your profile, security, and API access',
  loadingAccountSettings: 'Loading account settings',

  profileInformation: 'Profile Information',
  profileInformationDesc: 'Update your display name.',
  profilePicture: 'Profile picture',
  changePhoto: 'Change photo',
  uploadPhoto: 'Upload photo',
  removePhoto: 'Remove',
  uploadingPhoto: 'Uploading...',
  photoHint: 'PNG, JPG, or WebP. Square images look best; large photos are resized automatically.',
  photoUpdated: 'Profile picture updated.',
  photoRemoved: 'Profile picture removed.',
  photoUpdateFailed: 'Could not update your profile picture. Please try again.',
  photoErrorNotImage: 'Please choose an image file (PNG, JPG, or WebP).',
  photoErrorTooLarge: 'That image is too large. Please choose a file under 5 MB.',
  photoErrorDecode: 'We could not read that image. Please try a different file.',
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  emailChangeNote: 'Email changes require a verification flow. Contact support.',
  emailVerificationStatus: 'Email verification status',
  emailVerified: 'Verified',
  emailVerifiedOn: (date) => `Verified on ${date}`,
  emailVerificationPending: 'Verification pending',
  emailVerificationPendingDesc:
    'You can keep using Clario360, but verify this email to keep account recovery and email notifications reliable.',
  verifyEmail: 'Verify email',
  resendVerificationCode: 'Resend code',
  sendingVerificationCode: 'Sending...',
  verificationCodeSent: 'A new verification code has been sent.',
  verificationCodeSendFailed: 'Failed to send a new code. Open the verification flow and try again.',
  saveChanges: 'Save Changes',
  saving: 'Saving...',
  profileUpdated: 'Profile updated.',
  failedUpdateProfile: 'Failed to update profile.',

  signatureProfile: 'Signature Profile',
  signatureProfileDesc: 'Save a reusable signature and initials for native Watheeq signing.',
  signatureTypedName: 'Typed name',
  signatureTypedNamePlaceholder: 'Your legal signing name',
  signatureInitials: 'Initials',
  signatureInitialsPlaceholder: 'AB',
  signatureImage: 'Signature image',
  signatureInitialsImage: 'Initials image',
  signatureUploadSignature: 'Upload signature',
  signatureUploadInitials: 'Upload initials',
  signatureDrawSignature: 'Draw signature',
  signatureDrawInitials: 'Draw initials',
  signatureUseDrawing: 'Use drawing',
  signatureClearDrawing: 'Clear',
  signatureRemoveImage: 'Remove image',
  signaturePreview: 'Preview',
  signatureNoImage: 'No image saved',
  signatureConsent: 'I consent to use this saved signature for native Watheeq signing.',
  signatureOpenSignatures: 'Open Signatures',
  signatureSave: 'Save signature',
  signatureSaving: 'Saving...',
  signatureDelete: 'Delete signature',
  signatureSaved: 'Signature profile saved.',
  signatureDeleted: 'Signature profile deleted.',
  signatureLoadError: 'Failed to load signature profile.',
  signatureSaveError: 'Failed to save signature profile.',
  signatureDeleteError: 'Failed to delete signature profile.',
  signatureUploadTooLarge: 'Signature images must be 512KB or smaller.',
  signatureUnsupportedFile: 'Use PNG, JPEG, WebP, or SVG.',
  signatureEmptyProfile: 'Add a typed name or signature image before saving.',

  changePassword: 'Change Password',
  changePasswordDesc:
    'Update your password. You will be logged out of all other sessions.',
  currentPassword: 'Current Password',
  newPassword: 'New Password',
  confirmNewPassword: 'Confirm New Password',
  updatePassword: 'Update Password',
  updating: 'Updating...',
  passwordChangedSuccess: 'Password changed successfully.',
  otherSessionsLoggedOut: 'All other sessions have been logged out for security.',
  incorrectCurrentPassword: 'Incorrect current password.',
  invalidValue: 'Invalid value',
  failedChangePassword: 'Failed to change password.',

  twoFactorAuth: 'Two-Factor Authentication',
  twoFactorAuthDesc: 'Add an extra layer of security to your account.',
  mfaRequiredWarning:
    'Your organization requires two-factor authentication. Please enable it to continue using the platform.',
  twoFAEnabled: '2FA is enabled',
  twoFANotEnabled: '2FA is not enabled',
  enabled: 'Enabled',
  disabled: 'Disabled',
  enable2FA: 'Enable 2FA',
  disable2FA: 'Disable 2FA',

  activeSessions: 'Active Sessions',
  activeSessionsDesc: 'Manage your active login sessions across all devices.',
  sessionsBeingSetUp: 'Session management is being set up for your organization.',
  current: 'Current',
  revoke: 'Revoke',
  revokeAllOtherSessions: 'Revoke All Other Sessions',
  revokeAllOtherSessionsTitle: 'Revoke All Other Sessions',
  revokeAllOtherSessionsDesc:
    'This will log you out of all other devices. Your current session will remain active.',
  revokeAll: 'Revoke All',
  sessionRevoked: 'Session revoked.',
  failedRevokeSession: 'Failed to revoke session.',
  allOtherSessionsRevoked: 'All other sessions have been revoked.',
  failedRevokeSessions: 'Failed to revoke sessions.',
  deviceMobile: 'Mobile',
  deviceTablet: 'Tablet',
  deviceDesktop: 'Desktop',
  browserGeneric: 'Browser',

  apiKeys: 'API Keys',
  apiKeysDesc: 'Manage programmatic access to the platform.',
  createApiKey: 'Create API Key',
  noApiKeysYet: 'No API keys yet.',
  expiresLabel: 'Expires',
  createdLabel: 'Created',
  lastUsedLabel: 'Last used',
  neverUsed: 'Never used',
  apiKeyDialogDesc: 'API keys provide programmatic access to the platform.',
  cancel: 'Cancel',
  copyKeyNow: "Copy your API key now. It won't be shown again.",
  copyApiKeyAria: 'Copy API key',
  done: 'Done',
  nameRequired: 'Name *',
  namePlaceholder: 'e.g. CI/CD Bot',
  scopesRequired: 'Scopes *',
  creating: 'Creating...',
  apiKeyCreated: 'API key created.',
  apiKeyCopied: 'API key copied.',
  failedCreateApiKey: 'Failed to create API key.',
  closeWithoutSaving: 'Close without saving?',
  closeWithoutSavingDesc: 'Have you saved your API key? It will not be shown again.',
  closeAnyway: 'Close Anyway',
  revokeApiKeyTitle: 'Revoke API Key',
  revokeApiKeyDesc: (name) =>
    `Are you sure you want to revoke "${name}"? Any applications using this key will lose access immediately.`,
  revokeKey: 'Revoke Key',
  apiKeyRevoked: 'API key revoked.',
  failedRevokeApiKey: 'Failed to revoke API key.',

  notificationPreferences: 'Notification Preferences',
  notificationPreferencesDesc: 'Customize how and when you receive notifications.',
  resetToDefaults: 'Reset to Defaults',
  notificationChannels: 'Notification Channels',
  notificationChannelsDesc: 'Choose how you receive notifications',
  inAppNotifications: 'In-app notifications',
  alwaysEnabled: 'Always enabled',
  emailNotifications: 'Email notifications',
  emailNotificationsDesc: 'Receive notifications via email',
  realtimeNotifications: 'Real-time notifications',
  realtimeNotificationsDesc: 'Live updates via WebSocket connection',
  webhookNotifications: 'Webhook notifications',
  webhookNotificationsDesc: 'Deliver to registered webhook endpoints',
  quietHours: 'Quiet Hours',
  quietHoursDesc:
    'During quiet hours, only critical notifications are delivered immediately.',
  enableQuietHours: 'Enable quiet hours',
  startTime: 'Start time',
  endTime: 'End time',
  timezone: 'Timezone',
  digest: 'Digest',
  digestDesc: 'Receive a summary of notifications via email.',
  dailyDigest: 'Daily digest',
  dailyDigestDesc: 'Receive a daily summary each morning',
  weeklyDigest: 'Weekly digest',
  weeklyDigestDesc: 'Receive a weekly summary each Monday',
  enableDailyDigest: 'Enable daily digest',
  enableWeeklyDigest: 'Enable weekly digest',
  perTypeSettings: 'Per-Type Settings',
  perTypeSettingsDesc: 'Override global channel settings for specific notification types.',
  channelOverrides: 'Channel overrides',
  channelInApp: 'In-app',
  channelEmail: 'Email',
  channelRealtime: 'Real-time',
  channelWebhook: 'Webhook',
  savePreferences: 'Save Preferences',
  savingPreferences: 'Saving...',
  resetToDefaultsTitle: 'Reset to Defaults',
  resetToDefaultsDesc:
    'This will reset all notification preferences to their default values. Your current settings will be lost.',
  reset: 'Reset',
  preferencesSaved: 'Preferences saved',
  failedSavePreferences: 'Failed to save preferences',
  loadingPreferences: 'Loading preferences…',
  failedLoadPreferences: 'Failed to load preferences',

  notificationTypes: {
    'alert.created': 'Security Alerts',
    'alert.escalated': 'Alert Escalations',
    'security.incident': 'Security Incidents',
    'login.anomaly': 'Login Anomalies',
    'malware.detected': 'Malware Detection',
    'remediation.approval_required': 'Remediation Approvals',
    'remediation.completed': 'Remediation Completed',
    'remediation.failed': 'Remediation Failures',
    'task.assigned': 'Task Assignments',
    'task.overdue': 'Task Overdue',
    'task.escalated': 'Task Escalations',
    'workflow.failed': 'Workflow Failures',
    'workflow.completed': 'Workflow Completions',
    'pipeline.failed': 'Pipeline Failures',
    'pipeline.completed': 'Pipeline Completions',
    'data_quality.issue_detected': 'Data Quality Issues',
    'contradiction.detected': 'Contradiction Detected',
    'contract.expiring': 'Contract Expirations',
    'contract.created': 'Contract Created',
    'analysis.ready': 'Analysis Ready',
    'clause.risk_flagged': 'Clause Risk Flagged',
    'meeting.scheduled': 'Meeting Scheduled',
    'meeting.reminder': 'Meeting Reminders',
    'action_item.assigned': 'Action Item Assigned',
    'action_item.overdue': 'Action Item Overdue',
    'minutes.approved': 'Minutes Approved',
    'kpi.threshold_breached': 'KPI Threshold Breached',
    'password.expiring': 'Password Expiring',
    'system.maintenance': 'System Maintenance',
    welcome: 'Welcome',
  },
};

const ar: SettingsStrings = {
  eyebrowAccount: 'الحساب',
  segmentLabel: 'الإعدادات',
  accountSettings: 'إعدادات الحساب',
  accountSettingsDesc: 'إدارة ملفك الشخصي والأمن والوصول عبر واجهة برمجة التطبيقات',
  loadingAccountSettings: 'جارٍ تحميل الإعدادات الخاصة بالحساب',

  profileInformation: 'معلومات الملف الشخصي',
  profileInformationDesc: 'حدّث اسمك المعروض.',
  profilePicture: 'الصورة الشخصية',
  changePhoto: 'تغيير الصورة',
  uploadPhoto: 'رفع صورة',
  removePhoto: 'إزالة',
  uploadingPhoto: 'جارٍ الرفع...',
  photoHint: 'صيغ PNG أو JPG أو WebP. الصور المربّعة تظهر بأفضل شكل، ويُعاد تحجيم الصور الكبيرة تلقائيًا.',
  photoUpdated: 'تم تحديث الصورة الشخصية.',
  photoRemoved: 'تمت إزالة الصورة الشخصية.',
  photoUpdateFailed: 'تعذّر تحديث صورتك الشخصية. يُرجى المحاولة مرة أخرى.',
  photoErrorNotImage: 'يُرجى اختيار ملف صورة (PNG أو JPG أو WebP).',
  photoErrorTooLarge: 'هذه الصورة كبيرة جدًا. يُرجى اختيار ملف أصغر من 5 ميجابايت.',
  photoErrorDecode: 'تعذّرت قراءة هذه الصورة. يُرجى تجربة ملف آخر.',
  firstName: 'الاسم الأول',
  lastName: 'اسم العائلة',
  email: 'البريد الإلكتروني',
  emailChangeNote:
    'يتطلب تغيير البريد الإلكتروني إجراء تحقق. يُرجى التواصل مع الدعم.',
  emailVerificationStatus: 'حالة تحقق البريد الإلكتروني',
  emailVerified: 'تم التحقق',
  emailVerifiedOn: (date) => `تم التحقق في ${date}`,
  emailVerificationPending: 'التحقق معلّق',
  emailVerificationPendingDesc:
    'يمكنك متابعة استخدام Clario360، لكن تحقّق من هذا البريد للحفاظ على موثوقية استرداد الحساب وإشعارات البريد.',
  verifyEmail: 'التحقق من البريد',
  resendVerificationCode: 'إعادة إرسال الرمز',
  sendingVerificationCode: 'جارٍ الإرسال...',
  verificationCodeSent: 'تم إرسال رمز تحقق جديد.',
  verificationCodeSendFailed:
    'تعذّر إرسال رمز جديد. افتح مسار التحقق وحاول مرة أخرى.',
  saveChanges: 'حفظ التغييرات',
  saving: 'جارٍ الحفظ...',
  profileUpdated: 'تم تحديث الملف الشخصي.',
  failedUpdateProfile: 'تعذّر تحديث الملف الشخصي.',

  signatureProfile: 'ملف التوقيع',
  signatureProfileDesc: 'احفظ توقيعًا وأحرفًا أولى قابلة لإعادة الاستخدام للتوقيع المحلي في وثيقتك.',
  signatureTypedName: 'الاسم المكتوب',
  signatureTypedNamePlaceholder: 'اسمك القانوني للتوقيع',
  signatureInitials: 'الأحرف الأولى',
  signatureInitialsPlaceholder: 'م ع',
  signatureImage: 'صورة التوقيع',
  signatureInitialsImage: 'صورة الأحرف الأولى',
  signatureUploadSignature: 'رفع التوقيع',
  signatureUploadInitials: 'رفع الأحرف الأولى',
  signatureDrawSignature: 'رسم التوقيع',
  signatureDrawInitials: 'رسم الأحرف الأولى',
  signatureUseDrawing: 'استخدام الرسم',
  signatureClearDrawing: 'مسح',
  signatureRemoveImage: 'إزالة الصورة',
  signaturePreview: 'معاينة',
  signatureNoImage: 'لا توجد صورة محفوظة',
  signatureConsent: 'أوافق على استخدام هذا التوقيع المحفوظ للتوقيع المحلي في وثيقتك.',
  signatureOpenSignatures: 'فتح التوقيعات',
  signatureSave: 'حفظ التوقيع',
  signatureSaving: 'جارٍ الحفظ...',
  signatureDelete: 'حذف التوقيع',
  signatureSaved: 'تم حفظ ملف التوقيع.',
  signatureDeleted: 'تم حذف ملف التوقيع.',
  signatureLoadError: 'تعذّر تحميل ملف التوقيع.',
  signatureSaveError: 'تعذّر حفظ ملف التوقيع.',
  signatureDeleteError: 'تعذّر حذف ملف التوقيع.',
  signatureUploadTooLarge: 'يجب ألا يتجاوز حجم صورة التوقيع 512 كيلوبايت.',
  signatureUnsupportedFile: 'استخدم PNG أو JPEG أو WebP أو SVG.',
  signatureEmptyProfile: 'أضف اسمًا مكتوبًا أو صورة توقيع قبل الحفظ.',

  changePassword: 'تغيير كلمة المرور',
  changePasswordDesc:
    'حدّث كلمة المرور الخاصة بك. سيتم تسجيل خروجك من جميع الجلسات الأخرى.',
  currentPassword: 'كلمة المرور الحالية',
  newPassword: 'كلمة المرور الجديدة',
  confirmNewPassword: 'تأكيد كلمة المرور الجديدة',
  updatePassword: 'تحديث كلمة المرور',
  updating: 'جارٍ التحديث...',
  passwordChangedSuccess: 'تم تغيير كلمة المرور بنجاح.',
  otherSessionsLoggedOut: 'تم تسجيل الخروج من جميع الجلسات الأخرى حفاظًا على الأمن.',
  incorrectCurrentPassword: 'كلمة المرور الحالية غير صحيحة.',
  invalidValue: 'قيمة غير صالحة',
  failedChangePassword: 'تعذّر تغيير كلمة المرور.',

  twoFactorAuth: 'المصادقة الثنائية',
  twoFactorAuthDesc: 'أضف طبقة أمان إضافية إلى حسابك.',
  mfaRequiredWarning:
    'تتطلب مؤسستك تفعيل المصادقة الثنائية. يُرجى تفعيلها لمواصلة استخدام المنصة.',
  twoFAEnabled: 'المصادقة الثنائية مُفعّلة',
  twoFANotEnabled: 'المصادقة الثنائية غير مُفعّلة',
  enabled: 'مُفعّل',
  disabled: 'مُعطّل',
  enable2FA: 'تفعيل المصادقة الثنائية',
  disable2FA: 'تعطيل المصادقة الثنائية',

  activeSessions: 'الجلسات النشطة',
  activeSessionsDesc: 'إدارة جلسات تسجيل الدخول النشطة عبر جميع الأجهزة.',
  sessionsBeingSetUp: 'يجري إعداد إدارة الجلسات لمؤسستك.',
  current: 'الحالية',
  revoke: 'إلغاء',
  revokeAllOtherSessions: 'إلغاء جميع الجلسات الأخرى',
  revokeAllOtherSessionsTitle: 'إلغاء جميع الجلسات الأخرى',
  revokeAllOtherSessionsDesc:
    'سيؤدي ذلك إلى تسجيل خروجك من جميع الأجهزة الأخرى. ستبقى جلستك الحالية نشطة.',
  revokeAll: 'إلغاء الكل',
  sessionRevoked: 'تم إلغاء الجلسة.',
  failedRevokeSession: 'تعذّر إلغاء الجلسة.',
  allOtherSessionsRevoked: 'تم إلغاء جميع الجلسات الأخرى.',
  failedRevokeSessions: 'تعذّر إلغاء الجلسات.',
  deviceMobile: 'جوال',
  deviceTablet: 'جهاز لوحي',
  deviceDesktop: 'حاسوب مكتبي',
  browserGeneric: 'متصفّح',

  apiKeys: 'مفاتيح واجهة برمجة التطبيقات',
  apiKeysDesc: 'إدارة الوصول البرمجي إلى المنصة.',
  createApiKey: 'إنشاء مفتاح واجهة برمجة التطبيقات',
  noApiKeysYet: 'لا توجد مفاتيح بعد.',
  expiresLabel: 'تنتهي صلاحيته',
  createdLabel: 'أُنشئ في',
  lastUsedLabel: 'آخر استخدام',
  neverUsed: 'لم يُستخدم مطلقًا',
  apiKeyDialogDesc: 'توفّر مفاتيح واجهة برمجة التطبيقات وصولًا برمجيًا إلى المنصة.',
  cancel: 'إلغاء',
  copyKeyNow: 'انسخ مفتاحك الآن. لن يُعرض مرة أخرى.',
  copyApiKeyAria: 'نسخ مفتاح واجهة برمجة التطبيقات',
  done: 'تم',
  nameRequired: 'الاسم *',
  namePlaceholder: 'مثال: روبوت CI/CD',
  scopesRequired: 'الصلاحيات *',
  creating: 'جارٍ الإنشاء...',
  apiKeyCreated: 'تم إنشاء المفتاح.',
  apiKeyCopied: 'تم نسخ المفتاح.',
  failedCreateApiKey: 'تعذّر إنشاء المفتاح.',
  closeWithoutSaving: 'الإغلاق دون حفظ؟',
  closeWithoutSavingDesc: 'هل حفظت مفتاحك؟ لن يُعرض مرة أخرى.',
  closeAnyway: 'الإغلاق على أي حال',
  revokeApiKeyTitle: 'إلغاء المفتاح',
  revokeApiKeyDesc: (name) =>
    `هل أنت متأكد من رغبتك في إلغاء "${name}"؟ ستفقد أي تطبيقات تستخدم هذا المفتاح الوصول فورًا.`,
  revokeKey: 'إلغاء المفتاح',
  apiKeyRevoked: 'تم إلغاء المفتاح.',
  failedRevokeApiKey: 'تعذّر إلغاء المفتاح.',

  notificationPreferences: 'تفضيلات الإشعارات',
  notificationPreferencesDesc: 'خصّص كيفية وتوقيت استلامك للإشعارات.',
  resetToDefaults: 'إعادة التعيين إلى الإعدادات الافتراضية',
  notificationChannels: 'قنوات الإشعارات',
  notificationChannelsDesc: 'اختر كيفية استلامك للإشعارات',
  inAppNotifications: 'إشعارات داخل التطبيق',
  alwaysEnabled: 'مُفعّلة دائمًا',
  emailNotifications: 'إشعارات البريد الإلكتروني',
  emailNotificationsDesc: 'استلام الإشعارات عبر البريد الإلكتروني',
  realtimeNotifications: 'إشعارات فورية',
  realtimeNotificationsDesc: 'تحديثات مباشرة عبر اتصال WebSocket',
  webhookNotifications: 'إشعارات عبر خطاف الويب',
  webhookNotificationsDesc: 'التسليم إلى نقاط نهاية خطاف الويب المسجّلة',
  quietHours: 'ساعات الهدوء',
  quietHoursDesc: 'خلال ساعات الهدوء، تُسلَّم الإشعارات الحرجة فقط على الفور.',
  enableQuietHours: 'تفعيل ساعات الهدوء',
  startTime: 'وقت البدء',
  endTime: 'وقت الانتهاء',
  timezone: 'المنطقة الزمنية',
  digest: 'الملخّص',
  digestDesc: 'استلام ملخّص للإشعارات عبر البريد الإلكتروني.',
  dailyDigest: 'الملخّص اليومي',
  dailyDigestDesc: 'استلام ملخّص يومي كل صباح',
  weeklyDigest: 'الملخّص الأسبوعي',
  weeklyDigestDesc: 'استلام ملخّص أسبوعي كل يوم اثنين',
  enableDailyDigest: 'تفعيل الملخّص اليومي',
  enableWeeklyDigest: 'تفعيل الملخّص الأسبوعي',
  perTypeSettings: 'إعدادات حسب النوع',
  perTypeSettingsDesc: 'تجاوز إعدادات القنوات العامة لأنواع إشعارات محددة.',
  channelOverrides: 'تجاوزات القنوات',
  channelInApp: 'داخل التطبيق',
  channelEmail: 'البريد الإلكتروني',
  channelRealtime: 'فوري',
  channelWebhook: 'خطاف ويب',
  savePreferences: 'حفظ التفضيلات',
  savingPreferences: 'جارٍ الحفظ...',
  resetToDefaultsTitle: 'إعادة التعيين إلى الإعدادات الافتراضية',
  resetToDefaultsDesc:
    'سيؤدي ذلك إلى إعادة تعيين جميع تفضيلات الإشعارات إلى قيمها الافتراضية. ستفقد إعداداتك الحالية.',
  reset: 'إعادة التعيين',
  preferencesSaved: 'تم حفظ التفضيلات',
  failedSavePreferences: 'تعذّر حفظ التفضيلات',
  loadingPreferences: 'جارٍ تحميل التفضيلات…',
  failedLoadPreferences: 'تعذّر تحميل التفضيلات',

  notificationTypes: {
    'alert.created': 'تنبيهات أمنية',
    'alert.escalated': 'تصعيدات التنبيهات',
    'security.incident': 'حوادث أمنية',
    'login.anomaly': 'حالات تسجيل دخول شاذة',
    'malware.detected': 'اكتشاف برمجيات خبيثة',
    'remediation.approval_required': 'اعتمادات المعالجة',
    'remediation.completed': 'اكتمال المعالجة',
    'remediation.failed': 'إخفاقات المعالجة',
    'task.assigned': 'إسناد المهام',
    'task.overdue': 'مهام متأخرة',
    'task.escalated': 'تصعيدات المهام',
    'workflow.failed': 'إخفاقات سير العمل',
    'workflow.completed': 'اكتمال سير العمل',
    'pipeline.failed': 'إخفاقات خط البيانات',
    'pipeline.completed': 'اكتمال خط البيانات',
    'data_quality.issue_detected': 'مشكلات جودة البيانات',
    'contradiction.detected': 'اكتشاف تعارض',
    'contract.expiring': 'انتهاء صلاحية العقود',
    'contract.created': 'إنشاء عقد',
    'analysis.ready': 'التحليل جاهز',
    'clause.risk_flagged': 'الإشارة إلى مخاطر بند',
    'meeting.scheduled': 'جدولة اجتماع',
    'meeting.reminder': 'تذكيرات الاجتماعات',
    'action_item.assigned': 'إسناد بند إجرائي',
    'action_item.overdue': 'بند إجرائي متأخر',
    'minutes.approved': 'اعتماد المحضر',
    'kpi.threshold_breached': 'تجاوز عتبة مؤشر الأداء',
    'password.expiring': 'انتهاء صلاحية كلمة المرور',
    'system.maintenance': 'صيانة النظام',
    welcome: 'مرحبًا',
  },
};

export const SETTINGS_L: Record<AppLocale, SettingsStrings> = { en, ar };

/** React hook resolving the Account Settings strings for the active locale. */
export function useSettingsT(): SettingsStrings {
  const { locale } = useLocale();
  return SETTINGS_L[locale];
}
