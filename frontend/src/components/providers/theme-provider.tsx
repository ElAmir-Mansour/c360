'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * Wraps next-themes. Applies the `dark` class to <html> (Tailwind class
 * strategy), persists the choice, and defaults to the user's system setting.
 * SSR flash is prevented by next-themes' inline script (requires
 * `suppressHydrationWarning` on <html>, already set in the root layout).
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
