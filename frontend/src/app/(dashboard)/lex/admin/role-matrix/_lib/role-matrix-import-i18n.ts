'use client';

/**
 * Bilingual labels for the tenant Role-Matrix Import + Versions surfaces.
 * Follows the lex bilingual contract (EN + professional MSA), resolved by the
 * active locale.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type {
  RoleMatrixImportMode,
  RoleMatrixImportStatus,
  RoleMatrixVersionStatus,
} from '@/lib/lex/admin';

export interface RoleMatrixImportLabels {
  importCta: string;
  versionsCta: string;
  dialogTitle: string;
  dialogDescription: string;
  downloadStep: string;
  templateHelp: string;
  currentTemplate: string;
  blankTemplate: string;
  behaviorStep: string;
  modes: Record<RoleMatrixImportMode, { label: string; description: string }>;
  replaceWarning: string;
  uploadStep: string;
  chooseFile: string;
  noFile: string;
  parsedSummary: (roles: number, grants: number) => string;
  runDryRun: string;
  validationResult: string;
  status: Record<RoleMatrixImportStatus, string>;
  summary: { roles: string; grants: string; added: string; removed: string; unchanged: string };
  diffHeading: string;
  rolesAdded: (list: string) => string;
  rolesDeactivated: (list: string) => string;
  noChanges: string;
  validationErrors: (count: number) => string;
  warnings: (count: number) => string;
  confirmWarnings: string;
  errorReport: string;
  allPassed: string;
  changeReason: string;
  changeReasonPlaceholder: string;
  commit: string;
  committed: string;
  fourEyesNote: string;
  emptyFile: string;
  readError: string;
  close: string;
  history: string;
  noHistory: string;
  // Versions dialog
  versionsTitle: string;
  versionsDescription: string;
  versionStatus: Record<RoleMatrixVersionStatus, string>;
  versionLine: (version: number) => string;
  rolesCount: (count: number) => string;
  activate: string;
  rollback: string;
  activated: string;
  confirmActivateTitle: string;
  confirmActivateDescription: string;
  noVersions: string;
  bySomeone: (who: string) => string;
}

const EN: RoleMatrixImportLabels = {
  importCta: 'Import matrix',
  versionsCta: 'Versions',
  dialogTitle: 'Import role matrix',
  dialogDescription:
    'Upload a filled template to redefine this tenant’s role → permission grants. Changes are validated, previewed, committed as a draft version, and only enforced after a second administrator activates them.',
  downloadStep: '1 · Download the template',
  templateHelp: 'Prefilled with the currently enforced matrix — edit the X marks and re-upload.',
  currentTemplate: 'Current matrix',
  blankTemplate: 'Blank grid',
  behaviorStep: '2 · Import behaviour',
  modes: {
    merge: { label: 'Merge', description: 'Roles in the file replace their grants; roles not mentioned keep their current state.' },
    replace: { label: 'Replace', description: 'The file becomes the complete matrix; roles missing from it are deactivated.' },
  },
  replaceWarning: 'Replace deactivates every role the file does not mention. Roles are parked, never deleted.',
  uploadStep: '3 · Upload & validate',
  chooseFile: 'Choose file',
  noFile: 'No file selected',
  parsedSummary: (roles, grants) => `${roles} roles · ${grants} grants parsed`,
  runDryRun: 'Validate (dry-run)',
  validationResult: 'Validation result',
  status: { validated: 'Validated', failed: 'Failed', committed: 'Committed' },
  summary: { roles: 'Roles', grants: 'Grants', added: 'Grants added', removed: 'Grants removed', unchanged: 'Roles unchanged' },
  diffHeading: 'Changes vs the enforced matrix',
  rolesAdded: (list) => `New roles: ${list}`,
  rolesDeactivated: (list) => `Deactivated: ${list}`,
  noChanges: 'No changes — the file matches the enforced matrix.',
  validationErrors: (count) => `${count} validation error(s) — fix and re-upload`,
  warnings: (count) => `${count} warning(s) require explicit confirmation`,
  confirmWarnings: 'I understand the elevated grants flagged above and confirm them.',
  errorReport: 'Error report',
  allPassed: 'All checks passed.',
  changeReason: 'Change reason',
  changeReasonPlaceholder: 'e.g. Delegate contract sign-off to the deputy director',
  commit: 'Commit draft version',
  committed: 'Draft version committed — a second administrator must activate it.',
  fourEyesNote: 'Four-eyes: the importer cannot activate their own version.',
  emptyFile: 'The file contains no grants.',
  readError: 'The file could not be parsed — use an unmodified template layout.',
  close: 'Close',
  history: 'Import history',
  noHistory: 'No imports yet.',
  versionsTitle: 'Role-matrix versions',
  versionsDescription:
    'Every committed import is an immutable, reason-tagged version. Activating applies it to enforcement; activating an older version rolls back.',
  versionStatus: { draft: 'Draft', active: 'Active', superseded: 'Superseded' },
  versionLine: (version) => `Version ${version}`,
  rolesCount: (count) => `${count} roles`,
  activate: 'Activate',
  rollback: 'Re-activate',
  activated: 'Version activated — enforcement updated.',
  confirmActivateTitle: 'Activate this matrix version?',
  confirmActivateDescription:
    'The snapshot becomes the enforced role → permission matrix for this tenant immediately. The current active version is superseded (you can roll back to it later).',
  noVersions: 'No versions yet — commit an import first.',
  bySomeone: (who) => `by ${who}`,
};

const AR: RoleMatrixImportLabels = {
  importCta: 'استيراد المصفوفة',
  versionsCta: 'الإصدارات',
  dialogTitle: 'استيراد مصفوفة الأدوار',
  dialogDescription:
    'ارفع قالباً معبأً لإعادة تعريف صلاحيات الأدوار لهذا المستأجر. تُدقَّق التغييرات وتُعاين ثم تُعتمد كإصدار مسودة، ولا تُنفَّذ إلا بعد تفعيلها من مسؤول ثانٍ.',
  downloadStep: '١ · تنزيل القالب',
  templateHelp: 'معبأ مسبقاً بالمصفوفة المطبقة حالياً — عدّل علامات X ثم أعد الرفع.',
  currentTemplate: 'المصفوفة الحالية',
  blankTemplate: 'شبكة فارغة',
  behaviorStep: '٢ · سلوك الاستيراد',
  modes: {
    merge: { label: 'دمج', description: 'الأدوار الواردة في الملف تستبدل صلاحياتها؛ وغير المذكورة تبقى على حالها.' },
    replace: { label: 'استبدال', description: 'يصبح الملف هو المصفوفة الكاملة؛ وتُعطَّل الأدوار غير المذكورة فيه.' },
  },
  replaceWarning: 'وضع الاستبدال يعطّل كل دور لا يذكره الملف. تُوقَف الأدوار ولا تُحذف أبداً.',
  uploadStep: '٣ · الرفع والتدقيق',
  chooseFile: 'اختيار ملف',
  noFile: 'لم يُختَر ملف',
  parsedSummary: (roles, grants) => `تم تحليل ${roles} دور و${grants} صلاحية`,
  runDryRun: 'تدقيق (بدون تنفيذ)',
  validationResult: 'نتيجة التدقيق',
  status: { validated: 'مُدقَّق', failed: 'مرفوض', committed: 'معتمد' },
  summary: { roles: 'الأدوار', grants: 'الصلاحيات', added: 'صلاحيات مضافة', removed: 'صلاحيات محذوفة', unchanged: 'أدوار دون تغيير' },
  diffHeading: 'التغييرات مقارنة بالمصفوفة المطبقة',
  rolesAdded: (list) => `أدوار جديدة: ${list}`,
  rolesDeactivated: (list) => `مُعطَّلة: ${list}`,
  noChanges: 'لا تغييرات — الملف مطابق للمصفوفة المطبقة.',
  validationErrors: (count) => `${count} خطأ تدقيق — صحّح ثم أعد الرفع`,
  warnings: (count) => `${count} تحذير يتطلب تأكيداً صريحاً`,
  confirmWarnings: 'أُدرك الصلاحيات المرتفعة المشار إليها أعلاه وأؤكدها.',
  errorReport: 'تقرير الأخطاء',
  allPassed: 'اجتازت جميع الفحوصات.',
  changeReason: 'سبب التغيير',
  changeReasonPlaceholder: 'مثال: تفويض اعتماد العقود لنائب المدير',
  commit: 'اعتماد إصدار مسودة',
  committed: 'تم اعتماد إصدار المسودة — يلزم تفعيله من مسؤول ثانٍ.',
  fourEyesNote: 'مبدأ الرقابة المزدوجة: لا يمكن لمن استورد الإصدار أن يفعّله بنفسه.',
  emptyFile: 'الملف لا يحتوي على صلاحيات.',
  readError: 'تعذّر تحليل الملف — استخدم تخطيط القالب دون تعديل بنيته.',
  close: 'إغلاق',
  history: 'سجل الاستيراد',
  noHistory: 'لا توجد عمليات استيراد بعد.',
  versionsTitle: 'إصدارات مصفوفة الأدوار',
  versionsDescription:
    'كل استيراد معتمد هو إصدار ثابت موثق السبب. التفعيل يطبّقه على الإنفاذ؛ وتفعيل إصدار أقدم يعيد المصفوفة إليه.',
  versionStatus: { draft: 'مسودة', active: 'مُفعَّل', superseded: 'سابق' },
  versionLine: (version) => `الإصدار ${version}`,
  rolesCount: (count) => `${count} دور`,
  activate: 'تفعيل',
  rollback: 'إعادة تفعيل',
  activated: 'تم تفعيل الإصدار — تم تحديث الإنفاذ.',
  confirmActivateTitle: 'تفعيل هذا الإصدار؟',
  confirmActivateDescription:
    'تصبح هذه اللقطة هي مصفوفة الصلاحيات المطبقة لهذا المستأجر فوراً. يُستبدل الإصدار المفعّل الحالي (يمكن العودة إليه لاحقاً).',
  noVersions: 'لا توجد إصدارات بعد — اعتمد استيراداً أولاً.',
  bySomeone: (who) => `بواسطة ${who}`,
};

export function useRoleMatrixImportLabels(): RoleMatrixImportLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (locale === 'ar' ? AR : EN), [locale]);
}
