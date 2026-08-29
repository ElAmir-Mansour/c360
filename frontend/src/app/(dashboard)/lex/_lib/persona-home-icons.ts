/**
 * Lucide icon per persona-home quick-link id. Kept separate from the React-free
 * {@link import('./persona-home').PersonaHome} data module so that config stays
 * unit-testable without pulling in the icon library, while the component layer
 * resolves a distinct icon per card.
 */

import {
  Inbox,
  FilePlus2,
  CheckCircle2,
  Gavel,
  ShieldQuestion,
  Handshake,
  FileText,
  MessagesSquare,
  File,
  Sparkles,
  BookMarked,
  ClipboardList,
  FileBarChart,
  BarChart3,
  ShieldAlert,
  ShieldCheck,
  Building2,
  CalendarDays,
  Mails,
  Settings2,
  type LucideIcon,
} from 'lucide-react';

export const QUICK_LINK_ICONS: Record<string, LucideIcon> = {
  my_requests: Inbox,
  new_request: FilePlus2,
  request_approvals: CheckCircle2,
  cases: Gavel,
  investigations: ShieldQuestion,
  settlements: Handshake,
  contracts: FileText,
  consultations: MessagesSquare,
  documents: File,
  drafting: Sparkles,
  clause_library: BookMarked,
  playbooks: ClipboardList,
  reports: FileBarChart,
  analytics: BarChart3,
  risk_analytics: ShieldAlert,
  compliance: ShieldCheck,
  entities: Building2,
  calendar: CalendarDays,
  inbox: Mails,
  admin: Settings2,
};
