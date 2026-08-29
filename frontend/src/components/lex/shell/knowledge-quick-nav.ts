import type { LucideIcon } from 'lucide-react';
import { BookOpen, FileText, GraduationCap, ShieldCheck } from 'lucide-react';

import {
  LEX_ROUTE_PERMISSIONS,
  type PermissionRequirement,
} from '@/lib/permissions';

export interface KnowledgeQuickNavItem {
  id: 'clauses' | 'playbooks' | 'policies' | 'learning';
  href: string;
  labelEn: string;
  labelAr: string;
  icon: LucideIcon;
  permission: PermissionRequirement;
}

/**
 * The compact Knowledge Hub navigation represented in the Figma clause,
 * playbook, policy, and learning layouts. It is intentionally separate from
 * the suite-level mobile quick nav: while someone is working inside one of
 * these four collections, the most useful thumb-reachable destinations are
 * the sibling knowledge collections rather than unrelated Clario products.
 */
export const KNOWLEDGE_QUICK_NAV: readonly KnowledgeQuickNavItem[] = [
  {
    id: 'clauses',
    href: '/lex/clause-library',
    labelEn: 'Clauses',
    labelAr: 'البنود',
    icon: FileText,
    permission: LEX_ROUTE_PERMISSIONS['/lex/clause-library'],
  },
  {
    id: 'playbooks',
    href: '/lex/playbooks',
    labelEn: 'Playbooks',
    labelAr: 'أدلة العمل',
    icon: BookOpen,
    permission: LEX_ROUTE_PERMISSIONS['/lex/playbooks'],
  },
  {
    id: 'policies',
    href: '/lex/policies',
    labelEn: 'Policies',
    labelAr: 'السياسات',
    icon: ShieldCheck,
    permission: LEX_ROUTE_PERMISSIONS['/lex/policies'],
  },
  {
    id: 'learning',
    href: '/lex/learning-centre',
    labelEn: 'Learning',
    labelAr: 'التعلّم',
    icon: GraduationCap,
    permission: LEX_ROUTE_PERMISSIONS['/lex/learning-centre'],
  },
] as const;

function ownsPath(item: KnowledgeQuickNavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Return the active collection for a knowledge route, including drill-ins. */
export function activeKnowledgeQuickNavHref(
  pathname: string,
): string | undefined {
  return KNOWLEDGE_QUICK_NAV.find((item) => ownsPath(item, pathname))?.href;
}

/** Whether the compact Figma knowledge navigator should replace suite tabs. */
export function isKnowledgeQuickNavPath(pathname: string): boolean {
  return activeKnowledgeQuickNavHref(pathname) !== undefined;
}
