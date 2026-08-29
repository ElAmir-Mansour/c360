'use client';

/**
 * PERSONA HOME (§5 / §10) — the persona-aware "command center" band at the top
 * of the `/lex` landing page.
 *
 * Renders the active persona's PRIMARY MODULES as permission-filtered quick-link
 * cards under a persona-specific heading. A requester sees request-centric
 * links; an officer sees my-work links; a director sees command-center links; an
 * auditor sees compliance/audit; an admin sees configuration — driven by
 * {@link personaHomeForRole}.
 *
 * Each card is gated by its granular permission via `canAccessWith` (the shared
 * Wave-1 evaluator), so a card the persona cannot use never renders even if the
 * role→module mapping drifts — keeping the home safe under the
 * server-authoritative model.
 *
 * Visual layer composes the shared command-center primitives (`CommandCard` +
 * `SectionHeader` + `QuickActionCard`) so this section reads as ONE system with
 * the rest of the page. Token-only, bilingual + RTL, WCAG AA. No data change.
 */

import { LayoutGrid } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canAccessWith } from '@/lib/permissions';
import { useLexContext } from '@/lib/lex/use-lex-context';
import { useLexPersonaLabels } from '@/components/lex/persona/persona-labels';
import { personaHomeForRole } from '../_lib/persona-home';
import { QUICK_LINK_ICONS } from '../_lib/persona-home-icons';
import {
  CommandCard,
  SectionHeader,
  QuickActionCard,
  type CommandTone,
} from './command-ui';

const QUICK_LINK_TONES: Record<string, CommandTone> = {
  cases: 'warning',
  contracts: 'primary',
  request_approvals: 'info',
  compliance: 'success',
  analytics: 'info',
  admin: 'neutral',
};

export function PersonaHome() {
  const { hasPermission } = useAuth();
  const labels = useLexPersonaLabels();
  const { activeRole } = useLexContext();

  const home = personaHomeForRole(activeRole?.slug ?? null);
  const variantCopy = labels.home.variants[home.variant] ?? labels.home.variants.generic;

  // Permission-filter the persona's primary modules — never surface a card the
  // user cannot actually use (server remains authoritative).
  const visible = home.quickLinks.filter((link) =>
    canAccessWith(hasPermission, link.permission),
  );

  if (visible.length === 0) return null;

  return (
    <CommandCard
      accent="neutral"
      className="bg-card"
    >
      <div className="space-y-4">
        <SectionHeader
          icon={LayoutGrid}
          tone="primary"
          eyebrow={labels.home.quickLinksHeading}
          title={variantCopy.title}
          description={variantCopy.subtitle}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((link) => (
            <div key={link.id} data-testid={`persona-quick-link-${link.id}`}>
              <QuickActionCard
                icon={QUICK_LINK_ICONS[link.id] ?? LayoutGrid}
                title={labels.quickLinks[link.id] ?? link.id}
                href={link.href}
                tone={QUICK_LINK_TONES[link.id] ?? 'primary'}
                className="h-full"
              />
            </div>
          ))}
        </div>
      </div>
    </CommandCard>
  );
}
