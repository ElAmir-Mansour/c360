/**
 * ui-system — the ONE source of truth for the shared UI kit's variant recipes.
 *
 * This is a PURE module (no React runtime): it exports only cva objects, plain
 * className constants, and types, so non-client primitives (Server Components,
 * plain `.tsx` files without "use client") can import it freely.
 *
 * Everything here is TOKEN-ONLY — semantic Tailwind utilities bound to the
 * --ds-* design tokens (radius: rounded-{soft,softer,soft-lg,softest,input,
 * xl,…}; elevation: shadow-elevation-{1..4} / shadow-focus-ring; motion:
 * duration-{fast,normal} + ease-{standard,emphasized,decelerate,accelerate};
 * colour: bg-card/muted/background/popover, text-foreground/muted-foreground,
 * border-border, text-primary, *-status-{error,warning,success,info}). No raw
 * hex / px / rem for colour, space, type, radius, shadow or motion.
 *
 * RTL is first-class: spacing that differs across sides uses logical props
 * (ps-/pe-, start/end) — never physical left/right. Motion is gated behind
 * `motion-safe:` so `prefers-reduced-motion` users get an instant, calm result.
 */
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Density scale shared across the kit. `comfortable` reproduces the current
 * default heights/padding; `compact` is the opt-in denser register.
 */
export type Density = 'compact' | 'comfortable';

/* -------------------------------------------------------------------------- *
 * surfaceVariants — the canonical elevation / radius / background / padding /
 * blur / interactive system.
 *
 * This is a VERBATIM lift of the existing surface.tsx recipe so surface.tsx can
 * re-export it unchanged (same variant / radius / elevation / padding / blur /
 * interactive axes, same class outputs incl. surface-card / surface-panel /
 * glass / surface-stat / raised / bare, same defaults).
 *
 * `card` alignment note: the `.card` component class consumed by <Card> is the
 * `card` preset of THIS same system — it binds the identical --ds-surface-card /
 * --ds-border-default / --ds-elevation-1 tokens as `variant: 'card'` here, just
 * expressed as a globals.css @layer class instead of a Tailwind utility bundle.
 * Treat `<Surface variant="card">` and `.card` as the same surface.
 * -------------------------------------------------------------------------- */
export const surfaceVariants = cva('', {
  variants: {
    /** Surface chrome (background + border + resting shadow). */
    variant: {
      /** White/dark card — the dominant pattern. Legacy --card-* vars. */
      card: 'surface-card',
      /** Frosted shell/section panel. Legacy --panel-* vars. */
      panel: 'surface-panel',
      /** Translucent blurred glass. Reuses the existing `.glass` class. */
      glass: 'glass',
      /** Metric tile — same chrome as card, named for stat grids. */
      stat: 'surface-stat',
      /** DS-token raised surface (popover/menu family). */
      raised: 'border border-outline/70 bg-surface-raised text-foreground',
      /** No chrome — radius/padding only (e.g. nested cells). */
      bare: '',
    },
    /** Corner radius. Names map to the exact px the clusters used. */
    radius: {
      none: 'rounded-none',
      md: 'rounded-md',
      lg: 'rounded-lg',
      xl: 'rounded-xl',
      '2xl': 'rounded-2xl', // 20px — rounded-soft
      '3xl': 'rounded-3xl', // 24px — rounded-softer
      soft: 'rounded-soft', // 22px — rounded-soft
      softer: 'rounded-softer', // 26px — rounded-softer (most common)
      'soft-lg': 'rounded-soft-lg', // 28px — rounded-soft-lg
      softest: 'rounded-softest', // 30px — rounded-softest (shell frame)
      pill: 'rounded-full', // rounded-full pill surfaces
    },
    /** Elevation override. Omit to keep the variant's own resting shadow. */
    elevation: {
      none: 'shadow-none',
      1: 'shadow-elevation-1',
      2: 'shadow-elevation-2',
      3: 'shadow-elevation-3',
      4: 'shadow-elevation-4',
    },
    /** Inner padding rhythm (8pt). `none` for callers that pad themselves. */
    padding: {
      none: '',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-5',
      xl: 'p-6',
    },
    /** Frosted backdrop blur (several clusters pair the card with blur). */
    blur: {
      none: '',
      sm: 'backdrop-blur-md',
      lg: 'backdrop-blur-xl',
    },
    /** Hover lift (card-shadow -> card-shadow-hover). */
    interactive: {
      true: 'surface-card-interactive',
      false: '',
    },
  },
  defaultVariants: {
    variant: 'card',
    radius: 'softer',
    padding: 'none',
    blur: 'none',
    interactive: false,
  },
});

/* -------------------------------------------------------------------------- *
 * FOCUS_RING — the shared focus-visible ring used on every interactive element.
 * Token-only (shadow-focus-ring = --ds-elevation-focus). Pair `outline-none`
 * with the visible token ring so keyboard focus is always obvious (WCAG AA).
 * -------------------------------------------------------------------------- */
export const FOCUS_RING =
  'outline-none focus-visible:outline-none focus-visible:shadow-focus-ring';

