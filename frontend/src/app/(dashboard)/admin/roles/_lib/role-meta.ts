import {
  Crown,
  ShieldCheck,
  ShieldAlert,
  Scale,
  ClipboardCheck,
  Database,
  Sparkles,
  Landmark,
  LineChart,
  Briefcase,
  Shield,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types/models';

/**
 * Visual identity for a role card. `tile` is the full class bundle for the
 * leading icon chip (tinted surface + inset ring + icon color), authored as a
 * literal string so Tailwind's JIT can see every utility. Light + dark aware,
 * bound to the design-system color ramps (brand-primary / brand-gold /
 * brand-teal / success / warning / error / info / neutral).
 */
export interface RoleAccent {
  tile: string;
}

const ACCENTS = {
  primary: {
    tile: 'bg-brand-primary-500/10 text-brand-primary-600 ring-1 ring-inset ring-brand-primary-500/20 dark:bg-brand-primary-500/15 dark:text-brand-primary-300',
  },
  error: {
    tile: 'bg-error-500/10 text-error-600 ring-1 ring-inset ring-error-500/20 dark:bg-error-500/15 dark:text-error-300',
  },
  warning: {
    tile: 'bg-warning-500/12 text-warning-700 ring-1 ring-inset ring-warning-500/25 dark:bg-warning-500/15 dark:text-warning-300',
  },
  info: {
    tile: 'bg-info-500/10 text-info-600 ring-1 ring-inset ring-info-500/20 dark:bg-info-500/15 dark:text-info-300',
  },
  teal: {
    tile: 'bg-brand-teal-500/10 text-brand-teal-600 ring-1 ring-inset ring-brand-teal-500/20 dark:bg-brand-teal-500/15 dark:text-brand-teal-300',
  },
  gold: {
    tile: 'bg-brand-gold-500/12 text-brand-gold-700 ring-1 ring-inset ring-brand-gold-500/25 dark:bg-brand-gold-500/15 dark:text-brand-gold-300',
  },
  neutral: {
    tile: 'bg-neutral-500/10 text-neutral-600 ring-1 ring-inset ring-neutral-500/20 dark:bg-neutral-500/15 dark:text-neutral-300',
  },
} satisfies Record<string, RoleAccent>;

type AccentKey = keyof typeof ACCENTS;

interface Rule {
  kw: string[];
  icon: LucideIcon;
  accent: AccentKey;
}

/**
 * First matching rule wins, so order encodes precedence: a "Security Analyst"
 * resolves on `security` (red) before the generic `analyst` rule, "Legal
 * Manager" on `legal` before `manager`, and "Super Admin" on `super` before
 * `admin`.
 */
const RULES: Rule[] = [
  { kw: ['super'], icon: Crown, accent: 'primary' },
  { kw: ['security', 'cyber', 'soc', 'siem', 'threat', 'incident'], icon: ShieldAlert, accent: 'error' },
  { kw: ['legal', 'counsel', 'contract', 'clm', 'litig', 'attorney'], icon: Scale, accent: 'teal' },
  { kw: ['audit', 'oversight', 'inspect'], icon: ClipboardCheck, accent: 'warning' },
  { kw: ['complian', 'risk', 'regulat', 'policy'], icon: ShieldCheck, accent: 'warning' },
  { kw: ['data', 'steward', 'governance', 'quality'], icon: Database, accent: 'info' },
  { kw: ['board', 'secretary'], icon: Landmark, accent: 'gold' },
  { kw: ['exec', 'leadership', 'ceo', 'cxo', 'chief'], icon: Sparkles, accent: 'gold' },
  { kw: ['admin'], icon: ShieldCheck, accent: 'primary' },
  { kw: ['analyst'], icon: LineChart, accent: 'info' },
  { kw: ['manager', 'lead', 'head'], icon: Briefcase, accent: 'teal' },
];

export interface RoleVisual {
  Icon: LucideIcon;
  accent: RoleAccent;
}

/** Resolve a role to its icon + accent from its slug/name, with a system /
 * custom fallback when no keyword matches. */
export function getRoleVisual(role: Pick<Role, 'name' | 'slug' | 'is_system'>): RoleVisual {
  const haystack = `${role.slug} ${role.name}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.kw.some((k) => haystack.includes(k))) {
      return { Icon: rule.icon, accent: ACCENTS[rule.accent] };
    }
  }
  return {
    Icon: role.is_system ? Shield : UserCog,
    accent: role.is_system ? ACCENTS.neutral : ACCENTS.primary,
  };
}
