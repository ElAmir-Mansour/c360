'use client';

/**
 * React hook exposing the locale-resolved {@link SwimlaneLabels}. Mirrors the
 * suite convention: components receive the resolved `T`, never the bundle.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLexBilingual } from '@/app/(dashboard)/lex/_lib/lex-i18n';
import { swimlaneLabels, type SwimlaneLabels } from './swimlane-labels';

export function useSwimlaneLabels(): SwimlaneLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(swimlaneLabels, locale), [locale]);
}
