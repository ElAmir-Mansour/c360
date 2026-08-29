"use client";

/**
 * ChartPanel — titled `.card` shell around a chart, matching the suite's premium
 * panel look (gradient icon chip + title + optional description, then the body).
 * Shared across the risk / value sections of the Portfolio dashboard so every
 * panel is visually identical. Mirrors the analytics domain's `ChartPanel`.
 */

import { ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface ChartPanelProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional trailing slot in the header (e.g. a legend chip or stat). */
  aside?: React.ReactNode;
  /** Drill through to the register behind this analytic. */
  href?: string;
  className?: string;
  children: React.ReactNode;
}

export function ChartPanel({
  icon: Icon,
  title,
  description,
  aside,
  href,
  className,
  children,
}: ChartPanelProps) {
  return (
    <section className={cn("card p-5 motion-safe:animate-fade-up", className)}>
      <header className="mb-4 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[image:var(--ds-gradient-primary)] text-primary-foreground shadow-elevation-1 ring-1 ring-inset ring-white/15">
          <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            {href ? (
              <Link
                href={href}
                className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                {title}
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : (
              title
            )}
          </h3>
          {description ? (
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </header>
      {children}
    </section>
  );
}
