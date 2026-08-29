'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * CtaBand — full-width conversion band (headline + subcopy + CTA[s]).
 *
 * Two token-driven background treatments:
 *  - `primary`  : a brand-primary field with inverted on-primary text (high-impact
 *                 closing CTA).
 *  - `surface`  : a subtle card surface with primary text (mid-page, low-key CTA).
 *
 * CTAs are supplied as data (`href` + `label`) so the band is bilingual-ready and
 * stays a pure presentational component. The primary CTA renders a real anchor via
 * the shadcn Button (`asChild`), keeping native keyboard + focus semantics. The
 * leading icon flips automatically under RTL via the `rtl:rotate-180` logical hint.
 *
 * Accessibility: the band is a `<section>` landmark labelled by its headline; CTAs
 * are focusable links/buttons with visible focus rings (token focus ring); colour
 * pairings (on-primary over brand-primary, content-primary over surface) meet AA.
 *
 * Token discipline: colours (`brand-primary-*`, `content-*`, `surface-*`,
 * `outline-*`), radius (`rounded-card`), spacing (`section-y`, `section-x`,
 * `gutter`), shadow (`shadow-elevation-*`) and motion (`duration-*`, `ease-*`)
 * are token-backed. No hardcoded colours/spacing/type/radii/shadow/motion.
 */
const ctaBandVariants = cva(
  'relative w-full overflow-hidden px-section-x py-section-y transition-colors duration-normal ease-standard',
  {
    variants: {
      background: {
        primary:
          'bg-brand-primary-700 text-content-on-primary dark:bg-brand-primary-800',
        surface:
          'bg-surface-card text-content-primary border-y border-outline-subtle',
      },
    },
    defaultVariants: {
      background: 'primary',
    },
  },
);

export interface CtaAction {
  /** Localized button label. */
  label: React.ReactNode;
  /** Link target. When omitted, `onClick` is used as a plain button. */
  href?: string;
  /** Click handler (used when there is no `href`). */
  onClick?: () => void;
  /** Open external links in a new tab (adds rel=noopener). */
  external?: boolean;
  /** Accessible name override when the visible label is insufficient. */
  'aria-label'?: string;
}

export interface CtaBandProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'children'>,
    VariantProps<typeof ctaBandVariants> {
  /** Optional eyebrow / overline. */
  eyebrow?: React.ReactNode;
  /** Headline (required) — labels the section landmark. */
  headline: React.ReactNode;
  /** Supporting subcopy under the headline. */
  subcopy?: React.ReactNode;
  /** Primary call-to-action (required). */
  primaryAction: CtaAction;
  /** Optional secondary call-to-action. */
  secondaryAction?: CtaAction;
  /**
   * Heading level for the headline, for correct document outline.
   * @default 2
   */
  headingLevel?: 2 | 3;
}

function CtaButton({
  action,
  variant,
  onPrimary,
  showIcon,
}: {
  action: CtaAction;
  variant: 'primary' | 'secondary';
  onPrimary: boolean;
  showIcon?: boolean;
}) {
  // On a primary (brand) band, the buttons must invert to read against the field.
  const primaryOnDark =
    'bg-content-on-primary text-brand-primary-700 hover:bg-content-on-primary/90 shadow-elevation-2';
  const secondaryOnDark =
    'border border-content-on-primary/40 bg-transparent text-content-on-primary hover:bg-content-on-primary/10';

  const className =
    variant === 'primary'
      ? onPrimary
        ? primaryOnDark
        : undefined // default Button variant already uses brand primary on surface
      : onPrimary
        ? secondaryOnDark
        : 'border border-outline bg-surface-card text-content-primary hover:bg-bg-subtle';

  const buttonVariant = variant === 'primary' ? 'default' : 'outline';

  const content = (
    <>
      <span>{action.label}</span>
      {showIcon && (
        <ArrowRight className="ms-2 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      )}
    </>
  );

  if (action.href) {
    return (
      <Button
        asChild
        size="lg"
        variant={buttonVariant}
        className={cn('rounded-button', className)}
      >
        <a
          href={action.href}
          aria-label={action['aria-label']}
          {...(action.external
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          {content}
        </a>
      </Button>
    );
  }

  return (
    <Button
      size="lg"
      variant={buttonVariant}
      onClick={action.onClick}
      aria-label={action['aria-label']}
      className={cn('rounded-button', className)}
    >
      {content}
    </Button>
  );
}

/**
 * CtaBand renders a full-width, token-driven conversion band.
 */
export function CtaBand({
  background,
  eyebrow,
  headline,
  subcopy,
  primaryAction,
  secondaryAction,
  headingLevel = 2,
  className,
  ...props
}: CtaBandProps) {
  const headingId = React.useId();
  const onPrimary = (background ?? 'primary') === 'primary';
  const HeadingTag = (`h${headingLevel}` as unknown) as 'h2' | 'h3';

  return (
    <section
      aria-labelledby={headingId}
      className={cn(ctaBandVariants({ background }), className)}
      {...props}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 text-center md:flex-row md:items-center md:justify-between md:gap-gutter md:text-start">
        <div className="flex max-w-2xl flex-col gap-3">
          {eyebrow && (
            <span
              className={cn(
                'text-overline font-display font-semibold uppercase tracking-[0.08em]',
                onPrimary
                  ? 'text-content-on-primary/80'
                  : 'text-brand-primary-600 dark:text-brand-primary-300',
              )}
            >
              {eyebrow}
            </span>
          )}
          <HeadingTag
            id={headingId}
            className={cn(
              headingLevel === 2 ? 'text-h2' : 'text-h3',
              'font-display font-semibold',
              onPrimary ? 'text-content-on-primary' : 'text-content-primary',
            )}
          >
            {headline}
          </HeadingTag>
          {subcopy && (
            <p
              className={cn(
                'text-body-lg',
                onPrimary
                  ? 'text-content-on-primary/85'
                  : 'text-content-secondary',
              )}
            >
              {subcopy}
            </p>
          )}
        </div>

        <div className="flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:justify-center md:shrink-0">
          <CtaButton
            action={primaryAction}
            variant="primary"
            onPrimary={onPrimary}
            showIcon
          />
          {secondaryAction && (
            <CtaButton
              action={secondaryAction}
              variant="secondary"
              onPrimary={onPrimary}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Gallery / Storybook default export                                        */
/* ------------------------------------------------------------------------- */

export default function CtaBandGallery() {
  return (
    <div className="flex flex-col">
      <CtaBand
        background="primary"
        eyebrow="Prove recovery, on demand"
        headline="Rehearse your disaster recovery before the auditor asks."
        subcopy="ClarioDR turns runbooks into timed, sovereign drills with tamper-evident RTO evidence."
        primaryAction={{ label: 'Book a recovery walkthrough', href: '#book' }}
        secondaryAction={{ label: 'Read the runbook guide', href: '#guide' }}
      />
      <CtaBand
        background="surface"
        headline="Bring your own data mover. Keep your sovereignty."
        subcopy="Orchestrate failover inside your own boundary — SaaS, on-premises, or air-gapped."
        primaryAction={{ label: 'Start a sovereign trial', href: '#trial' }}
      />
    </div>
  );
}
