'use client';

/**
 * Bilingual copy for the competent-court reference list (feedback items 5/6).
 *
 * Follows the lex bilingual contract: one full `{en, ar}` bundle, resolved to a
 * plain label object by {@link useCourtLabels}. No inline `locale === 'ar'`
 * ternaries in the JSX.
 */
import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface CourtAdminLabels {
  pageTitle: string;
  pageDescription: string;
  create: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyDescriptionReadOnly: string;
  stats: { total: string; active: string; legacy: string };
  statsDetail: { registry: string; courts: string; activeShare: string; unreconciled: string };
  columns: { name: string; code: string; status: string; sort: string; updated: string };
  unnamed: string;
  searchPlaceholder: string;
  filters: { status: string; activeOnly: string; inactiveOnly: string };
  legacy: {
    title: string;
    description: string;
    empty: string;
    loadError: string;
    columnValue: string;
    columnCases: string;
    caseCount: (formatted: string) => string;
    createFrom: string;
    noteTitle: string;
    note: string;
  };
  form: {
    createTitle: string;
    editTitle: string;
    createDescription: string;
    editDescription: string;
    code: string;
    codeHint: string;
    codePlaceholder: string;
    nameEn: string;
    nameEnPlaceholder: string;
    nameAr: string;
    nameArPlaceholder: string;
    active: string;
    activeHint: string;
    sort: string;
    sortHint: string;
    nameRequired: string;
    codeRequired: string;
    codeInvalid: string;
    submit: string;
    saving: string;
  };
  toast: { created: string; updated: string; deleted: string };
  confirmDeleteTitle: string;
  confirmDeleteDescription: (label: string) => string;
  systemBadge: string;
}

