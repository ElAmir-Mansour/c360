/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the NEW
 * strings introduced by the Execution panel enhancements:
 *
 *   • Feature #10 — satisfy requirements via file upload / inline data entry +
 *     "satisfied by … · …" attribution.
 *   • Feature #11 — the live delivery auto-close countdown.
 *
 * These strings are intentionally kept OUT of the suite-wide `labels.ts`
 * (`useServiceDeskLabels().execution`) — that bundle is owned by another agent
 * and stays untouched. This file ADDS to it via the same `LexBilingual<T>` +
 * `resolveLexBilingual` contract documented in `../../_lib/lex-i18n.ts`, so the
 * EXISTING `execution` labels keep being consumed exactly as before.
 *
 * Western digits, interpolation params, and the ICU/function-valued shape are
 * preserved across BOTH locales.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface ExecutionExtraLabels {
  /** Requirement satisfy controls (Feature #10). */
  satisfy: {
    /** Upload control for attachment requirements. */
    upload: string;
    /** Re-upload (replace the currently attached file). */
    reupload: string;
    /** Uploading… in-flight state with a percentage. */
    uploading: (pct: number) => string;
    /** Open the currently attached evidence file in a new tab. */
    viewFile: string;
    /** Inline data-entry placeholder. */
    dataPlaceholder: string;
    /** Save the entered data value. */
    saveData: string;
    /** Prefix for the stored data value chip. */
    storedValuePrefix: string;
    /** Attribution line under a satisfied requirement. */
    satisfiedBy: (by: string, at: string) => string;
    /** Fallback actor label when `satisfied_by` is empty. */
    unknownActor: string;
    /** Toasts. */
    toast: {
      uploaded: string;
      uploadFailed: string;
      dataSaved: string;
    };
  };
  /** Delivery auto-close countdown (Feature #11). */
  countdown: {
    /** "auto-closes in 2d 4h". `remaining` is the pre-formatted duration. */
    autoClosesIn: (remaining: string) => string;
    /** Terminal state: the auto-close deadline has passed. */
    expired: string;
    /** Compose a short "2d 4h" / "4h 12m" / "8m" duration from parts. */
    duration: (days: number, hours: number, minutes: number) => string;
  };
}

const bundle: LexBilingual<ExecutionExtraLabels> = {
  en: {
    satisfy: {
      upload: 'Upload',
      reupload: 'Replace file',
      uploading: (pct) => `Uploading… ${pct}%`,
      viewFile: 'View file',
      dataPlaceholder: 'Enter value…',
      saveData: 'Save',
      storedValuePrefix: 'Value:',
      satisfiedBy: (by, at) => `Satisfied by ${by} · ${at}`,
      unknownActor: 'a team member',
      toast: {
        uploaded: 'File uploaded and requirement satisfied.',
        uploadFailed: 'Could not upload the file.',
        dataSaved: 'Value saved and requirement satisfied.',
      },
    },
    countdown: {
      autoClosesIn: (remaining) => `Auto-closes in ${remaining}`,
      expired: 'Auto-close window expired',
      duration: (days, hours, minutes) => {
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
      },
    },
  },
  ar: {
    satisfy: {
      upload: 'رفع',
      reupload: 'استبدال الملف',
      uploading: (pct) => `جارٍ الرفع… ${pct}%`,
      viewFile: 'عرض الملف',
      dataPlaceholder: 'أدخل القيمة…',
      saveData: 'حفظ',
      storedValuePrefix: 'القيمة:',
      satisfiedBy: (by, at) => `استوفاه ${by} · ${at}`,
      unknownActor: 'أحد أعضاء الفريق',
      toast: {
        uploaded: 'تم رفع الملف واستيفاء المتطلب.',
        uploadFailed: 'تعذّر رفع الملف.',
        dataSaved: 'تم حفظ القيمة واستيفاء المتطلب.',
      },
    },
    countdown: {
      autoClosesIn: (remaining) => `إغلاق تلقائي خلال ${remaining}`,
      expired: 'انتهت نافذة الإغلاق التلقائي',
      duration: (days, hours, minutes) => {
        if (days > 0) return `${days}ي ${hours}س`;
        if (hours > 0) return `${hours}س ${minutes}د`;
        return `${minutes}د`;
      },
    },
  },
};

/**
 * useExecutionExtraLabels resolves the NEW execution-enhancement strings against
 * the active locale (defaults to English outside a LocaleProvider, mirroring the
 * suite-wide hook). The component reads the resolved `ExecutionExtraLabels`
 * object alongside the unchanged `useServiceDeskLabels().execution`.
 */
export function useExecutionExtraLabels(): ExecutionExtraLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(bundle, locale), [locale]);
}
