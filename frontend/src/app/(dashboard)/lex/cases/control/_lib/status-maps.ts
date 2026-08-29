/**
 * Bilingual status → tone/label/icon maps for the control panel, consumed by the
 * canonical `<StatusBadge map={…} />`. Built on the shared `caseStatusMap` so the
 * case lifecycle reads identically to the rest of the platform, extended with the
 * two intake phases; the investigation map is authored here with masculine MSA
 * forms (تحقيق) since it has no shared counterpart.
 */

import {
  caseStatusMap,
  type StatusToneMap,
} from '@/components/shared/status-badge';
import {
  Ban,
  CheckCircle2,
  CircleDot,
  Clock,
  Inbox,
  ListChecks,
  PlayCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

/** Litigation case lifecycle — the shared case map plus the intake phases. */
export const CASE_STATUS_BADGE_MAP: StatusToneMap = {
  ...caseStatusMap,
  phase1: { tone: 'info', label: 'Phase 1', labelAr: 'المرحلة الأولى', icon: CircleDot },
  phase2: { tone: 'info', label: 'Phase 2', labelAr: 'المرحلة الثانية', icon: CircleDot },
};

/** Investigation lifecycle (CAP-077..083). */
export const INVESTIGATION_STATUS_BADGE_MAP: StatusToneMap = {
  registered: { tone: 'neutral', label: 'Registered', labelAr: 'مُسجَّل', icon: Inbox },
  in_progress: { tone: 'info', label: 'In Progress', labelAr: 'قيد التنفيذ', icon: PlayCircle },
  results_recorded: { tone: 'info', label: 'Results Recorded', labelAr: 'سُجّلت النتائج', icon: ListChecks },
  pending_approval: { tone: 'warning', label: 'Pending Approval', labelAr: 'بانتظار الاعتماد', icon: Clock },
  approved: { tone: 'primary', label: 'Approved', labelAr: 'معتمد', icon: ShieldCheck },
  rejected: { tone: 'danger', label: 'Rejected', labelAr: 'مرفوض', icon: XCircle },
  closed: { tone: 'success', label: 'Closed', labelAr: 'مغلق', icon: CheckCircle2 },
  cancelled: { tone: 'neutral', label: 'Cancelled', labelAr: 'ملغى', icon: Ban },
};