const courtLabelBundle: LexBilingual<CourtAdminLabels> = {
  en: {
    pageTitle: 'Competent Courts',
    pageDescription:
      'The tenant-maintained list behind the Competent Court field on a case. It ships empty — add your own courts and they appear in the case form immediately.',
    create: 'Add court',
    emptyTitle: 'No courts configured',
    emptyDescription:
      'Nothing has been added yet, so the Competent Court dropdown on the case form is empty. Add your courts here and they become selectable straight away.',
    emptyDescriptionReadOnly:
      'Nothing has been added yet, so the Competent Court dropdown on the case form is empty. Ask an administrator with catalogue permissions to add your courts.',
    stats: { total: 'Courts', active: 'Active', legacy: 'Unreconciled legacy values' },
    statsDetail: {
      registry: 'Current registry',
      courts: 'Courts',
      activeShare: 'Active share of courts',
      unreconciled: 'Free-text values on older cases',
    },
    columns: {
      name: 'Court',
      code: 'Code',
      status: 'Status',
      sort: 'Order',
      updated: 'Updated',
    },
    unnamed: 'Unnamed court',
    searchPlaceholder: 'Search courts by name or code…',
    filters: { status: 'Status', activeOnly: 'Active only', inactiveOnly: 'Inactive only' },
    legacy: {
      title: 'Legacy free-text courts',
      description:
        'Cases created before this list existed carry a typed court name instead of a reference. They are listed here exactly as they were entered so you can decide which court each belongs to. Nothing is matched or removed automatically.',
      empty: 'No legacy free-text court values. Every case either references a court or has none.',
      loadError: 'The legacy court values could not be loaded.',
      columnValue: 'Value as entered',
      columnCases: 'Cases',
      caseCount: (formatted) => `${formatted} cases`,
      createFrom: 'Add as a court',
      noteTitle: 'These are historical values, not courts',
      note: 'Adding one here creates a new court row. It does not re-point the existing cases — that reconciliation stays a deliberate act.',
    },
    form: {
      createTitle: 'Add court',
      editTitle: 'Edit court',
      createDescription: 'Add one court to the reference list used by the case form.',
      editDescription: 'Update this court. Existing cases keep pointing at it.',
      code: 'Code',
      codeHint: 'A short stable identifier. Letters, digits, hyphen and underscore only.',
      codePlaceholder: 'e.g. COURT_01',
      nameEn: 'Name (English)',
      nameEnPlaceholder: 'English name',
      nameAr: 'Name (Arabic)',
      nameArPlaceholder: 'Arabic name',
      active: 'Active',
      activeHint: 'Inactive courts stay on existing cases but cannot be selected on new ones.',
      sort: 'Order',
      sortHint: 'Lower numbers appear first in the dropdown.',
      nameRequired: 'Enter the court name in English or Arabic.',
      codeRequired: 'A code is required.',
      codeInvalid: 'Use letters, digits, hyphen or underscore only.',
      submit: 'Save court',
      saving: 'Saving…',
    },
    toast: {
      created: 'Court added.',
      updated: 'Court updated.',
      deleted: 'Court deleted.',
    },
    confirmDeleteTitle: 'Delete court',
    confirmDeleteDescription: (label) =>
      `Delete "${label}"? Courts already referenced by a case cannot be deleted — deactivate them instead.`,
    systemBadge: 'System',
  },
  ar: {
    pageTitle: 'المحاكم المختصة',
    pageDescription:
      'القائمة المرجعية التي يديرها المستأجر خلف حقل «المحكمة المختصة» في القضية. تبدأ فارغة — أضف محاكمك لتظهر مباشرةً في نموذج القضية.',
    create: 'إضافة محكمة',
    emptyTitle: 'لا توجد محاكم مُهيّأة',
    emptyDescription:
      'لم تُضف أي محكمة بعد، لذا تظهر قائمة «المحكمة المختصة» في نموذج القضية فارغة. أضف محاكمك هنا لتصبح قابلة للاختيار فورًا.',
    emptyDescriptionReadOnly:
      'لم تُضف أي محكمة بعد، لذا تظهر قائمة «المحكمة المختصة» في نموذج القضية فارغة. اطلب من مسؤول لديه صلاحية إدارة الأدلة إضافة المحاكم.',
    stats: { total: 'المحاكم', active: 'المُفعّلة', legacy: 'قيم تاريخية غير مُسوّاة' },
    statsDetail: {
      registry: 'السجل الحالي',
      courts: 'محاكم',
      activeShare: 'نسبة المحاكم المُفعّلة',
      unreconciled: 'قيم نصية حرة في قضايا سابقة',
    },
    columns: {
      name: 'المحكمة',
      code: 'الرمز',
      status: 'الحالة',
      sort: 'الترتيب',
      updated: 'آخر تحديث',
    },
    unnamed: 'محكمة بلا اسم',
    searchPlaceholder: 'ابحث عن المحاكم بالاسم أو الرمز…',
    filters: { status: 'الحالة', activeOnly: 'المُفعّلة فقط', inactiveOnly: 'المُعطّلة فقط' },
    legacy: {
      title: 'المحاكم النصية التاريخية',
      description:
        'القضايا التي أُنشئت قبل وجود هذه القائمة تحمل اسم محكمة مكتوبًا يدويًا بدل المرجع. تُعرض هنا كما أُدخلت تمامًا لتقرّر إلى أي محكمة تنتمي كل قيمة. لا تتم أي مطابقة أو حذف تلقائي.',
      empty: 'لا توجد قيم محاكم نصية تاريخية. كل قضية إمّا تشير إلى محكمة أو بلا محكمة.',
      loadError: 'تعذّر تحميل القيم التاريخية للمحاكم.',
      columnValue: 'القيمة كما أُدخلت',
      columnCases: 'القضايا',
      caseCount: (formatted) => `${formatted} قضايا`,
      createFrom: 'إضافتها كمحكمة',
      noteTitle: 'هذه قيم تاريخية وليست محاكم',
      note: 'إضافة أي منها تُنشئ سجل محكمة جديدًا، ولا تُعيد ربط القضايا القائمة — تبقى التسوية إجراءً مقصودًا.',
    },
    form: {
      createTitle: 'إضافة محكمة',
      editTitle: 'تعديل المحكمة',
      createDescription: 'أضف محكمة واحدة إلى القائمة المرجعية المستخدمة في نموذج القضية.',
      editDescription: 'حدّث بيانات هذه المحكمة. تبقى القضايا القائمة مرتبطة بها.',
      code: 'الرمز',
      codeHint: 'معرّف قصير وثابت. حروف وأرقام وشرطة وشرطة سفلية فقط.',
      codePlaceholder: 'مثال: COURT_01',
      nameEn: 'الاسم (إنجليزي)',
      nameEnPlaceholder: 'الاسم بالإنجليزية',
      nameAr: 'الاسم (عربي)',
      nameArPlaceholder: 'الاسم بالعربية',
      active: 'مُفعّلة',
      activeHint: 'المحاكم المُعطّلة تبقى على القضايا القائمة لكن لا يمكن اختيارها في قضايا جديدة.',
      sort: 'الترتيب',
      sortHint: 'الأرقام الأصغر تظهر أولًا في القائمة.',
      nameRequired: 'أدخل اسم المحكمة بالإنجليزية أو بالعربية.',
      codeRequired: 'الرمز مطلوب.',
      codeInvalid: 'استخدم حروفًا أو أرقامًا أو شرطة أو شرطة سفلية فقط.',
      submit: 'حفظ المحكمة',
      saving: 'جارٍ الحفظ…',
    },
    toast: {
      created: 'تمت إضافة المحكمة.',
      updated: 'تم تحديث المحكمة.',
      deleted: 'تم حذف المحكمة.',
    },
    confirmDeleteTitle: 'حذف المحكمة',
    confirmDeleteDescription: (label) =>
      `حذف «${label}»؟ لا يمكن حذف المحاكم المرتبطة بقضايا قائمة — عطّلها بدلًا من ذلك.`,
    systemBadge: 'نظامية',
  },
};

export function useCourtLabels(): CourtAdminLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(courtLabelBundle, locale), [locale]);
}
