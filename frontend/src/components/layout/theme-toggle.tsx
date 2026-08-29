'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

/**
 * Theme switcher for the header. Light / Dark / System with persistence via
 * next-themes. Renders a stable placeholder until mounted to avoid hydration
 * mismatch (server can't know the resolved theme).
 */
export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const Icon = !mounted
    ? Sun
    : resolvedTheme === 'dark'
      ? Moon
      : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Change theme"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-primary/15 bg-card text-foreground/65 shadow-sm transition-all hover:border-primary/30 hover:bg-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Icon className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {OPTIONS.map(({ value, label, icon: OptIcon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className="flex items-center gap-2"
          >
            <OptIcon className="h-4 w-4" />
            <span>{label}</span>
            {mounted && theme === value && (
              <span
                className={cn('ml-auto h-1.5 w-1.5 rounded-full bg-primary')}
                aria-hidden
              />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
