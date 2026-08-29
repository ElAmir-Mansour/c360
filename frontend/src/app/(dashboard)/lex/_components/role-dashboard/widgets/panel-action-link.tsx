import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import { cn } from '@/lib/utils';

export function PanelActionLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--wt-radius-pill)] px-2 py-1',
        'text-[length:var(--wt-font-size-caption)] font-bold text-[color:var(--wt-teal-700)]',
        'hover:bg-[var(--wt-canvas)] hover:text-[color:var(--wt-teal-900)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--wt-teal-700)]',
        className,
      )}
    >
      {label}
      <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
    </Link>
  );
}
