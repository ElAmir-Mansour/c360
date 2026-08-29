import {
  BellRing,
  LifeBuoy,
  Mail,
  Plug,
  Slack,
  SquareKanban,
  Users,
  Webhook,
  type LucideIcon,
} from "lucide-react";

/**
 * Per-provider brand identity for the External Integrations console.
 *
 * The live backend returns more provider types than the narrow TS union
 * (slack | teams | jira | servicenow | webhook): the connector registry also
 * emits `email` (SMTP), `pagerduty`, and `rest` (REST / Webhook), and may grow
 * further. So this resolver is keyed by an ARBITRARY string, normalizes it, and
 * matches by substring (first hit wins) so close variants ("Generic Webhook",
 * "REST / Webhook", "Email (SMTP)") all degrade onto the right glyph. Anything
 * unknown lands on a neutral {Plug, ''} fallback — an empty `badgeClassName`
 * leaves the IconBadge on its `tone="muted"` chip, so a tile is never blank.
 *
 * The brand tint is intentionally a fixed per-provider hue (not a --ds token):
 * provider identity colour is decorative and always paired with the provider
 * name as the real text label, so contrast obligations fall on the label, not
 * the hue. Lightness is kept high enough (≈40–55%) to stay legible on both the
 * light and dark card surface. All chrome around the chip stays on neutral
 * surface tokens so the grid reads as one cohesive, themeable catalogue.
 */
export interface ProviderVisual {
  icon: LucideIcon;
  /** Brand-tinted chip classes; empty string keeps the neutral `muted` chip. */
  badgeClassName: string;
}

interface ProviderRule {
  test: (k: string) => boolean;
  visual: ProviderVisual;
}

/** bg at low alpha + matching text colour, both off the same brand hue. */
function tint(h: number, s: number, l: number): string {
  return `bg-[hsl(${h}_${s}%_${l}%/0.14)] text-[hsl(${h}_${s}%_${l}%)]`;
}

const RULES: ProviderRule[] = [
  { test: (k) => k.includes("slack"), visual: { icon: Slack, badgeClassName: tint(331, 68, 50) } },
  { test: (k) => k.includes("team"), visual: { icon: Users, badgeClassName: tint(231, 45, 55) } },
  { test: (k) => k.includes("jira"), visual: { icon: SquareKanban, badgeClassName: tint(214, 80, 52) } },
  { test: (k) => k.includes("service"), visual: { icon: LifeBuoy, badgeClassName: tint(174, 55, 40) } },
  { test: (k) => k.includes("pager"), visual: { icon: BellRing, badgeClassName: tint(142, 60, 42) } },
  { test: (k) => k.includes("email") || k.includes("smtp") || k.includes("mail"), visual: { icon: Mail, badgeClassName: tint(199, 85, 48) } },
  { test: (k) => k.includes("webhook") || k.includes("rest") || k.includes("http"), visual: { icon: Webhook, badgeClassName: tint(222, 16, 52) } },
];

const FALLBACK: ProviderVisual = { icon: Plug, badgeClassName: "" };

/** Resolve a provider/integration type string to its brand glyph + chip tint. */
export function resolveProviderVisual(type: string): ProviderVisual {
  const k = (type ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const rule of RULES) {
    if (rule.test(k)) {
      return rule.visual;
    }
  }
  return FALLBACK;
}
