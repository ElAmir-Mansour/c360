/**
 * Bilingual (English + Modern Standard Arabic) labels for the guided CSV
 * bulk-import dialog on the Watheeq legal documents page. Follows the canonical
 * lex bilingual contract (`../../_lib/lex-i18n.ts`): a `LexBilingual<T>` bundle
 * with two FULL, same-shaped copies (natural English in `en`, professional MSA
 * in `ar`), resolved by a thin `use...Labels()` hook over `resolveLexBilingual`.
 *
 * No hardcoded English may appear in the dialog JSX — every visible string is
 * sourced from here.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/**
 * Target fields the user maps CSV columns onto. `__none` is the "do not map"
 * sentinel for the mapping dropdowns.
 */
export type CsvTargetField =
  | '__none'
  | 'title'
  | 'type'
  | 'description'
  | 'category'
  | 'confidentiality'
  | 'tags'
  | 'folder_path'
  | 'jurisdiction'
  | 'retention_policy'
  | 'source_record_id';

export interface CsvImportLabels {
  title: string;
  description: string;
  steps: {
    input: string;
    mapping: string;
    preview: string;
  };
  input: {
    fileLabel: string;
    fileHint: string;
    chooseFile: string;
    noFile: string;
    orPaste: string;
    pasteLabel: string;
    pastePlaceholder: string;
    delimiterDetected: (delimiter: string) => string;
    delimiterComma: string;
    delimiterTab: string;
    downloadTemplate: string;
    parse: string;
    parsedSummary: (rows: string, cols: string) => string;
  };
  mapping: {
    heading: string;
    hint: string;
    columnHeader: string;
    targetHeader: string;
    sampleHeader: string;
    none: string;
    requiredMissing: string;
    targets: Record<Exclude<CsvTargetField, '__none'>, string>;
  };
  options: {
    batchId: string;
    batchIdPlaceholder: string;
    sourceSystem: string;
    sourceSystemPlaceholder: string;
    indexLabel: string;
    indexHint: string;
    indexAria: string;
  };
  preview: {
    heading: string;
    validCount: (valid: string, total: string) => string;
    invalidCount: (invalid: string) => string;
    rowColumn: string;
    titleColumn: string;
    typeColumn: string;
    confidentialityColumn: string;
    issuesColumn: string;
    valid: string;
    invalid: string;
    moreRows: (count: string) => string;
    capWarning: (cap: string, total: string) => string;
    noValidRows: string;
  };
  issues: {
    titleRequired: string;
    typeInvalid: (value: string) => string;
    confidentialityInvalid: (value: string) => string;
  };
  result: {
    title: string;
    summary: (batchId: string, imported: string, failed: string, requested: string) => string;
    itemError: (index: number, error: string) => string;
    itemErrorFallback: string;
  };
  toasts: {
    importTitle: string;
    importDescription: (imported: string, failed: string, requested: string) => string;
  };
  actions: {
    back: string;
    continue: string;
    cancel: string;
    close: string;
    import: (count: string) => string;
  };
  template: {
    filename: string;
  };
}

