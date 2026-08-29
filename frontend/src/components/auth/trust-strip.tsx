import Link from 'next/link';
import {
  Globe,
  Landmark,
  Lock,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Capability #19 — Compliance & Data-Residency Trust Strip.
 *
 * A compact, accessible row of trust badges shown on the auth surface. Each
 * badge deep-links to `/trust` (the route may not yet exist — that is fine, it
 * degrades to a normal navigation that 404s until the page lands). Styling
 * mirrors the badge pill used in the `(auth)/layout.tsx` footer:
 *   `rounded-full border border-primary/15 bg-secondary/80 px-2.5 py-0.5`.
 *
 * Uses only `.auth-clario` palette tokens (text-foreground, text-primary,
 * border-primary/15, bg-secondary) and lucide-react icons. No new deps.
 *
 * ── Compliance-claim integrity ────────────────────────────────────────────
 * The default wording is ALIGNMENT language ("Aligned to NCA ECC"), never
 * certification language ("NCA ECC certified"). Claiming a certification the
 * company does not hold is a regulatory/legal exposure, so certification
 * wording is opt-in via configuration:
 *
 *   NEXT_PUBLIC_TRUST_BADGES = 'aligned' | 'certified' | 'hidden'
 *
 *   - 'aligned'   (default, also used for any unrecognized value): badges use
 *                 alignment wording; localized labels from the `labels` prop
 *                 (i18n `auth.trust`, which carries the same alignment tone)
 *                 apply as usual.
 *   - 'certified': restores certification wording. ONLY set this once the
 *                 certifications are actually held and evidenced. In this mode
 *                 the built-in certification strings are used verbatim and the
 *                 alignment-toned `labels` overrides are intentionally NOT
 *                 applied (they would water the claim back down / mismatch);
 *                 add localized certification copy when this mode is enabled.
 *   - 'hidden'   : the strip renders nothing.
 *
 * NEXT_PUBLIC_* values are inlined at build time — changing the flag requires
 * a rebuild.
 */

export type TrustBadgeMode = 'aligned' | 'certified' | 'hidden';

function resolveTrustBadgeMode(): TrustBadgeMode {
  const raw = process.env.NEXT_PUBLIC_TRUST_BADGES;
  return raw === 'certified' || raw === 'hidden' ? raw : 'aligned';
}

export const TRUST_BADGE_MODE: TrustBadgeMode = resolveTrustBadgeMode();

export interface TrustBadge {
  /** Short, screen-reader-friendly label. */
  label: string;
  /** lucide-react icon component. */
  icon: LucideIcon;
  /** Accessible description appended to the link's aria-label. */
  description: string;
}

/**
 * Default (alignment-worded) badge set. This is the canonical export — the
 * marketing `/trust` page consumes it positionally for icons, so the entry
 * order (NCA, SAMA, ISO, residency) is load-bearing and must not change.
 */
export const TRUST_BADGES: readonly TrustBadge[] = [
  {
    label: 'Aligned to NCA ECC',
    icon: ShieldCheck,
    description:
      'Security controls aligned to the National Cybersecurity Authority Essential Cybersecurity Controls (ECC)',
  },
  {
    label: 'SAMA CSF-aligned',
    icon: Landmark,
    description:
      'Controls aligned to the Saudi Central Bank (SAMA) Cyber Security Framework',
  },
  {
    label: 'ISO 27001-aligned controls',
    icon: Lock,
    description:
      'Information security management practices aligned to ISO/IEC 27001',
  },
  {
    label: 'Data hosted in KSA',
    icon: Globe,
    description: 'All tenant data resides within Saudi Arabia',
  },
] as const;

/**
 * Certification-worded badge set, used ONLY when
 * NEXT_PUBLIC_TRUST_BADGES='certified' (see the integrity note above). Same
 * entry order as TRUST_BADGES.
 */
const CERTIFIED_TRUST_BADGES: readonly TrustBadge[] = [
  {
    label: 'NCA ECC',
    icon: ShieldCheck,
    description: 'National Cybersecurity Authority Essential Cybersecurity Controls',
  },
  {
    label: 'SAMA CSF',
    icon: Landmark,
    description: 'Saudi Central Bank Cyber Security Framework',
  },
  {
    label: 'ISO 27001',
    icon: Lock,
    description: 'ISO/IEC 27001 information security management certification',
  },
  {
    label: 'Data hosted in KSA',
    icon: Globe,
    description: 'All tenant data resides within Saudi Arabia',
  },
] as const;

/**
 * Localized labels for the trust strip. Shape matches the `auth.trust` i18n
 * keys. When omitted (or a field is undefined), the hardcoded English defaults
 * from `TRUST_BADGES` / the `aria-label` below are used, so the component
 * degrades gracefully when rendered without i18n wiring.
 */
export interface TrustStripLabels {
  nca?: string;
  sama?: string;
  iso?: string;
  residency?: string;
  ariaLabel?: string;
  /** Localized long descriptions for aria-label/title (fall back to English). */
  ncaDescription?: string;
  samaDescription?: string;
  isoDescription?: string;
  residencyDescription?: string;
  /** Localized "View trust and compliance details." aria suffix. */
  viewDetails?: string;
}

export interface TrustStripProps {
  /**
   * Renders a tighter, icon-forward variant suitable for dense footers or
   * mobile. Defaults to the standard padded badge row.
   */
  compact?: boolean;
  /** Optional extra classes for the wrapping element. */
  className?: string;
  /** Override the destination route for each badge. Defaults to `/trust`. */
  href?: string;
  /**
   * Localized overrides for the badge labels and the nav aria-label. Each
   * field falls back to the hardcoded English default when omitted. Ignored
   * in 'certified' mode (see the compliance-claim integrity note above).
   */
  labels?: TrustStripLabels;
}

// Maps each badge to the `labels` fields that localize its visible text and
// its screen-reader description, so assistive tech hears the page language.
const BADGE_LABEL_KEYS: ReadonlyArray<keyof TrustStripLabels> = [
  'nca',
  'sama',
  'iso',
  'residency',
];
const BADGE_DESCRIPTION_KEYS: ReadonlyArray<keyof TrustStripLabels> = [
  'ncaDescription',
  'samaDescription',
  'isoDescription',
  'residencyDescription',
];

export function TrustStrip({
  compact = false,
  className,
  href = '/trust',
  labels,
}: TrustStripProps) {
  if (TRUST_BADGE_MODE === 'hidden') {
    return null;
  }

  const certified = TRUST_BADGE_MODE === 'certified';
  const badges = certified ? CERTIFIED_TRUST_BADGES : TRUST_BADGES;
  // The i18n `labels` carry alignment-toned copy; mixing them with the
  // certification badge set would produce contradictory claims, so overrides
  // only apply in 'aligned' mode.
  const localizedLabels = certified ? undefined : labels;
  const defaultAriaLabel = certified
    ? 'Compliance and data residency certifications'
    : 'Compliance alignment and data residency';

  return (
    <nav
      aria-label={localizedLabels?.ariaLabel ?? defaultAriaLabel}
      className={cn(
        'flex flex-wrap items-center text-foreground/70',
        compact ? 'gap-1.5 text-[10px]' : 'gap-2 text-[11px]',
        className,
      )}
    >
      {badges.map(({ label: defaultLabel, icon: Icon, description }, index) => {
        const label = localizedLabels?.[BADGE_LABEL_KEYS[index]] ?? defaultLabel;
        const localizedDescription =
          localizedLabels?.[BADGE_DESCRIPTION_KEYS[index]] ?? description;
        const viewDetails =
          localizedLabels?.viewDetails ?? 'View trust and compliance details.';

        return (
        <Link
          key={defaultLabel}
          href={href}
          aria-label={`${label} — ${localizedDescription}. ${viewDetails}`}
          title={localizedDescription}
          className={cn(
            'group inline-flex items-center rounded-full border border-primary/25 bg-secondary/90 font-medium text-foreground/75 transition-colors',
            'hover:border-primary/30 hover:bg-primary/10 hover:text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            compact ? 'gap-1 px-2 py-0.5' : 'gap-1.5 px-2.5 py-0.5',
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              'shrink-0 text-primary/80 transition-colors group-hover:text-primary',
              compact ? 'h-3 w-3' : 'h-3.5 w-3.5',
            )}
          />
          <span className="whitespace-nowrap">{label}</span>
        </Link>
        );
      })}
    </nav>
  );
}

export default TrustStrip;
