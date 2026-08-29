/**
 * The 'table' i18n namespace — shared chrome copy for the DataTable family
 * (pagination summary, toolbar, filters, export menu) and the locale-aware CSV
 * export helper (`@/lib/format/csv`).
 *
 * Registered into the namespace registry so any component can resolve it with
 * `useT('table')` (React) or `createNamespacedTranslator('table', locale)`
 * (non-React). Importing this module anywhere guarantees registration; the
 * data-table components and the CSV helper all import it.
 *
 * Interpolation uses `{param}` tokens (see `formatMessage` in the registry).
 * Callers pass ALREADY-FORMATTED numbers (via `useFormat().formatNumber`) so
 * Arabic mode renders Arabic-Indic digits consistently.
 */

import { registerMessages } from './registry';

export const TABLE_NAMESPACE = 'table';

export interface TableMessages {
  pagination: {
    label: string;
    noResults: string;
    /** `{start}` / `{end}` / `{total}` — preformatted numbers. */
    showing: string;
    rowsPerPage: string;
    firstPage: string;
    previousPage: string;
    nextPage: string;
    lastPage: string;
    /** `{page}` — preformatted page number. */
    goToPage: string;
    /** `{page}` / `{total}` — preformatted numbers. */
    pageOf: string;
  };
  toolbar: {
    clear: string;
    clearAll: string;
    activeFilters: string;
    /** `{label}` — the filter's display label. */
    removeFilter: string;
    density: string;
    rowDensity: string;
    comfortable: string;
    compact: string;
    columns: string;
    toggleColumns: string;
    export: string;
    exportAs: string;
    /** `{count}` — preformatted selected-row count. */
    selected: string;
    processing: string;
  };
  filter: {
    /** `{label}` — the filter's display label. */
    filterBy: string;
    apply: string;
    reset: string;
    clear: string;
  };
  export: {
    csv: string;
    json: string;
    yes: string;
    no: string;
    empty: string;
  };
}

export const tableMessages: { en: TableMessages; ar: TableMessages } = {
  en: {
    pagination: {
      label: 'Table pagination',
      noResults: 'No results',
      showing: 'Showing {start}–{end} of {total} results',
      rowsPerPage: 'Rows per page',
      firstPage: 'Go to first page',
      previousPage: 'Go to previous page',
      nextPage: 'Go to next page',
      lastPage: 'Go to last page',
      goToPage: 'Go to page {page}',
      pageOf: 'Page {page} of {total}',
    },
    toolbar: {
      clear: 'Clear',
      clearAll: 'Clear all',
      activeFilters: 'Active filters:',
      removeFilter: 'Remove {label} filter',
      density: 'Density',
      rowDensity: 'Row density',
      comfortable: 'Comfortable',
      compact: 'Compact',
      columns: 'Columns',
      toggleColumns: 'Toggle columns',
      export: 'Export',
      exportAs: 'Export as',
      selected: '{count} selected',
      processing: 'Processing...',
    },
    filter: {
      filterBy: 'Filter by {label}…',
      apply: 'Apply',
      reset: 'Reset',
      clear: 'Clear',
    },
    export: {
      // Format names stay verbatim across locales (established acronym rule).
      csv: 'CSV',
      json: 'JSON',
      yes: 'Yes',
      no: 'No',
      empty: '—',
    },
  },
  ar: {
    pagination: {
      label: 'ترقيم صفحات الجدول',
      noResults: 'لا توجد نتائج',
      showing: 'عرض {start}–{end} من {total} نتيجة',
      rowsPerPage: 'صفوف لكل صفحة',
      firstPage: 'الانتقال إلى الصفحة الأولى',
      previousPage: 'الانتقال إلى الصفحة السابقة',
      nextPage: 'الانتقال إلى الصفحة التالية',
      lastPage: 'الانتقال إلى الصفحة الأخيرة',
      goToPage: 'الانتقال إلى الصفحة {page}',
      pageOf: 'الصفحة {page} من {total}',
    },
    toolbar: {
      clear: 'مسح',
      clearAll: 'مسح الكل',
      activeFilters: 'عوامل التصفية النشطة:',
      removeFilter: 'إزالة عامل التصفية {label}',
      density: 'الكثافة',
      rowDensity: 'كثافة الصفوف',
      comfortable: 'مريح',
      compact: 'مضغوط',
      columns: 'الأعمدة',
      toggleColumns: 'إظهار/إخفاء الأعمدة',
      export: 'تصدير',
      exportAs: 'تصدير كـ',
      selected: '{count} محدد',
      processing: 'جارٍ المعالجة...',
    },
    filter: {
      filterBy: 'تصفية حسب {label}…',
      apply: 'تطبيق',
      reset: 'إعادة تعيين',
      clear: 'مسح',
    },
    export: {
      csv: 'CSV',
      json: 'JSON',
      yes: 'نعم',
      no: 'لا',
      empty: '—',
    },
  },
};

registerMessages(TABLE_NAMESPACE, tableMessages);
