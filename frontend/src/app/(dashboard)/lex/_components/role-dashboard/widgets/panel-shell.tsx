import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PanelShellProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Token-bound, bidi-safe panel chrome shared by the Legal Director widgets.
 * The caller owns all copy, icon choice, actions, and panel content.
 */
export function PanelShell({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...props
}: PanelShellProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();

  return (
    <section
      aria-labelledby={ariaLabelledBy ?? titleId}
      aria-describedby={description ? (ariaDescribedBy ?? descriptionId) : ariaDescribedBy}
      className={cn(
        'min-w-0 max-w-full',
        'rounded-[var(--wt-radius-card)] border-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)]',
        'bg-[var(--wt-surface)] p-8 shadow-[var(--wt-elevation)]',
        'text-[color:var(--wt-teal-900)]',
        className,
      )}
      {...props}
    >
      <header className="flex items-start gap-4">
        {Icon ? (
          <span
            className={cn(
              'grid size-9 shrink-0 place-items-center rounded-[var(--wt-radius-pill)]',
              'bg-[var(--wt-warn-050)] text-[color:var(--wt-teal-900)]',
            )}
            aria-hidden="true"
          >
            <Icon className="size-4" aria-hidden="true" />
          </span>
        ) : null}

        <div className="min-w-0">
          <h2
            id={titleId}
            dir="auto"
            className={cn(
              'text-start font-bold tracking-tight',
              'text-[length:var(--wt-font-size-panel-title)] leading-[var(--wt-line-height-panel-title)]',
            )}
          >
            {title}
          </h2>
          {description ? (
            <p
              id={descriptionId}
              dir="auto"
              className={cn(
                'mt-[var(--wt-space-base)] text-start text-[color:var(--wt-teal-700)]',
                'text-[length:var(--wt-font-size-body)] leading-[var(--wt-line-height-body)]',
              )}
            >
              {description}
            </p>
          ) : null}
        </div>

        {action ? (
          <div
            className={cn(
              'ms-auto shrink-0',
              '[&_a:focus-visible]:outline-none [&_a:focus-visible]:ring-2',
              '[&_a:focus-visible]:ring-[color:var(--wt-teal-700)] [&_a:focus-visible]:ring-offset-2',
              '[&_a:focus-visible]:ring-offset-[color:var(--wt-surface)]',
              '[&_button:focus-visible]:outline-none [&_button:focus-visible]:ring-2',
              '[&_button:focus-visible]:ring-[color:var(--wt-teal-700)] [&_button:focus-visible]:ring-offset-2',
              '[&_button:focus-visible]:ring-offset-[color:var(--wt-surface)]',
            )}
          >
            {action}
          </div>
        ) : null}
      </header>

      <div
        className={cn(
          'mt-6',
          'text-[length:var(--wt-font-size-body)] leading-[var(--wt-line-height-body)]',
        )}
      >
        {children}
      </div>
    </section>
  );
}