export const csvImportLabels: LexBilingual<CsvImportLabels> = {
  en: {
    title: 'Guided CSV Bulk Import',
    description:
      'Upload or paste a CSV of legal documents, map the columns, then review and import valid rows.',
    steps: {
      input: 'Provide data',
      mapping: 'Map columns',
      preview: 'Review & import',
    },
    input: {
      fileLabel: 'Upload a CSV or TSV file',
      fileHint: 'Accepts .csv, .tsv, and .txt. The first row is treated as the header.',
      chooseFile: 'Choose file',
      noFile: 'No file selected',
      orPaste: 'Or paste rows directly',
      pasteLabel: 'Paste CSV / TSV',
      pastePlaceholder: 'title,type,confidentiality,tags\nBoard Policy,policy,privileged,board;ksa',
      delimiterDetected: (delimiter) => `Detected delimiter: ${delimiter}`,
      delimiterComma: 'comma',
      delimiterTab: 'tab',
      downloadTemplate: 'Download CSV template',
      parse: 'Parse data',
      parsedSummary: (rows, cols) => `Parsed ${rows} rows across ${cols} columns.`,
    },
    mapping: {
      heading: 'Map detected columns to document fields',
      hint: 'Title is required. Unmapped columns are ignored. We pre-matched columns by name.',
      columnHeader: 'Detected column',
      targetHeader: 'Maps to field',
      sampleHeader: 'Sample value',
      none: 'Do not import',
      requiredMissing: 'Map a column to Title before continuing.',
      targets: {
        title: 'Title (required)',
        type: 'Document type',
        description: 'Description',
        category: 'Category',
        confidentiality: 'Confidentiality',
        tags: 'Tags',
        folder_path: 'Folder path',
        jurisdiction: 'Jurisdiction',
        retention_policy: 'Retention policy',
        source_record_id: 'Source record ID',
      },
    },
    options: {
      batchId: 'Batch ID',
      batchIdPlaceholder: 'legacy-ksa-2026',
      sourceSystem: 'Source system',
      sourceSystemPlaceholder: 'legacy-dms',
      indexLabel: 'Index imported content',
      indexHint: 'Attach migration, OCR, and repository-index metadata during import.',
      indexAria: 'Index imported content',
    },
    preview: {
      heading: 'Validation preview',
      validCount: (valid, total) => `${valid} of ${total} rows are valid.`,
      invalidCount: (invalid) => `${invalid} rows have issues and will be skipped.`,
      rowColumn: 'Row',
      titleColumn: 'Title',
      typeColumn: 'Type',
      confidentialityColumn: 'Confidentiality',
      issuesColumn: 'Issues',
      valid: 'Valid',
      invalid: 'Invalid',
      moreRows: (count) => `And ${count} more rows not shown.`,
      capWarning: (cap, total) =>
        `Only the first ${cap} valid rows will be imported (of ${total}). The backend caps a batch at ${cap}.`,
      noValidRows: 'No rows passed validation. Fix the source data or column mapping.',
    },
    issues: {
      titleRequired: 'Title is empty',
      typeInvalid: (value) => `Unknown type "${value}"`,
      confidentialityInvalid: (value) => `Unknown confidentiality "${value}"`,
    },
    result: {
      title: 'Import result',
      summary: (batchId, imported, failed, requested) =>
        `Batch ${batchId}: ${imported} imported, ${failed} failed from ${requested} submitted.`,
      itemError: (index, error) => `Row ${index}: ${error}`,
      itemErrorFallback: 'Import failed.',
    },
    toasts: {
      importTitle: 'Bulk import complete.',
      importDescription: (imported, failed, requested) =>
        `${imported} imported, ${failed} failed from ${requested} submitted.`,
    },
    actions: {
      back: 'Back',
      continue: 'Continue',
      cancel: 'Cancel',
      close: 'Close',
      import: (count) => `Import ${count} valid rows`,
    },
    template: {
      filename: 'watheeq-documents-template.csv',
    },
  },
  ar: {
    title: 'استيراد جماعي موجَّه عبر CSV',
    description:
      'ارفع أو الصق ملف CSV للوثائق القانونية، ثم اربط الأعمدة، وراجع الصفوف الصالحة واستوردها.',
    steps: {
      input: 'إدخال البيانات',
      mapping: 'ربط الأعمدة',
      preview: 'المراجعة والاستيراد',
    },
    input: {
      fileLabel: 'ارفع ملف CSV أو TSV',
      fileHint: 'يقبل .csv و.tsv و.txt. يُعدّ الصف الأول صف العناوين.',
      chooseFile: 'اختيار ملف',
      noFile: 'لم يُحدَّد ملف',
      orPaste: 'أو الصق الصفوف مباشرةً',
      pasteLabel: 'الصق CSV / TSV',
      pastePlaceholder: 'title,type,confidentiality,tags\nسياسة المجلس,policy,privileged,board;ksa',
      delimiterDetected: (delimiter) => `الفاصل المكتشف: ${delimiter}`,
      delimiterComma: 'فاصلة',
      delimiterTab: 'مسافة جدولة',
      downloadTemplate: 'تنزيل قالب CSV',
      parse: 'تحليل البيانات',
      parsedSummary: (rows, cols) => `تم تحليل ${rows} صفًا عبر ${cols} عمودًا.`,
    },
    mapping: {
      heading: 'اربط الأعمدة المكتشفة بحقول الوثيقة',
      hint: 'العنوان حقل إلزامي. تُتجاهل الأعمدة غير المربوطة. تم الربط المبدئي حسب الاسم.',
      columnHeader: 'العمود المكتشف',
      targetHeader: 'يُربط بالحقل',
      sampleHeader: 'قيمة نموذجية',
      none: 'عدم الاستيراد',
      requiredMissing: 'اربط عمودًا بحقل العنوان قبل المتابعة.',
      targets: {
        title: 'العنوان (إلزامي)',
        type: 'نوع الوثيقة',
        description: 'الوصف',
        category: 'الفئة',
        confidentiality: 'السرّية',
        tags: 'الوسوم',
        folder_path: 'مسار المجلد',
        jurisdiction: 'الاختصاص القضائي',
        retention_policy: 'سياسة الاحتفاظ',
        source_record_id: 'معرّف السجل المصدر',
      },
    },
    options: {
      batchId: 'معرّف الدفعة',
      batchIdPlaceholder: 'legacy-ksa-2026',
      sourceSystem: 'النظام المصدر',
      sourceSystemPlaceholder: 'legacy-dms',
      indexLabel: 'فهرسة المحتوى المستورد',
      indexHint: 'إرفاق بيانات الترحيل والتعرّف الضوئي وفهرسة المستودع أثناء الاستيراد.',
      indexAria: 'فهرسة المحتوى المستورد',
    },
    preview: {
      heading: 'معاينة التحقق',
      validCount: (valid, total) => `${valid} من أصل ${total} صفًا صالحة.`,
      invalidCount: (invalid) => `${invalid} صفًا بها مشكلات وسيتم تخطيها.`,
      rowColumn: 'الصف',
      titleColumn: 'العنوان',
      typeColumn: 'النوع',
      confidentialityColumn: 'السرّية',
      issuesColumn: 'المشكلات',
      valid: 'صالح',
      invalid: 'غير صالح',
      moreRows: (count) => `و${count} صفًا إضافيًا غير معروض.`,
      capWarning: (cap, total) =>
        `سيتم استيراد أول ${cap} صفًا صالحًا فقط (من أصل ${total}). تحدّ الخدمة الدفعة بـ ${cap}.`,
      noValidRows: 'لم يجتز أي صف التحقق. صحّح البيانات المصدرية أو ربط الأعمدة.',
    },
    issues: {
      titleRequired: 'العنوان فارغ',
      typeInvalid: (value) => `نوع غير معروف "${value}"`,
      confidentialityInvalid: (value) => `سرّية غير معروفة "${value}"`,
    },
    result: {
      title: 'نتيجة الاستيراد',
      summary: (batchId, imported, failed, requested) =>
        `الدفعة ${batchId}: تم استيراد ${imported}، وفشل ${failed} من أصل ${requested} مُقدَّم.`,
      itemError: (index, error) => `الصف ${index}: ${error}`,
      itemErrorFallback: 'فشل الاستيراد.',
    },
    toasts: {
      importTitle: 'اكتمل الاستيراد الجماعي.',
      importDescription: (imported, failed, requested) =>
        `تم استيراد ${imported}، وفشل ${failed} من أصل ${requested} مُقدَّم.`,
    },
    actions: {
      back: 'رجوع',
      continue: 'متابعة',
      cancel: 'إلغاء',
      close: 'إغلاق',
      import: (count) => `استيراد ${count} صفًا صالحًا`,
    },
    template: {
      filename: 'watheeq-documents-template.csv',
    },
  },
};

export function useCsvImportLabels(): CsvImportLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(csvImportLabels, locale), [locale]);
}

/** Pure resolver for non-React callers/tests. */
export function resolveCsvImportLabels(locale: AppLocale = 'en'): CsvImportLabels {
  return resolveLexBilingual(csvImportLabels, locale === 'ar' ? 'ar' : 'en');
}
