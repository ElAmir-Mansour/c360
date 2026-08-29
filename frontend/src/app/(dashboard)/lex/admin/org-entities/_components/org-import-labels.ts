'use client';

import { useLocale } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type { OrgImportJob, OrgImportMode } from '@/lib/lex/admin';

export type OrgImportLabels = {
  modes: Record<OrgImportMode, { label: string; description: string }>;
  status: Record<OrgImportJob['status'], string>;
  importStructure: string;
  uploadTitle: string;
  uploadDescription: string;
  downloadStep: string;
  templateHelp: string;
  blankTemplate: string;
  filledSample: string;
  behaviorStep: string;
  replaceWarning: string;
  uploadStep: string;
  chooseFile: string;
  noFile: string;
  rows: (count: number) => string;
  runDryRun: string;
  validationResult: string;
  summary: { rows: string; create: string; update: string; deactivate: string; roles: string; employees: string };
  validationErrors: (count: number) => string;
  errorReport: string;
  row: (number: number) => string;
  allRowsPassed: string;
  history: string;
  apiImport: string;
  downloadErrors: string;
  noHistory: string;
  close: string;
  applyAtomically: string;
  imported: string;
  emptyFile: string;
  readError: string;
};

const IMPORT_LABELS: Record<AppLocale, OrgImportLabels> = {
  en: {
    modes: {
      create: { label: 'Create only', description: 'Reject codes that already exist.' },
      update: { label: 'Update only', description: 'Reject codes that do not already exist.' },
      merge: { label: 'Merge', description: 'Create new codes and update existing codes.' },
      replace: { label: 'Replace', description: 'Merge this structure and deactivate every omitted entity.' },
    },
    status: { validated: 'Validated', failed: 'Failed', completed: 'Completed' },
    importStructure: 'Import structure',
    uploadTitle: 'Upload organizational structure',
    uploadDescription: 'Import XLSX, CSV, or JSON using stable entity codes. Every file is validated by the server before any change is committed.',
    downloadStep: '1. Download a template',
    templateHelp: 'Use the simple filled sample for a quick hierarchy and role demo. The blank template includes advanced people and metadata fields.',
    blankTemplate: 'Blank template',
    filledSample: 'Simple filled sample',
    behaviorStep: '2. Select import behavior',
    replaceWarning: 'Replace deactivates all existing entities omitted from the uploaded structure.',
    uploadStep: '3. Upload and validate',
    chooseFile: 'Choose file',
    noFile: 'No file selected',
    rows: (count) => `${count} rows`,
    runDryRun: 'Run dry-run',
    validationResult: 'Validation result',
    summary: { rows: 'Rows', create: 'Create', update: 'Update', deactivate: 'Deactivate', roles: 'Roles', employees: 'Employees' },
    validationErrors: (count) => `${count} validation errors`,
    errorReport: 'Error report',
    row: (number) => `Row ${number}`,
    allRowsPassed: 'All rows passed server validation. No changes were made during this dry-run.',
    history: 'Import history',
    apiImport: 'API import',
    downloadErrors: 'Download errors',
    noHistory: 'No import jobs yet.',
    close: 'Close',
    applyAtomically: 'Apply import atomically',
    imported: 'Organizational structure imported successfully.',
    emptyFile: 'The selected file contains no data rows.',
    readError: 'Could not read the selected file.',
  },
  ar: {
    modes: {
      create: { label: 'إنشاء فقط', description: 'رفض الرموز الموجودة مسبقًا.' },
      update: { label: 'تحديث فقط', description: 'رفض الرموز غير الموجودة مسبقًا.' },
      merge: { label: 'دمج', description: 'إنشاء الرموز الجديدة وتحديث الرموز الموجودة.' },
      replace: { label: 'استبدال', description: 'دمج هذا الهيكل وتعطيل كل كيان غير مضمّن.' },
    },
    status: { validated: 'تم التحقق', failed: 'فشل', completed: 'مكتمل' },
    importStructure: 'استيراد الهيكل',
    uploadTitle: 'رفع الهيكل التنظيمي',
    uploadDescription: 'استورد ملف XLSX أو CSV أو JSON باستخدام رموز ثابتة للكيانات. يتحقق الخادم من كل ملف قبل اعتماد أي تغيير.',
    downloadStep: '١. تنزيل قالب',
    templateHelp: 'استخدم العينة البسيطة المعبأة لعرض سريع للتسلسل الهرمي والأدوار. يتضمن القالب الفارغ حقولًا متقدمة للأشخاص والبيانات الوصفية.',
    blankTemplate: 'قالب فارغ',
    filledSample: 'عينة بسيطة معبأة',
    behaviorStep: '٢. اختيار سلوك الاستيراد',
    replaceWarning: 'يؤدي الاستبدال إلى تعطيل جميع الكيانات الحالية غير الموجودة في الهيكل المرفوع.',
    uploadStep: '٣. الرفع والتحقق',
    chooseFile: 'اختر ملفًا',
    noFile: 'لم يتم اختيار ملف',
    rows: (count) => `${count} صف`,
    runDryRun: 'تشغيل تحقق تجريبي',
    validationResult: 'نتيجة التحقق',
    summary: { rows: 'الصفوف', create: 'إنشاء', update: 'تحديث', deactivate: 'تعطيل', roles: 'الأدوار', employees: 'الموظفون' },
    validationErrors: (count) => `${count} أخطاء تحقق`,
    errorReport: 'تقرير الأخطاء',
    row: (number) => `الصف ${number}`,
    allRowsPassed: 'اجتازت جميع الصفوف تحقق الخادم. لم تُجرَ أي تغييرات أثناء هذا التشغيل التجريبي.',
    history: 'سجل الاستيراد',
    apiImport: 'استيراد عبر API',
    downloadErrors: 'تنزيل الأخطاء',
    noHistory: 'لا توجد عمليات استيراد بعد.',
    close: 'إغلاق',
    applyAtomically: 'تطبيق الاستيراد بشكل ذري',
    imported: 'تم استيراد الهيكل التنظيمي بنجاح.',
    emptyFile: 'لا يحتوي الملف المحدد على صفوف بيانات.',
    readError: 'تعذّرت قراءة الملف المحدد.',
  },
};

export function useOrgImportLabels(): OrgImportLabels {
  const { locale } = useLocale();
  return IMPORT_LABELS[locale];
}
