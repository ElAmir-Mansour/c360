'use client';

/**
 * ENTITY-360 detail — co-located bilingual (English + Modern Standard Arabic)
 * labels for the REVAMP surfaces only: the card-style hero band, the
 * navigation/shareability toolbar, and the three right-rail cards
 * (organization/people, linked-records, recent-activity mini).
 *
 * Follows the canonical lex i18n contract (`../../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useEntityDetailLabels}. This file holds ONLY the
 * NEW strings the revamp introduces — the pre-existing entity copy (hero facts,
 * tabs, sections, empty, record, posture, kpis, activityVerbs) stays in the
 * shared `entities/_lib/entity-i18n.ts` bundle and is consumed via
 * `useEntityLabels()`. Nothing here duplicates that bundle.
 *
 * Count-bearing interpolations take a PRE-FORMATTED string (produced by
 * `useLexFormat().formatNumber`) so Arabic mode renders Arabic-Indic digits.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';

export interface EntityDetailExtraLabels {
  /** #2 Navigation & shareability toolbar. */
  toolbar: {
    copyName: string;
    copyNameAria: (name: string) => string;
    copyLink: string;
    copyLinkAria: string;
    copied: string;
    prev: string;
    next: string;
    prevDisabled: string;
    nextDisabled: string;
  };
  /** #1 Card-style hero band — derived chips + fact-tile labels. */
  hero: {
    eyebrow: string;
    recordsChip: (count: string) => string;
    openCasesChip: (count: string) => string;
    activeContractsChip: (count: string) => string;
    facts: {
      records: string;
      exposure: string;
      recovery: string;
      lastActivity: string;
    };
    noActivity: string;
  };
  /** #5 Right-rail organization / people card. */
  people: {
    title: string;
    organization: string;
    matchKey: string;
    copyKey: string;
    copied: string;
    lastActivity: string;
    relationship: string;
    asPlaintiff: (count: string) => string;
    asDefendant: (count: string) => string;
    activeContracts: (count: string) => string;
    /** Honest note: the source records carry no named representative/contact. */
    noRepresentatives: string;
  };
  /** #5 Right-rail linked-records card (the central surface for a profile). */
  related: {
    title: string;
    description: string;
    counter: (shown: string, total: string) => string;
    viewAll: (count: string) => string;
    empty: string;
  };
  /** #5 Right-rail recent-activity mini feed. */
  activityMini: {
    title: string;
    empty: string;
    viewAll: string;
    actorPrefix: (actor: string) => string;
  };
}

const bundle: LexBilingual<EntityDetailExtraLabels> = {
  en: {
    toolbar: {
      copyName: 'Copy organization name',
      copyNameAria: (name) => `Copy organization name: ${name}`,
      copyLink: 'Copy link',
      copyLinkAria: 'Copy a shareable link to this organization',
      copied: 'Copied',
      prev: 'Previous organization',
      next: 'Next organization',
      prevDisabled: 'No previous organization',
      nextDisabled: 'No next organization',
    },
    hero: {
      eyebrow: 'Entity 360',
      recordsChip: (count) => `${count} linked records`,
      openCasesChip: (count) => `${count} open cases`,
      activeContractsChip: (count) => `${count} active contracts`,
      facts: {
        records: 'Linked records',
        exposure: 'Total SAR exposure',
        recovery: 'Recovery rate',
        lastActivity: 'Last activity',
      },
      noActivity: 'No activity yet',
    },
    people: {
      title: 'Organization',
      organization: 'Counterparty',
      matchKey: 'Match key',
      copyKey: 'Copy match key',
      copied: 'Copied',
      lastActivity: 'Last activity',
      relationship: 'Relationship',
      asPlaintiff: (count) => `Client is plaintiff · ${count}`,
      asDefendant: (count) => `Client is defendant · ${count}`,
      activeContracts: (count) => `Active contracts · ${count}`,
      noRepresentatives:
        'No named representatives are recorded — the source records name only the organization.',
    },
    related: {
      title: 'Linked records',
      description: 'Everything this organization is a party to, across the suite.',
      counter: (shown, total) => `${shown} of ${total}`,
      viewAll: (count) => `View all ${count}`,
      empty: 'No linked records for this organization.',
    },
    activityMini: {
      title: 'Recent activity',
      empty: 'No recorded activity yet.',
      viewAll: 'View full activity',
      actorPrefix: (actor) => `by ${actor}`,
    },
  },
  ar: {
    toolbar: {
      copyName: 'نسخ اسم المنشأة',
      copyNameAria: (name) => `نسخ اسم المنشأة: ${name}`,
      copyLink: 'نسخ الرابط',
      copyLinkAria: 'نسخ رابط قابل للمشاركة لهذه المنشأة',
      copied: 'تم النسخ',
      prev: 'المنشأة السابقة',
      next: 'المنشأة التالية',
      prevDisabled: 'لا توجد منشأة سابقة',
      nextDisabled: 'لا توجد منشأة تالية',
    },
    hero: {
      eyebrow: 'المنشأة 360',
      recordsChip: (count) => `${count} سجل مرتبط`,
      openCasesChip: (count) => `${count} قضية مفتوحة`,
      activeContractsChip: (count) => `${count} عقد ساري`,
      facts: {
        records: 'السجلات المرتبطة',
        exposure: 'إجمالي التعرّض بالريال',
        recovery: 'نسبة الاسترداد',
        lastActivity: 'آخر نشاط',
      },
      noActivity: 'لا يوجد نشاط بعد',
    },
    people: {
      title: 'المنشأة',
      organization: 'الطرف المقابل',
      matchKey: 'مفتاح المطابقة',
      copyKey: 'نسخ مفتاح المطابقة',
      copied: 'تم النسخ',
      lastActivity: 'آخر نشاط',
      relationship: 'العلاقة',
      asPlaintiff: (count) => `العميل مدّعٍ · ${count}`,
      asDefendant: (count) => `العميل مدّعى عليه · ${count}`,
      activeContracts: (count) => `العقود السارية · ${count}`,
      noRepresentatives:
        'لا يوجد ممثّلون مسجّلون بالاسم — تذكر السجلات المصدرية اسم المنشأة فقط.',
    },
    related: {
      title: 'السجلات المرتبطة',
      description: 'كل ما تكون هذه المنشأة طرفًا فيه عبر المجموعة.',
      counter: (shown, total) => `${shown} من ${total}`,
      viewAll: (count) => `عرض الكل (${count})`,
      empty: 'لا توجد سجلات مرتبطة بهذه المنشأة.',
    },
    activityMini: {
      title: 'أحدث نشاط',
      empty: 'لا يوجد نشاط مسجّل بعد.',
      viewAll: 'عرض كامل النشاط',
      actorPrefix: (actor) => `بواسطة ${actor}`,
    },
  },
};

export function resolveEntityDetailLabels(locale: AppLocale = 'en'): EntityDetailExtraLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useEntityDetailLabels(): EntityDetailExtraLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveEntityDetailLabels(locale), [locale]);
}
