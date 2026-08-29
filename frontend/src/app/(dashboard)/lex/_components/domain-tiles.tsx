/**
 * The DOMAIN TILES band of the Watheeq Legal-Affairs command center: a
 * {@link CommandCard} opened by a {@link SectionHeader}
 * (`overview.domainsHeading`) wrapping a responsive 4→3→2 grid of
 * {@link DomainTile} — one per entry in {@link LEX_DOMAINS} the current user is
 * permitted to see.
 *
 * Counts come from the per-domain react-query fan-out
 * ({@link useLexDomainCounts}); each tile reads its own id-keyed slice. Tiles
 * reveal with a subtle, capped `animate-fade-up` stagger (disabled under
 * `prefers-reduced-motion` by the global CSS). Bilingual (EN/AR) + RTL inherited
 * from {@link DomainTile}, the command-ui primitives, and the surrounding
 * layout.
 */

'use client';

import { LayoutGrid } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useLexFormat } from '@/lib/lex/ksa';

import { CommandCard, SectionHeader } from './command-ui';
import { DomainTile } from './domain-tile';
import { LEX_DOMAINS } from '../_lib/lex-domains';
import {
  useLexDomainCounts,
  type DomainCount,
} from '../_lib/use-lex-command-center';
import { useLexLabels } from '../_lib/lex-i18n';

/** Largest stagger index — caps cumulative entrance delay on long grids. */
const MAX_STAGGER_INDEX = 11;
/** Per-step entrance delay (ms) for the fade-up stagger. */
const STAGGER_STEP_MS = 40;

/** Resolves to `{ count: null, isLoading: false }` when a slice is absent. */
const NO_COUNT: DomainCount = { count: null, isLoading: false };

/**
 * Local-only section chrome (eyebrow + description). Kept in-file per the i18n
 * rule — never added to the shared lex catalog. The section TITLE still comes
 * from `useLexLabels().overview.domainsHeading`.
 */
const CHROME = {
  en: {
    eyebrow: 'Workspace',
    description: 'Jump straight to any legal domain.',
  },
  ar: {
    eyebrow: 'مساحة العمل',
    description: 'انتقل مباشرة إلى أي مجال قانوني.',
  },
} as const;

export function DomainTiles() {
  const { hasPermission } = useAuth();
  const labels = useLexLabels();
  const f = useLexFormat();
  const counts = useLexDomainCounts();

  const t = CHROME[f.locale === 'ar' ? 'ar' : 'en'];

  const visible = LEX_DOMAINS.filter((domain) =>
    hasPermission(domain.permission),
  );

  return (
    <CommandCard
      accent="teal"
      className="bg-card"
    >
      <div className="space-y-4">
        <SectionHeader
          eyebrow={t.eyebrow}
          title={labels.overview.domainsHeading}
          description={t.description}
          icon={LayoutGrid}
          tone="primary"
        />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((domain, index) => (
            <div
              key={domain.id}
              className="animate-fade-up"
              style={{
                animationDelay: `${Math.min(index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS}ms`,
              }}
            >
              <DomainTile
                domain={domain}
                count={counts[domain.id] ?? NO_COUNT}
              />
            </div>
          ))}
        </div>
      </div>
    </CommandCard>
  );
}

export default DomainTiles;