/* -------------------------------------------------------------------------- *
 * controlBase / controlVariants — the shared recipe for form controls
 * (Input / Textarea / Select trigger / etc.).
 *
 * `controlBase` is the field chrome shared by every control:
 *   - background + border + radius + type + placeholder tokens
 *   - focus-visible token ring (shadow-focus-ring)
 *   - automatic invalid styling driven by `aria-[invalid=true]` (status-error)
 *   - disabled affordance (cursor + opacity)
 *
 * `controlVariants` adds the axes callers tune:
 *   - density  : compact | comfortable  (comfortable === the current Input:
 *                 h-11 min-h-[44px] with symmetric logical padding)
 *   - withIcon : none | leading | trailing | both — reserves logical padding for
 *                an adornment (ps-/pe-, so it flips correctly under RTL)
 *   - invalid  : true | false — an explicit override for callers that cannot set
 *                aria-invalid on the element; `false` is a no-op and defers to
 *                the aria-driven styles baked into controlBase.
 * -------------------------------------------------------------------------- */
export const controlBase =
  'flex w-full rounded-input border border-border bg-background text-body-sm text-foreground ring-offset-background transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard placeholder:text-muted-foreground hover:border-primary/30 focus-visible:outline-none focus-visible:border-primary/40 focus-visible:shadow-focus-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-status-error aria-[invalid=true]:hover:border-status-error aria-[invalid=true]:focus-visible:border-status-error aria-[invalid=true]:focus-visible:shadow-none aria-[invalid=true]:focus-visible:ring-2 aria-[invalid=true]:focus-visible:ring-status-error/30';

export const controlVariants = cva(controlBase, {
  variants: {
    /** Field height + inner padding. `comfortable` === current Input chrome. */
    density: {
      comfortable: 'h-11 min-h-[44px] ps-3.5 pe-3.5 py-2',
      compact: 'h-9 ps-3 pe-3 py-1.5',
    },
    /** Reserve logical padding for a leading/trailing adornment. */
    withIcon: {
      none: '',
      leading: 'ps-10',
      trailing: 'pe-10',
      both: 'ps-10 pe-10',
    },
    /** Explicit invalid override (mirrors the aria-driven styles). */
    invalid: {
      true: 'border-status-error hover:border-status-error focus-visible:border-status-error focus-visible:shadow-none focus-visible:ring-2 focus-visible:ring-status-error/30',
      false: '',
    },
  },
  defaultVariants: {
    density: 'comfortable',
    withIcon: 'none',
    invalid: false,
  },
});

/* -------------------------------------------------------------------------- *
 * Overlay chrome shared by dialog / sheet / dropdown / popover / tooltip /
 * command. Token-only raised surface + the standard Radix enter/exit motion,
 * gated behind `motion-safe:` so reduced-motion users get an instant appear.
 * -------------------------------------------------------------------------- */
export const OVERLAY_SURFACE =
  'z-50 rounded-soft border border-border bg-popover text-popover-foreground shadow-elevation-3 duration-fast ease-decelerate motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95';

/** Scrim behind modal overlays (dialog / sheet). */
export const OVERLAY_BACKDROP =
  'fixed inset-0 z-50 bg-black/80 duration-normal ease-standard motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=open]:fade-in-0';

/** Shared close button (top-end corner, RTL-safe via logical `end-`). */
export const OVERLAY_CLOSE =
  'absolute end-4 top-4 inline-flex items-center justify-center rounded-soft opacity-70 ring-offset-background transition-opacity duration-fast ease-standard hover:opacity-100 focus-visible:outline-none focus-visible:shadow-focus-ring disabled:pointer-events-none';

/* -------------------------------------------------------------------------- *
 * densityPadding — ONE density scale shared by button / control / table cell /
 * tab / badge, so every primitive breathes on the same rhythm. Each entry maps
 * a Density to a class fragment. Symmetric fragments use `px-` (identical under
 * RTL); the control fragment uses logical `ps-/pe-` to match controlVariants.
 * -------------------------------------------------------------------------- */
export const densityPadding = {
  /** Button height + inline padding. `comfortable` === Button size 'default'. */
  button: {
    comfortable: 'h-10 min-h-[44px] px-4 py-2',
    compact: 'h-9 px-3.5 py-2',
  },
  /** Form control height + logical inline padding. Mirrors controlVariants. */
  control: {
    comfortable: 'h-11 min-h-[44px] ps-3.5 pe-3.5 py-2',
    compact: 'h-9 ps-3 pe-3 py-1.5',
  },
  /** Table cell padding. `comfortable` === current TableCell `p-4`. */
  tableCell: {
    comfortable: 'px-4 py-3',
    compact: 'px-3 py-2',
  },
  /** Tab trigger padding. `comfortable` === current TabsTrigger. */
  tab: {
    comfortable: 'px-3.5 py-2',
    compact: 'px-2.5 py-1',
  },
  /** Badge padding. `comfortable` === current Badge. */
  badge: {
    comfortable: 'px-2.5 py-1',
    compact: 'px-2 py-0.5',
  },
} as const;

/** VariantProps helpers so wave-2 primitives can type their prop surfaces. */
export type SurfaceVariantProps = VariantProps<typeof surfaceVariants>;
export type ControlVariantProps = VariantProps<typeof controlVariants>;
