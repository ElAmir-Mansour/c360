import { Cloud, LifeBuoy, ServerCog, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RecoverSubSolutionSlug } from '@/types/recover';

/**
 * Presentation metadata for each Recover sub-solution — icon + accent gradient.
 * Accents are token-bound design-system ramps (`success`/`info`/`warning`),
 * grounded in the DataStream/DR green family so Recover reads as part of the
 * resilience suite while distinguishing the three modes; they re-theme in dark
 * mode automatically instead of hardcoding hex.
 */
export interface SubSolutionMeta {
  icon: LucideIcon;
  accent: string;
}

export const RECOVER_SUBSOLUTION_META: Record<RecoverSubSolutionSlug, SubSolutionMeta> = {
  'it-dr': { icon: ServerCog, accent: 'from-success-700 to-success-500' },
  'cloud-dr': { icon: Cloud, accent: 'from-info-700 to-info-500' },
  'cyber-recovery': { icon: ShieldAlert, accent: 'from-warning-700 to-warning-500' },
};

export const RECOVER_PRODUCT_ICON: LucideIcon = LifeBuoy;
