/**
 * Bilingual status → tone/label/icon maps for the Contracts & Consultations
 * control panel, consumed by the canonical `<StatusBadge map={…} />` (the
 * sanctioned status primitive — the per-domain `LexStatusChip` adapter is
 * deprecated for new code). Masculine/feminine MSA forms follow the domain noun
 * (عقد / استشارة).
 */

import type { StatusToneMap } from '@/components/shared/status-badge';
import {
  Archive,
  Ban,
  CalendarX,
  CheckCircle2,
  Eye,
  FileText,
  Inbox,
  MessagesSquare,
  PauseCircle,
  PenLine,
  RefreshCw,
  Reply,
  Scale,
  ShieldCheck,
  Tags,
  Waypoints,
  XCircle,
} from 'lucide-react';

/** Contract lifecycle (LexContractStatus). */
export const CONTRACT_STATUS_BADGE_MAP: StatusToneMap = {
  draft: { tone: 'neutral', label: 'Draft', labelAr: 'مسودة', icon: FileText },
  internal_review: { tone: 'info', label: 'Internal Review', labelAr: 'مراجعة داخلية', icon: Eye },
  legal_review: { tone: 'info', label: 'Legal Review', labelAr: 'مراجعة قانونية', icon: Scale },
  negotiation: { tone: 'warning', label: 'Negotiation', labelAr: 'تفاوض', icon: MessagesSquare },
  pending_signature: { tone: 'warning', label: 'Pending Signature', labelAr: 'بانتظار التوقيع', icon: PenLine },
  active: { tone: 'success', label: 'Active', labelAr: 'نشط', icon: CheckCircle2 },
  suspended: { tone: 'warning', label: 'Suspended', labelAr: 'موقوف', icon: PauseCircle },
  expired: { tone: 'danger', label: 'Expired', labelAr: 'منتهٍ', icon: CalendarX },
  terminated: { tone: 'danger', label: 'Terminated', labelAr: 'مُنهى', icon: Ban },
  renewed: { tone: 'primary', label: 'Renewed', labelAr: 'مُجدَّد', icon: RefreshCw },
  cancelled: { tone: 'neutral', label: 'Cancelled', labelAr: 'ملغى', icon: XCircle },
};

/** Consultation lifecycle (ConsultationStatus). */
export const CONSULTATION_STATUS_BADGE_MAP: StatusToneMap = {
  submitted: { tone: 'neutral', label: 'Submitted', labelAr: 'مُقدَّمة', icon: Inbox },
  classified: { tone: 'info', label: 'Classified', labelAr: 'مُصنَّفة', icon: Tags },
  routed: { tone: 'info', label: 'Routed', labelAr: 'مُوجَّهة', icon: Waypoints },
  responded: { tone: 'primary', label: 'Responded', labelAr: 'تمت الإجابة', icon: Reply },
  approved: { tone: 'success', label: 'Approved', labelAr: 'معتمدة', icon: ShieldCheck },
  archived: { tone: 'neutral', label: 'Archived', labelAr: 'مؤرشفة', icon: Archive },
};
