'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * App-wide sonner Toaster, styled on the design-system overlay primitives.
 *
 * - Theme-aware: follows next-themes (`light` / `dark`), falling back to
 *   sonner's own `system` detection when no ThemeProvider is mounted.
 * - Surface: consumes the `.toast-surface` component class from globals.css
 *   (raised surface + token border + elevation-4 + motion tokens), so toasts
 *   match popovers/dialogs in both light and dark mode.
 * - RTL: callers pass `dir` / `position` (see ToastProvider) so the stack
 *   anchors to the correct corner for Arabic.
 */
export function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme();
  const theme: ToasterProps['theme'] =
    resolvedTheme === 'dark' ? 'dark' : resolvedTheme === 'light' ? 'light' : 'system';

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      richColors={false}
      toastOptions={{
        classNames: {
          // `.toast-surface` wins over sonner's zero-specificity `:where()`
          // defaults, binding background/border/shadow/text to --ds-* tokens.
          toast: 'group toast toast-surface',
          title: 'group-[.toast]:font-medium group-[.toast]:text-foreground',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          closeButton:
            'group-[.toast]:bg-background group-[.toast]:text-muted-foreground group-[.toast]:border-border',
        },
      }}
      {...props}
    />
  );
}
