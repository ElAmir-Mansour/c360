/**
 * Single source of truth for where a request's downstream matter opens.
 *
 * A routed request can spawn a case/litigation, a contract, an investigation,
 * or a consultation/legal-opinion — each has its OWN detail route. Both the
 * linked-subject card and the "Documents & links" related-matter row resolve
 * the target here. Previously each card kept a duplicate `isCaseSubject` helper
 * that only knew case-vs-consultation, so a contract subject fell through to
 * `/lex/consultations/{id}` and 404'd ("Failed to load consultation details").
 * Centralizing the mapping keeps both surfaces correct and in lock-step, and
 * makes adding a new matter type a one-line change.
 *
 * Matching is specific-before-generic; an unrecognized `subject_type` falls
 * back to the consultation view.
 */

import {
  FileSearch,
  FileSignature,
  Gavel,
  MessageSquareText,
  type LucideIcon,
} from 'lucide-react';

export type MatterKind = 'case' | 'contract' | 'investigation' | 'consultation';

export interface MatterTarget {
  kind: MatterKind;
  /** Route base for the matter's detail page, e.g. `/lex/contracts`. */
  base: string;
  icon: LucideIcon;
}

/** Resolve a request's `subject_type` to its detail route, icon and kind. */
export function matterTarget(subjectType: string): MatterTarget {
  const type = (subjectType ?? '').toLowerCase();
  if (type.includes('contract')) {
    return { kind: 'contract', base: '/lex/contracts', icon: FileSignature };
  }
  if (type.includes('investigation')) {
    return { kind: 'investigation', base: '/lex/investigations', icon: FileSearch };
  }
  if (
    type.includes('case') ||
    type.includes('litigation') ||
    type.includes('matter')
  ) {
    return { kind: 'case', base: '/lex/cases', icon: Gavel };
  }
  return { kind: 'consultation', base: '/lex/consultations', icon: MessageSquareText };
}

/** The full deep-link href for a linked matter (`{route base}/{subject id}`). */
export function matterHref(subjectType: string, subjectId: string): string {
  return `${matterTarget(subjectType).base}/${subjectId}`;
}
