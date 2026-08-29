'use client';

/**
 * Specimen scaffolding for the design-system catalog: section landmarks,
 * labelled specimen frames, and LTR-pinned code blocks. Purely presentational,
 * token-driven, and safe under the page's RTL preview toggle.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

/** Top-level catalog section with a stable anchor id. */
export function DsSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('scroll-mt-28', className)}>
      <div className="border-b border-border/70 pb-3">
        <h2 id={headingId} className="text-h2 font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </section>
  );
}

/** A labelled specimen frame: caption bar + canvas, with an optional code strip. */
export function Specimen({
  id,
  title,
  description,
  children,
  code,
  canvasClassName,
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Optional usage snippet rendered under the canvas (always LTR). */
  code?: string;
  canvasClassName?: string;
  className?: string;
}) {
  return (
    <figure
      id={id}
      className={cn(
        'overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elevation-1',
        'scroll-mt-28',
        className,
      )}
    >
      <figcaption className="border-b border-border/60 bg-muted/40 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {description && (
          <span className="ms-2 text-xs text-muted-foreground/80">{description}</span>
        )}
      </figcaption>
      <div className={cn('p-4 sm:p-5', canvasClassName)}>{children}</div>
      {code && <CodeBlock code={code} className="rounded-none border-0 border-t" />}
    </figure>
  );
}

/** Horizontal wrap row for inline specimens (buttons, badges, chips …). */
export function SpecimenRow({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <span className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Code block. Pinned `dir="ltr"` + `text-start` so snippets read correctly
 * even while the page is previewed in RTL.
 */
export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <pre
      dir="ltr"
      className={cn(
        'overflow-x-auto rounded-xl border border-border/60 bg-muted/50 px-4 py-3 text-start font-mono text-xs leading-relaxed text-foreground/90',
        className,
      )}
    >
      <code>{code}</code>
    </pre>
  );
}

/** Inline token / class-name chip. */
export function TokenChip({ children }: { children: React.ReactNode }) {
  return (
    <code
      dir="ltr"
      className="rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-caption text-foreground/90"
    >
      {children}
    </code>
  );
}
